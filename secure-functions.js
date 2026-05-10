import { auth, db, doc, functions as firebaseFunctions, getDoc, httpsCallable } from "./firebase-init.js";

import "./runtime-config.js";

const CALLABLE_CACHE = new Map();
const DEFAULT_HTTP_TIMEOUT_MS = 15000;

function getCallable(name) {
  const key = String(name || "").trim();
  if (!key) throw new Error("Callable name is required");
  if (!CALLABLE_CACHE.has(key)) {
    CALLABLE_CACHE.set(key, httpsCallable(firebaseFunctions, key));
  }
  return CALLABLE_CACHE.get(key);
}

function normalizeCallableError(err, fallback = "Erreur serveur") {
  const codeRaw = String(err?.code || "");
  const firebaseCode = codeRaw.startsWith("functions/") ? codeRaw.slice("functions/".length) : codeRaw;
  const details = err?.details && typeof err.details === "object" ? err.details : {};
  const normalized = new Error(String(err?.message || fallback));
  normalized.code = String(details.code || firebaseCode || "unknown");
  normalized.details = details;
  Object.keys(details).forEach((key) => {
    normalized[key] = details[key];
  });
  return normalized;
}

async function invokeCallable(name, payload = {}, fallbackError = "Erreur serveur") {
  try {
    const callable = getCallable(name);
    const response = await callable(payload);
    return response?.data || null;
  } catch (error) {
    throw normalizeCallableError(error, fallbackError);
  }
}

function getRuntimeBackendConfig() {
  if (typeof window === "undefined") return {};
  const source = window.__KOBPOSH_RUNTIME_CONFIG__ && typeof window.__KOBPOSH_RUNTIME_CONFIG__ === "object"
    ? window.__KOBPOSH_RUNTIME_CONFIG__
    : {};
  return source;
}

function getConfiguredApiBaseUrl() {
  if (typeof window === "undefined") return "";

  const runtimeConfig = getRuntimeBackendConfig();
  const candidates = [
    window.localStorage?.getItem("kobposh_api_base_url"),
    window.__KOBPOSH_API_BASE_URL,
    runtimeConfig.apiBaseUrl,
  ];

  for (const raw of candidates) {
    const value = String(raw || "").trim();
    if (!value) continue;
    return value.replace(/\/+$/, "");
  }

  return "";
}

function buildHttpBackendError(payload = {}, fallback = "Erreur serveur", status = 500) {
  const normalized = new Error(String(payload?.message || fallback));
  normalized.code = String(payload?.code || "unknown");
  normalized.details = payload?.details && typeof payload.details === "object" ? payload.details : {};
  normalized.httpStatus = Number(status) || 500;
  Object.keys(normalized.details).forEach((key) => {
    normalized[key] = normalized.details[key];
  });
  return normalized;
}

function shouldFallbackToCallable(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const httpStatus = Number(error?.httpStatus || 0);
  return code === "http-backend-not-configured"
    || code === "http-request-failed"
    || code === "http-timeout"
    || httpStatus === 404
    || httpStatus >= 500;
}

async function invokeBackendHttp(path, {
  payload = {},
  fallbackError = "Erreur serveur",
  requireAuth = false,
  method = "POST",
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
} = {}) {
  const baseUrl = getConfiguredApiBaseUrl();
  if (!baseUrl) {
    throw buildHttpBackendError({
      code: "http-backend-not-configured",
      message: "Backend HTTP non configure.",
    }, fallbackError, 503);
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (requireAuth) {
    const user = auth.currentUser;
    const token = await user?.getIdToken?.();
    if (!token) {
      throw buildHttpBackendError({
        code: "missing-auth-token",
        message: "Connexion requise.",
      }, fallbackError, 401);
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? window.setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || DEFAULT_HTTP_TIMEOUT_MS))
    : 0;

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(payload || {}),
      signal: controller?.signal,
    });

    const responseText = await response.text();
    let responseJson = {};
    try {
      responseJson = responseText ? JSON.parse(responseText) : {};
    } catch (_) {
      responseJson = {};
    }

    if (!response.ok) {
      throw buildHttpBackendError(responseJson, fallbackError, response.status);
    }

    return responseJson && typeof responseJson === "object" ? responseJson : {};
  } catch (error) {
    if (error?.name === "AbortError") {
      throw buildHttpBackendError({
        code: "http-timeout",
        message: "Le backend HTTP a mis trop de temps a repondre.",
      }, fallbackError, 504);
    }
    if (error instanceof Error && typeof error.code === "string") {
      throw error;
    }
    throw buildHttpBackendError({
      code: "http-request-failed",
      message: String(error?.message || fallbackError),
    }, fallbackError, 502);
  } finally {
    if (timer) {
      window.clearTimeout(timer);
    }
  }
}

function safeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export async function getDepositFundingStatusSecure() {
  const uid = String(auth.currentUser?.uid || "").trim();
  if (!uid) return {};

  let backendData = null;
  const fallbackError = "Impossible de charger l'etat financier.";
  const useHttpBackend = !!getConfiguredApiBaseUrl();
  try {
    backendData = useHttpBackend
      ? await invokeBackendHttp("/api/wallet/funding-status", {
          requireAuth: true,
          fallbackError,
        })
      : await invokeCallable("getDepositFundingStatusSecure", {}, fallbackError);
  } catch (_) {
    backendData = null;
  }

  const snap = await getDoc(doc(db, "clients", uid));
  const clientData = snap.exists() ? (snap.data() || {}) : {};
  const source = backendData && typeof backendData === "object"
    ? { ...clientData, ...backendData }
    : clientData;
  const approvedHtgAvailable = safeInt(source.approvedHtgAvailable ?? source.approvedGourdesAvailable);
  const provisionalHtgAvailable = safeInt(source.provisionalHtgAvailable ?? source.provisionalGourdesAvailable);
  const playableHtg = safeInt(
    source.playableHtg
    ?? source.availableGourdes
    ?? (approvedHtgAvailable + provisionalHtgAvailable)
  );
  const withdrawableHtg = safeInt(source.withdrawableHtg);

  return {
    ...source,
    approvedHtgAvailable,
    provisionalHtgAvailable,
    playableHtg,
    withdrawableHtg,
  };
}

export async function createOrderSecure(payload = {}) {
  const fallbackError = "Impossible de creer la commande.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/wallet/create-order", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("createOrderSecure", payload, fallbackError));
  }
  return invokeCallable("createOrderSecure", payload, fallbackError);
}

export async function walletMutateSecure(payload = {}) {
  return invokeCallable("walletMutate", payload, "Impossible de mettre a jour le wallet.");
}

export async function getPublicPaymentOptionsSecure(payload = {}) {
  const fallbackError = "Impossible de charger les options de paiement.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/public/payment-options", {
      payload,
      fallbackError,
    }).catch(() => invokeCallable("getPublicPaymentOptionsSecure", payload, fallbackError));
  }
  return invokeCallable("getPublicPaymentOptionsSecure", payload, fallbackError);
}

export async function getPublicGameStakeOptionsSecure(payload = {}) {
  const fallbackError = "Impossible de charger les mises publiques.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/public/game-stake-options", {
      payload,
      fallbackError,
      method: "GET",
    }).catch(() => invokeCallable("getPublicGameStakeOptionsSecure", payload, fallbackError));
  }
  return invokeCallable("getPublicGameStakeOptionsSecure", payload, fallbackError);
}

export async function getPublicHomeHeroConfigSecure(payload = {}) {
  const fallbackError = "Impossible de charger le hero public.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/public/home-hero-config", {
      payload,
      fallbackError,
      method: "GET",
    }).catch(() => invokeCallable("getPublicHomeHeroConfigSecure", payload, fallbackError));
  }
  return invokeCallable("getPublicHomeHeroConfigSecure", payload, fallbackError);
}

export async function claimWelcomeBonusSecure(payload = {}) {
  const fallbackError = "Impossible de reclamer le bonus de bienvenue.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/wallet/claim-welcome-bonus", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("claimWelcomeBonusSecure", payload, fallbackError));
  }
  return invokeCallable("claimWelcomeBonusSecure", payload, fallbackError);
}

export async function searchTransferRecipientsSecure(payload = {}) {
  const fallbackError = "Impossible de rechercher cet ami.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/wallet/search-transfer-recipients", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("searchTransferRecipientsSecure", payload, fallbackError));
  }
  return invokeCallable("searchTransferRecipientsSecure", payload, fallbackError);
}

export async function createTransferSecure(payload = {}) {
  const fallbackError = "Impossible d'envoyer le transfert.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/wallet/create-transfer", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("createTransferSecure", payload, fallbackError));
  }
  return invokeCallable("createTransferSecure", payload, fallbackError);
}

export async function listTransferHistorySecure(payload = {}) {
  const fallbackError = "Impossible de charger l'historique des transferts.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/wallet/transfer-history", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("listTransferHistorySecure", payload, fallbackError));
  }
  return invokeCallable("listTransferHistorySecure", payload, fallbackError);
}

export async function createWithdrawalSecure(payload = {}) {
  const fallbackError = "Impossible de soumettre la demande de retrait.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/wallet/create-withdrawal", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("createWithdrawalSecure", payload, fallbackError));
  }
  return invokeCallable("createWithdrawalSecure", payload, fallbackError);
}

export async function cancelWithdrawalSecure(payload = {}) {
  const fallbackError = "Impossible d'annuler le retrait.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/wallet/cancel-withdrawal", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("cancelWithdrawalSecure", payload, fallbackError));
  }
  return invokeCallable("cancelWithdrawalSecure", payload, fallbackError);
}

export async function orderClientActionSecure(payload = {}) {
  const fallbackError = "Impossible de mettre a jour la demande.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/wallet/order-client-action", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("orderClientActionSecure", payload, fallbackError));
  }
  return invokeCallable("orderClientActionSecure", payload, fallbackError);
}

export async function startPongWagerSecure(payload = {}) {
  const fallbackError = "Impossible de demarrer la partie Pong.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/pong/start-wager", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("startPongWagerSecure", payload, fallbackError);
}

export async function touchPongWagerHeartbeatSecure(payload = {}) {
  const fallbackError = "Impossible de mettre a jour la session Pong.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/pong/heartbeat", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("touchPongWagerHeartbeatSecure", payload, fallbackError);
}

export async function recordPongMatchResultSecure(payload = {}) {
  const fallbackError = "Impossible d'enregistrer le resultat Pong.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/pong/record-result", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("recordPongMatchResultSecure", payload, fallbackError);
}

export async function startDominoClassicWagerSecure(payload = {}) {
  const fallbackError = "Impossible de demarrer la partie Domino classique.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/domino-classic/start-wager", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("startDominoClassicWagerSecure", payload, fallbackError));
  }
  return invokeCallable("startDominoClassicWagerSecure", payload, fallbackError);
}

export async function touchDominoClassicWagerHeartbeatSecure(payload = {}) {
  const fallbackError = "Impossible de mettre a jour la session Domino classique.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/domino-classic/heartbeat", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("touchDominoClassicWagerHeartbeatSecure", payload, fallbackError));
  }
  return invokeCallable("touchDominoClassicWagerHeartbeatSecure", payload, fallbackError);
}

export async function recordDominoClassicMatchResultSecure(payload = {}) {
  const fallbackError = "Impossible d'enregistrer le resultat Domino classique.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/domino-classic/record-result", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("recordDominoClassicMatchResultSecure", payload, fallbackError));
  }
  return invokeCallable("recordDominoClassicMatchResultSecure", payload, fallbackError);
}

export async function joinMatchmakingDameSecure(payload = {}) {
  const fallbackError = "Impossible de rejoindre une partie de dame.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/join-matchmaking", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("joinMatchmakingDame", payload, fallbackError));
  }
  return invokeCallable("joinMatchmakingDame", payload, fallbackError);
}

export async function createFriendDameRoomSecure(payload = {}) {
  const fallbackError = "Impossible de kreye salon prive Dame la.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/create-friend-room", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("createFriendDameRoom", payload, fallbackError));
  }
  return invokeCallable("createFriendDameRoom", payload, fallbackError);
}

export async function joinFriendDameRoomByCodeSecure(payload = {}) {
  const fallbackError = "Impossible de antre nan salon prive Dame la.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/join-friend-room", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("joinFriendDameRoomByCode", payload, fallbackError));
  }
  return invokeCallable("joinFriendDameRoomByCode", payload, fallbackError);
}

export async function resumeFriendDameRoomSecure(payload = {}) {
  const fallbackError = "Impossible de reprendre la salle dame privee.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/resume-friend-room", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("resumeFriendDameRoom", payload, fallbackError));
  }
  return invokeCallable("resumeFriendDameRoom", payload, fallbackError);
}

export async function ensureRoomReadyDameSecure(payload = {}) {
  const fallbackError = "Impossible de demarrer la partie de dame.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/ensure-ready", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("ensureRoomReadyDame", payload, fallbackError));
  }
  return invokeCallable("ensureRoomReadyDame", payload, fallbackError);
}

export async function touchRoomPresenceDameSecure(payload = {}) {
  const fallbackError = "Impossible de mettre a jour la presence dame.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/touch-presence", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("touchRoomPresenceDame", payload, fallbackError));
  }
  return invokeCallable("touchRoomPresenceDame", payload, fallbackError);
}

export async function leaveRoomDameSecure(payload = {}) {
  const fallbackError = "Impossible de quitter la salle dame.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/leave-room", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("leaveRoomDame", payload, fallbackError));
  }
  return invokeCallable("leaveRoomDame", payload, fallbackError);
}

export async function submitActionDameSecure(payload = {}) {
  const fallbackError = "Impossible d'envoyer l'action dame.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/submit-action", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("submitActionDame", payload, fallbackError));
  }
  return invokeCallable("submitActionDame", payload, fallbackError);
}

export async function finalizeDameMatchSecure(payload = {}) {
  const fallbackError = "Impossible de finaliser le resultat dame.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/finalize-match", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("finalizeDameMatchSecure", payload, fallbackError));
  }
  return invokeCallable("finalizeDameMatchSecure", payload, fallbackError);
}

export async function restartDameAfterDrawSecure(payload = {}) {
  const fallbackError = "Impossible de rejouer la partie nulle.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/restart-after-draw", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("restartDameAfterDrawSecure", payload, fallbackError));
  }
  return invokeCallable("restartDameAfterDrawSecure", payload, fallbackError);
}

export async function requestFriendDameRematchSecure(payload = {}) {
  const fallbackError = "Impossible de relanse revanche prive Dame la.";
  return invokeBackendHttp("/api/games/dame/request-friend-rematch", {
    payload,
    requireAuth: true,
    fallbackError,
  });
}

export async function recordDameMatchResultSecure(payload = {}) {
  const fallbackError = "Impossible d'enregistrer le resultat dame.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/dame/record-result", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("recordDameMatchResultSecure", payload, fallbackError));
  }
  return invokeCallable("recordDameMatchResultSecure", payload, fallbackError);
}

export async function getPublicWhatsappModalConfigSecure(payload = {}) {
  const fallbackError = "Impossible de charger le contact WhatsApp.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/public/whatsapp-modal-config", {
      payload,
      fallbackError,
      method: "GET",
    }).catch(() => invokeCallable("getPublicWhatsappModalConfigSecure", payload, fallbackError));
  }
  return invokeCallable("getPublicWhatsappModalConfigSecure", payload, fallbackError);
}

export async function updateClientProfileSecure(payload = {}) {
  const fallbackError = "Impossible de mettre a jour le profil.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/wallet/update-profile", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("updateClientProfileSecure", payload, fallbackError));
  }
  return invokeCallable("updateClientProfileSecure", payload, fallbackError);
}

function buildDuelV2BackendUnavailableError(fallbackError = "Impossible de rejoindre Duel V2.") {
  return buildHttpBackendError({
    code: "duel-v2-backend-unavailable",
    message: "Backend Duel V2 poko disponib sou anviwonman sa a.",
    details: {
      actionable: true,
      nextStep: "deploy-or-migrate-duel-v2-backend",
    },
  }, fallbackError, 503);
}

async function invokeDuelV2HttpOnly(path, payload = {}, fallbackError = "Erreur Duel V2") {
  if (!getConfiguredApiBaseUrl()) {
    throw buildDuelV2BackendUnavailableError(fallbackError);
  }

  try {
    return await invokeBackendHttp(path, {
      payload,
      requireAuth: true,
      fallbackError,
    });
  } catch (error) {
    const status = Number(error?.httpStatus || 0);
    const code = String(error?.code || "").trim().toLowerCase();
    if (
      status === 404
      || code === "route-not-found"
      || code === "http-request-failed"
      || code === "http-backend-not-configured"
    ) {
      throw buildDuelV2BackendUnavailableError(fallbackError);
    }
    throw error;
  }
}

export async function joinMatchmakingDuelV2Secure(payload = {}) {
  return invokeDuelV2HttpOnly(
    "/api/games/duel-v2/join-matchmaking",
    payload,
    "Impossible de rejoindre Duel V2."
  );
}

export async function createFriendDuelRoomV2Secure(payload = {}) {
  return invokeDuelV2HttpOnly(
    "/api/games/duel-v2/create-friend-room",
    payload,
    "Impossible de kreye salon prive Duel la."
  );
}

export async function resumeFriendDuelRoomV2Secure(payload = {}) {
  return invokeDuelV2HttpOnly(
    "/api/games/duel-v2/resume-friend-room",
    payload,
    "Impossible de reprann salon prive Duel la."
  );
}

export async function joinFriendDuelRoomByCodeV2Secure(payload = {}) {
  return invokeDuelV2HttpOnly(
    "/api/games/duel-v2/join-friend-room-by-code",
    payload,
    "Impossible de antre nan salon prive Duel la."
  );
}

export async function requestFriendDuelRematchV2Secure(payload = {}) {
  return invokeDuelV2HttpOnly(
    "/api/games/duel-v2/request-friend-rematch",
    payload,
    "Impossible de relanse revanche prive Duel la."
  );
}

export async function getDuelV2RoomStateSecure(payload = {}) {
  return invokeDuelV2HttpOnly(
    "/api/games/duel-v2/get-room-state",
    payload,
    "Impossible de charger la salle Duel V2."
  );
}

export async function touchRoomPresenceDuelV2Secure(payload = {}) {
  return invokeDuelV2HttpOnly(
    "/api/games/duel-v2/touch-presence",
    payload,
    "Impossible de mettre a jour la presence Duel V2."
  );
}

export async function leaveRoomDuelV2Secure(payload = {}) {
  return invokeDuelV2HttpOnly(
    "/api/games/duel-v2/leave-room",
    payload,
    "Impossible de quitter la salle Duel V2."
  );
}

export async function submitActionDuelV2Secure(payload = {}) {
  return invokeDuelV2HttpOnly(
    "/api/games/duel-v2/submit-action",
    payload,
    "Impossible d'envoyer l'action Duel V2."
  );
}
export async function getMyGameHistorySecure(payload = {}) {
  const fallbackError = "Impossible de charger l'historique des jeux.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/history/list", {
      payload,
      requireAuth: true,
      fallbackError,
    }).catch(() => invokeCallable("getMyGameHistorySecure", payload, fallbackError));
  }
  return invokeCallable("getMyGameHistorySecure", payload, fallbackError);
}

export async function debugSimulateMorpionWinSecure(payload = {}) {
  return invokeCallable("debugSimulateMorpionWinSecure", payload, "Impossible de lancer le test de gain Morpion.");
}

export async function debugSimulateMorpionV2NoPlayRefundSecure(payload = {}) {
  return invokeCallable("debugSimulateMorpionV2NoPlayRefundSecure", payload, "Impossible de lancer le test de remboursement Morpion V2.");
}

export async function debugSimulateMorpionV2WinSecure(payload = {}) {
  return invokeCallable("debugSimulateMorpionV2WinSecure", payload, "Impossible de lancer le test de gain Morpion V2.");
}

export async function debugSimulateMorpionV3WinSecure(payload = {}) {
  return invokeCallable("debugSimulateMorpionV3WinSecure", payload, "Impossible de lancer le test de gain Mopyon V3.");
}

export async function debugSimulateMorpionV3FriendWinSecure(payload = {}) {
  return invokeCallable("debugSimulateMorpionV3FriendWinSecure", payload, "Impossible de lancer le test de gain Mopyon prive V3.");
}

export async function debugSimulateDominoClassicWinSecure(payload = {}) {
  return invokeCallable("debugSimulateDominoClassicWinSecure", payload, "Impossible de lancer le test de gain Domino classique.");
}

export async function debugSimulateDuelWinSecure(payload = {}) {
  return invokeCallable("debugSimulateDuelWinSecure", payload, "Impossible de lancer le test de gain Duel Domino.");
}

export async function debugSimulateDameWinSecure(payload = {}) {
  return invokeCallable("debugSimulateDameWinSecure", payload, "Impossible de lancer le test de gain Dame.");
}

export async function debugSimulatePongWinSecure(payload = {}) {
  return invokeCallable("debugSimulatePongWinSecure", payload, "Impossible de lancer le test de gain Pong.");
}

export async function joinMatchmakingMorpionV2Secure(payload = {}) {
  return invokeCallable("joinMatchmakingMorpionV2", payload, "Impossible de rejoindre une partie de morpion.");
}

export async function joinMatchmakingMorpionV3Secure(payload = {}) {
  const fallbackError = "Impossible de rejoindre une partie de mopyon.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/morpion-v3/join-matchmaking", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("joinMatchmakingMorpionV3", payload, fallbackError);
}

export async function createFriendMorpionRoomV3Secure(payload = {}) {
  const fallbackError = "Impossible de kreye salon prive Mopyon an.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/morpion-v3/create-friend-room", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("createFriendMorpionRoomV3", payload, fallbackError);
}

export async function resumeFriendMorpionRoomV3Secure(payload = {}) {
  const fallbackError = "Impossible de reprann salon prive Mopyon an.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/morpion-v3/resume-friend-room", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("resumeFriendMorpionRoomV3", payload, fallbackError);
}

export async function joinFriendMorpionRoomByCodeV3Secure(payload = {}) {
  const fallbackError = "Impossible de antre nan salon prive Mopyon an.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/morpion-v3/join-friend-room-by-code", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("joinFriendMorpionRoomByCodeV3", payload, fallbackError);
}

export async function requestFriendMorpionRematchV3Secure(payload = {}) {
  const fallbackError = "Impossible de relanse rematch prive Mopyon an.";
  return invokeBackendHttp("/api/games/morpion-v3/request-friend-rematch", {
    payload,
    requireAuth: true,
    fallbackError,
  });
}

export async function joinMatchmakingMorpionSecure(payload = {}) {
  return invokeCallable("joinMatchmakingMorpion", payload, "Impossible de rejoindre une partie de morpion.");
}

export async function ensureRoomReadyMorpionV2Secure(payload = {}) {
  return invokeCallable("ensureRoomReadyMorpionV2", payload, "Impossible de demarrer la partie de morpion.");
}

export async function getMorpionV3RoomStateSecure(payload = {}) {
  const fallbackError = "Impossible de charger la salle de mopyon.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/morpion-v3/get-room-state", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("getMorpionV3RoomState", payload, fallbackError);
}

export async function touchRoomPresenceMorpionV3Secure(payload = {}) {
  const fallbackError = "Impossible de mettre a jou prezans mopyon an.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/morpion-v3/touch-presence", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("touchRoomPresenceMorpionV3", payload, fallbackError);
}

export async function ensureRoomReadyMorpionSecure(payload = {}) {
  return invokeCallable("ensureRoomReadyMorpion", payload, "Impossible de demarrer la partie de morpion.");
}

export async function touchRoomPresenceMorpionV2Secure(payload = {}) {
  return invokeCallable("touchRoomPresenceMorpionV2", payload, "Impossible de mettre a jour la presence morpion.");
}

export async function touchRoomPresenceMorpionSecure(payload = {}) {
  return invokeCallable("touchRoomPresenceMorpion", payload, "Impossible de mettre a jour la presence morpion.");
}

export async function ackRoomStartSeenMorpionSecure(payload = {}) {
  return invokeCallable("ackRoomStartSeenMorpion", payload, "Impossible de synchroniser le demarrage du morpion.");
}

export async function leaveRoomMorpionV2Secure(payload = {}) {
  return invokeCallable("leaveRoomMorpionV2", payload, "Impossible de quitter la salle morpion.");
}

export async function leaveRoomMorpionV3Secure(payload = {}) {
  const fallbackError = "Impossible de quitter la salle mopyon.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/morpion-v3/leave-room", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("leaveRoomMorpionV3", payload, fallbackError);
}

export async function leaveRoomMorpionSecure(payload = {}) {
  return invokeCallable("leaveRoomMorpion", payload, "Impossible de quitter la salle morpion.");
}

export async function submitActionMorpionV2Secure(payload = {}) {
  return invokeCallable("submitActionMorpionV2", payload, "Impossible d'envoyer l'action morpion.");
}

export async function submitActionMorpionV3Secure(payload = {}) {
  const fallbackError = "Impossible d'envoyer l'action mopyon.";
  if (getConfiguredApiBaseUrl()) {
    return invokeBackendHttp("/api/games/morpion-v3/submit-action", {
      payload,
      requireAuth: true,
      fallbackError,
    });
  }
  return invokeCallable("submitActionMorpionV3", payload, fallbackError);
}

export async function submitActionMorpionSecure(payload = {}) {
  return invokeCallable("submitActionMorpion", payload, "Impossible d'envoyer l'action morpion.");
}

export async function claimWinRewardMorpionV2Secure(payload = {}) {
  return invokeCallable("claimWinRewardMorpionV2", payload, "Impossible de valider le gain morpion.");
}

export async function claimWinRewardMorpionSecure(payload = {}) {
  return invokeCallable("claimWinRewardMorpion", payload, "Impossible de valider le gain morpion.");
}

export async function getMorpionLiveMatchmakingSignalSecure(payload = {}) {
  return invokeCallable("getMorpionLiveMatchmakingSignal", payload, "Impossible de charger le signal Morpion.");
}

export async function getMorpionMatchmakingHintSecure(payload = {}) {
  return invokeCallable("getMorpionMatchmakingHint", payload, "Impossible de charger l'indication de file Morpion.");
}

export async function resumeFriendMorpionRoomSecure(payload = {}) {
  return invokeCallable("resumeFriendMorpionRoom", payload, "Impossible de reprendre la salle morpion privee.");
}

export async function resumeMorpionBotTestRoomSecure(payload = {}) {
  return invokeCallable("resumeMorpionBotTestRoom", payload, "Impossible de reprendre la salle de test morpion.");
}

export async function createMorpionBotTestRoomSecure(payload = {}) {
  return invokeCallable("createMorpionBotTestRoom", payload, "Impossible de creer la salle de test morpion.");
}

export async function requestFriendMorpionRematchSecure(payload = {}) {
  return invokeCallable("requestFriendMorpionRematch", payload, "Impossible de demander la revanche morpion.");
}

export async function getMyActiveMorpionInviteSecure(payload = {}) {
  return invokeCallable("getMyActiveMorpionInvite", payload, "Impossible de charger l'invitation morpion.");
}

export async function respondMorpionPlayInviteSecure(payload = {}) {
  return invokeCallable("respondMorpionPlayInvite", payload, "Impossible de repondre a l'invitation.");
}

export async function getMyMorpionWhatsappPreferenceSecure(payload = {}) {
  return invokeCallable("getMyMorpionWhatsappPreferenceSecure", payload, "Impossible de charger ton numero WhatsApp morpion.");
}

export async function saveMorpionWhatsappPreferenceSecure(payload = {}) {
  return invokeCallable("saveMorpionWhatsappPreferenceSecure", payload, "Impossible d'enregistrer ton numero WhatsApp.");
}

export async function removeMorpionWhatsappPreferenceSecure(payload = {}) {
  return invokeCallable("removeMorpionWhatsappPreferenceSecure", payload, "Impossible de retirer ton numero WhatsApp.");
}

export async function listRecentMorpionWhatsappContactsSecure(payload = {}) {
  return invokeCallable("listRecentMorpionWhatsappContactsSecure", payload, "Impossible de charger les joueurs recemment actifs.");
}

