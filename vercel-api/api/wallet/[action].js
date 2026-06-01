const { handlePreflight, sendJson } = require("../../lib/http");

const ROUTES = Object.freeze({
  "cancel-withdrawal": require("../../routes/wallet/cancel-withdrawal"),
  "claim-welcome-bonus": require("../../routes/wallet/claim-welcome-bonus"),
  "create-transfer": require("../../routes/wallet/create-transfer"),
  "create-withdrawal": require("../../routes/wallet/create-withdrawal"),
  "create-order": require("../../routes/wallet/create-order"),
  "funding-status": require("../../routes/wallet/funding-status"),
  "mutate": require("../../routes/wallet/mutate"),
  "order-client-action": require("../../routes/wallet/order-client-action"),
  "search-transfer-recipients": require("../../routes/wallet/search-transfer-recipients"),
  "transfer-history": require("../../routes/wallet/transfer-history"),
  "update-profile": require("../../routes/wallet/update-profile"),
});

module.exports = async function handler(req, res) {
  const action = String(req.query?.action || "").trim();
  const routeHandler = ROUTES[action];
  if (!routeHandler) {
    if (handlePreflight(req, res)) return;
    sendJson(req, res, 404, {
      ok: false,
      code: "route-not-found",
      message: "Route wallet introuvable.",
    });
    return;
  }
  return routeHandler(req, res);
};
