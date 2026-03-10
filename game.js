/* ═══════════════════════════════════════════════════════
   TELMA — CARD GAME — GAME ENGINE
   ═══════════════════════════════════════════════════════ */

(() => {
    'use strict';

    // ─── CARD SYMBOLS ──────────────────────────────────
    const SYMBOLS = [
        { emoji: '🌟', name: 'estrela' },
        { emoji: '🔥', name: 'fogo' },
        { emoji: '💎', name: 'diamante' },
        { emoji: '🍀', name: 'trevo' },
        { emoji: '🌙', name: 'lua' },
        { emoji: '⚡', name: 'raio' },
        { emoji: '🦋', name: 'borboleta' },
        { emoji: '🎵', name: 'nota' },
        { emoji: '🌸', name: 'flor' },
        { emoji: '🐉', name: 'dragão' },
        { emoji: '🎯', name: 'alvo' },
        { emoji: '🔮', name: 'bola' },
    ];

    const SPECIAL_123 = { emoji: '1️⃣2️⃣3️⃣', name: '1,2,3!', type: '123' };
    const SPECIAL_TELMA = { emoji: '🌪️', name: 'TELMA!', type: 'telma' };

    const CONTENDA_TIME_MS = 12000;
    const SPLASH_DURATION = 2400;

    // ─── STATE ──────────────────────────────────────────
    let state = {
        players: [],
        currentRound: 1,
        currentTurnIndex: 0,
        tableCards: [],     // cards currently face-up on the table per player
        centerPile: 0,      // extra cards from ties
        revealPhase: false,
        contendaActive: false,
        surtoActive: false,
        gameStarted: false,
        roundOver: false,
        contendaTimer: null,
        contendaTimeout: null,
        processing: false,  // debounce flag for reveals
    };

    // ─── DOM REFS ───────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const screens = {
        splash: $('#splash-screen'),
        menu: $('#menu-screen'),
        lobby: $('#lobby-screen'),
        game: $('#game-screen'),
        roundEnd: $('#round-end-screen'),
        gameover: $('#gameover-screen'),
    };

    const modals = {
        rules: $('#rules-modal'),
        scoreboard: $('#scoreboard-modal'),
    };

    // ─── SCREEN NAVIGATION ─────────────────────────────
    function showScreen(name) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[name].classList.add('active');
    }

    function showModal(name) {
        modals[name].classList.remove('hidden');
    }

    function hideModal(name) {
        modals[name].classList.add('hidden');
    }

    // ─── TOAST ──────────────────────────────────────────
    let toastEl = null;
    function showToast(message, type = 'info', duration = 2500) {
        if (toastEl) toastEl.remove();
        toastEl = document.createElement('div');
        toastEl.className = `toast ${type}`;
        toastEl.textContent = message;
        document.body.appendChild(toastEl);
        requestAnimationFrame(() => {
            toastEl.classList.add('show');
        });
        setTimeout(() => {
            if (toastEl) {
                toastEl.classList.remove('show');
                setTimeout(() => { if (toastEl) toastEl.remove(); toastEl = null; }, 400);
            }
        }, duration);
    }

    // ─── CONFETTI ───────────────────────────────────────
    function spawnConfetti(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        const colors = ['#a855f7', '#f472b6', '#fbbf24', '#22d3ee', '#34d399', '#f87171', '#fb923c'];
        for (let i = 0; i < 60; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            piece.style.setProperty('--fall-duration', (2 + Math.random() * 3) + 's');
            piece.style.setProperty('--fall-delay', (Math.random() * 1.5) + 's');
            piece.style.width = (6 + Math.random() * 8) + 'px';
            piece.style.height = (6 + Math.random() * 8) + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            container.appendChild(piece);
        }
    }

    // ─── DECK BUILDER ───────────────────────────────────
    function buildDeck(playerCount) {
        const deck = [];
        // Each symbol appears 4 times to create pairs
        SYMBOLS.forEach(sym => {
            for (let i = 0; i < 4; i++) {
                deck.push({ ...sym, type: 'normal' });
            }
        });
        // Add special cards
        deck.push({ ...SPECIAL_123, type: '123' });
        deck.push({ ...SPECIAL_TELMA, type: 'telma' });
        // Shuffle
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    function dealCards(players) {
        const deck = buildDeck(players.length);
        let idx = 0;
        deck.forEach((card, i) => {
            players[idx].pile.push(card);
            idx = (idx + 1) % players.length;
        });
    }

    // ─── PLAYER SETUP ───────────────────────────────────
    function generatePlayerInputs() {
        const count = parseInt($('#player-count').textContent);
        const container = $('#player-inputs');
        container.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const card = document.createElement('div');
            card.className = 'player-input-card';
            card.innerHTML = `
                <div class="player-label">
                    <div class="player-avatar p-color-${i}">${i + 1}</div>
                    <span>Jogador ${i + 1}</span>
                </div>
                <input type="text" id="player-name-${i}" placeholder="Nome do jogador" maxlength="20" />
                <input type="text" id="player-nickname-${i}" placeholder="Apelido (ex: mesa)" maxlength="30" style="margin-top:0.4rem;" />
            `;
            container.appendChild(card);
        }
    }

    // ─── MODIFIER INPUTS (Round 2/3) ──────────────────
    function generateModifierInputs() {
        const container = $('#modifier-inputs');
        container.innerHTML = '';
        state.players.forEach((p, i) => {
            const div = document.createElement('div');
            div.className = 'modifier-input-item';
            if (state.currentRound === 2) {
                div.innerHTML = `
                    <label>${p.name}:</label>
                    <input type="text" id="modifier-${i}" placeholder="Adjetivo (ex: azul)" maxlength="20" />
                `;
            } else if (state.currentRound === 3) {
                div.innerHTML = `
                    <label>${p.name}:</label>
                    <input type="text" id="modifier-${i}" placeholder="Ação (ex: que dança)" maxlength="30" />
                `;
            }
            container.appendChild(div);
        });
    }

    // ─── INIT LOBBY ─────────────────────────────────────
    function initLobby(isNewRound = false) {
        $('#round-display').textContent = state.currentRound;

        if (!isNewRound) {
            generatePlayerInputs();
            $('#round-modifier-section').classList.add('hidden');
        } else {
            // Show modifier section for round 2 and 3
            const modSection = $('#round-modifier-section');
            modSection.classList.remove('hidden');
            if (state.currentRound === 2) {
                $('#round-modifier-title').textContent = '🎨 Adicione um adjetivo ao seu apelido!';
            } else {
                $('#round-modifier-title').textContent = '💃 Adicione uma ação ao seu apelido!';
            }
            generateModifierInputs();

            // Regenerate player input cards (but pre-filled and disabled for name/nickname)
            const container = $('#player-inputs');
            container.innerHTML = '';
            state.players.forEach((p, i) => {
                const card = document.createElement('div');
                card.className = 'player-input-card';
                card.innerHTML = `
                    <div class="player-label">
                        <div class="player-avatar p-color-${i}">${i + 1}</div>
                        <span>${p.name}</span>
                    </div>
                    <input type="text" value="${p.baseNickname}" disabled style="opacity:0.6;" />
                    <div style="margin-top:0.3rem;font-size:0.75rem;color:var(--clr-primary-light);">
                        Apelido atual: <strong>"${p.nickname}"</strong>
                    </div>
                `;
                container.appendChild(card);
            });
        }

        showScreen('lobby');
    }

    // ─── START GAME ─────────────────────────────────────
    function startGame() {
        const count = parseInt($('#player-count').textContent);
        const isNewRound = state.currentRound > 1 && state.players.length > 0;

        if (!isNewRound) {
            // Validate inputs
            const players = [];
            for (let i = 0; i < count; i++) {
                const name = $(`#player-name-${i}`)?.value?.trim() || `Jogador ${i + 1}`;
                const nickname = $(`#player-nickname-${i}`)?.value?.trim().toLowerCase();
                if (!nickname) {
                    showToast(`Jogador ${i + 1} precisa de um apelido!`, 'error');
                    return;
                }
                players.push({
                    id: i,
                    name,
                    baseNickname: nickname,
                    nickname: nickname,
                    pile: [],
                    revealedCard: null,
                    score: 0,
                });
            }
            // Check unique nicknames
            const nicks = players.map(p => p.nickname);
            if (new Set(nicks).size !== nicks.length) {
                showToast('Os apelidos devem ser únicos!', 'error');
                return;
            }
            state.players = players;
        } else {
            // Apply modifiers
            state.players.forEach((p, i) => {
                const modInput = $(`#modifier-${i}`);
                const modifier = modInput?.value?.trim().toLowerCase();
                if (!modifier) {
                    showToast(`${p.name} precisa adicionar ${state.currentRound === 2 ? 'um adjetivo' : 'uma ação'}!`, 'error');
                    return;
                }
                if (state.currentRound === 2) {
                    p.nickname = `${p.baseNickname} ${modifier}`;
                } else {
                    // Previous round nickname + new action
                    p.nickname = `${p.nickname} ${modifier}`;
                }
            });
            // Reset piles
            state.players.forEach(p => {
                p.pile = [];
                p.revealedCard = null;
            });
        }

        // Deal cards
        dealCards(state.players);

        // Reset state
        state.currentTurnIndex = 0;
        state.centerPile = 0;
        state.contendaActive = false;
        state.surtoActive = false;
        state.gameStarted = true;
        state.roundOver = false;

        renderGameTable();
        updateTurnIndicator();
        showScreen('game');
        showToast('🃏 Que comece o jogo!', 'success');
    }

    // ─── RENDER GAME TABLE ─────────────────────────────
    function renderGameTable() {
        const table = $('#game-table');
        table.innerHTML = '';

        $('#game-round').textContent = state.currentRound;

        state.players.forEach((player, i) => {
            const slot = document.createElement('div');
            slot.className = 'player-slot';
            slot.id = `slot-${i}`;
            slot.dataset.playerIndex = i;

            const hasCards = player.pile.length > 0 || player.revealedCard;
            const isRevealed = !!player.revealedCard;
            const isSpecial = isRevealed && player.revealedCard.type !== 'normal';

            slot.innerHTML = `
                <div class="slot-avatar p-color-${i}">${i + 1}</div>
                <div class="slot-name">${player.name}</div>
                <div class="slot-nickname">"${player.nickname}"</div>
                ${hasCards ? `
                    <div class="slot-card-area">
                        <div class="slot-card" id="card-${i}">
                            <div class="card-back"></div>
                            <div class="card-front ${isSpecial ? 'special-card' : ''}">
                                <span class="card-symbol">${isRevealed ? player.revealedCard.emoji : ''}</span>
                                <span class="card-label">${isRevealed ? player.revealedCard.name : ''}</span>
                            </div>
                        </div>
                    </div>
                    <div class="slot-card-count">📚 ${player.pile.length} cartas</div>
                ` : `
                    <div class="slot-empty-marker">✓</div>
                    <div class="slot-card-count" style="color: var(--clr-green);">0 cartas!</div>
                `}
            `;
            table.appendChild(slot);

            // If this card was already revealed from a previous turn, flip it immediately (no animation)
            if (isRevealed && player.pile.length > 0 || (isRevealed && player.pile.length === 0)) {
                const cardEl = slot.querySelector(`#card-${i}`);
                if (cardEl) {
                    // Skip transition for already-revealed cards
                    cardEl.style.transition = 'none';
                    cardEl.classList.add('flipped');
                    // Re-enable transition after paint
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            cardEl.style.transition = '';
                        });
                    });
                }
            }
        });

        // Update center pile
        const centerEl = $('#center-pile');
        if (state.centerPile > 0) {
            centerEl.classList.remove('hidden');
            centerEl.querySelector('.pile-count').textContent = state.centerPile;
        } else {
            centerEl.classList.add('hidden');
        }
    }

    function updateTurnIndicator() {
        const current = state.players[state.currentTurnIndex];
        if (current) {
            $('#turn-indicator').textContent = `Vez de: ${current.name}`;
        }

        // Highlight current player slot
        $$('.player-slot').forEach(s => s.classList.remove('current-turn'));
        const currentSlot = $(`#slot-${state.currentTurnIndex}`);
        if (currentSlot) currentSlot.classList.add('current-turn');

        // Enable/disable reveal button
        const revealBtn = $('#btn-reveal-card');
        if (state.contendaActive || state.surtoActive || state.roundOver) {
            revealBtn.disabled = true;
        } else {
            const currentPlayer = state.players[state.currentTurnIndex];
            revealBtn.disabled = !currentPlayer || currentPlayer.pile.length === 0;
        }
    }

    // ─── REVEAL CARD ───────────────────────────────────
    function revealCard() {
        if (state.contendaActive || state.surtoActive || state.roundOver || state.processing) return;

        const player = state.players[state.currentTurnIndex];
        if (!player || player.pile.length === 0) {
            // Skip to next player
            advanceTurn();
            return;
        }

        state.processing = true;
        const revealingPlayerIdx = state.currentTurnIndex;
        const card = player.pile.shift();
        player.revealedCard = card;

        // Re-render
        renderGameTable();
        updateTurnIndicator();

        // Animate card flip with a tiny delay so the browser paints the un-flipped state first
        requestAnimationFrame(() => {
            const cardEl = $(`#card-${revealingPlayerIdx}`);
            if (cardEl) {
                cardEl.classList.add('flipped');
                const area = cardEl.closest('.slot-card-area');
                if (area) area.classList.add('card-reveal-glow');
            }
        });

        // Check for special cards
        if (card.type === '123') {
            setTimeout(() => { state.processing = false; handle123Card(); }, 800);
            return;
        }

        if (card.type === 'telma') {
            setTimeout(() => { state.processing = false; handleTelmaCard(); }, 800);
            return;
        }

        // Check for matches
        setTimeout(() => {
            state.processing = false;
            const matchResult = checkForMatches();
            if (matchResult) {
                startContenda(matchResult);
            } else {
                advanceTurn();
            }
        }, 700);
    }

    // ─── CHECK MATCHES ─────────────────────────────────
    function checkForMatches() {
        const revealed = state.players
            .map((p, i) => ({ player: p, index: i }))
            .filter(({ player }) => player.revealedCard && player.revealedCard.type === 'normal');

        // Group by symbol
        const groups = {};
        revealed.forEach(({ player, index }) => {
            const key = player.revealedCard.emoji;
            if (!groups[key]) groups[key] = [];
            groups[key].push(index);
        });

        // Find a match (two or more with same symbol)
        for (const [emoji, indices] of Object.entries(groups)) {
            if (indices.length >= 2) {
                return { emoji, players: indices };
            }
        }

        return null;
    }

    // ─── CONTENDA ──────────────────────────────────────
    function startContenda(matchResult) {
        state.contendaActive = true;
        updateTurnIndicator();

        const overlay = $('#contenda-overlay');
        const playersContainer = $('#contenda-players');
        const desc = $('#contenda-desc');

        desc.textContent = `Símbolo ${matchResult.emoji} repetido! Digite o apelido do oponente!`;

        playersContainer.innerHTML = '';
        matchResult.players.forEach(idx => {
            const player = state.players[idx];
            // Each player must type the OTHER player's nickname
            const opponentIndices = matchResult.players.filter(i => i !== idx);
            const opponents = opponentIndices.map(i => state.players[i]);

            const card = document.createElement('div');
            card.className = 'contenda-player-card';
            card.id = `cp-${idx}`;
            card.innerHTML = `
                <div class="cp-name" style="color: var(--clr-text);">${player.name}</div>
                <div class="cp-instruction">Digite o apelido de: ${opponents.map(o => o.name).join(' ou ')}</div>
                <input type="text" id="contenda-input-${idx}" placeholder="Digite aqui..." autocomplete="off" data-player="${idx}" />
            `;
            playersContainer.appendChild(card);
        });

        // Set timer
        const timerBar = $('#contenda-timer-bar');
        timerBar.style.setProperty('--timer-duration', `${CONTENDA_TIME_MS / 1000}s`);
        timerBar.style.animation = 'none';
        timerBar.offsetHeight; // force reflow
        timerBar.style.animation = '';

        overlay.classList.remove('hidden');

        // Focus first input
        setTimeout(() => {
            const firstInput = playersContainer.querySelector('input');
            if (firstInput) firstInput.focus();
        }, 100);

        // Listen for input
        const inputs = playersContainer.querySelectorAll('input');
        const contendaHandler = (e) => {
            if (e.key === 'Enter') {
                const inputEl = e.target;
                const playerIdx = parseInt(inputEl.dataset.player);
                const typed = inputEl.value.trim().toLowerCase();

                // Check if typed matches any opponent's nickname
                const opponentIndices = matchResult.players.filter(i => i !== playerIdx);
                const matchedOpponent = opponentIndices.find(i =>
                    state.players[i].nickname.toLowerCase() === typed
                );

                if (matchedOpponent !== undefined) {
                    resolveContenda(playerIdx, matchedOpponent, matchResult);
                    inputs.forEach(inp => inp.removeEventListener('keydown', contendaHandler));
                } else {
                    inputEl.value = '';
                    inputEl.style.borderColor = 'var(--clr-red)';
                    showToast('Apelido incorreto!', 'error', 1500);
                    setTimeout(() => { inputEl.style.borderColor = 'transparent'; }, 1000);
                }
            }
        };

        inputs.forEach(inp => inp.addEventListener('keydown', contendaHandler));

        // Timeout — no winner
        state.contendaTimeout = setTimeout(() => {
            if (state.contendaActive) {
                // Tie — nobody typed in time
                resolveContendaTie(matchResult);
                inputs.forEach(inp => inp.removeEventListener('keydown', contendaHandler));
            }
        }, CONTENDA_TIME_MS);
    }

    function resolveContenda(winnerIdx, loserIdx, matchResult) {
        clearTimeout(state.contendaTimeout);
        state.contendaActive = false;

        const winner = state.players[winnerIdx];
        const loser = state.players[loserIdx];

        // Visual feedback
        const winCard = $(`#cp-${winnerIdx}`);
        const loseCard = $(`#cp-${loserIdx}`);
        if (winCard) winCard.classList.add('winner');
        if (loseCard) loseCard.classList.add('loser');

        showToast(`${winner.name} venceu a contenda! ${loser.name} recolhe as cartas.`, 'success', 3000);

        setTimeout(() => {
            // Loser collects all revealed cards + center pile
            const collectedCards = [];
            state.players.forEach(p => {
                if (p.revealedCard) {
                    collectedCards.push(p.revealedCard);
                    p.revealedCard = null;
                }
            });

            // Add center pile cards (as blank fillers)
            for (let i = 0; i < state.centerPile; i++) {
                collectedCards.push({ emoji: '❓', name: '?', type: 'normal' });
            }
            state.centerPile = 0;

            // Shuffle collected and add to loser's pile
            shuffleArray(collectedCards);
            loser.pile.push(...collectedCards);

            // Check for round end
            if (checkRoundEnd()) return;

            // Reset turn — loser starts next
            state.currentTurnIndex = loserIdx;
            renderGameTable();
            updateTurnIndicator();

            // Hide overlay
            $('#contenda-overlay').classList.add('hidden');
        }, 1500);
    }

    function resolveContendaTie(matchResult) {
        clearTimeout(state.contendaTimeout);
        state.contendaActive = false;

        showToast('Tempo esgotado! Empate — cartas divididas!', 'info', 3000);

        setTimeout(() => {
            // Collect all revealed cards
            const collectedCards = [];
            state.players.forEach(p => {
                if (p.revealedCard) {
                    collectedCards.push(p.revealedCard);
                    p.revealedCard = null;
                }
            });

            // Divide among contenda players
            const playersInContenda = matchResult.players;
            shuffleArray(collectedCards);

            let cardIdx = 0;
            while (cardIdx < collectedCards.length) {
                const targetIdx = playersInContenda[cardIdx % playersInContenda.length];
                state.players[targetIdx].pile.push(collectedCards[cardIdx]);
                cardIdx++;
            }

            // Remaining odd card goes to center
            // (already handled above; center pile for truly leftover)

            if (checkRoundEnd()) return;

            // Next turn after first player in contenda
            state.currentTurnIndex = (playersInContenda[0] + 1) % state.players.length;
            skipEliminatedPlayers();
            renderGameTable();
            updateTurnIndicator();

            $('#contenda-overlay').classList.add('hidden');
        }, 1500);
    }

    // ─── SPECIAL CARDS ─────────────────────────────────
    function handle123Card() {
        showToast('🔢 Carta "1, 2, 3!" — Todos revelam ao mesmo tempo!', 'info', 3000);

        setTimeout(() => {
            // All players reveal simultaneously
            state.players.forEach(p => {
                if (p.pile.length > 0) {
                    const card = p.pile.shift();
                    p.revealedCard = card;
                }
            });

            renderGameTable();

            // Flip all cards
            state.players.forEach((p, i) => {
                const cardEl = $(`#card-${i}`);
                if (cardEl && p.revealedCard) {
                    cardEl.classList.add('flipped');
                }
            });

            // Check for matches
            setTimeout(() => {
                const matchResult = checkForMatches();
                if (matchResult) {
                    startContenda(matchResult);
                } else {
                    showToast('Nenhum par encontrado! Jogo continua.', 'info');
                    advanceTurn();
                }
            }, 1000);
        }, 1500);
    }

    function handleTelmaCard() {
        state.surtoActive = true;
        updateTurnIndicator();

        showToast('🌪️ CARTA DA TELMA! SURTO!!!', 'error', 3000);

        const overlay = $('#surto-overlay');
        const inputsContainer = $('#surto-inputs');
        inputsContainer.innerHTML = '';

        state.players.forEach((player, i) => {
            const card = document.createElement('div');
            card.className = 'surto-input-card';
            card.innerHTML = `
                <div class="si-label">${player.name}</div>
                <input type="text" id="surto-input-${i}" placeholder="Apelido de quem?" autocomplete="off" data-player="${i}" />
            `;
            inputsContainer.appendChild(card);
        });

        // Set timer
        const timerBar = $('#surto-timer-bar');
        timerBar.style.setProperty('--timer-duration', `${CONTENDA_TIME_MS / 1000}s`);
        timerBar.style.animation = 'none';
        timerBar.offsetHeight;
        timerBar.style.animation = '';

        overlay.classList.remove('hidden');

        setTimeout(() => {
            const firstInput = inputsContainer.querySelector('input');
            if (firstInput) firstInput.focus();
        }, 100);

        // Listen for any correct nickname
        const inputs = inputsContainer.querySelectorAll('input');
        const surtoHandler = (e) => {
            if (e.key === 'Enter') {
                const inputEl = e.target;
                const callerIdx = parseInt(inputEl.dataset.player);
                const typed = inputEl.value.trim().toLowerCase();

                // Check if typed matches ANY other player's nickname
                const matchedPlayer = state.players.find((p, i) =>
                    i !== callerIdx && p.nickname.toLowerCase() === typed
                );

                if (matchedPlayer) {
                    resolveSurto(callerIdx, matchedPlayer.id);
                    inputs.forEach(inp => inp.removeEventListener('keydown', surtoHandler));
                } else {
                    inputEl.value = '';
                    inputEl.style.borderColor = 'var(--clr-red)';
                    showToast('Apelido incorreto!', 'error', 1500);
                    setTimeout(() => { inputEl.style.borderColor = 'transparent'; }, 1000);
                }
            }
        };

        inputs.forEach(inp => inp.addEventListener('keydown', surtoHandler));

        state.contendaTimeout = setTimeout(() => {
            if (state.surtoActive) {
                resolveSurtoTimeout();
                inputs.forEach(inp => inp.removeEventListener('keydown', surtoHandler));
            }
        }, CONTENDA_TIME_MS);
    }

    function resolveSurto(winnerIdx, loserIdx) {
        clearTimeout(state.contendaTimeout);
        state.surtoActive = false;

        const winner = state.players[winnerIdx];
        const loser = state.players[loserIdx];

        showToast(`${winner.name} chamou "${loser.nickname}"! ${loser.name} recolhe tudo!`, 'success', 3000);

        setTimeout(() => {
            const collectedCards = [];
            state.players.forEach(p => {
                if (p.revealedCard) {
                    collectedCards.push(p.revealedCard);
                    p.revealedCard = null;
                }
            });
            for (let i = 0; i < state.centerPile; i++) {
                collectedCards.push({ emoji: '❓', name: '?', type: 'normal' });
            }
            state.centerPile = 0;

            shuffleArray(collectedCards);
            loser.pile.push(...collectedCards);

            if (checkRoundEnd()) return;

            state.currentTurnIndex = loserIdx;
            renderGameTable();
            updateTurnIndicator();

            $('#surto-overlay').classList.add('hidden');
        }, 1500);
    }

    function resolveSurtoTimeout() {
        clearTimeout(state.contendaTimeout);
        state.surtoActive = false;

        showToast('Ninguém conseguiu! Cartas vão para o centro.', 'info', 3000);

        setTimeout(() => {
            let count = 0;
            state.players.forEach(p => {
                if (p.revealedCard) {
                    count++;
                    p.revealedCard = null;
                }
            });
            state.centerPile += count;

            if (checkRoundEnd()) return;

            advanceTurn();
            renderGameTable();
            updateTurnIndicator();

            $('#surto-overlay').classList.add('hidden');
        }, 1500);
    }

    // ─── TURN MANAGEMENT ───────────────────────────────
    function advanceTurn() {
        state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
        skipEliminatedPlayers();
        updateTurnIndicator();
    }

    function skipEliminatedPlayers() {
        let attempts = 0;
        while (
            state.players[state.currentTurnIndex].pile.length === 0 &&
            !state.players[state.currentTurnIndex].revealedCard &&
            attempts < state.players.length
        ) {
            state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
            attempts++;
        }
    }

    // ─── ROUND END ─────────────────────────────────────
    function checkRoundEnd() {
        // A player wins when they have 0 cards in pile AND no revealed card
        const winner = state.players.find(p => p.pile.length === 0 && !p.revealedCard);
        if (!winner) return false;

        state.roundOver = true;
        state.contendaActive = false;
        state.surtoActive = false;

        winner.score += (state.currentRound === 3 ? 2 : 1);

        // Hide overlays
        $('#contenda-overlay').classList.add('hidden');
        $('#surto-overlay').classList.add('hidden');

        setTimeout(() => {
            showRoundEnd(winner);
        }, 1000);

        return true;
    }

    function showRoundEnd(winner) {
        // Check if game is over
        const maxScore = Math.max(...state.players.map(p => p.score));
        const playersWithMax = state.players.filter(p => p.score === maxScore);

        // Game is over if: round 3, or someone has 2+ points and no tie
        const gameOver = state.currentRound >= 3 || (maxScore >= 2 && playersWithMax.length === 1);

        if (gameOver) {
            showGameOver(playersWithMax[0] || winner);
            return;
        }

        // Check if we need a tiebreaker round
        const needTieBreaker = state.currentRound === 2 && playersWithMax.length > 1 && maxScore >= 1;

        $('#round-end-title').textContent = `Fim da Rodada ${state.currentRound}!`;
        $('#round-end-message').textContent = `${winner.name} venceu a rodada!`;

        // Scores
        const scoresContainer = $('#round-end-scores');
        scoresContainer.innerHTML = '';
        state.players.sort((a, b) => b.score - a.score).forEach(p => {
            const item = document.createElement('div');
            item.className = 'round-score-item';
            item.innerHTML = `
                <span class="rsi-name">${p.name} ("${p.nickname}")</span>
                <span class="rsi-pts">${p.score} pts</span>
            `;
            scoresContainer.appendChild(item);
        });

        // Next round button
        const nextBtn = $('#btn-next-round');
        if (needTieBreaker || state.currentRound < 3) {
            nextBtn.querySelector('.btn-text').textContent =
                needTieBreaker ? 'Rodada de Desempate!' : 'Próxima Rodada';
            nextBtn.classList.remove('hidden');
        }

        spawnConfetti('confetti');
        showScreen('roundEnd');
    }

    function showGameOver(winner) {
        $('#gameover-title').textContent = 'VITÓRIA!';
        $('#gameover-message').textContent = `${winner.name} é o grande campeão! 🏆`;

        const scoresContainer = $('#final-scores');
        scoresContainer.innerHTML = '';
        state.players.sort((a, b) => b.score - a.score).forEach(p => {
            const item = document.createElement('div');
            item.className = 'round-score-item';
            item.innerHTML = `
                <span class="rsi-name">${p.name}</span>
                <span class="rsi-pts">${p.score} pts</span>
            `;
            scoresContainer.appendChild(item);
        });

        spawnConfetti('confetti-final');
        showScreen('gameover');
    }

    // ─── SCOREBOARD ────────────────────────────────────
    function renderScoreboard() {
        const list = $('#scoreboard-list');
        list.innerHTML = '';
        const sorted = [...state.players].sort((a, b) => b.score - a.score);
        sorted.forEach((p, i) => {
            const row = document.createElement('div');
            row.className = 'score-row';
            row.innerHTML = `
                <span class="sr-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
                <div>
                    <div class="sr-name">${p.name}</div>
                    <div class="sr-nickname">"${p.nickname}"</div>
                </div>
                <span class="sr-points">${p.score}</span>
            `;
            list.appendChild(row);
        });
    }

    // ─── UTILS ─────────────────────────────────────────
    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    // ─── EVENT LISTENERS ───────────────────────────────
    function bindEvents() {
        // Splash → Menu
        setTimeout(() => {
            showScreen('menu');
        }, SPLASH_DURATION);

        // Menu
        $('#btn-new-game').addEventListener('click', () => {
            state = {
                players: [],
                currentRound: 1,
                currentTurnIndex: 0,
                tableCards: [],
                centerPile: 0,
                revealPhase: false,
                contendaActive: false,
                surtoActive: false,
                gameStarted: false,
                roundOver: false,
                contendaTimer: null,
                contendaTimeout: null,
            };
            initLobby(false);
        });

        $('#btn-rules').addEventListener('click', () => showModal('rules'));
        $('#close-rules').addEventListener('click', () => hideModal('rules'));

        // Player count
        $('#btn-minus-players').addEventListener('click', () => {
            const el = $('#player-count');
            let count = parseInt(el.textContent);
            if (count > 2) {
                el.textContent = --count;
                generatePlayerInputs();
            }
        });

        $('#btn-plus-players').addEventListener('click', () => {
            const el = $('#player-count');
            let count = parseInt(el.textContent);
            if (count < 8) {
                el.textContent = ++count;
                generatePlayerInputs();
            }
        });

        // Start game
        $('#btn-start-game').addEventListener('click', startGame);

        // Reveal card
        $('#btn-reveal-card').addEventListener('click', revealCard);

        // Scoreboard
        $('#btn-scoreboard').addEventListener('click', () => {
            renderScoreboard();
            showModal('scoreboard');
        });
        $('#close-scoreboard').addEventListener('click', () => hideModal('scoreboard'));
        $('#btn-close-score').addEventListener('click', () => hideModal('scoreboard'));

        // Next round
        $('#btn-next-round').addEventListener('click', () => {
            state.currentRound++;
            state.roundOver = false;
            initLobby(true);
        });

        // Play again
        $('#btn-play-again').addEventListener('click', () => {
            state = {
                players: [],
                currentRound: 1,
                currentTurnIndex: 0,
                tableCards: [],
                centerPile: 0,
                revealPhase: false,
                contendaActive: false,
                surtoActive: false,
                gameStarted: false,
                roundOver: false,
                contendaTimer: null,
                contendaTimeout: null,
            };
            showScreen('menu');
        });

        // Modal overlay clicks
        $$('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', () => {
                overlay.closest('.modal').classList.add('hidden');
            });
        });

        // Keyboard shortcut — Space to reveal
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && screens.game.classList.contains('active') &&
                !state.contendaActive && !state.surtoActive && !state.roundOver) {
                e.preventDefault();
                revealCard();
            }
        });
    }

    // ─── INIT ──────────────────────────────────────────
    function init() {
        bindEvents();
        showScreen('splash');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
