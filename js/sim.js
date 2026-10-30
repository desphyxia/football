'use strict';
// =====================================================================
//  Match simulation: players, ball physics, rules, team AI, goalkeepers
// =====================================================================
const DT = 1 / 60, GRAV = 9.81, BALL_R = 0.11;
const RUN = 7.0, SPRINT = 9.0, ACCEL = 30;
const ROLL_DEC = 1.8, ROLL_K = 0.28, AIR_K = 0.06;
const REP_N = 300; // replay frames (5 s)

const FORMATIONS = {
  11: [['GK', 0.02, 0], ['DEF', 0.2, -0.66], ['DEF', 0.16, -0.22], ['DEF', 0.16, 0.22], ['DEF', 0.2, 0.66],
       ['MID', 0.42, -0.72], ['MID', 0.37, -0.22], ['MID', 0.37, 0.22], ['MID', 0.42, 0.72],
       ['FWD', 0.6, -0.22], ['FWD', 0.62, 0.22]],
  7: [['GK', 0.02, 0], ['DEF', 0.2, -0.42], ['DEF', 0.2, 0.42], ['MID', 0.42, -0.66], ['MID', 0.38, 0], ['MID', 0.42, 0.66], ['FWD', 0.62, 0]],
  5: [['GK', 0.03, 0], ['DEF', 0.25, -0.4], ['DEF', 0.25, 0.4], ['FWD', 0.55, -0.32], ['FWD', 0.58, 0.32]],
};
const PITCH = {
  11: { L: 100, W: 64, boxD: 16.5, boxW: 40.3, sixD: 5.5, sixW: 18.3, pen: 11, circ: 9.15, gw: 3.66, gh: 2.44 },
  7: { L: 72, W: 46, boxD: 12, boxW: 28, sixD: 4, sixW: 12, pen: 9, circ: 7, gw: 3.66, gh: 2.44 },
  5: { L: 52, W: 34, boxD: 8, boxW: 18, sixD: 3, sixW: 9, pen: 7, circ: 5, gw: 2.6, gh: 2.1 },
};
const STATES = ['normal', 'kick', 'slide', 'tackle', 'down', 'getup', 'stumble', 'dive', 'celebrate'];
const RESTART_LABEL = { kickoff: 'KICK OFF', throwin: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK', freekick: 'FREE KICK', penalty: 'PENALTY!' };

let M = null; // the current match

// ---------- helpers ----------
function dirOf(t) { return (t.idx === 0 ? 1 : -1) * (M.half === 1 ? 1 : -1); } // attacking direction (+1 = towards +x)
function opp(t) { return M.teams[1 - t.idx]; }
function ownGoalX(t) { return -dirOf(t) * M.hl; }
function inBox(t, x, y) { // inside t's own penalty area
  const d = (x - ownGoalX(t)) * dirOf(t);
  return d > -2 && d <= M.boxD && Math.abs(y) <= M.boxW / 2;
}
function showBanner(text, t, sub, big) { M.banner = { text, t, t0: t, sub, big }; }
function rumbleTeam(t, s, w, ms) { if (t.ctl && t.ctl !== 'cpu') t.ctl.rumble(s, w, ms); }

function chooseKits(d0, d1) {
  let k0 = d0.home, k1 = d1.home;
  if (colorDist(k0.shirt, k1.shirt) < 130) {
    k1 = d1.away;
    if (colorDist(k0.shirt, k1.shirt) < 130) k0 = d0.away;
  }
  const used = [k0.shirt, k1.shirt];
  const score = (c) => Math.min(...used.map((u) => colorDist(c, u)));
  const gks = GK_COLORS.slice().sort((a, b) => score(b) - score(a));
  const gk = (c) => ({ shirt: c, shorts: '#1a1a1a', socks: c, trim: '#1a1a1a' });
  return [k0, k1, gk(gks[0]), gk(gks[1])];
}

function newBall() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: null, held: false, last: null, kickT: 0, kickId: 0, pass: null, roll: 0 };
}

function makePlayer(team, i, role, u, v) {
  return {
    team, i, num: i + 1, role, isGK: role === 'GK', home: { u, v },
    x: 0, y: 0, z: 0, vx: 0, vy: 0, face: 0, wx: 0, wy: 0, sprint: false,
    state: 'normal', stateT: 0, anim: Math.random() * 6, kickCD: 0, tackleCD: 0, stamina: 1,
    spd: 0.94 + team.data.spd * 0.015 + rand(-0.02, 0.02),
    skin: pick(SKINS), hair: pick(HAIRS), buf: null,
    tryId: -1, headId: -1, saveId: -1, diveDir: 0, diveZ: 0, holdT: 0, reactT: 0, seenKick: -1, slideWon: false,
  };
}

// ---------- match creation ----------
function createMatch(cfg) {
  const P = PITCH[cfg.size];
  const m = {
    cfg, ...P, hl: P.L / 2, hw: P.W / 2, teams: [], players: [], half: 1, clock: 0, halfLen: cfg.halfLen,
    phase: 'restart', phaseT: 0, score: [0, 0], restart: null, banner: null, cam: { x: 0, y: 0 },
    stats: { poss: [0, 0], shots: [0, 0] }, ball: newBall(), demo: !!cfg.demo,
    kickoffFirst: Math.random() < 0.5 ? 0 : 1, time: 0, skip: false,
    path: Array.from({ length: 31 }, () => ({ x: 0, y: 0, z: 0 })),
    goalTeam: null, scorer: null, crowd: 0.12, crowdTick: 0, ownGoal: false,
  };
  M = m;
  const d = [TEAMS[cfg.teams[0]], TEAMS[cfg.teams[1]]];
  const kits = chooseKits(d[0], d[1]);
  for (let ti = 0; ti < 2; ti++) {
    const ctl = cfg.ctl[ti];
    const t = {
      idx: ti, data: d[ti], kit: kits[ti], gkKit: kits[2 + ti], players: [], ctl,
      cpu: ctl === 'cpu' ? newCpu() : null, controlled: null, charging: false, charge: 0,
      swcd: 0, idleT: 0, chaser: null,
    };
    FORMATIONS[cfg.size].forEach(([role, u, v], i) => {
      const p = makePlayer(t, i, role, u, v);
      t.players.push(p); m.players.push(p);
    });
    t.controlled = t.players[t.players.length - 1];
    m.teams.push(t);
  }
  m.rep = {
    frames: Array.from({ length: REP_N }, () => ({ b: new Float32Array(3), p: new Float32Array(m.players.length * 9) })),
    head: 0, count: 0, pos: 0,
  };
  prerenderPitch(m);
  setupKickoff(m.kickoffFirst);
  return m;
}

// ---------- formation positioning ----------
function possOf(t) {
  const b = M.ball;
  if (b.owner) return b.owner.team === t ? 1 : -1;
  if (b.pass) return b.pass.team === t ? 1 : -1;
  if (b.last) return b.last.team === t ? 0.4 : -0.4;
  return 0;
}
function formationTarget(p, bp, poss) {
  const t = p.team, dir = dirOf(t);
  const bu = clamp((bp.x * dir) / M.L + 0.5, 0, 1), bv = clamp((bp.y / M.hw) * dir, -1, 1);
  let u = p.home.u, v = p.home.v;
  if (p.isGK) {
    u = clamp(0.02 + (bu - 0.5) * 0.06, 0.01, 0.06);
    v = bv * 0.05;
  } else {
    u += (bu - 0.45) * 0.6 + poss * 0.08;
    if (p.role === 'FWD' && poss > 0) u += 0.06;
    if (p.role === 'DEF' && poss < 0) u = Math.min(u, bu - 0.04);
    if (p.role === 'FWD' && poss < 0) u = Math.max(u, 0.38);
    u = clamp(u, 0.05, 0.92);
    v = clamp(v * 0.85 + bv * 0.28, -0.95, 0.95);
  }
  return { x: dir * (u - 0.5) * M.L, y: v * M.hw * dir };
}

function moveTo(p, x, y, s, sprint) {
  const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
  if (d < 0.25) { p.wx = 0; p.wy = 0; p.sprint = false; return; }
  const k = d < 1.5 ? s * Math.max(0.25, d / 1.5) : s;
  p.wx = (dx / d) * k; p.wy = (dy / d) * k; p.sprint = !!sprint;
}

// ---------- ball prediction ----------
function stepBall(s, h) {
  if (s.z > 0 || s.vz > 0) { s.vz -= GRAV * h; const k = 1 - AIR_K * h; s.vx *= k; s.vy *= k; }
  s.x += s.vx * h; s.y += s.vy * h; s.z += s.vz * h;
  let bounced = 0;
  if (s.z < 0) {
    s.z = 0;
    if (s.vz < -1.5) { bounced = -s.vz; s.vz = -s.vz * 0.5; s.vx *= 0.88; s.vy *= 0.88; } else s.vz = 0;
  }
  if (s.z === 0 && s.vz === 0) {
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > 0) { const ns = Math.max(0, sp - (ROLL_DEC + ROLL_K * sp) * h); s.vx *= ns / sp; s.vy *= ns / sp; }
  }
  return bounced;
}
const _sim = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
function computeBallPath() {
  const b = M.ball, P = M.path;
  if (b.owner) {
    const o = b.owner;
    for (let k = 0; k <= 30; k++) { const t = k * 0.1; P[k].x = b.x + o.vx * t * 0.7; P[k].y = b.y + o.vy * t * 0.7; P[k].z = 0; }
    return;
  }
  Object.assign(_sim, { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz });
  for (let k = 0; k <= 30; k++) {
    P[k].x = _sim.x; P[k].y = _sim.y; P[k].z = _sim.z;
    stepBall(_sim, 0.05); stepBall(_sim, 0.05);
  }
}
function interceptPoint(p) {
  const P = M.path, sp = SPRINT * p.spd * 0.9, zmax = p.isGK ? 2.3 : 1.6;
  for (let k = 0; k <= 30; k++) {
    const q = P[k];
    if (q.z > zmax) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y) - 0.6;
    if (d <= sp * k * 0.1 + 0.15) return { x: q.x, y: q.y, t: k * 0.1 };
  }
  const q = P[30];
  return { x: q.x, y: q.y, t: 3 + Math.hypot(q.x - p.x, q.y - p.y) / sp };
}

// ---------- kicking ----------
function groundDist(v0, vend) {
  const a = ROLL_DEC, k = ROLL_K;
  if (v0 <= vend) return 0;
  const te = Math.log((v0 + a / k) / (vend + a / k)) / k;
  return (v0 - vend) / k - (a / k) * te;
}
function groundSpeedFor(d, vend) {
  let lo = vend, hi = 45;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (groundDist(mid, vend) < d) lo = mid; else hi = mid; }
  return hi;
}

function kick(p, vx, vy, vz) {
  const b = M.ball;
  b.owner = null; b.held = false;
  b.vx = vx; b.vy = vy; b.vz = vz;
  b.last = p; b.kickT = 0; b.kickId++; b.pass = null;
  p.kickCD = 0.3;
  if (p.state === 'normal') { p.state = 'kick'; p.stateT = 0.2; }
  if (Math.hypot(vx, vy) > 0.5) p.face = Math.atan2(vy, vx);
  p.team.charging = false;
  Sound.kick(Math.min(1, Math.hypot(vx, vy, vz) / 30));
  if (p === p.team.controlled) rumbleTeam(p.team, 0.2, 0.45, 60);
}

function bestMateInDir(p, dx, dy, cone, kind) {
  const t = p.team;
  let best = null, bs = 1e9;
  for (const m of t.players) {
    if (m === p) continue;
    const vx = m.x - p.x, vy = m.y - p.y, d = Math.hypot(vx, vy);
    if (d < 2.5) continue;
    const a = Math.acos(clamp((vx * dx + vy * dy) / d, -1, 1));
    if (a > cone) continue;
    if (m.isGK && kind !== 'ground') continue;
    let s = d * (1 + a * 2.0);
    if (kind === 'lob' && d < 12) s += 15;
    if (kind === 'ground' && d > 35) s += 20;
    for (const o of opp(t).players) if (Math.hypot(o.x - m.x, o.y - m.y) < 3) s += 4;
    if (s < bs) { bs = s; best = m; }
  }
  return best;
}

function doPass(p, dx, dy, kind) {
  const b = M.ball, t = p.team, dir = dirOf(t);
  [dx, dy] = norm(dx, dy);
  if (!dx && !dy) { dx = Math.cos(p.face); dy = Math.sin(p.face); }
  const lofted = kind === 'lob' || kind === 'throw' || kind === 'throwlong';
  const cone = kind === 'through' ? 0.9 : lofted ? 0.6 : 0.75;
  const best = bestMateInDir(p, dx, dy, cone, kind === 'throw' || kind === 'throwlong' ? 'ground' : kind);
  let tx, ty;
  if (best) {
    if (kind === 'through') {
      const [fx, fy] = norm(dir + dx * 0.6, dy * 0.6);
      const ahead = clamp(Math.hypot(best.x - p.x, best.y - p.y) * 0.25, 5, 10);
      tx = best.x + fx * ahead; ty = best.y + fy * ahead;
    } else {
      const est = Math.hypot(best.x - b.x, best.y - b.y) / 15;
      tx = best.x + best.vx * Math.min(est, 0.8); ty = best.y + best.vy * Math.min(est, 0.8);
    }
  } else {
    const D = { ground: 14, through: 20, throw: 10, throwlong: 18, lob: 28 }[kind];
    tx = b.x + dx * D; ty = b.y + dy * D;
  }
  tx = clamp(tx, -M.hl + 1, M.hl - 1); ty = clamp(ty, -M.hw + 1, M.hw - 1);
  let ex = tx - b.x, ey = ty - b.y;
  const d = Math.hypot(ex, ey) || 1; ex /= d; ey /= d;
  const err = randn() * (lofted ? 0.05 : 0.03);
  const ce = Math.cos(err), se = Math.sin(err);
  [ex, ey] = [ex * ce - ey * se, ex * se + ey * ce];
  let vx, vy, vz;
  if (!lofted) {
    const v0 = clamp(groundSpeedFor(d, kind === 'through' ? 2.5 : 6.5), 7, 26);
    vx = ex * v0; vy = ey * v0; vz = 0.3;
  } else {
    const T = kind === 'throw' ? clamp(0.4 + d * 0.04, 0.5, 1.0) : clamp(0.55 + d * 0.03, 0.8, 2.0);
    const hs = (d / T) * 1.04;
    vx = ex * hs; vy = ey * hs; vz = (-b.z + 0.5 * GRAV * T * T) / T;
  }
  kick(p, vx, vy, vz);
  if (best) {
    b.pass = { target: best, team: t };
    if (t.ctl) { t.controlled = best; t.swcd = 0.3; t.idleT = 0; }
  }
}

function doShoot(p, dx, dy, power, hasDir) {
  const t = p.team, dir = dirOf(t), b = M.ball, gx = dir * M.hl;
  const [tgx, tgy] = norm(gx - b.x, -b.y);
  let lat;
  if (hasDir) {
    const [sx, sy] = norm(dx, dy);
    lat = clamp((tgx * sy - tgy * sx) * 1.6, -1, 1);
  } else lat = randSign() * rand(0.35, 0.9);
  let aimY = lat * (M.gw - 0.35) * dir;
  const dist = Math.hypot(gx - b.x, b.y);
  const skill = t.data.att;
  const spread = (0.45 + power * power * 1.4 + dist * 0.05) * (1.25 - skill * 0.07);
  aimY += randn() * spread;
  const v = (15 + power * 18) * (0.9 + skill * 0.03);
  const T = dist / (v * 0.93);
  const h = Math.max(0.1, 0.2 + power * 1.45 + Math.random() * power * 0.9 + randn() * 0.2);
  const [ex, ey] = norm(gx - b.x, aimY - b.y);
  const vz = clamp((h - b.z + 0.5 * GRAV * T * T) / T, b.z > 0.5 ? -6 : 0, 14);
  kick(p, ex * v, ey * v, vz);
  M.stats.shots[t.idx]++;
}

function doBuffered(p, f) {
  if (f.k === 'X') doShoot(p, f.dx, f.dy, 0.55, f.has);
  else doPass(p, f.dx, f.dy, f.k === 'A' ? 'ground' : f.k === 'B' ? 'lob' : 'through');
}

// ---------- possession ----------
function takePossession(p) {
  const b = M.ball, t = p.team;
  b.owner = p; b.held = false; b.vz = 0; b.z = 0; b.pass = null; b.last = p; b.kickT = 0;
  if (t.ctl && t.controlled !== p) { t.controlled = p; t.charging = false; }
  if (p.buf && t.controlled === p) { const f = p.buf; p.buf = null; doBuffered(p, f); }
}
function gkCatch(p) {
  const b = M.ball, t = p.team;
  b.owner = p; b.held = true; b.pass = null; b.last = p; b.vx = b.vy = b.vz = 0;
  p.holdT = 0;
  if (t.ctl) { t.controlled = p; t.charging = false; }
  Sound.catchBall();
}
function parry(p) {
  const b = M.ball, dir = dirOf(p.team);
  if (Math.random() < 0.5) { // tipped round the post
    b.vx *= 0.35;
    b.vy = (Math.sign(b.y) || randSign()) * rand(6, 10);
  } else { // pushed away from goal
    b.vx = dir * (Math.abs(b.vx) * 0.25 + rand(4, 8));
    b.vy = (Math.sign(b.y) || randSign()) * rand(4, 8);
  }
  b.vz = rand(1.5, 4.5);
  b.last = p; b.kickT = 0; b.kickId++; b.pass = null;
  p.kickCD = 0.4;
  Sound.tackle(); Sound.ooh();
}

function updatePossession() {
  const b = M.ball;
  if (b.owner) return;
  let best = null, bd = 1e9;
  for (const p of M.players) {
    if (p.kickCD > 0) continue;
    if (p.state !== 'normal' && p.state !== 'kick' && p.state !== 'dive' && p.state !== 'tackle') continue;
    const gk = p.isGK && inBox(p.team, p.x, p.y);
    if (p.state === 'dive' && !gk) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    const reach = gk ? (p.state === 'dive' ? 1.9 : 1.3) : 0.85;
    const maxZ = gk ? 2.55 : 1.4;
    if (d < reach && b.z < maxZ && d < bd) { best = p; bd = d; }
  }
  if (!best) { checkHeaders(); return; }
  const p = best, sp = Math.hypot(b.vx, b.vy, b.vz * 0.6);
  const fromOpp = b.last && b.last.team !== p.team;
  if (p.isGK && inBox(p.team, p.x, p.y)) {
    if (sp > 11 && fromOpp) {
      if (p.saveId === b.kickId) return;
      p.saveId = b.kickId;
      const pTouch = clamp(1.32 - sp / 50 - bd * 0.15 + (p.team.data.def - 4) * 0.04, 0.35, 0.95);
      if (Math.random() > pTouch) return; // beaten!
      if (Math.random() < clamp(1.35 - sp / 22, 0.12, 0.9)) gkCatch(p); else parry(p);
      return;
    }
    gkCatch(p);
    return;
  }
  if (fromOpp && sp > 16 && p.tryId !== b.kickId) {
    p.tryId = b.kickId;
    if (Math.random() < 0.45) { // miscontrol / deflection
      b.vx = b.vx * -0.25 + rand(-3, 3); b.vy = b.vy * -0.25 + rand(-3, 3); b.vz = rand(0, 3);
      b.last = p; b.kickT = 0; b.kickId++; p.kickCD = 0.25;
      Sound.kick(0.3);
      return;
    }
  }
  takePossession(p);
}

function checkHeaders() {
  const b = M.ball;
  if (b.z < 1.4 || b.z > 2.8 || b.kickT < 0.15) return;
  for (const p of M.players) {
    if (p.state !== 'normal' && p.state !== 'kick') continue;
    if (p.headId === b.kickId) continue;
    if (p.isGK && inBox(p.team, p.x, p.y)) continue;
    if (Math.hypot(b.x - p.x, b.y - p.y) > 0.9) continue;
    p.headId = b.kickId;
    const t = p.team;
    let act = null;
    if (t.controlled === p && t.ctl && p.buf) { act = p.buf; p.buf = null; }
    else if (Math.random() < 0.7) act = { k: 'auto' };
    if (!act) continue;
    header(p, act);
    return;
  }
}
function header(p, act) {
  const b = M.ball, t = p.team, dir = dirOf(t), gx = dir * M.hl;
  const dg = Math.hypot(gx - p.x, p.y);
  let k = act.k;
  if (k === 'auto') k = dg < 20 ? 'X' : 'A';
  if (k === 'X') {
    const aimY = clamp(randn() * M.gw * 0.7, -M.gw - 0.5, M.gw + 0.5);
    const [ex, ey] = norm(gx - b.x, aimY - b.y);
    const v = rand(12, 17), T = dg / v;
    const vz = clamp((rand(0.3, 2.4) - b.z + 0.5 * GRAV * T * T) / T, -3, 6);
    kick(p, ex * v, ey * v, vz);
    M.stats.shots[t.idx]++;
  } else {
    let dx = act.dx, dy = act.dy;
    if (!act.has) {
      if (p.x * dir < 0) [dx, dy] = norm(dir, -Math.sign(p.y || 1) * 0.6);
      else [dx, dy] = norm(dir, (-p.y / M.hw) * 0.5);
    }
    const v = rand(9, 14);
    kick(p, dx * v, dy * v, rand(2, 4));
    const m = bestMateInDir(p, dx, dy, 0.8, 'lob');
    if (m) { b.pass = { target: m, team: t }; if (t.ctl) t.controlled = m; }
  }
}

// ---------- tackling ----------
function standTackle(p) {
  if (p.state !== 'normal' || p.tackleCD > 0) return;
  p.state = 'tackle'; p.stateT = 0.3; p.tackleCD = 0.55;
  const fx = Math.cos(p.face), fy = Math.sin(p.face);
  p.vx += fx * 2.5; p.vy += fy * 2.5;
  const b = M.ball, c = b.owner;
  if (c && c.team !== p.team && !b.held) {
    const d = Math.hypot(c.x - p.x, c.y - p.y), db = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < 1.7 && db < 1.6) {
      const chance = clamp(0.5 + (p.team.data.def - c.team.data.att) * 0.06 + (db < 0.9 ? 0.15 : 0), 0.2, 0.85);
      if (Math.random() < chance) {
        c.state = 'stumble'; c.stateT = 0.45; c.kickCD = 0.4;
        b.owner = null; b.held = false;
        b.vx = fx * 4 + rand(-1.5, 1.5); b.vy = fy * 4 + rand(-1.5, 1.5); b.vz = 0.5;
        b.last = p; b.kickT = 0; b.kickId++; b.pass = null;
        Sound.tackle();
        rumbleTeam(c.team, 0.6, 0.4, 120); rumbleTeam(p.team, 0.3, 0.3, 80);
      } else if (Math.random() < 0.06 && M.phase === 'play') {
        c.state = 'down'; c.stateT = 0.9;
        foul(p, c);
      }
    }
  } else if (!c) {
    const db = Math.hypot(b.x - p.x, b.y - p.y);
    if (db < 1.3 && b.z < 0.8 && p.kickCD <= 0) kick(p, fx * 7, fy * 7, 0.5);
  }
}

function slideTackle(p, dx, dy) {
  if (p.state !== 'normal' || p.tackleCD > 0 || p.isGK) return;
  [dx, dy] = norm(dx, dy);
  if (!dx && !dy) { dx = Math.cos(p.face); dy = Math.sin(p.face); }
  p.state = 'slide'; p.stateT = 0.6; p.tackleCD = 1.0; p.slideWon = false;
  p.face = Math.atan2(dy, dx);
  const sp = Math.max(Math.hypot(p.vx, p.vy), 5) + 3;
  p.vx = dx * sp; p.vy = dy * sp;
  Sound.tackle();
}
function slideContact(p) {
  const b = M.ball, fx = Math.cos(p.face), fy = Math.sin(p.face);
  const ftx = p.x + fx * 0.7, fty = p.y + fy * 0.7;
  if (!p.slideWon && !b.held && b.z < 0.6 && Math.hypot(b.x - ftx, b.y - fty) < 0.9) {
    const c = b.owner;
    if (!c || c.team !== p.team) {
      if (c) { c.state = 'down'; c.stateT = 0.7; c.kickCD = 0.5; rumbleTeam(c.team, 0.7, 0.5, 150); }
      b.owner = null;
      const sp = Math.hypot(p.vx, p.vy);
      b.vx = fx * (sp * 0.8 + 3) + rand(-1.5, 1.5); b.vy = fy * (sp * 0.8 + 3) + rand(-1.5, 1.5); b.vz = rand(0, 1.2);
      b.last = p; b.kickT = 0; b.kickId++; b.pass = null;
      p.slideWon = true;
      Sound.tackle();
    }
  }
  for (const o of opp(p.team).players) {
    if (o.state === 'down' || o.state === 'getup' || o.state === 'dive') continue;
    if (Math.hypot(o.x - ftx, o.y - fty) < 0.8) {
      const hadBall = b.owner === o;
      o.state = 'down'; o.stateT = 1.0; o.vx *= 0.3; o.vy *= 0.3;
      if (!p.slideWon && (hadBall || Math.hypot(b.x - o.x, b.y - o.y) < 2.5) && M.phase === 'play') {
        if (hadBall) b.owner = null;
        foul(p, o);
        return;
      }
    }
  }
}

function foul(p, v) {
  if (M.phase !== 'play') return;
  const vt = v.team;
  M.ball.owner = null; M.ball.held = false;
  rumbleTeam(vt, 0.8, 0.6, 200);
  if (inBox(p.team, v.x, v.y)) beginRestart('penalty', vt.idx, dirOf(vt) * (M.hl - M.pen), 0, { takerP: v.isGK ? null : v });
  else beginRestart('freekick', vt.idx, clamp(v.x, -M.hl + 1, M.hl - 1), clamp(v.y, -M.hw + 1, M.hw - 1));
}

function switchPlayer(t, forced) {
  const b = M.ball, cur = t.controlled;
  let best = forced || null;
  if (!best) {
    let bs = 1e9;
    const gx = ownGoalX(t);
    for (const p of t.players) {
      if (p.isGK || p === cur) continue;
      if (p.state === 'down' || p.state === 'getup') continue;
      let s = Math.hypot(p.x + p.vx * 0.3 - b.x, p.y + p.vy * 0.3 - b.y);
      if (Math.abs(p.x - gx) < Math.abs(b.x - gx)) s -= 2.5; // prefer goal-side players
      if (s < bs) { bs = s; best = p; }
    }
  }
  if (best && best !== cur) {
    t.controlled = best; t.swcd = 0.25; t.charging = false; t.idleT = 0;
    if (cur) { cur.buf = null; }
  }
}

// ---------- human / CPU control of the active player ----------
function controlTeam(t, ctl, dt) {
  t.swcd -= dt;
  if (!ctl) return;
  const p = t.controlled, b = M.ball;
  const mag = Math.min(1, Math.hypot(ctl.mx, ctl.my));
  const hasDir = mag > 0.22;
  let wx = 0, wy = 0;
  if (hasDir) [wx, wy] = screenToWorldDir(ctl.mx, ctl.my);
  const smag = hasDir ? Math.min(1, 0.35 + (mag - 0.22) / 0.6) : 0;

  if (M.phase === 'restart') { restartControl(t, ctl, hasDir, wx, wy, dt); return; }
  if (M.phase !== 'play' || !p) return;

  const aimX = hasDir ? wx : Math.cos(p.face), aimY = hasDir ? wy : Math.sin(p.face);
  if (p.buf) { p.buf.t -= dt; if (p.buf.t <= 0) p.buf = null; }

  // --- carrying the ball ---
  if (b.owner === p) {
    p.wx = wx * smag; p.wy = wy * smag; p.sprint = !!ctl.held.SPRINT;
    t.idleT = 0;
    if (p.isGK && b.held) {
      p.holdT += dt;
      if (ctl.pressed.A) { doPass(p, aimX, aimY, 'ground'); return; }
      if (ctl.pressed.B || ctl.pressed.X || p.holdT > 6) { doPass(p, hasDir ? aimX : dirOf(t), hasDir ? aimY : 0, 'lob'); return; }
      if (ctl.pressed.Y) { doPass(p, aimX, aimY, 'through'); return; }
      return;
    }
    if (t.charging) {
      if (ctl.held.X) t.charge = Math.min(1, t.charge + dt / 0.85);
      if (!ctl.held.X || t.charge >= 1) { t.charging = false; doShoot(p, aimX, aimY, t.charge, hasDir); }
      return;
    }
    if (ctl.pressed.X) { t.charging = true; t.charge = 0.05; return; }
    if (ctl.pressed.A) { doPass(p, aimX, aimY, 'ground'); return; }
    if (ctl.pressed.B) { doPass(p, aimX, aimY, 'lob'); return; }
    if (ctl.pressed.Y) { doPass(p, aimX, aimY, 'through'); return; }
    return;
  }
  t.charging = false;

  // --- without the ball ---
  const teamHas = b.owner && b.owner.team === t;
  const oppHas = b.owner && b.owner.team !== t;
  const incoming = b.pass && b.pass.team === t;
  const near = Math.hypot(b.x - p.x, b.y - p.y);
  const assist = incoming && b.pass.target === p && (!hasDir || b.kickT < 0.4);
  if (hasDir && !assist) { p.wx = wx * smag; p.wy = wy * smag; t.idleT = 0; }
  else {
    t.idleT += dt;
    if (assist) { const ip = interceptPoint(p); moveTo(p, ip.x, ip.y, 1, true); }
    else if (!b.owner && near < 6) { const ip = interceptPoint(p); moveTo(p, ip.x, ip.y, 1, false); }
    else { p.wx = 0; p.wy = 0; }
  }
  if (hasDir && !assist) p.sprint = !!ctl.held.SPRINT;

  const buffer = (k) => { p.buf = { k, t: 0.35, dx: aimX, dy: aimY, has: hasDir }; };
  if (ctl.pressed.L1 && !teamHas) switchPlayer(t);
  if (ctl.pressed.A) {
    if (!teamHas && (oppHas || (near > 4 && !(incoming && b.pass.target === p)))) switchPlayer(t);
    else buffer('A');
  }
  if (ctl.pressed.B) {
    if (oppHas) standTackle(p);
    else if (!teamHas) { if (near < 3.5 || incoming) buffer('B'); else standTackle(p); }
  }
  if (ctl.pressed.X) {
    if (oppHas) slideTackle(p, aimX, aimY);
    else if (!teamHas) { if (near < 3.5 || incoming) buffer('X'); else slideTackle(p, aimX, aimY); }
  }
  if (ctl.pressed.Y && !teamHas) buffer('Y');

  // auto-switch to the closest man when the stick is idle
  if (!teamHas && !incoming && !hasDir && t.idleT > 0.35 && t.swcd <= 0) {
    let c = null, cd = 1e9;
    for (const q of t.players) {
      if (q.isGK) continue;
      const d = Math.hypot(q.x - b.x, q.y - b.y);
      if (d < cd) { cd = d; c = q; }
    }
    if (c && c !== p && cd + 5 < near) switchPlayer(t, c);
  }
}

function restartControl(t, ctl, hasDir, wx, wy, dt) {
  const r = M.restart;
  if (!r || !r.ready || r.team !== t.idx) return;
  const p = r.taker;
  if (hasDir && r.type !== 'penalty') {
    let [ax, ay] = [wx, wy];
    if (r.type === 'throwin') {
      const inY = -Math.sign(r.y);
      if (ay * inY < 0.25) { ay = 0.25 * inY; [ax, ay] = norm(ax, ay); }
    }
    p.face = Math.atan2(ay, ax);
  }
  const fx = Math.cos(p.face), fy = Math.sin(p.face);
  const canShoot = r.type === 'penalty' || r.type === 'freekick';
  if (canShoot) {
    if (ctl.pressed.X && !t.charging) { t.charging = true; t.charge = 0.05; }
    if (t.charging) {
      if (ctl.held.X) { t.charge = Math.min(1, t.charge + dt / 0.85); if (t.charge < 1) return; }
      const ch = t.charge;
      takeRestart(); doShoot(p, wx, wy, ch, hasDir); t.charging = false;
      return;
    }
  }
  const thr = r.type === 'throwin';
  if (ctl.pressed.A) { takeRestart(); doPass(p, fx, fy, thr ? 'throw' : 'ground'); }
  else if (ctl.pressed.B) { takeRestart(); doPass(p, fx, fy, thr ? 'throwlong' : 'lob'); }
  else if (ctl.pressed.Y) { takeRestart(); doPass(p, fx, fy, thr ? 'throw' : 'through'); }
  else if (ctl.pressed.X && !canShoot) { takeRestart(); doPass(p, fx, fy, thr ? 'throwlong' : 'lob'); }
}

// ---------- AI for everyone not controlled by a player ----------
function aiTeam(t) {
  const b = M.ball;
  const oppHas = b.owner && b.owner.team !== t;
  const weHave = b.owner && b.owner.team === t;
  const incoming = b.pass && b.pass.team === t;
  let chaser = null;
  if (!weHave && !incoming) {
    let bt = 1e9;
    for (const p of t.players) {
      if (p.isGK || (p === t.controlled && t.ctl)) continue;
      if (p.state !== 'normal' && p.state !== 'kick') continue;
      const tt = oppHas ? Math.hypot(p.x - b.owner.x, p.y - b.owner.y) / RUN : interceptPoint(p).t;
      if (tt < bt) { bt = tt; chaser = p; }
    }
    if (!oppHas && chaser && t.ctl && t.controlled && !t.controlled.isGK) {
      if (interceptPoint(t.controlled).t < bt * 0.9) chaser = null;
    }
  }
  t.chaser = chaser;
  // second presser when the ball is near our goal
  let cover = null;
  if (oppHas && Math.abs(b.x - ownGoalX(t)) < M.L * 0.33) {
    let bd = 1e9;
    for (const p of t.players) {
      if (p.isGK || p === chaser || (p === t.controlled && t.ctl)) continue;
      if (p.state !== 'normal' && p.state !== 'kick') continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < bd && d < 15) { bd = d; cover = p; }
    }
  }
  const poss = possOf(t);
  for (const p of t.players) {
    if (p === t.controlled && t.ctl) continue;
    if (p.state !== 'normal' && p.state !== 'kick') continue;
    if (p.isGK) { aiGK(p); continue; }
    if (b.owner === p) { aiCarrier(p); continue; }
    if (p === chaser) {
      if (oppHas && b.owner) {
        const c = b.owner;
        const [gx, gy] = norm(ownGoalX(t) - c.x, -c.y);
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        moveTo(p, c.x + c.vx * 0.2 + gx * 0.6, c.y + c.vy * 0.2 + gy * 0.6, 1, d > 4);
        if (d < 1.3 && p.tackleCD <= 0 && Math.random() < 0.035) standTackle(p);
      } else {
        const ip = interceptPoint(p);
        moveTo(p, ip.x, ip.y, 1, true);
      }
      continue;
    }
    if (incoming && b.pass.target === p) { const ip = interceptPoint(p); moveTo(p, ip.x, ip.y, 1, true); continue; }
    if (p === cover && b.owner) {
      const c = b.owner, gx = ownGoalX(t);
      const [nx, ny] = norm(gx - c.x, -c.y);
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      moveTo(p, c.x + nx * 1.8, c.y + ny * 1.8, 1, d > 5);
      if (d < 1.3 && p.tackleCD <= 0 && Math.random() < 0.025) standTackle(p);
      continue;
    }
    const f = formationTarget(p, b, poss);
    const d = Math.hypot(f.x - p.x, f.y - p.y);
    moveTo(p, f.x, f.y, d > 6 ? 0.95 : 0.6, d > 12);
  }
}

// An AI player that somehow has the ball (only when a team has no controller)
function aiCarrier(p) {
  const t = p.team, dir = dirOf(t);
  if (Math.random() < 0.03) {
    const m = pickPassTarget(t, p, false);
    if (m) { doPass(p, m.x - p.x, m.y - p.y, 'ground'); return; }
  }
  moveTo(p, dir * M.hl, 0, 0.9, false);
}

function aiGK(p) {
  const t = p.team, dir = dirOf(t), b = M.ball, gx = ownGoalX(t);
  if (b.owner === p) {
    p.holdT += DT;
    if (p.holdT > 1.5) { const m = pickPassTarget(t, p, true); if (m) doPass(p, m.x - p.x, m.y - p.y, 'lob'); else doPass(p, dir, 0, 'lob'); }
    p.wx = p.wy = 0;
    return;
  }
  if (b.kickId !== p.seenKick) { p.seenKick = b.kickId; p.reactT = rand(0.1, 0.22); }
  p.reactT -= DT;
  const vx = b.x - gx, vy = b.y, dg = Math.hypot(vx, vy) || 1;
  const depth = clamp(dg * 0.1, 0.6, 4.5);
  let tx = gx + (vx / dg) * depth, ty = clamp((vy / dg) * depth * 1.6, -M.gw * 0.85, M.gw * 0.85);
  let urgent = false;
  // react to shots
  if (!b.owner && b.last && b.last.team !== t && p.reactT <= 0 && b.vx * -dir > 6) {
    const planeX = gx + dir * 0.6, tt = (planeX - b.x) / b.vx;
    if (tt > 0 && tt < 1.8) {
      const yh = b.y + b.vy * tt, zh = b.z + b.vz * tt - 0.5 * GRAV * tt * tt;
      if (Math.abs(yh) < M.gw + 1.5 && zh < M.gh + 1.0) {
        tx = planeX; ty = clamp(yh, -M.gw - 0.5, M.gw + 0.5); urgent = true;
        const lat = ty - p.y;
        if (Math.abs(lat) > 0.8 && tt < 0.7 && p.state === 'normal') {
          p.state = 'dive'; p.stateT = 0.7; p.diveDir = Math.sign(lat);
          const sp = clamp((Math.abs(lat) / Math.max(tt, 0.2)) * 1.4, 4, 8);
          p.vy = Math.sign(lat) * sp; p.vx = (planeX - p.x) / Math.max(tt, 0.3);
          p.diveZ = clamp(zh, 0.2, 1.8);
          return;
        }
      }
    }
  }
  // claim loose balls in the box
  if (!urgent && !b.owner && inBox(t, b.x, b.y) && b.z < 2.0) {
    const ti = interceptPoint(p).t;
    let ot = 1e9;
    for (const o of opp(t).players) ot = Math.min(ot, interceptPoint(o).t);
    if (ti < ot + 0.3) { const ip = interceptPoint(p); tx = ip.x; ty = ip.y; urgent = true; }
  }
  // rush out at an attacker in the box
  if (!urgent && b.owner && b.owner.team !== t && inBox(t, b.x, b.y)) {
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < 9) {
      tx = b.x; ty = b.y; urgent = true;
      if (d < 1.6 && p.tackleCD <= 0) {
        p.tackleCD = 0.5;
        if (Math.random() < 0.5) { b.owner.state = 'stumble'; b.owner.stateT = 0.4; gkCatch(p); return; }
      }
    }
  }
  moveTo(p, tx, ty, urgent ? 1 : 0.7, urgent);
}

// ---------- player physics ----------
function updatePlayer(p, dt) {
  p.kickCD = Math.max(0, p.kickCD - dt);
  p.tackleCD = Math.max(0, p.tackleCD - dt);
  const b = M.ball;
  if (p.state !== 'normal') {
    p.stateT -= dt;
    const free = p.state === 'kick' || p.state === 'celebrate';
    if (!free) {
      if (p.state === 'slide') { const k = 1 - 2.8 * dt; p.vx *= k; p.vy *= k; if (M.phase === 'play') slideContact(p); }
      else if (p.state === 'tackle') { const k = 1 - 4 * dt; p.vx *= k; p.vy *= k; }
      else if (p.state === 'dive') {
        const k = 1 - 1.5 * dt; p.vx *= k; p.vy *= k;
        const prog = clamp(1 - p.stateT / 0.7, 0, 1);
        p.z = Math.sin(prog * Math.PI) * p.diveZ * 0.6;
      } else { const k = Math.max(0, 1 - 8 * dt); p.vx *= k; p.vy *= k; }
    }
    if (p.stateT <= 0) {
      p.z = 0;
      if (p.state === 'slide' || p.state === 'down') { p.state = 'getup'; p.stateT = 0.4; }
      else if (p.state === 'dive') { p.state = 'getup'; p.stateT = 0.45; }
      else p.state = 'normal';
    }
    if (!free) { p.x += p.vx * dt; p.y += p.vy * dt; clampToWorld(p); return; }
  }
  const owner = b.owner === p;
  let top = (p.sprint && p.stamina > 0.05 ? SPRINT : RUN) * p.spd;
  if (owner) top *= b.held ? 0.6 : 0.9;
  let wl = Math.hypot(p.wx, p.wy);
  if (wl > 1) { p.wx /= wl; p.wy /= wl; wl = 1; }
  const dvx = p.wx * top - p.vx, dvy = p.wy * top - p.vy, dl = Math.hypot(dvx, dvy);
  const maxd = ACCEL * dt * (owner ? 0.8 : 1);
  if (dl > maxd) { p.vx += (dvx / dl) * maxd; p.vy += (dvy / dl) * maxd; } else { p.vx += dvx; p.vy += dvy; }
  p.x += p.vx * dt; p.y += p.vy * dt;
  const sp = Math.hypot(p.vx, p.vy);
  const isTaker = M.restart && M.restart.taker === p;
  if (sp > 0.3) {
    const d = angDiff(p.face, Math.atan2(p.vy, p.vx)), rate = (owner ? 9 : 14) * dt;
    p.face += clamp(d, -rate, rate);
  } else if (!owner && !isTaker) {
    const d = angDiff(p.face, Math.atan2(b.y - p.y, b.x - p.x));
    p.face += clamp(d, -6 * dt, 6 * dt);
  }
  p.anim += sp * dt * 2.2;
  if (p.sprint && sp > RUN * 0.8) p.stamina = Math.max(0, p.stamina - dt * 0.1);
  else p.stamina = Math.min(1, p.stamina + dt * 0.06);
  clampToWorld(p);
}
function clampToWorld(p) {
  p.x = clamp(p.x, -M.hl - 3, M.hl + 3);
  p.y = clamp(p.y, -M.hw - 2.5, M.hw + 2.5);
  const b = M.ball;
  if (b.owner === p && b.held) {
    const t = p.team, gx = ownGoalX(t), dir = dirOf(t);
    const d = clamp((p.x - gx) * dir, 0.3, M.boxD - 0.3);
    p.x = gx + d * dir;
    p.y = clamp(p.y, -M.boxW / 2 + 0.3, M.boxW / 2 - 0.3);
  }
}
function separate() {
  const ps = M.players;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    for (let j = i + 1; j < ps.length; j++) {
      const c = ps[j], dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 < 0.42 && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (0.65 - d) * 0.5, nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
      }
    }
  }
}

// ---------- ball physics ----------
function updateBall(dt) {
  const b = M.ball;
  b.kickT += dt;
  if (b.owner) {
    const p = b.owner;
    if (b.held) {
      b.x = p.x + Math.cos(p.face) * 0.3; b.y = p.y + Math.sin(p.face) * 0.3;
      b.z = p.state === 'dive' ? Math.max(0.3, p.z + 0.3) : 1.1;
    } else {
      const off = 0.5 + Math.abs(Math.sin(p.anim * 0.5)) * 0.25;
      b.x = p.x + Math.cos(p.face) * off; b.y = p.y + Math.sin(p.face) * off; b.z = 0;
    }
    b.vx = p.vx; b.vy = p.vy; b.vz = 0;
    b.roll += Math.hypot(p.vx, p.vy) * dt * 3;
    return;
  }
  const sub = 4, h = dt / sub;
  for (let i = 0; i < sub; i++) {
    const bounced = stepBall(b, h);
    if (bounced > 4) Sound.bounce(bounced);
    goalFrame(b);
  }
  b.roll += Math.hypot(b.vx, b.vy) * dt * 3;
}
function goalFrame(b) {
  const r = 0.07 + BALL_R;
  for (const ex of [-1, 1]) {
    const gx = ex * M.hl;
    if (Math.abs(b.x - gx) > 1.5) continue;
    for (const ey of [-1, 1]) {
      const py = ey * M.gw, dx = b.x - gx, dy = b.y - py, d = Math.hypot(dx, dy);
      if (d < r && b.z < M.gh + 0.05) {
        const nx = dx / (d || 1), ny = dy / (d || 1), vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; Sound.post(); }
        b.x = gx + nx * r; b.y = py + ny * r;
      }
    }
    if (Math.abs(b.y) < M.gw) {
      const dx = b.x - gx, dz = b.z - M.gh, d = Math.hypot(dx, dz);
      if (d < r) {
        const nx = dx / (d || 1), nz = dz / (d || 1), vn = b.vx * nx + b.vz * nz;
        if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; Sound.post(); }
        b.x = gx + nx * r; b.z = M.gh + nz * r;
      }
    }
  }
}
function netConstrain() {
  const b = M.ball, ex = Math.sign(b.x), gx = ex * M.hl;
  if ((b.x - gx) * ex <= 0) return;
  const back = gx + ex * 1.8;
  if ((b.x - back) * ex > 0) { b.x = back; b.vx *= -0.15; }
  if (Math.abs(b.y) > M.gw - 0.15) { b.y = Math.sign(b.y) * (M.gw - 0.15); b.vy *= -0.2; }
  if (b.z > M.gh - 0.15) { b.z = M.gh - 0.15; b.vz = Math.min(0, b.vz); }
  b.vx *= 0.97; b.vy *= 0.97;
}

function checkOut() {
  const b = M.ball;
  if (b.owner) return;
  if (Math.abs(b.x) > M.hl + BALL_R) {
    const end = Math.sign(b.x);
    const att = M.teams.find((t) => dirOf(t) === end), def = opp(att);
    if (Math.abs(b.y) < M.gw - BALL_R && b.z < M.gh) { scoreGoal(att); return; }
    if (b.last && b.last.team === def) beginRestart('corner', att.idx, end * M.hl, Math.sign(b.y || 1) * M.hw);
    else beginRestart('goalkick', def.idx, end * (M.hl - M.sixD), Math.sign(b.y || 1) * M.sixW * 0.3);
    if (Math.abs(b.y) < M.gw + 3 && b.z < M.gh + 2) Sound.ooh();
    return;
  }
  if (Math.abs(b.y) > M.hw + BALL_R) {
    const ti = b.last ? 1 - b.last.team.idx : 0;
    beginRestart('throwin', ti, clamp(b.x, -M.hl + 1, M.hl - 1), Math.sign(b.y) * M.hw);
  }
}

// ---------- restarts (kick-off, throw-in, corner, goal kick, free kick, penalty) ----------
function setupKickoff(ti) { beginRestart('kickoff', ti, 0, 0); }

function beginRestart(type, ti, x, y, opts) {
  const b = M.ball;
  M.phase = 'restart'; M.phaseT = 0;
  const r = { type, team: ti, x, y, t: 0, ready: false, readyT: 0, taker: null, targets: null, ...(opts || {}) };
  M.restart = r;
  b.pass = null; b.owner = null; b.held = false;
  const t = M.teams[ti], dir = dirOf(t);
  for (const tt of M.teams) tt.charging = false;
  if (type === 'goalkick') r.taker = t.players[0];
  else if (r.takerP) r.taker = r.takerP;
  else {
    let best = null, bd = 1e9;
    for (const p of t.players) {
      if (p.isGK) continue;
      let d = Math.hypot(p.x - x, p.y - y);
      if (type === 'kickoff') d = p.role === 'FWD' ? -p.home.u : 10 - p.home.u;
      if (d < bd) { bd = d; best = p; }
    }
    r.taker = best;
  }
  let fx, fy;
  if (type === 'throwin') { fx = dir * 0.3; fy = -Math.sign(y); }
  else if (type === 'corner') [fx, fy] = norm(Math.sign(x) * (M.hl - M.pen) - x, -y);
  else if (type === 'kickoff') { r.kickY = randSign() * 4; [fx, fy] = norm(-dir * 0.6, r.kickY); }
  else { fx = dir; fy = 0; }
  r.face = Math.atan2(fy, fx);
  r.targets = computeRestartTargets(r);
  if (type === 'kickoff') { teleportRestart(); showBanner(RESTART_LABEL[type], 1.2); Sound.whistle(1); }
  else { showBanner(RESTART_LABEL[type], 1.6); Sound.whistle(1); }
}

function computeRestartTargets(r) {
  const T = new Map(), bp = { x: r.x, y: r.y };
  const end = Math.sign(r.x) || 1, gxe = end * M.hl;
  const support = r.type === 'kickoff'
    ? M.teams[r.team].players.filter((q) => q !== r.taker && !q.isGK).sort((a, b) => b.home.u - a.home.u)[0] : null;
  for (const t of M.teams) {
    const dir = dirOf(t), att = t.idx === r.team, gx = ownGoalX(t);
    for (const p of t.players) {
      let x, y;
      if (p === r.taker) {
        if (r.type === 'throwin') { x = r.x; y = r.y + Math.sign(r.y) * 0.35; }
        else { x = r.x - Math.cos(r.face) * 0.7; y = r.y - Math.sin(r.face) * 0.7; }
        T.set(p, { x, y });
        continue;
      }
      if (p.isGK) {
        if (r.type === 'kickoff' || att) { const f = formationTarget(p, bp, att ? 1 : -1); x = f.x; y = f.y; }
        else { x = gx + dir * (r.type === 'penalty' ? 0.2 : 0.8); y = clamp(r.y * 0.08, -1, 1); }
      } else if (r.type === 'kickoff') {
        const f = formationTarget(p, bp, att ? 1 : -1);
        x = f.x; y = f.y;
        if (x * dir > -1) x = -dir * 1;
        if (p === support) { x = -dir * 0.6; y = r.kickY; }
        if (!att) {
          const d = Math.hypot(x, y);
          const R2 = M.circ + 1;
          if (d < R2) { const [nx, ny] = norm(x || -dir, y); x = nx * R2; y = ny * R2; }
          if (x * dir > -1) x = -dir * 1;
          if (Math.hypot(x, y) < R2) y = (Math.sign(y) || randSign()) * Math.sqrt(R2 * R2 - x * x);
        }
      } else if (r.type === 'corner') {
        if (att) {
          if (p.role === 'DEF') { const f = formationTarget(p, { x: 0, y: 0 }, 1); x = f.x; y = f.y; }
          else { x = gxe - end * rand(4, 13); y = rand(-M.boxW * 0.3, M.boxW * 0.3); }
        } else if (p.role === 'FWD') { x = gxe - end * rand(20, 28); y = rand(-8, 8); }
        else { x = gxe - end * rand(2, 10); y = rand(-M.boxW * 0.32, M.boxW * 0.32); }
      } else if (r.type === 'penalty') {
        x = gxe - end * (M.boxD + rand(1.5, 6)); y = rand(-M.boxW * 0.4, M.boxW * 0.4);
      } else {
        const f = formationTarget(p, bp, att ? 1 : -1); x = f.x; y = f.y;
      }
      if (!att && !p.isGK) {
        const minD = r.type === 'throwin' ? 2.5 : r.type === 'kickoff' || r.type === 'penalty' ? 0 : 9.15;
        const dx = x - r.x, dy = y - r.y, d = Math.hypot(dx, dy);
        if (minD && d < minD) {
          const [nx, ny] = d > 0.1 ? [dx / d, dy / d] : norm(gx - r.x, 0);
          x = r.x + nx * minD; y = r.y + ny * minD;
        }
        if (r.type === 'goalkick') {
          const rt = M.teams[r.team];
          if (inBox(rt, x, y)) x = ownGoalX(rt) + dirOf(rt) * (M.boxD + 1.5);
        }
      }
      x = clamp(x, -M.hl + 0.5, M.hl - 0.5); y = clamp(y, -M.hw + 0.5, M.hw - 0.5);
      T.set(p, { x, y });
    }
  }
  return T;
}

function teleportRestart() {
  const r = M.restart, b = M.ball;
  for (const p of M.players) {
    const g = r.targets.get(p);
    p.x = g.x; p.y = g.y; p.vx = p.vy = 0; p.wx = p.wy = 0;
    p.state = 'normal'; p.stateT = 0; p.z = 0; p.buf = null;
    p.face = Math.atan2(r.y - p.y, r.x - p.x);
  }
  const tk = r.taker;
  tk.face = r.face;
  b.owner = null; b.held = false; b.vx = b.vy = b.vz = 0; b.pass = null;
  if (r.type === 'throwin') { b.x = tk.x; b.y = tk.y; b.z = 2.15; } else { b.x = r.x; b.y = r.y; b.z = 0; }
  r.ready = true; r.readyT = 0;
  const t = M.teams[r.team];
  t.controlled = tk; t.charging = false;
  const o = opp(t);
  let best = null, bd = 1e9;
  for (const p of o.players) {
    if (p.isGK) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < bd) { bd = d; best = p; }
  }
  o.controlled = best; o.charging = false;
  if (r.type === 'kickoff') { M.cam.x = 0; M.cam.y = 0; }
}
function takeRestart() { M.phase = 'play'; M.restart = null; M.phaseT = 0; M.banner = null; }

// ---------- goals, halves, replay ----------
function scoreGoal(t) {
  const b = M.ball;
  M.score[t.idx]++;
  M.phase = 'goal'; M.phaseT = 0; M.goalTeam = t;
  M.ownGoal = !!(b.last && b.last.team !== t);
  M.scorer = b.last && b.last.team === t ? b.last : null;
  const sub = `${M.teams[0].data.abbr} ${M.score[0]} - ${M.score[1]} ${M.teams[1].data.abbr}`;
  showBanner(M.ownGoal ? 'OWN GOAL!' : 'GOAL!', 3.2, sub, true);
  Sound.cheer();
  if (M.scorer) { M.scorer.state = 'celebrate'; M.scorer.stateT = 3.2; }
  rumbleTeam(t, 0.5, 1, 400);
}
function recordFrame() {
  const R = M.rep, f = R.frames[R.head], b = M.ball;
  f.b[0] = b.x; f.b[1] = b.y; f.b[2] = b.z;
  const P = f.p;
  M.players.forEach((p, i) => {
    const o = i * 9;
    P[o] = p.x; P[o + 1] = p.y; P[o + 2] = p.vx; P[o + 3] = p.vy; P[o + 4] = p.face;
    P[o + 5] = p.anim; P[o + 6] = STATES.indexOf(p.state); P[o + 7] = p.z; P[o + 8] = p.diveDir;
  });
  R.head = (R.head + 1) % REP_N;
  R.count = Math.min(REP_N, R.count + 1);
}
function applyFrame(k) {
  const R = M.rep, idx = (R.head - R.count + k + REP_N * 2) % REP_N, f = R.frames[idx], b = M.ball;
  b.owner = null; b.held = false; b.x = f.b[0]; b.y = f.b[1]; b.z = f.b[2]; b.vx = b.vy = 0;
  const P = f.p;
  M.players.forEach((p, i) => {
    const o = i * 9;
    p.x = P[o]; p.y = P[o + 1]; p.vx = P[o + 2]; p.vy = P[o + 3]; p.face = P[o + 4];
    p.anim = P[o + 5]; p.state = STATES[P[o + 6]] || 'normal'; p.z = P[o + 7]; p.diveDir = P[o + 8];
  });
  b.roll += 0.2;
}
function afterGoal() {
  M.rep.count = 0;
  if (M.clock >= M.halfLen) endHalf();
  else setupKickoff(1 - M.goalTeam.idx);
}
function endHalf() {
  M.ball.owner = null; M.ball.held = false; M.restart = null; M.ball.pass = null;
  for (const t of M.teams) t.charging = false;
  M.phaseT = 0;
  if (M.half === 1) { M.phase = 'halftime'; Sound.whistle(2); showBanner('HALF TIME', 4, `${M.teams[0].data.abbr} ${M.score[0]} - ${M.score[1]} ${M.teams[1].data.abbr}`, true); }
  else { M.phase = 'fulltime'; Sound.whistle(3, true); showBanner('FULL TIME', 9999, `${M.teams[0].data.abbr} ${M.score[0]} - ${M.score[1]} ${M.teams[1].data.abbr}`, true); }
}

// ---------- per-phase ticks ----------
function tickPlay(dt, ctls) {
  M.clock += dt;
  const b = M.ball;
  if (b.owner) M.stats.poss[b.owner.team.idx] += dt;
  computeBallPath();
  M.teams.forEach((t, i) => controlTeam(t, ctls[i], dt));
  if (M.phase !== 'play') return;
  M.teams.forEach((t) => aiTeam(t));
  for (const p of M.players) updatePlayer(p, dt);
  if (M.phase !== 'play') return;
  separate();
  updateBall(dt);
  updatePossession();
  if (M.phase !== 'play') return;
  checkOut();
  if (M.phase !== 'play') return;
  recordFrame();
  if (M.clock >= M.halfLen) endHalf();
}

function tickRestart(dt, ctls) {
  const r = M.restart;
  r.t += dt;
  if (!r.ready) {
    for (const p of M.players) {
      const g = r.targets.get(p);
      if (p.state === 'normal' || p.state === 'kick' || p.state === 'celebrate') moveTo(p, g.x, g.y, 1, true);
      updatePlayer(p, dt);
    }
    updateBall(dt);
    M.ball.vx *= 0.95; M.ball.vy *= 0.95;
    if (r.t > 1.1) teleportRestart();
    return;
  }
  r.readyT += dt;
  if (r.type !== 'kickoff') M.clock += dt;
  for (const p of M.players) { p.wx = 0; p.wy = 0; p.vx = 0; p.vy = 0; }
  M.teams.forEach((t, i) => controlTeam(t, ctls[i], dt));
  if (M.phase === 'restart') {
    if (r.readyT > 12) { takeRestart(); doPass(r.taker, Math.cos(r.taker.face), Math.sin(r.taker.face), 'ground'); }
    else if (M.clock >= M.halfLen && r.type !== 'kickoff') { endHalf(); return; }
  }
  for (const p of M.players) updatePlayer(p, dt);
  if (M.phase === 'restart' && r.type === 'throwin') { M.ball.x = r.taker.x; M.ball.y = r.taker.y; M.ball.z = 2.15; }
  if (M.phase === 'play') updateBall(dt);
}

function tickGoal(dt) {
  updateBall(dt);
  netConstrain();
  if (M.phaseT < 1.3) recordFrame();
  const gt = M.goalTeam, sc = M.scorer;
  for (const p of M.players) {
    if (p.state === 'normal' || p.state === 'kick' || p.state === 'celebrate') {
      if (p === sc) moveTo(p, dirOf(gt) * M.hl * 0.7, Math.sign(p.y || 1) * M.hw * 0.85, 0.9, false);
      else if (p.team === gt && sc) moveTo(p, sc.x - Math.cos(sc.face) * 1.5, sc.y - Math.sin(sc.face) * 1.5, 0.85, false);
      else { const f = formationTarget(p, { x: 0, y: 0 }, 0); moveTo(p, f.x, f.y, 0.35, false); }
    }
    updatePlayer(p, dt);
  }
  separate();
  if (M.phaseT > 3.4) {
    if (M.rep.count > 60) { M.phase = 'replay'; M.phaseT = 0; M.rep.pos = 0; M.banner = null; }
    else afterGoal();
  }
}

function tickReplay() {
  const R = M.rep;
  R.pos += 0.6;
  if (R.pos >= R.count - 1 || M.skip) { M.skip = false; afterGoal(); return; }
  applyFrame(Math.floor(R.pos));
}

function tickBreak(dt) {
  for (const p of M.players) {
    if (p.state === 'normal' || p.state === 'kick') {
      const f = formationTarget(p, { x: 0, y: 0 }, 0);
      moveTo(p, f.x * 0.6, f.y, 0.3, false);
    }
    updatePlayer(p, dt);
  }
  updateBall(dt);
  M.ball.vx *= 0.97; M.ball.vy *= 0.97;
  if (M.phase === 'halftime' && M.phaseT > 4) {
    M.half = 2; M.clock = 0; M.rep.count = 0;
    setupKickoff(1 - M.kickoffFirst);
    showBanner('SECOND HALF', 1.6);
  }
}

function updateCamera(dt) {
  const b = M.ball, c = M.cam;
  let tx = b.x + b.vx * 0.3, ty = b.y + b.vy * 0.3;
  const lx = Math.max(0, M.hl - 16), ly = Math.max(0, M.hw - 12);
  tx = clamp(tx, -lx, lx); ty = clamp(ty, -ly, ly);
  const k = Math.min(1, dt * (M.phase === 'replay' ? 6 : 3.5));
  c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
}

function updateCrowd(dt) {
  const b = M.ball;
  const dGoal = M.hl - Math.abs(b.x) + Math.max(0, Math.abs(b.y) - M.gw) * 0.5;
  let target = 0.1 + clamp(1 - dGoal / 30, 0, 1) * 0.16;
  if (M.phase === 'goal' || M.phase === 'replay') target = 0.32;
  if (M.phase === 'halftime' || M.phase === 'fulltime') target = 0.18;
  M.crowd += (target - M.crowd) * Math.min(1, dt * 2);
  if (++M.crowdTick % 10 === 0) Sound.crowd(M.crowd);
}

function matchTick(dt, ctls) {
  M.time += dt; M.phaseT += dt;
  if (M.banner) { M.banner.t -= dt; if (M.banner.t <= 0) M.banner = null; }
  switch (M.phase) {
    case 'play': tickPlay(dt, ctls); break;
    case 'restart': tickRestart(dt, ctls); break;
    case 'goal': tickGoal(dt); break;
    case 'replay': tickReplay(); break;
    default: tickBreak(dt); break;
  }
  updateCamera(dt);
  updateCrowd(dt);
}
