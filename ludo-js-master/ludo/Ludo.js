import { BASE_POSITIONS, HOME_ENTRANCE, HOME_POSITIONS, PLAYERS, SAFE_POSITIONS, START_POSITIONS, STATE, TURNING_POINTS } from './constants.js?v=20260523-ludo-frienddice2';
import { UI } from './UI.js?v=20260523-ludo-frienddice2';

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
    botTurnPlannedTotalMs = 0;
    botTurnRollDelayMs = 0;
    interactionLocked = false;
    botDifficulty = 'weak';
    botLastDiceValue = 0;
    botConsecutiveSixes = 0;
    botRecentDiceHistory = [];
    localPlayerId = 'P1';
    botPlayers = new Set(['P2']);
    actionIntentHandler = null;
    lastExternalDiceActionSeq = -1;

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
            UI.disableDice(this.localPlayerId);
            UI.unhighlightPieces();
        } else if(value === STATE.DICE_NOT_ROLLED) {
            UI.enableDice(PLAYERS[this.turn], this.localPlayerId);
            UI.unhighlightPieces();
        } else {
            UI.disableDice(this.localPlayerId);
        }
        UI.setGameState(value, PLAYERS[this.turn]);
        this.syncBotTurn();
    }

    constructor(options = {}) {
        console.log('Hello World! Lets play Ludo!');
        this.setBotDifficulty(options?.botDifficulty || 'weak');
        this.setLocalPlayerId(options?.localPlayerId || 'P1');
        this.setBotPlayers(options?.botPlayers || ['P2']);
        this.setActionIntentHandler(options?.onActionIntent || null);

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
            UI.disableDice(this.localPlayerId);
            UI.unhighlightPieces();
            return;
        }
        if (this.state === STATE.DICE_NOT_ROLLED) {
            UI.enableDice(PLAYERS[this.turn], this.localPlayerId);
        } else {
            UI.disableDice(this.localPlayerId);
        }
    }

    setBotDifficulty(level = 'weak') {
        this.botDifficulty = normalizeBotDifficulty(level);
    }

    setLocalPlayerId(playerId = 'P1') {
        this.localPlayerId = String(playerId || '').trim() === 'P2' ? 'P2' : 'P1';
    }

    setBotPlayers(players = ['P2']) {
        const values = Array.isArray(players) ? players : [players];
        this.botPlayers = new Set(values.map((value) => String(value || '').trim()).filter(Boolean));
    }

    setActionIntentHandler(handler = null) {
        this.actionIntentHandler = typeof handler === 'function' ? handler : null;
    }

    clearBotAction() {
        if (this.botActionHandle) {
            window.clearTimeout(this.botActionHandle);
            this.botActionHandle = 0;
        }
    }

    clearBotTurnPlan() {
        this.botTurnPlannedTotalMs = 0;
        this.botTurnRollDelayMs = 0;
    }

    resetBotDiceMemory() {
        this.botLastDiceValue = 0;
        this.botConsecutiveSixes = 0;
        this.botRecentDiceHistory = [];
    }

    recordBotDiceValue(diceValue) {
        const safeDiceValue = Math.max(1, Math.min(6, Number(diceValue) || 1));
        this.botConsecutiveSixes = safeDiceValue === 6 ? (this.botConsecutiveSixes + 1) : 0;
        this.botLastDiceValue = safeDiceValue;
        this.botRecentDiceHistory.push(safeDiceValue);
        if (this.botRecentDiceHistory.length > 6) {
            this.botRecentDiceHistory.shift();
        }
    }

    getRecentDiceStreak(diceValue) {
        let streak = 0;
        for (let index = this.botRecentDiceHistory.length - 1; index >= 0; index -= 1) {
            if (this.botRecentDiceHistory[index] !== diceValue) {
                break;
            }
            streak += 1;
        }
        return streak;
    }

    getBotDicePatternPenalty(diceValue, options = {}) {
        const safeDiceValue = Math.max(1, Math.min(6, Number(diceValue) || 1));
        const sixIsHighLeverage = Boolean(options?.sixIsHighLeverage);
        const streak = this.getRecentDiceStreak(safeDiceValue);
        const recentSixes = this.botRecentDiceHistory.slice(-4).filter((value) => value === 6).length;
        let penalty = 0;

        if (streak >= 1) {
            penalty += safeDiceValue === 6 ? (18 * streak) : (9 * streak);
        }

        if (streak >= 2) {
            penalty += safeDiceValue === 6 ? 64 : 24;
        }

        if (safeDiceValue === this.botLastDiceValue) {
            penalty += safeDiceValue === 6 ? 12 : 6;
        }

        if (safeDiceValue === 6) {
            penalty += recentSixes * 22;
            if (this.botConsecutiveSixes >= 1) {
                penalty += sixIsHighLeverage ? (46 * this.botConsecutiveSixes) : (132 * this.botConsecutiveSixes);
            }
            if (!sixIsHighLeverage && streak >= 1) {
                penalty += 40;
            }
        }

        return penalty;
    }

    pickWeightedOption(options = [], getWeight = () => 1) {
        if (!Array.isArray(options) || !options.length) {
            return null;
        }

        const weighted = options.map((item) => ({
            item,
            weight: Math.max(1, Number(getWeight(item)) || 1),
        }));
        const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
        let cursor = Math.random() * totalWeight;

        for (const entry of weighted) {
            cursor -= entry.weight;
            if (cursor <= 0) {
                return entry.item;
            }
        }

        return weighted[weighted.length - 1]?.item || options[0];
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

    getRandomIntInclusive(min, max) {
        const safeMin = Math.ceil(Number(min) || 0);
        const safeMax = Math.floor(Number(max) || 0);
        return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
    }

    getRandomStartingTurn() {
        return this.getRandomIntInclusive(0, PLAYERS.length - 1);
    }

    prepareBotTurnPlan() {
        const totalMs = this.getRandomIntInclusive(5000, 10000);
        const rollDelayMs = Math.min(
            totalMs - 1800,
            Math.max(2200, Math.floor(totalMs * (0.38 + Math.random() * 0.2)))
        );
        this.botTurnPlannedTotalMs = totalMs;
        this.botTurnRollDelayMs = rollDelayMs;
    }

    getBotRollDelayMs() {
        if (!this.botTurnRollDelayMs) {
            this.prepareBotTurnPlan();
        }
        return this.botTurnRollDelayMs;
    }

    getBotPieceDelayMs() {
        if (!this.botTurnPlannedTotalMs || !this.botTurnRollDelayMs) {
            this.prepareBotTurnPlan();
        }
        const remainingMs = this.botTurnPlannedTotalMs - this.botTurnRollDelayMs;
        return Math.max(1600, remainingMs);
    }

    isBotPlayer(player) {
        return this.botPlayers.has(player);
    }

    isBotTurn() {
        return this.isBotPlayer(PLAYERS[this.turn]);
    }

    syncBotTurn() {
        this.clearBotAction();
        if (this.state === STATE.GAME_OVER || !this.isBotTurn()) {
            this.clearBotTurnPlan();
            return;
        }

        if (this.state === STATE.DICE_NOT_ROLLED) {
            this.prepareBotTurnPlan();
            this.scheduleBotAction(() => this.onDiceClick({ fromBot: true }), this.getBotRollDelayMs());
        }
    }

    listenDiceClick() {
        UI.listenDiceClick(this.onDiceClick.bind(this))
    }

    onDiceClick(eventOrOptions = {}) {
        if(this.state === STATE.GAME_OVER) return;
        if (this.interactionLocked) return;
        const fromBot = Boolean(eventOrOptions?.fromBot);
        const clickedPlayer = String(eventOrOptions?.uiPlayer || eventOrOptions?.player || this.localPlayerId || 'P1').trim() === 'P2' ? 'P2' : 'P1';
        if (this.isBotTurn() && !fromBot) {
            UI.showWaitTurnModal();
            return;
        }
        if (!fromBot && clickedPlayer !== this.localPlayerId) {
            return;
        }
        if (!fromBot && PLAYERS[this.turn] !== this.localPlayerId) {
            UI.showWaitTurnModal();
            return;
        }
        if (!fromBot && this.state !== STATE.DICE_NOT_ROLLED) {
            return;
        }
        if (!fromBot && this.actionIntentHandler && !this.isBotPlayer(PLAYERS[this.turn])) {
            UI.startDicePreview(this.localPlayerId);
            this.actionIntentHandler({
                type: 'roll',
                player: PLAYERS[this.turn],
            });
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
                }, this.getBotPieceDelayMs());
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
        this.clearBotTurnPlan();
        this.resetBotDiceMemory();
        this.lastExternalDiceActionSeq = -1;
        UI.hideWinnerModal();
        UI.hideWaitTurnModal();
        UI.resetDiceFaces();
        this.currentPositions = structuredClone(BASE_POSITIONS);

        PLAYERS.forEach(player => {
            [0, 1, 2, 3].forEach(piece => {
                this.setPiecePosition(player, piece, this.currentPositions[player][piece])
            })
        });

        this.turn = this.getRandomStartingTurn();
        this.state = STATE.DICE_NOT_ROLLED;
        this.refreshHudStats();
    }

    applyExternalState(snapshot = {}) {
        this.clearBotAction();
        this.clearBotTurnPlan();
        UI.hideWaitTurnModal();
        UI.unhighlightPieces();

        const sourcePositions = snapshot?.currentPositions && typeof snapshot.currentPositions === 'object'
            ? snapshot.currentPositions
            : {};
        this.currentPositions = structuredClone({
            P1: Array.isArray(sourcePositions.P1) ? sourcePositions.P1.slice(0, 4) : BASE_POSITIONS.P1.slice(),
            P2: Array.isArray(sourcePositions.P2) ? sourcePositions.P2.slice(0, 4) : BASE_POSITIONS.P2.slice(),
        });

        PLAYERS.forEach(player => {
            [0, 1, 2, 3].forEach(piece => {
                this.setPiecePosition(player, piece, this.currentPositions[player][piece])
            })
        });

        const nextTurn = Number(snapshot?.turnIndex) === 1 ? 1 : 0;
        const nextDiceValue = Number(snapshot?.diceValue) || 0;
        const nextState = String(snapshot?.state || STATE.DICE_NOT_ROLLED);
        const nextActionSeq = Number(snapshot?.actionSeq) || 0;
        const nextLastDicePlayer = String(snapshot?.lastDicePlayer || '').trim() === 'P2' ? 'P2' : (String(snapshot?.lastDicePlayer || '').trim() === 'P1' ? 'P1' : '');
        const shouldAnimateDice = (
            nextState === STATE.DICE_ROLLED
            && nextDiceValue > 0
            && nextActionSeq !== this.lastExternalDiceActionSeq
        );
        const diceOwner = nextLastDicePlayer || PLAYERS[nextTurn];

        this.turn = nextTurn;
        this._diceValue = nextDiceValue;
        UI.setDiceValue(nextDiceValue, diceOwner, {
            animate: shouldAnimateDice,
        });
        this.lastExternalDiceActionSeq = nextActionSeq;
        this.state = nextState;
        this.refreshHudStats();

        const eligiblePieces = Array.isArray(snapshot?.eligiblePieces)
            ? snapshot.eligiblePieces.map((value) => Number(value)).filter((value) => Number.isFinite(value))
            : [];
        if (this.state === STATE.DICE_ROLLED && PLAYERS[this.turn] === this.localPlayerId && eligiblePieces.length) {
            UI.highlightPieces(this.localPlayerId, eligiblePieces);
        }
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
        if (player !== this.localPlayerId) {
            return;
        }
        this.handlePieceClick(player, piece);
    }

    handlePieceClick(player, piece) {
        console.log(player, piece);
        this.clearBotAction();
        if (this.actionIntentHandler && !this.isBotPlayer(player)) {
            UI.unhighlightPieces();
            this.actionIntentHandler({
                type: 'move',
                player,
                piece: Number(piece),
                diceValue: this.diceValue,
            });
            return;
        }
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
        if (this.botDifficulty === 'strong' && this.isBotPlayer(player)) {
            if (this.areAllPiecesInBase(player)) {
                return this.pickStrongOpeningBotDice(player);
            }
            return this.pickStrongBotDice(player);
        }

        if (this.botDifficulty === 'strong' && !this.isBotPlayer(player) && this.botPlayers.size > 0) {
            const naturalRoll = 1 + Math.floor(Math.random() * 6);
            if (this.shouldDampenHumanRoll(player, naturalRoll)) {
                return this.pickSoftenedHumanDice(player, naturalRoll);
            }
            return naturalRoll;
        }
        return 1 + Math.floor(Math.random() * 6);
    }

    areAllPiecesInBase(player) {
        const positions = Array.isArray(this.currentPositions[player]) ? this.currentPositions[player] : [];
        return positions.length > 0 && positions.every((position) => BASE_POSITIONS[player].includes(position));
    }

    countPiecesInBase(player) {
        const positions = Array.isArray(this.currentPositions[player]) ? this.currentPositions[player] : [];
        return positions.filter((position) => BASE_POSITIONS[player].includes(position)).length;
    }

    countPiecesOnBoard(player) {
        const positions = Array.isArray(this.currentPositions[player]) ? this.currentPositions[player] : [];
        return positions.filter((position) => (
            !BASE_POSITIONS[player].includes(position)
            && position !== HOME_POSITIONS[player]
        )).length;
    }

    pickStrongOpeningBotDice(player) {
        const openingPool = [
            { diceValue: 6, score: 180 },
            { diceValue: 5, score: 42 },
            { diceValue: 4, score: 34 },
            { diceValue: 3, score: 28 },
            { diceValue: 2, score: 20 },
            { diceValue: 1, score: 16 },
        ].map((item) => ({
            ...item,
            adjustedScore: item.score - this.getBotDicePatternPenalty(item.diceValue, {
                sixIsHighLeverage: item.diceValue === 6,
            }),
        })).sort((a, b) => b.adjustedScore - a.adjustedScore);

        const bestAdjustedScore = openingPool[0]?.adjustedScore ?? 0;
        const finalPool = openingPool.filter((item) => item.adjustedScore >= (bestAdjustedScore - 68));
        const choice = this.pickWeightedOption(finalPool, (item) => item.adjustedScore + 24) || openingPool[0] || { diceValue: 6 };

        this.recordBotDiceValue(choice.diceValue);
        return choice.diceValue;
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
        const sixCreatesLeverage = !!(
            sixOption
            && (
                sixOption.wouldWin
                || sixOption.captures > 0
                || sixOption.reachesHome
                || sixOption.leavesBase
            )
        );
        const sixIsMandatory = !!(
            sixOption
            && (
                sixOption.wouldWin
                || sixOption.captures > 0
                || sixOption.reachesHome
            )
            && (sixOption.score >= (bestOption.score - 18))
        );

        let candidatePool = rankedDice.filter((item) => item.score >= (bestOption.score - 22));
        if (!sixIsMandatory) {
            candidatePool = candidatePool.filter((item) => item.diceValue !== 6);
        }
        if (!candidatePool.length) {
            candidatePool = rankedDice.slice(0, 3);
        }

        const softenedPool = candidatePool
            .map((item) => {
                let adjustedScore = item.score;
                adjustedScore -= this.getBotDicePatternPenalty(item.diceValue, {
                    sixIsHighLeverage: sixCreatesLeverage || item.wouldWin || item.captures > 0 || item.reachesHome,
                });
                if (item.diceValue === 6 && !sixIsMandatory && !sixCreatesLeverage) {
                    adjustedScore -= 18;
                }
                return {
                    ...item,
                    adjustedScore,
                };
            })
            .sort((a, b) => b.adjustedScore - a.adjustedScore);

        const bestAdjustedScore = softenedPool[0]?.adjustedScore ?? -9999;
        const finalPool = softenedPool.filter((item) => item.adjustedScore >= (bestAdjustedScore - 14));
        const choice = this.pickWeightedOption(
            finalPool,
            (item) => Math.max(1, item.adjustedScore - bestAdjustedScore + 22),
        ) || softenedPool[0] || bestOption;

        this.recordBotDiceValue(choice.diceValue);
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

    isTrackPosition(position) {
        return Number.isFinite(position) && position >= 0 && position <= 51;
    }

    getTrackDistanceForPlayer(player, fromPosition, targetPosition, maxSteps = 6) {
        if (!this.isTrackPosition(fromPosition) || !this.isTrackPosition(targetPosition)) {
            return null;
        }

        let currentPosition = fromPosition;
        for (let step = 1; step <= maxSteps; step += 1) {
            currentPosition = this.getIncrementedPositionFrom(player, currentPosition);
            if (!this.isTrackPosition(currentPosition)) {
                return null;
            }
            if (currentPosition === targetPosition) {
                return step;
            }
        }
        return null;
    }

    estimateImmediateCaptureRisk(player, targetPosition) {
        if (!this.isTrackPosition(targetPosition) || SAFE_POSITIONS.includes(targetPosition)) {
            return 0;
        }

        const opponent = player === 'P1' ? 'P2' : 'P1';
        let risk = 0;
        [0, 1, 2, 3].forEach((piece) => {
            const opponentPosition = this.currentPositions[opponent][piece];
            const distance = this.getTrackDistanceForPlayer(opponent, opponentPosition, targetPosition, 6);
            if (distance == null) {
                return;
            }
            risk += Math.max(0, 88 - (distance * 11));
            if (distance <= 2) {
                risk += 18;
            }
        });
        return risk;
    }

    estimatePressureScore(player, targetPosition) {
        if (!this.isTrackPosition(targetPosition)) {
            return 0;
        }

        const opponent = player === 'P1' ? 'P2' : 'P1';
        let pressure = 0;
        [0, 1, 2, 3].forEach((piece) => {
            const opponentPosition = this.currentPositions[opponent][piece];
            if (!this.isTrackPosition(opponentPosition) || SAFE_POSITIONS.includes(opponentPosition)) {
                return;
            }
            const distance = this.getTrackDistanceForPlayer(player, targetPosition, opponentPosition, 6);
            if (distance == null) {
                return;
            }
            pressure += Math.max(0, 46 - (distance * 6));
        });
        return pressure;
    }

    getHomeApproachBonus(player, targetPosition) {
        const progress = this.getProgressDistance(player, targetPosition);
        if (targetPosition === HOME_POSITIONS[player]) {
            return 160;
        }
        if (HOME_ENTRANCE[player].includes(targetPosition)) {
            return 72 + (progress - 200) * 20;
        }
        if (progress >= 44) {
            return 18 + (progress - 44) * 4;
        }
        return 0;
    }

    getLeaderProgress(player) {
        return [0, 1, 2, 3].reduce((best, piece) => (
            Math.max(best, this.getProgressDistance(player, this.currentPositions[player][piece]))
        ), 0);
    }

    shouldDampenHumanRoll(player, naturalRoll) {
        const eligiblePieces = this.getEligiblePiecesForRoll(player, naturalRoll);
        if (!eligiblePieces.length) {
            return false;
        }

        const naturalScore = Math.max(...eligiblePieces.map((piece) => this.scoreHumanOpportunity(player, piece, naturalRoll)));
        if (naturalScore < 240) {
            return false;
        }

        const botPlayer = PLAYERS.find((candidate) => this.isBotPlayer(candidate)) || 'P2';
        const botLead = this.getLeaderProgress(botPlayer) - this.getLeaderProgress(player);
        let chance = naturalScore >= 900 ? 0.78 : (naturalScore >= 420 ? 0.56 : 0.32);

        if (botLead >= 150) {
            chance *= 0.52;
        } else if (botLead >= 80) {
            chance *= 0.7;
        }

        return Math.random() < chance;
    }

    pickSoftenedHumanDice(player, naturalRoll) {
        const softenedDice = this.pickRiggedHumanDice(player);
        if (softenedDice === naturalRoll) {
            return naturalRoll;
        }

        const naturalEligiblePieces = this.getEligiblePiecesForRoll(player, naturalRoll);
        const softenedEligiblePieces = this.getEligiblePiecesForRoll(player, softenedDice);
        const naturalScore = naturalEligiblePieces.length
            ? Math.max(...naturalEligiblePieces.map((piece) => this.scoreHumanOpportunity(player, piece, naturalRoll)))
            : -400;
        const softenedScore = softenedEligiblePieces.length
            ? Math.max(...softenedEligiblePieces.map((piece) => this.scoreHumanOpportunity(player, piece, softenedDice)))
            : -400;

        if (softenedScore <= (naturalScore - 55)) {
            return softenedDice;
        }

        return naturalRoll;
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
        const piecesInBase = this.countPiecesInBase(player);
        const piecesOnBoard = this.countPiecesOnBoard(player);
        const immediateCaptureRisk = this.estimateImmediateCaptureRisk(player, projectedPosition);
        const pressureScore = this.estimatePressureScore(player, projectedPosition);
        const homeApproachBonus = this.getHomeApproachBonus(player, projectedPosition);
        const baseReleasePenalty = leavesBase && piecesOnBoard > 0 && captures === 0 && !reachesHome && !wouldWin
            ? (70 + (piecesInBase >= 2 ? 26 : 0) + (this.botConsecutiveSixes >= 1 ? 48 : 0))
            : 0;

        let score = progress * 2.5;
        if (leavesBase) score += piecesOnBoard === 0 ? 158 : 112;
        if (reachesHome) score += 320;
        if (captures > 0) score += 420 * captures;
        if (safeLanding) score += 56;
        if (diceValue === 6) score += 10;
        if (wouldWin) score += 2200;
        score += pressureScore;
        score += homeApproachBonus;
        score -= Math.floor(opponentBestNextRoll * 0.46);
        score -= Math.floor(immediateCaptureRisk * (safeLanding ? 0 : 1));
        score -= exposedPenalty;
        score -= baseReleasePenalty;
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
            const bestScore = rankedStrongMoves[0]?.score ?? 0;
            const finalPool = rankedStrongMoves.filter((item) => item.score >= (bestScore - 14));
            return this.pickWeightedOption(
                finalPool,
                (item) => Math.max(1, item.score - bestScore + 20),
            )?.piece ?? rankedStrongMoves[0]?.piece ?? eligiblePieces[0];
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

        const reachedHome = this.currentPositions[player][piece] === HOME_POSITIONS[player];
        const isKill = await this.checkForKill(player, piece);

        if(reachedHome || isKill || this.diceValue === 6) {
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
