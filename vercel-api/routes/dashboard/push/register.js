const { admin } = require("../../../lib/firebase-admin");
const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const {
  handlePreflight,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const {
  dashboardPushSubscriptionIdFromEndpoint,
  dashboardPushSubscriptionsCollection,
  getDashboardWebPushConfig,
  sanitizePushSubscriptionPayload,
  validatePushSubscriptionPayload,
} = require("../../../lib/dashboard-push");
const { sanitizeEmail } = require("../../../lib/deposits");

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
    const subscription = sanitizePushSubscriptionPayload(payload.subscription || payload);
    validatePushSubscriptionPayload(subscription);

    const subscriptionId = dashboardPushSubscriptionIdFromEndpoint(subscription.endpoint);
    const nowMs = Date.now();
    await dashboardPushSubscriptionsCollection().doc(subscriptionId).set({
      uid: financeAdmin.uid,
      email: sanitizeEmail(financeAdmin.email || "", 160),
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime,
      keys: subscription.keys,
      platform: subscription.platform,
      userAgent: subscription.userAgent,
      enabled: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });

    sendJson(req, res, 200, {
      ok: true,
      subscriptionId,
      enabled: true,
      webPushEnabled: !!String(getDashboardWebPushConfig().publicKey || "").trim(),
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible d'enregistrer la subscription push.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
