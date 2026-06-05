import {
  auth,
  db,
  collection,
  doc,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
} from "./firebase-init.js";
import {
  createFriendDuelRoomV2Secure,
  getDuelV2RoomStateSecure,
  joinFriendDuelRoomByCodeV2Secure,
  joinMatchmakingDuelV2Secure,
  leaveRoomDuelV2Secure,
  requestFriendDuelRematchV2Secure,
  resumeFriendDuelRoomV2Secure,
  submitActionDuelV2Secure,
  touchRoomPresenceDuelV2Secure,
} from "./secure-functions.js";
import { ensureXchangeState, getXchangeState } from "./xchange.js";
import { mountNetworkQualityIndicator } from "./network-quality-indicator.js";

const DUEL_V2_ROOMS = "duelRoomsV2";
const PUBLIC_DUEL_STAKE_HTG = 25;
const MIN_PRIVATE_DUEL_STAKE_HTG = 25;
const HTG_TO_DOES_RATE = 20;
const PRESENCE_PING_MS = 15000;
const TURN_LIMIT_MS = 30000;
const WAIT_SECONDS = 7;
const WHATSAPP_GROUP_URL = "https://chat.whatsapp.com/IENi1LH9hn0JWrLfaZwwv1";
const URL_PARAMS = new URLSearchParams(window.location.search);

let currentUser = null;
let currentRoomId = "";
let currentRoomData = null;
let currentSeatIndex = -1;
let currentRoomMode = normalizeRoomMode(
  URL_PARAMS.get("roomMode")
  || (String(URL_PARAMS.get("mode") || "").trim().toLowerCase() === "friend" ? "duel_v2_friends" : "")
);
let currentInviteCode = normalizeCode(URL_PARAMS.get("inviteCode"));
let friendFlowAction = normalizeFriendFlowAction(URL_PARAMS.get("friendAction"));
let requestedFriendRoomId = String(URL_PARAMS.get("friendDuelRoomId") || URL_PARAMS.get("roomId") || "").trim();
let currentActions = [];
let duelDeckOrder = [];
let roomUnsub = null;
let actionsUnsub = null;
let presenceTimer = null;
let turnTimer = null;
let turnTick = null;
let joining = false;
let gameLaunched = false;
let actionsReady = false;
let duelStakeEntryAccepted = false;
let friendActionBusy = false;
let friendRematchBusy = false;
let friendRematchPending = false;
let waitingTimer = null;
let waitDeadlineMs = 0;
let roomWaitingDeadlineMs = 0;
let publicBotTransitionRunning = false;
let activeStakeHtg = Math.max(PUBLIC_DUEL_STAKE_HTG, safeInt(URL_PARAMS.get("stakeHtg"), PUBLIC_DUEL_STAKE_HTG));
let duelBootStarted = false;
let duelBranchChoiceHelpSeen = false;
let orientationGuardDeferredAction = null;
let orientationGuardAutoContinueTimer = 0;
let duelTurnWarningAccepted = false;
let duelBranchChoiceGuideAccepted = false;
let lotModalOpen = false;
let lotActionSending = false;
let duelLotScene = null;
let duelLotCamera = null;
let duelLotRenderer = null;
let duelLotViewport = null;
let duelLotLightsReady = false;
let duelLotTileEntries = [];
let duelLotRaycaster = null;
let duelLotPointer = null;
const duelNetworkQualityIndicator = mountNetworkQualityIndicator({
  position: "top-left",
  debugLabel: "DUEL_NETWORK_QUALITY",
});

const DUEL_LOT_COLUMNS = 7;
const DUEL_LOT_TILE_SCALE = 1.34;
const DUEL_LOT_TILE_WIDTH = 1.0 * DUEL_LOT_TILE_SCALE;
const DUEL_LOT_TILE_HEIGHT = 2.0 * DUEL_LOT_TILE_SCALE;
const DUEL_LOT_GAP_X = 0.22;
const DUEL_LOT_GAP_Z = 0.58;

function safeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function safeSignedInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function $(id) {
  return document.getElementById(id);
}

function openOverlay(id) {
  const overlay = $(id);
  if (!overlay) return;
  overlay.classList.remove("hidden");
  overlay.classList.add("flex");
}

function closeOverlay(id) {
  const overlay = $(id);
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.classList.remove("flex");
}

function normalizeCode(value = "") {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeRoomMode(value = "") {
  return String(value || "").trim().toLowerCase() === "duel_v2_friends"
    ? "duel_v2_friends"
    : "duel_v2_public";
}

function normalizeFriendFlowAction(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "create" || normalized === "friend-create") return "create";
  if (normalized === "join" || normalized === "friend-join") return "join";
  return "";
}

function getLegacyEntryIntentFromUrl() {
  return String(URL_PARAMS.get("entry") || "").trim().toLowerCase();
}

function getInviteCodeFromUrl() {
  return normalizeCode(URL_PARAMS.get("inviteCode") || "");
}

function getStakeHtgValue(roomData = currentRoomData || {}) {
  const roomStakeHtg = safeInt(roomData?.stakeHtg, 0);
  if (roomStakeHtg > 0) return roomStakeHtg;
  return Math.max(PUBLIC_DUEL_STAKE_HTG, activeStakeHtg || PUBLIC_DUEL_STAKE_HTG);
}

function syncActiveStakeFromRoomData(roomData = {}) {
  const roomStakeHtg = safeInt(roomData?.stakeHtg, 0);
  if (roomStakeHtg > 0) {
    activeStakeHtg = roomStakeHtg;
  }
}

function syncRoomUrl() {
  try {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("stake", String(getStakeHtgValue() * HTG_TO_DOES_RATE));
    nextUrl.searchParams.set("fundingCurrency", "htg");
    nextUrl.searchParams.set("stakeHtg", String(getStakeHtgValue()));
    nextUrl.searchParams.set("roomMode", currentRoomMode);
    if (currentRoomMode === "duel_v2_friends") {
      if (friendFlowAction) {
        nextUrl.searchParams.set("friendAction", friendFlowAction);
      } else {
        nextUrl.searchParams.delete("friendAction");
      }
      if (currentInviteCode) {
        nextUrl.searchParams.set("inviteCode", currentInviteCode);
      } else {
        nextUrl.searchParams.delete("inviteCode");
      }
      if (requestedFriendRoomId || currentRoomId) {
        nextUrl.searchParams.set("friendDuelRoomId", String(requestedFriendRoomId || currentRoomId || "").trim());
      } else {
        nextUrl.searchParams.delete("friendDuelRoomId");
      }
    } else {
      nextUrl.searchParams.delete("friendAction");
      nextUrl.searchParams.delete("inviteCode");
      nextUrl.searchParams.delete("friendDuelRoomId");
    }
    nextUrl.searchParams.delete("entry");
    nextUrl.searchParams.delete("mode");
    nextUrl.searchParams.delete("roomId");
    window.history.replaceState({ duelV2: true }, "", nextUrl.toString());
  } catch (_) {}
}

function syncLocalRoomMetaFromState(state = {}) {
  const nextRoomId = String(state?.roomId || currentRoomId || "").trim();
  if (nextRoomId) currentRoomId = nextRoomId;
  if (typeof state?.seatIndex === "number") currentSeatIndex = safeInt(state.seatIndex, currentSeatIndex);
  currentRoomMode = normalizeRoomMode(state?.roomMode || currentRoomMode || "duel_v2_public");
  currentInviteCode = String(state?.inviteCode || currentInviteCode || "").trim();
  if (currentRoomMode === "duel_v2_friends") {
    requestedFriendRoomId = String(state?.roomId || requestedFriendRoomId || currentRoomId || "").trim();
  } else {
    currentInviteCode = "";
    friendFlowAction = "";
    requestedFriendRoomId = "";
  }
  roomWaitingDeadlineMs = safeSignedInt(state?.waitingDeadlineMs, roomWaitingDeadlineMs);
  if (state && typeof state === "object") {
    currentRoomData = { ...(currentRoomData || {}), ...state };
    syncActiveStakeFromRoomData(currentRoomData);
  }
  syncRoomUrl();
}

function getFriendRematchRequestUids(state = currentRoomData || {}) {
  return Array.isArray(state?.rematchRequestUids)
    ? state.rematchRequestUids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function hasLocalFriendRematchRequest(state = currentRoomData || {}) {
  const uid = String(currentUser?.uid || auth.currentUser?.uid || "").trim();
  return uid ? getFriendRematchRequestUids(state).includes(uid) : false;
}

function shouldHoldFriendRematch(state = currentRoomData || {}) {
  return currentRoomMode === "duel_v2_friends"
    && String(state?.status || "").trim().toLowerCase() === "ended"
    && (friendRematchPending || hasLocalFriendRematchRequest(state));
}

function normalizePlayerName(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function setFriendJoinStatus(message = "", isError = false) {
  const status = $("DuelFriendJoinStatus");
  if (!status) return;
  status.textContent = String(message || "");
  status.style.color = isError ? "#fca5a5" : "";
}

function isLandscapeViewport() {
  return safeInt(window.innerWidth, 0) >= safeInt(window.innerHeight, 0);
}

function isSmartphoneMobileDevice() {
  const userAgent = String(window.navigator.userAgent || "");
  const shortSide = Math.min(safeInt(window.innerWidth, 0), safeInt(window.innerHeight, 0));
  const longSide = Math.max(safeInt(window.innerWidth, 0), safeInt(window.innerHeight, 0));
  const isIphoneLike = /iphone|ipod/i.test(userAgent);
  const isAndroidPhone = /android/i.test(userAgent) && /mobile/i.test(userAgent);
  const isOtherPhone = /mobile|windows phone|iemobile/i.test(userAgent) && !/ipad|tablet/i.test(userAgent);
  return (isIphoneLike || isAndroidPhone || isOtherPhone) && shortSide > 0 && shortSide <= 900 && longSide <= 1100;
}

function requiresLandscapeGuard() {
  return isSmartphoneMobileDevice() && !isLandscapeViewport();
}

function clearOrientationGuardAutoContinueTimer() {
  if (!orientationGuardAutoContinueTimer) return;
  window.clearTimeout(orientationGuardAutoContinueTimer);
  orientationGuardAutoContinueTimer = 0;
}

function closeOrientationGuard() {
  clearOrientationGuardAutoContinueTimer();
  closeOverlay("OrientationGuardOverlay");
}

function hideDuelPrelaunchOverlays() {
  closeOverlay("DuelTurnWarningOverlay");
  closeOverlay("DuelBranchChoiceGuideOverlay");
}

function openDuelTurnWarningOverlay() {
  hideDuelPrelaunchOverlays();
  closeOverlay("DuelBranchChoiceHelpOverlay");
  openOverlay("DuelTurnWarningOverlay");
}

function openDuelBranchChoiceGuideOverlay() {
  hideDuelPrelaunchOverlays();
  closeOverlay("DuelBranchChoiceHelpOverlay");
  openOverlay("DuelBranchChoiceGuideOverlay");
}

function getOrientationGuardCopy() {
  const playing = String(currentRoomData?.status || "").trim().toLowerCase() === "playing";
  if (orientationGuardDeferredAction) {
    return "Mete telefòn ou an peyizaj. Duel la pap lanse toutotan ekran an rete vètikal.";
  }
  return playing
    ? "Pati a ap kontinye. Remet telefòn ou an peyizaj vit pou ou pa rate tan pa w."
    : "Mete telefòn ou an peyizaj pou kontinye suiv duel la pi byen.";
}

function refreshOrientationGuardState() {
  const overlay = $("OrientationGuardOverlay");
  const risk = $("OrientationGuardRisk");
  if (!overlay) return;

  const shouldGuard = requiresLandscapeGuard();
  const shouldShow = shouldGuard && (
    !!orientationGuardDeferredAction
    || String(currentRoomData?.status || "").trim().length > 0
    || gameLaunched
    || duelBootStarted
  );

  if (!shouldGuard && orientationGuardDeferredAction) {
    const deferred = orientationGuardDeferredAction;
    orientationGuardDeferredAction = null;
    clearOrientationGuardAutoContinueTimer();
    orientationGuardAutoContinueTimer = window.setTimeout(() => {
      orientationGuardAutoContinueTimer = 0;
      closeOrientationGuard();
      deferred();
    }, 220);
    return;
  }

  if (!shouldShow) {
    closeOrientationGuard();
    return;
  }

  openOverlay("OrientationGuardOverlay");
  const copyNodes = overlay.querySelectorAll("p");
  if (copyNodes && copyNodes.length >= 1) {
    const introNode = copyNodes[0];
    if (introNode) introNode.textContent = getOrientationGuardCopy();
  }
  const showRisk = !orientationGuardDeferredAction && String(currentRoomData?.status || "").trim().toLowerCase() === "playing";
  if (risk) {
    risk.classList.toggle("hidden", !showRisk);
  }

  clearOrientationGuardAutoContinueTimer();
}

function guardLandscapeBeforeStart(onReady = null) {
  if (!requiresLandscapeGuard()) return false;
  orientationGuardDeferredAction = typeof onReady === "function" ? onReady : null;
  refreshOrientationGuardState();
  return true;
}

function getDuelBranchChoiceHelpRefs() {
  return {
    overlay: $("DuelBranchChoiceHelpOverlay"),
    title: $("DuelBranchChoiceHelpTitle"),
    lead: $("DuelBranchChoiceHelpLead"),
    scenario: $("DuelBranchChoiceHelpScenario"),
    leftTileValue: $("DuelBranchChoiceHelpLeftTileValue"),
    rightTileValue: $("DuelBranchChoiceHelpRightTileValue"),
    exactRule: $("DuelBranchChoiceHelpExactRule"),
    warning: $("DuelBranchChoiceHelpWarning"),
    close: $("DuelBranchChoiceHelpCloseBtn"),
    confirm: $("DuelBranchChoiceHelpConfirmBtn"),
  };
}

function hideDuelBranchChoiceHelp() {
  const refs = getDuelBranchChoiceHelpRefs();
  refs.overlay?.classList.add("hidden");
  refs.overlay?.classList.remove("flex");
}

function showDuelBranchChoiceHelp(detail = {}) {
  const refs = getDuelBranchChoiceHelpRefs();
  if (!refs.overlay) return false;

  const tileValues = Array.isArray(detail?.tileValues) ? detail.tileValues : [];
  const leftValue = Number.isFinite(Number(detail?.leftValue)) ? Math.trunc(Number(detail.leftValue)) : tileValues[0];
  const rightValue = Number.isFinite(Number(detail?.rightValue)) ? Math.trunc(Number(detail.rightValue)) : tileValues[1];
  const tileLeft = Number.isFinite(Number(tileValues[0])) ? Math.trunc(Number(tileValues[0])) : leftValue;
  const tileRight = Number.isFinite(Number(tileValues[1])) ? Math.trunc(Number(tileValues[1])) : rightValue;
  const reason = String(detail?.reason || "").trim().toLowerCase();

  duelBranchChoiceHelpSeen = true;

  if (refs.title) {
    refs.title.textContent = reason === "center_tap"
      ? "Chwazi ki mwatye pou w tape"
      : "Kijan pou chwazi ki bout pou jwe domino a";
  }
  if (refs.lead) {
    refs.lead.textContent = reason === "center_tap"
      ? "Domino sa a ka ale nan 2 bout diferan. Pou jwèt la konprann chwa w la, tape sou mwatye ki gen nimewo bout ou vle a."
      : "Lè menm domino a ka antre nan 2 bout diferan tab la, pa tape mitan domino a.";
  }
  if (refs.scenario) {
    refs.scenario.textContent = `Kounye a tab la louvri sou ${leftValue} a goch ak ${rightValue} la dwat. Domino w ap jwe a se ${tileLeft} | ${tileRight}.`;
  }
  if (refs.leftTileValue) refs.leftTileValue.textContent = String(tileLeft);
  if (refs.rightTileValue) refs.rightTileValue.textContent = String(tileRight);
  if (refs.exactRule) {
    refs.exactRule.textContent = `Si ou vle ale sou bout ${leftValue} a, tape pati domino a ki gen ${leftValue} a. Si ou vle ale sou bout ${rightValue} la, tape pati domino a ki gen ${rightValue} la.`;
  }
  if (refs.warning) {
    refs.warning.textContent = `Pa tape mitan domino a nan ka sa a. Fòk ou chwazi mwatye ki gen ${leftValue} oswa ${rightValue}, selon bout ou vle jwe a.`;
  }

  refs.overlay.classList.remove("hidden");
  refs.overlay.classList.add("flex");
  return true;
}

function installDuelBranchChoiceHelpBridge() {
  const refs = getDuelBranchChoiceHelpRefs();
  if (!refs.overlay) return;
  if (refs.overlay.dataset.kobposhBranchHelpBound === "1") {
    window.KobposhDuelShowBranchChoiceHelp = showDuelBranchChoiceHelp;
    window.KobposhDuelHasSeenBranchChoiceHelp = () => duelBranchChoiceHelpSeen;
    return;
  }

  refs.overlay.dataset.kobposhBranchHelpBound = "1";
  refs.close?.addEventListener("click", hideDuelBranchChoiceHelp);
  refs.confirm?.addEventListener("click", hideDuelBranchChoiceHelp);
  refs.overlay.addEventListener("click", (event) => {
    if (event.target === refs.overlay) hideDuelBranchChoiceHelp();
  });

  window.KobposhDuelShowBranchChoiceHelp = showDuelBranchChoiceHelp;
  window.KobposhDuelHasSeenBranchChoiceHelp = () => duelBranchChoiceHelpSeen;
}

function continueDuelPrelaunchFlow() {
  if (duelTurnWarningAccepted !== true) {
    openDuelTurnWarningOverlay();
    return;
  }
  if (duelBranchChoiceGuideAccepted !== true) {
    openDuelBranchChoiceGuideOverlay();
    return;
  }
  hideDuelPrelaunchOverlays();
  bootRoomFlowForCurrentUser();
}

const searchOpponentBadgeEl = $("DuelSearchOpponentBadge");
const searchOpponentNameEl = $("DuelSearchOpponentName");
const searchFriendBoxEl = $("DuelSearchFriendBox");
const searchInviteCodeEl = $("DuelSearchInviteCode");
const searchCopyCodeBtn = $("DuelSearchCopyCodeBtn");

function renderFriendSearchBox() {
  const shouldShow = currentRoomMode === "duel_v2_friends" && !!currentInviteCode;
  if (searchFriendBoxEl) {
    searchFriendBoxEl.classList.toggle("hidden", !shouldShow);
  }
  if (searchInviteCodeEl && shouldShow) {
    searchInviteCodeEl.textContent = currentInviteCode;
  }
}

function setSearchOpponentVisible(visible, displayName = "") {
  if (searchOpponentBadgeEl) {
    searchOpponentBadgeEl.classList.toggle("hidden", !visible);
  }
  if (searchOpponentNameEl && visible) {
    searchOpponentNameEl.textContent = String(displayName || "").trim() || "Advese a konekte";
  }
}

async function copyText(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {}
  try {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "readonly");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return !!ok;
  } catch (_) {
    return false;
  }
}

function getSeatName(roomData, seatIndex, fallback = "") {
  const names = Array.isArray(roomData?.playerNames) ? roomData.playerNames : [];
  return normalizePlayerName(names?.[seatIndex], fallback);
}

function getSelfDisplayName(roomData = currentRoomData) {
  if (currentSeatIndex < 0) return normalizePlayerName(currentUser?.displayName || currentUser?.email || "", "Ou");
  return getSeatName(roomData, currentSeatIndex, normalizePlayerName(currentUser?.displayName || currentUser?.email || "", "Ou"));
}

function getOpponentSeatIndex(roomData = currentRoomData) {
  const seats = Array.isArray(roomData?.playerUids) ? roomData.playerUids : [];
  for (let index = 0; index < seats.length; index += 1) {
    if (index !== currentSeatIndex && String(seats[index] || "").trim()) return index;
  }
  return currentSeatIndex === 0 ? 1 : 0;
}

function getOpponentDisplayName(roomData = currentRoomData) {
  const status = String(roomData?.status || "").trim().toLowerCase();
  if (currentRoomMode === "duel_v2_public" && status === "waiting") {
    return "Ap tann advese";
  }
  const opponentSeat = getOpponentSeatIndex(roomData);
  return getSeatName(roomData, opponentSeat, "Ap tann advese");
}

function syncLegacyDominoNames(roomData = currentRoomData) {
  const names = [
    getSeatName(roomData, 0, "Jwe 1"),
    getSeatName(roomData, 1, "Jwe 2"),
    "",
    "",
  ];
  names.forEach((name, index) => {
    const input = document.getElementById(`NNombre${index + 1}`);
    if (input) input.value = name;
    if (window.Domino?.Partida?.Opciones && typeof window.Domino.Partida.Opciones.AsignarNombreJugador === "function") {
      window.Domino.Partida.Opciones.AsignarNombreJugador(String(index + 1), name);
    }
  });
}

function renderPlayerNames(roomData = currentRoomData) {
  const valueEl = $("LocalTurnValue");
  const labelEl = $("LocalTurnLabel");
  if (valueEl) valueEl.textContent = getOpponentDisplayName(roomData);
  if (labelEl && String(roomData?.status || "") !== "playing") {
    labelEl.textContent = "Advese";
  }
  syncLegacyDominoNames(roomData);
}

function renderWallet() {
  const uid = String(currentUser?.uid || auth.currentUser?.uid || "").trim();
  const baseBalance = window.__userBaseBalance || window.__userBalance || 0;
  const state = getXchangeState(baseBalance, uid || undefined);
  const total = safeInt(state?.totalBalance, 0);
  const walletEl = $("LocalDoesValue");
  if (walletEl) walletEl.textContent = String(total);
}

async function refreshWallet() {
  try {
    const uid = String(currentUser?.uid || auth.currentUser?.uid || "").trim();
    await ensureXchangeState(uid || undefined);
  } catch (_) {}
  renderWallet();
  renderPlayerNames();
}

function setStatus(message = "") {
  const title = $("MatchLoadingTitle");
  const text = $("MatchLoadingText");
  if (title) {
    if (String(currentRoomData?.status || "") === "playing") title.textContent = "Duel Domino";
    else if (currentRoomMode === "duel_v2_friends") title.textContent = "Salon prive Domino";
    else title.textContent = "Recherche de partie...";
  }
  if (text) text.textContent = String(message || "");
}

function isRoomActivelyPlaying(state = currentRoomData) {
  const status = String(state?.status || "").trim().toLowerCase();
  return status === "playing" || gameLaunched === true || actionsReady === true;
}

function setMatchLoading(visible, text = "") {
  const overlay = $("MatchLoadingOverlay");
  const textNode = $("MatchLoadingText");
  if (textNode && text) textNode.textContent = String(text);
  if (!overlay) return;
  if (isRoomActivelyPlaying() && visible !== true) {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    return;
  }
  if (visible) {
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
  } else {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  }
}

function setLeaveRoomButtonVisible(visible) {
  const btn = $("LeaveRoomTopBtn");
  if (!btn) return;
  btn.classList.toggle("hidden", !visible);
  btn.style.display = visible ? "inline-flex" : "none";
}

function goHome() {
  window.location.href = "./index.html?view=public";
}

function stopWaitingCycle() {
  if (waitingTimer) {
    clearTimeout(waitingTimer);
    waitingTimer = null;
  }
}

function setWaitingActionsVisible(visible) {
  const actions = $("MatchLoadingActions");
  if (!actions) return;
  actions.classList.toggle("hidden", !visible);
}

function setWaitingTimerVisible(visible) {
  const wrap = $("MatchLoadingTimerWrap");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !visible);
}

function setWaitingActionButtonVisible(id, visible) {
  const btn = $(id);
  if (!btn) return;
  btn.classList.toggle("hidden", !visible);
}

function configureWaitingActionButtons({ showRetry = false, retryLabel = "Tann 15s anko", showGroup = false, showHome = false } = {}) {
  const retryBtn = $("MatchLoadingRetryBtn");
  if (retryBtn) retryBtn.textContent = String(retryLabel || "Tann 15s anko");
  setWaitingActionButtonVisible("MatchLoadingRetryBtn", showRetry);
  setWaitingActionButtonVisible("MatchLoadingGroupBtn", showGroup);
  setWaitingActionButtonVisible("MatchLoadingHomeBtn", showHome);
  setWaitingActionsVisible(showRetry || showGroup || showHome);
}

function setWaitingProgress(ratio) {
  const fill = $("MatchLoadingProgressFill");
  if (!fill) return;
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  fill.style.width = `${Math.max(4, Math.round(clamped * 100))}%`;
  fill.classList.toggle("animate-pulse", clamped <= 0.04);
}

function renderWaitingError(message = "Nou pa rive lanse duel la.", {
  showRetry = true,
  retryLabel = "Eseye ankò",
  showGroup = false,
  showHome = true,
} = {}) {
  stopWaitingCycle();
  waitDeadlineMs = 0;
  roomWaitingDeadlineMs = 0;
  setSearchOpponentVisible(false);
  if (searchFriendBoxEl) searchFriendBoxEl.classList.add("hidden");
  const title = $("MatchLoadingTitle");
  const text = $("MatchLoadingText");
  if (title) title.textContent = "Duel la pa mache";
  if (text) text.textContent = String(message || "Nou pa rive lanse duel la.");
  setWaitingTimerVisible(false);
  configureWaitingActionButtons({ showRetry, retryLabel, showGroup, showHome });
  setWaitingProgress(0);
  setMatchLoading(true);
}

function renderWaitingExpired() {
  stopWaitingCycle();
  setSearchOpponentVisible(false);
  if (currentRoomMode === "duel_v2_public") {
    void resolvePublicBotMatchStart();
    return;
  }
  renderFriendSearchBox();
  const title = $("MatchLoadingTitle");
  const text = $("MatchLoadingText");
  const stakeHtg = getStakeHtgValue();
  if (currentRoomMode === "duel_v2_friends") {
    if (title) title.textContent = "Salon prive a poko ranpli";
    if (text) {
      const codePart = currentInviteCode ? ` Kod la se ${currentInviteCode}.` : "";
      text.textContent = `Nou poko 2 nan salon prive sa a pou yon duel a ${stakeHtg} HTG.${codePart}`;
    }
    setWaitingTimerVisible(false);
    configureWaitingActionButtons({ showRetry: false, showGroup: false, showHome: true });
    setWaitingProgress(0);
    setMatchLoading(true);
    return;
  }
  if (title) title.textContent = "Pa gen advese pou kounye a";
  if (text) text.textContent = "Ou poko antre nan okenn duel. Ou ka tann anko, tounen sou kay la, oswa antre nan gwoup WhatsApp la pou jwenn jwe.";
  setWaitingTimerVisible(false);
  configureWaitingActionButtons({ showRetry: true, showGroup: true, showHome: true, retryLabel: "Tann 15s" });
  setWaitingProgress(0);
  setMatchLoading(true);
}

async function resolvePublicBotMatchStart() {
  if (publicBotTransitionRunning || currentRoomMode !== "duel_v2_public" || !currentRoomId || isRoomActivelyPlaying()) return;
  publicBotTransitionRunning = true;
  const title = $("MatchLoadingTitle");
  const text = $("MatchLoadingText");
  if (title) title.textContent = "Advese a pare";
  if (text) text.textContent = "N ap konekte yon advese pou duel la kounye a...";
  setWaitingTimerVisible(false);
  configureWaitingActionButtons({ showRetry: false, showGroup: false, showHome: false });
  setWaitingProgress(0.08);
  setMatchLoading(true);
  try {
    const room = await refreshFullRoomState();
    const status = String(room?.status || currentRoomData?.status || "").trim().toLowerCase();
    if (status === "playing") {
      stopWaitingCycle();
      waitDeadlineMs = 0;
      roomWaitingDeadlineMs = 0;
      setMatchLoading(false);
      return;
    }
    roomWaitingDeadlineMs = safeSignedInt(room?.waitingDeadlineMs, roomWaitingDeadlineMs);
    if (status === "waiting" && roomWaitingDeadlineMs > Date.now()) {
      startWaitingWindow(roomWaitingDeadlineMs);
      return;
    }
    renderWaitingError("Nou pa rive prepare advese duel la kounye a.", {
      showRetry: true,
      retryLabel: "Eseye ankò",
      showGroup: false,
      showHome: true,
    });
  } catch (error) {
    renderWaitingError(error?.message || "Nou pa rive prepare advese duel la kounye a.", {
      showRetry: true,
      retryLabel: "Eseye ankò",
      showGroup: false,
      showHome: true,
    });
  } finally {
    publicBotTransitionRunning = false;
  }
}

function tickWaitingCycle() {
  if (isRoomActivelyPlaying()) {
    stopWaitingCycle();
    waitDeadlineMs = 0;
    roomWaitingDeadlineMs = 0;
    setMatchLoading(false);
    return;
  }
  const remainingMs = Math.max(0, waitDeadlineMs - Date.now());
  const timerValue = $("MatchLoadingTimerValue");
  if (timerValue) timerValue.textContent = `${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
  const totalWindowMs = currentRoomMode === "duel_v2_friends" ? (5 * 60 * 1000) : (WAIT_SECONDS * 1000);
  setWaitingProgress(remainingMs / totalWindowMs);
  if (remainingMs <= 0) {
    renderWaitingExpired();
    return;
  }
  waitingTimer = setTimeout(tickWaitingCycle, 250);
}

function renderWaitingSearch() {
  if (isRoomActivelyPlaying()) {
    stopWaitingCycle();
    waitDeadlineMs = 0;
    roomWaitingDeadlineMs = 0;
    setWaitingTimerVisible(false);
    configureWaitingActionButtons({ showRetry: false, showGroup: false, showHome: false });
    setMatchLoading(false);
    return;
  }
  const title = $("MatchLoadingTitle");
  const text = $("MatchLoadingText");
  const stakeHtg = getStakeHtgValue();
  const opponentName = String(getOpponentDisplayName(currentRoomData) || "").trim();
  const hasOpponent = Boolean(opponentName) && opponentName !== "Ap tann advese";
  setSearchOpponentVisible(hasOpponent, opponentName);
  if (currentRoomMode === "duel_v2_friends") {
    if (title) title.textContent = "M ap tann zanmi ou...";
    if (text) {
      const codePart = currentInviteCode ? ` Pataje kod ${currentInviteCode} la ak zanmi ou.` : "";
      text.textContent = `Salon prive a pare pou yon duel a ${stakeHtg} HTG.${codePart} Nou poko pran okenn HTG sou kont ou pandan n ap tann 2e jwe a antre.`;
    }
  } else {
    if (title) title.textContent = "M ap tann yon advese";
    if (text) text.textContent = `Nou ap pare yon duel a ${stakeHtg} HTG.`;
  }
  renderFriendSearchBox();
  const now = Date.now();
  const externalDeadline = roomWaitingDeadlineMs > now ? roomWaitingDeadlineMs : 0;
  const localDeadline = waitDeadlineMs > now ? waitDeadlineMs : 0;
  const effectiveDeadline = Math.max(externalDeadline, localDeadline);
  if (effectiveDeadline <= now) {
    renderWaitingExpired();
    return;
  }
  waitDeadlineMs = effectiveDeadline;
  configureWaitingActionButtons({ showRetry: false, showGroup: false, showHome: false });
  setWaitingTimerVisible(true);
  setMatchLoading(true);
  tickWaitingCycle();
}

function openFriendRematchWaitingState(
  titleText = "Nou mande revanj",
  bodyText = "M ap tann lot jw a konfime pou nou relanse menm salon prive a."
) {
  stopWaitingCycle();
  setSearchOpponentVisible(false);
  renderFriendSearchBox();
  const title = $("MatchLoadingTitle");
  const text = $("MatchLoadingText");
  if (title) title.textContent = titleText;
  if (text) text.textContent = bodyText;
  setWaitingTimerVisible(false);
  configureWaitingActionButtons({ showRetry: false, showGroup: false, showHome: false });
  setWaitingProgress(0);
  setLeaveRoomButtonVisible(true);
  setMatchLoading(true);
}

function startWaitingWindow(nextDeadlineMs = 0) {
  if (isRoomActivelyPlaying()) {
    stopWaitingCycle();
    waitDeadlineMs = 0;
    roomWaitingDeadlineMs = 0;
    setMatchLoading(false);
    return;
  }
  roomWaitingDeadlineMs = safeSignedInt(nextDeadlineMs, roomWaitingDeadlineMs);
  publicBotTransitionRunning = false;
  stopWaitingCycle();
  renderWaitingSearch();
}

async function confirmStakeEntryAndJoin() {
  if (duelStakeEntryAccepted || joining) return;
  duelStakeEntryAccepted = true;
  await joinPublicRoom();
}

async function createFriendRoom() {
  if (!currentUser?.uid || friendActionBusy || joining) return;
  friendActionBusy = true;
  currentRoomMode = "duel_v2_friends";
  friendFlowAction = "create";
  syncRoomUrl();
  setFriendJoinStatus("");
  try {
    const result = await createFriendDuelRoomV2Secure({ stakeHtg: activeStakeHtg });
    syncLocalRoomMetaFromState(result || {});
    friendRematchPending = false;
    if (String(result?.status || "").trim().toLowerCase() === "playing") {
      watchRoom(currentRoomId);
      await refreshFullRoomState();
      return;
    }
    startWaitingWindow(roomWaitingDeadlineMs);
    watchRoom(currentRoomId);
    await refreshFullRoomState();
  } catch (error) {
    setMatchLoading(true, error?.message || "Nou pa rive kreye salon prive Duel la.");
    configureWaitingActionButtons({ showRetry: false, showGroup: false, showHome: true });
    setWaitingTimerVisible(false);
    setWaitingProgress(0);
  } finally {
    friendActionBusy = false;
  }
}

async function joinFriendRoomByCode(inviteCodeArg = "") {
  if (!currentUser?.uid || friendActionBusy || joining) return;
  const inviteCode = normalizeCode(inviteCodeArg || $("DuelFriendJoinCodeInput")?.value || "");
  const joinOverlayWasVisible = $("DuelFriendJoinOverlay") && !$("DuelFriendJoinOverlay").classList.contains("hidden");
  if (!inviteCode) {
    setFriendJoinStatus("Tanpri mete kod salon an.", true);
    return;
  }
  friendActionBusy = true;
  currentRoomMode = "duel_v2_friends";
  friendFlowAction = "join";
  currentInviteCode = inviteCode;
  syncRoomUrl();
  setFriendJoinStatus("M ap verifye kod la...");
  try {
    const result = await joinFriendDuelRoomByCodeV2Secure({ inviteCode });
    syncLocalRoomMetaFromState(result || {});
    friendRematchPending = hasLocalFriendRematchRequest(result || {});
    closeOverlay("DuelFriendJoinOverlay");
    setFriendJoinStatus("");
    if ($("DuelFriendJoinCodeInput")) $("DuelFriendJoinCodeInput").value = "";
    startWaitingWindow(roomWaitingDeadlineMs);
    watchRoom(currentRoomId);
    await refreshFullRoomState();
  } catch (error) {
    if (!joinOverlayWasVisible) {
      openOverlay("DuelFriendJoinOverlay");
    }
    setFriendJoinStatus(error?.message || "Nou pa rive antre nan salon prive a.", true);
  } finally {
    friendActionBusy = false;
  }
}

async function resumeFriendRoomFromUrl() {
  const roomId = String(requestedFriendRoomId || "").trim();
  if (!currentUser?.uid || joining || !roomId) return;
  joining = true;
  currentRoomMode = "duel_v2_friends";
  currentRoomId = roomId;
  syncRoomUrl();
  startWaitingWindow(roomWaitingDeadlineMs);
  try {
    const result = await resumeFriendDuelRoomV2Secure({ roomId });
    syncLocalRoomMetaFromState(result || {});
    friendRematchPending = hasLocalFriendRematchRequest(result || {});
    watchRoom(currentRoomId);
    await refreshFullRoomState();
  } catch (error) {
    currentRoomId = "";
    currentRoomMode = "duel_v2_public";
    currentInviteCode = "";
    friendFlowAction = "";
    requestedFriendRoomId = "";
    friendRematchPending = false;
    syncRoomUrl();
    setMatchLoading(true, error?.message || "Nou pa rive reprann salon prive Duel la.");
    configureWaitingActionButtons({ showRetry: false, showGroup: false, showHome: true });
    setWaitingTimerVisible(false);
    setWaitingProgress(0);
  } finally {
    joining = false;
  }
}

function isDominoEngineReady() {
  const partida = window.Domino?.Partida || null;
  return !!(
    window.Domino &&
    window.Domino.Escena &&
    partida &&
    typeof partida.Empezar === "function" &&
    typeof partida.AplicarAccionMultijugador === "function" &&
    window.UI &&
    typeof window.UI.ActualizarBotonLucesJugadores === "function"
  );
}

function clearTurnTimer() {
  if (turnTimer) {
    clearTimeout(turnTimer);
    turnTimer = null;
  }
  if (turnTick) {
    clearInterval(turnTick);
    turnTick = null;
  }
  setTurnTimerUI(0, safeSignedInt(currentRoomData?.currentPlayer, -1));
}

function setTurnTimerUI(remainingSec, currentPlayer) {
  const timerEl = $("TurnTimer");
  const localTimerWrapEl = $("LocalTurnTimerWrap");
  const localTimerEl = $("LocalTurnTimer");
  const isPlaying = String(currentRoomData?.status || "") === "playing";
  const safeSeconds = Math.max(0, Math.ceil(remainingSec));
  const timerText = isPlaying ? `${safeSeconds}s` : "--";
  const isUrgent = isPlaying && safeSeconds > 0 && safeSeconds <= 5;
  if (timerEl) {
    timerEl.textContent = timerText;
    timerEl.setAttribute("Urgent", isUrgent ? "true" : "false");
  }
  if (localTimerEl) {
    localTimerEl.textContent = timerText;
    localTimerEl.setAttribute("Urgent", isUrgent ? "true" : "false");
  }
  if (localTimerWrapEl) {
    const shouldShow = String(currentRoomData?.status || "") === "playing";
    localTimerWrapEl.classList.toggle("hidden", !shouldShow);
  }
  const valueEl = $("LocalTurnValue");
  const labelEl = $("LocalTurnLabel");
  if (valueEl) valueEl.textContent = getOpponentDisplayName(currentRoomData);
  if (labelEl) {
    if (String(currentRoomData?.status || "") !== "playing") labelEl.textContent = "Advese";
    else labelEl.textContent = currentPlayer === currentSeatIndex ? "Se tou pa ou" : "Se tou pa li";
  }
}

function scheduleTurnTimeout(roomData) {
  clearTurnTimer();
  if (!roomData || String(roomData.status || "") !== "playing") return;
  const deadlineMs = safeSignedInt(roomData.turnDeadlineMs, 0);
  if (deadlineMs <= 0) {
    setTurnTimerUI(0, safeSignedInt(roomData.currentPlayer, -1));
    return;
  }
  const remainingMs = Math.max(0, deadlineMs - Date.now());
  const baseStartMs = deadlineMs - TURN_LIMIT_MS;
  setTurnTimerUI(remainingMs / 1000, safeSignedInt(roomData.currentPlayer, -1));
  turnTick = setInterval(() => {
    const left = Math.max(0, TURN_LIMIT_MS - (Date.now() - baseStartMs));
    setTurnTimerUI(left / 1000, safeSignedInt(roomData.currentPlayer, -1));
  }, 250);
  turnTimer = setTimeout(() => {
    setTurnTimerUI(0, safeSignedInt(roomData.currentPlayer, -1));
    void pingPresence();
  }, remainingMs);
}

function getDuelPartida() {
  return window.Domino?.Partida || null;
}

function getDuelStockTileIds() {
  const partida = getDuelPartida();
  return Array.isArray(partida?.DuelStockTileIds) ? partida.DuelStockTileIds.slice() : [];
}

function canOpenLotModal() {
  return Boolean(currentRoomData && String(currentRoomData.status || "") === "playing" && getDuelPartida());
}

function canCurrentPlayerDrawFromLot() {
  const partida = getDuelPartida();
  if (!partida || !currentRoomData || String(currentRoomData.status || "") !== "playing") return false;
  if (safeSignedInt(currentRoomData.currentPlayer, -1) !== currentSeatIndex) return false;
  if (typeof partida.EsTurnoHumanoLocal === "function" && partida.EsTurnoHumanoLocal() !== true) return false;
  if (!Array.isArray(partida.DuelStockTileIds) || partida.DuelStockTileIds.length <= 0) return false;
  let legalMoves = [];
  if (typeof partida.PosibilidadesJugador === "function") {
    try {
      legalMoves = partida.PosibilidadesJugador(currentSeatIndex);
    } catch (error) {
      console.warn("[DUEL_V2] canCurrentPlayerDrawFromLot skipped before board edges were ready.", error);
      return false;
    }
  }
  return !Array.isArray(legalMoves) || legalMoves.length === 0;
}

function clearLotSceneTiles() {
  if (!duelLotScene || !Array.isArray(duelLotTileEntries) || duelLotTileEntries.length === 0) return;
  duelLotTileEntries.forEach((entry) => {
    if (entry?.root && duelLotScene) duelLotScene.remove(entry.root);
  });
  duelLotTileEntries = [];
}

function ensureLotScene() {
  const viewport = $("DuelLotViewport");
  if (!viewport || typeof window.THREE === "undefined" || typeof window.Domino_Ficha !== "function") return false;
  duelLotViewport = viewport;

  if (!duelLotRenderer) {
    duelLotRenderer = new window.THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    duelLotRenderer.setClearColor(0x000000, 0);
    duelLotRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    viewport.appendChild(duelLotRenderer.domElement);
  }

  if (!duelLotScene) duelLotScene = new window.THREE.Scene();
  if (!duelLotCamera) {
    duelLotCamera = new window.THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 40);
    duelLotCamera.position.set(0, 14, 0.001);
    duelLotCamera.up.set(0, 0, -1);
    duelLotCamera.lookAt(0, 0, 0);
  }

  if (!duelLotLightsReady) {
    duelLotScene.add(new window.THREE.AmbientLight(0xffffff, 1.25));
    duelLotLightsReady = true;
  }

  if (!duelLotRaycaster) duelLotRaycaster = new window.THREE.Raycaster();
  if (!duelLotPointer) duelLotPointer = new window.THREE.Vector2();
  return true;
}

function layoutLotCamera(tileCount) {
  if (!duelLotCamera || !duelLotViewport || !duelLotRenderer) return;
  const rect = duelLotViewport.getBoundingClientRect();
  const width = Math.max(1, rect.width || 1);
  const height = Math.max(1, rect.height || 1);
  const aspect = width / height;
  const columns = Math.min(DUEL_LOT_COLUMNS, Math.max(1, tileCount));
  const rows = tileCount > DUEL_LOT_COLUMNS ? 2 : 1;
  const contentWidth = Math.max(8.6, columns * DUEL_LOT_TILE_WIDTH + Math.max(0, columns - 1) * DUEL_LOT_GAP_X);
  const contentHeight = Math.max(5.1, rows * DUEL_LOT_TILE_HEIGHT + Math.max(0, rows - 1) * DUEL_LOT_GAP_Z);
  const halfHeight = Math.max(contentHeight / 2, (contentWidth / 2) / Math.max(0.65, aspect)) + 0.55;
  const halfWidth = halfHeight * aspect;
  duelLotCamera.left = -halfWidth;
  duelLotCamera.right = halfWidth;
  duelLotCamera.top = halfHeight;
  duelLotCamera.bottom = -halfHeight;
  duelLotCamera.updateProjectionMatrix();
  duelLotRenderer.setSize(width, height, false);
}

function renderLotScene() {
  if (!duelLotRenderer || !duelLotScene || !duelLotCamera) return;
  duelLotRenderer.render(duelLotScene, duelLotCamera);
}

function getLotTileSelectionFromPointer(event) {
  if (!duelLotViewport || !duelLotCamera || !duelLotRaycaster) return null;
  const rect = duelLotViewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  duelLotPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  duelLotPointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  duelLotRaycaster.setFromCamera(duelLotPointer, duelLotCamera);
  const hits = duelLotRaycaster.intersectObjects(duelLotTileEntries.map((entry) => entry.root).filter(Boolean), true);
  const hit = hits.find((item) => safeSignedInt(item?.object?.userData?.lotTileId, -1) >= 0);
  if (!hit) return null;
  return {
    tileId: safeSignedInt(hit.object.userData.lotTileId, -1),
    slotIndex: safeSignedInt(hit.object.userData.lotSlotIndex, -1),
  };
}

function teardownLotScene() {
  clearLotSceneTiles();
  if (duelLotRenderer?.domElement?.parentNode) {
    duelLotRenderer.domElement.parentNode.removeChild(duelLotRenderer.domElement);
  }
  duelLotScene = null;
  duelLotCamera = null;
  duelLotRenderer = null;
  duelLotViewport = null;
  duelLotLightsReady = false;
  duelLotRaycaster = null;
  duelLotPointer = null;
}

function syncLotScene() {
  const emptyEl = $("DuelLotEmpty");
  if (!ensureLotScene()) {
    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent = "Lot la pa disponib pou kounye a.";
    }
    return;
  }

  const stockPile = getDuelStockTileIds();
  clearLotSceneTiles();
  if (emptyEl) {
    emptyEl.style.display = stockPile.length > 0 ? "none" : "flex";
    emptyEl.textContent = stockPile.length > 0 ? "" : "Lot la vid.";
  }

  if (stockPile.length <= 0) {
    layoutLotCamera(1);
    renderLotScene();
    return;
  }

  stockPile.forEach((tileId, index) => {
    const tile = new window.Domino_Ficha();
    tile.Crear(tileId);
    tile.Ficha.rotation.set(Math.PI / 2, 0, 0);
    if (tile.Base?.material?.clone) {
      const matteBack = tile.Base.material.clone();
      if (typeof matteBack.color?.setHex === "function") matteBack.color.setHex(0x050505);
      if (typeof matteBack.specular?.setHex === "function") matteBack.specular.setHex(0x000000);
      matteBack.shininess = 0;
      tile.Base.material = matteBack;
    }
    if (tile.Cara1) tile.Cara1.visible = false;
    if (tile.Cara2) tile.Cara2.visible = false;
    if (tile.Textura1) tile.Textura1.visible = false;
    if (tile.Textura2) tile.Textura2.visible = false;
    if (tile.Bola) tile.Bola.visible = false;

    const tileWrap = new window.THREE.Group();
    tileWrap.add(tile.Ficha);
    tileWrap.rotation.y = Math.PI / 2;
    const col = index % DUEL_LOT_COLUMNS;
    const row = Math.floor(index / DUEL_LOT_COLUMNS);
    const columnsInRow = Math.min(DUEL_LOT_COLUMNS, stockPile.length - row * DUEL_LOT_COLUMNS);
    tileWrap.position.set(
      (col - ((columnsInRow - 1) / 2)) * (DUEL_LOT_TILE_WIDTH + DUEL_LOT_GAP_X),
      0,
      (row - 0.5) * (DUEL_LOT_TILE_HEIGHT + DUEL_LOT_GAP_Z),
    );
    tileWrap.scale.set(DUEL_LOT_TILE_SCALE, DUEL_LOT_TILE_SCALE, DUEL_LOT_TILE_SCALE);
    tileWrap.traverse((node) => {
      node.userData = { ...(node.userData || {}), lotTileId: tileId, lotSlotIndex: index };
    });
    duelLotScene.add(tileWrap);
    duelLotTileEntries.push({ tileId, slotIndex: index, root: tileWrap });
  });

  layoutLotCamera(stockPile.length);
  renderLotScene();
}

function setLotModalOpen(open) {
  lotModalOpen = open === true;
  syncLotUi();
}

function syncLotUi() {
  const btn = $("LotModalOpenBtn");
  const callout = $("LotModalCallout");
  const countEl = $("LotModalCount");
  const overlay = $("DuelLotModal");
  const hint = $("DuelLotHint");
  const stockCount = getDuelStockTileIds().length;
  const canOpen = canOpenLotModal();
  const drawAllowed = canCurrentPlayerDrawFromLot();
  const shouldGuideToLot = drawAllowed && canOpen && !lotModalOpen;

  if (btn) {
    btn.disabled = !canOpen;
    btn.classList.toggle("opacity-50", btn.disabled);
    btn.classList.toggle("pointer-events-none", btn.disabled);
    btn.classList.toggle("duel-lot-cta", shouldGuideToLot);
    btn.setAttribute("aria-label", drawAllowed ? "Ouvri lot la pou piocher" : "Ouvrir le lot");
    btn.title = drawAllowed ? "Ou pa gen domino pou jwe. Klike sou Lot pou piocher." : "Lot";
  }
  if (callout) {
    callout.classList.toggle("hidden", !shouldGuideToLot);
    callout.classList.toggle("duel-lot-cta-visible", shouldGuideToLot);
  }
  if (countEl) countEl.textContent = String(stockCount);
  if (hint) {
    hint.textContent = stockCount <= 0
      ? "Lot la vid."
      : drawAllowed
        ? "Ou pa gen domino pou jwe. Chwazi yon domino nan lot la pou piocher."
        : "Ou ka gade lot la, men ou ka piocher selman le se tou pa ou epi ou pa gen okenn domino pou jwe.";
  }
  if (overlay) {
    const shouldShow = lotModalOpen && canOpen;
    overlay.classList.toggle("hidden", !shouldShow);
    overlay.classList.toggle("flex", shouldShow);
    if (shouldShow) window.requestAnimationFrame(() => syncLotScene());
  }
}

function promptLotDraw() {
  syncLotUi();
  const btn = $("LotModalOpenBtn");
  if (canCurrentPlayerDrawFromLot() && btn) {
    btn.focus({ preventScroll: true });
  }
}

function parseHumanSeats(seats = {}) {
  const out = [];
  Object.keys(seats || {}).forEach((uid) => {
    const seat = safeSignedInt(seats[uid], -1);
    if (seat >= 0 && seat < 2) out.push(seat);
  });
  return out.sort((a, b) => a - b);
}

function syncGameSessionFromRoom(roomData) {
  if (!roomData) return;
  const seats = roomData.seats && typeof roomData.seats === "object" ? roomData.seats : {};
  const humanSeats = parseHumanSeats(seats);
  const hostSeat = typeof seats[roomData.ownerUid] === "number" ? safeInt(seats[roomData.ownerUid], 0) : 0;

  window.GameSession = {
    mode: "duel_2p",
    roomId: currentRoomId,
    seatIndex: currentSeatIndex,
    hostSeat,
    isHost: currentSeatIndex === hostSeat,
    playerUids: Array.isArray(roomData.playerUids) ? roomData.playerUids.slice(0, 2) : ["", ""],
    playerNames: Array.isArray(roomData.playerNames) ? roomData.playerNames.slice(0, 2) : ["", ""],
    humanSeats,
    humans: safeInt(roomData.humanCount, humanSeats.length || 1),
    bots: safeInt(roomData.botCount, 0),
    status: String(roomData.status || ""),
    startRevealPending: false,
    currentPlayer: safeInt(roomData.currentPlayer, 0),
    openingSeat: safeSignedInt(roomData.openingSeat, -1),
    openingTileId: safeSignedInt(roomData.openingTileId, -1),
    openingReason: String(roomData.openingReason || "").trim(),
    turnActual: safeInt(roomData.turnActual, 0),
    lastActionSeq: safeSignedInt(roomData.lastActionSeq, -1),
    entryCostDoes: 0,
    rewardAmountDoes: 0,
    startedAtMs: safeSignedInt(roomData.startedAtMs, 0),
    deckOrder: Array.isArray(duelDeckOrder) ? duelDeckOrder.slice(0, 28) : [],
  };

  renderPlayerNames(roomData);
  if (window.Domino?.Partida && typeof window.Domino.Partida.PrepararSesion === "function") {
    window.Domino.Partida.PrepararSesion();
  }
}

function prepareDuelFriendRematchStart() {
  friendRematchPending = false;
  hideEndedOverlay();
  clearTurnTimer();
  stopWaitingCycle();
  waitDeadlineMs = 0;
  roomWaitingDeadlineMs = 0;
  if (actionsUnsub) {
    actionsUnsub();
    actionsUnsub = null;
  }
  currentActions = [];
  duelDeckOrder = [];
  gameLaunched = false;
  actionsReady = false;
  window.GameSession = null;
  setLeaveRoomButtonVisible(true);
  setMatchLoading(true, "Nouvo won Domino a ap pare...");
}

function setGameEndReplayCtaVisible(visible = false) {
  const goBtn = $("GameEndGoBtn");
  if (!goBtn) return;
  goBtn.textContent = currentRoomMode === "duel_v2_friends" ? "Mande revanj" : "Rejouer";
  goBtn.classList.toggle("hidden", visible !== true);
}

function hideEndedOverlay(options = {}) {
  const overlay = $("GameEndOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  }
  setGameEndReplayCtaVisible(options?.keepReplayCta === true);
}

function showEndedOverlay() {
  const overlay = $("GameEndOverlay");
  const winnerText = $("GameEndWinnerText");
  const infoText = $("GameEndInfoText");
  const replayBtn = $("GameEndReplayBtn");
  const backBtn = $("GameEndBackBtn");
  const viewBtn = $("GameEndViewTableBtn");
  const actionsWrap = $("GameEndActionsWrap");
  if (!overlay || !currentRoomData) return;
  const winnerSeat = safeSignedInt(currentRoomData.winnerSeat, -1);
  const isWinner = winnerSeat >= 0 && winnerSeat === currentSeatIndex;
  const reason = String(currentRoomData.endedReason || "").trim();
  const title = overlay.querySelector("h2");
  const isFriendRoom = currentRoomMode === "duel_v2_friends";
  const replayLabel = isFriendRoom ? "Mande revanj" : "Rejouer nan gran chanm";
  if (title) title.textContent = "Partie terminee";
  if (winnerText) {
    if (reason === "quit_refund_before_opening" || reason === "timeout_refund") {
      winnerText.textContent = "Psonn pa pedi";
    } else if (winnerSeat < 0) {
      winnerText.textContent = "Match fini";
    } else {
      winnerText.textContent = isWinner ? "Ou genyen" : "Ou pedi";
    }
  }
  if (infoText) {
    let message = "";
    if (reason === "quit_refund_before_opening") {
      message = "Lot jw a kite parti a anvan duel la te louvri tout bon. Pesonn pa pedi miz la.";
    } else if (reason === "timeout_refund") {
      message = "Tan an fini anvan chak jw te gentan antre tout bon nan duel la. Pesonn pa pedi miz la.";
    } else if (reason === "quit") {
      message = isWinner ? "Lot jw a kite parti a." : "Ou kite parti a.";
    } else if (reason === "timeout") {
      message = isWinner ? "Lot jw a kite tan li fini." : "Tan pa ou fini.";
    } else if (reason === "block") {
      message = "Parti a fini sou blokaj.";
    } else {
      message = "Parti a fini.";
    }
    infoText.textContent = `${message} ${isFriendRoom ? "Ou ka mande revanj nan menm salon an." : "Ou ka rejouer nan gran chanm nan tout suite."}`;
  }
  if (replayBtn) replayBtn.textContent = replayLabel;
  if (backBtn) backBtn.textContent = "Retour accueil";
  if (viewBtn) viewBtn.textContent = "Voir la table seulement";
  if (actionsWrap) {
    actionsWrap.classList.remove("hidden");
    actionsWrap.classList.add("grid");
  }
  setGameEndReplayCtaVisible(false);
  overlay.classList.remove("hidden");
  overlay.classList.add("flex");
}

function maybeFinishInitialHydration(snapshot) {
  const partida = window.Domino?.Partida || null;
  if (!partida || typeof partida.AplicarAccionMultijugador !== "function") return;
  if (typeof partida.HayAnimacionInicioActiva === "function" && partida.HayAnimacionInicioActiva() === true) {
    window.setTimeout(() => maybeFinishInitialHydration(snapshot), 120);
    return;
  }
  snapshot.docs.forEach((docSnap) => {
    const action = docSnap.data();
    if (typeof action?.seq !== "number") return;
    partida.AplicarAccionMultijugador(action);
  });
  if (typeof partida.FinalizarRehidratacion === "function") {
    partida.FinalizarRehidratacion();
  }
  actionsReady = true;
  if (currentRoomData?.startRevealPending !== true) {
    setMatchLoading(false);
  }
}

function watchActions(roomId) {
  if (actionsUnsub) actionsUnsub();
  actionsReady = false;
  const actionsQuery = query(collection(db, DUEL_V2_ROOMS, roomId, "actions"), orderBy("seq", "asc"));
  let firstSnapshot = true;
  actionsUnsub = onSnapshot(
    actionsQuery,
    (snapshot) => {
      currentActions = snapshot.docs.map((docSnap) => ({ ...docSnap.data() }));
      if (!gameLaunched || !window.Domino?.Partida || typeof window.Domino.Partida.AplicarAccionMultijugador !== "function") {
        actionsReady = true;
        if (currentRoomData && String(currentRoomData.status || "") === "playing") scheduleTurnTimeout(currentRoomData);
        return;
      }

      if (firstSnapshot) {
        firstSnapshot = false;
        if (typeof window.Domino.Partida.IniciarRehidratacion === "function") {
          window.Domino.Partida.IniciarRehidratacion();
        }
        if (typeof window.Domino.Partida.Empezar === "function") {
          window.Domino.Partida.Empezar();
        }
        maybeFinishInitialHydration(snapshot);
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type !== "added") return;
        const action = change.doc.data();
        if (typeof action?.seq !== "number") return;
        window.Domino.Partida.AplicarAccionMultijugador(action);
      });
      actionsReady = true;
      if (currentRoomData && String(currentRoomData.status || "") === "playing") {
        scheduleTurnTimeout(currentRoomData);
      }
      syncLotUi();
      setMatchLoading(false);
    },
    () => {
      setStatus("Nou pa rive li aksyon yo.");
    }
  );
}

function launchLocalGame(roomData) {
  syncGameSessionFromRoom(roomData);
  if (!Array.isArray(duelDeckOrder) || duelDeckOrder.length !== 28) {
    setMatchLoading(true, "Preparasyon duel la...");
    return;
  }
  if (!isDominoEngineReady()) {
    setMatchLoading(true, "Inisyalizasyon duel la...");
    window.setTimeout(() => {
      if (currentRoomId && currentRoomData && String(currentRoomData.status || "") === "playing") {
        launchLocalGame(currentRoomData);
      }
    }, 120);
    return;
  }
  if (gameLaunched) {
    setMatchLoading(false);
    if (window.UI && typeof window.UI.ActualizarBotonLucesJugadores === "function") {
      window.UI.ActualizarBotonLucesJugadores();
    }
    syncLotUi();
    return;
  }
  gameLaunched = true;
  setLeaveRoomButtonVisible(true);
  setMatchLoading(true, "Senkronizasyon duel la...");
  if (window.UI && typeof window.UI.ActualizarBotonLucesJugadores === "function") {
    window.UI.ActualizarBotonLucesJugadores();
  }
  syncLotUi();
  setMatchLoading(false);
  watchActions(currentRoomId);
}

async function refreshFullRoomState() {
  if (!currentRoomId) return null;
  const room = await getDuelV2RoomStateSecure({ roomId: currentRoomId });
  if (Array.isArray(room?.privateDeckOrder) && room.privateDeckOrder.length === 28) {
    duelDeckOrder = room.privateDeckOrder.slice(0, 28);
  }
  syncLocalRoomMetaFromState(room || {});
  return room;
}

function watchRoom(roomId) {
  if (roomUnsub) roomUnsub();
  startPresenceHeartbeat();
  roomUnsub = onSnapshot(
    doc(db, DUEL_V2_ROOMS, roomId),
    async (snapshot) => {
      if (!snapshot.exists()) {
        renderWaitingError("Sal duel sa a pa egziste ankò.", {
          showRetry: false,
          showGroup: false,
          showHome: true,
        });
        return;
      }
      const previousStatus = String(currentRoomData?.status || "").trim().toLowerCase();
      currentRoomData = snapshot.data() || {};
      syncActiveStakeFromRoomData(currentRoomData);
      syncLocalRoomMetaFromState({ roomId, ...currentRoomData });
      renderPlayerNames(currentRoomData);
      if (currentUser?.uid) {
        const nextSeat = currentRoomData?.seats?.[currentUser.uid];
        if (typeof nextSeat === "number") currentSeatIndex = nextSeat;
      }

      const status = String(currentRoomData.status || "").trim().toLowerCase();
      if (status !== "ended") {
        friendRematchPending = false;
      }
      refreshOrientationGuardState();
      if (status === "waiting") {
        if (isRoomActivelyPlaying(currentRoomData)) {
          stopWaitingCycle();
          waitDeadlineMs = 0;
          roomWaitingDeadlineMs = 0;
          setMatchLoading(false);
          return;
        }
        publicBotTransitionRunning = false;
        setLotModalOpen(false);
        hideEndedOverlay();
        setLeaveRoomButtonVisible(true);
        clearTurnTimer();
        roomWaitingDeadlineMs = safeSignedInt(currentRoomData?.waitingDeadlineMs, roomWaitingDeadlineMs);
        startWaitingWindow(roomWaitingDeadlineMs);
      } else if (status === "playing") {
        const isRestartAfterEnded = previousStatus === "ended";
        stopWaitingCycle();
        waitDeadlineMs = 0;
        roomWaitingDeadlineMs = 0;
        hideEndedOverlay();
        if (isRestartAfterEnded) {
          prepareDuelFriendRematchStart();
        }
        await refreshFullRoomState();
        if (isRestartAfterEnded) {
          await refreshWallet();
        }
        launchLocalGame(currentRoomData);
        setMatchLoading(false);
        if (actionsReady) {
          scheduleTurnTimeout(currentRoomData);
        }
        syncLotUi();
      } else if (status === "ended") {
        setLotModalOpen(false);
        stopWaitingCycle();
        waitDeadlineMs = 0;
        roomWaitingDeadlineMs = 0;
        await refreshFullRoomState();
        if (shouldHoldFriendRematch(currentRoomData)) {
          clearTurnTimer();
          hideEndedOverlay();
          openFriendRematchWaitingState();
          return;
        }
        setMatchLoading(false);
        setLeaveRoomButtonVisible(false);
        clearTurnTimer();
        showEndedOverlay();
        await refreshWallet();
      }
    },
    () => {
      renderWaitingError("Nou pa ka swiv sal duel la.", {
        showRetry: false,
        showGroup: false,
        showHome: true,
      });
    }
  );
}

async function joinPublicRoom() {
  if (!currentUser?.uid || joining) return;
  joining = true;
  setMatchLoading(true, "Koneksyon jwè yo an kou.");
  try {
    activeStakeHtg = PUBLIC_DUEL_STAKE_HTG;
    currentRoomMode = "duel_v2_public";
    const result = await joinMatchmakingDuelV2Secure({ stakeHtg: PUBLIC_DUEL_STAKE_HTG });
    if (Array.isArray(result?.privateDeckOrder) && result.privateDeckOrder.length === 28) {
      duelDeckOrder = result.privateDeckOrder.slice(0, 28);
    }
    syncLocalRoomMetaFromState(result || {});
    friendRematchPending = false;
    setStatus(result?.status === "waiting" ? `Sal la kreye. Pozisyon ${currentSeatIndex + 1}/2.` : `Duel la pare. Pozisyon ${currentSeatIndex + 1}/2.`);
    if (String(result?.status || "") === "waiting") {
      waitDeadlineMs = 0;
      startWaitingWindow(roomWaitingDeadlineMs);
    }
    watchRoom(currentRoomId);
    await refreshFullRoomState();
  } catch (error) {
    renderWaitingError(error?.message || "Nou pa rive lanse duel la.", {
      showRetry: true,
      retryLabel: "Eseye ankò",
      showGroup: false,
      showHome: true,
    });
  } finally {
    joining = false;
  }
}

function clearRoomSubscriptions() {
  if (roomUnsub) {
    roomUnsub();
    roomUnsub = null;
  }
  if (actionsUnsub) {
    actionsUnsub();
    actionsUnsub = null;
  }
}

function stopPresenceHeartbeat() {
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
}

async function leaveCurrentRoom(reason = "manual") {
  clearTurnTimer();
  stopWaitingCycle();
  waitDeadlineMs = 0;
  roomWaitingDeadlineMs = 0;
  stopPresenceHeartbeat();
  clearRoomSubscriptions();
  const roomId = currentRoomId;
  currentRoomId = "";
  currentRoomData = null;
  currentSeatIndex = -1;
  currentRoomMode = "duel_v2_public";
  currentInviteCode = "";
  friendFlowAction = "";
  requestedFriendRoomId = "";
  friendRematchPending = false;
  activeStakeHtg = PUBLIC_DUEL_STAKE_HTG;
  currentActions = [];
  duelDeckOrder = [];
  gameLaunched = false;
  actionsReady = false;
  publicBotTransitionRunning = false;
  lotModalOpen = false;
  lotActionSending = false;
  teardownLotScene();
  setFriendJoinStatus("");
  closeOverlay("DuelFriendShareOverlay");
  closeOverlay("DuelFriendJoinOverlay");
  hideEndedOverlay();
  setLeaveRoomButtonVisible(false);
  window.GameSession = null;
  syncRoomUrl();
  if (roomId) {
    try {
      await leaveRoomDuelV2Secure({ roomId, reason });
    } catch (_) {}
  }
  await refreshWallet();
}


async function pushAction(action) {
  if (!currentRoomId) throw new Error("Aucune salle duel active.");
  await submitActionDuelV2Secure({
    roomId: currentRoomId,
    clientActionId: `duelv2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    action,
  });
}

async function sendDrawMove(tileId = -1) {
  if (!currentRoomId || lotActionSending) return;
  lotActionSending = true;
  syncLotUi();
  try {
    await pushAction({
      type: "draw",
      tileId: safeSignedInt(tileId, -1),
    });
    setStatus("Pioche envoyee. N ap mete lot la ajou...");
  } catch (error) {
    console.error("[DUEL] draw failed", error);
    setStatus(error?.message || "Nou pa rive piocher nan lot la.");
  } finally {
    lotActionSending = false;
    syncLotUi();
  }
}

function onGameEnded() {
  setStatus("Fen duel la...");
}

async function pingPresence() {
  if (!currentRoomId) return;
  try {
    const room = await touchRoomPresenceDuelV2Secure({ roomId: currentRoomId });
    syncLocalRoomMetaFromState(room || {});
    renderPlayerNames(currentRoomData);
    if (room && Array.isArray(room.privateDeckOrder) && room.privateDeckOrder.length === 28) {
      duelDeckOrder = room.privateDeckOrder.slice(0, 28);
    }
    renderWallet();
    if (!isRoomActivelyPlaying() && String(currentRoomData?.status || "") === "waiting") {
      roomWaitingDeadlineMs = safeSignedInt(currentRoomData?.waitingDeadlineMs, roomWaitingDeadlineMs);
      renderWaitingSearch();
    }
    if (String(currentRoomData?.status || "") === "ended") {
      stopWaitingCycle();
      clearTurnTimer();
      if (shouldHoldFriendRematch(currentRoomData)) {
        hideEndedOverlay();
        openFriendRematchWaitingState();
      } else {
        showEndedOverlay();
      }
    }
  } catch (_) {}
}

function startPresenceHeartbeat() {
  stopPresenceHeartbeat();
  if (!currentRoomId) return;
  void pingPresence();
  presenceTimer = setInterval(() => { void pingPresence(); }, PRESENCE_PING_MS);
}

async function requestFriendRematch() {
  if (!currentRoomId || friendRematchBusy) return;
  friendRematchBusy = true;
  try {
    const result = await requestFriendDuelRematchV2Secure({ roomId: currentRoomId });
    syncLocalRoomMetaFromState({
      ...(currentRoomData || {}),
      ...(result || {}),
      roomId: currentRoomId,
      status: "ended",
    });
    if (result?.started === true) {
      friendRematchPending = false;
      openFriendRematchWaitingState(
        "Nouvo won",
        "Tou de jw yo dakò. N ap relanse duel prive a nan menm salon an..."
      );
      await refreshWallet();
    } else {
      friendRematchPending = true;
      openFriendRematchWaitingState();
    }
  } catch (error) {
    renderWaitingError(error?.message || "Nou pa rive relanse revanj prive Domino a.", {
      showRetry: false,
      showGroup: false,
      showHome: true,
    });
  } finally {
    friendRematchBusy = false;
  }
}

async function replayFromGameEnd() {
  setGameEndReplayCtaVisible(false);
  if (currentRoomMode === "duel_v2_friends" && currentRoomId) {
    void requestFriendRematch();
    return;
  }
  await leaveCurrentRoom("replay");
  window.location.href = "./jeu-duel-v2.html?entry=public";
}

function bindButtons() {
  if (searchCopyCodeBtn) {
    searchCopyCodeBtn.addEventListener("click", async () => {
      const copied = await copyText(currentInviteCode);
      searchCopyCodeBtn.textContent = copied ? "Kod la kopye" : "Kopye kod la";
      window.setTimeout(() => {
        searchCopyCodeBtn.textContent = "Kopye kod la";
      }, 1400);
    });
  }
  const friendCopyBtn = $("DuelFriendCopyBtn");
  if (friendCopyBtn) {
    friendCopyBtn.addEventListener("click", async () => {
      const copied = await copyText(currentInviteCode);
      friendCopyBtn.textContent = copied ? "Kod la kopye" : "Kopye kod la";
      window.setTimeout(() => {
        friendCopyBtn.textContent = "Kopye kod la";
      }, 1400);
    });
  }
  const friendContinueBtn = $("DuelFriendContinueBtn");
  if (friendContinueBtn) {
    friendContinueBtn.addEventListener("click", async () => {
      closeOverlay("DuelFriendShareOverlay");
      startWaitingWindow(roomWaitingDeadlineMs);
      watchRoom(currentRoomId);
      await refreshFullRoomState();
    });
  }
  const friendJoinBackBtn = $("DuelFriendJoinBackBtn");
  if (friendJoinBackBtn) {
    friendJoinBackBtn.addEventListener("click", () => {
      closeOverlay("DuelFriendJoinOverlay");
      goHome();
    });
  }
  const friendJoinSubmitBtn = $("DuelFriendJoinSubmitBtn");
  if (friendJoinSubmitBtn) {
    friendJoinSubmitBtn.addEventListener("click", () => {
      void joinFriendRoomByCode();
    });
  }
  const turnWarningContinueBtn = $("DuelTurnWarningContinueBtn");
  if (turnWarningContinueBtn) {
    turnWarningContinueBtn.addEventListener("click", () => {
      duelTurnWarningAccepted = true;
      closeOverlay("DuelTurnWarningOverlay");
      continueDuelPrelaunchFlow();
    });
  }
  const turnWarningHomeBtn = $("DuelTurnWarningHomeBtn");
  if (turnWarningHomeBtn) {
    turnWarningHomeBtn.addEventListener("click", () => {
      goHome();
    });
  }
  const branchChoiceGuideContinueBtn = $("DuelBranchChoiceGuideContinueBtn");
  if (branchChoiceGuideContinueBtn) {
    branchChoiceGuideContinueBtn.addEventListener("click", () => {
      duelBranchChoiceGuideAccepted = true;
      closeOverlay("DuelBranchChoiceGuideOverlay");
      continueDuelPrelaunchFlow();
    });
  }
  const branchChoiceGuideHomeBtn = $("DuelBranchChoiceGuideHomeBtn");
  if (branchChoiceGuideHomeBtn) {
    branchChoiceGuideHomeBtn.addEventListener("click", () => {
      goHome();
    });
  }

  const waitingRetryBtn = $("MatchLoadingRetryBtn");
  if (waitingRetryBtn) {
    waitingRetryBtn.addEventListener("click", async () => {
      if (!currentRoomId) {
        void joinPublicRoom();
        return;
      }
      if (currentRoomMode === "duel_v2_friends") {
        await leaveCurrentRoom("friend-expired-retry");
        goHome();
        return;
      }
      waitDeadlineMs = Date.now() + (WAIT_SECONDS * 1000);
      renderWaitingSearch();
    });
  }

  const waitingGroupBtn = $("MatchLoadingGroupBtn");
  if (waitingGroupBtn) {
    waitingGroupBtn.addEventListener("click", () => {
      window.open(WHATSAPP_GROUP_URL, "_blank", "noopener,noreferrer");
    });
  }

  const waitingHomeBtn = $("MatchLoadingHomeBtn");
  if (waitingHomeBtn) {
    waitingHomeBtn.addEventListener("click", async () => {
      await leaveCurrentRoom("waiting-home");
      window.location.href = "./index.html?view=public";
    });
  }

  const backBtn = $("GameEndBackBtn");
  if (backBtn) {
    backBtn.addEventListener("click", async () => {
      await leaveCurrentRoom("end-back");
      window.location.href = "./index.html?view=public";
    });
  }
  const replayBtn = $("GameEndReplayBtn");
  if (replayBtn) {
    replayBtn.addEventListener("click", async () => {
      await replayFromGameEnd();
    });
  }
  const viewBtn = $("GameEndViewTableBtn");
  if (viewBtn) {
    viewBtn.addEventListener("click", () => hideEndedOverlay({ keepReplayCta: true }));
  }
  const goBtn = $("GameEndGoBtn");
  if (goBtn) {
    goBtn.addEventListener("click", async () => {
      await replayFromGameEnd();
    });
  }

  const lotOpenBtn = $("LotModalOpenBtn");
  if (lotOpenBtn && lotOpenBtn.dataset.bound !== "1") {
    lotOpenBtn.dataset.bound = "1";
    lotOpenBtn.addEventListener("click", () => {
      if (!canOpenLotModal()) return;
      setLotModalOpen(true);
    });
  }

  const lotOverlay = $("DuelLotModal");
  if (lotOverlay && lotOverlay.dataset.bound !== "1") {
    lotOverlay.dataset.bound = "1";
    lotOverlay.addEventListener("click", (event) => {
      if (event.target === lotOverlay) setLotModalOpen(false);
    });
  }

  const lotViewport = $("DuelLotViewport");
  if (lotViewport && lotViewport.dataset.bound !== "1") {
    lotViewport.dataset.bound = "1";
    lotViewport.addEventListener("click", (event) => {
      const selection = getLotTileSelectionFromPointer(event);
      if (!selection || !canCurrentPlayerDrawFromLot() || lotActionSending) return;
      if (window.Domino?.Partida && typeof window.Domino.Partida.DefinirPosePiocheDepuisModal === "function") {
        window.Domino.Partida.DefinirPosePiocheDepuisModal(selection.slotIndex);
      }
      setLotModalOpen(false);
      void sendDrawMove(selection.tileId);
    });
  }

  if (window.__duelLotResizeBound !== true) {
    window.__duelLotResizeBound = true;
    window.addEventListener("resize", () => {
      if (!lotModalOpen) return;
      window.requestAnimationFrame(() => syncLotScene());
    });
  }
}

window.LogiqueJeu = {
  pushAction,
  onGameEnded,
  leaveRoom: leaveCurrentRoom,
  hasActiveRoom: () => !!currentRoomId,
  getSession: () => window.GameSession || null,
};
window.KobposhDuelPromptLot = promptLotDraw;
window.KobposhDuelSyncLotUi = syncLotUi;

window.addEventListener("pagehide", () => {
  if (currentRoomId && navigator.onLine !== false) {
    leaveRoomDuelV2Secure({ roomId: currentRoomId, reason: "pagehide" }).catch(() => null);
  }
  clearTurnTimer();
  stopWaitingCycle();
  waitDeadlineMs = 0;
  roomWaitingDeadlineMs = 0;
  stopPresenceHeartbeat();
});

window.addEventListener("beforeunload", () => {
  if (currentRoomId && navigator.onLine !== false) {
    leaveRoomDuelV2Secure({ roomId: currentRoomId, reason: "beforeunload" }).catch(() => null);
  }
  clearTurnTimer();
  stopWaitingCycle();
  waitDeadlineMs = 0;
  roomWaitingDeadlineMs = 0;
  stopPresenceHeartbeat();
});

bindButtons();
installDuelBranchChoiceHelpBridge();
setLeaveRoomButtonVisible(false);
hideEndedOverlay();
setMatchLoading(false);
setTurnTimerUI(0, -1);
syncLotUi();
refreshOrientationGuardState();

window.addEventListener("resize", () => {
  refreshOrientationGuardState();
});

window.addEventListener("orientationchange", () => {
  window.setTimeout(() => {
    refreshOrientationGuardState();
  }, 80);
});

function bootRoomFlowForCurrentUser() {
  if (!currentUser || duelBootStarted) return;
  duelBootStarted = true;

  if (currentRoomMode === "duel_v2_friends" && requestedFriendRoomId) {
    void resumeFriendRoomFromUrl();
    return;
  }
  if (currentRoomMode === "duel_v2_friends" && friendFlowAction === "create") {
    void createFriendRoom();
    return;
  }
  if (currentRoomMode === "duel_v2_friends" && friendFlowAction === "join") {
    if (currentInviteCode) {
      void joinFriendRoomByCode(currentInviteCode);
      return;
    }
    openOverlay("DuelFriendJoinOverlay");
    setFriendJoinStatus("Tanpri mete kod salon an.", true);
    return;
  }
  const legacyEntryIntent = getLegacyEntryIntentFromUrl();
  if (legacyEntryIntent === "friend-create" || legacyEntryIntent === "create") {
    currentRoomMode = "duel_v2_friends";
    friendFlowAction = "create";
    syncRoomUrl();
    void createFriendRoom();
    return;
  }
  if (legacyEntryIntent === "friend-join" || legacyEntryIntent === "join") {
    const inviteCode = getInviteCodeFromUrl();
    currentRoomMode = "duel_v2_friends";
    friendFlowAction = "join";
    currentInviteCode = inviteCode;
    syncRoomUrl();
    if (inviteCode) {
      void joinFriendRoomByCode(inviteCode);
      return;
    }
    openOverlay("DuelFriendJoinOverlay");
    setFriendJoinStatus("Tanpri mete kod salon an.", true);
    return;
  }
  void confirmStakeEntryAndJoin();
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;
  if (!currentUser) {
    duelBootStarted = false;
    orientationGuardDeferredAction = null;
    setMatchLoading(false);
    setStatus("Ou dwe konekte pou antre nan duel la.");
    renderWallet();
    refreshOrientationGuardState();
    return;
  }
  await refreshWallet();
  if (guardLandscapeBeforeStart(() => {
    continueDuelPrelaunchFlow();
  })) {
    return;
  }
  continueDuelPrelaunchFlow();
});
