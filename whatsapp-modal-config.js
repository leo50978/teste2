import { db, doc, getDoc } from "./firebase-init.js";
import { SUPPORT_WHATSAPP_PHONE } from "./support-contact.js";

const WHATSAPP_CONTACTS_DOC_ID = "whatsapp_modal_contacts_v1";
const WHATSAPP_CONTACTS_CACHE_KEY = "kobposhv2_whatsapp_modal_contacts_v1";
const WHATSAPP_CONTACTS_VERSION = "wmc-v1";

const DEFAULT_CONTACTS = Object.freeze({
  support_default: SUPPORT_WHATSAPP_PHONE,
  rejected_order: SUPPORT_WHATSAPP_PHONE,
  agent_deposit: SUPPORT_WHATSAPP_PHONE,
  withdrawal_assistance: SUPPORT_WHATSAPP_PHONE,
  welcome_deposit_modal: SUPPORT_WHATSAPP_PHONE,
  recruitment_modal: SUPPORT_WHATSAPP_PHONE,
  championnat_mopyon: SUPPORT_WHATSAPP_PHONE,
});

const contactsCache = { ...DEFAULT_CONTACTS };
let contactsVersion = WHATSAPP_CONTACTS_VERSION;
let contactsUpdatedAtMs = 0;
let loadPromise = null;

function sanitizeWhatsappDigits(value, fallback = "") {
  const digits = String(value || "").replace(/\D/g, "").trim();
  if (digits.length >= 8 && digits.length <= 20) return digits;
  return String(fallback || "").replace(/\D/g, "").trim();
}

function normalizeContacts(rawContacts = {}) {
  const out = {};
  Object.keys(DEFAULT_CONTACTS).forEach((key) => {
    out[key] = sanitizeWhatsappDigits(rawContacts?.[key], DEFAULT_CONTACTS[key]);
  });
  return out;
}

function saveLocalCache() {
  try {
    window.localStorage.setItem(
      WHATSAPP_CONTACTS_CACHE_KEY,
      JSON.stringify({
        version: contactsVersion,
        updatedAtMs: contactsUpdatedAtMs,
        contacts: contactsCache,
      })
    );
  } catch (_) {}
}

function hydrateFromLocalCache() {
  try {
    const raw = window.localStorage.getItem(WHATSAPP_CONTACTS_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const normalized = normalizeContacts(parsed?.contacts || {});
    Object.assign(contactsCache, normalized);
    contactsVersion = String(parsed?.version || WHATSAPP_CONTACTS_VERSION);
    contactsUpdatedAtMs = Number(parsed?.updatedAtMs) || 0;
  } catch (_) {}
}

export function getWhatsappContactDigits(key = "support_default", fallback = SUPPORT_WHATSAPP_PHONE) {
  const safeKey = String(key || "support_default").trim();
  const fallbackDigits = sanitizeWhatsappDigits(fallback, SUPPORT_WHATSAPP_PHONE);
  const support = sanitizeWhatsappDigits(contactsCache.support_default, fallbackDigits) || fallbackDigits;
  const candidate = sanitizeWhatsappDigits(contactsCache[safeKey], support);
  return candidate || support;
}

export function getWhatsappContactLabel(key = "support_default", fallback = SUPPORT_WHATSAPP_PHONE) {
  const digits = getWhatsappContactDigits(key, fallback);
  return digits ? `+${digits}` : "";
}

export function buildWhatsappUrlForKey(key = "support_default", message = "", fallback = SUPPORT_WHATSAPP_PHONE) {
  const digits = getWhatsappContactDigits(key, fallback);
  const base = `https://wa.me/${digits}`;
  const text = String(message || "").trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export async function refreshWhatsappModalContacts(force = false) {
  if (!force && loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const snap = await getDoc(doc(db, "settings", WHATSAPP_CONTACTS_DOC_ID));
      const data = snap.exists() ? (snap.data() || {}) : {};
      const normalized = normalizeContacts(data.contacts || {});
      Object.assign(contactsCache, normalized);
      contactsVersion = String(data.version || WHATSAPP_CONTACTS_VERSION);
      contactsUpdatedAtMs = Number(data.updatedAtMs) || 0;
      saveLocalCache();
      return {
        contacts: { ...contactsCache },
        version: contactsVersion,
        updatedAtMs: contactsUpdatedAtMs,
      };
    } catch (_) {
      return {
        contacts: { ...contactsCache },
        version: contactsVersion,
        updatedAtMs: contactsUpdatedAtMs,
      };
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

hydrateFromLocalCache();
