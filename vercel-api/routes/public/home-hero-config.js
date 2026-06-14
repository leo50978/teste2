const {
  handlePreflight,
  normalizeError,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const { getPublicHomeHeroConfigPayload } = require("../../lib/public-config");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["GET", "POST", "OPTIONS"]);
    return;
  }

  try {
    const payload = await getPublicHomeHeroConfigPayload();
    sendJson(req, res, 200, payload);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger le hero public.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
