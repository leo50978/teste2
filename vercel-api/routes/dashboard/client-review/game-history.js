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
  collectClientGameHistoryRows,
  normalizeDashboardGameFilter,
  normalizeDashboardOpponentFilter,
  summarizeClientFraudGameRows,
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
    await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const clientId = sanitizeText(payload.clientId || payload.uid || "", 160);
    if (!clientId) {
      throw makeHttpError(400, "invalid-argument", "Client introuvable.");
    }

    const game = normalizeDashboardGameFilter(payload.game || payload.gameKey || payload.gameType || "all");
    const opponent = normalizeDashboardOpponentFilter(payload.opponent || payload.opponentType || "all");
    const result = String(payload.result || "all").trim().toLowerCase();
    const pageSize = Math.min(50, Math.max(1, safeInt(payload.pageSize) || 12));
    const offset = Math.max(0, safeInt(payload.offset));
    const startMs = safeSignedInt(payload.startMs);
    const endMs = safeSignedInt(payload.endMs);
    const minWonDoes = safeSignedInt(payload.minWonDoes);
    const maxWonDoes = safeSignedInt(payload.maxWonDoes);

    const rows = await collectClientGameHistoryRows(clientId, {
      startMs,
      endMs,
      game,
      opponent,
      result,
      minWonDoes,
      maxWonDoes,
    });
    const slice = rows.slice(offset, offset + pageSize);
    const nextOffset = offset + slice.length;
    const summary = summarizeClientFraudGameRows(rows);

    sendJson(req, res, 200, {
      ok: true,
      clientId,
      game,
      opponent,
      result,
      minWonDoes,
      maxWonDoes,
      pageSize,
      offset,
      nextOffset,
      hasMore: nextOffset < rows.length,
      totalMatches: rows.length,
      summary: summary.summary,
      byGame: summary.byGame,
      rows: slice,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger l'historique de jeu du client.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
