export function renderGameBoard(game, chatLog, onMove) {
    const boardContainer = document.createElement('div');
    boardContainer.className = 'game-board-container';
    boardContainer.style.display = 'grid';
    boardContainer.style.gridTemplateColumns = 'repeat(8, 40px)';
    boardContainer.style.gridTemplateRows = 'repeat(8, 40px)';
    boardContainer.style.width = '320px';
    boardContainer.style.height = '320px';
    boardContainer.style.border = '2px solid #333';
    boardContainer.style.margin = '10px 0';
    boardContainer.style.userSelect = 'none';

    let selectedSquare = null;

    function render() {
        boardContainer.innerHTML = '';
        let boardState;
        if (game.type === 'chess') {
            boardState = game.getBoard(); // 8x8 array of {type, color} or null
        } else {
            boardState = game.board; // 8x8 array of ints
        }

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const square = document.createElement('div');
                const isLight = (r + c) % 2 === 0;
                square.style.backgroundColor = isLight ? '#f0d9b5' : '#b58863';
                square.style.display = 'flex';
                square.style.alignItems = 'center';
                square.style.justifyContent = 'center';
                square.style.fontSize = '24px';
                square.style.cursor = 'pointer';

                // Chess coords: a8 to h1. r=0, c=0 is a8.
                // a=0, b=1, etc. row = 8 - r.
                const algebraic = String.fromCharCode('a'.charCodeAt(0) + c) + (8 - r);
                square.dataset.r = r;
                square.dataset.c = c;
                square.dataset.alg = algebraic;

                if (selectedSquare === algebraic || (selectedSquare && selectedSquare.r === r && selectedSquare.c === c)) {
                    square.style.backgroundColor = '#f6f669'; // highlight
                }

                const pieceEl = document.createElement('span');
                let pieceStr = '';
                if (game.type === 'chess') {
                    const p = boardState[r][c];
                    if (p) {
                        const symbols = {
                            'w': { 'p': '♙', 'n': '♘', 'b': '♗', 'r': '♖', 'q': '♕', 'k': '♔' },
                            'b': { 'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚' }
                        };
                        pieceStr = symbols[p.color][p.type];
                        pieceEl.style.color = p.color === 'w' ? '#fff' : '#000';
                        pieceEl.style.textShadow = p.color === 'w' ? '0 0 1px #000' : '0 0 1px #fff';
                    }
                } else {
                    const p = boardState[r][c];
                    if (p !== 0) {
                        pieceStr = Math.abs(p) === 2 ? '♚' : '●';
                        pieceEl.style.color = p > 0 ? '#fff' : '#000';
                        pieceEl.style.textShadow = p > 0 ? '0 0 1px #000' : '0 0 1px #fff';
                    }
                }
                pieceEl.textContent = pieceStr;
                square.appendChild(pieceEl);

                square.onclick = () => {
                    if (selectedSquare) {
                        let moveResult = null;
                        if (game.type === 'chess') {
                            moveResult = game.move(selectedSquare, algebraic);
                        } else {
                            moveResult = game.move(selectedSquare.r, selectedSquare.c, r, c);
                        }

                        if (moveResult) {
                            selectedSquare = null;
                            render();
                            onMove(moveResult); // callback to send prompt
                        } else {
                            // Invalid move or selecting a new piece
                            if (game.type === 'chess') {
                                selectedSquare = algebraic;
                            } else {
                                selectedSquare = {r, c};
                            }
                            render();
                        }
                    } else {
                        if (game.type === 'chess') {
                            selectedSquare = algebraic;
                        } else {
                            selectedSquare = {r, c};
                        }
                        render();
                    }
                };
                boardContainer.appendChild(square);
            }
        }
    }

    render();

    // Append to a message wrapper
    const messageWrap = document.createElement('div');
    messageWrap.className = 'message-wrap assistant-msg';
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content game-board-message';
    messageContent.appendChild(boardContainer);
    messageWrap.appendChild(messageContent);
    
    chatLog.appendChild(messageWrap);
    chatLog.scrollTop = chatLog.scrollHeight;

    return {
        update: render
    };
}
