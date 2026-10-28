(() => {
  'use strict';
  const G = globalThis.WindCliffCore, $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d'), overlay = $('overlay'), panel = $('panel');
  const sceneContainer = $('sceneContainer');
  const storeKey = 'wind-cliff-glide-v1';

  function loadStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey)) || {};
      const unlocked = Math.max(1, Math.min(24, +raw.unlocked || 1));
      const bestScores = (raw.bestScores && typeof raw.bestScores === 'object') ? raw.bestScores : {};
      return { unlocked, bestScores };
    } catch {
      return { unlocked: 1, bestScores: {} };
    }
  }

  function saveStore(unlockedVal, bestScoresVal) {
    try {
      localStorage.setItem(storeKey, JSON.stringify({ unlocked: unlockedVal, bestScores: bestScoresVal }));
    } catch { /* storage blocked */ }
  }

  const saved = loadStore();
  let unlocked = saved.unlocked;
  let bestScores = saved.bestScores;
  let selected = unlocked;
  let state = G.create(selected);
  let mode = 'menu';
  let paused = false;

  let keys = new Set(), pointers = new Map(), boostPointers = new Set(), mouseDirection = 0, releaseQueued = false;
  let joystickPointer = null, joystickSteer = 0;
  let last = 0, accumulator = 0, sound;
  let soundEnabled = true;
  let reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Visual telemetry & non-gameplay feedback buffers
  let trail = [];
  let popups = [];
  let bankFlashTicks = 0;
  let lastBankDelta = 0;
  let crashFlashTicks = 0;
  let grazeTickCounter = 0;
  let lastSteerSign = 0;

  function updatePreferenceButtons() {
    const mBtn = $('motionToggle'), sBtn = $('soundToggle');
    if (mBtn) {
      mBtn.setAttribute('aria-pressed', String(reducedMotion));
      $('motionIcon').textContent = reducedMotion ? '▬' : '≈';
      $('motionText').textContent = reducedMotion ? '모션 감소' : '모션 표준';
    }
    if (sBtn) {
      sBtn.setAttribute('aria-pressed', String(!soundEnabled));
      $('soundIcon').textContent = soundEnabled ? '🔊' : '🔇';
      $('soundText').textContent = soundEnabled ? '효과음 켜짐' : '음소거';
    }
    document.body.classList.toggle('reduced-motion', reducedMotion);
  }

  function beep(freq = 520, length = 0.12, type = 'sine', volume = 0.06, endFreq = null) {
    if (!soundEnabled) return;
    try {
      sound ||= new (window.AudioContext || window.webkitAudioContext)();
      if (sound.state === 'suspended') sound.resume();
      const now = sound.currentTime;
      const osc = sound.createOscillator(), gain = sound.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(55, endFreq || freq * 0.72), now + length);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + length);
      osc.connect(gain).connect(sound.destination);
      osc.start(now);
      osc.stop(now + length);
    } catch { /* audio is optional */ }
  }

  function playSfx(kind) {
    if (!soundEnabled) return;
    if (kind === 'ui') {
      beep(620, 0.05, 'triangle', 0.03, 740);
    } else if (kind === 'steer') {
      beep(240, 0.045, 'sine', 0.018, 290);
    } else if (kind === 'graze') {
      const pitch = Math.min(920, 480 + state.pending * 3.5);
      beep(pitch, 0.04, 'sine', 0.022, pitch * 1.08);
    } else if (kind === 'charge') {
      beep(540, 0.11, 'sine', 0.055, 760);
      setTimeout(() => beep(810, 0.14, 'triangle', 0.045, 980), 55);
    } else if (kind === 'burst') {
      beep(340, 0.22, 'triangle', 0.06, 780);
      setTimeout(() => beep(680, 0.18, 'sine', 0.04, 960), 60);
    } else if (kind === 'bank') {
      beep(587, 0.09, 'triangle', 0.045, 659);
      setTimeout(() => beep(880, 0.14, 'triangle', 0.05, 1046), 55);
    } else if (kind === 'win') {
      beep(523, 0.14, 'triangle', 0.06, 659);
      setTimeout(() => beep(659, 0.14, 'triangle', 0.06, 784), 90);
      setTimeout(() => beep(987, 0.32, 'triangle', 0.065, 1046), 180);
    } else if (kind === 'crash') {
      beep(175, 0.28, 'sawtooth', 0.048, 62);
      beep(110, 0.32, 'triangle', 0.055, 48);
    }
  }

  const button = (label, action, primary = false) =>
    `<button type="button" data-action="${action}" class="${primary ? 'primary' : ''}">${label}</button>`;

  function show(html) {
    resetJoystick();
    panel.innerHTML = html;
    overlay.hidden = false;
    sceneContainer.classList.add('has-overlay');
  }

  function hideOverlay() {
    overlay.hidden = true;
    sceneContainer.classList.remove('has-overlay');
  }

  function setPauseButtonState(isVisible, isPaused) {
    const pBtn = $('pause');
    pBtn.hidden = !isVisible;
    $('pauseIcon').textContent = isPaused ? '▶' : 'Ⅱ';
    $('pauseLabel').textContent = isPaused ? '계속하기' : '일시정지';
    pBtn.setAttribute('aria-label', isPaused ? '계속하기' : '일시정지');
  }

  function buildRoutePreviewSvg(level) {
    const w = 136, h = 44;
    const pts = level.turns.map((t, idx) => {
      const x = (idx / 9) * (w - 16) + 8;
      const y = h / 2 + (t / 120) * (h * 0.38);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="flex-shrink:0;background:rgba(5,14,25,.75);border-radius:8px;border:1px solid rgba(132,175,196,.25)">
      <line x1="8" y1="${h / 2}" x2="${w - 8}" y2="${h / 2}" stroke="rgba(148,186,201,.2)" stroke-dasharray="3 3"/>
      <polyline fill="none" stroke="#2ee6b8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>
      <circle cx="8" cy="${h / 2}" r="2.6" fill="#fffaf0"/>
      <circle cx="${w - 8}" cy="${h / 2}" r="2.8" fill="#ffd166"/>
    </svg>`;
  }

  function menu() {
    mode = 'menu';
    paused = false;
    setPauseButtonState(false, false);
    const curLevel = G.levels[selected - 1];
    const best = bestScores[selected] || 0;
    const hazardText = curLevel.hazards.length ? `이동 바위 ${curLevel.hazards.length}곳` : '바위 없음';
    show(`
      <span class="eyebrow">WIND CLIFF · 24 GORGES</span>
      <h2 id="overlayTitle">바람절벽 활공</h2>
      <p>좌우로 날개를 기울여 절벽 협곡을 통과하세요.<br>암벽 가까이 날아 <b>임시 점수</b>를 쌓고, <b>안전 거리로 멀어지면 확정</b>됩니다.</p>
      <div class="entity-legend" aria-label="화면 요소 안내">
        <span class="legend-chip"><i class="dot dot-player"></i>활공기(흰 원=충돌선)</span>
        <span class="legend-chip"><i class="dot dot-wind"></i>기류 원(✦ 1회 충전)</span>
        <span class="legend-chip"><i class="dot dot-graze"></i>스침 대역(+임시 점수)</span>
        <span class="legend-chip"><i class="dot dot-hazard"></i>이동 바위(충돌 위험)</span>
        <span class="legend-chip"><i class="dot dot-exit"></i>출구 관문(돌파)</span>
      </div>
      <div class="hero-summary">
        <div class="summary-box">
          <small>개방 진척</small>
          <strong>${unlocked} / 24 협곡</strong>
          <span>${unlocked === 24 ? '전 구간 개방 완료' : `${unlocked + 1}번 협곡 도전 가능`}</span>
        </div>
        <div class="summary-box">
          <small>현재 선택 협곡</small>
          <strong>${String(selected).padStart(2, '0')}번 · ${curLevel.windType}</strong>
          <span>기류 3곳 · ${hazardText}</span>
        </div>
        <div class="summary-box">
          <small>협곡 최고 점수</small>
          <strong>${best.toLocaleString('ko-KR')}점</strong>
          <span>스침 후 중앙 복귀로 경신</span>
        </div>
      </div>
      <div class="actions">
        ${button('비행 시작', 'start', true)}
        ${button('조작 배우기', 'tutorial')}
        ${button('협곡 선택', 'levels')}
      </div>
    `);
    sync();
  }

  function tutorial() {
    mode = 'tutorial';
    show(`
      <span class="eyebrow">비행 수첩 · FLIGHT RULES</span>
      <h2 id="overlayTitle">네 가지 비행 규칙</h2>
      <div class="tutorial-steps">
        <div>
          <strong class="step-title">01 · 조향과 충돌 윤곽</strong>
          ← → / A D 또는 화면·하단 버튼으로 조향합니다. 기체 주변의 <b>흰색 원</b>이 실제 충돌 경계이며, 암벽이나 붉은 바위에 닿으면 실패합니다.
        </div>
        <div>
          <strong class="step-title">02 · 기류 충전과 감속</strong>
          청록색 기류 원(<b>✦</b>)을 통과하면 1회 충전됩니다. <b>Space / 기류 해제</b>로 0.6초 동안 하강 속도를 늦춰 좁은 급커브를 안전하게 넘기세요.
        </div>
        <div>
          <strong class="step-title">03 · 벽 스침과 점수 확정</strong>
          암벽 안쪽 <b>주황색 스침 구간</b>을 날면 임시 점수가 쌓입니다. 단, <b>협곡 중앙으로 멀어져야 확정</b>되며 추락·출구 통과 시 임시 점수는 사라집니다.
        </div>
        <div>
          <strong class="step-title">04 · 급강하 부스트</strong>
          <b>B 또는 별도 급강하 부스트 버튼을 누르고 있으면</b> 하강 속도가 빨라집니다. 부스트 중 암벽 스침 임시 점수는 <b>2배</b>이며, 안전 거리로 벗어나야 확정됩니다. 기류 부양 중에는 부양이 우선합니다.
        </div>
      </div>
      <p class="muted">각 협곡을 돌파하면 멈추지 않고 다음 협곡으로 자동 진입합니다. 24번 완주 시 결과 화면이 표시됩니다.<br>60초 안에 아래쪽 황금 출구 도착 · 1–6 고요, 7–14 맥동풍, 15–24 횡풍과 이동 바위</p>
      <div class="actions">
        ${button('이해했어요 · 시작', 'start', true)}
        ${button('돌아가기', 'menu')}
      </div>
    `);
  }

  function levelMenu() {
    mode = 'levels';
    const cur = G.levels[selected - 1];
    const best = bestScores[selected] || 0;
    const chapterName = selected <= 6 ? '제1구간 · 고요한 새벽협곡' : selected <= 14 ? '제2구간 · 맥동하는 바람골' : '제3구간 · 폭풍과 이동 바위';
    show(`
      <span class="eyebrow">협곡 지도 · 24 GORGES</span>
      <h2 id="overlayTitle">비행 경로 선택</h2>
      <div class="chapter-legend">
        <span class="chapter-pill ch-1">01–06 고요 (기초 항로)</span>
        <span class="chapter-pill ch-2">07–14 맥동 (간헐 횡풍)</span>
        <span class="chapter-pill ch-3">15–24 횡풍 + 이동 바위</span>
      </div>
      <div class="level-preview">
        <div class="level-preview-info">
          <strong>${String(selected).padStart(2, '0')}번 협곡 · ${chapterName}</strong>
          <span>협곡 폭 ${cur.width}m · 바람: ${cur.windType} · 위험물: ${cur.hazards.length ? `이동 바위 ${cur.hazards.length}개` : '없음'} · 최고 ${best.toLocaleString('ko-KR')}점</span>
        </div>
        ${buildRoutePreviewSvg(cur)}
      </div>
      <div class="level-grid">
        ${G.levels.map(l => {
          const isCleared = l.id < unlocked || Boolean(bestScores[l.id]);
          const isLocked = l.id > unlocked;
          const tier = l.id <= 6 ? 1 : l.id <= 14 ? 2 : 3;
          const statusMark = isLocked ? '🔒' : isCleared ? '✓' : l.windType;
          return `<button type="button" data-level="${l.id}" data-tier="${tier}" class="${l.id === selected ? 'selected ' : ''}${isCleared ? 'cleared' : ''}" ${isLocked ? 'disabled' : ''} aria-label="${l.id}번 협곡 ${l.windType}${isLocked ? ' 잠김' : isCleared ? ' 완료' : ''}">
            <span>${String(l.id).padStart(2, '0')}</span>
            <small>${statusMark}</small>
          </button>`;
        }).join('')}
      </div>
      <div class="actions">
        ${button('선택한 협곡 시작', 'start', true)}
        ${button('돌아가기', 'menu')}
      </div>
    `);
  }

  function start() {
    state = G.create(selected);
    keys.clear();
    pointers.clear();
    boostPointers.clear();
    mouseDirection = 0;
    resetJoystick();
    releaseQueued = false;
    accumulator = 0;
    paused = false;
    trail = [];
    popups = [];
    bankFlashTicks = 0;
    lastBankDelta = 0;
    crashFlashTicks = 0;
    grazeTickCounter = 0;
    mode = 'playing';
    hideOverlay();
    setPauseButtonState(true, false);
    canvas.focus({ preventScroll: true });
    sync();
  }

  function pause() {
    if (mode !== 'playing') return;
    paused = !paused;
    if (paused) { boostPointers.clear(); keys.delete('KeyB'); pointers.clear(); mouseDirection = 0; resetJoystick(); }
    setPauseButtonState(true, paused);
    playSfx('ui');
    if (paused) {
      const progPct = Math.min(100, Math.round(((state.y - state.originY) / G.END_Y) * 100));
      show(`
        <span class="eyebrow">잠시 숨 고르기 · PAUSED</span>
        <h2 id="overlayTitle">일시정지</h2>
        <p>${String(selected).padStart(2, '0')}번 협곡 (${state.level.windType}) 진행률 <b>${progPct}%</b> · 바람은 기다려 줍니다.</p>
        <div class="result-stats">
          <div class="stat-item"><small>확정 점수</small><strong>${state.bank.toLocaleString('ko-KR')}</strong></div>
          <div class="stat-item"><small>스침 임시 점수</small><strong>+${state.pending.toLocaleString('ko-KR')}</strong></div>
          <div class="stat-item"><small>남은 시간</small><strong>${Math.max(0, 60 - state.ticks / 60).toFixed(1)}초</strong></div>
        </div>
        <div class="actions">
          ${button('계속 비행', 'resume', true)}
          ${button('처음부터', 'restart')}
          ${button('협곡 지도', 'levels')}
          ${button('타이틀로', 'menu')}
        </div>
      `);
    } else {
      hideOverlay();
      canvas.focus({ preventScroll: true });
    }
  }

  function recordGate(levelNumber) {
    if (levelNumber === unlocked && unlocked < 24) unlocked++;
    const prevBest = bestScores[levelNumber] || 0;
    bestScores[levelNumber] = Math.max(prevBest, state.bank);
    saveStore(unlocked, bestScores);
    playSfx('win');
    if (state.status === 'playing') {
      selected = state.level.id;
      popups.push({ x: state.x, y: state.y - 18, text: `${String(selected).padStart(2, '0')}번 협곡 진입!`, color: 'rgba(122, 247, 216, ALPHA)', life: 90, maxLife: 90 });
      $('sceneAnnouncement').textContent = `${selected}번 협곡 진입. 같은 비행 계속.`;
    }
  }

  function finish(isNewRecord = false) {
    if (state.status === 'won') {
      mode = 'result';
      setPauseButtonState(false, false);
      keys.clear();
      pointers.clear();
      boostPointers.clear();
      for (const id of ['left', 'right', 'burst', 'boost']) $(id)?.classList.remove('active');
      const nearText = state.bestNear < 900 ? `${Math.max(1, Math.round(state.bestNear))}m` : '중앙 안전 비행';
      show(`
        <span class="eyebrow">협곡 ${String(selected).padStart(2, '0')} 돌파 · CLEARED</span>
        <h2 id="overlayTitle">출구 도착!</h2>
        <p>24개 모든 협곡을 완주했습니다! ${isNewRecord ? '<b>(최고 기록 경신!)</b>' : ''}</p>
        <div class="result-stats">
          <div class="stat-item"><small>확정 점수</small><strong>${state.bank.toLocaleString('ko-KR')}</strong></div>
          <div class="stat-item"><small>비행 시간</small><strong>${(state.ticks / 60).toFixed(1)}초</strong></div>
          <div class="stat-item"><small>최접근 스침</small><strong>${nearText}</strong></div>
        </div>
        <p class="muted">원하는 협곡을 다시 선택해 최고 점수에 도전해 보세요.</p>
        <div class="actions">
          ${button('다시 비행', 'restart', true)}
          ${button('협곡 지도', 'levels')}
        </div>
      `);
    } else {
      mode = 'result';
      setPauseButtonState(false, false);
      keys.clear();
      pointers.clear();
      boostPointers.clear();
      for (const id of ['left', 'right', 'burst', 'boost']) $(id)?.classList.remove('active');
      crashFlashTicks = 24;
      playSfx('crash');
      const progPct = Math.min(99, Math.round(((state.y - state.originY) / G.END_Y) * 100));
      show(`
        <span class="eyebrow">협곡 ${String(selected).padStart(2, '0')} · 비행 종료</span>
        <h2 id="overlayTitle">다시 바람을 타요</h2>
        <p><b>${state.reason}</b> · 출구까지 <b>${progPct}%</b> 지점까지 도달했습니다.</p>
        <div class="result-stats">
          <div class="stat-item"><small>보존된 확정 점수</small><strong>${state.bank.toLocaleString('ko-KR')}</strong></div>
          <div class="stat-item"><small>미확정 임시 점수</small><strong>소멸됨</strong></div>
          <div class="stat-item"><small>경과 시간</small><strong>${(state.ticks / 60).toFixed(1)}초</strong></div>
        </div>
        <p class="muted">팁: 좁은 급커브나 이동 바위 앞에서는 저장한 기류(✦)를 해제해 하강 속도를 늦추세요.</p>
        <div class="actions">
          ${button('다시 시작', 'restart', true)}
          ${button('조작 배우기', 'tutorial')}
          ${button('협곡 지도', 'levels')}
        </div>
      `);
    }
    sync();
  }

  panel.addEventListener('click', e => {
    const level = e.target.closest('[data-level]');
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (level && !level.disabled) {
      selected = +level.dataset.level;
      state = G.create(selected);
      playSfx('ui');
      levelMenu();
      sync();
      return;
    }
    if (!action) return;
    playSfx('ui');
    if (action === 'start' || action === 'restart') start();
    else if (action === 'menu') menu();
    else if (action === 'levels') levelMenu();
    else if (action === 'tutorial') tutorial();
    else if (action === 'resume') pause();
  });

  $('pause').addEventListener('click', pause);
  $('motionToggle')?.addEventListener('click', () => {
    reducedMotion = !reducedMotion;
    updatePreferenceButtons();
    playSfx('ui');
  });
  $('soundToggle')?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    updatePreferenceButtons();
    if (soundEnabled) playSfx('ui');
  });

  window.addEventListener('keydown', e => {
    if (['ArrowLeft', 'ArrowRight', 'Space', 'KeyA', 'KeyD', 'KeyB', 'KeyP', 'Escape'].includes(e.code)) e.preventDefault();
    if (e.repeat && ['Space', 'KeyP', 'Escape'].includes(e.code)) return;
    keys.add(e.code);
    if (e.code === 'Space' && mode === 'playing' && !paused) releaseQueued = true;
    if ((e.code === 'KeyP' || e.code === 'Escape') && mode === 'playing') pause();
    if (e.code === 'Enter' && mode === 'menu') start();
  });

  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    pointers.clear();
    boostPointers.clear();
    mouseDirection = 0;
    resetJoystick();
    for (const id of ['left', 'right', 'burst', 'boost']) $(id)?.classList.remove('active');
    if (mode === 'playing' && !paused) pause();
  });

  const joystick = document.getElementById('joystick');
  const joystickTrack = joystick.querySelector('.joystick-track');
  const joystickKnob = document.getElementById('joystickKnob');
  function setJoystick(value) {
    joystickSteer = value;
    const radius = Math.max(1, (joystickTrack.clientWidth - joystickKnob.offsetWidth) / 2);
    joystickKnob.style.transform = `translateX(${value * radius}px)`;
    joystick.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    joystick.setAttribute('aria-valuetext', value === 0 ? '중앙' : `${value < 0 ? '왼쪽' : '오른쪽'} ${Math.round(Math.abs(value) * 100)}%`);
  }
  function resetJoystick() {
    joystickPointer = null;
    setJoystick(0);
  }
  function updateJoystick(e) {
    const box = joystickTrack.getBoundingClientRect();
    const radius = Math.max(1, (box.width - joystickKnob.offsetWidth) / 2);
    setJoystick(WindCliffJoystick.steer(e.clientX, e.clientY, box.left + box.width / 2, box.top + box.height / 2, radius));
  }
  joystick.addEventListener('pointerdown', (e) => {
    if (mode !== 'playing' || paused || joystickPointer !== null) return;
    e.preventDefault();
    joystickPointer = e.pointerId;
    try { joystick.setPointerCapture(e.pointerId); } catch {}
    updateJoystick(e);
  });
  joystick.addEventListener('pointermove', (e) => {
    if (e.pointerId === joystickPointer) { e.preventDefault(); updateJoystick(e); }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    joystick.addEventListener(type, (e) => { if (e.pointerId === joystickPointer) resetJoystick(); });
  }
  joystick.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    if (mode === 'playing' && !paused) setJoystick(Math.max(-1, Math.min(1, joystickSteer + (e.key === 'ArrowLeft' ? -0.25 : 0.25))));
  });
  joystick.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); resetJoystick(); }
  });

  for (const id of ['left', 'right', 'burst', 'boost']) {
    const el = $(id);
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch {}
      if (id === 'boost') {
        if (!el.disabled) boostPointers.add(e.pointerId);
      } else if (id === 'burst') {
        if (!el.disabled) {
          releaseQueued = true;
          el.classList.add('active');
        }
      } else {
        pointers.set(e.pointerId, id);
        el.classList.add('active');
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      el.addEventListener(type, e => {
        pointers.delete(e.pointerId);
        if (id === 'boost') boostPointers.delete(e.pointerId);
        el.classList.remove('active');
      });
    }
  }

  $('boost').addEventListener('keydown', e => {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    if (!$('boost').disabled) boostPointers.add('keyboard');
  });
  $('boost').addEventListener('keyup', e => {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    boostPointers.delete('keyboard');
  });
  $('boost').addEventListener('blur', () => boostPointers.delete('keyboard'));

  canvas.addEventListener('pointerdown', e => {
    if (mode !== 'playing' || paused) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    mouseDirection = e.offsetX < canvas.clientWidth / 2 ? -1 : 1;
  });
  canvas.addEventListener('pointermove', e => {
    if (e.buttons && mode === 'playing') mouseDirection = e.offsetX < canvas.clientWidth / 2 ? -1 : 1;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, () => { mouseDirection = 0; });
  }
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (mode === 'playing' && !paused) releaseQueued = true;
  });

  function currentClearance() {
    const c = G.canyonAt(state, state.y);
    return Math.min(state.x - c.left, c.right - state.x) - G.RADIUS;
  }

  function currentLateralWind() {
    const localY = state.y - state.originY;
    if (state.level.id >= 7 && localY > 500 && localY < G.END_Y - 100) {
      const pulse = state.level.id < 15 ? 0.10 : 0.19;
      return pulse * Math.sin((state.ticks + state.seed % 97) / 43 + localY / 182);
    }
    return 0;
  }

  function sync() {
    const progPct = Math.min(100, Math.max(0, ((state.y - state.originY) / G.END_Y) * 100));
    const remainSec = Math.max(0, 60 - state.ticks / 60);
    const clearance = currentClearance();
    const isGrazing = mode === 'playing' && clearance > 0 && clearance < 58;

    $('stage').textContent = `${String(selected).padStart(2, '0')} / 24`;
    const windBadge = $('windBadge');
    if (windBadge) {
      windBadge.textContent = state.level.windType;
      windBadge.dataset.wind = state.level.windType;
    }
    if ($('stageBar')) $('stageBar').style.width = `${progPct.toFixed(1)}%`;

    $('time').textContent = `${remainSec.toFixed(1)}초`;
    if ($('timeBar')) $('timeBar').style.width = `${((remainSec / 60) * 100).toFixed(1)}%`;
    const isLowTime = mode === 'playing' && remainSec <= 12;
    $('hudTimeCard')?.classList.toggle('is-low', isLowTime);
    if ($('timeState')) $('timeState').textContent = isLowTime ? '⚠ 서두르세요' : `${Math.round(progPct)}% 진행`;

    $('bank').textContent = state.bank.toLocaleString('ko-KR');
    $('hudBankCard')?.classList.toggle('is-banked', bankFlashTicks > 0);
    if ($('bankDelta')) {
      $('bankDelta').textContent = bankFlashTicks > 0 ? `★ +${lastBankDelta} 확정!` : '★ 안전 적립';
    }

    $('pending').textContent = `+${state.pending.toLocaleString('ko-KR')}`;
    $('hudPendingCard')?.classList.toggle('is-grazing', isGrazing || state.pending > 0);
    if ($('pendingHint')) {
      $('pendingHint').textContent = isGrazing
        ? '⚡ 스침 적립 중!'
        : state.pending > 0
          ? '→ 중앙으로 빠져 확정!'
          : '벽 접근 시 적립';
    }
    if ($('pendingBar')) {
      const pWidth = isGrazing
        ? Math.min(100, Math.max(20, ((58 - clearance) / 58) * 100))
        : state.pending > 0 ? 100 : 0;
      $('pendingBar').style.width = `${pWidth.toFixed(0)}%`;
    }

    const windCard = $('hudWindCard');
    const burstBtn = $('burst');
    windCard?.classList.toggle('is-ready', Boolean(state.charge && !state.lift));
    windCard?.classList.toggle('is-lifting', Boolean(state.lift > 0));
    burstBtn?.classList.toggle('is-ready', Boolean(state.charge && !state.lift));
    burstBtn?.classList.toggle('is-lifting', Boolean(state.lift > 0));

    if (state.lift > 0) {
      const liftSec = (Math.ceil((state.lift / 60) * 10) / 10).toFixed(1);
      $('charge').textContent = `▲ 상승 부양 ${liftSec}초`;
      if ($('chargeHint')) $('chargeHint').textContent = '하강 감속 중';
      if ($('chargeBar')) $('chargeBar').style.width = `${((state.lift / 36) * 100).toFixed(0)}%`;
      if ($('burstIcon')) $('burstIcon').textContent = '▲';
      if ($('burstLabel')) $('burstLabel').textContent = `부양 중 ${liftSec}초`;
      if ($('burstSub')) $('burstSub').textContent = '하강 속도 감소';
    } else if (state.charge) {
      $('charge').textContent = '✦ 준비 완료';
      if ($('chargeHint')) $('chargeHint').textContent = 'Space / 버튼 사용';
      if ($('chargeBar')) $('chargeBar').style.width = '100%';
      if ($('burstIcon')) $('burstIcon').textContent = '✦';
      if ($('burstLabel')) $('burstLabel').textContent = '기류 해제 가능!';
      if ($('burstSub')) $('burstSub').textContent = '0.6초 감속 · Space';
    } else {
      $('charge').textContent = '○ 비어 있음';
      if ($('chargeHint')) $('chargeHint').textContent = '기류 원 통과';
      if ($('chargeBar')) $('chargeBar').style.width = '0%';
      if ($('burstIcon')) $('burstIcon').textContent = '◇';
      if ($('burstLabel')) $('burstLabel').textContent = '기류 해제';
      if ($('burstSub')) $('burstSub').textContent = '기류 원 통과 필요';
    }

    burstBtn.disabled = mode !== 'playing' || paused || !state.charge;
    const boosting = mode === 'playing' && !paused && !state.lift && (keys.has('KeyB') || boostPointers.size > 0);
    const boostBtn = $('boost');
    boostBtn.disabled = mode !== 'playing' || paused;
    boostBtn.classList.toggle('active', boosting);
    boostBtn.setAttribute('aria-pressed', String(boosting));
    if ($('pendingHint') && boosting && isGrazing) $('pendingHint').textContent = '▼ 부스트 스침 ×2!';

    // Scene top label & lateral wind badge
    const sLabel = $('sceneLabel');
    const previousSceneState = sLabel.dataset.state;
    if (mode !== 'playing') {
      sLabel.textContent = '↓ 출구를 향해 활공';
      sLabel.dataset.state = 'normal';
    } else if (bankFlashTicks > 0) {
      sLabel.textContent = `★ +${lastBankDelta}점 안전 확정 완료!`;
      sLabel.dataset.state = 'bank';
    } else if (state.lift > 0) {
      sLabel.textContent = '▲ 저장 기류 해제 · 하강 속도 감소 중';
      sLabel.dataset.state = 'lift';
    } else if (clearance < 22) {
      sLabel.textContent = '⚠ 암벽 충돌 위험! 중앙으로 조향하세요';
      sLabel.dataset.state = 'danger';
    } else if (boosting) {
      sLabel.textContent = '▼ 급강하 중 · 암벽 스침 점수 2배';
      sLabel.dataset.state = 'boost';
    } else if (state.pending > 0) {
      sLabel.textContent = isGrazing
        ? `⚡ 암벽 스침 +${state.pending} · 벽에서 멀어지면 확정!`
        : `⚡ 미확정 +${state.pending} · 조금만 더 중앙으로 이동하세요!`;
      sLabel.dataset.state = 'graze';
    } else {
      const remM = Math.max(0, Math.round((state.originY + G.END_Y - state.y) / 10));
      sLabel.textContent = remM <= 45 ? `🏁 출구 관문 ${remM}m 앞!` : '↓ 출구를 향해 활공';
      sLabel.dataset.state = 'normal';
    }
    // Announce status transitions, not every frame's changing score or distance.
    const announcement = $('sceneAnnouncement');
    if (announcement && sLabel.dataset.state !== previousSceneState) {
      announcement.textContent = mode === 'playing' ? sLabel.textContent : '';
    }

    const wInd = $('windIndicator');
    if (wInd) {
      const lat = currentLateralWind();
      if (mode === 'playing' && Math.abs(lat) > 0.025) {
        wInd.hidden = false;
        const dir = lat > 0 ? '바람 ▶▶' : '◀◀ 바람';
        wInd.textContent = `${state.level.windType} ${dir}`;
      } else {
        wInd.hidden = true;
      }
    }
  }

  function render() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    const scale = rect.width > 650 ? Math.min(rect.width / 900, rect.height / 620) : Math.min(1, rect.width / 370);
    const W = rect.width / scale, H = rect.height / scale;
    const cameraX = state.x - W / 2;
    const cameraY = state.y - Math.min(185, H * 0.31);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    // 1. Chapter-themed Sky Gradient
    const chapter = state.level.id <= 6 ? 0 : state.level.id <= 14 ? 1 : 2;
    const skyColors = [
      ['#0b1e36', '#1e4964', '#5c8a91'],
      ['#111f38', '#294863', '#7d837d'],
      ['#0e1529', '#253552', '#5f697d']
    ][chapter];
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, skyColors[0]);
    sky.addColorStop(0.58, skyColors[1]);
    sky.addColorStop(1, skyColors[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 2. Parallax Distant Mountain Ridges
    const ridgeColors = [
      ['rgba(52, 98, 112, 0.55)', 'rgba(34, 72, 88, 0.72)', 'rgba(20, 47, 65, 0.88)'],
      ['rgba(74, 96, 108, 0.55)', 'rgba(46, 69, 86, 0.72)', 'rgba(25, 45, 64, 0.88)'],
      ['rgba(64, 76, 98, 0.55)', 'rgba(40, 54, 76, 0.72)', 'rgba(21, 33, 52, 0.88)']
    ][chapter];
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      ctx.moveTo(0, H);
      const vShift = ((cameraY * (0.025 + layer * 0.015)) % 90);
      for (let x = -12; x <= W + 12; x += 14) {
        const h = H * (0.56 + layer * 0.12) - vShift * 0.25
          + 24 * Math.sin((x + cameraX * (0.11 + layer * 0.08)) / 78 + layer * 1.7)
          + 12 * Math.sin((x + cameraX * 0.07) / 27 + layer * 3.1);
        ctx.lineTo(x, h);
      }
      ctx.lineTo(W, H);
      ctx.fillStyle = ridgeColors[layer];
      ctx.fill();
    }

    // 3. Atmospheric Wind Streamlines & Lateral Wind Currents
    const latWind = currentLateralWind();
    const streamCount = reducedMotion ? 10 : 22;
    for (let i = 0; i < streamCount; i++) {
      const sx = ((i * 179 + 42 - cameraX * 0.22 + (reducedMotion ? 0 : state.ticks * latWind * 8)) % (W + 100) + W + 100) % (W + 100) - 50;
      const sy = ((i * 131 - cameraY * 0.45) % (H + 100) + H + 100) % (H + 100) - 50;
      ctx.strokeStyle = Math.abs(latWind) > 0.03 ? 'rgba(255, 224, 150, 0.22)' : 'rgba(210, 240, 235, 0.18)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - latWind * 65, sy + (state.lift ? 8 : 16));
      ctx.stroke();
    }

    const top = Math.floor(cameraY / 12) * 12 - 24;
    const bottom = cameraY + H + 24;

    // 4. Canyon Safe Centerline & Near-Wall Scoring Zone Bands (drawn inside the gorge)
    // Centerline guide
    ctx.save();
    ctx.setLineDash([6, 14]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(180, 225, 235, 0.18)';
    ctx.beginPath();
    for (let y = top; y <= bottom; y += 16) {
      const c = G.canyonAt(state, y);
      const cx = c.center - cameraX, cy = y - cameraY;
      if (y === top) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.restore();

    // Near-wall graze scoring band (between RADIUS and RADIUS + 58 from each cliff)
    const clearance = currentClearance();
    const grazeAlpha = (clearance > 0 && clearance < 58) ? 0.22 : 0.09;
    for (const side of ['left', 'right']) {
      ctx.beginPath();
      for (let y = top; y <= bottom; y += 16) {
        const c = G.canyonAt(state, y);
        const outerX = (side === 'left' ? c.left + G.RADIUS : c.right - G.RADIUS) - cameraX;
        if (y === top) ctx.moveTo(outerX, y - cameraY);
        else ctx.lineTo(outerX, y - cameraY);
      }
      for (let y = bottom; y >= top; y -= 16) {
        const c = G.canyonAt(state, y);
        const innerX = (side === 'left' ? c.left + G.RADIUS + 58 : c.right - G.RADIUS - 58) - cameraX;
        ctx.lineTo(innerX, y - cameraY);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(255, 168, 68, ${grazeAlpha})`;
      ctx.fill();
    }

    // If player has unbanked pending score, highlight the safe banking boundary (clearance = 72)
    if (state.pending > 0) {
      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = 'rgba(255, 215, 102, 0.55)';
      for (const side of ['left', 'right']) {
        ctx.beginPath();
        for (let y = top; y <= bottom; y += 16) {
          const c = G.canyonAt(state, y);
          const bx = (side === 'left' ? c.left + G.RADIUS + 72 : c.right - G.RADIUS - 72) - cameraX;
          if (y === top) ctx.moveTo(bx, y - cameraY);
          else ctx.lineTo(bx, y - cameraY);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Canyon Cliff Walls with Stratified Rock Layers & Inner Ledge
    for (const side of ['left', 'right']) {
      ctx.save();
      ctx.beginPath();
      if (side === 'left') {
        ctx.moveTo(-40, -30);
        ctx.lineTo(G.canyonAt(state, top).left - cameraX, top - cameraY);
      } else {
        ctx.moveTo(W + 40, -30);
        ctx.lineTo(G.canyonAt(state, top).right - cameraX, top - cameraY);
      }
      for (let y = top + 12; y <= bottom; y += 12) {
        ctx.lineTo(G.canyonAt(state, y)[side] - cameraX, y - cameraY);
      }
      ctx.lineTo(side === 'left' ? -40 : W + 40, H + 30);
      ctx.closePath();

      const rock = ctx.createLinearGradient(0, 0, W, 0);
      if (side === 'left') {
        rock.addColorStop(0, '#071422');
        rock.addColorStop(0.45, '#132a3e');
        rock.addColorStop(1, '#2a4756');
      } else {
        rock.addColorStop(0, '#2a4756');
        rock.addColorStop(0.55, '#132a3e');
        rock.addColorStop(1, '#071422');
      }
      ctx.fillStyle = rock;
      ctx.fill();

      // Clip inside cliff polygon to draw scrolling rock strata and inner cliff facet
      ctx.clip();
      const firstStrataY = Math.floor(top / 80) * 80;
      ctx.strokeStyle = 'rgba(165, 205, 220, 0.11)';
      ctx.lineWidth = 2;
      for (let sy = firstStrataY; sy <= bottom + 80; sy += 80) {
        const edgeX = G.canyonAt(state, sy)[side] - cameraX;
        const screenY = sy - cameraY;
        ctx.beginPath();
        ctx.moveTo(edgeX, screenY);
        ctx.lineTo(side === 'left' ? -40 : W + 40, screenY + (side === 'left' ? -28 : 28));
        ctx.stroke();
      }

      // Inner dark cliff bevel step
      ctx.beginPath();
      for (let y = top; y <= bottom; y += 16) {
        const c = G.canyonAt(state, y);
        const inset = (side === 'left' ? c.left - 22 : c.right + 22) - cameraX;
        if (y === top) ctx.moveTo(inset, y - cameraY);
        else ctx.lineTo(inset, y - cameraY);
      }
      ctx.strokeStyle = 'rgba(6, 16, 28, 0.65)';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.restore();

      // High-contrast outer physical wall edge stroke
      ctx.beginPath();
      for (let y = top; y <= bottom; y += 12) {
        const wx = G.canyonAt(state, y)[side] - cameraX;
        if (y === top) ctx.moveTo(wx, y - cameraY);
        else ctx.lineTo(wx, y - cameraY);
      }
      ctx.strokeStyle = '#e5be83';
      ctx.lineWidth = 3.2;
      ctx.stroke();
    }

    // 6. Exact Collision Boundary Contour (Wall + Player Radius)
    ctx.save();
    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255, 220, 150, 0.52)';
    for (const side of ['left', 'right']) {
      ctx.beginPath();
      for (let y = top; y <= bottom; y += 12) {
        const c = G.canyonAt(state, y);
        const x = (side === 'left' ? c.left + G.RADIUS : c.right - G.RADIUS) - cameraX;
        if (y === top) ctx.moveTo(x, y - cameraY);
        else ctx.lineTo(x, y - cameraY);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 7. Updraft Wind Circles (Cyan-Mint Emerald, clearly distinct from rocks & exit)
    for (const w of state.level.winds) {
      const y = state.originY + w.y - cameraY;
      if (y < -80 || y > H + 80) continue;
      const x = G.canyon(state.level, w.y).center + w.offset - cameraX;

      if (w.used) {
        ctx.save();
        ctx.setLineDash([5, 6]);
        ctx.strokeStyle = 'rgba(122, 247, 216, 0.28)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(x, y, 36, 18, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(122, 247, 216, 0.42)';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✦ 기류 통과', x, y + 4);
        ctx.restore();
        continue;
      }

      const pulse = reducedMotion ? 1 : (Math.sin(state.ticks / 15 + w.y) * 0.12 + 1);
      ctx.save();
      // Soft emerald radial glow
      const glow = ctx.createRadialGradient(x, y, 4, x, y, 52);
      glow.addColorStop(0, 'rgba(46, 230, 184, 0.34)');
      glow.addColorStop(1, 'rgba(46, 230, 184, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 52, 0, Math.PI * 2);
      ctx.fill();

      // Pickup boundary ellipse (55px x 26px) + inner vortex rings
      ctx.strokeStyle = 'rgba(46, 230, 184, 0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(x, y, 52, 25, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#7af7d8';
      ctx.lineWidth = 2.2;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.ellipse(x, y, (20 + i * 15) * pulse, (10 + i * 7) * pulse, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = '#eafff8';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✦', x, y + 7);
      ctx.fillStyle = '#7af7d8';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(state.charge ? '기류 (충전됨)' : '▲ 기류 충전', x, y + 38);
      ctx.restore();
    }

    // 8. Moving Rock Hazards (Crimson-Coral Faceted Boulders + Oscillation Track + Offscreen Warning)
    for (const h of state.level.hazards) {
      const y = state.originY + h.y - cameraY;
      const centerAtY = G.canyon(state.level, h.y).center - cameraX;
      const trackCenter = centerAtY + h.side * 94;
      const x = G.obstacleX(state.level, h, state.ticks) - cameraX;

      // Off-screen upcoming hazard warning at bottom of screen
      if (y > H + 20 && y < H + 240) {
        ctx.save();
        const warnY = H - 18;
        ctx.fillStyle = 'rgba(80, 16, 24, 0.9)';
        ctx.strokeStyle = '#ff5e5b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x - 38, warnY - 12, 76, 20, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffb3b0';
        ctx.font = 'bold 10.5px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ 바위 접근 ↓', x, warnY + 2);
        ctx.restore();
      }

      if (y < -65 || y > H + 65) continue;

      ctx.save();
      // Horizontal movement track bar (±7px around trackCenter, plus 19px radius extent)
      ctx.strokeStyle = 'rgba(255, 94, 91, 0.38)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(trackCenter - 26, y);
      ctx.lineTo(trackCenter + 26, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Outer collision danger ring (19px radius)
      ctx.strokeStyle = 'rgba(255, 94, 91, 0.75)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating faceted crimson boulder
      ctx.translate(x, y);
      const rot = reducedMotion ? h.phase : (state.ticks / 65 + h.phase);
      ctx.rotate(rot);
      ctx.fillStyle = '#4a1822';
      ctx.strokeStyle = '#ff6b66';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      const radii = [19, 15, 19, 16, 19, 14, 18, 15];
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI * 2) / 8;
        const r = radii[k];
        if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Inner magma core & warning mark
      ctx.rotate(-rot);
      ctx.fillStyle = '#ff9e99';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, 4);
      ctx.restore();
    }

    // 9. Exit Gate Beacon (END_Y = 2700)
    const exitY = state.originY + G.END_Y - cameraY;
    if (exitY > -60 && exitY < H + 80) {
      const c = G.canyonAt(state, state.originY + G.END_Y);
      const leftX = c.left - cameraX, rightX = c.right - cameraX, centerX = c.center - cameraX;
      ctx.save();
      const gateGlow = ctx.createLinearGradient(0, exitY - 45, 0, exitY + 15);
      gateGlow.addColorStop(0, 'rgba(255, 209, 102, 0)');
      gateGlow.addColorStop(1, 'rgba(255, 209, 102, 0.34)');
      ctx.fillStyle = gateGlow;
      ctx.fillRect(leftX, exitY - 45, rightX - leftX, 55);

      ctx.fillStyle = '#ffd166';
      ctx.fillRect(leftX, exitY - 3, rightX - leftX, 6);
      ctx.strokeStyle = '#fff5cc';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(leftX, exitY - 3, rightX - leftX, 6);

      // Gate pillars on both cliff edges
      ctx.fillStyle = '#ffea9f';
      ctx.fillRect(leftX - 4, exitY - 18, 10, 26);
      ctx.fillRect(rightX - 6, exitY - 18, 10, 26);

      ctx.fillStyle = '#fff8dc';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🏁 ↓ 출구 관문 · 통과 시 돌파 ↓', centerX, exitY - 14);
      ctx.restore();
    }

    // 10. Player Glider, Wingtip Trails, Near-Wall Tether & Banking Popups
    const px = state.x - cameraX, py = state.y - cameraY;
    const cNow = G.canyonAt(state, state.y);
    const leftDist = state.x - cNow.left - G.RADIUS;
    const rightDist = cNow.right - state.x - G.RADIUS;
    const minClearance = Math.min(leftDist, rightDist);

    // Wingtip contrails (drawn behind/above player so upcoming path below is never blocked)
    if (trail.length > 1) {
      for (const wingSide of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i < trail.length; i++) {
          const pt = trail[i];
          const tx = pt.x - cameraX + wingSide * 19;
          const ty = pt.y - cameraY - 6;
          if (i === 0) ctx.moveTo(tx, ty);
          else ctx.lineTo(tx, ty);
        }
        ctx.strokeStyle = state.lift > 0
          ? 'rgba(46, 230, 184, 0.45)'
          : minClearance < 58
            ? 'rgba(255, 168, 68, 0.48)'
            : 'rgba(235, 247, 252, 0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Near-wall graze tether arc + live pending counter on canvas
    if (mode === 'playing' && minClearance > 0 && minClearance < 58) {
      const nearWallX = (leftDist < rightDist ? cNow.left : cNow.right) - cameraX;
      ctx.save();
      ctx.strokeStyle = '#ff9f43';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(nearWallX, py);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#ffbd69';
      ctx.beginPath();
      ctx.arc(nearWallX, py, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffd8a8';
      ctx.font = 'bold 11.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`⚡ 스침 +${state.pending}`, px, py - 24);
      ctx.restore();
    }

    // Player glider body & collision outline
    ctx.save();
    ctx.translate(px, py);
    const bankAngle = Math.max(-0.35, Math.min(0.35, state.vx * 0.065));
    ctx.rotate(bankAngle);

    // Active wind lift radial progress ring or charged aura
    if (state.lift > 0 || state.spark > 0) {
      const liftRatio = state.lift > 0 ? state.lift / 36 : state.spark / 24;
      ctx.strokeStyle = 'rgba(46, 230, 184, 0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 23, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#2ee6b8';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, 23, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * liftRatio);
      ctx.stroke();
    } else if (state.charge) {
      ctx.strokeStyle = 'rgba(122, 247, 216, 0.65)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Exact collision radius circle (G.RADIUS = 13)
    ctx.strokeStyle = minClearance < 22 ? '#ff6b66' : 'rgba(255, 255, 255, 0.78)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, G.RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Glider wing silhouette (Ivory White & Sunset Coral Wingtips pointing downward)
    ctx.fillStyle = '#fffaf0';
    ctx.strokeStyle = '#10283d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(-27, -7);
    ctx.lineTo(-9, -3);
    ctx.lineTo(0, -17);
    ctx.lineTo(9, -3);
    ctx.lineTo(27, -7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Coral-gold wingtip accents
    ctx.fillStyle = '#ff7b54';
    ctx.beginPath();
    ctx.moveTo(-27, -7);
    ctx.lineTo(-16, 2);
    ctx.lineTo(-14, -4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(27, -7);
    ctx.lineTo(16, 2);
    ctx.lineTo(14, -4);
    ctx.closePath();
    ctx.fill();

    // Cockpit spine
    ctx.fillStyle = '#14354d';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(-5, 3);
    ctx.lineTo(0, 12);
    ctx.lineTo(5, 3);
    ctx.closePath();
    ctx.fill();

    // Charged jewel indicator above canopy
    if (state.charge) {
      ctx.fillStyle = '#2ee6b8';
      ctx.beginPath();
      ctx.arc(0, -2, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Crash impact ring if failed
    if (state.status === 'failed') {
      ctx.save();
      ctx.strokeStyle = '#ff5e5b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, G.RADIUS + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Floating score popups (when banking near-wall points or picking up wind)
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.fillStyle = p.color.replace('ALPHA', alpha.toFixed(2));
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x - cameraX, p.y - cameraY);
      ctx.restore();
    }

    // 11. Right-Side Vertical Altitude & Canyon Minimap Gauge
    const prog = Math.min(1, Math.max(0, (state.y - state.originY) / G.END_Y));
    const gx = W - 18, gy = 20, gh = H - 40;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 22, 36, 0.78)';
    ctx.strokeStyle = 'rgba(138, 184, 202, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(gx - 5, gy - 4, 14, gh + 8, 7);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fillRect(gx, gy, 4, gh);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(gx, gy, 4, gh * prog);

    // Wind markers on gauge
    for (const w of state.level.winds) {
      const wy = gy + (w.y / G.END_Y) * gh;
      ctx.fillStyle = w.used ? 'rgba(122, 247, 216, 0.3)' : '#2ee6b8';
      ctx.beginPath();
      ctx.arc(gx + 2, wy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Hazard markers on gauge
    for (const h of state.level.hazards) {
      const hy = gy + (h.y / G.END_Y) * gh;
      ctx.fillStyle = '#ff5e5b';
      ctx.fillRect(gx - 1, hy - 2, 6, 4);
    }
    // Player current altitude marker
    const pyGauge = gy + prog * gh;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.arc(gx + 2, pyGauge, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function stepVisuals(oldCharge, oldLift, oldBank, steerInput) {
    if (bankFlashTicks > 0) bankFlashTicks--;
    if (crashFlashTicks > 0) crashFlashTicks--;

    const sign = Math.sign(steerInput);
    if (sign !== 0 && sign !== lastSteerSign) {
      playSfx('steer');
    }
    lastSteerSign = sign;

    if (!oldCharge && state.charge) {
      playSfx('charge');
      popups.push({ x: state.x, y: state.y - 18, text: '✦ 기류 충전!', color: 'rgba(122, 247, 216, ALPHA)', life: 36, maxLife: 36 });
    }
    if (oldLift === 0 && state.lift > 0) {
      playSfx('burst');
      popups.push({ x: state.x, y: state.y - 18, text: '▲ 감속 부양!', color: 'rgba(158, 252, 224, ALPHA)', life: 36, maxLife: 36 });
    }
    if (state.bank > oldBank) {
      const delta = state.bank - oldBank;
      lastBankDelta = delta;
      bankFlashTicks = 45;
      playSfx('bank');
      popups.push({ x: state.x, y: state.y - 20, text: `★ +${delta} 확정!`, color: 'rgba(255, 215, 102, ALPHA)', life: 45, maxLife: 45 });
    }

    const clearance = currentClearance();
    if (clearance > 0 && clearance < 58 && state.pending > 0) {
      grazeTickCounter++;
      if (grazeTickCounter % 11 === 1) playSfx('graze');
    } else {
      grazeTickCounter = 0;
    }

    if (state.ticks % 2 === 0) {
      trail.push({ x: state.x, y: state.y, vx: state.vx });
      const maxTrail = reducedMotion ? 6 : 14;
      if (trail.length > maxTrail) trail.shift();
    }

    for (let i = popups.length - 1; i >= 0; i--) {
      popups[i].y -= 0.6;
      popups[i].life--;
      if (popups[i].life <= 0) popups.splice(i, 1);
    }
  }

  function frame(ts) {
    if (!last) last = ts;
    const delta = Math.min(0.1, (ts - last) / 1000);
    last = ts;

    if (mode === 'playing' && !paused) {
      accumulator += delta;
      let steps = 0;
      while (accumulator >= G.STEP && steps++ < 8) {
        const steer = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0)
          - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0)
          + [...pointers.values()].reduce((v, id) => v + (id === 'left' ? -1 : 1), 0)
          + mouseDirection + joystickSteer;
        const clampedSteer = Math.max(-1, Math.min(1, steer));
        const oldCharge = state.charge, oldLift = state.lift, oldBank = state.bank;
        G.step(state, { steer: clampedSteer, release: releaseQueued, boost: keys.has('KeyB') || boostPointers.size > 0 });
        releaseQueued = false;
        stepVisuals(oldCharge, oldLift, oldBank, clampedSteer);
        const isNewRecord = state.completedLevel && state.bank > (bestScores[state.completedLevel] || 0);
        if (state.completedLevel) recordGate(state.completedLevel);
        accumulator -= G.STEP;
        if (state.status !== 'playing') {
          finish(isNewRecord);
          break;
        }
      }
      if (steps >= 8) accumulator = 0;
      sync();
    }
    render();
    setTimeout(() => frame(performance.now()), 16);
  }

  updatePreferenceButtons();
  menu();
  sync();
  setTimeout(() => frame(performance.now()), 16);
  globalThis.WindCliffUI = {
    get state() { return state; },
    get mode() { return mode; },
    get unlocked() { return unlocked; }
  };
})();
