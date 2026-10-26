/* 바람절벽 활공 — original deterministic simulation, 60 fixed steps per second. */
(() => {
  'use strict';
  const END_Y = 2700, RADIUS = 13, STEP = 1 / 60;
  // Ten authored centerline knots each. The final six use tighter switchbacks.
  const routes = [
    [0,10,25,40,50,40,20,0,-10,0], [0,-20,-45,-65,-50,-20,10,25,10,0],
    [0,25,55,20,-20,-45,-15,30,50,0], [0,-30,-60,-25,35,65,30,-25,-35,0],
    [0,5,55,80,40,-10,-55,-35,20,0], [0,-45,-70,-10,55,75,15,-55,-20,0],
    [0,40,85,25,-45,-80,-15,50,70,0], [0,-15,-65,-90,-25,60,85,20,-45,0],
    [0,55,30,-35,-75,-20,55,85,25,0], [0,-55,-20,65,90,15,-65,-35,50,0],
    [0,30,75,95,20,-65,-80,5,65,0], [0,-35,-85,-10,75,100,30,-65,-70,0],
    [0,65,95,25,-75,-90,-10,80,45,0], [0,-60,-95,-5,95,55,-55,-85,20,0],
    [0,45,100,40,-65,-110,-25,80,60,0], [0,-40,-105,-45,60,110,30,-80,-55,0],
    [0,70,15,-80,-105,5,105,45,-65,0], [0,-75,-15,90,110,-5,-100,-35,70,0],
    [0,90,105,-15,-110,-20,100,85,-75,0], [0,-85,-110,25,100,10,-100,-80,85,0],
    [0,50,-40,-105,0,105,50,-65,-95,0], [0,-50,45,110,5,-105,-45,75,100,0],
    [0,100,25,-105,-30,110,35,-100,-25,0], [0,-100,-20,105,25,-110,-35,100,30,0]
  ];
  const levels = routes.map((turns, i) => ({
    id: i + 1, turns,
    width: [278,260,244,272,252,232][i % 6] - Math.floor(i / 8) * 5,
    windType: i < 6 ? '고요' : i < 14 ? '맥동' : '횡풍',
    winds: [650, 1550, 2220].map((y, k) => ({ y, offset: k === 1 ? (i % 2 ? 12 : -12) : 0, used: false })),
    hazards: i < 14 ? [] : [1000, 1870, 2400].map((y, k) => ({ y, side: (i + k) % 2 ? 1 : -1, phase: i * 19 + k * 37 }))
  }));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function canyon(level, y) {
    const p = clamp(y / 300, 0, 8.99999), k = Math.floor(p), f = p - k;
    const ease = f * f * (3 - 2 * f);
    const center = 450 + level.turns[k] * (1 - ease) + level.turns[k + 1] * ease;
    const width = level.width + 14 * Math.sin(y / 143 + level.id * 0.7);
    return { center, left: center - width / 2, right: center + width / 2 };
  }
  function obstacleX(level, h, ticks) {
    return canyon(level, h.y).center + h.side * (94 + 7 * Math.sin((ticks + h.phase) / 45));
  }
  function create(number, seed = 20261027) {
    const base = levels[clamp(Math.floor(number), 1, 24) - 1];
    const level = { ...base, winds: base.winds.map(w => ({ ...w })), hazards: base.hazards.map(h => ({ ...h })) };
    return { level, seed, x: 450, y: 55, vx: 0, ticks: 0, charge: 0, lift: 0, bank: 0, pending: 0,
      bestNear: 999, status: 'playing', reason: '', spark: 0 };
  }
  function step(s, command = {}) {
    if (s.status !== 'playing') return s;
    const steer = clamp(Number(command.steer) || 0, -1, 1);
    s.ticks++;
    if (command.release && s.charge && !s.lift) { s.charge = 0; s.lift = 36; }
    s.vx = clamp((s.vx + steer * 0.66) * 0.88, -5.3, 5.3);
    s.x += s.vx;
    const speed = s.lift > 0 ? 1.05 : 2.65;
    s.y += speed;
    if (s.lift) s.lift--;
    // A fixed-seed, bounded lateral wind; does not alter tick rate or wall silhouette.
    if (s.level.id >= 7 && s.y > 500 && s.y < END_Y - 100) {
      const pulse = s.level.id < 15 ? 0.10 : 0.19;
      s.x += pulse * Math.sin((s.ticks + s.seed % 97) / 43 + s.y / 182);
    }
    const c = canyon(s.level, s.y), clearance = Math.min(s.x - c.left, c.right - s.x) - RADIUS;
    let crash = clearance <= 0;
    for (const h of s.level.hazards) {
      const dx = s.x - obstacleX(s.level, h, s.ticks), dy = s.y - h.y;
      if (dx * dx + dy * dy <= (RADIUS + 19) ** 2) crash = true;
    }
    if (crash) { s.status = 'failed'; s.reason = '암벽 또는 바위에 부딪혔어요'; s.pending = 0; return s; }
    if (s.ticks >= 3600) { s.status = 'failed'; s.reason = '시간이 다 됐어요'; s.pending = 0; return s; }
    for (const w of s.level.winds) {
      if (!w.used && Math.abs(s.y - w.y) < 26 && Math.abs(s.x - (canyon(s.level, w.y).center + w.offset)) < 55) {
        w.used = true; s.charge = 1; s.spark = 24;
      }
    }
    if (clearance < 58) {
      s.pending += Math.max(1, Math.round((60 - clearance) / 11));
      s.bestNear = Math.min(s.bestNear, clearance);
    } else if (clearance >= 72 && s.pending) {
      s.bank += s.pending; s.pending = 0; s.bestNear = 999;
    }
    if (s.y >= END_Y) {
      // A near-wall streak is not banked by crossing the exit; only a clean separation banks it.
      s.pending = 0; s.status = 'won';
    }
    if (s.spark) s.spark--;
    return s;
  }
  globalThis.WindCliffCore = { levels, END_Y, RADIUS, STEP, canyon, obstacleX, create, step };
})();
