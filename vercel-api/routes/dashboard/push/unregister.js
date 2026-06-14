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
  dashboardPushSubscriptionIdFromEndpoint,
  dashboardPushSubscriptionsCollection,
  sanitizeWebPushEndpoint,
} = require("../../../lib/dashboard-push");
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
    const endpoint = sanitizeWebPushEndpoint(payload.endpoint || "");
    const subscriptionId = sanitizeText(payload.subscriptionId || "", 128)
      || (endpoint ? dashboardPushSubscriptionIdFromEndpoint(endpoint) : "");

    if (!subscriptionId) {
      throw makeHttpError(400, "invalid-argument", "Subscription introuvable.");
    }

    const ref = dashboardPushSubscriptionsCollection().doc(subscriptionId);
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (String(data.uid || "") !== String(decoded.uid || "")) {
        throw makeHttpError(403, "permission-denied", "Subscription non autorisee.");
      }
      await ref.delete();
    }

    sendJson(req, res, 200, {
      ok: true,
      subscriptionId,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de retirer la subscription push.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
