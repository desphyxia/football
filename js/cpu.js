'use strict';
// CPU opponent: produces the same "controller" input a human would.
function newCpu() {
  return { cd: 0, tk: 0, sw: 0, shooting: false, shootT: 0, aim: null, rw: null, plan: null, gkT: 0, gkWait: 1.2 };
}

function pickPassTarget(t, p, safe) {
  const dir = dirOf(t);
  let best = null, bs = -1e9;
  for (const m of t.players) {
    if (m === p || m.isGK) continue;
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d < 5 || d > 38) continue;
    let open = 1e9, block = 0;
    for (const o of opp(t).players) {
      open = Math.min(open, Math.hypot(o.x - m.x, o.y - m.y));
      const rx = o.x - p.x, ry = o.y - p.y;
      const al = (rx * (m.x - p.x) + ry * (m.y - p.y)) / d;
      if (al < 1 || al > d - 1) continue;
      if (Math.abs(rx * (m.y - p.y) - ry * (m.x - p.x)) / d < 1.5) block++;
    }
    const fwd = (m.x - p.x) * dir;
    const s = fwd * (safe ? 0.3 : 1) + Math.min(open, 8) * 1.2 - block * 6 - d * 0.15;
    if (open > 2 && s > bs) { bs = s; best = m; }
  }
  return best;
}

function rot(x, y, a) { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; }

function cpuControl(t, dt) {
  const c = t.cpu, out = { mx: 0, my: 0, held: {}, pressed: {}, released: {} };
  c.cd -= dt; c.tk -= dt; c.sw -= dt;
  const b = M.ball, p = t.controlled, dir = dirOf(t), gx = dir * M.hl;
  const stick = (wx, wy, mag) => { const [sx, sy] = worldToScreenDir(wx, wy); const k = mag == null ? 1 : mag; out.mx = sx * k; out.my = sy * k; };

  if (M.phase === 'restart') { cpuRestart(t, c, out, stick, dt); return out; }
  c.rw = null; c.plan = null;
  if (M.phase !== 'play' || !p) return out;

  // ----- we have the ball -----
  if (b.owner === p) {
    if (p.isGK && b.held) {
      c.gkT += dt;
      if (c.gkT > c.gkWait) {
        c.gkT = 0; c.gkWait = rand(0.8, 2.2);
        const m = pickPassTarget(t, p, true);
        if (m) { stick(m.x - p.x, m.y - p.y); out.pressed[Math.hypot(m.x - p.x, m.y - p.y) > 25 ? 'B' : 'A'] = true; }
        else { stick(dir, randn() * 0.3); out.pressed.B = true; }
      }
      return out;
    }
    c.gkT = 0;
    if (c.shooting) {
      stick(c.aim[0], c.aim[1]);
      c.shootT -= dt;
      if (c.shootT > 0) out.held.X = true; else c.shooting = false;
      return out;
    }
    const dg = Math.hypot(gx - p.x, p.y);
    const ang = Math.atan2(Math.abs(p.y), Math.abs(gx - p.x));
    const near = Math.min(17, M.L * 0.16), far = Math.min(27, M.L * 0.26);
    if ((dg < near && ang < 1.1) || (dg < far && ang < 0.7 && Math.random() < 0.025)) {
      c.shooting = true; c.shootT = rand(0.15, 0.5);
      const [tx, ty] = norm(gx - p.x, -p.y);
      c.aim = rot(tx, ty, randSign() * rand(0.35, 0.6));
      stick(c.aim[0], c.aim[1]);
      out.pressed.X = true; out.held.X = true;
      return out;
    }
    let nd = 1e9, no = null;
    for (const o of opp(t).players) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < nd) { nd = d; no = o; } }
    const fx = Math.cos(p.face), fy = Math.sin(p.face);
    const ahead = no ? ((no.x - p.x) * fx + (no.y - p.y) * fy) / Math.max(nd, 0.01) : -1;
    const pressured = nd < 3.5 && ahead > 0.2;
    if (c.cd <= 0 && ((pressured && Math.random() < 0.12) || Math.random() < 0.006)) {
      const m = pickPassTarget(t, p, false);
      if (m) {
        const d = Math.hypot(m.x - p.x, m.y - p.y), fwd = (m.x - p.x) * dir;
        stick(m.x - p.x, m.y - p.y);
        out.pressed[d > 26 ? 'B' : m.role === 'FWD' && fwd > 6 && Math.random() < 0.35 ? 'Y' : 'A'] = true;
        c.cd = rand(0.6, 1.2);
        return out;
      }
    }
    // dribble towards goal, steering around defenders
    let [wx, wy] = norm(gx - p.x, -p.y * (dg < 30 ? 1 : 0.25));
    let sx = 0, sy = 0;
    for (const o of opp(t).players) {
      const rx = o.x - p.x, ry = o.y - p.y, al = rx * wx + ry * wy;
      if (al < -0.5 || al > 8) continue;
      const lat = wx * ry - wy * rx;
      if (Math.abs(lat) > 3.5) continue;
      const k = ((8 - al) / 8) * 1.4 * (lat >= 0 ? -1 : 1);
      sx += -wy * k; sy += wx * k;
    }
    if (Math.abs(p.y) > M.hw - 4) sy += -Math.sign(p.y) * 0.8;
    [wx, wy] = norm(wx + sx, wy + sy);
    stick(wx, wy);
    out.held.SPRINT = nd > 4 && p.stamina > 0.3;
    return out;
  }
  c.shooting = false;

  // ----- teammate has it, or a pass is on its way -----
  if (b.owner && b.owner.team === t) return out;
  if (b.pass && b.pass.team === t) return out; // receiver runs onto it automatically

  // ----- defending / loose ball -----
  let best = null, bd = 1e9;
  for (const q of t.players) {
    if (q.isGK) continue;
    const d = Math.hypot(q.x - b.x, q.y - b.y);
    if (d < bd) { bd = d; best = q; }
  }
  const pd = Math.hypot(p.x - b.x, p.y - b.y);
  if (best && best !== p && c.sw <= 0 && (bd + 3 < pd || p.isGK || p.state === 'down')) {
    out.pressed.L1 = true; c.sw = 0.6;
    return out;
  }
  const car = b.owner;
  let tx, ty;
  if (car) {
    const [gx2, gy2] = norm(ownGoalX(t) - car.x, -car.y);
    tx = car.x + car.vx * 0.25 + gx2 * 0.7; ty = car.y + car.vy * 0.25 + gy2 * 0.7;
  } else { const ip = interceptPoint(p); tx = ip.x; ty = ip.y; }
  const d = Math.hypot(tx - p.x, ty - p.y);
  if (d > 0.3) stick(tx - p.x, ty - p.y, d < 1.5 ? 0.6 : 1);
  out.held.SPRINT = d > 4;
  if (car && !b.held) {
    const dc = Math.hypot(car.x - p.x, car.y - p.y);
    if (dc < 1.4 && c.tk <= 0) { out.pressed.B = true; c.tk = rand(0.35, 0.9); }
    else if (dc > 1.8 && dc < 3 && c.tk <= 0 && Math.random() < 0.012) { stick(car.x - p.x, car.y - p.y); out.pressed.X = true; c.tk = 1.4; }
  }
  return out;
}

function cpuRestart(t, c, out, stick, dt) {
  const r = M.restart;
  if (!r || !r.ready || r.team !== t.idx) { c.rw = null; c.plan = null; return; }
  const p = r.taker, dir = dirOf(t), gx = dir * M.hl;
  if (c.rw == null) { c.rw = rand(0.6, 1.5); c.plan = null; }
  if (!c.plan) {
    if (r.type === 'penalty' || (r.type === 'freekick' && Math.hypot(gx - r.x, r.y) < 26)) {
      const [tx, ty] = norm(gx - r.x, -r.y);
      c.plan = { k: 'shoot', aim: rot(tx, ty, randSign() * rand(0.3, 0.55)), hold: rand(0.25, 0.6), started: false };
    } else {
      let m = null, k = 'A';
      if (r.type === 'corner') {
        const cands = t.players.filter((q) => q !== p && !q.isGK && Math.abs(q.x - gx) < M.boxD);
        m = cands.length ? pick(cands) : null; k = 'B';
      } else if (r.type === 'goalkick') {
        m = pickPassTarget(t, p, false);
        k = m && Math.hypot(m.x - p.x, m.y - p.y) < 25 ? 'A' : 'B';
      } else m = pickPassTarget(t, p, true);
      c.plan = { k, m, dir: [dir, -Math.sign(r.y || 0) * 0.5] };
    }
  }
  c.rw -= dt;
  const pl = c.plan;
  if (pl.k === 'shoot') {
    stick(pl.aim[0], pl.aim[1]);
    if (c.rw > 0) return;
    if (pl.hold > 0) { if (!pl.started) { out.pressed.X = true; pl.started = true; } out.held.X = true; pl.hold -= dt; }
    else { c.plan = null; c.rw = null; }
    return;
  }
  if (pl.m) stick(pl.m.x - p.x, pl.m.y - p.y); else stick(pl.dir[0], pl.dir[1]);
  if (c.rw <= 0) { out.pressed[pl.k] = true; c.plan = null; c.rw = null; }
}
