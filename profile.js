import {
  EmailAuthProvider,
  auth,
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  reauthenticateWithCredential,
  updatePassword,
} from "./firebase-init.js";
import { startAfter } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  createTransferSecure,
  getDepositFundingStatusSecure,
  listTransferHistorySecure,
  searchTransferRecipientsSecure,
} from "./secure-functions.js";
import { formatAuthError, logoutCurrentUser } from "./auth.js";
import { buildWhatsappUrlForKey, getWhatsappContactLabel, refreshWhatsappModalContacts } from "./whatsapp-modal-config.js";

const PROFILE_LUCIDE_PATHS = {
  "arrow-left": '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
  "arrow-down-to-line": '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
  "eye": '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>',
  "eye-off": '<path d="m2 2 20 20"></path><path d="M10.58 10.58a2 2 0 1 0 2.83 2.83"></path><path d="M9.363 5.365A10.674 10.674 0 0 1 12 5c4.808 0 8.873 3.208 10 7-1.563 5.182-8.258 7.036-12.637 6.635"></path><path d="M6.228 6.228C4.365 7.497 2.93 9.282 2 12c.617 2.056 2.059 3.974 4.228 5.228"></path>',
  "history": '<path d="M3 3v5h5"></path><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"></path><path d="M12 7v5l4 2"></path>',
  "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path>',
  "message-circle": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>',
  "send": '<path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path>',
  "user-round": '<circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 0 0-16 0"></path>',
  "wallet": '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5"></path><path d="M18 12h.01"></path>',
  "x": '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
};

const TRANSFER_MIN_HTG = 25;
const TRANSFER_FEE_HTG = 5;
const TRANSFER_HISTORY_PAGE_SIZE = 8;
const transferState = {
  currentStep: 1,
  selectedRecipient: null,
  searchResults: [],
  historyItems: [],
  historyLoaded: false,
  searching: false,
  sending: false,
  loadingHistory: false,
};
let transferPendingGateModal = null;
let profileAgentHelpModal = null;

function renderProfileIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
    return;
  }
  document.querySelectorAll("[data-lucide]").forEach((node) => {
    const name = String(node.getAttribute("data-lucide") || "").trim();
    const paths = PROFILE_LUCIDE_PATHS[name];
    if (!paths) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("class", node.getAttribute("class") || "icon");
    svg.setAttribute("data-lucide", name);
    svg.innerHTML = paths;
    node.replaceWith(svg);
  });
}
renderProfileIcons();

function formatProfilePasswordError(error) {
  const code = String(error?.code || "");
  if (code.includes("wrong-password") || code.includes("invalid-credential")) {
    return "Ansyen modpas la pa bon.";
  }
  if (code.includes("too-many-requests")) {
    return "Gen twop tantativ. Tann yon ti moman epi eseye ankÃ².";
  }
  if (code.includes("requires-recent-login")) {
    return "Tanpri rekonekte avan ou chanje modpas la.";
  }
  return formatAuthError(error, "Nou pa ka chanje modpas la kounye a.");
}

function bindPasswordVisibilityToggle(button, input) {
  if (!button || !input || button.dataset.bound === "1") return;
  button.dataset.bound = "1";
  button.addEventListener("click", () => {
    const currentlyHidden = input.type === "password";
    input.type = currentlyHidden ? "text" : "password";
    button.setAttribute("aria-label", currentlyHidden ? "Kache modpas" : "Montre modpas");
    const icon = button.querySelector("i");
    if (icon) {
      icon.setAttribute("data-lucide", currentlyHidden ? "eye-off" : "eye");
    }
    renderProfileIcons();
  });
}

function mountProfilePasswordModal() {
  const overlay = document.getElementById("profilePasswordOverlay");
  const openBtn = document.getElementById("profilePasswordBtn");
  const closeBtn = document.getElementById("profilePasswordClose");
  const cancelBtn = document.getElementById("profilePasswordCancel");
  const form = document.getElementById("profilePasswordForm");
  const submitBtn = document.getElementById("profilePasswordSubmit");
  const statusEl = document.getElementById("profilePasswordStatus");
  const currentInput = document.getElementById("profileCurrentPassword");
  const nextInput = document.getElementById("profileNewPassword");
  const confirmInput = document.getElementById("profileConfirmPassword");
  const toggleCurrent = document.getElementById("profileCurrentPasswordToggle");
  const toggleNext = document.getElementById("profileNewPasswordToggle");
  const toggleConfirm = document.getElementById("profileConfirmPasswordToggle");

  if (!overlay || !openBtn || !form || !submitBtn || !currentInput || !nextInput || !confirmInput) return;

  const setStatus = (message = "", tone = "neutral") => {
    statusEl.textContent = String(message || "");
    statusEl.classList.remove("is-error", "is-success");
    if (tone === "error") statusEl.classList.add("is-error");
    if (tone === "success") statusEl.classList.add("is-success");
  };

  const resetVisibility = () => {
    [currentInput, nextInput, confirmInput].forEach((input) => {
      input.type = "password";
    });
    [toggleCurrent, toggleNext, toggleConfirm].forEach((button) => {
      if (!button) return;
      button.setAttribute("aria-label", "Montre modpas");
      const icon = button.querySelector("i");
      if (icon) icon.setAttribute("data-lucide", "eye");
    });
    renderProfileIcons();
  };

  const closeModal = () => {
    overlay.hidden = true;
    form.reset();
    setStatus("");
    resetVisibility();
  };

  const openModal = () => {
    overlay.hidden = false;
    setStatus("");
    window.setTimeout(() => currentInput.focus(), 20);
  };

  window.__kobposhProfilePassword = {
    openModal,
    closeModal,
  };

  const setBusy = (busy) => {
    const disabled = busy === true;
    [openBtn, closeBtn, cancelBtn, submitBtn, currentInput, nextInput, confirmInput, toggleCurrent, toggleNext, toggleConfirm]
      .forEach((element) => {
        if (element) element.disabled = disabled;
      });
    submitBtn.textContent = disabled ? "Ap mete ajou..." : "Mete ajou";
  };

  bindPasswordVisibilityToggle(toggleCurrent, currentInput);
  bindPasswordVisibilityToggle(toggleNext, nextInput);
  bindPasswordVisibilityToggle(toggleConfirm, confirmInput);

  if (openBtn.dataset.bound !== "1") {
    openBtn.dataset.bound = "1";
    openBtn.addEventListener("click", openModal);
  }
  if (closeBtn && closeBtn.dataset.bound !== "1") {
    closeBtn.dataset.bound = "1";
    closeBtn.addEventListener("click", closeModal);
  }
  if (cancelBtn && cancelBtn.dataset.bound !== "1") {
    cancelBtn.dataset.bound = "1";
    cancelBtn.addEventListener("click", closeModal);
  }
  if (overlay.dataset.bound !== "1") {
    overlay.dataset.bound = "1";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal();
    });
  }

  if (form.dataset.bound !== "1") {
    form.dataset.bound = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const user = auth.currentUser;
      const email = String(user?.email || "").trim();
      const currentPassword = String(currentInput.value || "");
      const newPassword = String(nextInput.value || "");
      const confirmPassword = String(confirmInput.value || "");

      if (!user?.uid || !email) {
        setStatus("Tanpri rekonekte avan.", "error");
        return;
      }
      if (!currentPassword) {
        setStatus("Antre ansyen modpas la.", "error");
        currentInput.focus();
        return;
      }
      if (newPassword.length < 6) {
        setStatus("Nouvo modpas la dwe gen omwen 6 karakte.", "error");
        nextInput.focus();
        return;
      }
      if (newPassword !== confirmPassword) {
        setStatus("Konfimasyon modpas la pa menm.", "error");
        confirmInput.focus();
        return;
      }
      if (currentPassword === newPassword) {
        setStatus("Chwazi yon modpas ki diferan ak ansyen an.", "error");
        nextInput.focus();
        return;
      }

      setBusy(true);
      setStatus("Ap verifye kont lan...");
      try {
        const credential = EmailAuthProvider.credential(email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword);
        setStatus("Modpas ou chanje ak siksÃ¨.", "success");
        window.setTimeout(() => closeModal(), 800);
      } catch (error) {
        setStatus(formatProfilePasswordError(error), "error");
      } finally {
        setBusy(false);
      }
    });
  }
}

function safeText(value, fallback = "-") {
  const out = String(value || "").trim();
  return out || fallback;
}

function formatHtg(value) {
  const amount = Number(value || 0);
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)} HTG`;
}

function pickFirstFiniteNumber(...values) {
  for (const value of values) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
}

function getBestBalance(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const playable = pickFirstFiniteNumber(source.playableHtg, source.availableGourdes);
    if (Number.isFinite(playable) && playable >= 0) return playable;

    const approved = pickFirstFiniteNumber(source.approvedHtgAvailable, source.approvedGourdesAvailable);
    const provisional = pickFirstFiniteNumber(source.provisionalHtgAvailable, source.provisionalGourdesAvailable);
    if (Number.isFinite(approved) || Number.isFinite(provisional)) {
      return Math.max(
        0,
        (Number.isFinite(approved) ? approved : 0) + (Number.isFinite(provisional) ? provisional : 0)
      );
    }

    const withdrawable = pickFirstFiniteNumber(source.withdrawableHtg);
    if (Number.isFinite(withdrawable) && withdrawable >= 0) return withdrawable;
  }

  return null;
}

function getLiveWalletVisibleHtg(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const approved = pickFirstFiniteNumber(source.approvedHtgAvailable, source.approvedGourdesAvailable);
    const provisional = pickFirstFiniteNumber(source.provisionalHtgAvailable, source.provisionalGourdesAvailable);
    if (Number.isFinite(approved) || Number.isFinite(provisional)) {
      return Math.max(
        0,
        (Number.isFinite(approved) ? approved : 0) + (Number.isFinite(provisional) ? provisional : 0)
      );
    }
    const playable = pickFirstFiniteNumber(source.playableHtg, source.availableGourdes);
    if (Number.isFinite(playable) && playable >= 0) return playable;
  }
  return null;
}

function getPendingTransferLockAmount(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const pending = pickFirstFiniteNumber(source.provisionalHtgAvailable, source.provisionalGourdesAvailable);
    if (Number.isFinite(pending) && pending > 0) return Math.max(0, Math.trunc(pending));
  }
  return 0;
}

let latestProfileUser = null;
let latestProfileClientData = {};
let latestProfileFundingData = {};
let profileClientUnsub = null;
let profileFundingRefreshTimer = null;

function getDisplayName(user, clientData = {}) {
  return safeText(
    clientData.name
    || clientData.displayName
    || clientData.NonItilizate
    || user?.displayName
    || (user?.email ? user.email.split("@")[0] : ""),
    "Jwe"
  );
}

function getDisplayNonItilizate(user, clientData = {}) {
  return safeText(
    clientData.NonItilizate
    || "NonItilizate",
    "NonItilizate"
  );
}

function getDisplayEmail(user, clientData = {}) {
  return safeText(
    clientData.email
    || user?.email
    || "",
    ""
  );
}

function getDisplayPhone(user, clientData = {}) {
  return safeText(clientData.phone || clientData.customerPhone || "", "");
}

function getDisplayIdentifier(user, clientData = {}) {
  return safeText(
    clientData.NonItilizate
    || clientData.email
    || user?.email
    || user?.uid
    || "",
    "Idantifyan pa disponib"
  );
}

function getSidebarStatus(funding = {}, clientData = {}) {
  if (funding.accountFrozen === true || clientData.accountFrozen === true) return "KONT BLOKE";
  if (funding.withdrawalHold === true || clientData.withdrawalHold === true) return "RETRE BLOKE";
  const approved = Number(funding?.approvedHtgAvailable || clientData?.approvedHtgAvailable || 0);
  const provisional = Number(funding?.provisionalHtgAvailable || clientData?.provisionalHtgAvailable || 0);
  if (approved > 0 || provisional > 0) return "MANM AKTIF";
  return "MANM";
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return Number(value.toMillis()) || 0;
  if (typeof value?.seconds === "number") {
    const seconds = Number(value.seconds) || 0;
    const nanos = Number(value.nanoseconds) || 0;
    return (seconds * 1000) + Math.floor(nanos / 1e6);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatHistoryDate(value) {
  const ms = toMillis(value);
  if (!ms) return "-";
  return new Date(ms).toLocaleString("fr-HT", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getOperationKind(item = {}) {
  return String(item.type || item.collectionName || "").toLowerCase().includes("withdraw") ? "withdrawal" : "order";
}

function getOperationTitle(item = {}) {
  return getOperationKind(item) === "withdrawal" ? "Retre" : "Depo";
}

function getOperationAmount(item = {}) {
  const direct = Number(item.amount);
  if (Number.isFinite(direct)) return Math.max(0, Math.floor(direct));
  const requested = Number(item.requestedAmount);
  if (Number.isFinite(requested)) return Math.max(0, Math.floor(requested));
  return 0;
}

function normalizeOperationStatus(item = {}) {
  const raw = String(item.resolutionStatus || item.status || "pending").trim().toLowerCase();
  if (raw === "approved" || raw === "success" || raw === "completed" || raw === "done") return "approved";
  if (raw === "cancelled" || raw === "canceled") return "cancelled";
  if (raw === "rejected" || raw === "refused" || raw === "failed") return "rejected";
  if (raw === "review" || raw === "pending_review" || raw === "verifying" || raw === "processing") return "review";
  return "pending";
}

function getOperationStatusLabel(status) {
  if (status === "approved") return "Apwouve";
  if (status === "rejected") return "Rejte";
  if (status === "cancelled") return "Anile";
  if (status === "review") return "An revizyon";
  return "An atant";
}

function getOperationStatusClass(status) {
  if (status === "approved") return "is-approved";
  if (status === "rejected") return "is-rejected";
  if (status === "cancelled") return "is-cancelled";
  if (status === "review") return "is-review";
  return "is-pending";
}

function isPendingOperation(item = {}) {
  if (!item || item.userHiddenByClient) return false;
  const status = normalizeOperationStatus(item);
  return status !== "approved" && status !== "cancelled";
}

function formatHistoryAmount(item = {}) {
  const amount = getOperationAmount(item);
  const kind = getOperationKind(item);
  const prefix = kind === "withdrawal" ? "-" : "+";
  return `${prefix}${formatHtg(amount)}`;
}

function renderOperationCard(item = {}) {
  const kind = getOperationKind(item);
  const status = normalizeOperationStatus(item);
  const title = getOperationTitle(item);
  const amount = formatHistoryAmount(item);
  const method = safeText(item.methodName || item.method || item.paymentMethod || "-", "-");
  const code = safeText(item.uniqueCode || item.id || "-", "-");
  const createdAt = formatHistoryDate(item.createdAt);
  const note = safeText(item.note || item.message || item.reason || "", "");
  const amountClass = kind === "withdrawal" ? "is-out" : "";

  const wrapper = document.createElement("article");
  wrapper.className = "profile-history-item";
  wrapper.innerHTML = `
    <div class="profile-history-item__top">
      <div class="min-w-0">
        <p class="profile-history-item__title">${title} ${code}</p>
        <p class="profile-history-item__meta">${createdAt}</p>
      </div>
      <div class="profile-history-item__amount ${amountClass}">${amount}</div>
    </div>
    <div class="profile-history-item__body">
      <span class="profile-history-item__badge ${getOperationStatusClass(status)}">${getOperationStatusLabel(status)}</span>
      <div>Metod: ${method}</div>
      ${note ? `<div>Note: ${note}</div>` : ""}
    </div>
  `;
  return wrapper;
}

function renderOperationsList(target, items = [], emptyText = "Pa gen operasyon.") {
  const listEl = typeof target === "string" ? document.querySelector(target) : target;
  if (!listEl) return;
  listEl.replaceChildren();
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "profile-history-empty";
    empty.textContent = emptyText;
    listEl.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    listEl.appendChild(renderOperationCard(item));
  });
}

const AGENT_CONTACT_OPTIONS = {
  deposit: [
    { key: "agent_deposit", title: "Ajan depo", role: "Depo / validasyon", note: "Kontakte ajan sa a pou fe yon depo." },
    { key: "support_default", title: "Sipot", role: "Asistans jeneral", note: "Si ajan depo a pa reponn, kontakte sipot la." },
  ],
  withdrawal: [
    { key: "withdrawal_assistance", title: "Ajan retre", role: "Retre / swivi", note: "Kontakte ajan sa a pou yon retre." },
    { key: "support_default", title: "Sipot", role: "Asistans jeneral", note: "Si ajan retre a pa reponn, kontakte sipot la." },
  ],
};

function getAgentPanelMode() {
  const active = document.querySelector("[data-profile-panel='agents']")?.dataset.mode || "deposit";
  return active === "withdrawal" ? "withdrawal" : "deposit";
}

function setAgentPanelMode(mode = "deposit") {
  const panel = document.querySelector("[data-profile-panel='agents']");
  if (!panel) return;
  panel.dataset.mode = mode === "withdrawal" ? "withdrawal" : "deposit";
}

function renderAgentContacts(mode = "deposit") {
  const listEl = document.querySelector("[data-profile-agents-list]");
  const titleEl = document.querySelector("[data-profile-agents-title]");
  const copyEl = document.querySelector("[data-profile-agents-copy]");
  const normalizedMode = mode === "withdrawal" ? "withdrawal" : "deposit";
  const items = AGENT_CONTACT_OPTIONS[normalizedMode] || AGENT_CONTACT_OPTIONS.deposit;

  if (titleEl) {
    titleEl.textContent = normalizedMode === "withdrawal" ? "KONTAKTE YON AJAN RETRE" : "KONTAKTE YON AJAN DEPO";
  }
  if (copyEl) {
    copyEl.textContent = normalizedMode === "withdrawal"
      ? "Chwazi yon ajan retre pou kontinye sou WhatsApp."
      : "Chwazi yon ajan depo pou kontinye sou WhatsApp.";
  }
  if (!listEl) return;

  listEl.replaceChildren();
  items.forEach((item) => {
    const phoneLabel = getWhatsappContactLabel(item.key);
    const waLink = buildWhatsappUrlForKey(item.key, normalizedMode === "withdrawal"
      ? "Bonjou, mwen bezwen fe yon retre sou kont mwen."
      : "Bonjou, mwen bezwen fe yon depo sou kont mwen.");
    const card = document.createElement("article");
    card.className = "profile-agent-card";
    card.innerHTML = `
      <div class="profile-agent-card__top">
        <div class="min-w-0">
          <h3 class="profile-agent-card__name">${item.title}</h3>
          <p class="profile-agent-card__role">${item.role}</p>
        </div>
        <p class="profile-agent-card__phone">${phoneLabel || ""}</p>
      </div>
      <div class="profile-agent-card__actions">
        <a class="profile-agent-card__button" href="${waLink}" target="_blank" rel="noopener noreferrer">
          <i data-lucide="message-circle"></i>
          WhatsApp
        </a>
        <span class="profile-agent-card__button is-secondary" aria-hidden="true">${item.note}</span>
      </div>
    `;
    listEl.appendChild(card);
  });

  renderProfileIcons();
}

function getAvatarInitials(name = "") {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] || "P";
  const second = parts[1]?.[0] || parts[0]?.[1] || " ";
  return `${first}${second}`.trim().toUpperCase();
}

async function loadClientData(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return {};
  try {
    const snap = await getDoc(doc(db, "clients", safeUid));
    return snap.exists() ? (snap.data() || {}) : {};
  } catch (error) {
    console.warn("[KOBPOSH][PROFILE] client load failed", error);
    return {};
  }
}

function setHeaderBalance(value) {
  const headerBalanceEl = document.querySelector("[data-profile-header-balance]");
  if (!headerBalanceEl) return;
  headerBalanceEl.textContent = Number.isFinite(Number(value)) ? formatHtg(value) : "-- HTG";
}

function setAvatar(user, clientData = {}) {
  const avatarEl = document.querySelector("[data-profile-avatar]");
  const avatarTextEl = document.querySelector("[data-profile-avatar-text]");
  if (!avatarEl) return;

  const photoUrl = String(clientData.photoURL || user?.photoURL || "").trim();
  const name = getDisplayName(user, clientData);
  const initials = getAvatarInitials(name);

  avatarEl.classList.toggle("has-photo", Boolean(photoUrl));
  if (photoUrl) {
    avatarEl.style.backgroundImage = `url("${photoUrl}")`;
    avatarEl.style.backgroundSize = "cover";
    avatarEl.style.backgroundPosition = "center";
    avatarEl.style.color = "transparent";
    if (avatarTextEl) avatarTextEl.textContent = "";
  } else {
    avatarEl.style.backgroundImage = "";
    avatarEl.style.backgroundSize = "";
    avatarEl.style.backgroundPosition = "";
    avatarEl.style.color = "#ffffff";
    if (avatarTextEl) avatarTextEl.textContent = initials;
  }
}

function updateProfileFields(user, clientData = {}, fundingData = {}) {
  const name = getDisplayName(user, clientData);
  const NonItilizate = getDisplayNonItilizate(user, clientData);
  const email = getDisplayEmail(user, clientData);
  const phone = getDisplayPhone(user, clientData);
  const identifier = getDisplayIdentifier(user, clientData);
  const balance = getLiveWalletVisibleHtg(fundingData, clientData) ?? getBestBalance(fundingData, clientData);
  const sidebarStatus = getSidebarStatus(fundingData, clientData);

  const nameEl = document.querySelector("[data-profile-sidebar-name]");
  const statusEl = document.querySelector("[data-profile-sidebar-status]");
  const fullNameInput = document.getElementById("fullName");
  const emailInput = document.getElementById("email");
  const phoneInput = document.getElementById("phone");
  const identifierInput = document.getElementById("identifier");
  const walletAmountEl = document.querySelector("[data-profile-wallet-amount]");

  if (nameEl) nameEl.textContent = NonItilizate;
  if (statusEl) statusEl.textContent = sidebarStatus;
  if (fullNameInput) fullNameInput.value = name;
  if (emailInput) emailInput.value = email || "";
  if (phoneInput) phoneInput.value = phone || "";
  if (identifierInput) identifierInput.value = identifier || "";
  if (walletAmountEl) walletAmountEl.textContent = Number.isFinite(balance) ? formatHtg(balance) : "-- HTG";

  if (document.title && name) {
    document.title = `${name} | Kobposh`;
  }

  setAvatar(user, clientData);
  setHeaderBalance(balance);
}

function renderCurrentProfileState() {
  updateProfileFields(latestProfileUser, latestProfileClientData || {}, latestProfileFundingData || {});
}

function stopProfileClientWatcher() {
  if (typeof profileClientUnsub === "function") {
    profileClientUnsub();
    profileClientUnsub = null;
  }
}

function stopProfileFundingRefreshTimer() {
  if (profileFundingRefreshTimer) {
    window.clearTimeout(profileFundingRefreshTimer);
    profileFundingRefreshTimer = null;
  }
}

function scheduleFundingRefresh(uid, delayMs = 0) {
  const safeUid = String(uid || "").trim();
  stopProfileFundingRefreshTimer();
  if (!safeUid) {
    latestProfileFundingData = {};
    renderCurrentProfileState();
    return;
  }
  profileFundingRefreshTimer = window.setTimeout(async () => {
    profileFundingRefreshTimer = null;
    try {
      latestProfileFundingData = await getDepositFundingStatusSecure({}).catch((error) => {
        console.warn("[KOBPOSH][PROFILE] funding load failed", error);
        return {};
      });
    } finally {
      renderCurrentProfileState();
    }
  }, Math.max(0, Number(delayMs) || 0));
}

function startProfileClientWatcher(user) {
  const uid = String(user?.uid || "").trim();
  stopProfileClientWatcher();
  latestProfileUser = user || null;
  latestProfileClientData = {};
  if (!uid) {
    renderCurrentProfileState();
    return;
  }

  profileClientUnsub = onSnapshot(doc(db, "clients", uid), (snap) => {
    latestProfileClientData = snap.exists() ? (snap.data() || {}) : {};
    renderCurrentProfileState();
  }, (error) => {
    console.warn("[KOBPOSH][PROFILE] client realtime failed", error);
  });
}

async function loadUserOperations(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return { orders: [], withdrawals: [] };

  const ordersRef = collection(db, "clients", safeUid, "orders");
  const withdrawalsRef = collection(db, "clients", safeUid, "withdrawals");

  const [ordersSnap, withdrawalsSnap] = await Promise.all([
    getDocs(query(ordersRef, orderBy("createdAt", "desc"))).catch((error) => {
      console.warn("[KOBPOSH][PROFILE] orders history load failed", error);
      return { docs: [] };
    }),
    getDocs(query(withdrawalsRef, orderBy("createdAt", "desc"))).catch((error) => {
      console.warn("[KOBPOSH][PROFILE] withdrawals history load failed", error);
      return { docs: [] };
    }),
  ]);

  const orders = Array.isArray(ordersSnap.docs)
    ? ordersSnap.docs.map((snap) => ({ id: snap.id, type: "order", ...snap.data() }))
    : [];
  const withdrawals = Array.isArray(withdrawalsSnap.docs)
    ? withdrawalsSnap.docs.map((snap) => ({ id: snap.id, type: "withdrawal", ...snap.data() }))
    : [];

  const pending = [...orders, ...withdrawals]
    .filter(isPendingOperation)
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

  const deposits = [...orders]
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

  const withdrawalsSorted = [...withdrawals]
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

  return { orders, withdrawals: withdrawalsSorted, pending, deposits };
}

function setProfilePanel(panelKey = "info") {
  const key = String(panelKey || "info").trim();
  document.querySelectorAll("[data-profile-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.getAttribute("data-profile-panel") === key);
  });
  document.querySelectorAll("[data-profile-nav]").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("data-profile-nav") === key);
  });
}

function resolveInitialProfilePanel() {
  const params = new URLSearchParams(window.location.search || "");
  const requested = String(params.get("panel") || "").trim().toLowerCase();
  if (requested === "history") return "history";
  if (requested === "agents") return "agents";
  return "info";
}

function resolveInitialProfileHistorySection() {
  const params = new URLSearchParams(window.location.search || "");
  const requested = String(params.get("historySection") || "").trim().toLowerCase();
  if (requested === "deposit" || requested === "withdrawal") return requested;
  return "pending";
}

function resolveInitialAgentMode() {
  const params = new URLSearchParams(window.location.search || "");
  const requested = String(params.get("agentMode") || "").trim().toLowerCase();
  return requested === "withdrawal" ? "withdrawal" : "deposit";
}

function resolveInitialProfileModal() {
  const params = new URLSearchParams(window.location.search || "");
  const requested = String(params.get("modal") || "").trim().toLowerCase();
  if (requested === "transfer" || requested === "password") return requested;
  return "";
}

function getTransferElements() {
  return {
    panel: document.querySelector('[data-profile-panel="transfer"]'),
    closeButton: document.querySelector("[data-transfer-close]"),
    stepOne: document.querySelector('[data-transfer-step="1"]'),
    stepTwo: document.querySelector('[data-transfer-step="2"]'),
    stepThree: document.querySelector('[data-transfer-step="3"]'),
    searchInput: document.querySelector("[data-transfer-search-input]"),
    searchNextButton: document.querySelector("[data-transfer-search-next]"),
    prevToSearchButton: document.querySelector("[data-transfer-prev-to-search]"),
    nextToAmountButton: document.querySelector("[data-transfer-next-to-amount]"),
    prevToResultsButton: document.querySelector("[data-transfer-prev-to-results]"),
    searchStatus: document.querySelector("[data-transfer-search-status]"),
    searchStatusStepTwo: document.querySelector("[data-transfer-search-status-step2]"),
    searchResults: document.querySelector("[data-transfer-search-results]"),
    selectedName: document.querySelector("[data-transfer-selected-name]"),
    selectedMeta: document.querySelector("[data-transfer-selected-meta]"),
    amountInput: document.querySelector("[data-transfer-amount-input]"),
    sendButton: document.querySelector("[data-transfer-send-button]"),
    sendStatus: document.querySelector("[data-transfer-send-status]"),
    historyList: document.querySelector("[data-transfer-history-list]"),
    historyRefresh: document.querySelector("[data-transfer-history-refresh]"),
  };
}

function syncTransferStepUi() {
  const { stepOne, stepTwo, stepThree, nextToAmountButton } = getTransferElements();
  if (stepOne) stepOne.hidden = transferState.currentStep !== 1;
  if (stepTwo) stepTwo.hidden = transferState.currentStep !== 2;
  if (stepThree) stepThree.hidden = transferState.currentStep !== 3;
  if (nextToAmountButton) {
    nextToAmountButton.disabled = !transferState.selectedRecipient?.uid;
  }
}

function goToTransferStep(step = 1) {
  transferState.currentStep = Math.min(3, Math.max(1, Number(step) || 1));
  syncTransferStepUi();
}

function ensureTransferPendingGateModal() {
  if (transferPendingGateModal) return transferPendingGateModal;

  transferPendingGateModal = document.createElement("section");
  transferPendingGateModal.className = "kobposh-forgot-modal";
  transferPendingGateModal.setAttribute("aria-hidden", "true");
  transferPendingGateModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="profileTransferPendingGateTitle">
      <button class="kobposh-forgot-modal__close" type="button" data-transfer-pending-gate-close aria-label="Femen mesaj la">
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">TRANSFER BLOKE</p>
      <h3 id="profileTransferPendingGateTitle" class="kobposh-forgot-modal__title">Ou pa ka fe transfer pou kounye a</h3>
      <p class="kobposh-forgot-modal__text" data-transfer-pending-gate-text>
        Ou gen HTG an atant sou kont ou. Tout transfer zanmi rete bloke jouk HTG sa yo fin apwouve oswa regle.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-transfer-pending-gate-ok>
        Mwen konprann
      </button>
    </div>
  `;

  document.body.appendChild(transferPendingGateModal);
  renderProfileIcons();

  transferPendingGateModal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target === transferPendingGateModal
      || target?.closest("[data-transfer-pending-gate-close]")
      || target?.closest("[data-transfer-pending-gate-ok]")
    ) {
      closeTransferPendingGateModal();
    }
  });

  return transferPendingGateModal;
}

function openTransferPendingGateModal(pendingAmount = 0) {
  const modal = ensureTransferPendingGateModal();
  const textEl = modal.querySelector("[data-transfer-pending-gate-text]");
  if (textEl) {
    const amountLabel = pendingAmount > 0 ? formatHtg(pendingAmount) : "HTG an atant";
    textEl.textContent = `Ou gen ${amountLabel} an atant sou kont ou. Ou pa ka fe transfer zanmi jouk HTG sa yo fin apwouve oswa regle.`;
  }
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function closeTransferPendingGateModal() {
  if (!transferPendingGateModal) return;
  transferPendingGateModal.classList.remove("is-open");
  transferPendingGateModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function ensureProfileAgentHelpModal() {
  if (profileAgentHelpModal) return profileAgentHelpModal;

  profileAgentHelpModal = document.createElement("section");
  profileAgentHelpModal.className = "kobposh-forgot-modal";
  profileAgentHelpModal.setAttribute("aria-hidden", "true");
  profileAgentHelpModal.innerHTML = `
    <div class="kobposh-forgot-modal__panel" role="dialog" aria-modal="true" aria-labelledby="profileAgentHelpTitle">
      <button class="kobposh-forgot-modal__close" type="button" data-profile-agent-help-close aria-label="Femen mesaj la">
        <i data-lucide="x" class="icon" aria-hidden="true"></i>
      </button>
      <p class="kobposh-forgot-modal__eyebrow">ASISTANS</p>
      <h3 id="profileAgentHelpTitle" class="kobposh-forgot-modal__title">Opimion w enpotan, ou enpotan</h3>
      <p class="kobposh-forgot-modal__text">
        Siw rankontre on probleme klike sou bouton anba a pou kontakte on agent. Site la fet pou fe kob li pa fet pou pran kob ou, sou Kobpoch se plis ou fo plis ou fe lajan.
      </p>
      <button class="kobposh-forgot-modal__action" type="button" data-profile-agent-help-contact>
        KONTAKTE AGENT AN
      </button>
    </div>
  `;

  document.body.appendChild(profileAgentHelpModal);
  renderProfileIcons();

  const closeTargets = profileAgentHelpModal.querySelectorAll("[data-profile-agent-help-close]");
  closeTargets.forEach((button) => {
    button.addEventListener("click", closeProfileAgentHelpModal);
  });
  profileAgentHelpModal.addEventListener("click", (event) => {
    if (event.target === profileAgentHelpModal) {
      closeProfileAgentHelpModal();
    }
  });
  profileAgentHelpModal.querySelector("[data-profile-agent-help-contact]")?.addEventListener("click", () => {
    const waLink = buildWhatsappUrlForKey(
      "support_default",
      "Bonjou, mwen gen yon pwoblem sou Kobpoch epi mwen bezwen pale ak yon agent."
    );
    closeProfileAgentHelpModal();
    if (waLink) {
      window.location.href = waLink;
    }
  });

  return profileAgentHelpModal;
}

function openProfileAgentHelpModal() {
  const modal = ensureProfileAgentHelpModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
}

function closeProfileAgentHelpModal() {
  if (!profileAgentHelpModal) return;
  profileAgentHelpModal.classList.remove("is-open");
  profileAgentHelpModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
}

function openTransferModal() {
  const { panel, searchInput } = getTransferElements();
  if (!panel) return;
  const pendingAmount = getPendingTransferLockAmount(latestProfileFundingData, latestProfileClientData);
  if (pendingAmount > 0) {
    openTransferPendingGateModal(pendingAmount);
    return;
  }
  console.log("[PROFILE_V2_TRANSFER] open modal");
  goToTransferStep(1);
  panel.hidden = false;
  panel.removeAttribute("hidden");
  panel.classList.add("is-open");
  panel.style.display = "block";
  panel.style.visibility = "visible";
  panel.style.opacity = "1";
  document.body.style.overflow = "hidden";
  window.setTimeout(() => searchInput?.focus(), 20);
  if (!transferState.historyLoaded && !transferState.loadingHistory) {
    void loadTransferHistory(true);
  }
}

function closeTransferModal() {
  const { panel } = getTransferElements();
  if (!panel) return;
  console.log("[PROFILE_V2_TRANSFER] close modal");
  panel.classList.remove("is-open");
  panel.style.display = "none";
  panel.style.visibility = "";
  panel.style.opacity = "";
  panel.hidden = true;
  document.body.style.overflow = "";
}

function setTransferStatus(kind, message = "", tone = "neutral") {
  const { searchStatus, searchStatusStepTwo, sendStatus } = getTransferElements();
  const nodes = kind === "search"
    ? [searchStatus, searchStatusStepTwo]
    : [sendStatus];
  nodes.forEach((node) => {
    if (!node) return;
    node.textContent = String(message || "");
    node.classList.remove("is-error", "is-success");
    if (tone === "error") node.classList.add("is-error");
    if (tone === "success") node.classList.add("is-success");
  });
}

function getTransferRecipientLabel(recipient = {}) {
  return String(
    recipient.name
    || recipient.username
    || recipient.phone
    || recipient.email
    || "Kont san non"
  ).trim();
}

function getTransferRecipientMeta(recipient = {}) {
  const username = String(recipient.username || "").trim();
  const phone = String(recipient.phone || "").trim();
  const email = String(recipient.email || "").trim();
  return [username ? `@${username}` : "", phone, email].filter(Boolean).join(" · ") || "Kont resepte a";
}

function renderTransferSelection() {
  const { selectedName, selectedMeta } = getTransferElements();
  if (!selectedName || !selectedMeta) return;
  if (!transferState.selectedRecipient) {
    selectedName.textContent = "Poko gen zanmi chwazi";
    selectedMeta.textContent = "Chwazi yon zanmi nan rezilta rechech yo.";
    return;
  }
  selectedName.textContent = getTransferRecipientLabel(transferState.selectedRecipient);
  selectedMeta.textContent = getTransferRecipientMeta(transferState.selectedRecipient);
  syncTransferStepUi();
}

function renderTransferSearchResults() {
  const { searchResults } = getTransferElements();
  if (!searchResults) return;
  searchResults.replaceChildren();

  if (transferState.searching) {
    const loading = document.createElement("p");
    loading.className = "profile-history-empty";
    loading.textContent = "Ap chache zanmi an...";
    searchResults.appendChild(loading);
    return;
  }

  if (!transferState.searchResults.length) {
    const empty = document.createElement("p");
    empty.className = "profile-history-empty";
    empty.textContent = "Pa gen rezilta pou rechèch sa a.";
    searchResults.appendChild(empty);
    return;
  }

  transferState.searchResults.forEach((recipient) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "profile-transfer-result";
    if (transferState.selectedRecipient?.uid === recipient.uid) {
      button.classList.add("is-selected");
    }

    const textWrap = document.createElement("div");
    const title = document.createElement("p");
    title.className = "profile-transfer-result__title";
    title.textContent = getTransferRecipientLabel(recipient);
    const meta = document.createElement("p");
    meta.className = "profile-transfer-result__meta";
    meta.textContent = getTransferRecipientMeta(recipient);
    textWrap.append(title, meta);

    const tag = document.createElement("span");
    tag.className = "profile-transfer-result__tag";
    tag.textContent = "CHWAZI";

    button.append(textWrap, tag);
    button.addEventListener("click", () => {
      transferState.selectedRecipient = recipient;
      renderTransferSelection();
      renderTransferSearchResults();
      setTransferStatus("send", "");
    });
    searchResults.appendChild(button);
  });
}

function renderTransferHistory() {
  const { historyList } = getTransferElements();
  if (!historyList) return;
  historyList.replaceChildren();

  if (transferState.loadingHistory) {
    const loading = document.createElement("p");
    loading.className = "profile-history-empty";
    loading.textContent = "Ap chaje transfer yo...";
    historyList.appendChild(loading);
    return;
  }

  if (!transferState.historyItems.length) {
    const empty = document.createElement("p");
    empty.className = "profile-history-empty";
    empty.textContent = "Pa gen transfer anko.";
    historyList.appendChild(empty);
    return;
  }

  transferState.historyItems.forEach((item) => {
    const card = document.createElement("article");
    card.className = "profile-history-item";

    const top = document.createElement("div");
    top.className = "profile-history-item__top";

    const left = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "profile-history-item__title";
    const direction = String(item.direction || "").trim();
    const counterpart = direction === "sent"
      ? (item.recipientName || item.recipientUsername || "zanmi")
      : (item.senderName || item.senderUsername || "zanmi");
    title.textContent = direction === "sent" ? `Ou voye bay ${counterpart}` : `Ou resevwa nan men ${counterpart}`;
    const meta = document.createElement("p");
    meta.className = "profile-history-item__meta";
    meta.textContent = new Date(Number(item.createdAtMs || Date.now())).toLocaleString("fr-FR");
    left.append(title, meta);

    const amount = document.createElement("div");
    amount.className = `profile-history-item__amount${direction === "sent" ? " is-out" : ""}`;
    amount.textContent = `${direction === "sent" ? "-" : "+"}${formatHtg(direction === "sent" ? item.grossAmountHtg : item.netAmountHtg)}`;

    top.append(left, amount);

    const body = document.createElement("div");
    body.className = "profile-history-item__body";
    body.innerHTML = `
      <span>Montan brit: ${formatHtg(item.grossAmountHtg || 0)}</span>
      <span>Fre: ${formatHtg(item.feeHtg || 0)}</span>
      <span>Montan net: ${formatHtg(item.netAmountHtg || 0)}</span>
    `;

    card.append(top, body);
    historyList.appendChild(card);
  });
}

async function loadTransferHistory(force = false) {
  if (transferState.loadingHistory && !force) return;
  transferState.loadingHistory = true;
  renderTransferHistory();
  try {
    const response = await listTransferHistorySecure({ pageSize: TRANSFER_HISTORY_PAGE_SIZE });
    transferState.historyItems = Array.isArray(response?.items) ? response.items : [];
    transferState.historyLoaded = true;
  } catch (error) {
    console.warn("[KOBPOSH][TRANSFER] history load failed", error);
    transferState.historyItems = [];
  } finally {
    transferState.loadingHistory = false;
    renderTransferHistory();
  }
}

async function runTransferSearch() {
  const { searchInput } = getTransferElements();
  const rawQuery = String(searchInput?.value || "").trim();
  if (!rawQuery) {
    setTransferStatus("search", "Antre username zanmi an pou chache li.", "error");
    return;
  }
  transferState.searching = true;
  transferState.searchResults = [];
  renderTransferSearchResults();
  setTransferStatus("search", "Ap chache...");
  try {
    const response = await searchTransferRecipientsSecure({ query: rawQuery });
    transferState.searchResults = Array.isArray(response?.results) ? response.results : [];
    if (!transferState.searchResults.length) {
      transferState.selectedRecipient = null;
      renderTransferSelection();
      setTransferStatus("search", "Nou pa jwenn zanmi sa a kounye a.", "error");
    } else {
      setTransferStatus("search", `${transferState.searchResults.length} rezilta jwenn. Chwazi bon zanmi an.`, "success");
      goToTransferStep(2);
    }
  } catch (error) {
    console.warn("[KOBPOSH][TRANSFER] search failed", error);
    transferState.searchResults = [];
    setTransferStatus("search", error?.message || "Nou pa ka chache zanmi sa a kounye a.", "error");
  } finally {
    transferState.searching = false;
    renderTransferSearchResults();
  }
}

async function submitTransfer() {
  const { amountInput, sendButton } = getTransferElements();
  const selected = transferState.selectedRecipient;
  const amountHtg = Number(amountInput?.value || 0);

  if (!selected?.uid) {
    setTransferStatus("send", "Chwazi yon zanmi anvan ou voye transfer la.", "error");
    return;
  }
  if (!Number.isFinite(amountHtg) || amountHtg < TRANSFER_MIN_HTG) {
    setTransferStatus("send", `Montan minimum lan se ${TRANSFER_MIN_HTG} HTG.`, "error");
    return;
  }

  transferState.sending = true;
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = "AP VOYE...";
  }
  setTransferStatus("send", `Ap voye ${formatHtg(amountHtg)}. Fre sevis la se ${formatHtg(TRANSFER_FEE_HTG)}.`);
  try {
    const response = await createTransferSecure({
      recipientUid: selected.uid,
      amountHtg,
      requestId: `transfer:${auth.currentUser?.uid || "anon"}:${Date.now()}`,
    });
    if (amountInput) amountInput.value = "";
    setTransferStatus("send", `Transfer la reyisi. ${formatHtg(response?.netAmountHtg || 0)} rive jwenn ${getTransferRecipientLabel(selected)}.`, "success");
    window.dispatchEvent(new CustomEvent("transferUpdated"));
    void refreshProfileForUser(auth.currentUser || null);
    void loadTransferHistory(true);
  } catch (error) {
    console.warn("[KOBPOSH][TRANSFER] send failed", error);
    setTransferStatus("send", error?.message || "Nou pa ka voye transfer sa a kounye a.", "error");
  } finally {
    transferState.sending = false;
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = "VOYE TRANSFER A";
    }
  }
}

function mountTransferModal() {
  const {
    panel,
    closeButton,
    searchNextButton,
    searchInput,
    prevToSearchButton,
    nextToAmountButton,
    prevToResultsButton,
    sendButton,
    historyRefresh,
  } = getTransferElements();
  console.log("[PROFILE_V2_TRANSFER] mount", {
    hasPanel: Boolean(panel),
    hasCloseButton: Boolean(closeButton),
    hasSearchButton: Boolean(searchNextButton),
    hasSendButton: Boolean(sendButton),
  });
  if (!panel) return;
  panel.hidden = true;
  panel.style.display = "none";
  goToTransferStep(1);
  renderTransferSelection();
  renderTransferSearchResults();
  renderTransferHistory();

  if (closeButton && closeButton.dataset.bound !== "1") {
    closeButton.dataset.bound = "1";
    closeButton.addEventListener("click", closeTransferModal);
  }
  if (searchNextButton && searchNextButton.dataset.bound !== "1") {
    searchNextButton.dataset.bound = "1";
    searchNextButton.addEventListener("click", () => {
      void runTransferSearch();
    });
  }
  if (searchInput && searchInput.dataset.bound !== "1") {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void runTransferSearch();
      }
    });
  }
  if (sendButton && sendButton.dataset.bound !== "1") {
    sendButton.dataset.bound = "1";
    sendButton.addEventListener("click", () => {
      void submitTransfer();
    });
  }
  if (prevToSearchButton && prevToSearchButton.dataset.bound !== "1") {
    prevToSearchButton.dataset.bound = "1";
    prevToSearchButton.addEventListener("click", () => {
      goToTransferStep(1);
    });
  }
  if (nextToAmountButton && nextToAmountButton.dataset.bound !== "1") {
    nextToAmountButton.dataset.bound = "1";
    nextToAmountButton.addEventListener("click", () => {
      if (!transferState.selectedRecipient?.uid) {
        setTransferStatus("search", "Chwazi yon zanmi avan ou kontinye.", "error");
        return;
      }
      goToTransferStep(3);
    });
  }
  if (prevToResultsButton && prevToResultsButton.dataset.bound !== "1") {
    prevToResultsButton.dataset.bound = "1";
    prevToResultsButton.addEventListener("click", () => {
      goToTransferStep(2);
    });
  }
  if (historyRefresh && historyRefresh.dataset.bound !== "1") {
    historyRefresh.dataset.bound = "1";
    historyRefresh.addEventListener("click", () => {
      void loadTransferHistory(true);
    });
  }
}

const HISTORY_PAGE_SIZE = 3;
const HISTORY_SECTION_CONFIG = {
  pending: {
    emptyText: "Klike sou blok sa a pou chaje operasyon an kou yo.",
    moreText: "CHAJE PLIS",
  },
  deposit: {
    collectionName: "orders",
    emptyText: "Klike sou blok sa a pou chaje depo ajan yo.",
    moreText: "CHAJE PLIS",
  },
  withdrawal: {
    collectionName: "withdrawals",
    emptyText: "Klike sou blok sa a pou chaje retre yo.",
    moreText: "CHAJE PLIS",
  },
};

const historyState = {
  pending: {
    loaded: false,
    loading: false,
    open: false,
    items: [],
    visibleCount: HISTORY_PAGE_SIZE,
    hasMore: true,
    orderCursor: null,
    withdrawalCursor: null,
  },
  deposit: {
    loaded: false,
    loading: false,
    open: false,
    items: [],
    visibleCount: HISTORY_PAGE_SIZE,
    hasMore: true,
    cursor: null,
  },
  withdrawal: {
    loaded: false,
    loading: false,
    open: false,
    items: [],
    visibleCount: HISTORY_PAGE_SIZE,
    hasMore: true,
    cursor: null,
  },
};

function getHistorySectionElements(kind) {
  return {
    panel: document.querySelector(`[data-profile-history-panel="${kind}"]`),
    list: document.querySelector(`[data-profile-history-${kind}-list]`),
    count: document.querySelector(`[data-profile-history-${kind}-count]`),
    more: document.querySelector(`[data-profile-history-more="${kind}"]`),
    toggle: document.querySelector(`[data-profile-history-toggle="${kind}"]`),
  };
}

function resetHistorySections() {
  Object.values(historyState).forEach((state) => {
    state.loaded = false;
    state.loading = false;
    state.open = false;
    state.items = [];
    state.visibleCount = HISTORY_PAGE_SIZE;
    state.hasMore = true;
    state.cursor = null;
    state.orderCursor = null;
    state.withdrawalCursor = null;
  });

  Object.keys(HISTORY_SECTION_CONFIG).forEach((kind) => {
    const elements = getHistorySectionElements(kind);
    if (elements.panel) elements.panel.hidden = true;
    if (elements.toggle) elements.toggle.setAttribute("aria-expanded", "false");
    if (elements.count) elements.count.textContent = "0";
    if (elements.list) {
      elements.list.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "profile-history-empty";
      empty.textContent = HISTORY_SECTION_CONFIG[kind].emptyText;
      elements.list.appendChild(empty);
    }
    if (elements.more) elements.more.hidden = true;
  });
}

function renderHistorySection(kind) {
  const state = historyState[kind];
  const elements = getHistorySectionElements(kind);
  if (!state || !elements.panel || !elements.list) return;

  elements.panel.hidden = !state.open;
  if (elements.toggle) elements.toggle.setAttribute("aria-expanded", state.open ? "true" : "false");
  if (elements.count) elements.count.textContent = String(state.loaded ? state.items.length : 0);

  if (!state.open) return;

  if (!state.loaded && state.loading) {
    elements.list.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "profile-history-empty";
    loading.textContent = "Ap chaje...";
    elements.list.appendChild(loading);
    if (elements.more) elements.more.hidden = true;
    return;
  }

  const visibleItems = state.items.slice(0, state.visibleCount);
  renderOperationsList(elements.list, visibleItems, HISTORY_SECTION_CONFIG[kind].emptyText);

  if (elements.more) {
    const showMore = state.loaded && state.hasMore && state.visibleCount < state.items.length;
    elements.more.hidden = !showMore;
    elements.more.textContent = HISTORY_SECTION_CONFIG[kind].moreText;
  }
}

function appendUniqueHistoryItems(targetState, items = []) {
  const seen = new Set(targetState.items.map((item) => `${item.__sourceKey || ""}:${item.id || ""}`));
  items.forEach((item) => {
    const key = `${item.__sourceKey || ""}:${item.id || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    targetState.items.push(item);
  });
}

function mapHistoryDoc(collectionName, snap) {
  return {
    id: snap.id,
    __sourceKey: collectionName,
    type: collectionName === "withdrawals" ? "withdrawal" : "order",
    ...snap.data(),
  };
}

async function loadHistorySectionPage(uid, kind) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return;

  const state = historyState[kind];
  const elements = getHistorySectionElements(kind);
  if (!state || state.loading) return;

  state.loading = true;
  state.open = true;
  renderHistorySection(kind);

  try {
    if (kind === "pending") {
      const ordersRef = collection(db, "clients", safeUid, "orders");
      const withdrawalsRef = collection(db, "clients", safeUid, "withdrawals");

      const orderQuery = query(
        ordersRef,
        orderBy("createdAt", "desc"),
        ...(state.orderCursor ? [startAfter(state.orderCursor)] : []),
        limit(HISTORY_PAGE_SIZE)
      );
      const withdrawalQuery = query(
        withdrawalsRef,
        orderBy("createdAt", "desc"),
        ...(state.withdrawalCursor ? [startAfter(state.withdrawalCursor)] : []),
        limit(HISTORY_PAGE_SIZE)
      );

      const [ordersSnap, withdrawalsSnap] = await Promise.all([
        getDocs(orderQuery).catch((error) => {
          console.warn("[KOBPOSH][PROFILE] pending orders load failed", error);
          return { docs: [] };
        }),
        getDocs(withdrawalQuery).catch((error) => {
          console.warn("[KOBPOSH][PROFILE] pending withdrawals load failed", error);
          return { docs: [] };
        }),
      ]);

      state.orderCursor = ordersSnap.docs?.[ordersSnap.docs.length - 1] || state.orderCursor;
      state.withdrawalCursor = withdrawalsSnap.docs?.[withdrawalsSnap.docs.length - 1] || state.withdrawalCursor;

      const pendingItems = [
        ...(Array.isArray(ordersSnap.docs) ? ordersSnap.docs.map((snap) => mapHistoryDoc("orders", snap)) : []),
        ...(Array.isArray(withdrawalsSnap.docs) ? withdrawalsSnap.docs.map((snap) => mapHistoryDoc("withdrawals", snap)) : []),
      ]
        .filter(isPendingOperation)
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

      appendUniqueHistoryItems(state, pendingItems);
      state.hasMore = Boolean(
        (ordersSnap.docs?.length || 0) === HISTORY_PAGE_SIZE
        || (withdrawalsSnap.docs?.length || 0) === HISTORY_PAGE_SIZE
      );
    } else {
      const collectionName = HISTORY_SECTION_CONFIG[kind].collectionName;
      const baseRef = collection(db, "clients", safeUid, collectionName);
      const q = query(
        baseRef,
        orderBy("createdAt", "desc"),
        ...(state.cursor ? [startAfter(state.cursor)] : []),
        limit(HISTORY_PAGE_SIZE)
      );
      const snap = await getDocs(q).catch((error) => {
        console.warn("[KOBPOSH][PROFILE] history load failed", { kind, error });
        return { docs: [] };
      });
      state.cursor = snap.docs?.[snap.docs.length - 1] || state.cursor;
      const items = Array.isArray(snap.docs) ? snap.docs.map((docSnap) => mapHistoryDoc(collectionName, docSnap)) : [];
      appendUniqueHistoryItems(state, items);
      state.hasMore = (snap.docs?.length || 0) === HISTORY_PAGE_SIZE;
    }

    state.loaded = true;
    state.visibleCount = Math.min(Math.max(state.visibleCount, HISTORY_PAGE_SIZE), state.items.length || HISTORY_PAGE_SIZE);
    if (state.items.length < HISTORY_PAGE_SIZE && state.hasMore) {
      state.visibleCount = HISTORY_PAGE_SIZE;
    }
    renderHistorySection(kind);
  } catch (error) {
    console.warn("[KOBPOSH][PROFILE] history page load failed", { kind, error });
    const listEl = elements.list;
    if (listEl) {
      listEl.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "profile-history-empty";
      empty.textContent = "Nou pa ka chaje istwa a kounye a.";
      listEl.appendChild(empty);
    }
  } finally {
    state.loading = false;
    renderHistorySection(kind);
  }
}

function loadMoreHistorySection(kind) {
  const state = historyState[kind];
  if (!state) return;
  state.visibleCount += HISTORY_PAGE_SIZE;
  renderHistorySection(kind);
  if (state.visibleCount > state.items.length && state.hasMore && !state.loading) {
    const user = auth.currentUser;
    if (user?.uid) {
      void loadHistorySectionPage(user.uid, kind);
    }
  }
}

function openInitialHistorySection(kind = "pending") {
  const safeKind = historyState[kind] ? kind : "pending";
  const toggle = document.querySelector(`[data-profile-history-toggle="${safeKind}"]`);
  if (!(toggle instanceof HTMLElement)) return;
  if (historyState[safeKind].open !== true) {
    toggle.click();
    return;
  }
  if (!historyState[safeKind].loaded && !historyState[safeKind].loading) {
    void loadHistorySectionPage(auth.currentUser?.uid || "", safeKind);
  }
}

async function refreshProfileForUser(user) {
  const uid = String(user?.uid || "").trim();
  if (!uid) {
    latestProfileUser = null;
    latestProfileClientData = {};
    latestProfileFundingData = {};
    stopProfileClientWatcher();
    stopProfileFundingRefreshTimer();
    updateProfileFields(null, {}, {});
    resetHistorySections();
    return;
  }
  latestProfileUser = user || null;
  latestProfileClientData = await loadClientData(uid);
  latestProfileFundingData = await getDepositFundingStatusSecure({}).catch((error) => {
    console.warn("[KOBPOSH][PROFILE] funding load failed", error);
    return {};
  });
  startProfileClientWatcher(user);
  updateProfileFields(user, latestProfileClientData, latestProfileFundingData || {});
  renderAgentContacts(getAgentPanelMode());
  resetHistorySections();
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    stopProfileClientWatcher();
    stopProfileFundingRefreshTimer();
    window.location.href = "./index.html?auth=login";
    return;
  }
  void refreshProfileForUser(user || null);
});

function refreshProfileLiveSurface() {
  const user = auth.currentUser || null;
  latestProfileUser = user;
  if (!user?.uid) return;
  startProfileClientWatcher(user);
  scheduleFundingRefresh(user.uid, 0);
}

const profileBackBtn = document.querySelector("[data-profile-back]");
profileBackBtn?.addEventListener("click", () => {
  window.location.href = "./index.html";
});

document.querySelectorAll("[data-profile-nav]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const navKey = link.getAttribute("data-profile-nav") || "";
    console.log("[PROFILE_V2_TRANSFER] nav click", { navKey });
    if (navKey === "logout") {
      void logoutCurrentUser().finally(() => {
        window.location.href = "./index.html?auth=login";
      });
      return;
    }
    if (navKey === "transfer") {
      openTransferModal();
      return;
    }
    if (navKey === "agent-help") {
      openProfileAgentHelpModal();
      return;
    }
    const panel = navKey === "history" ? "history" : navKey === "deposit-agent" || navKey === "withdraw-agent" ? "agents" : "info";
    if (navKey === "deposit-agent") setAgentPanelMode("deposit");
    if (navKey === "withdraw-agent") setAgentPanelMode("withdrawal");
    setProfilePanel(panel);
    if (panel === "agents") {
      renderAgentContacts(getAgentPanelMode());
    }
  });
});

document.addEventListener("click", (event) => {
  const transferTrigger = event.target?.closest?.('[data-profile-nav="transfer"]');
  if (!transferTrigger) return;
  event.preventDefault();
  console.log("[PROFILE_V2_TRANSFER] delegated click");
  openTransferModal();
});

document.querySelectorAll("[data-profile-history-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const kind = button.getAttribute("data-profile-history-toggle") || "";
    if (!historyState[kind]) return;
    const state = historyState[kind];
    state.open = !state.open;
    renderHistorySection(kind);
    if (state.open && !state.loaded && !state.loading) {
      void loadHistorySectionPage(auth.currentUser?.uid || "", kind);
    }
  });
});

document.querySelectorAll("[data-profile-history-more]").forEach((button) => {
  button.addEventListener("click", () => {
    const kind = button.getAttribute("data-profile-history-more") || "";
    if (!historyState[kind]) return;
    loadMoreHistorySection(kind);
  });
});

document.querySelector("[data-profile-become-agent]")?.addEventListener("click", () => {
  const waLink = buildWhatsappUrlForKey(
    "recruitment_modal",
    "Bonjou, mwen vle vin yon ajan sou Kobpoch. Tanpri ban mwen etap yo."
  );
  if (waLink) {
    window.location.href = waLink;
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshProfileLiveSurface();
  }
});

window.addEventListener("focus", refreshProfileLiveSurface);
window.addEventListener("pageshow", refreshProfileLiveSurface);
window.addEventListener("storage", refreshProfileLiveSurface);
window.addEventListener("userBalanceUpdated", refreshProfileLiveSurface);
window.addEventListener("xchangeUpdated", refreshProfileLiveSurface);
window.addEventListener("transferUpdated", refreshProfileLiveSurface);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTransferModal();
    closeProfileAgentHelpModal();
  }
});

void refreshWhatsappModalContacts().then(() => {
  renderAgentContacts(getAgentPanelMode());
});

const initialProfilePanel = resolveInitialProfilePanel();
const initialProfileHistorySection = resolveInitialProfileHistorySection();
const initialAgentMode = resolveInitialAgentMode();
const initialProfileModal = resolveInitialProfileModal();
if (initialProfilePanel === "agents") {
  setAgentPanelMode(initialAgentMode);
}
setProfilePanel(initialProfilePanel);
mountTransferModal();
window.__kobposhProfileTransfer = {
  openTransferModal,
  closeTransferModal,
};
console.log("[PROFILE_V2_TRANSFER] boot complete", {
  initialProfilePanel,
  initialProfileHistorySection,
  initialAgentMode,
  initialProfileModal,
  transferTriggerCount: document.querySelectorAll('[data-profile-nav="transfer"]').length,
});
if (initialProfilePanel === "history") {
  window.setTimeout(() => openInitialHistorySection(initialProfileHistorySection), 0);
}
if (initialProfilePanel === "agents") {
  renderAgentContacts(initialAgentMode);
}
if (initialProfileModal === "transfer") {
  window.setTimeout(() => openTransferModal(), 0);
}
mountProfilePasswordModal();
if (initialProfileModal === "password") {
  window.setTimeout(() => {
    window.__kobposhProfilePassword?.openModal?.();
  }, 0);
}

