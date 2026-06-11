const DEFAULT_LOCAL_API_BASE_URL = "http://localhost:3000";

function isLocalFrontendRuntime() {
  if (typeof window === "undefined") return false;
  const protocol = String(window.location?.protocol || "").trim().toLowerCase();
  const hostname = String(window.location?.hostname || "").trim().toLowerCase();
  return protocol === "file:"
    || hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1";
}

const siteRuntimeConfig = Object.freeze({
  apiBaseUrl: "https://vercel-api-iota-lime.vercel.app",
});

if (typeof window !== "undefined") {
  const localRuntimeDefaults = isLocalFrontendRuntime() && !String(siteRuntimeConfig.apiBaseUrl || "").trim()
    ? { apiBaseUrl: DEFAULT_LOCAL_API_BASE_URL }
    : {};
  const existing = window.__KOBPOSH_RUNTIME_CONFIG__ && typeof window.__KOBPOSH_RUNTIME_CONFIG__ === "object"
    ? window.__KOBPOSH_RUNTIME_CONFIG__
    : {};
  window.__KOBPOSH_RUNTIME_CONFIG__ = Object.freeze({
    ...siteRuntimeConfig,
    ...localRuntimeDefaults,
    ...existing,
  });
}

export {
  DEFAULT_LOCAL_API_BASE_URL,
  siteRuntimeConfig,
};
