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
test('normal descent advances exactly 11 per tick while lift still slows descent', () => {
  const normal = G.create(1), lifted = G.create(1);
  lifted.lift = 2;
  G.step(normal, input); G.step(lifted, input);
  assert.equal(normal.y - 55, 11);
  assert.ok(lifted.y - 55 < normal.y - 55);
});
test('held boost advances exactly 15 per tick and release returns to 11', () => {
  const s = G.create(1);
  G.step(s, { boost: true });
  assert.equal(s.y - 55, 15);
  G.step(s, input);
  assert.equal(s.y - 70, 11);
});
test('held boost descends faster and doubles near-wall provisional score', () => {
  const normal = G.create(1), boosted = G.create(1);
  for (const s of [normal, boosted]) s.x = G.canyon(s.level, s.y).left + G.RADIUS + 36;
  G.step(normal, input); G.step(boosted, { steer: 0, boost: true });
  assert.ok(boosted.y > normal.y);
  assert.equal(boosted.pending, normal.pending * 2);
  assert.equal(boosted.bank, 0);
  boosted.x = G.canyon(boosted.level, boosted.y).center;
  boosted.vx = 0;
  G.step(boosted, input);
  assert.equal(boosted.bank, normal.pending * 2);
});
test('boost does not add points in the center or bypass failed-flight cancellation', () => {
  const s = G.create(1);
  G.step(s, { boost: true });
  assert.equal(s.pending, 0);
  assert.equal(s.bank, 0);
  s.x = G.canyon(s.level, s.y).left + G.RADIUS + 36;
  G.step(s, { boost: true });
  assert.ok(s.pending > 0);
  s.x = G.canyon(s.level, s.y).left + G.RADIUS;
  G.step(s, { boost: true });
  assert.equal(s.status, 'failed');
  assert.equal(s.pending, 0);
  assert.equal(s.bank, 0);
});
test('canyon turns increase from 20 to 35 percent beyond the current geometry across 24 stages', () => {
  const expected = [274, 256, 240, 268, 248, 228];
  const originalTurns = [10, -45, 55, -40, -100];
  const indices = [0, 5, 8, 15, 23];
  for (const i of indices) {
    const band = Math.floor(i / 8);
    assert.equal(G.levels[i].width, expected[i % 6] - band * 5);
    const currentTurn = originalTurns[indices.indexOf(i)] * 1.15;
    assert.ok(Math.abs(G.levels[i].turns[1] - currentTurn * (1.2 + 0.15 * i / 23)) < 1e-9, `stage ${i + 1}`);
  }
});
test('24 structurally different fixed canyon paths and safe sampled center', () => {
  assert.equal(G.levels.length, 24);
  assert.equal(new Set(G.levels.map(l => JSON.stringify(l.turns))).size, 24);
  G.levels.forEach((l, i) => {
    assert.equal(l.turns.length, 10);
    for (let y = 0; y <= G.END_Y; y += 15) {
      const c = G.canyon(l, y);
      assert.ok(c.right - c.left >= 180, `${i + 1} ${y}`);
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
  const s = G.create(24, 2); s.y = G.END_Y - 1;
  s.x = G.canyon(s.level, s.y).center;
  G.step(s, input); assert.equal(s.status, 'won');
  const t = G.create(1, 2); t.ticks = 3599;
  G.step(t, input); assert.equal(t.status, 'failed');
});
test('intermediate gate preserves the same flight position, momentum, charge and bank', () => {
  const s = G.create(1);
  s.y = G.END_Y - 3; s.x = 450; s.vx = 2; s.bank = 40; s.charge = 1;
  G.step(s, { boost: true });
  assert.equal(s.status, 'playing');
  assert.equal(s.level.id, 2);
  assert.equal(s.completedLevel, 1);
  assert.equal(s.originY, G.END_Y);
  assert.equal(s.y, G.END_Y + 12);
  assert.ok(s.vx > 0);
  assert.equal(s.bank, 40);
  assert.equal(s.charge, 1);
  assert.equal(s.ticks, 0);
  G.step(s, { boost: true });
  assert.equal(s.y, G.END_Y + 27);
  assert.equal(s.completedLevel, 0);
});
test('one uninterrupted flight can clear all 24 gates without recreating the player', () => {
  const s = G.create(1, 41), completed = [];
  let previousY = s.y;
  while (s.status === 'playing' && completed.length < 24) {
    const ahead = G.canyonAt(s, Math.min(s.originY + G.END_Y, s.y + 180)).center;
    G.step(s, { steer: Math.abs(ahead - s.x) < 8 ? 0 : Math.sign(ahead - s.x), boost: s.level.id <= 12 });
    assert.ok(s.y > previousY);
    previousY = s.y;
    if (s.completedLevel) completed.push(s.completedLevel);
    assert.ok(s.y < 24 * G.END_Y + 30, 'flight should finish');
  }
  assert.equal(s.status, 'won');
  assert.equal(completed.join(','), G.levels.map(l => l.id).join(','));
  assert.equal(s.originY, 23 * G.END_Y);
});
test('all 24 canyon centerline routes reach exit', () => {
  G.levels.forEach((_, n) => {
    const s = G.create(n + 1, n + 11);
    while (s.status === 'playing' && s.level.id === n + 1 && s.ticks < 3600) {
      const ahead = G.canyonAt(s, Math.min(s.originY + G.END_Y, s.y + 180)).center;
      G.step(s, { steer: Math.abs(ahead - s.x) < 8 ? 0 : Math.sign(ahead - s.x), release: false });
    }
    assert.equal(s.completedLevel, n + 1, `level ${n + 1} tick ${s.ticks} y ${s.y} x ${s.x}`);
  });
});
test('all 24 routes finish with early boost and normal-speed tight late turns', () => {
  G.levels.forEach((_, n) => {
    const s = G.create(n + 1, n + 11);
    while (s.status === 'playing' && s.level.id === n + 1 && s.ticks < 3600) {
      const ahead = G.canyonAt(s, Math.min(s.originY + G.END_Y, s.y + 180)).center;
      G.step(s, { steer: Math.abs(ahead - s.x) < 8 ? 0 : Math.sign(ahead - s.x), boost: n < 12 });
    }
    assert.equal(s.completedLevel, n + 1, `boosted level ${n + 1} tick ${s.ticks} y ${s.y} x ${s.x}`);
  });
});
