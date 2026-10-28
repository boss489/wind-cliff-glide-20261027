const assert = require('node:assert/strict');
const J = require('../joystick.js');
assert.equal(J.steer(50, 50, 50, 50, 48), 0, 'center neutral');
assert.equal(J.steer(54, 2, 50, 50, 48), 0, 'vertical movement does not steer');
assert.equal(J.steer(74, 50, 50, 50, 48), 0.5, 'half right');
assert.equal(J.steer(2, 50, 50, 50, 48), -1, 'full left');
assert.equal(J.steer(130, 50, 50, 50, 48), 1, 'right clamps');
console.log('✓ joystick horizontal analog steering and neutral');
