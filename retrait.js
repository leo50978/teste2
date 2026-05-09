import {
  auth,
  db,
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
} from "./firebase-init.js";
import {
  createWithdrawalSecure,
  getDepositFundingStatusSecure,
  getPublicPaymentOptionsSecure,
} from "./secure-functions.js";
import { SUPPORT_WHATSAPP_PHONE } from "./support-contact.js";
import {
  buildWhatsappUrlForKey,
  getWhatsappContactLabel,
  refreshWhatsappModalContacts,
} from "./whatsapp-modal-config.js";

const MIN_WITHDRAWAL_HTG = 50;
const MAX_WITHDRAWAL_HTG = 500000;
const ASSISTANCE_PHONE = SUPPORT_WHATSAPP_PHONE;

let activeRetraitTheme = "default";

const buildRetraitWhatsAppUrl = (message = "") => (
  buildWhatsappUrlForKey("withdrawal_assistance", message, ASSISTANCE_PHONE)
);

void refreshWhatsappModalContacts().catch(() => {});

function safeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatAmount(value) {
  return `${safeInt(value)} HTG`;
}

function createClientRequestId(prefix = "wd") {
  const safePrefix = String(prefix || "req").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "req";
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `${safePrefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${safePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveMethodAssetPath(value) {
  const out = String(value || "").trim();
  if (!out) return "";
  const baseValue = out.replace(/\\/g, "/").split(/[?#]/)[0];
  const fileName = baseValue.split("/").pop() || "";
  if (!/^[a-zA-Z0-9._-]+\.(png|jpe?g|gif|webp|svg)$/i.test(fileName)) return "";
  return `./assets/images/${fileName}`;
}

function normalizeRetraitTheme(value) {
  return String(value || "").trim().toLowerCase() === "kobposh" ? "kobposh" : "default";
}

function applyRetraitTheme(overlay, theme = "default") {
  if (!overlay) return;
  const safeTheme = normalizeRetraitTheme(theme);
  overlay.dataset.theme = safeTheme;
  overlay.classList.toggle("kobposh-retrait-theme", safeTheme === "kobposh");
}

function getLiveWalletVisibleHtg(data = {}) {
  const approved = Number(data?.approvedHtgAvailable);
  const provisional = Number(data?.provisionalHtgAvailable);
  if (Number.isFinite(approved) || Number.isFinite(provisional)) {
    return Math.max(0, (Number.isFinite(approved) ? approved : 0) + (Number.isFinite(provisional) ? provisional : 0));
  }
  const playable = Number(data?.playableHtg);
  if (Number.isFinite(playable) && playable >= 0) return playable;
  return null;
}

function getBestFundingBalance(data = {}) {
  const playable = Number(data?.playableHtg);
  if (Number.isFinite(playable) && playable >= 0) return playable;
  const approved = Number(data?.approvedHtgAvailable);
  const provisional = Number(data?.provisionalHtgAvailable);
  if (Number.isFinite(approved) || Number.isFinite(provisional)) {
    return Math.max(0, (Number.isFinite(approved) ? approved : 0) + (Number.isFinite(provisional) ? provisional : 0));
  }
  const withdrawable = Number(data?.withdrawableHtg);
  if (Number.isFinite(withdrawable) && withdrawable >= 0) return withdrawable;
  return null;
}

function computeOrderAmount(order) {
  if (typeof order?.amount === "number" && Number.isFinite(order.amount)) return safeInt(order.amount);
  if (!Array.isArray(order?.items)) return 0;
  return safeInt(order.items.reduce((sum, item) => {
    const price = Number(item?.price) || 0;
    const quantity = Number(item?.quantity) || 1;
    return sum + (price * quantity);
  }, 0));
}

function isWelcomeBonusOrder(order) {
  const orderType = String(order?.orderType || order?.kind || "").trim().toLowerCase();
  return order?.isWelcomeBonus === true || orderType === "welcome_bonus";
}

function computeRealDepositAmount(order) {
  return isWelcomeBonusOrder(order) ? 0 : computeOrderAmount(order);
}

export async function getWithdrawalRuleStatus(uid) {
  const approvedOrdersQuery = query(
    collection(db, "clients", uid, "orders"),
    where("status", "==", "approved"),
  );
  const [ordersSnap, clientSnap, fundingStatus] = await Promise.all([
    getDocs(approvedOrdersQuery),
    getDoc(doc(db, "clients", uid)),
    getDepositFundingStatusSecure({}).catch(() => null),
  ]);

  const approvedDepositsHtgFallback = ordersSnap.docs.reduce((sum, item) => {
    const data = item.data() || {};
    return sum + computeRealDepositAmount(data);
  }, 0);

  const clientData = clientSnap.exists() ? (clientSnap.data() || {}) : {};
  const approvedDepositsHtg = safeInt(
    typeof fundingStatus?.approvedDepositsHtg === "number"
      ? fundingStatus.approvedDepositsHtg
      : approvedDepositsHtgFallback,
  );
  const pendingWithdrawalPlayHtg = safeInt(
    typeof fundingStatus?.pendingWithdrawalPlayHtg === "number"
      ? fundingStatus.pendingWithdrawalPlayHtg
      : clientData.pendingWithdrawalPlayHtg,
  );
  const accountFrozen = fundingStatus?.accountFrozen === true || clientData.accountFrozen === true;
  const withdrawalHold = fundingStatus?.withdrawalHold === true || clientData.withdrawalHold === true;
  const withdrawalBlocked = accountFrozen || withdrawalHold;
  const withdrawableHtg = withdrawalBlocked
    ? 0
    : safeInt(
      typeof fundingStatus?.withdrawableHtg === "number"
        ? fundingStatus.withdrawableHtg
        : clientData.withdrawableHtg,
    );
  const provisionalHtgAvailable = safeInt(
    typeof fundingStatus?.provisionalHtgAvailable === "number"
      ? fundingStatus.provisionalHtgAvailable
      : clientData.provisionalHtgAvailable,
  );

  return {
    approvedDepositsHtg,
    pendingWithdrawalPlayHtg,
    hasQualifyingWithdrawalDeposit: fundingStatus?.hasQualifyingWithdrawalDeposit === true,
    qualifyingWithdrawalDepositCount: safeInt(fundingStatus?.qualifyingWithdrawalDepositCount),
    withdrawalPlayPolicyStartAtMs: safeInt(fundingStatus?.withdrawalPlayPolicyStartAtMs),
    withdrawalPlayPolicyStartLabel: String(fundingStatus?.withdrawalPlayPolicyStartLabel || ""),
    canWithdraw: !withdrawalBlocked && withdrawableHtg > 0 && pendingWithdrawalPlayHtg <= 0 && provisionalHtgAvailable <= 0,
    withdrawableHtg,
    accountFrozen,
    withdrawalHold,
    withdrawalHoldReason: String(fundingStatus?.withdrawalHoldReason || clientData.withdrawalHoldReason || ""),
    withdrawalHoldAtMs: safeInt(fundingStatus?.withdrawalHoldAtMs ?? clientData.withdrawalHoldAtMs),
    rejectedDepositStrikeCount: safeInt(fundingStatus?.rejectedDepositStrikeCount ?? clientData.rejectedDepositStrikeCount),
    freezeReason: String(fundingStatus?.freezeReason || clientData.freezeReason || ""),
    provisionalHtgAvailable,
    _fundingStatus: fundingStatus || {},
    _clientData: clientData,
  };
}

function hasPendingExamWithdrawalLock(ruleStatus = {}) {
  return safeInt(ruleStatus?.provisionalHtgAvailable) > 0;
}

function hasPendingWithdrawalPlayRule(ruleStatus = {}) {
  return safeInt(ruleStatus?.pendingWithdrawalPlayHtg) > 0;
}

function isWithdrawalDepositRequired(ruleStatus = {}) {
  return ruleStatus?.hasQualifyingWithdrawalDeposit === false;
}

function buildPendingWithdrawalPlayMessage(pendingHtg = 0) {
  const amount = safeInt(pendingHtg);
  return `Ou poko ka fe retrait paske ou dwe jwe pou ${amount} HTG apre depo ou a. Depi ou fin jwe kantite sa a, retrait la ap louvri otomatikman.`;
}

function buildPendingWithdrawalExamMessage(provisionalHtg = 0) {
  const amount = safeInt(provisionalHtg);
  return amount > 0
    ? `Ou gen ${amount} HTG an atant sou kont ou. HTG sa yo ka jwe, men yo poko apwouve, kidonk yo pa ka soti nan retrait pou kounya.`
    : "Ou gen HTG an atant sou kont ou. Yo ka jwe, men yo pa ka soti nan retrait pou kounya.";
}

function buildWithdrawalDepositRequiredMessage(ruleStatus = {}) {
  const startLabel = String(ruleStatus?.withdrawalPlayPolicyStartLabel || "jodi a").trim() || "jodi a";
  return `Depi ${startLabel}, ou dwe fe yon nouvo depo apwouve epi jwe pou 50 HTG avan retrait la ka louvri sou kont ou.`;
}

function buildWithdrawableReasonMessage(ruleStatus = {}, withdrawable = 0) {
  if (hasPendingExamWithdrawalLock(ruleStatus)) {
    return buildPendingWithdrawalExamMessage(ruleStatus.provisionalHtgAvailable);
  }
  if (isWithdrawalDepositRequired(ruleStatus)) {
    return buildWithdrawalDepositRequiredMessage(ruleStatus);
  }
  if (hasPendingWithdrawalPlayRule(ruleStatus)) {
    return buildPendingWithdrawalPlayMessage(ruleStatus.pendingWithdrawalPlayHtg);
  }
  if (ruleStatus.accountFrozen) {
    return "Kont ou jele pou retrait pou kounya. Kontakte asistans pou plis detay.";
  }
  if (ruleStatus.withdrawalHold) {
    return "Kont ou bloke pou retrait pou kounya. Kontakte asistans si w bezwen plis eksplikasyon.";
  }
  if (safeInt(withdrawable) <= 0 && safeInt(ruleStatus.approvedDepositsHtg) <= 0) {
    return "Ou poko gen HTG apwouve ki antre nan pati retirable a. Se sa ki fe retrait la rete a 0 HTG.";
  }
  if (safeInt(withdrawable) <= 0) {
    return "Pou kounya, sistem nan pa jwenn okenn HTG retirable sou kont ou. Se sa ki fe retrait la rete a 0 HTG.";
  }
  return "";
}

function openRetraitPendingOperationsProfile() {
  window.location.href = "./profile.html?panel=history";
}

function ensureRetraitRuleModal() {
  const existing = document.getElementById("retraitRuleModalOverlay");
  if (existing) {
    applyRetraitTheme(existing, activeRetraitTheme);
    return existing;
  }

  const overlay = document.createElement("div");
  overlay.id = "retraitRuleModalOverlay";
  overlay.className = "fixed inset-0 z-[3460] hidden items-center justify-center bg-black/50 p-4 backdrop-blur-sm";
  overlay.innerHTML = `
    <div id="retraitRuleModalPanel" class="w-full max-w-md rounded-3xl border border-white/20 bg-[#3F4766]/78 p-5 text-white shadow-[14px_14px_34px_rgba(16,23,40,0.5),-10px_-10px_24px_rgba(112,126,165,0.2)] backdrop-blur-xl sm:p-6">
      <h3 id="retraitRuleModalTitle" class="text-lg font-bold">Retrait bloke</h3>
      <p id="retraitRuleModalMessage" class="mt-2 text-sm text-white/90"></p>
      <div id="retraitRuleModalDetails" class="mt-3 rounded-2xl border border-white/20 bg-white/10 p-3 text-xs text-white/85"></div>
      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        <button id="retraitRuleModalContact" type="button" class="h-11 w-full rounded-2xl border border-white/20 bg-white/10 text-sm font-semibold text-white">
          Kontakte asistans
        </button>
        <button id="retraitRuleModalClose" type="button" class="h-11 w-full rounded-2xl border border-[#ffb26e] bg-[#F57C00] text-sm font-semibold text-white shadow-[8px_8px_18px_rgba(163,82,27,0.45),-6px_-6px_14px_rgba(255,175,102,0.22)]">
          Mwen konprann
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  applyRetraitTheme(overlay, activeRetraitTheme);
  const panel = overlay.querySelector("#retraitRuleModalPanel");
  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  };
  overlay.querySelector("#retraitRuleModalClose")?.addEventListener("click", close);
  overlay.querySelector("#retraitRuleModalContact")?.addEventListener("click", () => {
    window.open(buildRetraitWhatsAppUrl(), "_blank", "noopener,noreferrer");
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  panel?.addEventListener("click", (event) => event.stopPropagation());
  return overlay;
}

function showRetraitRuleModal(payload = {}) {
  const overlay = ensureRetraitRuleModal();
  const titleEl = overlay.querySelector("#retraitRuleModalTitle");
  const messageEl = overlay.querySelector("#retraitRuleModalMessage");
  const detailsEl = overlay.querySelector("#retraitRuleModalDetails");
  const lines = Array.isArray(payload.lines) ? payload.lines.filter(Boolean) : [];

  if (titleEl) titleEl.textContent = payload.title || "Retrait bloke";
  if (messageEl) messageEl.textContent = payload.message || "Aksyon sa a pa disponib pou kounya.";
  if (detailsEl) {
    detailsEl.textContent = "";
    (lines.length ? lines : ["Tcheke reg yo epi eseye anko."]).forEach((line) => {
      const p = document.createElement("p");
      p.textContent = String(line || "");
      detailsEl.appendChild(p);
    });
  }

  overlay.classList.remove("hidden");
  overlay.classList.add("flex");
}

function ensureRetraitSuccessModal() {
  const existing = document.getElementById("retraitSuccessModalOverlay");
  if (existing) {
    applyRetraitTheme(existing, activeRetraitTheme);
    return existing;
  }

  const assistanceLabel = getWhatsappContactLabel("withdrawal_assistance", ASSISTANCE_PHONE) || `+${ASSISTANCE_PHONE}`;
  const overlay = document.createElement("div");
  overlay.id = "retraitSuccessModalOverlay";
  overlay.className = "fixed inset-0 z-[3470] hidden items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4";
  overlay.innerHTML = `
    <div id="retraitSuccessModalPanel" class="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[30px] border border-white/20 bg-[#101827]/94 text-white shadow-[18px_18px_40px_rgba(2,6,17,0.58),-10px_-10px_24px_rgba(24,35,58,0.14)] sm:max-h-[86vh] sm:rounded-[30px]">
      <div class="flex-1 overflow-y-auto px-5 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-6">
        <div class="flex items-start gap-3">
          <div class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-500/15 text-emerald-100">
            <span class="text-lg">✓</span>
          </div>
          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100/70">Demann retre voye</p>
            <h3 class="mt-1 text-xl font-bold text-white">Demann ou a voye byen</h3>
          </div>
        </div>
        <div class="mt-4 rounded-2xl border border-[#ffb26e]/25 bg-[#1b2437]/90 p-4">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffcf9f]">Sa ki pi enpotan</p>
          <p class="mt-1 text-base font-semibold text-white">Ou dwe kontakte ajan an</p>
          <p class="mt-2 text-sm leading-6 text-white/80">
            Ou dwe ekri ajan an sou WhatsApp epi rele li pou resevwa retre ou. Si ou pa fe sa, ou ka pa resevwa retre a.
          </p>
          <div class="mt-4 grid gap-2">
            <button id="retraitSuccessWhatsapp1" type="button" class="min-h-[48px] w-full rounded-2xl border border-emerald-300/20 bg-emerald-500/15 px-4 text-sm font-semibold text-emerald-50">
              Ekri sou WhatsApp ${assistanceLabel}
            </button>
          </div>
        </div>
        <div class="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p id="retraitSuccessPrimary" class="text-sm leading-6 text-white/90">
            Ou ka tcheke eta retre ou a nan OPERATIONS EN COURS sou pwofil ou.
          </p>
          <p id="retraitSuccessSecondary" class="mt-2 text-sm leading-6 text-white/72">
            La a ou ap we si demann nan toujou an atant, an verifikasyon, oswa fin trete.
          </p>
        </div>
      </div>
      <div class="grid gap-2 border-t border-white/10 bg-[#101827]/96 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:grid-cols-2 sm:px-6">
        <button id="retraitSuccessPending" type="button" class="h-11 rounded-2xl border border-white/15 bg-white/10 text-sm font-semibold text-white">
          Ale sou pwofil la
        </button>
        <button id="retraitSuccessClose" type="button" class="h-11 rounded-2xl border border-[#ffb26e] bg-[#F57C00] text-sm font-semibold text-white shadow-[8px_8px_18px_rgba(163,82,27,0.45),-6px_-6px_14px_rgba(255,175,102,0.22)]">
          Femen
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  applyRetraitTheme(overlay, activeRetraitTheme);
  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  };
  overlay.querySelector("#retraitSuccessClose")?.addEventListener("click", close);
  overlay.querySelector("#retraitSuccessPending")?.addEventListener("click", () => {
    close();
    openRetraitPendingOperationsProfile();
  });
  overlay.querySelector("#retraitSuccessWhatsapp1")?.addEventListener("click", () => {
    window.open(buildRetraitWhatsAppUrl("Bonjou, mwen sot voye yon demann retre epi mwen bezwen resevwa li rapid."), "_blank", "noopener,noreferrer");
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector("#retraitSuccessModalPanel")?.addEventListener("click", (event) => event.stopPropagation());
  return overlay;
}

function showRetraitSuccessModal(payload = {}) {
  const overlay = ensureRetraitSuccessModal();
  const primary = overlay.querySelector("#retraitSuccessPrimary");
  if (primary && safeInt(payload.amount) > 0) {
    primary.textContent = `Demann retre ou pou ${formatAmount(payload.amount)} te soumet. Ou ka swiv li nan OPERATIONS EN COURS sou pwofil ou.`;
  }
  overlay.classList.remove("hidden");
  overlay.classList.add("flex");
}

async function loadActiveMethods() {
  const payload = await getPublicPaymentOptionsSecure({});
  const methods = Array.isArray(payload?.methods) ? payload.methods : [];
  return methods.filter((item) => {
    if (!item) return false;
    const isEnabled = item.enabled === true || item.isActive !== false;
    if (!isEnabled) return false;
    if (item.visible === false) return false;
    return true;
  });
}

function bindHideOnErrorImages(root) {
  if (!root) return;
  root.querySelectorAll('img[data-hide-on-error="1"]').forEach((img) => {
    if (img.dataset.errorBound === "1") return;
    img.dataset.errorBound = "1";
    img.addEventListener("error", () => {
      img.style.display = "none";
    });
  });
}

function ensureRetraitModal() {
  const existing = document.getElementById("retraitModalOverlay");
  if (existing) {
    applyRetraitTheme(existing, activeRetraitTheme);
    return existing;
  }

  const overlay = document.createElement("div");
  overlay.id = "retraitModalOverlay";
  overlay.className = "fixed inset-0 z-[3450] hidden items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4";
  overlay.innerHTML = `
    <div id="retraitModalPanel" class="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[30px] border border-white/20 bg-[#1a2237]/96 text-white shadow-[18px_18px_40px_rgba(2,6,17,0.58),-10px_-10px_24px_rgba(24,35,58,0.14)] sm:max-h-[86vh] sm:rounded-[30px]">
      <div class="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">Retre rapid</p>
          <h2 class="mt-1 text-lg font-bold text-white">Retire HTG ou</h2>
        </div>
        <button id="retraitModalClose" type="button" class="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/10 text-white">
          <span class="text-xl leading-none">×</span>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 sm:px-6">
        <div id="retraitBalanceBox" class="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p class="text-xs uppercase tracking-[0.14em] text-white/55">HTG retirable</p>
          <p id="retraitAvailableAmount" class="mt-2 text-2xl font-black text-white">0 HTG</p>
          <p id="retraitBalanceHint" class="mt-2 text-sm leading-6 text-white/70">N ap verifye kondisyon retrait ou yo...</p>
        </div>
        <div id="retraitRuleAlert" class="mt-4 hidden rounded-2xl border border-[#ffb26e]/20 bg-[#ffb26e]/10 p-4 text-sm leading-6 text-[#ffe0b9]"></div>
        <div id="retraitStepMethods" class="mt-5">
          <p class="text-sm font-semibold text-white">1. Chwazi metod retrait la</p>
          <div id="retraitMethods" class="mt-3 grid gap-3"></div>
        </div>
        <div id="retraitStepForm" class="mt-5 hidden">
          <p id="retraitMethodLabel" class="text-sm font-semibold text-white/80"></p>
          <div class="mt-4 grid gap-3">
            <input id="retraitAmountInput" type="number" min="${MIN_WITHDRAWAL_HTG}" max="${MAX_WITHDRAWAL_HTG}" class="h-12 rounded-2xl border border-white/10 bg-white/8 px-4 text-sm text-white outline-none" placeholder="Montan HTG" />
            <input id="retraitFirstNameInput" type="text" class="h-12 rounded-2xl border border-white/10 bg-white/8 px-4 text-sm text-white outline-none" placeholder="Prenom" />
            <input id="retraitLastNameInput" type="text" class="h-12 rounded-2xl border border-white/10 bg-white/8 px-4 text-sm text-white outline-none" placeholder="Nom" />
            <input id="retraitPhoneInput" type="tel" class="h-12 rounded-2xl border border-white/10 bg-white/8 px-4 text-sm text-white outline-none" placeholder="Telefon" />
          </div>
        </div>
        <p id="retraitError" class="mt-4 text-sm text-[#ffb0b0]"></p>
      </div>
      <div class="grid gap-2 border-t border-white/10 bg-[#1a2237]/98 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:grid-cols-2 sm:px-6">
        <button id="retraitBackBtn" type="button" class="hidden h-11 rounded-2xl border border-white/15 bg-white/10 text-sm font-semibold text-white">
          Retounen
        </button>
        <button id="retraitNextBtn" type="button" class="h-11 rounded-2xl border border-[#ffb26e] bg-[#F57C00] text-sm font-semibold text-white shadow-[8px_8px_18px_rgba(163,82,27,0.45),-6px_-6px_14px_rgba(255,175,102,0.22)] sm:col-span-2">
          Suivant
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  applyRetraitTheme(overlay, activeRetraitTheme);

  const panel = overlay.querySelector("#retraitModalPanel");
  const closeBtn = overlay.querySelector("#retraitModalClose");
  const backBtn = overlay.querySelector("#retraitBackBtn");
  const nextBtn = overlay.querySelector("#retraitNextBtn");
  const methodsEl = overlay.querySelector("#retraitMethods");
  const amountInput = overlay.querySelector("#retraitAmountInput");
  const firstNameInput = overlay.querySelector("#retraitFirstNameInput");
  const lastNameInput = overlay.querySelector("#retraitLastNameInput");
  const phoneInput = overlay.querySelector("#retraitPhoneInput");
  const methodLabelEl = overlay.querySelector("#retraitMethodLabel");
  const availableEl = overlay.querySelector("#retraitAvailableAmount");
  const hintEl = overlay.querySelector("#retraitBalanceHint");
  const errorEl = overlay.querySelector("#retraitError");
  const ruleAlertEl = overlay.querySelector("#retraitRuleAlert");
  const stepMethodsEl = overlay.querySelector("#retraitStepMethods");
  const stepFormEl = overlay.querySelector("#retraitStepForm");

  let step = 1;
  let selectedMethod = null;
  let methods = [];
  let isSubmitting = false;
  let activeRequestId = "";

  const syncStepVisibility = (element, isVisible) => {
    if (!element) return;
    element.hidden = !isVisible;
    element.classList.toggle("hidden", !isVisible);
  };

  const setStep = (value) => {
    step = value === 2 ? 2 : 1;
    syncStepVisibility(stepMethodsEl, step === 1);
    syncStepVisibility(stepFormEl, step === 2);
    backBtn.classList.toggle("hidden", step !== 2);
    nextBtn.textContent = isSubmitting ? "Traitement..." : (step === 1 ? "Suivant" : "Soumettre");
    nextBtn.classList.toggle("sm:col-span-2", step !== 2);
  };

  const setSubmitting = (value) => {
    isSubmitting = value === true;
    nextBtn.disabled = isSubmitting;
    nextBtn.textContent = isSubmitting ? "Traitement..." : (step === 1 ? "Suivant" : "Soumettre");
  };

  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    document.body.classList.remove("is-modal-open");
  };

  const renderMethods = () => {
    if (!methods.length) {
      methodsEl.innerHTML = `<p class="text-sm text-white/75">Pa gen metod aktif.</p>`;
      return;
    }
    methodsEl.innerHTML = methods.map((m) => {
      const imagePath = resolveMethodAssetPath(m.image);
      return `
        <button type="button" data-method-id="${escapeHtml(m.id)}" class="retrait-method w-full rounded-2xl border border-white/15 bg-white/8 p-3 text-left text-white transition hover:bg-white/12">
          <div class="flex items-center gap-3">
            ${imagePath
              ? `<img src="${escapeHtml(imagePath)}" alt="${escapeHtml(m.name || "Metod")}" class="h-10 w-10 rounded-xl object-cover border border-white/15 bg-white/10" data-hide-on-error="1">`
              : `<div class="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/10"><span>₭</span></div>`
            }
            <p class="text-sm font-semibold">${escapeHtml(m.name || "Metod")}</p>
          </div>
        </button>
      `;
    }).join("");
    bindHideOnErrorImages(methodsEl);
    methodsEl.querySelectorAll(".retrait-method").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-method-id");
        selectedMethod = methods.find((m) => m.id === id) || null;
        methodsEl.querySelectorAll(".retrait-method").forEach((node) => {
          node.classList.remove("border-[#ffb26e]", "bg-[#F57C00]/20");
        });
        btn.classList.add("border-[#ffb26e]", "bg-[#F57C00]/20");
      });
    });
  };

  const refreshAvailability = async () => {
    const user = auth.currentUser;
    if (!user?.uid) return null;
    const ruleStatus = await getWithdrawalRuleStatus(user.uid);
    const visibleBalance = getLiveWalletVisibleHtg(ruleStatus._fundingStatus) ?? getLiveWalletVisibleHtg(ruleStatus._clientData) ?? getBestFundingBalance(ruleStatus._fundingStatus) ?? 0;
    const withdrawable = safeInt(ruleStatus.withdrawableHtg);
    const showRuleAlert = (message = "") => {
      ruleAlertEl.hidden = false;
      ruleAlertEl.classList.remove("hidden");
      ruleAlertEl.textContent = message;
    };
    const hideRuleAlert = () => {
      ruleAlertEl.hidden = true;
      ruleAlertEl.classList.add("hidden");
      ruleAlertEl.textContent = "";
    };
    availableEl.textContent = formatAmount(withdrawable);
    hintEl.textContent = `Balans vizib: ${formatAmount(visibleBalance)} · Ou ka retire: ${formatAmount(withdrawable)}`;
    hintEl.textContent = `Balans vizib: ${formatAmount(visibleBalance)} | Ou ka retire: ${formatAmount(withdrawable)}`;
    if (hasPendingExamWithdrawalLock(ruleStatus)) {
      showRuleAlert(buildPendingWithdrawalExamMessage(ruleStatus.provisionalHtgAvailable));
    } else if (hasPendingWithdrawalPlayRule(ruleStatus)) {
      showRuleAlert(buildPendingWithdrawalPlayMessage(ruleStatus.pendingWithdrawalPlayHtg));
    } else if (isWithdrawalDepositRequired(ruleStatus)) {
      showRuleAlert(buildWithdrawalDepositRequiredMessage(ruleStatus));
    } else if (withdrawable <= 0) {
      showRuleAlert(buildWithdrawableReasonMessage(ruleStatus, withdrawable));
    } else {
      hideRuleAlert();
    }
    return { ruleStatus, visibleBalance, withdrawableHtg: withdrawable };
  };

  const open = async () => {
    const user = auth.currentUser;
    if (!user?.uid) {
      if (typeof window.__kobposhOpenAuthScreen === "function") {
        window.__kobposhOpenAuthScreen("login");
      }
      return;
    }
    selectedMethod = null;
    methods = [];
    activeRequestId = "";
    if (amountInput) amountInput.value = "";
    if (firstNameInput) firstNameInput.value = "";
    if (lastNameInput) lastNameInput.value = "";
    if (phoneInput) phoneInput.value = "";
    if (methodLabelEl) methodLabelEl.textContent = "";
    if (errorEl) errorEl.textContent = "";
    setSubmitting(false);
    setStep(1);
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    document.body.classList.add("is-modal-open");
    await refreshAvailability().catch(() => {});
    try {
      methods = await loadActiveMethods();
      renderMethods();
    } catch (error) {
      console.error("[KOBPOSH][WITHDRAWAL] methods load failed", error);
      if (errorEl) errorEl.textContent = "Nou pa rive chaje metod retrait yo.";
    }
  };

  nextBtn.addEventListener("click", async () => {
    if (errorEl) errorEl.textContent = "";
    if (step === 1) {
      if (!selectedMethod) {
        if (errorEl) errorEl.textContent = "Chwazi yon metod retrait avan ou kontinye.";
        return;
      }
      if (methodLabelEl) methodLabelEl.textContent = `Metod: ${selectedMethod.name || selectedMethod.id}`;
      setStep(2);
      return;
    }

    const user = auth.currentUser;
    if (!user?.uid) {
      if (typeof window.__kobposhOpenAuthScreen === "function") {
        window.__kobposhOpenAuthScreen("login");
      }
      return;
    }

    const amount = safeInt(amountInput?.value || 0);
    const firstName = String(firstNameInput?.value || "").trim();
    const lastName = String(lastNameInput?.value || "").trim();
    const phone = String(phoneInput?.value || "").trim();

    if (amount < MIN_WITHDRAWAL_HTG || amount > MAX_WITHDRAWAL_HTG) {
      if (errorEl) errorEl.textContent = `Montan an dwe antre ant ${MIN_WITHDRAWAL_HTG} HTG ak ${MAX_WITHDRAWAL_HTG} HTG.`;
      return;
    }
    if (!firstName || !lastName || !phone) {
      if (errorEl) errorEl.textContent = "Prenom, nom ak telefon obligatwa.";
      return;
    }
    if (isSubmitting) return;

    activeRequestId = activeRequestId || createClientRequestId("withdrawal");
    setSubmitting(true);

    try {
      const availability = await refreshAvailability();
      const available = safeInt(availability?.withdrawableHtg || 0);
      const ruleStatus = availability?.ruleStatus || await getWithdrawalRuleStatus(user.uid);

      if (ruleStatus.accountFrozen) {
        showRetraitRuleModal({
          title: "Kont la jele",
          message: "Kont ou bloke pou retrait pou kounya.",
          lines: ["Kontakte asistans pou plis detay."],
        });
        setSubmitting(false);
        return;
      }
      if (ruleStatus.withdrawalHold) {
        showRetraitRuleModal({
          title: "Retrait bloke",
          message: "Kont ou bloke pou retrait apre plizye pwoblem sou dosye a.",
          lines: [
            `Reje anrejistre: ${safeInt(ruleStatus.rejectedDepositStrikeCount)}/3`,
            "Kontakte asistans si w panse se yon erè.",
          ],
        });
        setSubmitting(false);
        return;
      }
        if (hasPendingExamWithdrawalLock(ruleStatus)) {
          showRetraitRuleModal({
            title: "HTG an atant",
            message: buildPendingWithdrawalExamMessage(ruleStatus.provisionalHtgAvailable),
            lines: [
              `HTG an atant: ${formatAmount(ruleStatus.provisionalHtgAvailable)}`,
              `Retirable kounya: ${formatAmount(available)}`,
              "Le yon admin apwouve HTG sa yo, yo ka vin antre nan pati retirable a.",
            ],
          });
          setSubmitting(false);
          return;
        }
        if (isWithdrawalDepositRequired(ruleStatus)) {
          showRetraitRuleModal({
            title: "Nouvo depo obligatwa",
            message: buildWithdrawalDepositRequiredMessage(ruleStatus),
            lines: [
              "Regleman retrait la mande yon nouvo depo apwouve.",
              "Apre sa, ou dwe jwe pou 50 HTG pou retrait la vin louvri.",
            ],
          });
          setSubmitting(false);
          return;
        }
        if (hasPendingWithdrawalPlayRule(ruleStatus)) {
        showRetraitRuleModal({
          title: "Retrait poko louvri",
            message: buildPendingWithdrawalPlayMessage(ruleStatus.pendingWithdrawalPlayHtg),
            lines: [
              `Rete pou jwe: ${formatAmount(ruleStatus.pendingWithdrawalPlayHtg)}`,
              `Retirable kounya: ${formatAmount(available)}`,
              "Se apre ou fin jwe kantite sa a ke HTG yo ka soti nan retrait.",
            ],
          });
          setSubmitting(false);
          return;
        }
      if (amount > available || !ruleStatus.canWithdraw) {
        showRetraitRuleModal({
          title: "Retrait poko disponib",
          message: "Montan sa a pa disponib pou retrait kounya.",
          lines: [
            `Retirable kounya: ${formatAmount(available)}`,
            `Depo apwouve: ${formatAmount(ruleStatus.approvedDepositsHtg)}`,
          ],
        });
        setSubmitting(false);
        return;
      }

      const response = await createWithdrawalSecure({
        requestedAmount: amount,
        destinationType: selectedMethod?.id || "",
        destinationValue: phone,
        methodId: selectedMethod?.id || "",
        customerName: `${firstName} ${lastName}`.trim(),
        customerPhone: phone,
        requestId: activeRequestId,
      });

      window.dispatchEvent(new CustomEvent("withdrawalSubmitted", {
        detail: {
          id: response?.withdrawalId || "",
          amount,
          requestedAmount: amount,
          status: response?.status || "pending",
          methodName: selectedMethod?.name || "",
          createdAt: new Date().toISOString(),
          type: "withdrawal",
          userHiddenByClient: false,
        },
      }));
      close();
      showRetraitSuccessModal({
        amount,
        withdrawalId: response?.withdrawalId || "",
        status: response?.status || "pending",
      });
    } catch (error) {
      console.error("[KOBPOSH][WITHDRAWAL] submit failed", error);
        if (String(error?.details?.code || "") === "withdrawal-pending-htg") {
          const pendingExamHtg = safeInt(error?.details?.provisionalHtgAvailable);
          showRetraitRuleModal({
            title: "HTG an atant",
            message: buildPendingWithdrawalExamMessage(pendingExamHtg),
            lines: [
              `HTG an atant: ${formatAmount(pendingExamHtg)}`,
              "HTG sa yo pa ka soti nan retrait toutotan yo poko apwouve.",
            ],
          });
        } else if (String(error?.details?.code || "") === "withdrawal-play-required") {
          const pendingHtg = safeInt(error?.details?.pendingWithdrawalPlayHtg);
          showRetraitRuleModal({
            title: "Retrait poko louvri",
            message: buildPendingWithdrawalPlayMessage(pendingHtg),
            lines: [
              `Rete pou jwe: ${formatAmount(pendingHtg)}`,
              "Jwe kantite sa a avan ou retounen fe retrait la.",
            ],
          });
        } else if (String(error?.details?.code || "") === "withdrawal-deposit-required") {
          showRetraitRuleModal({
            title: "Nouvo depo obligatwa",
            message: buildWithdrawalDepositRequiredMessage(error?.details || {}),
            lines: [
              "Fe yon nouvo depo apwouve.",
              "Apre sa, jwe 50 HTG pou retrait la vin louvri.",
            ],
          });
        } else {
        if (errorEl) errorEl.textContent = error?.message || "Nou pa rive soumet demann retrait la.";
      }
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
  });

  backBtn?.addEventListener("click", () => {
    if (errorEl) errorEl.textContent = "";
    setStep(1);
  });
  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  panel?.addEventListener("click", (event) => event.stopPropagation());

  window.addEventListener("userBalanceUpdated", () => {
    if (!overlay.classList.contains("hidden")) void refreshAvailability().catch(() => {});
  });
  window.addEventListener("xchangeUpdated", () => {
    if (!overlay.classList.contains("hidden")) void refreshAvailability().catch(() => {});
  });
  window.addEventListener("transferUpdated", () => {
    if (!overlay.classList.contains("hidden")) void refreshAvailability().catch(() => {});
  });

  overlay.__openRetrait = open;
  return overlay;
}

export function mountRetraitModal(options = {}) {
  const { triggerSelector = "#profileWithdrawBtn", theme = "default" } = options;
  activeRetraitTheme = normalizeRetraitTheme(theme);
  const overlay = ensureRetraitModal();
  applyRetraitTheme(overlay, activeRetraitTheme);
  const trigger = document.querySelector(triggerSelector);
  if (trigger && overlay.__openRetrait && !trigger.dataset.boundRetrait) {
    trigger.dataset.boundRetrait = "1";
    trigger.addEventListener("click", () => {
      activeRetraitTheme = normalizeRetraitTheme(theme);
      applyRetraitTheme(overlay, activeRetraitTheme);
      overlay.__openRetrait();
    });
  }
  window.openRetraitDirectly = () => {
    activeRetraitTheme = normalizeRetraitTheme(theme);
    applyRetraitTheme(overlay, activeRetraitTheme);
    if (overlay.__openRetrait) overlay.__openRetrait();
  };
}
