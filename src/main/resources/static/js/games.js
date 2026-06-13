// --- GAME HUB LOGIC ---
let isGameActive = false;
let currentGameType = null;
let gameOpponent = null;

// Best of Three State
let myScore = 0;
let opponentScore = 0;
let roundNumber = 1;
let matchStarter = false;

// Tic-Tac-Toe State
let currentGameState = ['', '', '', '', '', '', '', '', ''];
let myGameSymbol = 'X';
let isMyTurn = false;

// Connect 4 State
let c4GameState = Array(6).fill().map(() => Array(7).fill(''));
let myC4Color = 'red';


// Dots and Boxes State
let dbHlines = Array(4).fill().map(() => Array(3).fill(0));
let dbVlines = Array(3).fill().map(() => Array(4).fill(0));
let dbBoxes = Array(3).fill().map(() => Array(3).fill(0));
let myDbScore = 0;
let oppDbScore = 0;

// Checkers State
let chkBoard = [];
let chkSelected = null;
let chkValidMoves = [];
let myChkColor = 'r';
let chkMyPieces = 12;
let chkOppPieces = 12;

// Spinning Wheel State
let wheelMyItems = [];
let wheelOppItems = [];
let wheelCombinedItems = [];
let wheelMyItemsSubmitted = false;
let wheelOppItemsSubmitted = false;

// RPS State
let myRpsChoice = null;
let opponentRpsChoice = null;

function openGameSelectionModal() {
    if (!currentChatUser) return;
    document.getElementById('game-selection-modal').classList.remove('hidden');
}

async function sendGameMessage(type, payload = {}) {
    if (!gameOpponent) return;
    
    let recipientPubKey = userPublicKeys[gameOpponent];
    if (!recipientPubKey) {
        try {
            const response = await fetch(`/api/auth/keys/${gameOpponent}`, {
                headers: { 'Authorization': 'Bearer ' + jwtToken }
            });
            if (response.ok) {
                const data = await response.json();
                recipientPubKey = await CryptoUtils.importPublicKey(data.publicKey);
                userPublicKeys[gameOpponent] = recipientPubKey;
            }
        } catch (e) { console.error(e); }
    }
    
    if (!recipientPubKey) {
        alert("Could not fetch recipient's key for game.");
        return;
    }
    
    const message = { type, ...payload };
    try {
        const encryptedPayload = await CryptoUtils.encryptMessage(JSON.stringify(message), recipientPubKey);
        stompClient.send("/app/chat", {}, JSON.stringify({
            recipientId: gameOpponent,
            senderId: currentUsername,
            encryptedPayload: encryptedPayload
        }));
    } catch (e) {
        console.error("Game message encryption failed", e);
    }
}

function sendGameInvite(gameType) {
    document.getElementById('game-selection-modal').classList.add('hidden');
    gameOpponent = currentChatUser;
    currentGameType = gameType;
    myScore = 0;
    opponentScore = 0;
    roundNumber = 1;
    matchStarter = true;
    sendGameMessage('GAME_INVITE', { gameType: gameType });
    appendMessage("🎮 Sent " + gameType + " invite to " + gameOpponent, 'system-message');
}

function handleGameMessage(senderId, data) {
    if (data.type === 'GAME_INVITE') {
        currentGameType = data.gameType;
        document.getElementById('game-challenger-name').textContent = senderId;
        document.getElementById('incoming-game-type').textContent = data.gameType;
        document.getElementById('game-challenger-avatar').textContent = senderId.charAt(0).toUpperCase();
        document.getElementById('incoming-game-modal').classList.remove('hidden');
        gameOpponent = senderId;
    } else if (data.type === 'GAME_ACCEPT') {
        appendMessage("🎮 " + senderId + " accepted your game invite!", 'system-message');
        openGameUI();
    } else if (data.type === 'GAME_REJECT') {
        appendMessage("🎮 " + senderId + " declined your game invite.", 'system-message');
        gameOpponent = null;
        currentGameType = null;
    } else if (data.type === 'GAME_MOVE') {
        processRemoteMove(data.cellIndex);
    } else if (data.type === 'GAME_C4_MOVE') {
        processRemoteC4Move(data.col);

    } else if (data.type === 'GAME_DB_MOVE') {
        processRemoteDbMove(data.typeLine, data.r, data.c);
    } else if (data.type === 'GAME_CHK_MOVE') {
        processRemoteChkMove(data.fr, data.fc, data.tr, data.tc, data.isJump, data.jumpR, data.jumpC);
    } else if (data.type === 'GAME_WHEEL_ITEMS') {
        processRemoteWheelItems(data.items);
    } else if (data.type === 'GAME_WHEEL_SPIN') {
        processRemoteWheelSpin(data.degrees, data.resultItem);
    } else if (data.type === 'GAME_RPS_MOVE') {
        opponentRpsChoice = data.choice;
        checkRpsResult();
    } else if (data.type === 'GAME_COIN_FLIP') {
        processRemoteCoinFlip(data.callerChoice, data.result);
    } else if (data.type === 'GAME_END') {
        closeGameUI();
        alert("The game was closed by " + senderId);
        appendMessage("🎮 Game ended by " + senderId, 'system-message');
    }
}

function acceptGame() {
    document.getElementById('incoming-game-modal').classList.add('hidden');
    myScore = 0;
    opponentScore = 0;
    roundNumber = 1;
    matchStarter = false;
    sendGameMessage('GAME_ACCEPT');
    openGameUI();
}

function rejectGame() {
    document.getElementById('incoming-game-modal').classList.add('hidden');
    sendGameMessage('GAME_REJECT');
    gameOpponent = null;
    currentGameType = null;
}

function openGameUI() {
    document.getElementById('game-overlay').classList.remove('hidden');
    document.getElementById('game-scoreboard').classList.remove('hidden');
    setupRound();
}

function setupRound() {
    isGameActive = true;
    document.getElementById('my-score-label').textContent = 'You: ' + myScore;
    document.getElementById('opponent-score-label').textContent = 'Opponent: ' + opponentScore;
    
    // Determine turn and TTT symbol based on round logic
    if (matchStarter) {
        isMyTurn = (roundNumber % 2 !== 0); // Starter goes first on odd rounds
    } else {
        isMyTurn = (roundNumber % 2 === 0); // Acceptor goes first on even rounds
    }
    
    if (currentGameType === 'Tic-Tac-Toe') {
        myGameSymbol = isMyTurn ? 'X' : 'O';
    } else if (currentGameType === 'Connect 4') {
        myC4Color = isMyTurn ? 'red' : 'yellow';
    }

    // Hide all boards first
    document.getElementById('tic-tac-toe-board').classList.add('hidden');
    document.getElementById('c4-board').classList.add('hidden');

    document.getElementById('db-board').classList.add('hidden');
    document.getElementById('chk-board').classList.add('hidden');
    document.getElementById('wheel-board').classList.add('hidden');
    document.getElementById('rps-board').classList.add('hidden');
    document.getElementById('coin-toss-board').classList.add('hidden');
    
    document.getElementById('game-status').textContent = currentGameType + " - Round " + roundNumber;
    
    if (currentGameType === 'Tic-Tac-Toe') {
        currentGameState = ['', '', '', '', '', '', '', '', ''];
        document.getElementById('tic-tac-toe-board').classList.remove('hidden');
        renderBoard();
        updateGameStatus();
    } else if (currentGameType === 'Connect 4') {
        c4GameState = Array(6).fill().map(() => Array(7).fill(''));
        document.getElementById('c4-board').classList.remove('hidden');
        renderC4Board();
        updateC4GameStatus();

    } else if (currentGameType === 'Dots and Boxes') {
        dbHlines = Array(4).fill().map(() => Array(3).fill(0));
        dbVlines = Array(3).fill().map(() => Array(4).fill(0));
        dbBoxes = Array(3).fill().map(() => Array(3).fill(0));
        myDbScore = 0;
        oppDbScore = 0;
        document.getElementById('db-board').classList.remove('hidden');
        renderDbBoard();
        updateDbGameStatus();
    } else if (currentGameType === 'Checkers') {
        chkBoard = Array(8).fill().map(() => Array(8).fill(''));
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 8; c++) {
                if ((r + c) % 2 === 1) chkBoard[r][c] = 'b';
            }
        }
        for (let r = 5; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if ((r + c) % 2 === 1) chkBoard[r][c] = 'r';
            }
        }
        myChkColor = isMyTurn ? 'r' : 'b';
        chkSelected = null;
        chkValidMoves = [];
        chkMyPieces = 12;
        chkOppPieces = 12;
        document.getElementById('chk-board').classList.remove('hidden');
        renderChkBoard();
        updateChkGameStatus();
    } else if (currentGameType === 'Spinning Wheel') {
        document.getElementById('wheel-board').classList.remove('hidden');
        if (roundNumber === 1) {
            wheelMyItemsSubmitted = false;
            wheelOppItemsSubmitted = false;
            document.getElementById('wheel-setup-phase').classList.remove('hidden');
            document.getElementById('wheel-play-phase').classList.add('hidden');
            document.getElementById('wheel-item-1').value = '';
            document.getElementById('wheel-item-2').value = '';
            document.getElementById('wheel-item-3').value = '';
            document.getElementById('game-status').textContent = "Setup: Enter your 3 options";
        } else {
            document.getElementById('wheel-setup-phase').classList.add('hidden');
            document.getElementById('wheel-play-phase').classList.remove('hidden');
            document.getElementById('wheel').style.transform = 'rotate(0deg)';
            document.getElementById('wheel').style.transition = 'none';
            void document.getElementById('wheel').offsetWidth; // force reflow
            document.getElementById('wheel').style.transition = 'transform 3s cubic-bezier(0.25, 0.1, 0.25, 1)';
            updateWheelGameStatus();
        }
    } else if (currentGameType === 'Rock Paper Scissors') {
        myRpsChoice = null;
        opponentRpsChoice = null;
        document.getElementById('rps-board').classList.remove('hidden');
        document.getElementById('rps-buttons').classList.remove('hidden');
        document.getElementById('rps-result').classList.add('hidden');
        document.getElementById('game-status').textContent = "Round " + roundNumber + ": Make your choice!";
    } else if (currentGameType === 'Heads or Tails') {
        document.getElementById('coin-toss-board').classList.remove('hidden');
        const coin = document.getElementById('coin');
        coin.className = 'coin'; // reset flip
        
        if (isMyTurn) {
            document.getElementById('game-status').textContent = "Round " + roundNumber + ": Call it!";
            document.getElementById('coin-controls').classList.remove('hidden');
        } else {
            document.getElementById('game-status').textContent = "Round " + roundNumber + ": Waiting for opponent to call...";
            document.getElementById('coin-controls').classList.add('hidden');
        }
    }
}

function handleRoundEnd(result, winMessage) {
    if (result === 'win') myScore++;
    else if (result === 'lose') opponentScore++;
    
    document.getElementById('game-status').textContent = winMessage;
    document.getElementById('my-score-label').textContent = 'You: ' + myScore;
    document.getElementById('opponent-score-label').textContent = 'Opponent: ' + opponentScore;
    
    isGameActive = false;
    
    if (myScore >= 2 || opponentScore >= 2) {
        // Match Over
        const finalMsg = myScore >= 2 ? "Match Over: You Won the Best of 3! 🏆" : "Match Over: You Lost the Best of 3. 😔";
        setTimeout(() => {
            document.getElementById('game-status').textContent = finalMsg;
        }, 1500);
    } else {
        // Next round
        roundNumber++;
        setTimeout(() => {
            document.getElementById('game-status').textContent = "Next round starting...";
            setTimeout(() => {
                setupRound();
            }, 1500);
        }, 2000);
    }
}

function closeGame() {
    sendGameMessage('GAME_END');
    closeGameUI();
}

function closeGameUI() {
    isGameActive = false;
    document.getElementById('game-overlay').classList.add('hidden');
    gameOpponent = null;
    currentGameType = null;
}

// --- TIC-TAC-TOE LOGIC ---
function makeMove(index) {
    if (!isGameActive || !isMyTurn || currentGameState[index] !== '' || currentGameType !== 'Tic-Tac-Toe') return;
    currentGameState[index] = myGameSymbol;
    sendGameMessage('GAME_MOVE', { cellIndex: index });
    isMyTurn = false;
    renderBoard();
    if (!checkWinCondition()) {
        updateGameStatus();
    }
}

function processRemoteMove(index) {
    if (!isGameActive || currentGameType !== 'Tic-Tac-Toe') return;
    const opponentSymbol = myGameSymbol === 'X' ? 'O' : 'X';
    currentGameState[index] = opponentSymbol;
    isMyTurn = true;
    renderBoard();
    if (!checkWinCondition()) {
        updateGameStatus();
    }
}

function updateGameStatus() {
    if (!isGameActive || currentGameType !== 'Tic-Tac-Toe') return;
    const statusEl = document.getElementById('game-status');
    statusEl.textContent = isMyTurn ? "Your Turn (" + myGameSymbol + ")" : "Opponent's Turn";
}

function renderBoard() {
    for (let i = 0; i < 9; i++) {
        const cell = document.getElementById('cell-' + i);
        cell.textContent = currentGameState[i];
        cell.className = 'cell'; // reset
        if (currentGameState[i]) {
            cell.classList.add(currentGameState[i].toLowerCase());
        }
    }
}

function checkWinCondition() {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];
    
    for (let pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (currentGameState[a] && currentGameState[a] === currentGameState[b] && currentGameState[a] === currentGameState[c]) {
            const winner = currentGameState[a];
            if (winner === myGameSymbol) {
                handleRoundEnd('win', "Round Won! 🎉");
            } else {
                handleRoundEnd('lose', "Round Lost! 😢");
            }
            return true;
        }
    }
    
    if (!currentGameState.includes('')) {
        handleRoundEnd('draw', "Round Draw! 🤝");
        return true;
    }
    return false;
}

// --- CONNECT 4 LOGIC ---
function makeC4Move(col) {
    if (!isGameActive || !isMyTurn || currentGameType !== 'Connect 4') return;
    
    let row = -1;
    for (let r = 5; r >= 0; r--) {
        if (c4GameState[r][col] === '') {
            row = r;
            break;
        }
    }
    if (row === -1) return;
    
    c4GameState[row][col] = myC4Color;
    sendGameMessage('GAME_C4_MOVE', { col: col });
    isMyTurn = false;
    renderC4Board();
    if (!checkC4WinCondition(row, col, myC4Color)) {
        updateC4GameStatus();
    }
}

function processRemoteC4Move(col) {
    if (!isGameActive || currentGameType !== 'Connect 4') return;
    const opponentColor = myC4Color === 'red' ? 'yellow' : 'red';
    
    let row = -1;
    for (let r = 5; r >= 0; r--) {
        if (c4GameState[r][col] === '') {
            row = r;
            break;
        }
    }
    if (row === -1) return;
    
    c4GameState[row][col] = opponentColor;
    isMyTurn = true;
    renderC4Board();
    if (!checkC4WinCondition(row, col, opponentColor)) {
        updateC4GameStatus();
    }
}

function updateC4GameStatus() {
    if (!isGameActive || currentGameType !== 'Connect 4') return;
    const statusEl = document.getElementById('game-status');
    statusEl.textContent = isMyTurn ? "Your Turn (" + myC4Color + ")" : "Opponent's Turn";
}

function renderC4Board() {
    const board = document.getElementById('c4-board');
    board.innerHTML = '';
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 7; c++) {
            const cell = document.createElement('div');
            cell.className = 'c4-cell';
            if (c4GameState[r][c]) {
                cell.classList.add(c4GameState[r][c]);
            }
            cell.onclick = () => makeC4Move(c);
            board.appendChild(cell);
        }
    }
}

function checkC4WinCondition(row, col, color) {
    const directions = [
        [0, 1], [1, 0], [1, 1], [1, -1]
    ];
    
    let isWin = false;
    for (let [dr, dc] of directions) {
        let count = 1;
        for (let i = 1; i <= 3; i++) {
            let r = row + dr * i;
            let c = col + dc * i;
            if (r >= 0 && r < 6 && c >= 0 && c < 7 && c4GameState[r][c] === color) count++;
            else break;
        }
        for (let i = 1; i <= 3; i++) {
            let r = row - dr * i;
            let c = col - dc * i;
            if (r >= 0 && r < 6 && c >= 0 && c < 7 && c4GameState[r][c] === color) count++;
            else break;
        }
        if (count >= 4) {
            isWin = true;
            break;
        }
    }
    
    if (isWin) {
        if (color === myC4Color) handleRoundEnd('win', "Round Won! 🎉");
        else handleRoundEnd('lose', "Round Lost! 😢");
        return true;
    }
    
    let isDraw = true;
    for (let c = 0; c < 7; c++) {
        if (c4GameState[0][c] === '') {
            isDraw = false;
            break;
        }
    }
    if (isDraw) {
        handleRoundEnd('draw', "Round Draw! 🤝");
        return true;
    }
    
    return false;
}



// --- DOTS AND BOXES LOGIC ---
function renderDbBoard() {
    const board = document.getElementById('db-board');
    board.innerHTML = '';
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            const cell = document.createElement('div');
            if (r % 2 === 0 && c % 2 === 0) {
                cell.className = 'db-dot';
            } else if (r % 2 === 0 && c % 2 !== 0) {
                cell.className = 'db-hline';
                let hr = r / 2;
                let hc = Math.floor(c / 2);
                if (dbHlines[hr][hc]) cell.classList.add('active');
                else cell.onclick = () => makeDbMove('h', hr, hc);
            } else if (r % 2 !== 0 && c % 2 === 0) {
                cell.className = 'db-vline';
                let vr = Math.floor(r / 2);
                let vc = c / 2;
                if (dbVlines[vr][vc]) cell.classList.add('active');
                else cell.onclick = () => makeDbMove('v', vr, vc);
            } else {
                cell.className = 'db-box';
                let br = Math.floor(r / 2);
                let bc = Math.floor(c / 2);
                if (dbBoxes[br][bc] === 1) cell.classList.add('p1');
                else if (dbBoxes[br][bc] === 2) cell.classList.add('p2');
            }
            board.appendChild(cell);
        }
    }
}

function makeDbMove(typeLine, r, c) {
    if (!isGameActive || !isMyTurn || currentGameType !== 'Dots and Boxes') return;
    
    if (typeLine === 'h') dbHlines[r][c] = 1;
    else dbVlines[r][c] = 1;
    
    sendGameMessage('GAME_DB_MOVE', { typeLine: typeLine, r: r, c: c });
    
    let scored = checkDbBoxes(1);
    renderDbBoard();
    
    if (!scored) {
        isMyTurn = false;
    }
    
    checkDbWinCondition();
    updateDbGameStatus();
}

function processRemoteDbMove(typeLine, r, c) {
    if (!isGameActive || currentGameType !== 'Dots and Boxes') return;
    
    if (typeLine === 'h') dbHlines[r][c] = 1;
    else dbVlines[r][c] = 1;
    
    let scored = checkDbBoxes(2);
    renderDbBoard();
    
    if (!scored) {
        isMyTurn = true;
    }
    
    checkDbWinCondition();
    updateDbGameStatus();
}

function checkDbBoxes(playerNum) {
    let scored = false;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            if (dbBoxes[r][c] === 0) {
                if (dbHlines[r][c] && dbHlines[r+1][c] && dbVlines[r][c] && dbVlines[r][c+1]) {
                    dbBoxes[r][c] = playerNum;
                    if (playerNum === 1) myDbScore++;
                    else oppDbScore++;
                    scored = true;
                }
            }
        }
    }
    return scored;
}

function updateDbGameStatus() {
    if (!isGameActive || currentGameType !== 'Dots and Boxes') return;
    document.getElementById('game-status').textContent = isMyTurn ? `Your Turn (You: ${myDbScore}, Opp: ${oppDbScore})` : `Opponent's Turn (You: ${myDbScore}, Opp: ${oppDbScore})`;
}

function checkDbWinCondition() {
    if (myDbScore + oppDbScore === 9) {
        if (myDbScore > oppDbScore) handleRoundEnd('win', "Round Won! 🎉");
        else if (myDbScore < oppDbScore) handleRoundEnd('lose', "Round Lost! 😢");
        else handleRoundEnd('draw', "Round Draw! 🤝");
    }
}

// --- CHECKERS LOGIC ---
function renderChkBoard() {
    const board = document.getElementById('chk-board');
    board.innerHTML = '';
    
    let startR = myChkColor === 'r' ? 0 : 7;
    let endR = myChkColor === 'r' ? 8 : -1;
    let stepR = myChkColor === 'r' ? 1 : -1;
    
    let startC = myChkColor === 'r' ? 0 : 7;
    let endC = myChkColor === 'r' ? 8 : -1;
    let stepC = myChkColor === 'r' ? 1 : -1;

    for (let r = startR; r !== endR; r += stepR) {
        for (let c = startC; c !== endC; c += stepC) {
            const cell = document.createElement('div');
            cell.className = 'chk-cell ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
            
            if (chkSelected && chkSelected.r === r && chkSelected.c === c) {
                cell.classList.add('selected');
            }
            
            let isMove = chkValidMoves.find(m => m.r === r && m.c === c);
            if (isMove) {
                cell.classList.add('valid-move');
                cell.onclick = () => makeChkMove(isMove);
            } else if (chkBoard[r][c] !== '') {
                const piece = document.createElement('div');
                piece.className = 'chk-piece';
                const p = chkBoard[r][c];
                if (p.toLowerCase() === 'r') piece.classList.add('red');
                if (p.toLowerCase() === 'b') piece.classList.add('black');
                if (p === 'R' || p === 'B') piece.classList.add('king');
                
                if (isGameActive && isMyTurn && p.toLowerCase() === myChkColor) {
                    piece.onclick = () => selectChkPiece(r, c);
                }
                cell.appendChild(piece);
            }
            board.appendChild(cell);
        }
    }
}

function selectChkPiece(r, c) {
    if (!isGameActive || !isMyTurn || currentGameType !== 'Checkers') return;
    chkSelected = {r, c};
    chkValidMoves = getChkValidMoves(r, c);
    renderChkBoard();
}

function getChkValidMoves(r, c) {
    let moves = [];
    const p = chkBoard[r][c];
    const isKing = (p === 'R' || p === 'B');
    const color = p.toLowerCase();
    const dirs = [];
    if (color === 'r' || isKing) dirs.push([-1, -1], [-1, 1]); // Red moves UP (-1)
    if (color === 'b' || isKing) dirs.push([1, -1], [1, 1]); // Black moves DOWN (+1)
    
    for (let [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            if (chkBoard[nr][nc] === '') {
                moves.push({r: nr, c: nc, isJump: false});
            } else if (chkBoard[nr][nc].toLowerCase() !== color) {
                let jr = nr + dr, jc = nc + dc;
                if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 && chkBoard[jr][jc] === '') {
                    moves.push({r: jr, c: jc, isJump: true, jumpR: nr, jumpC: nc});
                }
            }
        }
    }
    return moves;
}

function makeChkMove(move) {
    if (!isGameActive || !isMyTurn || currentGameType !== 'Checkers' || !chkSelected) return;
    
    let fr = chkSelected.r, fc = chkSelected.c;
    let p = chkBoard[fr][fc];
    
    chkBoard[fr][fc] = '';
    chkBoard[move.r][move.c] = p;
    
    if (move.isJump) {
        chkBoard[move.jumpR][move.jumpC] = '';
        chkOppPieces--;
    }
    
    if (p === 'r' && move.r === 0) chkBoard[move.r][move.c] = 'R';
    if (p === 'b' && move.r === 7) chkBoard[move.r][move.c] = 'B';
    
    sendGameMessage('GAME_CHK_MOVE', {
        fr: fr, fc: fc, tr: move.r, tc: move.c,
        isJump: move.isJump, jumpR: move.jumpR, jumpC: move.jumpC
    });
    
    chkSelected = null;
    chkValidMoves = [];
    isMyTurn = false;
    renderChkBoard();
    
    if (chkOppPieces <= 0) handleRoundEnd('win', "You captured all pieces! Round Won! 🎉");
    else updateChkGameStatus();
}

function processRemoteChkMove(fr, fc, tr, tc, isJump, jumpR, jumpC) {
    if (!isGameActive || currentGameType !== 'Checkers') return;
    
    let p = chkBoard[fr][fc];
    chkBoard[fr][fc] = '';
    chkBoard[tr][tc] = p;
    
    if (isJump) {
        chkBoard[jumpR][jumpC] = '';
        chkMyPieces--;
    }
    
    if (p === 'r' && tr === 0) chkBoard[tr][tc] = 'R';
    if (p === 'b' && tr === 7) chkBoard[tr][tc] = 'B';
    
    isMyTurn = true;
    renderChkBoard();
    
    if (chkMyPieces <= 0) handleRoundEnd('lose', "All your pieces captured! Round Lost! 😢");
    else updateChkGameStatus();
}

function updateChkGameStatus() {
    if (!isGameActive || currentGameType !== 'Checkers') return;
    document.getElementById('game-status').textContent = isMyTurn ? `Your Turn (${myChkColor === 'r' ? 'Red' : 'Black'})` : "Opponent's Turn";
}

// --- SPINNING WHEEL LOGIC ---
function submitWheelItems() {
    if (!isGameActive || currentGameType !== 'Spinning Wheel') return;
    const i1 = document.getElementById('wheel-item-1').value.trim();
    const i2 = document.getElementById('wheel-item-2').value.trim();
    const i3 = document.getElementById('wheel-item-3').value.trim();
    if (!i1 || !i2 || !i3) {
        alert("Please fill all 3 options.");
        return;
    }
    
    wheelMyItems = [i1, i2, i3];
    wheelMyItemsSubmitted = true;
    
    document.getElementById('wheel-setup-phase').classList.add('hidden');
    
    if (wheelOppItemsSubmitted) {
        startWheelPlayPhase();
    } else {
        document.getElementById('game-status').textContent = "Waiting for opponent's options...";
    }
    
    sendGameMessage('GAME_WHEEL_ITEMS', { items: wheelMyItems });
}

function processRemoteWheelItems(items) {
    if (!isGameActive || currentGameType !== 'Spinning Wheel') return;
    wheelOppItems = items;
    wheelOppItemsSubmitted = true;
    
    if (wheelMyItemsSubmitted) {
        startWheelPlayPhase();
    }
}

function startWheelPlayPhase() {
    document.getElementById('wheel-play-phase').classList.remove('hidden');
    
    wheelCombinedItems = [];
    for (let i = 0; i < 3; i++) {
        if (matchStarter) {
            wheelCombinedItems.push(wheelMyItems[i]);
            wheelCombinedItems.push(wheelOppItems[i]);
        } else {
            wheelCombinedItems.push(wheelOppItems[i]);
            wheelCombinedItems.push(wheelMyItems[i]);
        }
    }
    
    for (let i = 0; i < 6; i++) {
        document.getElementById('wheel-text-' + i).textContent = wheelCombinedItems[i];
    }
    
    document.getElementById('wheel').style.transform = 'rotate(0deg)';
    document.getElementById('wheel').style.transition = 'none';
    void document.getElementById('wheel').offsetWidth;
    document.getElementById('wheel').style.transition = 'transform 3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    
    updateWheelGameStatus();
}

function makeWheelSpin() {
    if (!isGameActive || !isMyTurn || currentGameType !== 'Spinning Wheel') return;
    
    document.getElementById('wheel-spin-btn').disabled = true;
    
    const spins = Math.floor(Math.random() * 5) + 5;
    const extraDegrees = Math.floor(Math.random() * 360);
    const totalDegrees = (spins * 360) + extraDegrees;
    
    const finalAngle = (360 - (totalDegrees % 360)) % 360;
    const segmentIndex = Math.floor(finalAngle / 60);
    const resultItem = wheelCombinedItems[segmentIndex];
    
    sendGameMessage('GAME_WHEEL_SPIN', { degrees: totalDegrees, resultItem: resultItem });
    
    animateWheel(totalDegrees, resultItem, true);
}

function processRemoteWheelSpin(degrees, resultItem) {
    if (!isGameActive || currentGameType !== 'Spinning Wheel') return;
    animateWheel(degrees, resultItem, false);
}

function animateWheel(degrees, resultItem, isMe) {
    const wheel = document.getElementById('wheel');
    document.getElementById('game-status').textContent = isMe ? "You are spinning..." : "Opponent is spinning...";
    
    wheel.style.transform = `rotate(${degrees}deg)`;
    
    setTimeout(() => {
        handleRoundEnd('draw', `Result: ${resultItem}! 🎉`);
    }, 3200);
}

function updateWheelGameStatus() {
    if (!isGameActive || currentGameType !== 'Spinning Wheel') return;
    const btn = document.getElementById('wheel-spin-btn');
    btn.disabled = !isMyTurn;
    document.getElementById('game-status').textContent = isMyTurn ? "Your Turn: Spin the Wheel!" : "Opponent's Turn: Waiting for spin...";
}

// --- ROCK PAPER SCISSORS LOGIC ---
function makeRpsMove(choice) {
    if (!isGameActive || myRpsChoice || currentGameType !== 'Rock Paper Scissors') return;
    myRpsChoice = choice;
    document.getElementById('rps-buttons').classList.add('hidden');
    document.getElementById('game-status').textContent = "Waiting for opponent...";
    sendGameMessage('GAME_RPS_MOVE', { choice: choice });
    checkRpsResult();
}

function checkRpsResult() {
    if (!myRpsChoice || !opponentRpsChoice) return;
    
    const emojis = { 'rock': '🪨', 'paper': '📄', 'scissors': '✂️' };
    document.getElementById('my-rps-choice').textContent = emojis[myRpsChoice];
    document.getElementById('opponent-rps-choice').textContent = emojis[opponentRpsChoice];
    document.getElementById('rps-result').classList.remove('hidden');
    
    if (myRpsChoice === opponentRpsChoice) {
        handleRoundEnd('draw', "It's a Tie! 🤝");
    } else if (
        (myRpsChoice === 'rock' && opponentRpsChoice === 'scissors') ||
        (myRpsChoice === 'paper' && opponentRpsChoice === 'rock') ||
        (myRpsChoice === 'scissors' && opponentRpsChoice === 'paper')
    ) {
        handleRoundEnd('win', "Round Won! 🎉");
    } else {
        handleRoundEnd('lose', "Round Lost! 😢");
    }
}

// --- COIN TOSS LOGIC ---
function makeCoinChoice(choice) {
    if (!isGameActive || !isMyTurn || currentGameType !== 'Heads or Tails') return;
    
    document.getElementById('coin-controls').classList.add('hidden');
    document.getElementById('game-status').textContent = "Flipping...";
    
    // Generate random result
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    sendGameMessage('GAME_COIN_FLIP', { callerChoice: choice, result: result });
    
    playCoinAnimation(choice, result, true);
}

function processRemoteCoinFlip(callerChoice, result) {
    if (!isGameActive || currentGameType !== 'Heads or Tails') return;
    document.getElementById('game-status').textContent = "Opponent called " + callerChoice + "...";
    playCoinAnimation(callerChoice, result, false);
}

function playCoinAnimation(callerChoice, result, iAmCaller) {
    const coin = document.getElementById('coin');
    coin.className = 'coin'; // reset
    
    // trigger reflow to restart animation if needed
    void coin.offsetWidth;
    
    coin.classList.add('flipping-' + result);
    
    setTimeout(() => {
        let won = (callerChoice === result);
        if (!iAmCaller) won = !won;
        
        const resultText = result.charAt(0).toUpperCase() + result.slice(1);
        if (won) {
            handleRoundEnd('win', `It's ${resultText}! Round Won! 🎉`);
        } else {
            handleRoundEnd('lose', `It's ${resultText}! Round Lost! 😢`);
        }
    }, 3000);
}
