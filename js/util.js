'use strict';
// ---------- small math helpers ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randSign = () => (Math.random() < 0.5 ? -1 : 1);

function randn() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function norm(x, y) {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? [x / l, y / l] : [0, 0];
}
function angDiff(a, b) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colorDist(a, b) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

// ---------- projection (angled "FIFA 94" style view) ----------
// World: metres. x runs along the pitch length, y across it, z is height.
const VIEW_W = 480, VIEW_H = 270, SCALE = 10; // low-res game canvas (4x on a 1080p TV)
const HUD_W = 640, HUD_H = 360; // logical size of the sharp HUD layer
const ISO_A = 0.42, ISO_Q = 0.62;
const IC = Math.cos(ISO_A), IS = Math.sin(ISO_A);

function projX(x, y) { return (x * IC - y * IS) * SCALE; }
function projY(x, y, z) { return ((x * IS + y * IC) * ISO_Q - (z || 0)) * SCALE; }

// Stick direction on screen -> direction on the pitch
function screenToWorldDir(sx, sy) {
  const a = IC, b = -IS, c = IS * ISO_Q, d = IC * ISO_Q, det = a * d - b * c;
  return norm((d * sx - b * sy) / det, (-c * sx + a * sy) / det);
}
function worldToScreenDir(x, y) {
  return norm(x * IC - y * IS, (x * IS + y * IC) * ISO_Q);
}
