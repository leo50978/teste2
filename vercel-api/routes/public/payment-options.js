const { db } = require("../../lib/firebase-admin");
const {
  handlePreflight,
  normalizeError,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const {
  APP_PUBLIC_SETTINGS_DOC,
  normalizePublicAppSettings,
  sanitizePublicMethod,
} = require("../../lib/payment-options");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST" && req.method !== "GET") {
    sendMethodNotAllowed(req, res, ["GET", "POST", "OPTIONS"]);
    return;
  }

  try {
    const [settingsSnap, methodsSnap] = await Promise.all([
      db.collection("settings").doc(APP_PUBLIC_SETTINGS_DOC).get(),
      db.collection("paymentMethods").get(),
    ]);

    const settings = normalizePublicAppSettings(settingsSnap.exists ? (settingsSnap.data() || {}) : {});
    const methods = methodsSnap.docs
      .map((docSnap) => sanitizePublicMethod(docSnap))
      .filter(Boolean);

    sendJson(req, res, 200, {
      ok: true,
      methods,
      settings,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger les options de paiement.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
