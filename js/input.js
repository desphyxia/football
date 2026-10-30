'use strict';
// Unified input: gamepads (Gamepad API, "standard" mapping) + two keyboard layouts.
// Button names follow PlayStation positions:
//   A = Cross (bottom), B = Circle (right), X = Square (left), Y = Triangle (top)
const BTNS = ['A', 'B', 'X', 'Y', 'L1', 'R1', 'L2', 'R2', 'SPRINT', 'START', 'SELECT', 'UP', 'DOWN', 'LEFT', 'RIGHT'];

const KB1 = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  A: ['Space', 'KeyF'], X: ['KeyG'], B: ['KeyR'], Y: ['KeyT'], L1: ['KeyQ'],
  SPRINT: ['ShiftLeft'], START: ['Escape', 'Digit1'],
};
const KB2 = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  A: ['KeyK', 'Numpad1'], X: ['KeyL', 'Numpad2'], B: ['KeyO', 'Numpad3'], Y: ['KeyP', 'Numpad5'], L1: ['KeyU', 'Numpad0'],
  SPRINT: ['ShiftRight', 'KeyJ'], START: ['Enter', 'NumpadEnter'],
};

function prettyPadName(id) {
  if (/054c|playstation|dualshock|dualsense|wireless controller/i.test(id)) return 'PS Controller';
  if (/xbox|xinput|045e|28de|steam/i.test(id)) return 'Controller';
  return 'Gamepad';
}

class Device {
  constructor(id, type, map, index) {
    this.id = id; this.type = type; this.map = map; this.index = index;
    this.cur = {}; this.prev = {};
    this.mx = 0; this.my = 0;
    this.connected = type === 'kb';
    this.name = type === 'kb' ? (id === 'kb1' ? 'Keyboard (WASD)' : 'Keyboard (Arrows)') : 'Gamepad';
    this.rep = {}; this.navEdge = {};
    this.ctl = { mx: 0, my: 0, held: {}, pressed: {}, released: {} };
  }
  finish(dt) {
    const c = this.ctl;
    c.mx = this.mx; c.my = this.my; c.held = this.cur; c.pressed = {}; c.released = {};
    let any = false;
    for (const b of BTNS) {
      if (this.cur[b] && !this.prev[b]) { c.pressed[b] = true; any = true; }
      if (!this.cur[b] && this.prev[b]) c.released[b] = true;
    }
    this.anyPressed = any;
    const dirs = {
      UP: this.cur.UP || this.my < -0.6, DOWN: this.cur.DOWN || this.my > 0.6,
      LEFT: this.cur.LEFT || this.mx < -0.6, RIGHT: this.cur.RIGHT || this.mx > 0.6,
    };
    for (const k in dirs) {
      this.navEdge[k] = false;
      if (dirs[k]) {
        if (!this.rep[k]) { this.navEdge[k] = true; this.rep[k] = 0.4; }
        else { this.rep[k] -= dt; if (this.rep[k] <= 0) { this.navEdge[k] = true; this.rep[k] = 0.12; } }
      } else this.rep[k] = 0;
    }
  }
  readPad(gp, dt) {
    this.prev = this.cur;
    const B = gp.buttons, ax = gp.axes;
    const pr = (i) => !!(B[i] && (B[i].pressed || B[i].value > 0.5));
    // Firefox/Linux sometimes exposes a raw DualShock 4 layout
    const m = (gp.mapping !== 'standard' && /054c/i.test(gp.id)) ? { A: 1, B: 2, X: 0, Y: 3 } : { A: 0, B: 1, X: 2, Y: 3 };
    const cur = {
      A: pr(m.A), B: pr(m.B), X: pr(m.X), Y: pr(m.Y), L1: pr(4), R1: pr(5), L2: pr(6), R2: pr(7),
      SELECT: pr(8), START: pr(9), UP: pr(12), DOWN: pr(13), LEFT: pr(14), RIGHT: pr(15),
    };
    cur.SPRINT = cur.R1 || cur.R2 || cur.L2;
    let x = ax[0] || 0, y = ax[1] || 0;
    const mag = Math.hypot(x, y);
    if (mag < 0.2) { x = 0; y = 0; } else if (mag > 1) { x /= mag; y /= mag; }
    if (cur.LEFT || cur.RIGHT || cur.UP || cur.DOWN) {
      x = (cur.RIGHT ? 1 : 0) - (cur.LEFT ? 1 : 0);
      y = (cur.DOWN ? 1 : 0) - (cur.UP ? 1 : 0);
      const l = Math.hypot(x, y) || 1; x /= l; y /= l;
    }
    this.mx = x; this.my = y; this.cur = cur;
    this.name = prettyPadName(gp.id);
    this.finish(dt);
  }
  readKeys(keys, dt) {
    this.prev = this.cur;
    const m = this.map, k = (a) => a.some((c) => keys.has(c));
    const cur = {};
    for (const b of ['A', 'B', 'X', 'Y', 'L1', 'SPRINT', 'START']) cur[b] = k(m[b]);
    cur.UP = k(m.up); cur.DOWN = k(m.down); cur.LEFT = k(m.left); cur.RIGHT = k(m.right);
    let x = (cur.RIGHT ? 1 : 0) - (cur.LEFT ? 1 : 0), y = (cur.DOWN ? 1 : 0) - (cur.UP ? 1 : 0);
    const l = Math.hypot(x, y); if (l) { x /= l; y /= l; }
    this.mx = x; this.my = y; this.cur = cur;
    this.finish(dt);
  }
  clear() { this.prev = this.cur; this.cur = {}; this.mx = this.my = 0; this.finish(0); }
  rumble(strong, weak, ms) {
    if (this.type !== 'gp') return;
    try {
      const gp = navigator.getGamepads()[this.index];
      const a = gp && gp.vibrationActuator;
      if (a && a.playEffect) a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    } catch (e) { /* rumble is optional */ }
  }
}

const Input = {
  keys: new Set(),
  taps: new Set(), // keys pressed and released between two polls
  devices: new Map(),
  init() {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.taps.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      Sound.unlock();
      if (e.code === 'F2') toggleFullscreen();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousedown', () => Sound.unlock());
    addEventListener('touchstart', () => Sound.unlock());
    this.devices.set('kb1', new Device('kb1', 'kb', KB1));
    this.devices.set('kb2', new Device('kb2', 'kb', KB2));
  },
  poll(dt) {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    const seen = new Set();
    for (let i = 0; i < gps.length; i++) {
      const gp = gps[i];
      if (!gp || !gp.connected) continue;
      const id = 'gp' + i;
      seen.add(id);
      let d = this.devices.get(id);
      if (!d) { d = new Device(id, 'gp', null, i); this.devices.set(id, d); }
      d.connected = true;
      d.readPad(gp, dt);
      if (d.anyPressed) Sound.unlock();
    }
    for (const d of this.devices.values()) {
      if (d.type === 'gp' && !seen.has(d.id)) { if (d.connected) d.connected = false; d.clear(); }
    }
    const keys = new Set([...this.keys, ...this.taps]);
    this.taps.clear();
    this.devices.get('kb1').readKeys(keys, dt);
    this.devices.get('kb2').readKeys(keys, dt);
  },
  list() { return [...this.devices.values()]; },
};

function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  } catch (e) { /* ignore */ }
}
