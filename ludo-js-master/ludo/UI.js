import { COORDINATES_MAP, PLAYERS, STATE, STEP_LENGTH } from './constants.js?v=20260514-ludo-money1';

const diceButtonElements = {
    P1: document.querySelector('#ludoDiceButtonP1'),
    P2: document.querySelector('#ludoDiceButtonP2'),
};
const resetButtonElement = document.querySelector('#reset-btn');
const playerPiecesElements = {
    P1: document.querySelectorAll('[player-id="P1"].player-piece'),
    P2: document.querySelectorAll('[player-id="P2"].player-piece'),
};
const playerCardElements = {
    P1: document.querySelector('[data-player-card="P1"]'),
    P2: document.querySelector('[data-player-card="P2"]'),
};
const timerLabelElements = {
    P1: document.querySelector('#ludoTimerLabelP1'),
    P2: document.querySelector('#ludoTimerLabelP2'),
};
const timerFillElements = {
    P1: document.querySelector('#ludoTimerFillP1'),
    P2: document.querySelector('#ludoTimerFillP2'),
};
const playerNameElements = {
    P1: document.querySelector('#ludoPlayerNameP1'),
    P2: document.querySelector('#ludoPlayerNameP2'),
};
const playerBoardCountElements = {
    P1: document.querySelector('#ludoBoardCountP1'),
    P2: document.querySelector('#ludoBoardCountP2'),
};
const playerHomeCountElements = {
    P1: document.querySelector('#ludoHomeCountP1'),
    P2: document.querySelector('#ludoHomeCountP2'),
};
const activePlayerValueElement = document.querySelector('.active-player span');
const turnPromptElement = document.querySelector('#ludoTurnPrompt');
const statusTextElement = document.querySelector('#ludoStatusText');
const diceValueElements = {
    P1: document.querySelector('#ludoDiceValueP1'),
    P2: document.querySelector('#ludoDiceValueP2'),
};
const resultModalElement = document.querySelector('#ludoResultModal');
const resultTitleElement = document.querySelector('#ludoResultTitle');
const resultCopyElement = document.querySelector('#ludoResultCopy');
const replayButtonElement = document.querySelector('#ludoReplayBtn');
const homeButtonElement = document.querySelector('#ludoHomeBtn');
const diceRollAnimationHandles = {
    P1: 0,
    P2: 0,
};
const diceRollIntervalHandles = {
    P1: 0,
    P2: 0,
};

function getPlayerDisplayName(player) {
    const element = playerNameElements[player];
    const fallback = player === 'P1' ? 'Ou' : 'Advese a';
    return element ? String(element.textContent || '').trim() || fallback : fallback;
}

function dispatchUiEvent(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
}

function setText(element, value) {
    if (!element) return;
    element.textContent = value;
}

function clearDiceAnimation(player) {
    if (diceRollAnimationHandles[player]) {
        window.clearTimeout(diceRollAnimationHandles[player]);
        diceRollAnimationHandles[player] = 0;
    }
    if (diceRollIntervalHandles[player]) {
        window.clearInterval(diceRollIntervalHandles[player]);
        diceRollIntervalHandles[player] = 0;
    }
}

function getStackOffsets(count, index) {
    if (count <= 1) {
        return { x: 0, y: 0, scale: 1 };
    }

    const patterns = {
        2: [
            { x: -9, y: -7, scale: 0.94 },
            { x: 9, y: 7, scale: 0.94 },
        ],
        3: [
            { x: -10, y: -8, scale: 0.9 },
            { x: 10, y: -8, scale: 0.9 },
            { x: 0, y: 10, scale: 0.9 },
        ],
        4: [
            { x: -10, y: -9, scale: 0.88 },
            { x: 10, y: -9, scale: 0.88 },
            { x: -10, y: 9, scale: 0.88 },
            { x: 10, y: 9, scale: 0.88 },
        ],
    };

    const preset = patterns[Math.min(count, 4)] || patterns[4];
    return preset[index] || { x: 0, y: 0, scale: 0.88 };
}

function restackPieces() {
    const groups = new Map();
    document.querySelectorAll('.player-piece').forEach((element) => {
        const position = String(element.dataset.boardPosition || '').trim();
        if (!position) return;
        if (!groups.has(position)) {
            groups.set(position, []);
        }
        groups.get(position).push(element);
    });

    groups.forEach((elements) => {
        const ordered = elements.sort((a, b) => {
            const playerA = String(a.getAttribute('player-id') || '');
            const playerB = String(b.getAttribute('player-id') || '');
            const pieceA = Number(a.getAttribute('piece') || 0);
            const pieceB = Number(b.getAttribute('piece') || 0);
            if (playerA === playerB) return pieceA - pieceB;
            return playerA.localeCompare(playerB);
        });

        ordered.forEach((element, index) => {
            const { x, y, scale } = getStackOffsets(ordered.length, index);
            element.style.setProperty('--stack-offset-x', `${x}px`);
            element.style.setProperty('--stack-offset-y', `${y}px`);
            element.style.setProperty('--stack-scale', String(scale));
            element.style.zIndex = String(2 + index);
        });
    });
}

export class UI {
    static lastDiceValue = 0;
    static lastDicePlayer = 'P1';

    static listenDiceClick(callback) {
        diceButtonElements.P1?.addEventListener('click', callback);
    }

    static listenResetClick(callback) {
        resetButtonElement?.addEventListener('click', callback);
    }

    static listenPieceClick(callback) {
        document.querySelector('.player-pieces')?.addEventListener('click', callback);
    }

    static listenReplayClick(callback) {
        replayButtonElement?.addEventListener('click', callback);
    }

    static setPiecePosition(player, piece, newPosition) {
        if (!playerPiecesElements[player] || !playerPiecesElements[player][piece]) {
            console.error(`Player element of given player: ${player} and piece: ${piece} not found`);
            return;
        }

        const [x, y] = COORDINATES_MAP[newPosition];
        const pieceElement = playerPiecesElements[player][piece];
        pieceElement.dataset.boardPosition = String(newPosition);
        pieceElement.style.top = y * STEP_LENGTH + '%';
        pieceElement.style.left = x * STEP_LENGTH + '%';
        restackPieces();
    }

    static setTurn(index) {
        if (index < 0 || index >= PLAYERS.length) {
            console.error('index out of bound!');
            return;
        }

        const player = PLAYERS[index];
        setText(activePlayerValueElement, getPlayerDisplayName(player));

        PLAYERS.forEach((playerId) => {
            playerCardElements[playerId]?.classList.toggle('is-active', playerId === player);
        });

        dispatchUiEvent('kobposh:ludo-turn', { index, player });
    }

    static setGameState(state, player) {
        const displayName = getPlayerDisplayName(player);
        const isSelf = player === 'P1';
        if (state === STATE.DICE_NOT_ROLLED) {
            setText(turnPromptElement, isSelf ? 'Se ou ki gen men an. Lanse de a pou kontinye.' : `Se ${displayName} ki gen men an. Lanse de a pou li.`);
            setText(statusTextElement, isSelf ? 'Lanse de a, epi pare pou chwazi pyon ki dwe avanse a.' : `${displayName} pare pou woule de a.`);
        } else if (state === STATE.DICE_ROLLED) {
            setText(turnPromptElement, isSelf ? 'De a soti. Chwazi youn nan pyon ki klere yo.' : `${displayName} dwe chwazi pyon li kounye a.`);
            setText(statusTextElement, `De a montre ${UI.lastDiceValue || '--'}. Chwazi premye pyon ki disponib la pou avanse.`);
        } else if (state === STATE.GAME_OVER) {
            setText(turnPromptElement, `${displayName} fini wonn nan.`);
            setText(statusTextElement, `${displayName} mete tout pyon li yo lakay yo. Peze Rejwe pou relanse tablo a.`);
        }

        dispatchUiEvent('kobposh:ludo-state', { state, player, diceValue: UI.lastDiceValue });
    }

    static enableDice(player = 'P1') {
        PLAYERS.forEach((playerId) => {
            const button = diceButtonElements[playerId];
            if (!button) return;
            const canUse = playerId === player && playerId === 'P1';
            button.toggleAttribute('disabled', !canUse);
            button.classList.toggle('is-ready', canUse);
            button.classList.toggle('is-bot-turn', playerId === player && playerId === 'P2');
        });
    }

    static disableDice() {
        PLAYERS.forEach((playerId) => {
            const button = diceButtonElements[playerId];
            if (!button) return;
            button.setAttribute('disabled', '');
            button.classList.remove('is-ready', 'is-bot-turn');
        });
    }

    static highlightPieces(player, pieces) {
        pieces.forEach((piece) => {
            const pieceElement = playerPiecesElements[player][piece];
            pieceElement?.classList.add('highlight');
        });
    }

    static unhighlightPieces() {
        document.querySelectorAll('.player-piece.highlight').forEach((element) => {
            element.classList.remove('highlight');
        });
    }

    static setDiceValue(value, player = 'P1') {
        UI.lastDiceValue = Number(value) || 0;
        UI.lastDicePlayer = player;
        const faceElement = diceValueElements[player];
        const diceButtonElement = diceButtonElements[player];
        if (diceButtonElement && faceElement) {
            clearDiceAnimation(player);
            diceButtonElement.classList.remove('is-rolling');
            void diceButtonElement.offsetWidth;
            diceButtonElement.classList.add('is-rolling');
            let previousValue = 0;
            diceRollIntervalHandles[player] = window.setInterval(() => {
                let previewValue = 1 + Math.floor(Math.random() * 6);
                if (previewValue === previousValue) {
                    previewValue = previewValue === 6 ? 1 : previewValue + 1;
                }
                previousValue = previewValue;
                setText(faceElement, String(previewValue));
            }, 78);
            diceRollAnimationHandles[player] = window.setTimeout(() => {
                clearDiceAnimation(player);
                setText(faceElement, value > 0 ? String(value) : '--');
                diceButtonElement.classList.remove('is-rolling');
            }, 620);
        } else {
            setText(faceElement, value > 0 ? String(value) : '--');
        }
        dispatchUiEvent('kobposh:ludo-dice', { value: UI.lastDiceValue });
    }

    static setPlayerStats(player, stats = {}) {
        setText(playerBoardCountElements[player], String(Number(stats.boardCount) || 0));
        setText(playerHomeCountElements[player], String(Number(stats.homeCount) || 0));
    }

    static renderTurnTimer(player, { remaining = 30, total = 30, danger = false } = {}) {
        const safeRemaining = Math.max(0, Math.floor(Number(remaining) || 0));
        const safeTotal = Math.max(1, Math.floor(Number(total) || 1));
        const ratio = Math.max(0, Math.min(1, safeRemaining / safeTotal));

        setText(timerLabelElements[player], `${safeRemaining}s`);
        if (timerFillElements[player]) {
            timerFillElements[player].style.width = `${ratio * 100}%`;
        }
        playerCardElements[player]?.classList.toggle('is-danger', danger === true);
    }

    static resetTurnTimers(total = 30) {
        PLAYERS.forEach((player) => {
            UI.renderTurnTimer(player, { remaining: total, total, danger: false });
        });
    }

    static resetDiceFaces() {
        PLAYERS.forEach((player) => {
            clearDiceAnimation(player);
            setText(diceValueElements[player], '--');
            diceButtonElements[player]?.classList.remove('is-rolling', 'is-ready', 'is-bot-turn');
            if (player === 'P1') {
                diceButtonElements[player]?.removeAttribute('disabled');
            } else {
                diceButtonElements[player]?.setAttribute('disabled', '');
            }
        });
        UI.lastDiceValue = 0;
        UI.lastDicePlayer = 'P1';
    }

    static showResultModal({
        title = 'Ronn nan fini',
        copy = 'Youn nan jwet yo rive lakay yo ak tout pyon yo.',
        showReplay = true,
        replayLabel = 'Rejwe',
        homeLabel = 'Akey',
    } = {}) {
        setText(resultTitleElement, String(title || 'Ronn nan fini'));
        setText(resultCopyElement, String(copy || 'Youn nan jwet yo rive lakay yo ak tout pyon yo.'));
        if (replayButtonElement) {
            replayButtonElement.textContent = replayLabel;
            replayButtonElement.style.display = showReplay ? '' : 'none';
        }
        if (homeButtonElement) {
            homeButtonElement.textContent = homeLabel;
        }
        resultModalElement?.classList.remove('hidden');
        resultModalElement?.setAttribute('aria-hidden', 'false');
    }

    static showWinnerModal(player) {
        const selfWon = player === 'P1';
        UI.showResultModal({
            title: selfWon ? 'Ou genyen pati a' : 'Ou pedi',
            copy: selfWon
                ? 'Ou ka rejwe oswa tounen nan paj akey la.'
                : 'Ou ka rejwe oswa tounen nan akey la.',
            showReplay: true,
            replayLabel: 'Rejwe',
            homeLabel: 'Akey',
        });
    }

    static hideWinnerModal() {
        resultModalElement?.classList.add('hidden');
        resultModalElement?.setAttribute('aria-hidden', 'true');
    }
}
