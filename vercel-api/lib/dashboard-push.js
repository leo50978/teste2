const crypto = require("crypto");

const { db } = require("./firebase-admin");
const { makeHttpError } = require("./http");
const { sanitizeEmail } = require("./deposits");
const { sanitizeText } = require("./safe");

const DASHBOARD_PUSH_SUBSCRIPTIONS_COLLECTION = "dashboardPushSubscriptions";

function dashboardPushSubscriptionsCollection() {
  return db.collection(DASHBOARD_PUSH_SUBSCRIPTIONS_COLLECTION);
}

function sanitizeWebPushEndpoint(value, maxLength = 2000) {
  const out = sanitizeText(value || "", maxLength);
  if (!out) return "";
  if (!/^https:\/\/[^\s]+$/i.test(out)) return "";
  return out;
}

function sanitizeWebPushKey(value, maxLength = 512) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, maxLength);
}

function sanitizePushSubscriptionPayload(payload = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  const endpoint = sanitizeWebPushEndpoint(data.endpoint || "");
  const expirationTime = data.expirationTime == null ? null : Number(data.expirationTime);
  const keysRaw = data.keys && typeof data.keys === "object" ? data.keys : {};
  const p256dh = sanitizeWebPushKey(keysRaw.p256dh || "");
  const authKey = sanitizeWebPushKey(keysRaw.auth || "");
  return {
    endpoint,
    expirationTime: Number.isFinite(expirationTime) ? expirationTime : null,
    keys: {
      p256dh,
      auth: authKey,
    },
    platform: sanitizeText(data.platform || "", 80).toLowerCase(),
    userAgent: sanitizeText(data.userAgent || "", 240),
    enabled: data.enabled !== false,
  };
}

function validatePushSubscriptionPayload(payload = {}) {
  if (!payload.endpoint) {
    throw makeHttpError(400, "invalid-argument", "Endpoint push requis.");
  }
  if (!payload.keys?.p256dh || !payload.keys?.auth) {
    throw makeHttpError(400, "invalid-argument", "Cles push invalides.");
  }
}

function dashboardPushSubscriptionIdFromEndpoint(endpoint = "") {
  const safeEndpoint = sanitizeWebPushEndpoint(endpoint || "");
  if (!safeEndpoint) {
    throw makeHttpError(400, "invalid-argument", "Endpoint push invalide.");
  }
  return crypto.createHash("sha256").update(`dashboard-push:${safeEndpoint}`).digest("hex");
}

function getDashboardWebPushConfig() {
  return {
    publicKey: String(process.env.DASHBOARD_WEB_PUSH_PUBLIC_KEY || "").trim(),
    privateKey: String(process.env.DASHBOARD_WEB_PUSH_PRIVATE_KEY || "").trim(),
    subject: String(process.env.DASHBOARD_WEB_PUSH_SUBJECT || "mailto:admin@dominoeslakay.com").trim(),
  };
}

module.exports = {
  dashboardPushSubscriptionIdFromEndpoint,
  dashboardPushSubscriptionsCollection,
  getDashboardWebPushConfig,
  sanitizePushSubscriptionPayload,
  sanitizeWebPushEndpoint,
  validatePushSubscriptionPayload,
};
