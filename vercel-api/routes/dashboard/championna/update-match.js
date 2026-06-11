const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const { admin, db } = require("../../../lib/firebase-admin");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");

function normalizeGameKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeScore(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : -1;
}

function normalizeMatch(match = {}) {
  const source = match && typeof match === "object" ? match : {};
  return {
    ...source,
    id: String(source.id || "").trim(),
    round: String(source.round || "").trim(),
    roundOrder: Number(source.roundOrder || 99),
    order: Number(source.order || 99),
    status: String(source.status || "scheduled").trim() || "scheduled",
    homeUid: String(source.homeUid || "").trim(),
    homeName: String(source.homeName || "TBD").trim() || "TBD",
    awayUid: String(source.awayUid || "").trim(),
    awayName: String(source.awayName || "TBD").trim() || "TBD",
    winnerUid: String(source.winnerUid || "").trim(),
    winnerName: String(source.winnerName || "").trim(),
  };
}

function scoreToWinner(match, homeScore, awayScore) {
  if (homeScore === awayScore) {
    throw makeHttpError(400, "invalid-score", "Le score ne peut pas etre egal.");
  }
  if (Math.max(homeScore, awayScore) < 2) {
    throw makeHttpError(400, "invalid-score", "Le gagnant doit avoir au moins 2 parties gagnees.");
  }
  if (homeScore > 2 || awayScore > 2) {
    throw makeHttpError(400, "invalid-score", "Le score max attendu est 2 parties gagnees.");
  }
  const winnerSide = homeScore > awayScore ? "home" : "away";
  const winnerUid = winnerSide === "home" ? match.homeUid : match.awayUid;
  const winnerName = winnerSide === "home" ? match.homeName : match.awayName;
  const loserUid = winnerSide === "home" ? match.awayUid : match.homeUid;
  const loserName = winnerSide === "home" ? match.awayName : match.homeName;
  if (!winnerUid) {
    throw makeHttpError(400, "missing-player", "Le gagnant du match n'est pas encore defini.");
  }
  return { winnerSide, winnerUid, winnerName, loserUid, loserName };
}

function resetMatch(match) {
  return {
    ...match,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    winnerUid: "",
    winnerName: "",
    completedAtMs: null,
  };
}

function setMatchSlot(match, slot, sourceWinner, fallbackName) {
  const uidKey = slot === "home" ? "homeUid" : "awayUid";
  const nameKey = slot === "home" ? "homeName" : "awayName";
  return {
    ...match,
    [uidKey]: sourceWinner?.winnerUid || "",
    [nameKey]: sourceWinner?.winnerName || fallbackName,
  };
}

function refreshDownstreamMatches(matches) {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const winnerOf = (id) => {
    const match = byId.get(id);
    if (!match || String(match.status || "") !== "completed" || !match.winnerUid) return null;
    return { winnerUid: match.winnerUid, winnerName: match.winnerName || "Ganyan" };
  };

  const sf1 = byId.get("SF1");
  if (sf1) {
    const next = setMatchSlot(setMatchSlot(sf1, "home", winnerOf("QF1"), "Ganyan QF1"), "away", winnerOf("QF2"), "Ganyan QF2");
    const sourceReady = next.homeUid && next.awayUid;
    const sourceChanged = next.homeUid !== sf1.homeUid || next.awayUid !== sf1.awayUid;
    byId.set("SF1", sourceReady && !sourceChanged ? next : resetMatch(next));
  }

  const sf2 = byId.get("SF2");
  if (sf2) {
    const next = setMatchSlot(setMatchSlot(sf2, "home", winnerOf("QF3"), "Ganyan QF3"), "away", winnerOf("QF4"), "Ganyan QF4");
    const sourceReady = next.homeUid && next.awayUid;
    const sourceChanged = next.homeUid !== sf2.homeUid || next.awayUid !== sf2.awayUid;
    byId.set("SF2", sourceReady && !sourceChanged ? next : resetMatch(next));
  }

  const final = byId.get("F1");
  if (final) {
    const currentFinal = byId.get("F1");
    const next = setMatchSlot(setMatchSlot(currentFinal, "home", winnerOf("SF1"), "Ganyan SF1"), "away", winnerOf("SF2"), "Ganyan SF2");
    const sourceReady = next.homeUid && next.awayUid;
    const sourceChanged = next.homeUid !== final.homeUid || next.awayUid !== final.awayUid;
    byId.set("F1", sourceReady && !sourceChanged ? next : resetMatch(next));
  }

  return matches
    .map((match) => byId.get(match.id) || match)
    .sort((a, b) => (Number(a.roundOrder || 99) - Number(b.roundOrder || 99)) || (Number(a.order || 99) - Number(b.order || 99)));
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const adminInfo = await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const gameKey = normalizeGameKey(payload?.gameKey || "");
    const matchId = String(payload?.matchId || "").trim();
    const homeScore = safeScore(payload?.homeScore);
    const awayScore = safeScore(payload?.awayScore);

    if (!gameKey) throw makeHttpError(400, "missing-game-key", "Jeu Championna requis.");
    if (!matchId) throw makeHttpError(400, "missing-match-id", "Match requis.");
    if (homeScore < 0 || awayScore < 0) throw makeHttpError(400, "invalid-score", "Score invalide.");

    const bracketRef = db.collection("tournamentBrackets").doc(gameKey);
    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(bracketRef);
      if (!snap.exists) {
        throw makeHttpError(404, "bracket-not-found", "Aucun calendrier Championna trouve pour ce jeu.");
      }

      const data = snap.data() || {};
      const matches = Array.isArray(data.matches) ? data.matches.map(normalizeMatch) : [];
      const matchIndex = matches.findIndex((match) => match.id === matchId);
      if (matchIndex < 0) {
        throw makeHttpError(404, "match-not-found", "Match introuvable dans ce calendrier.");
      }

      const currentMatch = matches[matchIndex];
      if (!currentMatch.homeUid || !currentMatch.awayUid) {
        throw makeHttpError(400, "match-not-ready", "Ce match n'a pas encore ses deux joueurs.");
      }

      const winner = scoreToWinner(currentMatch, homeScore, awayScore);
      matches[matchIndex] = {
        ...currentMatch,
        status: "completed",
        homeScore,
        awayScore,
        winnerUid: winner.winnerUid,
        winnerName: winner.winnerName,
        loserUid: winner.loserUid,
        loserName: winner.loserName,
        completedAtMs: Date.now(),
        updatedByUid: adminInfo.uid,
        updatedByEmail: adminInfo.email,
      };

      const advancedMatches = refreshDownstreamMatches(matches);
      const finalMatch = advancedMatches.find((match) => match.id === "F1");
      const finalCompleted = finalMatch?.status === "completed" && finalMatch?.winnerUid;
      const runnerUpUid = finalCompleted
        ? (finalMatch.winnerUid === finalMatch.homeUid ? finalMatch.awayUid : finalMatch.homeUid)
        : "";
      const runnerUpName = finalCompleted
        ? (finalMatch.winnerUid === finalMatch.homeUid ? finalMatch.awayName : finalMatch.homeName)
        : "";

      transaction.set(bracketRef, {
        matches: advancedMatches,
        status: finalCompleted ? "completed" : "active",
        championUid: finalCompleted ? finalMatch.winnerUid : "",
        championName: finalCompleted ? finalMatch.winnerName : "",
        championPrizeHtg: finalCompleted ? 1100 : 0,
        runnerUpUid,
        runnerUpName,
        runnerUpPrizeHtg: finalCompleted ? 500 : 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
      }, { merge: true });

      return {
        ok: true,
        gameKey,
        match: advancedMatches.find((match) => match.id === matchId),
        matches: advancedMatches,
        finalCompleted,
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de mettre a jour le score Championna.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
