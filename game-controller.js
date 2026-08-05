import { ChessGame, CheckersGame, parseUserMove } from './game-logic.js';
import { renderGameBoard } from './game-ui.js';
import {
    playGameMoveSound,
    playGameWinSound,
    playGameLoseSound,
    playGameBuffSound
} from './audio-wakelock.js';

class GameController {
    constructor() {
        this.activeGame = null;
        this.activeGameUI = null;
        this.onGameStateChange = null; // Callback for when game state changes (e.g. to persist chat)
    }

    getGameState() {
        if (this.activeGame) {
            return { type: this.activeGame.type, state: this.activeGame.getState() };
        }
        return null;
    }

    restoreGameState(gameState) {
        if (gameState) {
            if (gameState.type === 'checkers') {
                this.activeGame = new CheckersGame(gameState.state);
            } else {
                this.activeGame = new ChessGame(gameState.state.fen, gameState.state.moveHistory);
            }
        } else {
            this.activeGame = null;
            this.activeGameUI = null;
        }
        this.refreshGameBoardUI();
    }

    closeActiveGame(addSystemMessageCallback) {
        this.activeGame = null;
        this.activeGameUI = null;
        if (addSystemMessageCallback) {
            addSystemMessageCallback('[Game Closed]');
        }
        this.refreshGameBoardUI();
    }

    refreshGameBoardUI() {
        const boardWrapper = document.getElementById('liveGameView');
        if (!boardWrapper) return;

        if (this.activeGame) {
            boardWrapper.innerHTML = '';
            boardWrapper.style.display = 'flex';
            boardWrapper.style.justifyContent = 'center';
            this.activeGameUI = renderGameBoard(this.activeGame, boardWrapper);
        } else {
            boardWrapper.style.display = 'none';
            boardWrapper.innerHTML = '';
            this.activeGameUI = null;
        }
    }

    handleGameMove(moveInfo, addSystemMessageCallback, setIdleStateCallback, queryModelCallback) {
        if (!this.activeGame) return;

        const { moveObj, fen, isCheckmate, isDraw, result } = moveInfo;
        
        if (this.activeGameUI) {
            this.activeGameUI.update(moveObj.san || moveInfo.notation);
        }

        if (moveObj.promotion || moveObj.jump || moveObj.multiJump) {
            playGameBuffSound();
        } else {
            playGameMoveSound();
        }

        if (isCheckmate || isDraw) {
            if (result === '1-0') playGameWinSound();
            else playGameLoseSound();
            
            if (addSystemMessageCallback) addSystemMessageCallback(`[Game Over] ${result}`);
            if (setIdleStateCallback) setIdleStateCallback(false);
            if (queryModelCallback) queryModelCallback();
        }
    }

    handleStartGame(params, addSystemMessageCallback, queryModelCallback) {
        const gameType = (params.game || 'chess').toLowerCase();
        
        if (gameType === 'checkers') {
            this.activeGame = new CheckersGame();
        } else {
            this.activeGame = new ChessGame();
        }
        
        this.refreshGameBoardUI();
        playGameBuffSound();

        const boardName = gameType === 'checkers' ? 'Checkers Board' : 'FEN';
        if (addSystemMessageCallback) addSystemMessageCallback(`[System]: ${gameType} started. Current ${boardName}: ${this.activeGame.getFen()}. You are Black. User is White. Please make the first move using the make_move tool.`);
        if (queryModelCallback) queryModelCallback();
    }

    handleMakeMove(params, addSystemMessageCallback, setIdleStateCallback, queryModelCallback) {
        if (!this.activeGame) {
            if (addSystemMessageCallback) addSystemMessageCallback(`[System]: Failed to make move. No active game. Please start a game first using start_game.`);
            if (queryModelCallback) queryModelCallback();
            return;
        }

        try {
            const moveInfo = this.activeGame.move(params.move);
            if (!moveInfo) {
                if (addSystemMessageCallback) addSystemMessageCallback(`[System]: Failed to make move ${params.move}. Invalid move.`);
                if (queryModelCallback) queryModelCallback();
                return;
            }
            this.handleGameMove(moveInfo, addSystemMessageCallback, setIdleStateCallback, queryModelCallback);
            if (this.onGameStateChange) this.onGameStateChange();
        } catch (e) {
            if (addSystemMessageCallback) addSystemMessageCallback(`[System]: Failed to make move ${params.move}. Error: ${e.message}`);
            if (queryModelCallback) queryModelCallback();
        }
    }

    parseUserMove(text) {
        if (!this.activeGame) return null;
        return parseUserMove(text, this.activeGame);
    }
}

export const gameController = new GameController();
