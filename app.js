// app.js - Unified STACCS Engine & 3D Renderer

// ==========================================
// 1. ENGINE: DECK & BOARD STATE
// ==========================================
const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];
const NUMBERS = ['2', '3', '4', '5', '6', '7', '8', '9', '10'];
const FACES = ['J', 'Q', 'K', 'A'];
const SPECIALS = ['0', 'WILD'];

const SUIT_SYMBOLS = { 'spades': '♠', 'hearts': '♥', 'clubs': '♣', 'diamonds': '♦' };
const CARD_WIDTH = 120;
const CARD_HEIGHT = 138;

let board = new Map();

function getCardAt(x, y, z) { return board.get(`${x},${y},${z}`) || null; }

function getCardByVisual(vx, vy, vz) {
    for (let card of board.values()) {
        if (card.vx === vx && card.vy === vy && card.vz === vz) return card;
    }
    return null;
}

function generateDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        NUMBERS.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'number', suit: suit, value: val }));
        FACES.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'face', suit: suit, value: val }));
        SPECIALS.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'special', suit: suit, value: val }));
    });
    return deck.sort(() => Math.random() - 0.5);
}

// ==========================================
// 2. ENGINE: RULES & STATE MACHINE
// ==========================================
const gameState = {
    players: [],
    currentPlayerIndex: 0,
    drawPile: [],
    direction: 1,
    currentRotation: 0
};

function startGame(numPlayers) {
    gameState.drawPile = generateDeck();
    gameState.currentRotation = 0;
    board.clear();

    const cardsPerPlayer = numPlayers === 5 ? 5 : 7;
    for (let i = 0; i < numPlayers; i++) {
        gameState.players.push({ id: i, hand: gameState.drawPile.splice(0, cardsPerPlayer) });
    }

    let firstCard;
    do {
        firstCard = gameState.drawPile.shift();
        if (firstCard.type !== 'number') gameState.drawPile.push(firstCard);
    } while (firstCard.type !== 'number');

    executePlacement(firstCard, 0, 0, 0, null, true);
}

function getVisualCoords(targetX, targetY, targetZ) {
    let anchor = null, stepAxis = '';
    if (getCardAt(targetX, targetY, targetZ - 1)) { anchor = getCardAt(targetX, targetY, targetZ - 1); stepAxis = 'Z'; }
    else if (getCardAt(targetX - 1, targetY, targetZ)) { anchor = getCardAt(targetX - 1, targetY, targetZ); stepAxis = 'X'; }
    else if (getCardAt(targetX, targetY - 1, targetZ)) { anchor = getCardAt(targetX, targetY - 1, targetZ); stepAxis = 'Y'; }

    if (!anchor) return { vx: 0, vy: 0, vz: 0 };

    let vx = anchor.vx, vy = anchor.vy, vz = anchor.vz;
    const aRot = anchor.globalRotation || 0;
    let visualAxis = stepAxis;

    if (aRot === 1) {
        if (stepAxis === 'Z') visualAxis = 'X';
        if (stepAxis === 'X') visualAxis = 'Y';
        if (stepAxis === 'Y') visualAxis = 'Z';
    } else if (aRot === 2) {
        if (stepAxis === 'Z') visualAxis = 'Y';
        if (stepAxis === 'X') visualAxis = 'Z';
        if (stepAxis === 'Y') visualAxis = 'X';
    }

    if (visualAxis === 'Z') vz += 1;
    if (visualAxis === 'X') vx += 1;
    if (visualAxis === 'Y') vy += 1;

    return { vx, vy, vz };
}

function isOccludedVisual(vx, vy, vz) {
    if (getCardByVisual(vx, vy, vz + 1)) return true;
    if (getCardByVisual(vx + 1, vy, vz)) return true;
    if (getCardByVisual(vx, vy + 1, vz)) return true;
    return false;
}

function isValidMove(card, targetX, targetY, targetZ) {
    if (getCardAt(targetX, targetY, targetZ)) return { valid: false, reason: "Space is already occupied." };

    const cardBelow = getCardAt(targetX, targetY, targetZ - 1);
    const cardLeft = getCardAt(targetX - 1, targetY, targetZ);
    const cardBehind = getCardAt(targetX, targetY - 1, targetZ);

    if (board.size > 0 && !cardBelow && !cardLeft && !cardBehind) {
        return { valid: false, reason: "Card must connect to an existing STACC." };
    }

    // 1. OCCLUSION CHECK
    const vCoords = getVisualCoords(targetX, targetY, targetZ);
    if (isOccludedVisual(vCoords.vx, vCoords.vy, vCoords.vz)) {
        return { valid: false, reason: "BLOCKED: This surface is visually covered by a foreground card." };
    }

    // 2. MATCHING LOGIC
    // LOGICAL Z AXIS (TOP) - The active building path
    if (cardBelow) {
        if (cardBelow.isLocked) return { valid: false, reason: "LOCKED: Cannot play on cards placed before a WILD." };
        if (cardBelow.value === '0' && cardBelow.zeroBlockTurns > 0) return { valid: false, reason: "ZERO BLOCK: A '0' blocks its TOP surface for one turn!" };
        // If cardBelow is a WILD, this is its valid active path. Just check the suit.
        if (card.value !== 'WILD' && cardBelow.suit !== card.suit) return { valid: false, reason: `TOP MATCH: Suit must match ${cardBelow.suit.toUpperCase()}.` };
    }

    // LOGICAL X AXIS (SIDE)
    if (cardLeft) {
        if (cardLeft.isLocked) return { valid: false, reason: "LOCKED: Cannot play on cards placed before a WILD." };
        if (cardLeft.value === 'WILD') return { valid: false, reason: "WILD RULE: You can only play on the active TOP path of a WILD." };

        if (card.type === 'face') return { valid: false, reason: "SIDE MATCH: Cannot play FACE cards on a SIDE surface." };
        if (card.value === 'WILD') return { valid: false, reason: "SIDE MATCH: Cannot play WILD cards on a SIDE surface." };
        if (cardLeft.value !== card.value) return { valid: false, reason: `SIDE MATCH: Number must be exactly ${cardLeft.value}.` };
    }

    // LOGICAL Y AXIS (FACE)
    if (cardBehind) {
        if (cardBehind.isLocked) return { valid: false, reason: "LOCKED: Cannot play on cards placed before a WILD." };
        if (cardBehind.value === 'WILD') return { valid: false, reason: "WILD RULE: You can only play on the active TOP path of a WILD." };

        if (card.type !== 'face') return { valid: false, reason: "FACE MATCH: Cannot play NUMBER cards on a FACE surface." };
        if (card.value === 'WILD') return { valid: false, reason: "FACE MATCH: Cannot play WILD cards on a FACE surface." };
        if (cardBehind.value !== card.value) return { valid: false, reason: `FACE MATCH: Letter must be exactly ${cardBehind.value}.` };
    }

    return { valid: true };
}

function applySpecialEffects(card) {
    if (card.value === '0') {
        card.zeroBlockTurns = 2; // Countdown timer directly on the card
        if (gameState.players.length >= 3) gameState.direction *= -1;
    } else if (card.value === 'A') {
        return true;
    }
    return false;
}

function nextTurn() {
    // Tick down active zero blocks
    board.forEach(c => {
        if (c.zeroBlockTurns > 0) c.zeroBlockTurns--;
    });

    const num = gameState.players.length;
    gameState.currentPlayerIndex = (gameState.currentPlayerIndex + gameState.direction + num) % num;
}

function lockPreviousCards() {
    board.forEach(card => card.isLocked = true);
}

// ==========================================
// 3. UI: 3D RENDERER & MATH
// ==========================================
const boardDOM = document.getElementById('gameBoard');
const renderedCards = new Set();
let selectedCardIndex = null;
let pendingWildMove = null;
let pendingWildSuit = null;

function executePlacement(card, x, y, z, clickedSurfaceEl = null, forcePlace = false) {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const moveCheck = isValidMove(card, x, y, z);

    if (forcePlace || moveCheck.valid) {

        const vCoords = getVisualCoords(x, y, z);
        card.vx = vCoords.vx;
        card.vy = vCoords.vy;
        card.vz = vCoords.vz;
        card.globalRotation = gameState.currentRotation;

        card.pixelX = (card.vx * (CARD_WIDTH / 2)) - (card.vy * (CARD_WIDTH / 2));
        card.pixelY = (card.vx * (CARD_HEIGHT / 4)) + (card.vy * (CARD_HEIGHT / 4)) - (card.vz * (CARD_HEIGHT / 2));
        card.zIndex = (card.vx + card.vy) + (card.vz * 10);

        board.set(`${x},${y},${z}`, card);
        if (currentPlayer && selectedCardIndex !== null) currentPlayer.hand.splice(selectedCardIndex, 1);
        selectedCardIndex = null;

        if (board.size > 1) {
            const keepTurn = applySpecialEffects(card);
            if (!keepTurn) nextTurn();
        }
        refreshUI();
    } else {
        triggerErrorFeedback(clickedSurfaceEl, moveCheck.reason);
    }
}

function createCardElement(card, x, y, z) {
    const cardDiv = document.createElement('div');
    cardDiv.id = `card-${x}-${y}-${z}`;
    cardDiv.className = `stacc-card suit-${card.suit === 'WILD' && !card.wildResolved ? 'spades' : card.suit}`;
    cardDiv.style.top = '50%'; cardDiv.style.left = '50%';
    cardDiv.style.marginTop = `-${CARD_HEIGHT / 2}px`; cardDiv.style.marginLeft = `-${CARD_WIDTH / 2}px`;

    let logicalTop = '', logicalFace = '', logicalSide = '';
    let colorTop = 'var(--text-dark)', colorFace = 'var(--text-dark)', colorSide = 'var(--text-dark)';
    const suitColor = (card.suit === 'hearts' || card.suit === 'diamonds') ? 'var(--text-red)' : 'var(--text-dark)';

    if (card.value === 'WILD') {
        logicalTop = card.wildResolved ? SUIT_SYMBOLS[card.suit] : 'W';
        logicalFace = 'W'; logicalSide = 'W';
        if (card.wildResolved) colorTop = suitColor;
    } else if (card.type === 'number' || card.value === '0') {
        logicalTop = SUIT_SYMBOLS[card.suit]; colorTop = suitColor;
        logicalFace = SUIT_SYMBOLS[card.suit]; colorFace = suitColor;
        logicalSide = card.value; colorSide = 'var(--text-dark)';
    } else if (card.type === 'face') {
        logicalTop = SUIT_SYMBOLS[card.suit]; colorTop = suitColor;
        logicalFace = card.value; colorFace = 'var(--text-dark)';
        logicalSide = card.value; colorSide = 'var(--text-dark)';
    }

    let visualTop = '', visualFace = '', visualSide = '';
    let vColorTop = '', vColorFace = '', vColorSide = '';
    let axisTop = 'Z', axisFace = 'Y', axisSide = 'X';

    const rot = card.globalRotation || 0;
    if (rot === 0) {
        visualTop = logicalTop; vColorTop = colorTop; axisTop = 'Z';
        visualFace = logicalFace; vColorFace = colorFace; axisFace = 'Y';
        visualSide = logicalSide; vColorSide = colorSide; axisSide = 'X';
    } else if (rot === 1) {
        visualTop = logicalFace; vColorTop = colorFace; axisTop = 'Y';
        visualSide = logicalTop; vColorSide = colorTop; axisSide = 'Z';
        visualFace = logicalSide; vColorFace = colorSide; axisFace = 'X';
    } else if (rot === 2) {
        visualTop = logicalSide; vColorTop = colorSide; axisTop = 'X';
        visualSide = logicalFace; vColorSide = colorFace; axisSide = 'Y';
        visualFace = logicalTop; vColorFace = colorTop; axisFace = 'Z';
    }

    cardDiv.innerHTML = `
        <div class="cube-wrapper">
            <div class="surface top"><span style="color: ${vColorTop}">${visualTop}</span></div>
            <div class="surface face"><span style="color: ${vColorFace}">${visualFace}</span></div>
            <div class="surface side"><span style="color: ${vColorSide}">${visualSide}</span></div>
        </div>
    `;

    if (card.isLocked) cardDiv.classList.add('locked');
    cardDiv.style.transform = `translate(${card.pixelX}px, ${card.pixelY}px)`;
    cardDiv.style.zIndex = card.zIndex;

    function routeClick(e, logicalAxis) {
        if (logicalAxis === 'Z') handleSurfaceClick(e, x, y, z + 1, 'TOP');
        if (logicalAxis === 'Y') handleSurfaceClick(e, x, y + 1, z, 'FACE');
        if (logicalAxis === 'X') handleSurfaceClick(e, x + 1, y, z, 'SIDE');
    }

    cardDiv.querySelector('.top').addEventListener('click', (e) => routeClick(e, axisTop));
    cardDiv.querySelector('.face').addEventListener('click', (e) => routeClick(e, axisFace));
    cardDiv.querySelector('.side').addEventListener('click', (e) => routeClick(e, axisSide));

    return cardDiv;
}

// ==========================================
// 4. UI: INTERACTION & WILDS
// ==========================================
function handleSurfaceClick(e, x, y, z, logicalName) {
    if (isDragging || selectedCardIndex === null) return;

    const card = gameState.players[gameState.currentPlayerIndex].hand[selectedCardIndex];

    if (card.value === 'WILD') {
        if (logicalName !== 'TOP') {
            showToast("WILD cards can ONLY be placed on TOP surfaces.");
            return;
        }
        const moveCheck = isValidMove(card, x, y, z);
        if (moveCheck.valid) {
            pendingWildMove = { card: card, x: x, y: y, z: z };
            document.getElementById('wildModal').classList.add('show');
            document.getElementById('wildStep1').style.display = 'block';
            document.getElementById('wildStep2').style.display = 'none';
            return;
        } else {
            triggerErrorFeedback(e.currentTarget, moveCheck.reason);
            return;
        }
    }
    executePlacement(card, x, y, z, e.currentTarget);
}

window.selectWildSuit = function (chosenSuit) {
    pendingWildSuit = chosenSuit;
    document.getElementById('wildStep1').style.display = 'none';
    document.getElementById('wildStep2').style.display = 'block';
};

window.resolveWild = function (rotationValue) {
    if (!pendingWildMove) return;

    lockPreviousCards();
    gameState.currentRotation = (gameState.currentRotation + rotationValue) % 3;
    pendingWildMove.card.suit = pendingWildSuit;
    pendingWildMove.card.wildResolved = true;

    document.getElementById('wildModal').classList.remove('show');
    executePlacement(pendingWildMove.card, pendingWildMove.x, pendingWildMove.y, pendingWildMove.z, null, true);

    pendingWildMove = null;
    pendingWildSuit = null;
};

// ==========================================
// 5. UI: RENDERING LOOP
// ==========================================
function updateBoardDisplay() {
    board.forEach((card, coordString) => {
        const [x, y, z] = coordString.split(',').map(Number);

        if (!renderedCards.has(coordString)) {
            boardDOM.appendChild(createCardElement(card, x, y, z));
            renderedCards.add(coordString);
        } else if (card.isLocked) {
            document.getElementById(`card-${x}-${y}-${z}`)?.classList.add('locked');
        }
    });
}

function renderHand() {
    const handDOM = document.getElementById('playerHand');
    handDOM.innerHTML = '';
    document.getElementById('turnDisplay').innerText = `Player ${gameState.currentPlayerIndex + 1}'s Turn`;

    gameState.players[gameState.currentPlayerIndex].hand.forEach((card, index) => {
        const div = document.createElement('div');
        div.className = `hand-card suit-${card.suit}`;
        div.innerHTML = `<div>${card.value === 'WILD' ? '' : card.value}</div>
                         <div>${card.value === 'WILD' ? 'W' : SUIT_SYMBOLS[card.suit]}</div>`;
        if (index === selectedCardIndex) div.classList.add('selected');
        div.addEventListener('click', () => {
            selectedCardIndex = selectedCardIndex === index ? null : index;
            renderHand();
        });
        handDOM.appendChild(div);
    });
}

function refreshUI() {
    updateBoardDisplay();
    renderHand();
}

document.getElementById('btnDraw').addEventListener('click', () => {
    gameState.players[gameState.currentPlayerIndex].hand.push(gameState.drawPile.shift());
    selectedCardIndex = null;
    nextTurn();
    refreshUI();
});

// ==========================================
// 6. UI: CAMERA & TOASTS
// ==========================================
let isDragging = false, startX, startY, scrollLeft, scrollTop, toastTimeout;

boardDOM.addEventListener('mousedown', (e) => {
    if (e.target !== boardDOM) return;
    isDragging = true;
    startX = e.pageX - boardDOM.offsetLeft;
    startY = e.pageY - boardDOM.offsetTop;
    const matrix = new DOMMatrixReadOnly(window.getComputedStyle(boardDOM).transform);
    scrollLeft = matrix.m41; scrollTop = matrix.m42;
});
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    boardDOM.style.transform = `translate(${scrollLeft + (e.pageX - boardDOM.offsetLeft - startX)}px, ${scrollTop + (e.pageY - boardDOM.offsetTop - startY)}px)`;
});

function showToast(msg) {
    const t = document.getElementById('toastMsg');
    t.innerText = msg; t.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.remove('show'), 2500);
}

function triggerErrorFeedback(el, reasonString) {
    if (el) {
        el.classList.remove('shake-error'); void el.offsetWidth; el.classList.add('shake-error');
        showToast(reasonString || "Invalid move!");
    }
}

document.addEventListener("DOMContentLoaded", () => { startGame(2); refreshUI(); });