(() => {
  'use strict';
  const G = globalThis.WindCliffCore, $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d'), overlay = $('overlay'), panel = $('panel');
  const storeKey = 'wind-cliff-glide-v1';
  function readProgress() { try { return Math.max(1, Math.min(24, +JSON.parse(localStorage.getItem(storeKey)).unlocked || 1)); } catch { return 1; } }
  let unlocked = readProgress(), selected = unlocked, state = G.create(selected), mode = 'menu', paused = false;
  let keys = new Set(), pointers = new Map(), mouseDirection = 0, releaseQueued = false, last = 0, accumulator = 0, sound;
  function beep(freq = 520, length = .12, type = 'sine', volume = .06) {
    try {
      sound ||= new (window.AudioContext || window.webkitAudioContext)();
      if (sound.state === 'suspended') sound.resume();
      const osc = sound.createOscillator(), gain = sound.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, sound.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(100, freq * .72), sound.currentTime + length);
      gain.gain.setValueAtTime(volume, sound.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, sound.currentTime + length);
      osc.connect(gain).connect(sound.destination); osc.start(); osc.stop(sound.currentTime + length);
    } catch { /* audio is optional */ }
  }
  const button = (label, action, primary = false) => `<button data-action="${action}" class="${primary ? 'primary' : ''}">${label}</button>`;
  function show(html) { panel.innerHTML = html; overlay.hidden = false; }
  function menu() {
    mode = 'menu'; $('pause').hidden = true;
    show(`<span class="eyebrow">WIND CLIFF · 24 GORGES</span><h2 id="overlayTitle">바람절벽 활공</h2><p>좌우로 기울여 암벽 사이를 통과하세요.<br>벽을 스치고 <b>안전하게 멀어지면</b> 점수가 확정됩니다.</p><p class="muted">진행: ${unlocked} / 24 협곡 개방 · 현재 ${selected}번 협곡</p><div class="actions">${button('비행 시작', 'start', true)}${button('조작 배우기', 'tutorial')}${button('협곡 선택', 'levels')}</div>`);
  }
  function tutorial() {
    mode = 'tutorial';
    show(`<span class="eyebrow">비행 수첩</span><h2 id="overlayTitle">세 가지 비행 규칙</h2><div class="tutorial-steps"><div><b>01 · 조향</b>← → / A D 또는 화면 양쪽을 누르고 이동. 벽 윤곽에 닿으면 추락!</div><div><b>02 · 바람</b>빛나는 기류를 지나면 1회 저장. Space / ✦로 해제하면 0.6초 동안 하강이 느려져요.</div><div><b>03 · 스침</b>가까이 날면 점수가 쌓이지만 임시 점수예요. 벽에서 멀어져야 확정! 추락하면 임시 점수는 사라져요.</div></div><p class="muted">60초 안에 아래쪽 출구 도착 · P / Ⅱ로 일시정지 · 7번부터 간헐 바람, 15번부터 움직이는 바위</p><div class="actions">${button('이해했어요 · 시작', 'start', true)}${button('돌아가기', 'menu')}</div>`);
  }
  function levelMenu() {
    mode = 'levels';
    show(`<span class="eyebrow">협곡 지도</span><h2 id="overlayTitle">비행 경로 선택</h2><p class="muted">1–6 고요 · 7–14 맥동 · 15–24 횡풍과 움직이는 바위</p><div class="level-grid">${G.levels.map(l => `<button data-level="${l.id}" class="${l.id === selected ? 'selected ' : ''}${l.id < unlocked ? 'cleared' : ''}" ${l.id > unlocked ? 'disabled' : ''} aria-label="${l.id}번 협곡${l.id > unlocked ? ' 잠김' : ''}">${String(l.id).padStart(2, '0')}</button>`).join('')}</div><div class="actions">${button('선택한 협곡 시작', 'start', true)}${button('돌아가기', 'menu')}</div>`);
  }
  function start() { state = G.create(selected); keys.clear(); pointers.clear(); mouseDirection = 0; releaseQueued = false; accumulator = 0; paused = false; mode = 'playing'; overlay.hidden = true; $('pause').hidden = false; $('pause').textContent = 'Ⅱ 일시정지'; canvas.focus({ preventScroll: true }); sync(); }
  function pause() { if (mode !== 'playing') return; paused = !paused; $('pause').textContent = paused ? '▶ 계속하기' : 'Ⅱ 일시정지'; if (paused) show(`<span class="eyebrow">잠시 숨 고르기</span><h2 id="overlayTitle">일시정지</h2><p>바람은 기다려 줍니다.</p><div class="actions">${button('계속 비행', 'resume', true)}${button('처음부터', 'restart')}${button('지도', 'levels')}</div>`); else overlay.hidden = true; }
  function finish() {
    mode = 'result'; $('pause').hidden = true; keys.clear(); pointers.clear();
    if (state.status === 'won') {
      if (selected === unlocked && unlocked < 24) { unlocked++; try { localStorage.setItem(storeKey, JSON.stringify({ unlocked })); } catch {} }
      beep(740, .4, 'triangle');
      show(`<span class="eyebrow">협곡 ${String(selected).padStart(2,'0')} 돌파</span><h2 id="overlayTitle">출구 도착!</h2><p>확정 점수 <b>${state.bank.toLocaleString('ko-KR')}</b> · 비행 시간 ${(state.ticks / 60).toFixed(1)}초</p><p class="muted">${selected === 24 ? '24개 협곡을 모두 건넜어요!' : '다음 길이 열렸어요.'}</p><div class="actions">${selected < 24 ? button('다음 협곡', 'next', true) : button('다시 비행', 'restart', true)}${button('다시 도전', 'restart')}${button('협곡 지도', 'levels')}</div>`);
    } else { beep(150, .3, 'sawtooth', .035); show(`<span class="eyebrow">협곡 ${String(selected).padStart(2,'0')} · 비행 종료</span><h2 id="overlayTitle">다시 바람을 타요</h2><p>${state.reason}</p><p>확정 점수 <b>${state.bank.toLocaleString('ko-KR')}</b> · 미확정 점수는 사라졌어요</p><div class="actions">${button('다시 시작', 'restart', true)}${button('조작 배우기', 'tutorial')}${button('협곡 지도', 'levels')}</div>`); }
  }
  panel.addEventListener('click', e => { const level = e.target.closest('[data-level]'), action = e.target.closest('[data-action]')?.dataset.action;
    if (level) { selected = +level.dataset.level; levelMenu(); }
    if (action === 'start' || action === 'restart') start();
    else if (action === 'next') { selected = Math.min(24, selected + 1); start(); }
    else if (action === 'menu') menu(); else if (action === 'levels') levelMenu(); else if (action === 'tutorial') tutorial(); else if (action === 'resume') pause();
  });
  $('pause').addEventListener('click', pause);
  window.addEventListener('keydown', e => {
    if (['ArrowLeft','ArrowRight','Space','KeyA','KeyD','KeyP','Escape'].includes(e.code)) e.preventDefault();
    if (e.repeat && ['Space','KeyP','Escape'].includes(e.code)) return;
    keys.add(e.code);
    if (e.code === 'Space' && mode === 'playing' && !paused) releaseQueued = true;
    if ((e.code === 'KeyP' || e.code === 'Escape') && mode === 'playing') pause();
    if (e.code === 'Enter' && mode === 'menu') start();
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); pointers.clear(); mouseDirection = 0; if (mode === 'playing' && !paused) pause(); });
  for (const id of ['left','right','burst']) { const el = $(id);
    el.addEventListener('pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} if (id === 'burst') releaseQueued = true; else { pointers.set(e.pointerId, id); el.classList.add('active'); } });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) el.addEventListener(type, e => { pointers.delete(e.pointerId); el.classList.remove('active'); });
  }
  canvas.addEventListener('pointerdown', e => { if (mode !== 'playing' || paused) return; e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch {} mouseDirection = e.offsetX < canvas.clientWidth / 2 ? -1 : 1; });
  canvas.addEventListener('pointermove', e => { if (e.buttons && mode === 'playing') mouseDirection = e.offsetX < canvas.clientWidth / 2 ? -1 : 1; });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type, () => mouseDirection = 0);
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); releaseQueued = true; });
  function sync() { $('stage').textContent = `${String(selected).padStart(2,'0')} / 24`; $('time').textContent = `${Math.max(0,60 - state.ticks / 60).toFixed(1)}초`; $('bank').textContent = state.bank.toLocaleString('ko-KR'); $('pending').textContent = `+${state.pending.toLocaleString('ko-KR')}`; $('charge').textContent = state.lift ? `상승 ${Math.ceil(state.lift / 60 * 10) / 10}초` : state.charge ? '✦ 준비 완료' : '비어 있음'; $('burst').disabled = mode !== 'playing' || paused || !state.charge; $('sceneLabel').textContent = mode === 'playing' ? (state.pending ? '스침 중 · 벽에서 멀어져 점수 확정!' : '↓ 출구를 향해 활공') : '↓ 출구를 향해 활공'; }
  function render() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    if (canvas.width !== Math.round(rect.width*dpr) || canvas.height !== Math.round(rect.height*dpr)) { canvas.width = Math.round(rect.width*dpr); canvas.height = Math.round(rect.height*dpr); }
    const scale = rect.width > 650 ? Math.min(rect.width / 900, rect.height / 620) : Math.min(1, rect.width / 370);
    const W = rect.width / scale, H = rect.height / scale, cameraX = state.x - W / 2, cameraY = state.y - Math.min(190, H * .33);
    ctx.setTransform(dpr*scale,0,0,dpr*scale,0,0);
    const sky = ctx.createLinearGradient(0,0,0,H); sky.addColorStop(0,'#152d4d'); sky.addColorStop(.6,'#356379'); sky.addColorStop(1,'#9cae9e'); ctx.fillStyle = sky; ctx.fillRect(0,0,W,H);
    // Original generative parallax ridges; no external image assets.
    for (let layer = 0; layer < 3; layer++) { ctx.beginPath(); ctx.moveTo(0,H); for (let x = -10; x <= W+10; x+=12) { const h = H*(.62+layer*.11) + 25*Math.sin((x+cameraX*(.12+layer*.09))/75+layer) + 13*Math.sin((x+cameraX*.08)/25+layer*3); ctx.lineTo(x,h); } ctx.lineTo(W,H); ctx.fillStyle = ['#3a6872','#285061','#19384d'][layer]; ctx.fill(); }
    for (let i=0;i<24;i++) { let x=((i*179+42-cameraX*.18)%(W+100)+W+100)%(W+100)-50, y=((i*131-cameraY*.22)%(H+100)+H+100)%(H+100)-50; ctx.fillStyle='rgba(220,242,225,.26)'; ctx.fillRect(x,y,2,2); }
    const top = Math.floor(cameraY / 12)*12-24, bottom = cameraY+H+24;
    for (const side of ['left','right']) { ctx.beginPath(); if(side==='left') {ctx.moveTo(-20,-20);ctx.lineTo(G.canyon(state.level,top)[side]-cameraX,top-cameraY);} else {ctx.moveTo(W+20,-20);ctx.lineTo(G.canyon(state.level,top)[side]-cameraX,top-cameraY);} for(let y=top+12;y<=bottom;y+=12)ctx.lineTo(G.canyon(state.level,y)[side]-cameraX,y-cameraY); ctx.lineTo(side==='left'?-20:W+20,H+20);ctx.closePath(); const rock=ctx.createLinearGradient(0,0,W,0); if(side==='left'){rock.addColorStop(0,'#0d2536');rock.addColorStop(1,'#425b61');}else{rock.addColorStop(0,'#455e62');rock.addColorStop(1,'#0e2534');}ctx.fillStyle=rock;ctx.fill(); ctx.strokeStyle='#f2c786';ctx.lineWidth=3;ctx.stroke(); }
    // Distance warning contour drawn on the safe side of both rock edges.
    ctx.setLineDash([9,9]);ctx.lineWidth=1;ctx.strokeStyle='rgba(247,211,138,.46)';
    for(const side of ['left','right']){ctx.beginPath();for(let y=top;y<=bottom;y+=12){const c=G.canyon(state.level,y),x=(side==='left'?c.left+G.RADIUS:c.right-G.RADIUS)-cameraX;if(y===top)ctx.moveTo(x,y-cameraY);else ctx.lineTo(x,y-cameraY);}ctx.stroke();}ctx.setLineDash([]);
    for(const w of state.level.winds){const y=w.y-cameraY;if(y < -65 || y > H+65 || w.used)continue;const x=G.canyon(state.level,w.y).center+w.offset-cameraX;const pulse=state.level.id<7?1:Math.sin(state.ticks/19+w.y)*.15+1;ctx.strokeStyle='#a7edcf';ctx.lineWidth=2;for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(x,y,18+i*13*pulse,9+i*9,0,0,Math.PI*2);ctx.stroke();}ctx.fillStyle='#d8ffdf';ctx.font='25px sans-serif';ctx.textAlign='center';ctx.fillText('✦',x,y+8);}
    for(const h of state.level.hazards){const y=h.y-cameraY;if(y < -60 || y > H+60)continue;const x=G.obstacleX(state.level,h,state.ticks)-cameraX;ctx.save();ctx.translate(x,y);ctx.rotate(state.ticks/75+h.phase);ctx.fillStyle='#e8b475';ctx.strokeStyle='#fff0bd';ctx.lineWidth=3;ctx.beginPath();for(let k=0;k<7;k++){let a=k*Math.PI*2/7;ctx.lineTo(Math.cos(a)*19,Math.sin(a)*19);}ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
    const exitY=G.END_Y-cameraY;if(exitY > -40 && exitY < H+40){const c=G.canyon(state.level,G.END_Y);ctx.fillStyle='#e7d18d';ctx.fillRect(c.left-cameraX,exitY,c.right-c.left,5);ctx.textAlign='center';ctx.font='bold 17px sans-serif';ctx.fillText('↓  출구',c.center-cameraX,exitY-12);}
    // Wing silhouette and shadow; white ring represents the collision radius.
    const px=state.x-cameraX,py=state.y-cameraY;ctx.save();ctx.translate(px,py);ctx.rotate(Math.max(-.35,Math.min(.35,state.vx*.065)));if(state.lift||state.spark){ctx.strokeStyle='#b7f5da';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,22+3*Math.sin(state.ticks/3),0,Math.PI*2);ctx.stroke();}ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,G.RADIUS,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#f6d393';ctx.beginPath();ctx.moveTo(0,15);ctx.lineTo(-26,-8);ctx.lineTo(-8,-4);ctx.lineTo(0,-18);ctx.lineTo(8,-4);ctx.lineTo(26,-8);ctx.closePath();ctx.fill();ctx.fillStyle='#173b50';ctx.beginPath();ctx.moveTo(0,-11);ctx.lineTo(-5,4);ctx.lineTo(0,11);ctx.lineTo(5,4);ctx.fill();ctx.restore();
    const prog=Math.min(1,state.y/G.END_Y);ctx.fillStyle='#122e42ad';ctx.fillRect(W-14,17,5,H-34);ctx.fillStyle='#f2ce88';ctx.fillRect(W-14,17,5,(H-34)*prog);
  }
  function frame(ts) { if(!last)last=ts;const delta=Math.min(.1,(ts-last)/1000);last=ts;
    if(mode==='playing'&&!paused){accumulator+=delta;let steps=0;while(accumulator>=G.STEP && steps++<8){const steer=(keys.has('ArrowRight')||keys.has('KeyD')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')?1:0)+[...pointers.values()].reduce((v,id)=>v+(id==='left'?-1:1),0)+mouseDirection;const oldCharge=state.charge,oldBank=state.bank;G.step(state,{steer:Math.max(-1,Math.min(1,steer)),release:releaseQueued});releaseQueued=false;if(!oldCharge&&state.charge)beep(640,.15,'sine');if(state.bank>oldBank)beep(880,.1,'triangle',.035);accumulator-=G.STEP;if(state.status!=='playing'){finish();break;}}if(steps>=8)accumulator=0;sync();}
    render();setTimeout(() => frame(performance.now()), 16);
  }
  menu();sync();setTimeout(() => frame(performance.now()), 16);
  globalThis.WindCliffUI = { get state(){return state;}, get mode(){return mode;}, get unlocked(){return unlocked;} };
})();
