const { db } = require("../../lib/firebase-admin");
const { requireAuth } = require("../../lib/auth");
const {
  handlePreflight,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const { sanitizeText } = require("../../lib/safe");
const { buildTransferRecipientRecord, sanitizeUsername } = require("../../lib/player-wallet");

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
    const rawQuery = sanitizeText(payload.query || "", 80);
    const normalizedQuery = sanitizeUsername(rawQuery || "", 24);

    if (!normalizedQuery) {
      sendJson(req, res, 200, { ok: true, results: [] });
      return;
    }

    const results = new Map();
    const addSnap = (snap) => {
      (snap?.docs || []).forEach((docSnap) => {
        if (!docSnap?.exists || docSnap.id === uid) return;
        const record = buildTransferRecipientRecord(docSnap.id, docSnap.data() || {});
        if (record.uid && record.username) {
          results.set(record.uid, record);
        }
      });
    };

    const exactSnap = await db.collection("clients")
      .where("username", "==", normalizedQuery)
      .limit(8)
      .get();
    addSnap(exactSnap);

    if (results.size < 8) {
      const prefixSnap = await db.collection("clients")
        .orderBy("username")
        .startAt(normalizedQuery)
        .endAt(`${normalizedQuery}\uf8ff`)
        .limit(12)
        .get();
      addSnap(prefixSnap);
    }

    sendJson(req, res, 200, {
      ok: true,
      results: Array.from(results.values()).slice(0, 8),
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de rechercher cet ami.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
