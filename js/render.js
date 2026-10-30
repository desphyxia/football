'use strict';
// =====================================================================
//  Rendering: pre-rendered stadium + depth-sorted pixel-art sprites
// =====================================================================
const R = { ox: 0, oy: 0 };
let PITCH_IMG = null;
const BOARDS = [
  ['PIXEL COLA', '#d32f2f', '#ffffff'], ['SUPER FOOTY', '#1565c0', '#ffffff'], ['RETRO FM', '#fdd835', '#222222'],
  ['BYTE BANK', '#2e7d32', '#ffffff'], ['16-BIT', '#6a1b9a', '#ffffff'], ['CHIPTUNE', '#ef6c00', '#ffffff'],
  ['KICK OFF', '#111111', '#ffeb3b'], ['TURBO', '#ffffff', '#c62828'],
];

function V(x, y, z) { return [Math.round(projX(x, y) + R.ox), Math.round(projY(x, y, z) + R.oy)]; }

function prerenderPitch(m) {
  const hl = m.hl, hw = m.hw;
  const X0 = -hl - 20, X1 = hl + 16, Y0 = -hw - 24, Y1 = hw + 10, ZT = 12;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const x of [X0, X1]) for (const y of [Y0, Y1]) for (const z of [0, ZT]) {
    const a = projX(x, y), b = projY(x, y, z);
    minX = Math.min(minX, a); maxX = Math.max(maxX, a); minY = Math.min(minY, b); maxY = Math.max(maxY, b);
  }
  minX = Math.floor(minX); minY = Math.floor(minY);
  const c = document.createElement('canvas');
  c.width = Math.ceil(maxX - minX) + 2; c.height = Math.ceil(maxY - minY) + 2;
  const g = c.getContext('2d');
  const P = (x, y, z) => [projX(x, y) - minX, projY(x, y, z || 0) - minY];
  const poly = (pts, fill) => {
    g.beginPath();
    pts.forEach((q, i) => { const [a, b] = P(q[0], q[1], q[2]); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  const line = (pts, close) => {
    g.beginPath();
    pts.forEach((q, i) => { const [a, b] = P(q[0], q[1], q[2]); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
    if (close) g.closePath();
    g.stroke();
  };
  const arc = (cx, cy, r, a0, a1, n) => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    line(pts);
  };

  g.fillStyle = '#0b1610'; g.fillRect(0, 0, c.width, c.height);
  // ground around the pitch
  poly([[-hl - 8, -hw - 5], [hl + 14, -hw - 5], [hl + 14, Y1], [-hl - 8, Y1]], '#2a6326');
  // mowing stripes
  const n = 16, sx0 = -hl - 4, sw = (m.L + 8) / n;
  for (let i = 0; i < n; i++) {
    poly([[sx0 + i * sw, -hw - 4], [sx0 + (i + 1) * sw, -hw - 4], [sx0 + (i + 1) * sw, hw + 4], [sx0 + i * sw, hw + 4]], i % 2 ? '#3b8a32' : '#45983a');
  }
  // grass grain
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 1] > 70 && d[i + 1] > d[i] + 30) { const k = (Math.random() * 12 - 6) | 0; d[i] += k; d[i + 1] += k; d[i + 2] += k; }
  }
  g.putImageData(id, 0, 0);

  // pitch markings
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.1;
  line([[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]], true);
  line([[0, -hw], [0, hw]]);
  arc(0, 0, m.circ, 0, Math.PI * 2, 48);
  g.fillStyle = '#fff';
  const dot = (x, y) => { const [a, b] = P(x, y); g.fillRect(Math.round(a) - 1, Math.round(b) - 1, 2, 2); };
  dot(0, 0);
  for (const e of [-1, 1]) {
    const gx = e * hl;
    line([[gx, -m.boxW / 2], [gx - e * m.boxD, -m.boxW / 2], [gx - e * m.boxD, m.boxW / 2], [gx, m.boxW / 2]]);
    line([[gx, -m.sixW / 2], [gx - e * m.sixD, -m.sixW / 2], [gx - e * m.sixD, m.sixW / 2], [gx, m.sixW / 2]]);
    const px = gx - e * m.pen;
    dot(px, 0);
    const da = Math.acos(clamp((m.boxD - m.pen) / m.circ, -1, 1));
    if (e > 0) arc(px, 0, m.circ, Math.PI - da, Math.PI + da, 16); else arc(px, 0, m.circ, -da, da, 16);
    for (const s of [-1, 1]) arc(gx, s * hw, 1, e > 0 ? Math.PI : 0, e > 0 ? (s > 0 ? Math.PI * 1.5 : Math.PI * 0.5) : (s > 0 ? -Math.PI * 0.5 : Math.PI * 0.5), 6);
  }

  // stands (far side and left end), drawn back to front
  const standRows = 14;
  for (let r = standRows - 1; r >= 0; r--) {
    const off = 6 + r * 0.9, z = r * 0.55;
    const y = -hw - off;
    poly([[-hl - 14, y, z], [hl + 14, y, z], [hl + 14, y - 0.9, z], [-hl - 14, y - 0.9, z]], r % 2 ? '#4a4f5a' : '#565c68');
    poly([[-hl - 14, y - 0.9, z], [hl + 14, y - 0.9, z], [hl + 14, y - 0.9, z + 0.55], [-hl - 14, y - 0.9, z + 0.55]], '#353943');
    for (let x = -hl - 13; x < hl + 13; x += 0.42) {
      if (Math.random() < 0.15) continue;
      const [a, b] = P(x + rand(-0.1, 0.1), y - 0.45, z + 0.05);
      g.fillStyle = pick(CROWD_COLS); g.fillRect(a | 0, (b | 0) - 3, 2, 3);
      g.fillStyle = pick(SKINS); g.fillRect(a | 0, (b | 0) - 5, 2, 2);
    }
  }
  for (let r = standRows - 1; r >= 0; r--) {
    const off = 8 + r * 0.9, z = r * 0.55, x = -hl - off;
    poly([[x, -hw - 6, z], [x, hw + 8, z], [x - 0.9, hw + 8, z], [x - 0.9, -hw - 6, z]], r % 2 ? '#4a4f5a' : '#565c68');
    poly([[x - 0.9, -hw - 6, z], [x - 0.9, hw + 8, z], [x - 0.9, hw + 8, z + 0.55], [x - 0.9, -hw - 6, z + 0.55]], '#353943');
    for (let y = -hw - 5; y < hw + 7; y += 0.42) {
      if (Math.random() < 0.15) continue;
      const [a, b] = P(x - 0.45, y + rand(-0.1, 0.1), z + 0.05);
      g.fillStyle = pick(CROWD_COLS); g.fillRect(a | 0, (b | 0) - 3, 2, 3);
      g.fillStyle = pick(SKINS); g.fillRect(a | 0, (b | 0) - 5, 2, 2);
    }
  }

  // advertising boards
  const board = (x0, y0, x1, y1, bi, withText) => {
    const [txt, bg, fg] = BOARDS[bi % BOARDS.length];
    poly([[x0, y0, 0], [x1, y1, 0], [x1, y1, 0.9], [x0, y0, 0.9]], bg);
    if (withText) {
      const [ox, oy] = P(x0, y0, 0);
      g.save();
      g.setTransform((IC * SCALE) / 10, (IS * ISO_Q * SCALE) / 10, 0, SCALE / 10, ox, oy);
      g.fillStyle = fg; g.font = 'bold 7px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt, ((x1 - x0) * 10) / 2, -4.5, (x1 - x0) * 10 - 4);
      g.restore();
    }
  };
  let bi = 0;
  for (let x = -hl - 2; x < hl + 2; x += 8) board(x, -hw - 3, Math.min(x + 8, hl + 2), -hw - 3, bi++, true);
  for (let y = -hw; y < hw; y += 8) board(-hl - 6, y, -hl - 6, Math.min(y + 8, hw), bi++, false);
  drawNet(g, P, m, -1);
  for (let x = -hl - 2; x < hl + 2; x += 8) board(x, hw + 3, Math.min(x + 8, hl + 2), hw + 3, bi++, true);
  // corner flags
  for (const e of [-1, 1]) for (const s of [-1, 1]) {
    const [a, b] = P(e * hl, s * hw, 0), [, b2] = P(e * hl, s * hw, 1.6);
    g.fillStyle = '#eee'; g.fillRect(Math.round(a), Math.round(b2), 1, Math.round(b - b2));
    g.fillStyle = '#ff3b30'; g.fillRect(Math.round(a) + 1, Math.round(b2), 4, 3);
  }
  PITCH_IMG = { canvas: c, minX, minY };
}

function drawNet(g, P, m, e) {
  const gx = e * m.hl, bx = gx + e * 2.0, gw = m.gw, gh = m.gh, bh = gh * 0.75;
  const face = (pts) => {
    g.beginPath();
    pts.forEach((q, i) => { const [a, b] = P(q[0], q[1], q[2]); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
    g.closePath(); g.fill();
  };
  const seg = (a, b) => { const [x1, y1] = P(a[0], a[1], a[2]), [x2, y2] = P(b[0], b[1], b[2]); g.moveTo(x1, y1); g.lineTo(x2, y2); };
  g.fillStyle = 'rgba(255,255,255,0.10)';
  face([[bx, -gw, 0], [bx, gw, 0], [bx, gw, bh], [bx, -gw, bh]]);
  face([[gx, -gw, gh], [gx, gw, gh], [bx, gw, bh], [bx, -gw, bh]]);
  for (const s of [-1, 1]) face([[gx, s * gw, 0], [bx, s * gw, 0], [bx, s * gw, bh], [gx, s * gw, gh]]);
  g.strokeStyle = 'rgba(255,255,255,0.38)'; g.lineWidth = 1;
  g.beginPath();
  for (let y = -gw; y <= gw + 0.01; y += 0.5) { seg([gx, y, gh], [bx, y, bh]); seg([bx, y, bh], [bx, y, 0]); }
  for (let z = 0; z <= bh + 0.01; z += 0.5) seg([bx, -gw, z], [bx, gw, z]);
  for (let k = 0; k <= 4; k++) {
    const x = gx + (bx - gx) * (k / 4), zt = gh + (bh - gh) * (k / 4);
    seg([x, -gw, 0], [x, -gw, zt]); seg([x, gw, 0], [x, gw, zt]); seg([x, -gw, zt], [x, gw, zt]);
  }
  for (const s of [-1, 1]) for (let z = 0.5; z < gh; z += 0.5) seg([gx, s * gw, Math.min(z, gh)], [bx, s * gw, Math.min(z, bh)]);
  g.stroke();
}

// ---------- sprites ----------
// Pixel figure ~20px tall. (x, y) = feet position on screen.
function drawFigure(g, x, y, kit, o) {
  const px = (c, a, b, w, h) => { g.fillStyle = c; g.fillRect(a, b, w, h); };
  const st = o.state;
  if (st === 'slide' || st === 'down' || st === 'dive') { drawLying(g, x, y, kit, o); return; }
  if (st === 'getup') y += 2;
  if (st === 'stumble') x += o.side;
  const s = Math.sin(o.ph), moving = o.moving;
  let l1 = 0, l2 = 0, lift1 = 0, lift2 = 0;
  if (moving) {
    if (o.view === 'side') { l1 = Math.round(s * 2); l2 = -l1; }
    else { lift1 = s > 0 ? Math.round(s * 2) : 0; lift2 = s < 0 ? Math.round(-s * 2) : 0; }
  }
  const leg = (a, b) => { px('#111', a, b - 1, 2, 1); px(kit.socks, a, b - 4, 2, 3); px(o.skin, a, b - 6, 2, 2); };
  if (st === 'kick' || st === 'tackle') {
    leg(x - 1 - o.side, y);
    px(kit.socks, o.side > 0 ? x + 1 : x - 6, y - 4, 5, 2);
    px('#111', o.side > 0 ? x + 6 : x - 7, y - 4, 1, 2);
  } else { leg(x - 3 + l1, y - lift1); leg(x + 1 + l2, y - lift2); }
  px(kit.shorts, x - 3, y - 9, 6, 3);
  px(kit.shirt, x - 3, y - 15, 6, 6);
  if (kit.stripe) { px(kit.stripe, x - 2, y - 15, 1, 6); px(kit.stripe, x, y - 15, 1, 6); px(kit.stripe, x + 2, y - 15, 1, 6); }
  px(kit.trim, x - 1, y - 15, 2, 1);
  if (st === 'celebrate' || o.armsUp) {
    px(kit.shirt, x - 4, y - 18, 1, 4); px(kit.shirt, x + 3, y - 18, 1, 4);
    px(o.skin, x - 4, y - 20, 1, 2); px(o.skin, x + 3, y - 20, 1, 2);
  } else {
    const as = moving ? Math.round(s * 1.5) : 0;
    px(kit.shirt, x - 4, y - 15 + as, 1, 3); px(o.skin, x - 4, y - 12 + as, 1, 2);
    px(kit.shirt, x + 3, y - 15 - as, 1, 3); px(o.skin, x + 3, y - 12 - as, 1, 2);
  }
  px(o.skin, x - 2, y - 19, 4, 4);
  if (o.view === 'back') px(o.hair, x - 2, y - 20, 4, 4);
  else if (o.view === 'front') { px(o.hair, x - 2, y - 20, 4, 2); px('#222', x - 1, y - 17, 1, 1); px('#222', x, y - 17, 1, 1); }
  else { px(o.hair, x - 2, y - 20, 4, 2); px(o.hair, o.side > 0 ? x - 2 : x + 1, y - 18, 1, 2); px('#222', o.side > 0 ? x + 1 : x - 2, y - 17, 1, 1); }
}

function drawLying(g, x, y, kit, o) {
  const px = (c, a, b, w, h) => { g.fillStyle = c; g.fillRect(a, b, w, h); };
  const dive = o.state === 'dive';
  const d = dive ? o.side : -o.side; // direction the head points
  // segments from feet to head along screen x
  const segs = [['#111', 1, 2], [kit.socks, 3, 2], [o.skin, 2, 2], [kit.shorts, 3, 3], [kit.shirt, 6, 4], [o.skin, 4, 4]];
  let pos = -9;
  for (const [col, len, h] of segs) {
    const a = d > 0 ? x + pos : x - pos - len;
    px(col, a, y - h, len, h);
    pos += len;
  }
  const headX = d > 0 ? x + pos - 4 : x - pos;
  px(o.hair, headX, y - 4, 4, 1);
  if (dive) { px(o.skin, d > 0 ? x + pos : x - pos - 2, y - 3, 2, 1); }
}

function drawPlayer(g, p, m) {
  const [x, y] = V(p.x, p.y, p.z || 0);
  if (x < -30 || x > VIEW_W + 30 || y < -10 || y > VIEW_H + 40) return;
  const kit = p.isGK ? p.team.gkKit : p.team.kit;
  const [fx, fy] = worldToScreenDir(Math.cos(p.face), Math.sin(p.face));
  let side = fx >= 0 ? 1 : -1;
  if (p.state === 'dive') { const [dx] = worldToScreenDir(0, p.diveDir || 1); side = dx >= 0 ? 1 : -1; }
  const r = m.restart;
  const armsUp = (r && r.ready && r.type === 'throwin' && r.taker === p) || (m.ball.owner === p && m.ball.held);
  drawFigure(g, x, y, kit, {
    side, view: fy > 0.45 ? 'front' : fy < -0.45 ? 'back' : 'side', ph: p.anim,
    moving: Math.hypot(p.vx, p.vy) > 0.5, state: p.state, skin: p.skin, hair: p.hair, armsUp,
  });
}

function drawBall(g, b) {
  const [x, y] = V(b.x, b.y, b.z);
  g.fillStyle = '#ffffff';
  g.fillRect(x - 1, y - 4, 3, 1); g.fillRect(x - 2, y - 3, 5, 2); g.fillRect(x - 1, y - 1, 3, 1);
  const spots = [[-1, -3], [0, -2], [1, -3], [0, -3]];
  const s = spots[Math.floor(b.roll) & 3];
  g.fillStyle = '#333'; g.fillRect(x + s[0], y + s[1], 1, 1);
}

function drawPost(g, m, e, s) {
  const gx = e * m.hl, y = s * m.gw;
  const [a, b] = V(gx, y, 0), [, b2] = V(gx, y, m.gh);
  g.fillStyle = '#f4f4f4'; g.fillRect(a - 1, b2, 2, b - b2);
}
function drawBar(g, m, e) {
  const gx = e * m.hl;
  const [a1, b1] = V(gx, -m.gw, m.gh), [a2, b2] = V(gx, m.gw, m.gh);
  g.strokeStyle = '#f4f4f4'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(a1, b1 + 0.5); g.lineTo(a2, b2 + 0.5); g.stroke();
}

function renderMatch(g, m) {
  const cx = projX(m.cam.x, m.cam.y), cy = projY(m.cam.x, m.cam.y, 0);
  R.ox = Math.round(VIEW_W / 2 - cx); R.oy = Math.round(VIEW_H / 2 - cy);
  g.fillStyle = '#0b1610'; g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.drawImage(PITCH_IMG.canvas, R.ox + PITCH_IMG.minX, R.oy + PITCH_IMG.minY);

  // shadows
  g.fillStyle = 'rgba(0,0,0,0.3)';
  for (const p of m.players) {
    const [a, b] = V(p.x, p.y, 0);
    if (p.state === 'slide' || p.state === 'down' || p.state === 'dive') g.fillRect(a - 9, b - 2, 18, 3);
    else { g.fillRect(a - 4, b - 1, 8, 2); g.fillRect(a - 3, b - 2, 6, 1); }
  }
  const b = m.ball;
  { const [a, c] = V(b.x, b.y, 0); g.fillRect(a - 2, c - 1, 4, 2); }

  const list = [];
  for (const p of m.players) list.push([projY(p.x, p.y, 0), 0, p]);
  list.push([projY(b.x, b.y, 0) + 0.5, 1, b]);
  for (const e of [-1, 1]) {
    for (const s of [-1, 1]) list.push([projY(e * m.hl, s * m.gw, 0), 2, e, s]);
    list.push([projY(e * m.hl, 0, 0), 3, e]);
  }
  list.sort((u, v) => u[0] - v[0]);
  for (const it of list) {
    if (it[1] === 0) drawPlayer(g, it[2], m);
    else if (it[1] === 1) drawBall(g, it[2]);
    else if (it[1] === 2) drawPost(g, m, it[2], it[3]);
    else drawBar(g, m, it[2]);
  }
  // the goal nearest the camera is drawn over the players
  drawNet(g, (x, y, z) => [projX(x, y) + R.ox, projY(x, y, z || 0) + R.oy], m, 1);

  // set-piece aim
  const r = m.restart;
  if (m.phase === 'restart' && r && r.ready && r.type !== 'penalty' && !m.demo) {
    const tk = r.taker, fx = Math.cos(tk.face), fy = Math.sin(tk.face);
    for (let i = 1; i <= 7; i++) {
      const [a, c] = V(b.x + fx * i * 1.0, b.y + fy * i * 1.0, 0);
      g.fillStyle = i % 2 ? '#ffee58' : '#ffffff';
      g.fillRect(a - 1, c - 1, 2, 2);
    }
  }
}

// Kit preview sprite for menus
function kitPreview(kit, scale) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 24;
  const g = c.getContext('2d');
  drawFigure(g, 8, 22, kit, { side: 1, view: 'front', ph: 0, moving: false, state: 'normal', skin: '#e0ac69', hair: '#2b1b0e' });
  return c;
}
