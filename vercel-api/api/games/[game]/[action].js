const { handlePreflight, sendJson } = require("../../../lib/http");

const ROUTE_LOADERS = Object.freeze({
  "domino-classic/start-wager": () => require("../../../routes/games/domino-classic/start-wager"),
  "domino-classic/heartbeat": () => require("../../../routes/games/domino-classic/heartbeat"),
  "domino-classic/record-result": () => require("../../../routes/games/domino-classic/record-result"),
  "ludo/start-wager": () => require("../../../routes/games/ludo/start-wager"),
  "ludo/heartbeat": () => require("../../../routes/games/ludo/heartbeat"),
  "ludo/record-result": () => require("../../../routes/games/ludo/record-result"),
  "ludo/create-friend-room": () => require("../../../routes/games/ludo/create-friend-room"),
  "ludo/join-friend-room": () => require("../../../routes/games/ludo/join-friend-room"),
  "ludo/resume-friend-room": () => require("../../../routes/games/ludo/resume-friend-room"),
  "ludo/get-room-state": () => require("../../../routes/games/ludo/get-room-state"),
  "ludo/touch-presence": () => require("../../../routes/games/ludo/touch-presence"),
  "ludo/leave-room": () => require("../../../routes/games/ludo/leave-room"),
  "ludo/submit-action": () => require("../../../routes/games/ludo/submit-action"),
  "morpion-v3/create-friend-room": () => require("../../../routes/games/morpion-v3/create-friend-room"),
  "morpion-v3/get-room-state": () => require("../../../routes/games/morpion-v3/get-room-state"),
  "morpion-v3/join-friend-room-by-code": () => require("../../../routes/games/morpion-v3/join-friend-room-by-code"),
  "morpion-v3/join-matchmaking": () => require("../../../routes/games/morpion-v3/join-matchmaking"),
  "morpion-v3/leave-room": () => require("../../../routes/games/morpion-v3/leave-room"),
  "morpion-v3/preview-friend-room": () => require("../../../routes/games/morpion-v3/preview-friend-room"),
  "morpion-v3/request-friend-rematch": () => require("../../../routes/games/morpion-v3/request-friend-rematch"),
  "morpion-v3/resume-friend-room": () => require("../../../routes/games/morpion-v3/resume-friend-room"),
  "morpion-v3/submit-action": () => require("../../../routes/games/morpion-v3/submit-action"),
  "morpion-v3/touch-presence": () => require("../../../routes/games/morpion-v3/touch-presence"),
  "dame/join-matchmaking": () => require("../../../routes/games/dame/join-matchmaking"),
  "dame/create-friend-room": () => require("../../../routes/games/dame/create-friend-room"),
  "dame/join-friend-room": () => require("../../../routes/games/dame/join-friend-room"),
  "dame/resume-friend-room": () => require("../../../routes/games/dame/resume-friend-room"),
  "dame/ensure-ready": () => require("../../../routes/games/dame/ensure-ready"),
  "dame/touch-presence": () => require("../../../routes/games/dame/touch-presence"),
  "dame/leave-room": () => require("../../../routes/games/dame/leave-room"),
  "dame/request-friend-rematch": () => require("../../../routes/games/dame/request-friend-rematch"),
  "dame/submit-action": () => require("../../../routes/games/dame/submit-action"),
  "dame/finalize-match": () => require("../../../routes/games/dame/finalize-match"),
  "dame/restart-after-draw": () => require("../../../routes/games/dame/restart-after-draw"),
  "dame/record-result": () => require("../../../routes/games/dame/record-result"),
  "chess/join-matchmaking": () => require("../../../routes/games/chess/join-matchmaking"),
  "chess/create-friend-room": () => require("../../../routes/games/chess/create-friend-room"),
  "chess/preview-friend-room": () => require("../../../routes/games/chess/preview-friend-room"),
  "chess/join-friend-room": () => require("../../../routes/games/chess/join-friend-room"),
  "chess/resume-friend-room": () => require("../../../routes/games/chess/resume-friend-room"),
  "chess/get-room-state": () => require("../../../routes/games/chess/get-room-state"),
  "chess/touch-presence": () => require("../../../routes/games/chess/touch-presence"),
  "chess/leave-room": () => require("../../../routes/games/chess/leave-room"),
  "chess/submit-action": () => require("../../../routes/games/chess/submit-action"),
  "chess/record-result": () => require("../../../routes/games/chess/record-result"),
  "duel-v2/join-matchmaking": () => require("../../../routes/games/duel-v2/join-matchmaking"),
  "duel-v2/create-friend-room": () => require("../../../routes/games/duel-v2/create-friend-room"),
  "duel-v2/resume-friend-room": () => require("../../../routes/games/duel-v2/resume-friend-room"),
  "duel-v2/preview-friend-room": () => require("../../../routes/games/duel-v2/preview-friend-room"),
  "duel-v2/join-friend-room-by-code": () => require("../../../routes/games/duel-v2/join-friend-room-by-code"),
  "duel-v2/get-room-state": () => require("../../../routes/games/duel-v2/get-room-state"),
  "duel-v2/request-friend-rematch": () => require("../../../routes/games/duel-v2/request-friend-rematch"),
  "duel-v2/touch-presence": () => require("../../../routes/games/duel-v2/touch-presence"),
  "duel-v2/leave-room": () => require("../../../routes/games/duel-v2/leave-room"),
  "duel-v2/submit-action": () => require("../../../routes/games/duel-v2/submit-action"),
  "pong/start-wager": () => require("../../../routes/games/pong/start-wager"),
  "pong/heartbeat": () => require("../../../routes/games/pong/heartbeat"),
  "pong/record-result": () => require("../../../routes/games/pong/record-result"),
  "history/list": () => require("../../../routes/games/history/list"),
  "history/request-fairplay": () => require("../../../routes/games/history/request-fairplay"),
  "history/respond-fairplay": () => require("../../../routes/games/history/respond-fairplay"),
});

module.exports = async function handler(req, res) {
  const game = String(req.query?.game || "").trim();
  const action = String(req.query?.action || "").trim();
  const routeKey = `${game}/${action}`;
  const routeLoader = ROUTE_LOADERS[routeKey];
  if (!routeLoader) {
    if (handlePreflight(req, res)) return;
    sendJson(req, res, 404, {
      ok: false,
      code: "route-not-found",
      message: "Route jeu introuvable.",
    });
    return;
  }
  if (handlePreflight(req, res)) return;
  try {
    const routeHandler = routeLoader();
    return routeHandler(req, res);
  } catch (error) {
    console.error("[GAMES_ROUTE_LOAD_FAILED]", {
      routeKey,
      message: String(error?.message || error || "Route load failed"),
      stack: error?.stack || null,
    });
    sendJson(req, res, 500, {
      ok: false,
      code: "route-load-failed",
      message: "Impossible de charger cette route jeu.",
      details: {
        routeKey,
      },
    });
    return;
  }
};
