import { db, doc, getDoc } from "./firebase-init.js";

const HOME_HERO_CONFIG_CACHE_KEY = "kobposhv2_home_hero_config_v1";
const HOME_HERO_CONFIG_VERSION = "hhs-v2";

const DEFAULT_HOME_HERO_SLIDES = Object.freeze([
  Object.freeze({ name: "hero.jpg", enabled: true, sortOrder: 10 }),
  Object.freeze({ name: "hero1.jpg", enabled: true, sortOrder: 20 }),
  Object.freeze({ name: "hero2.jpg", enabled: true, sortOrder: 30 }),
]);

let heroCache = DEFAULT_HOME_HERO_SLIDES.map((slide) => ({ ...slide }));
let heroVersion = HOME_HERO_CONFIG_VERSION;
let heroUpdatedAtMs = 0;
let loadPromise = null;

function normalizeHeroName(value = "", fallback = "") {
  const cleaned = String(value || "")
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+/, "");
  return String(cleaned || fallback || "").trim();
}

function normalizeSlides(rawSlides = []) {
  const source = Array.isArray(rawSlides) && rawSlides.length ? rawSlides : DEFAULT_HOME_HERO_SLIDES;
  const out = [];
  const usedNames = new Set();

  source.forEach((raw, index) => {
    const rawName = typeof raw === "string"
      ? raw
      : raw?.name || raw?.src || raw?.file || raw?.image || "";
    const name = normalizeHeroName(rawName, "");
    if (!name) return;

    const key = name.toLowerCase();
    if (usedNames.has(key)) return;
    usedNames.add(key);

    const sortOrderRaw = Number(raw?.sortOrder);
    const sortOrder = Number.isFinite(sortOrderRaw) ? Math.trunc(sortOrderRaw) : ((index + 1) * 10);
    const enabled = raw?.enabled === undefined ? true : raw?.enabled === true;

    out.push({ name, enabled, sortOrder });
  });

  out.sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.name.localeCompare(right.name);
  });

  return out;
}

function saveLocalCache() {
  try {
    window.localStorage.setItem(
      HOME_HERO_CONFIG_CACHE_KEY,
      JSON.stringify({
        version: heroVersion,
        updatedAtMs: heroUpdatedAtMs,
        slides: heroCache,
      })
    );
  } catch (_) {}
}

function hydrateFromLocalCache() {
  try {
    const raw = window.localStorage.getItem(HOME_HERO_CONFIG_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    heroCache = normalizeSlides(parsed?.slides || []);
    heroVersion = String(parsed?.version || HOME_HERO_CONFIG_VERSION);
    heroUpdatedAtMs = Number(parsed?.updatedAtMs) || 0;
  } catch (_) {}
}

export function buildHomeHeroImagePath(name = "") {
  const cleanName = normalizeHeroName(name, "");
  return cleanName ? `./assets/images/${cleanName}` : "";
}

export async function refreshHomeHeroSlides(force = false) {
  if (!force && loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const snap = await getDoc(doc(db, "settings", "home_hero_slides_v1"));
      const data = snap.exists() ? (snap.data() || {}) : {};
      heroCache = normalizeSlides(data.slides || data.images || data.items || []);
      heroVersion = String(data.version || HOME_HERO_CONFIG_VERSION);
      heroUpdatedAtMs = Number(data.updatedAtMs) || 0;
      saveLocalCache();
      return {
        slides: heroCache.map((slide) => ({ ...slide })),
        version: heroVersion,
        updatedAtMs: heroUpdatedAtMs,
      };
    } catch (_) {
      return {
        slides: heroCache.map((slide) => ({ ...slide })),
        version: heroVersion,
        updatedAtMs: heroUpdatedAtMs,
      };
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

hydrateFromLocalCache();

export { DEFAULT_HOME_HERO_SLIDES };
