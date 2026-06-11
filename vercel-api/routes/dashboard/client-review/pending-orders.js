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
const { getOrderResolutionStatus } = require("../../../lib/deposits");
const { sanitizeText } = require("../../../lib/safe");

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

    const ordersSnap = await db.collection("clients").doc(clientId).collection("orders").get();
    const orders = (ordersSnap.docs || [])
      .filter((docSnap) => {
        const status = getOrderResolutionStatus(docSnap.data() || {});
        return status === "pending" || status === "review";
      })
      .map((docSnap) => buildReviewOrderRow(docSnap))
      .sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0));

    sendJson(req, res, 200, {
      ok: true,
      clientId,
      count: orders.length,
      orders,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger les commandes pending du client.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
