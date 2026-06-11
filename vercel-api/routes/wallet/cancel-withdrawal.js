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
const { safeInt, sanitizeText } = require("../../lib/safe");
const {
  computeReservedWithdrawalAmount,
  getWithdrawalStatus,
  isWithdrawalClientCancellableStatus,
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
    const withdrawalId = sanitizeText(payload.withdrawalId || payload.id || "", 160);

    if (!withdrawalId) {
      throw makeHttpError(400, "invalid-argument", "Retrait introuvable.");
    }

    const clientRef = walletRef(uid);
    const withdrawalRef = clientRef.collection("withdrawals").doc(withdrawalId);

    const result = await db.runTransaction(async (tx) => {
      const [withdrawalSnap, clientSnap] = await Promise.all([
        tx.get(withdrawalRef),
        tx.get(clientRef),
      ]);

      if (!withdrawalSnap.exists) {
        throw makeHttpError(404, "not-found", "Demande de retrait introuvable.");
      }

      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const withdrawalData = withdrawalSnap.data() || {};
      const currentStatus = getWithdrawalStatus(withdrawalData);

      if (
        currentStatus === "cancelled"
        || currentStatus === "canceled"
        || (currentStatus === "rejected" && String(withdrawalData.cancelledBy || "").trim().toLowerCase() === "client")
      ) {
        return {
          ok: true,
          alreadyCancelled: true,
          withdrawalId,
          status: "rejected",
        };
      }

      if (!isWithdrawalClientCancellableStatus(currentStatus)) {
        throw makeHttpError(409, "withdrawal-not-cancellable", "Ce retrait ne peut plus etre annule.");
      }

      const requestedAmount = computeReservedWithdrawalAmount(withdrawalData);
      const approvedHtg = readApprovedHtg(clientData);
      const provisionalHtg = readProvisionalHtg(clientData);
      const withdrawableHtg = readWithdrawableHtg(clientData, approvedHtg);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const balancesPatch = buildBalancesPatch({
        approvedHtg: approvedHtg + requestedAmount,
        provisionalHtg,
        withdrawableHtg: withdrawableHtg + requestedAmount,
      });

      tx.set(withdrawalRef, {
        status: "rejected",
        resolutionStatus: "rejected",
        rejectedReason: "Retrait annule par le client",
        cancelledBy: "client",
        cancelledAtMs: nowMs,
        cancelledAt: nowIso,
        updatedAt: nowIso,
        updatedAtMs: nowMs,
        customerEmail: email,
      }, { merge: true });

      tx.set(clientRef, {
        uid,
        email: email || clientData.email || "",
        ...balancesPatch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });

      return {
        ok: true,
        alreadyCancelled: false,
        withdrawalId,
        status: "rejected",
        approvedHtgAvailable: safeInt(balancesPatch.approvedHtgAvailable),
        provisionalHtgAvailable: safeInt(balancesPatch.provisionalHtgAvailable),
        playableHtg: safeInt(balancesPatch.playableHtg),
        withdrawableHtg: safeInt(balancesPatch.withdrawableHtg),
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible d'annuler le retrait.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
