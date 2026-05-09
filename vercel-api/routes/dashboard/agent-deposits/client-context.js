const { db } = require("../../../lib/firebase-admin");
const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const { handlePreflight, makeHttpError, normalizeError, parseJsonBody, sendJson, sendMethodNotAllowed } = require("../../../lib/http");
const {
  AGENT_DEPOSIT_CONTEXT_ORDER_LIMIT,
  buildAgentDepositContextOrder,
  buildAgentDepositSearchRecord,
} = require("../../../lib/agent-deposits");
const { computeOrderAmount, getOrderResolutionStatus } = require("../../../lib/deposits");
const { safeInt, sanitizeText } = require("../../../lib/safe");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const clientId = sanitizeText(payload.clientId || payload.uid || "", 160);
    if (!clientId) {
      throw makeHttpError(400, "invalid-argument", "Client introuvable.");
    }

    const clientRef = db.collection("clients").doc(clientId);
    const clientSnap = await clientRef.get();
    if (!clientSnap.exists) {
      throw makeHttpError(404, "not-found", "Compte client introuvable.");
    }

    let ordersSnap = null;
    let withdrawalsSnap = null;
    try {
      ordersSnap = await clientRef.collection("orders").orderBy("createdAtMs", "desc").get();
    } catch (_) {
      ordersSnap = await clientRef.collection("orders").get();
    }
    try {
      withdrawalsSnap = await clientRef.collection("withdrawals").orderBy("createdAtMs", "desc").get();
    } catch (_) {
      withdrawalsSnap = await clientRef.collection("withdrawals").get();
    }

    const clientData = clientSnap.data() || {};
    const orders = (ordersSnap?.docs || []).map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
    const recentOrdersLimit = Math.min(20, Math.max(1, safeInt(payload.recentOrdersLimit) || AGENT_DEPOSIT_CONTEXT_ORDER_LIMIT));
    const approvedDepositsHtg = orders.reduce((sum, item) => {
      return getOrderResolutionStatus(item) === "approved" ? (sum + computeOrderAmount(item)) : sum;
    }, 0);
    const client = buildAgentDepositSearchRecord(clientSnap.id, {
      ...clientData,
      approvedDepositsHtg,
      hasApprovedDeposit: approvedDepositsHtg > 0 || clientData.hasApprovedDeposit === true,
    });
    const recentOrders = (ordersSnap?.docs || [])
      .map((docSnap) => buildAgentDepositContextOrder(docSnap))
      .sort((left, right) => safeInt(right.createdAtMs) - safeInt(left.createdAtMs))
      .slice(0, recentOrdersLimit);

    sendJson(req, res, 200, {
      ok: true,
      client,
      fundingSnapshot: {
        approvedHtgAvailable: client.approvedHtgAvailable,
        provisionalHtgAvailable: client.provisionalHtgAvailable,
        playableHtg: client.playableHtg,
        withdrawableHtg: client.withdrawableHtg,
        approvedDepositsHtg: client.approvedDepositsHtg,
      },
      recentOrders,
      recentOrdersTotal: ordersSnap?.size || recentOrders.length,
      recentOrdersHasMore: safeInt(ordersSnap?.size) > recentOrders.length,
      recentWithdrawals: (withdrawalsSnap?.docs || []).slice(0, 8).map((docSnap) => {
        const data = docSnap.data() || {};
        return {
          id: docSnap.id,
          status: String(data.status || data.resolutionStatus || "").trim().toLowerCase(),
          amountHtg: safeInt(data.amountHtg ?? data.requestedAmount ?? data.amount),
          createdAtMs: safeInt(data.createdAtMs),
        };
      }),
      recentWithdrawalsTotal: withdrawalsSnap?.size || 0,
      recentWithdrawalsHasMore: safeInt(withdrawalsSnap?.size) > 8,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger le contexte client.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
