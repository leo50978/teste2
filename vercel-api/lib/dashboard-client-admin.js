const { admin, auth } = require("./firebase-admin");
const { db } = require("./firebase-admin");
const { sanitizeEmail } = require("./deposits");
const { buildBalancesPatch, doesToHtg, readApprovedHtg, readProvisionalHtg, readWithdrawableHtg } = require("./wallet-htg");
const { walletRef, transferHistoryRef, sanitizeUsername } = require("./player-wallet");
const { safeInt, sanitizePhone, sanitizeText } = require("./safe");

const DELETED_CLIENTS_ARCHIVE_COLLECTION = "deletedClientsArchive";
const CLIENT_DELETION_REVIEW_ARCHIVED_STATUS = "archived";
const BOOTSTRAP_DOC_ID = "dpayment_admin_bootstrap";

function walletHistoryRef(uid) {
  return walletRef(uid).collection("xchanges");
}

async function readBootstrapAdminEmail() {
  try {
    const snap = await db.collection("settings").doc(BOOTSTRAP_DOC_ID).get();
    return snap.exists ? sanitizeEmail(snap.data()?.email || "", 160) : "";
  } catch (_) {
    return "";
  }
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

function getClientDeletionReviewStatus(client = {}) {
  const status = sanitizeText(client.deletionReviewStatus || "", 40).toLowerCase();
  return status === CLIENT_DELETION_REVIEW_ARCHIVED_STATUS ? status : "";
}

function getClientDeletionReviewBalanceSnapshot(client = {}) {
  const approvedHtgAvailable = readApprovedHtg(client);
  const provisionalHtgAvailable = readProvisionalHtg(client);
  const htgBalance = approvedHtgAvailable + provisionalHtgAvailable;
  const doesBalance = safeInt(
    client?.doesBalance
    || (safeInt(client?.doesApprovedBalance) + safeInt(client?.doesProvisionalBalance))
  );
  return {
    approvedHtgAvailable,
    provisionalHtgAvailable,
    htgBalance,
    doesBalance,
    hasBalance: htgBalance > 0 || doesBalance > 0,
  };
}

async function isClientProtectedFromDeletionReview(clientId = "", client = {}) {
  const bootstrapEmail = await readBootstrapAdminEmail();
  const email = sanitizeEmail(client.email || "", 160);
  const agentStatus = sanitizeText(client.agentStatus || "", 40).toLowerCase();
  return (
    client.accountArchived === true
    || getClientDeletionReviewStatus(client) === CLIENT_DELETION_REVIEW_ARCHIVED_STATUS
    || (!!bootstrapEmail && email === bootstrapEmail)
    || clientId === BOOTSTRAP_DOC_ID
    || client.isAgent === true
    || agentStatus === "active"
  );
}

async function getClientDeletionBlockers(clientId = "", clientData = {}) {
  const balance = getClientDeletionReviewBalanceSnapshot(clientData);
  const [ordersSnap, withdrawalsSnap, xchangesSnap, transfersSnap, pongWagersSnap, pongResultsSnap, morpionResultsSnap, dameResultsSnap, duelResultsSnap, dominoResultsSnap] = await Promise.all([
    walletRef(clientId).collection("orders").limit(1).get().catch(() => ({ empty: true })),
    walletRef(clientId).collection("withdrawals").limit(1).get().catch(() => ({ empty: true })),
    walletHistoryRef(clientId).limit(1).get().catch(() => ({ empty: true })),
    transferHistoryRef(clientId).limit(1).get().catch(() => ({ empty: true })),
    walletRef(clientId).collection("pongWagers").limit(1).get().catch(() => ({ empty: true })),
    walletRef(clientId).collection("pongMatchResults").limit(1).get().catch(() => ({ empty: true })),
    walletRef(clientId).collection("morpionRoomResults").limit(1).get().catch(() => ({ empty: true })),
    walletRef(clientId).collection("dameRoomResults").limit(1).get().catch(() => ({ empty: true })),
    walletRef(clientId).collection("duelRoomResults").limit(1).get().catch(() => ({ empty: true })),
    walletRef(clientId).collection("roomResults").limit(1).get().catch(() => ({ empty: true })),
  ]);

  const htgFromDoes = doesToHtg(balance.doesBalance);
  return {
    hasBalance: balance.hasBalance,
    approvedHtgAvailable: balance.approvedHtgAvailable,
    provisionalHtgAvailable: balance.provisionalHtgAvailable,
    htgBalance: balance.htgBalance,
    doesBalance: balance.doesBalance,
    equivalentLegacyHtgBalance: htgFromDoes,
    hasOrders: ordersSnap?.empty === false,
    hasWithdrawals: withdrawalsSnap?.empty === false,
    hasHistory: xchangesSnap?.empty === false
      || transfersSnap?.empty === false
      || pongWagersSnap?.empty === false
      || pongResultsSnap?.empty === false
      || morpionResultsSnap?.empty === false
      || dameResultsSnap?.empty === false
      || duelResultsSnap?.empty === false
      || dominoResultsSnap?.empty === false,
    isProtected: await isClientProtectedFromDeletionReview(clientId, clientData),
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

async function deleteClientAccount({
  adminUid = "",
  adminEmail = "",
  payload = {},
} = {}) {
  const clientId = sanitizeText(payload.clientId || payload.uid || "", 160);
  const note = sanitizeText(payload.note || payload.reason || "", 240);

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

  const clientData = clientSnap.data() || {};
  const blockers = await getClientDeletionBlockers(clientId, clientData);
  if (blockers.isProtected) {
    const error = new Error("Ce compte est protege et ne peut pas etre supprime.");
    error.httpStatus = 412;
    error.code = "protected-account";
    error.details = { blockers };
    throw error;
  }
  if (blockers.hasBalance || blockers.hasOrders || blockers.hasWithdrawals || blockers.hasHistory) {
    const error = new Error("Ce compte doit etre archive et non supprime, car il possede encore un solde ou un historique financier.");
    error.httpStatus = 412;
    error.code = "archive-required";
    error.details = { blockers };
    throw error;
  }

  const nowMs = Date.now();
  await db.collection(DELETED_CLIENTS_ARCHIVE_COLLECTION).doc(clientId).set({
    clientId,
    mode: "deleted_hard",
    note,
    deletedAtMs: nowMs,
    deletedByUid: sanitizeText(adminUid || "", 160),
    deletedByEmail: sanitizeEmail(adminEmail || "", 160),
    client: {
      ...clientData,
      email: sanitizeEmail(clientData.email || "", 160),
      phone: sanitizePhone(clientData.phone || "", 40),
      username: sanitizeUsername(clientData.username || "", 24),
    },
    blockers,
  }, { merge: true });

  try {
    await auth.deleteUser(clientId);
  } catch (deleteError) {
    const code = String(deleteError?.code || "");
    if (!code.includes("user-not-found")) {
      console.error("[DASHBOARD_CLIENT_DELETE] auth.deleteUser failed", {
        clientId,
        adminUid,
        adminEmail,
        code,
        message: String(deleteError?.message || deleteError),
      });
      const error = new Error("Impossible de supprimer ce compte Firebase Auth.");
      error.httpStatus = 500;
      error.code = "auth-delete-failed";
      throw error;
    }
  }

  await Promise.allSettled([
    clientRef.delete(),
    db.collection("adminAuditLogs").add({
      type: "client_account_deleted",
      clientId,
      adminUid: sanitizeText(adminUid || "", 160),
      adminEmail: sanitizeEmail(adminEmail || "", 160),
      note,
      createdAtMs: nowMs,
    }),
  ]);

  return {
    ok: true,
    clientId,
    deleted: true,
    deletedAtMs: nowMs,
    note,
  };
}

module.exports = {
  adminSetClientPassword,
  deleteClientAccount,
  resetClientFinancialAccount,
};
