const { admin, db } = require("../../../lib/firebase-admin");
const { requireAuth } = require("../../../lib/auth");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const { readActiveLudoWagerStatus } = require("../../../lib/ludo");
const { sanitizeText } = require("../../../lib/safe");

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
    const sessionId = sanitizeText(payload.sessionId || "", 120);
    if (!sessionId) {
      throw makeHttpError(400, "missing-session-id", "sessionId requis.");
    }

    const nowMs = Date.now();
    const clientRef = db.collection("clients").doc(uid);
    const result = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const currentWager = clientData.ludoWagerState && typeof clientData.ludoWagerState === "object"
        ? clientData.ludoWagerState
        : {};
      const activeWager = readActiveLudoWagerStatus(currentWager, nowMs);
      const isActiveSession = activeWager.wagerStatus === "active" && activeWager.sessionId === sessionId;

      if (!isActiveSession) {
        return {
          ok: true,
          active: false,
          status: activeWager.wagerStatus || "none",
        };
      }

      tx.set(clientRef, {
        uid,
        ludoWagerState: {
          ...currentWager,
          lastEventAtMs: nowMs,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      }, { merge: true });

      return {
        ok: true,
        active: true,
        status: "active",
        sessionId,
        lastEventAtMs: nowMs,
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de mettre a jour la session Ludo.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
