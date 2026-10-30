'use strict';
// =====================================================================
//  App shell: menus, HUD, main loop
// =====================================================================
const P_COLORS = ['#29d3ff', '#ffb300'];
const HEAD = '"Arial Black", "Arial Bold", Impact, sans-serif';
const BODY = '"Trebuchet MS", "Segoe UI", Verdana, Arial, sans-serif';
const F = (sz, w) => `${w || 'bold'} ${sz}px ${BODY}`;

const App = {
  screen: 'lobby', slots: [null, null],
  settings: { half: 4, size: 11, cpuTeam: 1 },
  setSel: 0, paused: false, pauseSel: 0, ftSel: 0, lastJoin: -1, t: 0,
  matchDevices: [], lastCfg: null, msg: null, previews: new Map(),
};
let gctx, hctx, gameCanvas, hudCanvas;

// ---------- setup ----------
function startDemo() {
  const a = randi(0, TEAMS.length - 1);
  let b = randi(0, TEAMS.length - 1);
  if (b === a) b = (a + 1) % TEAMS.length;
  createMatch({ teams: [a, b], ctl: ['cpu', 'cpu'], halfLen: 150, size: 11, demo: true });
  Sound.muted = true;
}
function startMatch(cfg) {
  App.lastCfg = cfg;
  createMatch(cfg);
  App.screen = 'match'; App.paused = false; App.msg = null;
  Sound.muted = false; Sound.unlock();
}
function goLobby(keepSlots) {
  App.screen = 'lobby';
  if (keepSlots) App.slots.forEach((s) => { if (s) s.ready = false; });
  else App.slots = [null, null];
  App.paused = false;
  startDemo();
}
function joinedDevices() { return App.slots.filter(Boolean).map((s) => s.dev); }

// ---------- menu input ----------
function lobbyInput() {
  for (const d of Input.list()) {
    const si = App.slots.findIndex((s) => s && s.dev === d);
    if (d.type === 'gp' && !d.connected) { if (si >= 0) App.slots[si] = null; continue; }
    const c = d.ctl;
    if (si < 0) {
      if ((c.pressed.A || c.pressed.START) && App.t - App.lastJoin > 0.25) {
        const free = App.slots.findIndex((s) => !s);
        if (free >= 0) {
          const other = App.slots[1 - free];
          let team = free === 0 ? 0 : 1;
          if (other && other.team === team) team = (team + 1) % TEAMS.length;
          App.slots[free] = { dev: d, team, ready: false };
          App.lastJoin = App.t;
          Sound.blip(true);
        }
      }
      continue;
    }
    const s = App.slots[si];
    if (!s.ready) {
      if (d.navEdge.LEFT) { s.team = (s.team + TEAMS.length - 1) % TEAMS.length; Sound.blip(); }
      if (d.navEdge.RIGHT) { s.team = (s.team + 1) % TEAMS.length; Sound.blip(); }
      if (c.pressed.A || c.pressed.START) { s.ready = true; Sound.blip(true); }
      else if (c.pressed.B) { App.slots[si] = null; Sound.blip(); }
    } else {
      if (c.pressed.B) { s.ready = false; Sound.blip(); }
      else if (c.pressed.A || c.pressed.START) {
        if (App.slots.filter(Boolean).every((q) => q.ready)) {
          App.screen = 'settings'; App.setSel = 0; Sound.blip(true);
          if (!App.slots[1]) {
            let ct = App.settings.cpuTeam;
            if (ct === App.slots[0].team) ct = (ct + 1) % TEAMS.length;
            App.settings.cpuTeam = ct;
          }
          return;
        }
      }
    }
  }
  if (!App.slots[0] && App.slots[1]) { App.slots[0] = App.slots[1]; App.slots[1] = null; }
}

function settingRows() {
  const rows = [
    { k: 'half', label: 'HALF LENGTH', vals: [2, 3, 4, 5, 8, 10], fmt: (v) => v + ' MIN' },
    { k: 'size', label: 'TEAM SIZE', vals: [11, 7, 5], fmt: (v) => v + ' A SIDE' },
  ];
  if (!App.slots[1]) rows.push({ k: 'cpuTeam', label: 'CPU TEAM', vals: TEAMS.map((_, i) => i), fmt: (v) => TEAMS[v].name.toUpperCase() });
  rows.push({ k: 'go', label: 'KICK OFF!' });
  return rows;
}
function settingsInput() {
  const rows = settingRows();
  for (const d of joinedDevices()) {
    const c = d.ctl;
    if (d.navEdge.UP) { App.setSel = (App.setSel + rows.length - 1) % rows.length; Sound.blip(); }
    if (d.navEdge.DOWN) { App.setSel = (App.setSel + 1) % rows.length; Sound.blip(); }
    const row = rows[App.setSel];
    if (row.vals && (d.navEdge.LEFT || d.navEdge.RIGHT)) {
      const i = row.vals.indexOf(App.settings[row.k]);
      const ni = (i + (d.navEdge.RIGHT ? 1 : row.vals.length - 1)) % row.vals.length;
      App.settings[row.k] = row.vals[ni];
      Sound.blip();
    }
    if (c.pressed.START || (c.pressed.A && row.k === 'go')) {
      Sound.blip(true);
      const s0 = App.slots[0], s1 = App.slots[1];
      App.matchDevices = joinedDevices();
      startMatch({
        teams: [s0.team, s1 ? s1.team : App.settings.cpuTeam],
        ctl: [s0.dev, s1 ? s1.dev : 'cpu'],
        halfLen: App.settings.half * 60, size: App.settings.size,
      });
      return;
    }
    if (c.pressed.B) { App.screen = 'lobby'; App.slots.forEach((s) => { if (s) s.ready = false; }); Sound.blip(); return; }
  }
}

const PAUSE_ITEMS = ['RESUME', 'RESTART MATCH', 'QUIT TO MENU'];
function pauseInput() {
  for (const d of App.matchDevices) {
    const c = d.ctl;
    if (d.navEdge.UP) { App.pauseSel = (App.pauseSel + 2) % 3; Sound.blip(); }
    if (d.navEdge.DOWN) { App.pauseSel = (App.pauseSel + 1) % 3; Sound.blip(); }
    if (c.pressed.START || c.pressed.B) { App.paused = false; App.msg = null; Sound.muted = false; return; }
    if (c.pressed.A) {
      Sound.blip(true);
      if (App.pauseSel === 0) { App.paused = false; App.msg = null; Sound.muted = false; }
      else if (App.pauseSel === 1) startMatch(App.lastCfg);
      else goLobby(true);
      return;
    }
  }
}
const FT_ITEMS = ['REMATCH', 'CHANGE TEAMS', 'MAIN MENU'];
function fulltimeInput() {
  for (const d of App.matchDevices) {
    const c = d.ctl;
    if (d.navEdge.UP) { App.ftSel = (App.ftSel + 2) % 3; Sound.blip(); }
    if (d.navEdge.DOWN) { App.ftSel = (App.ftSel + 1) % 3; Sound.blip(); }
    if (c.pressed.A || c.pressed.START) {
      Sound.blip(true);
      if (App.ftSel === 0) startMatch(App.lastCfg);
      else goLobby(App.ftSel === 1);
      return;
    }
  }
}

// ---------- main tick ----------
function tick(dt) {
  App.t += dt;
  Input.poll(dt);
  if (App.screen === 'match') {
    if (App.paused) { pauseInput(); return; }
    for (const d of App.matchDevices) {
      if (d.type === 'gp' && !d.connected && M.phase !== 'fulltime') {
        App.paused = true; App.pauseSel = 0; App.msg = 'CONTROLLER DISCONNECTED';
        Sound.muted = true; Sound.crowd(0);
        return;
      }
      if (d.ctl.pressed.START && M.phase !== 'fulltime') {
        App.paused = true; App.pauseSel = 0; Sound.muted = true; Sound.crowd(0);
        return;
      }
    }
    if (M.phase === 'replay') M.skip = App.matchDevices.some((d) => d.ctl.pressed.A || d.ctl.pressed.X);
    const ctls = M.teams.map((t) => (t.cpu ? cpuControl(t, dt) : t.ctl.ctl));
    matchTick(dt, ctls);
    if (M.phase === 'fulltime' && M.phaseT > 2) {
      if (M.phaseT - dt <= 2) App.ftSel = 0;
      fulltimeInput();
    }
  } else {
    if (!M || !M.demo) startDemo();
    matchTick(dt, M.teams.map((t) => cpuControl(t, dt)));
    if (M.phase === 'fulltime' && M.phaseT > 3) startDemo();
    if (App.screen === 'lobby') lobbyInput(); else settingsInput();
  }
}

// ---------- HUD drawing helpers ----------
function txt(h, s, x, y, font, color, align, stroke) {
  h.font = font; h.textAlign = align || 'left'; h.textBaseline = 'middle';
  if (stroke) { h.lineWidth = stroke; h.strokeStyle = 'rgba(0,0,0,0.85)'; h.lineJoin = 'round'; h.strokeText(s, x, y); }
  h.fillStyle = color; h.fillText(s, x, y);
}
function panel(h, x, y, w, ht, a) {
  h.fillStyle = `rgba(8,16,30,${a == null ? 0.78 : a})`;
  h.fillRect(x, y, w, ht);
  h.strokeStyle = 'rgba(255,255,255,0.25)'; h.lineWidth = 1; h.strokeRect(x + 0.5, y + 0.5, w - 1, ht - 1);
}
// PlayStation-style button icon
function btnIcon(h, b, x, y, r) {
  r = r || 6;
  h.save();
  if (b === 'L1' || b === 'R1' || b === 'OPT') {
    const w = b === 'OPT' ? r * 3.6 : r * 2.4;
    h.fillStyle = '#20232b'; h.fillRect(x - w / 2, y - r * 0.8, w, r * 1.6);
    txt(h, b === 'OPT' ? 'OPTIONS' : b, x, y + 0.5, `bold ${r * (b === 'OPT' ? 0.85 : 1.1)}px ${BODY}`, '#ddd', 'center');
    h.restore(); return;
  }
  h.fillStyle = '#20232b'; h.beginPath(); h.arc(x, y, r, 0, Math.PI * 2); h.fill();
  h.lineWidth = Math.max(1, r / 4.5);
  const k = r * 0.45;
  h.beginPath();
  if (b === 'A') { h.strokeStyle = '#8fb8ff'; h.moveTo(x - k, y - k); h.lineTo(x + k, y + k); h.moveTo(x + k, y - k); h.lineTo(x - k, y + k); }
  else if (b === 'B') { h.strokeStyle = '#ff6b6b'; h.arc(x, y, k, 0, Math.PI * 2); }
  else if (b === 'X') { h.strokeStyle = '#ff8ad8'; h.rect(x - k * 0.9, y - k * 0.9, k * 1.8, k * 1.8); }
  else if (b === 'Y') { h.strokeStyle = '#4fe0b0'; h.moveTo(x, y - k); h.lineTo(x + k, y + k * 0.75); h.lineTo(x - k, y + k * 0.75); h.closePath(); }
  h.stroke();
  h.restore();
}
// Draws a row like ['Pass', {b:'A'}, ...] centred at x
function richRow(h, parts, x, y, size, color) {
  h.font = F(size);
  const gap = size * 0.35, icon = size * 1.25;
  const widths = parts.map((p) => (typeof p === 'string' ? h.measureText(p).width : (p.b === 'OPT' ? icon * 1.6 : icon)) + gap);
  let cx = x - widths.reduce((a, b) => a + b, 0) / 2;
  parts.forEach((p, i) => {
    if (typeof p === 'string') txt(h, p, cx, y, F(size), color || '#fff', 'left');
    else btnIcon(h, p.b, cx + (widths[i] - gap) / 2, y, size * 0.55);
    cx += widths[i];
  });
}
function kitChip(h, kit, x, y, w, ht) {
  h.fillStyle = kit.shirt; h.fillRect(x, y, w, ht * 0.6);
  if (kit.stripe) { h.fillStyle = kit.stripe; for (let i = 1; i < 4; i += 2) h.fillRect(x + (w * i) / 4 - 1, y, 2, ht * 0.6); }
  h.fillStyle = kit.shorts; h.fillRect(x, y + ht * 0.6, w, ht * 0.4);
  h.strokeStyle = 'rgba(0,0,0,0.6)'; h.lineWidth = 1; h.strokeRect(x + 0.5, y + 0.5, w - 1, ht - 1);
}
function getPreview(kit) {
  const key = JSON.stringify(kit);
  if (!App.previews.has(key)) App.previews.set(key, kitPreview(kit));
  return App.previews.get(key);
}
function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

// ---------- HUD: in match ----------
function clockText(m) {
  const total = (m.half - 1) * 45 + Math.min(45, (m.clock / m.halfLen) * 45);
  const mm = Math.floor(total), ss = Math.floor((total - mm) * 60);
  return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}
function toHud(x, y, z) { const k = HUD_W / VIEW_W; return [(projX(x, y) + R.ox) * k, (projY(x, y, z) + R.oy) * k]; }

function drawMatchHUD(h, m) {
  // player markers
  if (m.phase !== 'replay' && !m.demo) {
    m.teams.forEach((t) => {
      const p = t.controlled;
      if (!p || !t.ctl) return;
      const isCpu = t.ctl === 'cpu';
      const label = isCpu ? 'CPU' : 'P' + (App.matchDevices.indexOf(t.ctl) + 1);
      const col = isCpu ? '#ff5a5a' : P_COLORS[App.matchDevices.indexOf(t.ctl)] || '#fff';
      let [sx, sy] = toHud(p.x, p.y, (p.z || 0) + 2.3);
      const off = sx < 8 || sx > HUD_W - 8 || sy < 14 || sy > HUD_H - 8;
      sx = clamp(sx, 10, HUD_W - 10); sy = clamp(sy, sx < 190 ? 48 : 18, HUD_H - 10);
      h.fillStyle = col;
      h.beginPath(); h.moveTo(sx - 4, sy - 5); h.lineTo(sx + 4, sy - 5); h.lineTo(sx, sy); h.closePath(); h.fill();
      h.strokeStyle = '#000'; h.lineWidth = 0.8; h.stroke();
      txt(h, off ? label + '!' : label, sx, sy - 10, F(8), col, 'center', 2.5);
      const charging = t.charging && (m.ball.owner === p || (m.restart && m.restart.taker === p));
      if (charging) {
        const w = 22;
        h.fillStyle = 'rgba(0,0,0,0.7)'; h.fillRect(sx - w / 2 - 1, sy + 24, w + 2, 5);
        h.fillStyle = t.charge > 0.8 ? '#ff4040' : t.charge > 0.5 ? '#ffd23f' : '#5cff6a';
        h.fillRect(sx - w / 2, sy + 25, w * t.charge, 3);
      }
    });
  }

  // scoreboard
  const t0 = m.teams[0], t1 = m.teams[1];
  panel(h, 8, 8, 170, 22, 0.75);
  kitChip(h, t0.kit, 13, 12, 8, 14);
  txt(h, t0.data.abbr, 25, 19.5, F(11), '#fff');
  txt(h, `${m.score[0]} - ${m.score[1]}`, 75, 19.5, F(12), '#ffe14d', 'center');
  txt(h, t1.data.abbr, 125, 19.5, F(11), '#fff', 'right');
  kitChip(h, t1.kit, 129, 12, 8, 14);
  txt(h, clockText(m), 158, 19.5, F(9), '#cde', 'center');

  if (m.phase === 'replay') {
    if (Math.floor(App.t * 2) % 2 === 0) txt(h, '● REPLAY', HUD_W - 12, 19, F(12), '#ff4d4d', 'right', 3);
    txt(h, 'Press ✕ to skip', HUD_W - 12, 33, F(7), '#ddd', 'right', 2);
  }

  // set-piece hint for human taker
  const r = m.restart;
  if (m.phase === 'restart' && r && r.ready && !m.demo) {
    const t = m.teams[r.team];
    if (t.ctl && t.ctl !== 'cpu') {
      let parts;
      if (r.type === 'penalty') parts = ['Aim with stick, hold', { b: 'X' }, 'to shoot'];
      else if (r.type === 'freekick') parts = [{ b: 'A' }, 'Pass', { b: 'B' }, 'Lob', { b: 'X' }, 'Shoot (hold)'];
      else if (r.type === 'throwin') parts = [{ b: 'A' }, 'Short throw', { b: 'B' }, 'Long throw'];
      else if (r.type === 'corner') parts = [{ b: 'B' }, 'Cross', { b: 'A' }, 'Short pass'];
      else parts = [{ b: 'A' }, 'Pass', { b: 'B' }, 'Long ball', { b: 'Y' }, 'Through'];
      const hy = HUD_H - 8 - (110 * m.W) / m.L - 26;
      panel(h, 170, hy, 300, 18, 0.6);
      richRow(h, parts, 320, hy + 9, 9);
    }
  }

  drawMinimap(h, m);

  // banner
  const bn = m.banner;
  if (bn) {
    const age = bn.t0 - bn.t;
    const big = bn.big;
    const sc = big ? 1 + 0.25 * Math.max(0, 1 - age * 3) : 1;
    h.save(); h.translate(HUD_W / 2, big ? 120 : 70); h.scale(sc, sc);
    txt(h, bn.text, 0, 0, `900 ${big ? 44 : 22}px ${HEAD}`, big ? '#ffe14d' : '#ffffff', 'center', big ? 7 : 4);
    if (bn.sub) txt(h, bn.sub, 0, big ? 36 : 22, F(15), '#fff', 'center', 4);
    h.restore();
  }
}

function drawMinimap(h, m) {
  const w = 110, ht = (w * m.W) / m.L, x0 = HUD_W / 2 - w / 2, y0 = HUD_H - ht - 8;
  h.fillStyle = 'rgba(20,60,20,0.55)'; h.fillRect(x0, y0, w, ht);
  h.strokeStyle = 'rgba(255,255,255,0.55)'; h.lineWidth = 0.8;
  h.strokeRect(x0, y0, w, ht);
  h.beginPath(); h.moveTo(x0 + w / 2, y0); h.lineTo(x0 + w / 2, y0 + ht); h.stroke();
  const bw = (m.boxD / m.L) * w, bh = (m.boxW / m.W) * ht;
  h.strokeRect(x0, y0 + ht / 2 - bh / 2, bw, bh); h.strokeRect(x0 + w - bw, y0 + ht / 2 - bh / 2, bw, bh);
  const mp = (x, y) => [x0 + ((x + m.hl) / m.L) * w, y0 + ((y + m.hw) / m.W) * ht];
  for (const t of m.teams) {
    for (const p of t.players) {
      const [a, b] = mp(p.x, p.y);
      const kit = p.isGK ? t.gkKit : t.kit;
      h.fillStyle = kit.shirt; h.fillRect(a - 1.5, b - 1.5, 3, 3);
      h.strokeStyle = 'rgba(0,0,0,0.7)'; h.lineWidth = 0.6; h.strokeRect(a - 1.5, b - 1.5, 3, 3);
      if (p === t.controlled && t.ctl && !m.demo) {
        const i = App.matchDevices.indexOf(t.ctl);
        h.strokeStyle = t.ctl === 'cpu' ? '#ff5a5a' : P_COLORS[i] || '#fff'; h.lineWidth = 1;
        h.strokeRect(a - 3, b - 3, 6, 6);
      }
    }
  }
  const [bx, by] = mp(m.ball.x, m.ball.y);
  h.fillStyle = '#fff'; h.beginPath(); h.arc(bx, by, 1.6, 0, Math.PI * 2); h.fill();
}

function drawMenuList(h, items, sel, y0, title, subtitle) {
  panel(h, 200, y0 - 30, 240, 34 + items.length * 26, 0.88);
  txt(h, title, 320, y0 - 14, `900 16px ${HEAD}`, '#ffe14d', 'center');
  if (subtitle) txt(h, subtitle, 320, y0 + 2, F(9), '#ff8080', 'center');
  items.forEach((it, i) => {
    const y = y0 + 16 + i * 26;
    if (i === sel) { h.fillStyle = 'rgba(41,211,255,0.25)'; h.fillRect(210, y - 10, 220, 20); }
    txt(h, it, 320, y, F(12), i === sel ? '#fff' : '#9ab', 'center');
  });
}

function drawStats(h, m) {
  const tp = m.stats.poss[0] + m.stats.poss[1] || 1;
  const p0 = Math.round((m.stats.poss[0] / tp) * 100);
  panel(h, 200, 170, 240, 52, 0.85);
  txt(h, 'POSSESSION', 320, 182, F(9), '#9ab', 'center');
  txt(h, p0 + '%', 230, 182, F(11), '#fff', 'center');
  txt(h, 100 - p0 + '%', 410, 182, F(11), '#fff', 'center');
  txt(h, 'SHOTS', 320, 204, F(9), '#9ab', 'center');
  txt(h, String(m.stats.shots[0]), 230, 204, F(11), '#fff', 'center');
  txt(h, String(m.stats.shots[1]), 410, 204, F(11), '#fff', 'center');
}

// ---------- HUD: menus ----------
function drawTitle(h) {
  const y = 44;
  h.save();
  h.translate(320, y);
  h.rotate(-0.04);
  txt(h, 'SUPER FOOTY', 0, 0, `900 40px ${HEAD}`, '#ffe14d', 'center', 8);
  txt(h, "'94", 160, 10, `900 22px ${HEAD}`, '#ff5a5a', 'center', 5);
  h.restore();
  txt(h, 'TWO PLAYER FOOTBALL', 320, 78, F(10), '#bfe6ff', 'center', 3);
}

function drawLobby(h) {
  drawTitle(h);
  for (let i = 0; i < 2; i++) {
    const s = App.slots[i], x = i === 0 ? 70 : 340, y = 96, w = 230, ht = 160;
    panel(h, x, y, w, ht, 0.82);
    h.fillStyle = P_COLORS[i]; h.fillRect(x, y, w, 3);
    txt(h, 'PLAYER ' + (i + 1), x + 10, y + 14, `900 12px ${HEAD}`, P_COLORS[i], 'left');
    if (!s) {
      const blink = Math.floor(App.t * 2) % 2 === 0;
      if (blink) richRow(h, ['Press', { b: 'A' }, 'to join'], x + w / 2, y + 66, 13);
      txt(h, i === 1 ? '(or play alone vs the CPU)' : 'Keyboard: SPACE or K', x + w / 2, y + 92, F(8), '#8aa', 'center');
      continue;
    }
    txt(h, s.dev.name, x + w - 10, y + 14, F(8), '#9ab', 'right');
    const team = TEAMS[s.team];
    const img = getPreview(team.home);
    h.imageSmoothingEnabled = false;
    h.drawImage(img, x + 14, y + 30, 16 * 4, 24 * 4);
    txt(h, (s.ready ? '' : '◀ ') + team.name.toUpperCase() + (s.ready ? '' : ' ▶'), x + 150, y + 44, `900 13px ${HEAD}`, '#fff', 'center');
    txt(h, 'ATT ' + stars(team.att), x + 150, y + 66, F(9), '#ffd54f', 'center');
    txt(h, 'DEF ' + stars(team.def), x + 150, y + 80, F(9), '#ffd54f', 'center');
    txt(h, 'SPD ' + stars(team.spd), x + 150, y + 94, F(9), '#ffd54f', 'center');
    if (s.ready) {
      txt(h, 'READY!', x + 150, y + 122, `900 15px ${HEAD}`, '#5cff6a', 'center', 3);
      const all = App.slots.filter(Boolean).every((q) => q.ready);
      if (all) richRow(h, ['Press', { b: 'A' }, 'to continue'], x + 150, y + 144, 9, '#cde');
      else txt(h, 'Waiting for other player…', x + 150, y + 144, F(8), '#9ab', 'center');
    } else {
      richRow(h, [{ b: 'A' }, 'Ready', { b: 'B' }, 'Leave'], x + 150, y + 126, 9);
    }
  }
  // controls
  panel(h, 70, 264, 500, 64, 0.82);
  richRow(h, ['ATTACK:', { b: 'A' }, 'Pass', { b: 'X' }, 'Shoot (hold)', { b: 'B' }, 'Lob/Cross', { b: 'Y' }, 'Through ball', { b: 'R1' }, 'Sprint'], 320, 280, 9);
  richRow(h, ['DEFEND:', { b: 'A' }, { b: 'L1' }, 'Switch player', { b: 'X' }, 'Slide', { b: 'B' }, 'Tackle', { b: 'OPT' }, 'Pause'], 320, 298, 9);
  txt(h, 'Keyboard P1: WASD move, F pass, G shoot, R lob, T through, Q switch, Shift sprint, Esc pause', 320, 315, F(7), '#8aa', 'center');
  if (!Sound.running()) txt(h, '🔇 Sound is off until you press a key or click (see README for the Steam launch option)', 320, 344, F(7), '#ffb3b3', 'center', 2);
}

function drawSettings(h) {
  drawTitle(h);
  const rows = settingRows();
  const s0 = App.slots[0], s1 = App.slots[1];
  const tA = TEAMS[s0.team], tB = TEAMS[s1 ? s1.team : App.settings.cpuTeam];
  panel(h, 150, 96, 340, 200, 0.85);
  txt(h, tA.name.toUpperCase(), 250, 116, `900 14px ${HEAD}`, P_COLORS[0], 'center');
  txt(h, 'VS', 320, 116, `900 12px ${HEAD}`, '#fff', 'center');
  txt(h, tB.name.toUpperCase(), 390, 116, `900 14px ${HEAD}`, s1 ? P_COLORS[1] : '#ff5a5a', 'center');
  rows.forEach((r, i) => {
    const y = 148 + i * 30, sel = i === App.setSel;
    if (sel) { h.fillStyle = 'rgba(41,211,255,0.22)'; h.fillRect(160, y - 12, 320, 24); }
    if (r.k === 'go') { txt(h, r.label, 320, y, `900 16px ${HEAD}`, sel ? '#5cff6a' : '#9c9', 'center', sel ? 3 : 0); return; }
    txt(h, r.label, 175, y, F(11), sel ? '#fff' : '#9ab', 'left');
    txt(h, (sel ? '◀  ' : '') + r.fmt(App.settings[r.k]) + (sel ? '  ▶' : ''), 465, y, F(11), sel ? '#ffe14d' : '#cde', 'right');
  });
  richRow(h, [{ b: 'A' }, 'Select', { b: 'B' }, 'Back', { b: 'OPT' }, 'Start match'], 320, 312, 9);
}

function drawHUD() {
  const h = hctx, s = hudCanvas.width / HUD_W;
  h.setTransform(1, 0, 0, 1, 0, 0);
  h.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  h.setTransform(s, 0, 0, s, 0, 0);
  if (App.screen === 'match') {
    drawMatchHUD(h, M);
    if (App.paused) {
      h.fillStyle = 'rgba(0,0,0,0.45)'; h.fillRect(0, 0, HUD_W, HUD_H);
      drawMenuList(h, PAUSE_ITEMS, App.pauseSel, 140, 'PAUSED', App.msg);
    } else if (M.phase === 'fulltime' && M.phaseT > 2) {
      drawStats(h, M);
      drawMenuList(h, FT_ITEMS, App.ftSel, 260, 'WHAT NEXT?');
    }
  } else {
    h.fillStyle = 'rgba(0,0,0,0.45)'; h.fillRect(0, 0, HUD_W, HUD_H);
    if (App.screen === 'lobby') drawLobby(h); else drawSettings(h);
  }
}

// ---------- layout & loop ----------
function resize() {
  const W = innerWidth, H = innerHeight;
  const s = Math.min(W / HUD_W, H / HUD_H);
  const cw = Math.floor(HUD_W * s), ch = Math.floor(HUD_H * s);
  const l = Math.floor((W - cw) / 2), t = Math.floor((H - ch) / 2);
  for (const c of [gameCanvas, hudCanvas]) {
    c.style.width = cw + 'px'; c.style.height = ch + 'px'; c.style.left = l + 'px'; c.style.top = t + 'px';
  }
  const dpr = window.devicePixelRatio || 1;
  hudCanvas.width = Math.round(cw * dpr); hudCanvas.height = Math.round(ch * dpr);
}

let lastT = 0, acc = 0;
function frame(now) {
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;
  acc += dt;
  let n = 0;
  while (acc >= DT && n < 6) { tick(DT); acc -= DT; n++; }
  if (n >= 6) acc = 0;
  if (M) renderMatch(gctx, M);
  drawHUD();
  requestAnimationFrame(frame);
}

function boot() {
  gameCanvas = document.getElementById('game');
  hudCanvas = document.getElementById('hud');
  gameCanvas.width = VIEW_W; gameCanvas.height = VIEW_H;
  gctx = gameCanvas.getContext('2d');
  hctx = hudCanvas.getContext('2d');
  gctx.imageSmoothingEnabled = false;
  Sound.init();
  Input.init();
  addEventListener('resize', resize);
  resize();
  startDemo();
  lastT = performance.now();
  requestAnimationFrame(frame);
}
addEventListener('load', boot);
