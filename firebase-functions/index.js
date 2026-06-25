const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  createFriendDameRoom,
  ensureRoomReadyDame,
  finalizeDameMatch,
  joinFriendDameRoomByCode,
  joinMatchmakingDame,
  leaveRoomDame,
  previewFriendDameRoomByCode,
  recordDameMatchResult,
  requestFriendDameRematch,
  restartDameAfterDraw,
  resumeFriendDameRoom,
  submitActionDame,
  touchRoomPresenceDame,
} = require("./lib/dame");
const {
  createFriendMorpionRoomV3,
  getMorpionV3RoomState,
  joinFriendMorpionRoomByCodeV3,
  joinMatchmakingMorpionV3,
  leaveRoomMorpionV3,
  previewFriendMorpionRoomByCodeV3,
  requestFriendMorpionRematchV3,
  resumeFriendMorpionRoomV3,
  submitActionMorpionV3,
  touchRoomPresenceMorpionV3,
} = require("./lib/morpion-v3");
const {
  createFriendLudoRoom,
  getFriendLudoRoomState,
  joinFriendLudoRoomByCode,
  leaveFriendLudoRoom,
  previewFriendLudoRoomByCode,
  resumeFriendLudoRoom,
  submitFriendLudoAction,
  touchFriendLudoPresence,
} = require("./lib/ludo");
const {
  recordLudoMatchResult,
  startLudoWager,
  touchLudoWagerHeartbeat,
} = require("./lib/ludo-wager");

const DAME_FUNCTION_OPTIONS = {
  region: "us-central1",
  cors: true,
  memory: "512MiB",
  timeoutSeconds: 30,
  minInstances: 0,
  concurrency: 80,
};

const MORPION_V3_FUNCTION_OPTIONS = {
  region: "us-central1",
  cors: true,
  memory: "512MiB",
  timeoutSeconds: 30,
  minInstances: 0,
  concurrency: 80,
};

const LUDO_FUNCTION_OPTIONS = {
  region: "us-central1",
  cors: true,
  memory: "512MiB",
  timeoutSeconds: 30,
  minInstances: 0,
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
  return gameCallable(handler, fallbackMessage, DAME_FUNCTION_OPTIONS);
}

function morpionV3Callable(handler, fallbackMessage) {
  return gameCallable(handler, fallbackMessage, MORPION_V3_FUNCTION_OPTIONS);
}

function ludoCallable(handler, fallbackMessage) {
  return gameCallable(handler, fallbackMessage, LUDO_FUNCTION_OPTIONS);
}

function gameCallable(handler, fallbackMessage, options = DAME_FUNCTION_OPTIONS) {
  return onCall(options, async (request) => {
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
exports.previewFriendDameRoomByCode = dameCallable(previewFriendDameRoomByCode, "Impossible de lire la mise du salon prive Dame.");
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

exports.joinMatchmakingMorpionV3 = morpionV3Callable(joinMatchmakingMorpionV3, "Impossible de rejoindre une partie de mopyon.");
exports.createFriendMorpionRoomV3 = morpionV3Callable(createFriendMorpionRoomV3, "Impossible de kreye salon prive Mopyon an.");
exports.resumeFriendMorpionRoomV3 = morpionV3Callable(resumeFriendMorpionRoomV3, "Impossible de reprann salon prive Mopyon an.");
exports.previewFriendMorpionRoomByCodeV3 = morpionV3Callable(previewFriendMorpionRoomByCodeV3, "Impossible de lire la mise du salon prive Mopyon an.");
exports.joinFriendMorpionRoomByCodeV3 = morpionV3Callable(joinFriendMorpionRoomByCodeV3, "Impossible de antre nan salon prive Mopyon an.");
exports.getMorpionV3RoomState = morpionV3Callable(getMorpionV3RoomState, "Impossible de charger la salle de mopyon.");
exports.touchRoomPresenceMorpionV3 = morpionV3Callable(touchRoomPresenceMorpionV3, "Impossible de mettre a jou prezans mopyon an.");
exports.leaveRoomMorpionV3 = morpionV3Callable(leaveRoomMorpionV3, "Impossible de quitter la salle mopyon.");
exports.submitActionMorpionV3 = morpionV3Callable(submitActionMorpionV3, "Impossible d'envoyer l'action mopyon.");
exports.requestFriendMorpionRematchV3 = morpionV3Callable(requestFriendMorpionRematchV3, "Impossible de relanse rematch prive Mopyon an.");

exports.startLudoWagerSecure = ludoCallable(startLudoWager, "Impossible de demarrer la partie Ludo.");
exports.touchLudoWagerHeartbeatSecure = ludoCallable(touchLudoWagerHeartbeat, "Impossible de mettre a jour la session Ludo.");
exports.recordLudoMatchResultSecure = ludoCallable(recordLudoMatchResult, "Impossible d'enregistrer le resultat Ludo.");
exports.createFriendLudoRoom = ludoCallable(createFriendLudoRoom, "Impossible de kreye salon prive Ludo a.");
exports.previewFriendLudoRoomByCode = ludoCallable(previewFriendLudoRoomByCode, "Impossible de lire la mise du salon prive Ludo a.");
exports.joinFriendLudoRoomByCode = ludoCallable(joinFriendLudoRoomByCode, "Impossible d'entrer nan salon prive Ludo a.");
exports.resumeFriendLudoRoom = ludoCallable(resumeFriendLudoRoom, "Impossible de reprann salon prive Ludo a.");
exports.getFriendLudoRoomState = ludoCallable(getFriendLudoRoomState, "Impossible de chaje eta salon prive Ludo a.");
exports.touchFriendLudoPresence = ludoCallable(touchFriendLudoPresence, "Impossible de mete prezans Ludo prive a ajou.");
exports.submitFriendLudoAction = ludoCallable(submitFriendLudoAction, "Impossible d'envoye aksyon Ludo prive a.");
exports.leaveFriendLudoRoom = ludoCallable(leaveFriendLudoRoom, "Impossible de kite salon prive Ludo a.");
