const { safeInt, sanitizePaymentMethodAsset, sanitizePhone, sanitizeText } = require("./safe");

const APP_PUBLIC_SETTINGS_DOC = "public_app_settings";
const DEFAULT_STAKE_REWARD_MULTIPLIER = 3;
const DEFAULT_GAME_STAKE_OPTIONS = Object.freeze([
  Object.freeze({ stakeDoes: 100, enabled: true, sortOrder: 10 }),
  Object.freeze({ stakeDoes: 500, enabled: false, sortOrder: 20 }),
  Object.freeze({ stakeDoes: 1000, enabled: false, sortOrder: 30 }),
  Object.freeze({ stakeDoes: 5000, enabled: false, sortOrder: 40 }),
]);

function buildStakeRewardDoes(stakeDoes) {
  return safeInt(stakeDoes) * DEFAULT_STAKE_REWARD_MULTIPLIER;
}

function buildStakeOptionId(stakeDoes) {
  return `stake_${safeInt(stakeDoes)}`;
}

function normalizeGameStakeOptions(rawOptions) {
  const source = Array.isArray(rawOptions) && rawOptions.length ? rawOptions : DEFAULT_GAME_STAKE_OPTIONS;
  const byStake = new Map();

  source.forEach((raw, index) => {
    const stakeDoes = safeInt(raw?.stakeDoes);
    if (stakeDoes <= 0 || byStake.has(stakeDoes)) return;
    const sortOrderRaw = Number(raw?.sortOrder);
    const sortOrder = Number.isFinite(sortOrderRaw) ? Math.trunc(sortOrderRaw) : ((index + 1) * 10);
    byStake.set(stakeDoes, {
      id: buildStakeOptionId(stakeDoes),
      stakeDoes,
      rewardDoes: buildStakeRewardDoes(stakeDoes),
      enabled: raw?.enabled !== false,
      sortOrder,
    });
  });

  return Array.from(byStake.values()).sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.stakeDoes - right.stakeDoes;
  });
}

function findStakeConfigByAmount(stakeDoes, gameStakeOptions, requireEnabled = false) {
  const normalizedStake = safeInt(stakeDoes);
  if (normalizedStake <= 0) return null;
  const options = Array.isArray(gameStakeOptions) ? gameStakeOptions : normalizeGameStakeOptions();
  const found = options.find((item) => safeInt(item?.stakeDoes) === normalizedStake) || null;
  if (!found) return null;
  if (requireEnabled && found.enabled !== true) return null;
  return found;
}

function normalizePublicAppSettings(rawData = {}) {
  return {
    gameStakeOptions: normalizeGameStakeOptions(rawData.gameStakeOptions),
    appCheckSiteKey: sanitizeText(rawData.appCheckSiteKey || "", 256),
    provisionalDepositsEnabled: rawData.provisionalDepositsEnabled === true,
    pongEnabled: rawData.pongEnabled !== false,
    dominoClassicEnabled: rawData.dominoClassicEnabled !== false,
    dominoDuelPublicEnabled: rawData.dominoDuelPublicEnabled !== false,
    ludoEnabled: rawData.ludoEnabled !== false,
  };
}

function sanitizePublicMethod(docSnap) {
  const data = docSnap?.data && typeof docSnap.data === "function" ? (docSnap.data() || {}) : {};
  if (data.isActive !== true) return null;

  return {
    id: sanitizeText(docSnap.id || data.id || "", 80),
    label: sanitizeText(data.label || data.name || "", 120),
    type: sanitizeText(data.type || "", 60),
    image: sanitizePaymentMethodAsset(data.image || ""),
    qrCode: sanitizePaymentMethodAsset(data.qrCode || ""),
    accountName: sanitizeText(data.accountName || "", 120),
    phoneNumber: sanitizePhone(data.phoneNumber || ""),
    isActive: true,
    steps: Array.isArray(data.steps)
      ? data.steps.map((step) => sanitizeText(step || "", 160)).filter(Boolean).slice(0, 8)
      : [],
  };
}

module.exports = {
  APP_PUBLIC_SETTINGS_DOC,
  findStakeConfigByAmount,
  normalizePublicAppSettings,
  normalizeGameStakeOptions,
  sanitizePublicMethod,
};
