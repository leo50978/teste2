import { BASE_POSITIONS, HOME_ENTRANCE, HOME_POSITIONS, PLAYERS, SAFE_POSITIONS, START_POSITIONS, STATE, TURNING_POINTS } from './constants.js?v=20260514-ludo-money1';
import { UI } from './UI.js?v=20260514-ludo-money1';

const BOT_DIFFICULTY_LEVELS = new Set(['weak', 'strong']);

function normalizeBotDifficulty(value = '') {
    const level = String(value || '').trim().toLowerCase();
    if (level === 'strong' || level === 'fort' || level === 'fo' || level === 'impossible') return 'strong';
    if (level === 'ultra' || level === 'expert' || level === 'dominov1') return 'strong';
    if (level === 'weak' || level === 'faible' || level === 'amateur' || level === 'userpro') return 'weak';
    return 'weak';
}

export class Ludo {
    currentPositions = {
        P1: [],
        P2: []
    }
    botActionHandle = 0;
    interactionLocked = false;
    botDifficulty = 'weak';
    botLastDiceValue = 0;
    botConsecutiveSixes = 0;

    _diceValue;
    get diceValue() {
        return this._diceValue;
    }
    set diceValue(value) {
        this._diceValue = value;

        UI.setDiceValue(value, PLAYERS[this.turn]);
    }

    _turn;
    get turn() {
        return this._turn;
    }
    set turn(value) {
        this._turn = value;
        UI.setTurn(value);
    }

    _state;
    get state() {
        return this._state;
    }
    set state(value) {
        this._state = value;

        if(this.interactionLocked) {
            UI.disableDice();
            UI.unhighlightPieces();
        } else if(value === STATE.DICE_NOT_ROLLED) {
            UI.enableDice(PLAYERS[this.turn]);
            UI.unhighlightPieces();
        } else {
            UI.disableDice();
        }
        UI.setGameState(value, PLAYERS[this.turn]);
        this.syncBotTurn();
    }

    constructor(options = {}) {
        console.log('Hello World! Lets play Ludo!');
        this.setBotDifficulty(options?.botDifficulty || 'weak');

        // this.diceValue = 4;
        // this.turn = 0;
        // this.state = STATE.DICE_ROLLED;
        this.listenDiceClick();
        this.listenResetClick();
        this.listenPieceClick();

        this.resetGame();
        // this.setPiecePosition('P1', 0, 0);
        // this.setPiecePosition('P2', 0, 1);
        // this.diceValue = 6;
        // console.log(this.getEligiblePieces('P1'))
        
    }

    setInteractionLocked(locked) {
        this.interactionLocked = Boolean(locked);
        if (this.interactionLocked) {
            this.clearBotAction();
            UI.disableDice();
            UI.unhighlightPieces();
            return;
        }
        if (this.state === STATE.DICE_NOT_ROLLED) {
            UI.enableDice(PLAYERS[this.turn]);
        } else {
            UI.disableDice();
        }
    }

    setBotDifficulty(level = 'weak') {
        this.botDifficulty = normalizeBotDifficulty(level);
    }

    clearBotAction() {
        if (this.botActionHandle) {
            window.clearTimeout(this.botActionHandle);
            this.botActionHandle = 0;
        }
    }

    wait(ms = 0) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, ms);
        });
    }

    scheduleBotAction(callback, delay = 720) {
        this.clearBotAction();
        this.botActionHandle = window.setTimeout(() => {
            this.botActionHandle = 0;
            callback();
        }, delay);
    }

    isBotPlayer(player) {
        return player === 'P2';
    }

    isBotTurn() {
        return this.isBotPlayer(PLAYERS[this.turn]);
    }

    syncBotTurn() {
        this.clearBotAction();
        if (this.state === STATE.GAME_OVER || !this.isBotTurn()) {
            return;
        }

        if (this.state === STATE.DICE_NOT_ROLLED) {
            this.scheduleBotAction(() => this.onDiceClick({ fromBot: true }), 760);
        }
    }

    listenDiceClick() {
        UI.listenDiceClick(this.onDiceClick.bind(this))
    }

    onDiceClick(eventOrOptions = {}) {
        if(this.state === STATE.GAME_OVER) return;
        if (this.interactionLocked) return;
        const fromBot = Boolean(eventOrOptions?.fromBot);
        if (this.isBotTurn() && !fromBot) {
            return;
        }
        console.log('dice clicked!');
        const player = PLAYERS[this.turn];
        this.diceValue = this.rollDiceValue(player);
        this.state = STATE.DICE_ROLLED;
        
        this.checkForEligiblePieces();
    }

    checkForEligiblePieces() {
        const player = PLAYERS[this.turn];
        // eligible pieces of given player
        const eligiblePieces = this.getEligiblePieces(player);
        if(eligiblePieces.length) {
            // highlight the pieces
            UI.highlightPieces(player, eligiblePieces);
            if (this.isBotPlayer(player)) {
                this.scheduleBotAction(() => {
                    const piece = this.pickBotPiece(player, eligiblePieces);
                    this.handlePieceClick(player, piece);
                }, 880);
            }
        } else {
            this.incrementTurn();
        }
    }

    incrementTurn() {
        this.turn = this.turn === 0 ? 1 : 0;
        this.state = STATE.DICE_NOT_ROLLED;
    }

    getEligiblePieces(player) {
        return this.getEligiblePiecesForRoll(player, this.diceValue);
    }

    listenResetClick() {
        UI.listenResetClick(this.resetGame.bind(this))
    }

    resetGame() {
        console.log('reset game');
        this.clearBotAction();
        UI.hideWinnerModal();
        UI.resetDiceFaces();
        this.currentPositions = structuredClone(BASE_POSITIONS);

        PLAYERS.forEach(player => {
            [0, 1, 2, 3].forEach(piece => {
                this.setPiecePosition(player, piece, this.currentPositions[player][piece])
            })
        });

        this.turn = 0;
        this.state = STATE.DICE_NOT_ROLLED;
        this.refreshHudStats();
    }

    listenPieceClick() {
        UI.listenPieceClick(this.onPieceClick.bind(this));
    }

    onPieceClick(event) {
        if(this.state === STATE.GAME_OVER) return;
        if (this.interactionLocked) return;
        const target = event.target;

        if(!target.classList.contains('player-piece') || !target.classList.contains('highlight')) {
            return;
        }
        console.log('piece clicked')

        const player = target.getAttribute('player-id');
        const piece = target.getAttribute('piece');
        if (player !== PLAYERS[this.turn] || this.isBotPlayer(player)) {
            return;
        }
        this.handlePieceClick(player, piece);
    }

    handlePieceClick(player, piece) {
        console.log(player, piece);
        this.clearBotAction();
        const currentPosition = this.currentPositions[player][piece];
        
        if(BASE_POSITIONS[player].includes(currentPosition)) {
            this.setPiecePosition(player, piece, START_POSITIONS[player]);
            this.state = STATE.DICE_NOT_ROLLED;
            return;
        }

        UI.unhighlightPieces();
        this.movePiece(player, piece, this.diceValue);
    }

    rollDiceValue(player) {
        if (this.botDifficulty === 'strong') {
            if (player === 'P2') {
                if (this.areAllPiecesInBase(player)) {
                    return 1 + Math.floor(Math.random() * 6);
                }
                return this.pickStrongBotDice(player);
            }
            if (player === 'P1') {
                return this.pickRiggedHumanDice(player);
            }
        }
        return 1 + Math.floor(Math.random() * 6);
    }

    areAllPiecesInBase(player) {
        const positions = Array.isArray(this.currentPositions[player]) ? this.currentPositions[player] : [];
        return positions.length > 0 && positions.every((position) => BASE_POSITIONS[player].includes(position));
    }

    pickStrongBotDice(player) {
        const rankedDice = [];

        for (let diceValue = 1; diceValue <= 6; diceValue += 1) {
            const eligiblePieces = this.getEligiblePiecesForRoll(player, diceValue);
            if (!eligiblePieces.length) {
                rankedDice.push({
                    diceValue,
                    score: -120,
                    reachesHome: false,
                    captures: 0,
                    wouldWin: false,
                    leavesBase: false,
                });
                continue;
            }

            const rankedMoves = eligiblePieces
                .map((piece) => {
                    const projectedPosition = this.getProjectedPosition(player, piece, diceValue);
                    const currentPosition = this.currentPositions[player][piece];
                    const leavesBase = BASE_POSITIONS[player].includes(currentPosition) && projectedPosition === START_POSITIONS[player];
                    const reachesHome = projectedPosition === HOME_POSITIONS[player];
                    const captures = this.countCapturesAtPosition(player, projectedPosition);
                    const wouldWin = this.wouldPlayerWinAfterMove(player, piece, diceValue);
                    return {
                        piece,
                        score: this.scoreStrongBotMove(player, piece, diceValue),
                        leavesBase,
                        reachesHome,
                        captures,
                        wouldWin,
                    };
                })
                .sort((a, b) => b.score - a.score);

            rankedDice.push({
                diceValue,
                ...rankedMoves[0],
            });
        }

        rankedDice.sort((a, b) => b.score - a.score);
        const bestOption = rankedDice[0] || { diceValue: 6, score: -120 };
        const sixOption = rankedDice.find((item) => item.diceValue === 6) || null;
        const sixIsMandatory = !!(
            sixOption
            && (
                sixOption.wouldWin
                || sixOption.captures > 0
                || sixOption.reachesHome
                || sixOption.leavesBase
            )
            && (sixOption.score >= (bestOption.score - 18))
        );

        let candidatePool = rankedDice.filter((item) => item.score >= (bestOption.score - 22));
        if (!sixIsMandatory) {
            candidatePool = candidatePool.filter((item) => item.diceValue !== 6);
        }
        if (!candidatePool.length) {
            candidatePool = rankedDice.slice(0, 2);
        }

        const softenedPool = candidatePool
            .map((item) => {
                let adjustedScore = item.score;
                if (item.diceValue === 6 && !sixIsMandatory) {
                    adjustedScore -= 26;
                }
                if (item.diceValue === 6 && this.botConsecutiveSixes >= 1) {
                    adjustedScore -= 42 * this.botConsecutiveSixes;
                }
                return {
                    ...item,
                    adjustedScore,
                };
            })
            .sort((a, b) => b.adjustedScore - a.adjustedScore);

        const finalPool = softenedPool.filter((item) => item.adjustedScore >= (softenedPool[0]?.adjustedScore ?? -9999) - 10);
        const choice = finalPool[Math.floor(Math.random() * finalPool.length)] || softenedPool[0] || bestOption;

        this.botConsecutiveSixes = choice.diceValue === 6 ? (this.botConsecutiveSixes + 1) : 0;
        this.botLastDiceValue = choice.diceValue;
        return choice.diceValue;
    }

    pickRiggedHumanDice(player) {
        let selectedDice = 1;
        let lowestScore = Number.POSITIVE_INFINITY;

        for (let diceValue = 1; diceValue <= 6; diceValue += 1) {
            const eligiblePieces = this.getEligiblePiecesForRoll(player, diceValue);
            const score = eligiblePieces.length
                ? Math.max(...eligiblePieces.map((piece) => this.scoreHumanOpportunity(player, piece, diceValue)))
                : -400;

            if (
                score < lowestScore
                || (score === lowestScore && diceValue !== 6 && selectedDice === 6)
                || (score === lowestScore && eligiblePieces.length === 0)
            ) {
                lowestScore = score;
                selectedDice = diceValue;
            }
        }

        return selectedDice;
    }

    getEligiblePiecesForRoll(player, diceValue) {
        return [0, 1, 2, 3].filter((piece) => this.isPieceEligibleForRoll(player, piece, diceValue));
    }

    isPieceEligibleForRoll(player, piece, diceValue) {
        const currentPosition = this.currentPositions[player][piece];

        if(currentPosition === HOME_POSITIONS[player]) {
            return false;
        }

        if(
            BASE_POSITIONS[player].includes(currentPosition)
            && diceValue !== 6
        ){
            return false;
        }

        if(
            HOME_ENTRANCE[player].includes(currentPosition)
            && diceValue > HOME_POSITIONS[player] - currentPosition
            ) {
            return false;
        }

        return true;
    }

    scoreHumanOpportunity(player, piece, diceValue) {
        const projectedPosition = this.getProjectedPosition(player, piece, diceValue);
        const currentPosition = this.currentPositions[player][piece];
        const leavesBase = BASE_POSITIONS[player].includes(currentPosition) && projectedPosition === START_POSITIONS[player];
        const reachesHome = projectedPosition === HOME_POSITIONS[player];
        const captures = this.countCapturesAtPosition(player, projectedPosition);
        const progress = this.getProgressDistance(player, projectedPosition);
        const safeLanding = SAFE_POSITIONS.includes(projectedPosition);
        const wouldWin = this.wouldPlayerWinAfterMove(player, piece, diceValue);

        let score = progress;
        if (leavesBase) score += 60;
        if (reachesHome) score += 180;
        if (captures > 0) score += 220 * captures;
        if (safeLanding) score += 20;
        if (diceValue === 6) score += 40;
        if (wouldWin) score += 900;
        return score;
    }

    scoreStrongBotMove(player, piece, diceValue) {
        const projectedPosition = this.getProjectedPosition(player, piece, diceValue);
        const currentPosition = this.currentPositions[player][piece];
        const leavesBase = BASE_POSITIONS[player].includes(currentPosition) && projectedPosition === START_POSITIONS[player];
        const reachesHome = projectedPosition === HOME_POSITIONS[player];
        const captures = this.countCapturesAtPosition(player, projectedPosition);
        const progress = this.getProgressDistance(player, projectedPosition);
        const safeLanding = SAFE_POSITIONS.includes(projectedPosition);
        const wouldWin = this.wouldPlayerWinAfterMove(player, piece, diceValue);
        const opponent = player === 'P1' ? 'P2' : 'P1';
        const opponentBestNextRoll = this.estimateBestScoreForAnyRoll(opponent);
        const exposedPenalty = !safeLanding && captures === 0 && !reachesHome ? 18 : 0;

        let score = progress * 2;
        if (leavesBase) score += 120;
        if (reachesHome) score += 240;
        if (captures > 0) score += 320 * captures;
        if (safeLanding) score += 28;
        if (diceValue === 6) score += 14;
        if (wouldWin) score += 1600;
        score -= Math.floor(opponentBestNextRoll * 0.35);
        score -= exposedPenalty;
        return score;
    }

    estimateBestScoreForAnyRoll(player) {
        let bestScore = 0;
        for (let diceValue = 1; diceValue <= 6; diceValue += 1) {
            const eligiblePieces = this.getEligiblePiecesForRoll(player, diceValue);
            if (!eligiblePieces.length) continue;
            const bestForRoll = Math.max(...eligiblePieces.map((piece) => this.scoreHumanOpportunity(player, piece, diceValue)));
            if (bestForRoll > bestScore) {
                bestScore = bestForRoll;
            }
        }
        return bestScore;
    }

    pickBotPiece(player, eligiblePieces) {
        if (!eligiblePieces.length) return 0;

        if (this.botDifficulty === 'strong') {
            const rankedStrongMoves = eligiblePieces
                .map((piece) => ({
                    piece,
                    score: this.scoreStrongBotMove(player, piece, this.diceValue),
                }))
                .sort((a, b) => b.score - a.score);
            return rankedStrongMoves[0]?.piece ?? eligiblePieces[0];
        }

        const rankedWeakMoves = eligiblePieces
            .map((piece) => {
                const projectedPosition = this.getProjectedPosition(player, piece, this.diceValue);
                const currentPosition = this.currentPositions[player][piece];
                const leavesBase = BASE_POSITIONS[player].includes(currentPosition) && projectedPosition === START_POSITIONS[player];
                const reachesHome = projectedPosition === HOME_POSITIONS[player];
                const makesKill = this.willKillAtPosition(player, projectedPosition);
                const progress = this.getProgressDistance(player, projectedPosition);

                let score = progress;
                if (leavesBase) score += 18;
                if (reachesHome) score += 55;
                if (makesKill) score += 26;
                if (SAFE_POSITIONS.includes(projectedPosition)) score += 4;

                return { piece, score };
            })
            .sort((a, b) => a.score - b.score);

        const weakPoolSize = Math.max(1, Math.min(rankedWeakMoves.length, 2));
        const weakPool = rankedWeakMoves.slice(0, weakPoolSize);
        const randomIndex = Math.floor(Math.random() * weakPool.length);
        return weakPool[randomIndex]?.piece ?? rankedWeakMoves[0]?.piece ?? eligiblePieces[0];
    }

    setPiecePosition(player, piece, newPosition) {
        this.currentPositions[player][piece] = newPosition;
        UI.setPiecePosition(player, piece, newPosition)
        this.refreshHudStats();
    }

    movePiece(player, piece, moveBy) {
        // this.setPiecePosition(player, piece, this.currentPositions[player][piece] + moveBy)
        const interval = setInterval(() => {
            this.incrementPiecePosition(player, piece);
            moveBy--;

            if(moveBy === 0) {
                clearInterval(interval);
                void this.finishMove(player, piece);
            }
        }, 200);
    }

    async finishMove(player, piece) {
        // check if player won
        if(this.hasPlayerWon(player)) {
            this.state = STATE.GAME_OVER;
            document.dispatchEvent(new CustomEvent('kobposh:ludo-game-over', {
                detail: {
                    winner: player,
                },
            }));
            UI.showWinnerModal(player);
            return;
        }

        const isKill = await this.checkForKill(player, piece);

        if(isKill || this.diceValue === 6) {
            this.state = STATE.DICE_NOT_ROLLED;
            return;
        }

        this.incrementTurn();
    }

    willKillAtPosition(player, targetPosition) {
        return this.countCapturesAtPosition(player, targetPosition) > 0;
    }

    async checkForKill(player, piece) {
        const currentPosition = this.currentPositions[player][piece];
        const opponent = player === 'P1' ? 'P2' : 'P1';
        const capturedPieces = [];

        [0, 1, 2, 3].forEach((opponentPiece) => {
            const opponentPosition = this.currentPositions[opponent][opponentPiece];

            if(currentPosition === opponentPosition && !SAFE_POSITIONS.includes(currentPosition)) {
                capturedPieces.push(opponentPiece);
            }
        });

        for (const capturedPiece of capturedPieces) {
            await this.animateCapturedPieceBack(opponent, capturedPiece);
        }

        return capturedPieces.length > 0;
    }

    hasPlayerWon(player) {
        return [0, 1, 2, 3].every(piece => this.currentPositions[player][piece] === HOME_POSITIONS[player])
    }

    incrementPiecePosition(player, piece) {
        this.setPiecePosition(player, piece, this.getIncrementedPosition(player, piece));
    }

    getProjectedPosition(player, piece, moveBy) {
        let projectedPosition = this.currentPositions[player][piece];
        if (BASE_POSITIONS[player].includes(projectedPosition)) {
            return START_POSITIONS[player];
        }

        while (moveBy > 0) {
            projectedPosition = this.getIncrementedPositionFrom(player, projectedPosition);
            moveBy -= 1;
        }

        return projectedPosition;
    }

    countCapturesAtPosition(player, targetPosition) {
        const opponent = player === 'P1' ? 'P2' : 'P1';
        if (SAFE_POSITIONS.includes(targetPosition)) {
            return 0;
        }
        let captures = 0;
        [0, 1, 2, 3].forEach((piece) => {
            if (this.currentPositions[opponent][piece] === targetPosition) {
                captures += 1;
            }
        });
        return captures;
    }

    wouldPlayerWinAfterMove(player, piece, moveBy) {
        const projectedPosition = this.getProjectedPosition(player, piece, moveBy);
        if (projectedPosition !== HOME_POSITIONS[player]) {
            return false;
        }
        const targetPiece = Number(piece);
        return [0, 1, 2, 3].every((candidate) => {
            if (candidate === targetPiece) {
                return projectedPosition === HOME_POSITIONS[player];
            }
            return this.currentPositions[player][candidate] === HOME_POSITIONS[player];
        });
    }
    
    getIncrementedPosition(player, piece) {
        const currentPosition = this.currentPositions[player][piece];
        return this.getIncrementedPositionFrom(player, currentPosition);
    }

    getIncrementedPositionFrom(player, currentPosition) {

        if(currentPosition === TURNING_POINTS[player]) {
            return HOME_ENTRANCE[player][0];
        }
        else if(currentPosition === 51) {
            return 0;
        }
        return currentPosition + 1;
    }

    getDecrementedTrackPosition(currentPosition) {
        if (currentPosition === 0) {
            return 51;
        }
        return currentPosition - 1;
    }

    async animateCapturedPieceBack(player, piece) {
        const exitPosition = START_POSITIONS[player];
        const basePosition = BASE_POSITIONS[player][piece];
        let currentPosition = this.currentPositions[player][piece];

        while (currentPosition !== exitPosition) {
            currentPosition = this.getDecrementedTrackPosition(currentPosition);
            this.setPiecePosition(player, piece, currentPosition);
            await this.wait(90);
        }

        await this.wait(90);
        this.setPiecePosition(player, piece, basePosition);
        await this.wait(120);
    }

    getProgressDistance(player, position) {
        if (BASE_POSITIONS[player].includes(position)) {
            return 0;
        }
        if (position === HOME_POSITIONS[player]) {
            return 999;
        }
        if (HOME_ENTRANCE[player].includes(position)) {
            return 200 + (position - HOME_ENTRANCE[player][0]);
        }

        const start = START_POSITIONS[player];
        if (position >= start) {
            return position - start;
        }
        return (52 - start) + position;
    }

    refreshHudStats() {
        PLAYERS.forEach((player) => {
            const homeCount = this.currentPositions[player].filter(position => position === HOME_POSITIONS[player]).length;
            const baseCount = this.currentPositions[player].filter(position => BASE_POSITIONS[player].includes(position)).length;
            const boardCount = Math.max(0, 4 - homeCount - baseCount);
            UI.setPlayerStats(player, {
                homeCount,
                baseCount,
                boardCount,
            });
        });
    }
}
