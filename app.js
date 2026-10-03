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

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function generateDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        NUMBERS.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'number', suit: suit, value: val }));
        FACES.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'face', suit: suit, value: val }));
        SPECIALS.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'special', suit: suit, value: val }));
    });
    return shuffle(deck); // Proper randomization
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

    executePlacement([firstCard], 0, 0, 0, null, true);
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
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    // PENALTY: If you end your turn with 1 card and forgot to call it!
    if (currentPlayer.hand.length === 1 && !currentPlayer.hasCalledUhOh) {
        showToast(`Player ${currentPlayer.id + 1} forgot UH OH! Penalty drawn.`);
        if (gameState.drawPile.length > 0) currentPlayer.hand.push(gameState.drawPile.shift());
        if (gameState.drawPile.length > 0) currentPlayer.hand.push(gameState.drawPile.shift());
    }

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
let selectedCardIndices = [];
let pendingWildMove = null;
let pendingWildSuit = null;

function executePlacement(cards, x, y, z, clickedSurfaceEl = null, forcePlace = false) {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    let validChain = true;
    let failReason = "";

    if (!forcePlace) {
        // 1. Validate the primary card against the actual board
        const moveCheck = isValidMove(cards[0], x, y, z);
        if (!moveCheck.valid) {
            triggerErrorFeedback(clickedSurfaceEl, moveCheck.reason);
            return;
        }

        // 2. Simulate the combo chain to test for space and occlusion
        let tempCoords = [];
        for (let i = 0; i < cards.length; i++) {
            let tx = x + i; // Combos chain outward on the X axis
            let ty = y;
            let tz = z;

            if (i > 0) {
                if (getCardAt(tx, ty, tz)) {
                    validChain = false;
                    failReason = "COMBO BLOCKED: Not enough space for the full chain.";
                    break;
                }
                const vCoords = getVisualCoords(tx, ty, tz);
                if (isOccludedVisual(vCoords.vx, vCoords.vy, vCoords.vz)) {
                    validChain = false;
                    failReason = `COMBO BLOCKED: Card ${i + 1} is visually covered.`;
                    break;
                }
            }

            // Temporarily mount card to map so the next card can calculate its 3D anchor
            let tempCard = { ...cards[i] };
            const vCoords = getVisualCoords(tx, ty, tz);
            tempCard.vx = vCoords.vx;
            tempCard.vy = vCoords.vy;
            tempCard.vz = vCoords.vz;
            tempCard.globalRotation = gameState.currentRotation;
            board.set(`${tx},${ty},${tz}`, tempCard);
            tempCoords.push(`${tx},${ty},${tz}`);
        }

        // Rollback the simulation
        tempCoords.forEach(c => board.delete(c));

        if (!validChain) {
            triggerErrorFeedback(clickedSurfaceEl, failReason);
            return;
        }
    }

    // --- ACTUAL PLACEMENT ---
    let keepTurn = false;
    for (let i = 0; i < cards.length; i++) {
        let card = cards[i];
        let tx = x + i;
        let ty = y;
        let tz = z;

        const vCoords = getVisualCoords(tx, ty, tz);
        card.vx = vCoords.vx;
        card.vy = vCoords.vy;
        card.vz = vCoords.vz;
        card.globalRotation = gameState.currentRotation;

        card.pixelX = (card.vx * (CARD_WIDTH / 2)) - (card.vy * (CARD_WIDTH / 2));
        card.pixelY = (card.vx * (CARD_HEIGHT / 4)) + (card.vy * (CARD_HEIGHT / 4)) - (card.vz * (CARD_HEIGHT / 2));
        card.zIndex = (card.vx + card.vy) + (card.vz * 10);

        board.set(`${tx},${ty},${tz}`, card);

        if (currentPlayer) {
            let handIndex = currentPlayer.hand.indexOf(card);
            if (handIndex > -1) currentPlayer.hand.splice(handIndex, 1);
        }

        if (board.size > 1) {
            if (applySpecialEffects(card)) keepTurn = true;
        }
    }

    // --- WIN CONDITION & PENALTY CHECK ---
    if (currentPlayer && currentPlayer.hand.length === 0) {
        if (currentPlayer.hasCalledUhOh) {
            // THEY WIN! 
            document.getElementById('hud').innerHTML = `<h2 style="color: #facc15; font-size: 2rem;">PLAYER ${currentPlayer.id + 1} WINS! 🎉</h2>`;
            document.getElementById('playerHand').innerHTML = '';
            showToast("WE HAVE A WINNER!");
            return; // Halt the game loop entirely
        } else {
            // Caught trying to sneak a win!
            showToast("Forgot to call UH OH! Penalty: Draw 2 cards.");
            if (gameState.drawPile.length > 0) currentPlayer.hand.push(gameState.drawPile.shift());
            if (gameState.drawPile.length > 0) currentPlayer.hand.push(gameState.drawPile.shift());
            currentPlayer.hasCalledUhOh = false;
            keepTurn = false; // Force turn pass on penalty
        }
    }

    selectedCardIndices = [];
    if (board.size > 1 && !keepTurn && currentPlayer.hand.length > 0) nextTurn();
    refreshUI();
}

function createCardElement(card, x, y, z) {
    const cardDiv = document.createElement('div');
    cardDiv.id = `card-${x}-${y}-${z}`;
    cardDiv.className = `stacc-card suit-${card.suit === 'WILD' && !card.wildResolved ? 'spades' : card.suit}`;
    cardDiv.style.top = '50%'; cardDiv.style.left = '50%';
    cardDiv.style.marginTop = `-${CARD_HEIGHT / 2}px`; cardDiv.style.marginLeft = `-${CARD_WIDTH / 2}px`;

    const suitColor = (card.suit === 'hearts' || card.suit === 'diamonds') ? 'var(--text-red)' : 'var(--text-dark)';

    // 1. Build the permanent physical content for the 3 sides
    let physicalTopContent = card.value === 'WILD' && !card.wildResolved ? 'W' : (card.wildResolved ? SUIT_SYMBOLS[card.suit] : SUIT_SYMBOLS[card.suit]);
    let physicalFaceContent = card.value === 'WILD' ? 'W' : (card.type === 'face' ? card.value : SUIT_SYMBOLS[card.suit]);
    let physicalSideContent = card.value === 'WILD' ? 'W' : card.value;

    let colorTop = card.wildResolved ? suitColor : (card.value === 'WILD' ? 'var(--text-dark)' : suitColor);
    let colorFace = card.value === 'WILD' ? 'var(--text-dark)' : (card.type === 'face' ? 'var(--text-dark)' : suitColor);
    let colorSide = 'var(--text-dark)';

    // 2. Bond the HTML elements together securely
    // FIX: Removed the solid .text-content span so ONLY the watermark renders on TOP
    let htmlTop = `<span class="watermark" style="color: ${colorTop};">${physicalTopContent}</span>`;

    let htmlFace = `<span class="text-content" style="color: ${colorFace};">${physicalFaceContent}</span>`;
    if (card.value !== 'WILD') {
        htmlFace += `<span class="index-mark" style="color: ${colorFace};">${card.value}</span>`;
    }

    let htmlSide = `<span class="text-content" style="color: ${colorSide};">${physicalSideContent}</span>`;

    // 3. Map the bonded physical planes to the visual screen axes based on rotation
    let vHtmlTop, vHtmlFace, vHtmlSide;
    let axisTop = 'Z', axisFace = 'Y', axisSide = 'X';

    const rot = card.globalRotation || 0;
    if (rot === 0) {
        vHtmlTop = htmlTop; axisTop = 'Z';
        vHtmlFace = htmlFace; axisFace = 'Y';
        vHtmlSide = htmlSide; axisSide = 'X';
    } else if (rot === 1) { // Rotated Right
        vHtmlTop = htmlFace; axisTop = 'Y';
        vHtmlSide = htmlTop; axisSide = 'Z';
        vHtmlFace = htmlSide; axisFace = 'X';
    } else if (rot === 2) { // Rotated Left
        vHtmlTop = htmlSide; axisTop = 'X';
        vHtmlSide = htmlFace; axisSide = 'Y';
        vHtmlFace = htmlTop; axisFace = 'Z';
    }

    // 4. Inject the final rotated mapping
    cardDiv.innerHTML = `
        <div class="cube-wrapper">
            <div class="surface top">${vHtmlTop}</div>
            <div class="surface face">${vHtmlFace}</div>
            <div class="surface side">${vHtmlSide}</div>
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
    if (isDragging || selectedCardIndices.length === 0) return;

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const cardsToPlay = selectedCardIndices.map(index => currentPlayer.hand[index]);
    const firstCard = cardsToPlay[0];

    // --- 1. COMBO RULE ENFORCEMENT ---
    if (cardsToPlay.length > 1 && logicalName !== 'SIDE') {
        triggerErrorFeedback(e.currentTarget, "COMBO RULE: Multiples can only be chained on a SIDE match!");
        return;
    }

    // --- 2. WILD CARD ENFORCEMENT ---
    if (firstCard.value === 'WILD') {
        if (cardsToPlay.length > 1) {
            showToast("Cannot combo WILD cards!");
            return;
        }
        if (logicalName !== 'TOP') {
            // Shake the invalid surface they clicked
            triggerErrorFeedback(e.currentTarget, "WILD RULE: Can ONLY be placed on TOP surfaces.");
            return;
        }
        const moveCheck = isValidMove(firstCard, x, y, z);
        if (moveCheck.valid) {
            pendingWildMove = { card: firstCard, x: x, y: y, z: z };
            document.getElementById('wildModal').classList.add('show');
            document.getElementById('wildStep1').style.display = 'block';
            document.getElementById('wildStep2').style.display = 'none';
            return;
        } else {
            triggerErrorFeedback(e.currentTarget, moveCheck.reason);
            return;
        }
    }

    // --- 3. EXECUTE PLACEMENT ---
    executePlacement(cardsToPlay, x, y, z, e.currentTarget);
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
    executePlacement([pendingWildMove.card], pendingWildMove.x, pendingWildMove.y, pendingWildMove.z, null, true);

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
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    document.getElementById('turnDisplay').innerText = `Player ${gameState.currentPlayerIndex + 1}'s Turn`;

    // Dynamic UH OH Button visibility
    const btnUhOh = document.getElementById('btnUhOh');
    const projectedHandSize = currentPlayer.hand.length - selectedCardIndices.length;

    if (projectedHandSize <= 1 || currentPlayer.hand.length <= 2) {
        btnUhOh.style.display = 'block';
        btnUhOh.innerText = currentPlayer.hasCalledUhOh ? "CALLED!" : "UH OH!";
        btnUhOh.style.opacity = currentPlayer.hasCalledUhOh ? "0.5" : "1";
    } else {
        btnUhOh.style.display = 'none';
        currentPlayer.hasCalledUhOh = false; // Reset if hand grows
    }

    currentPlayer.hand.forEach((card, index) => {
        const div = document.createElement('div');
        div.className = `hand-card suit-${card.suit}`;
        div.innerHTML = `<div>${card.value === 'WILD' ? '' : card.value}</div>
                         <div>${card.value === 'WILD' ? 'W' : SUIT_SYMBOLS[card.suit]}</div>`;

        if (selectedCardIndices.includes(index)) div.classList.add('selected');

        div.addEventListener('click', () => {
            if (selectedCardIndices.includes(index)) {
                selectedCardIndices = selectedCardIndices.filter(i => i !== index); // Deselect
            } else {
                if (selectedCardIndices.length > 0) {
                    const firstSelected = gameState.players[gameState.currentPlayerIndex].hand[selectedCardIndices[0]];
                    if ((card.type === 'number' || card.value === '0') && card.value === firstSelected.value) {
                        selectedCardIndices.push(index);
                    } else {
                        selectedCardIndices = [index];
                    }
                } else {
                    selectedCardIndices = [index];
                }
            }
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
    selectedCardIndices = [];
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

document.getElementById('btnUhOh').addEventListener('click', () => {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    currentPlayer.hasCalledUhOh = true;
    showToast("UH OH!");
    refreshUI();
});