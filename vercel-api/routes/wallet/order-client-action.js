const { db } = require("../../lib/firebase-admin");
const { requireAuth } = require("../../lib/auth");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const { sanitizeText } = require("../../lib/safe");

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
    const kind = String(payload.kind || "").trim();
    const id = sanitizeText(payload.id || "", 160);
    const action = String(payload.action || "").trim();

    if (!id || (kind !== "order" && kind !== "withdrawal") || (action !== "hide" && action !== "review")) {
      throw makeHttpError(400, "invalid-argument", "Action client invalide.");
    }

    const subcollection = kind === "withdrawal" ? "withdrawals" : "orders";
    const ref = db.collection("clients").doc(uid).collection(subcollection).doc(id);
    const nowIso = new Date().toISOString();
    const updates = {
      updatedAt: nowIso,
      updatedAtMs: Date.now(),
    };

    if (action === "hide") {
      updates.userHiddenByClient = true;
      updates.userHiddenAt = nowIso;
    } else {
      updates.status = "review";
      updates.reviewRequestedByClient = true;
      updates.reviewRequestedAt = nowIso;
      updates.userHiddenByClient = false;
    }

    await ref.set(updates, { merge: true });

    sendJson(req, res, 200, { ok: true });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de mettre a jour la demande.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
