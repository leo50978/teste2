const crypto = require("crypto");

const { db } = require("./firebase-admin");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");

const DPAYMENT_ADMIN_BOOTSTRAP_DOC = "dpayment_admin_bootstrap";
const DEFAULT_BOT_DIFFICULTY = "expert";
const PONG_ALLOWED_AI_PROFILES = new Set(["soft", "normal", "ultra"]);
const PONG_ALLOWED_STAKES = new Set([100, 500]);
const PONG_RECENT_OUTCOMES_LIMIT = 10;
const PONG_RECENT_MATCH_IDS_LIMIT = 20;
const PONG_ODDS_NUMERATOR = 19;
const PONG_ODDS_DENOMINATOR = 10;
const PONG_ACTIVE_WAGER_STALE_MS = 30 * 60 * 1000;
const PONG_DISCONNECT_FORFEIT_MS = 30 * 1000;
const BOT_DIFFICULTY_LEVELS = new Set(["amateur", "expert", "ultra", "userpro"]);
const BOT_PILOT_MODES = new Set(["manual", "auto"]);

function adminBootstrapRef() {
  return db.collection("settings").doc(DPAYMENT_ADMIN_BOOTSTRAP_DOC);
}

function normalizeBotDifficulty(value = "") {
  const level = sanitizeText(value || "", 20).toLowerCase();
  return BOT_DIFFICULTY_LEVELS.has(level) ? level : DEFAULT_BOT_DIFFICULTY;
}

function normalizeBotPilotMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return BOT_PILOT_MODES.has(normalized) ? normalized : "manual";
}

function mapBotDifficultyToPongAiProfile(level = "") {
  const normalized = normalizeBotDifficulty(level);
  if (normalized === "ultra" || normalized === "expert") return "ultra";
  return "soft";
}

async function getConfiguredPongBotDifficulty() {
  try {
    const snap = await adminBootstrapRef().get();
    if (!snap.exists) return DEFAULT_BOT_DIFFICULTY;
    const data = snap.data() || {};
    const mode = normalizeBotPilotMode(data.pongBotPilotMode || "manual");
    if (mode === "auto") {
      return normalizeBotDifficulty(
        data.autoPongBotDifficulty || data.pongBotDifficulty || data.autoBotDifficulty || data.botDifficulty
      );
    }
    return normalizeBotDifficulty(
      data.manualPongBotDifficulty || data.pongBotDifficulty || data.manualBotDifficulty || data.botDifficulty
    );
  } catch (_) {
    return DEFAULT_BOT_DIFFICULTY;
  }
}

async function getConfiguredPongAiProfile() {
  const difficulty = await getConfiguredPongBotDifficulty();
  return mapBotDifficultyToPongAiProfile(difficulty);
}

function buildPongSessionId(nowMs = Date.now()) {
  return `pongw_${Number(nowMs).toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function buildPongRewardDoes(stakeDoes = 0) {
  const safeStakeDoes = safeInt(stakeDoes);
  if (safeStakeDoes <= 0) return 0;
  return Math.floor((safeStakeDoes * PONG_ODDS_NUMERATOR) / PONG_ODDS_DENOMINATOR);
}

function readActivePongWagerStatus(currentWager = {}, nowMs = Date.now()) {
  const wagerStatus = String(currentWager.status || "").trim().toLowerCase();
  const sessionId = sanitizeText(currentWager.sessionId || "", 120);
  const lastEventAtMs = Math.max(
    safeSignedInt(currentWager.lastEventAtMs, 0),
    safeSignedInt(currentWager.startedAtMs, 0)
  );
  const expired = lastEventAtMs > 0
    ? (nowMs - lastEventAtMs) >= PONG_ACTIVE_WAGER_STALE_MS
    : false;

  return {
    wagerStatus,
    sessionId,
    lastEventAtMs,
    expired,
    isActive: wagerStatus === "active",
  };
}

module.exports = {
  PONG_ALLOWED_AI_PROFILES,
  PONG_ALLOWED_STAKES,
  PONG_RECENT_OUTCOMES_LIMIT,
  PONG_RECENT_MATCH_IDS_LIMIT,
  PONG_ODDS_NUMERATOR,
  PONG_ODDS_DENOMINATOR,
  PONG_ACTIVE_WAGER_STALE_MS,
  PONG_DISCONNECT_FORFEIT_MS,
  buildPongRewardDoes,
  buildPongSessionId,
  getConfiguredPongAiProfile,
  readActivePongWagerStatus,
};
