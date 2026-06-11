const canvas = document.getElementById("pong");
const ctx = canvas.getContext("2d");
const leftScoreEl = document.getElementById("leftScore");
const rightScoreEl = document.getElementById("rightScore");
const rightPlayerLabelEl = document.getElementById("rightPlayerLabel");
const matchStatusEl = document.getElementById("matchStatus");
const replayBtn = document.getElementById("replayBtn");
const endModal = document.getElementById("endModal");
const endModalEyebrowEl = document.getElementById("endModalEyebrow");
const endModalTitleEl = document.getElementById("endModalTitle");
const endModalScoreEl = document.getElementById("endModalScore");
const endModalCopyEl = document.getElementById("endModalCopy");
const endReplayBtn = document.getElementById("endReplayBtn");
const endHomeBtn = document.getElementById("endHomeBtn");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const PADDLE_WIDTH = 15;
const PADDLE_HEIGHT = 100;
const PADDLE_MARGIN = 20;
const PADDLE_SPEED = 5;

const BALL_SIZE = 16;
const BALL_START_SPEED = 8;
const BALL_ACCEL_PER_SECOND = 1.2;

const WIN_SCORE = 3;
const ROUND_COUNTDOWN_MS = 3000;
const MATCH_RESULT_DELAY_MS = 1200;
const SOFT_RANDOM_MOVE_DELAY_MS = 30 * 1000;
const OPPONENT_NAMES = Object.freeze([
  "Jerome",
  "Pierre",
  "Donal",
  "Mickael",
  "Kevin",
  "Stevenson",
  "James",
  "David",
  "Jonas",
  "Samuel",
  "Frantz",
  "Jean",
  "Rony",
  "Ralph",
  "Nixon",
  "Wilson",
  "Patrick",
  "Christo",
  "Dimitri",
  "Esteban",
  "Enzo",
  "Alex",
  "Nicolas",
  "Thomas",
  "Brandon",
  "Jordan",
  "Sebastien",
  "Claude",
  "Luckner",
  "Reginald",
  "Marlon",
  "Evans",
  "Cyril",
  "Didier",
  "Kervens",
  "Ricardo",
  "Christopher",
  "Evens",
  "Robenson",
  "Yvens",
  "Carlo",
  "Rodolphe",
  "Brice",
  "Gary",
  "Henry",
  "Ludovic",
  "Maxime",
  "Francois",
  "Benson",
  "Teddy",
]);

const leftPaddle = {
  x: PADDLE_MARGIN,
  y: HEIGHT / 2 - PADDLE_HEIGHT / 2,
  width: PADDLE_WIDTH,
  height: PADDLE_HEIGHT,
};

const rightPaddle = {
  x: WIDTH - PADDLE_MARGIN - PADDLE_WIDTH,
  y: HEIGHT / 2 - PADDLE_HEIGHT / 2,
  width: PADDLE_WIDTH,
  height: PADDLE_HEIGHT,
};

const ball = {
  x: WIDTH / 2 - BALL_SIZE / 2,
  y: HEIGHT / 2 - BALL_SIZE / 2,
  size: BALL_SIZE,
  speedX: BALL_START_SPEED,
  speedY: BALL_START_SPEED * (Math.random() * 2 - 1),
};

const AI_PROFILES = Object.freeze({
  soft: Object.freeze({
    key: "soft",
    label: "Mòd dous",
    maxSpeed: 9.5,
    reactionFrames: 1,
    deadZone: 14,
    noiseAmplitude: 18,
    hesitationChance: 0.08,
    throwChance: 0.26,
    throwDurationFrames: 30,
    throwOffset: 260,
    randomMoveChance: 0.22,
    randomMoveDurationFrames: 20,
    randomMoveAmplitude: 230,
  }),
  normal: Object.freeze({
    key: "normal",
    label: "Mòd nòmal",
    maxSpeed: 5.4,
    reactionFrames: 1,
    deadZone: 10,
    noiseAmplitude: 7,
    hesitationChance: 0.03,
    throwChance: 0.14,
    throwDurationFrames: 20,
    throwOffset: 190,
  }),
  ultra: Object.freeze({
    key: "ultra",
    label: "Mòd rapid",
    maxSpeed: 42,
    reactionFrames: 0,
    deadZone: 1,
    noiseAmplitude: 0,
    hesitationChance: 0,
    throwChance: 0,
    throwDurationFrames: 0,
    throwOffset: 0,
    trackIntercept: true,
  }),
});

function parseAiProfile() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = String(params.get("aiProfile") || "normal").trim().toLowerCase();
    return AI_PROFILES[raw] || AI_PROFILES.normal;
  } catch (_) {
    return AI_PROFILES.normal;
  }
}

function parseFriendMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("friendMode") === "1";
  } catch (_) {
    return false;
  }
}

function parseOpponentName() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = String(params.get("opponentName") || "").trim();
    return raw.slice(0, 40);
  } catch (_) {
    return "";
  }
}

let aiProfile = parseAiProfile();
const friendMode = parseFriendMode();
const matchId = `pong_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
function buildOpponentHandle() {
  const baseName = (OPPONENT_NAMES[Math.floor(Math.random() * OPPONENT_NAMES.length)] || "Advèsè").toLowerCase();
  const suffix = Math.floor(Math.random() * 90) + 10; // 10..99
  return `${baseName}${suffix}`;
}

const opponentName = parseOpponentName() || buildOpponentHandle();

let leftScore = 0;
let rightScore = 0;
let roundCountdownMs = ROUND_COUNTDOWN_MS;
let roundRunning = false;
let matchOver = false;
let matchOverDelayMs = MATCH_RESULT_DELAY_MS;
let lastFrameTs = performance.now();

let aiReactionTick = 0;
let aiNoiseTick = 0;
let aiAimOffset = 0;
let aiThrowFrames = 0;
let aiThrowDirection = 1;
let aiRandomFrames = 0;
let aiRandomTargetY = HEIGHT / 2;
let postedResult = false;
let roundPlayElapsedMs = 0;
let endActionsEnabled = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function reflectIntoRange(value, min, max) {
  const span = max - min;
  if (!(span > 0)) {
    return min;
  }
  const period = span * 2;
  let normalized = value - min;
  normalized = ((normalized % period) + period) % period;
  if (normalized > span) {
    normalized = period - normalized;
  }
  return min + normalized;
}

function predictBallCenterYAtAiPaddle() {
  const minCenterY = ball.size / 2;
  const maxCenterY = HEIGHT - (ball.size / 2);
  const ballCenterY = ball.y + ball.size / 2;
  if (!(ball.speedX > 0)) {
    return clamp(ballCenterY, minCenterY, maxCenterY);
  }
  const aiCollisionX = rightPaddle.x - ball.size;
  const distanceX = Math.max(0, aiCollisionX - ball.x);
  const framesUntilCollision = distanceX / Math.max(0.001, ball.speedX);
  const projectedCenterY = ballCenterY + (ball.speedY * framesUntilCollision);
  return reflectIntoRange(projectedCenterY, minCenterY, maxCenterY);
}

function getEffectiveAiProfile() {
  if (aiProfile?.key !== "soft" || roundPlayElapsedMs >= SOFT_RANDOM_MOVE_DELAY_MS) {
    return aiProfile;
  }
  return {
    ...aiProfile,
    throwChance: 0,
    randomMoveChance: 0,
    randomMoveDurationFrames: 0,
    randomMoveAmplitude: 0,
  };
}

function updateMatchStatus(text) {
  if (!matchStatusEl) return;
  matchStatusEl.textContent = text;
}

function renderOpponentLabel() {
  if (!rightPlayerLabelEl) return;
  rightPlayerLabelEl.textContent = opponentName;
}

function renderScore() {
  if (leftScoreEl) leftScoreEl.textContent = String(leftScore);
  if (rightScoreEl) rightScoreEl.textContent = String(rightScore);
}

function setEndModalOpen(open) {
  if (!endModal) return;
  endModal.classList.toggle("active", !!open);
  endModal.setAttribute("aria-hidden", open ? "false" : "true");
}

function setEndActionsEnabled(enabled) {
  endActionsEnabled = !!enabled;
  if (endReplayBtn) endReplayBtn.disabled = !enabled;
  if (endHomeBtn) endHomeBtn.disabled = !enabled;
  if (endModalCopyEl && enabled) {
    endModalCopyEl.textContent = "Koulye a ou ka rejwe menm kote a oswa retounen sou paj dakey la.";
  }
}

function renderEndModal() {
  const userWon = leftScore > rightScore;
  if (endModalEyebrowEl) {
    endModalEyebrowEl.textContent = userWon ? "Ou genyen" : "Pati fini";
  }
  if (endModalTitleEl) {
    endModalTitleEl.textContent = userWon ? "Bravo, ou genyen match la!" : "Match la fini.";
  }
  if (endModalScoreEl) {
    endModalScoreEl.textContent = `${leftScore} - ${rightScore}`;
  }
  if (endModalCopyEl) {
    endModalCopyEl.textContent = userWon
      ? "N ap anrejistre viktwa ou a. Tann yon ti moman pou ou ka chwazi sa pou fe apre."
      : "N ap anrejistre rezilta match la. Tann yon ti moman pou ou ka kontinye.";
  }
}

function resetBall(towardPlayer = null) {
  ball.x = WIDTH / 2 - BALL_SIZE / 2;
  ball.y = HEIGHT / 2 - BALL_SIZE / 2;
  const randomY = BALL_START_SPEED * (Math.random() * 2 - 1);
  ball.speedY = Math.abs(randomY) < 1 ? (Math.random() < 0.5 ? -2 : 2) : randomY;

  if (towardPlayer === "left") {
    ball.speedX = -BALL_START_SPEED;
  } else if (towardPlayer === "right") {
    ball.speedX = BALL_START_SPEED;
  } else {
    ball.speedX = BALL_START_SPEED * (Math.random() < 0.5 ? 1 : -1);
  }
}

function accelerateBall(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  const currentSpeed = Math.hypot(ball.speedX, ball.speedY);
  if (currentSpeed <= 0) return;
  const deltaSeconds = deltaMs / 1000;
  const targetSpeed = currentSpeed + (BALL_ACCEL_PER_SECOND * deltaSeconds);
  const ratio = targetSpeed / currentSpeed;
  ball.speedX *= ratio;
  ball.speedY *= ratio;
}

function startRoundCountdown() {
  roundRunning = false;
  roundCountdownMs = ROUND_COUNTDOWN_MS;
  aiReactionTick = 0;
  aiNoiseTick = 0;
  aiAimOffset = 0;
  aiThrowFrames = 0;
  aiRandomFrames = 0;
  roundPlayElapsedMs = 0;
}

function startRoundNow() {
  roundRunning = true;
  updateMatchStatus(friendMode ? "Chanm zanmi · pati a ap mache" : "Pati a ap mache");
}

function moveAiPaddle() {
  const softRoundUnlocked = !(aiProfile?.key === "soft") || roundPlayElapsedMs >= SOFT_RANDOM_MOVE_DELAY_MS;
  const effectiveProfile = getEffectiveAiProfile();

  aiReactionTick += 1;
  aiNoiseTick += 1;

  if (aiReactionTick < effectiveProfile.reactionFrames) {
    return;
  }
  aiReactionTick = 0;

  if (aiNoiseTick >= 18) {
    aiNoiseTick = 0;
    aiAimOffset = (Math.random() * 2 - 1) * effectiveProfile.noiseAmplitude;
  }

  if (Math.random() < effectiveProfile.hesitationChance) {
    return;
  }

  const centerY = rightPaddle.y + rightPaddle.height / 2;
  const ballCenterY = ball.y + ball.size / 2;
  const ballComingToAi = ball.speedX > 0;
  const ballNearAiSide = ball.x > WIDTH * 0.58;

  if (
    aiThrowFrames <= 0
    && ballComingToAi
    && ballNearAiSide
    && Math.random() < effectiveProfile.throwChance
  ) {
    aiThrowFrames = Math.max(0, effectiveProfile.throwDurationFrames);
    aiThrowDirection = Math.random() < 0.5 ? -1 : 1;
  }

  const randomMoveChance = Number(effectiveProfile.randomMoveChance || 0);
  const randomMoveUnlocked = softRoundUnlocked;
  if (
    aiRandomFrames <= 0
    && aiThrowFrames <= 0
    && randomMoveUnlocked
    && randomMoveChance > 0
    && Math.random() < randomMoveChance
  ) {
    aiRandomFrames = Math.max(0, Number(effectiveProfile.randomMoveDurationFrames || 0));
    const center = HEIGHT / 2;
    const amplitude = Math.max(0, Number(effectiveProfile.randomMoveAmplitude || 0));
    aiRandomTargetY = clamp(center + ((Math.random() * 2 - 1) * amplitude), 0, HEIGHT);
  }

  let targetY = (effectiveProfile.trackIntercept && ballComingToAi)
    ? predictBallCenterYAtAiPaddle()
    : ballCenterY;
  targetY += aiAimOffset;
  if (aiRandomFrames > 0) {
    aiRandomFrames -= 1;
    targetY = aiRandomTargetY;
  }
  if (aiThrowFrames > 0) {
    aiThrowFrames -= 1;
    targetY = ballCenterY + (aiThrowDirection * effectiveProfile.throwOffset);
  }
  const diff = targetY - centerY;

  if (Math.abs(diff) <= effectiveProfile.deadZone) {
    return;
  }

  const step = Math.sign(diff) * Math.min(Math.abs(diff), effectiveProfile.maxSpeed);
  rightPaddle.y += step;
  rightPaddle.y = clamp(rightPaddle.y, 0, HEIGHT - rightPaddle.height);
}

function endMatch() {
  matchOver = true;
  roundRunning = false;
  matchOverDelayMs = MATCH_RESULT_DELAY_MS;
  const winner = leftScore > rightScore ? "user" : "ai";
  updateMatchStatus(
    winner === "user"
      ? `Viktwa ${leftScore}-${rightScore} !`
      : `Defèt ${leftScore}-${rightScore}.`
  );
  renderEndModal();
  setEndActionsEnabled(false);
  setEndModalOpen(true);
}

function postMatchResult() {
  if (postedResult) return;
  postedResult = true;
  const payload = {
    type: "pong:matchResult",
    payload: {
      matchId,
      aiProfile: aiProfile.key,
      winner: leftScore > rightScore ? "user" : "ai",
      leftScore,
      rightScore,
      winScore: WIN_SCORE,
      endedAt: Date.now(),
    },
  };
  window.parent?.postMessage(payload, window.location.origin);
  setEndActionsEnabled(true);
}

function scorePoint(side) {
  if (side === "left") {
    leftScore += 1;
    resetBall("right");
  } else {
    rightScore += 1;
    resetBall("left");
  }
  renderScore();

  if (leftScore >= WIN_SCORE || rightScore >= WIN_SCORE) {
    endMatch();
    return;
  }
  updateMatchStatus(`Wonn fini (${leftScore}-${rightScore}). Nouvo won...`);
  startRoundCountdown();
}

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#f3fbf5");
  gradient.addColorStop(1, "#e5f6ea");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(31, 143, 76, 0.24)";
  for (let i = 0; i < HEIGHT; i += 30) {
    ctx.fillRect(WIDTH / 2 - 2, i, 4, 20);
  }

  ctx.fillStyle = "#1f8f4c";
  ctx.fillRect(leftPaddle.x, leftPaddle.y, leftPaddle.width, leftPaddle.height);

  ctx.fillStyle = "#0f5f34";
  ctx.fillRect(rightPaddle.x, rightPaddle.y, rightPaddle.width, rightPaddle.height);

  ctx.beginPath();
  ctx.arc(ball.x + ball.size / 2, ball.y + ball.size / 2, ball.size / 2, 0, Math.PI * 2, false);
  ctx.fillStyle = "#000000";
  ctx.fill();

  if (!roundRunning && !matchOver) {
    const seconds = Math.max(1, Math.ceil(roundCountdownMs / 1000));
    ctx.fillStyle = "rgba(16, 49, 31, 0.38)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 34px Poppins, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(seconds), WIDTH / 2, HEIGHT / 2);
  }

  if (matchOver) {
    ctx.fillStyle = "rgba(16, 49, 31, 0.42)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 30px Poppins, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(leftScore > rightScore ? "VIKTWA" : "DEFÈT", WIDTH / 2, HEIGHT / 2 - 16);
    ctx.font = "600 20px Poppins, sans-serif";
    ctx.fillText(`${leftScore} - ${rightScore}`, WIDTH / 2, HEIGHT / 2 + 20);
  }
}

function update(deltaMs) {
  if (matchOver) {
    matchOverDelayMs -= deltaMs;
    if (matchOverDelayMs <= 0) {
      postMatchResult();
    }
    return;
  }

  if (!roundRunning) {
    roundCountdownMs -= deltaMs;
    updateMatchStatus(
      `Kòmanse nan ${Math.max(1, Math.ceil(roundCountdownMs / 1000))}s`
    );
    if (roundCountdownMs <= 0) {
      startRoundNow();
    }
    return;
  }

  roundPlayElapsedMs += Math.max(0, deltaMs);

  ball.x += ball.speedX;
  ball.y += ball.speedY;
  accelerateBall(deltaMs);

  if (ball.y <= 0) {
    ball.y = 0;
    ball.speedY *= -1;
  }
  if (ball.y + ball.size >= HEIGHT) {
    ball.y = HEIGHT - ball.size;
    ball.speedY *= -1;
  }

  if (
    ball.x <= leftPaddle.x + leftPaddle.width &&
    ball.y + ball.size >= leftPaddle.y &&
    ball.y <= leftPaddle.y + leftPaddle.height
  ) {
    const speed = Math.hypot(ball.speedX, ball.speedY);
    ball.x = leftPaddle.x + leftPaddle.width;
    let collidePoint = (ball.y + ball.size / 2) - (leftPaddle.y + leftPaddle.height / 2);
    collidePoint = collidePoint / (leftPaddle.height / 2);
    const angle = collidePoint * Math.PI / 4;
    ball.speedX = Math.abs(speed * Math.cos(angle));
    ball.speedY = speed * Math.sin(angle);
  }

  if (
    ball.x + ball.size >= rightPaddle.x &&
    ball.y + ball.size >= rightPaddle.y &&
    ball.y <= rightPaddle.y + rightPaddle.height
  ) {
    const speed = Math.hypot(ball.speedX, ball.speedY);
    ball.x = rightPaddle.x - ball.size;
    let collidePoint = (ball.y + ball.size / 2) - (rightPaddle.y + rightPaddle.height / 2);
    collidePoint = collidePoint / (rightPaddle.height / 2);
    const angle = collidePoint * Math.PI / 4;
    ball.speedX = -Math.abs(speed * Math.cos(angle));
    ball.speedY = speed * Math.sin(angle);
  }

  if (ball.x < 0) {
    scorePoint("right");
    return;
  }
  if (ball.x > WIDTH) {
    scorePoint("left");
    return;
  }

  moveAiPaddle();
}

function updatePlayerPaddleFromClientY(clientY) {
  const rect = canvas.getBoundingClientRect();
  const localY = clientY - rect.top;
  const scaledY = (localY / Math.max(1, rect.height)) * HEIGHT;
  leftPaddle.y = clamp(scaledY - leftPaddle.height / 2, 0, HEIGHT - leftPaddle.height);
}

canvas.addEventListener("pointerdown", (event) => {
  updatePlayerPaddleFromClientY(event.clientY);
});

canvas.addEventListener("pointermove", (event) => {
  updatePlayerPaddleFromClientY(event.clientY);
});

replayBtn?.addEventListener("click", () => {
  window.parent?.postMessage({ type: "pong:playAgain" }, window.location.origin);
});

endReplayBtn?.addEventListener("click", () => {
  if (!endActionsEnabled) return;
  window.parent?.postMessage({ type: "pong:playAgain" }, window.location.origin);
});

endHomeBtn?.addEventListener("click", () => {
  if (!endActionsEnabled) return;
  window.parent?.postMessage({ type: "pong:returnHome" }, window.location.origin);
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  const data = event?.data;
  if (!data || typeof data !== "object") return;
  if (data.type !== "pong:setAiProfile") return;
  const incoming = String(data.payload?.aiProfile || "").toLowerCase();
  const nextProfile = AI_PROFILES[incoming];
  if (!nextProfile || roundRunning || matchOver || leftScore !== 0 || rightScore !== 0) return;
  aiProfile = nextProfile;
  aiReactionTick = 0;
  aiNoiseTick = 0;
  aiAimOffset = 0;
  aiThrowFrames = 0;
  aiRandomFrames = 0;
  updateMatchStatus("Kòmanse nan 3s");
});

function gameLoop(ts) {
  const deltaMs = Math.max(0, ts - lastFrameTs);
  lastFrameTs = ts;
  update(deltaMs);
  draw();
  window.requestAnimationFrame(gameLoop);
}

renderScore();
resetBall();
startRoundCountdown();
renderOpponentLabel();
updateMatchStatus("Kòmanse nan 3s");
window.requestAnimationFrame(gameLoop);
