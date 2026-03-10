/* ═══════════════════════════════════════════════════════
   TELMA — ONLINE MULTIPLAYER CLIENT
   Socket.IO Client
   ═══════════════════════════════════════════════════════ */

(() => {
    'use strict';

    const SPLASH_DURATION = 2400;

    // ─── CONNECTION ────────────────────────────────────
    const socket = io();

    // ─── LOCAL STATE ───────────────────────────────────
    let myPlayerId = null;
    let myRoomCode = null;
    let isHost = false;
    let gameState = null;

    // ─── DOM REFS ──────────────────────────────────────
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

    // ─── SCREEN NAVIGATION ────────────────────────────
    function showScreen(name) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[name].classList.add('active');
    }

    function showModal(id) {
        document.getElementById(id)?.classList.remove('hidden');
    }

    function hideModal(id) {
        document.getElementById(id)?.classList.add('hidden');
    }

    // ─── TOAST ─────────────────────────────────────────
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

    // ─── CONFETTI ──────────────────────────────────────
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

    // ─── SPLASH ────────────────────────────────────────
    setTimeout(() => {
        showScreen('menu');
    }, SPLASH_DURATION);

    // ─── MENU EVENTS ───────────────────────────────────
    $('#btn-create-room').addEventListener('click', () => showModal('create-modal'));
    $('#btn-join-room').addEventListener('click', () => showModal('join-modal'));
    $('#btn-rules').addEventListener('click', () => showModal('rules-modal'));

    // Close modals
    document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
        el.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) modal.classList.add('hidden');
        });
    });

    // ─── CREATE ROOM ───────────────────────────────────
    $('#btn-do-create').addEventListener('click', () => {
        const name = $('#create-name').value.trim();
        const nickname = $('#create-nickname').value.trim();

        if (!nickname) {
            showToast('Escolha um apelido!', 'error');
            return;
        }

        socket.emit('createRoom', { playerName: name || 'Jogador 1', nickname }, (res) => {
            if (res.success) {
                myPlayerId = res.playerId;
                myRoomCode = res.code;
                isHost = true;
                gameState = res.state;
                hideModal('create-modal');
                renderLobby(res.state);
                showScreen('lobby');
                showToast('Sala criada! Compartilhe o código!', 'success');
            } else {
                showToast(res.error || 'Erro ao criar sala', 'error');
            }
        });
    });

    // ─── JOIN ROOM ─────────────────────────────────────
    $('#btn-do-join').addEventListener('click', () => {
        const code = $('#join-code').value.trim();
        const name = $('#join-name').value.trim();
        const nickname = $('#join-nickname').value.trim();

        if (!code) {
            showToast('Digite o código da sala!', 'error');
            return;
        }
        if (!nickname) {
            showToast('Escolha um apelido!', 'error');
            return;
        }

        socket.emit('joinRoom', {
            code,
            playerName: name || `Jogador`,
            nickname,
        }, (res) => {
            if (res.success) {
                myPlayerId = res.playerId;
                myRoomCode = res.code;
                isHost = false;
                gameState = res.state;
                hideModal('join-modal');
                renderLobby(res.state);
                showScreen('lobby');
                showToast('Você entrou na sala!', 'success');
            } else {
                showToast(res.error || 'Erro ao entrar', 'error');
            }
        });
    });

    // ─── COPY ROOM CODE ────────────────────────────────
    $('#btn-copy-code').addEventListener('click', () => {
        navigator.clipboard.writeText(myRoomCode).then(() => {
            showToast('Código copiado!', 'success', 1500);
        }).catch(() => {
            showToast(myRoomCode, 'info', 3000);
        });
    });

    // ─── LOBBY RENDER ──────────────────────────────────
    function renderLobby(state) {
        gameState = state;
        $('#room-code').textContent = state.code;
        $('#lobby-status').textContent = `${state.players.length} jogador(es) na sala`;

        const container = $('#lobby-players');
        container.innerHTML = '';
        state.players.forEach((p, i) => {
            const card = document.createElement('div');
            card.className = `lobby-player-card ${p.id === myPlayerId ? 'is-you' : ''}`;
            card.innerHTML = `
                <div class="player-avatar p-color-${i}">${i + 1}</div>
                <div class="lpc-info">
                    <div class="lpc-name">${p.name}${p.id === myPlayerId ? ' (você)' : ''}</div>
                    <div class="lpc-nickname">"${p.nickname}"</div>
                </div>
                ${p.id === state.hostId ? '<span class="lpc-badge host-badge">HOST</span>' : ''}
                <div class="connection-dot ${p.connected ? '' : 'disconnected'}"></div>
            `;
            container.appendChild(card);
        });

        // Show/hide host controls
        if (isHost) {
            $('#host-controls').classList.remove('hidden');
            $('#guest-controls').classList.add('hidden');
            const startBtn = $('#btn-start-online');
            startBtn.disabled = state.players.length < 2;
        } else {
            $('#host-controls').classList.add('hidden');
            $('#guest-controls').classList.remove('hidden');
        }
    }

    // ─── START GAME ────────────────────────────────────
    $('#btn-start-online').addEventListener('click', () => {
        socket.emit('startGame', (res) => {
            if (!res.success) {
                showToast(res.error || 'Erro ao iniciar', 'error');
            }
        });
    });

    // ─── GAME TABLE RENDER ─────────────────────────────
    function renderGameTable(state) {
        gameState = state;
        const table = $('#game-table');
        table.innerHTML = '';

        $('#game-round').textContent = state.currentRound;
        $('#game-room-code').textContent = `Sala: ${state.code}`;

        state.players.forEach((player, i) => {
            const slot = document.createElement('div');
            slot.className = 'player-slot';
            slot.id = `slot-${i}`;
            if (player.id === myPlayerId) slot.classList.add('is-you');
            if (!player.connected) slot.classList.add('disconnected');
            if (i === state.currentTurnIndex) slot.classList.add('current-turn');

            const hasCards = player.pileCount > 0 || player.revealedCard;
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
                    <div class="slot-card-count">📚 ${player.pileCount} cartas</div>
                ` : `
                    <div class="slot-empty-marker">✓</div>
                    <div class="slot-card-count" style="color: var(--clr-green);">0 cartas!</div>
                `}
            `;
            table.appendChild(slot);

            // Flip already-revealed cards instantly
            if (isRevealed) {
                const cardEl = slot.querySelector(`#card-${i}`);
                if (cardEl) {
                    cardEl.style.transition = 'none';
                    cardEl.classList.add('flipped');
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

        // Turn indicator
        const current = state.players[state.currentTurnIndex];
        if (current) {
            const isMyTurn = current.id === myPlayerId;
            $('#turn-indicator').textContent = isMyTurn
                ? '🟢 SUA VEZ!'
                : `Vez de: ${current.name}`;
            $('#turn-indicator').style.color = isMyTurn ? 'var(--clr-green)' : 'var(--clr-gold)';
        }

        // Reveal button
        updateRevealButton(state);
    }

    function updateRevealButton(state) {
        const revealBtn = $('#btn-reveal-card');
        const currentPlayer = state.players[state.currentTurnIndex];
        const isMyTurn = currentPlayer && currentPlayer.id === myPlayerId;
        const isPlaying = state.phase === 'playing';

        revealBtn.disabled = !(isMyTurn && isPlaying && currentPlayer.pileCount > 0);

        if (isMyTurn && isPlaying) {
            revealBtn.querySelector('span').textContent = '🃏 Revelar Carta';
        } else if (!isPlaying) {
            revealBtn.querySelector('span').textContent = '⏳ Aguarde...';
        } else {
            revealBtn.querySelector('span').textContent = `⏳ Vez de ${currentPlayer?.name || '...'}`;
        }
    }

    // ─── REVEAL CARD ───────────────────────────────────
    $('#btn-reveal-card').addEventListener('click', () => {
        if ($('#btn-reveal-card').disabled) return;
        $('#btn-reveal-card').disabled = true;

        socket.emit('revealCard', (res) => {
            if (!res.success) {
                showToast(res.error || 'Erro ao revelar', 'error');
                $('#btn-reveal-card').disabled = false;
            }
        });
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.target.matches('input')) {
            e.preventDefault();
            const btn = $('#btn-reveal-card');
            if (btn && !btn.disabled) {
                btn.click();
            }
        }
    });

    // ─── SCOREBOARD ────────────────────────────────────
    $('#btn-scoreboard').addEventListener('click', () => {
        renderScoreboard();
        showModal('scoreboard-modal');
    });

    function renderScoreboard() {
        if (!gameState) return;
        const list = $('#scoreboard-list');
        list.innerHTML = '';
        const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
        sorted.forEach((p, i) => {
            const row = document.createElement('div');
            row.className = 'score-row';
            row.innerHTML = `
                <span class="sr-rank">${i + 1}</span>
                <span class="sr-name">${p.name}</span>
                <span class="sr-nickname">"${p.nickname}"</span>
                <span class="sr-points">${p.score} pts</span>
            `;
            list.appendChild(row);
        });
    }

    // ─── CONTENDA INPUT ────────────────────────────────
    const contendaInput = $('#contenda-input');
    contendaInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const answer = contendaInput.value.trim();
            if (!answer) return;

            socket.emit('contendaAnswer', { answer }, (res) => {
                if (res && !res.correct) {
                    contendaInput.value = '';
                    contendaInput.style.borderColor = 'var(--clr-red)';
                    showToast(res.error || 'Incorreto!', 'error', 1500);
                    setTimeout(() => { contendaInput.style.borderColor = ''; }, 1000);
                }
            });
        }
    });

    // ─── SURTO INPUT ───────────────────────────────────
    const surtoInput = $('#surto-input');
    surtoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const answer = surtoInput.value.trim();
            if (!answer) return;

            socket.emit('contendaAnswer', { answer }, (res) => {
                if (res && !res.correct) {
                    surtoInput.value = '';
                    surtoInput.style.borderColor = 'var(--clr-red)';
                    showToast(res.error || 'Incorreto!', 'error', 1500);
                    setTimeout(() => { surtoInput.style.borderColor = ''; }, 1000);
                }
            });
        }
    });

    // ─── ROUND END — MODIFIER ──────────────────────────
    $('#btn-submit-modifier').addEventListener('click', () => {
        const modifier = $('#modifier-input').value.trim();
        if (!modifier) {
            showToast('Preencha o campo!', 'error');
            return;
        }

        socket.emit('nextRound', { modifier }, (res) => {
            if (res.success) {
                $('#btn-submit-modifier').disabled = true;
                $('#modifier-waiting').classList.remove('hidden');
                showToast('Enviado! Aguardando outros jogadores...', 'info');
            }
        });
    });

    // ─── PLAY AGAIN ────────────────────────────────────
    $('#btn-play-again')?.addEventListener('click', () => {
        socket.emit('playAgain', (res) => {
            if (!res.success) {
                showToast('Erro ao reiniciar', 'error');
            }
        });
    });

    // ═══════════════════════════════════════════════════════
    //  SOCKET EVENT HANDLERS
    // ═══════════════════════════════════════════════════════

    // Room update (generic state sync)
    socket.on('roomUpdate', (state) => {
        gameState = state;
        if (state.phase === 'lobby') {
            renderLobby(state);
        } else if (state.phase === 'playing') {
            renderGameTable(state);
            // Hide overlays
            $('#contenda-overlay').classList.add('hidden');
            $('#surto-overlay').classList.add('hidden');
        }
    });

    // Game started
    socket.on('gameStarted', (state) => {
        gameState = state;
        renderGameTable(state);
        showScreen('game');
        showToast('🃏 Que comece o jogo!', 'success');
    });

    // Card revealed
    socket.on('cardRevealed', ({ playerIndex, card, state }) => {
        gameState = state;
        renderGameTable(state);

        // Animate the newly revealed card with a flip
        requestAnimationFrame(() => {
            const cardEl = $(`#card-${playerIndex}`);
            if (cardEl) {
                // Reset to un-flipped
                cardEl.style.transition = 'none';
                cardEl.classList.remove('flipped');
                requestAnimationFrame(() => {
                    cardEl.style.transition = '';
                    cardEl.classList.add('flipped');
                    const area = cardEl.closest('.slot-card-area');
                    if (area) area.classList.add('card-reveal-glow');
                });
            }
        });
    });

    // Contenda started
    socket.on('contendaStarted', ({ emoji, playerIndices, state, timeMs }) => {
        gameState = state;
        const isInContenda = playerIndices.includes(myPlayerId);

        const overlay = $('#contenda-overlay');
        const desc = $('#contenda-desc');
        desc.textContent = `Símbolo ${emoji} repetido! ⚔️`;

        // Show correct section
        if (isInContenda) {
            const opponentIndices = playerIndices.filter(i => i !== myPlayerId);
            const opponents = opponentIndices.map(i => state.players[i]);
            $('#ci-instruction').textContent = `Digite o apelido de: ${opponents.map(o => o.name).join(' ou ')}`;
            $('#contenda-input-section').classList.remove('hidden');
            $('#contenda-spectator').classList.add('hidden');
            contendaInput.value = '';
            setTimeout(() => contendaInput.focus(), 100);
        } else {
            $('#contenda-input-section').classList.add('hidden');
            $('#contenda-spectator').classList.remove('hidden');
        }

        // Timer
        const timerBar = $('#contenda-timer-bar');
        timerBar.style.setProperty('--timer-duration', `${timeMs / 1000}s`);
        timerBar.style.animation = 'none';
        timerBar.offsetHeight;
        timerBar.style.animation = '';

        overlay.classList.remove('hidden');
    });

    // Contenda resolved
    socket.on('contendaResolved', ({ winnerId, loserId, winnerName, loserName, cardsCollected }) => {
        showToast(`${winnerName} venceu! ${loserName} recolhe ${cardsCollected} cartas.`, 'success', 3000);
        setTimeout(() => {
            $('#contenda-overlay').classList.add('hidden');
        }, 1500);
    });

    // Contenda tied
    socket.on('contendaTied', ({ message }) => {
        showToast(message, 'info', 3000);
        setTimeout(() => {
            $('#contenda-overlay').classList.add('hidden');
        }, 1500);
    });

    // Contenda wrong (for this player specifically)
    socket.on('contendaWrong', () => {
        // Already handled by callback
    });

    // Special 1-2-3
    socket.on('special123', ({ message }) => {
        showToast(`🔢 ${message}`, 'info', 3000);
    });

    // All cards revealed (after 1-2-3)
    socket.on('allCardsRevealed', ({ state }) => {
        gameState = state;
        renderGameTable(state);
        // Animate all cards
        state.players.forEach((p, i) => {
            if (p.revealedCard) {
                requestAnimationFrame(() => {
                    const cardEl = $(`#card-${i}`);
                    if (cardEl) {
                        cardEl.style.transition = 'none';
                        cardEl.classList.remove('flipped');
                        requestAnimationFrame(() => {
                            cardEl.style.transition = '';
                            cardEl.classList.add('flipped');
                        });
                    }
                });
            }
        });
    });

    // Surto started
    socket.on('surtoStarted', ({ state, timeMs }) => {
        gameState = state;
        showToast('🌪️ CARTA DA TELMA! SURTO!!!', 'error', 3000);

        const overlay = $('#surto-overlay');
        surtoInput.value = '';

        const timerBar = $('#surto-timer-bar');
        timerBar.style.setProperty('--timer-duration', `${timeMs / 1000}s`);
        timerBar.style.animation = 'none';
        timerBar.offsetHeight;
        timerBar.style.animation = '';

        overlay.classList.remove('hidden');
        setTimeout(() => surtoInput.focus(), 100);
    });

    // Surto resolved
    socket.on('surtoResolved', ({ winnerName, loserName, loserNickname, cardsCollected }) => {
        showToast(`${winnerName} chamou "${loserNickname}"! ${loserName} recolhe ${cardsCollected} cartas!`, 'success', 3000);
        setTimeout(() => {
            $('#surto-overlay').classList.add('hidden');
        }, 1500);
    });

    // Surto timeout
    socket.on('surtoTimeout', ({ message }) => {
        showToast(message, 'info', 3000);
        setTimeout(() => {
            $('#surto-overlay').classList.add('hidden');
        }, 1500);
    });

    // Round ended
    socket.on('roundEnded', ({ winnerId, winnerName, round, nextRound, state }) => {
        gameState = state;

        $('#round-end-title').textContent = `Fim da Rodada ${round}!`;
        $('#round-end-message').textContent = `${winnerName} venceu esta rodada se livrando de todas as cartas!`;

        // Scores
        const scoresContainer = $('#round-end-scores');
        scoresContainer.innerHTML = '';
        state.players.forEach(p => {
            const item = document.createElement('div');
            item.className = 'round-score-item';
            item.innerHTML = `
                <span class="rsi-name">${p.name}</span>
                <span class="rsi-pts">${p.score} pts</span>
            `;
            scoresContainer.appendChild(item);
        });

        // Modifier input
        const modSection = $('#modifier-section');
        const modTitle = $('#modifier-title');
        const modInput = $('#modifier-input');
        $('#btn-submit-modifier').disabled = false;
        $('#modifier-waiting').classList.add('hidden');

        if (nextRound === 2) {
            modTitle.textContent = '🎨 Adicione um adjetivo ao seu apelido!';
            modInput.placeholder = 'Ex: azul, grande, brilhante';
        } else if (nextRound === 3) {
            modTitle.textContent = '💃 Adicione uma ação ao seu apelido!';
            modInput.placeholder = 'Ex: que dança, que voa';
        }
        modInput.value = '';

        spawnConfetti('confetti');
        showScreen('roundEnd');
    });

    // New round started
    socket.on('newRoundStarted', (state) => {
        gameState = state;
        renderGameTable(state);
        showScreen('game');
        showToast(`🎉 Rodada ${state.currentRound} começou!`, 'success');
    });

    // Player ready (for modifier submission)
    socket.on('playerReady', ({ readyCount, totalCount }) => {
        showToast(`${readyCount}/${totalCount} jogadores prontos`, 'info', 1500);
    });

    // Game over
    socket.on('gameOver', ({ winnerId, winnerName, state }) => {
        gameState = state;

        $('#gameover-title').textContent = `${winnerName} VENCEU!`;
        $('#gameover-message').textContent = 'Parabéns ao grande campeão de Telma!';

        const scoresContainer = $('#final-scores');
        scoresContainer.innerHTML = '';
        const sorted = [...state.players].sort((a, b) => b.score - a.score);
        sorted.forEach((p, i) => {
            const item = document.createElement('div');
            item.className = 'round-score-item';
            item.innerHTML = `
                <span class="rsi-name">${i + 1}. ${p.name}</span>
                <span class="rsi-pts">${p.score} pts</span>
            `;
            scoresContainer.appendChild(item);
        });

        if (isHost) {
            $('#host-replay').classList.remove('hidden');
        } else {
            $('#host-replay').classList.add('hidden');
        }

        spawnConfetti('confetti-final');
        showScreen('gameover');
    });

    // Back to lobby
    socket.on('backToLobby', (state) => {
        gameState = state;
        renderLobby(state);
        showScreen('lobby');
        showToast('Nova partida! Aguardando o host iniciar.', 'info');
    });

    // Player disconnected
    socket.on('playerDisconnected', ({ playerName, state }) => {
        gameState = state;
        showToast(`${playerName} desconectou!`, 'error', 3000);
        if (state.phase === 'lobby') {
            renderLobby(state);
        } else if (state.phase === 'playing') {
            renderGameTable(state);
        }
    });

    // Player reconnected
    socket.on('playerReconnected', ({ playerName, state }) => {
        gameState = state;
        showToast(`${playerName} reconectou!`, 'success', 2000);
        if (state.phase === 'lobby') {
            renderLobby(state);
        } else if (state.phase === 'playing') {
            renderGameTable(state);
        }
    });

    // Connection status
    socket.on('connect', () => {
        console.log('[CONNECTED] Socket ID:', socket.id);
        // Try to rejoin if we have room info stored
        if (myRoomCode !== null && myPlayerId !== null) {
            socket.emit('rejoinRoom', { code: myRoomCode, playerId: myPlayerId }, (res) => {
                if (res.success) {
                    showToast('Reconectado!', 'success');
                    gameState = res.state;
                    if (res.state.phase === 'lobby') {
                        renderLobby(res.state);
                        showScreen('lobby');
                    } else if (res.state.phase === 'playing' || res.state.phase === 'contenda' || res.state.phase === 'surto') {
                        renderGameTable(res.state);
                        showScreen('game');
                    } else if (res.state.phase === 'roundEnd') {
                        showScreen('roundEnd');
                    } else if (res.state.phase === 'gameOver') {
                        showScreen('gameover');
                    }
                }
            });
        }
    });

    socket.on('disconnect', () => {
        showToast('Conexão perdida... tentando reconectar.', 'error', 5000);
    });

})();
