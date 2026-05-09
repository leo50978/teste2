const { handlePreflight, sendJson } = require("../../lib/http");

const ROUTES = Object.freeze({
  "payment-options": require("../../routes/public/payment-options"),
  "runtime-config": require("../../routes/public/runtime-config"),
  "whatsapp-modal-config": require("../../routes/public/whatsapp-modal-config"),
  "game-stake-options": require("../../routes/public/game-stake-options"),
  "home-hero-config": require("../../routes/public/home-hero-config"),
});

module.exports = async function handler(req, res) {
  const action = String(req.query?.action || "").trim();
  const routeHandler = ROUTES[action];
  if (!routeHandler) {
    if (handlePreflight(req, res)) return;
    sendJson(req, res, 404, {
      ok: false,
      code: "route-not-found",
      message: "Route publique introuvable.",
    });
    return;
  }
  return routeHandler(req, res);
};
