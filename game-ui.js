/**
 * renderGameBoard
 * Renders an interactive 8×8 board for either a ChessGame or CheckersGame.
 *
 * Features:
 *  - Chess: highlights selected square + all legal destination squares (via chess.js).
 *  - Checkers: highlights selected square + all legal destinations (respects forced-
 *    capture and multi-jump rules). The piece locked into a multi-jump sequence
 *    is visually indicated.
 *  - Better checkers piece symbols: regular piece = ⬤, king = ♛.
 *  - game-over banner shown inside the board container.
 */
export function renderGameBoard(game, chatLog, onMove) {
    const boardContainer = document.createElement('div');
    boardContainer.className = 'game-board-container';
    boardContainer.style.cssText = `
        display: grid;
        grid-template-columns: repeat(8, 44px);
        grid-template-rows: repeat(8, 44px);
        width: 352px;
        height: 352px;
        border: 2px solid #555;
        border-radius: 4px;
        margin: 10px 0;
        user-select: none;
        position: relative;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    `;

    let selectedSquare = null; // chess: algebraic string; checkers: {r,c}

    // ── Chess piece symbols ─────────────────────────────────────────────────────
    const CHESS_SYMBOLS = {
        w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
        b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
    };

    // ── Checkers piece symbols ──────────────────────────────────────────────────
    // Regular piece = filled circle, King = crown (♛)
    const CHECKERS_SYMBOL = { regular: '⬤', king: '♛' };

    function render() {
        boardContainer.innerHTML = '';

        // Compute valid destinations for the selected square (for highlighting)
        let validDests = new Set(); // "r,c" strings for checkers; algebraic for chess

        if (selectedSquare !== null) {
            if (game.type === 'chess') {
                const moves = game.getValidMoves(selectedSquare);
                moves.forEach(m => validDests.add(m.to));
            } else {
                // Checkers
                const sr = selectedSquare.r, sc = selectedSquare.c;
                game.getValidMovesFrom(sr, sc).forEach(d => validDests.add(`${d.r},${d.c}`));
            }
        }

        // Determine the square locked into a multi-jump (checkers only)
        const mustKey = (game.type === 'checkers' && game.mustJumpFrom)
            ? `${game.mustJumpFrom.r},${game.mustJumpFrom.c}` : null;

        const boardState = game.type === 'chess' ? game.getBoard() : game.board;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const square = document.createElement('div');
                const isLight = (r + c) % 2 === 0;

                // Base board colour
                square.style.cssText = `
                    background-color: ${isLight ? '#f0d9b5' : '#b58863'};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 26px;
                    cursor: pointer;
                    position: relative;
                    transition: background-color 0.12s;
                `;

                const algebraic = String.fromCharCode('a'.charCodeAt(0) + c) + (8 - r);
                const ckKey     = `${r},${c}`;

                square.dataset.r   = r;
                square.dataset.c   = c;
                square.dataset.alg = algebraic;

                // ── Highlight logic ───────────────────────────────────────────
                const isSelected = game.type === 'chess'
                    ? selectedSquare === algebraic
                    : selectedSquare && selectedSquare.r === r && selectedSquare.c === c;

                const isDest = game.type === 'chess'
                    ? validDests.has(algebraic)
                    : validDests.has(ckKey);

                const isMustJump = mustKey === ckKey;

                if (isSelected) {
                    square.style.backgroundColor = '#f6f669';
                } else if (isMustJump && !selectedSquare) {
                    // Pulse the piece that's locked in a multi-jump
                    square.style.backgroundColor = '#ffe066';
                    square.style.boxShadow = 'inset 0 0 0 2px #e6a800';
                }

                // ── Valid-move dot / capture highlight ────────────────────────
                if (isDest) {
                    const dot = document.createElement('div');
                    const hasPiece = game.type === 'chess'
                        ? boardState[r][c] !== null
                        : boardState[r][c] !== 0;

                    if (hasPiece) {
                        // Capture ring
                        dot.style.cssText = `
                            position: absolute; inset: 0;
                            border-radius: 0;
                            box-shadow: inset 0 0 0 3px rgba(0,0,0,0.35);
                            pointer-events: none;
                        `;
                    } else {
                        // Move dot
                        dot.style.cssText = `
                            position: absolute;
                            width: 28%;
                            height: 28%;
                            border-radius: 50%;
                            background: rgba(0,0,0,0.25);
                            pointer-events: none;
                        `;
                    }
                    square.appendChild(dot);
                }

                // ── Piece rendering ───────────────────────────────────────────
                const pieceEl = document.createElement('span');
                pieceEl.style.cssText = 'position: relative; z-index: 1; line-height: 1;';

                if (game.type === 'chess') {
                    const p = boardState[r][c];
                    if (p) {
                        pieceEl.textContent = CHESS_SYMBOLS[p.color][p.type];
                        pieceEl.style.color      = p.color === 'w' ? '#fff' : '#000';
                        pieceEl.style.textShadow = p.color === 'w'
                            ? '0 0 2px #000, 0 0 2px #000'
                            : '0 0 2px #fff';
                    }
                } else {
                    const p = boardState[r][c];
                    if (p !== 0) {
                        const isKing = Math.abs(p) === 2;
                        pieceEl.textContent = isKing ? CHECKERS_SYMBOL.king : CHECKERS_SYMBOL.regular;
                        pieceEl.style.fontSize   = isKing ? '22px' : '28px';
                        pieceEl.style.color      = p > 0 ? '#f0f0f0' : '#1a1a1a';
                        pieceEl.style.textShadow = p > 0
                            ? '0 0 2px #000, 0 0 2px #000'
                            : '0 0 2px #fff, 0 0 2px #fff';
                    }
                }
                square.appendChild(pieceEl);

                // ── Click handler ─────────────────────────────────────────────
                square.onclick = () => {
                    if (selectedSquare !== null) {
                        let moveResult = null;

                        if (game.type === 'chess') {
                            moveResult = game.move(selectedSquare, algebraic);
                        } else {
                            moveResult = game.move(selectedSquare.r, selectedSquare.c, r, c);
                        }

                        if (moveResult) {
                            // Successful move
                            if (game.type === 'checkers' && moveResult.multiJump) {
                                // Stay in multi-jump: keep selection on the jumping piece
                                selectedSquare = { r, c };
                            } else {
                                selectedSquare = null;
                            }
                            render();
                            if (!moveResult.multiJump) {
                                onMove(moveResult); // notify app.js only when the full turn is done
                            }
                        } else {
                            // Invalid move → try to select the clicked square instead
                            if (game.type === 'chess') {
                                selectedSquare = boardState[r][c] ? algebraic : null;
                            } else {
                                selectedSquare = boardState[r][c] !== 0 ? { r, c } : null;
                            }
                            render();
                        }
                    } else {
                        // Nothing selected — select clicked square (only own pieces)
                        let isOwnPiece = false;
                        if (game.type === 'chess') {
                            const p = boardState[r][c];
                            isOwnPiece = p && p.color === game.getTurn();
                        } else {
                            const p = boardState[r][c];
                            isOwnPiece = p !== 0 && ((game.turn === 'w' && p > 0) || (game.turn === 'b' && p < 0));
                        }

                        if (isOwnPiece) {
                            if (game.type === 'chess') {
                                selectedSquare = algebraic;
                            } else {
                                // Don't allow selecting a different piece during multi-jump
                                if (!game.mustJumpFrom || (game.mustJumpFrom.r === r && game.mustJumpFrom.c === c)) {
                                    selectedSquare = { r, c };
                                }
                            }
                            render();
                        }
                    }
                };

                boardContainer.appendChild(square);
            }
        }

        // ── Game-over overlay (checkers only; chess handled by chess.js) ───────
        if (game.type === 'checkers' && game.isGameOver()) {
            const winner = game.getWinner();
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: absolute; inset: 0;
                background: rgba(0,0,0,0.65);
                display: flex; align-items: center; justify-content: center;
                z-index: 10; border-radius: 2px;
            `;
            const banner = document.createElement('div');
            banner.style.cssText = `
                color: #fff;
                font-size: 1.3em;
                font-weight: bold;
                text-align: center;
                padding: 12px 20px;
                background: rgba(0,0,0,0.5);
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.2);
            `;
            banner.textContent = winner === 'w' ? '⬤ White wins! 🎉' : '⬤ Black wins! 🎉';
            overlay.appendChild(banner);
            boardContainer.appendChild(overlay);
        }
    }

    render();

    // Wrap and append to chat
    const messageWrap = document.createElement('div');
    messageWrap.className = 'message-wrap assistant-msg';
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content game-board-message';
    messageContent.appendChild(boardContainer);
    messageWrap.appendChild(messageContent);
    chatLog.appendChild(messageWrap);
    chatLog.scrollTop = chatLog.scrollHeight;

    return { update: render };
}
