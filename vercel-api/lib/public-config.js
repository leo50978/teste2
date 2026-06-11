const { db } = require("./firebase-admin");
const { APP_PUBLIC_SETTINGS_DOC, normalizePublicAppSettings } = require("./payment-options");
const { getDashboardWebPushConfig } = require("./dashboard-push");
const { safeSignedInt, sanitizePhone, sanitizeText } = require("./safe");

const DPAYMENT_ADMIN_BOOTSTRAP_DOC = "dpayment_admin_bootstrap";
const WHATSAPP_MODAL_SETTINGS_DOC = "whatsapp_modal_contacts_v1";
const HOME_HERO_SETTINGS_DOC = "home_hero_slides_v1";

const DEFAULT_WHATSAPP_MODAL_CONTACTS = Object.freeze({
  support_default: "50940507232",
  rejected_order: "50940507232",
  agent_deposit: "50940507232",
  withdrawal_assistance: "50940507232",
  welcome_deposit_modal: "50940507232",
  recruitment_modal: "50940507232",
  championnat_mopyon: "50940507232",
});

const DEFAULT_HOME_HERO_SLIDES = Object.freeze([
  Object.freeze({ name: "hero.jpg", enabled: true, sortOrder: 10 }),
  Object.freeze({ name: "hero1.jpg", enabled: true, sortOrder: 20 }),
  Object.freeze({ name: "hero2.jpg", enabled: true, sortOrder: 30 }),
]);

async function readRawPublicAppSettings() {
  const directSnap = await db.collection("settings").doc(APP_PUBLIC_SETTINGS_DOC).get();
  if (directSnap.exists) {
    return directSnap.data() || {};
  }

  const fallbackSnap = await db.collection("settings").get();
  if (fallbackSnap.empty) return {};

  const legacy = fallbackSnap.docs.find((docSnap) => {
    return ![
      DPAYMENT_ADMIN_BOOTSTRAP_DOC,
      APP_PUBLIC_SETTINGS_DOC,
      WHATSAPP_MODAL_SETTINGS_DOC,
      HOME_HERO_SETTINGS_DOC,
    ].includes(docSnap.id);
  });

  return legacy ? (legacy.data() || {}) : {};
}

async function readPublicAppSettings() {
  const raw = await readRawPublicAppSettings();
  return normalizePublicAppSettings(raw);
}

function sanitizeWhatsappDigits(value, fallback = "") {
  const digits = String(value || "").replace(/\D/g, "").trim();
  if (digits.length >= 8 && digits.length <= 20) return digits;
  return String(fallback || "").replace(/\D/g, "").trim();
}

function normalizeWhatsappModalContacts(rawContacts = {}) {
  const source = rawContacts && typeof rawContacts === "object" ? rawContacts : {};
  const supportDefault = sanitizeWhatsappDigits(
    source.support_default,
    DEFAULT_WHATSAPP_MODAL_CONTACTS.support_default
  );

  return {
    support_default: supportDefault,
    rejected_order: sanitizeWhatsappDigits(source.rejected_order, supportDefault || DEFAULT_WHATSAPP_MODAL_CONTACTS.rejected_order),
    agent_deposit: sanitizeWhatsappDigits(source.agent_deposit, supportDefault || DEFAULT_WHATSAPP_MODAL_CONTACTS.agent_deposit),
    withdrawal_assistance: sanitizeWhatsappDigits(
      source.withdrawal_assistance,
      supportDefault || DEFAULT_WHATSAPP_MODAL_CONTACTS.withdrawal_assistance
    ),
    welcome_deposit_modal: sanitizeWhatsappDigits(
      source.welcome_deposit_modal,
      supportDefault || DEFAULT_WHATSAPP_MODAL_CONTACTS.welcome_deposit_modal
    ),
    recruitment_modal: sanitizeWhatsappDigits(
      source.recruitment_modal,
      supportDefault || DEFAULT_WHATSAPP_MODAL_CONTACTS.recruitment_modal
    ),
    championnat_mopyon: sanitizeWhatsappDigits(
      source.championnat_mopyon,
      supportDefault || DEFAULT_WHATSAPP_MODAL_CONTACTS.championnat_mopyon
    ),
  };
}

async function readWhatsappModalSettings() {
  const snap = await db.collection("settings").doc(WHATSAPP_MODAL_SETTINGS_DOC).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const contacts = normalizeWhatsappModalContacts({
    ...DEFAULT_WHATSAPP_MODAL_CONTACTS,
    ...(data.contacts && typeof data.contacts === "object" ? data.contacts : {}),
  });
  return {
    contacts,
    version: String(data.version || "wmc-v1"),
    updatedAtMs: safeSignedInt(data.updatedAtMs),
  };
}

function normalizeHeroName(value = "", fallback = "") {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .slice(0, 180)
    || String(fallback || "").trim();
}

function normalizeHomeHeroSlides(rawSlides = []) {
  const source = Array.isArray(rawSlides) && rawSlides.length ? rawSlides : DEFAULT_HOME_HERO_SLIDES;
  const out = [];
  const seen = new Set();

  source.forEach((raw, index) => {
    const rawName = typeof raw === "string"
      ? raw
      : raw?.name || raw?.src || raw?.file || raw?.image || "";
    const name = normalizeHeroName(rawName, "");
    if (!name) return;

    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const sortOrderRaw = Number(raw?.sortOrder);
    const sortOrder = Number.isFinite(sortOrderRaw) ? Math.trunc(sortOrderRaw) : ((index + 1) * 10);
    out.push({
      name,
      enabled: raw?.enabled === undefined ? true : raw?.enabled === true,
      sortOrder,
      title: sanitizeText(raw?.title || "", 120),
      subtitle: sanitizeText(raw?.subtitle || raw?.caption || "", 180),
    });
  });

  return out.sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return String(left.name || "").localeCompare(String(right.name || ""), "fr");
  });
}

async function readHomeHeroSettings() {
  const snap = await db.collection("settings").doc(HOME_HERO_SETTINGS_DOC).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  return {
    slides: normalizeHomeHeroSlides(data.slides || data.images || data.items || DEFAULT_HOME_HERO_SLIDES),
    version: String(data.version || "hhs-v1"),
    updatedAtMs: safeSignedInt(data.updatedAtMs),
  };
}

async function getPublicRuntimeConfigPayload() {
  const settings = await readPublicAppSettings();
  const pushConfig = getDashboardWebPushConfig();
  return {
    ok: true,
    appCheckSiteKey: String(settings.appCheckSiteKey || ""),
    appCheckConfigured: !!String(settings.appCheckSiteKey || "").trim(),
    dashboardWebPushPublicKey: String(pushConfig.publicKey || ""),
    dashboardWebPushEnabled: !!String(pushConfig.publicKey || "").trim(),
    provisionalDepositsEnabled: settings.provisionalDepositsEnabled === true,
    pongEnabled: settings.pongEnabled !== false,
    dominoClassicEnabled: settings.dominoClassicEnabled !== false,
    dominoDuelPublicEnabled: settings.dominoDuelPublicEnabled !== false,
    ludoEnabled: settings.ludoEnabled !== false,
  };
}

async function getPublicGameStakeOptionsPayload() {
  const settings = await readPublicAppSettings();
  return {
    ok: true,
    options: (Array.isArray(settings.gameStakeOptions) ? settings.gameStakeOptions : []).map((item) => ({
      id: sanitizeText(item?.id || "", 80),
      stakeDoes: Number(item?.stakeDoes) > 0 ? Math.trunc(Number(item.stakeDoes)) : 0,
      rewardDoes: Number(item?.rewardDoes) > 0 ? Math.trunc(Number(item.rewardDoes)) : 0,
      enabled: item?.enabled === true,
      sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Math.trunc(Number(item.sortOrder)) : 0,
    })),
  };
}

async function getPublicWhatsappModalConfigPayload() {
  const snapshot = await readWhatsappModalSettings();
  return {
    ok: true,
    contacts: snapshot.contacts,
    version: snapshot.version,
    updatedAtMs: snapshot.updatedAtMs || 0,
  };
}

async function getPublicHomeHeroConfigPayload() {
  const snapshot = await readHomeHeroSettings();
  return {
    ok: true,
    slides: snapshot.slides,
    version: snapshot.version,
    updatedAtMs: snapshot.updatedAtMs || 0,
  };
}

module.exports = {
  DEFAULT_HOME_HERO_SLIDES,
  DEFAULT_WHATSAPP_MODAL_CONTACTS,
  HOME_HERO_SETTINGS_DOC,
  WHATSAPP_MODAL_SETTINGS_DOC,
  getPublicGameStakeOptionsPayload,
  getPublicHomeHeroConfigPayload,
  getPublicRuntimeConfigPayload,
  getPublicWhatsappModalConfigPayload,
  normalizeHomeHeroSlides,
  normalizeWhatsappModalContacts,
  readHomeHeroSettings,
  readPublicAppSettings,
  readWhatsappModalSettings,
  sanitizeWhatsappDigits,
};
