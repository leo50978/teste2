const { admin, db } = require("../../../lib/firebase-admin");
const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const {
  computeOrderAmount,
  getOrderResolutionStatus,
  getPendingOrderAmountForSettlement,
} = require("../../../lib/deposits");
const { safeInt, sanitizeText } = require("../../../lib/safe");
const {
  buildBalancesPatch,
  readApprovedHtg,
  readProvisionalHtg,
  readWithdrawableHtg,
} = require("../../../lib/wallet-htg");
const { applyDepositResolvedStatsTx } = require("../../../lib/deposit-flow-stats");

async function resolveOrderDocument(orderId = "", clientId = "") {
  const safeOrderId = String(orderId || "").trim();
  const safeClientId = String(clientId || "").trim();
  if (!safeOrderId) return null;

  if (safeClientId) {
    const directRef = db.collection("clients").doc(safeClientId).collection("orders").doc(safeOrderId);
    const directSnap = await directRef.get();
    if (directSnap.exists) return directSnap;
  }

  const groupSnap = await db.collectionGroup("orders")
    .where(admin.firestore.FieldPath.documentId(), "==", safeOrderId)
    .limit(1)
    .get();
  if (groupSnap.empty) return null;
  return groupSnap.docs[0];
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const adminUser = await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const orderId = sanitizeText(payload.orderId || "", 160);
    const clientId = sanitizeText(payload.clientId || payload.uid || "", 160);
    const decision = String(payload.decision || "").trim().toLowerCase();
    const reason = sanitizeText(payload.reason || "", 240);

    if (!orderId || (decision !== "approve" && decision !== "reject")) {
      throw makeHttpError(400, "invalid-argument", "Payload de validation invalide.");
    }

    const orderDoc = await resolveOrderDocument(orderId, clientId);
    if (!orderDoc) {
      throw makeHttpError(404, "not-found", "Depot introuvable.");
    }

    const ownerRef = orderDoc.ref.parent.parent;
    const ownerUid = String(ownerRef?.id || "").trim();
    if (!ownerUid) {
      throw makeHttpError(409, "failed-precondition", "Compte depot introuvable.");
    }

    const result = await db.runTransaction(async (tx) => {
      const [orderSnap, clientSnap] = await Promise.all([
        tx.get(orderDoc.ref),
        tx.get(ownerRef),
      ]);

      if (!orderSnap.exists) {
        throw makeHttpError(404, "not-found", "Depot introuvable.");
      }

      const orderData = orderSnap.data() || {};
      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const resolutionStatus = getOrderResolutionStatus(orderData);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const settlementAmountHtg = getPendingOrderAmountForSettlement(orderData);
      const orderAmountHtg = computeOrderAmount(orderData);

      if (resolutionStatus !== "pending" && resolutionStatus !== "review") {
        return {
          ok: true,
          orderId,
          clientId: ownerUid,
          status: resolutionStatus,
          resolutionStatus,
          message: "Cette commande a deja ete traitee.",
        };
      }

      const approvedHtg = readApprovedHtg(clientData);
      const provisionalHtg = readProvisionalHtg(clientData);
      const withdrawableHtg = readWithdrawableHtg(clientData, approvedHtg);

      let nextApprovedHtg = approvedHtg;
      const nextProvisionalHtg = Math.max(0, provisionalHtg - settlementAmountHtg);
      let nextWithdrawableHtg = withdrawableHtg;

      if (decision === "approve") {
        nextApprovedHtg += settlementAmountHtg;
        nextWithdrawableHtg += settlementAmountHtg;
      }

      const balancesPatch = buildBalancesPatch({
        approvedHtg: nextApprovedHtg,
        provisionalHtg: nextProvisionalHtg,
        withdrawableHtg: nextWithdrawableHtg,
      });

      const orderPatch = decision === "approve"
        ? {
            status: "approved",
            resolutionStatus: "approved",
            approvedAmountHtg: orderAmountHtg,
            rejectedReason: "",
            provisionalHtgRemaining: 0,
            provisionalDoesRemaining: 0,
            provisionalGainDoes: 0,
            fundingSettledAtMs: nowMs,
            resolvedAtMs: nowMs,
            reviewResolvedAtMs: nowMs,
            approvedAtMs: nowMs,
            approvedAt: nowIso,
            approvedByUid: adminUser.uid,
            approvedByEmail: adminUser.email,
            reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
            reviewedAtMs: nowMs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtMs: nowMs,
          }
        : {
            status: "rejected",
            resolutionStatus: "rejected",
            rejectedReason: reason || "Rejete par l'admin.",
            provisionalHtgRemaining: 0,
            provisionalDoesRemaining: 0,
            provisionalGainDoes: 0,
            fundingSettledAtMs: nowMs,
            resolvedAtMs: nowMs,
            reviewResolvedAtMs: nowMs,
            rejectedAtMs: nowMs,
            rejectedAt: nowIso,
            rejectedByUid: adminUser.uid,
            rejectedByEmail: adminUser.email,
            reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
            reviewedAtMs: nowMs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtMs: nowMs,
          };

      tx.set(orderSnap.ref, orderPatch, { merge: true });
      applyDepositResolvedStatsTx(tx, {
        ...orderData,
        ...orderPatch,
      }, decision, nowMs);

      const clientPatch = {
        ...balancesPatch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      };

      if (decision === "reject") {
        clientPatch.accountFrozen = true;
        clientPatch.withdrawalHold = true;
        clientPatch.freezeReason = "deposit_rejected";
        clientPatch.freezeReasonLabel = "Depot rejete";
        clientPatch.freezeReasonAtMs = nowMs;
      }

      tx.set(ownerRef, clientPatch, { merge: true });

      return {
        ok: true,
        orderId,
        clientId: ownerUid,
        status: orderPatch.status,
        resolutionStatus: orderPatch.resolutionStatus,
        approvedHtgAvailable: safeInt(balancesPatch.approvedHtgAvailable),
        provisionalHtgAvailable: safeInt(balancesPatch.provisionalHtgAvailable),
        playableHtg: safeInt(balancesPatch.playableHtg),
        withdrawableHtg: safeInt(balancesPatch.withdrawableHtg),
        accountFrozen: decision === "reject" ? true : clientData.accountFrozen === true,
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de traiter la commande.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
