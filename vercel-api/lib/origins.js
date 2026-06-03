function splitOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllowedOrigins() {
  const defaults = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "null",
  ];

  const siteOrigins = splitOrigins(process.env.CORS_ALLOWED_ORIGINS);
  const dashboardOrigins = splitOrigins(process.env.DASHBOARD_ALLOWED_ORIGINS);
  return new Set([...defaults, ...siteOrigins, ...dashboardOrigins]);
}

function resolveAllowedOrigin(origin = "") {
  const normalized = String(origin || "").trim();
  if (!normalized) return "*";

  const allowed = getAllowedOrigins();
  if (allowed.has(normalized)) return normalized;
  return "*";
}

module.exports = {
  getAllowedOrigins,
  resolveAllowedOrigin,
};
