// ============= PAYMENT COMPONENT - PROCESSUS DE PAIEMENT =============
import {
  claimWelcomeBonusSecure,
  createOrderSecure,
  getDepositFundingStatusSecure,
  getPublicPaymentOptionsSecure,
} from './secure-functions.js?v=20260625-morpion-firebase1';
import { SUPPORT_WHATSAPP_PHONE, SUPPORT_WHATSAPP_LABEL, buildSupportWhatsAppUrl } from './support-contact.js';
import {
  buildWhatsappUrlForKey,
  getWhatsappContactDigits,
  getWhatsappContactLabel,
  refreshWhatsappModalContacts,
} from "./whatsapp-modal-config.js";

const OCR_LANGUAGE = 'fra+eng';
const DEPOSIT_BONUS_MIN_HTG = 100;
const DEPOSIT_BONUS_PERCENT = 10;
const DEPOSIT_BONUS_RATE_HTG_TO_DOES = 20;
const WELCOME_BONUS_HTG = 25;
const DEPOSIT_AGENT_ONLY_THRESHOLD_HTG = 1000;
const DEPOSIT_PROOF_TIMER_STORAGE_PREFIX = 'deposit_proof_started_at';
const DEPOSIT_RAPID_WARNING_STORAGE_PREFIX = 'deposit_rapid_warning_guard';
const DEPOSIT_LAST_OCR_TEXT_STORAGE_PREFIX = 'deposit_last_ocr_text';
const DEPOSIT_RAPID_WARNING_DELAY_MS = 6 * 60 * 1000;
const DEPOSIT_RAPID_WARNING_THRESHOLD = 2;
const SUPPORT_WHATSAPP_DIGITS = SUPPORT_WHATSAPP_PHONE;
const AGENT_DEPOSIT_WHATSAPP_DIGITS = SUPPORT_WHATSAPP_DIGITS;
const AGENT_DEPOSIT_WHATSAPP_LABEL = `+${AGENT_DEPOSIT_WHATSAPP_DIGITS}`;
let tesseractRuntimePromise = null;

void refreshWhatsappModalContacts().catch(() => {});

async function loadTesseractRuntime() {
  if (typeof window !== 'undefined' && window.Tesseract && typeof window.Tesseract.recognize === 'function') {
    return window.Tesseract;
  }

  if (!tesseractRuntimePromise) {
    tesseractRuntimePromise = (async () => {
      const moduleUrls = [
        'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js',
        'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.esm.min.js',
      ];

      for (const url of moduleUrls) {
        try {
          const mod = await import(url);
          const maybeLib = (mod && mod.default && typeof mod.default.recognize === 'function')
            ? mod.default
            : mod;
          if (maybeLib && typeof maybeLib.recognize === 'function') {
            return maybeLib;
          }
        } catch (_) {
          // fallback sur autre source
        }
      }

      await new Promise((resolve, reject) => {
        const existing = document.getElementById('tesseract-runtime-script');
        if (existing) {
          if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
            resolve();
            return;
          }
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', () => reject(new Error('Impossible de charger Tesseract')), { once: true });
          return;
        }

        const script = document.createElement('script');
        script.id = 'tesseract-runtime-script';
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Impossible de charger Tesseract'));
        document.head.appendChild(script);
      });

      if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
        return window.Tesseract;
      }

      throw new Error('Tesseract indisponible');
    })().catch((error) => {
      tesseractRuntimePromise = null;
      throw error;
    });
  }

  return tesseractRuntimePromise;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function sanitizePhoneInput(value) {
  return String(value || "")
    .replace(/[^\d+\-\s().]/g, "")
    .trim()
    .slice(0, 40);
}

function extractPhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeOcrSearchText(value) {
  return String(value || "")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function isLikelyDepositIdToken(value) {
  const token = String(value || '')
    .trim()
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  if (!token) return false;
  if (/^\d{5,}$/.test(token)) return true;
  if (!/^[A-Z0-9-]{5,}$/.test(token)) return false;
  return /[A-Z]/.test(token) || /\d{4,}/.test(token);
}

function extractDepositIdFromOcrText(value) {
  const text = normalizeOcrSearchText(value);
  if (!text) return '';

  const patterns = [
    /(?:TRANSACTION|TRANS|REFERENCE|REF|IDENTIFIANT|IDENTIFIANT DE TRANSACTION|ID)\s*(?:NO|N0|NUMERO|NUM|NUMBER|#|:|-)?\s*([A-Z0-9-]{5,})/g,
    /(?:NO|N0|NUMERO|NUM|NUMBER|#)\s*(?:DE\s+)?(?:TRANSACTION|TRANS|REFERENCE|REF|IDENTIFIANT|ID)\s*[:\-]?\s*([A-Z0-9-]{5,})/g,
    /(?:ID|REF)[\s:.-]*([A-Z0-9-]{5,})/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = String(match[1] || '').trim();
      if (isLikelyDepositIdToken(candidate)) {
        return candidate;
      }
    }
  }

  return '';
}

function sanitizeAsset(value) {
  const out = String(value || '').trim();
  if (!out) return '';

  const baseValue = out.replace(/\\/g, '/').split(/[?#]/)[0];
  const fileName = baseValue.split('/').pop() || '';
  if (!/^[a-zA-Z0-9._-]+\.(png|jpe?g|gif|webp|svg)$/i.test(fileName)) {
    return '';
  }
  return fileName;
}

function getPaymentFriendlyErrorMessage(error) {
  if (error?.code === 'account-frozen') {
    return error?.message || "Kont ou a te bloke tanporèman apre plizyè depo yo te refize. Kontakte sipò a.";
  }
  const message = String(error?.message || '').trim();
  if (message) {
    return message;
  }
  return 'Yon erè rive. Tanpri eseye ankò.';
}

function getBlockingPendingDepositAmount(funding = null) {
  const pendingOrders = Array.isArray(funding?.pendingOrders) ? funding.pendingOrders : [];
  for (const item of pendingOrders) {
    const status = String(item?.status || item?.resolutionStatus || '').trim().toLowerCase();
    if (status !== 'pending' && status !== 'review') continue;
    const amount = Number(item?.amountHtg ?? item?.amount ?? item?.approvedAmountHtg ?? 0);
    if (Number.isFinite(amount) && amount > 0) {
      return Math.max(0, Math.trunc(amount));
    }
  }
  const fallback = Number(funding?.provisionalHtgAvailable);
  return Number.isFinite(fallback) && fallback > 0 ? Math.max(0, Math.trunc(fallback)) : 0;
}

function buildPendingDepositBlockingMessage(amount = 0) {
  const amountLabel = amount > 0 ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount)} HTG` : 'yon depo an atant';
  return `Ou deja gen ${amountLabel} sou kont ou. Tann admin nan valide oswa rejte li avan ou voye yon lot demann depo.`;
}

function isDepositProofSecurityError(error) {
  const code = String(error?.code || '').trim().toLowerCase();
  const message = String(error?.message || '').trim().toLowerCase();
  return code === 'deposit-proof-security-check-failed'
    || message.includes('mesures de securite')
    || message.includes('contacter un agent')
    || message.includes('aucun id de transaction');
}

class PaymentModal {
  constructor(options = {}) {
    this.options = {
      amount: 0,
      client: null,
      cart: [],
      methodId: null,
      onClose: null,
      onSuccess: null,
      imageBasePath: './',
      delivery: null,
      ...options
    };
    
    this.uniqueId = 'payment_' + Math.random().toString(36).substr(2, 9);
    this.modal = null;
    this.methods = [];
    this.method = null;
    this.steps = [];
    this.currentStep = 0;
    this.clientData = this.options.client ? { ...this.options.client } : {};
    this.selectedMethod = null;
    this.settings = null;
    this.countdownInterval = null;
    this.timeLeft = 0;
    this.proofImageFile = null;
    this.extractedText = '';
    this.extractedTextStatus = 'pending';
    this.extractedProofId = '';
    this.isSubmitted = false;
    this.confirmationMessage = "";
    this.isCompleted = false;
    this.fundingStatus = null;
    this.proofMode = this.options.flowType === 'welcome_bonus' ? 'welcome_bonus' : 'deposit';
    this.completedFlowType = this.options.flowType === 'welcome_bonus' ? 'welcome_bonus' : 'deposit';
    this.welcomeBonusCaptureReady = this.options.flowType === 'welcome_bonus' ? false : true;
    this.proofStepStartedAtMs = 0;
    this.proofSubmitAttemptDurationMs = 0;
    this.agentDepositAutoPrompted = false;
    
    this.init();
  }

  isKobposhTheme() {
    return String(this.options?.theme || "").trim().toLowerCase() === "kobposh";
  }

  getImageBasePathForFile(filename, kind = "generic") {
    const cleanName = String(filename || "").trim().toLowerCase();
    if (!cleanName) {
      return this.options.imageBasePath || "./";
    }

    if (this.isKobposhTheme()) {
      const localKobposhAssets = new Set(["logokobpash.png"]);
      const sharedRootAssets = new Set([
        "moncash.png",
        "natcash.png",
        "jui.png",
        "qr.jpeg",
        "qrmoncash.jpeg",
        "qrnatcash.jpeg",
      ]);

      if (localKobposhAssets.has(cleanName)) {
        return "./assets/images/";
      }

      if (kind === "payment" || kind === "qr" || sharedRootAssets.has(cleanName)) {
        return "./assets/images/";
      }
    }

    return this.options.imageBasePath || "./";
  }

  getThemePalette() {
    if (this.isKobposhTheme()) {
      return {
        overlayBg: "rgba(245,245,245,0.96)",
        panelBg: "linear-gradient(180deg, #f7fff9 0%, #ffffff 100%)",
        panelBorder: "1px solid rgba(31,174,91,0.12)",
        text: "#0e5c34",
        muted: "rgba(14,92,52,0.68)",
        accent: "#1fae5b",
        accentDeep: "#0e5c34",
        chipBg: "#ffffff",
        chipBorder: "rgba(31,174,91,0.16)",
        cardBg: "#ffffff",
        cardBorder: "rgba(31,174,91,0.14)",
        selectedBg: "#eefaf2",
        selectedBorder: "rgba(31,174,91,0.35)",
        buttonBg: "linear-gradient(180deg, #25c46b 0%, #1fae5b 100%)",
        buttonText: "#ffffff",
        topBarBg: "rgba(255,255,255,0.94)",
        topBarBorder: "rgba(31,174,91,0.12)",
      };
    }

    return {
      overlayBg: "rgba(0,0,0,0.5)",
      panelBg: "rgba(63, 71, 102, 0.58)",
      panelBorder: "1px solid rgba(255,255,255,0.18)",
      text: "#ffffff",
      muted: "#8B7E6B",
      accent: "#F57C00",
      accentDeep: "#C6A75E",
      chipBg: "rgba(255,255,255,0.10)",
      chipBorder: "rgba(255,255,255,0.2)",
      cardBg: "rgba(255,255,255,0.10)",
      cardBorder: "rgba(255,255,255,0.2)",
      selectedBg: "rgba(245,124,0,0.18)",
      selectedBorder: "#ffb26e",
      buttonBg: "#F57C00",
      buttonText: "#ffffff",
      topBarBg: "rgba(63, 71, 102, 0.52)",
      topBarBorder: "rgba(255,255,255,0.14)",
    };
  }

  getClientUid() {
    return String(this.options.client?.uid || this.options.client?.id || '').trim();
  }

  getProofTimerStorageKey() {
    const uid = this.getClientUid();
    return uid ? `${DEPOSIT_PROOF_TIMER_STORAGE_PREFIX}_${uid}` : '';
  }

  getRapidWarningStorageKey() {
    const uid = this.getClientUid();
    return uid ? `${DEPOSIT_RAPID_WARNING_STORAGE_PREFIX}_${uid}` : '';
  }

  getLastProofOcrStorageKey() {
    const uid = this.getClientUid();
    return uid ? `${DEPOSIT_LAST_OCR_TEXT_STORAGE_PREFIX}_${uid}` : '';
  }

  normalizeProofOcrText(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  }

  readLastProofOcrText() {
    const storageKey = this.getLastProofOcrStorageKey();
    if (!storageKey) return '';
    try {
      return this.normalizeProofOcrText(window.localStorage.getItem(storageKey) || '');
    } catch (_) {
      return '';
    }
  }

  writeLastProofOcrText(text) {
    const storageKey = this.getLastProofOcrStorageKey();
    if (!storageKey) return;
    const normalizedText = this.normalizeProofOcrText(text);
    if (!normalizedText) return;
    try {
      window.localStorage.setItem(storageKey, normalizedText);
    } catch (_) {
      // ignore storage failure
    }
  }

  async openDuplicateProofOcrModal() {
    const isKobposh = this.isKobposhTheme();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.76);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        width: min(100%, 470px);
        background: ${isKobposh ? "linear-gradient(180deg, #f7fff9 0%, #ffffff 100%)" : "linear-gradient(180deg, #FFF7ED 0%, #FFEDD5 100%)"};
        border: 1px solid ${isKobposh ? "rgba(31,174,91,0.14)" : "rgba(194, 65, 12, 0.16)"};
        border-radius: 24px;
        box-shadow: 0 28px 80px rgba(15, 23, 42, 0.28);
        padding: 1.4rem;
        color: ${isKobposh ? "#0e5c34" : "#7c2d12"};
      `;

      modal.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:0.85rem;">
          <div style="
            width:44px;
            height:44px;
            border-radius:999px;
            background:${isKobposh ? "rgba(31,174,91,0.10)" : "rgba(194,65,12,0.12)"};
            color:${isKobposh ? "#1fae5b" : "#c2410c"};
            display:flex;
            align-items:center;
            justify-content:center;
            font-size:1.15rem;
            flex-shrink:0;
          "><i class="fas fa-shield-alt"></i></div>
          <div style="min-width:0;">
            <div style="font-size:1.08rem;font-weight:800;margin-bottom:0.35rem;color:${isKobposh ? "#0e5c34" : "#7c2d12"};">
              Prèv deja itilize
            </div>
            <div style="font-size:0.95rem;line-height:1.6;color:${isKobposh ? "rgba(14,92,52,0.76)" : "#9a3412"};">
              Demann sa a pa valab ankò. Prèv depo sa a deja itilize sou aparèy sa a. Tanpri itilize yon nouvo prèv depo.
            </div>
          </div>
        </div>
        <div style="margin-top:1.2rem;">
          <button type="button" data-duplicate-proof-close="1" style="
            width:100%;
            min-height:48px;
            border:none;
            border-radius:14px;
            background:${isKobposh ? "linear-gradient(180deg, #0e5c34 0%, #1fae5b 100%)" : "linear-gradient(135deg, #B45309 0%, #D97706 100%)"};
            color:white;
            font-weight:800;
            cursor:pointer;
            padding:0.9rem 1rem;
          ">Mwen konprann</button>
        </div>
      `;

      const cleanup = () => {
        overlay.remove();
        resolve(false);
      };

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          cleanup();
        }
      });

      modal.querySelector('[data-duplicate-proof-close="1"]')?.addEventListener('click', cleanup);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    });
  }

  readRapidWarningState() {
    const storageKey = this.getRapidWarningStorageKey();
    if (!storageKey) {
      return {
        windowStartedAtMs: 0,
        rapidAttemptCount: 0,
        lastAttemptAtMs: 0,
      };
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        windowStartedAtMs: Number(parsed?.windowStartedAtMs) || 0,
        rapidAttemptCount: Number(parsed?.rapidAttemptCount) || 0,
        lastAttemptAtMs: Number(parsed?.lastAttemptAtMs) || 0,
      };
    } catch (_) {
      return {
        windowStartedAtMs: 0,
        rapidAttemptCount: 0,
        lastAttemptAtMs: 0,
      };
    }
  }

  writeRapidWarningState(state) {
    const storageKey = this.getRapidWarningStorageKey();
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        windowStartedAtMs: Number(state?.windowStartedAtMs) || 0,
        rapidAttemptCount: Number(state?.rapidAttemptCount) || 0,
        lastAttemptAtMs: Number(state?.lastAttemptAtMs) || 0,
      }));
    } catch (_) {
      // ignore storage failure
    }
  }

  clearRapidWarningState() {
    const storageKey = this.getRapidWarningStorageKey();
    if (!storageKey) return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch (_) {
      // ignore storage failure
    }
  }

  shouldPromptRapidDepositWarning() {
    if (this.isWelcomeBonusSelected()) return false;
    if (!(this.proofSubmitAttemptDurationMs > 0) || this.proofSubmitAttemptDurationMs >= DEPOSIT_RAPID_WARNING_DELAY_MS) {
      this.clearRapidWarningState();
      return false;
    }

    const nowMs = Date.now();
    const previousState = this.readRapidWarningState();
    const withinWindow = previousState.windowStartedAtMs > 0
      && (nowMs - previousState.windowStartedAtMs) < DEPOSIT_RAPID_WARNING_DELAY_MS;
    const nextRapidAttemptCount = withinWindow
      ? previousState.rapidAttemptCount + 1
      : 1;

    this.writeRapidWarningState({
      windowStartedAtMs: withinWindow ? previousState.windowStartedAtMs : nowMs,
      rapidAttemptCount: nextRapidAttemptCount,
      lastAttemptAtMs: nowMs,
    });

    return nextRapidAttemptCount >= DEPOSIT_RAPID_WARNING_THRESHOLD;
  }

  ensureProofStepStartedAtMs() {
    if (this.isWelcomeBonusSelected()) {
      this.clearProofStepStartedAtMs();
      return 0;
    }
    if (this.proofStepStartedAtMs > 0) {
      return this.proofStepStartedAtMs;
    }
    const storageKey = this.getProofTimerStorageKey();
    let startedAtMs = 0;
    if (storageKey) {
      try {
        startedAtMs = Number(window.localStorage.getItem(storageKey)) || 0;
      } catch (_) {
        startedAtMs = 0;
      }
    }
    if (startedAtMs <= 0) {
      startedAtMs = Date.now();
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, String(startedAtMs));
        } catch (_) {
          // ignore storage failure
        }
      }
    }
    this.proofStepStartedAtMs = startedAtMs;
    return startedAtMs;
  }

  clearProofStepStartedAtMs() {
    this.proofStepStartedAtMs = 0;
    this.proofSubmitAttemptDurationMs = 0;
    const storageKey = this.getProofTimerStorageKey();
    if (!storageKey) return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch (_) {
      // ignore storage failure
    }
  }

  getProofStepDurationMs() {
    if (this.proofSubmitAttemptDurationMs > 0) {
      return this.proofSubmitAttemptDurationMs;
    }
    const startedAtMs = this.ensureProofStepStartedAtMs();
    if (startedAtMs <= 0) return 0;
    return Math.max(0, Date.now() - startedAtMs);
  }

  async confirmRapidDepositSubmission() {
    const isKobposh = this.isKobposhTheme();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.72);
        backdrop-filter: blur(3px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        width: min(100%, 460px);
        background: ${isKobposh ? "linear-gradient(180deg, #f7fff9 0%, #ffffff 100%)" : "linear-gradient(180deg, #FFF9E8 0%, #F6E7B8 100%)"};
        border: 1px solid ${isKobposh ? "rgba(31,174,91,0.14)" : "rgba(127, 29, 29, 0.18)"};
        border-radius: 24px;
        box-shadow: 0 28px 80px rgba(15, 23, 42, 0.18);
        padding: 1.35rem;
        color: ${isKobposh ? "#0e5c34" : "#3F2D14"};
      `;

      const supportUrl = buildWhatsappUrlForKey("support_default", "", SUPPORT_WHATSAPP_DIGITS) || buildSupportWhatsAppUrl();
      const supportLabel = getWhatsappContactLabel("support_default", SUPPORT_WHATSAPP_DIGITS) || SUPPORT_WHATSAPP_LABEL;

      modal.innerHTML = `
        <div style="display:flex; align-items:flex-start; gap:0.85rem;">
          <div style="
            width:42px;
            height:42px;
            border-radius:999px;
            background: ${isKobposh ? "rgba(31,174,91,0.10)" : "rgba(180, 83, 9, 0.12)"};
            color:${isKobposh ? "#1fae5b" : "#9A3412"};
            display:flex;
            align-items:center;
            justify-content:center;
            font-size:1.2rem;
            flex-shrink:0;
          ">!</div>
          <div style="min-width:0;">
            <div style="font-size:1.08rem; font-weight:800; margin-bottom:0.35rem; color:${isKobposh ? "#0e5c34" : "#3F2D14"};">
              Avez-vous effectue ce depot ?
            </div>
            <div style="font-size:0.95rem; line-height:1.55; color:${isKobposh ? "rgba(14,92,52,0.72)" : "#6B4F2A"};">
              Si vous ne l'avez pas effectue, le systeme le remarquera automatiquement et votre solde ne sera pas credite.
            </div>
            <div style="font-size:0.92rem; line-height:1.5; color:${isKobposh ? "#0e5c34" : "#7C2D12"}; margin-top:0.65rem; font-weight:700;">
              En cas de probleme, veuillez contacter l'assistance.
            </div>
          </div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:0.65rem; margin-top:1.2rem;">
          <button type="button" data-rapid-confirm="cancel" style="
            flex:1 1 120px;
            min-height:46px;
            border:none;
            border-radius:14px;
            background:${isKobposh ? "#f3fbf6" : "#E5E7EB"};
            color:${isKobposh ? "#0e5c34" : "#374151"};
            font-weight:700;
            cursor:pointer;
            padding:0.85rem 1rem;
          ">Annuler</button>
          <a href="${supportUrl}" target="_blank" rel="noopener noreferrer" data-rapid-confirm="support" style="
            flex:1 1 160px;
            min-height:46px;
            border-radius:14px;
            background:${isKobposh ? "linear-gradient(180deg, #25c46b 0%, #1fae5b 100%)" : "#16A34A"};
            color:white;
            font-weight:800;
            text-decoration:none;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:0.85rem 1rem;
          ">Kontakte sipò a</a>
          <button type="button" data-rapid-confirm="continue" style="
            flex:1 1 180px;
            min-height:46px;
            border:none;
            border-radius:14px;
            background:${isKobposh ? "linear-gradient(180deg, #0e5c34 0%, #1fae5b 100%)" : "linear-gradient(135deg, #B45309 0%, #D97706 100%)"};
            color:white;
            font-weight:800;
            cursor:pointer;
            padding:0.85rem 1rem;
          ">Kontinye</button>
        </div>
        <div style="margin-top:0.75rem; font-size:0.82rem; color:${isKobposh ? "rgba(14,92,52,0.62)" : "#6B7280"}; text-align:center;">
          Sipò WhatsApp: ${supportLabel}
        </div>
      `;

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          cleanup(false);
        }
      });

      modal.querySelector('[data-rapid-confirm="cancel"]')?.addEventListener('click', () => cleanup(false));
      modal.querySelector('[data-rapid-confirm="continue"]')?.addEventListener('click', () => cleanup(true));

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    });
  }

  async openAgentDepositSupportModal() {
    const isKobposh = this.isKobposhTheme();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.72);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        width: min(100%, 470px);
        background: ${isKobposh ? "linear-gradient(180deg, #f7fff9 0%, #ffffff 100%)" : "linear-gradient(180deg, #f7f4ff 0%, #ebe4ff 100%)"};
        border: 1px solid ${isKobposh ? "rgba(31,174,91,0.14)" : "rgba(76, 29, 149, 0.14)"};
        border-radius: 24px;
        box-shadow: 0 28px 80px rgba(15, 23, 42, 0.28);
        padding: 1.4rem;
        color: ${isKobposh ? "#0e5c34" : "#2e1065"};
      `;

      const agentDepositDigits = getWhatsappContactDigits("agent_deposit", AGENT_DEPOSIT_WHATSAPP_DIGITS) || AGENT_DEPOSIT_WHATSAPP_DIGITS;
      const agentDepositLabel = getWhatsappContactLabel("agent_deposit", AGENT_DEPOSIT_WHATSAPP_DIGITS) || AGENT_DEPOSIT_WHATSAPP_LABEL;

      modal.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:0.85rem;">
          <div style="
            width:44px;
            height:44px;
            border-radius:999px;
            background: ${isKobposh ? "rgba(31,174,91,0.10)" : "rgba(124, 58, 237, 0.12)"};
            color:${isKobposh ? "#1fae5b" : "#6d28d9"};
            display:flex;
            align-items:center;
            justify-content:center;
            font-size:1.15rem;
            flex-shrink:0;
          "><i class="fas fa-user-tie"></i></div>
          <div style="min-width:0;">
            <div style="font-size:1.08rem;font-weight:800;margin-bottom:0.35rem;color:${isKobposh ? "#0e5c34" : "#2e1065"};">
              Depo atravè ajan
            </div>
            <div style="font-size:0.95rem;line-height:1.55;color:${isKobposh ? "rgba(14,92,52,0.72)" : "#4c1d95"};">
              Kontakte yon ajan pou fè depo ou a. Metòd sa a pa otomatik; li depann de ajan an.
            </div>
            <div style="margin-top:0.7rem;font-size:0.9rem;line-height:1.55;color:${isKobposh ? "#0e5c34" : "#5b21b6"};">
              Voye kaptire ou a ak enfòmasyon nesesè yo sou WhatsApp. Ajan an ka kredite kont ou a distans apre sa.
            </div>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:0.65rem;margin-top:1.25rem;">
          <button type="button" data-agent-deposit="cancel" style="
            flex:1 1 140px;
            min-height:46px;
            border:none;
            border-radius:14px;
            background:${isKobposh ? "#f3fbf6" : "#e5e7eb"};
            color:${isKobposh ? "#0e5c34" : "#374151"};
            font-weight:700;
            cursor:pointer;
            padding:0.85rem 1rem;
          ">Fèmen</button>
          <a href="https://wa.me/${agentDepositDigits}" target="_blank" rel="noopener noreferrer" data-agent-deposit="continue" style="
            flex:1 1 200px;
            min-height:46px;
            border-radius:14px;
            background:${isKobposh ? "linear-gradient(180deg, #25c46b 0%, #1fae5b 100%)" : "#16A34A"};
            color:white;
            font-weight:800;
            text-decoration:none;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:0.85rem 1rem;
          ">Kontinye sou WhatsApp</a>
        </div>
        <div style="margin-top:0.75rem;font-size:0.82rem;color:${isKobposh ? "rgba(14,92,52,0.62)" : "#6b7280"};text-align:center;">
          Ajan WhatsApp: ${agentDepositLabel}
        </div>
      `;

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          cleanup(false);
        }
      });

      modal.querySelector('[data-agent-deposit="cancel"]')?.addEventListener('click', () => cleanup(false));
      modal.querySelector('[data-agent-deposit="continue"]')?.addEventListener('click', () => cleanup(true));

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    });
  }

  async openMissingDepositIdSupportModal() {
    const isKobposh = this.isKobposhTheme();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.76);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        width: min(100%, 480px);
        background: ${isKobposh ? "linear-gradient(180deg, #f7fff9 0%, #ffffff 100%)" : "linear-gradient(180deg, #FFF7ED 0%, #FFEDD5 100%)"};
        border: 1px solid ${isKobposh ? "rgba(31,174,91,0.14)" : "rgba(194, 65, 12, 0.16)"};
        border-radius: 24px;
        box-shadow: 0 28px 80px rgba(15, 23, 42, 0.28);
        padding: 1.4rem;
        color: ${isKobposh ? "#0e5c34" : "#7C2D12"};
      `;

      const isWelcomeFlow = this.options.flowType === 'welcome_bonus'
        || this.proofMode === 'welcome_bonus'
        || this.isWelcomeBonusSelected();
      const welcomeSupport = this.getWelcomeDepositWhatsappMeta();
      const supportUrl = isWelcomeFlow
        ? welcomeSupport.url
        : (buildWhatsappUrlForKey("support_default", "", SUPPORT_WHATSAPP_DIGITS) || buildSupportWhatsAppUrl());
      const supportLabel = isWelcomeFlow
        ? welcomeSupport.label
        : (getWhatsappContactLabel("support_default", SUPPORT_WHATSAPP_DIGITS) || SUPPORT_WHATSAPP_LABEL);
      const supportButtonLabel = isWelcomeFlow ? "Kontakte sipò bonus la" : "Kontakte yon ajan";
      const supportIntro = isWelcomeFlow
        ? "Tanpri kontakte sipò bonus la pou yo ka gide w sou pwochen etap bonus byenveni an."
        : "Tanpri kontakte yon ajan pou kontinye.";

      modal.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:0.85rem;">
          <div style="
            width:44px;
            height:44px;
            border-radius:999px;
            background: ${isKobposh ? "rgba(31,174,91,0.10)" : "rgba(194, 65, 12, 0.12)"};
            color:${isKobposh ? "#1fae5b" : "#C2410C"};
            display:flex;
            align-items:center;
            justify-content:center;
            font-size:1.15rem;
            flex-shrink:0;
          "><i class="fas fa-headset"></i></div>
          <div style="min-width:0;">
            <div style="font-size:1.08rem;font-weight:800;margin-bottom:0.35rem;color:${isKobposh ? "#0e5c34" : "#7C2D12"};">
              Verifikasyon sekirite obligatwa
            </div>
            <div style="font-size:0.95rem;line-height:1.55;color:${isKobposh ? "rgba(14,92,52,0.72)" : "#9A3412"};">
              Imaj ou voye a pa pase verifikasyon sekirite nou yo pou demann depo sa a.
            </div>
            <div style="margin-top:0.7rem;font-size:0.9rem;line-height:1.55;color:${isKobposh ? "#0e5c34" : "#7C2D12"};font-weight:700;">
              ${supportIntro}
            </div>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:0.65rem;margin-top:1.25rem;">
          <button type="button" data-missing-id="close" style="
            flex:1 1 140px;
            min-height:46px;
            border:none;
            border-radius:14px;
            background:${isKobposh ? "#f3fbf6" : "#E5E7EB"};
            color:${isKobposh ? "#0e5c34" : "#374151"};
            font-weight:700;
            cursor:pointer;
            padding:0.85rem 1rem;
          ">Fèmen</button>
          <a href="${supportUrl}" target="_blank" rel="noopener noreferrer" data-missing-id="support" style="
            flex:1 1 200px;
            min-height:46px;
            border-radius:14px;
            background:${isKobposh ? "linear-gradient(180deg, #25c46b 0%, #1fae5b 100%)" : "#16A34A"};
            color:white;
            font-weight:800;
            text-decoration:none;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:0.85rem 1rem;
          ">${supportButtonLabel}</a>
        </div>
        <div style="margin-top:0.75rem;font-size:0.82rem;color:${isKobposh ? "rgba(14,92,52,0.62)" : "#6B7280"};text-align:center;">
          Agent WhatsApp: ${supportLabel}
        </div>
      `;

      const cleanup = () => {
        overlay.remove();
        resolve(false);
      };

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          cleanup();
        }
      });

      modal.querySelector('[data-missing-id="close"]')?.addEventListener('click', cleanup);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    });
  }

  getDefaultSteps() {
    return [
      {
        type: 'custom',
        title: 'Verifikasyon anvan peman',
        content: 'Voye montan ou vle depoze a depi nan kont MonCash oswa NatCash pa ou sou kont peman ki parèt la. Apre sa, pran yon foto oswa yon kaptire ekran ki montre prèv depo a menm. Se sèlman imaj prèv depo sa a ki otorize; okenn lòt kalite imaj pap aksepte.',
        buttonText: 'Swivan'
      },
      {
        type: 'payment',
        title: 'Enfòmasyon peman',
        instruction: 'Sèvi ak enfòmasyon ki anba yo pou fè yon depo oswa yon transfè. Si w sèvi ak kòd QR la, ou pap peye frè.',
        buttonText: 'Swivan'
      },
      {
        type: 'proof',
        title: 'Prèv peman',
        description: 'Ajoute kaptire ekran ou oswa referans tranzaksyon an.',
        buttonText: 'Voye demann mwen'
      },
      {
        type: 'confirmation',
        title: 'Konfimasyon',
        message: 'Demann ou a an atant jiskaske yon admin apwouve oswa rejte li.'
      }
    ];
  }

  getMethodSteps(method) {
    const steps = Array.isArray(method?.steps) ? method.steps.filter(Boolean) : [];
    return steps.length > 0 ? steps : this.getDefaultSteps();
  }

  requiresAgentDepositFlow() {
    const amount = Number(this.options?.amount || 0);
    return Number.isFinite(amount) && amount >= DEPOSIT_AGENT_ONLY_THRESHOLD_HTG;
  }
  
  async init() {
    await this.loadSettings();
    await this.loadFundingStatus();
    await this.loadPaymentMethods();
    this.render();
    this.attachEvents();
    this.animateIn();
    
    document.body.style.overflow = 'hidden';
  }
  
  async loadSettings() {
    try {
      const payload = await getPublicPaymentOptionsSecure({});
      this.settings = payload?.settings || {};
      this.methods = Array.isArray(payload?.methods)
        ? payload.methods
          .map((item) => {
            const data = { ...(item || {}) };
            data.steps = this.getMethodSteps(data);
            return data;
          })
          .filter((m) => m && m.isActive !== false)
        : [];
    } catch (error) {
      console.error('Erreur chargement paramètres:', error);
      this.settings = {};
      this.methods = [];
    }
  }

  async loadFundingStatus() {
    try {
      this.fundingStatus = await getDepositFundingStatusSecure({});
      console.info("[FUNDING_TRACE][PAYMENT] loadFundingStatus", {
        uid: this.getClientUid(),
        approvedDepositsHtg: this.fundingStatus?.approvedDepositsHtg,
        approvedDepositBonusHtg: this.fundingStatus?.approvedDepositBonusHtg,
        reservedWithdrawalsHtg: this.fundingStatus?.reservedWithdrawalsHtg,
        exchangedApprovedHtg: this.fundingStatus?.exchangedApprovedHtg,
        transferSentHtgTotal: this.fundingStatus?.transferSentHtgTotal,
        transferReceivedHtgTotal: this.fundingStatus?.transferReceivedHtgTotal,
        nativeGameEntryApprovedHtgTotal: this.fundingStatus?.nativeGameEntryApprovedHtgTotal,
        nativeGameRewardApprovedHtgTotal: this.fundingStatus?.nativeGameRewardApprovedHtgTotal,
        approvedHtgAvailable: this.fundingStatus?.approvedHtgAvailable,
        provisionalHtgAvailable: this.fundingStatus?.provisionalHtgAvailable,
        playableHtg: this.fundingStatus?.playableHtg,
        withdrawableHtg: this.fundingStatus?.withdrawableHtg,
        pendingOrders: Array.isArray(this.fundingStatus?.pendingOrders) ? this.fundingStatus.pendingOrders : [],
      });
    } catch (error) {
      console.warn('[PAYMENT] Impossible de charger le statut funding:', error);
      this.fundingStatus = null;
    }
  }
  
  async loadPaymentMethods() {
    if (!Array.isArray(this.methods)) {
      this.methods = [];
    }
    try {
      if (this.options.methodId) {
        this.selectedMethod = this.methods.find(m => m.id === this.options.methodId);
        if (this.selectedMethod) {
          this.steps = this.getMethodSteps(this.selectedMethod);
          this.currentStep = 1;
        }
      }
      
      if (this.methods.length === 1 && !this.selectedMethod) {
        this.selectedMethod = this.methods[0];
        this.steps = this.getMethodSteps(this.selectedMethod);
        this.currentStep = 1;
      }
    } catch (error) {
      console.error('Erreur chargement méthodes:', error);
      this.methods = [];
    }
  }
  
  getImagePath(filename, kind = "generic") {
    const safeFilename = sanitizeAsset(filename);
    if (!safeFilename) return '';
    if (safeFilename.startsWith('http')) return safeFilename;
    const cleanName = safeFilename.split('/').pop();
    return `${this.getImageBasePathForFile(cleanName, kind)}${cleanName}`;
  }

  getDefaultMethodImage(method) {
    const key = String(method?.id || method?.name || '').toLowerCase();
    if (key.includes('moncash')) return 'moncash.png';
    if (key.includes('natcash')) return 'natcash.png';
    if (key.includes('jui')) return 'jui.png';
    return '';
  }

  getDefaultQrCodeImage(method) {
    const key = String(method?.id || method?.name || '').toLowerCase();
    if (key.includes('moncash')) return 'qrmoncash.jpeg';
    if (key.includes('natcash')) return 'qrnatcash.jpeg';
    return 'qr.jpeg';
  }
  
  formatPrice(price) {
    return new Intl.NumberFormat('fr-FR', { 
      style: 'currency', 
      currency: 'HTG',
      minimumFractionDigits: 0
    }).format(price || 0);
  }

  formatInlineNumber(value, maximumFractionDigits = 2) {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }).format(Number(value) || 0);
  }

  getDepositBonusPreview() {
    const amountHtg = Math.max(0, Number(this.options?.amount) || 0);
    const eligible = amountHtg >= DEPOSIT_BONUS_MIN_HTG;
    const bonusHtgRaw = eligible ? (amountHtg * DEPOSIT_BONUS_PERCENT) / 100 : 0;
    const bonusHtgAwarded = eligible ? Math.floor(bonusHtgRaw) : 0;

    return {
      amountHtg,
      eligible,
      thresholdHtg: DEPOSIT_BONUS_MIN_HTG,
      bonusPercent: DEPOSIT_BONUS_PERCENT,
      bonusHtgRaw,
      bonusHtgAwarded,
    };
  }

  getWelcomeBonusStatus() {
    const funding = this.fundingStatus && typeof this.fundingStatus === 'object'
      ? this.fundingStatus
      : {};
    const hasRealApprovedDeposit = funding.hasRealApprovedDeposit === true
      || funding.hasApprovedDeposit === true
      || Number(funding.realApprovedDepositsHtg) > 0
      || Number(funding.approvedDepositsHtg) > 0;
    const alreadyClaimed = funding.welcomeBonusClaimed === true
      || Number(funding.welcomeBonusReceivedAtMs) > 0
      || Number(funding.welcomeBonusApprovedHtg) > 0;
    const eligibilityReason = String(funding.welcomeBonusEligibilityReason || '');
    const eligible = funding.welcomeBonusEligible === true;

    return {
      eligible,
      alreadyClaimed,
      hasRealApprovedDeposit,
      accountFrozen: funding.accountFrozen === true,
      isLegacyAccount: funding.isLegacyAccount === true,
      eligibilityReason,
      grantedHtg: WELCOME_BONUS_HTG,
      proofCode: String(funding.welcomeBonusProofCode || '').trim(),
      endAtMs: Number(funding.welcomeBonusEndAtMs) || 0,
    };
  }

  buildWelcomeBonusCaptureStep() {
    return {
      type: 'custom',
      variant: 'welcome_bonus_capture',
      title: 'Capture la preuve du bonus',
      buttonText: 'Suivant',
    };
  }

  getWelcomeBonusProofCode() {
    const fundingCode = String(this.fundingStatus?.welcomeBonusProofCode || '').trim().toUpperCase();
    if (fundingCode) return fundingCode;
    const profileCode = String(this.clientData?.welcomeBonusProofCode || this.options?.client?.welcomeBonusProofCode || '').trim().toUpperCase();
    if (profileCode) return profileCode;
    const uid = String(this.options?.client?.uid || this.options?.client?.id || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return uid ? `CLIENT-${uid.slice(0, 6)}-LOCAL` : 'CLIENT-BONUS';
  }

  isWelcomeBonusSelected() {
    return this.proofMode === 'welcome_bonus' && this.getWelcomeBonusStatus().eligible;
  }

  getWelcomeDepositWhatsappMeta() {
    const message = "Bonjou, mwen bezwen asistans pou bonus byenveni an sou Kobpoch.";
    const url = buildWhatsappUrlForKey("welcome_deposit_modal", message, SUPPORT_WHATSAPP_DIGITS)
      || buildSupportWhatsAppUrl(message);
    const label = getWhatsappContactLabel("welcome_deposit_modal", SUPPORT_WHATSAPP_DIGITS) || SUPPORT_WHATSAPP_LABEL;
    return { message, url, label };
  }
  
  render() {
    const palette = this.getThemePalette();
    this.modal = document.createElement('div');
    this.modal.className = `payment-modal-${this.uniqueId}`;
    this.modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100vw;
      height: 100vh;
      background: ${palette.overlayBg};
      backdrop-filter: blur(${this.isKobposhTheme() ? "10px" : "8px"});
      z-index: 1000000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    
    this.modal.innerHTML = `
      <div class="payment-container-${this.uniqueId} payment-theme-${this.uniqueId}" style="
        background: ${palette.panelBg};
        border-radius: 1.5rem;
        width: 100%;
        max-width: ${this.isKobposhTheme() ? "560px" : "600px"};
        max-height: ${this.isKobposhTheme() ? "calc(100dvh - 0.5rem)" : "90vh"};
        overflow: hidden;
        border: ${palette.panelBorder};
        box-shadow: ${this.isKobposhTheme()
          ? "0 18px 40px rgba(31,174,91,0.10)"
          : "14px 14px 34px rgba(17, 24, 39, 0.48), -10px -10px 24px rgba(113, 128, 168, 0.2)"};
        backdrop-filter: blur(${this.isKobposhTheme() ? "12px" : "14px"});
        transform: scale(${this.isKobposhTheme() ? "1" : "0.95"});
        transition: transform 0.3s ease;
        position: relative;
        display: flex;
        flex-direction: column;
      ">
        <!-- Header avec progression -->
        <div class="payment-header-${this.uniqueId}" style="
          position: sticky;
          top: 0;
          background: ${palette.topBarBg};
          border-bottom: 1px solid ${palette.topBarBorder};
          padding: 1.5rem;
          z-index: 10;
          border-radius: 1.5rem 1.5rem 0 0;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              ${this.currentStep > 0 ? `
                <button class="back-step payment-icon-btn" style="
                  background: none;
                  border: none;
                  font-size: 1.2rem;
                  cursor: pointer;
                  color: ${this.isKobposhTheme() ? "rgba(14,92,52,0.78)" : "rgba(255,255,255,0.82)"};
                  padding: 0.5rem;
                  width: 40px;
                  height: 40px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  border-radius: 50%;
                  transition: all 0.2s;
                ">
                  <i class="fas fa-arrow-left"></i>
                </button>
              ` : ''}
              <h2 style="
                font-size: 1.5rem;
                font-weight: 800;
                color: ${palette.text};
                margin: 0;
              ">
                Paiement sécurisé
              </h2>
            </div>
            <button class="close-payment payment-icon-btn" style="
              background: none;
              border: none;
              font-size: 1.5rem;
              cursor: pointer;
              color: ${this.isKobposhTheme() ? "rgba(14,92,52,0.78)" : "rgba(255,255,255,0.82)"};
              transition: all 0.2s;
              padding: 0.5rem;
              width: 40px;
              height: 40px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 50%;
            ">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          ${this.renderProgressBar()}
        </div>
        
        <div class="payment-scroll-area-${this.uniqueId}" style="
          padding: 1.5rem;
          padding-bottom: calc(6.5rem + env(safe-area-inset-bottom, 0px));
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          flex: 1;
          min-height: 0;
        ">
          ${this.renderCurrentStep()}
        </div>
      </div>
      
      <style>
        .payment-container-${this.uniqueId} {
          animation: paymentSlideIn 0.3s ease forwards;
        }

        .payment-theme-${this.uniqueId} p,
        .payment-theme-${this.uniqueId} span,
        .payment-theme-${this.uniqueId} h1,
        .payment-theme-${this.uniqueId} h2,
        .payment-theme-${this.uniqueId} h3,
        .payment-theme-${this.uniqueId} h4,
        .payment-theme-${this.uniqueId} label {
          color: ${palette.text} !important;
        }

        .payment-theme-${this.uniqueId} .payment-icon-btn:hover {
          background: ${this.isKobposhTheme() ? "rgba(31,174,91,0.10)" : "rgba(198, 167, 94, 0.1)"} !important;
          color: ${palette.accentDeep} !important;
        }
        
        @keyframes paymentSlideIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        
        .payment-container-${this.uniqueId}::-webkit-scrollbar {
          width: 6px;
        }
        
        .payment-container-${this.uniqueId}::-webkit-scrollbar-track {
          background: ${this.isKobposhTheme() ? "rgba(31,174,91,0.10)" : "rgba(255,255,255,0.14)"};
          border-radius: 3px;
        }

        .payment-container-${this.uniqueId}::-webkit-scrollbar-thumb {
          background: ${this.isKobposhTheme() ? "rgba(31,174,91,0.85)" : "rgba(245,124,0,0.85)"};
          border-radius: 3px;
        }
        
        .method-card {
          transition: all 0.25s ease;
          cursor: pointer;
          border: 1px solid ${this.isKobposhTheme() ? "rgba(31,174,91,0.16)" : "rgba(255,255,255,0.2)"} !important;
          background: ${this.isKobposhTheme() ? "#ffffff" : "rgba(255,255,255,0.10)"} !important;
          backdrop-filter: blur(8px);
          box-shadow: ${this.isKobposhTheme()
            ? "0 10px 24px rgba(31,174,91,0.08)"
            : "10px 10px 22px rgba(18,25,42,0.38), -8px -8px 18px rgba(121,135,173,0.18), inset 5px 5px 10px rgba(255,255,255,0.05), inset -5px -5px 10px rgba(8,13,24,0.18)"};
        }
        
        .method-card:hover {
          transform: translateY(-2px);
          background: ${this.isKobposhTheme() ? "#f7fff9" : "rgba(255,255,255,0.14)"} !important;
          box-shadow: ${this.isKobposhTheme()
            ? "0 14px 28px rgba(31,174,91,0.10)"
            : "12px 12px 24px rgba(16,22,38,0.42), -8px -8px 18px rgba(132,147,188,0.20), inset 5px 5px 10px rgba(255,255,255,0.06), inset -5px -5px 10px rgba(8,13,24,0.22)"};
        }
        
        .method-card.selected {
          border-color: ${palette.selectedBorder} !important;
          background: ${palette.selectedBg} !important;
          box-shadow: ${this.isKobposhTheme()
            ? "0 14px 28px rgba(31,174,91,0.12)"
            : "12px 12px 26px rgba(120,61,23,0.45), -8px -8px 18px rgba(255,174,98,0.14), inset 5px 5px 10px rgba(255,255,255,0.06), inset -5px -5px 10px rgba(8,13,24,0.22)"};
        }
        
        .countdown-timer {
          font-family: monospace;
          font-size: 1.5rem;
          font-weight: bold;
          color: ${palette.accent};
        }
        
        .form-group {
          margin-bottom: 1rem;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 0.25rem;
          font-size: 0.9rem;
          color: ${this.isKobposhTheme() ? "rgba(14,92,52,0.78)" : "rgba(255,255,255,0.82)"};
        }
        
        .form-group input,
        .form-group textarea,
        .form-group select {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid ${this.isKobposhTheme() ? "rgba(31,174,91,0.18)" : "rgba(255,255,255,0.24)"};
          border-radius: 0.9rem;
          background: ${this.isKobposhTheme() ? "#ffffff" : "rgba(255,255,255,0.12)"};
          color: ${palette.text};
          box-shadow: ${this.isKobposhTheme()
            ? "0 8px 18px rgba(31,174,91,0.06)"
            : "inset 6px 6px 12px rgba(19, 26, 43, 0.42), inset -6px -6px 12px rgba(120, 134, 172, 0.22)"};
          font-size: 0.95rem;
        }
        
        .form-group input:focus,
        .form-group textarea:focus,
        .form-group select:focus {
          outline: none;
          border-color: ${palette.accent};
        }
        
        .next-step-btn {
          width: 100%;
          background: ${palette.buttonBg};
          color: ${palette.buttonText};
          border: 1px solid ${this.isKobposhTheme() ? "rgba(31,174,91,0.22)" : "#ffb26e"};
          padding: 1rem;
          border-radius: 0.9rem;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s;
          margin-top: 1.5rem;
          box-shadow: ${this.isKobposhTheme()
            ? "0 12px 24px rgba(31,174,91,0.18)"
            : "8px 8px 18px rgba(17, 24, 39, 0.42), -6px -6px 14px rgba(123, 137, 180, 0.2)"};
        }

        .next-step-btn:hover {
          background: ${this.isKobposhTheme() ? "#25c46b" : "#ff8b1f"};
          color: #ffffff;
        }
        
        .next-step-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        @media (max-width: 768px) {
          .payment-modal-${this.uniqueId} {
            align-items: flex-end !important;
            padding: 0 !important;
          }

          .payment-container-${this.uniqueId} {
            width: 100vw !important;
            max-width: 100vw !important;
            max-height: 100dvh !important;
            height: 100dvh !important;
            border-radius: 1.25rem 1.25rem 0 0 !important;
            transform: none !important;
          }

          .payment-header-${this.uniqueId} {
            padding: 1rem 1rem 0.9rem !important;
            border-radius: 1.25rem 1.25rem 0 0 !important;
          }

          .payment-scroll-area-${this.uniqueId} {
            padding: 1rem !important;
            padding-bottom: calc(7.25rem + env(safe-area-inset-bottom, 18px)) !important;
          }

          .payment-theme-${this.uniqueId} .form-group {
            margin-bottom: 0.75rem !important;
          }

          .payment-theme-${this.uniqueId} .form-group input,
          .payment-theme-${this.uniqueId} .form-group textarea,
          .payment-theme-${this.uniqueId} .form-group select {
            padding: 0.7rem !important;
            font-size: 0.95rem !important;
          }

          .payment-theme-${this.uniqueId} .next-step-btn {
            position: sticky;
            bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem);
            z-index: 25;
            margin-top: 1rem !important;
            margin-bottom: 0 !important;
            padding: 0.95rem 1rem !important;
            box-shadow: ${this.isKobposhTheme()
              ? "0 16px 30px rgba(31,174,91,0.22)"
              : "0 16px 30px rgba(17,24,39,0.32)"} !important;
          }
        }
        
        .warning-message {
          background: ${this.isKobposhTheme() ? "rgba(31,174,91,0.08)" : "rgba(255,255,255,0.12)"};
          border-left: 4px solid ${palette.accent};
          padding: 1rem;
          border-radius: 0.5rem;
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
        }
        
        .loading-spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 2px solid ${this.isKobposhTheme() ? "rgba(31,174,91,0.22)" : "rgba(255,255,255,0.3)"};
          border-radius: 50%;
          border-top-color: ${palette.accent};
          animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
      </style>
    `;
    
    document.body.appendChild(this.modal);
  }
  
  renderProgressBar() {
    const totalSteps = 1 + (this.steps?.length || 0);
    const currentStepDisplay = this.currentStep + 1;
    const progress = (currentStepDisplay / totalSteps) * 100;
    
    return `
      <div style="margin-top: 0.5rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
          <span style="font-size: 0.85rem; color: #8B7E6B;">Etap ${currentStepDisplay}/${totalSteps}</span>
          <span style="font-size: 0.85rem; color: #8B7E6B;">${Math.round(progress)}%</span>
        </div>
        <div style="
          width: 100%;
          height: 4px;
          background: rgba(198, 167, 94, 0.2);
          border-radius: 2px;
          overflow: hidden;
        ">
          <div style="
            width: ${progress}%;
            height: 100%;
            background: #C6A75E;
            transition: width 0.3s ease;
          "></div>
        </div>
      </div>
    `;
  }
  
  renderCurrentStep() {
    if (this.currentStep === 0) {
      return this.renderStep0();
    }
    
    if (!this.steps || this.steps.length === 0) {
      return this.renderNoSteps();
    }
    
    const stepIndex = this.currentStep - 1;
    const step = this.steps[stepIndex];
    
    if (!step) {
      return this.renderNoSteps();
    }
    
    switch(step.type) {
      case 'form':
        return this.renderFormStep(step);
      case 'payment':
        return this.renderPaymentStep(step);
      case 'proof':
        return this.renderProofStep(step);
      case 'confirmation':
        return this.renderConfirmationStep(step);
      default:
        return this.renderCustomStep(step);
    }
  }
  
  renderStep0() {
    if (this.options.flowType === 'welcome_bonus' && this.getWelcomeBonusStatus().eligible && !this.welcomeBonusCaptureReady) {
      return this.renderCustomStep(this.buildWelcomeBonusCaptureStep());
    }
    const isKobposh = this.isKobposhTheme();
    const stepTextColor = isKobposh ? "#0e5c34" : "#ffffff";
    const mutedColor = isKobposh ? "rgba(14,92,52,0.68)" : "#8B7E6B";

    if (this.methods.length === 0) {
      return `
        <div style="text-align: center; padding: 2rem;">
          <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: ${this.isKobposhTheme() ? "#1fae5b" : "#B76E2E"}; margin-bottom: 1rem;"></i>
          <h3 style="font-size: 1.2rem; margin-bottom: 1rem; color: ${stepTextColor};">Pa gen metòd ki disponib</h3>
          <p style="color: ${mutedColor};">Tanpri eseye ankò pita.</p>
        </div>
      `;
    }

    if (this.requiresAgentDepositFlow()) {
      return `
        <div>
          <h3 style="font-size: 1.3rem; margin-bottom: 1rem; color: ${stepTextColor};">Depo sa a mande yon ajan</h3>
          <p style="color: ${mutedColor}; margin-bottom: 1.1rem;">
            Depi yon depo rive sou <strong>${this.formatInlineNumber(DEPOSIT_AGENT_ONLY_THRESHOLD_HTG, 0)} HTG</strong>, li dwe fèt atravè yon ajan.
          </p>

          <div style="
            border: 1px solid ${this.isKobposhTheme() ? 'rgba(31,174,91,0.18)' : 'rgba(255,255,255,0.18)'};
            background: ${this.isKobposhTheme() ? 'rgba(31,174,91,0.07)' : 'rgba(255,255,255,0.08)'};
            border-radius: 1rem;
            padding: 1rem;
            color: ${stepTextColor};
            margin-bottom: 1rem;
            line-height: 1.7;
          ">
            Pou montan sa a, ou dwe kontakte yon ajan sou WhatsApp pou resevwa enfòmasyon yo epi voye prèv depo a bay ajan an dirèkteman.
          </div>

          <button id="agentDepositBtn" type="button" style="
            width: 100%;
            margin-top: 0.4rem;
            min-height: 54px;
            border-radius: 1rem;
            border: 1px dashed ${this.isKobposhTheme() ? "rgba(31,174,91,0.24)" : "rgba(255,255,255,0.28)"};
            background: ${this.isKobposhTheme() ? "#f7fff9" : "rgba(124,58,237,0.12)"};
            color: ${stepTextColor};
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            padding: 0.95rem 1rem;
            cursor: pointer;
            box-shadow: 10px 10px 22px rgba(18,25,42,0.28), -8px -8px 18px rgba(121,135,173,0.12);
          ">
            <span style="display:flex;align-items:center;gap:0.85rem;text-align:left;">
              <span style="
                width: 42px;
                height: 42px;
                border-radius: 999px;
                background: ${this.isKobposhTheme() ? "rgba(31,174,91,0.10)" : "rgba(255,255,255,0.12)"};
                display:flex;
                align-items:center;
                justify-content:center;
                flex-shrink:0;
              "><i class="fas fa-user-headset" style="color:${this.isKobposhTheme() ? "#1fae5b" : "#d8b4fe"};"></i></span>
              <span>
                <strong style="display:block;font-size:0.98rem;color:${stepTextColor};">Kontakte ajan an</strong>
                <span style="display:block;font-size:0.84rem;color:${mutedColor};margin-top:0.18rem;">Depo ${this.formatInlineNumber(Number(this.options?.amount || 0), 0)} HTG sa a ap pase atravè ajan an.</span>
              </span>
            </span>
            <i class="fas fa-chevron-right" style="color:${this.isKobposhTheme() ? "#1fae5b" : "#e9d5ff"};"></i>
          </button>
        </div>
      `;
    }
    
    return `
      <div>
        <h3 style="font-size: 1.3rem; margin-bottom: 1rem; color: ${stepTextColor};">Chwazi metòd peman ou</h3>
        <p style="color: ${mutedColor}; margin-bottom: 1.5rem;">Chwazi youn nan opsyon ki disponib yo</p>
        
        <div id="methodsList" style="display: flex; flex-direction: column; gap: 1rem;">
          ${this.methods.map(method => this.renderMethodCard(method)).join('')}
        </div>

        <button id="agentDepositBtn" type="button" style="
          width: 100%;
          margin-top: 1rem;
          min-height: 54px;
          border-radius: 1rem;
          border: 1px dashed ${this.isKobposhTheme() ? "rgba(31,174,91,0.24)" : "rgba(255,255,255,0.28)"};
          background: ${this.isKobposhTheme() ? "#f7fff9" : "rgba(124,58,237,0.12)"};
          color: ${stepTextColor};
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.95rem 1rem;
          cursor: pointer;
          box-shadow: 10px 10px 22px rgba(18,25,42,0.28), -8px -8px 18px rgba(121,135,173,0.12);
        ">
          <span style="display:flex;align-items:center;gap:0.85rem;text-align:left;">
            <span style="
              width: 42px;
              height: 42px;
              border-radius: 999px;
              background: ${this.isKobposhTheme() ? "rgba(31,174,91,0.10)" : "rgba(255,255,255,0.12)"};
              display:flex;
              align-items:center;
              justify-content:center;
              flex-shrink:0;
            "><i class="fas fa-user-headset" style="color:${this.isKobposhTheme() ? "#1fae5b" : "#d8b4fe"};"></i></span>
            <span>
              <strong style="display:block;font-size:0.98rem;color:${stepTextColor};">Depo atravè ajan</strong>
              <span style="display:block;font-size:0.84rem;color:${mutedColor};margin-top:0.18rem;">Bezwen èd? Yon ajan ka ede w epi kredite kont ou a distans.</span>
            </span>
          </span>
          <i class="fas fa-chevron-right" style="color:${this.isKobposhTheme() ? "#1fae5b" : "#e9d5ff"};"></i>
        </button>
      </div>
    `;
  }
  
  renderMethodCard(method) {
    const isSelected = this.selectedMethod?.id === method.id;
    const isKobposh = this.isKobposhTheme();
    const safeMethodId = escapeAttr(method?.id || '');
    const safeMethodName = escapeHtml(method?.name || 'Metòd');
    const safeInstructions = escapeHtml(method?.instructions || '');
    const methodImageName = method?.image || this.getDefaultMethodImage(method);
    const safeImagePath = escapeAttr(this.getImagePath(methodImageName, 'payment'));
    
    return `
      <div class="method-card" data-method-id="${safeMethodId}" data-welcome-coach="payment-method" style="
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        border: 1px solid ${isSelected ? (isKobposh ? '#1fae5b' : '#ffb26e') : (isKobposh ? 'rgba(31,174,91,0.16)' : 'rgba(255,255,255,0.2)')};
        border-radius: 1rem;
        background: ${isSelected ? (isKobposh ? 'rgba(31,174,91,0.10)' : 'rgba(245,124,0,0.18)') : (isKobposh ? '#ffffff' : 'rgba(255,255,255,0.10)')};
        color: ${isKobposh ? '#0e5c34' : '#ffffff'};
        cursor: pointer;
      ">
        <div style="
          width: 60px;
          height: 60px;
          min-width: 60px;
          min-height: 60px;
          flex-shrink: 0;
          background: rgba(255,255,255,0.14);
          border: 1px solid ${isKobposh ? 'rgba(31,174,91,0.14)' : 'rgba(255,255,255,0.18)'};
          border-radius: 0.9rem;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          box-shadow: ${isKobposh ? '0 8px 18px rgba(31,174,91,0.08)' : 'inset 4px 4px 9px rgba(255,255,255,0.05), inset -4px -4px 9px rgba(8,13,24,0.2)'};
        ">
          ${methodImageName ?
            `<img src="${safeImagePath}" data-fallback-icon="fa-money-bill-wave" style="width: 100%; height: 100%; object-fit: cover;">` :
            `<i class="fas fa-money-bill-wave" style="font-size: 1.5rem; color: ${isKobposh ? '#1fae5b' : '#C6A75E'};"></i>`
          }
        </div>
        <div style="flex: 1;">
          <h4 style="font-weight: 700; margin-bottom: 0.25rem; color: ${isKobposh ? '#0e5c34' : '#ffffff'};">${safeMethodName}</h4>
          <p style="font-size: 0.85rem; color: ${isKobposh ? 'rgba(14,92,52,0.68)' : 'rgba(255,255,255,0.75)'};">${safeInstructions}</p>
        </div>
        <div style="width: 24px; height: 24px; min-width: 24px; min-height: 24px; flex-shrink: 0; border-radius: 999px; border: 2px solid ${isKobposh ? '#1fae5b' : '#ffb26e'}; display: flex; align-items: center; justify-content: center;">
          ${isSelected ? `<div style="width: 12px; height: 12px; border-radius: 999px; background: ${isKobposh ? '#1fae5b' : '#ffb26e'};"></div>` : ''}
        </div>
      </div>
    `;
  }
  
  renderFormStep(step) {
    const safeTitle = escapeHtml(step?.title || 'Enfòmasyon ou yo');
    const safeDescription = escapeHtml(step?.description || '');
    const safeButtonText = escapeHtml(step?.buttonText || 'Kontinye');
    return `
      <div>
        <h3 style="font-size: 1.3rem; margin-bottom: 0.5rem;">${safeTitle}</h3>
        <p style="color: #8B7E6B; margin-bottom: 1.5rem;">${safeDescription}</p>
        
        <form id="clientForm" class="space-y-4">
          ${step.fields?.map(field => this.renderFormField(field)).join('') || ''}
        </form>
        
        <button class="next-step-btn" id="nextStepBtn" data-welcome-coach="payment-step-next">
          ${safeButtonText}
        </button>
      </div>
    `;
  }
  
  renderFormField(field) {
    const value = this.clientData[field.name] || '';
    const required = field.required ? 'required' : '';
    const safeLabel = escapeHtml(field?.label || '');
    const safeName = escapeAttr(field?.name || '');
    const safeValue = escapeAttr(value);
    
    switch(field.type) {
      case 'textarea':
        return `
          <div class="form-group">
            <label>${safeLabel}${field.required ? ' *' : ''}</label>
            <textarea name="${safeName}" ${required} rows="3">${escapeHtml(value)}</textarea>
          </div>
        `;
      case 'select':
        return `
          <div class="form-group">
            <label>${safeLabel}${field.required ? ' *' : ''}</label>
            <select name="${safeName}" ${required}>
              <option value="">Chwazi...</option>
              ${field.options?.map(opt => `
                <option value="${escapeAttr(opt)}" ${value === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>
              `).join('') || ''}
            </select>
          </div>
        `;
      case 'checkbox':
        return `
          <div class="form-group" style="display: flex; align-items: center; gap: 0.5rem;">
            <input type="checkbox" name="${safeName}" id="${safeName}" ${value ? 'checked' : ''}>
            <label for="${safeName}" style="margin: 0;">${safeLabel}${field.required ? ' *' : ''}</label>
          </div>
        `;
      default:
        return `
          <div class="form-group">
            <label>${safeLabel}${field.required ? ' *' : ''}</label>
            <input type="${escapeAttr(field?.type || 'text')}" name="${safeName}" value="${safeValue}" ${required}>
          </div>
        `;
    }
  }
  
  renderPaymentStep(step) {
    if (!this.selectedMethod) {
      return '<p class="text-accent">Tanpri chwazi yon metòd an premye</p>';
    }

    const accountName = this.selectedMethod.accountName || 'Jean Pè';
    const phoneNumber = this.selectedMethod.phoneNumber || '45678909';
    const qrCodePath = this.getImagePath(this.selectedMethod.qrCode || this.getDefaultQrCodeImage(this.selectedMethod), 'qr');
    const safeTitle = escapeHtml(step?.title || 'Fè peman an');
    const safeInstruction = escapeHtml(step?.instruction || 'Peye sou enfòmasyon sa yo:');
    const safeMethodName = escapeHtml(this.selectedMethod?.name || 'Metòd');
    const safeAccountName = escapeHtml(accountName);
    const safePhoneNumber = escapeHtml(phoneNumber);
    const safeMethodImage = escapeAttr(this.getImagePath(this.selectedMethod?.image || this.getDefaultMethodImage(this.selectedMethod), 'payment'));
    const safeQrCodePath = escapeAttr(qrCodePath);
    const safeButtonText = escapeHtml(step?.buttonText || "Mwen peye");
    
    return `
      <div>
        <h3 style="font-size: 1.3rem; margin-bottom: 1rem;">${safeTitle}</h3>
        
        <p style="color: #8B7E6B; margin-bottom: 1.5rem;">${safeInstruction}</p>
        
        <div style="
          background: rgba(255,255,255,0.1);
          border-radius: 1rem;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          border: 1px solid rgba(255,255,255,0.2);
        ">
          <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
            <div style="
              width: 60px;
              height: 60px;
              background: rgba(198,167,94,0.1);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
            ">
              ${this.selectedMethod?.image || this.getDefaultMethodImage(this.selectedMethod) ?
                `<img src="${safeMethodImage}" data-fallback-icon="fa-university" style="width: 100%; height: 100%; object-fit: cover;">` :
                `<i class="fas fa-university" style="font-size: 1.5rem; color: #C6A75E;"></i>`
              }
            </div>
            <div>
              <h4 style="font-weight: 600;">${safeMethodName}</h4>
              <p style="font-size: 0.85rem; color: #8B7E6B;">Kont: ${safeAccountName}</p>
            </div>
          </div>
          
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 0;
            border-top: 1px solid rgba(198,167,94,0.2);
            border-bottom: 1px solid rgba(198,167,94,0.2);
          ">
            <span style="color: #8B7E6B;">Nimewo</span>
            <span style="font-weight: 500;">${safePhoneNumber}</span>
          </div>
          
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 0;
          ">
            <span style="color: #8B7E6B;">Montan</span>
            <span style="font-weight: bold; font-size: 1.2rem;">${this.formatPrice(this.options.amount || 0)}</span>
          </div>
          
          ${qrCodePath ? `
            <div style="
              display: flex;
              flex-direction: column;
              align-items: center;
              padding: 1rem;
              background: rgba(255,255,255,0.15);
              border-radius: 0.5rem;
            ">
              <p style="font-size: 0.85rem; color: #8B7E6B; margin-bottom: 0.5rem;">Eskane kòd QR la</p>
              <img src="${safeQrCodePath}" data-hide-on-error="1" style="width: 150px; height: 150px; object-fit: contain;">
            </div>
          ` : ''}
        </div>
        
        <button class="next-step-btn" id="nextStepBtn">
          ${safeButtonText}
        </button>
      </div>
    `;
  }
  
  renderProofStep(step) {
    const safeTitle = escapeHtml(step?.title || 'Konfime peman ou');
    const safeButtonText = escapeHtml(step?.buttonText || 'Voye demann mwen');
    const welcomeBonus = this.getWelcomeBonusStatus();
    const allowWelcomeChoice = this.options.allowWelcomeBonusChoice === true && welcomeBonus.eligible;
    const selectedProofMode = this.isWelcomeBonusSelected() ? 'welcome_bonus' : 'deposit';
    
    return `
      <div>
        <h3 style="font-size: 1.3rem; margin-bottom: 1rem;">${safeTitle}</h3>

        <form id="proofForm" class="space-y-4">
          <div class="form-group">
            <label id="proofImageLabel">Kaptire ekran prèv depo a *</label>
            <input type="file" id="proofImage" data-welcome-coach="proof-upload" accept="image/*" required>
          </div>
          
          <div id="imagePreview" style="display: none; margin-top: 1rem; text-align: center;">
            <img id="previewImg" style="max-width: 100%; max-height: 200px; border-radius: 0.5rem; border: 1px solid rgba(198,167,94,0.3);">
          </div>
        </form>
        
        <button class="next-step-btn" id="nextStepBtn" data-welcome-coach="proof-submit">
          ${safeButtonText}
        </button>
      </div>
    `;
  }
  
  renderConfirmationStep(step) {
    this.stopCountdown();
    const safeMessage = escapeHtml(this.confirmationMessage || step?.message || 'Demann ou a ap rete an atant jiskaske yon admin apwouve oswa rejte li.');
    const bonusPreview = this.getDepositBonusPreview();
    const timingPanel = this.completedFlowType === 'welcome_bonus'
      ? `
        <div style="
          background: rgba(255,255,255,0.08);
          border-radius: 1rem;
          padding: 1.2rem;
          margin-bottom: 1.5rem;
          border: 1px solid rgba(255,255,255,0.1);
        ">
          <p style="font-size: 0.9rem; color: #CBD5E1; margin-bottom: 0.45rem;">Estati</p>
          <div style="font-size: 1.25rem; font-weight: 800; color: #FBBF24;">Aktivasyon imedya</div>
        </div>
      `
      : `
        <div style="
          background: white;
          border-radius: 1rem;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
        ">
          <p style="font-size: 0.9rem; color: #8B7E6B; margin-bottom: 0.45rem;">Estati</p>
          <div style="font-size: 1.2rem; font-weight: 800; color: #1f6f45;">An atant</div>
          <p style="margin: 0.55rem 0 0; font-size: 0.92rem; color: #536273; line-height: 1.6;">
            Demann nan ap rete an atant jiskaske yon admin apwouve oswa rejte li.
          </p>
        </div>
      `;
    const bonusPanel = this.completedFlowType === 'welcome_bonus'
      ? `
        <div style="
          margin: 1.25rem 0 0;
          border: 1px solid rgba(14,92,52,0.24);
          border-radius: 1.15rem;
          background: linear-gradient(180deg, rgba(236,253,245,0.98), rgba(220,252,231,0.98));
          padding: 1rem;
          text-align: left;
          color: #F8FAFC;
          box-shadow: 0 16px 34px rgba(15,23,42,0.24), inset 0 1px 0 rgba(255,255,255,0.06);
        ">
          <p style="margin: 0; font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase; color: #FBBF24; font-weight: 800;">Bonus byenveni</p>
          <h4 style="margin: 0.55rem 0 0; font-size: 1.05rem; color: #FFFFFF;">Bonus ou a ${escapeHtml(this.formatInlineNumber(WELCOME_BONUS_HTG, 0))} HTG te ajoute</h4>
          <div style="
            margin-top: 0.9rem;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 0.75rem;
          ">
            <div style="border-radius: 0.95rem; background: rgba(255,255,255,0.08); padding: 0.9rem; border: 1px solid rgba(255,255,255,0.08);">
              <p style="margin: 0; font-size: 0.75rem; color: #CBD5E1; font-weight: 700;">Bonus kredite</p>
              <p style="margin: 0.4rem 0 0; font-size: 1.05rem; color: #FFFFFF; font-weight: 900;">${escapeHtml(this.formatInlineNumber(WELCOME_BONUS_HTG, 0))} HTG</p>
            </div>
            <div style="border-radius: 0.95rem; background: rgba(251,191,36,0.12); padding: 0.9rem; border: 1px solid rgba(251,191,36,0.18);">
              <p style="margin: 0; font-size: 0.75rem; color: #FCD34D; font-weight: 700;">Tip</p>
              <p style="margin: 0.4rem 0 0; font-size: 1.05rem; color: #FFFFFF; font-weight: 900;">Byenveni</p>
            </div>
          </div>
          <div style="
            margin-top: 0.9rem;
            border-radius: 0.95rem;
            background: rgba(15,23,42,0.24);
            padding: 0.9rem;
            color: #E2E8F0;
            line-height: 1.65;
            font-size: 0.92rem;
            border: 1px solid rgba(255,255,255,0.08);
          ">
            <p style="margin: 0;"><strong>Enpòtan :</strong> bonus byenveni sa a se yon bagay reyèl, men li suiv règ bonus ki diferan de yon depo nòmal.</p>
            <p style="margin: 0.65rem 0 0;">Ou ka kounye a eksplore sistèm nan, jwe, epi familyarize w ak etap depo yo anvan premye vrè depo ou ki apwouve.</p>
          </div>
        </div>
      `
      : bonusPreview.eligible
      ? `
        <div style="
          margin: 1.25rem 0 0;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 1.15rem;
          background: linear-gradient(180deg, rgba(44, 52, 78, 0.94), rgba(33, 39, 60, 0.96));
          padding: 1rem;
          text-align: left;
          color: #F8FAFC;
          box-shadow: 0 16px 34px rgba(15,23,42,0.24), inset 0 1px 0 rgba(255,255,255,0.06);
        ">
          <p style="margin: 0; font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF; font-weight: 900;">Bonus depo</p>
          <h4 style="margin: 0.55rem 0 0; font-size: 1.05rem; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">Depo ou a ka resevwa yon bonus apre apwobasyon</h4>
          <div style="
            margin-top: 0.9rem;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 0.75rem;
          ">
            <div style="border-radius: 0.95rem; background: rgba(255,255,255,0.08); padding: 0.9rem; border: 1px solid rgba(255,255,255,0.08);">
              <p style="margin: 0; font-size: 0.75rem; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF; font-weight: 700;">Depo soumet</p>
              <p style="margin: 0.4rem 0 0; font-size: 1.05rem; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF; font-weight: 900;">${escapeHtml(this.formatInlineNumber(bonusPreview.amountHtg, 0))} HTG</p>
            </div>
            <div style="border-radius: 0.95rem; background: rgba(251,191,36,0.12); padding: 0.9rem; border: 1px solid rgba(251,191,36,0.18);">
              <p style="margin: 0; font-size: 0.75rem; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF; font-weight: 700;">Bonus pwomosyon</p>
              <p style="margin: 0.4rem 0 0; font-size: 1.05rem; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF; font-weight: 900;">+${escapeHtml(this.formatInlineNumber(bonusPreview.bonusHtgAwarded, 0))} HTG</p>
            </div>
          </div>
          <div style="
            margin-top: 0.9rem;
            border-radius: 0.95rem;
            background: rgba(15,23,42,0.24);
            padding: 0.9rem;
            color: #FFFFFF !important;
            -webkit-text-fill-color: #FFFFFF;
            line-height: 1.65;
            font-size: 0.92rem;
            border: 1px solid rgba(255,255,255,0.08);
          ">
            <p style="margin: 0; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF;"><strong style="color:#FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">Ki jan sa mache:</strong> depo ou a ale an premye nan <strong style="color:#FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">HTG sou verifikasyon</strong>. Si administrasyon an apwouve demann nan, sistem nan kalkile otomatikman <strong style="color:#FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">${escapeHtml(this.formatInlineNumber(bonusPreview.bonusPercent, 0))}%</strong> nan depo a, epi li ajoute bonus la an <strong style="color:#FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">HTG</strong> sou kont ou.</p>
            <p style="margin: 0.65rem 0 0; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">Pou depo sa a, w ap resevwa anviwon <strong style="color:#FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">${escapeHtml(this.formatInlineNumber(bonusPreview.bonusHtgRaw))} HTG</strong> bonus, ki kredite an <strong style="color:#FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">HTG</strong> sou kont ou apre apwobasyon.</p>
            <p style="margin: 0.65rem 0 0; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">Bonus la pa paret avan apwobasyon. Si yo rejte l, pa gen okenn bonus ki ajoute.</p>
        </div>
      `
      : `
        <div style="
          margin: 1.25rem 0 0;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 1.15rem;
          background: linear-gradient(180deg, rgba(44, 52, 78, 0.94), rgba(33, 39, 60, 0.96));
          padding: 1rem;
          text-align: left;
          color: #FFFFFF !important;
          -webkit-text-fill-color: #FFFFFF;
          line-height: 1.65;
          font-size: 0.92rem;
          box-shadow: 0 14px 28px rgba(8,61,34,0.16), inset 0 1px 0 rgba(255,255,255,0.8);
        ">
          <p style="margin: 0; font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF; font-weight: 900;">Bonus depo</p>
          <p style="margin: 0.6rem 0 0; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF;"><strong style="color:#FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">Enfòmasyon enpòtan :</strong> bonus pwomosyon an kòmanse apati de <strong style="color:#FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">${escapeHtml(this.formatInlineNumber(bonusPreview.thresholdHtg, 0))} HTG</strong> ki apwouve.</p>
          <p style="margin: 0.55rem 0 0; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">Depo sa a ap trete nòmalman: li monte an <strong style="color:#FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">HTG sou verifikasyon</strong>, epi administrasyon an ap valide l oswa rejte l.</p>
        </div>
      `;
    
    return `
      <div style="text-align: center; padding: 1rem 0;">
        <div style="
          width: 100px;
          height: 100px;
          background: #2E5D3A;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
        ">
          <i class="fas fa-check" style="font-size: 3rem; color: white;"></i>
        </div>
        
        <h3 style="font-size: 1.5rem; margin-bottom: 1rem;">Demann nan soumèt ak siksè !</h3>
        
        <p style="color: #8B7E6B; margin-bottom: 2rem;">
          ${safeMessage}
        </p>

        ${timingPanel}

        ${bonusPanel}
        
          <p style="font-size: 0.9rem; color: #FFFFFF !important; -webkit-text-fill-color:#FFFFFF;">
          <i class="fas fa-clock" style="margin-right: 0.3rem;"></i>
          Ou ka suiv estati demann ou a nan modil balans lan.
        </p>
        
        <button class="next-step-btn" id="closeAfterConfirmation" style="margin-top: 2rem;">
          Fèmen
        </button>
      </div>
    `;
  }
  
  renderCustomStep(step) {
    if (step?.variant === 'welcome_bonus_capture') {
      const proofCode = escapeHtml(this.getWelcomeBonusProofCode());
      const welcomeSupport = this.getWelcomeDepositWhatsappMeta();
      return `
        <div>
          <h3 style="font-size: 1.3rem; margin-bottom: 1rem;">Pran prèv bonus la</h3>
          <p style="color: #8B7E6B; margin-bottom: 1rem;">Fè yon kaptire ekran kat sa a. Yo pral sèvi avè l kòm prèv nan dènye etap la.</p>

          <div data-welcome-coach="proof-card" style="
            border: 1px solid rgba(251,191,36,0.24);
            border-radius: 1.25rem;
            padding: 1.25rem;
            background: linear-gradient(180deg, rgba(50,57,84,0.96), rgba(34,40,61,0.98));
            color: #F8FAFC;
            box-shadow: 0 18px 36px rgba(15,23,42,0.25), inset 0 1px 0 rgba(255,255,255,0.06);
          ">
            <p style="margin: 0; font-size: 0.74rem; letter-spacing: 0.16em; text-transform: uppercase; color: #FBBF24; font-weight: 800;">Bonus byenveni</p>
            <h4 style="margin: 0.7rem 0 0; font-size: 1.18rem; color: #FFFFFF;">Ranmase bonus mwen an 25 Gdes</h4>
            <div style="
              margin-top: 1rem;
              border-radius: 1rem;
              border: 1px solid rgba(255,255,255,0.08);
              background: rgba(255,255,255,0.07);
              padding: 1rem;
            ">
              <p style="margin: 0; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.12em; color: #CBD5E1;">ID kliyan</p>
              <p style="margin: 0.45rem 0 0; font-size: 1.1rem; font-weight: 900; color: #FFFFFF; letter-spacing: 0.08em;">${proofCode}</p>
            </div>
          </div>

          <div style="
            margin-top: 1rem;
            border-radius: 1rem;
            background: rgba(245,124,0,0.10);
            border: 1px solid rgba(255,178,110,0.18);
            padding: 1rem;
            color: #F8FAFC;
            line-height: 1.65;
          ">
            Imaj sa a dwe parèt nan kaptire ou a. Kenbe l byen, epi klike sou swivan pou kontinye pwosesis la.
          </div>

          <div style="
            margin-top: 1rem;
            border-radius: 1rem;
            border: 1px solid rgba(31,174,91,0.18);
            background: rgba(31,174,91,0.08);
            padding: 1rem;
            color: #F8FAFC;
          ">
            <p style="margin: 0; font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; color: #86efac; font-weight: 800;">Asistans bonus</p>
            <p style="margin: 0.55rem 0 0; line-height: 1.6;">Si ou bezwen èd pou bonus byenveni an, kontakte sipò a sou WhatsApp avan ou voye demann nan.</p>
            <div style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;margin-top:0.85rem;">
              <a
                href="${escapeHtml(welcomeSupport.url)}"
                target="_blank"
                rel="noopener noreferrer"
                style="
                  display:inline-flex;
                  align-items:center;
                  justify-content:center;
                  min-height:44px;
                  padding:0.8rem 1rem;
                  border-radius:0.9rem;
                  background:linear-gradient(180deg,#25c46b 0%,#1fae5b 100%);
                  color:#042417;
                  font-weight:800;
                  text-decoration:none;
                "
              >Kontakte sipò bonus la</a>
              <span style="font-size:0.86rem;color:#d1fae5;">WhatsApp: ${escapeHtml(welcomeSupport.label)}</span>
            </div>
          </div>

          <button class="next-step-btn" id="nextStepBtn" data-welcome-coach="proof-card-next">
            ${escapeHtml(step?.buttonText || 'Swivan')}
          </button>
        </div>
      `;
    }

    const safeTitle = escapeHtml(step?.title || 'Etap pèsonalize');
    const safeContent = escapeHtml(step?.content || '');
    const safeButtonText = escapeHtml(step?.buttonText || 'Kontinye');
    return `
      <div>
        <h3 style="font-size: 1.3rem; margin-bottom: 1rem;">${safeTitle}</h3>
        <div style="
          background: white;
          border-radius: 1rem;
          padding: 1.5rem;
          white-space: pre-line;
        ">
          ${safeContent}
        </div>
        
        <button class="next-step-btn" id="nextStepBtn">
          ${safeButtonText}
        </button>
      </div>
    `;
  }
  
  renderNoSteps() {
    return `
      <div style="text-align: center; padding: 2rem;">
        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #B76E2E; margin-bottom: 1rem;"></i>
        <h3 style="font-size: 1.2rem; margin-bottom: 1rem;">Konfigirasyon an pa konplè</h3>
        <p style="color: #8B7E6B;">Metòd peman sa a pa konfigire kòrèkteman.</p>
      </div>
    `;
  }
  
  attachEvents() {
    this.bindAssetFallbacks();

    const closeBtn = this.modal.querySelector('.close-payment');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    
    const backBtn = this.modal.querySelector('.back-step');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.goBack());
    }
    
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });
    
    if (this.currentStep === 0) {
      this.attachStep0Events();
    } else {
      this.attachStepEvents();
    }
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  bindAssetFallbacks() {
    if (!this.modal) return;

    this.modal.querySelectorAll('img[data-hide-on-error="1"]').forEach((img) => {
      if (img.dataset.errorBound === '1') return;
      img.dataset.errorBound = '1';
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
    });

    this.modal.querySelectorAll('img[data-fallback-icon]').forEach((img) => {
      if (img.dataset.errorBound === '1') return;
      img.dataset.errorBound = '1';
      img.addEventListener('error', () => {
        const parent = img.parentElement;
        if (!parent) {
          img.style.display = 'none';
          return;
        }
        if (parent.dataset.fallbackApplied === '1') return;
        parent.dataset.fallbackApplied = '1';
        while (parent.firstChild) {
          parent.removeChild(parent.firstChild);
        }
        const icon = document.createElement('i');
        icon.className = `fas ${img.dataset.fallbackIcon || 'fa-image'}`;
        icon.style.fontSize = '1.5rem';
        icon.style.color = '#C6A75E';
        parent.appendChild(icon);
      });
    });
  }
  
  attachStep0Events() {
    const introNextBtn = this.modal.querySelector('#nextStepBtn');
    if (introNextBtn && this.options.flowType === 'welcome_bonus' && this.getWelcomeBonusStatus().eligible && !this.welcomeBonusCaptureReady) {
      introNextBtn.addEventListener('click', () => {
        this.welcomeBonusCaptureReady = true;
        this.updateStepDisplay();
      });
      return;
    }

    const methodsList = this.modal.querySelector('#methodsList');
    const agentDepositBtn = this.modal.querySelector('#agentDepositBtn');
    
    if (methodsList) {
      methodsList.querySelectorAll('.method-card').forEach(card => {
        card.addEventListener('click', () => {
          const methodId = card.dataset.methodId;
          const method = this.methods.find(m => m.id === methodId);
          
          if (method) {
            this.selectedMethod = method;
            this.steps = this.getMethodSteps(this.selectedMethod);
            this.currentStep = 1;
            this.updateStepDisplay();
          }
        });
      });
    }

    if (agentDepositBtn) {
      agentDepositBtn.addEventListener('click', async () => {
        await this.openAgentDepositSupportModal();
      });
    }

    if (this.requiresAgentDepositFlow() && !this.agentDepositAutoPrompted) {
      this.agentDepositAutoPrompted = true;
      window.setTimeout(() => {
        this.openAgentDepositSupportModal().catch(() => {});
      }, 120);
    }
  }
  
  attachStepEvents() {
    const nextBtn = this.modal.querySelector('#nextStepBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.handleNextStep());
    }
    
    const closeBtn = this.modal.querySelector('#closeAfterConfirmation');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    
    const proofImage = this.modal.querySelector('#proofImage');
    if (proofImage) {
      proofImage.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          if (file.size > 5 * 1024 * 1024) {
            alert('L\'image est trop volumineuse. Taille maximum : 5 Mo');
            proofImage.value = '';
            return;
          }
          
          const reader = new FileReader();
          reader.onload = (e) => {
            const preview = this.modal.querySelector('#imagePreview');
            const img = this.modal.querySelector('#previewImg');
            if (preview && img) {
              img.src = e.target.result;
              preview.style.display = 'block';
            }
            this.proofImageFile = file;
          };
          reader.readAsDataURL(file);
        }
      });
    }

    this.modal.querySelectorAll('input[name="depositMode"]').forEach((input) => {
      input.addEventListener('change', () => {
        this.proofMode = input.value === 'welcome_bonus' ? 'welcome_bonus' : 'deposit';
        this.syncProofModeUi();
      });
    });
    this.syncProofModeUi();
  }

  syncProofModeUi() {
    if (!this.modal) return;
    const selectedMode = this.isWelcomeBonusSelected() ? 'welcome_bonus' : 'deposit';
    this.proofMode = selectedMode;
    if (selectedMode === 'welcome_bonus') {
      this.clearProofStepStartedAtMs();
    } else {
      this.ensureProofStepStartedAtMs();
    }

    this.modal.querySelectorAll('[data-proof-mode-card]').forEach((card) => {
      const mode = card.getAttribute('data-proof-mode-card');
      const active = mode === selectedMode;
      card.style.borderColor = active
        ? (mode === 'welcome_bonus' ? 'rgba(251,191,36,0.75)' : 'rgba(255,178,110,0.9)')
        : 'rgba(255,255,255,0.16)';
      card.style.background = active
        ? (mode === 'welcome_bonus' ? 'rgba(251,191,36,0.14)' : 'rgba(245,124,0,0.14)')
        : 'rgba(255,255,255,0.08)';
    });

    const helpEl = this.modal.querySelector('#proofImageHelp');
    if (helpEl) {
      helpEl.textContent = selectedMode === 'welcome_bonus'
        ? "Charge l image recue pour activer ton bonus de bienvenue. Format accepte : JPG, PNG (max 5 Mo)."
        : "Format accepte : JPG, PNG (max 5 Mo)";
    }

    const labelEl = this.modal.querySelector('#proofImageLabel');
    if (labelEl) {
      labelEl.textContent = selectedMode === 'welcome_bonus'
        ? "Imaj yo mande pou bonus la *"
        : "Kaptire ekran tranzaksyon an *";
    }

    const nextBtn = this.modal.querySelector('#nextStepBtn');
    if (nextBtn) {
      nextBtn.textContent = selectedMode === 'welcome_bonus'
        ? `Ranmase bonus mwen an ${this.formatInlineNumber(WELCOME_BONUS_HTG, 0)} HTG`
        : 'Voye demann mwen';
    }
  }
  
  goBack() {
    if (this.currentStep > 0 && this.currentStep < this.steps.length) {
      this.currentStep--;
      this.updateStepDisplay();
    }
  }
  
  async handleNextStep() {
    const stepIndex = this.currentStep - 1;
    const step = this.steps[stepIndex];
    
    if (!step) return;
    
    const nextBtn = this.modal.querySelector('#nextStepBtn');
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.innerHTML = '<div class="loading-spinner"></div> Traitement...';
    }
    
    try {
      let isValid = true;
      
      switch(step.type) {
        case 'form':
          isValid = this.validateFormStep();
          break;
        case 'proof':
          isValid = await this.validateProofStep();
          break;
        case 'payment':
          break;
        default:
          break;
      }
      
      if (!isValid) {
        if (nextBtn) {
          nextBtn.disabled = false;
          nextBtn.innerHTML = step.type === 'proof'
            ? (this.isWelcomeBonusSelected()
              ? `Ranmase bonus mwen an ${this.formatInlineNumber(WELCOME_BONUS_HTG, 0)} HTG`
              : (step.buttonText || 'Voye demann mwen'))
            : (step.buttonText || 'Kontinye');
        }
        return;
      }
      
      if (step.type === 'proof') {
        this.clearProofStepStartedAtMs();
        this.isSubmitted = true;
        this.isCompleted = true;
        
        this.currentStep++;
        this.updateStepDisplay();
        
        return;
      }
      
      if (this.currentStep < this.steps.length) {
        this.currentStep++;
        this.updateStepDisplay();
      }
    } catch (error) {
      console.error('[PAYMENT] Erreur:', error);
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.innerHTML = step.type === 'proof'
          ? (this.isWelcomeBonusSelected()
            ? `Ranmase bonus mwen an ${this.formatInlineNumber(WELCOME_BONUS_HTG, 0)} HTG`
            : (step.buttonText || 'Voye demann mwen'))
          : (step.buttonText || 'Kontinye');
      }
      if (step.type === 'proof' && isDepositProofSecurityError(error)) {
        await this.openMissingDepositIdSupportModal();
        return;
      }
      alert(getPaymentFriendlyErrorMessage(error));
    }
  }
  
  validateFormStep() {
    const form = this.modal.querySelector('#clientForm');
    if (!form) return false;
    
    const inputs = form.querySelectorAll('input, textarea, select');
    let isValid = true;
    let firstInvalid = null;
    
    inputs.forEach(input => {
      if (input.hasAttribute('required') && !input.value.trim()) {
        input.style.borderColor = '#7F1D1D';
        isValid = false;
        if (!firstInvalid) firstInvalid = input;
      } else {
        input.style.borderColor = 'rgba(198,167,94,0.3)';
      }
    });
    
    if (!isValid && firstInvalid) {
      firstInvalid.focus();
      alert('Tanpri ranpli tout chan obligatwa yo');
      return false;
    }

    if (isValid) {
      inputs.forEach(input => {
        if (input.type === 'checkbox') {
          this.clientData[input.name] = input.checked;
        } else {
          this.clientData[input.name] = input.value.trim();
        }
      });
    }
    
    return isValid;
  }

  async extractTextFromProofImage(imageFile) {
    if (!imageFile) return '';
    const tesseract = await loadTesseractRuntime();
    const result = await tesseract.recognize(imageFile, OCR_LANGUAGE, { logger: () => {} });
    const raw = String(result?.data?.text || '');
    return raw.replace(/[ \t]+\n/g, '\n').trim();
  }
  
  async validateProofStep() {
    this.proofSubmitAttemptDurationMs = this.getProofStepDurationMs();
    console.info('[DEPOSIT_GUARD_DEBUG][PAYMENT] proof-submit', {
      uid: this.getClientUid(),
      durationMs: this.proofSubmitAttemptDurationMs,
      proofMode: this.proofMode,
      welcomeSelected: this.isWelcomeBonusSelected(),
    });

    const proofImage = this.modal.querySelector('#proofImage')?.files[0];

    if (!proofImage && !this.proofImageFile) {
      alert('Tanpri chwazi yon imaj');
      return false;
    }

    if (this.shouldPromptRapidDepositWarning()) {
      const confirmedRapidSubmission = await this.confirmRapidDepositSubmission();
      if (!confirmedRapidSubmission) {
        return false;
      }
    }

    const imageFile = this.proofImageFile || proofImage;
    const proofDepositorPhone = sanitizePhoneInput(
      this.clientData.depositorPhone
      || this.clientData.phone
      || this.options.client?.depositorPhone
      || this.options.client?.phone
      || ''
    );
    const fallbackProofRef = [
      imageFile?.name,
      this.clientData.fullName,
      this.clientData.name,
      this.options.client?.name,
      `proof-${Date.now()}`
    ].find((value) => String(value || '').trim()) || `proof-${Date.now()}`;

    this.extractedText = '';
    this.extractedTextStatus = 'pending';
    this.extractedProofId = '';

    try {
      this.extractedText = await this.extractTextFromProofImage(imageFile);
      this.extractedTextStatus = this.extractedText ? 'success' : 'empty';
      this.extractedProofId = extractDepositIdFromOcrText(this.extractedText);
    } catch (ocrError) {
      console.error('OCR proof extraction failed:', ocrError);
      this.extractedText = '';
      this.extractedTextStatus = 'failed';
      this.extractedProofId = '';
    }

    const normalizedCurrentOcrText = this.normalizeProofOcrText(this.extractedText);
    const normalizedPreviousOcrText = this.readLastProofOcrText();
    if (
      normalizedCurrentOcrText
      && normalizedPreviousOcrText
      && normalizedCurrentOcrText === normalizedPreviousOcrText
    ) {
      await this.openDuplicateProofOcrModal();
      return false;
    }

    this.clientData.depositorPhone = proofDepositorPhone;
    const proofName = String(this.extractedProofId || fallbackProofRef).trim();

    if (!this.isWelcomeBonusSelected() && !this.extractedProofId) {
      console.info('[DEPOSIT_GUARD_DEBUG][PAYMENT] proof-id-missing-but-allowed', {
        uid: this.getClientUid(),
        extractedTextStatus: this.extractedTextStatus,
        extractedTextLength: this.extractedText.length,
      });
    }

    if (this.isWelcomeBonusSelected()) {
      await this.saveWelcomeBonusClaim(proofName);
    } else {
      const orderSaved = await this.saveOrder(proofName);
      if (orderSaved === false) {
        return false;
      }
    }

    if (normalizedCurrentOcrText) {
      this.writeLastProofOcrText(normalizedCurrentOcrText);
    }

    return true;
  }

  async saveWelcomeBonusClaim(proofName) {
    const customerName = this.clientData.fullName || this.clientData.name || this.options.client?.name || '';
    const customerPhone = this.clientData.phone || this.options.client?.phone || '';
    const depositorPhone = this.clientData.depositorPhone || '';

    const response = await claimWelcomeBonusSecure({
      customerName,
      customerPhone,
      depositorPhone,
      proofRef: proofName,
      methodId: this.selectedMethod?.id || 'welcome_bonus',
    });
    this.completedFlowType = 'welcome_bonus';
    this.confirmationMessage = String(
      response?.message
      || `Ton bonus de bienvenue de ${WELCOME_BONUS_HTG} HTG a ete active avec succes.`
    ).trim();
    await this.loadFundingStatus();

    try {
      const { ensureXchangeState } = await import('./xchange.js?v=20260625-morpion-firebase1');
      await ensureXchangeState(this.options.client?.uid || this.options.client?.id || '');
    } catch (error) {
      console.warn('Impossible de rafraichir l état Xchange après bonus:', error);
    }

    const eventDetail = {
      uid: this.options.client?.uid || this.options.client?.id || '',
      welcomeBonusHtgGranted: Number(response?.welcomeBonusHtgGranted) || WELCOME_BONUS_HTG,
    };
    document.dispatchEvent(new CustomEvent('welcomeBonusClaimed', {
      detail: eventDetail
    }));
    window.dispatchEvent(new CustomEvent('welcomeBonusClaimed', {
      detail: {
        ...eventDetail,
      }
    }));

    if (this.options.onSuccess) {
      this.options.onSuccess({
        type: 'welcome_bonus',
        welcomeBonusHtgGranted: Number(response?.welcomeBonusHtgGranted) || WELCOME_BONUS_HTG,
      });
    }

    return true;
  }
  
  async saveOrder(proofName) {
    try {
      if (!this.options.client || !this.options.client.id) {
        console.error('[PAYMENT] Client non disponible');
        return false;
      }

      await this.loadFundingStatus();
      const blockingPendingAmount = getBlockingPendingDepositAmount(this.fundingStatus);
      if (blockingPendingAmount > 0) {
        throw new Error(buildPendingDepositBlockingMessage(blockingPendingAmount));
      }

      const normalizedItems = Array.isArray(this.options.cart)
        ? this.options.cart.map((item) => {
            const quantity = Number(item?.quantity) || 1;
            const price = Number(item?.price) || 0;
            return {
              productId: item?.productId || '',
              name: item?.name || 'Produit',
              price,
              quantity,
              sku: item?.sku || '',
              image: item?.image || '',
              selectedOptions: Array.isArray(item?.selectedOptions) ? item.selectedOptions : []
            };
          })
        : [];
      const computedAmount = normalizedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const finalAmount = Number(this.options.amount) || computedAmount;
      
      const uniqueCode = 'VLX-' + Math.random().toString(36).substr(2, 8).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
      
      const orderData = {
        amount: finalAmount,
        clientId: this.options.client?.id || '',
        clientUid: this.options.client?.uid || '',
        methodId: this.selectedMethod?.id,
        methodName: this.selectedMethod?.name,
        methodDetails: {
          name: this.selectedMethod?.name,
          accountName: this.selectedMethod?.accountName,
          phoneNumber: this.selectedMethod?.phoneNumber
        },
        delivery: this.options.delivery || null,
        shippingAmount: Number(this.options.delivery?.totalFee || 0),
        weightFee: Number(this.options.delivery?.weightFee || 0),
        items: normalizedItems,
        status: 'pending',
        uniqueCode: uniqueCode,
        extractedText: this.extractedText,
        extractedTextStatus: this.extractedTextStatus,
        extractedTextAt: new Date().toISOString(),
        proofName: proofName,
        clientData: this.clientData,
        customerName: this.clientData.fullName || this.clientData.name || this.options.client?.name || '',
        customerEmail: this.clientData.email || this.options.client?.email || '',
        customerPhone: this.clientData.phone || this.options.client?.phone || '',
        depositorPhone: this.clientData.depositorPhone || '',
        customerAddress: this.clientData.address || this.options.client?.address || '',
        customerCity: this.clientData.city || this.options.client?.city || '',
        createdAt: new Date().toISOString()
      };

      const response = await createOrderSecure({
        methodId: this.selectedMethod?.id || '',
        amountHtg: finalAmount,
        customerName: orderData.customerName,
        customerEmail: orderData.customerEmail,
        customerPhone: orderData.customerPhone,
        depositorPhone: orderData.depositorPhone,
        proofRef: proofName,
        extractedText: this.extractedText,
        extractedTextStatus: this.extractedTextStatus,
        proofStepDurationMs: this.getProofStepDurationMs(),
      });
      console.info('[DEPOSIT_GUARD_DEBUG][PAYMENT] create-order:response', {
        uid: this.getClientUid(),
        requestedAmountHtg: finalAmount,
        orderId: String(response?.orderId || ''),
        status: String(response?.status || ''),
        creditedProvisionally: response?.creditedProvisionally === true,
        message: String(response?.message || ''),
      });
      try {
        const afterCreateFunding = await getDepositFundingStatusSecure({});
        console.info("[FUNDING_TRACE][PAYMENT] after-createOrder-funding", {
          uid: this.getClientUid(),
          orderId: String(response?.orderId || ''),
          approvedDepositsHtg: afterCreateFunding?.approvedDepositsHtg,
          approvedDepositBonusHtg: afterCreateFunding?.approvedDepositBonusHtg,
          reservedWithdrawalsHtg: afterCreateFunding?.reservedWithdrawalsHtg,
          exchangedApprovedHtg: afterCreateFunding?.exchangedApprovedHtg,
          transferSentHtgTotal: afterCreateFunding?.transferSentHtgTotal,
          transferReceivedHtgTotal: afterCreateFunding?.transferReceivedHtgTotal,
          nativeGameEntryApprovedHtgTotal: afterCreateFunding?.nativeGameEntryApprovedHtgTotal,
          nativeGameRewardApprovedHtgTotal: afterCreateFunding?.nativeGameRewardApprovedHtgTotal,
          approvedHtgAvailable: afterCreateFunding?.approvedHtgAvailable,
          provisionalHtgAvailable: afterCreateFunding?.provisionalHtgAvailable,
          playableHtg: afterCreateFunding?.playableHtg,
          withdrawableHtg: afterCreateFunding?.withdrawableHtg,
          pendingOrders: Array.isArray(afterCreateFunding?.pendingOrders) ? afterCreateFunding.pendingOrders : [],
        });
      } catch (fundingError) {
        console.warn("[FUNDING_TRACE][PAYMENT] after-createOrder-funding failed", fundingError);
      }
      this.completedFlowType = 'deposit';
      this.confirmationMessage = String(response?.message || "").trim();
      const orderId = response?.orderId || '';
      
      document.dispatchEvent(new CustomEvent('orderSaved', {
        detail: { id: orderId, clientId: this.options.client.id, order: orderData }
      }));
      
      if (this.options.onSuccess) {
        this.options.onSuccess({ id: orderId, ...orderData });
      }
      
      return true;
    } catch (error) {
      console.error('[PAYMENT] Erreur sauvegarde commande:', error);
      if (isDepositProofSecurityError(error)) {
        await this.openMissingDepositIdSupportModal();
        return false;
      }
      throw error;
    }
  }
  
  updateStepDisplay() {
    const header = this.modal.querySelector('.payment-container-' + this.uniqueId + ' > div:first-child');
    if (header) {
      const titleDiv = header.querySelector('div:first-child');
      if (titleDiv) {
        titleDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 1rem;">
            ${this.currentStep > 0 && this.currentStep < (this.steps?.length || 0) && !this.isSubmitted ? `
              <button class="back-step payment-icon-btn" style="
                background: none;
                border: none;
                font-size: 1.2rem;
                cursor: pointer;
                color: #8B7E6B;
                padding: 0.5rem;
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: all 0.2s;
              ">
                <i class="fas fa-arrow-left"></i>
              </button>
            ` : ''}
            <h2 style="
              font-family: 'Cormorant Garamond', serif;
              font-size: 1.5rem;
              color: #1F1E1C;
              margin: 0;
            ">
              Paiement sécurisé
            </h2>
          </div>
          <button class="close-payment payment-icon-btn" style="
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #8B7E6B;
            transition: all 0.2s;
            padding: 0.5rem;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
          ">
            <i class="fas fa-times"></i>
          </button>
        `;
      }
      
      const oldProgress = header.querySelector('div[style*="margin-top: 0.5rem"]');
      if (oldProgress) {
        oldProgress.remove();
      }
      
      if (this.currentStep < (this.steps?.length || 0) && !this.isSubmitted) {
        const newProgress = document.createElement('div');
        newProgress.innerHTML = this.renderProgressBar();
        header.appendChild(newProgress.firstChild);
      }
    }
    
    const content = this.modal.querySelector('.payment-container-' + this.uniqueId + ' > div:nth-child(2)');
    if (content) {
      content.innerHTML = this.renderCurrentStep();
    }
    
    this.attachEvents();
  }
  

  stopCountdown() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }
  
  animateIn() {
    setTimeout(() => {
      this.modal.style.opacity = '1';
    }, 50);
  }
  
  animateOut() {
    return new Promise(resolve => {
      this.modal.style.opacity = '0';
      const container = this.modal.querySelector('.payment-container-' + this.uniqueId);
      if (container) {
        container.style.transform = 'scale(0.95)';
      }
      setTimeout(resolve, 300);
    });
  }
  
  async close() {
    this.stopCountdown();
    this.clearProofStepStartedAtMs();
    
    await this.animateOut();
    this.modal.remove();
    document.body.style.overflow = '';
    
    if (this.options.onClose) {
      this.options.onClose();
    }
  }
}

export default PaymentModal;

