const { requireAuth } = require("../../../lib/auth");
const {
  handlePreflight,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const { joinMatchmakingDame } = require("../../../lib/dame");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const payload = await parseJsonBody(req);
    const result = await joinMatchmakingDame({
      uid: String(decoded.uid || "").trim(),
      email: String(decoded.email || "").trim(),
      payload,
    });
    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de rejoindre une partie de dame.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
