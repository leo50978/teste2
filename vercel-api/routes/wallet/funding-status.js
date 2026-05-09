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
const { buildFundingStatusDecorations } = require("../../lib/player-wallet");

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
    const [clientSnap, ordersSnap] = await Promise.all([
      clientRef.get(),
      clientRef.collection("orders").get(),
    ]);
    const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
    const orders = ordersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));

    const approvedHtgAvailable = safeInt(clientData.approvedHtgAvailable ?? clientData.approvedGourdesAvailable);
    const provisionalHtgAvailable = safeInt(clientData.provisionalHtgAvailable ?? clientData.provisionalGourdesAvailable);
    const playableHtg = safeInt(
      clientData.playableHtg
      ?? clientData.availableGourdes
      ?? (approvedHtgAvailable + provisionalHtgAvailable)
    );
    const withdrawableHtg = safeInt(clientData.withdrawableHtg);
    const pendingOrders = summarizePendingOrders(orders);
    const fundingDecorations = buildFundingStatusDecorations(clientData, orders);

    sendJson(req, res, 200, {
      ok: true,
      uid,
      ...clientData,
      pendingOrders,
      ...fundingDecorations,
      approvedHtgAvailable,
      provisionalHtgAvailable,
      playableHtg,
      withdrawableHtg,
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
