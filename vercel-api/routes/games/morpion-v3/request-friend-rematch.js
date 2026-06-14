const { requireAuth } = require("../../../lib/auth");
const {
  handlePreflight,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const { requestFriendMorpionRematchV3 } = require("../../../lib/morpion-v3");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const payload = await parseJsonBody(req);
    const result = await requestFriendMorpionRematchV3({
      uid: String(decoded.uid || "").trim(),
      payload,
    });
    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de relanse rematch prive Mopyon an.");
    console.error("[MORPION_V3_REQUEST_FRIEND_REMATCH]", {
      code: normalized.code || "internal",
      httpStatus: normalized.httpStatus || 500,
      message: normalized.message,
      details: normalized.details || null,
      stack: error?.stack || null,
    });
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
