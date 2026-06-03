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

function sanitizeText(value = "", maxLength = 180) {
  return String(value || "").trim().slice(0, maxLength);
}

function hasCompletedMatch(matches = []) {
  return (Array.isArray(matches) ? matches : []).some((match) => String(match?.status || "") === "completed");
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
    const uid = sanitizeText(payload?.uid || "", 160);
    const registrationId = sanitizeText(payload?.registrationId || `${gameKey}_${uid}`, 220);

    if (!gameKey) throw makeHttpError(400, "missing-game-key", "Jeu Championna requis.");
    if (!uid) throw makeHttpError(400, "missing-uid", "Utilisateur requis.");
    if (!registrationId) throw makeHttpError(400, "missing-registration", "Inscription requise.");

    const registrationRef = db.collection("tournamentRegistrations").doc(registrationId);
    const bracketRef = db.collection("tournamentBrackets").doc(gameKey);

    const result = await db.runTransaction(async (transaction) => {
      const [registrationSnap, bracketSnap] = await Promise.all([
        transaction.get(registrationRef),
        transaction.get(bracketRef),
      ]);

      if (!registrationSnap.exists) {
        throw makeHttpError(404, "registration-not-found", "Inscription Championna introuvable.");
      }

      const registration = registrationSnap.data() || {};
      const registrationGameKey = normalizeGameKey(registration.gameKey || "");
      const registrationUid = sanitizeText(registration.uid || "", 160);
      if (registrationGameKey !== gameKey || registrationUid !== uid) {
        throw makeHttpError(400, "registration-mismatch", "Cette inscription ne correspond pas au jeu/utilisateur choisi.");
      }

      let bracketDeleted = false;
      if (bracketSnap.exists) {
        const bracket = bracketSnap.data() || {};
        const matches = Array.isArray(bracket.matches) ? bracket.matches : [];
        if (hasCompletedMatch(matches)) {
          throw makeHttpError(409, "bracket-already-started", "Impossible de retirer un inscrit apres un match deja termine.");
        }
        transaction.delete(bracketRef);
        bracketDeleted = true;
      }

      transaction.delete(registrationRef);
      transaction.set(db.collection("adminAuditLogs").doc(), {
        type: "championna_registration_removed",
        gameKey,
        uid,
        registrationId,
        username: sanitizeText(registration.username || "", 160),
        bracketDeleted,
        adminUid: sanitizeText(adminInfo.uid || "", 160),
        adminEmail: sanitizeText(adminInfo.email || "", 180),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),
      });

      return {
        ok: true,
        gameKey,
        uid,
        registrationId,
        bracketDeleted,
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de retirer cet inscrit Championna.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
