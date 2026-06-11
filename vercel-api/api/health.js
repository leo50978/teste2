const { handlePreflight, sendJson, sendMethodNotAllowed } = require("../lib/http");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "GET") {
    sendMethodNotAllowed(req, res, ["GET", "OPTIONS"]);
    return;
  }

  sendJson(req, res, 200, {
    ok: true,
    service: "kobposh-vercel-api",
    timestamp: Date.now(),
  });
};
