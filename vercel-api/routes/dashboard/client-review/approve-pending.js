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
  sanitizeEmail,
} = require("../../../lib/deposits");
const { safeInt, sanitizeText } = require("../../../lib/safe");
const { buildBalancesPatch, readApprovedHtg, readProvisionalHtg, readWithdrawableHtg } = require("../../../lib/wallet-htg");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const financeAdmin = await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const clientId = sanitizeText(payload.clientId || payload.uid || "", 160);
    if (!clientId) {
      throw makeHttpError(400, "invalid-argument", "Client introuvable.");
    }

    const clientRef = db.collection("clients").doc(clientId);
    const result = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists) {
        throw makeHttpError(404, "not-found", "Compte client introuvable.");
      }

      const ordersSnap = await tx.get(clientRef.collection("orders"));
      const clientData = clientSnap.data() || {};
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const pendingOrders = ordersSnap.docs
        .map((orderSnap) => ({ snap: orderSnap, data: orderSnap.data() || {} }))
        .filter((item) => {
          const status = getOrderResolutionStatus(item.data);
          return status === "pending" || status === "review";
        });

      const currentApprovedHtg = readApprovedHtg(clientData);
      const currentProvisionalHtg = readProvisionalHtg(clientData);
      const currentWithdrawableHtg = readWithdrawableHtg(clientData, currentApprovedHtg);
      const approvedOrdersCount = pendingOrders.length;
      const approvedHtgMoved = currentProvisionalHtg;
      const totalPendingOrdersHtg = pendingOrders.reduce((sum, item) => sum + computeOrderAmount(item.data), 0);

      pendingOrders.forEach((item) => {
        tx.set(item.snap.ref, {
          status: "approved",
          resolutionStatus: "approved",
          approvedAmountHtg: computeOrderAmount(item.data),
          rejectedReason: "",
          provisionalHtgRemaining: 0,
          provisionalDoesRemaining: 0,
          provisionalGainDoes: 0,
          fundingSettledAtMs: safeInt(item.data.fundingSettledAtMs) || nowMs,
          resolvedAtMs: safeInt(item.data.resolvedAtMs) || nowMs,
          reviewResolvedAtMs: safeInt(item.data.reviewResolvedAtMs) || nowMs,
          approvedAtMs: safeInt(item.data.approvedAtMs) || nowMs,
          approvedAt: String(item.data.approvedAt || nowIso),
          approvedByUid: sanitizeText(financeAdmin.uid || "", 160),
          approvedByEmail: sanitizeEmail(financeAdmin.email || "", 160),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        }, { merge: true });
      });

      const nextApprovedHtg = currentApprovedHtg + approvedHtgMoved;
      const nextProvisionalHtg = 0;
      const nextWithdrawableHtg = currentWithdrawableHtg + approvedHtgMoved;

      tx.set(clientRef, {
        ...buildBalancesPatch({
          approvedHtg: nextApprovedHtg,
          provisionalHtg: nextProvisionalHtg,
          withdrawableHtg: nextWithdrawableHtg,
        }),
        lastPendingBalanceApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastPendingBalanceApprovedAtMs: nowMs,
        lastPendingBalanceApprovedByUid: sanitizeText(financeAdmin.uid || "", 160),
        lastPendingBalanceApprovedByEmail: sanitizeEmail(financeAdmin.email || "", 160),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });

      return {
        ok: true,
        clientId,
        approvedOrdersCount,
        approvedHtgMoved,
        totalPendingOrdersHtg,
        before: {
          approvedHtgAvailable: currentApprovedHtg,
          provisionalHtgAvailable: currentProvisionalHtg,
          withdrawableHtg: currentWithdrawableHtg,
        },
        after: {
          approvedHtgAvailable: nextApprovedHtg,
          provisionalHtgAvailable: nextProvisionalHtg,
          withdrawableHtg: nextWithdrawableHtg,
        },
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible d'approuver les soldes pending du client.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
