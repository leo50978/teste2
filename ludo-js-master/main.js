import { auth, onAuthStateChanged } from '../firebase-init.js?v=20260515-ludo-searchpage1';
import {
    getDepositFundingStatusSecure,
    recordLudoMatchResultSecure,
    startLudoWagerSecure,
    touchLudoWagerHeartbeatSecure,
} from '../secure-functions.js?v=20260515-ludo-searchpage1';
import { PLAYERS, STATE } from './ludo/constants.js?v=20260516-ludo-botbase1';
import { Ludo } from './ludo/Ludo.js?v=20260516-ludo-botbase1';
import { UI } from './ludo/UI.js?v=20260516-ludo-botbase1';

const TURN_DURATION_SECONDS = 30;
const LUDO_PUBLIC_STAKE_HTG = 25;
const LUDO_PUBLIC_STAKE_DOES = 500;
const DEFAULT_BOT_DIFFICULTY = 'weak';
const LUDO_PENDING_RESULTS_KEY = 'ludo_v2_pending_results';
const LUDO_ACTIVE_WAGER_KEY = 'ludo_v2_active_wager';
const LUDO_HEARTBEAT_INTERVAL_MS = 12000;
const LUDO_MAX_HEARTBEAT_FAILURES = 2;
const LUDO_MATCHMAKING_WAIT_MS = 15000;
const pageParams = new URLSearchParams(window.location.search);
const MONETIZED_MODE = pageParams.get('autostart') === '1';
const REQUESTED_STAKE_DOES = Math.max(0, Number.parseInt(pageParams.get('stakeDoes') || pageParams.get('stake') || String(LUDO_PUBLIC_STAKE_DOES), 10)) || LUDO_PUBLIC_STAKE_DOES;
const REQUESTED_STAKE_HTG = Math.max(0, Number.parseInt(pageParams.get('stakeHtg') || String(LUDO_PUBLIC_STAKE_HTG), 10)) || LUDO_PUBLIC_STAKE_HTG;
const REQUESTED_FUNDING_CURRENCY = 'htg';
const HOME_URL = '../index.html?view=public';

const BOT_USERNAMES = [
    'marc456', 'junior17', 'jen33', 'lucky509', 'samy88', 'dany22', 'kervens9', 'mika77',
    'teedy51', 'vensly8', 'jhon34', 'louis22', 'nicky44', 'sandro15', 'wilguens7', 'belony86',
    'tedson37', 'leov51', 'bobby29', 'roro11', 'malko93', 'fafa20', 'kendy64', 'pipo18',
    'frantz5', 'stevy90', 'nono42', 'mano73', 'rico31', 'djo48', 'kiki14', 'nash66',
    'peter39', 'jonas55', 'kato27', 'daren12', 'tiwil99', 'jojo61', 'momo24', 'kenzo52',
    'benson16', 'fredo87', 'rudy13', 'mendy45', 'charly58', 'soso19', 'matt75', 'nixon26',
    'ralph63', 'slevy10', 'cisco84', 'drix28', 'yonyon4', 'maksim6', 'benji72', 'frido35',
    'ricky49', 'jules60', 'manno23', 'yves41', 'paska68', 'toto95', 'harold32', 'venson53',
    'roody21', 'kendy91', 'mikael30', 'rony57', 'sherly12', 'bryan69', 'dodo38', 'carlito47',
    'mervil25', 'teddy83', 'nashly54', 'stenio70', 'bobo36', 'renel62', 'sagesse18', 'milo74',
    'yanick43', 'cristal8', 'tibob59', 'nixon71', 'cory50', 'vany65', 'samson27', 'ruben94',
    'evens33', 'kenley56', 'marvens40', 'jery80', 'sylvio46', 'loulou15', 'mardoch1', 'djems67',
    'wilky29', 'nando82', 'kerv49', 'jude34',
];

const PLAYER_DISPLAY = {
    P1: { label: 'Ou', name: 'Ou' },
    P2: { label: 'Advese', name: 'marc456' },
};

const dom = {
    walletValue: document.getElementById('ludoWalletValue'),
    guideModal: document.getElementById('ludoGuideModal'),
    guideConfirmBtn: document.getElementById('ludoGuideConfirmBtn'),
    searchModal: document.getElementById('ludoSearchModal'),
    searchCountdown: document.getElementById('ludoSearchCountdown'),
    playerNames: {
        P1: document.getElementById('ludoPlayerNameP1'),
        P2: document.getElementById('ludoPlayerNameP2'),
    },
    playerLabels: {
        P1: document.getElementById('ludoPlayerLabelP1'),
        P2: document.getElementById('ludoPlayerLabelP2'),
    },
};

let activeTurnPlayer = 'P1';
let activeState = STATE.DICE_NOT_ROLLED;
let turnTimerHandle = 0;
let heartbeatTimerHandle = 0;
let heartbeatFailures = 0;
let ludo = null;
let currentBotUsername = BOT_USERNAMES[0];
let activeBotDifficulty = DEFAULT_BOT_DIFFICULTY;
let activeWager = null;
let bootstrapStarted = false;
let roundLaunchInFlight = false;
let roundSettlementInFlight = false;
let currentRoundSettled = false;
let pendingSettlementEntry = null;
let introGatePromise = null;
let recoveredForfeitOnBoot = false;
let matchmakingTimerHandle = 0;
let matchmakingIntervalHandle = 0;

function safeInt(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function sanitizeText(value, maxLength = 120) {
    return String(value || '').trim().slice(0, maxLength);
}

function formatHtg(value) {
    return `${safeInt(value)} HTG`;
}

function normalizeBotDifficulty(value = '') {
    const level = String(value || '').trim().toLowerCase();
    if (level === 'strong' || level === 'fort' || level === 'fo' || level === 'impossible') return 'strong';
    if (level === 'ultra' || level === 'expert' || level === 'dominov1') return 'strong';
    if (level === 'weak' || level === 'faible' || level === 'amateur' || level === 'userpro') return 'weak';
    return DEFAULT_BOT_DIFFICULTY;
}

function applyBotDifficulty(level = DEFAULT_BOT_DIFFICULTY) {
    activeBotDifficulty = normalizeBotDifficulty(level);
    ludo?.setBotDifficulty?.(activeBotDifficulty);
}

function ensureGuideAcknowledged() {
    if (introGatePromise) return introGatePromise;

    introGatePromise = new Promise((resolve) => {
        const modal = dom.guideModal;
        const confirmBtn = dom.guideConfirmBtn;
        if (!modal || !confirmBtn) {
            resolve();
            return;
        }

        const close = () => {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
            confirmBtn.removeEventListener('click', handleConfirm);
            resolve();
        };

        const handleConfirm = () => {
            close();
        };

        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        confirmBtn.addEventListener('click', handleConfirm, { once: true });
    });

    return introGatePromise;
}

function clearMatchmakingWait() {
    if (matchmakingIntervalHandle) {
        window.clearInterval(matchmakingIntervalHandle);
        matchmakingIntervalHandle = 0;
    }
    if (matchmakingTimerHandle) {
        window.clearTimeout(matchmakingTimerHandle);
        matchmakingTimerHandle = 0;
    }
}

function setMatchmakingCountdown(remainingSeconds = 15) {
    if (!dom.searchCountdown) return;
    dom.searchCountdown.textContent = `${Math.max(0, Number(remainingSeconds) || 0)}s`;
}

function hideMatchmakingModal() {
    clearMatchmakingWait();
    dom.searchModal?.classList.add('hidden');
    dom.searchModal?.setAttribute('aria-hidden', 'true');
}

function waitForMatchmakingGate() {
    if (!MONETIZED_MODE) return Promise.resolve();
    const modal = dom.searchModal;
    if (!modal) return Promise.resolve();

    hideMatchmakingModal();
    const startedAtMs = Date.now();
    setMatchmakingCountdown(Math.ceil(LUDO_MATCHMAKING_WAIT_MS / 1000));
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    return new Promise((resolve) => {
        matchmakingIntervalHandle = window.setInterval(() => {
            const elapsedMs = Date.now() - startedAtMs;
            const remainingMs = Math.max(0, LUDO_MATCHMAKING_WAIT_MS - elapsedMs);
            setMatchmakingCountdown(Math.ceil(remainingMs / 1000));
        }, 250);

        matchmakingTimerHandle = window.setTimeout(() => {
            hideMatchmakingModal();
            resolve();
        }, LUDO_MATCHMAKING_WAIT_MS);
    });
}

function readStorageJson(key, fallback) {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function writeStorageJson(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore local storage failures to keep the game flow usable.
    }
}

function removeStorageKey(key) {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // Ignore local storage failures to keep the game flow usable.
    }
}

function pickRandomBotUsername() {
    const index = Math.floor(Math.random() * BOT_USERNAMES.length);
    return BOT_USERNAMES[index] || 'marc456';
}

function assignRandomBotIdentity() {
    currentBotUsername = pickRandomBotUsername();
    PLAYER_DISPLAY.P2 = {
        label: 'Advese',
        name: currentBotUsername,
    };
}

function applyPlayerIdentity() {
    PLAYERS.forEach((player) => {
        if (dom.playerNames[player]) {
            dom.playerNames[player].textContent = PLAYER_DISPLAY[player]?.name || player;
        }
        if (dom.playerLabels[player]) {
            dom.playerLabels[player].textContent = PLAYER_DISPLAY[player]?.label || player;
        }
    });
}

async function refreshWalletValue() {
    if (!dom.walletValue) return;
    const uid = String(auth.currentUser?.uid || '').trim();
    if (!uid) {
        dom.walletValue.textContent = '-- HTG';
        return;
    }

    try {
        const snapshot = await getDepositFundingStatusSecure();
        const total = safeInt(
            snapshot?.playableHtg
            ?? (safeInt(snapshot?.approvedHtgAvailable) + safeInt(snapshot?.provisionalHtgAvailable)),
        );
        dom.walletValue.textContent = formatHtg(total);
    } catch (error) {
        console.warn('[LUDO_V2] wallet refresh failed', error);
        dom.walletValue.textContent = '-- HTG';
    }
}

function clearTurnTimer() {
    if (turnTimerHandle) {
        window.clearInterval(turnTimerHandle);
        turnTimerHandle = 0;
    }
}

function setTimerUi(player, remaining) {
    UI.renderTurnTimer(player, {
        remaining,
        total: TURN_DURATION_SECONDS,
        danger: remaining <= 5,
    });
}

function triggerTimeoutMove(player) {
    if (activeState === STATE.GAME_OVER) return;
    if (player !== activeTurnPlayer) return;

    const highlightedPiece = document.querySelector(`.player-piece[player-id="${player}"].highlight`);
    if (highlightedPiece) {
        highlightedPiece.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return;
    }

    const diceButton = document.getElementById('ludoDiceButtonP1');
    if (diceButton && !diceButton.disabled) {
        diceButton.click();
    }
}

async function handleTurnTimeout(player) {
    if (activeState === STATE.GAME_OVER) return;
    if (player !== activeTurnPlayer) return;

    clearTurnTimer();

    if (player !== 'P1') {
        triggerTimeoutMove(player);
        return;
    }

    freezeRoundLocally();

    if (MONETIZED_MODE) {
        await settleRound({
            winner: 'ai',
            reason: 'turn_timeout',
            matchId: `ludo_timeout_${activeWager?.sessionId || Date.now().toString(36)}`,
        });
        await refreshWalletValue();
    }

    UI.showResultModal({
        title: 'Ou pedi wonn nan',
        copy: '30 segonn yo fini anvan ou te jwe kou ou. Pati a konte tankou yon defet otomatik.',
        showReplay: true,
        replayLabel: 'Rejwe',
        homeLabel: 'Akey',
    });
}

function startTurnTimer(player) {
    activeTurnPlayer = player;
    clearTurnTimer();
    let remaining = TURN_DURATION_SECONDS;

    PLAYERS.forEach((playerId) => {
        UI.renderTurnTimer(playerId, {
            remaining: TURN_DURATION_SECONDS,
            total: TURN_DURATION_SECONDS,
            danger: false,
        });
    });

    setTimerUi(player, remaining);
    turnTimerHandle = window.setInterval(() => {
        remaining -= 1;
        setTimerUi(player, remaining);
        if (remaining > 0) return;

        clearTurnTimer();
        void handleTurnTimeout(player);
    }, 1000);
}

function handleStateEvent(event) {
    const detail = event?.detail || {};
    activeState = detail.state || STATE.DICE_NOT_ROLLED;
    activeTurnPlayer = detail.player || activeTurnPlayer;

    if (activeState === STATE.GAME_OVER) {
        clearTurnTimer();
        return;
    }

    if (activeState === STATE.DICE_NOT_ROLLED) {
        startTurnTimer(activeTurnPlayer);
    }
}

function readPendingResults() {
    const queue = readStorageJson(LUDO_PENDING_RESULTS_KEY, []);
    return Array.isArray(queue) ? queue : [];
}

function writePendingResults(entries) {
    if (!Array.isArray(entries) || !entries.length) {
        removeStorageKey(LUDO_PENDING_RESULTS_KEY);
        return;
    }
    writeStorageJson(LUDO_PENDING_RESULTS_KEY, entries);
}

function readStoredActiveWager() {
    const raw = readStorageJson(LUDO_ACTIVE_WAGER_KEY, null);
    if (!raw || typeof raw !== 'object') return null;
    const sessionId = sanitizeText(raw.sessionId, 120);
    if (!sessionId) return null;
    return {
        sessionId,
        stakeDoes: safeInt(raw.stakeDoes) || LUDO_PUBLIC_STAKE_DOES,
        stakeHtg: safeInt(raw.stakeHtg) || LUDO_PUBLIC_STAKE_HTG,
        fundingCurrency: sanitizeText(raw.fundingCurrency, 16) || 'htg',
        startedAtMs: safeInt(raw.startedAtMs) || Date.now(),
        botUsername: sanitizeText(raw.botUsername, 64) || currentBotUsername,
        botDifficulty: normalizeBotDifficulty(raw.botDifficulty || activeBotDifficulty),
    };
}

function persistActiveWager() {
    if (!activeWager) {
        removeStorageKey(LUDO_ACTIVE_WAGER_KEY);
        return;
    }
    writeStorageJson(LUDO_ACTIVE_WAGER_KEY, activeWager);
}

function setActiveWager(value) {
    activeWager = value && typeof value === 'object' ? { ...value } : null;
    if (activeWager?.botDifficulty) {
        applyBotDifficulty(activeWager.botDifficulty);
    }
    persistActiveWager();
}

function clearActiveWager() {
    activeWager = null;
    persistActiveWager();
}

function buildOutcomeEntry({
    sessionId = '',
    stakeDoes = LUDO_PUBLIC_STAKE_DOES,
    stakeHtg = LUDO_PUBLIC_STAKE_HTG,
    fundingCurrency = 'htg',
    startedAtMs = Date.now(),
    winner = 'ai',
    reason = 'match_end',
    botUsername = currentBotUsername,
    botDifficulty = activeBotDifficulty,
    matchId = '',
} = {}) {
    const safeSessionId = sanitizeText(sessionId, 120);
    return {
        matchId: sanitizeText(matchId || `ludo_${safeSessionId}_${Date.now().toString(36)}`, 120),
        sessionId: safeSessionId,
        stakeDoes: safeInt(stakeDoes) || LUDO_PUBLIC_STAKE_DOES,
        stakeHtg: safeInt(stakeHtg) || LUDO_PUBLIC_STAKE_HTG,
        fundingCurrency: 'htg',
        startedAtMs: safeInt(startedAtMs) || Date.now(),
        winner: sanitizeText(winner, 16) === 'user' ? 'user' : 'ai',
        reason: sanitizeText(reason, 80) || 'match_end',
        botUsername: sanitizeText(botUsername, 64) || currentBotUsername,
        botDifficulty: normalizeBotDifficulty(botDifficulty || activeBotDifficulty),
    };
}

function queuePendingResult(entry) {
    if (!entry?.sessionId) return;
    const queue = readPendingResults();
    const filtered = queue.filter((item) => sanitizeText(item?.sessionId, 120) !== entry.sessionId);
    filtered.push(entry);
    writePendingResults(filtered);
}

function queueCurrentRoundResult(reason = 'session_resume_forfeit', winner = 'ai') {
    if (roundSettlementInFlight && pendingSettlementEntry?.sessionId) {
        queuePendingResult(pendingSettlementEntry);
        clearActiveWager();
        return pendingSettlementEntry;
    }
    const source = activeWager || readStoredActiveWager();
    if (!source?.sessionId) return null;
    const entry = buildOutcomeEntry({
        sessionId: source.sessionId,
        stakeDoes: source.stakeDoes,
        stakeHtg: source.stakeHtg,
        fundingCurrency: source.fundingCurrency,
        startedAtMs: source.startedAtMs,
        winner,
        reason,
        botUsername: source.botUsername || currentBotUsername,
        botDifficulty: source.botDifficulty || activeBotDifficulty,
        matchId: `ludo_${reason}_${source.sessionId}`,
    });
    queuePendingResult(entry);
    clearActiveWager();
    return entry;
}

function recoverStoredActiveSession() {
    const stored = readStoredActiveWager();
    if (!stored?.sessionId) return false;
    const queue = readPendingResults();
    const alreadyQueued = queue.some((item) => sanitizeText(item?.sessionId, 120) === stored.sessionId);
    if (!alreadyQueued) {
        queuePendingResult(buildOutcomeEntry({
            sessionId: stored.sessionId,
            stakeDoes: stored.stakeDoes,
            stakeHtg: stored.stakeHtg,
            fundingCurrency: stored.fundingCurrency,
            startedAtMs: stored.startedAtMs,
            winner: 'ai',
            reason: 'session_resume_forfeit',
            botUsername: stored.botUsername || currentBotUsername,
            botDifficulty: stored.botDifficulty || activeBotDifficulty,
            matchId: `ludo_session_resume_${stored.sessionId}`,
        }));
    }
    clearActiveWager();
    return true;
}

function showReloadForfeitModal() {
    hideMatchmakingModal();
    freezeRoundLocally();
    currentRoundSettled = true;
    UI.showResultModal({
        title: 'Ou pedi',
        copy: 'Ou kite jwet la. Ou ka rejwe oswa tounen nan akey la.',
        showReplay: true,
        replayLabel: 'Rejwe',
        homeLabel: 'Akey',
    });
}

function stopHeartbeat() {
    if (!heartbeatTimerHandle) return;
    window.clearInterval(heartbeatTimerHandle);
    heartbeatTimerHandle = 0;
}

async function sendHeartbeat() {
    if (!MONETIZED_MODE || !activeWager?.sessionId || !auth.currentUser) return;
    try {
        const result = await touchLudoWagerHeartbeatSecure({
            sessionId: activeWager.sessionId,
        });
        if (result?.active === false) {
            stopHeartbeat();
            clearActiveWager();
            return;
        }
        heartbeatFailures = 0;
    } catch (error) {
        heartbeatFailures += 1;
        console.warn('[LUDO_V2] heartbeat failed', error);
        if (heartbeatFailures >= LUDO_MAX_HEARTBEAT_FAILURES) {
            await handleConnectivityForfeit('heartbeat_failed');
        }
    }
}

function startHeartbeat() {
    stopHeartbeat();
    heartbeatFailures = 0;
    heartbeatTimerHandle = window.setInterval(() => {
        void sendHeartbeat();
    }, LUDO_HEARTBEAT_INTERVAL_MS);
}

async function flushPendingResults() {
    if (!auth.currentUser) return;
    const queue = readPendingResults();
    if (!queue.length) return;

    const remaining = [];
    let changed = false;
    for (const item of queue) {
        try {
            await recordLudoMatchResultSecure({
                matchId: sanitizeText(item.matchId, 120),
                sessionId: sanitizeText(item.sessionId, 120),
                winner: sanitizeText(item.winner, 16) === 'user' ? 'user' : 'ai',
                reason: sanitizeText(item.reason, 80) || 'session_resume_forfeit',
                stakeDoes: safeInt(item.stakeDoes),
                fundingCurrency: 'htg',
                startedAtMs: safeInt(item.startedAtMs),
                botUsername: sanitizeText(item.botUsername, 64),
                botDifficulty: normalizeBotDifficulty(item.botDifficulty || activeBotDifficulty),
            });
            changed = true;
        } catch (error) {
            console.warn('[LUDO_V2] flush pending result failed', error);
            remaining.push(item);
        }
    }

    writePendingResults(remaining);
    if (changed) {
        await refreshWalletValue();
    }
}

function freezeRoundLocally() {
    clearTurnTimer();
    ludo?.clearBotAction?.();
    ludo?.setInteractionLocked?.(true);
    UI.unhighlightPieces();
    if (ludo) {
        ludo.state = STATE.GAME_OVER;
    } else {
        UI.disableDice();
    }
}

async function settleRound({ winner = 'ai', reason = 'match_end', matchId = '' } = {}) {
    if (!MONETIZED_MODE || !activeWager?.sessionId || roundSettlementInFlight || currentRoundSettled) {
        return false;
    }

    roundSettlementInFlight = true;
    stopHeartbeat();
    const entry = buildOutcomeEntry({
        sessionId: activeWager.sessionId,
        stakeDoes: activeWager.stakeDoes,
        stakeHtg: activeWager.stakeHtg,
        fundingCurrency: activeWager.fundingCurrency,
        startedAtMs: activeWager.startedAtMs,
        winner,
        reason,
        botUsername: activeWager.botUsername || currentBotUsername,
        botDifficulty: activeWager.botDifficulty || activeBotDifficulty,
        matchId: matchId || `ludo_${reason}_${activeWager.sessionId}`,
    });
    pendingSettlementEntry = entry;

    try {
        await recordLudoMatchResultSecure({
            matchId: entry.matchId,
            sessionId: entry.sessionId,
            winner: entry.winner,
            reason: entry.reason,
            stakeDoes: entry.stakeDoes,
            fundingCurrency: entry.fundingCurrency,
            startedAtMs: entry.startedAtMs,
            botUsername: entry.botUsername,
            botDifficulty: entry.botDifficulty,
        });
        currentRoundSettled = true;
        clearActiveWager();
        await refreshWalletValue();
        return true;
    } catch (error) {
        console.warn('[LUDO_V2] settle round failed', error);
        queuePendingResult(entry);
        currentRoundSettled = true;
        clearActiveWager();
        return false;
    } finally {
        pendingSettlementEntry = null;
        roundSettlementInFlight = false;
    }
}

async function handleConnectivityForfeit(reason = 'offline') {
    if (!MONETIZED_MODE || currentRoundSettled) return;
    hideMatchmakingModal();
    queueCurrentRoundResult(reason, 'ai');
    freezeRoundLocally();
    currentRoundSettled = true;
    stopHeartbeat();
    UI.showResultModal({
        title: 'Ou pedi wonn nan',
        copy: 'Pati a konsidere tankou abandon paske ou kite jwèt la oswa koneksyon an koupe.',
        showReplay: true,
        replayLabel: 'Rejwe',
        homeLabel: 'Akey',
    });
    await refreshWalletValue();
}

async function startMonetizedRound({ allowRecover = true } = {}) {
    if (!MONETIZED_MODE || roundLaunchInFlight || roundSettlementInFlight) return;
    if (!auth.currentUser) {
        window.location.href = HOME_URL;
        return;
    }

    roundLaunchInFlight = true;
    hideMatchmakingModal();
    stopHeartbeat();
    clearTurnTimer();
    ludo?.setInteractionLocked?.(true);
    UI.hideWinnerModal();
    currentRoundSettled = false;
    assignRandomBotIdentity();
    applyPlayerIdentity();

    try {
        await flushPendingResults();
        const result = await startLudoWagerSecure({
            stakeDoes: REQUESTED_STAKE_DOES,
            fundingCurrency: REQUESTED_FUNDING_CURRENCY,
            botUsername: currentBotUsername,
        });
        const roundBotDifficulty = normalizeBotDifficulty(result?.botDifficulty || pageParams.get('botDifficulty'));
        applyBotDifficulty(roundBotDifficulty);

        setActiveWager({
            sessionId: sanitizeText(result?.sessionId, 120),
            stakeDoes: safeInt(result?.stakeDoes) || REQUESTED_STAKE_DOES,
            stakeHtg: safeInt(result?.stakeHtg) || REQUESTED_STAKE_HTG,
            fundingCurrency: sanitizeText(result?.fundingCurrency, 16) || REQUESTED_FUNDING_CURRENCY,
            startedAtMs: safeInt(result?.startedAtMs) || Date.now(),
            botUsername: sanitizeText(result?.botUsername, 64) || currentBotUsername,
            botDifficulty: roundBotDifficulty,
        });

        if (dom.walletValue) {
            dom.walletValue.textContent = formatHtg(result?.playableHtg);
        }

        ludo.setInteractionLocked(false);
        ludo.resetGame();
        startHeartbeat();
    } catch (error) {
        const errorCode = sanitizeText(error?.code, 64).toLowerCase();
        const activeSessionId = sanitizeText(error?.details?.sessionId, 120);

        if (allowRecover && errorCode === 'active-ludo-wager') {
            const source = readStoredActiveWager() || (activeSessionId ? {
                sessionId: activeSessionId,
                stakeDoes: REQUESTED_STAKE_DOES,
                stakeHtg: REQUESTED_STAKE_HTG,
                fundingCurrency: REQUESTED_FUNDING_CURRENCY,
                startedAtMs: Date.now(),
                botUsername: currentBotUsername,
                botDifficulty: activeBotDifficulty,
            } : null);
            if (source?.sessionId) {
                applyBotDifficulty(source.botDifficulty || activeBotDifficulty);
                setActiveWager(source);
                queueCurrentRoundResult('auto_forfeit_active_session', 'ai');
                await flushPendingResults();
                showReloadForfeitModal();
                return;
            }
        }

        freezeRoundLocally();
        UI.showResultModal({
            title: 'Ludo pa ka komanse',
            copy: String(error?.message || 'Nou pa rive lanse pati Ludo a kounye a. Tanpri retounen sou paj dakèy la epi eseye ankò.'),
            showReplay: false,
            homeLabel: 'Akey',
        });
    } finally {
        roundLaunchInFlight = false;
    }
}

function installUiBridges() {
    document.addEventListener('kobposh:ludo-turn', (event) => {
        const player = String(event?.detail?.player || 'P1');
        activeTurnPlayer = player;
    });

    document.addEventListener('kobposh:ludo-state', handleStateEvent);

    document.addEventListener('kobposh:ludo-game-over', (event) => {
        const winnerPlayer = String(event?.detail?.winner || 'P2');
        if (!MONETIZED_MODE) return;
        const winner = winnerPlayer === 'P1' ? 'user' : 'ai';
        void settleRound({
            winner,
            reason: 'match_end',
            matchId: `ludo_match_${activeWager?.sessionId || Date.now().toString(36)}`,
        });
    });

    UI.listenReplayClick(() => {
        if (MONETIZED_MODE) {
            void (async () => {
                await waitForMatchmakingGate();
                await startMonetizedRound();
            })();
            return;
        }
        if (!ludo) return;
        UI.hideWinnerModal();
        assignRandomBotIdentity();
        applyPlayerIdentity();
        ludo.resetGame();
    });
}

function installMonetizedExitGuards() {
    if (!MONETIZED_MODE) return;

    try {
        window.history.pushState({ ludoSession: true }, '', window.location.href);
    } catch {
        // Ignore history API failures.
    }

    window.addEventListener('popstate', () => {
        void (async () => {
            if (activeWager?.sessionId && !currentRoundSettled) {
                await settleRound({
                    winner: 'ai',
                    reason: 'quit',
                    matchId: `ludo_quit_${activeWager.sessionId}`,
                });
            }
            window.location.href = HOME_URL;
        })();
    });

    window.addEventListener('offline', () => {
        void handleConnectivityForfeit('offline');
    });

    window.addEventListener('pagehide', () => {
        if (!currentRoundSettled) {
            queueCurrentRoundResult('pagehide', 'ai');
        }
    });

    window.addEventListener('beforeunload', () => {
        if (!currentRoundSettled) {
            queueCurrentRoundResult('beforeunload', 'ai');
        }
    });
}

assignRandomBotIdentity();
applyPlayerIdentity();
installUiBridges();
applyBotDifficulty(pageParams.get('botDifficulty'));
ludo = new Ludo({ botDifficulty: activeBotDifficulty });
ludo.setInteractionLocked(true);
UI.resetTurnTimers(TURN_DURATION_SECONDS);
installMonetizedExitGuards();

if (!MONETIZED_MODE) {
    void ensureGuideAcknowledged().then(() => {
        ludo?.setInteractionLocked(false);
        ludo?.resetGame();
    });
}

onAuthStateChanged(auth, async () => {
    await refreshWalletValue();

    if (!MONETIZED_MODE || bootstrapStarted) {
        return;
    }
    bootstrapStarted = true;

    if (!auth.currentUser) {
        window.location.href = HOME_URL;
        return;
    }

    await ensureGuideAcknowledged();
    recoveredForfeitOnBoot = recoverStoredActiveSession();
    await flushPendingResults();
    if (recoveredForfeitOnBoot) {
        await refreshWalletValue();
        showReloadForfeitModal();
        return;
    }
    await waitForMatchmakingGate();
    await startMonetizedRound();
});

void refreshWalletValue();
