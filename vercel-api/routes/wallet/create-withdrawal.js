const { admin, db } = require("../../lib/firebase-admin");
const { requireAuth } = require("../../lib/auth");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const { sanitizeEmail } = require("../../lib/deposits");
const { safeInt, sanitizePhone, sanitizeText } = require("../../lib/safe");
const {
  MAX_WITHDRAWAL_HTG,
  MIN_WITHDRAWAL_HTG,
  assertWithdrawalAllowed,
  computeRealApprovedDepositsHtg,
  walletRef,
} = require("../../lib/player-wallet");
const {
  buildBalancesPatch,
  readApprovedHtg,
  readProvisionalHtg,
  readWithdrawableHtg,
} = require("../../lib/wallet-htg");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const uid = String(decoded.uid || "").trim();
    const email = sanitizeEmail(decoded.email || "", 160);
    const payload = await parseJsonBody(req);
    const requestedAmount = safeInt(payload.requestedAmount ?? payload.amountHtg ?? payload.amountDoes);
    const destinationType = sanitizeText(payload.destinationType || payload.methodId || "", 80);
    const destinationValue = sanitizeText(payload.destinationValue || payload.phone || "", 160);
    const customerName = sanitizeText(payload.customerName || "", 120);
    const customerPhone = sanitizePhone(payload.customerPhone || payload.phone || "", 40);
    const clientRequestId = sanitizeText(payload.requestId || payload.clientRequestId || "", 120);

    if (!destinationType || !destinationValue || requestedAmount < MIN_WITHDRAWAL_HTG || requestedAmount > MAX_WITHDRAWAL_HTG) {
      throw makeHttpError(400, "invalid-argument", "Retrait invalide.");
    }

    const clientRef = walletRef(uid);
    const withdrawalsRef = clientRef.collection("withdrawals");

    const result = await db.runTransaction(async (tx) => {
      const newWithdrawalRef = withdrawalsRef.doc();
      const [clientSnap, ordersSnap, withdrawalsSnap] = await Promise.all([
        tx.get(clientRef),
        tx.get(clientRef.collection("orders")),
        tx.get(withdrawalsRef),
      ]);

      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const existingOrders = ordersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
      const existingWithdrawals = withdrawalsSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        data: docSnap.data() || {},
      }));

      assertWithdrawalAllowed(clientData);

      if (clientRequestId) {
        const duplicate = existingWithdrawals.find((item) => String(item.data?.clientRequestId || "") === clientRequestId);
        if (duplicate) {
          return {
            ok: true,
            duplicate: true,
            withdrawalId: duplicate.id,
            status: String(duplicate.data?.status || "pending"),
          };
        }
      }

      const approvedHtg = readApprovedHtg(clientData);
      const provisionalHtg = readProvisionalHtg(clientData);
      const withdrawableHtg = readWithdrawableHtg(clientData, approvedHtg);
      const pendingWithdrawalPlayHtg = safeInt(clientData.pendingWithdrawalPlayHtg);
      const approvedDepositsHtg = safeInt(computeRealApprovedDepositsHtg(existingOrders));

      if (provisionalHtg > 0) {
        throw makeHttpError(
          409,
          "withdrawal-pending-htg",
          `Ou gen ${provisionalHtg} HTG an atant. Ou pa ka fe yon demann retrait pandan montan sa a poko valide.`,
          {
            provisionalHtgAvailable: provisionalHtg,
            withdrawableHtg,
            approvedHtgAvailable: approvedHtg,
            requestedAmount,
          }
        );
      }

      if (pendingWithdrawalPlayHtg > 0) {
        throw makeHttpError(
          409,
          "withdrawal-play-required",
          `Ou dwe jwe pou ${pendingWithdrawalPlayHtg} HTG apre depo a avan ou ka fe yon retrait.`,
          {
            pendingWithdrawalPlayHtg,
            withdrawableHtg,
            approvedHtgAvailable: approvedHtg,
            requestedAmount,
          }
        );
      }

      if (approvedDepositsHtg <= 0 || withdrawableHtg <= 0) {
        throw makeHttpError(
          409,
          "withdrawal-deposit-required",
          "Ou dwe gen omwen yon depo apwouve avan ou ka fe yon retrait.",
          {
            approvedDepositsHtg,
            withdrawableHtg,
            approvedHtgAvailable: approvedHtg,
            requestedAmount,
          }
        );
      }

      if (requestedAmount > withdrawableHtg || requestedAmount > approvedHtg) {
        throw makeHttpError(
          409,
          "insufficient-funds",
          "Montant superieur au solde disponible.",
          {
            withdrawableHtg,
            approvedHtgAvailable: approvedHtg,
            requestedAmount,
          }
        );
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const balancesPatch = buildBalancesPatch({
        approvedHtg: approvedHtg - requestedAmount,
        provisionalHtg,
        withdrawableHtg: Math.max(0, withdrawableHtg - requestedAmount),
      });

      tx.set(newWithdrawalRef, {
        id: newWithdrawalRef.id,
        withdrawalId: newWithdrawalRef.id,
        uid,
        clientId: uid,
        clientUid: uid,
        status: "pending",
        resolutionStatus: "pending",
        requestedAmount,
        amount: requestedAmount,
        approvedAmountHtg: 0,
        methodId: destinationType,
        methodName: destinationType,
        destinationType,
        destinationValue,
        customerName,
        customerEmail: email,
        customerPhone,
        clientRequestId: clientRequestId || newWithdrawalRef.id,
        createdAtMs: nowMs,
        createdAt: nowIso,
        updatedAtMs: nowMs,
        updatedAt: nowIso,
      }, { merge: true });

      tx.set(clientRef, {
        uid,
        email: email || clientData.email || "",
        name: customerName || clientData.name || "",
        phone: customerPhone || clientData.phone || "",
        ...balancesPatch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      }, { merge: true });

      return {
        ok: true,
        duplicate: false,
        withdrawalId: newWithdrawalRef.id,
        status: "pending",
        approvedHtgAvailable: safeInt(balancesPatch.approvedHtgAvailable),
        provisionalHtgAvailable: safeInt(balancesPatch.provisionalHtgAvailable),
        playableHtg: safeInt(balancesPatch.playableHtg),
        withdrawableHtg: safeInt(balancesPatch.withdrawableHtg),
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de soumettre la demande de retrait.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
