(() => {
  'use strict';
  const api = {
    steer(x, y, centerX, centerY, radius) {
      const dx = x - centerX;
      return Math.abs(dx) < 6 ? 0 : Math.max(-1, Math.min(1, dx / radius));
    }
  };
  globalThis.WindCliffJoystick = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
