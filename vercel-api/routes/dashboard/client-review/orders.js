const { db } = require("../../../lib/firebase-admin");
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
const { buildReviewOrderRow } = require("../../../lib/client-review");
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

    const pageSize = Math.min(30, Math.max(1, safeInt(payload.pageSize) || 8));
    const offset = Math.max(0, safeInt(payload.offset));
    const clientRef = db.collection("clients").doc(clientId);
    let ordersSnap = null;
    try {
      ordersSnap = await clientRef.collection("orders").orderBy("createdAtMs", "desc").get();
    } catch (_) {
      ordersSnap = await clientRef.collection("orders").get();
    }

    const orders = (ordersSnap.docs || [])
      .map((docSnap) => buildReviewOrderRow(docSnap))
      .sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0));
    const slice = orders.slice(offset, offset + pageSize);
    const nextOffset = offset + slice.length;

    sendJson(req, res, 200, {
      ok: true,
      clientId,
      total: orders.length,
      offset,
      nextOffset,
      pageSize,
      hasMore: nextOffset < orders.length,
      orders: slice,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger les commandes client.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
