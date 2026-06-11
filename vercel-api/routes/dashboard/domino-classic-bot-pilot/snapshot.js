const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const {
  handlePreflight,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const { getDominoClassicBotPilotSnapshot } = require("../../../lib/domino-classic");

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
    const result = await getDominoClassicBotPilotSnapshot(payload || {});
    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger le pilotage Domino classique.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
