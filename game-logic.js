import { Chess } from 'https://esm.sh/chess.js';

export class ChessGame {
    constructor(fen) {
        this.game = new Chess(fen);
        this.type = 'chess';
    }

    getFen() {
        return this.game.fen();
    }

    getBoard() {
        return this.game.board(); // 2D array
    }

    getTurn() {
        return this.game.turn(); // 'w' or 'b'
    }

    move(source, target, promotion = 'q') {
        try {
            const result = this.game.move({
                from: source,
                to: target,
                promotion: promotion // always promote to queen for simplicity
            });
            return result;
        } catch (e) {
            return null;
        }
    }

    makeSanMove(san) {
        try {
            return this.game.move(san);
        } catch (e) {
            return null;
        }
    }

    isGameOver() {
        return this.game.isGameOver();
    }

    getValidMoves(square) {
        return this.game.moves({ square, verbose: true });
    }
}

export class CheckersGame {
    // Basic Checkers implementation
    // Board is 8x8. 0 = empty, 1 = white, 2 = white king, -1 = black, -2 = black king
    // White is at the bottom (rows 5,6,7), Black is at the top (rows 0,1,2).
    // White moves up (row - 1), Black moves down (row + 1).
    constructor(state) {
        this.type = 'checkers';
        if (state) {
            this.board = JSON.parse(state.board);
            this.turn = state.turn;
        } else {
            this.reset();
        }
    }

    reset() {
        this.board = Array(8).fill(null).map(() => Array(8).fill(0));
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if ((r + c) % 2 !== 0) {
                    if (r < 3) this.board[r][c] = -1; // Black
                    else if (r > 4) this.board[r][c] = 1; // White
                }
            }
        }
        this.turn = 'w';
    }

    getState() {
        return JSON.stringify({ board: JSON.stringify(this.board), turn: this.turn });
    }

    getFen() {
        // A simple text representation for the AI
        let fen = "";
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                fen += p === 0 ? '.' : p === 1 ? 'w' : p === 2 ? 'W' : p === -1 ? 'b' : 'B';
            }
            fen += "/";
        }
        return fen.slice(0, -1) + " " + this.turn;
    }

    isValidMove(sr, sc, tr, tc) {
        if (tr < 0 || tr > 7 || tc < 0 || tc > 7) return false;
        if (this.board[tr][tc] !== 0) return false;

        const piece = this.board[sr][sc];
        const isWhite = piece > 0;
        if (isWhite && this.turn !== 'w') return false;
        if (!isWhite && this.turn !== 'b') return false;

        const dr = tr - sr;
        const dc = tc - sc;

        const isKing = Math.abs(piece) === 2;
        const forward = isWhite ? -1 : 1;

        // Simple move
        if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
            if (!isKing && dr !== forward) return false;
            return true;
        }

        // Jump move
        if (Math.abs(dr) === 2 && Math.abs(dc) === 2) {
            if (!isKing && Math.sign(dr) !== forward) return false;
            const mr = sr + dr / 2;
            const mc = sc + dc / 2;
            const midPiece = this.board[mr][mc];
            if (midPiece === 0) return false;
            if (isWhite && midPiece > 0) return false; // jumping own
            if (!isWhite && midPiece < 0) return false;
            return true;
        }

        return false;
    }

    move(sr, sc, tr, tc) {
        if (!this.isValidMove(sr, sc, tr, tc)) return null;
        
        const piece = this.board[sr][sc];
        this.board[sr][sc] = 0;
        this.board[tr][tc] = piece;

        const isWhite = piece > 0;
        const dr = tr - sr;
        let jumped = false;

        if (Math.abs(dr) === 2) {
            this.board[sr + dr / 2][sc + (tc - sc) / 2] = 0;
            jumped = true;
        }

        // King promotion
        if (isWhite && tr === 0 && piece === 1) this.board[tr][tc] = 2;
        if (!isWhite && tr === 7 && piece === -1) this.board[tr][tc] = -2;

        this.turn = this.turn === 'w' ? 'b' : 'w';
        return { valid: true, jumped };
    }

    makeSanMove(san) {
        // e.g., "1,2 to 2,3"
        const match = san.match(/(\d)[,\s]*(\d)\s*(?:to|-)?\s*(\d)[,\s]*(\d)/);
        if (match) {
            const sr = parseInt(match[1]), sc = parseInt(match[2]);
            const tr = parseInt(match[3]), tc = parseInt(match[4]);
            if (this.move(sr, sc, tr, tc)) return true;
        }
        return null;
    }
}
