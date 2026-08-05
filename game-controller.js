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
        if (window.renderChatLog) {
            window.renderChatLog();
        } else {
            this.refreshGameBoardUI();
        }
    }

    refreshGameBoardUI() {
        const boardWrapper = document.getElementById('liveGameView');
        if (!boardWrapper) return;

        if (this.activeGame) {
            boardWrapper.innerHTML = '';
            boardWrapper.style.display = 'flex';
            boardWrapper.style.justifyContent = 'center';
            this.activeGameUI = renderGameBoard(this.activeGame, boardWrapper, (moveResult) => {
                // When user clicks to make a move, populate the input and send it
                if (moveResult && moveResult.notation && window.uiManager && window.uiManager.cmdInput && window.sendMessage) {
                    window.uiManager.cmdInput.value = moveResult.notation;
                    window.sendMessage();
                }
            });
        } else {
            boardWrapper.style.display = 'none';
            boardWrapper.innerHTML = '';
            this.activeGameUI = null;
        }
    }

    handleGameMove(moveInfo, addSystemMessageCallback, setIdleStateCallback, queryModelCallback, skipUIUpdate = false) {
        if (!this.activeGame) return;

        let notation = moveInfo.notation || moveInfo.san;
        const actualMove = moveInfo.move || moveInfo;
        
        if (this.activeGameUI && !skipUIUpdate) {
            this.activeGameUI.update(notation);
        }

        const isPromotion = actualMove.promotion || (actualMove.flags && actualMove.flags.includes('p'));
        const isJump = actualMove.jumped || actualMove.multiJump;

        if (isPromotion || isJump) {
            playGameBuffSound();
        } else {
            playGameMoveSound();
        }

        let isGameOver = false;
        let result = null;
        let isWin = false;

        if (this.activeGame.type === 'chess' && this.activeGame.game.isGameOver()) {
            isGameOver = true;
            if (this.activeGame.game.isCheckmate()) {
                result = this.activeGame.getTurn() === 'w' ? '0-1' : '1-0';
                isWin = result === '1-0';
            } else {
                result = '1/2-1/2';
                isWin = false; // draw
            }
        } else if (this.activeGame.type === 'checkers' && this.activeGame.isGameOver()) {
            isGameOver = true;
            result = this.activeGame.getWinner() === 'w' ? '1-0' : '0-1';
            isWin = result === '1-0';
        }

        if (isGameOver) {
            if (isWin) playGameWinSound();
            else playGameLoseSound();
            
            if (addSystemMessageCallback) addSystemMessageCallback(`[Game Over] ${result || 'Draw'}`);
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
        
        playGameBuffSound();

        const boardName = gameType === 'checkers' ? 'Checkers Board' : 'FEN';
        if (addSystemMessageCallback) {
            addSystemMessageCallback(`[System]: ${gameType} started. Current ${boardName}: ${this.activeGame.getFen()}. You are Black. User is White. Please make the first move using the make_move tool.`);
        }
        
        if (window.renderChatLog) {
            window.renderChatLog();
        } else {
            this.refreshGameBoardUI();
        }
        if (queryModelCallback) queryModelCallback();
    }

    handleMakeMove(params, addSystemMessageCallback, setIdleStateCallback, queryModelCallback) {
        if (!this.activeGame) {
            const err = `[System]: Failed to make move. No active game. Please start a game first using start_game.`;
            if (addSystemMessageCallback) addSystemMessageCallback(err);
            if (queryModelCallback) queryModelCallback();
            return { success: false, error: err };
        }

        try {
            const moveInfo = this.activeGame.move(params.move);
            if (!moveInfo) {
                const err = `[System]: Failed to make move ${params.move}. Invalid move.`;
                if (addSystemMessageCallback) addSystemMessageCallback(err);
                if (queryModelCallback) queryModelCallback();
                return { success: false, error: err };
            }
            this.handleGameMove(moveInfo, addSystemMessageCallback, setIdleStateCallback, queryModelCallback);
            if (this.onGameStateChange) this.onGameStateChange();
            return { success: true };
        } catch (e) {
            const err = `[System]: Failed to make move ${params.move}. Error: ${e.message}`;
            if (addSystemMessageCallback) addSystemMessageCallback(err);
            if (queryModelCallback) queryModelCallback();
            return { success: false, error: err };
        }
    }

    parseUserMove(text) {
        if (!this.activeGame) return null;
        return parseUserMove(text, this.activeGame);
    }
}

export const gameController = new GameController();
