const { admin, auth } = require("./firebase-admin");
const { db } = require("./firebase-admin");
const { sanitizeEmail } = require("./deposits");
const { walletRef, transferHistoryRef, sanitizeUsername } = require("./player-wallet");
const { buildBalancesPatch, readApprovedHtg, readProvisionalHtg, readWithdrawableHtg } = require("./wallet-htg");
const { safeInt, sanitizePhone, sanitizeText } = require("./safe");

function walletHistoryRef(uid) {
  return walletRef(uid).collection("xchanges");
}

async function deleteCollectionInChunks(collectionRef, batchSize = 400) {
  while (true) {
    const snap = await collectionRef.limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

function buildFundingPreview(walletData = {}) {
  const approvedHtgAvailable = readApprovedHtg(walletData);
  const provisionalHtgAvailable = readProvisionalHtg(walletData);
  const withdrawableHtg = readWithdrawableHtg(walletData, approvedHtgAvailable);
  return {
    approvedHtgAvailable,
    provisionalHtgAvailable,
    playableHtg: approvedHtgAvailable + provisionalHtgAvailable,
    withdrawableHtg,
    approvedDoesBalance: safeInt(
      walletData?.doesApprovedBalance
      ?? walletData?.approvedDoesBalance
      ?? walletData?.approvedDoes
    ),
  };
}

async function adminSetClientPassword({
  adminUid = "",
  adminEmail = "",
  payload = {},
} = {}) {
  const clientId = sanitizeText(payload.clientId || payload.uid || "", 160);
  const newPassword = String(payload.newPassword || "").trim();
  const note = sanitizeText(payload.note || "", 240);

  if (!clientId) {
    const error = new Error("Client introuvable.");
    error.httpStatus = 400;
    error.code = "invalid-argument";
    throw error;
  }
  if (newPassword.length < 6) {
    const error = new Error("Le nouveau mot de passe doit contenir au moins 6 caracteres.");
    error.httpStatus = 400;
    error.code = "invalid-argument";
    throw error;
  }

  const clientRef = walletRef(clientId);
  const clientSnap = await clientRef.get();
  if (!clientSnap.exists) {
    const error = new Error("Compte client introuvable.");
    error.httpStatus = 404;
    error.code = "not-found";
    throw error;
  }

  try {
    await auth.updateUser(clientId, { password: newPassword });
  } catch (updateError) {
    console.error("[DASHBOARD_ADMIN_PASSWORD] updateUser failed", {
      clientId,
      adminUid,
      adminEmail,
      code: String(updateError?.code || ""),
      message: String(updateError?.message || updateError),
    });
    const error = new Error("Impossible de reinitialiser le mot de passe pour ce compte.");
    error.httpStatus = 500;
    error.code = "internal";
    throw error;
  }

  const clientData = clientSnap.data() || {};
  const nowMs = Date.now();
  const auditData = {
    type: "client_password_reset",
    clientId,
    adminUid,
    adminEmail: sanitizeEmail(adminEmail || "", 160),
    note,
    createdAtMs: nowMs,
    clientEmail: sanitizeEmail(clientData.email || "", 160),
    clientPhone: sanitizePhone(clientData.phone || "", 40),
    clientUsername: sanitizeUsername(clientData.username || "", 24),
  };

  await Promise.allSettled([
    clientRef.set({
      passwordResetByAdminAtMs: nowMs,
      passwordResetByAdminEmail: sanitizeEmail(adminEmail || "", 160),
      passwordResetByAdminUid: sanitizeText(adminUid || "", 160),
      passwordResetMode: "admin_assisted",
      passwordResetSupportNote: note,
      updatedAtMs: nowMs,
    }, { merge: true }),
    db.collection("adminAuditLogs").add(auditData),
  ]);

  return {
    ok: true,
    clientId,
    client: {
      uid: clientId,
      email: sanitizeEmail(clientData.email || "", 160),
      phone: sanitizePhone(clientData.phone || "", 40),
      username: sanitizeUsername(clientData.username || "", 24),
      name: sanitizeText(clientData.name || clientData.displayName || "", 120),
    },
    passwordResetAtMs: nowMs,
  };
}

async function resetClientFinancialAccount({
  adminUid = "",
  adminEmail = "",
  payload = {},
} = {}) {
  const clientId = sanitizeText(payload.clientId || payload.uid || "", 160);
  const reason = sanitizeText(payload.reason || "", 240);
  const dryRun = payload.dryRun === true;

  if (!clientId) {
    const error = new Error("Client introuvable.");
    error.httpStatus = 400;
    error.code = "invalid-argument";
    throw error;
  }

  const clientRef = walletRef(clientId);
  const clientSnap = await clientRef.get();
  if (!clientSnap.exists) {
    const error = new Error("Compte client introuvable.");
    error.httpStatus = 404;
    error.code = "not-found";
    throw error;
  }

  const ordersRef = clientRef.collection("orders");
  const withdrawalsRef = clientRef.collection("withdrawals");
  const xchangesRef = walletHistoryRef(clientId);
  const transfersRef = transferHistoryRef(clientId);
  const pongWagersRef = clientRef.collection("pongWagers");
  const pongResultsRef = clientRef.collection("pongMatchResults");
  const morpionResultsRef = clientRef.collection("morpionRoomResults");
  const dameResultsRef = clientRef.collection("dameRoomResults");
  const duelResultsRef = clientRef.collection("duelRoomResults");
  const dominoResultsRef = clientRef.collection("roomResults");

  const [
    ordersSnap,
    withdrawalsSnap,
    xchangesSnap,
    transfersSnap,
    pongWagersSnap,
    pongResultsSnap,
    morpionResultsSnap,
    dameResultsSnap,
    duelResultsSnap,
    dominoResultsSnap,
  ] = await Promise.all([
    ordersRef.limit(1000).get(),
    withdrawalsRef.limit(1000).get(),
    xchangesRef.limit(1000).get(),
    transfersRef.limit(1000).get(),
    pongWagersRef.limit(1000).get(),
    pongResultsRef.limit(1000).get(),
    morpionResultsRef.limit(1000).get(),
    dameResultsRef.limit(1000).get(),
    duelResultsRef.limit(1000).get(),
    dominoResultsRef.limit(1000).get(),
  ]);

  const beforeFunding = buildFundingPreview(clientSnap.data() || {});
  const nowMs = Date.now();
  const zeroBalances = buildBalancesPatch({
    approvedHtg: 0,
    provisionalHtg: 0,
    withdrawableHtg: 0,
  });

  const resetPatch = {
    ...zeroBalances,
    balance: 0,
    depositBalance: 0,
    withdrawableBalance: 0,
    totalDepositHtg: 0,
    totalWithdrawalHtg: 0,
    approvedDepositsHtg: 0,
    approvedDepositBonusHtg: 0,
    reservedWithdrawalsHtg: 0,
    exchangedApprovedHtg: 0,
    totalExchangedApprovedHtg: 0,
    totalExchangedHtgEver: 0,
    transferSentHtgTotal: 0,
    transferReceivedHtgTotal: 0,
    transferFeePaidHtgTotal: 0,
    nativeGameEntryApprovedHtgTotal: 0,
    nativeGameRewardApprovedHtgTotal: 0,
    pendingWithdrawalPlayHtg: 0,
    welcomeBonusHtgAvailable: 0,
    welcomeBonusHtgConverted: 0,
    welcomeBonusHtgPlayed: 0,
    pendingPlayFromXchangeDoes: 0,
    pendingPlayFromReferralDoes: 0,
    pendingPlayFromWelcomeDoes: 0,
    hasApprovedDeposit: false,
    accountFrozen: false,
    freezeReason: "",
    withdrawalHold: false,
    withdrawalHoldReason: "",
    withdrawalHoldAtMs: 0,
    rejectedDepositStrikeCount: 0,
    activeRoomId: "",
    activeRoomJoinedAtMs: 0,
    activeDuelRoomId: "",
    activeDuelRoomJoinedAtMs: 0,
    activeMorpionRoomId: "",
    activeMorpionRoomJoinedAtMs: 0,
    activeDameRoomId: "",
    activeDameRoomJoinedAtMs: 0,
    activePongWagerId: "",
    activePongFriendRoomId: "",
    activePongRoomJoinedAtMs: 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
    financialResetAt: admin.firestore.FieldValue.serverTimestamp(),
    financialResetAtMs: nowMs,
    financialResetByUid: adminUid,
    financialResetByEmail: sanitizeEmail(adminEmail || "", 160),
    financialResetReason: reason || "",
  };

  const preview = {
    ok: true,
    dryRun,
    clientId,
    reason,
    before: beforeFunding,
    collections: {
      orders: ordersSnap.size,
      withdrawals: withdrawalsSnap.size,
      xchanges: xchangesSnap.size,
      transfers: transfersSnap.size,
      pongWagers: pongWagersSnap.size,
      pongMatchResults: pongResultsSnap.size,
      morpionRoomResults: morpionResultsSnap.size,
      dameRoomResults: dameResultsSnap.size,
      duelRoomResults: duelResultsSnap.size,
      roomResults: dominoResultsSnap.size,
    },
  };

  if (dryRun) {
    return preview;
  }

  await clientRef.set(resetPatch, { merge: true });

  await Promise.all([
    deleteCollectionInChunks(ordersRef),
    deleteCollectionInChunks(withdrawalsRef),
    deleteCollectionInChunks(xchangesRef),
    deleteCollectionInChunks(transfersRef),
    deleteCollectionInChunks(pongWagersRef),
    deleteCollectionInChunks(pongResultsRef),
    deleteCollectionInChunks(morpionResultsRef),
    deleteCollectionInChunks(dameResultsRef),
    deleteCollectionInChunks(duelResultsRef),
    deleteCollectionInChunks(dominoResultsRef),
  ]);

  await db.collection("adminAuditLogs").add({
    type: "client_financial_reset",
    clientId,
    reason: reason || "",
    adminUid,
    adminEmail: sanitizeEmail(adminEmail || "", 160),
    createdAtMs: nowMs,
    preview,
  });

  return {
    ...preview,
    resetDone: true,
    after: {
      approvedHtgAvailable: 0,
      provisionalHtgAvailable: 0,
      playableHtg: 0,
      withdrawableHtg: 0,
      approvedDoesBalance: 0,
    },
  };
}

module.exports = {
  adminSetClientPassword,
  resetClientFinancialAccount,
};
