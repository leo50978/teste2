import PaymentModal from "./payment.js";
import { getXchangeState } from "./xchange.js";
import {
  auth,
  db,
  collection,
  query,
  orderBy,
  getDocs,
  onAuthStateChanged,
} from "./firebase-init.js";
import { cancelWithdrawalSecure, getDepositFundingStatusSecure, orderClientActionSecure } from "./secure-functions.js";
import {
  buildWhatsappUrlForKey,
  getWhatsappContactLabel,
  refreshWhatsappModalContacts,
} from "./whatsapp-modal-config.js";
const BALANCE_DEBUG = false;
const WELCOME_FLOW_DEBUG = false;
const SOLDE_BUILD_TAG = "welcome-bonus-debug-2026-03-21-v2";
const DEPOSIT_INFO_DISMISSED_KEY = "domino_deposit_info_hidden_v1";
const REJECTED_ORDER_ALERT_SEEN_KEY = "domino_rejected_order_alert_seen_v1";
const REJECTED_ORDER_SUPPORT_PHONE = "50940507232";
const AGENT_DEPOSIT_SUPPORT_PHONE = REJECTED_ORDER_SUPPORT_PHONE;
const WELCOME_BONUS_HTG = 25;
const AGENT_REQUIRED_DEPOSIT_THRESHOLD_HTG = 500;

let cachedOrders = [];
let cachedWithdrawals = [];
const MIN_DEPOSIT_HTG = 25;
let soldeAuthUnsub = null;
let soldeActiveUid = "";
let activeRejectedOrderAlertId = "";
let queuedRejectedOrderAlertIds = [];
let soldeRefreshTimer = null;
let soldeVisibilityBound = false;
let ordersLoadToken = 0;
let withdrawalsLoadToken = 0;
const SOLDE_REFRESH_MS = 3 * 60 * 1000;
void refreshWhatsappModalContacts().catch(() => {});
let balanceHydrationSession = {
  uid: "",
  ordersReady: false,
  withdrawalsReady: false,
  promise: null,
  resolve: null,
};

function ensureBalanceHydrationSession(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return null;
  if (balanceHydrationSession.uid === safeUid && balanceHydrationSession.promise) {
    return balanceHydrationSession;
  }
  balanceHydrationSession = {
    uid: safeUid,
    ordersReady: false,
    withdrawalsReady: false,
    promise: null,
    resolve: null,
  };
  balanceHydrationSession.promise = new Promise((resolve) => {
    balanceHydrationSession.resolve = resolve;
  });
  return balanceHydrationSession;
}

function markBalanceHydrationReady(kind, uid) {
  const session = ensureBalanceHydrationSession(uid);
  if (!session) return;
  if (kind === "orders") session.ordersReady = true;
  if (kind === "withdrawals") session.withdrawalsReady = true;
  if (session.ordersReady && session.withdrawalsReady && typeof session.resolve === "function") {
    const resolve = session.resolve;
    session.resolve = null;
    resolve(true);
  }
}

export async function waitForBalanceHydration(uid = auth.currentUser?.uid, timeoutMs = 2200) {
  const session = ensureBalanceHydrationSession(uid);
  if (!session) return false;
  if (session.ordersReady && session.withdrawalsReady) return true;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), Math.max(300, Number(timeoutMs) || 2200));
    session.promise.then(() => {
      window.clearTimeout(timer);
      resolve(true);
    });
  });
}

function formatAmount(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("fr-HT", {
    style: "currency",
    currency: "HTG",
    maximumFractionDigits: 0,
  }).format(amount);
}

function computeOrderAmount(order) {
  if (typeof order?.amount === "number" && Number.isFinite(order.amount)) {
    return Math.max(0, Math.floor(order.amount));
  }
  if (!Array.isArray(order?.items)) return 0;
  return Math.max(0, Math.floor(order.items.reduce((sum, item) => {
    const price = Number(item?.price) || 0;
    const quantity = Number(item?.quantity) || 1;
    return sum + (price * quantity);
  }, 0)));
}

function isWelcomeBonusOrder(order) {
  const orderType = String(order?.orderType || order?.kind || "").trim().toLowerCase();
  return order?.isWelcomeBonus === true || orderType === "welcome_bonus";
}

function computeRealDepositAmount(order) {
  return isWelcomeBonusOrder(order) ? 0 : computeOrderAmount(order);
}

function computeReservedWithdrawalAmount(withdrawal) {
  return Math.max(0, Math.floor(Number(withdrawal?.requestedAmount ?? withdrawal?.amount) || 0));
}

function isWithdrawalReservedStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized !== "rejected" && normalized !== "cancelled" && normalized !== "canceled";
}

function isWithdrawalClientCancellableStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "pending" || normalized === "review";
}

function isClientCancelledWithdrawal(order = {}) {
  return String(order?.status || "").trim().toLowerCase() === "rejected"
    && String(order?.cancelledBy || "").trim().toLowerCase() === "client";
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isSyntheticPhoneLoginEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.endsWith("@phone.dominoeslakay.local");
}

function buildClientFromAuth() {
  const user = auth.currentUser;
  if (!user) return null;
  const name = String(user.displayName || "").trim()
    || (user.email && !isSyntheticPhoneLoginEmail(user.email) ? user.email.split("@")[0] : "")
    || "Client";
  const email = String(user.email || "").trim();
  return {
    id: user.uid,
    uid: user.uid,
    name,
    email: isSyntheticPhoneLoginEmail(email) ? "" : email,
  };
}

function buildRejectedOrderAlertStorageKey(uid = "", orderId = "") {
  const safeUid = String(uid || "").trim();
  const safeOrderId = String(orderId || "").trim();
  if (!safeUid || !safeOrderId) return "";
  return `${REJECTED_ORDER_ALERT_SEEN_KEY}:${safeUid}:${safeOrderId}`;
}

function hasSeenRejectedOrderAlert(uid = "", orderId = "") {
  const storageKey = buildRejectedOrderAlertStorageKey(uid, orderId);
  if (!storageKey) return false;
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch (_) {
    return false;
  }
}

function markRejectedOrderAlertSeen(uid = "", orderId = "") {
  const storageKey = buildRejectedOrderAlertStorageKey(uid, orderId);
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, "1");
  } catch (_) {
  }
}

function openRejectedOrderSupport() {
  const text = (
    "Bonjour assistance, ma demande de depot a ete rejetee et je souhaite contester cette decision."
  );
  const url = buildWhatsappUrlForKey("rejected_order", text, REJECTED_ORDER_SUPPORT_PHONE);
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    window.location.href = url;
  }
}

function ensureLargeDepositAgentModal() {
  const existing = document.getElementById("largeDepositAgentModalOverlay");
  if (existing) return existing;

  const overlay = document.createElement("div");
  const agentLabel = getWhatsappContactLabel("agent_deposit", AGENT_DEPOSIT_SUPPORT_PHONE) || `+${AGENT_DEPOSIT_SUPPORT_PHONE}`;
  overlay.id = "largeDepositAgentModalOverlay";
  overlay.className = "fixed inset-0 z-[3200] hidden items-end justify-center bg-[#12050b]/78 px-[max(12px,env(safe-area-inset-left))] pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-md sm:items-center sm:px-4 sm:py-4";
  overlay.innerHTML = `
    <div id="largeDepositAgentModalPanel" class="w-full max-w-lg max-h-full overflow-y-auto rounded-[28px] border border-[#f3bf78]/24 bg-[linear-gradient(180deg,rgba(63,29,14,0.98),rgba(25,10,6,0.98))] p-4 text-white shadow-[0_-18px_42px_rgba(27,9,4,0.52)] sm:max-h-[min(88vh,760px)] sm:rounded-[32px] sm:p-6">
      <div class="flex items-start gap-3">
        <div class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#f8d39d]/26 bg-white/10 text-[#ffe1b4]">
          <i class="fa-solid fa-user-tie text-lg"></i>
        </div>
        <div class="min-w-0">
          <div class="inline-flex items-center gap-2 rounded-full border border-[#f8d39d]/18 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ffe1b4]">
            <i class="fa-solid fa-shield-halved text-[12px]"></i>
            Verification manuelle
          </div>
          <h3 class="mt-3 text-xl font-bold text-white sm:text-2xl">Depot via agent requis</h3>
        </div>
      </div>

      <div class="mt-5 rounded-[24px] border border-[#f7cf98]/16 bg-white/8 p-4 sm:p-5">
        <p id="largeDepositAgentMessage" class="text-sm leading-7 text-white/92">
          Pour ce montant, veuillez contacter un agent pour faire votre depot. Votre demande sera traitee directement avec assistance.
        </p>
        <div class="mt-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm font-semibold text-[#ffe0bb]">
          Agent WhatsApp: ${agentLabel}
        </div>
      </div>

      <div class="mt-5 grid gap-3 sm:grid-cols-2">
        <button id="largeDepositAgentClose" type="button" class="h-12 rounded-2xl border border-white/15 bg-white/10 text-sm font-semibold text-white">
          Fermer
        </button>
        <button id="largeDepositAgentContact" type="button" class="h-12 rounded-2xl border border-[#34d399]/22 bg-[#139c55] text-sm font-semibold text-white shadow-[10px_12px_22px_rgba(8,61,34,0.34)]">
          Contacter un agent
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const panel = overlay.querySelector("#largeDepositAgentModalPanel");
  const closeBtn = overlay.querySelector("#largeDepositAgentClose");
  const contactBtn = overlay.querySelector("#largeDepositAgentContact");
  const messageEl = overlay.querySelector("#largeDepositAgentMessage");

  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    document.body.classList.remove("overflow-hidden");
  };

  const open = ({ amount } = {}) => {
    if (messageEl) {
      messageEl.textContent = "Veuillez contacter un agent pour recevoir l'argent automatiquement et rapidement.";
    }
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    document.body.classList.add("overflow-hidden");
  };

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  if (panel) panel.addEventListener("click", (ev) => ev.stopPropagation());
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (contactBtn) {
    contactBtn.addEventListener("click", () => {
      const text = "Bonjour agent, je veux faire un depot superieur a 500 GDes.";
      const url = buildWhatsappUrlForKey("agent_deposit", text, AGENT_DEPOSIT_SUPPORT_PHONE);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        window.location.href = url;
      }
    });
  }

  overlay.__openLargeDepositAgentModal = open;
  return overlay;
}

async function getWelcomeBonusEntryStatus() {
  try {
    const funding = await getDepositFundingStatusSecure({});
    if (WELCOME_FLOW_DEBUG) {
      console.log("[WELCOME_BONUS_DEBUG][SOLDE] funding status", {
        uid: auth.currentUser?.uid || "",
        email: auth.currentUser?.email || "",
        funding,
      });
    }
    return {
      eligible: funding?.welcomeBonusEligible === true,
      reason: String(funding?.welcomeBonusEligibilityReason || ""),
    };
  } catch (error) {
    console.warn("[SOLDE] welcome bonus eligibility unavailable", error);
    return {
      eligible: false,
      reason: "unavailable",
    };
  }
}

function openPaymentDepositDirectly(amount = 500, options = {}) {
  const numericAmount = Number(amount || 0);
  if (numericAmount < MIN_DEPOSIT_HTG) return false;

  const client = buildClientFromAuth();
  if (!client) return false;
  const flowType = options?.flowType === "welcome_bonus" ? "welcome_bonus" : "deposit";

  new PaymentModal({
    amount: numericAmount,
    flowType,
    client,
    cart: [
      {
        id: `${flowType}_${Date.now()}`,
        name: flowType === "welcome_bonus" ? "Bonus de bienvenue" : "Depot de solde",
        price: numericAmount,
        quantity: 1,
        image: "",
        weight: 0,
      },
    ],
    delivery: null,
    onSuccess: () => {
      const event = new CustomEvent("balanceDepositSuccess", {
        detail: {
          amount: numericAmount,
          flowType,
        }
      });
      document.dispatchEvent(event);
    },
  });

  return true;
}

function ensureDepositInfoModal() {
  const existing = document.getElementById("depositInfoModalOverlay");
  if (existing) return existing;

  const overlay = document.createElement("div");
  overlay.id = "depositInfoModalOverlay";
  overlay.className = "fixed inset-0 z-[3150] hidden items-end justify-center bg-[#071226]/68 px-[max(12px,env(safe-area-inset-left))] pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:items-center sm:px-4 sm:py-4";
  overlay.innerHTML = `
    <div id="depositInfoModalPanel" class="w-full max-w-lg max-h-full overflow-y-auto rounded-[28px] border border-[#7dd3fc]/26 bg-[linear-gradient(180deg,rgba(10,44,80,0.97),rgba(8,26,52,0.98))] p-4 text-white shadow-[0_-18px_38px_rgba(6,20,42,0.5)] backdrop-blur-xl sm:max-h-[min(88vh,760px)] sm:rounded-[32px] sm:p-6 sm:shadow-[16px_18px_42px_rgba(6,20,42,0.48)]">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="inline-flex items-center gap-2 rounded-full border border-[#7dd3fc]/28 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#bae6fd]">
            <i class="fa-solid fa-shield-halved text-[12px]"></i>
            Mesaj konfyans
          </div>
          <h3 class="mt-3 text-xl font-bold text-white sm:text-2xl">Depo ou an sekirite</h3>
        </div>
        <button id="depositInfoClose" type="button" class="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-white">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="mt-4 rounded-[24px] border border-[#7dd3fc]/22 bg-white/10 p-4 sm:p-5">
        <div class="flex items-start gap-3">
          <div class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#93c5fd]/28 bg-[#22d3ee]/14 text-[#dbeafe]">
            <i class="fa-solid fa-shield-halved text-lg"></i>
          </div>
          <div class="min-w-0">
            <p class="text-sm leading-7 text-white/92">
              Fason pou fe depo yo fasil epi yo sekirize. Pou nou kapab pi proch nou, nou gen 2 system depo sou sit la. Kontakte on agent kounya pou fe depo. Metod sa natirel, li senp, li fasil epi li mete w an konfyans. Mesi paske w chwazi nou, vinn fe lajan ak kapasitew. Resevwa 10% bonus an plis lew fe on depo pou pi piti 100 goud, pa pedi bonus ou.
            </p>
          </div>
        </div>
      </div>

      <div class="mt-5 grid gap-3 sm:grid-cols-2">
        <button id="depositInfoHide" type="button" class="h-11 rounded-2xl border border-[#93c5fd]/25 bg-white/10 text-sm font-semibold text-[#e0f2fe]">
          Ne plus afficher ce message
        </button>
        <button id="depositInfoContactAgent" type="button" class="h-11 rounded-2xl border border-[#6ee7b7]/26 bg-[#0f9f79] text-sm font-semibold text-white shadow-[10px_12px_22px_rgba(6,68,51,0.36)]">
          Contacter l'agent
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const panel = overlay.querySelector("#depositInfoModalPanel");
  const closeBtn = overlay.querySelector("#depositInfoClose");
  const hideBtn = overlay.querySelector("#depositInfoHide");
  const contactAgentBtn = overlay.querySelector("#depositInfoContactAgent");

  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    document.body.classList.remove("overflow-hidden");
  };

  const open = ({ onContinue } = {}) => {
    overlay.__onContinue = typeof onContinue === "function" ? onContinue : null;
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    document.body.classList.add("overflow-hidden");
  };

  const handleContinue = () => {
    const callback = typeof overlay.__onContinue === "function" ? overlay.__onContinue : null;
    close();
    overlay.__onContinue = null;
    if (callback) callback();
  };

  const handleHideForever = () => {
    try {
      localStorage.setItem(DEPOSIT_INFO_DISMISSED_KEY, "1");
    } catch (_) {
    }
    handleContinue();
  };

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  if (panel) panel.addEventListener("click", (ev) => ev.stopPropagation());
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (hideBtn) hideBtn.addEventListener("click", handleHideForever);
  if (contactAgentBtn) {
    contactAgentBtn.addEventListener("click", () => {
      const text = "Bonjou agent, mwen bezwen fe yon depo kounya tanpri.";
      const url = buildWhatsappUrlForKey("agent_deposit", text, AGENT_DEPOSIT_SUPPORT_PHONE);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        window.location.href = url;
      }
      close();
    });
  }

  overlay.__openDepositInfo = open;
  return overlay;
}

function ensureDepositTermsModal() {
  const existing = document.getElementById("depositTermsModalOverlay");
  if (existing) return existing;

  const overlay = document.createElement("div");
  overlay.id = "depositTermsModalOverlay";
  overlay.className = "fixed inset-0 z-[3160] hidden items-end justify-center bg-[#071120]/72 px-[max(12px,env(safe-area-inset-left))] pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:items-center sm:px-4 sm:py-4";
  overlay.innerHTML = `
    <div id="depositTermsModalPanel" class="w-full max-w-xl max-h-full overflow-y-auto rounded-[28px] border border-white/15 bg-[linear-gradient(180deg,rgba(32,48,76,0.98),rgba(13,21,36,0.98))] p-4 text-white shadow-[0_-18px_40px_rgba(5,10,18,0.48)] backdrop-blur-xl sm:max-h-[min(88vh,760px)] sm:rounded-[32px] sm:p-6">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">
            <i class="fa-solid fa-file-shield text-[12px]"></i>
            Conditions d'utilisation
          </div>
          <h3 class="mt-3 text-xl font-bold text-white sm:text-2xl">Depot, fraude et securite</h3>
        </div>
        <button id="depositTermsClose" type="button" class="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-white">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="mt-4 space-y-3 text-sm leading-7 text-white/88">
        <p>
          Quand tu envoies un depot, la plateforme peut verifier la transaction avant validation finale.
        </p>
        <p>
          Tout depot faux, vole, conteste, ou appuye par un faux document est considere comme une tentative de fraude.
        </p>
        <p>
          En cas de fraude, d'arnaque, de vol ou de tentative de vol, ton compte peut etre suspendu ou ferme definitivement, et le solde, les Does et les gains lies au depot peuvent etre annules.
        </p>
        <p>
          Le vol, l'arnaque, la fraude et l'usage de faux peuvent egalement entrainer des suites avec la justice selon le dossier.
        </p>
        <p>
          En continuant, tu reconnais avoir lu ces conditions et accepter les controles de securite de la plateforme.
        </p>
      </div>

      <button id="depositTermsOk" type="button" class="mt-5 h-11 w-full rounded-2xl border border-sky-300/20 bg-sky-400/12 text-sm font-semibold text-white">
        J'ai lu
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const panel = overlay.querySelector("#depositTermsModalPanel");
  const closeBtn = overlay.querySelector("#depositTermsClose");
  const okBtn = overlay.querySelector("#depositTermsOk");

  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    document.body.classList.remove("overflow-hidden");
  };

  const open = () => {
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    document.body.classList.add("overflow-hidden");
  };

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  if (panel) panel.addEventListener("click", (ev) => ev.stopPropagation());
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (okBtn) okBtn.addEventListener("click", close);

  overlay.__openDepositTerms = open;
  return overlay;
}

function ensureRejectedOrderAlertModal() {
  const existing = document.getElementById("rejectedOrderAlertOverlay");
  if (existing) return existing;

  const overlay = document.createElement("div");
  overlay.id = "rejectedOrderAlertOverlay";
  overlay.className = "fixed inset-0 z-[3180] hidden items-end justify-center bg-[#130606]/78 px-[max(12px,env(safe-area-inset-left))] pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-md sm:items-center sm:px-4 sm:py-4";
  overlay.innerHTML = `
    <div id="rejectedOrderAlertPanel" class="w-full max-w-lg max-h-full overflow-y-auto rounded-[28px] border border-[#ff8c8c]/28 bg-[linear-gradient(180deg,rgba(96,18,18,0.98),rgba(39,7,7,0.98))] p-4 text-white shadow-[0_-18px_42px_rgba(31,6,6,0.58)] sm:max-h-[min(88vh,760px)] sm:rounded-[32px] sm:p-6">
      <div class="flex items-start gap-3">
        <div class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#ffb1b1]/24 bg-white/10 text-[#ffd5d5]">
          <i class="fa-solid fa-user-shield text-lg"></i>
        </div>
        <div class="min-w-0">
          <div class="inline-flex items-center gap-2 rounded-full border border-[#ffb1b1]/20 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ffd1d1]">
            <i class="fa-solid fa-ban text-[12px]"></i>
            Demande rejetee
          </div>
          <h3 class="mt-3 text-xl font-bold text-white sm:text-2xl">Ta demande a ete rejetee</h3>
          <p id="rejectedOrderAlertCode" class="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/65"></p>
        </div>
      </div>

      <div class="mt-5 rounded-[24px] border border-[#ffb1b1]/18 bg-white/8 p-4 sm:p-5">
        <p class="text-sm leading-7 text-white/92">
          Ta demande a ete rejetee car elle n'a pas passe les balises de securite. Elle a ete declaree comme un vol.
        </p>
        <p class="mt-3 text-sm leading-7 text-white/82">
          Si ce n'est pas vrai, contacte l'assistance pour demander une verification manuelle.
        </p>
        <div class="mt-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm font-semibold text-[#ffd9d9]">
          Assistance WhatsApp: ${getWhatsappContactLabel("rejected_order", REJECTED_ORDER_SUPPORT_PHONE) || `+${REJECTED_ORDER_SUPPORT_PHONE}`}
        </div>
      </div>

      <div class="mt-5 grid gap-3 sm:grid-cols-2">
        <button id="rejectedOrderAlertAcknowledge" type="button" class="h-12 rounded-2xl border border-white/15 bg-white/10 text-sm font-semibold text-white">
          Je ne le ferais plus
        </button>
        <button id="rejectedOrderAlertSupport" type="button" class="h-12 rounded-2xl border border-[#ff9a66]/30 bg-[#d96a13] text-sm font-semibold text-white shadow-[10px_12px_22px_rgba(103,44,9,0.34)]">
          Contact l'assistance
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const panel = overlay.querySelector("#rejectedOrderAlertPanel");
  const acknowledgeBtn = overlay.querySelector("#rejectedOrderAlertAcknowledge");
  const supportBtn = overlay.querySelector("#rejectedOrderAlertSupport");
  const codeEl = overlay.querySelector("#rejectedOrderAlertCode");

  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    document.body.classList.remove("overflow-hidden");
    activeRejectedOrderAlertId = "";
    const nextOrderId = queuedRejectedOrderAlertIds.shift();
    if (nextOrderId) {
      const nextOrder = cachedOrders.find((item) => item?.id === nextOrderId && item?.status === "rejected");
      if (nextOrder) {
        window.setTimeout(() => {
          if (typeof overlay.__openRejectedOrderAlert === "function") {
            overlay.__openRejectedOrderAlert(nextOrder);
          }
        }, 0);
      }
    }
  };

  const open = (order) => {
    if (!order?.id) return;
    activeRejectedOrderAlertId = String(order.id);
    if (codeEl) {
      codeEl.textContent = order.uniqueCode
        ? `Demande ${String(order.uniqueCode)}`
        : `Demande ${String(order.id)}`;
    }
    overlay.__currentOrderId = String(order.id);
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    document.body.classList.add("overflow-hidden");
  };

  const acknowledge = () => {
    const orderId = String(overlay.__currentOrderId || "").trim();
    if (auth.currentUser?.uid && orderId) {
      markRejectedOrderAlertSeen(auth.currentUser.uid, orderId);
    }
    close();
  };

  const contactSupport = () => {
    const orderId = String(overlay.__currentOrderId || "").trim();
    if (auth.currentUser?.uid && orderId) {
      markRejectedOrderAlertSeen(auth.currentUser.uid, orderId);
    }
    openRejectedOrderSupport();
    close();
  };

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) acknowledge();
  });
  if (panel) panel.addEventListener("click", (ev) => ev.stopPropagation());
  if (acknowledgeBtn) acknowledgeBtn.addEventListener("click", acknowledge);
  if (supportBtn) supportBtn.addEventListener("click", contactSupport);

  overlay.__openRejectedOrderAlert = open;
  return overlay;
}

function ensurePendingHtgInfoModal() {
  const existing = document.getElementById("pendingHtgInfoModalOverlay");
  if (existing) return existing;

  const overlay = document.createElement("div");
  overlay.id = "pendingHtgInfoModalOverlay";
  overlay.className = "fixed inset-0 z-[3120] hidden items-center justify-center bg-black/50 p-4 backdrop-blur-sm";
  overlay.innerHTML = `
    <div id="pendingHtgInfoModalPanel" class="w-full max-w-md rounded-3xl border border-amber-200/20 bg-[linear-gradient(180deg,rgba(38,44,69,0.98),rgba(24,29,47,0.98))] p-5 text-white shadow-[14px_14px_34px_rgba(16,23,40,0.5),-10px_-10px_24px_rgba(112,126,165,0.2)] sm:p-6">
      <div class="flex items-start gap-3">
        <div class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-300/20 bg-amber-400/12 text-amber-200">
          <i class="fa-solid fa-hourglass-half text-sm"></i>
        </div>
        <div class="min-w-0">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200/80">HTG an atant</p>
          <h3 class="mt-1 text-lg font-bold text-white">Ou ka jwe ak lajan sa a</h3>
        </div>
      </div>

      <div class="mt-4 rounded-2xl border border-amber-300/16 bg-white/6 p-4">
        <p id="pendingHtgInfoAmount" class="text-2xl font-black text-amber-200">0 HTG</p>
        <p class="mt-3 text-sm leading-6 text-white/85">
          HTG sa yo soti nan yon depo ki toujou sou verifikasyon. Ou ka jwe ak yo depi kounye a, men yo poko retirable.
        </p>
        <p class="mt-3 text-sm leading-6 text-white/72">
          Le yon admin apwouve depo a, montan sa a ap pase nan HTG apwouve epi li ap parèt an vet nan solde ou.
        </p>
      </div>

      <button id="pendingHtgInfoClose" type="button" class="mt-5 h-11 w-full rounded-2xl border border-[#ffb26e] bg-[#F57C00] text-sm font-semibold text-white shadow-[8px_8px_18px_rgba(163,82,27,0.45),-6px_-6px_14px_rgba(255,175,102,0.22)]">
        Mwen konprann
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
  const panel = overlay.querySelector("#pendingHtgInfoModalPanel");
  const closeBtn = overlay.querySelector("#pendingHtgInfoClose");
  const amountEl = overlay.querySelector("#pendingHtgInfoAmount");

  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  };

  overlay.__openPendingHtgInfo = (amount = 0) => {
    if (amountEl) amountEl.textContent = formatAmount(amount);
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
  };

  if (closeBtn) closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  if (panel) panel.addEventListener("click", (ev) => ev.stopPropagation());
  return overlay;
}

function syncRejectedOrderAlerts(orders = []) {
  const uid = String(auth.currentUser?.uid || "").trim();
  if (!uid) return;

  const rejectedOrders = (orders || [])
    .filter((order) => order && order.status === "rejected" && !order.userHiddenByClient)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const unseenRejected = rejectedOrders.filter((order) => !hasSeenRejectedOrderAlert(uid, order.id));
  if (!unseenRejected.length) return;

  const overlay = ensureRejectedOrderAlertModal();
  const queuedIds = new Set(queuedRejectedOrderAlertIds);
  unseenRejected.forEach((order) => {
    if (String(order.id) === activeRejectedOrderAlertId) return;
    if (queuedIds.has(String(order.id))) return;
    queuedRejectedOrderAlertIds.push(String(order.id));
    queuedIds.add(String(order.id));
  });

  if (!activeRejectedOrderAlertId) {
    const nextOrderId = queuedRejectedOrderAlertIds.shift();
    const nextOrder = unseenRejected.find((order) => String(order.id) === nextOrderId) || unseenRejected[0];
    if (nextOrder && typeof overlay.__openRejectedOrderAlert === "function") {
      overlay.__openRejectedOrderAlert(nextOrder);
    }
  }
}

function updateSoldBadge(balanceValue) {
  const badge = document.getElementById("soldBadge");
  const baseBalance = Number(balanceValue || 0);
  const xState = getXchangeState(baseBalance, auth.currentUser?.uid);
  const availableBalance = Number(xState.availableGourdes || 0);
  const pendingBalance = Number(xState.provisionalGourdesAvailable || 0);
  if (BALANCE_DEBUG) {
    console.log("[BALANCE_DEBUG][SOLDE] updateSoldBadge", {
      inputBalanceValue: balanceValue,
      baseBalance,
      uid: auth.currentUser?.uid || null,
      exchangedGourdes: xState.exchangedGourdes,
      does: xState.does,
      availableBalance,
      pendingBalance,
      prevUserBaseBalance: window.__userBaseBalance,
      prevUserBalance: window.__userBalance,
      hasSoldBadge: !!badge,
    });
  }

  if (badge) {
    if (pendingBalance > 0) {
      badge.dataset.pendingHtgAmount = String(Math.max(0, Math.trunc(pendingBalance)));
    } else {
      delete badge.dataset.pendingHtgAmount;
    }
    if (availableBalance > 0) {
      badge.innerHTML = `
        <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px]">+</span>
        <span class="min-w-0 text-left leading-tight">
          <span class="block">${formatAmount(availableBalance)}</span>
          ${pendingBalance > 0 ? `
            <span data-pending-htg-info="1" class="mt-0.5 block text-[11px] font-semibold text-amber-300 hover:text-amber-200">
              ${formatAmount(pendingBalance)} an atant
            </span>
          ` : ""}
        </span>
      `;
    } else {
      badge.innerHTML = `
        <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px]">+</span>
        <span>Faire un dépôt</span>
      `;
    }
  }

  window.__userBaseBalance = baseBalance;
  window.__userBalance = availableBalance;
  window.dispatchEvent(
    new CustomEvent("userBalanceUpdated", {
      detail: { balance: availableBalance, baseBalance },
    })
  );
}

function getOrderUiStatus(order) {
  if (!order) return "pending";
  if (order.status === "approved") return "approved";
  if (isClientCancelledWithdrawal(order)) return "cancelled";
  if (order.status === "rejected") return "rejected";
  if (order.status === "cancelled" || order.status === "canceled") return "cancelled";
  if (order.status === "review") return "review";
  return "pending";
}

function renderOrderCard(order) {
  const kind = order.type === "withdrawal" ? "withdrawal" : "order";
  const status = getOrderUiStatus(order);
  const isProvisionallyCredited = kind === "order"
    && Number(order?.fundingVersion || 0) >= 2
    && String(order?.creditMode || "") === "provisional"
    && String(order?.resolutionStatus || order?.status || "pending") === "pending";
  const code = escapeHtml(order.uniqueCode || order.id || "-");
  const amountValue = kind === "withdrawal"
    ? computeReservedWithdrawalAmount(order)
    : computeOrderAmount(order);
  const amount = formatAmount(amountValue);
  const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleString() : "-";
  const title = kind === "withdrawal" ? "Retrait" : "Commande";
  const amountPrefix = kind === "withdrawal" ? "-" : "";

  let badgeClass = "bg-[#a16a28]/30 text-[#ffd7a7]";
  let badgeLabel = "En attente";
  let extraHint = "";

  if (isProvisionallyCredited) {
    badgeClass = "bg-[#2b4f79]/40 text-[#b8dcff]";
    badgeLabel = "En examen";
    extraHint = `
      <div class="mt-3 rounded-xl bg-[#2b4f79]/25 p-3 text-xs text-[#d7e8ff]">
        Dépôt crédité provisoirement. Tu peux jouer avec ce solde, mais il reste non retirable tant qu'il n'est pas validé.
      </div>
    `;
  }

  if (status === "review") {
    badgeClass = "bg-[#2b4f79]/40 text-[#b8dcff]";
    badgeLabel = "En examen";
  }
  if (status === "rejected") {
    badgeClass = "bg-[#7a2b2b]/40 text-[#ffbdbd]";
    badgeLabel = "Rejetée";
  }
  if (status === "cancelled") {
    badgeClass = "bg-[#475569]/45 text-[#dbe4f3]";
    badgeLabel = "Annulée";
  }
  const showCancelWithdrawal = kind === "withdrawal" && isWithdrawalClientCancellableStatus(status);

  return `
    <div class="rounded-2xl border border-white/20 bg-white/10 p-4 shadow-[8px_8px_18px_rgba(18,25,42,0.35),-6px_-6px_14px_rgba(121,135,173,0.2)]">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-white">${title} ${code}</p>
          <p class="text-xs text-white/70">${createdAt}</p>
        </div>
        <span class="rounded-full px-2 py-1 text-[11px] font-semibold ${badgeClass}">${badgeLabel}</span>
      </div>

      <div class="mt-3 text-sm text-white/85">
        <p>Montant: <span class="font-semibold">${amountPrefix}${amount}</span></p>
        <p>Méthode: ${escapeHtml(order.methodName || "-")}</p>
      </div>

      ${extraHint}

      ${showCancelWithdrawal ? `
        <div class="mt-3">
          <button data-action="cancel-withdrawal" data-kind="${kind}" data-order-id="${escapeHtml(order.id)}" class="w-full rounded-xl border border-amber-200/25 bg-amber-500/15 py-2.5 text-xs font-semibold text-amber-100">
            Annuler retrait
          </button>
        </div>
      ` : ""}

      ${status === "rejected" ? `
        <div class="mt-3 rounded-xl bg-[#7a2b2b]/25 p-3 text-xs text-[#ffd1d1]">
          Commande rejetée à cause d'une erreur.
        </div>
        <div class="mt-3 flex gap-2">
          <button data-action="hide" data-kind="${kind}" data-order-id="${escapeHtml(order.id)}" class="flex-1 rounded-xl border border-white/20 bg-white/10 py-2 text-xs font-semibold text-white">Supprimer</button>
          <button data-action="review" data-kind="${kind}" data-order-id="${escapeHtml(order.id)}" class="flex-1 rounded-xl border border-[#ffb26e] bg-[#F57C00] py-2 text-xs font-semibold text-white">Demander un examen</button>
        </div>
      ` : ""}
    </div>
  `;
}

function getPendingOperationsSnapshot(orders = cachedOrders, withdrawals = cachedWithdrawals) {
  const ops = [
    ...(orders || []).map((o) => ({ ...o, type: "order" })),
    ...(withdrawals || []).map((w) => ({ ...w, type: "withdrawal" })),
  ];
  return ops
    .filter((o) => (
      o
      && !o.userHiddenByClient
      && o.status !== "approved"
      && o.status !== "cancelled"
      && o.status !== "canceled"
      && !isClientCancelledWithdrawal(o)
    ))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function dispatchPendingOperationsUpdate(orders = cachedOrders, withdrawals = cachedWithdrawals) {
  const visible = getPendingOperationsSnapshot(orders, withdrawals);
  window.dispatchEvent(
    new CustomEvent("pendingOperationsUpdated", {
      detail: {
        count: visible.length,
        operations: visible.map((item) => ({ ...item })),
      },
    })
  );
}

export function getPendingOperations() {
  return getPendingOperationsSnapshot().map((item) => ({ ...item }));
}

export function renderPendingOperationsList(target, options = {}) {
  const listEl = typeof target === "string" ? document.querySelector(target) : target;
  if (!listEl) return [];
  const visible = getPendingOperationsSnapshot();
  const emptyText = String(options.emptyText || "Aucune opération en cours.");

  if (visible.length === 0) {
    listEl.innerHTML = `<p class="text-sm text-white/70">${escapeHtml(emptyText)}</p>`;
    return visible;
  }

  listEl.innerHTML = visible.map(renderOrderCard).join("");
  return visible;
}

async function cancelWithdrawalOperation(orderId) {
  const user = auth.currentUser;
  if (!user || !orderId) return null;
  return cancelWithdrawalSecure({ withdrawalId: orderId });
}

export function bindPendingOperationsActions(target) {
  const listEl = typeof target === "string" ? document.querySelector(target) : target;
  if (!listEl) return;
  if (listEl.dataset.pendingOpsBound === "1") {
    listEl.dataset.pendingOpsBound = "0";
  }
  listEl.dataset.pendingOpsBound = "1";

  listEl.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.getAttribute("data-action");
      const orderId = btn.getAttribute("data-order-id");
      const kind = btn.getAttribute("data-kind") || "order";
      if (!orderId) return;

      try {
        if (action === "hide") {
          await hideOperationForUser(orderId, kind);
        }
        if (action === "review") {
          await requestOperationReview(orderId, kind);
        }
        if (action === "cancel-withdrawal" && kind === "withdrawal") {
          const confirmed = window.confirm("Annuler ce retrait et remettre le montant dans ton solde disponible ?");
          if (!confirmed) return;
          const result = await cancelWithdrawalOperation(orderId);
          window.dispatchEvent(new CustomEvent("withdrawalCancelled", {
            detail: {
              id: orderId,
              status: "rejected",
              fundingSnapshot: result && typeof result === "object" ? result : null,
            },
          }));
        }
      } catch (err) {
        console.error("Erreur action commande:", err);
      }
    });
  });
}

function renderOrdersSection(orders, withdrawals) {
  const listEl = document.getElementById("soldeOrdersList");
  if (!listEl) {
    dispatchPendingOperationsUpdate(orders, withdrawals);
    return;
  }

  const visible = renderPendingOperationsList(listEl, {
    emptyText: "Aucune opération en cours.",
  });
  bindPendingOperationsActions(listEl);
  dispatchPendingOperationsUpdate(orders, withdrawals);
}

async function hideOrderForUser(orderId) {
  const user = auth.currentUser;
  if (!user || !orderId) return;
  await orderClientActionSecure({
    kind: "order",
    id: orderId,
    action: "hide",
  });
}

async function requestReview(orderId) {
  const user = auth.currentUser;
  if (!user || !orderId) return;
  await orderClientActionSecure({
    kind: "order",
    id: orderId,
    action: "review",
  });
}

async function hideOperationForUser(orderId, kind) {
  if (kind === "withdrawal") {
    const user = auth.currentUser;
    if (!user || !orderId) return;
    await orderClientActionSecure({
      kind: "withdrawal",
      id: orderId,
      action: "hide",
    });
    return;
  }
  await hideOrderForUser(orderId);
}

async function requestOperationReview(orderId, kind) {
  if (kind === "withdrawal") {
    const user = auth.currentUser;
    if (!user || !orderId) return;
    await orderClientActionSecure({
      kind: "withdrawal",
      id: orderId,
      action: "review",
    });
    return;
  }
  await requestReview(orderId);
}

function bindOrdersActions() {
  bindPendingOperationsActions(document.getElementById("soldeOrdersList"));
}

async function attachOrdersListener() {
  const user = auth.currentUser;
  if (!user) return;
  ensureBalanceHydrationSession(user.uid);
  const token = ++ordersLoadToken;

  const ordersRef = collection(db, "clients", user.uid, "orders");
  const q = query(ordersRef, orderBy("createdAt", "desc"));

  try {
    const snapshot = await getDocs(q);
    if (token !== ordersLoadToken) return;
    const orders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (BALANCE_DEBUG) {
      console.log("[BALANCE_DEBUG][SOLDE] orders snapshot", {
        count: orders.length,
        approvedCount: orders.filter((o) => o.status === "approved").length,
        preview: orders.slice(0, 3).map((o) => ({
          id: o.id,
          status: o.status,
          amount: o.amount,
          createdAt: o.createdAt,
        })),
      });
    }
    cachedOrders = orders;
    syncRejectedOrderAlerts(orders);
    refreshBalanceFromCaches();
    markBalanceHydrationReady("orders", user.uid);

    const approvedVisible = orders.filter((o) => o.status === "approved" && !o.userHiddenByClient);
    for (const order of approvedVisible) {
      try {
        await hideOrderForUser(order.id);
      } catch (err) {
        console.error("Erreur hide approved order:", err);
      }
    }

    renderOrdersSection(cachedOrders, cachedWithdrawals);
    bindOrdersActions();
  } catch (error) {
    console.error("Erreur refresh commandes:", error);
    markBalanceHydrationReady("orders", user.uid);
  }
}

async function attachWithdrawalsListener() {
  const user = auth.currentUser;
  if (!user) return;
  ensureBalanceHydrationSession(user.uid);
  const token = ++withdrawalsLoadToken;

  const ref = collection(db, "clients", user.uid, "withdrawals");
  const q = query(ref, orderBy("createdAt", "desc"));

  try {
    const snapshot = await getDocs(q);
    if (token !== withdrawalsLoadToken) return;
    const withdrawals = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (BALANCE_DEBUG) {
      console.log("[BALANCE_DEBUG][SOLDE] withdrawals snapshot", {
        count: withdrawals.length,
        pendingLikeCount: withdrawals.filter((w) => isWithdrawalReservedStatus(w.status)).length,
        preview: withdrawals.slice(0, 3).map((w) => ({
          id: w.id,
          status: w.status,
          amount: w.amount,
          requestedAmount: w.requestedAmount,
          createdAt: w.createdAt,
        })),
      });
    }
    cachedWithdrawals = withdrawals;
    refreshBalanceFromCaches();
    markBalanceHydrationReady("withdrawals", user.uid);

    const approvedVisible = withdrawals.filter((o) => o.status === "approved" && !o.userHiddenByClient);
    for (const item of approvedVisible) {
      try {
        await hideOperationForUser(item.id, "withdrawal");
      } catch (err) {
        console.error("Erreur hide approved withdrawal:", err);
      }
    }

    renderOrdersSection(cachedOrders, cachedWithdrawals);
    bindOrdersActions();
  } catch (error) {
    console.error("Erreur refresh retraits:", error);
    markBalanceHydrationReady("withdrawals", user.uid);
  }
}

function detachSoldeRealtimeListeners() {
  ordersLoadToken += 1;
  withdrawalsLoadToken += 1;
  if (soldeRefreshTimer) {
    clearInterval(soldeRefreshTimer);
    soldeRefreshTimer = null;
  }
}

function startSoldeRefreshLoop(uid = auth.currentUser?.uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    detachSoldeRealtimeListeners();
    return;
  }
  if (soldeRefreshTimer) {
    clearInterval(soldeRefreshTimer);
    soldeRefreshTimer = null;
  }
  soldeRefreshTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (String(auth.currentUser?.uid || "").trim() !== safeUid) return;
    void attachOrdersListener();
    void attachWithdrawalsListener();
  }, SOLDE_REFRESH_MS);

  if (!soldeVisibilityBound) {
    soldeVisibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      void attachOrdersListener();
      void attachWithdrawalsListener();
    });
  }
}

function ensureSoldeAuthWatcher() {
  if (soldeAuthUnsub) return;
  soldeAuthUnsub = onAuthStateChanged(auth, (user) => {
    const nextUid = String(user?.uid || "").trim();
    if (!nextUid) {
      soldeActiveUid = "";
      cachedOrders = [];
      cachedWithdrawals = [];
      activeRejectedOrderAlertId = "";
      queuedRejectedOrderAlertIds = [];
      detachSoldeRealtimeListeners();
      const rejectedAlertOverlay = document.getElementById("rejectedOrderAlertOverlay");
      if (rejectedAlertOverlay) {
        rejectedAlertOverlay.classList.add("hidden");
        rejectedAlertOverlay.classList.remove("flex");
      }
      document.body.classList.remove("overflow-hidden");
      updateSoldBadge(0);
      return;
    }
    if (nextUid === soldeActiveUid && soldeRefreshTimer) {
      return;
    }
    soldeActiveUid = nextUid;
    activeRejectedOrderAlertId = "";
    queuedRejectedOrderAlertIds = [];
    detachSoldeRealtimeListeners();
    startSoldeRefreshLoop(nextUid);
    void attachOrdersListener();
    void attachWithdrawalsListener();
  });
}

function refreshBalanceFromCaches() {
  const approvedDeposits = cachedOrders
    .filter((o) => o.status === "approved")
    .reduce((sum, o) => sum + computeRealDepositAmount(o), 0);
  const reservedWithdrawals = cachedWithdrawals
    .filter((o) => isWithdrawalReservedStatus(o.status))
    .reduce((sum, o) => sum + computeReservedWithdrawalAmount(o), 0);
  const rawBaseBalance = approvedDeposits - reservedWithdrawals;
  if (BALANCE_DEBUG) {
    console.log("[BALANCE_DEBUG][SOLDE] refreshBalanceFromCaches", {
      approvedDeposits,
      reservedWithdrawals,
      computedBase: rawBaseBalance,
      ordersCount: cachedOrders.length,
      withdrawalsCount: cachedWithdrawals.length,
    });
  }
  updateSoldBadge(rawBaseBalance);
}

function ensureSoldeModal() {
  const existing = document.getElementById("soldeModalOverlay");
  if (existing) return existing;

  if (!document.getElementById("soldeModalScrollStyle")) {
    const style = document.createElement("style");
    style.id = "soldeModalScrollStyle";
    style.textContent = `
      #soldePanel {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      #soldePanel::-webkit-scrollbar {
        width: 0;
        height: 0;
        display: none;
      }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement("div");
  overlay.id = "soldeModalOverlay";
  overlay.className = "fixed inset-0 z-[3100] hidden items-center justify-center bg-black/45 p-4 backdrop-blur-sm";

  overlay.innerHTML = `
    <div id="soldePanel" class="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-3xl border border-white/20 bg-[#3F4766]/55 p-5 shadow-[14px_14px_34px_rgba(16,23,40,0.5),-10px_-10px_24px_rgba(112,126,165,0.2)] backdrop-blur-xl sm:p-6">
      <div class="flex items-start justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">Solde</p>
          <h3 class="mt-1 text-2xl font-bold text-white">Faire un dépôt</h3>
        </div>
        <button id="soldeClose" type="button" class="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-white/10 text-white shadow-[8px_8px_18px_rgba(18,25,42,0.42),-6px_-6px_14px_rgba(121,135,173,0.2)]">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="mt-5 rounded-2xl border border-white/20 bg-white/10 p-4 shadow-[inset_6px_6px_12px_rgba(19,26,43,0.42),inset_-6px_-6px_12px_rgba(120,134,172,0.22)]">
        <label for="soldeAmount" class="block text-sm font-medium text-white/90">Montant (HTG)</label>
        <input id="soldeAmount" type="number" min="25" step="25" value="25" class="mt-2 h-12 w-full rounded-xl border border-white/25 bg-white/10 px-4 text-white outline-none" />
        <div class="mt-3 grid grid-cols-3 gap-2">
          <button class="solde-quick rounded-xl border border-white/20 bg-white/10 py-2 text-sm text-white shadow-[8px_8px_18px_rgba(18,25,42,0.35),-6px_-6px_14px_rgba(121,135,173,0.2)]" data-amount="25">25</button>
          <button class="solde-quick rounded-xl border border-white/20 bg-white/10 py-2 text-sm text-white shadow-[8px_8px_18px_rgba(18,25,42,0.35),-6px_-6px_14px_rgba(121,135,173,0.2)]" data-amount="50">50</button>
          <button class="solde-quick rounded-xl border border-white/20 bg-white/10 py-2 text-sm text-white shadow-[8px_8px_18px_rgba(18,25,42,0.35),-6px_-6px_14px_rgba(121,135,173,0.2)]" data-amount="100">100</button>
        </div>
      </div>

      <div class="mt-4 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/90">
        Total du dépôt: <span id="soldeTotal" class="font-semibold text-white"></span>
      </div>

      <div id="soldeWelcomeBonusWrap" class="mt-4 hidden rounded-2xl border border-amber-300/25 bg-[linear-gradient(180deg,rgba(245,158,11,0.16),rgba(251,113,133,0.12))] p-4 text-white shadow-[10px_12px_24px_rgba(82,38,10,0.24)]">
        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">Nouveau compte</p>
        <h4 class="mt-2 text-lg font-bold text-white">Prendre mon bonus ${WELCOME_BONUS_HTG} HTG</h4>
        <button id="soldeWelcomeBonusBtn" data-welcome-coach="claim-bonus" type="button" class="mt-4 h-12 w-full rounded-2xl border border-amber-200/35 bg-white/12 text-sm font-semibold text-white shadow-[8px_10px_20px_rgba(78,38,8,0.2)]">
          Recevoir mon bonus ${WELCOME_BONUS_HTG} HTG
        </button>
      </div>

      <div id="soldeError" class="mt-3 min-h-5 text-sm text-[#ffb0b0]"></div>

      <button id="soldeCheckout" type="button" class="mt-2 h-12 w-full rounded-2xl border border-[#ffb26e] bg-[#F57C00] font-semibold text-white shadow-[9px_9px_20px_rgba(155,78,25,0.45),-7px_-7px_16px_rgba(255,173,96,0.2)] transition hover:-translate-y-0.5">
        Faire un autre dépôt
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const panel = overlay.querySelector("#soldePanel");
  const closeBtn = overlay.querySelector("#soldeClose");
  const amountInput = overlay.querySelector("#soldeAmount");
  const totalEl = overlay.querySelector("#soldeTotal");
  const welcomeBonusWrap = overlay.querySelector("#soldeWelcomeBonusWrap");
  const welcomeBonusBtn = overlay.querySelector("#soldeWelcomeBonusBtn");
  const errorEl = overlay.querySelector("#soldeError");
  const checkoutBtn = overlay.querySelector("#soldeCheckout");

  const refreshTotal = () => {
    const amount = Number(amountInput?.value || 0);
    if (totalEl) totalEl.textContent = formatAmount(amount);
  };

  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    document.body.classList.remove("overflow-hidden");
    if (errorEl) errorEl.textContent = "";
  };

  const refreshWelcomeBonusAction = async () => {
    if (!welcomeBonusWrap || !welcomeBonusBtn) return;
    welcomeBonusWrap.classList.add("hidden");
    welcomeBonusBtn.disabled = true;
    if (WELCOME_FLOW_DEBUG) {
      console.log("[WELCOME_BONUS_DEBUG][SOLDE] refresh:start", {
        uid: auth.currentUser?.uid || "",
        email: auth.currentUser?.email || "",
        hasWrap: Boolean(welcomeBonusWrap),
        hasButton: Boolean(welcomeBonusBtn),
      });
    }

    const status = await getWelcomeBonusEntryStatus();
    if (WELCOME_FLOW_DEBUG) console.log("[WELCOME_BONUS_DEBUG][SOLDE] refresh:status", status);
    if (!status?.eligible) {
      if (WELCOME_FLOW_DEBUG) {
        console.log("[WELCOME_BONUS_DEBUG][SOLDE] refresh:hidden", {
          reason: status?.reason || "unknown",
        });
      }
      return;
    }

    welcomeBonusWrap.classList.remove("hidden");
    welcomeBonusBtn.disabled = false;
    if (WELCOME_FLOW_DEBUG) {
      console.log("[WELCOME_BONUS_DEBUG][SOLDE] refresh:shown", {
        reason: status?.reason || "eligible",
      });
    }
  };

  const open = () => {
    if (WELCOME_FLOW_DEBUG) {
      console.log("[WELCOME_BONUS_DEBUG][SOLDE] modal:open", {
        uid: auth.currentUser?.uid || "",
        email: auth.currentUser?.email || "",
      });
    }
    refreshTotal();
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    document.body.classList.add("overflow-hidden");
    void attachOrdersListener();
    void attachWithdrawalsListener();
    void refreshWelcomeBonusAction();
    renderOrdersSection(cachedOrders, cachedWithdrawals);
    bindOrdersActions();
  };

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });

  if (panel) panel.addEventListener("click", (ev) => ev.stopPropagation());
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (amountInput) amountInput.addEventListener("input", refreshTotal);

  overlay.querySelectorAll(".solde-quick").forEach((btn) => {
    btn.addEventListener("click", () => {
      const amount = Number(btn.getAttribute("data-amount") || 0);
      if (amountInput) amountInput.value = String(amount);
      refreshTotal();
    });
  });

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", () => {
      const amount = Number(amountInput?.value || 0);
      if (amount < MIN_DEPOSIT_HTG) {
        if (errorEl) errorEl.textContent = `Le montant minimum est ${MIN_DEPOSIT_HTG} HTG.`;
        return;
      }

      if (amount > AGENT_REQUIRED_DEPOSIT_THRESHOLD_HTG) {
        if (errorEl) errorEl.textContent = "";
        const agentModal = ensureLargeDepositAgentModal();
        if (typeof agentModal.__openLargeDepositAgentModal === "function") {
          agentModal.__openLargeDepositAgentModal({ amount });
        }
        return;
      }

      const opened = openPaymentDepositDirectly(amount);
      if (!opened) {
        if (errorEl) errorEl.textContent = "Utilisateur non connecté.";
        return;
      }

      close();
    });
  }

  if (welcomeBonusBtn) {
    welcomeBonusBtn.addEventListener("click", async () => {
      if (errorEl) errorEl.textContent = "";
      welcomeBonusBtn.disabled = true;
      if (WELCOME_FLOW_DEBUG) {
        console.log("[WELCOME_BONUS_DEBUG][SOLDE] button:click", {
          uid: auth.currentUser?.uid || "",
          email: auth.currentUser?.email || "",
        });
      }

      try {
        const status = await getWelcomeBonusEntryStatus();
        if (WELCOME_FLOW_DEBUG) console.log("[WELCOME_BONUS_DEBUG][SOLDE] button:status", status);
        if (!status?.eligible) {
          if (welcomeBonusWrap) welcomeBonusWrap.classList.add("hidden");
          if (errorEl) errorEl.textContent = "Ce bonus n'est plus disponible pour ce compte.";
          return;
        }

        const opened = openPaymentDepositDirectly(WELCOME_BONUS_HTG, {
          flowType: "welcome_bonus",
        });
        if (!opened) {
          if (errorEl) errorEl.textContent = "Utilisateur non connecté.";
          return;
        }

        close();
      } finally {
        welcomeBonusBtn.disabled = false;
      }
    });
  }

  overlay.__openSolde = open;
  return overlay;
}

export function mountSoldeModal(options = {}) {
  const { triggerSelector = "#soldBadge" } = options;
  const overlay = ensureSoldeModal();
  const infoOverlay = ensureDepositInfoModal();
  const pendingInfoOverlay = ensurePendingHtgInfoModal();
  const trigger = document.querySelector(triggerSelector);

  if (trigger && overlay.__openSolde) {
    trigger.addEventListener("click", (event) => {
      const pendingTarget = event.target instanceof Element
        ? event.target.closest("[data-pending-htg-info='1']")
        : null;
      if (pendingTarget) {
        event.preventDefault();
        event.stopPropagation();
        const pendingAmount = Math.max(0, Math.trunc(Number(trigger.dataset.pendingHtgAmount || 0)));
        if (typeof pendingInfoOverlay.__openPendingHtgInfo === "function") {
          pendingInfoOverlay.__openPendingHtgInfo(pendingAmount);
        }
        return;
      }
      if (WELCOME_FLOW_DEBUG) {
        console.log("[WELCOME_BONUS_DEBUG][SOLDE] trigger:click", {
          uid: auth.currentUser?.uid || "",
          email: auth.currentUser?.email || "",
          build: SOLDE_BUILD_TAG,
        });
      }
      let hideInfoMessage = false;
      try {
        hideInfoMessage = localStorage.getItem(DEPOSIT_INFO_DISMISSED_KEY) === "1";
      } catch (_) {
      }
      if (hideInfoMessage) {
        if (WELCOME_FLOW_DEBUG) console.log("[WELCOME_BONUS_DEBUG][SOLDE] trigger:open-direct");
        overlay.__openSolde();
        return;
      }
      if (typeof infoOverlay.__openDepositInfo === "function") {
        if (WELCOME_FLOW_DEBUG) console.log("[WELCOME_BONUS_DEBUG][SOLDE] trigger:open-info-modal");
        infoOverlay.__openDepositInfo({
          onContinue: () => {
            if (WELCOME_FLOW_DEBUG) console.log("[WELCOME_BONUS_DEBUG][SOLDE] info-modal:continue");
            overlay.__openSolde();
          },
        });
        return;
      }
      if (WELCOME_FLOW_DEBUG) console.log("[WELCOME_BONUS_DEBUG][SOLDE] trigger:fallback-open");
      overlay.__openSolde();
    });
  }

  updateSoldBadge(0);
  ensureSoldeAuthWatcher();
  void attachOrdersListener();
  void attachWithdrawalsListener();
  window.addEventListener("xchangeUpdated", () => {
    if (BALANCE_DEBUG) {
      console.log("[BALANCE_DEBUG][SOLDE] xchangeUpdated event", {
        __userBaseBalance: window.__userBaseBalance,
        __userBalance: window.__userBalance,
      });
    }
    updateSoldBadge(window.__userBaseBalance || 0);
  });
  window.addEventListener("withdrawalSubmitted", (ev) => {
    const detail = ev?.detail || {};
    const submittedAmount = Number(detail?.requestedAmount ?? detail?.amount ?? 0);
    if (BALANCE_DEBUG) {
      console.log("[BALANCE_DEBUG][SOLDE] withdrawalSubmitted event", {
        detail,
        submittedAmount,
        __userBaseBalance: window.__userBaseBalance,
        __userBalance: window.__userBalance,
      });
    }

    // Déduction immédiate et centrale du solde après soumission retrait.
    if (Number.isFinite(submittedAmount) && submittedAmount > 0) {
      const currentBase = Number(window.__userBaseBalance || 0);
      const nextBase = Math.max(0, currentBase - submittedAmount);
      if (BALANCE_DEBUG) {
        console.log("[BALANCE_DEBUG][SOLDE] immediate deduction", {
          currentBase,
          submittedAmount,
          nextBase,
        });
      }
      updateSoldBadge(nextBase);
    }

    if (detail && typeof(detail) === "object" && detail.id) {
      const exists = cachedWithdrawals.some((w) => w && w.id === detail.id);
      if (!exists) {
        cachedWithdrawals = [{ ...detail }, ...cachedWithdrawals];
        refreshBalanceFromCaches();
        renderOrdersSection(cachedOrders, cachedWithdrawals);
        bindOrdersActions();
      }
    }
    void attachWithdrawalsListener();
  });
  window.addEventListener("withdrawalCancelled", (ev) => {
    const detail = ev?.detail || {};
    const targetId = String(detail?.id || "").trim();
    if (!targetId) return;
    const exists = cachedWithdrawals.some((w) => w && w.id === targetId);
    if (!exists) return;
    cachedWithdrawals = cachedWithdrawals.map((item) => (
      item && item.id === targetId
        ? {
            ...item,
            status: "rejected",
            resolutionStatus: "rejected",
            rejectedReason: "Retrait annulé par le client",
            cancelledBy: "client",
            cancelledAt: new Date().toISOString(),
          }
        : item
    ));
    refreshBalanceFromCaches();
    renderOrdersSection(cachedOrders, cachedWithdrawals);
    bindOrdersActions();
    void attachWithdrawalsListener();
  });

  window.openPaymentDepositDirectly = openPaymentDepositDirectly;
}
