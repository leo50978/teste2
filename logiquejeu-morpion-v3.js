import {
  auth,
  onAuthStateChanged,
} from "./firebase-init.js";
import {
  createFriendMorpionRoomV3Secure,
  getMorpionV3RoomStateSecure,
  joinFriendMorpionRoomByCodeV3Secure,
  joinMatchmakingMorpionV3Secure,
  leaveRoomMorpionV3Secure,
  requestFriendMorpionRematchV3Secure,
  resumeFriendMorpionRoomV3Secure,
  submitActionMorpionV3Secure,
  touchRoomPresenceMorpionV3Secure,
} from "./secure-functions.js?v=20260625-morpion-firebase1";
import { ensureXchangeState, getXchangeState } from "./xchange.js";

const BOARD_SIZE = 15;
const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
const TURN_DURATION_SECONDS = 90;
const WAIT_SECONDS = 15;
const DEFAULT_STAKE_HTG = 25;
const PRESENCE_PING_INTERVAL_MS = 3000;
const WHATSAPP_GROUP_URL = "https://chat.whatsapp.com/IENi1LH9hn0JWrLfaZwwv1";

const dom = {
  board: document.getElementById("morpionBoard"),
  stakeModal: document.getElementById("morpionStakeModal"),
  stakeInput: document.getElementById("morpionStakeInput"),
  stakeHomeBtn: document.getElementById("morpionStakeHomeBtn"),
  stakeContinueBtn: document.getElementById("morpionStakeContinueBtn"),
  stakeFriendBtn: document.getElementById("morpionStakeFriendBtn"),
  stakeJoinFriendBtn: document.getElementById("morpionStakeJoinFriendBtn"),
  inviteModal: document.getElementById("morpionInviteModal"),
  inviteTitle: document.getElementById("morpionInviteTitle"),
  inviteCopy: document.getElementById("morpionInviteCopy"),
  inviteAcceptBtn: document.getElementById("morpionInviteAcceptBtn"),
  inviteRefuseBtn: document.getElementById("morpionInviteRefuseBtn"),
  modeModal: document.getElementById("morpionModeModal"),
  modePublicBtn: document.getElementById("morpionModePublicBtn"),
  modeCreateFriendBtn: document.getElementById("morpionModeCreateFriendBtn"),
  modeJoinFriendBtn: document.getElementById("morpionModeJoinFriendBtn"),
  privateCreateModal: document.getElementById("morpionPrivateCreateModal"),
  privateCreateStakeInput: document.getElementById("morpionPrivateCreateStakeInput"),
  privateCreateBackBtn: document.getElementById("morpionPrivateCreateBackBtn"),
  privateCreateSubmitBtn: document.getElementById("morpionPrivateCreateSubmitBtn"),
  friendShareModal: document.getElementById("morpionFriendShareModal"),
  friendInviteCodeValue: document.getElementById("morpionFriendInviteCodeValue"),
  friendShareCopyBtn: document.getElementById("morpionFriendShareCopyBtn"),
  friendShareContinueBtn: document.getElementById("morpionFriendShareContinueBtn"),
  friendJoinModal: document.getElementById("morpionFriendJoinModal"),
  friendJoinCodeInput: document.getElementById("morpionFriendJoinCodeInput"),
  friendJoinStatus: document.getElementById("morpionFriendJoinStatus"),
  friendJoinBackBtn: document.getElementById("morpionFriendJoinBackBtn"),
  friendJoinSubmitBtn: document.getElementById("morpionFriendJoinSubmitBtn"),
  waitingModal: document.getElementById("morpionWaitingModal"),
  waitingTitle: document.getElementById("morpionWaitingTitle"),
  waitingCopy: document.getElementById("morpionWaitingCopy"),
  waitingTimerWrap: document.getElementById("morpionWaitingTimerWrap"),
  waitingTimerValue: document.getElementById("morpionWaitingTimerValue"),
  waitingActions: document.getElementById("morpionWaitingActions"),
  waitingHomeBtn: document.getElementById("morpionWaitingHomeBtn"),
  waitingRetryBtn: document.getElementById("morpionWaitingRetryBtn"),
  waitingStopExtendBtn: document.getElementById("morpionWaitingStopExtendBtn"),
  waitingNotifyBtn: document.getElementById("morpionWaitingNotifyBtn"),
  waitingGroupBtn: document.getElementById("morpionWaitingGroupBtn"),
  waitingWhatsappBtn: document.getElementById("morpionWaitingWhatsappBtn"),
  waitingContactsBtn: document.getElementById("morpionWaitingContactsBtn"),
  whatsappModal: document.getElementById("morpionWhatsappModal"),
  whatsappCloseBtn: document.getElementById("morpionWhatsappCloseBtn"),
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
  ruleModal: document.getElementById("morpionRuleModal"),
  ruleContinueBtn: document.getElementById("morpionRuleContinueBtn"),
  selfCard: document.querySelector('[data-player-side="self"]'),
  opponentCard: document.querySelector('[data-player-side="opponent"]'),
  selfName: document.getElementById("morpionSelfName"),
  opponentName: document.getElementById("morpionOpponentName"),
  opponentLabel: document.getElementById("morpionOpponentLabel"),
  walletValue: document.getElementById("morpionWalletValue"),
  revealResultBtn: document.getElementById("morpionRevealResultBtn"),
  selfSymbol: document.getElementById("morpionSelfSymbol"),
  opponentSymbol: document.getElementById("morpionOpponentSymbol"),
  selfTimerLabel: document.getElementById("morpionSelfTimerLabel"),
  opponentTimerLabel: document.getElementById("morpionOpponentTimerLabel"),
  selfTimerFill: document.getElementById("morpionSelfTimerFill"),
  opponentTimerFill: document.getElementById("morpionOpponentTimerFill"),
};

let selectedStakeHtg = DEFAULT_STAKE_HTG;
let currentUser = null;
let currentRoomId = "";
let currentSeatIndex = -1;
let currentRoomState = null;
let joining = false;
let actionSending = false;
let roomPollTimer = null;
let waitingTimer = null;
let turnUiTimer = null;
let presenceTimer = null;
let waitDeadlineMs = 0;
let roomWaitingDeadlineMs = 0;
let leavingRoom = false;
let lastKnownRoomStatus = "";
let currentRoomMode = "public";
let currentInviteCode = "";
let pendingStartFlow = "public";
let friendActionBusy = false;
let friendRematchRequestBusy = false;
let friendRematchPending = false;
let pendingJoinInviteCode = "";
let pendingJoinStakeHtg = DEFAULT_STAKE_HTG;
let roomPollFailureCount = 0;
let offlineLeaveTimer = null;
let connectionToastTimer = null;
let connectionToastEl = null;

function debugMorpion(label, payload = null) {
  try {
    if (typeof payload === "undefined" || payload === null) {
      console.log(`[MORPION_V3_DEBUG] ${label}`);
      return;
    }
    console.log(`[MORPION_V3_DEBUG] ${label}`, payload);
  } catch (_) {
  }
}

function isTransientNetworkError(error) {
  const rawMessage = String(error?.message || "").trim().toLowerCase();
  const rawCode = String(error?.code || "").trim().toLowerCase();
  return /failed to fetch|network|timeout|timed out|load failed|abort|internet|offline|unavailable|deadline/i.test(rawMessage)
    || /unavailable|deadline|network|timeout|aborted/i.test(rawCode);
}

function ensureConnectionToast() {
  if (connectionToastEl) return connectionToastEl;
  connectionToastEl = document.createElement("div");
  connectionToastEl.className = "morpion-connection-toast hidden";
  connectionToastEl.setAttribute("role", "status");
  connectionToastEl.setAttribute("aria-live", "polite");
  connectionToastEl.innerHTML = `
    <span class="morpion-connection-toast__dot" aria-hidden="true"></span>
    <span class="morpion-connection-toast__text">Koneksyon feb. N ap reeseye...</span>
  `;
  document.body.appendChild(connectionToastEl);

  const style = document.createElement("style");
  style.textContent = `
    .morpion-connection-toast {
      position: fixed;
      left: 50%;
      top: max(12px, env(safe-area-inset-top));
      z-index: 80;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      max-width: calc(100vw - 28px);
      transform: translateX(-50%);
      border: 1px solid rgba(120, 92, 58, 0.18);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 16px 38px rgba(22, 28, 35, 0.16);
      color: #26313b;
      padding: 10px 14px;
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.01em;
      backdrop-filter: blur(12px);
    }
    .morpion-connection-toast.hidden {
      display: none;
    }
    .morpion-connection-toast__dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: #d68a2c;
      box-shadow: 0 0 0 5px rgba(214, 138, 44, 0.16);
      flex: 0 0 auto;
    }
  `;
  document.head.appendChild(style);
  return connectionToastEl;
}

function showConnectionToast(message = "Koneksyon feb. N ap reeseye...", ttlMs = 2600) {
  const toast = ensureConnectionToast();
  const textEl = toast.querySelector(".morpion-connection-toast__text");
  if (textEl) textEl.textContent = message;
  toast.classList.remove("hidden");
  if (connectionToastTimer) window.clearTimeout(connectionToastTimer);
  if (ttlMs > 0) {
    connectionToastTimer = window.setTimeout(() => {
      toast.classList.add("hidden");
    }, ttlMs);
  }
}

function hideConnectionToast() {
  if (connectionToastTimer) {
    window.clearTimeout(connectionToastTimer);
    connectionToastTimer = null;
  }
  connectionToastEl?.classList.add("hidden");
}

function resetRoomNetworkFailures() {
  roomPollFailureCount = 0;
  hideConnectionToast();
}

const URL_PARAMS = new URLSearchParams(window.location.search);

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function getFriendRoomIdFromUrl() {
  return String(URL_PARAMS.get("friendMorpionRoomId") || URL_PARAMS.get("roomId") || "").trim();
}

function isFriendFlowFromUrl() {
  return String(URL_PARAMS.get("mode") || "").trim().toLowerCase() === "friend" && getFriendRoomIdFromUrl().length > 0;
}

function syncRoomUrl() {
  try {
    const nextUrl = new URL(window.location.href);
    if (currentRoomMode === "morpion_friends_v3" && currentRoomId) {
      nextUrl.searchParams.set("mode", "friend");
      nextUrl.searchParams.set("friendMorpionRoomId", currentRoomId);
    } else {
      nextUrl.searchParams.delete("mode");
      nextUrl.searchParams.delete("friendMorpionRoomId");
    }
    window.history.replaceState({ morpion: true }, "", nextUrl.toString());
  } catch (_) {
  }
}

function setFriendJoinStatus(message = "", isError = false) {
  if (!dom.friendJoinStatus) return;
  dom.friendJoinStatus.textContent = message;
  dom.friendJoinStatus.style.color = isError ? "#b91c1c" : "";
}

async function copyText(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {
  }
  return false;
}

function formatHtg(amount) {
  return `${safeInt(amount, 0)} HTG`;
}

function getFriendRematchRequestUids(state = currentRoomState) {
  return Array.isArray(state?.rematchRequestUids)
    ? state.rematchRequestUids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function hasLocalFriendRematchRequest(state = currentRoomState) {
  const uid = String(currentUser?.uid || auth.currentUser?.uid || "").trim();
  return uid ? getFriendRematchRequestUids(state).includes(uid) : false;
}

function shouldHoldFriendRematch(state = currentRoomState) {
  return currentRoomMode === "morpion_friends_v3"
    && String(state?.status || "").trim() === "ended"
    && (friendRematchPending || hasLocalFriendRematchRequest(state));
}

function normalizeStakeHtg(value, fallback = DEFAULT_STAKE_HTG) {
  const parsed = safeInt(value, fallback) || fallback;
  return Math.max(DEFAULT_STAKE_HTG, parsed);
}

function readPrivateCreateStakeDraft() {
  return Math.max(0, safeInt(dom.privateCreateStakeInput?.value, 0));
}

function readStakeDraft() {
  return Math.max(0, safeInt(dom.stakeInput?.value, 0));
}

function show(element) {
  if (!element) return;
  element.classList.remove("hidden");
}

function hide(element) {
  if (!element) return;
  element.classList.add("hidden");
}

function openModal(element) {
  show(element);
}

function closeModal(element) {
  hide(element);
}

function setResultModal(eyebrow, title, copy) {
  if (dom.resultEyebrow) dom.resultEyebrow.textContent = eyebrow;
  if (dom.resultTitle) dom.resultTitle.textContent = title;
  if (dom.resultCopy) dom.resultCopy.textContent = copy;
  openModal(dom.resultModal);
}

function renderWallet() {
  const uid = String(currentUser?.uid || auth.currentUser?.uid || "").trim();
  const baseBalance = window.__userBaseBalance || window.__userBalance || 0;
  const state = getXchangeState(baseBalance, uid || undefined);
  const total = safeInt(state?.totalBalance, 0);
  if (dom.walletValue) dom.walletValue.textContent = formatHtg(total);
  if (dom.privateCreateStakeInput) {
    dom.privateCreateStakeInput.min = String(DEFAULT_STAKE_HTG);
    dom.privateCreateStakeInput.max = String(Math.max(DEFAULT_STAKE_HTG, total));
    dom.privateCreateStakeInput.step = "1";
  }
  updatePrivateCreateSubmitState();
}

function getCurrentWalletTotalHtg() {
  const uid = String(currentUser?.uid || auth.currentUser?.uid || "").trim();
  const baseBalance = window.__userBaseBalance || window.__userBalance || 0;
  const state = getXchangeState(baseBalance, uid || undefined);
  return safeInt(state?.totalBalance, 0);
}

function updateStakeActionAvailability() {
  const draftStake = readStakeDraft();
  const isValidStake = draftStake >= DEFAULT_STAKE_HTG;
  const publicStake = DEFAULT_STAKE_HTG;
  const friendStake = isValidStake
    ? draftStake
    : normalizeStakeHtg(dom.stakeInput?.value, selectedStakeHtg || DEFAULT_STAKE_HTG);
  const balance = getCurrentWalletTotalHtg();

  if (dom.stakeInput) {
    dom.stakeInput.setAttribute("aria-invalid", isValidStake ? "false" : "true");
    dom.stakeInput.setCustomValidity(
      isValidStake ? "" : `Mete omwen ${formatHtg(DEFAULT_STAKE_HTG)} pou kontinye.`
    );
  }

  [
    { button: dom.stakeContinueBtn, requiredStake: publicStake, label: "jwe piblik la" },
    { button: dom.stakeFriendBtn, requiredStake: friendStake, label: "kreye salon prive a" },
    { button: dom.stakeJoinFriendBtn, requiredStake: DEFAULT_STAKE_HTG, label: "antre nan salon prive a", allowWithoutDraftStake: true },
  ].forEach(({ button, requiredStake, label, allowWithoutDraftStake = false }) => {
    if (!button) return;
    const canAfford = balance >= requiredStake;
    const canProceed = (isValidStake || allowWithoutDraftStake) && canAfford;
    const shortfall = Math.max(0, requiredStake - balance);
    button.disabled = !canProceed;
    button.setAttribute("aria-disabled", canProceed ? "false" : "true");
    button.classList.toggle("is-disabled", !canProceed);
    if (!isValidStake && !allowWithoutDraftStake) {
      button.title = `Miz la pa ka desann anba ${formatHtg(DEFAULT_STAKE_HTG)}.`;
    } else if (!canAfford) {
      button.title = `Ou bezwen ${formatHtg(shortfall)} anplis pou ${label}.`;
    } else {
      button.removeAttribute("title");
    }
  });
}

function updatePrivateCreateSubmitState() {
  if (!dom.privateCreateSubmitBtn) return;
  const draftStake = readPrivateCreateStakeDraft();
  const isValidStake = draftStake >= DEFAULT_STAKE_HTG;
  dom.privateCreateSubmitBtn.disabled = !isValidStake;
  dom.privateCreateSubmitBtn.setAttribute("aria-disabled", isValidStake ? "false" : "true");
  dom.privateCreateSubmitBtn.classList.toggle("is-disabled", !isValidStake);
  if (dom.privateCreateStakeInput) {
    dom.privateCreateStakeInput.setAttribute("aria-invalid", isValidStake ? "false" : "true");
    dom.privateCreateStakeInput.setCustomValidity(
      isValidStake ? "" : `Mete omwen ${formatHtg(DEFAULT_STAKE_HTG)} pou salon prive a.`
    );
  }
  if (!isValidStake) {
    dom.privateCreateSubmitBtn.title = `Miz salon prive a pa ka desann anba ${formatHtg(DEFAULT_STAKE_HTG)}.`;
  } else {
    dom.privateCreateSubmitBtn.removeAttribute("title");
  }
}

async function refreshWallet() {
  try {
    const uid = String(currentUser?.uid || auth.currentUser?.uid || "").trim();
    await ensureXchangeState(uid || undefined);
  } catch (_) {
  }
  renderWallet();
  updateStakeActionAvailability();
}

async function ensureStakeIsAffordable(stakeHtg, contextLabel = "jwe Mopyon") {
  const requiredStake = Math.max(1, safeInt(stakeHtg, DEFAULT_STAKE_HTG) || DEFAULT_STAKE_HTG);
  const hasEnoughNow = getCurrentWalletTotalHtg() >= requiredStake;
  if (!hasEnoughNow) {
    await refreshWallet();
  }
  const currentBalance = getCurrentWalletTotalHtg();
  if (currentBalance >= requiredStake) return true;
  const missing = Math.max(0, requiredStake - currentBalance);
  setResultModal(
    "Mopyon",
    "Solde a pa sifi",
    `Ou pa ka ${contextLabel} ak ${formatHtg(requiredStake)} pou kounye a. Balans ou se ${formatHtg(currentBalance)} epi ou manke ${formatHtg(missing)}.`
  );
  openModal(dom.stakeModal);
  return false;
}

function isMorpionStakeShortfallError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  return code === "insufficient-funds"
    || code === "morpion-v3-insufficient-funds"
    || code === "morpion-v3-owner-insufficient-funds";
}

function showMorpionStakeErrorModal(error, contextLabel = "antre nan salon prive sa a", fallbackStakeHtg = 0) {
  if (!isMorpionStakeShortfallError(error)) return false;
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  const culpritRole = String(details.culpritRole || "").trim().toLowerCase();
  const requiredStake = Math.max(
    DEFAULT_STAKE_HTG,
    safeInt(details.requiredHtg, fallbackStakeHtg || selectedStakeHtg || DEFAULT_STAKE_HTG)
  );
  const playableHtg = Math.max(0, safeInt(details.playableHtg, getCurrentWalletTotalHtg()));
  const missingHtg = Math.max(0, safeInt(details.missingHtg, requiredStake - playableHtg));

  closeModal(dom.friendJoinModal);
  closeModal(dom.privateCreateModal);
  closeModal(dom.modeModal);

  if (culpritRole === "owner") {
    setResultModal(
      "Mopyon",
      "Kreyate a pa pare",
      `Kreyate salon an pa gen ${formatHtg(requiredStake)} disponib anko pou lanse match la. Mande li rechaje oswa chwazi yon lot miz.`
    );
    return true;
  }

  setResultModal(
    "Mopyon",
    "Solde a pa sifi",
    `Salon sa a mande ${formatHtg(requiredStake)}. Balans ou se ${formatHtg(playableHtg)} epi ou manke ${formatHtg(missingHtg)} pou ${contextLabel}.`
  );
  return true;
}

function showMorpionStakeMismatchModal(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  if (code !== "morpion-v3-stake-mismatch") return false;
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  const roomStakeHtg = Math.max(DEFAULT_STAKE_HTG, safeInt(details.roomStakeHtg, selectedStakeHtg || DEFAULT_STAKE_HTG));
  closeModal(dom.friendJoinModal);
  setResultModal(
    "Mopyon",
    "Miz salon an diferan",
    `Salon prive sa a mande ${formatHtg(roomStakeHtg)}. Mande zanmi ou konfime miz la epi eseye anko.`
  );
  return true;
}

function renderFriendStakeCopy() {
  const copyEl = dom.friendShareModal?.querySelector(".modal__copy");
  if (!copyEl) return;
  copyEl.textContent = `Zanmi ou a dwe antre menm kòd sa a sou lòt kont lan pou li rantre nan menm match la ak yon miz ${formatHtg(selectedStakeHtg)}.`;
}

function openFriendJoinConfirmModal(inviteCode, stakeHtg) {
  pendingJoinInviteCode = String(inviteCode || "").trim();
  pendingJoinStakeHtg = normalizeStakeHtg(stakeHtg, DEFAULT_STAKE_HTG);
  if (dom.inviteTitle) dom.inviteTitle.textContent = "Konfime antre ou";
  if (dom.inviteCopy) {
    dom.inviteCopy.textContent = `Ou pral eseye antre nan salon ${pendingJoinInviteCode} ak yon miz ${formatHtg(pendingJoinStakeHtg)}. Non kreyatè sal la ak miz serve a poko ekspoze pa backend aktyèl la, kidonk mande zanmi ou konfime yo si sa nesesè.`;
  }
  openModal(dom.inviteModal);
}

function ensurePrivateFlowUi() {
  if (!dom.privateCreateModal) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <div id="morpionPrivateCreateModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="morpionPrivateCreateTitle">
        <div class="modal__backdrop"></div>
        <div class="modal__card">
          <div class="modal__eyebrow">Salle prive</div>
          <h2 class="modal__title" id="morpionPrivateCreateTitle">Kreye salon ou</h2>
          <p class="modal__copy">Chwazi kantite HTG pou salon prive a. Minimom lan rete 25 HTG.</p>
          <label class="field-stack" for="morpionPrivateCreateStakeInput">
            <span class="field-stack__label">Miz salon an</span>
            <input id="morpionPrivateCreateStakeInput" class="field-stack__input" type="number" inputmode="numeric" min="25" step="1" value="25" />
            <span class="field-stack__hint">Se kantite sa a ni ou ni zanmi ou pral jwe a si li antre nan salon an.</span>
          </label>
          <div class="modal__actions">
            <button class="btn btn--ghost" id="morpionPrivateCreateBackBtn" type="button">Retounen</button>
            <button class="btn btn--primary" id="morpionPrivateCreateSubmitBtn" type="button">Kreye salle</button>
          </div>
        </div>
      </div>
    `.trim();
    const modal = wrapper.firstElementChild;
    if (modal) document.body.appendChild(modal);
    dom.privateCreateModal = document.getElementById("morpionPrivateCreateModal");
    dom.privateCreateStakeInput = document.getElementById("morpionPrivateCreateStakeInput");
    dom.privateCreateBackBtn = document.getElementById("morpionPrivateCreateBackBtn");
    dom.privateCreateSubmitBtn = document.getElementById("morpionPrivateCreateSubmitBtn");
  }

  const joinCodeLabel = dom.friendJoinModal?.querySelector(".modal__copy");
  if (joinCodeLabel) {
    joinCodeLabel.textContent = "Mete kòd salon an. Pou kounye a, mete miz salon an tou pou nou ka verifye menm chanm nan.";
  }
  if (dom.friendJoinSubmitBtn) dom.friendJoinSubmitBtn.textContent = "Antre nan salle";
  if (dom.friendShareContinueBtn) dom.friendShareContinueBtn.textContent = "Antre nan salle";
  if (dom.inviteTitle) dom.inviteTitle.textContent = "Konfime antre ou";
  if (dom.inviteCopy) {
    dom.inviteCopy.textContent = "Apre ou konfime, nou pral eseye antre w nan salon prive sa a ak enfòmasyon ou bay yo.";
  }
  if (dom.inviteAcceptBtn) dom.inviteAcceptBtn.textContent = "Kontinye";
  if (dom.inviteRefuseBtn) dom.inviteRefuseBtn.textContent = "Refize";
  if (joinCodeLabel) {
    joinCodeLabel.textContent = "Mete kod salon an pou antre direkteman nan salon zanmi ou a.";
  }

  if (dom.stakeModal?.querySelector(".modal__title")) {
    dom.stakeModal.querySelector(".modal__title").textContent = "Chwazi kijan ou vle antre";
  }
  if (dom.stakeModal?.querySelector(".modal__copy")) {
    dom.stakeModal.querySelector(".modal__copy").textContent = "Mode piblik la toujou sou 25 HTG. Si ou vle jwe ak yon zanmi, itilize salle prive a pou kreye oswa antre ak yon kòd.";
  }
  const stakeHint = dom.stakeModal?.querySelector(".field-stack__hint");
  if (stakeHint) {
    stakeHint.textContent = "Chan sa a sèvi pou salon prive yo. Minimom lan rete 25 HTG.";
  }
  const stakeLabel = dom.stakeModal?.querySelector(".field-stack__label");
  if (stakeLabel) {
    stakeLabel.textContent = "";
  }
  const stakeField = dom.stakeInput?.closest(".field-stack");
  if (stakeField) {
    stakeField.style.display = "none";
  }
  if (dom.stakeContinueBtn) dom.stakeContinueBtn.textContent = "Salle piblik 25 HTG";
  if (dom.stakeFriendBtn) dom.stakeFriendBtn.textContent = "Salle prive";
  if (dom.stakeJoinFriendBtn) {
    dom.stakeJoinFriendBtn.hidden = false;
    dom.stakeJoinFriendBtn.textContent = "Antre ak kod";
  }
  if (dom.modeModal?.querySelector(".modal__eyebrow")) {
    dom.modeModal.querySelector(".modal__eyebrow").textContent = "Salle prive";
  }
  if (dom.modeModal?.querySelector(".modal__title")) {
    dom.modeModal.querySelector(".modal__title").textContent = "Chwazi aksyon ou";
  }
  if (dom.modeModal?.querySelector(".modal__copy")) {
    dom.modeModal.querySelector(".modal__copy").textContent = "Ou ka kreye yon nouvo salon prive oswa antre nan youn ak yon kòd.";
  }
  if (dom.modeCreateFriendBtn) dom.modeCreateFriendBtn.textContent = "Kreye salon";
  if (dom.modeJoinFriendBtn) dom.modeJoinFriendBtn.textContent = "Antre ak kòd";
  if (dom.modePublicBtn) dom.modePublicBtn.textContent = "Retounen";

  const joinStakeField = document.getElementById("morpionFriendJoinStakeInput")?.closest(".field-stack");
  if (joinStakeField) joinStakeField.remove();
  if (dom.privateCreateStakeInput) {
    dom.privateCreateStakeInput.value = String(normalizeStakeHtg(dom.privateCreateStakeInput.value, DEFAULT_STAKE_HTG));
    dom.privateCreateStakeInput.readOnly = false;
  }
  updatePrivateCreateSubmitState();
}

function createBoardCell(index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cell";
  button.dataset.index = String(index);
  button.setAttribute("role", "gridcell");
  button.setAttribute("aria-label", `Liy ${Math.floor(index / BOARD_SIZE) + 1}, kolonn ${(index % BOARD_SIZE) + 1}`);

  const inner = document.createElement("span");
  inner.className = "cell__symbol";
  inner.setAttribute("aria-hidden", "true");
  button.appendChild(inner);
  return button;
}

function ensureCellSymbol(cell, seat) {
  const symbolEl = cell.querySelector(".cell__symbol");
  const nextClass = seat === 0
    ? "cell__symbol cell__symbol--x"
    : "cell__symbol cell__symbol--o";
  if (!symbolEl) return;
  if (symbolEl.className !== nextClass) {
    symbolEl.className = nextClass;
  }
}

function getLastMoveCellIndex(state = currentRoomState) {
  const directIndex = safeInt(state?.lastMove?.cellIndex, -1);
  if (directIndex >= 0 && directIndex < TOTAL_CELLS) return directIndex;

  const board = Array.isArray(state?.board) ? state.board : [];
  const moveCount = safeInt(state?.moveCount, 0);
  if (!moveCount || board.length !== TOTAL_CELLS) return -1;

  const expectedSeat = (moveCount - 1) % 2;
  for (let index = board.length - 1; index >= 0; index -= 1) {
    if (board[index] === expectedSeat) return index;
  }
  return -1;
}

function renderBoard() {
  if (!dom.board) return;
  if (!dom.board.childElementCount) {
    dom.board.innerHTML = "";
    for (let index = 0; index < TOTAL_CELLS; index += 1) {
      dom.board.appendChild(createBoardCell(index));
    }
  }

  const state = currentRoomState;
  const board = Array.isArray(state?.board) ? state.board : Array.from({ length: TOTAL_CELLS }, () => -1);
  const currentPlayer = safeInt(state?.currentPlayer, -1);
  const ended = String(state?.status || "").trim() === "ended" || String(state?.endedReason || "").trim().length > 0;
  const lastMoveCellIndex = getLastMoveCellIndex(state);

  Array.from(dom.board.children).forEach((button, index) => {
    const value = board[index];
    const occupied = value === 0 || value === 1;
    button.classList.toggle("is-occupied", occupied);
    button.classList.toggle("is-last-move", occupied && index === lastMoveCellIndex);
    if (occupied) {
      ensureCellSymbol(button, value);
    } else {
      const symbol = button.querySelector(".cell__symbol");
      if (symbol) {
        symbol.className = "cell__symbol";
      }
    }
    const canPlay = !ended && currentSeatIndex >= 0 && currentPlayer === currentSeatIndex && value === -1 && !actionSending;
    button.disabled = !canPlay;
    button.classList.toggle("is-playable", canPlay);
  });
}

function renderPlayers() {
  const playerNames = Array.isArray(currentRoomState?.playerNames) ? currentRoomState.playerNames : ["", ""];
  const selfName = playerNames[currentSeatIndex] || currentUser?.email || "Ou";
  const opponentSeat = currentSeatIndex === 0 ? 1 : 0;
  const opponentName = playerNames[opponentSeat] || "M ap tann...";
  const currentPlayer = safeInt(currentRoomState?.currentPlayer, -1);
  if (dom.selfName) dom.selfName.textContent = selfName;
  if (dom.opponentName) dom.opponentName.textContent = opponentName;
  if (dom.opponentLabel) dom.opponentLabel.textContent = currentPlayer === opponentSeat ? "Se tou pa li" : "Advese";
  if (dom.selfCard) {
    const selfLabel = dom.selfCard.querySelector(".player-card__label");
    if (selfLabel) selfLabel.textContent = currentPlayer === currentSeatIndex ? "Se tou pa ou" : "Ou";
  }
  if (dom.selfSymbol) dom.selfSymbol.textContent = currentSeatIndex === 0 ? "X" : "O";
  if (dom.opponentSymbol) dom.opponentSymbol.textContent = currentSeatIndex === 0 ? "O" : "X";
  dom.selfCard?.classList.toggle("is-active", currentPlayer === currentSeatIndex);
  dom.opponentCard?.classList.toggle("is-active", currentPlayer === opponentSeat);
}

function stopTurnUiTimer() {
  if (turnUiTimer) {
    window.clearInterval(turnUiTimer);
    turnUiTimer = null;
  }
}

function stopPresenceLoop() {
  if (presenceTimer) {
    window.clearInterval(presenceTimer);
    presenceTimer = null;
  }
}

function renderTimers() {
  const currentPlayer = safeInt(currentRoomState?.currentPlayer, -1);
  const turnDeadlineMs = safeInt(currentRoomState?.turnDeadlineMs, 0);
  if (turnDeadlineMs <= 0 || currentPlayer < 0) {
    if (dom.selfTimerLabel) dom.selfTimerLabel.textContent = `${TURN_DURATION_SECONDS}s`;
    if (dom.opponentTimerLabel) dom.opponentTimerLabel.textContent = `${TURN_DURATION_SECONDS}s`;
    if (dom.selfTimerFill) dom.selfTimerFill.style.width = "100%";
    if (dom.opponentTimerFill) dom.opponentTimerFill.style.width = "100%";
    dom.selfCard?.classList.remove("is-danger");
    dom.opponentCard?.classList.remove("is-danger");
    return;
  }

  const selfIsCurrent = currentPlayer === currentSeatIndex;
  if (actionSending && selfIsCurrent) {
    if (dom.selfTimerLabel) dom.selfTimerLabel.textContent = "Sync...";
    if (dom.opponentTimerLabel) dom.opponentTimerLabel.textContent = "Tann";
    if (dom.selfTimerFill) dom.selfTimerFill.style.width = "8%";
    if (dom.opponentTimerFill) dom.opponentTimerFill.style.width = "100%";
    dom.selfCard?.classList.add("is-danger");
    dom.opponentCard?.classList.remove("is-danger");
    return;
  }

  const remainingMs = Math.max(0, turnDeadlineMs - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const ratio = Math.max(0, Math.min(1, remainingMs / (TURN_DURATION_SECONDS * 1000)));
  const ratioPercent = `${Math.round(ratio * 100)}%`;
  if (dom.selfTimerLabel) dom.selfTimerLabel.textContent = selfIsCurrent ? `${remainingSeconds}s` : "Tann";
  if (dom.opponentTimerLabel) dom.opponentTimerLabel.textContent = selfIsCurrent ? "Tann" : `${remainingSeconds}s`;
  if (dom.selfTimerFill) dom.selfTimerFill.style.width = selfIsCurrent ? ratioPercent : "100%";
  if (dom.opponentTimerFill) dom.opponentTimerFill.style.width = selfIsCurrent ? "100%" : ratioPercent;
  const danger = remainingSeconds <= 5;
  dom.selfCard?.classList.toggle("is-danger", selfIsCurrent && danger);
  dom.opponentCard?.classList.toggle("is-danger", !selfIsCurrent && danger);
}

function startTurnUiTimer() {
  stopTurnUiTimer();
  renderTimers();
  turnUiTimer = window.setInterval(() => {
    renderTimers();
  }, 250);
}

async function pingPresence() {
  if (!currentRoomId || leavingRoom) return;
  try {
    const result = await touchRoomPresenceMorpionV3Secure({ roomId: currentRoomId });
    debugMorpion("pingPresence:result", result || null);
    if (String(result?.status || "").trim() === "ended") {
      const endedReason = String(result?.endedReason || currentRoomState?.endedReason || "").trim();
      const winnerSeat = safeInt(result?.winnerSeat, safeInt(currentRoomState?.winnerSeat, -1));
      currentRoomState = {
        ...(currentRoomState || {}),
        status: "ended",
        endedReason,
        winnerSeat,
      };
      if (shouldHoldFriendRematch(currentRoomState)) {
        openFriendRematchWaitingModal();
        return;
      }
      stopRoomPolling();
      stopWaitingCycle();
      stopTurnUiTimer();
      stopPresenceLoop();
      closeModal(dom.waitingModal);
      renderPlayers();
      renderBoard();
      renderEndedState();
    }
  } catch (_) {
  }
}

function startPresenceLoop() {
  stopPresenceLoop();
  if (!currentRoomId) return;
  void pingPresence();
  presenceTimer = window.setInterval(() => {
    void pingPresence();
  }, PRESENCE_PING_INTERVAL_MS);
}

function stopWaitingCycle() {
  if (waitingTimer) {
    window.clearTimeout(waitingTimer);
    waitingTimer = null;
  }
}

function renderWaitingExpired() {
  if (currentRoomMode === "morpion_friends_v3") {
    if (dom.waitingTitle) dom.waitingTitle.textContent = "Salon prive a poko ranpli";
    if (dom.waitingCopy) {
      const codePart = currentInviteCode ? ` Pataje kod ${currentInviteCode} la ak zanmi ou.` : "";
      dom.waitingCopy.textContent = `Nou poko 2 nan salon prive a pou yon miz ${selectedStakeHtg} HTG.${codePart}`;
    }
  } else {
    if (dom.waitingTitle) dom.waitingTitle.textContent = "Pa gen advese pou kounye a";
    if (dom.waitingCopy) {
      dom.waitingCopy.textContent = "Ou poko antre nan okenn match. Ou ka tann anko, tounen sou kay la, oswa antre nan gwoup WhatsApp la pou jwenn jwe.";
    }
  }
  hide(dom.waitingTimerWrap);
  show(dom.waitingActions);
  hide(dom.waitingStopExtendBtn);
}

function tickWaitingCycle() {
  const remainingMs = Math.max(0, waitDeadlineMs - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  if (dom.waitingTimerValue) dom.waitingTimerValue.textContent = `${remainingSeconds}s`;
  if (remainingMs <= 0) {
    renderWaitingExpired();
    return;
  }
  waitingTimer = window.setTimeout(tickWaitingCycle, 250);
}

function startWaitingCycle() {
  stopWaitingCycle();
  waitDeadlineMs = currentRoomMode === "morpion_friends_v3" && roomWaitingDeadlineMs > Date.now()
    ? roomWaitingDeadlineMs
    : (Date.now() + (WAIT_SECONDS * 1000));
  if (currentRoomMode === "morpion_friends_v3") {
    if (dom.waitingTitle) dom.waitingTitle.textContent = "M ap tann zanmi ou...";
    if (dom.waitingCopy) {
      const codePart = currentInviteCode ? ` Pataje kod ${currentInviteCode} la ak zanmi ou.` : "";
      dom.waitingCopy.textContent = `Salon prive a pare ak yon miz ${selectedStakeHtg} HTG.${codePart} Nou poko pran okenn HTG sou kont ou pandan w ap tann pou 2e jwè a antre.`;
    }
  } else {
    if (dom.waitingTitle) dom.waitingTitle.textContent = "M ap cheche yon advese...";
    if (dom.waitingCopy) {
      dom.waitingCopy.textContent = `Nou pare pou chache yon match ak yon miz ${selectedStakeHtg} HTG. Pou kounye a, nou poko pran okenn HTG sou kont ou.`;
    }
  }
  show(dom.waitingModal);
  show(dom.waitingTimerWrap);
  hide(dom.waitingActions);
  hide(dom.waitingStopExtendBtn);
  tickWaitingCycle();
}

function openFriendRematchWaitingModal(
  title = "Nou mande revanj",
  copy = "M ap tann lot jwe a pou nou rekomanse nan menm salon prive a."
) {
  if (dom.waitingTitle) dom.waitingTitle.textContent = title;
  if (dom.waitingCopy) dom.waitingCopy.textContent = copy;
  show(dom.waitingModal);
  hide(dom.waitingTimerWrap);
  hide(dom.waitingActions);
  hide(dom.waitingStopExtendBtn);
}

function stopRoomPolling() {
  if (roomPollTimer) {
    window.clearTimeout(roomPollTimer);
    roomPollTimer = null;
  }
}

function scheduleRoomPoll(delayMs = 1000) {
  stopRoomPolling();
  if (!currentRoomId) return;
  roomPollTimer = window.setTimeout(() => {
    void pollRoomState();
  }, delayMs);
}

function openWaitingWithState() {
  if (String(currentRoomState?.status || "") === "playing") {
    closeModal(dom.waitingModal);
    return;
  }
  show(dom.waitingModal);
}

function renderEndedState() {
  if (shouldHoldFriendRematch()) {
    openFriendRematchWaitingModal();
    return;
  }
  const endedReason = String(currentRoomState?.endedReason || "").trim();
  const winnerSeat = safeInt(currentRoomState?.winnerSeat, -1);
  if (endedReason === "line") {
    const won = winnerSeat === currentSeatIndex;
    setResultModal("Mopyon", won ? "Ou genyen" : "Ou pedi", won ? "Ou rive aliyen 5 pwen yo anvan advese a." : "Advese a rive aliyen 5 pwen yo anvan ou.");
    return;
  }
  if (endedReason === "quit") {
    const won = winnerSeat === currentSeatIndex;
    setResultModal("Mopyon", won ? "Ou genyen" : "Ou pedi", won ? "Advese a kite match la apre match la te komanse." : "Ou kite match la.");
    return;
  }
  if (endedReason === "quit_refund_before_opening") {
    setResultModal("Mopyon", "Ou pa pedi", "Youn nan jwè yo soti avan nou toude te mete omwen yon pion. Se sa ki fe pesonn pa pedi.");
    return;
  }
  if (endedReason === "timeout_refund") {
    setResultModal("Mopyon", "Ou pa pedi", "Ni ou ni advese a pa t mete omwen yon pion chak. Se sa ki fe pesonn pa pedi sou timeout sa a.");
    return;
  }
  if (endedReason === "timeout") {
    const won = winnerSeat === currentSeatIndex;
    setResultModal(
      "Mopyon",
      won ? "Ou genyen" : "Ou pedi",
      won
        ? "Advese a kite tan li fini apre nou te deja mete omwen yon pion chak."
        : "Ou kite tan ou fini apre nou te deja mete omwen yon pion chak."
    );
    return;
  }
  if (endedReason === "cancelled_before_start") {
    setResultModal("Mopyon", "Match la anile", "Youn nan jwè yo soti avan premye kou a.");
    return;
  }
  setResultModal("Mopyon", "Fen match la", "Match la fini.");
}

async function pollRoomState() {
  if (!currentRoomId) return;
  try {
    const previousStatus = String(currentRoomState?.status || lastKnownRoomStatus || "").trim();
    const state = await getMorpionV3RoomStateSecure({ roomId: currentRoomId });
    resetRoomNetworkFailures();
    debugMorpion("pollRoomState:result", {
      roomId: currentRoomId,
      previousStatus,
      status: String(state?.status || "").trim(),
      endedReason: String(state?.endedReason || "").trim(),
      winnerSeat: safeInt(state?.winnerSeat, -1),
      seatIndex: safeInt(state?.seatIndex, -1),
      stakeHtg: safeInt(state?.stakeHtg, 0),
      roomMode: String(state?.roomMode || "").trim(),
    });
    currentRoomState = state || null;
    if (String(state?.status || "").trim() !== "ended") {
      friendRematchPending = false;
    }
    selectedStakeHtg = normalizeStakeHtg(state?.stakeHtg, selectedStakeHtg || DEFAULT_STAKE_HTG);
    currentRoomMode = String(state?.roomMode || currentRoomMode || "public").trim() || "public";
    currentInviteCode = String(state?.inviteCode || currentInviteCode || "").trim();
    roomWaitingDeadlineMs = safeInt(state?.waitingDeadlineMs, roomWaitingDeadlineMs);
    lastKnownRoomStatus = String(state?.status || "").trim();
    currentSeatIndex = safeInt(state?.seatIndex, currentSeatIndex);
    syncRoomUrl();
    renderPlayers();
    startTurnUiTimer();
    startPresenceLoop();
    renderBoard();
    if (String(state?.status || "") === "waiting") {
      openWaitingWithState();
      scheduleRoomPoll(1000);
      return;
    }
    closeModal(dom.waitingModal);
    if (lastKnownRoomStatus && lastKnownRoomStatus !== previousStatus) {
      void refreshWallet();
    }
    if (String(state?.status || "") === "ended") {
      if (shouldHoldFriendRematch(state)) {
        openFriendRematchWaitingModal();
        scheduleRoomPoll(1000);
        return;
      }
      stopRoomPolling();
      stopTurnUiTimer();
      stopPresenceLoop();
      stopWaitingCycle();
      void refreshWallet();
      renderEndedState();
      return;
    }
    scheduleRoomPoll(1000);
  } catch (error) {
    const hasKnownRoom = Boolean(currentRoomState || lastKnownRoomStatus || currentRoomId);
    if (hasKnownRoom && isTransientNetworkError(error)) {
      roomPollFailureCount += 1;
      debugMorpion("pollRoomState:network-retry", {
        roomId: currentRoomId,
        failureCount: roomPollFailureCount,
        message: error?.message || "unknown-error",
        code: error?.code || "",
      });
      showConnectionToast(
        roomPollFailureCount >= 4
          ? "Koneksyon an toujou feb. Tanpri pa femen paj la."
          : "Koneksyon feb. N ap reeseye..."
      );
      scheduleRoomPoll(Math.min(5000, 900 + (roomPollFailureCount * 650)));
      return;
    }
    setResultModal("Mopyon", "Koneksyon pa mache", "Nou pa rive pale ak seve a. Tcheke entenet ou epi peze Rejwe.");
  }
}

async function beginSearch() {
  if (joining) return;
  if (!(await ensureStakeIsAffordable(selectedStakeHtg, "antre nan rechèch la"))) return;
  joining = true;
  currentRoomMode = "public";
  currentInviteCode = "";
  syncRoomUrl();
  closeModal(dom.resultModal);
  closeModal(dom.quitModal);
  startWaitingCycle();
  try {
    const result = await joinMatchmakingMorpionV3Secure({ stakeHtg: selectedStakeHtg });
    currentRoomId = String(result?.roomId || "").trim();
    currentSeatIndex = safeInt(result?.seatIndex, -1);
    await pollRoomState();
  } catch (error) {
    closeModal(dom.waitingModal);
    setResultModal("Mopyon", "Koneksyon pa mache", error?.message || "Nou pa rive antre nan rechèch la.");
  } finally {
    joining = false;
  }
}

async function createFriendRoom() {
  if (friendActionBusy) return;
  selectedStakeHtg = normalizeStakeHtg(selectedStakeHtg, DEFAULT_STAKE_HTG);
  if (!(await ensureStakeIsAffordable(selectedStakeHtg, "kreye salon prive a"))) return;
  friendActionBusy = true;
  setFriendJoinStatus("");
  try {
    const result = await createFriendMorpionRoomV3Secure({ stakeHtg: selectedStakeHtg });
    debugMorpion("createFriendRoom:result", result || null);
    currentRoomId = String(result?.roomId || "").trim();
    currentSeatIndex = safeInt(result?.seatIndex, 0);
    selectedStakeHtg = normalizeStakeHtg(result?.stakeHtg, selectedStakeHtg);
    currentRoomMode = "morpion_friends_v3";
    currentInviteCode = String(result?.inviteCode || "").trim();
    roomWaitingDeadlineMs = safeInt(result?.waitingDeadlineMs, 0);
    friendRematchPending = false;
    syncRoomUrl();
    renderFriendStakeCopy();
    if (dom.friendInviteCodeValue) dom.friendInviteCodeValue.textContent = currentInviteCode || "------";
    closeModal(dom.modeModal);
    openModal(dom.friendShareModal);
  } catch (error) {
    if (showMorpionStakeErrorModal(error, "kreye salon prive sa a", selectedStakeHtg)) return;
    setResultModal("Mopyon", "Salon prive a pa mache", error?.message || "Nou pa rive kreye salon prive a.");
  } finally {
    friendActionBusy = false;
  }
}

async function joinFriendRoomByCode(inviteCodeArg = "", stakeHtgArg = null) {
  if (friendActionBusy) return;
  const inviteCode = normalizeCode(inviteCodeArg || dom.friendJoinCodeInput?.value || "");
  if (!inviteCode) {
    setFriendJoinStatus("Tanpri mete kod salon an.", true);
    return;
  }
  const rawStakeArg = Number.parseInt(String(stakeHtgArg ?? ""), 10);
  const requestedStakeHtg = Number.isFinite(rawStakeArg) && rawStakeArg >= DEFAULT_STAKE_HTG
    ? normalizeStakeHtg(rawStakeArg, DEFAULT_STAKE_HTG)
    : 0;
  if (requestedStakeHtg > 0) {
    selectedStakeHtg = requestedStakeHtg;
  }
  if (requestedStakeHtg > 0) {
    if (!(await ensureStakeIsAffordable(requestedStakeHtg, "antre nan salon prive a"))) return;
  } else if (getCurrentWalletTotalHtg() < DEFAULT_STAKE_HTG) {
    if (!(await ensureStakeIsAffordable(DEFAULT_STAKE_HTG, "antre nan salon prive a"))) return;
  }
  friendActionBusy = true;
  setFriendJoinStatus("M ap verifye kod la ak miz salon an...");
  try {
    const payload = { inviteCode };
    if (requestedStakeHtg > 0) payload.stakeHtg = requestedStakeHtg;
    debugMorpion("joinFriendRoomByCode:request", payload);
    const result = await joinFriendMorpionRoomByCodeV3Secure(payload);
    debugMorpion("joinFriendRoomByCode:result", result || null);
    currentRoomId = String(result?.roomId || "").trim();
    currentSeatIndex = safeInt(result?.seatIndex, 0);
    selectedStakeHtg = normalizeStakeHtg(result?.stakeHtg, selectedStakeHtg || DEFAULT_STAKE_HTG);
    currentRoomMode = "morpion_friends_v3";
    currentInviteCode = String(result?.inviteCode || inviteCode).trim();
    roomWaitingDeadlineMs = safeInt(result?.waitingDeadlineMs, 0);
    friendRematchPending = false;
    syncRoomUrl();
    closeModal(dom.friendJoinModal);
    setFriendJoinStatus("");
    if (dom.friendJoinCodeInput) dom.friendJoinCodeInput.value = "";
    pendingStartFlow = "friend";
    startWaitingCycle();
    await pollRoomState();
  } catch (error) {
    if (showMorpionStakeErrorModal(error, "antre nan salon prive sa a")) {
      setFriendJoinStatus("");
      return;
    }
    if (showMorpionStakeMismatchModal(error)) {
      setFriendJoinStatus("");
      return;
    }
    setFriendJoinStatus(error?.message || "Nou pa rive antre nan salon prive a.", true);
  } finally {
    friendActionBusy = false;
  }
}

async function resumeFriendRoomFromUrl() {
  const roomId = getFriendRoomIdFromUrl();
  if (!currentUser?.uid || joining || !roomId) return;
  joining = true;
  currentRoomMode = "morpion_friends_v3";
  startWaitingCycle();
  try {
    const result = await resumeFriendMorpionRoomV3Secure({ roomId });
    debugMorpion("resumeFriendRoomFromUrl:result", result || null);
    currentRoomId = String(result?.roomId || roomId).trim();
    currentSeatIndex = safeInt(result?.seatIndex, 0);
    selectedStakeHtg = normalizeStakeHtg(result?.stakeHtg, selectedStakeHtg || DEFAULT_STAKE_HTG);
    currentRoomMode = "morpion_friends_v3";
    currentInviteCode = String(result?.inviteCode || "").trim();
    roomWaitingDeadlineMs = safeInt(result?.waitingDeadlineMs, 0);
    friendRematchPending = hasLocalFriendRematchRequest(result || {});
    syncRoomUrl();
    await pollRoomState();
  } catch (error) {
    closeModal(dom.waitingModal);
    setResultModal("Mopyon", "Salon prive a pa mache", error?.message || "Nou pa rive reprann salon prive a.");
  } finally {
    joining = false;
  }
}

async function leaveCurrentRoomAndGoHome() {
  if (leavingRoom) return;
  leavingRoom = true;
  const roomId = currentRoomId;
  stopRoomPolling();
  stopWaitingCycle();
  stopTurnUiTimer();
  stopPresenceLoop();
  friendRematchPending = false;
  try {
    if (roomId) {
      const result = await leaveRoomMorpionV3Secure({ roomId });
      debugMorpion("leaveCurrentRoomAndGoHome:result", result || null);
    }
  } catch (_) {
  }
  window.location.href = "./index.html";
}

async function leaveCurrentRoomSilently() {
  if (leavingRoom) return;
  leavingRoom = true;
  const roomId = currentRoomId;
  stopRoomPolling();
  stopWaitingCycle();
  stopTurnUiTimer();
  stopPresenceLoop();
  friendRematchPending = false;
  try {
    if (roomId) {
      const result = await leaveRoomMorpionV3Secure({ roomId });
      debugMorpion("leaveCurrentRoomSilently:result", result || null);
    }
  } catch (_) {
  }
}

async function submitCell(index) {
  if (!currentRoomId || actionSending) return;
  actionSending = true;
  renderBoard();
  try {
    const payload = {
      roomId: currentRoomId,
      clientActionId: `morpion_v3_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      action: { cellIndex: index },
    };
    debugMorpion("submitCell:request", payload);
    const result = await submitActionMorpionV3Secure(payload);
    debugMorpion("submitCell:result", result || null);
    await pollRoomState();
  } catch (error) {
    debugMorpion("submitCell:error", {
      message: error?.message || "unknown-error",
      code: error?.code || "",
      details: error?.details || null,
    });
    if (isTransientNetworkError(error)) {
      showConnectionToast("Kou a poko pase. Koneksyon an feb, reeseye nan yon ti moman.", 3200);
      scheduleRoomPoll(900);
      return;
    }
    setResultModal("Mopyon", "Kou a pa pase", "Nou pa rive voye kou a. Tanpri reeseye.");
  } finally {
    actionSending = false;
    renderBoard();
  }
}

async function requestFriendRematch() {
  if (!currentRoomId || friendRematchRequestBusy) return;
  friendRematchRequestBusy = true;
  try {
    const result = await requestFriendMorpionRematchV3Secure({ roomId: currentRoomId });
    currentRoomState = {
      ...(currentRoomState || {}),
      ...(result || {}),
      status: result?.started === true ? "playing" : "ended",
    };
    closeModal(dom.resultModal);
    if (result?.started === true) {
      friendRematchPending = false;
      openFriendRematchWaitingModal(
        "Nouvo won",
        "Tou de jwè yo dakò. N ap relanse pati a nan menm salon prive a..."
      );
    } else {
      friendRematchPending = true;
      openFriendRematchWaitingModal();
    }
    startPresenceLoop();
    scheduleRoomPoll(250);
  } catch (error) {
    setResultModal("Mopyon", "Rejouer pa mache", error?.message || "Nou pa rive relanse rematch prive a.");
  } finally {
    friendRematchRequestBusy = false;
  }
}

function bindBoardEvents() {
  dom.board?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest(".cell") : null;
    if (!button) return;
    const index = safeInt(button.dataset.index, -1);
    if (index < 0) return;
    void submitCell(index);
  });
}

function bindEvents() {
  bindBoardEvents();

  dom.stakeHomeBtn?.addEventListener("click", () => {
    window.location.href = "./index.html";
  });
  dom.stakeContinueBtn?.addEventListener("click", async () => {
    selectedStakeHtg = DEFAULT_STAKE_HTG;
    if (!(await ensureStakeIsAffordable(selectedStakeHtg, "antre nan rechèch la"))) return;
    closeModal(dom.stakeModal);
    startWaitingCycle();
    void beginSearch();
  });
  dom.stakeFriendBtn?.addEventListener("click", () => {
    closeModal(dom.stakeModal);
    openModal(dom.modeModal);
  });
  dom.stakeJoinFriendBtn?.addEventListener("click", () => {
    closeModal(dom.stakeModal);
    setFriendJoinStatus("");
    openModal(dom.friendJoinModal);
  });

  dom.modePublicBtn?.addEventListener("click", () => {
    closeModal(dom.modeModal);
    openModal(dom.stakeModal);
  });
  dom.modeCreateFriendBtn?.addEventListener("click", () => {
    if (dom.privateCreateStakeInput) {
      dom.privateCreateStakeInput.value = String(normalizeStakeHtg(selectedStakeHtg, DEFAULT_STAKE_HTG));
    }
    closeModal(dom.modeModal);
    openModal(dom.privateCreateModal);
    updatePrivateCreateSubmitState();
  });
  dom.modeJoinFriendBtn?.addEventListener("click", () => {
    closeModal(dom.modeModal);
    setFriendJoinStatus("");
    openModal(dom.friendJoinModal);
  });

  dom.privateCreateBackBtn?.addEventListener("click", () => {
    closeModal(dom.privateCreateModal);
    openModal(dom.modeModal);
  });
  dom.privateCreateSubmitBtn?.addEventListener("click", async () => {
    const draftStake = readPrivateCreateStakeDraft();
    if (draftStake < DEFAULT_STAKE_HTG) {
      updatePrivateCreateSubmitState();
      dom.privateCreateStakeInput?.reportValidity();
      dom.privateCreateStakeInput?.focus();
      return;
    }
    selectedStakeHtg = normalizeStakeHtg(draftStake, DEFAULT_STAKE_HTG);
    if (!(await ensureStakeIsAffordable(selectedStakeHtg, "kreye salon prive a"))) return;
    closeModal(dom.privateCreateModal);
    void createFriendRoom();
  });
  dom.privateCreateStakeInput?.addEventListener("input", () => {
    updatePrivateCreateSubmitState();
  });
  dom.privateCreateStakeInput?.addEventListener("blur", () => {
    const draftStake = readPrivateCreateStakeDraft();
    if (draftStake > 0 && draftStake < DEFAULT_STAKE_HTG) {
      dom.privateCreateStakeInput.value = String(draftStake);
    }
    updatePrivateCreateSubmitState();
  });

  dom.friendShareCopyBtn?.addEventListener("click", async () => {
    const copied = await copyText(currentInviteCode);
    if (dom.friendShareCopyBtn) {
      dom.friendShareCopyBtn.textContent = copied ? "Kod la kopye" : "Kopye kòd la";
      window.setTimeout(() => {
        if (dom.friendShareCopyBtn) dom.friendShareCopyBtn.textContent = "Kopye kòd la";
      }, 1500);
    }
  });
  dom.friendShareContinueBtn?.addEventListener("click", () => {
    pendingStartFlow = "friend";
    closeModal(dom.friendShareModal);
    startWaitingCycle();
    void pollRoomState();
  });

  dom.friendJoinBackBtn?.addEventListener("click", () => {
    closeModal(dom.friendJoinModal);
    openModal(dom.modeModal);
  });
  dom.friendJoinSubmitBtn?.addEventListener("click", () => {
    const inviteCode = normalizeCode(dom.friendJoinCodeInput?.value || "");
    if (!inviteCode) {
      setFriendJoinStatus("Tanpri mete kod salon an.", true);
      return;
    }
    void joinFriendRoomByCode(inviteCode);
  });

  dom.waitingHomeBtn?.addEventListener("click", () => {
    void leaveCurrentRoomAndGoHome();
  });
  dom.waitingRetryBtn?.addEventListener("click", () => {
    startWaitingCycle();
  });
  dom.waitingStopExtendBtn?.addEventListener("click", () => {
    startWaitingCycle();
  });
  dom.waitingNotifyBtn?.addEventListener("click", () => {
    setResultModal("Mopyon", "Notifikasyon yo poko branche", "Opsyon notifikasyon an poko pare pou Mopyon. Ou ka kontinye tann oswa itilize gwoup WhatsApp la pou kounye a.");
  });
  dom.waitingGroupBtn?.addEventListener("click", () => {
    window.open(WHATSAPP_GROUP_URL, "_blank", "noopener,noreferrer");
  });
  dom.waitingWhatsappBtn?.addEventListener("click", () => {
    openModal(dom.whatsappModal);
  });
  dom.waitingContactsBtn?.addEventListener("click", () => {
    if (dom.contactsList) {
      dom.contactsList.innerHTML = '<div class="contact-empty">Lis jwe aktif yo ap disponib pita.</div>';
    }
    openModal(dom.contactsModal);
  });

  dom.whatsappCloseBtn?.addEventListener("click", () => closeModal(dom.whatsappModal));
  dom.whatsappCloseTargets.forEach((node) => {
    node.addEventListener("click", () => closeModal(dom.whatsappModal));
  });
  dom.contactsCloseBtn?.addEventListener("click", () => closeModal(dom.contactsModal));
  dom.contactsCloseTargets.forEach((node) => {
    node.addEventListener("click", () => closeModal(dom.contactsModal));
  });

  dom.resultReplayBtn?.addEventListener("click", () => {
    if (currentRoomMode === "morpion_friends_v3" && currentRoomId) {
      void requestFriendRematch();
      return;
    }
    closeModal(dom.resultModal);
    leavingRoom = false;
    currentRoomId = "";
    currentSeatIndex = -1;
    currentRoomState = null;
    currentRoomMode = "public";
    currentInviteCode = "";
    roomWaitingDeadlineMs = 0;
    friendRematchPending = false;
    syncRoomUrl();
    if (pendingStartFlow === "friend" || isFriendFlowFromUrl()) {
      openModal(dom.modeModal);
      return;
    }
    startWaitingCycle();
    void beginSearch();
  });
  dom.resultHomeBtn?.addEventListener("click", () => {
    void leaveCurrentRoomAndGoHome();
  });

  dom.quitReplayBtn?.addEventListener("click", () => closeModal(dom.quitModal));
  dom.quitHomeBtn?.addEventListener("click", () => {
    void leaveCurrentRoomAndGoHome();
  });
  dom.quitCloseTargets.forEach((node) => {
    node.addEventListener("click", () => closeModal(dom.quitModal));
  });

  dom.ruleContinueBtn?.addEventListener("click", () => {
    closeModal(dom.ruleModal);
    if (pendingStartFlow === "friend" && currentRoomId) {
      startWaitingCycle();
      void pollRoomState();
      return;
    }
    void beginSearch();
  });

  window.addEventListener("offline", () => {
    showConnectionToast("Entenet la koupe. Pa femen paj la, n ap tann li tounen.", 0);
    if (offlineLeaveTimer) window.clearTimeout(offlineLeaveTimer);
    offlineLeaveTimer = window.setTimeout(() => {
      offlineLeaveTimer = null;
      if (!navigator.onLine) {
        void leaveCurrentRoomSilently();
      }
    }, 12000);
  });
  window.addEventListener("online", () => {
    if (offlineLeaveTimer) {
      window.clearTimeout(offlineLeaveTimer);
      offlineLeaveTimer = null;
    }
    showConnectionToast("Koneksyon an tounen. N ap resenkronize match la.", 2200);
    if (currentRoomId && !leavingRoom) {
      scheduleRoomPoll(250);
      void pingPresence();
    }
  });
  window.addEventListener("pagehide", () => {
    void leaveCurrentRoomSilently();
  });
  window.addEventListener("beforeunload", () => {
    void leaveCurrentRoomSilently();
  });
  window.addEventListener("popstate", () => {
    if (!currentRoomId) return;
    history.pushState({ morpion: true }, "", window.location.href);
    void leaveCurrentRoomAndGoHome();
  });
  window.addEventListener("xchangeUpdated", () => {
    renderWallet();
    updateStakeActionAvailability();
  });
  dom.stakeInput?.addEventListener("input", () => {
    updateStakeActionAvailability();
  });
  dom.stakeInput?.addEventListener("change", () => {
    updateStakeActionAvailability();
  });
}

function bootUser(user) {
  currentUser = user;
  if (dom.stakeInput) dom.stakeInput.value = String(DEFAULT_STAKE_HTG);
  if (dom.privateCreateStakeInput) dom.privateCreateStakeInput.value = String(DEFAULT_STAKE_HTG);
  updatePrivateCreateSubmitState();
  if (dom.selfName) {
    dom.selfName.textContent = String(user?.displayName || user?.email || "Ou").trim() || "Ou";
  }
  if (dom.opponentName) dom.opponentName.textContent = "M ap tann...";
  if (dom.opponentLabel) dom.opponentLabel.textContent = "Advese";
  if (dom.revealResultBtn) hide(dom.revealResultBtn);
  renderBoard();
  void refreshWallet();
  updateStakeActionAvailability();
  if (isFriendFlowFromUrl()) {
    void resumeFriendRoomFromUrl();
    return;
  }
  openModal(dom.stakeModal);
}

function bootstrap() {
  try {
    history.pushState({ morpion: true }, "", window.location.href);
  } catch (_) {
  }
  ensurePrivateFlowUi();
  renderBoard();
  renderTimers();
  bindEvents();
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "./index.html?auth=login";
      return;
    }
    bootUser(user);
  });
}

bootstrap();
