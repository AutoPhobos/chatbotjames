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
            return this.game.move(san.trim());
        } catch (e) {
            // Fallback: search for SAN-like tokens in the text
            const sanRegex = /\b(?:[NQKBR]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NQKBR])?[+#]?|O-O(?:-O)?)\b/g;
            const matches = san.match(sanRegex);
            if (matches) {
                for (const match of matches) {
                    try {
                        return this.game.move(match);
                    } catch(err) {}
                }
            }
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

/**
 * Checkers (English draughts) implementation.
 *
 * Board encoding: 0 = empty, 1 = white, 2 = white king, -1 = black, -2 = black king.
 * White starts at the bottom (rows 5–7) and moves up (dr = -1).
 * Black starts at the top (rows 0–2) and moves down (dr = +1).
 *
 * Rules implemented:
 *  - Forced capture: if any jump is available you must jump.
 *  - Multi-jump: after a capture, if the same piece can jump again the turn
 *    continues (mustJumpFrom tracks which piece must keep jumping).
 *  - King promotion: white reaching row 0, black reaching row 7.
 *  - Game over: current player has no legal moves (wins go to the other side).
 */
export class CheckersGame {
    constructor(state) {
        this.type = 'checkers';
        if (state) {
            this.board = JSON.parse(state.board);
            this.turn = state.turn;
            this.mustJumpFrom = state.mustJumpFrom || null; // {r,c} during a multi-jump sequence
        } else {
            this.reset();
        }
    }

    reset() {
        this.board = Array(8).fill(null).map(() => Array(8).fill(0));
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if ((r + c) % 2 !== 0) {
                    if (r < 3)      this.board[r][c] = -1; // Black
                    else if (r > 4) this.board[r][c] =  1; // White
                }
            }
        }
        this.turn = 'w';
        this.mustJumpFrom = null;
    }

    getTurn() {
        return this.turn;
    }

    getState() {
        return { board: JSON.stringify(this.board), turn: this.turn, mustJumpFrom: this.mustJumpFrom };
    }

    getFen() {
        let fen = '';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                fen += p === 0 ? '.' : p === 1 ? 'w' : p === 2 ? 'W' : p === -1 ? 'b' : 'B';
            }
            fen += '/';
        }
        return fen.slice(0, -1) + ' ' + this.turn;
    }

    // ── Internal helpers ────────────────────────────────────────────────────────

    /** All jump destinations from square (sr, sc). Does NOT check turn. */
    _getJumpsFrom(sr, sc) {
        const piece = this.board[sr][sc];
        if (piece === 0) return [];
        const isWhite = piece > 0;
        const isKing  = Math.abs(piece) === 2;
        const fwd     = isWhite ? -1 : 1;
        const rowDirs = isKing ? [-1, 1] : [fwd];
        const jumps   = [];

        for (const dr of rowDirs) {
            for (const dc of [-1, 1]) {
                const mr = sr + dr,     mc = sc + dc;
                const tr = sr + dr * 2, tc = sc + dc * 2;
                if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
                if (this.board[tr][tc] !== 0) continue;
                const mid = this.board[mr][mc];
                if (mid === 0) continue;
                if (isWhite && mid > 0) continue; // can't jump own piece
                if (!isWhite && mid < 0) continue;
                jumps.push({ r: tr, c: tc });
            }
        }
        return jumps;
    }

    /** All squares with at least one jump available for the current player. */
    _getAllJumps() {
        const result = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p === 0) continue;
                if (this.turn === 'w' && p < 0) continue;
                if (this.turn === 'b' && p > 0) continue;
                const targets = this._getJumpsFrom(r, c);
                if (targets.length > 0) result.push({ r, c, targets });
            }
        }
        return result;
    }

    /** All simple (non-jump) moves for the current player. */
    _getAllSimpleMoves() {
        const result = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p === 0) continue;
                if (this.turn === 'w' && p < 0) continue;
                if (this.turn === 'b' && p > 0) continue;
                const isKing = Math.abs(p) === 2;
                const fwd    = p > 0 ? -1 : 1;
                for (const dr of (isKing ? [-1, 1] : [fwd])) {
                    for (const dc of [-1, 1]) {
                        const tr = r + dr, tc = c + dc;
                        if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
                        if (this.board[tr][tc] !== 0) continue;
                        result.push({ r, c, tr, tc });
                    }
                }
            }
        }
        return result;
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    /**
     * Returns true if (sr,sc)→(tr,tc) is a legal move for the current player,
     * taking forced-capture and multi-jump rules into account.
     */
    isValidMove(sr, sc, tr, tc) {
        if (tr < 0 || tr > 7 || tc < 0 || tc > 7) return false;
        if (this.board[tr][tc] !== 0) return false;

        const piece = this.board[sr][sc];
        if (piece === 0) return false;
        const isWhite = piece > 0;
        if (isWhite && this.turn !== 'w') return false;
        if (!isWhite && this.turn !== 'b') return false;

        // Mid-multi-jump: only the piece that started the sequence may move.
        if (this.mustJumpFrom && (sr !== this.mustJumpFrom.r || sc !== this.mustJumpFrom.c)) return false;

        const dr = tr - sr;
        const dc = tc - sc;
        const isKing = Math.abs(piece) === 2;
        const fwd    = isWhite ? -1 : 1;

        const allJumps = this.mustJumpFrom
            ? [{ r: sr, c: sc, targets: this._getJumpsFrom(sr, sc) }].filter(j => j.targets.length)
            : this._getAllJumps();

        // Simple move — only allowed when no captures are available
        if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
            if (allJumps.length > 0) return false; // forced capture
            if (!isKing && dr !== fwd) return false;
            return true;
        }

        // Jump move
        if (Math.abs(dr) === 2 && Math.abs(dc) === 2) {
            if (!isKing && Math.sign(dr) !== fwd) return false;
            const mr  = sr + dr / 2;
            const mc  = sc + dc / 2;
            const mid = this.board[mr][mc];
            if (mid === 0) return false;
            if (isWhite && mid > 0) return false;
            if (!isWhite && mid < 0) return false;
            return true;
        }

        return false;
    }

    /**
     * Execute the move (sr,sc)→(tr,tc). Returns a result object on success, null on failure.
     * Handles captures, king promotion, multi-jump continuation, and turn switching.
     */
    move(sr, sc, tr, tc) {
        if (!this.isValidMove(sr, sc, tr, tc)) return null;

        const piece = this.board[sr][sc];
        this.board[sr][sc] = 0;
        this.board[tr][tc] = piece;

        const isWhite = piece > 0;
        const dr = tr - sr;
        let jumped = false;

        // Remove captured piece
        if (Math.abs(dr) === 2) {
            this.board[sr + dr / 2][sc + (tc - sc) / 2] = 0;
            jumped = true;
        }

        // King promotion (promote immediately, but can't continue jump as a king this turn)
        let promoted = false;
        if (isWhite && tr === 0 && piece === 1)  { this.board[tr][tc] = 2;  promoted = true; }
        if (!isWhite && tr === 7 && piece === -1) { this.board[tr][tc] = -2; promoted = true; }

        // Multi-jump check: can this same piece jump again?
        if (jumped && !promoted) {
            const furtherJumps = this._getJumpsFrom(tr, tc);
            if (furtherJumps.length > 0) {
                this.mustJumpFrom = { r: tr, c: tc };
                return { valid: true, jumped, multiJump: true };
            }
        }

        // End of turn
        this.mustJumpFrom = null;
        this.turn = this.turn === 'w' ? 'b' : 'w';
        return { valid: true, jumped, multiJump: false };
    }

    /**
     * Returns the list of legal destination squares from (sr,sc) for UI highlighting.
     * Respects forced-capture and multi-jump constraints.
     */
    getValidMovesFrom(sr, sc) {
        const piece = this.board[sr][sc];
        if (piece === 0) return [];
        const isWhite = piece > 0;
        if (isWhite && this.turn !== 'w') return [];
        if (!isWhite && this.turn !== 'b') return [];

        // During multi-jump only the locked piece may move
        if (this.mustJumpFrom && (sr !== this.mustJumpFrom.r || sc !== this.mustJumpFrom.c)) return [];

        const allJumps = this.mustJumpFrom
            ? [{ r: sr, c: sc, targets: this._getJumpsFrom(sr, sc) }].filter(j => j.targets.length)
            : this._getAllJumps();

        if (allJumps.length > 0) {
            const mine = allJumps.find(j => j.r === sr && j.c === sc);
            return mine ? mine.targets : [];
        }

        // Simple moves
        const isKing = Math.abs(piece) === 2;
        const fwd    = isWhite ? -1 : 1;
        const dests  = [];
        for (const dr of (isKing ? [-1, 1] : [fwd])) {
            for (const dc of [-1, 1]) {
                const tr = sr + dr, tc = sc + dc;
                if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
                if (this.board[tr][tc] !== 0) continue;
                dests.push({ r: tr, c: tc });
            }
        }
        return dests;
    }

    /** True when the current player has no legal moves (they lose). */
    isGameOver() {
        if (this._getAllJumps().length > 0) return false;
        return this._getAllSimpleMoves().length === 0;
    }

    /** Returns 'w' or 'b' (the winner), or null if the game is still ongoing. */
    getWinner() {
        if (!this.isGameOver()) return null;
        return this.turn === 'w' ? 'b' : 'w'; // the player who can't move loses
    }

    /**
     * Parse a move from an AI string such as:
     *   "5,2 to 4,3"  |  "5 2 to 4 3"  |  "row 5 col 2 to row 4 col 3"
     *   "(5,2) -> (4,3)"  |  "5,2-4,3"
     */
    makeSanMove(san) {
        const match = san.match(/(\d+)\s*[,:]?\s*(\d+)\s*(?:to|->|-|→|\s+)\s*(\d+)\s*[,:]?\s*(\d+)/i);
        if (match) {
            const sr = parseInt(match[1]), sc = parseInt(match[2]);
            const tr = parseInt(match[3]), tc = parseInt(match[4]);
            return this.move(sr, sc, tr, tc);
        }
        return null;
    }
}
