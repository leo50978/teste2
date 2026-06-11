const { requireAuth } = require("../../lib/auth");
const {
  handlePreflight,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const { safeInt, sanitizeText } = require("../../lib/safe");
const { transferHistoryRef } = require("../../lib/player-wallet");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const uid = String(decoded.uid || "").trim();
    const payload = await parseJsonBody(req);
    const pageSize = Math.min(20, Math.max(1, safeInt(payload.pageSize) || 20));
    const cursorKey = sanitizeText(payload.cursorKey || payload.cursor || "", 180);

    let query = transferHistoryRef(uid).orderBy("sortKey", "desc").limit(pageSize);
    if (cursorKey) {
      query = query.startAfter(cursorKey);
    }

    const snap = await query.get();
    const items = snap.docs.map((docSnap) => docSnap.data() || {});
    const lastDoc = snap.docs[snap.docs.length - 1];

    sendJson(req, res, 200, {
      ok: true,
      items,
      nextCursorKey: lastDoc ? String(lastDoc.data()?.sortKey || "") : "",
      hasMore: snap.size === pageSize,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger l'historique des transferts.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
