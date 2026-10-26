const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const context = vm.createContext({ globalThis: {}, Math, console });
vm.runInContext(source, context);
const G = context.globalThis.WindCliffCore;
function test(name, fn) { fn(); console.log('✓', name); }
const input = { steer: 0, release: false };
test('24 structurally different fixed canyon paths and safe sampled center', () => {
  assert.equal(G.levels.length, 24);
  assert.equal(new Set(G.levels.map(l => JSON.stringify(l.turns))).size, 24);
  G.levels.forEach((l, i) => {
    assert.equal(l.turns.length, 10);
    for (let y = 0; y <= G.END_Y; y += 15) {
      const c = G.canyon(l, y);
      assert.ok(c.right - c.left >= 200, `${i + 1} ${y}`);
      assert.ok(c.center > c.left + G.RADIUS && c.center < c.right - G.RADIUS);
    }
    assert.equal(l.hazards.length > 0, i >= 14);
  });
});
test('fixed 60Hz seed replay has identical state', () => {
  const a = G.create(18, 37), b = G.create(18, 37);
  for (let i = 0; i < 700; i++) {
    const command = { steer: Math.sin(i / 52) > 0 ? 1 : -1, release: i === 240 };
    G.step(a, command); G.step(b, command);
  }
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.ticks, b.ticks);
});
test('wind charge is one use and 36 tick lift', () => {
  const s = G.create(1, 4);
  s.x = G.canyon(s.level, s.y).center;
  s.y = s.level.winds[0].y;
  G.step(s, input);
  assert.equal(s.charge, 1);
  G.step(s, { steer: 0, release: true });
  assert.equal(s.charge, 0);
  assert.equal(s.lift, 35);
  assert.equal(s.level.winds[0].used, true);
  G.step(s, { steer: 0, release: true });
  assert.equal(s.lift, 34);
  assert.equal(s.charge, 0);
});
test('wall boundary collision clears pending but preserves bank', () => {
  const s = G.create(1, 1), c = G.canyon(s.level, s.y);
  s.x = c.left + G.RADIUS;
  s.pending = 55; s.bank = 20;
  G.step(s, input);
  assert.equal(s.status, 'failed'); assert.equal(s.pending, 0); assert.equal(s.bank, 20);
});
test('near-wall score banks only after leaving proximity', () => {
  const s = G.create(1, 1);
  s.x = G.canyon(s.level, s.y).left + G.RADIUS + 36;
  G.step(s, input);
  assert.ok(s.pending > 0); assert.equal(s.bank, 0);
  s.x = G.canyon(s.level, s.y).center; s.vx = 0;
  G.step(s, input);
  assert.ok(s.bank > 0); assert.equal(s.pending, 0);
});
test('exit succeeds and timeout fails', () => {
  const s = G.create(1, 2); s.y = G.END_Y - 1;
  s.x = G.canyon(s.level, s.y).center;
  G.step(s, input); assert.equal(s.status, 'won');
  const t = G.create(1, 2); t.ticks = 3599;
  G.step(t, input); assert.equal(t.status, 'failed');
});
test('all 24 canyon centerline routes reach exit', () => {
  G.levels.forEach((_, n) => {
    const s = G.create(n + 1, n + 11);
    while (s.status === 'playing' && s.ticks < 3600) {
      const ahead = G.canyon(s.level, Math.min(G.END_Y, s.y + 85)).center;
      G.step(s, { steer: Math.abs(ahead - s.x) < 8 ? 0 : Math.sign(ahead - s.x), release: false });
    }
    assert.equal(s.status, 'won', `level ${n + 1} tick ${s.ticks} y ${s.y} x ${s.x}`);
  });
});
