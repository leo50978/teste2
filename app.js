import {
  auth,
  collection,
  createUserWithEmailAndPassword,
  doc,
  db,
  getDocs,
  limit,
  onAuthStateChanged,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  where,
} from "./firebase-init.js";
import PaymentModal from "./payment.js?v=20260603-welcome-export1";
import { ensureXchangeState, getXchangeState } from "./xchange.js";
import {
  buildHomeHeroImagePath,
  DEFAULT_HOME_HERO_SLIDES,
  refreshHomeHeroSlides,
} from "./home-hero-config.js";
import { mountRetraitModal } from "./retrait.js";
import { buildWhatsappUrlForKey, getWhatsappContactLabel } from "./whatsapp-modal-config.js";
import {
  createFriendLudoRoomSecure,
  createFriendDuelRoomV2Secure,
  getDepositFundingStatusSecure,
  getMyGameHistorySecure,
  getPublicRuntimeConfigSecure,
  walletMutateSecure,
} from "./secure-functions.js";

const HERO_ROTATION_MS = 5000;
const AGENT_ONLY_DEPOSIT_THRESHOLD_HTG = 1000;
const PWA_MODAL_STORAGE_KEY = "kobposh_pwa_install_dismissed";
const PWA_MODAL_INITIAL_DELAY_MS = 1600;
const WELCOME_COORDINATOR_MODAL_STORAGE_KEY = "kobposh_welcome_championna_dismissed_v1";
const WELCOME_COORDINATOR_MODAL_DELAY_MS = 700;
const CHAMPIONNA_COORDINATOR_WHATSAPP = "50943160977";
const pageParams = new URLSearchParams(window.location.search);
let heroRotationTimer = null;

function initHeroRotation() {
  const slides = Array.from(document.querySelectorAll("[data-kobposh-hero-slide]"));
  if (heroRotationTimer) {
    window.clearInterval(heroRotationTimer);
    heroRotationTimer = null;
  }
  if (slides.length === 0) return;

  let activeIndex = slides.findIndex((slide) => slide.classList.contains("is-active"));
  if (activeIndex < 0) activeIndex = 0;

  const render = () => {
    slides.forEach((slide, index) => {
      slide.classList.toggle("is-active", index === activeIndex);
    });
  };

  render();
  if (slides.length === 1) return;

  heroRotationTimer = window.setInterval(() => {
    activeIndex = (activeIndex + 1) % slides.length;
    render();
  }, HERO_ROTATION_MS);
}

function normalizeKobposhHeroPath(value = "") {
  return String(value || "").trim().replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "");
}

function buildDynamicHeroSlides(rawSlides = DEFAULT_HOME_HERO_SLIDES) {
  const track = document.querySelector("[data-kobposh-hero-track]");
  if (!track) return [];

  const slides = Array.isArray(rawSlides) && rawSlides.length ? rawSlides : DEFAULT_HOME_HERO_SLIDES;
  track.replaceChildren();

  slides.forEach((slideData, index) => {
    const source = normalizeKobposhHeroPath(buildHomeHeroImagePath(slideData?.name || slideData?.src || ""));
    if (!source) return;

    const slide = document.createElement("div");
    slide.className = "hero-banner__slide";
    slide.setAttribute("data-kobposh-hero-slide", "");
    if (index === 0) slide.classList.add("is-active");
    slide.innerHTML = `
      <img
        src="${source}"
        alt="${String(slideData?.alt || `Entefas Kobposh ${index + 1}`)}"
        width="600"
        height="600"
        fetchpriority="${index === 0 ? "high" : "auto"}"
        decoding="async"
      />
    `;
    track.appendChild(slide);
  });

  return Array.from(track.querySelectorAll("[data-kobposh-hero-slide]"));
}

async function refreshKobposhHeroRotation() {
  try {
    const snapshot = await refreshHomeHeroSlides();
    const enabledSlides = Array.isArray(snapshot?.slides)
      ? snapshot.slides.filter((slide) => slide && slide.enabled === true)
      : [];
    buildDynamicHeroSlides(enabledSlides.length ? enabledSlides : DEFAULT_HOME_HERO_SLIDES);
  } catch (error) {
    console.warn("[KOBPOSH_V2] hero config refresh failed", error);
    buildDynamicHeroSlides(DEFAULT_HOME_HERO_SLIDES);
  }
  initHeroRotation();
}

const gamesModal = document.querySelector("[data-games-modal]");
const tournamentsModal = document.querySelector("[data-tournaments-modal]");
const tournamentRegisterModal = document.querySelector("[data-tournament-register-modal]");
const authScreenEl = document.querySelector("[data-kobposh-auth-screen]");
const signupToggleBtn = document.querySelector("[data-kobposh-open-signup]");
const siteAboutToggleBtn = document.querySelector("[data-kobposh-open-site-about]");
const siteAboutModalEl = document.querySelector("[data-kobposh-site-about-modal]");
const siteAboutCloseBtns = document.querySelectorAll("[data-kobposh-close-site-about]");
const forgotPasswordBtn = document.querySelector("[data-kobposh-open-forgot-password]");
const loginFormEl = document.querySelector("[data-kobposh-login-form]");
const loginFieldsEl = document.querySelector("[data-kobposh-login-fields]");
const signupFieldsEl = document.querySelector("[data-kobposh-signup-fields]");
const authCardSubtitleEl = document.querySelector(".auth-screen__subtitle");
const authSubmitBtn = document.querySelector(".auth-screen__button");
const accountLabelEl = document.querySelector("[data-kobposh-account-label]");
const balanceEl = document.querySelector("[data-kobposh-balance]");
const openDepositModalBtns = Array.from(document.querySelectorAll("[data-open-deposit-modal]"));
const supportQuickBtn = document.querySelector("#kobposhSupportBtn");
const agentHelpQuickBtn = document.querySelector("#kobposhAgentHelpBtn");
const loginIdentifierEl = document.querySelector("[data-kobposh-login-identifier]");
const loginPasswordEl = document.querySelector("[data-kobposh-login-password]");
const loginErrorEl = document.querySelector("[data-kobposh-login-error]");
const signupUsernameEl = document.querySelector("[data-kobposh-signup-username]");
const signupPhoneEl = document.querySelector("[data-kobposh-signup-phone]");
const signupPasswordEl = document.querySelector("[data-kobposh-signup-password]");
const signupPasswordConfirmEl = document.querySelector("[data-kobposh-signup-password-confirm]");
const signupAgeEl = document.querySelector("[data-kobposh-signup-age]");
const signupTermsEl = document.querySelector("[data-kobposh-signup-terms]");
const passwordToggleBtns = Array.from(document.querySelectorAll("[data-kobposh-toggle-password]"));
const profileLinks = Array.from(document.querySelectorAll('a[href="./profile.html"]'));
const transferFriendBtn = document.getElementById("kobposhTransferBtn");
const openGamesButtons = Array.from(document.querySelectorAll("[data-open-games-modal]"));
const closeGamesButtons = Array.from(document.querySelectorAll("[data-close-games-modal]"));
const openTournamentsButtons = Array.from(document.querySelectorAll("[data-open-tournaments-modal]"));
const closeTournamentsButtons = Array.from(document.querySelectorAll("[data-close-tournaments-modal]"));
const openTournamentRegisterButtons = Array.from(document.querySelectorAll("[data-open-tournament-register-modal]"));
const closeTournamentRegisterButtons = Array.from(document.querySelectorAll("[data-close-tournament-register-modal]"));
const tournamentRegisterGameEl = document.querySelector("[data-tournament-register-game]");
const tournamentRegisterImageEl = document.querySelector("[data-tournament-register-image]");
const tournamentRegisterSubmitBtn = document.querySelector("[data-tournament-register-submit]");
const tournamentRegisterRulesBtn = document.querySelector("[data-tournament-register-rules]");
const tournamentRegisterCountEl = document.querySelector("[data-tournament-register-count]");
const tournamentRegisterListStateEl = document.querySelector("[data-tournament-register-list-state]");
const tournamentRegisterListEl = document.querySelector("[data-tournament-register-list]");
const tournamentBracketStateEl = document.querySelector("[data-tournament-bracket-state]");
const tournamentUpcomingListEl = document.querySelector("[data-tournament-upcoming-list]");
const tournamentCompletedListEl = document.querySelector("[data-tournament-completed-list]");
const openHistoryButtons = Array.from(document.querySelectorAll("[data-open-history-modal]"));
let authMode = "login";
let walletUnsubscribe = null;
let withdrawalDecisionUnsubscribe = null;
let depositModal = null;
let depositAmountInput = null;
let depositAmountSummary = null;
let depositErrorEl = null;
let depositSubmitBtn = null;
let activePaymentModal = null;
let forgotPasswordModal = null;
let highAmountAgentModal = null;
let supportHelpModal = null;
let homeAgentHelpModal = null;
let transferPendingModal = null;
let depositPendingModal = null;
let accountFrozenAlertModal = null;
let withdrawalDecisionModal = null;
let historyModal = null;
let latestHomeClientData = {};
let latestHomeFundingData = {};
let homeFundingRefreshTimer = null;
let homeFundingRefreshSeq = 0;
let dominoModeModal = null;
let dominoDuelStakeModal = null;
let dameStakeModal = null;
let dameBlockedModal = null;
let ludoStakeModal = null;
let ludoBlockedModal = null;
let upcomingGameModal = null;
let deferredPwaInstallPrompt = null;
let pwaInstallModalRefs = null;
let pwaInstallModalTimer = null;
let welcomeCoordinatorModalRefs = null;
let tournamentCostConfirmModal = null;
let tournamentFeedbackModal = null;
let tournamentRulesModal = null;
let tournamentRegisterBusy = false;
let tournamentRegisterListUnsub = null;
let tournamentBracketUnsub = null;
let tournamentBracketBuildInFlight = false;
let tournamentRegisterGateBusy = false;
let tournamentAlreadyRegistered = false;
let currentTournamentGameState = {
  name: "",
  key: "",
  image: "./assets/images/championna.png",
};
const TOURNAMENT_REGISTER_COST_HTG = 200;
const TOURNAMENT_REGISTER_COST_DOES = TOURNAMENT_REGISTER_COST_HTG * 20;

const DAME_PUBLIC_ENTRY_HTG = 25;
const LUDO_PUBLIC_ENTRY_HTG = 25;
const CHESS_PUBLIC_ENTRY_HTG = 25;
const CHESS_PRIVATE_MIN_STAKE_HTG = 25;
const LUDO_PUBLIC_ENTRY_DOES = 500;
const LUDO_FRIEND_STAKE_OPTIONS_HTG = Object.freeze([25, 50, 100, 250, 500]);
const UPCOMING_GAME_LABELS = {
  ludo: "Ludo",
  chess: "Echec",
};
const PUBLIC_GAME_AVAILABILITY_TTL_MS = 15000;
const DEFAULT_PUBLIC_GAME_AVAILABILITY = Object.freeze({
  pongEnabled: true,
  dominoClassicEnabled: true,
  dominoDuelPublicEnabled: true,
  ludoEnabled: true,
});

let publicGameAvailabilityCache = { ...DEFAULT_PUBLIC_GAME_AVAILABILITY };
let publicGameAvailabilityUpdatedAtMs = 0;
let publicGameAvailabilityPromise = null;
let gameUnavailableModal = null;

function normalizePublicGameAvailability(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    pongEnabled: source.pongEnabled !== false,
    dominoClassicEnabled: source.dominoClassicEnabled !== false,
    dominoDuelPublicEnabled: source.dominoDuelPublicEnabled !== false,
    ludoEnabled: source.ludoEnabled !== false,
  };
}

async function readPublicGameAvailability(force = false) {
  const nowMs = Date.now();
  const shouldUseCache =
    !force
    && publicGameAvailabilityUpdatedAtMs > 0
    && (nowMs - publicGameAvailabilityUpdatedAtMs) < PUBLIC_GAME_AVAILABILITY_TTL_MS;
  if (shouldUseCache) {
    return { ...publicGameAvailabilityCache };
  }
  if (publicGameAvailabilityPromise) {
    return publicGameAvailabilityPromise;
  }

  publicGameAvailabilityPromise = (async () => {
    try {
      const payload = await getPublicRuntimeConfigSecure();
      publicGameAvailabilityCache = normalizePublicGameAvailability(payload);
      publicGameAvailabilityUpdatedAtMs = Date.now();
    } catch (error) {
      console.warn("[KOBPOSH_V2] public game availability refresh failed", error);
      if (!publicGameAvailabilityCache || typeof publicGameAvailabilityCache !== "object") {
        publicGameAvailabilityCache = { ...DEFAULT_PUBLIC_GAME_AVAILABILITY };
      }
    } finally {
      publicGameAvailabilityPromise = null;
    }
    return { ...publicGameAvailabilityCache };
  })();

  return publicGameAvailabilityPromise;
}

function getGameAvailabilityLabel(gameKey = "") {
  const normalizedKey = String(gameKey || "").trim().toLowerCase();
  if (normalizedKey === "pong") return "Pong";
  if (normalizedKey === "dominoclassic" || normalizedKey === "domino-classic") return "Domino 4 player";
  if (normalizedKey === "dominoduel" || normalizedKey === "domino-duel") return "Domino duel gran chanm";
  if (normalizedKey === "ludo") return "Ludo";
  return "Jwet sa a";
}

function ensureGameUnavailableModal() {
  if (gameUnavailableModal) return gameUnavailableModal;

  gameUnavailableModal = document.createElement("section");
  gameUnavailableModal.className = "kobposh-forgot-modal";
  gameUnavailableModal.setAttribute("aria-hidden", "true");
  gameUnavailableModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhGameUnavailableTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-game-unavailable-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">JWET PA DISPONIB</p>
      <h2 id="kobposhGameUnavailableTitle" class="kobposh-forgot-modal__title" data-kobposh-game-unavailable-title>Jwet sa a pa disponib pou kounye a</h2>
      <p class="kobposh-forgot-modal__text" data-kobposh-game-unavailable-text>
        Tanpri tounen pita. Nou femen jwet sa a tanporèman pandan nap travay sou li.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-game-unavailable-close>
        Mwen konprann
      </button>
    </div>
  `;

  document.body.appendChild(gameUnavailableModal);
  renderIconsSafely();

  gameUnavailableModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === gameUnavailableModal || target?.closest("[data-kobposh-game-unavailable-close]")) {
      closeGameUnavailableModal();
    }
  });

  return gameUnavailableModal;
}

function openGameUnavailableModal(gameKey = "", options = {}) {
  const modal = ensureGameUnavailableModal();
  const label = getGameAvailabilityLabel(gameKey);
  const titleEl = modal.querySelector("[data-kobposh-game-unavailable-title]");
  const textEl = modal.querySelector("[data-kobposh-game-unavailable-text]");
  const customTitle = String(options?.title || "").trim();
  const customText = String(options?.text || "").trim();

  if (titleEl) {
    titleEl.textContent = customTitle || `${label} pa disponib pou kounye a`;
  }
  if (textEl) {
    textEl.textContent = customText || `Nou femen ${label} tanporèman. Tanpri tounen pita pou eseye anko.`;
  }

  closeGamesModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.remove("modal-open");
  document.body.classList.add("is-modal-open");
}

function closeGameUnavailableModal() {
  if (!gameUnavailableModal) return;
  gameUnavailableModal.classList.remove("is-open");
  gameUnavailableModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

async function canLaunchPublicGame(gameKey = "") {
  const availability = await readPublicGameAvailability(true);
  const normalizedKey = String(gameKey || "").trim().toLowerCase();
  let isEnabled = true;
  if (normalizedKey === "pong") {
    isEnabled = availability.pongEnabled !== false;
  } else if (normalizedKey === "dominoduel" || normalizedKey === "domino-duel") {
    isEnabled = availability.dominoDuelPublicEnabled !== false;
  } else if (normalizedKey === "ludo") {
    isEnabled = availability.ludoEnabled !== false;
  } else {
    isEnabled = availability.dominoClassicEnabled !== false;
  }

  if (!isEnabled) {
    openGameUnavailableModal(normalizedKey);
    return false;
  }
  return true;
}

async function launchPongEntry() {
  if (!auth.currentUser) {
    openAuthScreen("login");
    return;
  }
  const canLaunch = await canLaunchPublicGame("pong");
  if (!canLaunch) return;
  window.location.href = "./pong.html?fundingCurrency=htg";
}

async function launchDominoClassicEntry() {
  const canLaunch = await canLaunchPublicGame("dominoClassic");
  if (!canLaunch) return;
  window.location.href = "./domino-classique.html?autostart=1";
}

function buildLudoEntryUrl({
  roomMode = "",
  friendAction = "",
  inviteCode = "",
  roomId = "",
  stakeHtg = LUDO_PUBLIC_ENTRY_HTG,
  autostart = true,
  includeStake = true,
} = {}) {
  const safeStakeHtg = Math.max(0, Math.trunc(Number(stakeHtg) || LUDO_PUBLIC_ENTRY_HTG));
  const params = new URLSearchParams({
    fundingCurrency: "htg",
  });
  if (includeStake) {
    params.set("stakeDoes", String(safeStakeHtg * 20));
    params.set("stakeHtg", String(safeStakeHtg));
  }
  if (autostart) params.set("autostart", "1");
  if (roomMode) params.set("roomMode", String(roomMode || "").trim());
  if (friendAction) params.set("friendAction", String(friendAction || "").trim());
  if (inviteCode) params.set("inviteCode", String(inviteCode || "").trim().toUpperCase());
  if (roomId) params.set("friendLudoRoomId", String(roomId || "").trim());
  return `./ludo-js-master/index.html?${params.toString()}`;
}

function closeLudoStakeModal() {
  if (!ludoStakeModal) return;
  ludoStakeModal.classList.remove("is-open");
  ludoStakeModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function ensureLudoStakeModal() {
  if (ludoStakeModal) return ludoStakeModal;

  ludoStakeModal = document.createElement("section");
  ludoStakeModal.className = "kobposh-forgot-modal";
  ludoStakeModal.setAttribute("aria-hidden", "true");
  ludoStakeModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhLudoStakeTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-ludo-stake-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">LUDO</p>
      <h2 id="kobposhLudoStakeTitle" class="kobposh-forgot-modal__title">Chwazi kijan ou vle antre nan Ludo</h2>
      <div class="mt-3 rounded-full border border-[#d6ebe0] bg-[#eef8f1] px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-[#156437]" data-kobposh-ludo-step-label>
        Etap 1/3
      </div>

      <div class="mt-5 space-y-4" data-kobposh-ludo-step-panel="mode">
        <button class="w-full rounded-[22px] border border-[#dce5df] bg-white px-5 py-4 text-left transition hover:bg-[#f6faf7]" type="button" data-kobposh-ludo-mode="public">
          <span class="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Piblik</span>
          <span class="mt-2 block text-lg font-black text-[#18212b]">Gran chanm</span>
          <span class="mt-2 block text-sm leading-6 text-[#5f6f67]">Antre dirak nan gran chanm piblik 25 HTG la.</span>
        </button>
        <button class="w-full rounded-[22px] border border-[#dce5df] bg-white px-5 py-4 text-left transition hover:bg-[#f6faf7]" type="button" data-kobposh-ludo-mode="friend">
          <span class="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Entre amis</span>
          <span class="mt-2 block text-lg font-black text-[#18212b]">Salon prive</span>
          <span class="mt-2 block text-sm leading-6 text-[#5f6f67]">Kreye yon salon oswa antre ak kod zanmi ou voye ba ou.</span>
        </button>
      </div>

      <div class="mt-5 hidden space-y-4" data-kobposh-ludo-step-panel="public">
        <div class="rounded-[22px] border border-[#d6ebe0] bg-[#eef8f1] px-5 py-4 text-center">
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f7f76]">Gran chanm</p>
          <p class="mt-2 text-2xl font-black text-[#156437]">25 HTG</p>
          <p class="mt-3 text-sm leading-6 text-[#5f6f67]">Le ou kontinye, paj Ludo a ap louvri sou antre piblik la.</p>
        </div>
        <p class="min-h-[20px] text-sm font-medium text-[#c05b5b]" data-kobposh-ludo-public-status></p>
      </div>

      <div class="mt-5 hidden space-y-4" data-kobposh-ludo-step-panel="private">
        <button class="w-full rounded-[22px] border border-[#dce5df] bg-white px-5 py-4 text-left transition hover:bg-[#f6faf7]" type="button" data-kobposh-ludo-friend-action="create">
          <span class="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Kreye</span>
          <span class="mt-2 block text-lg font-black text-[#18212b]">Nouvo salon prive</span>
          <span class="mt-2 block text-sm leading-6 text-[#5f6f67]">Nou ap kreye salon an la menm epi ba ou kod la anvan ou antre sou paj la.</span>
        </button>
        <button class="w-full rounded-[22px] border border-[#dce5df] bg-white px-5 py-4 text-left transition hover:bg-[#f6faf7]" type="button" data-kobposh-ludo-friend-action="join">
          <span class="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Antre</span>
          <span class="mt-2 block text-lg font-black text-[#18212b]">Mwen gen yon kod</span>
          <span class="mt-2 block text-sm leading-6 text-[#5f6f67]">Antre sou paj Ludo a ak kod salon prive a.</span>
        </button>
      </div>

      <div class="mt-5 hidden space-y-4" data-kobposh-ludo-step-panel="privateCreate">
        <div class="rounded-[22px] border border-[#dce5df] bg-white px-5 py-5">
          <label class="block" for="kobposhLudoFriendStakeInput">
            <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Miz salon an</span>
            <div class="mt-3 flex items-center gap-3 rounded-[20px] border border-[#dce5df] bg-[#f7fbf8] px-4 py-3">
              <input id="kobposhLudoFriendStakeInput" type="number" min="25" step="1" value="25" class="min-w-0 flex-1 border-0 bg-transparent text-[28px] font-black tracking-[-0.02em] text-[#18212b] outline-none" />
              <span class="rounded-full border border-[#dce5df] bg-white px-3 py-1 text-xs font-semibold text-[#50615a]">HTG</span>
            </div>
          </label>
          <div class="mt-4 flex flex-wrap gap-2">
            <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-kobposh-ludo-stake-quick="25">25 HTG</button>
            <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-kobposh-ludo-stake-quick="50">50 HTG</button>
            <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-kobposh-ludo-stake-quick="100">100 HTG</button>
            <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-kobposh-ludo-stake-quick="250">250 HTG</button>
            <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-kobposh-ludo-stake-quick="500">500 HTG</button>
          </div>
          <p class="mt-4 text-xs leading-5 text-[#6d7b74]">Joiner a ap suiv mise sa a. Li pap ka chanje li sou pa l.</p>
          <p class="mt-3 min-h-[20px] text-sm font-medium text-[#c05b5b]" data-kobposh-ludo-private-status></p>
        </div>
      </div>

      <div class="mt-5 hidden space-y-4" data-kobposh-ludo-step-panel="privateShare">
        <div class="rounded-[22px] border border-[#d6ebe0] bg-[#eef8f1] px-5 py-5">
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f7f76]">Salon pare</p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <p class="text-2xl font-black text-[#156437]">Kod la deja pare</p>
            <span class="rounded-full border border-[#dce5df] bg-white px-3 py-1 text-[11px] font-semibold text-[#41514b]" data-kobposh-ludo-created-stake>25 HTG</span>
          </div>
          <p class="mt-3 text-sm leading-6 text-[#5f6f67]">Pataje kod sa a ak zanmi ou avan ou antre sou paj Ludo a. Konsa li ka prepare kod la tou san nou pa pedi tan apre sa.</p>
        </div>
        <div class="rounded-[22px] border border-[#dce5df] bg-white px-5 py-5">
          <label class="block">
            <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Kod salon prive a</span>
            <div class="mt-3 flex items-center gap-3 rounded-[20px] border border-[#dce5df] bg-[#f7fbf8] px-4 py-4">
              <p class="min-w-0 flex-1 text-[30px] font-black uppercase tracking-[0.24em] text-[#18212b]" data-kobposh-ludo-created-code>------</p>
              <button type="button" class="rounded-full border border-[#dce5df] bg-white px-4 py-2 text-xs font-semibold text-[#42524c] transition hover:bg-[#f7fbf8]" data-kobposh-ludo-copy-code>
                Kopye
              </button>
            </div>
          </label>
          <p class="mt-4 text-xs leading-5 text-[#6d7b74]">Le ou peze kontinye, paj Ludo a ap louvri dirak sou salon sa a san li pa bezwen rekreye li.</p>
          <p class="mt-3 min-h-[20px] text-sm font-medium text-[#156437]" data-kobposh-ludo-share-status></p>
        </div>
      </div>

      <div class="mt-5 hidden space-y-4" data-kobposh-ludo-step-panel="privateJoin">
        <div class="rounded-[22px] border border-[#dce5df] bg-white px-5 py-5">
          <label class="block" for="kobposhLudoFriendJoinCodeInput">
            <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Kod salon prive a</span>
            <input id="kobposhLudoFriendJoinCodeInput" type="text" maxlength="12" placeholder="Egzanp: AB12CD" class="mt-3 w-full rounded-[20px] border border-[#dce5df] bg-[#f7fbf8] px-4 py-4 text-base font-semibold uppercase tracking-[0.24em] text-[#18212b] outline-none transition focus:border-[#1b6b3f]" />
          </label>
          <p class="mt-4 text-xs leading-5 text-[#6d7b74]">Paj Ludo a ap verifye kod la epi relire room nan avan li kite w antre.</p>
          <p class="mt-3 min-h-[20px] text-sm font-medium text-[#c05b5b]" data-kobposh-ludo-join-status></p>
        </div>
      </div>

      <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button class="hidden rounded-full border border-[#dbe4dc] bg-white px-5 py-3 text-sm font-semibold text-[#43524c] transition hover:bg-[#f6faf7]" type="button" data-kobposh-ludo-step-back>
          Retounen
        </button>
        <button class="kobposh-forgot-modal__action" type="button" data-kobposh-ludo-step-next>
          Kontinye
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(ludoStakeModal);
  renderIconsSafely();

  const stepLabelEl = ludoStakeModal.querySelector("[data-kobposh-ludo-step-label]");
  const backBtn = ludoStakeModal.querySelector("[data-kobposh-ludo-step-back]");
  const nextBtn = ludoStakeModal.querySelector("[data-kobposh-ludo-step-next]");
  const stepPanels = Array.from(ludoStakeModal.querySelectorAll("[data-kobposh-ludo-step-panel]"));
  const privateStakeInput = ludoStakeModal.querySelector("#kobposhLudoFriendStakeInput");
  const privateStakeStatusEl = ludoStakeModal.querySelector("[data-kobposh-ludo-private-status]");
  const joinCodeInput = ludoStakeModal.querySelector("#kobposhLudoFriendJoinCodeInput");
  const joinStatusEl = ludoStakeModal.querySelector("[data-kobposh-ludo-join-status]");
  const publicStatusEl = ludoStakeModal.querySelector("[data-kobposh-ludo-public-status]");
  const quickStakeButtons = Array.from(ludoStakeModal.querySelectorAll("[data-kobposh-ludo-stake-quick]"));
  const createdCodeEl = ludoStakeModal.querySelector("[data-kobposh-ludo-created-code]");
  const createdStakeEl = ludoStakeModal.querySelector("[data-kobposh-ludo-created-stake]");
  const shareStatusEl = ludoStakeModal.querySelector("[data-kobposh-ludo-share-status]");
  const copyCodeBtn = ludoStakeModal.querySelector("[data-kobposh-ludo-copy-code]");
  const normalizeStakeHtg = (value, fallback = LUDO_PUBLIC_ENTRY_HTG) => {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  };
  const normalizeInviteCode = (value = "") => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
  const STEP_META = {
    mode: { label: "Etap 1/3", nextLabel: "Suivant", showBack: false },
    public: { label: "Etap 2/2", nextLabel: "Antre nan gran chanm nan", showBack: true },
    private: { label: "Etap 2/3", nextLabel: "Suivant", showBack: true },
    privateCreate: { label: "Etap 3/3", nextLabel: "Kreye salon prive a", showBack: true },
    privateShare: { label: "Etap 3/3", nextLabel: "Kontinye sou paj Ludo a", showBack: false },
    privateJoin: { label: "Etap 3/3", nextLabel: "Antre sou paj Ludo a", showBack: true },
  };
  let currentStep = "mode";
  let selectedMode = "";
  let selectedFriendAction = "";
  let privateStakeHtg = LUDO_PUBLIC_ENTRY_HTG;
  let createdFriendRoomState = null;
  let creatingFriendRoom = false;

  const setPublicStatus = (message = "") => {
    if (publicStatusEl) publicStatusEl.textContent = String(message || "");
  };
  const setPrivateStakeStatus = (message = "") => {
    if (privateStakeStatusEl) privateStakeStatusEl.textContent = String(message || "");
  };
  const setJoinStatus = (message = "") => {
    if (joinStatusEl) joinStatusEl.textContent = String(message || "");
  };
  const setShareStatus = (message = "", tone = "success") => {
    if (!shareStatusEl) return;
    shareStatusEl.textContent = String(message || "");
    shareStatusEl.classList.toggle("text-[#156437]", tone !== "error");
    shareStatusEl.classList.toggle("text-[#c05b5b]", tone === "error");
  };
  const validatePublic = () => {
    const balance = getCurrentHomeWalletTotalHtg();
    if (balance < LUDO_PUBLIC_ENTRY_HTG) {
      setPublicStatus(`Ou bezwen ${Math.max(0, LUDO_PUBLIC_ENTRY_HTG - balance)} HTG anplis pou antre nan gran chanm nan.`);
      return false;
    }
    setPublicStatus("");
    return true;
  };
  const validatePrivateStake = () => {
    privateStakeHtg = normalizeStakeHtg(privateStakeInput?.value, LUDO_PUBLIC_ENTRY_HTG);
    if (privateStakeInput) privateStakeInput.value = String(privateStakeHtg || "");
    if (!LUDO_FRIEND_STAKE_OPTIONS_HTG.includes(privateStakeHtg)) {
      setPrivateStakeStatus("Chwazi youn nan mise prive yo: 25, 50, 100, 250 oswa 500 HTG.");
      return false;
    }
    const balance = getCurrentHomeWalletTotalHtg();
    if (balance < privateStakeHtg) {
      setPrivateStakeStatus(`Ou bezwen ${Math.max(0, privateStakeHtg - balance)} HTG anplis pou kreye salon sa a.`);
      return false;
    }
    setPrivateStakeStatus("");
    return true;
  };
  const validateJoinCode = () => {
    const inviteCode = normalizeInviteCode(joinCodeInput?.value || "");
    if (joinCodeInput) joinCodeInput.value = inviteCode;
    if (!inviteCode || inviteCode.length < 4) {
      setJoinStatus("Mete yon kod salon prive ki valab.");
      return false;
    }
    setJoinStatus("");
    return true;
  };
  const populateCreatedFriendRoom = () => {
    const inviteCode = normalizeInviteCode(createdFriendRoomState?.inviteCode || "");
    const roomStakeHtg = normalizeStakeHtg(createdFriendRoomState?.stakeHtg, privateStakeHtg || LUDO_PUBLIC_ENTRY_HTG);
    if (createdCodeEl) createdCodeEl.textContent = inviteCode || "------";
    if (createdStakeEl) createdStakeEl.textContent = `${roomStakeHtg} HTG`;
  };
  const copyCreatedFriendCode = async () => {
    const inviteCode = normalizeInviteCode(createdFriendRoomState?.inviteCode || "");
    if (!inviteCode) {
      setShareStatus("Kod la poko pare pou kopye.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteCode);
      setShareStatus("Kod la kopye. Ou ka voye li bay zanmi ou kounye a.");
    } catch (_) {
      setShareStatus(`Kopye kod sa a manyelman: ${inviteCode}`, "error");
    }
  };
  const renderStep = () => {
    stepPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.getAttribute("data-kobposh-ludo-step-panel") !== currentStep);
    });
    const meta = STEP_META[currentStep] || STEP_META.mode;
    if (stepLabelEl) stepLabelEl.textContent = meta.label;
    populateCreatedFriendRoom();
    if (nextBtn) {
      nextBtn.textContent = meta.nextLabel;
      nextBtn.disabled = (currentStep === "mode" && !selectedMode)
        || (currentStep === "private" && !selectedFriendAction)
        || (currentStep === "privateCreate" && creatingFriendRoom)
        || (currentStep === "privateShare" && (!createdFriendRoomState?.roomId || creatingFriendRoom));
    }
    if (backBtn) backBtn.classList.toggle("hidden", !meta.showBack);
  };
  const resetFlow = () => {
    currentStep = "mode";
    selectedMode = "";
    selectedFriendAction = "";
    privateStakeHtg = LUDO_PUBLIC_ENTRY_HTG;
    createdFriendRoomState = null;
    creatingFriendRoom = false;
    if (privateStakeInput) privateStakeInput.value = String(LUDO_PUBLIC_ENTRY_HTG);
    if (joinCodeInput) joinCodeInput.value = "";
    setPublicStatus("");
    setPrivateStakeStatus("");
    setJoinStatus("");
    setShareStatus("");
    renderStep();
  };
  const launch = (options = {}) => {
    closeLudoStakeModal();
    window.location.href = buildLudoEntryUrl(options);
  };
  const handleCreateFriendRoom = async () => {
    if (!validatePrivateStake()) return;

    creatingFriendRoom = true;
    createdFriendRoomState = null;
    setPrivateStakeStatus("M ap kreye salon prive a...");
    setShareStatus("M ap kreye salon prive a...");
    renderStep();
    try {
      const result = await createFriendLudoRoomSecure({ stakeHtg: privateStakeHtg });
      createdFriendRoomState = {
        roomId: String(result?.roomId || "").trim(),
        inviteCode: normalizeInviteCode(result?.inviteCode || ""),
        stakeHtg: normalizeStakeHtg(result?.stakeHtg, privateStakeHtg),
        resumed: result?.resumed === true,
      };
      currentStep = "privateShare";
      setShareStatus(
        createdFriendRoomState.resumed
          ? "Nou jwenn salon prive ou te deja genyen an. Ou ka pataje kod la oswa kontinye."
          : "Salon prive a pare. Pataje kod la ak zanmi ou avan ou antre nan paj la."
      );
      setPrivateStakeStatus("");
      renderStep();
    } catch (error) {
      createdFriendRoomState = null;
      setShareStatus("");
      setPrivateStakeStatus(error?.message || "Nou pa rive kreye salon prive a.");
      renderStep();
    } finally {
      creatingFriendRoom = false;
      renderStep();
    }
  };

  ludoStakeModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === ludoStakeModal || target?.closest("[data-kobposh-ludo-stake-close]")) {
      closeLudoStakeModal();
      return;
    }
    const modeBtn = target?.closest("[data-kobposh-ludo-mode]");
    if (modeBtn) {
      selectedMode = modeBtn.getAttribute("data-kobposh-ludo-mode") === "friend" ? "friend" : "public";
      currentStep = selectedMode === "friend" ? "private" : "public";
      renderStep();
      return;
    }
    const friendActionBtn = target?.closest("[data-kobposh-ludo-friend-action]");
    if (friendActionBtn) {
      selectedFriendAction = friendActionBtn.getAttribute("data-kobposh-ludo-friend-action") === "join" ? "join" : "create";
      currentStep = selectedFriendAction === "join" ? "privateJoin" : "privateCreate";
      renderStep();
      return;
    }
    const quickStakeBtn = target?.closest("[data-kobposh-ludo-stake-quick]");
    if (quickStakeBtn) {
      privateStakeHtg = normalizeStakeHtg(quickStakeBtn.getAttribute("data-kobposh-ludo-stake-quick"), LUDO_PUBLIC_ENTRY_HTG);
      if (privateStakeInput) privateStakeInput.value = String(privateStakeHtg || "");
      validatePrivateStake();
      return;
    }
    if (target?.closest("[data-kobposh-ludo-step-back]")) {
      if (currentStep === "public" || currentStep === "private") {
        currentStep = "mode";
      } else if (currentStep === "privateCreate" || currentStep === "privateJoin") {
        currentStep = "private";
      } else {
        currentStep = "mode";
      }
      renderStep();
      return;
    }
    if (target?.closest("[data-kobposh-ludo-step-next]")) {
      if (currentStep === "mode") {
        currentStep = selectedMode === "friend" ? "private" : "public";
        renderStep();
        return;
      }
      if (currentStep === "public") {
        if (!validatePublic()) return;
        launch({ autostart: true, stakeHtg: LUDO_PUBLIC_ENTRY_HTG });
        return;
      }
      if (currentStep === "private") {
        currentStep = selectedFriendAction === "join" ? "privateJoin" : "privateCreate";
        renderStep();
        return;
      }
      if (currentStep === "privateCreate") {
        void handleCreateFriendRoom();
        return;
      }
      if (currentStep === "privateShare") {
        if (!createdFriendRoomState?.roomId) {
          renderStep();
          return;
        }
        launch({
          autostart: false,
          roomMode: "ludo_friends",
          friendAction: "create",
          inviteCode: normalizeInviteCode(createdFriendRoomState.inviteCode || ""),
          roomId: String(createdFriendRoomState.roomId || "").trim(),
          stakeHtg: normalizeStakeHtg(createdFriendRoomState.stakeHtg, privateStakeHtg),
        });
        return;
      }
      if (currentStep === "privateJoin") {
        if (!validateJoinCode()) return;
        launch({
          autostart: false,
          roomMode: "ludo_friends",
          friendAction: "join",
          inviteCode: normalizeInviteCode(joinCodeInput?.value || ""),
          includeStake: false,
        });
      }
    }
    if (target?.closest("[data-kobposh-ludo-copy-code]")) {
      void copyCreatedFriendCode();
    }
  });

  quickStakeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      privateStakeHtg = normalizeStakeHtg(button.getAttribute("data-kobposh-ludo-stake-quick"), LUDO_PUBLIC_ENTRY_HTG);
      if (privateStakeInput) privateStakeInput.value = String(privateStakeHtg || "");
      validatePrivateStake();
    });
  });
  privateStakeInput?.addEventListener("input", () => {
    validatePrivateStake();
  });
  joinCodeInput?.addEventListener("input", () => {
    joinCodeInput.value = normalizeInviteCode(joinCodeInput.value || "");
    validateJoinCode();
  });
  ludoStakeModal.__kobposhLudoResetFlow = resetFlow;
  resetFlow();

  return ludoStakeModal;
}

function openLudoStakeModal() {
  const modal = ensureLudoStakeModal();
  if (typeof modal.__kobposhLudoResetFlow === "function") {
    modal.__kobposhLudoResetFlow();
  }
  closeGamesModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.remove("modal-open");
  document.body.classList.add("is-modal-open");
}

function closeLudoBlockedModal() {
  if (!ludoBlockedModal) return;
  ludoBlockedModal.classList.remove("is-open");
  ludoBlockedModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function ensureLudoBlockedModal() {
  if (ludoBlockedModal) return ludoBlockedModal;

  ludoBlockedModal = document.createElement("section");
  ludoBlockedModal.className = "kobposh-forgot-modal";
  ludoBlockedModal.setAttribute("aria-hidden", "true");
  ludoBlockedModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhLudoBlockedTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-ludo-blocked-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">HTG PA SIFI</p>
      <h2 id="kobposhLudoBlockedTitle" class="kobposh-forgot-modal__title">Ou poko pare pou antre nan Ludo</h2>
      <p class="kobposh-forgot-modal__text" data-kobposh-ludo-blocked-text>
        Ou bezwen plis HTG disponib sou kont ou avan ou ka antre nan jwèt la.
      </p>
      <div class="mt-6 flex flex-col gap-3">
        <button class="kobposh-forgot-modal__action" type="button" data-kobposh-ludo-blocked-deposit>
          Fè yon depo
        </button>
        <button class="rounded-full border border-[#dbe4dc] bg-white px-5 py-3 text-sm font-semibold text-[#43524c] transition hover:bg-[#f6faf7]" type="button" data-kobposh-ludo-blocked-close>
          Retounen
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(ludoBlockedModal);
  renderIconsSafely();

  ludoBlockedModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === ludoBlockedModal || target?.closest("[data-kobposh-ludo-blocked-close]")) {
      closeLudoBlockedModal();
      return;
    }
    if (target?.closest("[data-kobposh-ludo-blocked-deposit]")) {
      closeLudoBlockedModal();
      openDepositModal();
    }
  });

  return ludoBlockedModal;
}

function openLudoBlockedModal(requiredHtg = LUDO_PUBLIC_ENTRY_HTG, currentHtg = 0) {
  const modal = ensureLudoBlockedModal();
  const textEl = modal.querySelector("[data-kobposh-ludo-blocked-text]");
  const safeRequired = Math.max(0, Math.trunc(Number(requiredHtg) || 0));
  const safeCurrent = Math.max(0, Math.trunc(Number(currentHtg) || 0));
  const missingHtg = Math.max(0, safeRequired - safeCurrent);

  if (textEl) {
    if (safeCurrent > 0) {
      textEl.textContent = `Ou bezwen omwen ${formatHtg(safeRequired)} disponib pou antre nan jeu Ludo a. Kounye a ou gen ${formatHtg(safeCurrent)}. Sa vle di ou manke ${formatHtg(missingHtg)} toujou.`;
    } else {
      textEl.textContent = `Ou bezwen omwen ${formatHtg(safeRequired)} disponib pou antre nan jeu Ludo a. Kounye a ou pa gen HTG disponib sou kont ou.`;
    }
  }

  closeGamesModal();
  closeLudoStakeModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.remove("modal-open");
  document.body.classList.add("is-modal-open");
}

function ensureDominoModeModal() {
  if (dominoModeModal) return dominoModeModal;

  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[4200] hidden items-stretch justify-stretch overflow-hidden bg-[rgba(239,246,241,0.82)] backdrop-blur-sm";
  overlay.setAttribute("data-kobposh-domino-mode-modal", "");
  overlay.innerHTML = `
    <div class="flex h-[100dvh] w-full flex-col overflow-hidden bg-[linear-gradient(180deg,_rgba(248,252,249,0.98),_rgba(241,248,243,0.96))]">
      <div class="flex shrink-0 items-center justify-between gap-4 border-b border-[#dcecdf] bg-white/90 px-4 py-4 sm:px-6">
        <div class="flex items-center gap-3">
          <button type="button" class="grid h-11 w-11 place-items-center rounded-full bg-[#eaf6ee] text-[#21342a] transition hover:bg-[#ddf1e3]" data-close-domino-mode aria-label="Retounen">
            <i data-lucide="arrow-left" class="icon" aria-hidden="true"></i>
          </button>
          <div>
            <p class="text-[11px] font-black uppercase tracking-[0.22em] text-[#51c774]">Jwet</p>
            <h2 class="text-[22px] font-black leading-none text-[#20252b] sm:text-[26px]">DOMINO</h2>
          </div>
        </div>
        <div class="rounded-full bg-[#e8f5ea] px-4 py-2 text-sm font-black uppercase tracking-[0.06em] text-[#20b15a]">Chwazi</div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,_rgba(238,247,241,0.9),_rgba(246,251,247,0.96))] px-3 py-4 sm:px-5 sm:py-5">
        <div class="mx-auto flex min-h-full w-full max-w-[1880px] flex-col overflow-hidden rounded-none border border-white/80 bg-white p-3 shadow-[0_10px_30px_rgba(14,61,30,0.08)] sm:rounded-[28px] sm:p-5">
          <img src="./assets/images/domino.png" alt="Domino" class="h-[clamp(220px,38vh,460px)] w-full rounded-[22px] object-cover" />
          <p class="mt-4 text-sm leading-6 text-[#50615a] sm:text-[17px]">Chwazi mòd domino ou vle lanse sou Kobposh kounye a.</p>
          <div class="mt-5 grid gap-3 sm:grid-cols-2">
            <button type="button" class="rounded-full border px-5 py-4 text-center text-base font-black transition" data-domino-mode-option="classic">Domino 4 player</button>
            <button type="button" class="rounded-full border px-5 py-4 text-center text-base font-black transition" data-domino-mode-option="duel">Domino 2 player</button>
          </div>
          <div class="mt-5 flex items-center justify-between gap-4 rounded-[22px] border border-[#dbeedf] bg-[#eef8f0] px-4 py-5">
            <div class="min-w-0">
            <p class="text-sm text-[#1e2a23]">Ou chwazi mòd</p>
            </div>
            <p class="shrink-0 text-xl font-black text-[#20b15a]" data-domino-mode-current-label>Domino 4 player</p>
          </div>
          <button type="button" class="mt-8 h-14 w-full rounded-[20px] bg-[#2cc460] text-lg font-black text-white shadow-[0_18px_30px_rgba(44,196,96,0.26)] transition hover:brightness-[1.03]" data-domino-mode-continue>Kontinye</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  renderIconsSafely();

  const modeLabels = {
    classic: "Domino 4 player",
    duel: "Domino 2 player",
  };
  let selectedMode = "classic";

  const optionButtons = Array.from(overlay.querySelectorAll("[data-domino-mode-option]"));
  const currentLabel = overlay.querySelector("[data-domino-mode-current-label]");
  const continueBtn = overlay.querySelector("[data-domino-mode-continue]");

  const renderSelectedMode = () => {
    optionButtons.forEach((button) => {
      const optionMode = button.getAttribute("data-domino-mode-option") === "classic" ? "classic" : "duel";
      const isActive = optionMode === selectedMode;
      button.className = isActive
        ? "rounded-full border border-[#9ce2b3] bg-[#e7f7eb] px-5 py-4 text-center text-base font-black text-[#1fb35a] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition"
        : "rounded-full border border-[#d9eadf] bg-white px-5 py-4 text-center text-base font-black text-[#1fb35a] transition hover:bg-[#f7fcf8]";
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    if (currentLabel) currentLabel.textContent = modeLabels[selectedMode] || "";
  };

  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    document.body.classList.remove("modal-open");
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector("[data-close-domino-mode]")?.addEventListener("click", close);
  optionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedMode = button.getAttribute("data-domino-mode-option") === "duel" ? "duel" : "classic";
      renderSelectedMode();
    });
  });
  continueBtn?.addEventListener("click", async () => {
    if (selectedMode === "duel") {
      close();
      ensureDominoDuelStakeModal().open();
      return;
    }
    close();
    await launchDominoClassicEntry();
  });
  renderSelectedMode();
  dominoModeModal = {
    open() {
      overlay.classList.remove("hidden");
      overlay.classList.add("flex");
      document.body.classList.add("modal-open");
    },
    close,
  };

  return dominoModeModal;
}

function ensureDominoDuelStakeModal() {
  if (dominoDuelStakeModal) return dominoDuelStakeModal;

  const PUBLIC_DUEL_STAKE_HTG = 25;
  const MIN_PRIVATE_DUEL_STAKE_HTG = 25;
  const HTG_TO_DOES_RATE = 20;

  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[4205] hidden items-end justify-center bg-black/55 px-4 py-6 backdrop-blur-sm sm:items-center";
  overlay.setAttribute("data-kobposh-domino-duel-stake-modal", "");
  overlay.innerHTML = `
    <div class="w-full max-w-2xl overflow-hidden rounded-[36px] border border-white/40 bg-[linear-gradient(180deg,rgba(255,252,247,0.98)_0%,rgba(248,251,247,0.96)_100%)] shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
      <div class="border-b border-[#e7ece6] px-6 py-6 sm:px-8 sm:py-7">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6f7f76]">Domino duel</p>
            <h2 class="mt-2 text-[30px] font-black leading-tight text-[#18212b]">Domino 2 joueurs</h2>
            <p class="mt-3 max-w-xl text-sm leading-6 text-[#61706a]" data-domino-duel-step-copy></p>
          </div>
          <div class="flex items-center gap-3">
            <span class="rounded-full border border-[#d6ebe0] bg-[#eef8f1] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#156437]" data-domino-duel-step-progress>Etap 1/3</span>
            <button type="button" class="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[#dbe4dc] bg-white/90 text-slate-700 transition hover:bg-[#f6faf7]" data-close-domino-duel-stake aria-label="Femen">
              <i data-lucide="x" class="icon" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div class="mt-5 flex flex-wrap gap-2">
          <span class="rounded-full border border-[#dbe4dc] bg-white px-3 py-1.5 text-xs font-semibold text-[#32423c]">Gran chanm: 25 HTG</span>
          <span class="rounded-full border border-[#dbe4dc] bg-white px-3 py-1.5 text-xs font-semibold text-[#32423c]">Salon prive: 25 HTG min</span>
          <span class="rounded-full border border-[#dbe4dc] bg-white px-3 py-1.5 text-xs font-semibold text-[#32423c]">2 joueurs</span>
        </div>
      </div>
      <div class="px-6 py-6 sm:px-8 sm:py-7">
        <div data-domino-duel-step-panel="mode" class="space-y-4">
          <div>
            <h3 class="text-[24px] font-black text-[#18212b]">Chwazi kijan ou vle antre</h3>
            <p class="mt-2 text-sm leading-6 text-[#6b7871]">Nou montre yon sel desizyon pa etap pou kenbe eksperyans la senp.</p>
          </div>
          <button type="button" class="group w-full rounded-[28px] border border-[#dfe7e1] bg-white px-5 py-5 text-left transition duration-150 hover:border-[#cae5d5] hover:bg-[#f8fcf9]" data-domino-duel-select-mode="public">
            <div class="flex items-start gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Piblik</p>
                <p class="mt-2 text-[22px] font-black text-[#18212b]">Gran chanm</p>
                <p class="mt-2 text-sm leading-6 text-[#697670]">Le sistem nan jwenn yon advese, duel la komanse otomatikman.</p>
              </div>
              <span class="mt-1 h-3.5 w-3.5 rounded-full bg-slate-200 transition" data-domino-duel-mode-indicator="public"></span>
            </div>
          </button>
          <button type="button" class="group w-full rounded-[28px] border border-[#dfe7e1] bg-white px-5 py-5 text-left transition duration-150 hover:border-[#cae5d5] hover:bg-[#f8fcf9]" data-domino-duel-select-mode="friend">
            <div class="flex items-start gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Entre amis</p>
                <p class="mt-2 text-[22px] font-black text-[#18212b]">Salon prive</p>
                <p class="mt-2 text-sm leading-6 text-[#697670]">Kreye yon salon oswa antre ak yon kod pou jwe ak yon zanmi.</p>
              </div>
              <span class="mt-1 h-3.5 w-3.5 rounded-full bg-slate-200 transition" data-domino-duel-mode-indicator="friend"></span>
            </div>
          </button>
        </div>

        <div data-domino-duel-step-panel="public" class="hidden space-y-4">
          <div class="rounded-[30px] border border-[#dcebe1] bg-[linear-gradient(180deg,#f5fcf7_0%,#eef8f1_100%)] px-5 py-5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border border-[#d6ebe0] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#156437]">Gran chanm</span>
              <span class="rounded-full border border-[#dce5df] bg-white px-3 py-1 text-[11px] font-semibold text-[#41514b]">25 HTG</span>
            </div>
            <h3 class="mt-4 text-[26px] font-black text-[#18212b]">Antre nan gran chanm nan</h3>
            <p class="mt-3 text-sm leading-6 text-[#5f6f67]">N ap chache yon lot jw pou yon duel Domino a 25 HTG. Lajan an pa soti avan match la jwenn 2 moun vre.</p>
            <p class="mt-3 min-h-[20px] text-sm font-medium text-[#c05b5b]" data-domino-duel-public-status></p>
          </div>
        </div>

        <div data-domino-duel-step-panel="private" class="hidden space-y-4">
          <div>
            <h3 class="text-[24px] font-black text-[#18212b]">Chwazi aksyon salon prive a</h3>
            <p class="mt-2 text-sm leading-6 text-[#6b7871]">Ou ka swa kreye pwop salon ou, swa antre ak kod yon zanmi voye ba ou.</p>
          </div>
          <button type="button" class="group w-full rounded-[28px] border border-[#dfe7e1] bg-white px-5 py-5 text-left transition duration-150 hover:border-[#cae5d5] hover:bg-[#f8fcf9]" data-domino-duel-select-friend-action="create">
            <div class="flex items-start gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Kreye</p>
                <p class="mt-2 text-[22px] font-black text-[#18212b]">Nouvo salon prive</p>
                <p class="mt-2 text-sm leading-6 text-[#697670]">Nou ap ba w yon kod pou pataje. Match la poko komanse ni pran lajan anvan 2e jw a antre.</p>
              </div>
              <span class="mt-1 h-3.5 w-3.5 rounded-full bg-slate-200 transition" data-domino-duel-friend-indicator="create"></span>
            </div>
          </button>
          <button type="button" class="group w-full rounded-[28px] border border-[#dfe7e1] bg-white px-5 py-5 text-left transition duration-150 hover:border-[#cae5d5] hover:bg-[#f8fcf9]" data-domino-duel-select-friend-action="join">
            <div class="flex items-start gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Antre</p>
                <p class="mt-2 text-[22px] font-black text-[#18212b]">Mwen gen yon kod</p>
                <p class="mt-2 text-sm leading-6 text-[#697670]">Mete kod zanmi ou voye a nan etap ki vini apre a.</p>
              </div>
              <span class="mt-1 h-3.5 w-3.5 rounded-full bg-slate-200 transition" data-domino-duel-friend-indicator="join"></span>
            </div>
          </button>
        </div>

        <div data-domino-duel-step-panel="private-create" class="hidden space-y-5">
          <div class="rounded-[30px] border border-[#ece1cf] bg-[linear-gradient(180deg,#fffaf2_0%,#fffdf8_100%)] px-5 py-5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border border-[#eed9b8] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8f6732]">Salon prive</span>
              <span class="rounded-full border border-[#eed9b8] bg-white px-3 py-1 text-[11px] font-semibold text-[#6b5430]">25 HTG min</span>
            </div>
            <h3 class="mt-4 text-[28px] font-black text-[#18212b]">Chwazi mise salon an</h3>
            <p class="mt-3 text-sm leading-6 text-[#6d6558]">Sa a se etap kote ou deside konbyen salon prive a vo. Le salon an pare, zanmi ou ap dwe gen menm kantite sa a sou kont li pou li antre.</p>
          </div>
          <div class="rounded-[30px] border border-[#dfe7e1] bg-white px-5 py-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
            <label class="block" for="dominoDuelPrivateStakeInput">
              <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Miz salon an</span>
              <div class="mt-3 flex items-center gap-3 rounded-[24px] border border-[#dce5df] bg-[#f7fbf8] px-4 py-3">
                <input id="dominoDuelPrivateStakeInput" type="number" inputmode="numeric" min="25" step="1" value="25" class="min-w-0 flex-1 border-0 bg-transparent text-[28px] font-black tracking-[-0.02em] text-[#18212b] outline-none" />
                <span class="rounded-full border border-[#dce5df] bg-white px-3 py-1 text-xs font-semibold text-[#50615a]">HTG</span>
              </div>
            </label>
            <div class="mt-4 flex flex-wrap gap-2">
              <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-domino-duel-stake-quick="25">25 HTG</button>
              <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-domino-duel-stake-quick="50">50 HTG</button>
              <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-domino-duel-stake-quick="100">100 HTG</button>
              <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-domino-duel-stake-quick="200">200 HTG</button>
            </div>
            <p class="mt-4 text-xs leading-5 text-[#6d7b74]">Se kantite sa a ni ou ni zanmi ou pral jwe a si nou antre nan menm salon an.</p>
            <p class="mt-3 min-h-[20px] text-sm font-medium text-[#c05b5b]" data-domino-duel-private-stake-status></p>
          </div>
        </div>

        <div data-domino-duel-step-panel="private-share" class="hidden space-y-5">
          <div class="rounded-[30px] border border-[#dcebe1] bg-[linear-gradient(180deg,#f5fcf7_0%,#eef8f1_100%)] px-5 py-5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border border-[#d6ebe0] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#156437]">Salon pare</span>
              <span class="rounded-full border border-[#dce5df] bg-white px-3 py-1 text-[11px] font-semibold text-[#41514b]" data-domino-duel-created-stake>25 HTG</span>
            </div>
            <h3 class="mt-4 text-[28px] font-black text-[#18212b]">Kod la deja pare</h3>
            <p class="mt-3 text-sm leading-6 text-[#5f6f67]">Pataje kod sa a ak zanmi ou avan ou antre nan paj duel la. Konsa li ka prepare kod la tou san nou pa pedi tan sou paj la.</p>
          </div>
          <div class="rounded-[30px] border border-[#dfe7e1] bg-white px-5 py-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Kod salon prive a</p>
            <div class="mt-3 flex items-center gap-3 rounded-[24px] border border-[#dce5df] bg-[#f7fbf8] px-4 py-4">
              <p class="min-w-0 flex-1 text-[30px] font-black uppercase tracking-[0.24em] text-[#18212b]" data-domino-duel-created-code>------</p>
              <button type="button" class="rounded-full border border-[#dce5df] bg-white px-4 py-2 text-xs font-semibold text-[#42524c] transition hover:bg-[#f7fbf8]" data-domino-duel-copy-code>
                Kopye
              </button>
            </div>
            <p class="mt-4 text-xs leading-5 text-[#6d7b74]">Le ou peze kontinye, paj duel la ap louvri dirak sou salon sa a san li pa bezwen rekreye li.</p>
            <p class="mt-3 min-h-[20px] text-sm font-medium text-[#156437]" data-domino-duel-share-status></p>
          </div>
        </div>

        <div data-domino-duel-step-panel="private-join" class="hidden space-y-5">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Kod prive</p>
            <h3 class="mt-2 text-[28px] font-black text-[#18212b]">Antre ak yon kod salon</h3>
            <p class="mt-2 text-sm leading-6 text-[#697670]">Mete kod zanmi ou voye a pou antre nan menm salon Domino a.</p>
          </div>
          <div class="rounded-[30px] border border-[#dfe7e1] bg-white px-5 py-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
            <label class="block">
              <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Kod salon an</span>
              <input type="text" inputmode="text" autocomplete="off" maxlength="12" placeholder="Egzanp: AB12CD" class="mt-3 w-full rounded-[22px] border border-[#dce5df] bg-[#f7fbf8] px-4 py-4 text-base font-semibold uppercase tracking-[0.24em] text-[#18212b] outline-none transition focus:border-[#1b6b3f]" data-domino-duel-join-code>
            </label>
            <p class="mt-4 text-xs leading-5 text-[#6d7b74]">Nou pral verifye salon an ak menm kod sa a avan nou kite ou antre.</p>
            <p class="mt-3 min-h-[20px] text-sm font-medium text-[#c05b5b]" data-domino-duel-join-status></p>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between gap-3 border-t border-[#e7ece6] px-6 py-5 sm:px-8">
        <button type="button" class="hidden rounded-full border border-[#dce5df] bg-white px-5 py-3 text-sm font-semibold text-[#42524c] transition hover:bg-[#f7fbf8]" data-domino-duel-step-back>
          Retounen
        </button>
        <button type="button" class="ml-auto rounded-full border border-[#1b6b3f] bg-[#1b6b3f] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[#15542f] disabled:cursor-not-allowed disabled:opacity-45" data-domino-duel-step-next>
          Suivant
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  renderIconsSafely();

  const stepCopyEl = overlay.querySelector("[data-domino-duel-step-copy]");
  const stepProgressEl = overlay.querySelector("[data-domino-duel-step-progress]");
  const backBtn = overlay.querySelector("[data-domino-duel-step-back]");
  const nextBtn = overlay.querySelector("[data-domino-duel-step-next]");
  const stepPanels = Array.from(overlay.querySelectorAll("[data-domino-duel-step-panel]"));
  const modeButtons = Array.from(overlay.querySelectorAll("[data-domino-duel-select-mode]"));
  const friendActionButtons = Array.from(overlay.querySelectorAll("[data-domino-duel-select-friend-action]"));
  const joinCodeInput = overlay.querySelector("[data-domino-duel-join-code]");
  const joinStatusEl = overlay.querySelector("[data-domino-duel-join-status]");
  const publicStatusEl = overlay.querySelector("[data-domino-duel-public-status]");
  const privateStakeInput = overlay.querySelector("#dominoDuelPrivateStakeInput");
  const privateStakeStatusEl = overlay.querySelector("[data-domino-duel-private-stake-status]");
  const privateStakeQuickButtons = Array.from(overlay.querySelectorAll("[data-domino-duel-stake-quick]"));
  const createdCodeEl = overlay.querySelector("[data-domino-duel-created-code]");
  const createdStakeEl = overlay.querySelector("[data-domino-duel-created-stake]");
  const shareStatusEl = overlay.querySelector("[data-domino-duel-share-status]");
  const copyCodeBtn = overlay.querySelector("[data-domino-duel-copy-code]");
  const normalizeInviteCode = (value = "") => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
  const normalizeStakeHtg = (value, fallback = MIN_PRIVATE_DUEL_STAKE_HTG) => {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  };
  const STEP_META = {
    mode: { progress: "Etap 1/3", copy: "", nextLabel: "Suivant", showBack: false },
    public: { progress: "Etap 2/2", copy: "", nextLabel: "Antre nan gran chanm nan", showBack: true },
    private: { progress: "Etap 2/3", copy: "Koulye a chwazi ki jan ou vle antre nan salon prive a.", nextLabel: "Suivant", showBack: true },
    privateCreate: { progress: "Etap 3/3", copy: "Denye etap la se konfime kreyasyon salon prive a.", nextLabel: "Kreye salon prive a", showBack: true },
    privateShare: { progress: "Etap 3/3", copy: "Kod la pare deja. Pataje li epi antre nan salon an le ou pare.", nextLabel: "Kontinye nan salon an", showBack: false },
    privateJoin: { progress: "Etap 3/3", copy: "Denye etap la se antre kod salon an.", nextLabel: "Antre nan salon an", showBack: true },
  };
  let currentStep = "mode";
  let selectedMode = "";
  let selectedFriendAction = "";
  let privateStakeHtg = MIN_PRIVATE_DUEL_STAKE_HTG;
  let createdFriendRoomState = null;
  let creatingFriendRoom = false;

  const buildDuelUrl = ({ roomMode = "", friendAction = "", inviteCode = "", roomId = "", stakeHtg = PUBLIC_DUEL_STAKE_HTG } = {}) => {
    const safeStakeHtg = Math.max(0, normalizeStakeHtg(stakeHtg, PUBLIC_DUEL_STAKE_HTG));
    const params = new URLSearchParams({
      stake: String(safeStakeHtg * HTG_TO_DOES_RATE),
      fundingCurrency: "htg",
      stakeHtg: String(safeStakeHtg),
    });
    if (roomMode) params.set("roomMode", roomMode);
    if (friendAction) params.set("friendAction", friendAction);
    if (inviteCode) params.set("inviteCode", inviteCode);
    if (roomId) params.set("friendDuelRoomId", String(roomId || "").trim());
    return `./jeu-duel-v2.html?${params.toString()}`;
  };
  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    document.body.classList.remove("modal-open");
  };
  const launch = (options = {}) => {
    close();
    window.location.href = buildDuelUrl(options);
  };
  const setJoinStatus = (message = "") => {
    if (joinStatusEl) joinStatusEl.textContent = String(message || "");
  };
  const setPublicStatus = (message = "") => {
    if (publicStatusEl) publicStatusEl.textContent = String(message || "");
  };
  const setPrivateStakeStatus = (message = "") => {
    if (privateStakeStatusEl) privateStakeStatusEl.textContent = String(message || "");
  };
  const setShareStatus = (message = "", tone = "success") => {
    if (!shareStatusEl) return;
    shareStatusEl.textContent = String(message || "");
    shareStatusEl.classList.toggle("text-[#156437]", tone !== "error");
    shareStatusEl.classList.toggle("text-[#c05b5b]", tone === "error");
  };
  const validatePublicEntry = () => {
    const balance = getCurrentHomeWalletTotalHtg();
    const canAfford = balance >= PUBLIC_DUEL_STAKE_HTG;
    if (!canAfford) {
      const missing = Math.max(0, PUBLIC_DUEL_STAKE_HTG - balance);
      setPublicStatus(`Ou bezwen ${missing} HTG anplis pou antre nan gran chanm nan.`);
    } else {
      setPublicStatus("");
    }
    return { canAfford, balance };
  };
  const validatePrivateStake = () => {
    privateStakeHtg = normalizeStakeHtg(privateStakeInput?.value, MIN_PRIVATE_DUEL_STAKE_HTG);
    if (privateStakeInput) {
      privateStakeInput.value = String(privateStakeHtg || "");
    }
    const balance = getCurrentHomeWalletTotalHtg();
    const meetsMinimum = privateStakeHtg >= MIN_PRIVATE_DUEL_STAKE_HTG;
    const canAfford = balance >= privateStakeHtg;
    if (privateStakeInput) {
      privateStakeInput.setAttribute("aria-invalid", meetsMinimum ? "false" : "true");
      privateStakeInput.setCustomValidity(
        meetsMinimum ? "" : `Mete omwen ${MIN_PRIVATE_DUEL_STAKE_HTG} HTG pou salon prive a.`
      );
    }
    if (!meetsMinimum) {
      setPrivateStakeStatus(`Miz la pa ka desann anba ${MIN_PRIVATE_DUEL_STAKE_HTG} HTG.`);
    } else if (!canAfford) {
      const missing = Math.max(0, privateStakeHtg - balance);
      setPrivateStakeStatus(`Ou bezwen ${missing} HTG anplis pou kreye salon sa a.`);
    } else {
      setPrivateStakeStatus("");
    }
    return { meetsMinimum, canAfford, balance };
  };
  const refreshStakeValidation = async () => {
    try {
      const uid = String(auth.currentUser?.uid || "").trim();
      if (uid) {
        await ensureXchangeState(uid);
      }
    } catch (_) {
    }
    return {
      publicState: validatePublicEntry(),
      privateState: validatePrivateStake(),
    };
  };
  const populateCreatedFriendRoom = () => {
    const inviteCode = normalizeInviteCode(createdFriendRoomState?.inviteCode || "");
    const roomStakeHtg = normalizeStakeHtg(createdFriendRoomState?.stakeHtg, privateStakeHtg || MIN_PRIVATE_DUEL_STAKE_HTG);
    if (createdCodeEl) createdCodeEl.textContent = inviteCode || "------";
    if (createdStakeEl) createdStakeEl.textContent = `${roomStakeHtg} HTG`;
  };
  const copyCreatedFriendCode = async () => {
    const inviteCode = normalizeInviteCode(createdFriendRoomState?.inviteCode || "");
    if (!inviteCode) {
      setShareStatus("Kod la poko pare pou kopye.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteCode);
      setShareStatus("Kod la kopye. Ou ka voye li bay zanmi ou kounye a.");
    } catch (_) {
      setShareStatus(`Kopye kod sa a manyelman: ${inviteCode}`, "error");
    }
  };
  const setSelectableState = (buttons, selectedValue, attributeName, indicatorName) => {
    buttons.forEach((button) => {
      const isActive = button.getAttribute(attributeName) === selectedValue;
      button.classList.toggle("border-[#1b6b3f]", isActive);
      button.classList.toggle("bg-emerald-50", isActive);
      button.classList.toggle("shadow-[0_14px_34px_rgba(16,185,129,0.12)]", isActive);
      button.classList.toggle("border-slate-200", !isActive);
      button.classList.toggle("bg-slate-50", !isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      const indicator = button.querySelector(`[${indicatorName}]`);
      if (indicator) {
        indicator.classList.toggle("bg-[#1b6b3f]", isActive);
        indicator.classList.toggle("bg-slate-200", !isActive);
        indicator.classList.toggle("scale-125", isActive);
      }
    });
  };
  const normalizePanelStep = (value = "") => String(value || "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const renderStep = () => {
    stepPanels.forEach((panel) => {
      const isCurrent = normalizePanelStep(panel.getAttribute("data-domino-duel-step-panel")) === currentStep;
      panel.classList.toggle("hidden", !isCurrent);
    });
    setSelectableState(modeButtons, selectedMode, "data-domino-duel-select-mode", "data-domino-duel-mode-indicator");
    setSelectableState(friendActionButtons, selectedFriendAction, "data-domino-duel-select-friend-action", "data-domino-duel-friend-indicator");
    const meta = STEP_META[currentStep] || STEP_META.mode;
    if (stepCopyEl) stepCopyEl.textContent = meta.copy;
    if (stepProgressEl) stepProgressEl.textContent = meta.progress;
    const publicEntryState = validatePublicEntry();
    const privateStakeState = validatePrivateStake();
    populateCreatedFriendRoom();
    if (nextBtn) {
      nextBtn.textContent = meta.nextLabel;
      const disabled = (currentStep === "mode" && !selectedMode)
        || (currentStep === "public" && !publicEntryState.canAfford)
        || (currentStep === "private" && !selectedFriendAction)
        || (currentStep === "privateShare" && (!createdFriendRoomState?.roomId || creatingFriendRoom))
        || (currentStep === "privateCreate" && (creatingFriendRoom || !privateStakeState.meetsMinimum || !privateStakeState.canAfford))
        || (currentStep === "privateJoin" && !normalizeInviteCode(joinCodeInput?.value || ""));
      nextBtn.disabled = disabled;
    }
    if (backBtn) backBtn.classList.toggle("hidden", !meta.showBack);
    privateStakeQuickButtons.forEach((button) => {
      const quickStake = normalizeStakeHtg(button.getAttribute("data-domino-duel-stake-quick"), 0);
      const isActive = quickStake === privateStakeHtg;
      button.classList.toggle("border-[#d7c09a]", isActive);
      button.classList.toggle("bg-[#fff4de]", isActive);
      button.classList.toggle("text-[#8a6330]", isActive);
      button.classList.toggle("border-[#dce5df]", !isActive);
      button.classList.toggle("bg-[#f7fbf8]", !isActive);
      button.classList.toggle("text-[#42524c]", !isActive);
    });
    if (currentStep === "privateJoin") window.setTimeout(() => joinCodeInput?.focus(), 30);
  };
  const handleJoin = () => {
    const inviteCode = normalizeInviteCode(joinCodeInput?.value || "");
    if (!inviteCode) {
      setJoinStatus("Mete kod salon prive a anvan ou kontinye.");
      joinCodeInput?.focus();
      return;
    }
    if (joinCodeInput) joinCodeInput.value = inviteCode;
    setJoinStatus("");
    launch({
      roomMode: "duel_v2_friends",
      friendAction: "join",
      inviteCode,
      stakeHtg: PUBLIC_DUEL_STAKE_HTG,
    });
  };
  const handleCreateFriendRoom = async () => {
    const stakeState = validatePrivateStake();
    if (!stakeState.meetsMinimum) {
      privateStakeInput?.reportValidity();
      privateStakeInput?.focus();
      renderStep();
      return;
    }
    if (!stakeState.canAfford || creatingFriendRoom) {
      renderStep();
      return;
    }

    creatingFriendRoom = true;
    createdFriendRoomState = null;
    setPrivateStakeStatus("M ap kreye salon prive a...");
    setShareStatus("M ap kreye salon prive a...");
    renderStep();
    try {
      const result = await createFriendDuelRoomV2Secure({ stakeHtg: privateStakeHtg });
      createdFriendRoomState = {
        roomId: String(result?.roomId || "").trim(),
        inviteCode: normalizeInviteCode(result?.inviteCode || ""),
        stakeHtg: normalizeStakeHtg(result?.stakeHtg, privateStakeHtg),
        resumed: result?.resumed === true,
      };
      currentStep = "privateShare";
      setShareStatus(
        createdFriendRoomState.resumed
          ? "Nou jwenn salon prive ou te deja genyen an. Ou ka pataje kod la oswa kontinye."
          : "Salon prive a pare. Pataje kod la ak zanmi ou avan ou antre nan paj la."
      );
      renderStep();
    } catch (error) {
      createdFriendRoomState = null;
      setShareStatus("");
      setPrivateStakeStatus(error?.message || "Nou pa rive kreye salon prive a.");
      renderStep();
    } finally {
      creatingFriendRoom = false;
      renderStep();
    }
  };
  const handleBack = () => {
    if (currentStep === "public" || currentStep === "private") {
      currentStep = "mode";
    } else if (currentStep === "privateCreate" || currentStep === "privateJoin") {
      currentStep = "private";
    } else {
      return;
    }
    renderStep();
  };
  const handleNext = async () => {
    if (currentStep === "mode") {
      if (!selectedMode) return;
      currentStep = selectedMode === "friend" ? "private" : "public";
      renderStep();
      return;
    }
    if (currentStep === "public") {
      const publicEntryState = validatePublicEntry();
      if (!publicEntryState.canAfford) {
        renderStep();
        return;
      }
      const canLaunch = await canLaunchPublicGame("domino-duel");
      if (!canLaunch) return;
      setJoinStatus("");
      launch({ stakeHtg: PUBLIC_DUEL_STAKE_HTG });
      return;
    }
    if (currentStep === "private") {
      if (!selectedFriendAction) return;
      currentStep = selectedFriendAction === "join" ? "privateJoin" : "privateCreate";
      renderStep();
      return;
    }
    if (currentStep === "privateCreate") {
      setJoinStatus("");
      void handleCreateFriendRoom();
      return;
    }
    if (currentStep === "privateShare") {
      if (!createdFriendRoomState?.roomId) {
        renderStep();
        return;
      }
      launch({
        roomMode: "duel_v2_friends",
        friendAction: "create",
        inviteCode: normalizeInviteCode(createdFriendRoomState.inviteCode || ""),
        roomId: String(createdFriendRoomState.roomId || "").trim(),
        stakeHtg: normalizeStakeHtg(createdFriendRoomState.stakeHtg, privateStakeHtg),
      });
      return;
    }
    if (currentStep === "privateJoin") {
      handleJoin();
    }
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector("[data-close-domino-duel-stake]")?.addEventListener("click", close);
  backBtn?.addEventListener("click", handleBack);
    nextBtn?.addEventListener("click", () => {
      void handleNext();
    });
  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedMode = button.getAttribute("data-domino-duel-select-mode") === "friend" ? "friend" : "public";
      if (selectedMode !== "friend") selectedFriendAction = "";
      setJoinStatus("");
      renderStep();
    });
  });
  friendActionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedFriendAction = button.getAttribute("data-domino-duel-select-friend-action") === "join" ? "join" : "create";
      setJoinStatus("");
      renderStep();
    });
  });
  joinCodeInput?.addEventListener("input", () => {
    const normalized = normalizeInviteCode(joinCodeInput.value || "");
    if (joinCodeInput.value !== normalized) joinCodeInput.value = normalized;
    setJoinStatus("");
    renderStep();
  });
  joinCodeInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handleJoin();
  });
  privateStakeInput?.addEventListener("input", () => {
    privateStakeHtg = normalizeStakeHtg(privateStakeInput.value, MIN_PRIVATE_DUEL_STAKE_HTG);
    setPrivateStakeStatus("");
    renderStep();
  });
  privateStakeInput?.addEventListener("blur", () => {
    validatePrivateStake();
    renderStep();
  });
  privateStakeQuickButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const quickStake = normalizeStakeHtg(button.getAttribute("data-domino-duel-stake-quick"), MIN_PRIVATE_DUEL_STAKE_HTG);
      privateStakeHtg = quickStake;
      if (privateStakeInput) {
        privateStakeInput.value = String(quickStake);
      }
      setPrivateStakeStatus("");
      renderStep();
    });
  });
  copyCodeBtn?.addEventListener("click", () => {
    void copyCreatedFriendCode();
  });

  dominoDuelStakeModal = {
    open() {
      overlay.classList.remove("hidden");
      overlay.classList.add("flex");
      document.body.classList.add("modal-open");
      currentStep = "mode";
      selectedMode = "";
      selectedFriendAction = "";
      privateStakeHtg = MIN_PRIVATE_DUEL_STAKE_HTG;
      createdFriendRoomState = null;
      creatingFriendRoom = false;
      setPublicStatus("");
      setJoinStatus("");
      setPrivateStakeStatus("");
      setShareStatus("");
      if (joinCodeInput) joinCodeInput.value = "";
      if (privateStakeInput) privateStakeInput.value = String(MIN_PRIVATE_DUEL_STAKE_HTG);
      renderStep();
      void refreshStakeValidation().then(() => {
        if (!overlay.classList.contains("hidden")) renderStep();
      });
    },
    close,
  };

  return dominoDuelStakeModal;
}

function ensureDameStakeModal() {
  if (dameStakeModal) return dameStakeModal;

  const PUBLIC_DAME_STAKE_HTG = DAME_PUBLIC_ENTRY_HTG;
  const MIN_PRIVATE_DAME_STAKE_HTG = 25;
  const HTG_TO_DOES_RATE = 20;

  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[4200] hidden items-end justify-center bg-black/55 px-4 py-6 backdrop-blur-sm sm:items-center";
  overlay.setAttribute("data-kobposh-dame-stake-modal", "");
  overlay.innerHTML = `
    <div class="w-full max-w-2xl overflow-hidden rounded-[36px] border border-white/40 bg-[linear-gradient(180deg,rgba(255,252,247,0.98)_0%,rgba(248,251,247,0.96)_100%)] shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
      <div class="border-b border-[#e7ece6] px-6 py-6 sm:px-8 sm:py-7">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6f7f76]">Dame</p>
            <h2 class="mt-2 text-[30px] font-black leading-tight text-[#18212b]">Dame 2 joueurs</h2>
            <p class="mt-3 max-w-xl text-sm leading-6 text-[#61706a]" data-dame-step-copy></p>
          </div>
          <div class="flex items-center gap-3">
            <span class="rounded-full border border-[#d6ebe0] bg-[#eef8f1] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#156437]" data-dame-step-progress>Etap 1/3</span>
            <button type="button" class="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[#dbe4dc] bg-white/90 text-slate-700 transition hover:bg-[#f6faf7]" data-close-dame-stake aria-label="Femen">
              <i data-lucide="x" class="icon" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div class="mt-5 flex flex-wrap gap-2">
          <span class="rounded-full border border-[#dbe4dc] bg-white px-3 py-1.5 text-xs font-semibold text-[#32423c]">Gran chanm: 25 HTG</span>
          <span class="rounded-full border border-[#dbe4dc] bg-white px-3 py-1.5 text-xs font-semibold text-[#32423c]">Salon prive: 25 HTG min</span>
          <span class="rounded-full border border-[#dbe4dc] bg-white px-3 py-1.5 text-xs font-semibold text-[#32423c]">2 joueurs</span>
        </div>
      </div>
      <div class="px-6 py-6 sm:px-8 sm:py-7">
        <div data-dame-step-panel="mode" class="space-y-4">
          <div>
            <h3 class="text-[24px] font-black text-[#18212b]">Chwazi kijan ou vle antre</h3>
            <p class="mt-2 text-sm leading-6 text-[#6b7871]">Nou montre yon sel desizyon pa etap pou kenbe eksperyans la senp.</p>
          </div>
          <button type="button" class="group w-full rounded-[28px] border border-[#dfe7e1] bg-white px-5 py-5 text-left transition duration-150 hover:border-[#cae5d5] hover:bg-[#f8fcf9]" data-dame-select-mode="public">
            <div class="flex items-start gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Piblik</p>
                <p class="mt-2 text-[22px] font-black text-[#18212b]">Gran chanm</p>
                <p class="mt-2 text-sm leading-6 text-[#697670]">Le sistem nan jwenn yon advese, pati a komanse otomatikman.</p>
              </div>
              <span class="mt-1 h-3.5 w-3.5 rounded-full bg-slate-200 transition" data-dame-mode-indicator="public"></span>
            </div>
          </button>
          <button type="button" class="group w-full rounded-[28px] border border-[#dfe7e1] bg-white px-5 py-5 text-left transition duration-150 hover:border-[#cae5d5] hover:bg-[#f8fcf9]" data-dame-select-mode="friend">
            <div class="flex items-start gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Entre amis</p>
                <p class="mt-2 text-[22px] font-black text-[#18212b]">Salon prive</p>
                <p class="mt-2 text-sm leading-6 text-[#697670]">Kreye yon salon oswa antre ak yon kod pou jwe ak yon zanmi.</p>
              </div>
              <span class="mt-1 h-3.5 w-3.5 rounded-full bg-slate-200 transition" data-dame-mode-indicator="friend"></span>
            </div>
          </button>
        </div>

        <div data-dame-step-panel="public" class="hidden space-y-4">
          <div class="rounded-[30px] border border-[#dcebe1] bg-[linear-gradient(180deg,#f5fcf7_0%,#eef8f1_100%)] px-5 py-5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border border-[#d6ebe0] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#156437]">Gran chanm</span>
              <span class="rounded-full border border-[#dce5df] bg-white px-3 py-1 text-[11px] font-semibold text-[#41514b]">25 HTG</span>
            </div>
            <h3 class="mt-4 text-[26px] font-black text-[#18212b]">Antre nan gran chanm nan</h3>
            <p class="mt-3 text-sm leading-6 text-[#5f6f67]">N ap chache yon lot jw pou yon pati Dame a 25 HTG. Lajan an pa soti avan match la jwenn 2 moun vre.</p>
          </div>
        </div>

        <div data-dame-step-panel="private" class="hidden space-y-4">
          <div>
            <h3 class="text-[24px] font-black text-[#18212b]">Chwazi aksyon salon prive a</h3>
            <p class="mt-2 text-sm leading-6 text-[#6b7871]">Ou ka swa kreye pwop salon ou, swa antre ak kod yon zanmi voye ba ou.</p>
          </div>
          <button type="button" class="group w-full rounded-[28px] border border-[#dfe7e1] bg-white px-5 py-5 text-left transition duration-150 hover:border-[#cae5d5] hover:bg-[#f8fcf9]" data-dame-select-friend-action="create">
            <div class="flex items-start gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Kreye</p>
                <p class="mt-2 text-[22px] font-black text-[#18212b]">Nouvo salon prive</p>
                <p class="mt-2 text-sm leading-6 text-[#697670]">Nou ap ba w yon kod pou pataje. Match la poko komanse ni pran lajan anvan 2e jw a antre.</p>
              </div>
              <span class="mt-1 h-3.5 w-3.5 rounded-full bg-slate-200 transition" data-dame-friend-indicator="create"></span>
            </div>
          </button>
          <button type="button" class="group w-full rounded-[28px] border border-[#dfe7e1] bg-white px-5 py-5 text-left transition duration-150 hover:border-[#cae5d5] hover:bg-[#f8fcf9]" data-dame-select-friend-action="join">
            <div class="flex items-start gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Antre</p>
                <p class="mt-2 text-[22px] font-black text-[#18212b]">Mwen gen yon kod</p>
                <p class="mt-2 text-sm leading-6 text-[#697670]">Mete kod zanmi ou voye a nan etap ki vini apre a.</p>
              </div>
              <span class="mt-1 h-3.5 w-3.5 rounded-full bg-slate-200 transition" data-dame-friend-indicator="join"></span>
            </div>
          </button>
        </div>

        <div data-dame-step-panel="private-create" class="hidden space-y-5">
          <div class="rounded-[30px] border border-[#ece1cf] bg-[linear-gradient(180deg,#fffaf2_0%,#fffdf8_100%)] px-5 py-5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border border-[#eed9b8] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8f6732]">Salon prive</span>
              <span class="rounded-full border border-[#eed9b8] bg-white px-3 py-1 text-[11px] font-semibold text-[#6b5430]">25 HTG min</span>
            </div>
            <h3 class="mt-4 text-[28px] font-black text-[#18212b]">Chwazi mise salon an</h3>
            <p class="mt-3 text-sm leading-6 text-[#6d6558]">Sa a se etap kote ou deside konbyen salon prive a vo. Le salon an pare, zanmi ou ap dwe gen menm kantite sa a sou kont li pou li antre.</p>
          </div>
          <div class="rounded-[30px] border border-[#dfe7e1] bg-white px-5 py-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
            <label class="block" for="damePrivateStakeInput">
              <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Miz salon an</span>
              <div class="mt-3 flex items-center gap-3 rounded-[24px] border border-[#dce5df] bg-[#f7fbf8] px-4 py-3">
                <input id="damePrivateStakeInput" type="number" inputmode="numeric" min="25" step="1" value="25" class="min-w-0 flex-1 border-0 bg-transparent text-[28px] font-black tracking-[-0.02em] text-[#18212b] outline-none" />
                <span class="rounded-full border border-[#dce5df] bg-white px-3 py-1 text-xs font-semibold text-[#50615a]">HTG</span>
              </div>
            </label>
            <div class="mt-4 flex flex-wrap gap-2">
              <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-dame-stake-quick="25">25 HTG</button>
              <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-dame-stake-quick="50">50 HTG</button>
              <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-dame-stake-quick="100">100 HTG</button>
              <button type="button" class="rounded-full border border-[#dce5df] bg-[#f7fbf8] px-3 py-1.5 text-xs font-semibold text-[#42524c]" data-dame-stake-quick="200">200 HTG</button>
            </div>
            <p class="mt-4 text-xs leading-5 text-[#6d7b74]">Se kantite sa a ni ou ni zanmi ou pral jwe a si nou antre nan menm salon an.</p>
            <p class="mt-3 min-h-[20px] text-sm font-medium text-[#c05b5b]" data-dame-private-stake-status></p>
          </div>
        </div>

        <div data-dame-step-panel="private-join" class="hidden space-y-5">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Kod prive</p>
            <h3 class="mt-2 text-[28px] font-black text-[#18212b]">Antre ak yon kod salon</h3>
            <p class="mt-2 text-sm leading-6 text-[#697670]">Mete kod zanmi ou voye a pou antre nan menm salon Dame a.</p>
          </div>
          <div class="rounded-[30px] border border-[#dfe7e1] bg-white px-5 py-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
            <label class="block">
              <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Kod salon an</span>
              <input type="text" inputmode="text" autocomplete="off" maxlength="12" placeholder="Egzanp: AB12CD" class="mt-3 w-full rounded-[22px] border border-[#dce5df] bg-[#f7fbf8] px-4 py-4 text-base font-semibold uppercase tracking-[0.24em] text-[#18212b] outline-none transition focus:border-[#1b6b3f]" data-dame-join-code>
            </label>
            <p class="mt-4 text-xs leading-5 text-[#6d7b74]">Nou pral verifye salon an ak menm kod sa a avan nou kite ou antre.</p>
            <p class="mt-3 min-h-[20px] text-sm font-medium text-[#c05b5b]" data-dame-join-status></p>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between gap-3 border-t border-[#e7ece6] px-6 py-5 sm:px-8">
        <button type="button" class="hidden rounded-full border border-[#dce5df] bg-white px-5 py-3 text-sm font-semibold text-[#42524c] transition hover:bg-[#f7fbf8]" data-dame-step-back>
          Retounen
        </button>
        <button type="button" class="ml-auto rounded-full border border-[#1b6b3f] bg-[#1b6b3f] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[#15542f] disabled:cursor-not-allowed disabled:opacity-45" data-dame-step-next>
          Suivant
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  renderIconsSafely();

  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    document.body.classList.remove("modal-open");
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  const stepCopyEl = overlay.querySelector("[data-dame-step-copy]");
  const stepProgressEl = overlay.querySelector("[data-dame-step-progress]");
  const backBtn = overlay.querySelector("[data-dame-step-back]");
  const nextBtn = overlay.querySelector("[data-dame-step-next]");
  const stepPanels = Array.from(overlay.querySelectorAll("[data-dame-step-panel]"));
  const modeButtons = Array.from(overlay.querySelectorAll("[data-dame-select-mode]"));
  const friendActionButtons = Array.from(overlay.querySelectorAll("[data-dame-select-friend-action]"));
  const joinCodeInput = overlay.querySelector("[data-dame-join-code]");
  const joinStatusEl = overlay.querySelector("[data-dame-join-status]");
  const privateStakeInput = overlay.querySelector("#damePrivateStakeInput");
  const privateStakeStatusEl = overlay.querySelector("[data-dame-private-stake-status]");
  const privateStakeQuickButtons = Array.from(overlay.querySelectorAll("[data-dame-stake-quick]"));
  const normalizeInviteCode = (value = "") => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
  const normalizeStakeHtg = (value, fallback = MIN_PRIVATE_DAME_STAKE_HTG) => {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  };
  let privateStakeHtg = MIN_PRIVATE_DAME_STAKE_HTG;
  const STEP_META = {
    mode: {
      progress: "Etap 1/3",
      copy: "",
      nextLabel: "Suivant",
      showBack: false,
    },
    public: {
      progress: "Etap 2/2",
      copy: "",
      nextLabel: "Antre nan gran chanm nan",
      showBack: true,
    },
    private: {
      progress: "Etap 2/3",
      copy: "Koulye a chwazi ki jan ou vle antre nan salon prive a.",
      nextLabel: "Suivant",
      showBack: true,
    },
    privateCreate: {
      progress: "Etap 3/3",
      copy: "Denye etap la se konfime kreyasyon salon prive a.",
      nextLabel: "Kreye salon prive a",
      showBack: true,
    },
    privateJoin: {
      progress: "Etap 3/3",
      copy: "Denye etap la se antre kod salon an.",
      nextLabel: "Antre nan salon an",
      showBack: true,
    },
  };
  let currentStep = "mode";
  let selectedMode = "";
  let selectedFriendAction = "";
  const buildDameUrl = ({ roomMode = "", friendAction = "", inviteCode = "", stakeHtg = PUBLIC_DAME_STAKE_HTG } = {}) => {
    const safeStakeHtg = Math.max(0, normalizeStakeHtg(stakeHtg, PUBLIC_DAME_STAKE_HTG));
    const params = new URLSearchParams({
      stake: String(safeStakeHtg * HTG_TO_DOES_RATE),
      fundingCurrency: "htg",
      stakeHtg: String(safeStakeHtg),
    });
    if (roomMode) params.set("roomMode", roomMode);
    if (friendAction) params.set("friendAction", friendAction);
    if (inviteCode) params.set("inviteCode", inviteCode);
    return `./dame.html?${params.toString()}`;
  };
  const launch = (options = {}) => {
    close();
    window.location.href = buildDameUrl(options);
  };
  const setJoinStatus = (message = "") => {
    if (joinStatusEl) joinStatusEl.textContent = String(message || "");
  };
  const setPrivateStakeStatus = (message = "") => {
    if (privateStakeStatusEl) privateStakeStatusEl.textContent = String(message || "");
  };
  const validatePrivateStake = ({ allowRefresh = false } = {}) => {
    privateStakeHtg = normalizeStakeHtg(privateStakeInput?.value, MIN_PRIVATE_DAME_STAKE_HTG);
    if (privateStakeInput) {
      privateStakeInput.value = String(privateStakeHtg || "");
    }
    const balance = getCurrentHomeWalletTotalHtg();
    const meetsMinimum = privateStakeHtg >= MIN_PRIVATE_DAME_STAKE_HTG;
    const canAfford = balance >= privateStakeHtg;
    if (privateStakeInput) {
      privateStakeInput.setAttribute("aria-invalid", meetsMinimum ? "false" : "true");
      privateStakeInput.setCustomValidity(
        meetsMinimum ? "" : `Mete omwen ${MIN_PRIVATE_DAME_STAKE_HTG} HTG pou salon prive a.`
      );
    }
    if (!meetsMinimum) {
      setPrivateStakeStatus(`Miz la pa ka desann anba ${MIN_PRIVATE_DAME_STAKE_HTG} HTG.`);
    } else if (!canAfford) {
      const missing = Math.max(0, privateStakeHtg - balance);
      setPrivateStakeStatus(`Ou bezwen ${missing} HTG anplis pou kreye salon sa a.`);
    } else {
      setPrivateStakeStatus("");
    }
    return { meetsMinimum, canAfford, balance };
  };
  const refreshPrivateStakeValidation = async () => {
    try {
      const uid = String(auth.currentUser?.uid || "").trim();
      if (uid) {
        await ensureXchangeState(uid);
      }
    } catch (_) {
    }
    return validatePrivateStake();
  };
  const setSelectableState = (buttons, selectedValue, attributeName, indicatorName) => {
    buttons.forEach((button) => {
      const isActive = button.getAttribute(attributeName) === selectedValue;
      button.classList.toggle("border-[#1b6b3f]", isActive);
      button.classList.toggle("bg-emerald-50", isActive);
      button.classList.toggle("shadow-[0_14px_34px_rgba(16,185,129,0.12)]", isActive);
      button.classList.toggle("border-slate-200", !isActive);
      button.classList.toggle("bg-slate-50", !isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      const indicator = button.querySelector(`[${indicatorName}]`);
      if (indicator) {
        indicator.classList.toggle("bg-[#1b6b3f]", isActive);
        indicator.classList.toggle("bg-slate-200", !isActive);
        indicator.classList.toggle("scale-125", isActive);
      }
    });
  };
  const normalizePanelStep = (value = "") => String(value || "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const renderStep = () => {
    stepPanels.forEach((panel) => {
      const isCurrent = normalizePanelStep(panel.getAttribute("data-dame-step-panel")) === currentStep;
      panel.classList.toggle("hidden", !isCurrent);
    });
    setSelectableState(modeButtons, selectedMode, "data-dame-select-mode", "data-dame-mode-indicator");
    setSelectableState(friendActionButtons, selectedFriendAction, "data-dame-select-friend-action", "data-dame-friend-indicator");
    const meta = STEP_META[currentStep] || STEP_META.mode;
    if (stepCopyEl) stepCopyEl.textContent = meta.copy;
    if (stepProgressEl) stepProgressEl.textContent = meta.progress;
    const privateStakeState = validatePrivateStake();
    if (nextBtn) {
      nextBtn.textContent = meta.nextLabel;
      const disabled = (currentStep === "mode" && !selectedMode)
        || (currentStep === "private" && !selectedFriendAction)
        || (currentStep === "privateCreate" && (!privateStakeState.meetsMinimum || !privateStakeState.canAfford))
        || (currentStep === "privateJoin" && !normalizeInviteCode(joinCodeInput?.value || ""));
      nextBtn.disabled = disabled;
    }
    if (backBtn) {
      backBtn.classList.toggle("hidden", !meta.showBack);
    }
    privateStakeQuickButtons.forEach((button) => {
      const quickStake = normalizeStakeHtg(button.getAttribute("data-dame-stake-quick"), 0);
      const isActive = quickStake === privateStakeHtg;
      button.classList.toggle("border-[#d7c09a]", isActive);
      button.classList.toggle("bg-[#fff4de]", isActive);
      button.classList.toggle("text-[#8a6330]", isActive);
      button.classList.toggle("border-[#dce5df]", !isActive);
      button.classList.toggle("bg-[#f7fbf8]", !isActive);
      button.classList.toggle("text-[#42524c]", !isActive);
    });
    if (currentStep === "privateJoin") {
      window.setTimeout(() => joinCodeInput?.focus(), 30);
    }
  };
  const handleJoinFriendRoom = () => {
    const inviteCode = normalizeInviteCode(joinCodeInput?.value || "");
    if (!inviteCode) {
      setJoinStatus("Mete kod salon prive a anvan ou kontinye.");
      joinCodeInput?.focus();
      return;
    }
    if (joinCodeInput) {
      joinCodeInput.value = inviteCode;
    }
    setJoinStatus("");
    launch({
      roomMode: "dame_friends",
      friendAction: "join",
      inviteCode,
    });
  };
  const handleBack = () => {
    if (currentStep === "public" || currentStep === "private") {
      currentStep = "mode";
    } else if (currentStep === "privateCreate" || currentStep === "privateJoin") {
      currentStep = "private";
    } else {
      return;
    }
    renderStep();
  };
  const handleNext = () => {
    if (currentStep === "mode") {
      if (!selectedMode) return;
      currentStep = selectedMode === "friend" ? "private" : "public";
      renderStep();
      return;
    }
    if (currentStep === "public") {
      setJoinStatus("");
      launch({ stakeHtg: PUBLIC_DAME_STAKE_HTG });
      return;
    }
    if (currentStep === "private") {
      if (!selectedFriendAction) return;
      currentStep = selectedFriendAction === "join" ? "privateJoin" : "privateCreate";
      renderStep();
      return;
    }
    if (currentStep === "privateCreate") {
      const stakeState = validatePrivateStake();
      if (!stakeState.meetsMinimum) {
        privateStakeInput?.reportValidity();
        privateStakeInput?.focus();
        renderStep();
        return;
      }
      if (!stakeState.canAfford) {
        renderStep();
        return;
      }
      setJoinStatus("");
      setPrivateStakeStatus("");
      launch({
        roomMode: "dame_friends",
        friendAction: "create",
        stakeHtg: privateStakeHtg,
      });
      return;
    }
    if (currentStep === "privateJoin") {
      handleJoinFriendRoom();
    }
  };

  overlay.querySelector("[data-close-dame-stake]")?.addEventListener("click", close);
  backBtn?.addEventListener("click", handleBack);
  nextBtn?.addEventListener("click", handleNext);
  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedMode = button.getAttribute("data-dame-select-mode") === "friend" ? "friend" : "public";
      if (selectedMode !== "friend") {
        selectedFriendAction = "";
      }
      setJoinStatus("");
      renderStep();
    });
  });
  friendActionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedFriendAction = button.getAttribute("data-dame-select-friend-action") === "join" ? "join" : "create";
      setJoinStatus("");
      renderStep();
    });
  });
  joinCodeInput?.addEventListener("input", () => {
    const normalized = normalizeInviteCode(joinCodeInput.value || "");
    if (joinCodeInput.value !== normalized) {
      joinCodeInput.value = normalized;
    }
    setJoinStatus("");
    renderStep();
  });
  joinCodeInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handleJoinFriendRoom();
  });
  privateStakeInput?.addEventListener("input", () => {
    privateStakeHtg = normalizeStakeHtg(privateStakeInput.value, MIN_PRIVATE_DAME_STAKE_HTG);
    setPrivateStakeStatus("");
    renderStep();
  });
  privateStakeInput?.addEventListener("blur", () => {
    validatePrivateStake();
    renderStep();
  });
  privateStakeQuickButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const quickStake = normalizeStakeHtg(button.getAttribute("data-dame-stake-quick"), MIN_PRIVATE_DAME_STAKE_HTG);
      privateStakeHtg = quickStake;
      if (privateStakeInput) {
        privateStakeInput.value = String(quickStake);
      }
      setPrivateStakeStatus("");
      renderStep();
    });
  });

  dameStakeModal = {
    open() {
      const currentBalanceHtg = getCurrentHomeWalletTotalHtg();
      if (currentBalanceHtg < PUBLIC_DAME_STAKE_HTG) {
        openDameBlockedModal(PUBLIC_DAME_STAKE_HTG, currentBalanceHtg);
        return;
      }
      overlay.classList.remove("hidden");
      overlay.classList.add("flex");
      document.body.classList.add("modal-open");
      currentStep = "mode";
      selectedMode = "";
      selectedFriendAction = "";
      privateStakeHtg = MIN_PRIVATE_DAME_STAKE_HTG;
      setJoinStatus("");
      setPrivateStakeStatus("");
      if (joinCodeInput) {
        joinCodeInput.value = "";
      }
      if (privateStakeInput) {
        privateStakeInput.value = String(MIN_PRIVATE_DAME_STAKE_HTG);
      }
      renderStep();
      void refreshPrivateStakeValidation().then(() => {
        if (!overlay.classList.contains("hidden")) renderStep();
      });
    },
    close,
  };

  return dameStakeModal;
}

const SUPPORT_HELP_TOPICS = [
  {
    key: "create-account",
    icon: "user-round",
    label: "Koman poum kreye on kont",
    title: "Koman pou kreye yon kont",
    targets: ["Si w pa gen kont, kreye youn la", "Username", "Numero", "Modpas", "Verifye modpas", "Kreye kont"],
    body: [
      "Le ekran koneksyon an louvri, peze sou Si w pa gen kont, kreye youn la pou chanje mòd la.",
      "Nan chan Username, ekri non itilizate ou vle itilize sou sit la.",
      "Nan chan Numero, mete nimewo telefonn ou nan fom 509...",
      "Mete modpas ou, epi remete li nan Verifye modpas pou konfime li.",
      "Koche bwat ki mande w konfime laj ak kondisyon yo si yo parèt, epi peze Kreye kont.",
      "Apre kont la fin kreye, sit la ap konekte w epi li ap mennen w sou paj dakey la.",
    ],
  },
  {
    key: "login-account",
    icon: "house",
    label: "Koman poum konektem",
    title: "Koman pou konekte sou kont ou",
    targets: ["Username oswa email", "Modpas", "Konekte"],
    body: [
      "Le ekran koneksyon an louvri, rete sou premye mòd la ki montre bouton Konekte.",
      "Nan chan Username oswa email, ekri username ou oswa email kont ou.",
      "Nan chan Modpas, antre modpas kont ou. Ou ka peze icon je a si w bezwen verifye sa w tape a.",
      "Peze bouton Konekte pou antre sou kont ou.",
      "Si modpas la pa mache, peze lyen rekiperasyon an pou kontakte yon ajan epi rekipere kont la.",
    ],
  },
  {
    key: "change-password",
    icon: "eye",
    label: "Kijan poum chanje modpass mwn",
    title: "Kijan pou chanje modpas ou",
    targets: ["Profil", "CHANGER MOT DE PASSE", "ANSYEN MODPAS", "NOUVO MODPAS", "KONFIME MODPAS", "Mete ajou"],
    body: [
      "Depi sou paj dakey la, ale nan Profil ou.",
      "Nan paj Profil la, chache bouton CHANGER MOT DE PASSE epi peze li.",
      "Nan modal la, antre ansyen modpas ou nan ANSYEN MODPAS.",
      "Apre sa, mete nouvo modpas ou nan NOUVO MODPAS epi remete li nan KONFIME MODPAS.",
      "Peze Mete ajou pou anrejistre chanjman an. Si ansyen modpas la pa bon, sit la ap montre w mesaj erè a.",
    ],
  },
  {
    key: "forgot-password",
    icon: "message-circle",
    label: "Kissa poum fe lem blye modpass mwn",
    title: "Kisa pou fe le ou bliye modpas ou",
    targets: ["Mwn blye modpass mwn", "Kontakte yon ajan"],
    body: [
      "Sou ekran koneksyon an, peze lyen Mwn blye modpass mwn ki anba bouton koneksyon an.",
      "Sit la ap louvri modal rekiperasyon kont la pou ede w jwenn asistans rapid.",
      "Nan modal sa a, peze bouton Kontakte yon ajan pou pale sou WhatsApp ak sipò a.",
      "Bay ajan an bon enfomasyon sou kont ou pou li ka verifye epi ede w reprann aksè a.",
    ],
  },
  {
    key: "install-app",
    icon: "house",
    label: "Kijan poum installe app la sou telephone mwn",
    title: "Kijan pou enstale app Kobposh la sou telefon ou",
    targets: ["Kobposh app", "Enstale kounye a", "Add to Home Screen"],
    body: [
      "Sou Kobposh V2, yon modal enstalasyon app ka parèt otomatikman pou pwopoze w mete sit la tankou yon app sou telefon ou.",
      "Si ou sou Android oswa yon navigatè ki sipòte li, peze Enstale kounye a le modal Kobposh app la parèt.",
      "Si ou sou iPhone, louvri meni pataj Safari a epi chwazi Add to Home Screen oswa Ajouter sur l'ecran d'accueil.",
      "Apre sa, konfime aksyon an pou mete Kobposh sou ekran prensipal telefon ou.",
      "Le sa fini, ou ka louvri Kobposh tankou yon app san ou pa bezwen chache li chak fwa nan navigatè a.",
    ],
  },
  {
    key: "depo",
    icon: "wallet",
    label: "Kijan poum voye lajan sou kont mwen",
    title: "Kijan pou voye lajan sou kont ou",
    targets: ["Depo imedya", "Montan depo (HTG)", "Kontinye nan peman an"],
    body: [
      "Nan paj dakey la, chache bouton Depo imedya epi peze li.",
      "Nan modal depo a, nan chan Montan depo (HTG), ekri kantite a oswa peze youn nan chips yo ki disponib sou ekran an.",
      "Tcheke liy total la, epi peze bouton Kontinye nan peman an.",
      "Swiv etap peman an jouk demann nan ale. Si depo a antre an atant, li ap parèt nan HTG an atant anwo a.",
      "Le admin nan apwouve depo a, montan an ap pase nan HTG apwouve.",
    ],
  },
  {
    key: "retre",
    icon: "arrow-up-right",
    label: "Kijan poum retire lajan sou kont mwen",
    title: "Kijan pou retire lajan sou kont ou",
    targets: ["Retre rapid", "Chwazi metod", "Konfime retre a"],
    body: [
      "Nan paj dakey la, peze sou Retre rapid.",
      "Le modal retrait la louvri, chwazi metòd ou vle a epi peze Suivant.",
      "Nan pwochen etap la, mete kantite a, prenon an, non an ak nimewo kote ou vle resevwa lajan an.",
      "Verifye tout enfomasyon yo byen ekri, epi peze Soumettre pou voye demann nan.",
      "Apre sa, tann desizyon an. Sit la ap montre w si retrait la reyisi oswa li echwe.",
    ],
  },
  {
    key: "game-history",
    icon: "history",
    label: "Kijan poum we istorik jwet mwn jwe yo",
    title: "Kijan pou we istorik jwet ou yo",
    targets: ["Istwa jwet ou yo", "Profil", "Historik"],
    body: [
      "Sou paj dakey la, peze sou bouton oswa zon ki louvri Istwa jwet ou yo si li parèt sou ekran an.",
      "Si w sou profil la, peze sou onglet oswa seksyon Historik la pou antre nan pati istorik yo.",
      "Nan istorik jwet la, w ap we pati ou te jwe yo ak rezilta tankou genyen oswa pedi.",
      "Si ou pa we denye pati a touswit, rafrechi paj la oswa retounen sou historik la apre kek segond.",
    ],
  },
  {
    key: "deposit-history",
    icon: "arrow-down-to-line",
    label: "Kijan poum we istorik depot",
    title: "Kijan pou we istorik depo",
    targets: ["Profil", "Historik", "Depo"],
    body: [
      "Depi sou paj dakey la, antre sou Profil ou.",
      "Louvri seksyon Historik la pou jwenn tout mouvman kont ou yo.",
      "Nan pati Depo a, w ap we lis demand depo yo ak eta yo tankou pending, approved oswa rejected.",
      "Si yon depo fenk fet, li ka pran kek segond anvan li parèt nan lis la.",
    ],
  },
  {
    key: "withdrawal-history",
    icon: "send",
    label: "Kijan poum we istorik retre",
    title: "Kijan pou we istorik retrait",
    targets: ["Profil", "Historik", "Retre"],
    body: [
      "Depi sou paj dakey la, peze pou ale sou Profil ou.",
      "Nan Profil la, antre nan seksyon Historik la.",
      "Chache pati Retre a pou we tout demann retrait ou yo ak desizyon yo.",
      "Le yon retrait apwouve oswa rejte, li dwe parèt nan lis sa a ansanm ak dènye eta li.",
    ],
  },
  {
    key: "ongoing-operations",
    icon: "history",
    label: "Kijan poum we operetion en cour yo",
    title: "Kijan pou we operasyon an kou yo",
    targets: ["Profil", "Historik", "OPERATIONS EN COURS"],
    body: [
      "Ale sou Profil ou depi paj dakey la.",
      "Louvri seksyon Historik la kote plizye blok enfomasyon parèt.",
      "Nan blok OPERATIONS EN COURS la, w ap we operasyon ki poko fini tankou demann ki toujou ap tann tretman.",
      "Le operasyon an fini, li soti nan blok sa a epi li antre nan istorik final ki koresponn lan.",
    ],
  },
  {
    key: "pending-balance",
    icon: "wallet",
    label: "Poukissa solde mwn en attente",
    title: "Poukisa solde ou an atant",
    targets: ["HTG an atant", "Depo imedya"],
    body: [
      "Le ou fe yon depo epi admin nan poko valide li, kob la antre nan HTG an atant.",
      "Sa vle di demann depo a rive sou sit la, men li poko pase nan HTG apwouve.",
      "Sou KobPoch V2 a, HTG an atant la ka deja sevi pou jwe pandan admin nan ap trete demann nan.",
      "Le depo a apwouve, kantite ki rete a pase nan solde apwouve. Si ou te deja jwe ak yon pati ladan li, se kantite ki rete a ki suiv eta a.",
    ],
  },
  {
    key: "pending-rejected",
    icon: "message-circle",
    label: "Sa kap passe si solde en attente mwn yo refuse",
    title: "Sa k ap pase si solde an atant ou rejte",
    targets: ["HTG an atant", "Kontakte agent an"],
    body: [
      "Si yon demann depo an atant rejte, sa vle di admin nan jwenn yon pwoblem sou peman an oswa sou verifikasyon an.",
      "Si se yon depo ou poko itilize, li pap pase nan HTG apwouve.",
      "Si ou te deja jwe ak HTG an atant sa a epi demann nan rejte, kont ou ka antre nan blokaj oswa sispansyon pou ajan an verifye sa ak ou.",
      "Nan ka sa a, sit la ka montre w yon modal ki mande w kontakte yon agent pou deboke kont ou.",
      "Pi bon aksyon an se peze bouton kontak la epi pale ak ajan an touswit pou rezoud dosye a.",
    ],
  },
  {
    key: "cannot-play",
    icon: "message-circle",
    label: "Poukissa m paka jwe",
    title: "Poukisa ou pa ka jwe sou Kobposh",
    targets: ["Konekte", "HTG apwouve", "HTG an atant", "Kontakte agent an"],
    body: [
      "Premye koz la se si ou pa konekte sou kont ou. Anpil jwèt mande pou w konekte avan yo kite w antre.",
      "Ou ka pa gen ase lajan disponib pou kouvri mise jwèt la. Gade si HTG apwouve ou oswa HTG an atant ou sifi pou kantite jwèt la mande a.",
      "Si kont ou sispann apre yon depo rejte oswa yon pwoblem verifikasyon, sit la ka bloke jwèt yo jouk yon agent deboke kont ou.",
      "Gen jwèt oswa branch ki poko louvri sou V2 la. Pa egzanp, si yon branch make Bientot oswa li pa aktif, ou pap ka antre ladan li.",
      "Si koneksyon entènèt ou pa bon, jwèt la ka pa chaje, li ka pa jwenn sal la, oswa li ka lage w anvan match la komanse.",
      "Nan jwèt piblik yo, pafwa ou ka jis ap tann yon lòt jwè. Sa pa toujou vle di jwèt la an pann, men li ka pran tan pou yon sal ranpli.",
      "Si ou te kite yon sal oswa yon ansyen sesyon rete an konfli, jwèt la ka mande yon rafrechisman oswa yon nouvo eseye pou li reprann pwopman.",
      "Si apre tout sa ou toujou pa ka jwe, pi bon bagay la se kontakte yon agent pou verifye kont ou oswa jwèt la ak ou.",
    ],
  },
  {
    key: "cannot-withdraw",
    icon: "arrow-up-right",
    label: "Poukissa m paka fe retre",
    title: "Poukisa ou pa ka fe retre sou Kobposh",
    targets: ["Retre rapid", "HTG apwouve", "HTG an atant", "Kontakte agent an"],
    body: [
      "Premye koz la se si ou pa gen ase HTG apwouve sou kont ou. Retre pa soti nan HTG an atant, li soti nan solde ki deja apwouve.",
      "Si ou gen yon depo an atant oswa yon pwoblem verifikasyon sou kont ou, gen ka kote retre a ka rete bloke jouk dosye a regle.",
      "Si kont ou sou sispansyon, sou withdrawal hold, oswa admin nan bloke li apre yon pwoblem depo, ou pap ka soumet yon retre.",
      "Si ou deja gen yon demann retre kap tann tretman, li ka pi bon tann li fini avan ou eseye fe yon lot selon eta kont lan.",
      "Si metòd la pa byen chwazi oswa enfomasyon tankou non, prenon, nimewo ak montan an pa konple, sit la ka pa kite w kontinye.",
      "Gen ka tou kote pwoblem koneksyon oswa chajman ka anpeche modal retre a fini voye demann nan.",
      "Si ou verifye tout sa yo epi sa pa mache toujou, kontakte yon agent pou li tcheke blokaj oswa eta retre a sou kont ou.",
    ],
  },
  {
    key: "invite-friend-room",
    icon: "users",
    label: "Kijan poum invite on moun jwe nan on salle",
    title: "Kijan pou envite yon moun jwe nan yon sal prive",
    targets: ["Kat MOPYON", "Jwe ak yon ami", "Chanm prive"],
    body: [
      "Sou paj dakey la, peze sou kat MOPYON pou antre nan chwa mòd jwèt la.",
      "Nan modal Mopyon an, chwazi opsyon Jwe ak yon ami pou lanse yon sal prive olye de matchmaking piblik la.",
      "Le sal prive a fin kreye, pataje envitasyon an oswa lyen sal la ak moun ou vle jwe avè l la.",
      "Lot moun nan dwe louvri envitasyon an pou antre nan menm sal prive a sou Kobposh.",
      "Le nou toude antre nan sal la, pati a ap pare epi l ap komanse sou menm lojik Morpion prive sit la deja itilize.",
    ],
  },
  {
    key: "mopyon",
    icon: "gamepad-2",
    label: "Kijan poum jwe mopyon",
    title: "Kijan pou jwe Mopyon",
    targets: ["Kat MOPYON", "Chips HTG", "Kontinye nan jwet la", "Jwe ak yon ami"],
    body: [
      "Sou paj dakey la, peze sou kat MOPYON.",
      "Nan modal la, chwazi kantite HTG a nan chips yo.",
      "Peze bouton Kontinye nan jwet la pou antre nan sal piblik la.",
      "Si w vle jwe ak yon moun ou konnen, peze Jwe ak yon ami epi swiv envitasyon sal prive a.",
      "Tann lot jwè a antre, epi jwet la ap komanse otomatikman.",
    ],
  },
  {
    key: "domino",
    icon: "landmark",
    label: "Kijan poum jwe domino",
    title: "Kijan pou jwe Domino",
    targets: ["Kat DOMINO", "Domino duel", "Live"],
    body: [
      "Sou paj dakey la, peze sou kat DOMINO.",
      "Nan modal Domino a, peze sou kat Domino duel, paske se branch sa a ki aktif kounye a nan V2 la.",
      "Apre sa, sit la ap louvri paj Duel la pou voye w nan eksperyans Domino ki disponib la.",
      "Branch Domino classique la poko louvri, se sak fe li make Bientot nan modal la.",
    ],
  },
  {
    key: "pong",
    icon: "circle",
    label: "Kijan poum jwe pong",
    title: "Kijan pou jwe Pong",
    targets: ["Kat PONG", "Chips HTG", "Kontinye nan jwet la"],
    body: [
      "Sou paj dakey la, peze sou kat PONG.",
      "Chwazi kantite HTG ou vle jwe a nan modal ki parèt la.",
      "Peze Kontinye nan jwet la pou komanse match la.",
      "Tann match la chaje, epi jwe jouk li fini.",
      "Le match la fini, sit la ap montre rezilta a epi li ka mete balans ou ajou.",
    ],
  },
  {
    key: "transfer",
    icon: "users",
    label: "Kijan poum voye HTG bay yon zanmi",
    title: "Kijan pou voye HTG bay yon zanmi",
    targets: ["Transfer zanmi", "Chache username", "Suivant", "Montan HTG"],
    body: [
      "Sou paj dakey la, peze sou Transfer zanmi.",
      "Chache username zanmi a epi peze Suivant.",
      "Chwazi bon itilizate a nan lis la epi peze Suivant.",
      "Mete kantite HTG ou vle voye a, epi konfime transfer la.",
      "Si ou gen HTG an atant sou kont ou, transfer la ka rete bloke jouk HTG sa yo regle.",
    ],
  },
];

const SUPPORT_HELP_ACTION_TRANSITION_MS = 220;

function buildSupportProfileUrl({ panel = "info", historySection = "", modal = "", agentMode = "" } = {}) {
  const params = new URLSearchParams();
  const safePanel = String(panel || "info").trim().toLowerCase();
  if (safePanel === "history" || safePanel === "agents") {
    params.set("panel", safePanel);
  } else {
    params.set("panel", "info");
  }

  const safeHistorySection = String(historySection || "").trim().toLowerCase();
  if (safeHistorySection === "pending" || safeHistorySection === "deposit" || safeHistorySection === "withdrawal") {
    params.set("historySection", safeHistorySection);
  }

  const safeModal = String(modal || "").trim().toLowerCase();
  if (safeModal === "transfer" || safeModal === "password") {
    params.set("modal", safeModal);
  }

  const safeAgentMode = String(agentMode || "").trim().toLowerCase();
  if (safeAgentMode === "deposit" || safeAgentMode === "withdrawal") {
    params.set("agentMode", safeAgentMode);
  }

  return `./profile.html?${params.toString()}`;
}

function getSupportTopicActionConfig(topicKey = "") {
  const normalized = String(topicKey || "").trim().toLowerCase();
  switch (normalized) {
    case "create-account":
      return {
        label: "Ale sou kreye kont",
        type: "callback",
        run: () => openAuthScreen("signup"),
      };
    case "login-account":
      return {
        label: "Ale sou koneksyon",
        type: "callback",
        run: () => openAuthScreen("login"),
      };
    case "change-password":
      return {
        label: "Ale chanje modpas la",
        type: "navigate",
        href: buildSupportProfileUrl({ panel: "info", modal: "password" }),
      };
    case "forgot-password":
      return {
        label: "Ouvri rekiperasyon kont la",
        type: "callback",
        run: () => openForgotPasswordModal(),
      };
    case "install-app":
      return {
        label: "Ouvri modal enstalasyon app la",
        type: "callback",
        run: () => openPwaInstallModal(true),
      };
    case "depo":
      return {
        label: "Ouvri depo a",
        type: "callback",
        run: () => {
          const trigger = openDepositModalBtns[0] || null;
          if (trigger instanceof HTMLElement) {
            trigger.click();
            return;
          }
          if (!auth.currentUser) {
            openAuthScreen("login");
            return;
          }
          openDepositModal();
        },
      };
    case "retre":
      return {
        label: "Ouvri retre a",
        type: "callback",
        run: () => {
          const trigger = document.getElementById("kobposhWithdrawalBtn");
          if (trigger instanceof HTMLElement) {
            trigger.click();
            return;
          }
          if (!auth.currentUser) {
            openAuthScreen("login");
          }
        },
      };
    case "game-history":
      return {
        label: "Ouvri istorik jwet la",
        type: "callback",
        run: () => openHistoryModal(),
      };
    case "deposit-history":
      return {
        label: "Ale sou istorik depo yo",
        type: "navigate",
        href: buildSupportProfileUrl({ panel: "history", historySection: "deposit" }),
      };
    case "withdrawal-history":
      return {
        label: "Ale sou istorik retre yo",
        type: "navigate",
        href: buildSupportProfileUrl({ panel: "history", historySection: "withdrawal" }),
      };
    case "ongoing-operations":
      return {
        label: "Ale sou operasyon an kou yo",
        type: "navigate",
        href: buildSupportProfileUrl({ panel: "history", historySection: "pending" }),
      };
    case "pending-balance":
      return {
        label: "We modal HTG an atant la",
        type: "callback",
        run: () => {
          const modal = ensurePendingHeaderBalanceInfoModal();
          const pendingAmount = Math.max(0, Math.trunc(Number(balanceEl?.dataset.pendingHtgAmount || latestHomeClientData?.provisionalHtgAvailable || latestHomeFundingData?.provisionalHtgAvailable || 0)));
          if (typeof modal?.__openPendingBalanceInfo === "function") {
            modal.__openPendingBalanceInfo(pendingAmount);
          }
        },
      };
    case "pending-rejected":
      return {
        label: "Kontakte agent an",
        type: "callback",
        run: () => openHomeAgentHelpModal(),
      };
    case "cannot-play":
      return {
        label: "Mwen bezwen yon agent",
        type: "callback",
        run: () => openHomeAgentHelpModal(),
      };
    case "cannot-withdraw":
      return {
        label: "Mwen bezwen yon agent retre",
        type: "callback",
        run: () => openHomeAgentHelpModal(),
      };
    case "invite-friend-room":
      return {
        label: "Ale sou Mopyon prive",
        type: "navigate",
        href: "./morpion.html?engine=v2&fundingCurrency=htg&stakeHtg=25",
      };
    case "mopyon":
      return {
        label: "Ouvri Mopyon",
        type: "navigate",
        href: "./morpion.html?engine=v2&fundingCurrency=htg&stakeHtg=25",
      };
    case "domino":
      return {
        label: "Ouvri Domino",
        type: "callback",
        run: () => ensureDominoModeModal().open(),
      };
    case "pong":
      return {
        label: "Ouvri Pong",
        type: "callback",
        run: () => launchPongEntry(),
      };
    case "transfer":
      return {
        label: "Ouvri transfer zanmi",
        type: "callback",
        run: () => openTransferFriendFlow(),
      };
    default:
      return null;
  }
}

function runSupportHelpTopicAction(topicKey = "") {
  const action = getSupportTopicActionConfig(topicKey);
  if (!action) return;

  const modal = ensureSupportHelpModal();
  const isNavigation = action.type === "navigate" && typeof action.href === "string" && action.href.trim().length > 0;
  modal.classList.add("is-transitioning");
  if (isNavigation) {
    document.body.classList.add("kobposh-route-transition");
  }

  window.setTimeout(() => {
    closeSupportHelpModal();
    modal.classList.remove("is-transitioning");

    if (isNavigation) {
      window.location.href = action.href;
      return;
    }

    if (typeof action.run === "function") {
      window.setTimeout(() => {
        action.run();
      }, 40);
    }
  }, SUPPORT_HELP_ACTION_TRANSITION_MS);
}

function normalizeUsername(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 24);
}

function isValidUsername(value = "") {
  return /^[a-z0-9](?:[a-z0-9._-]{1,22}[a-z0-9])$/.test(normalizeUsername(value));
}

function usernameToSyntheticEmail(username = "") {
  const normalized = normalizeUsername(username);
  return `${normalized}@username.kobposhv2.local`;
}

const OBVIOUS_FAKE_HAITI_PHONE_LOCALS = new Set([
  "01234567",
  "12345678",
  "23456789",
  "76543210",
  "87654321",
  "98765432",
]);

function phoneDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeHaitiMobilePhone(value = "") {
  const digits = phoneDigits(value);
  if (!digits) return "";

  let local = "";
  if (digits.length === 11 && digits.startsWith("509")) {
    local = digits.slice(3);
  } else if (digits.length === 8) {
    local = digits;
  } else {
    return "";
  }

  if (!/^[34]\d{7}$/.test(local)) return "";
  if (/^(\d)\1{7}$/.test(local)) return "";
  if (OBVIOUS_FAKE_HAITI_PHONE_LOCALS.has(local)) return "";

  return `509${local}`;
}

function buildHaitiMobilePhoneError(value = "") {
  const digits = phoneDigits(value);
  if (!digits) return "Numero a pa bon mete on bon numero haiti ossinon ou pap k fe retre";
  if (digits.length !== 8 && !(digits.length === 11 && digits.startsWith("509"))) {
    return "Numero a pa bon mete on bon numero haiti ossinon ou pap k fe retre";
  }

  const local = digits.length === 11 ? digits.slice(3) : digits;
  if (!/^[34]\d{7}$/.test(local)) {
    return "Numero a pa bon mete on bon numero haiti ossinon ou pap k fe retre";
  }
  if (/^(\d)\1{7}$/.test(local) || OBVIOUS_FAKE_HAITI_PHONE_LOCALS.has(local)) {
    return "Numero a pa bon mete on bon numero haiti ossinon ou pap k fe retre";
  }

  return "Numero a pa bon mete on bon numero haiti ossinon ou pap k fe retre";
}

async function ensureSignupPhoneAvailable(phone = "") {
  const normalizedPhone = normalizeHaitiMobilePhone(phone);
  if (!normalizedPhone) {
    throw new Error(buildHaitiMobilePhoneError(phone));
  }

  const phoneSnap = await getDocs(query(
    collection(db, "clients"),
    where("phone", "==", normalizedPhone),
    limit(1)
  ));

  if (!phoneSnap.empty) {
    throw new Error("Numero sa a deja lye ak yon lot kont.");
  }

  return normalizedPhone;
}

function setAuthError(message = "") {
  if (!loginErrorEl) return;
  loginErrorEl.textContent = String(message || "");
}

function formatAuthError(error, fallback = "Nou pa rive konekte w kounye a.") {
  const code = String(error?.code || "");
  const map = {
    "auth/email-already-in-use": "Kont sa deja egziste.",
    "auth/invalid-credential": "Username oswa modpas la pa bon.",
    "auth/invalid-email": "Email la pa bon.",
    "auth/network-request-failed": "Pwoblem rezo. Tcheke koneksyon ou.",
    "auth/too-many-requests": "Twop tantativ. Tann yon ti moman epi eseye anko.",
    "auth/user-not-found": "Kont la pa egziste.",
    "auth/weak-password": "Modpas la two kout. Li dwe gen omwen 6 karakte.",
    "auth/wrong-password": "Modpas la pa bon.",
  };
  return map[code] || String(error?.message || fallback);
}

function safeMoney(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
}

function formatHtg(value) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(safeMoney(value))} HTG`;
}

function getPendingHtgAmount(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const pending = Number(source?.provisionalHtgAvailable);
    if (Number.isFinite(pending) && pending > 0) return Math.max(0, Math.trunc(pending));
  }
  return 0;
}

function pickFirstFiniteNonNegativeNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return Number.NaN;
}

function getCurrentHomeWalletTotalHtg() {
  const livePlayable = pickFirstFiniteNonNegativeNumber(
    latestHomeFundingData?.playableHtg,
    latestHomeClientData?.playableHtg,
  );
  if (Number.isFinite(livePlayable)) {
    return Math.max(0, Math.trunc(livePlayable));
  }

  const approved = pickFirstFiniteNonNegativeNumber(
    latestHomeFundingData?.approvedHtgAvailable,
    latestHomeClientData?.approvedHtgAvailable,
  );
  const pending = pickFirstFiniteNonNegativeNumber(
    latestHomeFundingData?.provisionalHtgAvailable,
    latestHomeClientData?.provisionalHtgAvailable,
  );
  if (Number.isFinite(approved) || Number.isFinite(pending)) {
    return Math.max(
      0,
      Math.trunc((Number.isFinite(approved) ? approved : 0) + (Number.isFinite(pending) ? pending : 0)),
    );
  }

  const uid = String(auth.currentUser?.uid || "").trim();
  if (!uid) return 0;

  const baseBalance = window.__userBaseBalance || window.__userBalance || 0;
  const state = getXchangeState(baseBalance, uid || undefined);
  return Math.max(0, Math.trunc(Number(state?.totalBalance || 0) || 0));
}

function getPendingDepositOrderCount(source = null) {
  const pendingOrders = Array.isArray(source?.pendingOrders) ? source.pendingOrders : [];
  return pendingOrders.filter((item) => {
    const status = String(item?.status || item?.resolutionStatus || "").trim().toLowerCase();
    return status === "pending" || status === "review";
  }).length;
}

function getPendingDepositGuardAmount(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const pendingOrders = Array.isArray(source?.pendingOrders) ? source.pendingOrders : [];
    for (const item of pendingOrders) {
      const status = String(item?.status || item?.resolutionStatus || "").trim().toLowerCase();
      if (status !== "pending" && status !== "review") continue;
      const amount = Number(item?.amountHtg ?? item?.amount ?? item?.approvedAmountHtg ?? 0);
      if (Number.isFinite(amount) && amount > 0) return Math.max(0, Math.trunc(amount));
    }
  }
  return getPendingHtgAmount(...sources);
}

function buildPendingDepositGuardMessage(pendingAmount = 0) {
  const amountLabel = pendingAmount > 0 ? formatHtg(pendingAmount) : "yon depo an atant";
  return `Ou deja gen ${amountLabel} sou kont ou. Tann admin nan valide oswa rejte li avan ou voye yon lot demann depo.`;
}

function getAccountFreezeAlertStorageKey(uid = "") {
  const safeUid = String(uid || "").trim();
  return safeUid ? `kobposh_account_freeze_alert_${safeUid}` : "";
}

function buildAccountFreezeAlertSignature(source = {}) {
  return JSON.stringify({
    accountFrozen: source?.accountFrozen === true,
    withdrawalHold: source?.withdrawalHold === true,
    freezeReason: String(source?.freezeReason || source?.withdrawalHoldReason || ""),
    rejectedDepositStrikeCount: Math.max(0, Math.trunc(Number(source?.rejectedDepositStrikeCount || 0))),
    frozenAtMs: Math.max(0, Math.trunc(Number(source?.frozenAtMs || source?.withdrawalHoldAtMs || 0))),
  });
}

function shouldOpenAccountFreezeAlert(user = null, clientData = null) {
  const uid = String(user?.uid || "").trim();
  if (!uid || !clientData) return false;
  return clientData.accountFrozen === true || clientData.withdrawalHold === true;
}

function syncAccountFreezeAlertState(user = null, clientData = null) {
  const uid = String(user?.uid || "").trim();
  if (!uid) return;
  const storageKey = getAccountFreezeAlertStorageKey(uid);
  if (!storageKey) return;
  const stillFrozen = clientData?.accountFrozen === true || clientData?.withdrawalHold === true;
  if (!stillFrozen) {
    window.sessionStorage.removeItem(storageKey);
    closeAccountFrozenAlertModal();
  }
}

function renderHeaderBalance(approvedBalance, pendingBalance) {
  if (!balanceEl) return;
  const approved = Number(approvedBalance);
  const pending = Number(pendingBalance);
  if (!Number.isFinite(approved) && !Number.isFinite(pending)) {
    balanceEl.classList.remove("balance--split");
    balanceEl.removeAttribute("data-has-pending-balance");
    delete balanceEl.dataset.pendingHtgAmount;
    balanceEl.textContent = "-- HTG";
    return;
  }
  const safeApproved = Math.max(0, Math.trunc(Number.isFinite(approved) ? approved : 0));
  const safePending = Math.max(0, Math.trunc(Number.isFinite(pending) ? pending : 0));
  const hasPending = safePending > 0;
  balanceEl.dataset.pendingHtgAmount = String(safePending);
  balanceEl.classList.toggle("balance--split", hasPending);

  if (hasPending) {
    balanceEl.setAttribute("data-has-pending-balance", "1");
    balanceEl.innerHTML = `
      <span class="balance__approved">${formatHtg(safeApproved)}</span>
      <span class="balance__pending" data-kobposh-pending-balance="1">${formatHtg(safePending)} an atant</span>
    `;
    balanceEl.title = `HTG apwouve: ${formatHtg(safeApproved)} | HTG an atant: ${formatHtg(safePending)}`;
    return;
  }

  balanceEl.removeAttribute("data-has-pending-balance");
  balanceEl.classList.remove("balance--split");
  balanceEl.innerHTML = `<span class="balance__approved">${formatHtg(safeApproved)}</span>`;
  balanceEl.title = `Balans HTG apwouve: ${formatHtg(safeApproved)}`;
}

function renderLiveHomeHeaderBalance() {
  const approved = pickFirstFiniteNonNegativeNumber(
    latestHomeFundingData?.approvedHtgAvailable,
    latestHomeClientData?.approvedHtgAvailable,
  );
  const pending = pickFirstFiniteNonNegativeNumber(
    latestHomeFundingData?.provisionalHtgAvailable,
    latestHomeClientData?.provisionalHtgAvailable,
  );
  renderHeaderBalance(approved, pending);
}

function stopHomeFundingRefreshTimer() {
  if (homeFundingRefreshTimer) {
    window.clearTimeout(homeFundingRefreshTimer);
    homeFundingRefreshTimer = null;
  }
}

function scheduleHomeFundingRefresh(uid = "", delayMs = 0) {
  const safeUid = String(uid || "").trim();
  stopHomeFundingRefreshTimer();
  if (!safeUid) {
    latestHomeFundingData = {};
    renderLiveHomeHeaderBalance();
    return;
  }

  const refreshSeq = ++homeFundingRefreshSeq;
  homeFundingRefreshTimer = window.setTimeout(async () => {
    homeFundingRefreshTimer = null;
    try {
      const fundingData = await getDepositFundingStatusSecure({}).catch((error) => {
        console.warn("[KOBPOSH_V2] home funding refresh failed", error);
        return {};
      });
      if (refreshSeq !== homeFundingRefreshSeq) return;
      if (String(auth.currentUser?.uid || "").trim() !== safeUid) return;
      latestHomeFundingData = fundingData && typeof fundingData === "object" ? fundingData : {};
    } finally {
      if (String(auth.currentUser?.uid || "").trim() === safeUid) {
        renderLiveHomeHeaderBalance();
      }
    }
  }, Math.max(0, Number(delayMs) || 0));
}

function ensurePendingHeaderBalanceInfoModal() {
  const existing = document.getElementById("kobposhPendingBalanceInfoModal");
  if (existing) return existing;

  const overlay = document.createElement("div");
  overlay.id = "kobposhPendingBalanceInfoModal";
  overlay.className = "fixed inset-0 z-[3400] hidden items-center justify-center bg-black/55 px-4 backdrop-blur-sm";
  overlay.innerHTML = `
    <div class="w-full max-w-sm rounded-[28px] border border-[#f5cf77]/28 bg-[linear-gradient(180deg,rgba(40,47,72,0.98),rgba(23,28,45,0.98))] p-5 text-white shadow-[0_22px_44px_rgba(8,11,24,0.45)]">
      <div class="flex items-start gap-3">
        <div class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#f5cf77]/28 bg-[#f5cf77]/12 text-[#ffe39c]">
          <i data-lucide="wallet" class="icon" aria-hidden="true"></i>
        </div>
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ffe39c]">HTG an atant</p>
          <h3 class="mt-1 text-lg font-extrabold text-white">Ou ka jwe ak li</h3>
        </div>
      </div>
      <div class="mt-4 rounded-2xl border border-white/10 bg-white/6 p-4">
        <p data-kobposh-pending-balance-amount class="text-2xl font-black text-[#ffd86b]">0 HTG</p>
        <p class="mt-3 text-sm leading-6 text-white/88">
          Sa se HTG depo ou ki poko fin apwouve toujou. Ou ka jwe ak li depi kounye a.
        </p>
        <p class="mt-3 text-sm leading-6 text-white/74">
          Le yon admin apwouve depo a, montan sa a ap pase nan HTG apwouve epi li ap paret an vet nan balans ou.
        </p>
      </div>
      <button type="button" data-kobposh-close-pending-balance class="mt-5 h-11 w-full rounded-2xl border border-[#efb24f] bg-[#f08a18] text-sm font-semibold text-white">
        Mwen konprann
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
  renderIconsSafely();

  const amountEl = overlay.querySelector("[data-kobposh-pending-balance-amount]");
  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  };
  const open = (amount) => {
    if (amountEl) amountEl.textContent = formatHtg(amount);
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector("[data-kobposh-close-pending-balance]")?.addEventListener("click", close);
  overlay.__openPendingBalanceInfo = open;
  return overlay;
}

function bindHeaderBalanceHistoryShortcut() {
  if (!balanceEl || balanceEl.dataset.historyShortcutBound === "1") return;
  balanceEl.dataset.historyShortcutBound = "1";
  balanceEl.style.cursor = "pointer";
  balanceEl.title = "Klike pou louvri istorik kont la";
  const pendingInfoModal = ensurePendingHeaderBalanceInfoModal();
  const openHistory = () => {
    window.location.href = "./profile.html?panel=history";
  };
  balanceEl.addEventListener("click", (event) => {
    const pendingTarget = event.target instanceof Element
      ? event.target.closest("[data-kobposh-pending-balance='1']")
      : null;
    if (pendingTarget) {
      event.preventDefault();
      event.stopPropagation();
      const pendingAmount = Math.max(0, Math.trunc(Number(balanceEl.dataset.pendingHtgAmount || 0)));
      if (typeof pendingInfoModal.__openPendingBalanceInfo === "function") {
        pendingInfoModal.__openPendingBalanceInfo(pendingAmount);
      }
      return;
    }
    openHistory();
  });
  balanceEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openHistory();
    }
  });
}

function updateAccountLabelDisplay(user = null, clientData = null) {
  if (!accountLabelEl) return;
  const preferred = String(
    clientData?.username
    || clientData?.displayName
    || clientData?.name
    || user?.email?.split("@")[0]
    || ""
  ).trim();
  accountLabelEl.textContent = preferred || "Ou pagen kont";
}

function watchCurrentUserWallet(user = null) {
  if (typeof walletUnsubscribe === "function") {
    walletUnsubscribe();
    walletUnsubscribe = null;
  }
  stopHomeFundingRefreshTimer();

  if (!user?.uid) {
    latestHomeClientData = {};
    latestHomeFundingData = {};
    updateAccountLabelDisplay(null, null);
    renderHeaderBalance(Number.NaN, Number.NaN);
    stopWithdrawalDecisionWatcher();
    return;
  }

  walletUnsubscribe = onSnapshot(
    doc(db, "clients", user.uid),
    (snapshot) => {
      const clientData = snapshot.exists() ? (snapshot.data() || {}) : {};
      latestHomeClientData = clientData;
      updateAccountLabelDisplay(user, clientData);
      renderLiveHomeHeaderBalance();
      scheduleHomeFundingRefresh(user.uid, 150);
      if (shouldOpenAccountFreezeAlert(user, clientData)) {
        openAccountFrozenAlertModal();
      }
      syncAccountFreezeAlertState(user, clientData);
    },
    () => {
      latestHomeClientData = {};
      latestHomeFundingData = {};
      updateAccountLabelDisplay(user, null);
      renderHeaderBalance(Number.NaN, Number.NaN);
    }
  );
}

function stopWithdrawalDecisionWatcher() {
  if (typeof withdrawalDecisionUnsubscribe === "function") {
    withdrawalDecisionUnsubscribe();
    withdrawalDecisionUnsubscribe = null;
  }
}

function getWithdrawalDecisionSeenStorageKey(uid = "", withdrawalId = "", status = "", updatedAtMs = 0) {
  const safeUid = String(uid || "").trim();
  const safeId = String(withdrawalId || "").trim();
  const safeStatus = String(status || "").trim().toLowerCase();
  const safeUpdatedAtMs = Math.max(0, Math.trunc(Number(updatedAtMs) || 0));
  if (!safeUid || !safeId || !safeStatus || safeUpdatedAtMs <= 0) return "";
  return `kobposh_withdrawal_decision_seen_${safeUid}_${safeId}_${safeStatus}_${safeUpdatedAtMs}`;
}

function ensureWithdrawalDecisionModal() {
  if (withdrawalDecisionModal) return withdrawalDecisionModal;

  withdrawalDecisionModal = document.createElement("section");
  withdrawalDecisionModal.className = "kobposh-forgot-modal";
  withdrawalDecisionModal.setAttribute("aria-hidden", "true");
  withdrawalDecisionModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhWithdrawalDecisionTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-withdrawal-decision-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">DEMANN RETRE</p>
      <h2 id="kobposhWithdrawalDecisionTitle" class="kobposh-forgot-modal__title" data-kobposh-withdrawal-decision-title>
        Demande retre w la reyisi
      </h2>
      <p class="kobposh-forgot-modal__text" data-kobposh-withdrawal-decision-text>
        Demande retre w la reyisi.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-withdrawal-decision-ok>
        Mwen konprann
      </button>
    </div>
  `;

  document.body.appendChild(withdrawalDecisionModal);
  renderIconsSafely();

  const closeModal = () => {
    withdrawalDecisionModal.classList.remove("is-open");
    withdrawalDecisionModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-modal-open");
  };

  withdrawalDecisionModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target === withdrawalDecisionModal
      || target?.closest("[data-kobposh-withdrawal-decision-close]")
      || target?.closest("[data-kobposh-withdrawal-decision-ok]")
    ) {
      closeModal();
    }
  });

  return withdrawalDecisionModal;
}

function openWithdrawalDecisionModal(status = "approved") {
  const modal = ensureWithdrawalDecisionModal();
  const titleEl = modal.querySelector("[data-kobposh-withdrawal-decision-title]");
  const textEl = modal.querySelector("[data-kobposh-withdrawal-decision-text]");
  const normalized = String(status || "").trim().toLowerCase();
  const isApproved = normalized === "approved";

  if (titleEl) {
    titleEl.textContent = isApproved ? "Demande retre w la reyisi" : "Demande retre w la echwe";
  }
  if (textEl) {
    textEl.textContent = isApproved
      ? "Demande retre w la reyisi."
      : "Demande retre w la echwe.";
  }

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function watchWithdrawalDecisionUpdates(user = null) {
  stopWithdrawalDecisionWatcher();
  const uid = String(user?.uid || "").trim();
  if (!uid) return;

  const withdrawalsQuery = query(
    collection(db, "clients", uid, "withdrawals"),
    limit(25),
  );

  withdrawalDecisionUnsubscribe = onSnapshot(withdrawalsQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "removed") return;
      const data = change.doc.data() || {};
      const status = String(data.status || data.resolutionStatus || "").trim().toLowerCase();
      if (status !== "approved" && status !== "rejected") return;
      const reviewedAtMs = Number.isFinite(Date.parse(String(data.reviewedAt || "")))
        ? Date.parse(String(data.reviewedAt || ""))
        : 0;
      const updatedAtMs = Math.max(
        0,
        Math.trunc(Number(
          data.updatedAtMs
          || data.resolvedAtMs
          || data.processedAtMs
          || data.reviewedAtMs
          || reviewedAtMs
          || data.createdAtMs
          || 0
        ))
      );
      const storageKey = getWithdrawalDecisionSeenStorageKey(uid, change.doc.id, status, updatedAtMs);
      if (!storageKey) return;
      if (window.sessionStorage.getItem(storageKey) === "1") return;
      window.sessionStorage.setItem(storageKey, "1");
      scheduleHomeFundingRefresh(uid, 0);
      openWithdrawalDecisionModal(status);
    });
  });
}

function refreshHomeLiveSurface() {
  const user = auth.currentUser || null;
  if (!user?.uid) return;
  scheduleHomeFundingRefresh(user.uid, 0);
}

function setAuthBusy(isBusy) {
  const disabled = isBusy === true;
  if (authSubmitBtn) authSubmitBtn.disabled = disabled;
  if (loginIdentifierEl) loginIdentifierEl.disabled = disabled;
  if (loginPasswordEl) loginPasswordEl.disabled = disabled;
  if (signupUsernameEl) signupUsernameEl.disabled = disabled;
  if (signupPhoneEl) signupPhoneEl.disabled = disabled;
  if (signupPasswordEl) signupPasswordEl.disabled = disabled;
  if (signupPasswordConfirmEl) signupPasswordConfirmEl.disabled = disabled;
  passwordToggleBtns.forEach((button) => {
    button.disabled = disabled;
  });
}

function openGamesModal() {
  if (!gamesModal) return;
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  gamesModal.classList.add("is-open");
  gamesModal.setAttribute("aria-hidden", "false");
  closeTournamentsModal();
  closeTournamentRegisterModal();
  document.body.classList.add("is-modal-open");
  window.requestAnimationFrame(() => {
    gamesModal.querySelector(".games-modal__back, .games-modal__item")?.focus?.();
  });
}

function closeGamesModal() {
  if (!gamesModal) return;
  if (gamesModal.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  gamesModal.classList.remove("is-open");
  gamesModal.setAttribute("aria-hidden", "true");
  if (!tournamentsModal?.classList.contains("is-open") && !tournamentRegisterModal?.classList.contains("is-open")) {
    document.body.classList.remove("is-modal-open");
  }
}

function openTournamentsModal() {
  if (!tournamentsModal) return;
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  closeGamesModal();
  closeTournamentRegisterModal();
  tournamentsModal.classList.add("is-open");
  tournamentsModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
  window.requestAnimationFrame(() => {
    tournamentsModal.querySelector(".games-modal__back, .games-modal__item")?.focus?.();
  });
}

function closeTournamentsModal() {
  if (!tournamentsModal) return;
  if (tournamentsModal.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  tournamentsModal.classList.remove("is-open");
  tournamentsModal.setAttribute("aria-hidden", "true");
  if (!gamesModal?.classList.contains("is-open") && !tournamentRegisterModal?.classList.contains("is-open")) {
    document.body.classList.remove("is-modal-open");
  }
}

function openTournamentRegisterModal(gameName = "", imagePath = "") {
  if (!tournamentRegisterModal) return;
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  const normalizedName = String(gameName || "").trim() || "Championna";
  const normalizedKey = normalizeTournamentGameKey(normalizedName);
  const normalizedImage = String(imagePath || "").trim() || "./assets/images/championna.png";
  currentTournamentGameState = {
    name: normalizedName,
    key: normalizedKey,
    image: normalizedImage,
  };
  if (tournamentRegisterGameEl) {
    tournamentRegisterGameEl.textContent = normalizedName.toUpperCase();
  }
  if (tournamentRegisterImageEl) {
    tournamentRegisterImageEl.src = normalizedImage;
    tournamentRegisterImageEl.alt = `Championna ${normalizedName}`;
  }
  closeTournamentsModal();
  tournamentRegisterModal.classList.add("is-open");
  tournamentRegisterModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
  startTournamentRegisterListSync(normalizedKey);
  window.requestAnimationFrame(() => {
    tournamentRegisterModal.querySelector("[data-tournament-register-submit], .games-modal__back")?.focus?.();
  });
}

function closeTournamentRegisterModal() {
  if (!tournamentRegisterModal) return;
  if (tournamentRegisterModal.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  tournamentRegisterModal.classList.remove("is-open");
  tournamentRegisterModal.setAttribute("aria-hidden", "true");
  if (tournamentCostConfirmModal?.classList.contains("is-open")) {
    if (tournamentCostConfirmModal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    tournamentCostConfirmModal.classList.remove("is-open");
    tournamentCostConfirmModal.setAttribute("aria-hidden", "true");
  }
  if (typeof tournamentRegisterListUnsub === "function") {
    tournamentRegisterListUnsub();
    tournamentRegisterListUnsub = null;
  }
  closeTournamentBracketSync();
  if (!gamesModal?.classList.contains("is-open") && !tournamentsModal?.classList.contains("is-open")) {
    document.body.classList.remove("is-modal-open");
  }
}

function normalizeTournamentGameKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function updateTournamentRegisterPrimaryButton() {
  if (!tournamentRegisterSubmitBtn) return;
  if (tournamentRegisterGateBusy) {
    tournamentRegisterSubmitBtn.disabled = true;
    tournamentRegisterSubmitBtn.textContent = "Verifikasyon...";
    return;
  }
  if (tournamentRegisterBusy) {
    tournamentRegisterSubmitBtn.disabled = true;
    tournamentRegisterSubmitBtn.textContent = "Enskripsyon an kou...";
    return;
  }
  if (tournamentAlreadyRegistered) {
    tournamentRegisterSubmitBtn.disabled = true;
    tournamentRegisterSubmitBtn.textContent = "N ap tann lot jwe yo";
    return;
  }
  tournamentRegisterSubmitBtn.disabled = false;
  tournamentRegisterSubmitBtn.textContent = "S'inscrire";
}

function getTournamentDisplayUsername() {
  const candidate = String(
    latestHomeClientData?.username
    || latestHomeClientData?.displayName
    || auth.currentUser?.displayName
    || auth.currentUser?.email?.split("@")?.[0]
    || "Utilisateur"
  ).trim();
  return candidate || "Utilisateur";
}

function renderTournamentRegisterList(rows = [], { isLoading = false, errorText = "" } = {}) {
  if (!tournamentRegisterListEl || !tournamentRegisterListStateEl || !tournamentRegisterCountEl) return;
  const safeRows = Array.isArray(rows) ? rows : [];
  tournamentRegisterCountEl.textContent = String(safeRows.length);
  tournamentRegisterListEl.innerHTML = safeRows.map((row) => {
    const username = String(row?.username || "Utilisateur").trim() || "Utilisateur";
    const enrolledAt = Number(row?.createdAtMs || 0);
    const dateLabel = enrolledAt > 0
      ? new Date(enrolledAt).toLocaleString("fr-FR")
      : "Kounye a";
    return `
      <li class="tournament-register-list__item">
        <span class="tournament-register-list__name">${username}</span>
        <small class="tournament-register-list__meta">${dateLabel}</small>
      </li>
    `;
  }).join("");
  if (isLoading) {
    tournamentRegisterListStateEl.hidden = false;
    tournamentRegisterListStateEl.textContent = "Chajman lis la...";
    return;
  }
  if (errorText) {
    tournamentRegisterListStateEl.hidden = false;
    tournamentRegisterListStateEl.textContent = errorText;
    return;
  }
  if (safeRows.length === 0) {
    tournamentRegisterListStateEl.hidden = false;
    tournamentRegisterListStateEl.textContent = "Pa gen moun enskri pou kounye a.";
    return;
  }
  tournamentRegisterListStateEl.hidden = true;
}

function startTournamentRegisterListSync(gameKey = "") {
  if (typeof tournamentRegisterListUnsub === "function") {
    tournamentRegisterListUnsub();
    tournamentRegisterListUnsub = null;
  }
  if (!gameKey) {
    renderTournamentRegisterList([], { errorText: "Jwet la pa valid pou enskripsyon." });
    return;
  }
  tournamentAlreadyRegistered = false;
  updateTournamentRegisterPrimaryButton();
  renderTournamentRegisterList([], { isLoading: true });
  const registrationsQuery = query(
    collection(db, "tournamentRegistrations"),
    where("gameKey", "==", gameKey),
    limit(150),
  );
  tournamentRegisterListUnsub = onSnapshot(registrationsQuery, (snapshot) => {
    const currentUid = String(auth.currentUser?.uid || "").trim();
    const rows = snapshot.docs
      .map((docSnap) => docSnap.data() || {})
      .sort((a, b) => Number(b?.createdAtMs || 0) - Number(a?.createdAtMs || 0));
    tournamentAlreadyRegistered = currentUid
      ? rows.some((row) => String(row?.uid || "").trim() === currentUid)
      : false;
    updateTournamentRegisterPrimaryButton();
    renderTournamentRegisterList(rows, { isLoading: false });
    void maybeCreateTournamentBracket(rows);
  }, () => {
    tournamentAlreadyRegistered = false;
    updateTournamentRegisterPrimaryButton();
    renderTournamentRegisterList([], { errorText: "Nou pa ka chaje lis enskripsyon an pou kounye a." });
  });
  startTournamentBracketSync(gameKey);
}

function closeTournamentBracketSync() {
  if (typeof tournamentBracketUnsub === "function") {
    tournamentBracketUnsub();
    tournamentBracketUnsub = null;
  }
}

function renderTournamentBracket({
  stateText = "N ap tann 8 patisipan pou lanse tiraj la.",
  upcomingMatches = [],
  completedMatches = [],
} = {}) {
  if (!tournamentBracketStateEl || !tournamentUpcomingListEl || !tournamentCompletedListEl) return;
  tournamentBracketStateEl.textContent = String(stateText || "");
  const renderMatch = (match = {}) => {
    const title = String(match.roundLabel || "Match").trim();
    const homeName = String(match.homeName || "TBD").trim() || "TBD";
    const awayName = String(match.awayName || "TBD").trim() || "TBD";
    const scoreText = (Number.isFinite(Number(match.homeScore)) && Number.isFinite(Number(match.awayScore)))
      ? `${Math.trunc(Number(match.homeScore))} - ${Math.trunc(Number(match.awayScore))}`
      : "A poko jwe";
    return `
      <li class="tournament-bracket__match">
        <span class="tournament-bracket__match-title">${title}</span>
        <span class="tournament-bracket__pair">${homeName} vs ${awayName}</span>
        <span class="tournament-bracket__score">${scoreText}</span>
      </li>
    `;
  };

  tournamentUpcomingListEl.innerHTML = upcomingMatches.length
    ? upcomingMatches.map(renderMatch).join("")
    : `<li class="tournament-bracket__empty">Pa gen match k ap vini pou kounye a.</li>`;

  tournamentCompletedListEl.innerHTML = completedMatches.length
    ? completedMatches.map(renderMatch).join("")
    : `<li class="tournament-bracket__empty">Pa gen match fini pou kounye a.</li>`;
}

function formatRoundLabel(round = "", index = 0) {
  const safeIndex = Math.max(1, Number(index) + 1);
  const normalized = String(round || "").trim().toLowerCase();
  if (normalized === "quarter") return `Premye tou - Match ${safeIndex}`;
  if (normalized === "semi") return `Demi final - Match ${safeIndex}`;
  if (normalized === "final") return "Final";
  return `Match ${safeIndex}`;
}

function shuffleTournamentParticipants(list = []) {
  const arr = Array.isArray(list) ? [...list] : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function buildInitialTournamentMatches(participants = []) {
  const safeParticipants = Array.isArray(participants) ? participants.slice(0, 8) : [];
  const quarterMatches = [];
  for (let i = 0; i < 4; i += 1) {
    const home = safeParticipants[i * 2] || null;
    const away = safeParticipants[(i * 2) + 1] || null;
    quarterMatches.push({
      id: `QF${i + 1}`,
      round: "quarter",
      roundOrder: 1,
      order: i + 1,
      roundLabel: formatRoundLabel("quarter", i),
      homeUid: String(home?.uid || "").trim(),
      homeName: String(home?.username || "TBD").trim() || "TBD",
      awayUid: String(away?.uid || "").trim(),
      awayName: String(away?.username || "TBD").trim() || "TBD",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      winnerUid: "",
    });
  }

  const semiMatches = [
    {
      id: "SF1",
      round: "semi",
      roundOrder: 2,
      order: 1,
      roundLabel: formatRoundLabel("semi", 0),
      homeUid: "",
      homeName: "Ganyan QF1",
      awayUid: "",
      awayName: "Ganyan QF2",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      winnerUid: "",
      sourceMatchIds: ["QF1", "QF2"],
    },
    {
      id: "SF2",
      round: "semi",
      roundOrder: 2,
      order: 2,
      roundLabel: formatRoundLabel("semi", 1),
      homeUid: "",
      homeName: "Ganyan QF3",
      awayUid: "",
      awayName: "Ganyan QF4",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      winnerUid: "",
      sourceMatchIds: ["QF3", "QF4"],
    },
  ];

  const finalMatch = [{
    id: "F1",
    round: "final",
    roundOrder: 3,
    order: 1,
    roundLabel: formatRoundLabel("final", 0),
    homeUid: "",
    homeName: "Ganyan SF1",
    awayUid: "",
    awayName: "Ganyan SF2",
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    winnerUid: "",
    sourceMatchIds: ["SF1", "SF2"],
  }];

  return [...quarterMatches, ...semiMatches, ...finalMatch];
}

async function maybeCreateTournamentBracket(registrationRows = []) {
  const gameKey = String(currentTournamentGameState?.key || "").trim();
  const gameName = String(currentTournamentGameState?.name || "").trim() || "Championna";
  if (!gameKey) return;
  if (tournamentBracketBuildInFlight) return;

  const uniqueRows = [];
  const seen = new Set();
  for (const row of registrationRows) {
    const uid = String(row?.uid || "").trim();
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    uniqueRows.push({
      uid,
      username: String(row?.username || "Utilisateur").trim() || "Utilisateur",
      createdAtMs: Number(row?.createdAtMs || 0),
    });
  }
  if (uniqueRows.length < 8) {
    return;
  }

  tournamentBracketBuildInFlight = true;
  try {
    const bracketRef = doc(db, "tournamentBrackets", gameKey);
    const bracketSnap = await getDoc(bracketRef);
    if (bracketSnap.exists()) return;

    const selected = shuffleTournamentParticipants(
      uniqueRows.sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0)).slice(0, 8)
    );
    const matches = buildInitialTournamentMatches(selected);
    await setDoc(bracketRef, {
      gameKey,
      gameName,
      participantCount: selected.length,
      bracketSize: 8,
      drawCompleted: true,
      createdAtMs: Date.now(),
      updatedAt: serverTimestamp(),
      participants: selected,
      matches,
    }, { merge: true });
  } catch (_) {
  } finally {
    tournamentBracketBuildInFlight = false;
  }
}

function startTournamentBracketSync(gameKey = "") {
  closeTournamentBracketSync();
  if (!gameKey) {
    renderTournamentBracket({
      stateText: "N ap tann 8 patisipan pou lanse tiraj la.",
      upcomingMatches: [],
      completedMatches: [],
    });
    return;
  }
  renderTournamentBracket({
    stateText: "N ap tcheke kalandriye championna a...",
    upcomingMatches: [],
    completedMatches: [],
  });
  const bracketRef = doc(db, "tournamentBrackets", gameKey);
  tournamentBracketUnsub = onSnapshot(bracketRef, (snap) => {
    if (!snap.exists()) {
      renderTournamentBracket({
        stateText: "N ap tann 8 patisipan pou lanse tiraj la.",
        upcomingMatches: [],
        completedMatches: [],
      });
      return;
    }
    const data = snap.data() || {};
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const normalizedMatches = matches
      .map((match) => ({
        ...match,
        roundOrder: Number(match?.roundOrder || 99),
        order: Number(match?.order || 99),
      }))
      .sort((a, b) => (a.roundOrder - b.roundOrder) || (a.order - b.order));

    const completedMatches = normalizedMatches.filter((match) => String(match?.status || "").trim().toLowerCase() === "completed");
    const upcomingMatches = normalizedMatches.filter((match) => String(match?.status || "").trim().toLowerCase() !== "completed");
    const participantCount = Number(data?.participantCount || 0);
    const stateText = participantCount >= 8
      ? "Tiraj la fet. Men kalandriye ofisyel championna a."
      : `N ap tann 8 patisipan pou lanse tiraj la. (${participantCount}/8)`;
    renderTournamentBracket({
      stateText,
      upcomingMatches,
      completedMatches,
    });
  }, () => {
    renderTournamentBracket({
      stateText: "Nou pa ka chaje kalandriye championna a pou kounye a.",
      upcomingMatches: [],
      completedMatches: [],
    });
  });
}

function ensureTournamentCostConfirmModal() {
  if (tournamentCostConfirmModal) return tournamentCostConfirmModal;

  tournamentCostConfirmModal = document.createElement("section");
  tournamentCostConfirmModal.className = "kobposh-forgot-modal";
  tournamentCostConfirmModal.setAttribute("aria-hidden", "true");
  tournamentCostConfirmModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhTournamentCostTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-tournament-cost-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">ENSKRIPSYON CHAMPIONNA</p>
      <h2 id="kobposhTournamentCostTitle" class="kobposh-forgot-modal__title">Pri enskripsyon an se ${TOURNAMENT_REGISTER_COST_HTG} HTG</h2>
      <p class="kobposh-forgot-modal__text" data-kobposh-tournament-cost-text>
        Le ou konfime, ${TOURNAMENT_REGISTER_COST_HTG} HTG ap soti sou kont ou epi non itilizate ou ap antre nan lis moun ki enskri yo.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-tournament-cost-confirm>
        Peye ${TOURNAMENT_REGISTER_COST_HTG} HTG
      </button>
    </div>
  `;

  document.body.appendChild(tournamentCostConfirmModal);
  renderIconsSafely();

  const closeModal = () => {
    if (tournamentCostConfirmModal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    tournamentCostConfirmModal.classList.remove("is-open");
    tournamentCostConfirmModal.setAttribute("aria-hidden", "true");
    if (
      !gamesModal?.classList.contains("is-open")
      && !tournamentsModal?.classList.contains("is-open")
      && !tournamentRegisterModal?.classList.contains("is-open")
    ) {
      document.body.classList.remove("is-modal-open");
    }
  };

  tournamentCostConfirmModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === tournamentCostConfirmModal || target?.closest("[data-kobposh-tournament-cost-close]")) {
      closeModal();
      return;
    }
    if (target?.closest("[data-kobposh-tournament-cost-confirm]")) {
      closeModal();
      void registerCurrentUserToTournament();
    }
  });

  tournamentCostConfirmModal.__open = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    tournamentCostConfirmModal.classList.add("is-open");
    tournamentCostConfirmModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-modal-open");
    window.requestAnimationFrame(() => {
      tournamentCostConfirmModal.querySelector("[data-kobposh-tournament-cost-confirm], [data-kobposh-tournament-cost-close]")?.focus?.();
    });
  };
  tournamentCostConfirmModal.__close = closeModal;
  return tournamentCostConfirmModal;
}

function openTournamentCostConfirmModal() {
  const modal = ensureTournamentCostConfirmModal();
  modal.__open?.();
}

async function readLivePendingHtgForTournamentGate() {
  let fundingData = {};
  try {
    fundingData = await getDepositFundingStatusSecure({});
  } catch (_) {
    fundingData = {};
  }
  if (fundingData && typeof fundingData === "object") {
    latestHomeFundingData = fundingData;
    renderLiveHomeHeaderBalance();
  }
  return getPendingHtgAmount(fundingData, latestHomeFundingData, latestHomeClientData);
}

async function openTournamentRegisterPaymentGate() {
  if (!auth.currentUser) {
    openAuthScreen("login");
    return;
  }
  if (tournamentAlreadyRegistered || tournamentRegisterBusy || tournamentRegisterGateBusy) return;

  tournamentRegisterGateBusy = true;
  updateTournamentRegisterPrimaryButton();
  try {
    const pendingHtgAmount = await readLivePendingHtgForTournamentGate();
    if (pendingHtgAmount > 0) {
      openTournamentFeedbackModal({
        eyebrow: "ENSKRIPSYON BLOKE",
        title: "Ou gen HTG an atant sou kont ou",
        text: `Ou pa ka enskri nan championna a pandan ou gen ${formatHtg(pendingHtgAmount)} an atant. Tann validsyon an fini avan ou eseye anko.`,
      });
      return;
    }
    openTournamentCostConfirmModal();
  } finally {
    tournamentRegisterGateBusy = false;
    updateTournamentRegisterPrimaryButton();
  }
}

function ensureTournamentFeedbackModal() {
  if (tournamentFeedbackModal) return tournamentFeedbackModal;

  tournamentFeedbackModal = document.createElement("section");
  tournamentFeedbackModal.className = "kobposh-forgot-modal";
  tournamentFeedbackModal.setAttribute("aria-hidden", "true");
  tournamentFeedbackModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhTournamentFeedbackTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-tournament-feedback-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow" data-kobposh-tournament-feedback-eyebrow>CHAMPIONNA</p>
      <h2 id="kobposhTournamentFeedbackTitle" class="kobposh-forgot-modal__title" data-kobposh-tournament-feedback-title></h2>
      <p class="kobposh-forgot-modal__text" data-kobposh-tournament-feedback-text></p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-tournament-feedback-ok>Dakò</button>
    </div>
  `;

  document.body.appendChild(tournamentFeedbackModal);
  renderIconsSafely();

  const closeModal = () => {
    if (tournamentFeedbackModal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    tournamentFeedbackModal.classList.remove("is-open");
    tournamentFeedbackModal.setAttribute("aria-hidden", "true");
    if (
      !gamesModal?.classList.contains("is-open")
      && !tournamentsModal?.classList.contains("is-open")
      && !tournamentRegisterModal?.classList.contains("is-open")
      && !tournamentCostConfirmModal?.classList.contains("is-open")
    ) {
      document.body.classList.remove("is-modal-open");
    }
  };

  tournamentFeedbackModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target === tournamentFeedbackModal
      || target?.closest("[data-kobposh-tournament-feedback-close]")
      || target?.closest("[data-kobposh-tournament-feedback-ok]")
    ) {
      closeModal();
    }
  });

  tournamentFeedbackModal.__open = ({
    eyebrow = "CHAMPIONNA",
    title = "Mesaj",
    text = "",
  } = {}) => {
    const eyebrowEl = tournamentFeedbackModal.querySelector("[data-kobposh-tournament-feedback-eyebrow]");
    const titleEl = tournamentFeedbackModal.querySelector("[data-kobposh-tournament-feedback-title]");
    const textEl = tournamentFeedbackModal.querySelector("[data-kobposh-tournament-feedback-text]");
    if (eyebrowEl) eyebrowEl.textContent = String(eyebrow || "CHAMPIONNA");
    if (titleEl) titleEl.textContent = String(title || "Mesaj");
    if (textEl) textEl.textContent = String(text || "");

    tournamentFeedbackModal.classList.add("is-open");
    tournamentFeedbackModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-modal-open");
    window.requestAnimationFrame(() => {
      tournamentFeedbackModal.querySelector("[data-kobposh-tournament-feedback-ok]")?.focus?.();
    });
  };
  tournamentFeedbackModal.__close = closeModal;
  return tournamentFeedbackModal;
}

function openTournamentFeedbackModal(options = {}) {
  const modal = ensureTournamentFeedbackModal();
  modal.__open?.(options);
}

function ensureTournamentRulesModal() {
  if (tournamentRulesModal) return tournamentRulesModal;

  tournamentRulesModal = document.createElement("section");
  tournamentRulesModal.className = "kobposh-forgot-modal";
  tournamentRulesModal.setAttribute("aria-hidden", "true");
  tournamentRulesModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel kobposh-tournament-rules-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhTournamentRulesTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-tournament-rules-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">RÈG CHAMPIONNA</p>
      <h2 id="kobposhTournamentRulesTitle" class="kobposh-forgot-modal__title">Règ ofisyèl Championna a</h2>
      <div class="kobposh-tournament-rules-modal__content">
        <section class="kobposh-tournament-rules-modal__section">
          <h3>Fòma konpetisyon an</h3>
          <ul>
            <li>Championna a fèt ak 8 patisipan, epi li kòmanse dirèkteman an kat de final.</li>
            <li>Premye tou: 4 match (yon jwè kont yon jwè).</li>
            <li>Dezyèm tou: 2 match demi final.</li>
            <li>Dènye tou: 1 gran final.</li>
          </ul>
        </section>
        <section class="kobposh-tournament-rules-modal__section">
          <h3>Kijan pou genyen yon match</h3>
          <ul>
            <li>Chak match gen plizyè pati.</li>
            <li>Premye jwè ki genyen 2 pati ranpòte match la.</li>
            <li>Pèdan an elimine, gayan an pase nan pwochen tou.</li>
          </ul>
        </section>
        <section class="kobposh-tournament-rules-modal__section">
          <h3>Pri ak rekonpans</h3>
          <ul>
            <li>Apre enskripsyon an, chak jwè ap peye chak pati nòmalman sou sit ofisyèl la.</li>
            <li>Pri yon pati se 25 HTG, li enpòtan pou chak jwè konprann sa avan li kòmanse match li yo.</li>
            <li>1e plas (chanpyon): 1100 HTG.</li>
            <li>2e plas (finalis): 500 HTG.</li>
            <li>Tout lòt jwè yo pa resevwa prim finansye.</li>
          </ul>
        </section>
        <section class="kobposh-tournament-rules-modal__section">
          <h3>Supervizyon ak abit</h3>
          <ul>
            <li>Tout match yo ap fèt anba sipèvizyon yon kowòdonatè ofisyèl.</li>
            <li>Kowòdonatè a se abit match yo, epi desizyon li pran sou jwèt la dwe respekte.</li>
          </ul>
        </section>
        <section class="kobposh-tournament-rules-modal__section">
          <h3>Kominikasyon ofisyèl</h3>
          <ul>
            <li>Kowòdonatè a ap kominike ak jwè yo sou gwoup WhatsApp Championna a.</li>
            <li>Chak jwè dwe rete aktif sou gwoup la pou resevwa orè, enfòmasyon, ak enstriksyon match yo.</li>
          </ul>
        </section>
        <section class="kobposh-tournament-rules-modal__section">
          <h3>Kijan yon pati ap lanse</h3>
          <ul>
            <li>Pou chak pati, chak jwè ap resevwa yon kòd.</li>
            <li>Jwè a antre sou sit la, chwazi jwèt la, epi antre kòd la pou li rantre nan pati a.</li>
          </ul>
        </section>
        <section class="kobposh-tournament-rules-modal__section">
          <h3>Règ disiplin ak konpòtman</h3>
          <ul>
            <li>Move konpòtman, jouman, menas, oswa mank respè sou advèsè/staf pa aksepte.</li>
            <li>Nenpòt trich oswa tantativ manipilasyon mennen nan diskalifikasyon imedya.</li>
            <li>Si yon jwè kite jwèt la volontèman, li pèdi match la sou fotfè.</li>
          </ul>
        </section>
        <section class="kobposh-tournament-rules-modal__section">
          <h3>Spectateurs ak envitasyon</h3>
          <ul>
            <li>Gen match ki ka ouvè pou spectateurs.</li>
            <li>Jwè yo ka envite zanmi ak fanmi yo vin gade match yo.</li>
          </ul>
        </section>
        <section class="kobposh-tournament-rules-modal__section">
          <h3>Pèt koneksyon / pwoblèm teknik</h3>
          <ul>
            <li>Si yon jwè pèdi koneksyon pandan match, li gen yon delè kout pou retounen.</li>
            <li>Si li pa retounen nan delè a, li ka pèdi pati a oswa match la selon desizyon òganizasyon an.</li>
            <li>Repete dekoneksyon oswa sòti jwèt an seri kapab mennen nan diskalifikasyon.</li>
          </ul>
        </section>
      </div>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-tournament-rules-close>Mwen konprann</button>
    </div>
  `;

  document.body.appendChild(tournamentRulesModal);
  renderIconsSafely();

  const closeModal = () => {
    if (tournamentRulesModal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    tournamentRulesModal.classList.remove("is-open");
    tournamentRulesModal.setAttribute("aria-hidden", "true");
    if (
      !gamesModal?.classList.contains("is-open")
      && !tournamentsModal?.classList.contains("is-open")
      && !tournamentRegisterModal?.classList.contains("is-open")
      && !tournamentCostConfirmModal?.classList.contains("is-open")
      && !tournamentFeedbackModal?.classList.contains("is-open")
    ) {
      document.body.classList.remove("is-modal-open");
    }
  };

  tournamentRulesModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target === tournamentRulesModal
      || target?.closest("[data-kobposh-tournament-rules-close]")
    ) {
      closeModal();
    }
  });

  tournamentRulesModal.__open = () => {
    tournamentRulesModal.classList.add("is-open");
    tournamentRulesModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-modal-open");
    window.requestAnimationFrame(() => {
      tournamentRulesModal.querySelector("[data-kobposh-tournament-rules-close]")?.focus?.();
    });
  };
  tournamentRulesModal.__close = closeModal;
  return tournamentRulesModal;
}

function openTournamentRulesModal() {
  const modal = ensureTournamentRulesModal();
  modal.__open?.();
}

async function registerCurrentUserToTournament() {
  if (tournamentRegisterBusy) return;
  if (tournamentAlreadyRegistered) return;
  const uid = String(auth.currentUser?.uid || "").trim();
  if (!uid) {
    openAuthScreen("login");
    return;
  }
  if (!currentTournamentGameState?.key) {
    openTournamentFeedbackModal({
      eyebrow: "ERÈ CHAMPIONNA",
      title: "Jwèt la pa valid",
      text: "Nou pa rive idantifye championna jwèt sa a. Tanpri fèmen fenèt la epi eseye ankò.",
    });
    return;
  }

  tournamentRegisterBusy = true;
  updateTournamentRegisterPrimaryButton();

  try {
    const pendingHtgAmount = getPendingHtgAmount(latestHomeFundingData, latestHomeClientData);
    if (pendingHtgAmount > 0) {
      openTournamentFeedbackModal({
        eyebrow: "ENSKRIPSYON BLOKE",
        title: "Ou gen HTG an atant sou kont ou",
        text: `Ou pa ka enskri nan championna a pandan ou gen ${formatHtg(pendingHtgAmount)} an atant. Tann validsyon an fini avan ou eseye anko.`,
      });
      return;
    }

    const currentBalanceHtg = getCurrentHomeWalletTotalHtg();
    if (currentBalanceHtg < TOURNAMENT_REGISTER_COST_HTG) {
      const missing = Math.max(0, TOURNAMENT_REGISTER_COST_HTG - currentBalanceHtg);
      openTournamentFeedbackModal({
        eyebrow: "SOLDE ENSIFIZAN",
        title: "Ou pa gen ase HTG",
        text: `Ou bezwen ${missing} HTG anplis pou enskri nan championna a.`,
      });
      return;
    }

    await walletMutateSecure({
      op: "game_entry",
      amountDoes: TOURNAMENT_REGISTER_COST_DOES,
      amountGourdes: TOURNAMENT_REGISTER_COST_HTG,
      fundingCurrency: "htg",
    });

    const username = getTournamentDisplayUsername();
    const gameKey = currentTournamentGameState.key;
    const gameName = String(currentTournamentGameState.name || "").trim() || "Championna";
    const registrationRef = doc(db, "tournamentRegistrations", `${gameKey}_${uid}`);
    await setDoc(registrationRef, {
      uid,
      username,
      gameKey,
      gameName,
      costHtg: TOURNAMENT_REGISTER_COST_HTG,
      createdAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    tournamentAlreadyRegistered = true;
    updateTournamentRegisterPrimaryButton();
    openTournamentFeedbackModal({
      eyebrow: "ENSKRIPSYON KONFIME",
      title: `Byenveni nan championna ${gameName}`,
      text: `${TOURNAMENT_REGISTER_COST_HTG} HTG deja debite sou kont ou. Non ou antre nan lis moun ki enskri yo.`,
    });
    refreshHomeLiveSurface();
  } catch (error) {
    const rawMessage = String(error?.message || "");
    const looksLikeCorsFailure = /cors|failed to fetch|network request failed|preflight/i.test(rawMessage);
    const message = looksLikeCorsFailure
      ? "Enskripsyon an pa pase sou localhost akoz blokaj CORS sou backend wallet la. Teste sou domain deploye a oswa aktive route API backend ki otorize origin lokal la."
      : String(error?.message || "Enskripsyon an pa pase. Tanpri eseye anko.");
    openTournamentFeedbackModal({
      eyebrow: "ENSKRIPSYON ECHOUE",
      title: "Nou pa rive valide enskripsyon an",
      text: message,
    });
  } finally {
    tournamentRegisterBusy = false;
    updateTournamentRegisterPrimaryButton();
  }
}

function formatDepositAmount(value) {
  return formatHtg(value);
}

function ensureDepositModal() {
  if (depositModal) return depositModal;

  depositModal = document.createElement("section");
  depositModal.className = "deposit-modal";
  depositModal.setAttribute("aria-hidden", "true");
  depositModal.innerHTML = `
    <div class="deposit-modal__panel" role="dialog" aria-modal="true" aria-labelledby="depositModalTitle">
      <header class="deposit-modal__header">
        <button class="deposit-modal__back" type="button" aria-label="Femen depo a" data-close-deposit-modal>
          <i data-lucide="arrow-left" class="icon icon--modal-back" aria-hidden="true"></i>
        </button>

        <div class="deposit-modal__brand">
          <p class="deposit-modal__eyebrow">DEPO</p>
          <h2 id="depositModalTitle" class="deposit-modal__title">Fe yon depo</h2>
        </div>

        <div class="deposit-modal__badge">Kobposh</div>
      </header>

      <div class="deposit-modal__body">
        <div class="deposit-modal__card">
          <p class="deposit-modal__lead">
            Mete kantite lajan ou vle depoze a.
          </p>

          <div class="deposit-modal__field">
            <label class="deposit-modal__label" for="depositAmount">Montan depo (HTG)</label>
            <input
              id="depositAmount"
              class="deposit-modal__input"
              type="number"
              min="25"
              step="1"
              inputmode="numeric"
              value="25"
            />
          </div>

          <div class="deposit-modal__chips" aria-label="Kantite rapid">
            <button class="deposit-modal__chip is-active" type="button" data-deposit-amount-chip="25">25</button>
            <button class="deposit-modal__chip" type="button" data-deposit-amount-chip="50">50</button>
            <button class="deposit-modal__chip" type="button" data-deposit-amount-chip="100">100</button>
            <button class="deposit-modal__chip" type="button" data-deposit-amount-chip="250">250</button>
          </div>

          <div class="deposit-modal__summary" aria-live="polite">
            <span>Total ou pral antre a</span>
            <strong data-deposit-total>25 HTG</strong>
          </div>

          <div class="deposit-modal__note">
          Depo sa a ap antre nan HTG an atant. Asire montan an korek anvan ou kontinye.
          </div>

          <div class="deposit-modal__error" data-deposit-error></div>

          <button class="deposit-modal__submit" type="button" data-deposit-submit>
            Kontinye nan depo a
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(depositModal);
  renderIconsSafely();

  depositAmountInput = depositModal.querySelector("#depositAmount");
  depositAmountSummary = depositModal.querySelector("[data-deposit-total]");
  depositErrorEl = depositModal.querySelector("[data-deposit-error]");
  depositSubmitBtn = depositModal.querySelector("[data-deposit-submit]");
  const closeBtn = depositModal.querySelector("[data-close-deposit-modal]");

  const syncAmountState = (amountValue, { forceInputValue = false } = {}) => {
    const rawValue = String(amountValue ?? "").trim();
    const parsedAmount = Math.floor(Number(rawValue || 0));
    const hasValidPositiveDraft = Number.isFinite(parsedAmount) && parsedAmount > 0;
    const normalizedAmount = hasValidPositiveDraft ? parsedAmount : 0;

    if (depositAmountInput && forceInputValue) {
      depositAmountInput.value = normalizedAmount > 0 ? String(normalizedAmount) : "";
    }
    if (depositAmountSummary) {
      depositAmountSummary.textContent = normalizedAmount > 0
        ? formatDepositAmount(normalizedAmount)
        : "-- HTG";
    }

    depositModal.querySelectorAll("[data-deposit-amount-chip]").forEach((chip) => {
      const chipAmount = Number(chip.getAttribute("data-deposit-amount-chip") || 0);
      chip.classList.toggle("is-active", chipAmount === normalizedAmount);
    });
  };

  depositAmountInput?.addEventListener("input", () => {
    syncAmountState(depositAmountInput.value);
    if (depositErrorEl) depositErrorEl.textContent = "";
  });

  depositModal.querySelectorAll("[data-deposit-amount-chip]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const amount = Number(chip.getAttribute("data-deposit-amount-chip") || 0);
      syncAmountState(amount, { forceInputValue: true });
      if (depositErrorEl) depositErrorEl.textContent = "";
    });
  });

  closeBtn?.addEventListener("click", closeDepositModal);
  depositModal.addEventListener("click", (event) => {
    if (event.target === depositModal) closeDepositModal();
  });

  depositSubmitBtn?.addEventListener("click", async () => {
    const amount = Math.floor(Number(depositAmountInput?.value || 0));
    if (!Number.isFinite(amount) || amount < 25) {
      if (depositErrorEl) depositErrorEl.textContent = "Mete yon montan ki valab, omwen 25 HTG.";
      return;
    }

    const user = auth.currentUser;
    if (!user?.uid) {
        if (depositErrorEl) depositErrorEl.textContent = "Ou dwe konekte pou fe depo a.";
      return;
    }

    const pendingAmount = await resolvePendingDepositGate();
    if (pendingAmount > 0) {
      if (depositErrorEl) depositErrorEl.textContent = buildPendingDepositGuardMessage(pendingAmount);
      return;
    }

    const clientName =
      user.displayName?.trim()
      || user.email?.split("@")?.[0]?.trim()
      || "Itilizate Kobposh";

    if (amount >= AGENT_ONLY_DEPOSIT_THRESHOLD_HTG) {
      closeDepositModal();
      openHighAmountAgentModal(amount);
      return;
    }

    closeDepositModal();
    activePaymentModal = new PaymentModal({
      amount,
      theme: "kobposh",
      client: {
        id: user.uid,
        uid: user.uid,
        name: clientName,
        email: user.email || "",
        photoURL: user.photoURL || "",
      },
      cart: [
        {
          productId: "kobposh-deposit",
          name: "Depo Kobposh",
          price: amount,
          quantity: 1,
          image: "logokobpash.png",
        },
      ],
      imageBasePath: "./assets/images/",
      onClose: () => {
        activePaymentModal = null;
      },
      onSuccess: () => {},
    });
  });

  syncAmountState(25, { forceInputValue: true });
  return depositModal;
}

function openDepositModal() {
  const pendingAmount = getPendingDepositGuardAmount(latestHomeClientData);
  if (pendingAmount > 0 || getPendingDepositOrderCount(latestHomeClientData) > 0) {
    openDepositPendingModal(pendingAmount);
    return;
  }
  const modal = ensureDepositModal();
  if (!modal) return;
  closeGamesModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
  depositAmountInput?.focus();
  depositAmountInput?.select?.();
}

function closeDepositModal() {
  if (!depositModal) return;
  depositModal.classList.remove("is-open");
  depositModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
  if (depositErrorEl) depositErrorEl.textContent = "";
}

async function resolvePendingDepositGate() {
  const localPendingAmount = getPendingDepositGuardAmount(latestHomeClientData);
  if (localPendingAmount > 0 || getPendingDepositOrderCount(latestHomeClientData) > 0) {
    return localPendingAmount;
  }

  if (!auth.currentUser?.uid) return 0;

  try {
    const fundingStatus = await getDepositFundingStatusSecure({});
    const remotePendingAmount = getPendingDepositGuardAmount(fundingStatus);
    if (remotePendingAmount > 0 || getPendingDepositOrderCount(fundingStatus) > 0) {
      return remotePendingAmount;
    }
  } catch (_) {
    return localPendingAmount;
  }

  return 0;
}

function closeSiteAboutModal() {
  if (!siteAboutModalEl) return;
  siteAboutModalEl.classList.add("hidden");
  siteAboutModalEl.classList.remove("flex");
  siteAboutModalEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function openSiteAboutModal() {
  if (!siteAboutModalEl) return;
  siteAboutModalEl.classList.remove("hidden");
  siteAboutModalEl.classList.add("flex");
  siteAboutModalEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function ensureHomeAgentHelpModal() {
  if (homeAgentHelpModal) return homeAgentHelpModal;

  homeAgentHelpModal = document.createElement("section");
  homeAgentHelpModal.className = "kobposh-forgot-modal";
  homeAgentHelpModal.setAttribute("aria-hidden", "true");
  homeAgentHelpModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhHomeAgentHelpTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-home-agent-help-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">ASISTANS</p>
      <h2 id="kobposhHomeAgentHelpTitle" class="kobposh-forgot-modal__title">Opimion w enpotan, ou enpotan</h2>
      <p class="kobposh-forgot-modal__text">
        Siw rankontre on probleme klike sou bouton anba a pou kontakte on agent, site la fet pou fe kob li pa fet pou pran kob ou, sou Kobpoch se plis ou fo pliss ou fe lajan.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-home-agent-help-contact>
        Kontakte agent an
      </button>
    </div>
  `;

  document.body.appendChild(homeAgentHelpModal);
  renderIconsSafely();

  homeAgentHelpModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === homeAgentHelpModal || target?.closest("[data-kobposh-home-agent-help-close]")) {
      closeHomeAgentHelpModal();
      return;
    }
    if (target?.closest("[data-kobposh-home-agent-help-contact]")) {
      const whatsappUrl = buildWhatsappUrlForKey(
        "support_default",
        "Bonjou, mwen gen yon pwoblem sou Kobpoch epi mwen bezwen pale ak yon agent."
      );
      closeHomeAgentHelpModal();
      if (whatsappUrl) window.location.href = whatsappUrl;
    }
  });

  return homeAgentHelpModal;
}

function openHomeAgentHelpModal() {
  const modal = ensureHomeAgentHelpModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function closeHomeAgentHelpModal() {
  if (!homeAgentHelpModal) return;
  homeAgentHelpModal.classList.remove("is-open");
  homeAgentHelpModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function ensureAccountFrozenAlertModal() {
  if (accountFrozenAlertModal) return accountFrozenAlertModal;

  accountFrozenAlertModal = document.createElement("section");
  accountFrozenAlertModal.className = "kobposh-forgot-modal";
  accountFrozenAlertModal.setAttribute("aria-hidden", "true");
  accountFrozenAlertModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhAccountFrozenTitle">
      <p class="kobposh-forgot-modal__eyebrow">DEMANN DEPOT</p>
      <h2 id="kobposhAccountFrozenTitle" class="kobposh-forgot-modal__title">Demande depo w fe a gen on probleme</h2>
      <p class="kobposh-forgot-modal__text">
        Li rejeter, compte ou an suspendu, kontakte on agent poul debloke kont ou an pou ou.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-account-frozen-contact>
        Kontakte agent an
      </button>
    </div>
  `;

  document.body.appendChild(accountFrozenAlertModal);
  renderIconsSafely();

  accountFrozenAlertModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-kobposh-account-frozen-contact]")) {
      const whatsappUrl = buildWhatsappUrlForKey(
        "support_default",
        "Bonjou, yon depo mwen te fe rejte epi kont mwen sispann. Tanpri ede m debloke kont mwen."
      );
      if (whatsappUrl) window.location.href = whatsappUrl;
    }
  });

  return accountFrozenAlertModal;
}

function openAccountFrozenAlertModal() {
  const modal = ensureAccountFrozenAlertModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function closeAccountFrozenAlertModal() {
  if (!accountFrozenAlertModal) return;
  accountFrozenAlertModal.classList.remove("is-open");
  accountFrozenAlertModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function getSupportTopicByKey(topicKey = "") {
  const normalizedKey = String(topicKey || "").trim().toLowerCase();
  return SUPPORT_HELP_TOPICS.find((item) => String(item.key || "").toLowerCase() === normalizedKey) || null;
}

function renderSupportHelpList() {
  const modal = ensureSupportHelpModal();
  const titleEl = modal.querySelector("[data-kobposh-support-title]");
  const introEl = modal.querySelector("[data-kobposh-support-intro]");
  const listEl = modal.querySelector("[data-kobposh-support-list]");
  const detailEl = modal.querySelector("[data-kobposh-support-detail]");
  const contactWrapEl = modal.querySelector("[data-kobposh-support-contact-wrap]");
  const backBtn = modal.querySelector("[data-kobposh-support-back]");

  if (titleEl) titleEl.textContent = "Sevis kliyan 24/7";
  if (introEl) introEl.textContent = "Issit la wap jwenn bon jan enfomasyon kap ede w konprann site la ak lot koze.";
  if (listEl) {
    listEl.innerHTML = SUPPORT_HELP_TOPICS.map((item) => `
      <button class="kobposh-support-help__topic" type="button" data-kobposh-support-topic="${item.key}">
        <span class="kobposh-support-help__topic-icon">
          <i data-lucide="${item.icon || "circle-help"}" class="icon" aria-hidden="true"></i>
        </span>
        <span class="kobposh-support-help__topic-text">
          <strong>${item.label}</strong>
          <small>Peze pou w jwenn etap pa etap</small>
        </span>
      </button>
    `).join("");
    renderIconsSafely();
  }
  if (detailEl) detailEl.innerHTML = "";
  if (contactWrapEl) contactWrapEl.hidden = false;
  if (backBtn) backBtn.hidden = true;
}

function renderSupportHelpDetail(topicKey = "") {
  const topic = getSupportTopicByKey(topicKey);
  if (!topic) {
    renderSupportHelpList();
    return;
  }

  const modal = ensureSupportHelpModal();
  const titleEl = modal.querySelector("[data-kobposh-support-title]");
  const introEl = modal.querySelector("[data-kobposh-support-intro]");
  const listEl = modal.querySelector("[data-kobposh-support-list]");
  const detailEl = modal.querySelector("[data-kobposh-support-detail]");
  const contactWrapEl = modal.querySelector("[data-kobposh-support-contact-wrap]");
  const backBtn = modal.querySelector("[data-kobposh-support-back]");

  if (titleEl) titleEl.textContent = topic.title;
  if (introEl) introEl.textContent = "";
  if (listEl) listEl.innerHTML = "";
  if (detailEl) {
    const actionConfig = getSupportTopicActionConfig(topic.key);
    const targetsMarkup = Array.isArray(topic.targets) && topic.targets.length
      ? `
      <div class="kobposh-support-help__targets">
        <p class="kobposh-support-help__targets-title">Sa pou peze egzakteman:</p>
        <div class="kobposh-support-help__targets-grid">
          ${topic.targets.map((target) => `<span class="kobposh-support-help__target-chip">${target}</span>`).join("")}
        </div>
      </div>
      `
      : "";
    const actionMarkup = actionConfig
      ? `
      <div class="kobposh-support-help__action-wrap">
        <button class="kobposh-support-help__action-btn" type="button" data-kobposh-support-primary-action="${topic.key}">
          ${actionConfig.label}
        </button>
      </div>
      `
      : "";
    detailEl.innerHTML = `
      <div class="kobposh-support-help__article">
        ${targetsMarkup}
        ${topic.body.map((line, index) => `<p><strong>${index + 1}.</strong> ${line}</p>`).join("")}
        ${actionMarkup}
      </div>
    `;
  }
  if (backBtn) backBtn.hidden = false;
  if (contactWrapEl) contactWrapEl.hidden = false;
}

function ensureSupportHelpModal() {
  if (supportHelpModal) return supportHelpModal;

  supportHelpModal = document.createElement("section");
  supportHelpModal.className = "kobposh-support-help-modal";
  supportHelpModal.setAttribute("aria-hidden", "true");
  supportHelpModal.innerHTML = `
    <div class="kobposh-support-help-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhSupportHelpTitle">
      <header class="kobposh-support-help__header">
        <button class="kobposh-support-help__back" type="button" aria-label="Retounen" data-kobposh-support-back hidden>
          <i data-lucide="arrow-left" class="icon icon--modal-back" aria-hidden="true"></i>
        </button>
        <div class="kobposh-support-help__brand">
          <p class="kobposh-support-help__eyebrow">ASISTANS</p>
          <h2 id="kobposhSupportHelpTitle" class="kobposh-support-help__title" data-kobposh-support-title>Sevis kliyan 24/7</h2>
          <p class="kobposh-support-help__intro" data-kobposh-support-intro></p>
        </div>
        <button class="kobposh-support-help__close" type="button" aria-label="Femen modal la" data-kobposh-support-close>
          <i data-lucide="x" class="icon" aria-hidden="true"></i>
        </button>
      </header>
      <div class="kobposh-support-help__content">
        <div class="kobposh-support-help__list" data-kobposh-support-list></div>
        <div class="kobposh-support-help__detail" data-kobposh-support-detail></div>
        <div class="kobposh-support-help__contact-wrap" data-kobposh-support-contact-wrap>
          <button class="kobposh-support-help__contact-btn" type="button" data-kobposh-support-contact-agent>
            Klike la pou kontakte ajan an direkteman
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(supportHelpModal);
  renderIconsSafely();

  supportHelpModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === supportHelpModal || target?.closest("[data-kobposh-support-close]")) {
      closeSupportHelpModal();
      return;
    }
    if (target?.closest("[data-kobposh-support-back]")) {
      renderSupportHelpList();
      return;
    }
    if (target?.closest("[data-kobposh-support-contact-agent]")) {
      const whatsappUrl = buildWhatsappUrlForKey("withdrawal_assistance", "Bonjou, mwen bezwen asistans sou sit la.");
      if (whatsappUrl) window.location.href = whatsappUrl;
      return;
    }
    const primaryActionBtn = target?.closest("[data-kobposh-support-primary-action]");
    if (primaryActionBtn) {
      runSupportHelpTopicAction(primaryActionBtn.getAttribute("data-kobposh-support-primary-action"));
      return;
    }
    const topicBtn = target?.closest("[data-kobposh-support-topic]");
    if (topicBtn) {
      renderSupportHelpDetail(topicBtn.getAttribute("data-kobposh-support-topic"));
    }
  });

  renderSupportHelpList();
  return supportHelpModal;
}

function openSupportHelpModal() {
  const modal = ensureSupportHelpModal();
  renderSupportHelpList();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function closeSupportHelpModal() {
  if (!supportHelpModal) return;
  supportHelpModal.classList.remove("is-open");
  supportHelpModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function ensureForgotPasswordModal() {
  if (forgotPasswordModal) return forgotPasswordModal;

  forgotPasswordModal = document.createElement("section");
  forgotPasswordModal.className = "kobposh-forgot-modal";
  forgotPasswordModal.setAttribute("aria-hidden", "true");
  forgotPasswordModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhForgotTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-forgot-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">REKIPERASYON KONT</p>
      <h2 id="kobposhForgotTitle" class="kobposh-forgot-modal__title">Ou bliye modpas ou?</h2>
      <p class="kobposh-forgot-modal__text">Kontakte yon ajan kounya pou ede w rekipere kont ou rapid.</p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-forgot-contact>
        Kontakte ajan an dirÃ¨kteman
      </button>
    </div>
  `;

  document.body.appendChild(forgotPasswordModal);
  renderIconsSafely();

  forgotPasswordModal.addEventListener("click", (event) => {
    if (event.target === forgotPasswordModal || event.target?.closest?.("[data-kobposh-forgot-close]")) {
      closeForgotPasswordModal();
      return;
    }
    if (event.target?.closest?.("[data-kobposh-forgot-contact]")) {
      const waUrl = buildWhatsappUrlForKey(
        "withdrawal_assistance",
        "Bonjou, mwen bliye modpas kont mwen. Tanpri ede m rekipere li.",
      );
      if (waUrl) window.location.href = waUrl;
    }
  });

  return forgotPasswordModal;
}

function openForgotPasswordModal() {
  const modal = ensureForgotPasswordModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function closeForgotPasswordModal() {
  if (!forgotPasswordModal) return;
  forgotPasswordModal.classList.remove("is-open");
  forgotPasswordModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function ensureHighAmountAgentModal() {
  if (highAmountAgentModal) return highAmountAgentModal;

  highAmountAgentModal = document.createElement("section");
  highAmountAgentModal.className = "kobposh-forgot-modal";
  highAmountAgentModal.setAttribute("aria-hidden", "true");
  highAmountAgentModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhHighAmountAgentTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-high-agent-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">DEPO GWO MONTAN</p>
      <h2 id="kobposhHighAmountAgentTitle" class="kobposh-forgot-modal__title">Pou montan sa a, kontakte yon ajan</h2>
      <p class="kobposh-forgot-modal__text">Depi yon depo rive sou ${AGENT_ONLY_DEPOSIT_THRESHOLD_HTG} HTG oswa plis, li dwe fet atrave yon ajan sou WhatsApp.</p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-high-agent-contact>
        Kontakte ajan an dirÃ¨kteman
      </button>
    </div>
  `;

  document.body.appendChild(highAmountAgentModal);
  renderIconsSafely();

  highAmountAgentModal.addEventListener("click", (event) => {
    if (event.target === highAmountAgentModal || event.target?.closest?.("[data-kobposh-high-agent-close]")) {
      closeHighAmountAgentModal();
      return;
    }
    if (event.target?.closest?.("[data-kobposh-high-agent-contact]")) {
      const waUrl = buildWhatsappUrlForKey(
        "agent_deposit",
        "Bonjou, mwen bezwen fe yon gwo depo. Tanpri ede m kontinye ak ajan an.",
      );
      if (waUrl) window.location.href = waUrl;
    }
  });

  return highAmountAgentModal;
}

function openHighAmountAgentModal(amount = AGENT_ONLY_DEPOSIT_THRESHOLD_HTG) {
  const modal = ensureHighAmountAgentModal();
  const textEl = modal.querySelector(".kobposh-forgot-modal__text");
  const actionEl = modal.querySelector("[data-kobposh-high-agent-contact]");
  const label = getWhatsappContactLabel("agent_deposit");
  if (textEl) {
  textEl.textContent = `Depi yon depo rive sou ${AGENT_ONLY_DEPOSIT_THRESHOLD_HTG} HTG oswa plis, li dwe fet atrave yon ajan sou WhatsApp. Pou ${amount} HTG sa a, kontakte yon ajan pou kontinye.`;
  }
  if (actionEl && label) {
    actionEl.textContent = `Kontakte ajan an sou WhatsApp ${label}`;
  }
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function closeHighAmountAgentModal() {
  if (!highAmountAgentModal) return;
  highAmountAgentModal.classList.remove("is-open");
  highAmountAgentModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function ensureTransferPendingModal() {
  if (transferPendingModal) return transferPendingModal;

  transferPendingModal = document.createElement("section");
  transferPendingModal.className = "kobposh-forgot-modal";
  transferPendingModal.setAttribute("aria-hidden", "true");
  transferPendingModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhTransferPendingTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-transfer-pending-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">TRANSFER BLOKE</p>
      <h2 id="kobposhTransferPendingTitle" class="kobposh-forgot-modal__title">Ou pa ka fe transfer pou kounye a</h2>
      <p class="kobposh-forgot-modal__text" data-kobposh-transfer-pending-text>
        Ou gen HTG an atant sou kont ou. Tout transfer zanmi rete bloke jouk HTG sa yo fin apwouve oswa regle.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-transfer-pending-ok>
        Mwen konprann
      </button>
    </div>
  `;

  document.body.appendChild(transferPendingModal);
  renderIconsSafely();

  transferPendingModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target === transferPendingModal
      || target?.closest("[data-kobposh-transfer-pending-close]")
      || target?.closest("[data-kobposh-transfer-pending-ok]")
    ) {
      closeTransferPendingModal();
    }
  });

  return transferPendingModal;
}

function openTransferPendingModal(pendingAmount = 0) {
  const modal = ensureTransferPendingModal();
  const textEl = modal.querySelector("[data-kobposh-transfer-pending-text]");
  if (textEl) {
    const amountLabel = pendingAmount > 0 ? formatHtg(pendingAmount) : "HTG an atant";
    textEl.textContent = `Ou gen ${amountLabel} an atant sou kont ou. Ou pa ka fe transfer zanmi jouk HTG sa yo fin apwouve oswa regle.`;
  }
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function closeTransferPendingModal() {
  if (!transferPendingModal) return;
  transferPendingModal.classList.remove("is-open");
  transferPendingModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function ensureDameBlockedModal() {
  if (dameBlockedModal) return dameBlockedModal;

  dameBlockedModal = document.createElement("section");
  dameBlockedModal.className = "kobposh-forgot-modal";
  dameBlockedModal.setAttribute("aria-hidden", "true");
  dameBlockedModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhDameBlockedTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-dame-blocked-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">DAME BLOKE</p>
      <h2 id="kobposhDameBlockedTitle" class="kobposh-forgot-modal__title">Ou pa gen ase HTG pou antre nan Dame</h2>
      <p class="kobposh-forgot-modal__text" data-kobposh-dame-blocked-text>
        Ou bezwen omwen ${DAME_PUBLIC_ENTRY_HTG} HTG disponib pou antre nan jeu Dame la.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-dame-blocked-deposit>
        Fe yon depo
      </button>
    </div>
  `;

  document.body.appendChild(dameBlockedModal);
  renderIconsSafely();

  dameBlockedModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target === dameBlockedModal
      || target?.closest("[data-kobposh-dame-blocked-close]")
    ) {
      closeDameBlockedModal();
      return;
    }
    if (target?.closest("[data-kobposh-dame-blocked-deposit]")) {
      closeDameBlockedModal();
      openDepositModal();
    }
  });

  return dameBlockedModal;
}

function openDameBlockedModal(requiredHtg = DAME_PUBLIC_ENTRY_HTG, currentHtg = 0) {
  const modal = ensureDameBlockedModal();
  const textEl = modal.querySelector("[data-kobposh-dame-blocked-text]");
  const safeRequired = Math.max(0, Math.trunc(Number(requiredHtg) || 0));
  const safeCurrent = Math.max(0, Math.trunc(Number(currentHtg) || 0));
  const missingHtg = Math.max(0, safeRequired - safeCurrent);

  if (textEl) {
    if (safeCurrent > 0) {
      textEl.textContent = `Ou bezwen omwen ${formatHtg(safeRequired)} disponib pou antre nan jeu Dame la. Kounye a ou gen ${formatHtg(safeCurrent)}. Sa vle di ou manke ${formatHtg(missingHtg)} toujou.`;
    } else {
      textEl.textContent = `Ou bezwen omwen ${formatHtg(safeRequired)} disponib pou antre nan jeu Dame la. Kounye a ou pa gen HTG disponib sou kont ou.`;
    }
  }

  dameStakeModal?.close?.();
  closeGamesModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.remove("modal-open");
  document.body.classList.add("is-modal-open");
}

function closeDameBlockedModal() {
  if (!dameBlockedModal) return;
  dameBlockedModal.classList.remove("is-open");
  dameBlockedModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

let chessStakeModal = null;

function buildChessUrl({
  roomMode = "",
  friendAction = "",
  inviteCode = "",
  stakeHtg = CHESS_PUBLIC_ENTRY_HTG,
  roomId = "",
  botDifficulty = "fo",
} = {}) {
  const safeStakeHtg = Math.max(0, Math.trunc(Number(stakeHtg) || CHESS_PUBLIC_ENTRY_HTG));
  const params = new URLSearchParams({
    stakeHtg: String(safeStakeHtg),
    roomMode: String(roomMode || "chess_public_bot").trim() || "chess_public_bot",
    botDifficulty: String(botDifficulty || "fo").trim().toLowerCase() || "fo",
  });
  if (friendAction) params.set("friendAction", String(friendAction || "").trim().toLowerCase());
  if (inviteCode) params.set("inviteCode", String(inviteCode || "").trim().toUpperCase());
  if (roomId) params.set("friendChessRoomId", String(roomId || "").trim());
  return `./JS-Chess-Stockfish-Puzzles-main/kobposh-chess.html?${params.toString()}`;
}

function ensureChessStakeModal() {
  if (chessStakeModal) return chessStakeModal;

  const modal = document.createElement("section");
  modal.className = "kobposh-forgot-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhChessModeTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-chess-mode-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">ECHEC</p>
      <h2 id="kobposhChessModeTitle" class="kobposh-forgot-modal__title">Chwazi mode jeu ou</h2>
      <p class="kobposh-forgot-modal__text">
        Gran chanm nan se 25 HTG fixe. Salon prive a komanse depi 25 HTG ak kod envitasyon.
      </p>
      <div class="mt-5 grid gap-3">
        <button class="kobposh-forgot-modal__action" type="button" data-kobposh-chess-public>
          Antre nan gran chanm nan
        </button>
        <button class="kobposh-forgot-modal__secondary" type="button" data-kobposh-chess-private-toggle>
          Ouvri salon prive a
        </button>
      </div>
      <div class="mt-5 hidden rounded-[24px] border border-[#dce5df] bg-[#f8fcf9] p-4 text-left" data-kobposh-chess-private-panel>
        <div class="grid gap-3 sm:grid-cols-2">
          <button class="rounded-[18px] border border-[#cfe4d7] bg-white px-4 py-4 text-left" type="button" data-kobposh-chess-private-action="create">
            <span class="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Create</span>
            <span class="mt-2 block text-lg font-black text-[#18212b]">Nouvo salon prive</span>
          </button>
          <button class="rounded-[18px] border border-[#cfe4d7] bg-white px-4 py-4 text-left" type="button" data-kobposh-chess-private-action="join">
            <span class="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b8a83]">Join</span>
            <span class="mt-2 block text-lg font-black text-[#18212b]">Antre ak kod la</span>
          </button>
        </div>
        <div class="mt-4 space-y-3" data-kobposh-chess-private-create-panel>
          <label class="block text-sm font-semibold text-[#30443a]" for="kobposhChessPrivateStake">Montan salon prive a</label>
          <input id="kobposhChessPrivateStake" class="w-full rounded-[18px] border border-[#dce5df] bg-white px-4 py-3 text-base font-semibold text-[#18212b] outline-none" type="number" min="${CHESS_PRIVATE_MIN_STAKE_HTG}" step="25" value="${CHESS_PRIVATE_MIN_STAKE_HTG}">
          <p class="text-sm text-[#5f6f67]" data-kobposh-chess-private-status></p>
          <button class="kobposh-forgot-modal__action" type="button" data-kobposh-chess-private-create-submit>
            Kreye salon prive a
          </button>
        </div>
        <div class="mt-4 hidden space-y-3" data-kobposh-chess-private-join-panel>
          <label class="block text-sm font-semibold text-[#30443a]" for="kobposhChessInviteCode">Kod salon prive a</label>
          <input id="kobposhChessInviteCode" class="w-full rounded-[18px] border border-[#dce5df] bg-white px-4 py-3 text-base font-semibold uppercase tracking-[0.12em] text-[#18212b] outline-none" type="text" maxlength="12" placeholder="ABCD12">
          <p class="text-sm text-[#5f6f67]" data-kobposh-chess-join-status></p>
          <button class="kobposh-forgot-modal__action" type="button" data-kobposh-chess-private-join-submit>
            Antre nan salon an
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  try {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({ icons: window.lucide.icons, attrs: { class: "icon" } });
    }
  } catch (_) {
  }

  const privatePanel = modal.querySelector("[data-kobposh-chess-private-panel]");
  const createPanel = modal.querySelector("[data-kobposh-chess-private-create-panel]");
  const joinPanel = modal.querySelector("[data-kobposh-chess-private-join-panel]");
  const privateStatusEl = modal.querySelector("[data-kobposh-chess-private-status]");
  const joinStatusEl = modal.querySelector("[data-kobposh-chess-join-status]");
  const privateStakeInput = modal.querySelector("#kobposhChessPrivateStake");
  const inviteInput = modal.querySelector("#kobposhChessInviteCode");

  const close = () => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-modal-open");
  };

  const open = () => {
    if (privatePanel) privatePanel.classList.add("hidden");
    if (createPanel) createPanel.classList.remove("hidden");
    if (joinPanel) joinPanel.classList.add("hidden");
    if (privateStatusEl) privateStatusEl.textContent = "";
    if (joinStatusEl) joinStatusEl.textContent = "";
    if (privateStakeInput) privateStakeInput.value = String(CHESS_PRIVATE_MIN_STAKE_HTG);
    if (inviteInput) inviteInput.value = "";
    closeGamesModal();
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-modal-open");
  };

  const validatePrivateStake = () => {
    const currentBalanceHtg = getCurrentHomeWalletTotalHtg();
    const stakeHtg = Math.max(
      CHESS_PRIVATE_MIN_STAKE_HTG,
      Math.trunc(Number(privateStakeInput?.value || CHESS_PRIVATE_MIN_STAKE_HTG) || CHESS_PRIVATE_MIN_STAKE_HTG)
    );
    if (privateStakeInput) privateStakeInput.value = String(stakeHtg);
    if (currentBalanceHtg < stakeHtg) {
      if (privateStatusEl) {
        privateStatusEl.textContent = `Ou bezwen ${formatHtg(Math.max(0, stakeHtg - currentBalanceHtg))} anplis pou salon sa a.`;
      }
      return { valid: false, stakeHtg };
    }
    if (privateStatusEl) privateStatusEl.textContent = "";
    return { valid: true, stakeHtg };
  };

  const normalizeInviteCode = (value = "") => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");

  modal.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target === modal || target.closest("[data-kobposh-chess-mode-close]")) {
      close();
      return;
    }
    if (target.closest("[data-kobposh-chess-public]")) {
      close();
      window.location.href = buildChessUrl({
        roomMode: "chess_public_bot",
        stakeHtg: CHESS_PUBLIC_ENTRY_HTG,
        botDifficulty: "fo",
      });
      return;
    }
    if (target.closest("[data-kobposh-chess-private-toggle]")) {
      privatePanel?.classList.remove("hidden");
      return;
    }
    if (target.closest("[data-kobposh-chess-private-action=\"create\"]")) {
      createPanel?.classList.remove("hidden");
      joinPanel?.classList.add("hidden");
      return;
    }
    if (target.closest("[data-kobposh-chess-private-action=\"join\"]")) {
      createPanel?.classList.add("hidden");
      joinPanel?.classList.remove("hidden");
      return;
    }
    if (target.closest("[data-kobposh-chess-private-create-submit]")) {
      const stakeState = validatePrivateStake();
      if (!stakeState.valid) return;
      close();
      window.location.href = buildChessUrl({
        roomMode: "chess_friends",
        friendAction: "create",
        stakeHtg: stakeState.stakeHtg,
        botDifficulty: "fo",
      });
      return;
    }
    if (target.closest("[data-kobposh-chess-private-join-submit]")) {
      const inviteCode = normalizeInviteCode(inviteInput?.value || "");
      if (inviteInput) inviteInput.value = inviteCode;
      if (!inviteCode) {
        if (joinStatusEl) joinStatusEl.textContent = "Mete kod salon prive a anvan ou kontinye.";
        return;
      }
      if (joinStatusEl) joinStatusEl.textContent = "";
      close();
      window.location.href = buildChessUrl({
        roomMode: "chess_friends",
        friendAction: "join",
        inviteCode,
        stakeHtg: CHESS_PRIVATE_MIN_STAKE_HTG,
        botDifficulty: "fo",
      });
    }
  });

  privateStakeInput?.addEventListener("input", validatePrivateStake);
  inviteInput?.addEventListener("input", () => {
    if (joinStatusEl) joinStatusEl.textContent = "";
  });

  chessStakeModal = { open, close };
  return chessStakeModal;
}

function ensureUpcomingGameModal() {
  if (upcomingGameModal) return upcomingGameModal;

  upcomingGameModal = document.createElement("section");
  upcomingGameModal.className = "kobposh-forgot-modal";
  upcomingGameModal.setAttribute("aria-hidden", "true");
  upcomingGameModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhUpcomingGameTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-upcoming-game-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">BYENTO DISPONIB</p>
      <h2 id="kobposhUpcomingGameTitle" class="kobposh-forgot-modal__title" data-kobposh-upcoming-game-title>Jwet sa ap vini byento</h2>
      <p class="kobposh-forgot-modal__text" data-kobposh-upcoming-game-text>
        Nou ap prepare jwet sa a sou Kobposh. Le li pare, ou ap ka antre ladan li dirak depi paj dakey la.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-upcoming-game-close>
        Mwen konprann
      </button>
    </div>
  `;

  document.body.appendChild(upcomingGameModal);
  renderIconsSafely();

  upcomingGameModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === upcomingGameModal || target?.closest("[data-kobposh-upcoming-game-close]")) {
      closeUpcomingGameModal();
    }
  });

  return upcomingGameModal;
}

function openUpcomingGameModal(gameKey = "") {
  const modal = ensureUpcomingGameModal();
  const normalizedKey = String(gameKey || "").trim().toLowerCase();
  const label = UPCOMING_GAME_LABELS[normalizedKey] || "Jwet sa";
  const titleEl = modal.querySelector("[data-kobposh-upcoming-game-title]");
  const textEl = modal.querySelector("[data-kobposh-upcoming-game-text]");

  if (titleEl) {
    titleEl.textContent = `${label} ap vini byento`;
  }
  if (textEl) {
    textEl.textContent = `${label} poko disponib sou Kobposh pou kounye a. Nou ap travay sou li pou ou ka jwe li byento depi menm kat sa a.`;
  }

  closeGamesModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.remove("modal-open");
  document.body.classList.add("is-modal-open");
}

function closeUpcomingGameModal() {
  if (!upcomingGameModal) return;
  upcomingGameModal.classList.remove("is-open");
  upcomingGameModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function setAuthMode(mode = "login") {
  const normalizedMode = mode === "signup" ? "signup" : "login";
  authMode = normalizedMode;
  if (loginFieldsEl) loginFieldsEl.hidden = normalizedMode !== "login";
  if (signupFieldsEl) signupFieldsEl.hidden = normalizedMode !== "signup";
  if (forgotPasswordBtn) forgotPasswordBtn.hidden = normalizedMode === "signup";
  if (authCardSubtitleEl) {
    authCardSubtitleEl.textContent = normalizedMode === "signup"
      ? "Kreye kont ou pou komanse."
      : "Konekte pou kontinye.";
  }
  if (authSubmitBtn) {
    authSubmitBtn.textContent = normalizedMode === "signup" ? "Kreye kont" : "Konekte";
  }
  if (signupToggleBtn) {
    signupToggleBtn.textContent = normalizedMode === "signup"
      ? "Ou gen kont deja? konekte la"
      : "Si w pa gen kont, kreye youn la";
  }
  if (authScreenEl) {
    authScreenEl.dataset.mode = normalizedMode;
  }
}

function openAuthScreen(mode = "login") {
  setAuthMode(mode);
  if (!authScreenEl) return;
  authScreenEl.hidden = false;
  authScreenEl.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-auth-locked");
}
window.__kobposhOpenAuthScreen = openAuthScreen;

function closeAuthScreen() {
  if (!authScreenEl) return;
  authScreenEl.hidden = true;
  authScreenEl.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-auth-locked");
  setAuthError("");
}

function openTransferFriendFlow() {
  const user = auth.currentUser || null;
  if (!user?.uid) {
    openAuthScreen("login");
    setAuthError("Tanpri konekte avan pou w ka fe yon transfer ak yon zanmi.");
    return;
  }
  const pendingAmount = getPendingHtgAmount(latestHomeClientData);
  if (pendingAmount > 0) {
    openTransferPendingModal(pendingAmount);
    return;
  }
  window.location.href = "./profile.html?modal=transfer";
}

function ensureDepositPendingModal() {
  if (depositPendingModal) return depositPendingModal;

  const modal = document.createElement("section");
  modal.className = "kobposh-forgot-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhDepositPendingTitle">
      <button class="kobposh-forgot-modal__close" type="button" aria-label="Femen modal la" data-kobposh-deposit-pending-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">Depo bloke</p>
      <h2 id="kobposhDepositPendingTitle" class="kobposh-forgot-modal__title">Ou gen depo an atant deja</h2>
      <p class="kobposh-forgot-modal__text" data-kobposh-deposit-pending-text>
        Ou deja gen yon depo an atant sou kont ou. Tann admin nan valide oswa rejte li avan ou voye yon lot demann depo.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-kobposh-deposit-pending-ok>
        Mwen konprann
      </button>
    </div>
  `;

  document.body.appendChild(modal);
  renderIconsSafely();

  const closeModal = () => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-modal-open");
  };

  modal.querySelector("[data-kobposh-deposit-pending-close]")?.addEventListener("click", closeModal);
  modal.querySelector("[data-kobposh-deposit-pending-ok]")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  depositPendingModal = modal;
  return modal;
}

function openDepositPendingModal(pendingAmount = 0) {
  const modal = ensureDepositPendingModal();
  const textEl = modal.querySelector("[data-kobposh-deposit-pending-text]");
  if (textEl) {
    textEl.textContent = buildPendingDepositGuardMessage(pendingAmount);
  }
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function formatHistoryAmount(value = 0) {
  return `${Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString("fr-FR")} HTG`;
}

function formatHistorySignedAmount(value = 0) {
  const normalized = Math.trunc(Number(value) || 0);
  const sign = normalized > 0 ? "+" : normalized < 0 ? "-" : "";
  return `${sign}${Math.abs(normalized).toLocaleString("fr-FR")} HTG`;
}

function formatHistoryWhen(value) {
  const ts = Number(value || 0);
  if (!Number.isFinite(ts) || ts <= 0) return "Dat pa disponib";
  try {
    return new Intl.DateTimeFormat("fr-HT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return "Dat pa disponib";
  }
}

function ensureHistoryModal() {
  if (historyModal) return historyModal;

  const modal = document.createElement("section");
  modal.className = "kobposh-history-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="kobposh-history-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhHistoryTitle">
      <header class="kobposh-history-modal__header">
        <button class="kobposh-history-modal__back" type="button" aria-label="Retounen" data-kobposh-history-close>
          <i data-lucide="arrow-left" class="icon" aria-hidden="true"></i>
        </button>
        <div>
          <p class="kobposh-history-modal__eyebrow">ISTORIK</p>
          <h2 id="kobposhHistoryTitle" class="kobposh-history-modal__title">Istwa jwèt ou yo</h2>
          <p class="kobposh-history-modal__subtitle">Wè 3 jwèt pa 3 jwèt, ak gan oswa pèt sou chak pati.</p>
        </div>
      </header>

      <div class="kobposh-history-modal__content">
        <div class="kobposh-history-modal__summary">
          <span>3 a la fwa</span>
          <strong data-kobposh-history-status>0 jwèt</strong>
        </div>
        <div class="kobposh-history-modal__list" data-kobposh-history-list></div>
        <p class="kobposh-history-modal__empty" data-kobposh-history-empty hidden>Pa gen istorik jwèt pou montre.</p>
        <button class="kobposh-history-modal__more" type="button" data-kobposh-history-load-more>Chaje 3 lòt</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  renderIconsSafely();

  const stateEl = modal.querySelector("[data-kobposh-history-status]");
  const listEl = modal.querySelector("[data-kobposh-history-list]");
  const emptyEl = modal.querySelector("[data-kobposh-history-empty]");
  const loadMoreBtn = modal.querySelector("[data-kobposh-history-load-more]");
  const closeButtons = Array.from(modal.querySelectorAll("[data-kobposh-history-close]"));

  const state = {
    loading: false,
    offset: 0,
    pageSize: 3,
    total: 0,
    hasMore: true,
    rows: [],
  };

  const close = () => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-modal-open");
  };

  const renderRows = () => {
    if (!listEl || !emptyEl || !loadMoreBtn || !stateEl) return;

    stateEl.textContent = state.loading
      ? "Ap chaje..."
      : state.rows.length
        ? `${state.rows.length} jwèt`
        : "0 jwèt";

    if (!state.rows.length) {
      listEl.innerHTML = "";
      emptyEl.hidden = state.loading;
      emptyEl.textContent = state.loading ? "Ap chaje..." : "Pa gen istorik jwèt pou montre.";
    } else {
      emptyEl.hidden = true;
      listEl.innerHTML = state.rows.map((row) => {
        const won = row?.won === true;
        const resultClass = won ? "win" : "loss";
        const resultLabel = String(row?.resultLabel || (won ? "Genyen" : "Pèdi"));
        const opponentLabel = row?.vsBot
          ? ""
          : String(row?.opponentLabel || "").trim();
        const metaParts = [
          formatHistoryWhen(row?.endedAtMs || row?.createdAtMs),
          opponentLabel,
        ].filter(Boolean);
        const stake = formatHistoryAmount(row?.stakeHtg ?? row?.wageredHtg ?? 0);
        const wonAmount = formatHistoryAmount(row?.wonHtg ?? 0);
        const netHtgRaw = Number.isFinite(Number(row?.netHtg)) ? Number(row.netHtg) : 0;
        const netHtg = formatHistorySignedAmount(netHtgRaw);
        return `
          <article class="kobposh-history-card">
            <div class="kobposh-history-card__top">
              <div>
                <h3 class="kobposh-history-card__title">${String(row?.gameLabel || row?.gameKey || "Jwèt")}</h3>
                <p class="kobposh-history-card__meta">${metaParts.join(" • ")}</p>
              </div>
              <span class="kobposh-history-card__result kobposh-history-card__result--${resultClass}">${resultLabel}</span>
            </div>
            <div class="kobposh-history-card__bottom">
              <span class="kobposh-history-card__amount ${netHtgRaw >= 0 ? "is-win" : "is-loss"}">${netHtg}</span>
              <span class="kobposh-history-card__details">Mise ${stake} · Gain ${wonAmount}</span>
            </div>
          </article>
        `;
      }).join("");
    }

    loadMoreBtn.hidden = !state.hasMore;
    loadMoreBtn.disabled = state.loading;
    loadMoreBtn.textContent = state.loading ? "Ap chaje..." : "Chaje 3 lòt";
  };

  const loadPage = async ({ reset = false } = {}) => {
    if (state.loading) return;
    if (!auth.currentUser) {
      openAuthScreen("login");
      return;
    }

    state.loading = true;
    if (reset) {
      state.offset = 0;
      state.rows = [];
      state.hasMore = true;
      state.total = 0;
    }
    renderRows();

    try {
      const result = await getMyGameHistorySecure({
        offset: state.offset,
        pageSize: state.pageSize,
      });
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      state.total = Math.max(0, Number(result?.total || 0));
      state.rows = reset ? rows : [...state.rows, ...rows];
      state.offset = Math.max(0, Number(result?.offset || 0)) + rows.length;
      state.hasMore = result?.hasMore === true;
    } catch (error) {
      console.warn("[KOBPOSH_V2] history modal load failed", error);
      state.hasMore = false;
    } finally {
      state.loading = false;
      renderRows();
    }
  };

  closeButtons.forEach((button) => button.addEventListener("click", close));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  loadMoreBtn?.addEventListener("click", () => {
    if (!state.hasMore || state.loading) return;
    void loadPage({ reset: false });
  });

  modal.__openHistory = () => {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-modal-open");
    void loadPage({ reset: true });
  };

  historyModal = modal;
  return modal;
}

function openHistoryModal() {
  const modal = ensureHistoryModal();
  if (typeof modal.__openHistory === "function") {
    void modal.__openHistory();
  }
}

function bindPasswordToggles() {
  passwordToggleBtns.forEach((button) => {
    if (button.dataset.bound === "1") return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => {
      const targetId = String(button.dataset.kobposhTogglePassword || "").trim();
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;
      const hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
    });
  });
}

async function upsertClientProfile(user, payload = {}) {
  if (!user?.uid) return;
  const normalizedPhone = normalizeHaitiMobilePhone(payload.phone || "");
  await setDoc(doc(db, "clients", user.uid), {
    uid: user.uid,
    email: String(payload.email || user.email || "").trim(),
    NonItilizate: String(payload.username || "").trim(),
    username: String(payload.username || "").trim(),
    name: String(payload.username || "").trim(),
    displayName: String(payload.username || "").trim(),
    phone: normalizedPhone || "",
    accountFrozen: false,
    withdrawalHold: false,
    approvedHtgAvailable: 0,
    provisionalHtgAvailable: 0,
    playableHtg: 0,
    withdrawableHtg: 0,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });
}

async function loginWithIdentifier(identifier, password) {
  const normalizedIdentifier = String(identifier || "").trim();
  const email = normalizedIdentifier.includes("@")
    ? normalizedIdentifier
    : usernameToSyntheticEmail(normalizedIdentifier);
  return signInWithEmailAndPassword(auth, email, String(password || ""));
}

async function signupWithUsernamePhone(username, phone, password) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedPhone = await ensureSignupPhoneAvailable(phone);
  const email = usernameToSyntheticEmail(normalizedUsername);
  const credential = await createUserWithEmailAndPassword(auth, email, String(password || ""));
  await upsertClientProfile(credential.user, {
    email,
    username: normalizedUsername,
    phone: normalizedPhone,
  });
  return credential;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  setAuthError("");
  setAuthBusy(true);

  try {
    if (authMode === "signup") {
      const username = String(signupUsernameEl?.value || "").trim();
      const phone = String(signupPhoneEl?.value || "").trim();
      const password = String(signupPasswordEl?.value || "");
      const confirmPassword = String(signupPasswordConfirmEl?.value || "");

      if (!isValidUsername(username)) {
        throw new Error("Username la pa bon. Itilize let, chif, pwen, tirÃ¨ oswa underscore.");
      }
      const normalizedPhone = normalizeHaitiMobilePhone(phone);
      if (!normalizedPhone) {
        throw new Error(buildHaitiMobilePhoneError(phone));
      }
      if (password.length < 6) {
        throw new Error("Modpas la dwe gen omwen 6 karakte.");
      }
      if (password !== confirmPassword) {
        throw new Error("De modpas yo pa menm.");
      }
      if (signupAgeEl?.checked !== true) {
        throw new Error("Ou dwe konfime ou gen plis pase 18 an.");
      }
      if (signupTermsEl?.checked !== true) {
        throw new Error("Ou dwe aksepte kondisyon itilizasyon yo.");
      }

      if (signupPhoneEl) signupPhoneEl.value = normalizedPhone;
      await signupWithUsernamePhone(username, normalizedPhone, password);
    } else {
      const identifier = String(loginIdentifierEl?.value || "").trim();
      const password = String(loginPasswordEl?.value || "");
      if (!identifier || !password) {
        throw new Error("Antre username oswa email la ak modpas la.");
      }
      await loginWithIdentifier(identifier, password);
    }

    closeAuthScreen();
    if (pageParams.get("auth")) {
      window.history.replaceState({}, "", "./index.html");
    }
  } catch (error) {
    setAuthError(formatAuthError(error));
  } finally {
    setAuthBusy(false);
  }
}

if (signupToggleBtn && authScreenEl) {
  signupToggleBtn.addEventListener("click", () => {
    const currentMode = authScreenEl.dataset.mode === "signup" ? "signup" : "login";
    setAuthMode(currentMode === "signup" ? "login" : "signup");
  });
}

if (signupPhoneEl) {
  signupPhoneEl.addEventListener("blur", () => {
    const normalizedPhone = normalizeHaitiMobilePhone(signupPhoneEl.value || "");
    if (normalizedPhone) {
      signupPhoneEl.value = normalizedPhone;
    }
  });
}

siteAboutToggleBtn?.addEventListener("click", () => {
  openSiteAboutModal();
});

siteAboutCloseBtns.forEach((button) => {
  button.addEventListener("click", () => {
    closeSiteAboutModal();
  });
});

siteAboutModalEl?.addEventListener("click", (event) => {
  if (event.target === siteAboutModalEl) {
    closeSiteAboutModal();
  }
});

forgotPasswordBtn?.addEventListener("click", () => {
  setAuthError("");
  openForgotPasswordModal();
});

openGamesButtons.forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  openGamesModal();
}));

openTournamentsButtons.forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  openTournamentsModal();
}));

openTournamentRegisterButtons.forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  const gameName = String(button.dataset.tournamentGame || "").trim();
  const imagePath = String(button.dataset.tournamentImage || "").trim();
  openTournamentRegisterModal(gameName, imagePath);
}));

openDepositModalBtns.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!auth.currentUser) {
      openAuthScreen("login");
      return;
    }
    const pendingAmount = await resolvePendingDepositGate();
    if (pendingAmount > 0) {
      openDepositPendingModal(pendingAmount);
      return;
    }
    openDepositModal();
  });
});

if (supportQuickBtn && supportQuickBtn.dataset.bound !== "1") {
  supportQuickBtn.dataset.bound = "1";
  supportQuickBtn.addEventListener("click", (event) => {
    event.preventDefault();
    openSupportHelpModal();
  });
}

if (agentHelpQuickBtn && agentHelpQuickBtn.dataset.bound !== "1") {
  agentHelpQuickBtn.dataset.bound = "1";
  agentHelpQuickBtn.addEventListener("click", (event) => {
    event.preventDefault();
    openHomeAgentHelpModal();
  });
}

closeGamesButtons.forEach((button) => button.addEventListener("click", closeGamesModal));
closeTournamentsButtons.forEach((button) => button.addEventListener("click", closeTournamentsModal));
closeTournamentRegisterButtons.forEach((button) => button.addEventListener("click", () => {
  closeTournamentRegisterModal();
  openTournamentsModal();
}));

gamesModal?.addEventListener("click", (event) => {
  if (event.target === gamesModal) {
    closeGamesModal();
  }
});

tournamentsModal?.addEventListener("click", (event) => {
  if (event.target === tournamentsModal) {
    closeTournamentsModal();
  }
});

tournamentRegisterModal?.addEventListener("click", (event) => {
  if (event.target === tournamentRegisterModal) {
    closeTournamentRegisterModal();
    openTournamentsModal();
  }
});

tournamentRegisterSubmitBtn?.addEventListener("click", () => {
  void openTournamentRegisterPaymentGate();
});

tournamentRegisterRulesBtn?.addEventListener("click", () => {
  openTournamentRulesModal();
});

openHistoryButtons.forEach((button) => {
  if (button.dataset.boundHistoryModal === "1") return;
  button.dataset.boundHistoryModal = "1";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openHistoryModal();
  });
});

bindPasswordToggles();
loginFormEl?.addEventListener("submit", handleAuthSubmit);

profileLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    if (auth.currentUser) return;
    event.preventDefault();
    openAuthScreen("login");
  });
});

if (transferFriendBtn && transferFriendBtn.dataset.bound !== "1") {
  transferFriendBtn.dataset.bound = "1";
  transferFriendBtn.addEventListener("click", (event) => {
    event.preventDefault();
    openTransferFriendFlow();
  });
}

document.querySelectorAll("[data-kobposh-launch-game]").forEach((button) => {
  button.addEventListener("click", async () => {
    const game = String(button.dataset.kobposhLaunchGame || "").trim();
    if (game === "domino") {
      const modal = ensureDominoModeModal();
      modal.open();
      return;
    }
    if (game === "morpion") {
      if (!auth.currentUser) {
        openAuthScreen("login");
        return;
      }
      window.location.href = "./morpion.html?engine=v2&stake=500&fundingCurrency=htg&stakeHtg=25";
      return;
    }
    if (game === "pong") {
      await launchPongEntry();
      return;
    }
    if (game === "dame") {
      if (!auth.currentUser) {
        openAuthScreen("login");
        return;
      }
      const currentBalanceHtg = getCurrentHomeWalletTotalHtg();
      if (currentBalanceHtg < DAME_PUBLIC_ENTRY_HTG) {
        openDameBlockedModal(DAME_PUBLIC_ENTRY_HTG, currentBalanceHtg);
        return;
      }
      const modal = ensureDameStakeModal();
      modal.open();
      return;
    }
    if (game === "ludo") {
      if (!auth.currentUser) {
        openAuthScreen("login");
        return;
      }
      const canLaunch = await canLaunchPublicGame("ludo");
      if (!canLaunch) return;
      const currentBalanceHtg = getCurrentHomeWalletTotalHtg();
      if (currentBalanceHtg < LUDO_PUBLIC_ENTRY_HTG) {
        openLudoBlockedModal(LUDO_PUBLIC_ENTRY_HTG, currentBalanceHtg);
        return;
      }
      openLudoStakeModal();
      return;
    }
    if (game === "chess") {
      openUpcomingGameModal("chess");
      return;
    }
  });
});

function getPwaPlatform() {
  const userAgent = String(window.navigator.userAgent || "");
  const isiPadOnMac = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;

  if (/iphone|ipad|ipod/i.test(userAgent) || isiPadOnMac) return "ios";
  if (/android/i.test(userAgent)) return "android";
  if (/windows|macintosh|linux|cros/i.test(userAgent)) return "desktop";
  return "other";
}

function isPwaStandalone() {
  const displayModeStandalone = typeof window.matchMedia === "function"
    ? window.matchMedia("(display-mode: standalone)").matches
    : false;
  return displayModeStandalone || window.navigator.standalone === true;
}

function isPwaInstallDismissed() {
  try {
    return window.localStorage.getItem(PWA_MODAL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberPwaInstallDismiss() {
  try {
    window.localStorage.setItem(PWA_MODAL_STORAGE_KEY, "1");
  } catch {
    // Ignore storage errors and keep the UX functional.
  }
}

function clearPwaInstallDismiss() {
  try {
    window.localStorage.removeItem(PWA_MODAL_STORAGE_KEY);
  } catch {
    // Ignore storage errors and keep the UX functional.
  }
}

function isWelcomeCoordinatorDismissed() {
  try {
    return window.localStorage.getItem(WELCOME_COORDINATOR_MODAL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberWelcomeCoordinatorDismiss() {
  try {
    window.localStorage.setItem(WELCOME_COORDINATOR_MODAL_STORAGE_KEY, "1");
  } catch {
    // Ignore storage errors and keep the UX functional.
  }
}

function buildChampionnaCoordinatorWhatsappUrl() {
  const message = "Bonjou, mwen sou Kobposh pou Championna a. Mwen bezwen pale ak yon kowodonate.";
  return `https://wa.me/${CHAMPIONNA_COORDINATOR_WHATSAPP}?text=${encodeURIComponent(message)}`;
}

function isWelcomeCoordinatorModalOpen() {
  return Boolean(welcomeCoordinatorModalRefs?.overlay?.classList.contains("is-open"));
}

function closeWelcomeCoordinatorModal({ persistDismiss = false } = {}) {
  if (!welcomeCoordinatorModalRefs) {
    if (persistDismiss) rememberWelcomeCoordinatorDismiss();
    return;
  }

  if (persistDismiss) rememberWelcomeCoordinatorDismiss();
  const { overlay } = welcomeCoordinatorModalRefs;
  if (overlay.contains(document.activeElement)) {
    document.activeElement?.blur?.();
  }
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function ensureWelcomeCoordinatorModal() {
  if (welcomeCoordinatorModalRefs) return welcomeCoordinatorModalRefs;

  const overlay = document.createElement("section");
  overlay.className = "kobposh-welcome-modal";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="kobposh-welcome-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhWelcomeTitle">
      <button class="kobposh-welcome-modal__close" type="button" aria-label="Femen mesaj la" data-kobposh-welcome-close>
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <div class="kobposh-welcome-modal__hero" aria-hidden="true">
        <img src="./assets/images/championna.png" alt="" class="kobposh-welcome-modal__hero-img" />
        <span class="kobposh-welcome-modal__live-pill">Championna Kobposh</span>
      </div>
      <div class="kobposh-welcome-modal__content">
        <p class="kobposh-welcome-modal__eyebrow">Byenveni sou Kobposh</p>
        <h2 class="kobposh-welcome-modal__title" id="kobposhWelcomeTitle">Ou la pou yon championna?</h2>
        <p class="kobposh-welcome-modal__text">
          Si ou nouvo sou sit la oswa ou vini pou championna a, yon kowodonate ka ede ou konprann kijan pou enskri,
          kijan pou jwe, epi kijan pou antre nan gwoup WhatsApp ofisyel la.
        </p>
        <div class="kobposh-welcome-modal__highlights" aria-label="Sa kowodonate a ka ede ou fe">
          <span><i data-lucide="message-circle" class="icon" aria-hidden="true"></i> Pale ak kowodonate a</span>
          <span><i data-lucide="trophy" class="icon" aria-hidden="true"></i> Konprann championna a</span>
        </div>
        <div class="kobposh-welcome-modal__actions">
          <a class="kobposh-welcome-modal__button kobposh-welcome-modal__button--primary" href="${buildChampionnaCoordinatorWhatsappUrl()}" data-kobposh-welcome-whatsapp>
            Kontakte sou WhatsApp
          </a>
          <button class="kobposh-welcome-modal__button kobposh-welcome-modal__button--secondary" type="button" data-kobposh-welcome-dismiss>
            Pa montre mesaj sa anko
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  renderIconsSafely();

  const refs = {
    overlay,
    close: overlay.querySelector("[data-kobposh-welcome-close]"),
    dismiss: overlay.querySelector("[data-kobposh-welcome-dismiss]"),
    whatsapp: overlay.querySelector("[data-kobposh-welcome-whatsapp]"),
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeWelcomeCoordinatorModal();
    }
  });

  refs.close?.addEventListener("click", () => {
    closeWelcomeCoordinatorModal();
  });

  refs.dismiss?.addEventListener("click", () => {
    closeWelcomeCoordinatorModal({ persistDismiss: true });
  });

  welcomeCoordinatorModalRefs = refs;
  return refs;
}

function openWelcomeCoordinatorModal(force = false) {
  if (!force && isWelcomeCoordinatorDismissed()) return;
  const refs = ensureWelcomeCoordinatorModal();
  refs.overlay.classList.add("is-open");
  refs.overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
  window.setTimeout(() => refs.whatsapp?.focus?.(), 60);
}

function scheduleWelcomeCoordinatorModal(delayMs = WELCOME_COORDINATOR_MODAL_DELAY_MS) {
  if (isWelcomeCoordinatorDismissed()) return;
  window.setTimeout(() => {
    openWelcomeCoordinatorModal();
  }, delayMs);
}

function getPwaInstallConfig() {
  const platform = getPwaPlatform();
  const hasNativePrompt = Boolean(deferredPwaInstallPrompt);

  if (platform === "ios") {
    return {
      platformLabel: "iPhone / iPad",
      title: "Ajoute Kobposh sou ekran ou",
      description: "Sou iPhone oswa iPad, ou ka mete Kobposh tankou yon app pou louvri l pi vit epi retounen sou li fasil.",
      steps: [
        "Louvri sit la nan Safari epi peze bouton Pataje a.",
        "Chwazi Add to Home Screen oswa Ajouter sur l'ecran d'accueil.",
        "Peze Ajouter pou mete Kobposh sou ekran prensipal ou.",
      ],
      primaryLabel: "Mwen konprann",
      secondaryLabel: "Mwen pa enterese",
      note: "Sou iPhone, pa gen bouton install otomatik. Metod Safari a se bon fason pou mete app la sou ekran an.",
    };
  }

  if (hasNativePrompt) {
    const isDesktop = platform === "desktop";
    return {
      platformLabel: isDesktop ? "PC / Desktop" : "Android",
      title: isDesktop ? "Installe Kobposh sur votre PC" : "Telechaje app Kobposh la",
      description: isDesktop
        ? "Kenbe Kobposh sou desktop ou pou antre pi vit nan jwèt yo ak jwenn aksè rapid ak kont ou."
        : "Ajoute Kobposh sou telefòn ou pou louvri li tankou yon vrè app epi antre pi vit nan jwèt yo.",
      steps: [
        "Peze bouton enstalasyon an anba a.",
        "Valide fenet navigatè a lè li mande w konfime instalasyon an.",
        "Lanse Kobposh depi icon lan sou ekran ou oswa nan lis aplikasyon yo.",
      ],
      primaryLabel: isDesktop ? "Installer sur ce PC" : "Enstale kounye a",
      secondaryLabel: "Mwen pa enterese",
      note: "Apre enstalasyon an, Kobposh ap pi fasil pou relanse epi li ka sanble plis ak yon app natif.",
    };
  }

  if (platform === "android" || platform === "desktop") {
    return {
      platformLabel: platform === "desktop" ? "PC / Desktop" : "Android",
      title: "Kenbe Kobposh pi pre ou",
      description: "Si navigatè a poko montre bouton install la, ou ka toujou ajoute Kobposh manyelman depi meni navigatè a.",
      steps: [
        "Louvri meni navigatè a.",
        "Chèche opsyon Install app, Installer l'application oswa Add to Home Screen.",
        "Konfime aksyon an pou kenbe Kobposh pi pre ou.",
      ],
      primaryLabel: "Mwen konprann",
      secondaryLabel: "Mwen pa enterese",
      note: "Disponibilite opsyon an ka chanje selon navigatè a, men sou Chrome li parèt pi souvan pou Android ak desktop.",
    };
  }

  return null;
}

function updatePwaInstallModalContent() {
  if (!pwaInstallModalRefs) return;
  const config = getPwaInstallConfig();
  if (!config) return;

  pwaInstallModalRefs.platform.textContent = config.platformLabel;
  pwaInstallModalRefs.title.textContent = config.title;
  pwaInstallModalRefs.description.textContent = config.description;
  pwaInstallModalRefs.primary.textContent = config.primaryLabel;
  pwaInstallModalRefs.secondary.textContent = config.secondaryLabel;
  pwaInstallModalRefs.note.textContent = config.note;
  pwaInstallModalRefs.steps.innerHTML = config.steps
    .map(
      (step, index) => `
        <li class="pwa-install-modal__step">
          <span class="pwa-install-modal__step-index">${index + 1}</span>
          <span class="pwa-install-modal__step-text">${step}</span>
        </li>
      `,
    )
    .join("");
}

function closePwaInstallModal({ persistDismiss = false } = {}) {
  if (!pwaInstallModalRefs) {
    if (persistDismiss) rememberPwaInstallDismiss();
    return;
  }

  if (persistDismiss) rememberPwaInstallDismiss();
  pwaInstallModalRefs.overlay.classList.remove("is-open");
  pwaInstallModalRefs.overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function ensurePwaInstallModal() {
  if (pwaInstallModalRefs) return pwaInstallModalRefs;

  const overlay = document.createElement("section");
  overlay.className = "pwa-install-modal";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="pwa-install-modal__panel" role="dialog" aria-modal="true" aria-labelledby="kobposhPwaInstallTitle">
      <div class="pwa-install-modal__header">
        <div>
          <p class="pwa-install-modal__eyebrow">Kobposh app</p>
          <h2 class="pwa-install-modal__title" id="kobposhPwaInstallTitle"></h2>
        </div>
        <button class="pwa-install-modal__close" type="button" aria-label="Femen fenet la" data-kobposh-close-pwa-install>
          <i data-lucide="x" class="icon" aria-hidden="true"></i>
        </button>
      </div>
      <div class="pwa-install-modal__body">
        <div class="pwa-install-modal__hero">
          <div class="pwa-install-modal__brand">
            <img src="./assets/images/logokobpash.png" alt="Kobposh" class="pwa-install-modal__brand-mark" />
            <div class="pwa-install-modal__brand-copy">
              <p class="pwa-install-modal__description"></p>
            </div>
          </div>
          <div class="pwa-install-modal__platform"></div>
        </div>
        <div class="pwa-install-modal__benefits">
          <div class="pwa-install-modal__benefit">Aksè pi rapid sou kont ou ak jwèt yo</div>
          <div class="pwa-install-modal__benefit">Eksperyans pi pre yon app sou mobil ak desktop</div>
        </div>
        <ol class="pwa-install-modal__steps"></ol>
        <p class="pwa-install-modal__note"></p>
        <div class="pwa-install-modal__actions">
          <button class="pwa-install-modal__button pwa-install-modal__button--primary" type="button" data-kobposh-pwa-primary></button>
          <button class="pwa-install-modal__button pwa-install-modal__button--secondary" type="button" data-kobposh-pwa-secondary></button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  renderIconsSafely();

  const refs = {
    overlay,
    title: overlay.querySelector(".pwa-install-modal__title"),
    description: overlay.querySelector(".pwa-install-modal__description"),
    platform: overlay.querySelector(".pwa-install-modal__platform"),
    steps: overlay.querySelector(".pwa-install-modal__steps"),
    note: overlay.querySelector(".pwa-install-modal__note"),
    primary: overlay.querySelector("[data-kobposh-pwa-primary]"),
    secondary: overlay.querySelector("[data-kobposh-pwa-secondary]"),
    close: overlay.querySelector("[data-kobposh-close-pwa-install]"),
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closePwaInstallModal();
    }
  });

  refs.close?.addEventListener("click", () => {
    closePwaInstallModal();
  });

  refs.secondary?.addEventListener("click", () => {
    closePwaInstallModal({ persistDismiss: true });
  });

  refs.primary?.addEventListener("click", async () => {
    if (!deferredPwaInstallPrompt) {
      closePwaInstallModal({ persistDismiss: false });
      return;
    }

    const promptEvent = deferredPwaInstallPrompt;
    deferredPwaInstallPrompt = null;
    rememberPwaInstallDismiss();

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === "accepted") {
        closePwaInstallModal({ persistDismiss: false });
        return;
      }
    } catch (error) {
      console.warn("[KOBPOSH_PWA] install prompt failed", error);
    }

    closePwaInstallModal({ persistDismiss: false });
  });

  pwaInstallModalRefs = refs;
  updatePwaInstallModalContent();
  return refs;
}

function openPwaInstallModal(force = false) {
  if (isPwaStandalone()) return;
  if (!force && isPwaInstallDismissed()) return;
  const config = getPwaInstallConfig();
  if (!config) return;

  const refs = ensurePwaInstallModal();
  updatePwaInstallModalContent();
  refs.overlay.classList.add("is-open");
  refs.overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function schedulePwaInstallModal(delayMs = PWA_MODAL_INITIAL_DELAY_MS) {
  if (isPwaStandalone() || isPwaInstallDismissed()) return;
  if (!getPwaInstallConfig()) return;

  if (pwaInstallModalTimer) {
    window.clearTimeout(pwaInstallModalTimer);
  }

  pwaInstallModalTimer = window.setTimeout(() => {
    pwaInstallModalTimer = null;
    if (isWelcomeCoordinatorModalOpen()) {
      schedulePwaInstallModal(2500);
      return;
    }
    openPwaInstallModal();
  }, delayMs);
}

function registerKobposhServiceWorker() {
  if (!("serviceWorker" in window.navigator)) return;

  window.addEventListener("load", () => {
    window.navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch((error) => {
      console.warn("[KOBPOSH_PWA] service worker registration failed", error);
    });
  }, { once: true });
}

function initPwaInstallExperience() {
  registerKobposhServiceWorker();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPwaInstallPrompt = event;
    updatePwaInstallModalContent();
    schedulePwaInstallModal(900);
  });

  window.addEventListener("appinstalled", () => {
    deferredPwaInstallPrompt = null;
    rememberPwaInstallDismiss();
    closePwaInstallModal({ persistDismiss: false });
  });

  if (!isPwaStandalone()) {
    schedulePwaInstallModal();
  }
}

const LUCIDE_PATHS = {
  "arrow-left": '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
  "arrow-down-to-line": '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
  "arrow-up-right": '<path d="M7 7h10v10"></path><path d="M7 17 17 7"></path>',
  circle: '<circle cx="12" cy="12" r="10"></circle>',
  "eye": '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>',
  "x": '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  "gamepad-2": '<line x1="6" x2="10" y1="11" y2="11"></line><line x1="8" x2="8" y1="9" y2="13"></line><line x1="15" x2="15.01" y1="12" y2="12"></line><line x1="18" x2="18.01" y1="10" y2="10"></line><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59c-.16 1.6-.35 3.44-.7 5.41-.36 2.04.91 4 2.88 4.53 1.62.43 3.02-.56 3.69-1.96l.44-.91A2 2 0 0 1 10.8 14h2.4a2 2 0 0 1 1.79 1.11l.44.91c.67 1.4 2.07 2.39 3.69 1.96 1.97-.53 3.24-2.49 2.88-4.53-.35-1.97-.54-3.81-.7-5.41A4 4 0 0 0 17.32 5Z"></path>',
  "grid-3x3": '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M9 3v18"></path><path d="M15 3v18"></path><path d="M3 9h18"></path><path d="M3 15h18"></path>',
  "headset": '<path d="M3 11a9 9 0 0 1 18 0"></path><path d="M21 16v-5"></path><path d="M3 16v-5"></path><path d="M21 16a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"></path><path d="M3 16a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z"></path><path d="M16 20h-2a2 2 0 0 1-2-2v-1"></path>',
  "history": '<path d="M3 3v5h5"></path><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"></path><path d="M12 7v5l4 2"></path>',
  "house": '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path><path d="M3 10.5 12 3l9 7.5"></path><path d="M5 10v11h14V10"></path>',
  "landmark": '<line x1="3" x2="21" y1="22" y2="22"></line><line x1="6" x2="6" y1="18" y2="11"></line><line x1="10" x2="10" y1="18" y2="11"></line><line x1="14" x2="14" y1="18" y2="11"></line><line x1="18" x2="18" y1="18" y2="11"></line><polygon points="12 2 20 7 4 7"></polygon>',
  "layout-grid": '<rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect>',
  "message-circle": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>',
  "send": '<path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path>',
  "user-round": '<circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 0 0-16 0"></path>',
  "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
  "wallet": '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5"></path><path d="M18 12h.01"></path>',
};

function createLocalLucideIcon(name, className = "") {
  const paths = LUCIDE_PATHS[name];
  if (!paths) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", className);
  svg.innerHTML = paths;
  return svg;
}

function renderLocalLucideIcons() {
  document.querySelectorAll("[data-lucide]").forEach((node) => {
    const name = String(node.getAttribute("data-lucide") || "").trim();
    const icon = createLocalLucideIcon(name, node.getAttribute("class") || "icon");
    if (!icon) return;
    icon.setAttribute("data-lucide", name);
    icon.setAttribute("aria-hidden", node.getAttribute("aria-hidden") || "true");
    node.replaceWith(icon);
  });
}

function renderIconsSafely() {
  // Force local SVG icons so the UI does not depend on Lucide CDN/cache timing.
  renderLocalLucideIcons();
}

renderIconsSafely();
window.addEventListener("DOMContentLoaded", renderIconsSafely);
window.setTimeout(renderIconsSafely, 150);
scheduleWelcomeCoordinatorModal();
window.addEventListener("focus", refreshHomeLiveSurface);
window.addEventListener("pageshow", refreshHomeLiveSurface);
window.addEventListener("storage", refreshHomeLiveSurface);
window.addEventListener("userBalanceUpdated", refreshHomeLiveSurface);
window.addEventListener("xchangeUpdated", refreshHomeLiveSurface);
window.addEventListener("transferUpdated", refreshHomeLiveSurface);
initPwaInstallExperience();
bindHeaderBalanceHistoryShortcut();
mountRetraitModal({ triggerSelector: "#kobposhWithdrawalBtn", theme: "kobposh" });
onAuthStateChanged(auth, (user) => {
  watchCurrentUserWallet(user || null);
  watchWithdrawalDecisionUpdates(user || null);
  if (user) {
    scheduleHomeFundingRefresh(user.uid, 0);
    closeAuthScreen();
  }
});
if (pageParams.get("auth") === "login") {
  openAuthScreen("login");
}
if (pageParams.get("auth") === "signup") {
  openAuthScreen("signup");
}
void refreshKobposhHeroRotation();



