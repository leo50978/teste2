const SITE_VISIT_SESSION_KEY = "kobposhv2_site_visit_session_v1";
const SITE_VISIT_LAST_SENT_KEY = "kobposhv2_site_visit_last_sent_v1";
const SITE_VISIT_ENDPOINT = "/api/public/site-visit";

function getRuntimeBackendConfig() {
  if (typeof window === "undefined") return {};
  return window.__KOBPOSH_RUNTIME_CONFIG__ && typeof window.__KOBPOSH_RUNTIME_CONFIG__ === "object"
    ? window.__KOBPOSH_RUNTIME_CONFIG__
    : {};
}

function getConfiguredApiBaseUrl() {
  if (typeof window === "undefined") return "";
  const runtimeConfig = getRuntimeBackendConfig();
  const candidates = [
    window.localStorage?.getItem("kobposh_api_base_url"),
    window.__KOBPOSH_API_BASE_URL,
    runtimeConfig.apiBaseUrl,
  ];

  for (const raw of candidates) {
    const value = String(raw || "").trim();
    if (!value) continue;
    return value.replace(/\/+$/, "");
  }
  return "";
}

function buildRandomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `visit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateSessionId() {
  try {
    const existing = window.sessionStorage.getItem(SITE_VISIT_SESSION_KEY);
    if (existing) return existing;
    const next = buildRandomId();
    window.sessionStorage.setItem(SITE_VISIT_SESSION_KEY, next);
    return next;
  } catch (_) {
    return buildRandomId();
  }
}

function getCurrentPath() {
  const pathname = String(window.location?.pathname || "/").trim() || "/";
  const search = String(window.location?.search || "").trim();
  return `${pathname}${search}`;
}

function shouldSkipDuplicateSend(sessionId = "", path = "") {
  try {
    const marker = `${sessionId}::${path}`;
    if (window.sessionStorage.getItem(SITE_VISIT_LAST_SENT_KEY) === marker) {
      return true;
    }
    window.sessionStorage.setItem(SITE_VISIT_LAST_SENT_KEY, marker);
    return false;
  } catch (_) {
    return false;
  }
}

async function postSiteVisit() {
  if (typeof window === "undefined") return;
  const baseUrl = getConfiguredApiBaseUrl();
  if (!baseUrl) return;

  const sessionId = getOrCreateSessionId();
  const path = getCurrentPath();
  if (shouldSkipDuplicateSend(sessionId, path)) return;

  try {
    await fetch(`${baseUrl}${SITE_VISIT_ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        path,
        pathname: path,
        referrer: String(document.referrer || "").trim(),
      }),
      keepalive: true,
    });
  } catch (error) {
    console.warn("[KOBPOSH_V2] site visit tracking failed", error);
  }
}

function scheduleSiteVisitPost() {
  if (typeof window === "undefined") return;
  const kickoff = () => {
    window.setTimeout(() => {
      void postSiteVisit();
    }, 0);
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    kickoff();
    return;
  }

  window.addEventListener("DOMContentLoaded", kickoff, { once: true });
}

scheduleSiteVisitPost();
