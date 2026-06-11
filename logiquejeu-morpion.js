import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot,
  onAuthStateChanged,
} from "./firebase-init.js";
import {
  getDepositFundingStatusSecure,
  joinMatchmakingMorpionSecure,
  joinMatchmakingMorpionV2Secure,
  resumeFriendMorpionRoomSecure,
  resumeMorpionBotTestRoomSecure,
  createMorpionBotTestRoomSecure,
  ensureRoomReadyMorpionSecure,
  ensureRoomReadyMorpionV2Secure,
  touchRoomPresenceMorpionSecure,
  touchRoomPresenceMorpionV2Secure,
  ackRoomStartSeenMorpionSecure,
  leaveRoomMorpionSecure,
  leaveRoomMorpionV2Secure,
  submitActionMorpionSecure,
  submitActionMorpionV2Secure,
  claimWinRewardMorpionSecure,
  claimWinRewardMorpionV2Secure,
  requestFriendMorpionRematchSecure,
  getMyActiveMorpionInviteSecure,
  respondMorpionPlayInviteSecure,
  getMorpionMatchmakingHintSecure,
  getMyMorpionWhatsappPreferenceSecure,
  saveMorpionWhatsappPreferenceSecure,
  removeMorpionWhatsappPreferenceSecure,
  listRecentMorpionWhatsappContactsSecure,
} from "./secure-functions.js";
import { ensureXchangeState, getXchangeState } from "./xchange.js";

const ALLOWED_MORPION_STAKE_AMOUNTS = Object.freeze([500]);
const MORPION_BOT_TEST_STAKE_DOES = 0;
const MORPION_BOARD_SIZE = 15;
const TURN_LIMIT_SECONDS = 30;
const TURN_LIMIT_MS = TURN_LIMIT_SECONDS * 1000;
const MATCHMAKING_WAIT_SECONDS = 15;
const MATCHMAKING_WAIT_MS = MATCHMAKING_WAIT_SECONDS * 1000;
const MORPION_FRIEND_FIXED_STAKE_DOES = 500;
const PRESENCE_PING_MS = 20 * 1000;
const SITE_PRESENCE_PING_MS = 25 * 1000;
const SITE_PRESENCE_TTL_MS = 70 * 1000;
const INVITE_POLL_MS = 6 * 1000;
const BOT_TURN_NUDGE_COOLDOWN_MS = 4 * 1000;
const TIMEOUT_NUDGE_COOLDOWN_MS = 4 * 1000;
const MORPION_WHATSAPP_GROUP_URL = "https://chat.whatsapp.com/IENi1LH9hn0JWrLfaZwwv1";
const ABANDONED_ROOMS_STORAGE_KEY = "domino_morpion_abandoned_rooms_v1";
const MORPION_BOT_NUMERIC_IDS = Object.freeze([35601379, 40507232, 41752992]);

const URL_PARAMS = new URLSearchParams(window.location.search);
const REQUESTED_MORPION_ENGINE = String(URL_PARAMS.get("engine") || "v1").trim().toLowerCase();
const MORPION_USE_V2 = REQUESTED_MORPION_ENGINE === "v2";
const MORPION_ROOMS = MORPION_USE_V2 ? "morpionRoomsV2" : "morpionRooms";
const MORPION_GAME_STATES = MORPION_USE_V2 ? "morpionGameStatesV2" : "morpionGameStates";
const parsedRequestedStake = Number.parseInt(String(URL_PARAMS.get("stake") ?? 500), 10);
const requestedStake = Number.isFinite(parsedRequestedStake) ? parsedRequestedStake : 500;
const requestedRoomMode = String(URL_PARAMS.get("roomMode") || "").trim();
const requestedLocalBotFlag = String(URL_PARAMS.get("localBot") || "").trim();
const REQUESTED_FUNDING_CURRENCY = String(URL_PARAMS.get("fundingCurrency") || "htg").trim().toLowerCase() === "htg"
  ? "htg"
  : "does";
const joinMatchmakingMorpionCallable = MORPION_USE_V2 ? joinMatchmakingMorpionV2Secure : joinMatchmakingMorpionSecure;
const ensureRoomReadyMorpionCallable = MORPION_USE_V2 ? ensureRoomReadyMorpionV2Secure : ensureRoomReadyMorpionSecure;
const touchRoomPresenceMorpionCallable = MORPION_USE_V2 ? touchRoomPresenceMorpionV2Secure : touchRoomPresenceMorpionSecure;
const leaveRoomMorpionCallable = MORPION_USE_V2 ? leaveRoomMorpionV2Secure : leaveRoomMorpionSecure;
const submitActionMorpionCallable = MORPION_USE_V2 ? submitActionMorpionV2Secure : submitActionMorpionSecure;
const claimWinRewardMorpionCallable = MORPION_USE_V2 ? claimWinRewardMorpionV2Secure : claimWinRewardMorpionSecure;

async function ackRoomStartSeenMorpionCallable(payload = {}) {
  if (MORPION_USE_V2) {
    return { ok: true, pending: false, released: false, skipped: true, engineVersion: 2 };
  }
  return ackRoomStartSeenMorpionSecure(payload);
}

function buildMorpionBotTestGameUrl(roomId = "", seatIndex = 0) {
  const params = new URLSearchParams();
  params.set("autostart", "1");
  params.set("stake", String(MORPION_BOT_TEST_STAKE_DOES));
  const safeRoomId = String(roomId || "").trim();
  if (safeRoomId) {
    params.set("botTestMorpionRoomId", safeRoomId);
    params.set("seat", String(Math.max(0, Number.parseInt(String(seatIndex || 0), 10) || 0)));
  }
  params.set("roomMode", "morpion_bot_test");
  return `./morpion.html?${params.toString()}`;
}

function buildPublicMorpionReplayUrl() {
  const params = new URLSearchParams();
  if (MORPION_USE_V2) {
    params.set("engine", "v2");
  }
  if (REQUESTED_FUNDING_CURRENCY === "htg") {
    params.set("fundingCurrency", "htg");
  }
  if (selectedStakeDoes > 0 && selectedStakeDoes !== 500) {
    params.set("stake", String(selectedStakeDoes));
  }
  const query = params.toString();
  return query ? `./morpion.html?${query}` : "./morpion.html";
}

function getFriendMorpionRoomIdFromUrl() {
  return String(URL_PARAMS.get("friendMorpionRoomId") || "").trim();
}

function getBotTestMorpionRoomIdFromUrl() {
  return String(URL_PARAMS.get("botTestMorpionRoomId") || "").trim();
}

function isFriendMorpionFlowFromUrl() {
  return getFriendMorpionRoomIdFromUrl().length > 0;
}

function isBotTestMorpionFlowFromUrl() {
  return getBotTestMorpionRoomIdFromUrl().length > 0 || requestedRoomMode === "morpion_bot_test";
}

function isLocalBotModeEnabled() {
  if (!isBotTestMorpionFlowFromUrl()) return false;
  if (requestedLocalBotFlag === "0") return false;
  return true;
}

const selectedStakeDoes = isFriendMorpionFlowFromUrl()
  ? MORPION_FRIEND_FIXED_STAKE_DOES
  : (isBotTestMorpionFlowFromUrl()
    ? MORPION_BOT_TEST_STAKE_DOES
    : (ALLOWED_MORPION_STAKE_AMOUNTS.includes(requestedStake) ? requestedStake : 500));

const dom = {
  board: document.getElementById("morpionBoard"),
  winLine: null,
  waitingModal: document.getElementById("morpionWaitingModal"),
  inviteModal: document.getElementById("morpionInviteModal"),
  inviteTitle: document.getElementById("morpionInviteTitle"),
  inviteCopy: document.getElementById("morpionInviteCopy"),
  inviteAcceptBtn: document.getElementById("morpionInviteAcceptBtn"),
  inviteRefuseBtn: document.getElementById("morpionInviteRefuseBtn"),
  ruleModal: document.getElementById("morpionRuleModal"),
  ruleContinueBtn: document.getElementById("morpionRuleContinueBtn"),
  waitingTitle: document.getElementById("morpionWaitingTitle"),
  waitingCopy: document.getElementById("morpionWaitingCopy"),
  waitingTimerWrap: document.getElementById("morpionWaitingTimerWrap"),
  waitingTimerValue: document.getElementById("morpionWaitingTimerValue"),
  waitingActions: document.getElementById("morpionWaitingActions"),
  waitingHomeBtn: document.getElementById("morpionWaitingHomeBtn"),
  waitingRetryBtn: document.getElementById("morpionWaitingRetryBtn"),
  waitingExtendBtn: document.getElementById("morpionWaitingExtendBtn"),
  waitingStopExtendBtn: document.getElementById("morpionWaitingStopExtendBtn"),
  waitingNotifyBtn: document.getElementById("morpionWaitingNotifyBtn"),
  waitingGroupBtn: document.getElementById("morpionWaitingGroupBtn"),
  waitingWhatsappBtn: document.getElementById("morpionWaitingWhatsappBtn"),
  waitingContactsBtn: document.getElementById("morpionWaitingContactsBtn"),
  whatsappModal: document.getElementById("morpionWhatsappModal"),
  whatsappInput: document.getElementById("morpionWhatsappInput"),
  whatsappStatus: document.getElementById("morpionWhatsappStatus"),
  whatsappSaveBtn: document.getElementById("morpionWhatsappSaveBtn"),
  whatsappRemoveBtn: document.getElementById("morpionWhatsappRemoveBtn"),
  whatsappCloseBtn: document.getElementById("morpionWhatsappCloseBtn"),
  whatsappSavedWrap: document.getElementById("morpionWhatsappSavedWrap"),
  whatsappSavedValue: document.getElementById("morpionWhatsappSavedValue"),
  whatsappCloseTargets: Array.from(document.querySelectorAll("[data-whatsapp-close]")),
  contactsModal: document.getElementById("morpionContactsModal"),
  contactsList: document.getElementById("morpionContactsList"),
  contactsCloseBtn: document.getElementById("morpionContactsCloseBtn"),
  contactsCloseTargets: Array.from(document.querySelectorAll("[data-contacts-close]")),
  resultModal: document.getElementById("morpionResultModal"),
  resultEyebrow: document.getElementById("morpionResultEyebrow"),
  resultTitle: document.getElementById("morpionResultTitle"),
  resultCopy: document.getElementById("morpionResultCopy"),
  resultReplayBtn: document.getElementById("morpionResultReplayBtn"),
  resultHomeBtn: document.getElementById("morpionResultHomeBtn"),
  quitBtn: document.getElementById("morpionQuitBtn"),
  quitModal: document.getElementById("morpionQuitModal"),
  quitReplayBtn: document.getElementById("morpionQuitReplayBtn"),
  quitHomeBtn: document.getElementById("morpionQuitHomeBtn"),
  quitCloseTargets: Array.from(document.querySelectorAll("[data-quit-close]")),
  revealResultBtn: document.getElementById("morpionRevealResultBtn"),
  opponentCard: document.querySelector('[data-player-side="opponent"]'),
  selfCard: document.querySelector('[data-player-side="self"]'),
  opponentLabel: document.getElementById("morpionOpponentLabel"),
  opponentName: document.getElementById("morpionOpponentName"),
  selfName: document.getElementById("morpionSelfName"),
  walletValue: document.getElementById("morpionWalletValue"),
  opponentSymbol: document.getElementById("morpionOpponentSymbol"),
  selfSymbol: document.getElementById("morpionSelfSymbol"),
  opponentTimerLabel: document.getElementById("morpionOpponentTimerLabel"),
  selfTimerLabel: document.getElementById("morpionSelfTimerLabel"),
  opponentTimerFill: document.getElementById("morpionOpponentTimerFill"),
  selfTimerFill: document.getElementById("morpionSelfTimerFill"),
};

let currentUser = null;
let currentRoomId = "";
let currentRoomData = null;
let currentGameState = null;
let currentSeatIndex = -1;
let roomUnsub = null;
let stateUnsub = null;
let presenceTimer = null;
let sitePresenceTimer = null;
let turnTick = null;
let waitingEnsureTimer = null;
let botTurnNudgeTimer = null;
let turnTimeoutNudgeTimer = null;
let joining = false;
let ensuringRoom = false;
let actionSending = false;
let rewardClaiming = false;
let rewardClaimed = false;
let rematchRequestInFlight = false;
let startRevealAcked = false;
let leavingRoom = false;
let turnTimeoutRequestInFlight = false;
let presencePingInFlight = false;
let sitePresencePingInFlight = false;
let clientUnsub = null;
let currentHtgBalance = null;
let endResultTimer = null;
let lastHandledEndKey = "";
let pendingEndModalPayload = null;
let winLineVisible = false;
let fallbackOpponentAlias = "";
let fallbackOpponentAliasRoomId = "";
let turnRuleAccepted = false;
let invitePollTimer = null;
let invitePollInFlight = false;
let activeInviteId = "";
let friendRematchSyncTimer = null;
let matchmakingWaitDeadlineMs = 0;
let matchmakingWaitRoomId = "";
let matchmakingWaitExpired = false;
let matchmakingExtendedWaiting = false;
let matchmakingHintInFlight = false;
let matchmakingHintRoomId = "";
let matchmakingHintCheckedAtMs = 0;
let matchmakingHintHasOddPlayingHumans = false;
let matchmakingHintMessage = "";
let myWhatsappContact = null;
let recentWhatsappContacts = [];
let whatsappPreferenceLoaded = false;
let sitePresenceWarned = false;
let lastRoomTraceKey = "";
let lastStateTraceKey = "";
let botTurnStallKey = "";
let botTurnStallSinceMs = 0;
let botTurnStallLastReportedMs = 0;
let queuedPresenceReason = "";
let presencePingStartedAtMs = 0;
let lastBotTurnNudgeKey = "";
let lastBotTurnNudgeAtMs = 0;
let lastTimeoutNudgeKey = "";
let lastTimeoutNudgeAtMs = 0;
let localBotMoveTimer = null;
let localTurnTimeoutTimer = null;
let debugJoinFundingPreflight = null;
let debugJoinFundingAfterCharge = null;
let lastMorpionDebugLogKey = "";
let lastMorpionDebugLogAtMs = 0;
const MORPION_DEBUG_ENABLED = false;

const MORPION_DEBUG_ALLOWED_EVENTS = new Set([
  "join:preflight",
  "join:result",
  "join:after-join",
  "end:state",
  "end:balance-snapshot",
  "modal:end:open",
  "leave:start",
  "leave:result",
  "leave:balance-snapshot",
  "nav:abandon:start",
  "nav:abandon:after-leave",
  "nav:abandon:after-leave:delayed",
  "settlement:claim:start",
  "settlement:claim:result",
  "settlement:claim:error",
  "action:submit:end",
  "action:submit:error",
  "leave:error",
]);

const MORPION_DEBUG_ERROR_EVENTS = new Set([
  "settlement:claim:error",
  "action:submit:error",
  "leave:error",
  "presencePingFailed",
  "timeoutNudgeFailed",
]);

function buildMorpionLogPayload(payload = {}) {
  return {
    ts: new Date().toISOString(),
    roomId: currentRoomId || "",
    seat: currentSeatIndex,
    ...payload,
  };
}

function summarizeFundingStatusForDebug(funding = null) {
  if (!funding || typeof funding !== "object") return null;
  return {
    approvedHtgAvailable: safeInt(funding.approvedHtgAvailable, 0),
    provisionalHtgAvailable: safeInt(funding.provisionalHtgAvailable, 0),
    playableHtg: safeInt(funding.playableHtg, 0),
    withdrawableHtg: safeInt(funding.withdrawableHtg, 0),
    nativeGameEntryApprovedHtgTotal: safeInt(funding.nativeGameEntryApprovedHtgTotal, 0),
    nativeGameRewardApprovedHtgTotal: safeInt(funding.nativeGameRewardApprovedHtgTotal, 0),
    pendingWithdrawalPlayHtg: safeInt(funding.pendingWithdrawalPlayHtg, 0),
    approvedDoesBalance: safeInt(funding.approvedDoesBalance, 0),
    doesBalance: safeInt(funding.doesBalance, 0),
    hasRealApprovedDeposit: funding.hasRealApprovedDeposit === true,
    debugLastMorpionRefundMutation: funding.debugLastMorpionRefundMutation && typeof funding.debugLastMorpionRefundMutation === "object"
      ? funding.debugLastMorpionRefundMutation
      : null,
  };
}

async function logFundingSnapshotForDebug(event, payload = {}) {
  let funding = null;
  let fundingError = "";
  try {
    funding = await getDepositFundingStatusSecure({});
  } catch (error) {
    fundingError = error?.message || String(error || "");
  }
  const summary = summarizeFundingStatusForDebug(funding);
  const baselinePre = debugJoinFundingPreflight && typeof debugJoinFundingPreflight === "object" ? debugJoinFundingPreflight : null;
  const baselinePost = debugJoinFundingAfterCharge && typeof debugJoinFundingAfterCharge === "object" ? debugJoinFundingAfterCharge : null;
  morpionTrace(event, {
    ...payload,
    funding: summary,
    fundingError,
    fundingApprovedHtgAvailable: safeInt(summary?.approvedHtgAvailable, 0),
    fundingPlayableHtg: safeInt(summary?.playableHtg, 0),
    fundingWithdrawableHtg: safeInt(summary?.withdrawableHtg, 0),
    fundingEntryTotalHtg: safeInt(summary?.nativeGameEntryApprovedHtgTotal, 0),
    fundingRewardTotalHtg: safeInt(summary?.nativeGameRewardApprovedHtgTotal, 0),
    fundingPendingWithdrawalPlayHtg: safeInt(summary?.pendingWithdrawalPlayHtg, 0),
    deltaVsPreflightPlayableHtg: baselinePre ? (safeInt(summary?.playableHtg, 0) - safeInt(baselinePre?.playableHtg, 0)) : null,
    deltaVsAfterJoinPlayableHtg: baselinePost ? (safeInt(summary?.playableHtg, 0) - safeInt(baselinePost?.playableHtg, 0)) : null,
  });
}

function getPresenceReasonPriority(reason = "") {
  switch (String(reason || "")) {
    case "timeoutNudge":
      return 3;
    case "botTurnNudge":
      return 2;
    default:
      return 1;
  }
}

function queuePresenceReason(reason = "") {
  const safeReason = String(reason || "presence");
  if (!queuedPresenceReason || getPresenceReasonPriority(safeReason) >= getPresenceReasonPriority(queuedPresenceReason)) {
    queuedPresenceReason = safeReason;
  }
}

function resetTurnNudgeTracking() {
  lastBotTurnNudgeKey = "";
  lastBotTurnNudgeAtMs = 0;
  lastTimeoutNudgeKey = "";
  lastTimeoutNudgeAtMs = 0;
}

function buildTurnNudgeKey(kind = "") {
  return [
    String(kind || ""),
    currentRoomId || "",
    safeInt(currentRoomData?.currentPlayer, -1),
    safeInt(currentRoomData?.lastActionSeq, 0),
    safeInt(currentRoomData?.turnLockedUntilMs, 0),
    safeInt(currentRoomData?.turnDeadlineMs, 0),
  ].join(":");
}

function shouldThrottleTurnNudge(kind = "bot") {
  const key = buildTurnNudgeKey(kind);
  const nowMs = Date.now();
  const cooldownMs = kind === "timeout" ? TIMEOUT_NUDGE_COOLDOWN_MS : BOT_TURN_NUDGE_COOLDOWN_MS;
  const lastKey = kind === "timeout" ? lastTimeoutNudgeKey : lastBotTurnNudgeKey;
  const lastAtMs = kind === "timeout" ? lastTimeoutNudgeAtMs : lastBotTurnNudgeAtMs;
  const throttled = key === lastKey && lastAtMs > 0 && (nowMs - lastAtMs) < cooldownMs;

  if (!throttled) {
    if (kind === "timeout") {
      lastTimeoutNudgeKey = key;
      lastTimeoutNudgeAtMs = nowMs;
    } else {
      lastBotTurnNudgeKey = key;
      lastBotTurnNudgeAtMs = nowMs;
    }
  }

  return {
    key,
    nowMs,
    throttled,
    cooldownMs,
    remainingMs: throttled ? Math.max(0, cooldownMs - (nowMs - lastAtMs)) : 0,
  };
}

function withTimeout(promise, timeoutMs = 8000, timeoutMessage = "operation-timeout") {
  let timeoutId = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  });
}

function morpionTrace(event, payload = {}) {
  try {
    if (!MORPION_DEBUG_ENABLED) return;
    const normalizedEvent = String(event || "").trim();
    if (!MORPION_DEBUG_ALLOWED_EVENTS.has(normalizedEvent)) return;
    const logPayload = buildMorpionLogPayload(payload);
    const serialized = JSON.stringify(logPayload);
    const nowMs = Date.now();
    const logKey = `${normalizedEvent}:${serialized}`;
    if (logKey === lastMorpionDebugLogKey && (nowMs - lastMorpionDebugLogAtMs) < 1500) {
      return;
    }
    lastMorpionDebugLogKey = logKey;
    lastMorpionDebugLogAtMs = nowMs;
    console.log(`[MORPION_DEBUG_JSON] ${normalizedEvent} ${serialized}`);
  } catch (_) {
  }
}

function morpionIncident(event, payload = {}) {
  try {
    if (!MORPION_DEBUG_ENABLED) return;
    const normalizedEvent = String(event || "").trim();
    if (!MORPION_DEBUG_ERROR_EVENTS.has(normalizedEvent)) return;
    const logPayload = buildMorpionLogPayload(payload);
    console.warn(`[MORPION_DEBUG_ERROR_JSON] ${normalizedEvent} ${JSON.stringify(logPayload)}`);
  } catch (_) {
  }
}

function isActiveSeatControlledByBot() {
  const activeSeat = safeInt(currentRoomData?.currentPlayer, -1);
  if (activeSeat < 0) return false;
  if (isBotTestMorpionFlowFromUrl() || String(currentRoomData?.roomMode || "").trim() === "morpion_bot_test") {
    return true;
  }
  const playerUids = Array.isArray(currentRoomData?.playerUids) ? currentRoomData.playerUids : [];
  const activeSeatUid = String(playerUids[activeSeat] || "").trim();
  if (activeSeatUid) return false;
  return safeInt(currentRoomData?.botCount, 0) > 0;
}

function safeInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function formatDoesAmount(value) {
  return new Intl.NumberFormat("fr-FR").format(Math.max(0, safeInt(value, 0)));
}

function doesToHtgAmount(value) {
  return Math.floor(Math.max(0, safeInt(value, 0)) / 20);
}

function makePlayerId(seed = "") {
  const source = String(seed || "").trim();
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash * 31) + source.charCodeAt(index)) % 1_000_000;
  }
  const normalizedHash = Math.max(0, Math.abs(hash));
  const safeCode = ((normalizedHash % 900000) + 100000);
  return `Jwè ID-${String(safeCode).padStart(6, "0")}`;
}

function randomPlayerIdLabel() {
  const value = Math.floor(Math.random() * 900000) + 100000;
  return `Jwè ID-${String(value)}`;
}

function pickBotNumericId() {
  const roomSeed = String(currentRoomId || "").trim();
  let hash = 0;
  for (let index = 0; index < roomSeed.length; index += 1) {
    hash = ((hash * 31) + roomSeed.charCodeAt(index)) >>> 0;
  }
  const slot = MORPION_BOT_NUMERIC_IDS.length > 0
    ? (hash % MORPION_BOT_NUMERIC_IDS.length)
    : 0;
  return MORPION_BOT_NUMERIC_IDS[slot] || MORPION_BOT_NUMERIC_IDS[0];
}

function readAbandonedRoomIds() {
  try {
    const raw = window.localStorage.getItem(ABANDONED_ROOMS_STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8);
  } catch (_) {
    return [];
  }
}

function writeAbandonedRoomIds(roomIds = []) {
  try {
    window.localStorage.setItem(ABANDONED_ROOMS_STORAGE_KEY, JSON.stringify(roomIds.slice(0, 8)));
  } catch (_) {
  }
}

function markRoomAbandoned(roomId = "") {
  const safeRoomId = String(roomId || "").trim();
  if (!safeRoomId) return;
  const next = [safeRoomId, ...readAbandonedRoomIds().filter((item) => item !== safeRoomId)];
  writeAbandonedRoomIds(next);
}

function clearRoomAbandoned(roomId = "") {
  const safeRoomId = String(roomId || "").trim();
  if (!safeRoomId) return;
  writeAbandonedRoomIds(readAbandonedRoomIds().filter((item) => item !== safeRoomId));
}

function otherSeat(seat) {
  return seat === 0 ? 1 : 0;
}

function seatSymbol(seat) {
  return seat === 0 ? "X" : "O";
}

function getOpponentSeat() {
  if (currentSeatIndex === 0) return 1;
  if (currentSeatIndex === 1) return 0;
  return 0;
}

function getSelfName() {
  const fallback = currentUser?.displayName || currentUser?.email || "Ou";
  const roomName = Array.isArray(currentRoomData?.playerNames) ? String(currentRoomData.playerNames[currentSeatIndex] || "").trim() : "";
  return roomName || fallback;
}

function getOpponentName() {
  const opponentSeat = getOpponentSeat();
  const roomName = Array.isArray(currentRoomData?.playerNames) ? String(currentRoomData.playerNames[opponentSeat] || "").trim() : "";
  const opponentUid = Array.isArray(currentRoomData?.playerUids) ? String(currentRoomData.playerUids[opponentSeat] || "").trim() : "";
  if (!opponentUid && safeInt(currentRoomData?.botCount, 0) > 0 && safeInt(currentRoomData?.humanCount, 0) <= 1) {
    return `Jwè ${pickBotNumericId()}`;
  }
  return roomName || "M ap tann...";
}

function getOpponentLabel() {
  const opponentSeat = getOpponentSeat();
  const opponentUid = Array.isArray(currentRoomData?.playerUids) ? String(currentRoomData.playerUids[opponentSeat] || "").trim() : "";
  if (!opponentUid) {
    if (safeInt(currentRoomData?.botCount, 0) > 0 && safeInt(currentRoomData?.humanCount, 0) <= 1) {
      return `Jwè ID-${pickBotNumericId()}`;
    }
    const roomKey = String(currentRoomId || "").trim();
    if (!fallbackOpponentAlias || fallbackOpponentAliasRoomId !== roomKey) {
      fallbackOpponentAlias = randomPlayerIdLabel();
      fallbackOpponentAliasRoomId = roomKey;
    }
    return fallbackOpponentAlias;
  }
  return makePlayerId(`${currentRoomId}:${opponentUid}:${opponentSeat}`);
}

function renderWalletValue() {
  if (!dom.walletValue) return;
  try {
    const uid = auth.currentUser?.uid || "guest";
    const xState = getXchangeState(window.__userBaseBalance || window.__userBalance || 0, uid);
    const total = Math.max(0, Math.trunc(Number(xState?.totalBalance || 0)));
    dom.walletValue.textContent = `${formatDoesAmount(total)} HTG`;
  } catch (_) {
    if (currentHtgBalance === null) {
      dom.walletValue.textContent = "--";
      return;
    }
    dom.walletValue.textContent = `${formatDoesAmount(currentHtgBalance)} HTG`;
  }
}

async function refreshWalletState(reason = "") {
  const uid = String(currentUser?.uid || auth.currentUser?.uid || "").trim();
  if (!uid) {
    renderWalletValue();
    return;
  }
  try {
    await ensureXchangeState(uid);
  } catch (error) {
    console.warn("[MORPION] wallet refresh failed", { reason, error });
  }
  renderWalletValue();
}

function normalizeWhatsappInput(value = "") {
  return String(value || "")
    .replace(/[^\d+\-\s().]/g, "")
    .trim()
    .slice(0, 40);
}

function extractDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function formatWhatsappValue(value = "") {
  const digits = extractDigits(value);
  if (!digits) return "";
  return value.startsWith("+") ? value : `+${digits}`;
}

function formatRecentContactTime(value = 0) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue) || safeValue <= 0) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(safeValue));
  } catch (_) {
    return "";
  }
}

function buildWhatsappDeepLink(digits = "") {
  const normalizedDigits = extractDigits(digits);
  if (!normalizedDigits) return "";
  const message = encodeURIComponent("Bonjour, je veux jouer au morpion sur Kobposh. Es-tu disponible ?");
  return `https://wa.me/${normalizedDigits}?text=${message}`;
}

function setWhatsappStatus(message = "", tone = "") {
  if (!dom.whatsappStatus) return;
  dom.whatsappStatus.textContent = String(message || "");
  dom.whatsappStatus.classList.toggle("is-error", tone === "error");
  dom.whatsappStatus.classList.toggle("is-success", tone === "success");
}

function renderWhatsappPreference() {
  const savedNumber = String(myWhatsappContact?.whatsappNumber || "").trim();
  if (dom.whatsappSavedWrap) dom.whatsappSavedWrap.classList.toggle("hidden", !savedNumber);
  if (dom.whatsappSavedValue) dom.whatsappSavedValue.textContent = savedNumber || "";
  if (dom.whatsappRemoveBtn) dom.whatsappRemoveBtn.classList.toggle("hidden", !savedNumber);
  if (dom.whatsappInput && document.activeElement !== dom.whatsappInput) {
    dom.whatsappInput.value = savedNumber || dom.whatsappInput.value || "";
  }
}

function openWhatsappModal() {
  dom.whatsappModal?.classList.remove("hidden");
  renderWhatsappPreference();
  if (whatsappPreferenceLoaded && myWhatsappContact) {
    setWhatsappStatus("Nimewo ou deja pataje. Ou ka mete li ajou oswa retire li.", "success");
  } else if (whatsappPreferenceLoaded && !myWhatsappContact) {
    setWhatsappStatus("Nimewo ou poko pataje. Ou ka ajoute li la a.", "");
  }
}

function closeWhatsappModal() {
  dom.whatsappModal?.classList.add("hidden");
}

function closeContactsModal() {
  dom.contactsModal?.classList.add("hidden");
}

function renderRecentWhatsappContacts() {
  if (!dom.contactsList) return;
  if (!Array.isArray(recentWhatsappContacts) || recentWhatsappContacts.length === 0) {
    dom.contactsList.innerHTML = `
      <div class="contact-empty">
        Pa gen okenn nimewo resan ki disponib pou kounye a. Kite WhatsApp ou pou ede pwochen jwè yo jwenn ou.
      </div>
    `;
    return;
  }

  dom.contactsList.innerHTML = recentWhatsappContacts.map((contact, index) => {
    const label = String(contact?.label || `Jwè ${index + 1}`);
    const whatsappNumber = String(contact?.whatsappNumber || "").trim();
    const whatsappDigits = extractDigits(contact?.whatsappDigits || whatsappNumber);
    const online = contact?.online === true;
    const presenceLabel = online ? "Sou liy" : "Dekonekte";
    const lastSeen = formatRecentContactTime(contact?.lastInterestAtMs || contact?.lastSeenAtMs);
    const whatsappLink = buildWhatsappDeepLink(whatsappDigits);
    return `
      <article class="contact-card">
        <div class="contact-card__top">
          <div class="contact-card__identity">
            <div class="contact-card__label">${label}</div>
            <div class="contact-card__value">${whatsappNumber}</div>
            <div class="contact-card__meta">${lastSeen ? `Aktif depi ${lastSeen}` : "Aktivite resan"}<\/div>
          </div>
          <span class="presence-pill ${online ? "is-online" : ""}">
            <span class="presence-pill__dot"><\/span>
            ${presenceLabel}
          <\/span>
        </div>
        <div class="contact-card__actions">
          <button class="btn btn--primary" type="button" data-contact-action="copy" data-contact-number="${whatsappNumber}">
            Kopye
          <\/button>
          <a class="btn btn--ghost" href="${whatsappLink || "#"}" ${whatsappLink ? `target="_blank" rel="noopener noreferrer"` : `aria-disabled="true"`}>
            WhatsApp
          <\/a>
        </div>
      </article>
    `;
  }).join("");
}

async function copyToClipboard(value = "") {
  const safeValue = String(value || "").trim();
  if (!safeValue) return false;
  try {
    await navigator.clipboard.writeText(safeValue);
    return true;
  } catch (_) {
    return false;
  }
}

async function loadWhatsappPreference(force = false) {
  if (!currentUser?.uid) return;
  if (whatsappPreferenceLoaded && !force) return;
  try {
    const result = await getMyMorpionWhatsappPreferenceSecure({});
    myWhatsappContact = result?.contact && typeof result.contact === "object" ? result.contact : null;
    whatsappPreferenceLoaded = true;
    renderWhatsappPreference();
  } catch (error) {
    console.warn("[MORPION] load whatsapp preference failed", error);
  }
}

async function saveWhatsappPreference() {
  const rawValue = normalizeWhatsappInput(dom.whatsappInput?.value || "");
  if (!extractDigits(rawValue)) {
    setWhatsappStatus("Antre yon nimewo WhatsApp ki valab pou kontinye.", "error");
    return;
  }

  if (dom.whatsappSaveBtn) dom.whatsappSaveBtn.disabled = true;
  setWhatsappStatus("M ap anrejistre nimewo a...", "");
  try {
    const result = await saveMorpionWhatsappPreferenceSecure({ whatsappNumber: rawValue });
    myWhatsappContact = result?.contact && typeof result.contact === "object" ? result.contact : null;
    whatsappPreferenceLoaded = true;
    renderWhatsappPreference();
    setWhatsappStatus("Nimewo WhatsApp ou a kounye a vizib nan lis jwè resan yo.", "success");
  } catch (error) {
    setWhatsappStatus(error?.message || "M pa ka anrejistre nimewo ou a pou kounye a.", "error");
  } finally {
    if (dom.whatsappSaveBtn) dom.whatsappSaveBtn.disabled = false;
  }
}

async function removeWhatsappPreference() {
  if (dom.whatsappRemoveBtn) dom.whatsappRemoveBtn.disabled = true;
  setWhatsappStatus("M ap retire nimewo a...", "");
  try {
    await removeMorpionWhatsappPreferenceSecure({});
    myWhatsappContact = null;
    whatsappPreferenceLoaded = true;
    if (dom.whatsappInput) dom.whatsappInput.value = "";
    renderWhatsappPreference();
    setWhatsappStatus("Nimewo ou a retire nan lis jwè resan yo.", "success");
  } catch (error) {
    setWhatsappStatus(error?.message || "M pa ka retire nimewo ou a pou kounye a.", "error");
  } finally {
    if (dom.whatsappRemoveBtn) dom.whatsappRemoveBtn.disabled = false;
  }
}

async function loadRecentWhatsappContacts() {
  if (!dom.contactsList) return;
  dom.contactsList.innerHTML = `<div class="contact-empty">M ap chaje jwè resan yo...<\/div>`;
  try {
    const result = await listRecentMorpionWhatsappContactsSecure({});
    recentWhatsappContacts = Array.isArray(result?.contacts) ? result.contacts : [];
    renderRecentWhatsappContacts();
  } catch (error) {
    recentWhatsappContacts = [];
    dom.contactsList.innerHTML = `<div class="contact-empty">${String(error?.message || "Impossible de charger la liste pour le moment.")}<\/div>`;
  }
}

async function openContactsModal() {
  dom.contactsModal?.classList.remove("hidden");
  await loadRecentWhatsappContacts();
}

async function touchClientSitePresence() {
  if (!currentUser?.uid || sitePresencePingInFlight) return;
  sitePresencePingInFlight = true;
  const nowMs = Date.now();
  try {
    await setDoc(doc(db, "clients", currentUser.uid), {
      uid: currentUser.uid,
      email: String(currentUser.email || ""),
      lastSeenAt: serverTimestamp(),
      lastSeenAtMs: nowMs,
      updatedAt: serverTimestamp(),
      sitePresencePage: "morpion",
      sitePresenceExpiresAtMs: nowMs + SITE_PRESENCE_TTL_MS,
      morpionLastInterestAtMs: nowMs,
    }, { merge: true });
  } catch (error) {
    if (!sitePresenceWarned) {
      sitePresenceWarned = true;
      morpionTrace("sitePresenceUnavailable", {
        message: error?.message || String(error),
      });
    }
  } finally {
    sitePresencePingInFlight = false;
  }
}

function currentBoard() {
  const board = Array.isArray(currentGameState?.board) ? currentGameState.board : [];
  return board.length === 225 ? board : Array.from({ length: 225 }, () => -1);
}

function resetBotTurnStallObservation() {
  botTurnStallKey = "";
  botTurnStallSinceMs = 0;
  botTurnStallLastReportedMs = 0;
}

function observeBotTurnStall(source = "") {
  const status = String(currentRoomData?.status || "");
  const activeSeat = safeInt(currentRoomData?.currentPlayer, -1);
  const revealPending = currentRoomData?.startRevealPending === true;
  if (!currentRoomId || status !== "playing" || revealPending || activeSeat < 0 || activeSeat === currentSeatIndex) {
    resetBotTurnStallObservation();
    return;
  }

  const key = [
    currentRoomId,
    activeSeat,
    safeInt(currentRoomData?.lastActionSeq, 0),
    safeInt(currentRoomData?.turnLockedUntilMs, 0),
    safeInt(currentRoomData?.turnDeadlineMs, 0),
    safeInt(currentGameState?.moveCount, 0),
  ].join(":");
  const nowMs = Date.now();
  if (key !== botTurnStallKey) {
    botTurnStallKey = key;
    botTurnStallSinceMs = nowMs;
    botTurnStallLastReportedMs = 0;
    return;
  }

  const lockedUntilMs = safeInt(currentRoomData?.turnLockedUntilMs, 0);
  const thresholdMs = lockedUntilMs > nowMs
    ? Math.max(3500, (lockedUntilMs - nowMs) + 1500)
    : 3500;
  const ageMs = nowMs - botTurnStallSinceMs;
  if (ageMs < thresholdMs || (nowMs - botTurnStallLastReportedMs) < 5000) return;

  botTurnStallLastReportedMs = nowMs;
  morpionIncident("botTurnStalled", {
    source,
    activeSeat,
    lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
    moveCount: safeInt(currentGameState?.moveCount, 0),
    turnLockedUntilMs: lockedUntilMs,
    turnDeadlineMs: safeInt(currentRoomData?.turnDeadlineMs, 0),
    stallAgeMs: ageMs,
    humanCount: safeInt(currentRoomData?.humanCount, 0),
    botCount: safeInt(currentRoomData?.botCount, 0),
  });
}

function traceRoomTransition(source = "room") {
  const traceKey = [
    String(currentRoomData?.status || ""),
    currentRoomData?.startRevealPending === true ? 1 : 0,
    safeInt(currentRoomData?.currentPlayer, -1),
    safeInt(currentRoomData?.lastActionSeq, 0),
    safeInt(currentRoomData?.turnLockedUntilMs, 0),
    safeInt(currentRoomData?.turnDeadlineMs, 0),
    safeInt(currentRoomData?.humanCount, 0),
    safeInt(currentRoomData?.botCount, 0),
  ].join(":");
  if (traceKey !== lastRoomTraceKey) {
    lastRoomTraceKey = traceKey;
    morpionTrace("roomTransition", {
      source,
      roomMode: String(currentRoomData?.roomMode || "").trim(),
      status: String(currentRoomData?.status || ""),
      startRevealPending: currentRoomData?.startRevealPending === true,
      currentPlayer: safeInt(currentRoomData?.currentPlayer, -1),
      lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
      turnLockedUntilMs: safeInt(currentRoomData?.turnLockedUntilMs, 0),
      turnDeadlineMs: safeInt(currentRoomData?.turnDeadlineMs, 0),
      humanCount: safeInt(currentRoomData?.humanCount, 0),
      botCount: safeInt(currentRoomData?.botCount, 0),
      winnerSeat: safeInt(currentRoomData?.winnerSeat, -1),
      winnerUid: String(currentRoomData?.winnerUid || "").trim(),
      endedReason: String(currentRoomData?.endedReason || "").trim(),
      rewardAmountDoes: safeInt(currentRoomData?.rewardAmountDoes, 0),
      rewardAmountHtg: doesToHtgAmount(safeInt(currentRoomData?.rewardAmountDoes, 0)),
    });
  }
  observeBotTurnStall(source);
}

function traceStateTransition(source = "state") {
  const traceKey = [
    currentGameState ? 1 : 0,
    safeInt(currentGameState?.currentPlayer, -1),
    safeInt(currentGameState?.moveCount, 0),
    safeInt(currentGameState?.winnerSeat, -1),
    String(currentGameState?.endedReason || ""),
  ].join(":");
  if (traceKey !== lastStateTraceKey) {
    lastStateTraceKey = traceKey;
    morpionTrace("stateTransition", {
      source,
      currentPlayer: safeInt(currentGameState?.currentPlayer, -1),
      moveCount: safeInt(currentGameState?.moveCount, 0),
      placedCountBySeat: [0, 1].map((seat) => safeInt((currentGameState?.placedCountBySeat || [])[seat], 0)),
      winnerSeat: safeInt(currentGameState?.winnerSeat, -1),
      endedReason: String(currentGameState?.endedReason || ""),
    });
  }
  observeBotTurnStall(source);
}

function isMyTurn() {
  return currentRoomData?.status === "playing"
    && currentRoomData?.startRevealPending !== true
    && safeInt(currentRoomData?.currentPlayer, -1) === currentSeatIndex;
}

function openWaitingModal(title = "", copy = "") {
  if (dom.waitingTitle) dom.waitingTitle.textContent = String(title || "M ap chèche yon advèsè...");
  if (dom.waitingCopy) dom.waitingCopy.textContent = String(copy || "");
  dom.waitingModal?.classList.remove("hidden");
}

function closeWaitingModal() {
  dom.waitingModal?.classList.add("hidden");
}

function startMatchmakingWaitCycle() {
  matchmakingWaitDeadlineMs = Date.now() + MATCHMAKING_WAIT_MS;
  matchmakingWaitExpired = false;
  matchmakingExtendedWaiting = false;
  matchmakingHintInFlight = false;
  matchmakingHintRoomId = "";
  matchmakingHintCheckedAtMs = 0;
  matchmakingHintHasOddPlayingHumans = false;
  matchmakingHintMessage = "";
  if (dom.waitingActions) dom.waitingActions.classList.add("hidden");
}

function resetMatchmakingWaitState() {
  matchmakingWaitDeadlineMs = 0;
  matchmakingWaitRoomId = "";
  matchmakingWaitExpired = false;
  matchmakingExtendedWaiting = false;
  matchmakingHintInFlight = false;
  matchmakingHintRoomId = "";
  matchmakingHintCheckedAtMs = 0;
  matchmakingHintHasOddPlayingHumans = false;
  matchmakingHintMessage = "";
  if (dom.waitingActions) dom.waitingActions.classList.add("hidden");
}

async function refreshMatchmakingHintIfNeeded(force = false) {
  if (!currentRoomId) return;
  if (matchmakingHintInFlight) return;
  const nowMs = Date.now();
  const stale = (nowMs - matchmakingHintCheckedAtMs) > 10_000;
  if (!force && !stale && matchmakingHintRoomId === currentRoomId) return;

  matchmakingHintInFlight = true;
  try {
    const result = await getMorpionMatchmakingHintSecure({ roomId: currentRoomId });
    matchmakingHintRoomId = currentRoomId;
    matchmakingHintCheckedAtMs = Number(result?.checkedAtMs || nowMs);
    matchmakingHintHasOddPlayingHumans = result?.hasOddActivePlayingHumans === true;
    matchmakingHintMessage = String(result?.message || "").trim();
  } catch (_) {
  } finally {
    matchmakingHintInFlight = false;
    renderMatchmakingWaitingModal();
  }
}

function setWaitingActionsVisibility({
  showHome = true,
  showRetry = true,
  showExtend = true,
  showStopExtended = false,
  showNotify = true,
  showGroup = false,
  showWhatsapp = true,
  showContacts = true,
} = {}) {
  if (dom.waitingHomeBtn) dom.waitingHomeBtn.classList.toggle("hidden", !showHome);
  if (dom.waitingRetryBtn) dom.waitingRetryBtn.classList.toggle("hidden", !showRetry);
  if (dom.waitingExtendBtn) dom.waitingExtendBtn.classList.toggle("hidden", !showExtend);
  if (dom.waitingStopExtendBtn) dom.waitingStopExtendBtn.classList.toggle("hidden", !showStopExtended);
  if (dom.waitingNotifyBtn) dom.waitingNotifyBtn.classList.toggle("hidden", !showNotify);
  if (dom.waitingGroupBtn) dom.waitingGroupBtn.classList.toggle("hidden", !showGroup);
  if (dom.waitingWhatsappBtn) dom.waitingWhatsappBtn.classList.toggle("hidden", !showWhatsapp);
  if (dom.waitingContactsBtn) dom.waitingContactsBtn.classList.toggle("hidden", !showContacts);
}

function renderMatchmakingWaitingModal() {
  if (String(currentRoomData?.status || "") !== "waiting") {
    resetMatchmakingWaitState();
    return;
  }

  if (isFriendMorpionRoomFlow()) {
    const humans = safeInt(currentRoomData?.humanCount, 0);
    if (humans >= 2) {
      openWaitingModal("Advèsè jwenn", "Pati prive a ap kòmanse...");
    } else {
      openWaitingModal(
        "M ap tann zanmi ou...",
        "Chanm prive a rete ouvè san limit tan jouk nou kite chanm nan."
      );
    }
    if (dom.waitingTimerWrap) dom.waitingTimerWrap.classList.add("hidden");
    if (dom.waitingActions) dom.waitingActions.classList.add("hidden");
    return;
  }

  const humans = safeInt(currentRoomData?.humanCount, 0);
  if (humans >= 2) {
    openWaitingModal("Advèsè jwenn", "Pati a ap kòmanse...");
    if (dom.waitingTimerWrap) dom.waitingTimerWrap.classList.add("hidden");
    if (dom.waitingActions) dom.waitingActions.classList.add("hidden");
    return;
  }

  const roomKey = String(currentRoomId || "").trim();
  if (!roomKey) return;
  if (matchmakingWaitRoomId !== roomKey) {
    matchmakingWaitRoomId = roomKey;
    startMatchmakingWaitCycle();
  } else if (matchmakingWaitDeadlineMs <= 0) {
    startMatchmakingWaitCycle();
  }

  const now = Date.now();
  const remainingMs = Math.max(0, matchmakingWaitDeadlineMs - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  if (remainingMs > 0) {
    openWaitingModal(
      "M ap chèche yon jwè...",
      "Nou ap chèche yon jwè reyèl. Si pèsonn pa antre nan 15 segonn, pa gen pati."
    );
    if (dom.waitingTimerWrap) dom.waitingTimerWrap.classList.remove("hidden");
    if (dom.waitingTimerValue) dom.waitingTimerValue.textContent = `${Math.max(1, remainingSeconds)}s`;
    if (dom.waitingActions) dom.waitingActions.classList.add("hidden");
    matchmakingWaitExpired = false;
    return;
  }

  if (!matchmakingWaitExpired) {
    matchmakingWaitExpired = true;
  }
  const notificationsSupported = typeof window !== "undefined" && ("Notification" in window);
  const notificationsGranted = notificationsSupported && Notification.permission === "granted";
  const showNotifyAction = notificationsSupported && !notificationsGranted;
  const oddPlayingHint = matchmakingHintHasOddPlayingHumans && String(matchmakingHintMessage || "").trim();

  if ((Date.now() - matchmakingHintCheckedAtMs) > 10_000 || matchmakingHintRoomId !== roomKey) {
    void refreshMatchmakingHintIfNeeded();
  }

  if (matchmakingExtendedWaiting) {
    openWaitingModal(
      "Tan tann pwolonje aktive",
      oddPlayingHint
        ? matchmakingHintMessage
        : (notificationsGranted
          ? "Ou rete ap tann san limit. Notifikasyon yo deja aktive: n ap avèti ou le pli vit yon jwè disponib."
          : "Ou rete ap tann san limit. Ou ka soti nan tann nan nenpòt ki lè.")
    );
    if (dom.waitingTimerWrap) dom.waitingTimerWrap.classList.add("hidden");
    if (dom.waitingActions) dom.waitingActions.classList.remove("hidden");
    setWaitingActionsVisibility({
      showHome: false,
      showRetry: false,
      showExtend: false,
      showStopExtended: true,
      showNotify: showNotifyAction,
      showGroup: true,
      showWhatsapp: true,
      showContacts: true,
    });
    return;
  }

  openWaitingModal(
    "Pa gen jwè disponib",
    oddPlayingHint
      ? matchmakingHintMessage
      : (notificationsGranted
        ? "Pa gen jwè ki antre nan 15 segonn yo. Antre tou nan gwoup WhatsApp la pou jwenn jwè rapid."
        : "Pa gen jwè ki antre nan 15 segonn yo. Aktive notifikasyon yo oswa antre nan gwoup WhatsApp la pou jwenn jwè.")
  );
  if (dom.waitingTimerWrap) dom.waitingTimerWrap.classList.add("hidden");
  if (dom.waitingActions) dom.waitingActions.classList.remove("hidden");
  setWaitingActionsVisibility({
    showHome: true,
    showRetry: true,
    showExtend: true,
    showStopExtended: false,
    showNotify: showNotifyAction,
    showGroup: true,
    showWhatsapp: true,
    showContacts: true,
  });
}

async function requestMatchmakingNotifications() {
  if (!dom.waitingCopy) return;
  if (typeof window === "undefined" || !("Notification" in window)) {
    dom.waitingCopy.textContent = "Aparèy sa a pa sipòte notifikasyon yo.";
    if (dom.waitingNotifyBtn) dom.waitingNotifyBtn.classList.add("hidden");
    return;
  }
  try {
    if (Notification.permission === "granted") {
      dom.waitingCopy.textContent = "Notifikasyon yo deja aktif. N ap avèti ou lè jwè yo disponib.";
      if (dom.waitingNotifyBtn) dom.waitingNotifyBtn.classList.add("hidden");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      dom.waitingCopy.textContent = "Notifikasyon yo aktive. Ou va resevwa avètisman lè jwè yo disponib.";
      if (dom.waitingNotifyBtn) dom.waitingNotifyBtn.classList.add("hidden");
      try {
        const note = new Notification("Morpion", {
          body: "Notifikasyon yo aktive. N ap avèti ou lè jwè yo rive.",
          tag: "morpion-notify-enabled",
          icon: "./favicon.ico",
        });
        window.setTimeout(() => note.close(), 3000);
      } catch (_) {
      }
      return;
    }
    dom.waitingCopy.textContent = "Notifikasyon yo bloke. Otorize yo nan paramèt navigatè a.";
    if (dom.waitingNotifyBtn) dom.waitingNotifyBtn.classList.remove("hidden");
  } catch (_) {
    dom.waitingCopy.textContent = "M pa ka aktive notifikasyon yo pou kounye a.";
    if (dom.waitingNotifyBtn) dom.waitingNotifyBtn.classList.remove("hidden");
  }
}

function openInviteModal(title = "", copy = "") {
  if (dom.inviteTitle) dom.inviteTitle.textContent = String(title || "Envitasyon disponib");
  if (dom.inviteCopy) dom.inviteCopy.textContent = String(copy || "");
  dom.inviteModal?.classList.remove("hidden");
}

function closeInviteModal() {
  dom.inviteModal?.classList.add("hidden");
}

function openRuleModal() {
  dom.ruleModal?.classList.remove("hidden");
}

function closeRuleModal() {
  dom.ruleModal?.classList.add("hidden");
}

function openResultModal(eyebrow = "", title = "", copy = "") {
  if (dom.resultEyebrow) dom.resultEyebrow.textContent = String(eyebrow || "Fen pati");
  if (dom.resultTitle) dom.resultTitle.textContent = String(title || "Fen pati");
  if (dom.resultCopy) dom.resultCopy.textContent = String(copy || "");
  syncReplayActionLabels();
  dom.resultModal?.classList.remove("hidden");
}

function closeResultModal() {
  dom.resultModal?.classList.add("hidden");
}

function stopFriendRematchSync() {
  if (friendRematchSyncTimer) {
    window.clearInterval(friendRematchSyncTimer);
    friendRematchSyncTimer = null;
  }
}

function resetForStartedFriendRematch() {
  rewardClaimed = false;
  rewardClaiming = false;
  rematchRequestInFlight = false;
  startRevealAcked = false;
  lastHandledEndKey = "";
  clearEndStateDecorations();
  resetMatchmakingWaitState();
  closeResultModal();
  closeQuitModal();
  closeWaitingModal();
  stopFriendRematchSync();
}

async function refreshFriendRematchRoomState() {
  if (!currentRoomId || !isFriendMorpionRoomFlow()) return;
  try {
    const roomSnap = await getDoc(doc(db, MORPION_ROOMS, currentRoomId));
    if (!roomSnap.exists()) return;

    const previousRoomData = currentRoomData;
    const nextRoomData = roomSnap.data() || {};
    const previousStatus = String(previousRoomData?.status || "").trim();
    const nextStatus = String(nextRoomData?.status || "").trim();
    const previousStartedAtMs = safeInt(previousRoomData?.startedAtMs, 0);
    const nextStartedAtMs = safeInt(nextRoomData?.startedAtMs, 0);

    currentRoomData = nextRoomData;
    currentSeatIndex = safeInt(currentRoomData?.seats?.[currentUser?.uid], currentSeatIndex);

    if (
      nextStatus === "playing"
      && (
        previousStatus === "ended"
        || previousStartedAtMs !== nextStartedAtMs
      )
    ) {
      resetForStartedFriendRematch();
    }

    renderFromRoom();
  } catch (_) {
  }
}

function startFriendRematchSync() {
  stopFriendRematchSync();
  if (!currentRoomId || !isFriendMorpionRoomFlow()) return;

  friendRematchSyncTimer = window.setInterval(() => {
    if (
      !currentRoomId
      || !isFriendMorpionRoomFlow()
      || String(currentRoomData?.status || "").trim() !== "ended"
      || !hasCurrentUserRequestedFriendRematch()
    ) {
      stopFriendRematchSync();
      return;
    }
    void refreshFriendRematchRoomState();
  }, 900);
}

function syncFriendRematchActionState() {
  const waitingForOpponent = isFriendMorpionRoomFlow()
    && String(currentRoomData?.status || "") === "ended"
    && hasCurrentUserRequestedFriendRematch();
  const disabled = waitingForOpponent || rematchRequestInFlight;
  if (dom.resultReplayBtn) {
    dom.resultReplayBtn.disabled = disabled;
    dom.resultReplayBtn.classList.toggle("opacity-60", disabled);
    dom.resultReplayBtn.classList.toggle("cursor-not-allowed", disabled);
  }
  if (dom.quitReplayBtn) {
    dom.quitReplayBtn.disabled = disabled;
    dom.quitReplayBtn.classList.toggle("opacity-60", disabled);
    dom.quitReplayBtn.classList.toggle("cursor-not-allowed", disabled);
  }
}

function openQuitModal() {
  syncReplayActionLabels();
  dom.quitModal?.classList.remove("hidden");
}

function closeQuitModal() {
  dom.quitModal?.classList.add("hidden");
}

function formatResultErrorCopy(error, fallback = "Eseye ankò nan yon ti moman.") {
  const message = String(error?.message || fallback || "").trim();
  const code = String(error?.code || "").trim();
  if (!code) return message;
  if (message.toLowerCase().includes(code.toLowerCase())) return message;
  return `${message} (code: ${code})`;
}

function renderPlayerCards() {
  const selfSeat = currentSeatIndex >= 0 ? currentSeatIndex : 1;
  const opponentSeat = getOpponentSeat();
  const activeSeat = safeInt(currentRoomData?.currentPlayer, -1);

  if (dom.selfName) dom.selfName.textContent = getSelfName();
  if (dom.opponentName) dom.opponentName.textContent = getOpponentName();
  if (dom.opponentLabel) dom.opponentLabel.textContent = getOpponentLabel();

  if (dom.selfSymbol) {
    const symbol = seatSymbol(selfSeat);
    dom.selfSymbol.textContent = symbol;
    dom.selfSymbol.dataset.symbol = symbol;
  }
  if (dom.opponentSymbol) {
    const symbol = seatSymbol(opponentSeat);
    dom.opponentSymbol.textContent = symbol;
    dom.opponentSymbol.dataset.symbol = symbol;
  }

  dom.selfCard?.classList.toggle("is-active", activeSeat === selfSeat && currentRoomData?.status === "playing" && currentRoomData?.startRevealPending !== true);
  dom.opponentCard?.classList.toggle("is-active", activeSeat === opponentSeat && currentRoomData?.status === "playing" && currentRoomData?.startRevealPending !== true);
}

function renderTimers() {
  const now = Date.now();
  const activeSeat = safeInt(currentRoomData?.currentPlayer, -1);
  const deadlineMs = safeInt(currentRoomData?.turnDeadlineMs, 0);
  const remainingMs = currentRoomData?.status === "playing" && currentRoomData?.startRevealPending !== true && deadlineMs > 0
    ? Math.max(0, deadlineMs - now)
    : TURN_LIMIT_MS;
  const remainingRatio = Math.max(0, Math.min(1, remainingMs / TURN_LIMIT_MS));
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const selfSeat = currentSeatIndex >= 0 ? currentSeatIndex : 1;
  const opponentSeat = getOpponentSeat();

  const applyTimer = (seat, labelEl, fillEl, cardEl) => {
    const isActive = currentRoomData?.status === "playing" && currentRoomData?.startRevealPending !== true && activeSeat === seat;
    if (labelEl) labelEl.textContent = `${isActive ? remainingSeconds : TURN_LIMIT_SECONDS}s`;
    if (fillEl) fillEl.style.width = `${(isActive ? remainingRatio : 1) * 100}%`;
    if (cardEl) cardEl.classList.toggle("is-danger", isActive && remainingMs <= 5000);
  };

  applyTimer(opponentSeat, dom.opponentTimerLabel, dom.opponentTimerFill, dom.opponentCard);
  applyTimer(selfSeat, dom.selfTimerLabel, dom.selfTimerFill, dom.selfCard);

  if (currentRoomData?.status === "playing" && currentRoomData?.startRevealPending !== true && deadlineMs > 0 && now >= deadlineMs) {
    maybeRequestTurnTimeoutResolution();
  }

  renderMatchmakingWaitingModal();
}

function buildWinningSet() {
  const line = Array.isArray(currentGameState?.winningLine) ? currentGameState.winningLine : [];
  return new Set(line.map((item) => safeInt(item, -1)).filter((item) => item >= 0));
}

function getWinningLineCells() {
  const line = Array.isArray(currentGameState?.winningLine) ? currentGameState.winningLine : [];
  return line.map((item) => safeInt(item, -1)).filter((item) => item >= 0);
}

function getLastMoveCellIndex() {
  const cellIndex = safeInt(currentRoomData?.lastMove?.cellIndex, -1);
  return cellIndex >= 0 && cellIndex < 225 ? cellIndex : -1;
}

function isFriendMorpionRoomFlow() {
  return isFriendMorpionFlowFromUrl() || String(currentRoomData?.roomMode || "").trim() === "morpion_friends";
}

function getFriendMorpionRematchRequestUids() {
  return Array.isArray(currentRoomData?.rematchRequestUids)
    ? currentRoomData.rematchRequestUids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function hasCurrentUserRequestedFriendRematch() {
  const uid = String(currentUser?.uid || "").trim();
  return uid ? getFriendMorpionRematchRequestUids().includes(uid) : false;
}

function hideRevealResultButton() {
  dom.revealResultBtn?.classList.add("hidden");
}

function showRevealResultButton() {
  dom.revealResultBtn?.classList.remove("hidden");
}

function hideWinLine() {
  if (!dom.winLine) return;
  dom.winLine.classList.add("hidden");
  dom.winLine.style.width = "0px";
}

function isLineEndState() {
  return String(currentRoomData?.status || "") === "ended"
    && String(currentRoomData?.endedReason || currentGameState?.endedReason || "").trim() === "line";
}

function clearEndStateDecorations() {
  stopEndResultTimer();
  pendingEndModalPayload = null;
  winLineVisible = false;
  hideRevealResultButton();
  hideWinLine();
}

function buildEndModalPayload() {
  const winnerSeat = safeInt(currentRoomData?.winnerSeat, -1);
  const endedReason = String(currentRoomData?.endedReason || currentGameState?.endedReason || "").trim();
  const isFriendRoom = isFriendMorpionRoomFlow();
  const rematchRequestUids = getFriendMorpionRematchRequestUids();
  const currentUid = String(currentUser?.uid || "").trim();
  const requestedByMe = currentUid ? rematchRequestUids.includes(currentUid) : false;
  const requestedByOpponent = rematchRequestUids.length > 0 && requestedByMe !== true;
  const rematchLine = isFriendRoom
    ? (requestedByMe
      ? " Revanj mande. M ap tann lòt jwè a."
      : (requestedByOpponent ? " Lòt jwè a vle rejwe. Klike sou Rejwe pou aksepte." : ""))
    : "";
  if (endedReason === "no_play_refund") {
    const placedCountBySeat = Array.isArray(currentGameState?.placedCountBySeat)
      ? currentGameState.placedCountBySeat
      : [];
    const myPlacedCount = Math.max(0, safeInt(placedCountBySeat[currentSeatIndex], 0));
    const timedOutSeat = safeInt(currentRoomData?.currentPlayer, -1);
    const iTimedOutWithoutPlaying = timedOutSeat === currentSeatIndex || (timedOutSeat < 0 && myPlacedCount <= 0);
    if (iTimedOutWithoutPlaying) {
      return {
        eyebrow: "Partie annulee",
        title: "Ou pa t pèdi",
        copy: `Ou pa t mete okenn senbòl anvan tan an fini. Kont ou ap ranbouse pou ou ka rekòmanse jwe.${rematchLine}`,
      };
    }
    return {
      eyebrow: "Partie annulee",
      title: "Kont ou ap ranbouse",
      copy: `Advèsè w la pa t pèdi, li te deside pa jwe. Kont ou ap ranbouse pou ou ka kontinye jwe.${rematchLine}`,
    };
  }
  if (endedReason === "quit_refund_before_opening") {
    return {
      eyebrow: "Partie annulee",
      title: "Kont ou ap ranbouse",
      copy: `Pati a te kanpe anvan 2 jwè yo te antre vrèman nan match la. Kont ou ap ranbouse pou ou ka rekòmanse jwe.${rematchLine}`,
    };
  }
  if (endedReason === "draw") {
    return {
      eyebrow: "Match nul",
      title: "Pati nil",
      copy: `Planch la plen e pa gen okenn aliman 5 ki fòme.${rematchLine}`,
    };
  }
  if (endedReason === "opponent_left") {
    return {
      eyebrow: "Fen pati",
      title: "Lòt jwè a kouri li fè lach",
      copy: "Lòt jwè a kouri li fè lach.",
    };
  }
  if (winnerSeat === currentSeatIndex) {
    const rewardDoes = safeInt(currentRoomData?.rewardAmountDoes, 0);
    const rewardLine = rewardDoes > 0
      ? (
        REQUESTED_FUNDING_CURRENCY === "htg"
          ? ` Tu remportes ${doesToHtgAmount(rewardDoes)} HTG.`
          : ` Tu remportes ${rewardDoes} Does.`
      )
      : "";
    return {
      eyebrow: endedReason === "timeout" ? "Tan fini" : "Viktwa",
      title: "Ou genyen",
      copy: endedReason === "timeout"
        ? `Advèsè ou a kite tan an desann rive 0.${rewardLine}${rematchLine}`
        : `Ou aliman 5 senbòl.${rewardLine}${rematchLine}`,
    };
  }
  return {
    eyebrow: endedReason === "timeout" ? "Tan fini" : "Defèt",
    title: endedReason === "timeout" ? "Ou pèdi pa tan" : "Ou pèdi",
    copy: endedReason === "timeout"
      ? `Tan ou a rive 0.${rematchLine}`
      : `Advèsè a aliman 5 senbòl.${rematchLine}`,
  };
}

function openPendingEndModal() {
  if (!pendingEndModalPayload) return;
  morpionTrace("modal:end:open", {
    eyebrow: String(pendingEndModalPayload.eyebrow || ""),
    title: String(pendingEndModalPayload.title || ""),
    endedReason: String(currentRoomData?.endedReason || currentGameState?.endedReason || "").trim(),
    winnerSeat: safeInt(currentRoomData?.winnerSeat, -1),
    moveCount: safeInt(currentGameState?.moveCount, 0),
    placedCountBySeat: [0, 1].map((seat) => safeInt((currentGameState?.placedCountBySeat || [])[seat], 0)),
  });
  openResultModal(
    pendingEndModalPayload.eyebrow,
    pendingEndModalPayload.title,
    pendingEndModalPayload.copy,
  );
}

function createBoard() {
  if (!dom.board) return;
  dom.board.style.setProperty("--board-size", "15");
  dom.board.innerHTML = "";
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      const cellIndex = (row * 15) + col;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.dataset.index = String(cellIndex);
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", `Ligne ${row + 1}, colonne ${col + 1}`);
      dom.board.appendChild(button);
    }
  }
  const winLine = document.createElement("div");
  winLine.id = "morpionWinLine";
  winLine.className = "board-win-line hidden";
  winLine.setAttribute("aria-hidden", "true");
  dom.board.appendChild(winLine);
  dom.winLine = winLine;
}

function ensureCellSymbol(cell, symbol) {
  const existingSymbol = cell.querySelector(".cell__symbol");
  const nextClass = `cell__symbol cell__symbol--${symbol.toLowerCase()}`;
  if (existingSymbol) {
    if (existingSymbol.className !== nextClass) {
      existingSymbol.className = nextClass;
    }
    return;
  }
  const symbolEl = document.createElement("span");
  symbolEl.className = nextClass;
  symbolEl.setAttribute("aria-hidden", "true");
  cell.appendChild(symbolEl);
}

function renderBoard() {
  if (!dom.board) return;
  const board = currentBoard();
  const winningLineCells = getWinningLineCells();
  const winningSet = new Set(winningLineCells);
  const lastMoveCellIndex = getLastMoveCellIndex();
  Array.from(dom.board.querySelectorAll(".cell")).forEach((cell) => {
    const cellIndex = safeInt(cell.dataset.index, -1);
    const occupant = board[cellIndex];
    const occupied = occupant === 0 || occupant === 1;
    const symbol = occupied ? seatSymbol(occupant) : "";
    const isWinning = winningSet.has(cellIndex);
    const isLastMove = cellIndex === lastMoveCellIndex;
    cell.classList.toggle("is-occupied", occupied);
    cell.classList.toggle("is-win", isWinning);
    cell.classList.toggle("is-last-move", isLastMove);
    cell.disabled = occupied || !isMyTurn();
    if (occupied) {
      ensureCellSymbol(cell, symbol);
    } else {
      const existingSymbol = cell.querySelector(".cell__symbol");
      if (existingSymbol) existingSymbol.remove();
    }
  });
}

function renderWinningLine() {
  if (!dom.board || !dom.winLine) return;
  if (!winLineVisible || !isLineEndState()) {
    hideWinLine();
    return;
  }
  const winningLineCells = getWinningLineCells();
  if (winningLineCells.length < 2) {
    hideWinLine();
    return;
  }
  const firstCell = dom.board.querySelector(`.cell[data-index="${winningLineCells[0]}"]`);
  const lastCell = dom.board.querySelector(`.cell[data-index="${winningLineCells[winningLineCells.length - 1]}"]`);
  if (!(firstCell instanceof HTMLElement) || !(lastCell instanceof HTMLElement)) {
    hideWinLine();
    return;
  }
  const boardRect = dom.board.getBoundingClientRect();
  const firstRect = firstCell.getBoundingClientRect();
  const lastRect = lastCell.getBoundingClientRect();
  const startX = (firstRect.left - boardRect.left) + (firstRect.width / 2);
  const startY = (firstRect.top - boardRect.top) + (firstRect.height / 2);
  const endX = (lastRect.left - boardRect.left) + (lastRect.width / 2);
  const endY = (lastRect.top - boardRect.top) + (lastRect.height / 2);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const length = Math.hypot(deltaX, deltaY);
  const angleDeg = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
  dom.winLine.style.left = `${startX}px`;
  dom.winLine.style.top = `${startY - 4}px`;
  dom.winLine.style.width = `${length}px`;
  dom.winLine.style.transform = `rotate(${angleDeg}deg)`;
  dom.winLine.classList.remove("hidden");
}

function stopRoomSubscriptions() {
  try { roomUnsub?.(); } catch (_) {}
  try { stateUnsub?.(); } catch (_) {}
  roomUnsub = null;
  stateUnsub = null;
  stopFriendRematchSync();
  lastRoomTraceKey = "";
  lastStateTraceKey = "";
  resetBotTurnStallObservation();
  resetTurnNudgeTracking();
}

function stopClientSubscription() {
  try { clientUnsub?.(); } catch (_) {}
  clientUnsub = null;
}

function stopEndResultTimer() {
  if (endResultTimer) {
    window.clearTimeout(endResultTimer);
    endResultTimer = null;
  }
}

function stopPresencePing() {
  if (presenceTimer) {
    window.clearInterval(presenceTimer);
    presenceTimer = null;
  }
}

function stopSitePresencePing() {
  if (sitePresenceTimer) {
    window.clearInterval(sitePresenceTimer);
    sitePresenceTimer = null;
  }
}

function stopTurnTick() {
  if (turnTick) {
    window.clearInterval(turnTick);
    turnTick = null;
  }
}

function stopInvitePoll() {
  if (invitePollTimer) {
    window.clearInterval(invitePollTimer);
    invitePollTimer = null;
  }
}

function stopWaitingEnsureTimer() {
  if (waitingEnsureTimer) {
    window.clearTimeout(waitingEnsureTimer);
    waitingEnsureTimer = null;
  }
}

function stopBotTurnNudgeTimer() {
  if (botTurnNudgeTimer) {
    window.clearTimeout(botTurnNudgeTimer);
    botTurnNudgeTimer = null;
  }
}

function stopTurnTimeoutNudgeTimer() {
  if (turnTimeoutNudgeTimer) {
    window.clearTimeout(turnTimeoutNudgeTimer);
    turnTimeoutNudgeTimer = null;
  }
}

async function pingPresence(reason = "presence") {
  if (!currentRoomId || leavingRoom) return false;
  const safeReason = String(reason || "presence");
  if (presencePingInFlight) {
    if (safeReason !== "presence") {
      queuePresenceReason(safeReason);
      morpionTrace("presencePing:queued", {
        reason: safeReason,
        queuedReason: queuedPresenceReason,
        inFlightForMs: Math.max(0, Date.now() - presencePingStartedAtMs),
        currentPlayer: safeInt(currentRoomData?.currentPlayer, -1),
        lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
      });
    }
    return false;
  }
  presencePingInFlight = true;
  presencePingStartedAtMs = Date.now();
  try {
    if (safeReason !== "presence") {
      morpionTrace("presencePing:start", {
        reason: safeReason,
        currentPlayer: safeInt(currentRoomData?.currentPlayer, -1),
        lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
        turnLockedUntilMs: safeInt(currentRoomData?.turnLockedUntilMs, 0),
        turnDeadlineMs: safeInt(currentRoomData?.turnDeadlineMs, 0),
      });
    }
    await withTimeout(
          touchRoomPresenceMorpionCallable({ roomId: currentRoomId }),
      8000,
      "presence-ping-timeout"
    );
    if (safeReason !== "presence") {
      morpionTrace("presencePing:done", {
        reason: safeReason,
        currentPlayer: safeInt(currentRoomData?.currentPlayer, -1),
        lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
      });
    }
    return true;
  } catch (error) {
    morpionIncident("presencePingFailed", {
      reason: safeReason,
      message: error?.message || String(error),
      currentPlayer: safeInt(currentRoomData?.currentPlayer, -1),
      lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
      inFlightForMs: Math.max(0, Date.now() - presencePingStartedAtMs),
    });
    return false;
  } finally {
    presencePingInFlight = false;
    presencePingStartedAtMs = 0;
    const nextReason = queuedPresenceReason;
    queuedPresenceReason = "";
    if (nextReason && currentRoomId && !leavingRoom) {
      window.setTimeout(() => {
        void pingPresence(nextReason);
      }, 0);
    }
  }
}

function startPresencePing() {
  stopPresencePing();
  presenceTimer = window.setInterval(() => {
    void pingPresence();
  }, PRESENCE_PING_MS);
}

function startSitePresencePing() {
  stopSitePresencePing();
  void touchClientSitePresence();
  sitePresenceTimer = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void touchClientSitePresence();
  }, SITE_PRESENCE_PING_MS);
}

function startTurnTicker() {
  stopTurnTick();
  turnTick = window.setInterval(renderTimers, 250);
}

async function pollActiveInvite() {
  if (!currentUser?.uid || invitePollInFlight) return;
  invitePollInFlight = true;
  try {
    const result = await getMyActiveMorpionInviteSecure({});
    const invite = result?.invitation && typeof result.invitation === "object" ? result.invitation : null;
    const invitationId = String(invite?.invitationId || "").trim();
    if (!invitationId) {
      activeInviteId = "";
      closeInviteModal();
      return;
    }
    activeInviteId = invitationId;
    const gameLabel = String(invite?.gameLabel || "domino").toUpperCase();
    const copy = String(invite?.message || "Gen jwè ki disponib kounye a. Ou vle jwe kounye a ?");
    openInviteModal(`Gen jwè ki disponib sou ${gameLabel}`, copy);
  } catch (error) {
    console.warn("[MORPION] invite poll failed", error);
  } finally {
    invitePollInFlight = false;
  }
}

function startInvitePoll() {
  stopInvitePoll();
  invitePollTimer = window.setInterval(() => {
    void pollActiveInvite();
  }, INVITE_POLL_MS);
}

async function respondInvite(action = "refuse") {
  const invitationId = String(activeInviteId || "").trim();
  if (!invitationId) {
    closeInviteModal();
    return;
  }
  try {
    await respondMorpionPlayInviteSecure({ invitationId, action });
  } catch (error) {
    console.warn("[MORPION] invite response failed", error);
  } finally {
    activeInviteId = "";
    closeInviteModal();
  }
  if (action === "accept") {
    window.location.href = "./index.html";
  }
}

async function maybeRequestTurnTimeoutResolution() {
  if (!currentRoomId || turnTimeoutRequestInFlight) return;
  const activeSeat = safeInt(currentRoomData?.currentPlayer, -1);
  if (activeSeat < 0) return;
  const throttleState = shouldThrottleTurnNudge("timeout");
  if (throttleState.throttled) return;
  turnTimeoutRequestInFlight = true;
  try {
    morpionTrace("timeoutNudge:start", {
      deadlineMs: safeInt(currentRoomData?.turnDeadlineMs, 0),
      currentPlayer: activeSeat,
      lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
      activeSeatIsBot: activeSeat !== currentSeatIndex,
      nudgeKey: throttleState.key,
    });
    const sent = await pingPresence("timeoutNudge");
    morpionTrace(sent ? "timeoutNudge:done" : "timeoutNudge:queued", {
      currentPlayer: safeInt(currentRoomData?.currentPlayer, -1),
      lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
    });
  } catch (error) {
    morpionIncident("timeoutNudgeFailed", {
      message: error?.message || String(error),
      currentPlayer: safeInt(currentRoomData?.currentPlayer, -1),
      lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
      deadlineMs: safeInt(currentRoomData?.turnDeadlineMs, 0),
    });
  } finally {
    turnTimeoutRequestInFlight = false;
  }
}

function scheduleTurnTimeoutNudge() {
  stopTurnTimeoutNudgeTimer();
  if (!currentRoomId || !currentRoomData) return;
  if (String(currentRoomData.status || "") !== "playing") return;
  if (currentRoomData.startRevealPending === true) return;

  const activeSeat = safeInt(currentRoomData?.currentPlayer, -1);
  if (activeSeat < 0) return;

  const deadlineMs = safeInt(currentRoomData?.turnDeadlineMs, 0);
  if (deadlineMs <= 0) return;

  const delayMs = Math.max(50, deadlineMs - Date.now() + 40);
  morpionTrace("timeoutWatchScheduled", {
    activeSeat,
    deadlineMs,
    lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
    delayMs,
  });

  turnTimeoutNudgeTimer = window.setTimeout(() => {
    morpionTrace("timeoutWatchFired", {
      activeSeat,
      deadlineMs,
      lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
    });
    void maybeRequestTurnTimeoutResolution();
  }, delayMs);
}

function scheduleBotTurnNudge() {
  stopBotTurnNudgeTimer();
  if (!currentRoomId || !currentRoomData) return;
  if (String(currentRoomData.status || "") !== "playing") return;
  if (currentRoomData.startRevealPending === true) return;

  const activeSeat = safeInt(currentRoomData.currentPlayer, -1);
  if (activeSeat < 0 || activeSeat === currentSeatIndex) return;
  if (!isActiveSeatControlledByBot()) return;

  const lockedUntilMs = safeInt(currentRoomData.turnLockedUntilMs, 0);
  const delayMs = lockedUntilMs > 0
    ? Math.max(80, Math.min(5000, lockedUntilMs - Date.now() + 50))
    : 120;

  morpionTrace("botTurnWatchScheduled", {
    activeSeat,
    lockedUntilMs,
    delayMs,
    currentPlayer: safeInt(currentRoomData?.currentPlayer, -1),
    lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
  });

  botTurnNudgeTimer = window.setTimeout(() => {
    const throttleState = shouldThrottleTurnNudge("bot");
    if (throttleState.throttled) return;
    morpionTrace("botTurnWatchFired", {
      activeSeat,
      lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
      turnLockedUntilMs: safeInt(currentRoomData?.turnLockedUntilMs, 0),
      nudgeKey: throttleState.key,
    });
    void pingPresence("botTurnNudge");
  }, delayMs);
}

async function maybeAckStartReveal() {
  if (!currentRoomId || startRevealAcked || currentRoomData?.startRevealPending !== true || currentRoomData?.status !== "playing") return;
  startRevealAcked = true;
  try {
      await ackRoomStartSeenMorpionCallable({ roomId: currentRoomId });
  } catch (error) {
    startRevealAcked = false;
    morpionIncident("ackStartRevealFailed", {
      message: error?.message || String(error),
      currentPlayer: safeInt(currentRoomData?.currentPlayer, -1),
      lastActionSeq: safeInt(currentRoomData?.lastActionSeq, 0),
    });
  }
}

async function ensureRoomReady() {
  if (!currentRoomId || ensuringRoom || currentRoomData?.status !== "waiting") return;
  const humanCount = safeInt(currentRoomData?.humanCount, 0);
  if (humanCount < 2) return;
  ensuringRoom = true;
  try {
      await ensureRoomReadyMorpionCallable({ roomId: currentRoomId });
  } catch (error) {
    morpionIncident("ensureRoomReadyFailed", {
      message: error?.message || String(error),
      waitingDeadlineMs: safeInt(currentRoomData?.waitingDeadlineMs, 0),
      humanCount: safeInt(currentRoomData?.humanCount, 0),
      botCount: safeInt(currentRoomData?.botCount, 0),
    });
  } finally {
    ensuringRoom = false;
    if (currentRoomId && currentRoomData?.status === "waiting") {
      scheduleEnsureRoomReady();
    }
  }
}

function scheduleEnsureRoomReady() {
  stopWaitingEnsureTimer();
  if (!currentRoomId || currentRoomData?.status !== "waiting") return;
  const humanCount = safeInt(currentRoomData?.humanCount, 0);
  if (humanCount < 2) return;
  const waitingDeadlineMs = safeInt(currentRoomData?.waitingDeadlineMs, 0);
  const delayMs = waitingDeadlineMs > 0
    ? Math.max(350, Math.min(30000, waitingDeadlineMs - Date.now() + 80))
    : 800;
  waitingEnsureTimer = window.setTimeout(() => {
    void ensureRoomReady();
  }, delayMs);
}

async function claimRewardIfNeeded() {
  if (rewardClaiming || rewardClaimed || !currentRoomId) return;
  const winnerSeat = safeInt(currentRoomData?.winnerSeat, -1);
  const endedReason = String(currentRoomData?.endedReason || currentGameState?.endedReason || "").trim();
  const isRefundClaim = endedReason === "no_play_refund" || endedReason === "quit_refund_before_opening";
  if (!isRefundClaim && winnerSeat !== currentSeatIndex) return;
  rewardClaiming = true;
  try {
    let fundingBefore = null;
    try {
      fundingBefore = await getDepositFundingStatusSecure({});
    } catch (_) {
    }
    morpionTrace("settlement:claim:start", {
      roomId: currentRoomId,
      currentSeatIndex,
      winnerSeat,
      endedReason,
      rewardAmountDoes: safeInt(currentRoomData?.rewardAmountDoes, 0),
      fundingBefore: summarizeFundingStatusForDebug(fundingBefore),
    });
      const result = await claimWinRewardMorpionCallable({ roomId: currentRoomId });
    let fundingAfter = null;
    try {
      fundingAfter = await getDepositFundingStatusSecure({});
    } catch (_) {
    }
    morpionTrace("settlement:claim:result", {
      roomId: currentRoomId,
      result,
      fundingAfter: summarizeFundingStatusForDebug(fundingAfter),
    });
    rewardClaimed = result?.rewardGranted === true
      || result?.reason === "already_paid"
      || result?.reason === "already_refunded"
      || result?.reason === "no_reward";
    if (!rewardClaimed && Array.isArray(result?.refunds) && result.refunds.length > 0) {
      rewardClaimed = true;
    }
    await refreshWalletState("settlement-claim");
  } catch (error) {
    morpionIncident("settlement:claim:error", {
      roomId: currentRoomId,
      code: error?.code || "",
      message: error?.message || "",
      details: error?.details || null,
    });
  } finally {
    rewardClaiming = false;
  }
}

function handleEndedState() {
  closeWaitingModal();
  const debugUid = String(currentUser?.uid || "").trim();
  morpionTrace("end:state", {
    roomId: currentRoomId,
    currentSeatIndex,
    winnerSeat: safeInt(currentRoomData?.winnerSeat, -1),
    winnerUid: String(currentRoomData?.winnerUid || currentGameState?.winnerUid || "").trim(),
    endedReason: String(currentRoomData?.endedReason || currentGameState?.endedReason || "").trim(),
    rewardAmountDoes: safeInt(currentRoomData?.rewardAmountDoes, 0),
    rewardAmountHtg: doesToHtgAmount(safeInt(currentRoomData?.rewardAmountDoes, 0)),
    status: String(currentRoomData?.status || ""),
    moveCount: safeInt(currentGameState?.moveCount, 0),
    placedCountBySeat: [0, 1].map((seat) => safeInt((currentGameState?.placedCountBySeat || [])[seat], 0)),
    roomEntryFundingCurrency: String(currentRoomData?.entryFundingCurrencyByUid?.[debugUid] || ""),
    roomEntryFunding: currentRoomData?.entryFundingByUid?.[debugUid] || null,
    roomRefundDebug: currentRoomData?.debugLastNoPlayRefundByUid?.[debugUid] || null,
  });
  void logFundingSnapshotForDebug("end:balance-snapshot", {
    winnerSeat: safeInt(currentRoomData?.winnerSeat, -1),
    endedReason: String(currentRoomData?.endedReason || currentGameState?.endedReason || "").trim(),
    moveCount: safeInt(currentGameState?.moveCount, 0),
    placedCountBySeat: [0, 1].map((seat) => safeInt((currentGameState?.placedCountBySeat || [])[seat], 0)),
    roomEntryFundingCurrency: String(currentRoomData?.entryFundingCurrencyByUid?.[debugUid] || ""),
    roomEntryFunding: currentRoomData?.entryFundingByUid?.[debugUid] || null,
    roomRefundDebug: currentRoomData?.debugLastNoPlayRefundByUid?.[debugUid] || null,
  });
  void refreshWalletState("room-ended");
  void claimRewardIfNeeded();
  const endKey = [
    currentRoomId,
    safeInt(currentRoomData?.lastActionSeq, 0),
    String(currentRoomData?.endedReason || currentGameState?.endedReason || "").trim(),
    safeInt(currentRoomData?.winnerSeat, -1),
    getFriendMorpionRematchRequestUids().slice().sort().join(","),
  ].join(":");
  if (lastHandledEndKey === endKey) return;
  lastHandledEndKey = endKey;

  const winnerSeat = safeInt(currentRoomData?.winnerSeat, -1);
  const endedReason = String(currentRoomData?.endedReason || currentGameState?.endedReason || "").trim();
  pendingEndModalPayload = buildEndModalPayload();
  stopEndResultTimer();

  if (endedReason === "line") {
    hideRevealResultButton();
    hideWinLine();
    endResultTimer = window.setTimeout(() => {
      endResultTimer = null;
      winLineVisible = true;
      renderWinningLine();
      showRevealResultButton();
    }, 240);
    return;
  }

  winLineVisible = false;
  hideWinLine();
  hideRevealResultButton();
  endResultTimer = window.setTimeout(() => {
    endResultTimer = null;
    if (!pendingEndModalPayload) return;
    openPendingEndModal();
  }, winnerSeat === currentSeatIndex ? 140 : 140);
}

function renderFromRoom() {
  renderPlayerCards();
  renderWalletValue();
  renderTimers();
  renderBoard();
  renderWinningLine();
  scheduleBotTurnNudge();
  scheduleTurnTimeoutNudge();

  if (!currentRoomData) return;
  if (currentRoomData.status === "waiting") {
    clearEndStateDecorations();
    scheduleEnsureRoomReady();
    renderMatchmakingWaitingModal();
    return;
  }
  stopWaitingEnsureTimer();

  if (currentRoomData.status === "playing" && currentRoomData.startRevealPending === true) {
    clearEndStateDecorations();
    closeResultModal();
    closeQuitModal();
    closeWaitingModal();
    stopFriendRematchSync();
    void maybeAckStartReveal();
    return;
  }

  if (currentRoomData.status === "playing") {
    resetMatchmakingWaitState();
    clearEndStateDecorations();
    closeResultModal();
    closeQuitModal();
    closeWaitingModal();
    stopFriendRematchSync();
    return;
  }

  if (currentRoomData.status === "ended") {
    resetMatchmakingWaitState();
    handleEndedState();
  }
}

function subscribeToClient(uid) {
  stopClientSubscription();
  if (!uid) {
    currentHtgBalance = null;
    renderWalletValue();
    return;
  }

  clientUnsub = onSnapshot(doc(db, "clients", uid), (clientSnap) => {
    const clientData = clientSnap.exists() ? (clientSnap.data() || {}) : {};
    currentHtgBalance = Math.max(
      0,
      Math.trunc(
        Number(clientData?.approvedHtgAvailable)
        + Number(clientData?.provisionalHtgAvailable)
      ) || 0
    );
    renderWalletValue();
  }, () => {
    currentHtgBalance = null;
    renderWalletValue();
  });
}

function subscribeToRoom(roomId) {
  stopRoomSubscriptions();
  stopBotTurnNudgeTimer();
  stopTurnTimeoutNudgeTimer();

  roomUnsub = onSnapshot(doc(db, MORPION_ROOMS, roomId), (roomSnap) => {
    if (!roomSnap.exists()) {
      morpionIncident("roomSnapshotMissing", { source: "roomSub" });
      return;
    }
    const previousRoomData = currentRoomData;
    currentRoomData = roomSnap.data() || {};
    currentRoomId = roomId;
    currentSeatIndex = safeInt(currentRoomData?.seats?.[currentUser?.uid], currentSeatIndex);
    const previousStatus = String(previousRoomData?.status || "").trim();
    const nextStatus = String(currentRoomData?.status || "").trim();
    const previousStartedAtMs = safeInt(previousRoomData?.startedAtMs, 0);
    const nextStartedAtMs = safeInt(currentRoomData?.startedAtMs, 0);
    if (
      nextStatus === "playing"
      && (
        previousStatus === "ended"
        || previousStartedAtMs !== nextStartedAtMs
      )
    ) {
      resetForStartedFriendRematch();
    }
    traceRoomTransition("roomSub");
    renderFromRoom();
  }, (error) => {
    console.error("[MORPION] room snapshot failed", error);
    morpionIncident("roomSnapshotFailed", { message: error?.message || String(error) });
  });

  stateUnsub = onSnapshot(doc(db, MORPION_GAME_STATES, roomId), (stateSnap) => {
    currentGameState = stateSnap.exists() ? (stateSnap.data() || {}) : null;
    traceStateTransition("stateSub");
    renderBoard();
    renderFromRoom();
  }, (error) => {
    console.error("[MORPION] state snapshot failed", error);
    morpionIncident("stateSnapshotFailed", { message: error?.message || String(error) });
  });
}

async function submitCell(cellIndex) {
  if (!currentRoomId || actionSending || !isMyTurn()) return;
  actionSending = true;
  try {
    const clientActionId = `morpion_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const result = await submitActionMorpionCallable({
      roomId: currentRoomId,
      clientActionId,
      action: { cellIndex },
    });
    if (String(result?.status || "").trim().toLowerCase() === "ended") {
      morpionTrace("action:submit:end", {
        roomId: currentRoomId,
        cellIndex,
        clientActionId,
        seq: safeInt(result?.seq, 0),
        winnerSeat: safeInt(result?.winnerSeat, -1),
        winnerUid: String(result?.winnerUid || "").trim(),
        endedReason: String(result?.endedReason || "").trim(),
        settlement: result?.settlement || null,
      });
      await refreshWalletState("submit-ended");
    }
  } catch (error) {
    morpionIncident("action:submit:error", {
      cellIndex,
      roomId: currentRoomId,
      code: error?.code || "",
      message: error?.message || String(error),
      details: error?.details || null,
    });
  } finally {
    actionSending = false;
  }
}

async function leaveCurrentRoom() {
  if (!currentRoomId || leavingRoom) return;
  const roomIdBeforeLeave = currentRoomId;
  leavingRoom = true;
  try {
    morpionTrace("leave:start", {
      roomId: roomIdBeforeLeave,
      status: String(currentRoomData?.status || ""),
      endedReason: String(currentRoomData?.endedReason || currentGameState?.endedReason || "").trim(),
      winnerSeat: safeInt(currentRoomData?.winnerSeat, -1),
      moveCount: safeInt(currentGameState?.moveCount, 0),
      placedCountBySeat: [0, 1].map((seat) => safeInt((currentGameState?.placedCountBySeat || [])[seat], 0)),
    });
    const result = await leaveRoomMorpionCallable({ roomId: roomIdBeforeLeave });
    morpionTrace("leave:result", {
      roomId: roomIdBeforeLeave,
      result,
    });
    await refreshWalletState("leave");
    void logFundingSnapshotForDebug("leave:balance-snapshot", {
      roomId: roomIdBeforeLeave,
      leaveResult: result || null,
    });
  } catch (error) {
    morpionIncident("leave:error", {
      roomId: roomIdBeforeLeave,
      code: error?.code || "",
      message: error?.message || String(error || ""),
      details: error?.details || null,
    });
  } finally {
    leavingRoom = false;
  }
}

async function abandonAndNavigate(destination = "home") {
  morpionTrace("nav:abandon:start", {
    destination,
    roomId: currentRoomId,
    status: String(currentRoomData?.status || ""),
    endedReason: String(currentRoomData?.endedReason || currentGameState?.endedReason || "").trim(),
    moveCount: safeInt(currentGameState?.moveCount, 0),
    placedCountBySeat: [0, 1].map((seat) => safeInt((currentGameState?.placedCountBySeat || [])[seat], 0)),
  });
  if (currentRoomId) {
    markRoomAbandoned(currentRoomId);
  }
  await leaveCurrentRoom();
  void logFundingSnapshotForDebug("nav:abandon:after-leave", {
    destination,
  });
  if (destination === "home") {
    window.setTimeout(() => {
      void logFundingSnapshotForDebug("nav:abandon:after-leave:delayed", {
        destination,
      });
    }, 1200);
  }
  if (destination === "replay") {
    const roomMode = String(currentRoomData?.roomMode || "").trim();
    if (
      isFriendMorpionFlowFromUrl()
      || isBotTestMorpionFlowFromUrl()
      || roomMode === "morpion_friends"
      || roomMode === "morpion_bot_test"
    ) {
      window.location.href = "./index.html";
      return;
    }
    window.location.href = buildPublicMorpionReplayUrl();
    return;
  }
  window.location.href = "./index.html";
}

async function joinOrResumeRoom() {
  if (joining || !currentUser?.uid) return;
  joining = true;
  rewardClaimed = false;
  startRevealAcked = false;
  lastHandledEndKey = "";
  clearEndStateDecorations();
  closeResultModal();
  closeQuitModal();
  openWaitingModal("Koneksyon an ap fèt...", "Nou ap chèche yon chanm Mopyon ki disponib.");
  void logFundingSnapshotForDebug("join:preflight", {
    uid: currentUser?.uid || "",
    fundingCurrency: REQUESTED_FUNDING_CURRENCY,
    selectedStakeDoes,
    selectedStakeHtg: Math.floor(Math.max(0, selectedStakeDoes) / 20),
    excludeRoomIds: readAbandonedRoomIds(),
  });

  try {
    try {
      debugJoinFundingPreflight = summarizeFundingStatusForDebug(await getDepositFundingStatusSecure({}));
    } catch (_) {
      debugJoinFundingPreflight = null;
    }
      const result = await joinMatchmakingMorpionCallable({
      stakeDoes: selectedStakeDoes,
      fundingCurrency: REQUESTED_FUNDING_CURRENCY,
      excludeRoomIds: readAbandonedRoomIds(),
    });
    morpionTrace("join:result", {
      requestedFundingCurrency: REQUESTED_FUNDING_CURRENCY,
      requestedStakeDoes: selectedStakeDoes,
      roomId: String(result?.roomId || "").trim(),
      seatIndex: safeInt(result?.seatIndex, 0),
      status: String(result?.status || "").trim(),
      started: result?.started === true,
      startRevealPending: result?.startRevealPending === true,
      humanCount: safeInt(result?.humanCount, 0),
      botCount: safeInt(result?.botCount, 0),
    });
    await refreshWalletState("join");
    void logFundingSnapshotForDebug("join:after-join", {
      requestedFundingCurrency: REQUESTED_FUNDING_CURRENCY,
      requestedStakeDoes: selectedStakeDoes,
      roomId: String(result?.roomId || "").trim(),
      seatIndex: safeInt(result?.seatIndex, 0),
      status: String(result?.status || "").trim(),
    });
    try {
      debugJoinFundingAfterCharge = summarizeFundingStatusForDebug(await getDepositFundingStatusSecure({}));
    } catch (_) {
      debugJoinFundingAfterCharge = null;
    }
    currentRoomId = String(result?.roomId || "").trim();
    currentSeatIndex = safeInt(result?.seatIndex, 0);
    clearRoomAbandoned(currentRoomId);
    subscribeToRoom(currentRoomId);
    startPresencePing();
    startTurnTicker();
    void pingPresence();
    if (String(result?.status || "") === "waiting") {
      startMatchmakingWaitCycle();
    }
  } catch (error) {
    console.error("[MORPION] join failed", error);
    const reasonCode = String(error?.reason || error?.code || "").trim().toLowerCase();
    if (reasonCode === "morpion-skilled-wait-human-only") {
      openResultModal(
        "Pa gen jwè disponib",
        "Pa gen chanm moun",
        "Pa gen moun k ap jwe Mopyon kounye a. Retounen pi ta oswa eseye yon lòt jwèt."
      );
      return;
    }
    openResultModal("Koneksyon pa mache", "M pa ka antre nan yon chanm", error?.message || "Eseye ankò nan yon ti moman.");
  } finally {
    joining = false;
  }
}

async function resumeFriendMorpionFromUrl() {
  const friendRoomId = getFriendMorpionRoomIdFromUrl();
  if (!currentUser?.uid || joining || currentRoomId || !friendRoomId) return;
  joining = true;
  rewardClaimed = false;
  startRevealAcked = false;
  lastHandledEndKey = "";
  clearEndStateDecorations();
  closeResultModal();
  closeQuitModal();
  openWaitingModal("Koneksyon an ap fèt...", "Nou ap antre nan chanm prive Mopyon an.");

  try {
    const result = await resumeFriendMorpionRoomSecure({ roomId: friendRoomId });
    subscribeToClient(currentUser.uid);
    currentRoomId = String(result?.roomId || friendRoomId).trim();
    currentSeatIndex = safeInt(result?.seatIndex, 0);
    clearRoomAbandoned(currentRoomId);
    subscribeToRoom(currentRoomId);
    startPresencePing();
    startTurnTicker();
    void pingPresence();
  } catch (error) {
    console.error("[MORPION] resumeFriendMorpionFromUrl failed", error);
    openResultModal("Koneksyon pa mache", "M pa ka antre nan chanm prive sa a", error?.message || "Eseye ankò nan yon ti moman.");
  } finally {
    joining = false;
  }
}

async function requestFriendMorpionRematch() {
  if (!currentRoomId || rematchRequestInFlight) return;
  rematchRequestInFlight = true;
  syncReplayActionLabels();
  try {
    const result = await requestFriendMorpionRematchSecure({ roomId: currentRoomId });
    if (result?.started === true) {
      closeResultModal();
      openWaitingModal("Nouvo won", "Tou de jwè yo dakò. Nou relanse pati a...");
      if (dom.waitingTimerWrap) dom.waitingTimerWrap.classList.add("hidden");
      if (dom.waitingActions) dom.waitingActions.classList.add("hidden");
      startFriendRematchSync();
      return;
    }
    closeResultModal();
    openWaitingModal("Nou mande revanj", "M ap tann lòt jwè a pou nou rekòmanse pati a.");
    if (dom.waitingTimerWrap) dom.waitingTimerWrap.classList.add("hidden");
    if (dom.waitingActions) dom.waitingActions.classList.add("hidden");
    startFriendRematchSync();
  } catch (error) {
    const errorMessage = String(error?.message || "").trim().toLowerCase();
    if (errorMessage.includes("lot jwe a fe lach li kouri")) {
      openResultModal("Fen pati", "Lòt jwè a pran kouri", "Lòt jwè a pran kouri.");
      return;
    }
    openResultModal("Koneksyon pa mache", "M pa ka mande revanj", formatResultErrorCopy(error, "Eseye ankò nan yon ti moman."));
  } finally {
    rematchRequestInFlight = false;
    syncReplayActionLabels();
  }
}

async function resumeMorpionBotTestFromUrl() {
  const botTestRoomId = getBotTestMorpionRoomIdFromUrl();
  if (!currentUser?.uid || joining || currentRoomId || !botTestRoomId) return;
  joining = true;
  rewardClaimed = false;
  startRevealAcked = false;
  lastHandledEndKey = "";
  clearEndStateDecorations();
  closeResultModal();
  closeQuitModal();
  openWaitingModal("Koneksyon an ap fèt...", "Nou ap prepare chanm tès ou kont bot la.");

  try {
    const result = await resumeMorpionBotTestRoomSecure({ roomId: botTestRoomId });
    subscribeToClient(currentUser.uid);
    currentRoomId = String(result?.roomId || botTestRoomId).trim();
    currentSeatIndex = safeInt(result?.seatIndex, 0);
    clearRoomAbandoned(currentRoomId);
    subscribeToRoom(currentRoomId);
    startPresencePing();
    startTurnTicker();
    void pingPresence();
  } catch (error) {
    console.error("[MORPION] resumeMorpionBotTestFromUrl failed", error);
    openResultModal("Koneksyon pa mache", "M pa ka antre nan chanm tès sa a", formatResultErrorCopy(error, "Eseye ankò nan yon ti moman."));
  } finally {
    joining = false;
  }
}

async function startMorpionBotTestFromUrl() {
  if (!currentUser?.uid || joining || currentRoomId) return;
  joining = true;
  rewardClaimed = false;
  startRevealAcked = false;
  lastHandledEndKey = "";
  clearEndStateDecorations();
  closeResultModal();
  closeQuitModal();
  openWaitingModal("Koneksyon an ap fèt...", "Nou ap prepare chanm tès ou kont bot la.");

  let didForceLeave = false;
  try {
    const result = await createMorpionBotTestRoomSecure({});
    subscribeToClient(currentUser.uid);
    currentRoomId = String(result?.roomId || "").trim();
    currentSeatIndex = safeInt(result?.seatIndex, 0);
    if (!currentRoomId) {
      throw new Error("Salle de test morpion introuvable.");
    }
    clearRoomAbandoned(currentRoomId);
    subscribeToRoom(currentRoomId);
    startPresencePing();
    startTurnTicker();
    void pingPresence();
  } catch (error) {
    const reasonCode = String(error?.code || "").trim().toLowerCase();
    if (reasonCode === "active-room-exists" && error?.roomId) {
      const roomMode = String(error?.roomMode || "").trim();
      if (roomMode === "morpion_bot_test") {
        window.location.href = buildMorpionBotTestGameUrl(String(error.roomId || "").trim(), Number.parseInt(String(error?.seatIndex || 0), 10) || 0);
        return;
      }
      if (!didForceLeave) {
        didForceLeave = true;
        try {
      await leaveRoomMorpionCallable({ roomId: String(error.roomId || "").trim() });
        } catch (_) {
        }
        try {
          const retry = await createMorpionBotTestRoomSecure({});
          subscribeToClient(currentUser.uid);
          currentRoomId = String(retry?.roomId || "").trim();
          currentSeatIndex = safeInt(retry?.seatIndex, 0);
          if (!currentRoomId) {
            throw new Error("Salle de test morpion introuvable.");
          }
          clearRoomAbandoned(currentRoomId);
          subscribeToRoom(currentRoomId);
          startPresencePing();
          startTurnTicker();
          void pingPresence();
          return;
        } catch (retryError) {
          console.error("[MORPION] startMorpionBotTestFromUrl retry failed", retryError);
        }
      }
    }
    console.error("[MORPION] startMorpionBotTestFromUrl failed", error);
    openResultModal("Koneksyon pa mache", "M pa ka kreye chanm tès la", formatResultErrorCopy(error, "Eseye ankò nan yon ti moman."));
  } finally {
    joining = false;
  }
}

function syncReplayActionLabels() {
  const roomMode = String(currentRoomData?.roomMode || "").trim();
  const isFriendReplayWaiting = isFriendMorpionRoomFlow()
    && String(currentRoomData?.status || "") === "ended"
    && hasCurrentUserRequestedFriendRematch();
  const replayLabel = isFriendReplayWaiting
    ? "M ap tann..."
    : (isBotTestMorpionFlowFromUrl() || roomMode === "morpion_bot_test"
    ? "Nouvo tès bot"
    : ((isFriendMorpionFlowFromUrl() || roomMode === "morpion_friends")
      ? "Nouvo chanm prive"
      : "Rejwe"));
  if (dom.resultReplayBtn) dom.resultReplayBtn.textContent = replayLabel;
  if (dom.quitReplayBtn) dom.quitReplayBtn.textContent = replayLabel;
  syncFriendRematchActionState();
}

function joinOrResumeCurrentFlow() {
  if (isBotTestMorpionFlowFromUrl()) {
    if (getBotTestMorpionRoomIdFromUrl().length > 0) {
      void resumeMorpionBotTestFromUrl();
    } else {
      void startMorpionBotTestFromUrl();
    }
    return;
  }
  if (isFriendMorpionFlowFromUrl()) {
    void resumeFriendMorpionFromUrl();
    return;
  }
  void joinOrResumeRoom();
}

function bindEvents() {
  dom.board?.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".cell") : null;
    if (!(target instanceof HTMLElement)) return;
    const cellIndex = safeInt(target.dataset.index, -1);
    if (cellIndex < 0) return;
    void submitCell(cellIndex);
  });

  dom.quitBtn?.addEventListener("click", openQuitModal);
  dom.quitReplayBtn?.addEventListener("click", () => { closeQuitModal(); });
  dom.quitHomeBtn?.addEventListener("click", () => { void abandonAndNavigate("home"); });
  dom.quitCloseTargets.forEach((target) => target.addEventListener("click", closeQuitModal));
  dom.revealResultBtn?.addEventListener("click", openPendingEndModal);
  dom.resultReplayBtn?.addEventListener("click", () => {
    if (isFriendMorpionRoomFlow() && String(currentRoomData?.status || "") === "ended") {
      void requestFriendMorpionRematch();
      return;
    }
    void abandonAndNavigate("replay");
  });
  dom.resultHomeBtn?.addEventListener("click", () => { void abandonAndNavigate("home"); });
  dom.inviteAcceptBtn?.addEventListener("click", () => { void respondInvite("accept"); });
  dom.inviteRefuseBtn?.addEventListener("click", () => { void respondInvite("refuse"); });
  dom.waitingRetryBtn?.addEventListener("click", () => {
    void abandonAndNavigate("replay");
  });
  dom.waitingExtendBtn?.addEventListener("click", () => {
    matchmakingExtendedWaiting = true;
    renderMatchmakingWaitingModal();
  });
  dom.waitingStopExtendBtn?.addEventListener("click", () => {
    matchmakingExtendedWaiting = false;
    void abandonAndNavigate("home");
  });
  dom.waitingHomeBtn?.addEventListener("click", () => {
    void abandonAndNavigate("home");
  });
  dom.waitingNotifyBtn?.addEventListener("click", () => {
    void requestMatchmakingNotifications();
  });
  dom.waitingGroupBtn?.addEventListener("click", () => {
    if (typeof window === "undefined") return;
    window.open(MORPION_WHATSAPP_GROUP_URL, "_blank", "noopener,noreferrer");
  });
  dom.waitingWhatsappBtn?.addEventListener("click", () => {
    if (!whatsappPreferenceLoaded) {
      void loadWhatsappPreference(true);
    }
    openWhatsappModal();
  });
  dom.waitingContactsBtn?.addEventListener("click", () => {
    void openContactsModal();
  });
  dom.whatsappSaveBtn?.addEventListener("click", () => {
    void saveWhatsappPreference();
  });
  dom.whatsappRemoveBtn?.addEventListener("click", () => {
    void removeWhatsappPreference();
  });
  dom.whatsappCloseBtn?.addEventListener("click", closeWhatsappModal);
  dom.whatsappCloseTargets.forEach((target) => target.addEventListener("click", closeWhatsappModal));
  dom.contactsCloseBtn?.addEventListener("click", closeContactsModal);
  dom.contactsCloseTargets.forEach((target) => target.addEventListener("click", closeContactsModal));
  dom.contactsList?.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("[data-contact-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    const action = String(target.dataset.contactAction || "").trim();
    if (action !== "copy") return;
    const number = String(target.dataset.contactNumber || "").trim();
    void copyToClipboard(number).then((copied) => {
      if (copied) {
      target.textContent = "Kopye!";
      window.setTimeout(() => {
          target.textContent = "Kopye";
        }, 1200);
      }
    });
  });
  dom.ruleContinueBtn?.addEventListener("click", () => {
    turnRuleAccepted = true;
    closeRuleModal();
    if (currentUser?.uid) {
      joinOrResumeCurrentFlow();
    }
  });

  window.addEventListener("pagehide", () => {
    stopSitePresencePing();
    if (currentRoomId) {
      markRoomAbandoned(currentRoomId);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void pingPresence();
      void touchClientSitePresence();
    }
  });

  window.addEventListener("resize", renderWinningLine);
}

function init() {
  createBoard();
  bindEvents();
  startTurnTicker();
  startInvitePoll();
  renderWalletValue();
  openRuleModal();
  onAuthStateChanged(auth, (user) => {
    currentUser = user || null;
    if (!currentUser) {
      stopSitePresencePing();
      stopInvitePoll();
      closeInviteModal();
      stopClientSubscription();
      window.location.href = "./auth.html";
      return;
    }
    void ensureXchangeState(currentUser.uid).then(() => renderWalletValue()).catch(() => {});
    startSitePresencePing();
    startInvitePoll();
    void pollActiveInvite();
    subscribeToClient(currentUser.uid);
    void loadWhatsappPreference(true);
    if (!turnRuleAccepted) {
      openRuleModal();
      return;
    }
    joinOrResumeCurrentFlow();
  });
}

window.addEventListener("xchangeUpdated", () => {
  renderWalletValue();
});

window.addEventListener("userBalanceUpdated", () => {
  renderWalletValue();
});

init();
