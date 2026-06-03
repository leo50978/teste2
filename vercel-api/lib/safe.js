function safeInt(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  const f = Number(fallback);
  return Number.isFinite(f) ? Math.max(0, Math.floor(f)) : 0;
}

function safeSignedInt(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) {
    return Math.trunc(n);
  }
  const f = Number(fallback);
  return Number.isFinite(f) ? Math.trunc(f) : 0;
}

function clamp(value, min, max) {
  const n = Number(value);
  const safeValue = Number.isFinite(n) ? n : 0;
  return Math.min(Math.max(safeValue, min), max);
}

function sanitizeText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, Math.max(0, maxLength));
}

const OBVIOUS_FAKE_HAITI_PHONE_LOCALS = new Set([
  "01234567",
  "12345678",
  "23456789",
  "76543210",
  "87654321",
  "98765432",
]);

function phoneDigits(value = "", maxLength = 40) {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, Math.max(0, maxLength));
}

function sanitizePhone(value, maxLength = 40) {
  return String(value || "")
    .replace(/[^\d+\-\s().]/g, "")
    .trim()
    .slice(0, Math.max(0, maxLength));
}

function normalizeHaitiMobilePhone(value = "", maxLength = 40) {
  const digits = phoneDigits(value, maxLength);
  if (!digits) return "";

  let local = "";
  if (digits.length === 11 && digits.startsWith("509")) {
    local = digits.slice(3);
  } else if (digits.length === 8) {
    local = digits;
  } else {
    return "";
  }

  if (!/^[34]\d{7}$/.test(local)) return "";
  if (/^(\d)\1{7}$/.test(local)) return "";
  if (OBVIOUS_FAKE_HAITI_PHONE_LOCALS.has(local)) return "";

  return `509${local}`;
}

function isValidHaitiMobilePhone(value = "", maxLength = 40) {
  return !!normalizeHaitiMobilePhone(value, maxLength);
}

function sanitizePaymentMethodAsset(value, maxLength = 180) {
  const out = sanitizeText(value, maxLength);
  if (!out) return "";

  const baseValue = out.replace(/\\/g, "/").split(/[?#]/)[0];
  const fileName = baseValue.split("/").pop() || "";
  if (!/^[a-zA-Z0-9._-]+\.(png|jpe?g|gif|webp|svg)$/i.test(fileName)) {
    return "";
  }
  return fileName;
}

module.exports = {
  clamp,
  isValidHaitiMobilePhone,
  normalizeHaitiMobilePhone,
  phoneDigits,
  safeInt,
  safeSignedInt,
  sanitizePhone,
  sanitizePaymentMethodAsset,
  sanitizeText,
};
