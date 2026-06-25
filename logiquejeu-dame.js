import {
  auth,
  db,
  collection,
  doc,
  orderBy,
  onSnapshot,
  onAuthStateChanged,
  query,
} from "./firebase-init.js";
import {
  joinMatchmakingDameSecure,
  createFriendDameRoomSecure,
  joinFriendDameRoomByCodeSecure,
  resumeFriendDameRoomSecure,
  ensureRoomReadyDameSecure,
  touchRoomPresenceDameSecure,
  leaveRoomDameSecure,
  submitActionDameSecure,
  finalizeDameMatchSecure,
  restartDameAfterDrawSecure,
  requestFriendDameRematchSecure,
  recordDameMatchResultSecure,
  getPublicWhatsappModalConfigSecure,
  updateClientProfileSecure,
} from "./secure-functions.js?v=20260625-dame-firebase1";
import { ensureXchangeState, getXchangeState } from "./xchange.js";
import { mountNetworkQualityIndicator } from "./network-quality-indicator.js?v=20260605-network2";

const urlParams = new URLSearchParams(window.location.search);
const dameNetworkQualityIndicator = mountNetworkQualityIndicator({
  mountSelector: ".game-topbar-actions",
  inline: true,
  debugLabel: "DAME_NETWORK_QUALITY",
});

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatHtg(value) {
  return `${safeInt(value, 0)} HTG`;
}

const PUBLIC_DAME_ROOM_MODE = "dame_2p";
const DEFAULT_PUBLIC_DAME_STAKE_DOES = 500;
const DAME_PRESENCE_PING_INTERVAL_MS = 20000;
const DAME_UI_WATCHDOG_INTERVAL_MS = 1200;
const DAME_SLOW_SUBMIT_NOTICE_MS = 5000;

function normalizeInviteCode(value = "") {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
}

function normalizeDameRoomMode(value = "") {
  return String(value || "").trim().toLowerCase() === "dame_friends"
    ? "dame_friends"
    : PUBLIC_DAME_ROOM_MODE;
}

function normalizeFriendFlowAction(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "create" || normalized === "join" ? normalized : "";
}

const initialStakeDoes = Number.parseInt(String(urlParams.get("stake") || `${DEFAULT_PUBLIC_DAME_STAKE_DOES}`), 10);
let activeStakeDoes = Number.isFinite(initialStakeDoes) && initialStakeDoes > 0
  ? initialStakeDoes
  : DEFAULT_PUBLIC_DAME_STAKE_DOES;
const fundingCurrency = String(urlParams.get("fundingCurrency") || "htg").trim().toLowerCase() === "htg"
  ? "htg"
  : "does";
const baseRoomMode = normalizeDameRoomMode(urlParams.get("roomMode") || PUBLIC_DAME_ROOM_MODE);

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("dameStatusBadge") || document.getElementById("botStatus");
const balanceEl = document.getElementById("dameBalanceBadge");
const turnTimerEl = document.getElementById("dameTurnTimer");
const opponentBadgeEl = document.getElementById("dameOpponentBadge");
const opponentNameEl = document.getElementById("dameOpponentName");
const searchOpponentBadgeEl = document.getElementById("dameSearchOpponentBadge");
const searchOpponentNameEl = document.getElementById("dameSearchOpponentName");
const searchOverlayEl = document.getElementById("dameSearchOverlay");
const searchCopyEl = document.getElementById("dameSearchCopy");
const searchCountdownEl = document.getElementById("dameSearchCountdown");
const searchFriendBoxEl = document.getElementById("dameSearchFriendBox");
const searchInviteCodeEl = document.getElementById("dameSearchInviteCode");
const searchCopyCodeBtn = document.getElementById("dameSearchCopyCodeBtn");
const expiredOverlayEl = document.getElementById("dameSearchExpiredOverlay");
const expiredAgentValue = document.getElementById("dameExpiredAgentValue");
const expiredRetryBtn = document.getElementById("dameExpiredRetryBtn");
const expiredHomeBtn = document.getElementById("dameExpiredHomeBtn");
const expiredStayBtn = document.getElementById("dameExpiredStayBtn");
const expiredPhoneRevealBtn = document.getElementById("dameExpiredPhoneRevealBtn");
const expiredViewNumberBtn = document.getElementById("dameExpiredViewNumberBtn");
const expiredNotifyBtn = document.getElementById("dameExpiredNotifyBtn");
const expiredPhoneBox = document.getElementById("dameExpiredPhoneBox");
const expiredPhoneInput = document.getElementById("dameExpiredPhoneInput");
const expiredPhoneSaveBtn = document.getElementById("dameExpiredPhoneSaveBtn");
const CLIENTS_COLLECTION = "clients";

let currentUid = "";
let startedAtMs = 0;
let submittedResultKey = "";
let currentRoomId = "";
let currentRoomMode = baseRoomMode;
let currentInviteCode = normalizeInviteCode(urlParams.get("inviteCode"));
let friendFlowAction = normalizeFriendFlowAction(urlParams.get("friendAction"));
let requestedFriendRoomId = String(urlParams.get("friendDameRoomId") || "").trim();
let currentRoomData = null;
let mySeatIndex = -1;
let roomUnsub = null;
let actionsUnsub = null;
let ensureTimer = null;
let presenceTimer = null;
let turnSyncTimer = null;
let uiWatchdogTimer = null;
let syncRetryTimer = null;
let balanceUnsub = null;
let searchTimer = null;
let currentWaitingDeadlineMs = 0;
let dameExpiredModalVisible = false;
let dameWhatsappConfigPromise = null;
let dameWhatsappAgentDigits = "";
let hasAuthUser = false;
let replayingRemoteAction = false;
let rebuildingBoardState = false;
let lastAppliedActionSeq = 0;
let isLeavingRoom = false;
let latestDameActionDocs = [];
let dameResultModal = null;
let dameRulesModal = null;
let dameResultShownForRoomId = "";
let dameFinalizeInFlight = false;
let dameDrawRestartInFlight = false;
let dameFriendRematchBusy = false;
let dameFriendRematchPending = false;
let pendingBootAfterRulesModal = false;
let dameHistoryGuardArmed = false;
let currentSearchCountdownOverride = "";
let dameActionSubmitting = false;
let dameActionSubmitStartedAtMs = 0;
let dameLiveIssueBanner = null;
let dameLiveIssueTimer = null;
let lastRoomSnapshotAtMs = 0;
let lastActionSnapshotAtMs = 0;
let lastBoardInteractionEnabled = false;
const dameRecordedHistoryKeys = new Set();

function formatDoes(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num).toLocaleString("fr-FR") : "--";
}

async function copyText(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {
  }
  try {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "readonly");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(input);
    return copied === true;
  } catch (_) {
    return false;
  }
}

function syncDameRoomUrl() {
  try {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("stake", String(Math.max(0, activeStakeDoes)));
    nextUrl.searchParams.set("fundingCurrency", String(fundingCurrency || "htg").trim().toLowerCase() === "htg" ? "htg" : "does");
    nextUrl.searchParams.set("stakeHtg", String(Math.max(0, Math.floor(Math.max(0, activeStakeDoes) / 20))));
    nextUrl.searchParams.set("roomMode", currentRoomMode);
    if (currentRoomMode === "dame_friends") {
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
      if (requestedFriendRoomId) {
        nextUrl.searchParams.set("friendDameRoomId", requestedFriendRoomId);
      } else {
        nextUrl.searchParams.delete("friendDameRoomId");
      }
    } else {
      nextUrl.searchParams.delete("friendAction");
      nextUrl.searchParams.delete("inviteCode");
      nextUrl.searchParams.delete("friendDameRoomId");
    }
    window.history.replaceState({}, "", nextUrl.toString());
  } catch (_) {
  }
}

function renderFriendSearchBox() {
  const shouldShow = currentRoomMode === "dame_friends" && !!currentInviteCode;
  if (searchFriendBoxEl) {
    searchFriendBoxEl.classList.toggle("hidden", !shouldShow);
  }
  if (searchInviteCodeEl && shouldShow) {
    searchInviteCodeEl.textContent = currentInviteCode;
  }
}

function getStakeHtgValue(valueDoes = activeStakeDoes) {
  return Math.max(0, Math.trunc((Number(valueDoes) || 0) / 20));
}

function syncActiveStakeFromRoomData(roomData = {}) {
  const roomStakeDoes = safeInt(roomData?.entryCostDoes || roomData?.stakeDoes);
  if (roomStakeDoes > 0) {
    activeStakeDoes = roomStakeDoes;
  }
}

function buildDameWaitingMessage({ roomData = currentRoomData || {}, opponentName = "" } = {}) {
  const safeOpponentName = String(opponentName || getOpponentName(roomData) || "").trim();
  const roomStakeDoes = safeInt(roomData?.entryCostDoes || roomData?.stakeDoes || activeStakeDoes);
  const stakeHtg = getStakeHtgValue(roomStakeDoes);
  if (currentRoomMode === "dame_friends") {
    if (safeOpponentName) {
      return `Zanmi ou ${safeOpponentName} deja nan salon prive a. Pati a pral komanse taler konsa.`;
    }
    const codePart = currentInviteCode ? ` Pataje kod ${currentInviteCode} la ak zanmi ou.` : "";
    return `Salon prive Dame a pare pou yon pati a ${stakeHtg} HTG.${codePart} Nou poko komanse match la.`;
  }
  if (safeOpponentName) {
    return `Advese w ${safeOpponentName} deja nan sal la. Pati a pral komanse taler konsa.`;
  }
  return "N ap chache yon lot jwe pou pati Dame ou a.";
}

function getDameFriendRematchRequestUids(roomData = currentRoomData || {}) {
  return Array.isArray(roomData?.rematchRequestUids)
    ? roomData.rematchRequestUids.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function hasLocalDameFriendRematchRequest(roomData = currentRoomData || {}) {
  const uid = String(currentUid || auth.currentUser?.uid || "").trim();
  return uid ? getDameFriendRematchRequestUids(roomData).includes(uid) : false;
}

function shouldHoldDameFriendRematch(roomData = currentRoomData || {}) {
  return currentRoomMode === "dame_friends"
    && String(roomData?.status || "").trim().toLowerCase() === "ended"
    && (dameFriendRematchPending || hasLocalDameFriendRematchRequest(roomData));
}

function buildDameFriendRematchWaitingMessage(roomData = currentRoomData || {}) {
  const opponentName = String(getOpponentName(roomData) || "").trim();
  if (opponentName) {
    return `Nou mande revanj la. N ap tann ${opponentName} konfime pou nou relanse menm salon prive a.`;
  }
  return "Nou mande revanj la. N ap tann lot jw a konfime pou nou relanse menm salon prive a.";
}

function updateStatus(text) {
  if (!statusEl) return;
  const nextText = String(text || "");
  statusEl.textContent = nextText;
  statusEl.title = nextText;
}

function isDamePlaying(roomData = currentRoomData || {}) {
  return String(roomData?.status || "").trim().toLowerCase() === "playing";
}

function getRoomCurrentPlayer(roomData = currentRoomData || {}) {
  return Number.isFinite(Number(roomData?.currentPlayer))
    ? Math.trunc(Number(roomData.currentPlayer))
    : -1;
}

function isLocalPlayerTurn(roomData = currentRoomData || {}) {
  const currentPlayer = getRoomCurrentPlayer(roomData);
  return isDamePlaying(roomData)
    && mySeatIndex >= 0
    && currentPlayer >= 0
    && getMySeatColor(roomData) === currentPlayer;
}

function ensureDameLiveIssueBanner() {
  if (dameLiveIssueBanner) return dameLiveIssueBanner;
  dameLiveIssueBanner = document.createElement("div");
  dameLiveIssueBanner.className = "dame-live-issue hidden";
  dameLiveIssueBanner.setAttribute("role", "status");
  dameLiveIssueBanner.setAttribute("aria-live", "polite");
  const host = document.getElementById("draughts") || boardEl?.parentElement || document.body;
  host?.parentElement?.insertBefore(dameLiveIssueBanner, host);
  return dameLiveIssueBanner;
}

function showDameLiveIssue(message = "", { autoHide = true } = {}) {
  const banner = ensureDameLiveIssueBanner();
  if (!banner) return;
  const text = String(message || "Synchro pati a pran reta. N ap rekonekte tablo a...").trim();
  banner.textContent = text;
  banner.classList.remove("hidden");
  updateStatus(text);
  if (dameLiveIssueTimer) {
    window.clearTimeout(dameLiveIssueTimer);
    dameLiveIssueTimer = null;
  }
  if (autoHide) {
    dameLiveIssueTimer = window.setTimeout(() => {
      banner.classList.add("hidden");
      dameLiveIssueTimer = null;
    }, 4500);
  }
}

function hideDameLiveIssue() {
  if (dameLiveIssueTimer) {
    window.clearTimeout(dameLiveIssueTimer);
    dameLiveIssueTimer = null;
  }
  if (dameLiveIssueBanner) {
    dameLiveIssueBanner.classList.add("hidden");
  }
}

function buildDameHistoryRecordKey(roomData = {}) {
  const roomId = String(roomData?.roomId || currentRoomId || "").trim();
  const endedAtMs = Number(roomData?.endedAtMs || roomData?.endedAt || 0);
  const winnerUid = String(roomData?.winnerUid || "").trim();
  const winnerSeat = Number.isFinite(Number(roomData?.winnerSeat)) ? Math.trunc(Number(roomData.winnerSeat)) : -1;
  const endedReason = String(roomData?.endedReason || "").trim().toLowerCase();
  if (!roomId || !endedAtMs) return "";
  return [roomId, endedAtMs, winnerUid || "none", winnerSeat, endedReason || "match_end"].join(":");
}

async function ensureDameHistoryRecorded(roomData = {}) {
  if (!currentUid) return;
  const status = String(roomData?.status || "").trim().toLowerCase();
  if (status !== "ended" && status !== "closed") return;

  const roomId = String(roomData?.roomId || currentRoomId || "").trim();
  const recordKey = buildDameHistoryRecordKey(roomData);
  if (!roomId || !recordKey || dameRecordedHistoryKeys.has(recordKey)) return;

  const winnerSeat = Number.isFinite(Number(roomData?.winnerSeat)) ? Math.trunc(Number(roomData.winnerSeat)) : -1;
  const playerUids = Array.isArray(roomData?.playerUids)
    ? roomData.playerUids.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 2)
    : [];
  const winnerUid = String(roomData?.winnerUid || "").trim()
    || (winnerSeat >= 0 && winnerSeat < playerUids.length ? String(playerUids[winnerSeat] || "").trim() : "");
  const endedReason = String(roomData?.endedReason || "match_end").trim().toLowerCase() || "match_end";
  const isRefundResult = endedReason === "timeout_refund" || endedReason === "quit_refund_before_opening";
  const rewardAmountDoes = isRefundResult
    ? 0
    : Math.max(0, Number(roomData?.rewardAmountDoes || roomData?.rewardDoes || 0) || 0);
  const explicitRewardHtg = Number(roomData?.rewardAmountHtg);
  const rewardAmountHtg = Number.isFinite(explicitRewardHtg)
    ? (isRefundResult ? 0 : Math.max(0, Math.trunc(explicitRewardHtg)))
    : Math.max(0, Math.floor(rewardAmountDoes / 20));
  const endedAtMs = Number(roomData?.endedAtMs || roomData?.endedAt || Date.now()) || Date.now();
  const startedAtMsValue = Number(roomData?.startedAtMs || startedAtMs || 0);
  try {
    await recordDameMatchResultSecure({
      matchId: `dame_room_${roomId}_${endedAtMs}`,
      roomId,
      roomMode: String(roomData?.roomMode || currentRoomMode || PUBLIC_DAME_ROOM_MODE).trim() || PUBLIC_DAME_ROOM_MODE,
      stakeDoes: Math.max(0, Number(roomData?.entryCostDoes || roomData?.stakeDoes || activeStakeDoes || 0) || 0),
      stakeHtg: Math.max(0, Math.trunc(Number(roomData?.stakeHtg || Math.floor((Number(roomData?.entryCostDoes || roomData?.stakeDoes || activeStakeDoes || 0) || 0) / 20)) || 0)),
      fundingCurrency: String(roomData?.fundingCurrency || fundingCurrency || "htg").trim().toLowerCase(),
      winnerSeat,
      winnerUid,
      playerUids,
      winnerType: "human",
      humanCount: playerUids.length || 2,
      botCount: 0,
      rewardAmountDoes,
      rewardAmountHtg,
      startedAtMs: startedAtMsValue > 0 ? startedAtMsValue : 0,
      endedAtMs,
      endedReason,
    });
    dameRecordedHistoryKeys.add(recordKey);
  } catch (error) {
    console.warn("[DAME] echec enregistrement historique resultat", error);
  }
}

function renderTurnTimer(roomData = currentRoomData || {}) {
  if (!turnTimerEl) return;
  const status = String(roomData?.status || "").trim().toLowerCase();
  if (status !== "playing") {
    turnTimerEl.textContent = "Tan kou: --";
    turnTimerEl.title = "Tan kou: --";
    turnTimerEl.classList.remove("danger");
    return;
  }

  const deadlineMs = Number(roomData?.turnDeadlineMs || 0);
  const currentColor = Number.isFinite(Number(roomData?.currentPlayer)) ? Math.trunc(Number(roomData.currentPlayer)) : -1;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || currentColor < 0) {
    turnTimerEl.textContent = "Tan kou: --";
    turnTimerEl.title = "Tan kou: --";
    turnTimerEl.classList.remove("danger");
    return;
  }

  const remainingSec = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
  const myTurn = mySeatIndex >= 0 && getMySeatColor(roomData) === currentColor;
  if (dameActionSubmitting && myTurn) {
    const syncText = "Tan ou: sync...";
    turnTimerEl.textContent = syncText;
    turnTimerEl.title = syncText;
    turnTimerEl.classList.add("danger");
    return;
  }
  const timerText = `${myTurn ? "Tan ou" : "Tan advese a"}: ${remainingSec}s`;
  turnTimerEl.textContent = timerText;
  turnTimerEl.title = timerText;
  if (remainingSec <= 10) {
    turnTimerEl.classList.add("danger");
  } else {
    turnTimerEl.classList.remove("danger");
  }
}

function buildDameReplayUrl() {
  const params = new URLSearchParams();
  params.set("autostart", "1");
  params.set("stake", String(Math.max(0, activeStakeDoes)));
  if (String(fundingCurrency || "").trim().toLowerCase() === "htg") {
    params.set("fundingCurrency", "htg");
  }
  params.set("stakeHtg", String(Math.max(0, Math.floor(Math.max(0, activeStakeDoes) / 20))));
  if (currentRoomMode === "dame_friends") {
    params.set("roomMode", "dame_friends");
    params.set("friendAction", "create");
  }
  return `./dame.html?${params.toString()}`;
}

function ensureDameRulesModal() {
  if (dameRulesModal) return dameRulesModal;
  dameRulesModal = document.createElement("section");
  dameRulesModal.className = "search-modal hidden";
  dameRulesModal.innerHTML = `
    <div class="search-card" role="dialog" aria-modal="true" aria-labelledby="dameRulesTitle">
      <p class="search-eyebrow">REG ENPOTAN</p>
      <h2 id="dameRulesTitle" class="search-title">Anvan ou jwe Dame</h2>
      <p class="search-copy" style="text-align:left;margin-top:12px;">
        Reg aktyel la: si pati a rive sou 160 demi-kou, pati a fini <strong>nul</strong>.<br><br>
        Le sa rive, 2 jwe yo ap we mesaj <strong>Pati a fini nul</strong> ak bouton
        <strong>Jwe yon lot pati pou depataj</strong>.<br><br>
        Bouton sa a relanse menm match la sou menm mise a, <strong>san re-mize</strong>.
      </p>
      <div style="margin-top:14px;display:grid;gap:10px;">
        <button class="leave-btn" type="button" data-dame-rules-continue>Mwen konprann, ann jwe</button>
      </div>
    </div>
  `;
  document.body.appendChild(dameRulesModal);
  dameRulesModal.addEventListener("click", (event) => {
    if (event.target?.closest?.("[data-dame-rules-continue]")) {
      closeDameRulesModal();
      if (pendingBootAfterRulesModal && currentUid) {
        pendingBootAfterRulesModal = false;
        void bootRoomFlow();
      }
    }
  });
  return dameRulesModal;
}

function openDameRulesModal() {
  const modal = ensureDameRulesModal();
  modal.classList.remove("hidden");
}

function closeDameRulesModal() {
  if (!dameRulesModal) return;
  dameRulesModal.classList.add("hidden");
}

function ensureDameResultModal() {
  if (dameResultModal) return dameResultModal;
  dameResultModal = document.createElement("section");
  dameResultModal.className = "search-modal hidden";
  dameResultModal.innerHTML = `
    <div class="search-card" role="dialog" aria-modal="true" aria-labelledby="dameResultTitle">
      <p class="search-eyebrow">REZILTA</p>
      <h2 id="dameResultTitle" class="search-title" data-dame-result-title>Pati a fini</h2>
      <p class="search-copy" data-dame-result-copy></p>
      <div style="margin-top:14px;display:grid;gap:10px;">
        <button class="leave-btn" type="button" data-dame-result-replay>Rejouer</button>
        <button class="back-btn" type="button" data-dame-result-secondary>Femen</button>
      </div>
    </div>
  `;
  document.body.appendChild(dameResultModal);
  dameResultModal.addEventListener("click", (event) => {
    if (event.target === dameResultModal || event.target?.closest?.("[data-dame-result-secondary]")) {
      handleDameResultModalAction(dameResultModal?.dataset?.resultSecondaryAction || "home");
      return;
    }
    if (event.target?.closest?.("[data-dame-result-replay]")) {
      handleDameResultModalAction(dameResultModal?.dataset?.resultReplayAction || "replay");
    }
  });
  return dameResultModal;
}

function handleDameResultModalAction(action = "home") {
  const normalized = String(action || "").trim().toLowerCase();
  if (normalized === "draw-restart") {
    void restartDameAfterDraw();
    return;
  }
  if (normalized === "retry-room-flow") {
    closeDameResultModal();
    closeExpiredModal();
    closeSearchModal();
    clearSyncRetryTimer();
    updateStatus("N ap reeseye antre nan salon an...");
    setBoardInteractionEnabled(false);
    if (currentUid) {
      void bootRoomFlow();
    }
    return;
  }
  if (normalized === "close") {
    closeDameResultModal();
    return;
  }
  if (normalized === "replay") {
    if (currentRoomMode === "dame_friends" && currentRoomId) {
      void requestFriendDameRematch();
      return;
    }
    isLeavingRoom = true;
    window.location.href = buildDameReplayUrl();
    return;
  }
  isLeavingRoom = true;
  window.location.href = "./index.html";
}

function openDameResultModal({ won = false, rewardHtg = 0 } = {}) {
  const modal = ensureDameResultModal();
  const titleEl = modal.querySelector("[data-dame-result-title]");
  const copyEl = modal.querySelector("[data-dame-result-copy]");
  const replayBtn = modal.querySelector("[data-dame-result-replay]");
  const secondaryBtn = modal.querySelector("[data-dame-result-secondary]");
  const safeReward = Math.max(0, Math.trunc(Number(rewardHtg) || 0));
  modal.dataset.resultMode = "normal";
  modal.dataset.resultReplayAction = "replay";
  modal.dataset.resultSecondaryAction = "home";
  if (titleEl) titleEl.textContent = won ? "Ou genyen pati a!" : "Ou pedi pati a.";
  if (copyEl) {
    copyEl.textContent = won
      ? (safeReward > 0
        ? `Ou genyen. Ou touche ${safeReward} HTG. Ou ka rejwe oswa tounen nan paj akey.`
        : "Ou genyen. Ou ka rejwe oswa tounen nan paj akey.")
      : "Ou pedi pati a. Ou ka rejwe oswa tounen nan paj akey.";
  }
  if (replayBtn) replayBtn.textContent = "Rejouer";
  if (secondaryBtn) secondaryBtn.textContent = "Tounen nan paj akey";
  modal.classList.remove("hidden");
}

function openDameDrawResultModal() {
  const modal = ensureDameResultModal();
  const titleEl = modal.querySelector("[data-dame-result-title]");
  const copyEl = modal.querySelector("[data-dame-result-copy]");
  const replayBtn = modal.querySelector("[data-dame-result-replay]");
  const secondaryBtn = modal.querySelector("[data-dame-result-secondary]");
  modal.dataset.resultMode = "draw";
  modal.dataset.resultReplayAction = "draw-restart";
  modal.dataset.resultSecondaryAction = "close";
  if (titleEl) titleEl.textContent = "Pati a fini nul.";
  if (copyEl) {
    copyEl.textContent = "Pesonn pa genyen. Klike pou jwe yon lot pati pou depataj sou menm mise a.";
  }
  if (replayBtn) replayBtn.textContent = "Jwe yon lot pati pou depataj";
  if (secondaryBtn) secondaryBtn.textContent = "Femen";
  modal.classList.remove("hidden");
}

function openDameTimeoutResultModal({ won = false } = {}) {
  openDameResultModal({ won, rewardHtg: 0 });
}

function openDameForfeitResultModal({ rewardHtg = 0 } = {}) {
  openDameResultModal({ won: true, rewardHtg });
}

function openDameRefundResultModal({ reason = "" } = {}) {
  const modal = ensureDameResultModal();
  const titleEl = modal.querySelector("[data-dame-result-title]");
  const copyEl = modal.querySelector("[data-dame-result-copy]");
  const replayBtn = modal.querySelector("[data-dame-result-replay]");
  const secondaryBtn = modal.querySelector("[data-dame-result-secondary]");
  const normalizedReason = String(reason || "").trim().toLowerCase();
  modal.dataset.resultMode = "refund";
  modal.dataset.resultReplayAction = "replay";
  modal.dataset.resultSecondaryAction = "home";
  if (titleEl) titleEl.textContent = "Pati a anile san pedan.";
  if (copyEl) {
    copyEl.textContent = normalizedReason === "quit_refund_before_opening"
      ? "Youn nan jwe yo kite pati a avan 2 bo yo te fe premye mouvman yo. Mize yo remet. Ou ka rejwe oswa tounen nan paj akey."
      : "Tan an oswa koneksyon an koupe avan 2 bo yo te fe premye mouvman yo. Mize yo remet. Ou ka rejwe oswa tounen nan paj akey.";
  }
  if (replayBtn) replayBtn.textContent = "Rejouer";
  if (secondaryBtn) secondaryBtn.textContent = "Tounen nan paj akey";
  modal.classList.remove("hidden");
}

function openDameInfoModal({
  title = "Salon prive a pa mache",
  copy = "",
  replayLabel = "Eseye anko",
  secondaryLabel = "Tounen nan paj akey",
  replayAction = "retry-room-flow",
  secondaryAction = "home",
} = {}) {
  const modal = ensureDameResultModal();
  const titleEl = modal.querySelector("[data-dame-result-title]");
  const copyEl = modal.querySelector("[data-dame-result-copy]");
  const replayBtn = modal.querySelector("[data-dame-result-replay]");
  const secondaryBtn = modal.querySelector("[data-dame-result-secondary]");
  modal.dataset.resultMode = "info";
  modal.dataset.resultReplayAction = replayAction;
  modal.dataset.resultSecondaryAction = secondaryAction;
  if (titleEl) titleEl.textContent = title;
  if (copyEl) copyEl.textContent = copy;
  if (replayBtn) replayBtn.textContent = replayLabel;
  if (secondaryBtn) secondaryBtn.textContent = secondaryLabel;
  closeSearchModal();
  closeExpiredModal();
  modal.classList.remove("hidden");
}

function showDameRoomFlowIssue(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  const requiredStakeHtg = Math.max(
    25,
    safeInt(
      details.requestedAmount ?? details.requiredHtg ?? details.roomStakeHtg,
      getStakeHtgValue(activeStakeDoes) || 25
    )
  );
  const playableHtg = Math.max(0, safeInt(details.playableHtg, computeHtgBalance({})));
  const missingHtg = Math.max(0, safeInt(details.missingHtg, requiredStakeHtg - playableHtg));

  if (code === "insufficient-funds") {
    openDameInfoModal({
      title: "Solde a pa sifi",
      copy: `Salon sa a mande ${formatHtg(requiredStakeHtg)}. Balans ou se ${formatHtg(playableHtg)} epi ou manke ${formatHtg(missingHtg)} pou kontinye.`,
      replayLabel: "Tounen nan paj akey",
      replayAction: "home",
      secondaryLabel: "Femen",
      secondaryAction: "close",
    });
    return true;
  }

  if (code === "missing-invite-code") {
    openDameInfoModal({
      title: "Kod salon an manke",
      copy: "Mete kod salon prive a anvan ou kontinye depi sou paj akey la.",
      replayLabel: "Tounen nan paj akey",
      replayAction: "home",
      secondaryLabel: "Femen",
      secondaryAction: "close",
    });
    return true;
  }

  if (code === "room-not-found") {
    openDameInfoModal({
      title: "Kod salon an pa bon",
      copy: "Nou pa jwenn salon prive sa a. Verifye kod la oswa mande zanmi ou voye l ankò.",
      replayLabel: "Tounen nan paj akey",
      replayAction: "home",
      secondaryLabel: "Femen",
      secondaryAction: "close",
    });
    return true;
  }

  if (code === "room-expired") {
    openDameInfoModal({
      title: "Salon prive a ekspire",
      copy: "Salon sa a pa disponib ankò. Mande zanmi ou kreye yon lòt salon oswa relanse rechèch la depi sou paj akey la.",
      replayLabel: "Tounen nan paj akey",
      replayAction: "home",
      secondaryLabel: "Femen",
      secondaryAction: "close",
    });
    return true;
  }

  if (code === "room-full") {
    openDameInfoModal({
      title: "Salon prive a plen",
      copy: "Salon sa a deja gen 2 jwè ladan li. Mande yon lòt kod oswa kreye pwòp salon ou.",
      replayLabel: "Tounen nan paj akey",
      replayAction: "home",
      secondaryLabel: "Femen",
      secondaryAction: "close",
    });
    return true;
  }

  if (code === "room-already-started") {
    openDameInfoModal({
      title: "Pati a deja komanse",
      copy: "Salon prive sa a deja lanse. Mande zanmi ou kreye yon lòt salon si nou vle rekòmanse.",
      replayLabel: "Tounen nan paj akey",
      replayAction: "home",
      secondaryLabel: "Femen",
      secondaryAction: "close",
    });
    return true;
  }

  if (code === "room-unavailable" || code === "invalid-room" || code === "blocked-rejoin") {
    openDameInfoModal({
      title: "Salon prive a pa disponib",
      copy: String(error?.message || "Salon prive sa a pa disponib pou kounye a."),
      replayLabel: "Tounen nan paj akey",
      replayAction: "home",
      secondaryLabel: "Femen",
      secondaryAction: "close",
    });
    return true;
  }

  return false;
}

async function restartDameAfterDraw() {
  if (!currentRoomId || dameDrawRestartInFlight) return;
  dameDrawRestartInFlight = true;
  try {
    updateStatus("N ap rekomanse sou menm mise a...");
    await restartDameAfterDrawSecure({ roomId: currentRoomId });
    closeDameResultModal();
  } catch (error) {
    console.warn("[DAME] draw restart failed", error);
    updateStatus(error?.message || "Pa posib rekomanse pati nul la kounye a.");
  } finally {
    dameDrawRestartInFlight = false;
  }
}

function closeDameResultModal() {
  if (!dameResultModal) return;
  dameResultModal.classList.add("hidden");
}

function resetDameRoundRuntimeState({ clearBoard = true } = {}) {
  if (actionsUnsub) {
    actionsUnsub();
    actionsUnsub = null;
  }
  latestDameActionDocs = [];
  lastAppliedActionSeq = 0;
  startedAtMs = 0;
  submittedResultKey = "";
  dameResultShownForRoomId = "";
  dameFinalizeInFlight = false;
  if (clearBoard) {
    resetDameBoardState();
  }
  renderTurnTimer({ status: "" });
  setBoardInteractionEnabled(false);
}

function openDameFriendRematchWaitingModal() {
  const message = buildDameFriendRematchWaitingMessage();
  closeDameResultModal();
  closeExpiredModal();
  openSearchModal(
    message,
    0,
    "N ap tann lot jw a konfime revanj la."
  );
  updateStatus(message);
}

function prepareDameNextRoundStart() {
  dameFriendRematchPending = false;
  closeDameResultModal();
  closeExpiredModal();
  resetDameRoundRuntimeState({ clearBoard: true });
  updateStatus("Nouvo won Dame a ap pare...");
  void refreshLiveWalletState("round-restart");
}

async function requestFriendDameRematch() {
  if (!currentRoomId || dameFriendRematchBusy) return;
  dameFriendRematchBusy = true;
  try {
    updateStatus("N ap voye demann revanj la...");
    const result = await requestFriendDameRematchSecure({ roomId: currentRoomId });
    currentRoomData = {
      ...(currentRoomData || {}),
      ...(result || {}),
      roomId: currentRoomId,
      status: "ended",
    };
    syncActiveStakeFromRoomData(currentRoomData || {});
    if (currentRoomMode === "dame_friends") {
      currentInviteCode = normalizeInviteCode(result?.inviteCode || currentInviteCode);
      requestedFriendRoomId = currentRoomId || requestedFriendRoomId;
    }
    syncDameRoomUrl();
    dameResultShownForRoomId = "";
    closeDameResultModal();
    closeExpiredModal();
    if (result?.started === true) {
      dameFriendRematchPending = false;
      openSearchModal(
        "Tou de jw yo dakò. N ap relanse pati Dame prive a...",
        0,
        "Nouvo won an ap pare."
      );
      void refreshLiveWalletState("friend-rematch-started");
    } else {
      dameFriendRematchPending = true;
      openDameFriendRematchWaitingModal();
    }
  } catch (error) {
    console.warn("[DAME] friend rematch failed", error);
    openDameInfoModal({
      title: "Rejouer pa mache",
      copy: String(error?.message || "Nou pa rive relanse revanj prive Dame la."),
      replayLabel: "Femen",
      replayAction: "close",
      secondaryLabel: "Tounen nan paj akey",
      secondaryAction: "home",
    });
  } finally {
    dameFriendRematchBusy = false;
  }
}

function updateBalanceLabel(value) {
  if (!balanceEl) return;
  balanceEl.textContent = `HTG: ${formatDoes(value)}`;
}

async function refreshLiveWalletState(reason = "") {
  if (!currentUid) {
    updateBalanceLabel("--");
    return;
  }
  try {
    await ensureXchangeState(currentUid);
  } catch (error) {
    console.warn("[DAME] wallet refresh failed", { reason, error });
  }
  updateBalanceLabel(computeHtgBalance({}));
}

function getRoomHumanCount(roomData = {}) {
  if (Array.isArray(roomData?.playerUids)) {
    return roomData.playerUids.filter((uid) => String(uid || "").trim()).length;
  }
  return Math.max(0, Number(roomData?.humanCount || 0));
}

function getOpponentSeatIndex(roomData = {}) {
  if (Number.isFinite(Number(mySeatIndex)) && mySeatIndex >= 0) {
    return mySeatIndex === 0 ? 1 : mySeatIndex === 1 ? 0 : -1;
  }

  const playerUids = Array.isArray(roomData?.playerUids) ? roomData.playerUids : [];
  const myUidIndex = playerUids.findIndex((uid) => String(uid || "").trim() === currentUid);
  if (myUidIndex >= 0) {
    return myUidIndex === 0 ? 1 : myUidIndex === 1 ? 0 : -1;
  }

  const seats = roomData?.seats && typeof roomData.seats === "object" ? roomData.seats : {};
  const seatEntries = Object.entries(seats);
  const foundSeat = seatEntries.find(([, seat]) => Number.isFinite(Number(seat)) && Number(seat) >= 0 && Number(seat) < 2);
  if (foundSeat) {
    const seatIndex = Number(foundSeat[1]);
    return seatIndex === 0 ? 1 : 0;
  }

  return -1;
}

function getOpponentName(roomData = {}) {
  if (getRoomHumanCount(roomData) < 2) return "";

  const names = Array.isArray(roomData?.playerNames) ? roomData.playerNames : [];
  const playerUids = Array.isArray(roomData?.playerUids) ? roomData.playerUids : [];
  const opponentSeat = getOpponentSeatIndex(roomData);
  if (opponentSeat >= 0 && opponentSeat < names.length) {
    const explicitName = String(names[opponentSeat] || "").trim();
    if (explicitName) return explicitName;
  }

  const otherUid = playerUids.find((uid) => String(uid || "").trim() && String(uid).trim() !== currentUid);
  if (otherUid) {
    const seatIndex = playerUids.findIndex((uid) => String(uid || "").trim() === String(otherUid || "").trim());
    if (seatIndex >= 0 && seatIndex < names.length) {
      const fallbackName = String(names[seatIndex] || "").trim();
      if (fallbackName) return fallbackName;
    }
  }

  return "";
}

function getStartingPlayerSeat(roomData = {}) {
  const seat = Number(roomData?.startingPlayerSeat);
  if (Number.isFinite(seat) && seat >= 0 && seat < 2) {
    return Math.trunc(seat);
  }
  return 1;
}

function getSeatColor(roomData = {}, seatIndex = -1) {
  const redSeatIndex = getStartingPlayerSeat(roomData);
  if (!Number.isFinite(Number(seatIndex)) || seatIndex < 0 || seatIndex > 1) {
    return -1;
  }
  return Math.trunc(seatIndex) === redSeatIndex ? 1 : 0;
}

function getSeatIndexForColor(roomData = {}, color = -1) {
  const colorValue = Number(color);
  if (!Number.isFinite(colorValue) || colorValue < 0 || colorValue > 1) return -1;
  const redSeatIndex = getStartingPlayerSeat(roomData);
  return Math.trunc(colorValue) === 1 ? redSeatIndex : (redSeatIndex === 0 ? 1 : 0);
}

function getMySeatColor(roomData = currentRoomData || {}) {
  return getSeatColor(roomData, mySeatIndex);
}

function updateBoardOrientation(roomData = currentRoomData || {}) {
  if (!boardEl) return;
  const status = String(roomData?.status || "").trim().toLowerCase();
  const shouldFlip = status === "playing" && mySeatIndex >= 0 && getMySeatColor(roomData) === 0;
  boardEl.classList.toggle("dame-board-flipped", shouldFlip);
}

function updateOpponentUi(roomData = currentRoomData || {}) {
  const visible = getRoomHumanCount(roomData) >= 2;
  const opponentName = visible ? getOpponentName(roomData) : "";
  const displayName = opponentName || "Advese nan sal la";

  if (opponentBadgeEl) {
    opponentBadgeEl.classList.toggle("hidden", !visible);
  }
  if (searchOpponentBadgeEl) {
    searchOpponentBadgeEl.classList.toggle("hidden", !visible);
  }
  if (opponentNameEl) {
    opponentNameEl.textContent = displayName;
  }
  if (searchOpponentNameEl) {
    searchOpponentNameEl.textContent = displayName;
  }
}

function updateDameRoomUi(roomData = currentRoomData || {}) {
  const status = String(roomData?.status || "").trim().toLowerCase();
  const humanCount = getRoomHumanCount(roomData);
  const waitingDeadlineMs = Number(roomData?.waitingDeadlineMs || 0);
  const opponentName = getOpponentName(roomData);
  const opponentText = opponentName || "Advese nan sal la";
  const currentPlayer = Number.isFinite(Number(roomData?.currentPlayer))
    ? Math.trunc(Number(roomData.currentPlayer))
    : -1;

  updateOpponentUi(roomData);
  renderTurnTimer(roomData);

  if (status === "playing") {
    if (mySeatIndex >= 0 && currentPlayer >= 0 && getMySeatColor(roomData) === currentPlayer) {
      updateStatus("Pati a an kou. Se ou ki pou jwe.");
    } else {
      updateStatus("Pati a an kou. N ap tann mouvman advese a...");
    }
    return;
  }

  if (status === "waiting") {
    if (humanCount >= 2) {
      const waitingCopy = opponentName
        ? `Advese w ${opponentName} deja nan sal la. Pati a pral komanse taler konsa.`
        : "Advese a deja nan sal la. Pati a pral komanse taler konsa.";
      if (searchCopyEl) {
        searchCopyEl.textContent = waitingCopy;
      }
      if (searchCountdownEl) {
        searchCountdownEl.textContent = "Nou jwenn yon advese. N ap prepare pati a...";
      }
      updateStatus(waitingCopy);
      return;
    }

    const remaining = waitingDeadlineMs > Date.now()
      ? Math.max(0, Math.ceil((waitingDeadlineMs - Date.now()) / 1000))
      : 0;
    const waitingCopy = remaining > 0
      ? `N ap tann lot jwe a... (${remaining}s)`
      : "Pa gen jwe jwenn anko. Tounen nan meni an epi relanse.";
    if (searchCopyEl) {
      searchCopyEl.textContent = "N ap prepare pati a epi n ap chache advese w la.";
    }
    updateStatus(waitingCopy);
    return;
  }

  if (status === "ended" || status === "closed") {
    updateStatus("Pati a fini. Komanse yon nouvo pati.");
    return;
  }

  if (humanCount >= 2) {
    updateStatus(opponentName
      ? `Sal la aktif (${humanCount}/2). ${opponentText}.`
      : `Sal la aktif (${humanCount}/2).`);
  } else {
    updateStatus(`Sal la aktif (${humanCount}/2).`);
  }
}

function syncBoardTurnFromRoom(roomData = currentRoomData || {}) {
  if (!boardEl) return;
  const status = String(roomData?.status || "").trim().toLowerCase();
  const currentPlayer = Number(roomData?.currentPlayer);
  if (status !== "playing" || !Number.isFinite(currentPlayer)) return;

  const nextBoardTurn = Math.max(0, Math.trunc(currentPlayer) + 1);
  if (Number(boardEl.turn) !== nextBoardTurn) {
    boardEl.turn = nextBoardTurn;
  }
}

function syncBoardTurnFromAction(action = {}) {
  if (!boardEl) return;
  const piecePlayer = Number.isFinite(Number(action?.piecePlayer))
    ? Number(action.piecePlayer)
    : Number.isFinite(Number(action?.seatIndex))
      ? Number(action.seatIndex)
      : -1;
  if (piecePlayer < 0 || piecePlayer > 1) return;
  const moverBoardTurn = Math.max(0, Math.trunc(piecePlayer) + 1);
  if (Number(boardEl.turn) !== moverBoardTurn) {
    boardEl.turn = moverBoardTurn;
  }
}

function resetDameBoardState() {
  if (!boardEl?.data) return false;
  if (typeof boardEl.data.destroy === "function") {
    boardEl.data.destroy();
  }
  try {
    boardEl.turn = 0;
  } catch (_) {}
  if (typeof boardEl.data.create === "function") {
    boardEl.data.create();
  }
  return true;
}

function replayDameActions(actions = []) {
  const docs = Array.isArray(actions) ? actions : [];
  console.log("[DAME_TRACE] replay:start", {
    roomId: currentRoomId,
    docsCount: docs.length,
    lastAppliedActionSeq,
    roomStatus: String(currentRoomData?.status || ""),
  });
  if (!boardEl?.data || String(currentRoomData?.status || "").trim().toLowerCase() !== "playing") {
    console.log("[DAME_TRACE] replay:skip", {
      hasBoard: !!boardEl?.data,
      roomStatus: String(currentRoomData?.status || ""),
    });
    return;
  }

  rebuildingBoardState = true;
  replayingRemoteAction = true;
  try {
    const replayFromCurrentBoard = (startSeq) => {
      let latestSeq = Number.isFinite(startSeq) ? Math.trunc(startSeq) : 0;
      syncBoardTurnFromRoom(currentRoomData || {});

      for (const docSnap of docs) {
        const data = docSnap?.data ? (docSnap.data() || {}) : (docSnap || {});
        const seq = Number(data?.seq || 0);
        if (!Number.isFinite(seq) || seq <= 0 || seq <= latestSeq) continue;
        syncBoardTurnFromAction(data);
        const ok = applyActionToBoard(data);
        if (!ok) {
          console.warn("[DAME_TRACE] replay:apply-failed", {
            roomId: currentRoomId,
            seq,
            from: data?.from || null,
            to: data?.to || null,
          });
          return { ok: false, latestSeq };
        }
        latestSeq = seq;
        lastAppliedActionSeq = seq;
      }

      return { ok: true, latestSeq };
    };

    let replayResult = replayFromCurrentBoard(lastAppliedActionSeq);
    if (!replayResult.ok && resetDameBoardState()) {
      lastAppliedActionSeq = 0;
      replayResult = replayFromCurrentBoard(0);
    }
    if (!replayResult.ok) {
      showDameLiveIssue("Tablo a pa rive aplike denye mouvman yo. N ap relanse synchro a otomatikman.", { autoHide: false });
      scheduleDameSyncRetry(800);
    }

    const boardTurnValue = Number.isFinite(Number(boardEl?.turn))
      ? Math.trunc(Number(boardEl.turn))
      : NaN;
    const boardCurrentPlayer = Number.isFinite(boardTurnValue)
      ? (boardTurnValue % 2 ^ 1)
      : Number.isFinite(Number(currentRoomData?.currentPlayer))
        ? Math.max(0, Math.trunc(Number(currentRoomData.currentPlayer)))
        : -1;
    updateDameRoomUi({
      ...(currentRoomData || {}),
      currentPlayer: boardCurrentPlayer,
    });
    setBoardInteractionEnabled(mySeatIndex >= 0 && getMySeatColor(currentRoomData) === boardCurrentPlayer);
  } finally {
    replayingRemoteAction = false;
    rebuildingBoardState = false;
  }
}

function computeHtgBalance(profile = {}) {
  try {
    const uid = auth.currentUser?.uid || currentUid || "guest";
    const xState = getXchangeState(window.__userBaseBalance || window.__userBalance || 0, uid);
    const live = Number(xState?.totalBalance);
    if (Number.isFinite(live)) {
      return Math.max(0, Math.trunc(live));
    }
  } catch (_) {}
  const approved = Number(profile?.approvedHtgAvailable);
  const provisional = Number(profile?.provisionalHtgAvailable);
  if (Number.isFinite(approved) || Number.isFinite(provisional)) {
    return Math.trunc((Number.isFinite(approved) ? approved : 0) + (Number.isFinite(provisional) ? provisional : 0));
  }
  return 0;
}

function setBoardInteractionEnabled(enabled) {
  if (!boardEl) return;
  const on = enabled === true;
  lastBoardInteractionEnabled = on;
  boardEl.dataset.dameInteraction = on ? "enabled" : "disabled";
  boardEl.style.pointerEvents = on ? "auto" : "none";
  boardEl.style.opacity = "1";
}

function syncDameInteractionGuard(reason = "guard") {
  if (!boardEl || replayingRemoteAction || rebuildingBoardState) return;
  if (!isDamePlaying(currentRoomData)) {
    setBoardInteractionEnabled(false);
    return;
  }

  const myTurn = isLocalPlayerTurn(currentRoomData);
  if (!myTurn) {
    setBoardInteractionEnabled(false);
    return;
  }

  syncBoardTurnFromRoom(currentRoomData);
  if (!dameActionSubmitting) {
    const wasDisabled = lastBoardInteractionEnabled !== true || boardEl.style.pointerEvents === "none";
    setBoardInteractionEnabled(true);
    if (wasDisabled) {
      console.warn("[DAME_GUARD] board interaction restored", {
        roomId: currentRoomId,
        reason,
        mySeatIndex,
        currentPlayer: getRoomCurrentPlayer(currentRoomData),
      });
    }
  }
}

function recoverDameBoardFromServer(reason = "recover") {
  if (!boardEl?.data || !isDamePlaying(currentRoomData)) return;
  console.warn("[DAME_GUARD] recovering board from server actions", {
    roomId: currentRoomId,
    reason,
    actionsCount: latestDameActionDocs.length,
    lastAppliedActionSeq,
  });
  showDameLiveIssue("Synchro mouvman an pran reta. N ap rekonekte tablo a pou ou pa pedi san rezon.", { autoHide: false });
  rebuildingBoardState = true;
  try {
    if (resetDameBoardState()) {
      lastAppliedActionSeq = 0;
      replayDameActions(latestDameActionDocs);
    } else {
      syncBoardTurnFromRoom(currentRoomData);
    }
  } finally {
    rebuildingBoardState = false;
  }
  syncDameInteractionGuard(reason);
  if (isLocalPlayerTurn(currentRoomData) && !dameActionSubmitting) {
    showDameLiveIssue("Tablo a rekonekte. Se tou pa ou toujou, ou ka jwe kounye a.");
  }
  void syncRoomReady();
}

function clearSyncRetryTimer() {
  if (syncRetryTimer) {
    window.clearTimeout(syncRetryTimer);
    syncRetryTimer = null;
  }
}

function scheduleDameSyncRetry(delayMs = 1500) {
  clearSyncRetryTimer();
  syncRetryTimer = window.setTimeout(() => {
    syncRetryTimer = null;
    if (!currentRoomId || !currentUid) return;
    startRoomSync();
  }, Math.max(250, Math.trunc(delayMs) || 1500));
}

function stopSearchTimer() {
  if (searchTimer) {
    window.clearInterval(searchTimer);
    searchTimer = null;
  }
}

function getSearchSecondsLeft() {
  if (!currentWaitingDeadlineMs) return 0;
  const remainingMs = Math.max(0, currentWaitingDeadlineMs - Date.now());
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function renderSearchCountdown() {
  if (!searchCountdownEl) return;
  if (currentSearchCountdownOverride) {
    searchCountdownEl.textContent = currentSearchCountdownOverride;
    return;
  }
  const remaining = getSearchSecondsLeft();
  if (remaining > 0) {
    searchCountdownEl.textContent = `${remaining} s ki rete`;
  } else if (currentWaitingDeadlineMs > 0) {
    searchCountdownEl.textContent = "Tan an fini. N ap pase nan model ed la.";
  } else {
    searchCountdownEl.textContent = "N ap prepare pati a...";
  }
}

function openSearchModal(message = "", deadlineMs = 0, countdownOverride = "") {
  currentWaitingDeadlineMs = Number.isFinite(Number(deadlineMs)) ? Math.max(0, Number(deadlineMs)) : 0;
  currentSearchCountdownOverride = String(countdownOverride || "").trim();
  if (searchCopyEl && message) {
    searchCopyEl.textContent = String(message);
  }
  renderFriendSearchBox();
  if (expiredOverlayEl) {
    expiredOverlayEl.classList.add("hidden");
  }
  dameExpiredModalVisible = false;
  if (searchOverlayEl) {
    searchOverlayEl.classList.remove("hidden");
  }
  stopSearchTimer();
  renderSearchCountdown();
  searchTimer = window.setInterval(() => {
    renderSearchCountdown();
    if (currentWaitingDeadlineMs > 0 && Date.now() >= currentWaitingDeadlineMs) {
      stopSearchTimer();
      if (currentRoomData?.status === "waiting" && !dameExpiredModalVisible) {
        openExpiredModal();
      }
    }
  }, 1000);
}

function closeSearchModal() {
  if (searchOverlayEl) {
    searchOverlayEl.classList.add("hidden");
  }
  if (searchFriendBoxEl) {
    searchFriendBoxEl.classList.add("hidden");
  }
  currentWaitingDeadlineMs = 0;
  currentSearchCountdownOverride = "";
  stopSearchTimer();
}

function openExpiredModal() {
  if (searchOverlayEl) {
    searchOverlayEl.classList.add("hidden");
  }
  stopSearchTimer();
  currentWaitingDeadlineMs = 0;
  currentSearchCountdownOverride = "";
  if (expiredOverlayEl) {
    expiredOverlayEl.classList.remove("hidden");
  }
  dameExpiredModalVisible = true;
  void loadDameWhatsappConfig();
}

function closeExpiredModal() {
  if (expiredOverlayEl) {
    expiredOverlayEl.classList.add("hidden");
  }
  if (expiredPhoneBox) {
    expiredPhoneBox.classList.remove("visible");
  }
  dameExpiredModalVisible = false;
}

function formatWhatsappDisplay(digits = "") {
  const clean = String(digits || "").replace(/\D/g, "");
  return clean ? `+${clean}` : "";
}

async function loadDameWhatsappConfig() {
  if (dameWhatsappConfigPromise) return dameWhatsappConfigPromise;
  dameWhatsappConfigPromise = getPublicWhatsappModalConfigSecure({})
    .then((result) => {
      const contacts = result?.contacts && typeof result.contacts === "object" ? result.contacts : {};
      dameWhatsappAgentDigits = String(contacts.championnat_mopyon || contacts.support_default || contacts.agent_deposit || "").replace(/\D/g, "");
      if (expiredAgentValue) {
        expiredAgentValue.textContent = dameWhatsappAgentDigits
          ? `Nimewo WhatsApp ajan an: ${formatWhatsappDisplay(dameWhatsappAgentDigits)}`
          : "Nimewo WhatsApp la pa disponib pou kounye a.";
      }
      return result;
    })
    .catch((error) => {
      console.warn("[DAME] whatsapp config load failed", error);
      dameWhatsappAgentDigits = "";
      if (expiredAgentValue) {
        expiredAgentValue.textContent = "Nimewo WhatsApp la pa disponib pou kounye a.";
      }
      return null;
    })
    .finally(() => {
      dameWhatsappConfigPromise = null;
    });
  return dameWhatsappConfigPromise;
}

async function saveDameWaitlistInfo({ phone = "", notify = false } = {}) {
  if (!currentUid) {
    throw new Error("Koneksyon obligatwa.");
  }
  const cleanPhone = String(phone || "").replace(/\D/g, "");
  const payload = {
    phone: cleanPhone || undefined,
  };
  if (cleanPhone) {
    payload.dameWhatsappNumber = cleanPhone;
  }
  if (notify) {
    payload.dameWaitingNotificationRequested = true;
    payload.dameWaitingNotificationRequestedAtMs = Date.now();
    payload.dameWhatsappVisible = true;
  }
  return updateClientProfileSecure(payload);
}

async function restartDameSearch({ fresh = true } = {}) {
  const previousRoomId = String(currentRoomId || "").trim();
  const wasFriendRoom = currentRoomMode === "dame_friends";
  const previousRoomData = currentRoomData && typeof currentRoomData === "object"
    ? { ...currentRoomData }
    : null;
  stopRoomSync();
  closeDameResultModal();
  dameResultShownForRoomId = "";
  closeExpiredModal();
  closeSearchModal();
  dameFriendRematchPending = false;
  currentRoomData = null;
  currentRoomId = "";
  requestedFriendRoomId = "";
  startedAtMs = 0;
  submittedResultKey = "";
  mySeatIndex = -1;
  updateBoardOrientation({ status: "" });
  renderTurnTimer({ status: "" });
  if (!wasFriendRoom) {
    currentInviteCode = "";
  }
  syncDameRoomUrl();

  if (fresh) {
    try {
      if (previousRoomId) {
        await leaveRoomDameSecure({ roomId: previousRoomId, reason: "search_restart" }).catch(() => null);
      }
    } catch (_) {}
    await bootRoomFlow();
    return;
  }
  if (previousRoomId) {
    currentRoomId = previousRoomId;
    currentRoomData = previousRoomData;
    if (wasFriendRoom) {
      requestedFriendRoomId = previousRoomId;
    }
    syncDameRoomUrl();
    currentWaitingDeadlineMs = Date.now() + 15000;
    const waitingMessage = buildDameWaitingMessage({
      roomData: previousRoomData || {},
    });
    openSearchModal(waitingMessage, currentWaitingDeadlineMs);
    updateStatus(waitingMessage);
    setBoardInteractionEnabled(false);
    startRoomSync();
    return;
  }
  currentWaitingDeadlineMs = Date.now() + 15000;
  openSearchModal(buildDameWaitingMessage(), currentWaitingDeadlineMs);
  return;
  openSearchModal("N ap chache yon lot jwe pou pati Dame ou a.", currentWaitingDeadlineMs);
}

async function leaveCurrentDameRoom({ redirect = true } = {}) {
  const roomId = String(currentRoomId || "").trim();
  if (!roomId) {
    if (redirect) {
      window.location.href = "./index.html";
    }
    return;
  }

  if (isLeavingRoom) return;
  isLeavingRoom = true;
  setBoardInteractionEnabled(false);
  updateStatus("N ap kite pati a...");

  try {
    await leaveRoomDameSecure({ roomId, reason: "manual_quit" });
  } catch (error) {
    console.warn("[DAME] leave room failed", error);
    if (statusEl) {
      statusEl.textContent = error?.message || "Pa posib kite sal la pou kounye a.";
    }
  } finally {
    await refreshLiveWalletState("leave");
    stopRoomSync();
    closeSearchModal();
    closeExpiredModal();
    dameFriendRematchPending = false;
    currentRoomId = "";
    currentRoomData = null;
    mySeatIndex = -1;
    startedAtMs = 0;
    submittedResultKey = "";
    if (redirect) {
      window.location.href = "./index.html";
    }
  }
}

async function leaveCurrentDameRoomSilently() {
  const roomId = String(currentRoomId || "").trim();
  const status = String(currentRoomData?.status || "").trim().toLowerCase();
  const isMatchActive = status === "playing" || status === "waiting";
  if (!roomId || !currentUid || isLeavingRoom || !isMatchActive) return;

  isLeavingRoom = true;
  try {
    await leaveRoomDameSecure({ roomId, reason: "page_hide" });
  } catch (_) {
  }
}

async function leaveCurrentDameRoomAndGoHome() {
  if (isLeavingRoom) return;
  await leaveCurrentDameRoom({ redirect: true });
}

function armDameHistoryGuard() {
  if (dameHistoryGuardArmed) return;
  try {
    history.pushState({ dame: true }, "", window.location.href);
    dameHistoryGuardArmed = true;
  } catch (_) {
  }
}

async function refreshBalance() {
  if (!currentUid) {
    if (balanceUnsub) {
      balanceUnsub();
      balanceUnsub = null;
    }
    updateBalanceLabel("--");
    return;
  }

  if (balanceUnsub) {
    balanceUnsub();
    balanceUnsub = null;
  }

  const walletRef = doc(db, CLIENTS_COLLECTION, currentUid);
  balanceUnsub = onSnapshot(walletRef, (snap) => {
    if (!snap.exists()) {
      updateBalanceLabel(0);
      return;
    }
    const profile = snap.data() || {};
    updateBalanceLabel(computeHtgBalance(profile));
  }, () => {
    updateBalanceLabel("--");
  });
}

function stopRoomSync() {
  if (roomUnsub) {
    roomUnsub();
    roomUnsub = null;
  }
  if (actionsUnsub) {
    actionsUnsub();
    actionsUnsub = null;
  }
  if (ensureTimer) {
    window.clearInterval(ensureTimer);
    ensureTimer = null;
  }
  if (presenceTimer) {
    window.clearInterval(presenceTimer);
    presenceTimer = null;
  }
  if (turnSyncTimer) {
    window.clearInterval(turnSyncTimer);
    turnSyncTimer = null;
  }
  if (uiWatchdogTimer) {
    window.clearInterval(uiWatchdogTimer);
    uiWatchdogTimer = null;
  }
  if (balanceUnsub) {
    balanceUnsub();
    balanceUnsub = null;
  }
  clearSyncRetryTimer();
  latestDameActionDocs = [];
  lastAppliedActionSeq = 0;
  dameResultShownForRoomId = "";
  updateBoardOrientation({ status: "" });
  renderTurnTimer({ status: "" });
  hideDameLiveIssue();
}

function getFieldAt(line, column) {
  if (!boardEl) return null;
  return boardEl.querySelector(`div.line${Number(line)}.column${Number(column)}`);
}

function normalizeCoordPair(line, column) {
  const l = Number(line);
  const c = Number(column);
  if (!Number.isFinite(l) || !Number.isFinite(c)) return null;
  if (l < 0 || l > 7 || c < 0 || c > 7) return null;
  return { line: Math.trunc(l), column: Math.trunc(c) };
}

function applyActionToBoard(action = {}) {
  const fromRaw = action?.from || {};
  const toRaw = action?.to || {};
  const from = normalizeCoordPair(fromRaw?.line, fromRaw?.column);
  const to = normalizeCoordPair(toRaw?.line, toRaw?.column);
  if (!from || !to) return false;

  const fromField = getFieldAt(from.line, from.column);
  const toField = getFieldAt(to.line, to.column);
  if (!fromField || !toField) return false;
  const piece = fromField.querySelector("a.player0, a.player1");
  if (!piece) {
    console.warn("[DAME_TRACE] apply:no-piece", {
      roomId: currentRoomId,
      seq: Number(action?.seq || 0),
      from,
      to,
    });
    return false;
  }

  const expectedPiecePlayer = Number(action?.piecePlayer);
  const actualPiecePlayer = Number(piece?.data?.player?.());
  if (Number.isFinite(expectedPiecePlayer) && Number.isFinite(actualPiecePlayer) && expectedPiecePlayer !== actualPiecePlayer) {
    console.warn("[DAME_TRACE] apply:piece-mismatch", {
      roomId: currentRoomId,
      seq: Number(action?.seq || 0),
      from,
      to,
      expectedPiecePlayer,
      actualPiecePlayer,
    });
    return false;
  }

  piece.dispatchEvent(new MouseEvent("click", { view: window, bubbles: true, cancelable: true }));
  const mask = toField.querySelector("a.move");
  if (!mask) {
    console.warn("[DAME_TRACE] apply:no-mask", {
      roomId: currentRoomId,
      seq: Number(action?.seq || 0),
      from,
      to,
    });
    return false;
  }
  mask.dispatchEvent(new MouseEvent("click", { view: window, bubbles: true, cancelable: true }));
  return true;
}

function startActionsSync() {
  if (!currentRoomId || !currentUid) return;
  if (String(currentRoomData?.status || "").trim().toLowerCase() !== "playing") return;
  if (actionsUnsub) {
    actionsUnsub();
    actionsUnsub = null;
  }
  lastAppliedActionSeq = 0;

  const actionsQuery = query(
    collection(db, "dameRooms", currentRoomId, "actions"),
    orderBy("seq", "asc")
  );
  console.log("[DAME_TRACE] actions-sync:start", {
    roomId: currentRoomId,
  });
  actionsUnsub = onSnapshot(
    actionsQuery,
    (snap) => {
      lastActionSnapshotAtMs = Date.now();
      latestDameActionDocs = snap.docs || [];
      const seqList = latestDameActionDocs
        .map((docSnap) => Number(docSnap?.data?.()?.seq || 0))
        .filter((value) => Number.isFinite(value) && value > 0);
      console.log("[DAME_TRACE] actions-sync:snapshot", {
        roomId: currentRoomId,
        docsCount: latestDameActionDocs.length,
        seqList,
        roomStatus: String(currentRoomData?.status || ""),
      });
      if (String(currentRoomData?.status || "").trim().toLowerCase() === "playing") {
        replayDameActions(latestDameActionDocs);
      }
    },
    (error) => {
      console.warn("[DAME] actions snapshot error", error);
      showDameLiveIssue("Koneksyon tablo a ap pran reta. N ap rekonekte mouvman yo otomatikman.", { autoHide: false });
      if (String(error?.code || "") === "permission-denied") {
        scheduleDameSyncRetry();
      }
    }
  );
}

async function syncRoomReady() {
  const roomId = String(currentRoomId || "").trim();
  if (!roomId || !currentUid) return;
  const localStatus = String(currentRoomData?.status || "").trim().toLowerCase();
  if (localStatus === "ended" || localStatus === "closed") return;
  try {
    const result = await ensureRoomReadyDameSecure({ roomId });
    if (result?.status === "playing") {
      currentRoomData = {
        ...(currentRoomData || {}),
        turnDeadlineMs: Number(result?.turnDeadlineMs || currentRoomData?.turnDeadlineMs || 0),
        turnStartedAtMs: Number(result?.turnStartedAtMs || currentRoomData?.turnStartedAtMs || 0),
        currentPlayer: Number.isFinite(Number(result?.currentPlayer))
          ? Math.trunc(Number(result.currentPlayer))
          : Number.isFinite(Number(currentRoomData?.currentPlayer))
            ? Math.trunc(Number(currentRoomData.currentPlayer))
            : -1,
      };
      closeSearchModal();
      closeExpiredModal();
      const liveCurrentPlayer = Number.isFinite(Number(currentRoomData?.currentPlayer))
        ? Math.trunc(Number(currentRoomData.currentPlayer))
        : Number.isFinite(Number(result?.currentPlayer))
          ? Math.trunc(Number(result.currentPlayer))
          : -1;
      const myTurn = mySeatIndex >= 0 && liveCurrentPlayer >= 0 && getMySeatColor(currentRoomData) === liveCurrentPlayer;
      setBoardInteractionEnabled(myTurn);
      updateStatus(myTurn ? "Pati a an kou. Se ou ki pou jwe." : "Pati a an kou. N ap tann mouvman advese a...");
    } else if (result?.status === "waiting") {
      const deadlineMs = Number(result?.waitingDeadlineMs || 0);
      if (deadlineMs > 0) {
        currentWaitingDeadlineMs = deadlineMs;
        renderSearchCountdown();
        if (result?.expired === true || (deadlineMs > 0 && Date.now() >= deadlineMs)) {
          openExpiredModal();
        }
      }
    } else if (result?.status === "closed" || result?.expired === true) {
      openExpiredModal();
    }
  } catch (error) {
    console.warn("[DAME] ensureRoomReady failed", {
      roomId,
      status: localStatus,
      message: String(error?.message || error || ""),
      code: String(error?.code || ""),
    });
  }
}

async function touchPresence() {
  const roomId = String(currentRoomId || "").trim();
  if (!roomId || !currentUid) return;
  try {
    await touchRoomPresenceDameSecure({ roomId });
  } catch (_) {}
}

function startRoomSync() {
  if (!currentRoomId || !currentUid) return;
  stopRoomSync();

  const roomRef = doc(db, "dameRooms", currentRoomId);
  roomUnsub = onSnapshot(roomRef, async (snap) => {
    lastRoomSnapshotAtMs = Date.now();
    if (!snap.exists()) {
      updateStatus("Sal la pa jwenn. Komanse yon nouvo pati.");
      setBoardInteractionEnabled(false);
      openExpiredModal();
      closeSearchModal();
      return;
    }
    const previousRoomData = currentRoomData;
    currentRoomData = snap.data() || {};
    syncActiveStakeFromRoomData(currentRoomData);
    const seats = currentRoomData?.seats && typeof currentRoomData.seats === "object" ? currentRoomData.seats : {};
    mySeatIndex = Number.isFinite(Number(seats?.[currentUid])) ? Number(seats[currentUid]) : -1;
    const status = String(currentRoomData?.status || "").trim().toLowerCase();
    const humanCount = Array.isArray(currentRoomData?.playerUids)
      ? currentRoomData.playerUids.filter(Boolean).length
      : Number(currentRoomData?.humanCount || 0);
    const waitingDeadlineMs = Number(currentRoomData?.waitingDeadlineMs || 0);
    const currentPlayer = Number.isFinite(Number(currentRoomData?.currentPlayer))
      ? Number(currentRoomData.currentPlayer)
      : -1;
    const previousStatus = String(previousRoomData?.status || "").trim().toLowerCase();
    if (status !== "ended") {
      dameFriendRematchPending = false;
    }
    if (status === "playing" && !dameActionSubmitting) {
      hideDameLiveIssue();
    }
    if (previousStatus === "ended" && status === "playing") {
      prepareDameNextRoundStart();
    }
    const nextLastActionSeq = Number.isFinite(Number(currentRoomData?.lastActionSeq))
      ? Number(currentRoomData.lastActionSeq)
      : 0;
    const shouldReplayActions = status === "playing" && (previousStatus !== "playing" || nextLastActionSeq !== lastAppliedActionSeq);
    console.log("[DAME_TRACE] room-sync:snapshot", {
      roomId: currentRoomId,
      status,
      previousStatus,
      mySeatIndex,
      currentPlayer,
      lastActionSeq: nextLastActionSeq,
      localLastAppliedActionSeq: lastAppliedActionSeq,
      shouldReplayActions,
      humanCount,
    });

    updateBoardOrientation(currentRoomData);
    syncBoardTurnFromRoom(currentRoomData);
    updateDameRoomUi(currentRoomData);

    if (status === "playing") {
      if (!actionsUnsub) {
        startActionsSync();
      }
      if (shouldReplayActions) {
        replayDameActions(latestDameActionDocs);
      }
      closeSearchModal();
      closeExpiredModal();
      if (startedAtMs <= 0) {
        startedAtMs = Number(currentRoomData?.startedAtMs || Date.now()) || Date.now();
      }
      const roomTurnForUi = shouldReplayActions && Number.isFinite(Number(boardEl?.turn))
        ? (Math.trunc(Number(boardEl.turn)) % 2 ^ 1)
        : currentPlayer;
      const myTurn = mySeatIndex >= 0 && getMySeatColor(currentRoomData) === roomTurnForUi;
      setBoardInteractionEnabled(myTurn);
      updateStatus(myTurn ? "Pati a an kou. Se ou ki pou jwe." : "Pati a an kou. N ap tann mouvman advese a...");
      return;
    }

    setBoardInteractionEnabled(false);
    if (status === "waiting") {
      if (currentRoomMode === "dame_friends") {
        const opponentName = getOpponentName(currentRoomData);
        const waitingMessage = buildDameWaitingMessage({
          roomData: currentRoomData,
          opponentName,
        });
        openSearchModal(
          waitingMessage,
          waitingDeadlineMs > 0 ? waitingDeadlineMs : Date.now() + 15000
        );
        if (waitingDeadlineMs > Date.now()) {
          updateStatus(waitingMessage);
        } else {
          updateStatus("Pa gen jwe jwenn anko. Tounen nan meni an epi relanse.");
          openExpiredModal();
        }
        return;
      }
      const opponentName = getOpponentName(currentRoomData);
      openSearchModal(
        humanCount >= 2 && opponentName
          ? `Advese w ${opponentName} deja nan sal la. Pati a pral komanse taler konsa.`
          : "N ap chache yon lot jwe pou pati Dame ou a.",
        waitingDeadlineMs > 0 ? waitingDeadlineMs : Date.now() + 15000
      );
      if (waitingDeadlineMs > Date.now()) {
        const remaining = Math.max(0, Math.ceil((waitingDeadlineMs - Date.now()) / 1000));
        updateStatus(humanCount >= 2 && opponentName
          ? `Advese w ${opponentName} deja nan sal la. Pati a pral komanse taler konsa.`
          : `N ap tann lot jwe a... (${remaining}s)`);
      } else {
        updateStatus("Pa gen jwe jwenn anko. Tounen nan meni an epi relanse.");
        openExpiredModal();
      }
      return;
    }

    if (status === "ended" || status === "closed") {
      void refreshLiveWalletState(`room-${status}`);
      void ensureDameHistoryRecorded({
        ...(currentRoomData || {}),
        roomId: currentRoomId,
      });
      if (shouldHoldDameFriendRematch(currentRoomData)) {
        openDameFriendRematchWaitingModal();
        return;
      }
      closeSearchModal();
      const winnerUid = String(currentRoomData?.winnerUid || "").trim();
      const winnerSeat = Number.isFinite(Number(currentRoomData?.winnerSeat)) ? Number(currentRoomData.winnerSeat) : -1;
      const endedReason = String(currentRoomData?.endedReason || "").trim().toLowerCase();
      const hasNoWinner = !winnerUid && winnerSeat < 0;
      const isRefund = endedReason === "timeout_refund" || endedReason === "quit_refund_before_opening";
      const isDraw = !isRefund && (endedReason.startsWith("draw") || (hasNoWinner && !endedReason));
      const isTimeout = endedReason === "turn_timeout";
      const isForfeitWin = endedReason === "player_left" || endedReason === "disconnect_forfeit";
      const won = winnerUid
        ? winnerUid === currentUid
        : (mySeatIndex >= 0 && winnerSeat >= 0 && mySeatIndex === winnerSeat);
      const rewardDoes = Number(currentRoomData?.rewardAmountDoes || currentRoomData?.rewardDoes || 0);
      const rewardHtg = Math.max(0, Math.floor(Math.max(0, rewardDoes) / 20));
      if (dameResultShownForRoomId !== currentRoomId) {
        if (isRefund) {
          openDameRefundResultModal({ reason: endedReason });
          dameResultShownForRoomId = currentRoomId;
        } else if (isDraw) {
          openDameDrawResultModal();
          dameResultShownForRoomId = currentRoomId;
        } else if (won) {
          if (isForfeitWin) {
            openDameForfeitResultModal({ rewardHtg });
          } else {
            openDameResultModal({ won: true, rewardHtg });
          }
          dameResultShownForRoomId = currentRoomId;
          if (!dameFinalizeInFlight) {
            dameFinalizeInFlight = true;
            try {
              const finalizeResult = await finalizeDameMatchSecure({
                roomId: currentRoomId,
                winnerSeat,
                endedReason: endedReason || "match_end",
              });
              const paidRewardHtg = Number(
                finalizeResult?.rewardAmountHtg
                || Math.floor(Number(finalizeResult?.rewardAmountDoes || 0) / 20)
                || rewardHtg
              );
              if (isForfeitWin) {
                openDameForfeitResultModal({ rewardHtg: paidRewardHtg });
              } else {
                openDameResultModal({ won: true, rewardHtg: paidRewardHtg });
              }
            } catch (error) {
              updateStatus("Rezilta a jwenn, men peman an poko finalize. Tanpri rete sou paj la...");
              console.warn("[DAME] winner finalize from room snapshot failed", error);
            } finally {
              dameFinalizeInFlight = false;
            }
          }
        } else {
          if (isTimeout) {
            openDameTimeoutResultModal({ won: false });
          } else {
            openDameResultModal({ won: false, rewardHtg: 0 });
          }
          dameResultShownForRoomId = currentRoomId;
        }
      }
      updateStatus(
        isRefund
          ? "Pati a anile. Mize yo remet paske 2 bo yo pa te fe premye mouvman yo toude."
          : (isDraw
            ? "Pati a fini nul."
          : (isTimeout
            ? (won ? "Pati a fini. Ou genyen pa tan." : "Pati a fini. Ou pedi pa tan.")
            : (isForfeitWin
              ? (won ? "Advese a kite pati a. Ou genyen." : "Ou kite pati a. Ou pedi.")
              : (won ? "Pati a fini. Ou genyen." : "Pati a fini. Ou pedi."))))
      );
      return;
    }

    closeSearchModal();
    updateStatus(`Sal la aktif (${humanCount}/2).`);
  }, (error) => {
    console.warn("[DAME] room snapshot error", error);
    showDameLiveIssue("Koneksyon pati a gen reta. Pa kite paj la, n ap rekonekte otomatikman.", { autoHide: false });
    if (String(error?.code || "") === "permission-denied") {
      scheduleDameSyncRetry();
    }
  });

  ensureTimer = window.setInterval(() => {
    void syncRoomReady();
  }, 2000);
  presenceTimer = window.setInterval(() => {
    void touchPresence();
  }, DAME_PRESENCE_PING_INTERVAL_MS);
  turnSyncTimer = window.setInterval(() => {
    if (String(currentRoomData?.status || "").trim().toLowerCase() !== "playing") return;
    syncBoardTurnFromRoom(currentRoomData);
    renderTurnTimer(currentRoomData);
    syncDameInteractionGuard("turn-sync");
  }, 750);
  uiWatchdogTimer = window.setInterval(() => {
    if (!isDamePlaying(currentRoomData)) return;
    const nowMs = Date.now();
    if (dameActionSubmitting && dameActionSubmitStartedAtMs > 0) {
      const pendingMs = nowMs - dameActionSubmitStartedAtMs;
      if (pendingMs >= DAME_SLOW_SUBMIT_NOTICE_MS) {
        showDameLiveIssue("Mouvman ou a ap voye, men rezo a pran reta. Pa kite paj la, n ap verifye li.");
      }
      return;
    }
    syncDameInteractionGuard("watchdog");
    const lastRoomAgeMs = lastRoomSnapshotAtMs > 0 ? nowMs - lastRoomSnapshotAtMs : 0;
    if (lastRoomAgeMs > 10000 && isLocalPlayerTurn(currentRoomData)) {
      showDameLiveIssue("Nou pa resevwa nouvo synchro depi kek segond. Si tablo a pa reponn, n ap relanse synchro a.");
      scheduleDameSyncRetry(500);
    }
  }, DAME_UI_WATCHDOG_INTERVAL_MS);

  void syncRoomReady();
  void touchPresence();
}

async function bootRoomFlow() {
  if (!hasAuthUser || !currentUid) return;
  if (currentRoomMode !== "dame_friends") {
    friendFlowAction = "";
    currentInviteCode = "";
    requestedFriendRoomId = "";
  }
  syncDameRoomUrl();
  try {
    console.log("[DAME_TRACE] room-flow:start", {
      stakeDoes: activeStakeDoes,
      fundingCurrency,
      currentRoomMode,
      friendFlowAction,
      currentInviteCode,
      requestedFriendRoomId,
      uid: currentUid,
    });
    let result = null;
    if (currentRoomMode === "dame_friends") {
      if (requestedFriendRoomId) {
        result = await resumeFriendDameRoomSecure({ roomId: requestedFriendRoomId });
      } else if (friendFlowAction === "create") {
        result = await createFriendDameRoomSecure({
          stakeDoes: Math.max(0, activeStakeDoes),
          fundingCurrency,
          stakeHtg: getStakeHtgValue(activeStakeDoes),
        });
      } else if (friendFlowAction === "join" && currentInviteCode) {
        result = await joinFriendDameRoomByCodeSecure({
          inviteCode: currentInviteCode,
          fundingCurrency,
        });
      } else {
        const missingInviteError = new Error("Code salon Dame a manke.");
        missingInviteError.code = "missing-invite-code";
        throw missingInviteError;
      }
    } else {
      result = await joinMatchmakingDameSecure({
        stakeDoes: Math.max(0, activeStakeDoes),
        fundingCurrency,
        stakeHtg: getStakeHtgValue(activeStakeDoes),
      });
    }
    if (safeInt(result?.stakeDoes) > 0) {
      activeStakeDoes = safeInt(result.stakeDoes);
    }
    currentRoomId = String(result?.roomId || "").trim();
    currentRoomMode = normalizeDameRoomMode(result?.roomMode || currentRoomMode);
    if (currentRoomMode === "dame_friends") {
      currentInviteCode = normalizeInviteCode(result?.inviteCode || currentInviteCode);
      requestedFriendRoomId = currentRoomId || requestedFriendRoomId;
      dameFriendRematchPending = hasLocalDameFriendRematchRequest(result || {});
    } else {
      currentInviteCode = "";
      requestedFriendRoomId = "";
      dameFriendRematchPending = false;
    }
    syncDameRoomUrl();
    await refreshLiveWalletState("join");
    console.log("[DAME_TRACE] room-flow:result", {
      uid: currentUid,
      result,
      currentRoomId,
      currentRoomMode,
      currentInviteCode,
      requestedFriendRoomId,
    });
    if (!currentRoomId) {
      updateStatus("Pa posib antre nan sal Dame a.");
      setBoardInteractionEnabled(false);
      return;
    }
    const resultStatus = String(result?.status || "").trim().toLowerCase();
    if (resultStatus === "waiting") {
      const waitingMessage = buildDameWaitingMessage();
      openSearchModal(
        waitingMessage,
        Number(result?.waitingDeadlineMs || Date.now() + 15000)
      );
      updateStatus(currentRoomMode === "dame_friends" ? waitingMessage : "Rechech jwe an kou...");
    } else {
      closeSearchModal();
      updateStatus("Pati a ap chaje...");
    }
    setBoardInteractionEnabled(false);
    startRoomSync();
    return;
  } catch (error) {
    console.warn("[DAME] room flow error", error);
    if (!showDameRoomFlowIssue(error)) {
      updateStatus(error?.message || "Ere koneksyon sal la. Eseye anko depi akey la.");
    }
    setBoardInteractionEnabled(false);
    updateBoardOrientation({ status: "" });
    closeSearchModal();
    clearSyncRetryTimer();
    return;
  }
}

onAuthStateChanged(auth, (user) => {
  currentUid = String(user?.uid || "").trim();
  hasAuthUser = !!currentUid;
  void refreshBalance();
  if (currentUid) {
    void ensureXchangeState(currentUid).then(() => {
      updateBalanceLabel(computeHtgBalance({}));
    }).catch(() => {});
    updateStatus("Li reg yo avan ou antre nan pati a.");
    pendingBootAfterRulesModal = true;
    openDameRulesModal();
  } else {
    updateStatus("Konekte pou jwe sou entenet.");
    setBoardInteractionEnabled(false);
    updateBoardOrientation({ status: "" });
    closeSearchModal();
    closeDameRulesModal();
  }
});

window.addEventListener("xchangeUpdated", () => {
  updateBalanceLabel(computeHtgBalance({}));
});

window.addEventListener("userBalanceUpdated", () => {
  updateBalanceLabel(computeHtgBalance({}));
});

expiredRetryBtn?.addEventListener("click", () => {
  void restartDameSearch({ fresh: true });
});

expiredHomeBtn?.addEventListener("click", () => {
  void leaveCurrentDameRoom({ redirect: true });
});

expiredStayBtn?.addEventListener("click", () => {
  void restartDameSearch({ fresh: false });
});

expiredPhoneRevealBtn?.addEventListener("click", () => {
  if (expiredPhoneBox) {
    expiredPhoneBox.classList.add("visible");
  }
  expiredPhoneInput?.focus();
});

expiredViewNumberBtn?.addEventListener("click", async () => {
  await loadDameWhatsappConfig();
  if (dameWhatsappAgentDigits && expiredAgentValue) {
    expiredAgentValue.textContent = `Nimewo WhatsApp ajan an: ${formatWhatsappDisplay(dameWhatsappAgentDigits)}`;
  }
});

expiredPhoneSaveBtn?.addEventListener("click", async () => {
  const phone = String(expiredPhoneInput?.value || "").trim();
  if (!phone) {
    if (expiredAgentValue) {
      expiredAgentValue.textContent = "Mete yon nimewo WhatsApp anvan ou anrejistre l.";
    }
    return;
  }
  try {
    await saveDameWaitlistInfo({ phone, notify: false });
    if (expiredAgentValue) {
      expiredAgentValue.textContent = "Nimewo a anrejistre.";
    }
  } catch (error) {
    console.warn("[DAME] save phone failed", error);
    if (expiredAgentValue) {
      expiredAgentValue.textContent = error?.message || "Pa posib anrejistre nimewo a pou kounye a.";
    }
  }
});

expiredNotifyBtn?.addEventListener("click", async () => {
  try {
    const phone = String(expiredPhoneInput?.value || "").trim();
    await saveDameWaitlistInfo({ phone, notify: true });
    if (expiredAgentValue) {
      expiredAgentValue.textContent = "Nou anrejistre demann notifikasyon ou a.";
    }
  } catch (error) {
    console.warn("[DAME] notify request failed", error);
    if (expiredAgentValue) {
      expiredAgentValue.textContent = error?.message || "Pa posib anrejistre notifikasyon an pou kounye a.";
    }
  }
});

expiredOverlayEl?.addEventListener("click", (event) => {
  if (event.target === expiredOverlayEl) {
    closeExpiredModal();
  }
});

document.getElementById("dameSearchExpiredOverlay")?.querySelector(".expired-card")?.addEventListener("click", (event) => {
  event.stopPropagation();
});

searchCopyCodeBtn?.addEventListener("click", async () => {
  const copied = await copyText(currentInviteCode);
  const defaultLabel = "Kopye kod la";
  searchCopyCodeBtn.textContent = copied ? "Kod la kopye" : defaultLabel;
  window.setTimeout(() => {
    if (searchCopyCodeBtn) {
      searchCopyCodeBtn.textContent = defaultLabel;
    }
  }, 1500);
});

void loadDameWhatsappConfig();

boardEl?.addEventListener("piecemove", () => {
  if (replayingRemoteAction || rebuildingBoardState) return;
  if (startedAtMs <= 0) {
    startedAtMs = Date.now();
  }
});

boardEl?.addEventListener("piecemove", async (event) => {
  if (replayingRemoteAction || rebuildingBoardState) return;
  if (!currentUid || !currentRoomId) return;
  const status = String(currentRoomData?.status || "").trim().toLowerCase();
  if (status !== "playing") return;

  const piecePlayer = Number(event?.detail?.piece?.data?.player?.());
  if (!Number.isFinite(piecePlayer) || piecePlayer < 0 || piecePlayer > 1) return;
  if (mySeatIndex >= 0 && getMySeatColor(currentRoomData) !== piecePlayer) return;

  const fromField = event?.detail?.fromField;
  const toField = event?.detail?.toField;
  const fromLine = Number(fromField?.data?.line);
  const fromColumn = Number(fromField?.data?.column);
  const toLine = Number(toField?.data?.line);
  const toColumn = Number(toField?.data?.column);
  if (![fromLine, fromColumn, toLine, toColumn].every((n) => Number.isFinite(n))) return;
  const canonicalFrom = normalizeCoordPair(fromLine, fromColumn);
  const canonicalTo = normalizeCoordPair(toLine, toColumn);
  if (!canonicalFrom || !canonicalTo) return;
  const boardTurnValue = Number.isFinite(Number(event?.detail?.turn))
    ? Math.trunc(Number(event.detail.turn))
    : Number.isFinite(Number(boardEl?.turn))
      ? Math.trunc(Number(boardEl.turn))
      : 0;
  const clientActionId = `dame:${currentRoomId}:${mySeatIndex}:${piecePlayer}:${boardTurnValue}:${canonicalFrom.line},${canonicalFrom.column}>${canonicalTo.line},${canonicalTo.column}`;
  console.log("[DAME_TRACE] move:local-submit", {
    roomId: currentRoomId,
    uid: currentUid,
    mySeatIndex,
    piecePlayer,
    from: { line: canonicalFrom.line, column: canonicalFrom.column },
    to: { line: canonicalTo.line, column: canonicalTo.column },
    boardTurnValue,
    clientActionId,
  });

  dameActionSubmitting = true;
  dameActionSubmitStartedAtMs = Date.now();
  renderTurnTimer(currentRoomData);
  try {
    const result = await submitActionDameSecure({
      roomId: currentRoomId,
      seatIndex: mySeatIndex,
      piecePlayer,
      from: { line: canonicalFrom.line, column: canonicalFrom.column },
      to: { line: canonicalTo.line, column: canonicalTo.column },
      changeTurn: event?.detail?.changeTurn !== false,
      clientActionId,
    });
    const seq = Number(result?.seq || 0);
    const nextPlayer = Number(result?.currentPlayer);
    console.log("[DAME_TRACE] move:submit-result", {
      roomId: currentRoomId,
      clientActionId,
      result,
      seq,
      nextPlayer,
    });
    hideDameLiveIssue();
    if (Number.isFinite(nextPlayer)) {
      currentRoomData = {
        ...(currentRoomData || {}),
        currentPlayer: nextPlayer,
        turnDeadlineMs: Number(result?.turnDeadlineMs || currentRoomData?.turnDeadlineMs || 0),
        turnStartedAtMs: Number(result?.turnStartedAtMs || currentRoomData?.turnStartedAtMs || 0),
      };
      syncBoardTurnFromRoom(currentRoomData);
      updateDameRoomUi(currentRoomData);
      setBoardInteractionEnabled(mySeatIndex >= 0 && getMySeatColor(currentRoomData) === nextPlayer);
    }
    if (Number.isFinite(seq) && seq > 0) {
      lastAppliedActionSeq = Math.max(lastAppliedActionSeq, seq);
    }
  } catch (error) {
    console.warn("[DAME] submit action failed", error);
    showDameLiveIssue("Mouvman an pa rive verifye. N ap remet tablo a menm jan ak serveur a pou ou ka rejwe si se toujou tou pa ou.", { autoHide: false });
    recoverDameBoardFromServer("submit-failed");
    updateStatus("Mouvman an pa pase. Si se toujou tou pa ou, chwazi pion an epi jwe anko.");
  } finally {
    dameActionSubmitting = false;
    dameActionSubmitStartedAtMs = 0;
    renderTurnTimer(currentRoomData);
    syncDameInteractionGuard("submit-finally");
  }
});

boardEl?.addEventListener("gameover", async (event) => {
  if (replayingRemoteAction || rebuildingBoardState) return;
  const winnerColor = Number(event?.detail?.winner);
  const winnerSeat = getSeatIndexForColor(currentRoomData || {}, winnerColor);
  const endedAtMs = Date.now();
  const dedupeKey = `${winnerColor}:${winnerSeat}:${endedAtMs}`;
  if (submittedResultKey === dedupeKey) return;
  submittedResultKey = dedupeKey;

  if (!currentUid) {
    updateStatus("Pati a fini. Konekte pou anrejistre rezilta sa a.");
    return;
  }

  const winnerSeatSafe = Number.isFinite(winnerSeat) ? winnerSeat : -1;
  const matchId = `dame_${currentUid}_${endedAtMs}`;
  const myWon = mySeatIndex >= 0 && winnerSeatSafe >= 0 && mySeatIndex === winnerSeatSafe;

  if (winnerSeatSafe >= 0 && !dameFinalizeInFlight) {
    dameFinalizeInFlight = true;
    try {
      const finalizeResult = await finalizeDameMatchSecure({
        roomId: currentRoomId,
        winnerSeat: winnerSeatSafe,
        endedReason: "gameover",
      });
      const resolvedWinnerUid = String(finalizeResult?.winnerUid || "").trim();
      const iWon = resolvedWinnerUid ? (resolvedWinnerUid === currentUid) : myWon;
      if (iWon) {
        const rewardHtg = Number(finalizeResult?.rewardAmountHtg || Math.floor(Number(finalizeResult?.rewardAmountDoes || 0) / 20) || 0);
        openDameResultModal({ won: true, rewardHtg });
        dameResultShownForRoomId = currentRoomId;
        updateStatus("Pati a fini. Ou genyen.");
      }
    } catch (error) {
      const message = String(error?.message || "").toLowerCase();
      if (!message.includes("gayan")) {
        console.warn("[DAME] finalize failed", error);
      }
    } finally {
      dameFinalizeInFlight = false;
    }
  }

  if (!myWon) {
    openDameResultModal({ won: false, rewardHtg: 0 });
    dameResultShownForRoomId = currentRoomId;
    updateStatus("Pati a fini. Ou pedi.");
  }

  return;

  try {
    await recordDameMatchResultSecure({
      matchId,
      roomId: currentRoomId,
      roomMode,
      stakeDoes: activeStakeDoes,
      stakeHtg: Math.max(0, Math.floor(Math.max(0, activeStakeDoes) / 20)),
      fundingCurrency,
      winnerSeat: winnerSeatSafe,
      winnerUid: winnerSeatSafe >= 0 && Array.isArray(currentRoomData?.playerUids)
        ? String(currentRoomData.playerUids[winnerSeatSafe] || "").trim()
        : "",
      playerUids: Array.isArray(currentRoomData?.playerUids)
        ? currentRoomData.playerUids.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 2)
        : [],
      winnerType: "human",
      rewardAmountDoes: Math.max(0, Number(currentRoomData?.rewardAmountDoes || currentRoomData?.rewardDoes || 0) || 0),
      rewardAmountHtg: Math.max(
        0,
        Math.trunc(
          Number(currentRoomData?.rewardAmountHtg || Math.floor((Number(currentRoomData?.rewardAmountDoes || currentRoomData?.rewardDoes || 0) || 0) / 20)) || 0
        )
      ),
      startedAtMs: startedAtMs > 0 ? startedAtMs : 0,
      endedAtMs,
      endedReason: "gameover",
    });
  } catch (error) {
    console.warn("[DAME] echec enregistrement resultat", error);
  }
});

window.addEventListener("beforeunload", () => {
  void leaveCurrentDameRoomSilently();
});

window.addEventListener("pagehide", () => {
  void leaveCurrentDameRoomSilently();
});

window.addEventListener("offline", () => {
  void leaveCurrentDameRoomSilently();
});

window.addEventListener("popstate", () => {
  if (!currentRoomId) return;
  try {
    history.pushState({ dame: true }, "", window.location.href);
  } catch (_) {
  }
  void leaveCurrentDameRoomAndGoHome();
});

armDameHistoryGuard();
