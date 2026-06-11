const { db } = require("../../../lib/firebase-admin");
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
  buildClientFraudAnalysis,
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
    await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const clientId = sanitizeText(payload.clientId || payload.uid || "", 160);
    if (!clientId) {
      throw makeHttpError(400, "invalid-argument", "Client introuvable.");
    }

    const game = normalizeDashboardGameFilter(payload.game || payload.gameKey || payload.gameType || "all");
    const opponent = normalizeDashboardOpponentFilter(payload.opponent || payload.opponentType || "all");
    const result = String(payload.result || "all").trim().toLowerCase();
    const startMs = safeSignedInt(payload.startMs);
    const endMs = safeSignedInt(payload.endMs);
    const minWonDoes = safeSignedInt(payload.minWonDoes);
    const maxWonDoes = safeSignedInt(payload.maxWonDoes);
    const findingsLimit = Math.min(50, Math.max(5, safeInt(payload.findingsLimit) || 12));
    const timelineLimit = Math.min(60, Math.max(10, safeInt(payload.timelineLimit) || 20));

    const clientRef = db.collection("clients").doc(clientId);
    const [clientSnap, ordersSnap, withdrawalsSnap, gameRows] = await Promise.all([
      clientRef.get(),
      clientRef.collection("orders").get(),
      clientRef.collection("withdrawals").get(),
      collectClientGameHistoryRows(clientId, {
        startMs,
        endMs,
        game,
        opponent,
        result,
        minWonDoes,
        maxWonDoes,
      }),
    ]);

    if (!clientSnap.exists) {
      throw makeHttpError(404, "not-found", "Compte client introuvable.");
    }

    const analysis = buildClientFraudAnalysis({
      clientData: clientSnap.data() || {},
      orders: (ordersSnap.docs || []).map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) })),
      withdrawals: (withdrawalsSnap.docs || []).map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) })),
      gameRows,
      startMs,
      endMs,
      findingsLimit,
      timelineLimit,
    });

    sendJson(req, res, 200, analysis);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger l'analyse client.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
