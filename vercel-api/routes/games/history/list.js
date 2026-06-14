const { requireAuth } = require("../../../lib/auth");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const {
  collectClientGameHistoryRows,
  normalizeDashboardGameFilter,
  normalizeDashboardOpponentFilter,
} = require("../../../lib/client-review");
const { safeInt, safeSignedInt, sanitizeText } = require("../../../lib/safe");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const payload = await parseJsonBody(req);
    const authUid = sanitizeText(decoded.uid || "", 160);
    const clientId = sanitizeText(payload.clientId || payload.uid || authUid, 160);

    if (!authUid) {
      throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
    }
    if (!clientId || clientId !== authUid) {
      throw makeHttpError(403, "permission-denied", "Acces refuse.");
    }

    const rows = await collectClientGameHistoryRows(clientId, {
      startMs: safeSignedInt(payload.startMs),
      endMs: safeSignedInt(payload.endMs),
      game: normalizeDashboardGameFilter(payload.game || "all"),
      opponent: normalizeDashboardOpponentFilter(payload.opponent || "all"),
      result: payload.result || "all",
      minWonDoes: safeSignedInt(payload.minWonDoes),
      maxWonDoes: safeSignedInt(payload.maxWonDoes),
    });
    const pageSize = Math.min(3, Math.max(1, safeInt(payload.pageSize) || 3));
    const offset = Math.max(0, safeInt(payload.offset));
    const slice = rows.slice(offset, offset + pageSize);

    sendJson(req, res, 200, {
      ok: true,
      clientId,
      total: rows.length,
      offset,
      pageSize,
      hasMore: offset + pageSize < rows.length,
      rows: slice,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger l'historique des jeux.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
