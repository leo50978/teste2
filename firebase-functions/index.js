const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  createFriendDameRoom,
  ensureRoomReadyDame,
  finalizeDameMatch,
  joinFriendDameRoomByCode,
  joinMatchmakingDame,
  leaveRoomDame,
  recordDameMatchResult,
  requestFriendDameRematch,
  restartDameAfterDraw,
  resumeFriendDameRoom,
  submitActionDame,
  touchRoomPresenceDame,
} = require("./lib/dame");

const DAME_FUNCTION_OPTIONS = {
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 30,
  minInstances: 1,
  concurrency: 80,
};

function mapHttpStatusToHttpsCode(status = 500) {
  const safeStatus = Number(status) || 500;
  if (safeStatus === 400) return "invalid-argument";
  if (safeStatus === 401) return "unauthenticated";
  if (safeStatus === 403) return "permission-denied";
  if (safeStatus === 404) return "not-found";
  if (safeStatus === 409) return "failed-precondition";
  if (safeStatus === 429) return "resource-exhausted";
  return "internal";
}

function normalizeCallableError(error, fallbackMessage = "Erreur serveur Dame.") {
  if (error instanceof HttpsError) return error;
  const status = Number(error?.httpStatus || 500);
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  return new HttpsError(
    mapHttpStatusToHttpsCode(status),
    String(error?.message || fallbackMessage),
    {
      ...details,
      code: String(error?.code || "internal"),
      httpStatus: status,
    },
  );
}

function requireCallableAuth(request) {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) {
    throw new HttpsError("unauthenticated", "Connexion requise.", {
      code: "missing-auth-token",
      httpStatus: 401,
    });
  }

  return {
    uid,
    email: String(request?.auth?.token?.email || request?.auth?.token?.firebase?.identities?.email?.[0] || "").trim(),
  };
}

function dameCallable(handler, fallbackMessage) {
  return onCall(DAME_FUNCTION_OPTIONS, async (request) => {
    try {
      const decoded = requireCallableAuth(request);
      return await handler({
        uid: decoded.uid,
        email: decoded.email,
        payload: request?.data && typeof request.data === "object" ? request.data : {},
      });
    } catch (error) {
      throw normalizeCallableError(error, fallbackMessage);
    }
  });
}

exports.joinMatchmakingDame = dameCallable(joinMatchmakingDame, "Impossible de rejoindre une partie de dame.");
exports.createFriendDameRoom = dameCallable(createFriendDameRoom, "Impossible de kreye salon prive Dame la.");
exports.joinFriendDameRoomByCode = dameCallable(joinFriendDameRoomByCode, "Impossible de antre nan salon prive Dame la.");
exports.resumeFriendDameRoom = dameCallable(resumeFriendDameRoom, "Impossible de reprendre la salle dame privee.");
exports.ensureRoomReadyDame = dameCallable(ensureRoomReadyDame, "Impossible de demarrer la partie de dame.");
exports.touchRoomPresenceDame = dameCallable(touchRoomPresenceDame, "Impossible de mettre a jour la presence dame.");
exports.leaveRoomDame = dameCallable(leaveRoomDame, "Impossible de quitter la salle dame.");
exports.submitActionDame = dameCallable(submitActionDame, "Impossible d'envoyer l'action dame.");
exports.finalizeDameMatchSecure = dameCallable(finalizeDameMatch, "Impossible de finaliser le resultat dame.");
exports.restartDameAfterDrawSecure = dameCallable(restartDameAfterDraw, "Impossible de rejouer la partie nulle.");
exports.requestFriendDameRematch = dameCallable(requestFriendDameRematch, "Impossible de relanse revanche prive Dame la.");
exports.recordDameMatchResultSecure = dameCallable(recordDameMatchResult, "Impossible d'enregistrer le resultat dame.");
