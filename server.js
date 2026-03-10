/* ═══════════════════════════════════════════════════════
   TELMA — ONLINE MULTIPLAYER SERVER v2
   Node.js + Express + Socket.IO
   ═══════════════════════════════════════════════════════ */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    pingTimeout: 60000,
    pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ─── CARD DEFINITIONS ──────────────────────────────────
const SYMBOLS = [
    { emoji: '\u{1F31F}', name: 'estrela' },
    { emoji: '\u{1F525}', name: 'fogo' },
    { emoji: '\u{1F48E}', name: 'diamante' },
    { emoji: '\u{1F340}', name: 'trevo' },
    { emoji: '\u{1F319}', name: 'lua' },
    { emoji: '\u{26A1}', name: 'raio' },
    { emoji: '\u{1F98B}', name: 'borboleta' },
    { emoji: '\u{1F3B5}', name: 'nota' },
    { emoji: '\u{1F338}', name: 'flor' },
    { emoji: '\u{1F409}', name: 'dragao' },
    { emoji: '\u{1F3AF}', name: 'alvo' },
    { emoji: '\u{1F52E}', name: 'bola' },
];

const SPECIAL_123 = { emoji: '1\uFE0F\u20E32\uFE0F\u20E33\uFE0F\u20E3', name: '1,2,3!', type: '123' };
const SPECIAL_TELMA = { emoji: '\u{1F32A}\uFE0F', name: 'TELMA!', type: 'telma' };

const CONTENDA_TIME_MS = 15000;

// ─── ROOMS STORAGE ─────────────────────────────────────
const rooms = new Map();

// ─── UTILITY FUNCTIONS ─────────────────────────────────
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (rooms.has(code)) return generateRoomCode();
    return code;
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function buildDeck() {
    const deck = [];
    SYMBOLS.forEach(sym => {
        for (let i = 0; i < 4; i++) {
            deck.push({ ...sym, type: 'normal' });
        }
    });
    deck.push({ ...SPECIAL_123, type: '123' });
    deck.push({ ...SPECIAL_TELMA, type: 'telma' });
    return shuffleArray(deck);
}

function dealCards(room) {
    const deck = buildDeck();
    const players = room.players;
    players.forEach(p => { p.pile = []; p.revealedCard = null; });
    let idx = 0;
    deck.forEach(card => {
        players[idx].pile.push(card);
        idx = (idx + 1) % players.length;
    });
    console.log(`[DEAL] Cards dealt. ${players.map(p => p.name + ':' + p.pile.length).join(', ')}`);
}

function getPublicPlayerState(room) {
    return room.players.map(p => ({
        id: p.id,
        socketId: p.socketId,
        name: p.name,
        nickname: p.nickname,
        baseNickname: p.baseNickname,
        pileCount: p.pile.length,
        revealedCard: p.revealedCard,
        score: p.score,
        connected: p.connected,
    }));
}

function getRoomState(room) {
    return {
        code: room.code,
        hostId: room.hostId,
        players: getPublicPlayerState(room),
        currentRound: room.currentRound,
        currentTurnIndex: room.currentTurnIndex,
        centerPile: room.centerPile,
        phase: room.phase,
        contendaData: room.contendaData,
        minPlayers: 2,
        maxPlayers: 8,
    };
}

function checkForMatches(room) {
    const revealed = room.players
        .map((p, i) => ({ player: p, index: i }))
        .filter(({ player }) => player.revealedCard && player.revealedCard.type === 'normal');

    const groups = {};
    revealed.forEach(({ player, index }) => {
        const key = player.revealedCard.emoji;
        if (!groups[key]) groups[key] = [];
        groups[key].push(index);
    });

    for (const [emoji, indices] of Object.entries(groups)) {
        if (indices.length >= 2) {
            return { emoji, players: indices };
        }
    }
    return null;
}

// ─── WIN DETECTION ─────────────────────────────────────
// A player wins when their PILE is empty (0 cards to draw from).
// The revealed card on the table does NOT count as in-hand.
function checkRoundEnd(room) {
    const winner = room.players.find(p => p.pile.length === 0);
    if (!winner) return null;
    if (!room._roundAwarded) {
        winner.score += (room.currentRound === 3 ? 2 : 1);
        room._roundAwarded = true;
        console.log(`[WIN!] ${winner.name} won round ${room.currentRound}! Score: ${winner.score}`);
    }
    return winner;
}

// Central win check — call this EVERYWHERE after state changes
function checkAndHandleWin(room, roomCode) {
    if (room.phase !== 'playing') return false;
    const winner = checkRoundEnd(room);
    if (winner) {
        console.log(`[ROUND END] ${winner.name} has 0 cards. Ending round.`);
        handleRoundEnd(room, roomCode, winner);
        return true;
    }
    return false;
}

function advanceTurn(room) {
    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    skipEliminatedPlayers(room);
}

// Skip players with empty pile
function skipEliminatedPlayers(room) {
    let attempts = 0;
    while (
        room.players[room.currentTurnIndex].pile.length === 0 &&
        attempts < room.players.length
    ) {
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        attempts++;
    }
}

function collectRevealedCards(room) {
    const collected = [];
    room.players.forEach(p => {
        if (p.revealedCard) {
            collected.push(p.revealedCard);
            p.revealedCard = null;
        }
    });
    for (let i = 0; i < room.centerPile; i++) {
        collected.push({ emoji: '?', name: '?', type: 'normal' });
    }
    room.centerPile = 0;
    return shuffleArray(collected);
}

function isGameOver(room) {
    const maxScore = Math.max(...room.players.map(p => p.score));
    const playersWithMax = room.players.filter(p => p.score === maxScore);
    return room.currentRound >= 3 || (maxScore >= 2 && playersWithMax.length === 1);
}

// ─── CLEANUP STALE ROOMS ──────────────────────────────
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
        if (now - room.lastActivity > 2 * 60 * 60 * 1000) {
            rooms.delete(code);
            console.log(`[CLEANUP] Room ${code} removed (inactive)`);
        }
    }
}, 5 * 60 * 1000);

// ─── SOCKET.IO CONNECTION ──────────────────────────────
io.on('connection', (socket) => {
    console.log(`[CONNECT] ${socket.id}`);

    let currentRoom = null;
    let currentPlayerId = null;

    // ── CREATE ROOM ────────────────────────────────────
    socket.on('createRoom', ({ playerName, nickname }, callback) => {
        const code = generateRoomCode();
        const playerId = 0;

        const room = {
            code,
            hostId: playerId,
            players: [{
                id: playerId,
                socketId: socket.id,
                name: playerName || 'Jogador 1',
                nickname: (nickname || '').toLowerCase(),
                baseNickname: (nickname || '').toLowerCase(),
                pile: [],
                revealedCard: null,
                score: 0,
                connected: true,
            }],
            currentRound: 1,
            currentTurnIndex: 0,
            centerPile: 0,
            phase: 'lobby',
            contendaData: null,
            contendaTimeout: null,
            _roundAwarded: false,
            lastActivity: Date.now(),
        };

        rooms.set(code, room);
        socket.join(code);
        currentRoom = code;
        currentPlayerId = playerId;

        console.log(`[ROOM CREATED] ${code} by ${playerName}`);
        callback({ success: true, code, playerId, state: getRoomState(room) });
    });

    // ── JOIN ROOM ──────────────────────────────────────
    socket.on('joinRoom', ({ code, playerName, nickname }, callback) => {
        const roomCode = (code || '').toUpperCase();
        const room = rooms.get(roomCode);

        if (!room) return callback({ success: false, error: 'Sala nao encontrada!' });
        if (room.phase !== 'lobby') return callback({ success: false, error: 'O jogo ja comecou!' });
        if (room.players.length >= 8) return callback({ success: false, error: 'Sala cheia! (maximo 8 jogadores)' });

        const nick = (nickname || '').toLowerCase();
        if (room.players.some(p => p.nickname === nick)) {
            return callback({ success: false, error: 'Esse apelido ja esta em uso!' });
        }

        const playerId = room.players.length;
        room.players.push({
            id: playerId,
            socketId: socket.id,
            name: playerName || `Jogador ${playerId + 1}`,
            nickname: nick,
            baseNickname: nick,
            pile: [],
            revealedCard: null,
            score: 0,
            connected: true,
        });

        room.lastActivity = Date.now();
        socket.join(roomCode);
        currentRoom = roomCode;
        currentPlayerId = playerId;

        console.log(`[JOIN] ${playerName} joined room ${roomCode}`);
        callback({ success: true, code: roomCode, playerId, state: getRoomState(room) });
        io.to(roomCode).emit('roomUpdate', getRoomState(room));
    });

    // ── START GAME ─────────────────────────────────────
    socket.on('startGame', (callback) => {
        const room = rooms.get(currentRoom);
        if (!room) return callback?.({ success: false, error: 'Sala nao encontrada' });
        if (currentPlayerId !== room.hostId) return callback?.({ success: false, error: 'Apenas o host pode iniciar' });
        if (room.players.length < 2) return callback?.({ success: false, error: 'Minimo 2 jogadores' });

        const emptyNick = room.players.find(p => !p.nickname);
        if (emptyNick) return callback?.({ success: false, error: `${emptyNick.name} precisa de um apelido!` });

        dealCards(room);
        room.phase = 'playing';
        room.currentTurnIndex = 0;
        room.centerPile = 0;
        room._roundAwarded = false;
        room.lastActivity = Date.now();

        console.log(`[GAME START] Room ${currentRoom}, ${room.players.length} players`);
        callback?.({ success: true });
        io.to(currentRoom).emit('gameStarted', getRoomState(room));
    });

    // ── REVEAL CARD ────────────────────────────────────
    socket.on('revealCard', (callback) => {
        const room = rooms.get(currentRoom);
        if (!room || room.phase !== 'playing') return callback?.({ success: false });
        if (currentPlayerId !== room.currentTurnIndex) {
            return callback?.({ success: false, error: 'Nao e a sua vez!' });
        }

        const player = room.players[currentPlayerId];
        if (!player) return callback?.({ success: false });

        // Player has 0 cards — they have WON!
        if (player.pile.length === 0) {
            console.log(`[REVEAL] ${player.name} has 0 cards in pile. Triggering win!`);
            if (checkAndHandleWin(room, currentRoom)) {
                return callback?.({ success: true });
            }
            // Fallback: skip this player's turn
            advanceTurn(room);
            io.to(currentRoom).emit('roomUpdate', getRoomState(room));
            return callback?.({ success: true });
        }

        room.lastActivity = Date.now();

        // If player already has a face-up card, it goes to center pile
        if (player.revealedCard) {
            room.centerPile++;
            console.log(`[CARD] ${player.name} old revealed card -> center. Center pile: ${room.centerPile}`);
        }

        const card = player.pile.shift();
        player.revealedCard = card;
        console.log(`[REVEAL] ${player.name} reveals ${card.name} (${card.type}). Pile remaining: ${player.pile.length}`);

        // Emit to all clients
        const capturedRoom = currentRoom;
        io.to(capturedRoom).emit('cardRevealed', {
            playerIndex: currentPlayerId,
            card,
            state: getRoomState(room),
        });

        // Special cards
        if (card.type === '123') {
            setTimeout(() => handle123(room, capturedRoom), 1200);
            return callback?.({ success: true });
        }
        if (card.type === 'telma') {
            setTimeout(() => handleTelma(room, capturedRoom), 1200);
            return callback?.({ success: true });
        }

        // Normal card: check win -> check matches -> advance turn
        setTimeout(() => {
            if (room.phase !== 'playing') return;

            // WIN: did this empty the pile?
            if (checkAndHandleWin(room, capturedRoom)) return;

            // MATCH: do any revealed cards match?
            const match = checkForMatches(room);
            if (match) {
                startContenda(room, capturedRoom, match);
            } else {
                advanceTurn(room);
                // After advancing, re-check (edge case)
                if (!checkAndHandleWin(room, capturedRoom)) {
                    io.to(capturedRoom).emit('roomUpdate', getRoomState(room));
                }
            }
        }, 800);

        callback?.({ success: true });
    });

    // ── CONTENDA ANSWER ────────────────────────────────
    socket.on('contendaAnswer', ({ answer }, callback) => {
        const room = rooms.get(currentRoom);
        if (!room || (room.phase !== 'contenda' && room.phase !== 'surto')) {
            return callback?.({ success: false });
        }

        room.lastActivity = Date.now();
        const typed = (answer || '').trim().toLowerCase();

        if (room.phase === 'contenda') {
            const contenda = room.contendaData;
            if (!contenda || !contenda.players.includes(currentPlayerId)) {
                return callback?.({ success: false, error: 'Voce nao esta na contenda!' });
            }

            const opponentIndices = contenda.players.filter(i => i !== currentPlayerId);
            const matchedOpponent = opponentIndices.find(i =>
                room.players[i].nickname.toLowerCase() === typed
            );

            if (matchedOpponent !== undefined) {
                resolveContenda(room, currentRoom, currentPlayerId, matchedOpponent);
                callback?.({ success: true, correct: true });
            } else {
                callback?.({ success: true, correct: false, error: 'Apelido incorreto!' });
                io.to(socket.id).emit('contendaWrong');
            }
        } else if (room.phase === 'surto') {
            const matchedPlayer = room.players.find((p, i) =>
                i !== currentPlayerId && p.nickname.toLowerCase() === typed
            );

            if (matchedPlayer) {
                resolveSurto(room, currentRoom, currentPlayerId, matchedPlayer.id);
                callback?.({ success: true, correct: true });
            } else {
                callback?.({ success: true, correct: false, error: 'Apelido incorreto!' });
                io.to(socket.id).emit('contendaWrong');
            }
        }
    });

    // ── NEXT ROUND (with modifiers) ────────────────────
    socket.on('nextRound', ({ modifier }, callback) => {
        const room = rooms.get(currentRoom);
        if (!room || room.phase !== 'roundEnd') return callback?.({ success: false });

        const player = room.players.find(p => p.id === currentPlayerId);
        if (player && modifier) {
            player._pendingModifier = modifier.trim().toLowerCase();
        }

        const connectedPlayers = room.players.filter(p => p.connected);
        const allReady = connectedPlayers.every(p => p._pendingModifier);

        if (allReady) {
            const nextRound = room.currentRound + 1;

            // Apply modifiers to nicknames
            room.players.forEach(p => {
                if (p._pendingModifier) {
                    if (nextRound === 2) {
                        // Round 2: base nickname + adjective
                        p.nickname = `${p.baseNickname} ${p._pendingModifier}`;
                    } else if (nextRound === 3) {
                        // Round 3: current nickname + action
                        p.nickname = `${p.nickname} ${p._pendingModifier}`;
                    }
                    delete p._pendingModifier;
                }
            });

            room.currentRound = nextRound;
            dealCards(room);
            room.phase = 'playing';
            room.currentTurnIndex = 0;
            room.centerPile = 0;
            room._roundAwarded = false;
            room.lastActivity = Date.now();

            console.log(`[ROUND ${nextRound}] Nicknames: ${room.players.map(p => `${p.name}="${p.nickname}"`).join(', ')}`);
            io.to(currentRoom).emit('newRoundStarted', getRoomState(room));
        } else {
            io.to(currentRoom).emit('playerReady', {
                playerId: currentPlayerId,
                readyCount: connectedPlayers.filter(p => p._pendingModifier).length,
                totalCount: connectedPlayers.length,
            });
        }

        callback?.({ success: true });
    });

    // ── PLAY AGAIN ─────────────────────────────────────
    socket.on('playAgain', (callback) => {
        const room = rooms.get(currentRoom);
        if (!room || currentPlayerId !== room.hostId) return callback?.({ success: false });

        room.players.forEach(p => {
            p.score = 0;
            p.pile = [];
            p.revealedCard = null;
            p.nickname = p.baseNickname;
        });
        room.currentRound = 1;
        room.phase = 'lobby';
        room._roundAwarded = false;
        room.lastActivity = Date.now();

        io.to(currentRoom).emit('backToLobby', getRoomState(room));
        callback?.({ success: true });
    });

    // ── DISCONNECT ─────────────────────────────────────
    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] ${socket.id}`);
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        if (!room) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
            player.connected = false;
            console.log(`[PLAYER OFFLINE] ${player.name} from room ${currentRoom}`);

            const anyConnected = room.players.some(p => p.connected);
            if (!anyConnected) {
                setTimeout(() => {
                    const r = rooms.get(currentRoom);
                    if (r && !r.players.some(p => p.connected)) {
                        rooms.delete(currentRoom);
                        console.log(`[ROOM DELETED] ${currentRoom}`);
                    }
                }, 5 * 60 * 1000);
            }

            io.to(currentRoom).emit('playerDisconnected', {
                playerId: player.id,
                playerName: player.name,
                state: getRoomState(room),
            });
        }
    });

    // ── RECONNECT ──────────────────────────────────────
    socket.on('rejoinRoom', ({ code, playerId }, callback) => {
        const roomCode = (code || '').toUpperCase();
        const room = rooms.get(roomCode);
        if (!room) return callback?.({ success: false, error: 'Sala nao encontrada' });

        const player = room.players[playerId];
        if (!player) return callback?.({ success: false, error: 'Jogador nao encontrado' });

        player.socketId = socket.id;
        player.connected = true;
        socket.join(roomCode);
        currentRoom = roomCode;
        currentPlayerId = playerId;
        room.lastActivity = Date.now();

        console.log(`[REJOIN] ${player.name} rejoined room ${roomCode}`);
        callback?.({ success: true, state: getRoomState(room) });
        io.to(roomCode).emit('playerReconnected', {
            playerId: player.id,
            playerName: player.name,
            state: getRoomState(room),
        });
    });
});

// ─── CONTENDA LOGIC ────────────────────────────────────
function startContenda(room, roomCode, matchResult) {
    room.phase = 'contenda';
    room.contendaData = {
        emoji: matchResult.emoji,
        players: matchResult.players,
        startedAt: Date.now(),
    };

    io.to(roomCode).emit('contendaStarted', {
        emoji: matchResult.emoji,
        playerIndices: matchResult.players,
        state: getRoomState(room),
        timeMs: CONTENDA_TIME_MS,
    });

    room.contendaTimeout = setTimeout(() => {
        if (room.phase === 'contenda') {
            resolveContendaTie(room, roomCode, matchResult);
        }
    }, CONTENDA_TIME_MS);
}

function resolveContenda(room, roomCode, winnerIdx, loserIdx) {
    if (room.contendaTimeout) clearTimeout(room.contendaTimeout);
    room.phase = 'playing';
    room.contendaData = null;

    const winner = room.players[winnerIdx];
    const loser = room.players[loserIdx];
    const collected = collectRevealedCards(room);
    loser.pile.push(...collected);

    console.log(`[CONTENDA] ${winner.name} beat ${loser.name}. ${loser.name} gets ${collected.length} cards.`);

    io.to(roomCode).emit('contendaResolved', {
        winnerId: winnerIdx,
        loserId: loserIdx,
        winnerName: winner.name,
        loserName: loser.name,
        cardsCollected: collected.length,
    });

    // Check if winner now has 0 cards
    if (checkAndHandleWin(room, roomCode)) return;

    room.currentTurnIndex = loserIdx;
    skipEliminatedPlayers(room);

    setTimeout(() => {
        io.to(roomCode).emit('roomUpdate', getRoomState(room));
    }, 1500);
}

function resolveContendaTie(room, roomCode, matchResult) {
    if (room.contendaTimeout) clearTimeout(room.contendaTimeout);
    room.phase = 'playing';
    room.contendaData = null;

    const collected = collectRevealedCards(room);
    const playersInContenda = matchResult.players;
    let cardIdx = 0;
    while (cardIdx < collected.length) {
        const targetIdx = playersInContenda[cardIdx % playersInContenda.length];
        room.players[targetIdx].pile.push(collected[cardIdx]);
        cardIdx++;
    }

    console.log(`[CONTENDA TIE] Cards split among ${playersInContenda.length} players`);

    io.to(roomCode).emit('contendaTied', {
        message: 'Tempo esgotado! Empate - cartas divididas!',
    });

    if (checkAndHandleWin(room, roomCode)) return;

    room.currentTurnIndex = (playersInContenda[0] + 1) % room.players.length;
    skipEliminatedPlayers(room);

    setTimeout(() => {
        io.to(roomCode).emit('roomUpdate', getRoomState(room));
    }, 1500);
}

// ─── SPECIAL CARDS LOGIC ───────────────────────────────
function handle123(room, roomCode) {
    io.to(roomCode).emit('special123', { message: 'Carta "1, 2, 3!" - Todos revelam ao mesmo tempo!' });

    setTimeout(() => {
        room.players.forEach(p => {
            if (p.pile.length > 0) {
                if (p.revealedCard) room.centerPile++;
                p.revealedCard = p.pile.shift();
                console.log(`[123] ${p.name} reveals ${p.revealedCard.name}. Pile: ${p.pile.length}`);
            }
        });

        io.to(roomCode).emit('allCardsRevealed', { state: getRoomState(room) });

        setTimeout(() => {
            if (checkAndHandleWin(room, roomCode)) return;

            const match = checkForMatches(room);
            if (match) {
                startContenda(room, roomCode, match);
            } else {
                advanceTurn(room);
                if (!checkAndHandleWin(room, roomCode)) {
                    io.to(roomCode).emit('roomUpdate', getRoomState(room));
                }
            }
        }, 1200);
    }, 1500);
}

function handleTelma(room, roomCode) {
    room.phase = 'surto';
    room.contendaData = { startedAt: Date.now() };

    io.to(roomCode).emit('surtoStarted', {
        state: getRoomState(room),
        timeMs: CONTENDA_TIME_MS,
    });

    room.contendaTimeout = setTimeout(() => {
        if (room.phase === 'surto') {
            resolveSurtoTimeout(room, roomCode);
        }
    }, CONTENDA_TIME_MS);
}

function resolveSurto(room, roomCode, winnerIdx, loserIdx) {
    if (room.contendaTimeout) clearTimeout(room.contendaTimeout);
    room.phase = 'playing';
    room.contendaData = null;

    const winner = room.players[winnerIdx];
    const loser = room.players[loserIdx];
    const collected = collectRevealedCards(room);
    loser.pile.push(...collected);

    console.log(`[SURTO] ${winner.name} called ${loser.nickname}. ${loser.name} gets ${collected.length} cards.`);

    io.to(roomCode).emit('surtoResolved', {
        winnerId: winnerIdx,
        loserId: loserIdx,
        winnerName: winner.name,
        loserName: loser.name,
        loserNickname: loser.nickname,
        cardsCollected: collected.length,
    });

    if (checkAndHandleWin(room, roomCode)) return;

    room.currentTurnIndex = loserIdx;
    skipEliminatedPlayers(room);

    setTimeout(() => {
        io.to(roomCode).emit('roomUpdate', getRoomState(room));
    }, 1500);
}

function resolveSurtoTimeout(room, roomCode) {
    if (room.contendaTimeout) clearTimeout(room.contendaTimeout);
    room.phase = 'playing';
    room.contendaData = null;

    let count = 0;
    room.players.forEach(p => {
        if (p.revealedCard) { count++; p.revealedCard = null; }
    });
    room.centerPile += count;

    io.to(roomCode).emit('surtoTimeout', {
        message: 'Ninguem conseguiu! Cartas vao para o centro.',
    });

    if (checkAndHandleWin(room, roomCode)) return;

    advanceTurn(room);
    setTimeout(() => {
        io.to(roomCode).emit('roomUpdate', getRoomState(room));
    }, 1500);
}

// ─── ROUND END ─────────────────────────────────────────
function handleRoundEnd(room, roomCode, winner) {
    console.log(`[HANDLE ROUND END] Winner: ${winner.name}, Round: ${room.currentRound}, isGameOver: ${isGameOver(room)}`);

    if (isGameOver(room)) {
        room.phase = 'gameOver';
        console.log(`[GAME OVER] ${winner.name} wins the game!`);
        io.to(roomCode).emit('gameOver', {
            winnerId: winner.id,
            winnerName: winner.name,
            state: getRoomState(room),
        });
    } else {
        room.phase = 'roundEnd';
        console.log(`[ROUND END SCREEN] Showing round end. Next round: ${room.currentRound + 1}`);
        io.to(roomCode).emit('roundEnded', {
            winnerId: winner.id,
            winnerName: winner.name,
            round: room.currentRound,
            nextRound: room.currentRound + 1,
            state: getRoomState(room),
        });
    }
}

// ─── START SERVER ──────────────────────────────────────
server.listen(PORT, () => {
    console.log(`\n=== TELMA Online Server v2 ===`);
    console.log(`    URL: http://localhost:${PORT}`);
    console.log(`    Ready!\n`);
});
