const { handlePreflight, sendJson } = require("../../../lib/http");

const ROUTES = Object.freeze({
  "acquisition/snapshot": require("../../../routes/dashboard/acquisition/snapshot"),
  "ai-advisor/snapshot": require("../../../routes/dashboard/ai-advisor/snapshot"),
  "cashflow-htg/snapshot": require("../../../routes/dashboard/cashflow-htg/snapshot"),
  "deposits/resolve-review": require("../../../routes/dashboard/deposits/resolve-review"),
  "deposit-flow/snapshot": require("../../../routes/dashboard/deposit-flow/snapshot"),
  "withdrawal-flow/snapshot": require("../../../routes/dashboard/withdrawal-flow/snapshot"),
  "approved-deposits/snapshot": require("../../../routes/dashboard/approved-deposits/snapshot"),
  "games-volume/snapshot": require("../../../routes/dashboard/games-volume/snapshot"),
  "agent-deposits/search-clients": require("../../../routes/dashboard/agent-deposits/search-clients"),
  "agent-deposits/client-context": require("../../../routes/dashboard/agent-deposits/client-context"),
  "agent-deposits/credit": require("../../../routes/dashboard/agent-deposits/credit"),
  "client-review/pending-orders": require("../../../routes/dashboard/client-review/pending-orders"),
  "client-review/orders": require("../../../routes/dashboard/client-review/orders"),
  "client-review/game-history": require("../../../routes/dashboard/client-review/game-history"),
  "client-review/fraud-analysis": require("../../../routes/dashboard/client-review/fraud-analysis"),
  "client-review/approve-pending": require("../../../routes/dashboard/client-review/approve-pending"),
  "client-review/repair-resolved-residues": require("../../../routes/dashboard/client-review/repair-resolved-residues"),
  "client-admin/delete-account": require("../../../routes/dashboard/client-admin/delete-account"),
  "client-admin/reset-financial-account": require("../../../routes/dashboard/client-admin/reset-financial-account"),
  "client-admin/set-password": require("../../../routes/dashboard/client-admin/set-password"),
  "client-admin/set-withdrawal-temporary-hold": require("../../../routes/dashboard/client-admin/set-withdrawal-temporary-hold"),
  "client-admin/unfreeze-account": require("../../../routes/dashboard/client-admin/unfreeze-account"),
  "championna/snapshot": require("../../../routes/dashboard/championna/snapshot"),
  "championna/update-match": require("../../../routes/dashboard/championna/update-match"),
  "championna/remove-registration": require("../../../routes/dashboard/championna/remove-registration"),
  "morpion/snapshot": require("../../../routes/dashboard/morpion/snapshot"),
  "site-visits/snapshot": require("../../../routes/dashboard/site-visits/snapshot"),
  "transfers/analytics": require("../../../routes/dashboard/transfers/analytics"),
  "domino-classic-bot-pilot/snapshot": require("../../../routes/dashboard/domino-classic-bot-pilot/snapshot"),
  "domino-classic-bot-pilot/control": require("../../../routes/dashboard/domino-classic-bot-pilot/control"),
  "duel-bot-pilot/snapshot": require("../../../routes/dashboard/duel-bot-pilot/snapshot"),
  "duel-bot-pilot/control": require("../../../routes/dashboard/duel-bot-pilot/control"),
  "chess-bot-pilot/snapshot": require("../../../routes/dashboard/chess-bot-pilot/snapshot"),
  "chess-bot-pilot/control": require("../../../routes/dashboard/chess-bot-pilot/control"),
  "ludo-bot-pilot/snapshot": require("../../../routes/dashboard/ludo-bot-pilot/snapshot"),
  "ludo-bot-pilot/control": require("../../../routes/dashboard/ludo-bot-pilot/control"),
  "pong-bot-pilot/snapshot": require("../../../routes/dashboard/pong-bot-pilot/snapshot"),
  "pong-bot-pilot/control": require("../../../routes/dashboard/pong-bot-pilot/control"),
  "push/register": require("../../../routes/dashboard/push/register"),
  "push/unregister": require("../../../routes/dashboard/push/unregister"),
});

module.exports = async function handler(req, res) {
  const section = String(req.query?.section || "").trim();
  const action = String(req.query?.action || "").trim();
  const routeHandler = ROUTES[`${section}/${action}`];
  if (!routeHandler) {
    if (handlePreflight(req, res)) return;
    sendJson(req, res, 404, {
      ok: false,
      code: "route-not-found",
      message: "Route dashboard introuvable.",
    });
    return;
  }
  return routeHandler(req, res);
};
