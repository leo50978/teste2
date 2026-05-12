const { db } = require("../../lib/firebase-admin");
const { requireAuth } = require("../../lib/auth");
const {
  handlePreflight,
  normalizeError,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const { safeInt } = require("../../lib/safe");
const { computeOrderAmount, summarizePendingOrders } = require("../../lib/deposits");
const {
  buildFundingStatusDecorations,
  buildWithdrawalFundingStatus,
  listGameResultsForWithdrawalProgress,
} = require("../../lib/player-wallet");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const uid = String(decoded.uid || "").trim();
    const clientRef = db.collection("clients").doc(uid);
    const [clientSnap, ordersSnap, walletHistorySnap, withdrawalsSnap, gameResults] = await Promise.all([
      clientRef.get(),
      clientRef.collection("orders").get(),
      clientRef.collection("walletHistory").get(),
      clientRef.collection("withdrawals").get(),
      listGameResultsForWithdrawalProgress(uid),
    ]);
    const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
    const orders = ordersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
    const withdrawals = withdrawalsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
    const walletHistory = walletHistorySnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));

    const approvedHtgAvailable = safeInt(clientData.approvedHtgAvailable ?? clientData.approvedGourdesAvailable);
    const provisionalHtgAvailable = safeInt(clientData.provisionalHtgAvailable ?? clientData.provisionalGourdesAvailable);
    const playableHtg = safeInt(
      clientData.playableHtg
      ?? clientData.availableGourdes
      ?? (approvedHtgAvailable + provisionalHtgAvailable)
    );
    const pendingOrders = summarizePendingOrders(orders);
    const fundingDecorations = buildFundingStatusDecorations(clientData, orders);
    const withdrawalFunding = buildWithdrawalFundingStatus({
      walletData: { uid, ...clientData },
      orders,
      withdrawals,
      exchangeHistory: walletHistory,
      gameResults,
    });

    sendJson(req, res, 200, {
      ok: true,
      uid,
      ...clientData,
      pendingOrders,
      ...fundingDecorations,
      ...withdrawalFunding,
      approvedHtgAvailable,
      provisionalHtgAvailable,
      playableHtg,
      withdrawableHtg: safeInt(withdrawalFunding.withdrawableHtg),
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger l'etat financier.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
