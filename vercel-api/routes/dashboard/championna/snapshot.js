const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const { db } = require("../../../lib/firebase-admin");
const {
  handlePreflight,
  normalizeError,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");

const GAME_OPTIONS = Object.freeze([
  { key: "domino", name: "Domino" },
  { key: "mopyon", name: "Mopyon" },
  { key: "dame", name: "Dame" },
  { key: "ludo", name: "Ludo" },
  { key: "echec", name: "Echec" },
]);

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeMatch(match = {}) {
  const source = match && typeof match === "object" ? match : {};
  return {
    ...source,
    id: String(source.id || "").trim(),
    round: String(source.round || "").trim(),
    roundLabel: String(source.roundLabel || "Match").trim() || "Match",
    roundOrder: safeNumber(source.roundOrder, 99),
    order: safeNumber(source.order, 99),
    status: String(source.status || "scheduled").trim() || "scheduled",
    homeName: String(source.homeName || "TBD").trim() || "TBD",
    awayName: String(source.awayName || "TBD").trim() || "TBD",
    homeScore: source.homeScore == null ? null : safeNumber(source.homeScore, 0),
    awayScore: source.awayScore == null ? null : safeNumber(source.awayScore, 0),
    winnerUid: String(source.winnerUid || "").trim(),
    winnerName: String(source.winnerName || "").trim(),
  };
}

function normalizeRegistration(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    uid: String(data.uid || "").trim(),
    username: String(data.username || "Utilisateur").trim() || "Utilisateur",
    gameKey: String(data.gameKey || "").trim(),
    gameName: String(data.gameName || "").trim(),
    costHtg: safeNumber(data.costHtg, 0),
    createdAtMs: safeNumber(data.createdAtMs, 0),
  };
}

async function readRegistrationsByGame() {
  const snap = await db.collection("tournamentRegistrations").limit(600).get();
  const byGame = {};
  snap.docs.forEach((docSnap) => {
    const row = normalizeRegistration(docSnap);
    if (!row.gameKey) return;
    if (!byGame[row.gameKey]) byGame[row.gameKey] = [];
    byGame[row.gameKey].push(row);
  });
  Object.keys(byGame).forEach((gameKey) => {
    byGame[gameKey].sort((a, b) => safeNumber(a.createdAtMs) - safeNumber(b.createdAtMs));
  });
  return byGame;
}

async function readBracketsByGame() {
  const snap = await db.collection("tournamentBrackets").limit(100).get();
  const byGame = {};
  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const matches = Array.isArray(data.matches) ? data.matches.map(normalizeMatch) : [];
    matches.sort((a, b) => (a.roundOrder - b.roundOrder) || (a.order - b.order));
    byGame[docSnap.id] = {
      id: docSnap.id,
      gameKey: String(data.gameKey || docSnap.id).trim(),
      gameName: String(data.gameName || "").trim(),
      participantCount: safeNumber(data.participantCount, 0),
      bracketSize: safeNumber(data.bracketSize, 8),
      drawCompleted: data.drawCompleted === true,
      championUid: String(data.championUid || "").trim(),
      championName: String(data.championName || "").trim(),
      runnerUpUid: String(data.runnerUpUid || "").trim(),
      runnerUpName: String(data.runnerUpName || "").trim(),
      status: String(data.status || "").trim(),
      matches,
      participants: Array.isArray(data.participants) ? data.participants : [],
    };
  });
  return byGame;
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    await requireFinanceAdmin(decoded);
    const [registrationsByGame, bracketsByGame] = await Promise.all([
      readRegistrationsByGame(),
      readBracketsByGame(),
    ]);
    sendJson(req, res, 200, {
      ok: true,
      games: GAME_OPTIONS.map((game) => ({
        ...game,
        registrationCount: registrationsByGame[game.key]?.length || 0,
        hasBracket: !!bracketsByGame[game.key],
      })),
      registrationsByGame,
      bracketsByGame,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger le dashboard Championna.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
