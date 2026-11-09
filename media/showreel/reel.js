// Cowork motion reel. 15 s, 1920x1080. Every frame is a pure function of time,
// so the capture script can render any frame in any order.
(() => {
'use strict';

const W = 1920, H = 1080, CX = W / 2, CY = H / 2, FPS = 60, DUR = 15;
const TAU = Math.PI * 2;
const C = {
  bg: '#080808', or: '#EA5A15', deep: '#CC2600', warm: '#E9BC8D', ink: '#F3EEE7',
  panel: '#131211', line: '#2A2623', mute: '#7F776F', bar: '#2C2825', chip: '#1E1B19',
};
const HK = 'Hanken', NR = 'Newsreader';

// ---------------------------------------------------------------- math
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const smooth = u => u * u * (3 - 2 * u);
const bump = u => Math.sin(Math.PI * clamp(u));
const E = {
  outCubic: u => 1 - Math.pow(1 - u, 3),
  inCubic: u => u * u * u,
  inOutCubic: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  outQuint: u => 1 - Math.pow(1 - u, 5),
  inOutSine: u => -(Math.cos(Math.PI * u) - 1) / 2,
  outExpo: u => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
  inExpo: u => (u <= 0 ? 0 : Math.pow(2, 10 * u - 10)),
  inOutExpo: u => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2),
  outBack: (u, s = 1.70158) => 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2),
};
function rng(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- canvases
const main = document.getElementById('c');
const mctx = main.getContext('2d');
function mk() { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
const scene = mk(), sctx = scene.getContext('2d');
const acc = mk(), actx = acc.getContext('2d');
const tmp = mk(), tctx = tmp.getContext('2d');

let UI = 'dark'; // tone of the current background, drives overlay colours

// ---------------------------------------------------------------- drawing helpers
function font(c, fam, wt, size, ital = false) {
  c.font = `${ital ? 'italic ' : ''}${Math.round(wt)} ${size}px ${fam}`;
}
function fill(c, col, alpha = 1) {
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = alpha;
  c.fillStyle = col; c.fillRect(0, 0, W, H); c.restore();
}
function lay(c, text, track = 0) {
  const L = [];
  for (let i = 0; i < text.length; i++) {
    L.push({ ch: text[i], x: c.measureText(text.slice(0, i)).width + track * i, w: c.measureText(text[i]).width });
  }
  return { L, w: c.measureText(text).width + track * (text.length - 1) };
}
let CAP_HK = 0.7, CAP_NR = 0.62;
// Centered word followed by the brand dot, the reel's recurring full stop.
function centerWord(c, text, size, cap, track = 0, dot = true) {
  const l = lay(c, text, track);
  const gap = size * 0.06, dr = size * 0.072;
  const total = l.w + (dot ? gap + dr * 2 : 0);
  const x0 = CX - total / 2, base = CY + (cap * size) / 2;
  return { ...l, x0, base, dotX: x0 + l.w + gap + dr, dotY: base - dr, dr, total };
}
function circle(c, x, y, r, col) {
  if (r <= 0) return;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = col; c.fill();
}
function zoomAbout(c, px, py, s, sx = px, sy = py) {
  c.translate(sx, sy); c.scale(s, s); c.translate(-px, -py);
}
function creep(c, s) { zoomAbout(c, CX, CY, s); }

// The Cowork mark: an open arc with a dot at its opening (app/icon.svg).
// R is the arc radius; arc is the drawn fraction of the 270 degree sweep.
function drawMark(c, x, y, R, o = {}) {
  const arc = o.arc ?? 1, dot = o.dot ?? 1, col = o.color ?? C.ink, dotCol = o.dotColor ?? col;
  c.save(); c.translate(x, y); c.rotate(o.rot ?? 0);
  if (arc > 0.0005) {
    c.beginPath(); c.lineWidth = R * 0.46; c.lineCap = 'round'; c.strokeStyle = col;
    c.arc(0, 0, R, -Math.PI / 4, -Math.PI / 4 - arc * 1.5 * Math.PI, true); c.stroke();
  }
  if (dot > 0) circle(c, R * 0.72, 0, R * 0.26 * dot, dotCol);
  c.restore();
}
// Position of a dot that leaves the mouth, rides the arc and returns (phi 0..2pi).
function dotRide(R, phi) {
  const q = Math.PI / 4;
  let rad = R;
  if (phi < q) rad = lerp(R * 0.72, R, smooth(phi / q));
  else if (phi > 7 * q) rad = lerp(R, R * 0.72, smooth((phi - 7 * q) / q));
  return { x: Math.cos(-phi) * rad, y: Math.sin(-phi) * rad, arc: clamp((phi - q) / (6 * q)) };
}

// ---------------------------------------------------------------- 01 title  (0.00 - 3.00)
const T = { word: 'Cowork', size: 300, kern: [] };
function initTitle(c) {
  font(c, HK, 520, T.size);
  T.cap = c.measureText('H').actualBoundingBoxAscent;
  for (let i = 0; i < 5; i++) {
    const a = T.word[i], b = T.word[i + 1];
    T.kern.push(c.measureText(a + b).width - c.measureText(a).width - c.measureText(b).width);
  }
}
function titleLayout(c, t) {
  const track = lerp(72, 0, E.outExpo(prog(t, 0.28, 1.7)));
  const items = []; let x = 0;
  for (let i = 0; i < 6; i++) {
    const ts = 0.3 + i * 0.06;
    const wt = lerp(860, 520, E.outCubic(prog(t, ts, ts + 1.1)));
    font(c, HK, wt, T.size);
    const w = c.measureText(T.word[i]).width;
    items.push({ ch: T.word[i], x, wt, ts });
    x += w + (i < 5 ? T.kern[i] + track : 0);
  }
  const x0 = CX - x / 2;
  items.forEach(it => (it.x += x0));
  return items;
}
function sTitle(c, t) {
  fill(c, C.bg); UI = 'dark';
  const base = CY + T.cap / 2;
  const items = titleLayout(c, t);
  const ci = items[0];
  font(c, HK, ci.wt, T.size);
  const m = c.measureText('C');
  const top = base - m.actualBoundingBoxAscent, bot = base + m.actualBoundingBoxDescent;
  const mc = { x: (ci.x - m.actualBoundingBoxLeft + ci.x + m.actualBoundingBoxRight) / 2, y: (top + bot) / 2 };
  const R = (bot - top) / 2 / 1.23;
  const mouth = { x: mc.x + 0.72 * R, y: mc.y };

  // camera: slow push, then a dive into the dot
  const push = lerp(1, 1.045, E.inOutSine(prog(t, 0.2, 2.9)));
  const dv = prog(t, 2.42, 3.0);
  const s = Math.exp(Math.log(95) * E.inCubic(dv)), k = E.inOutCubic(dv);
  const dpx = CX + (mouth.x - CX) * push, dpy = CY + (mouth.y - CY) * push;
  c.save();
  zoomAbout(c, dpx, dpy, s, lerp(dpx, CX, k), lerp(dpy, CY, k));
  creep(c, push);

  // drafting grid
  const ga = E.outCubic(prog(t, 0.0, 0.9)) * (1 - prog(t, 2.0, 2.6));
  c.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    c.strokeStyle = `rgba(243,238,231,${0.055 * ga * (1 - Math.abs(i) / 7)})`;
    const gx = CX + i * 160;
    const len = H * E.outExpo(prog(t, 0.05 + Math.abs(i) * 0.03, 0.9 + Math.abs(i) * 0.03));
    c.beginPath(); c.moveTo(gx, CY - len / 2); c.lineTo(gx, CY + len / 2); c.stroke();
  }

  // hairline the letters rise through
  const ly = base + 14;
  const half = 760 * E.outExpo(prog(t, 0.02, 0.6)) * (1 - E.inOutExpo(prog(t, 1.5, 2.05)));
  if (half > 0.5) {
    c.fillStyle = 'rgba(243,238,231,0.55)';
    c.fillRect(CX - half, ly - 1, half * 2, 2);
    c.fillRect(CX - half - 1, ly - 9, 2, 18); c.fillRect(CX + half - 1, ly - 9, 2, 18);
  }

  // letters
  const phi = TAU * E.inOutCubic(prog(t, 1.38, 1.94));
  c.save();
  c.beginPath(); c.rect(-W, -H, W * 3, ly - 1 + H); c.clip();
  c.fillStyle = C.ink;
  items.forEach((it, i) => {
    const u = E.outExpo(prog(t, it.ts, it.ts + 0.85));
    if (u <= 0) return;
    const dy = (1 - u) * T.cap * 1.35;
    font(c, HK, it.wt, T.size);
    if (i === 0) {
      if (phi >= TAU) return;
      c.save();
      c.beginPath(); c.moveTo(mc.x, mc.y);
      c.arc(mc.x, mc.y, R * 3, -Math.PI / 4 - phi, -Math.PI / 4 - TAU, true);
      c.closePath(); c.clip();
      c.fillText(it.ch, it.x, base + dy);
      c.restore();
    } else {
      c.fillText(it.ch, it.x, base + dy);
    }
  });
  c.restore();

  // the C becomes the mark: a clock wipe removes the glyph while the arc draws in
  if (phi > 0) {
    const p = dotRide(R, Math.min(phi, 1.75 * Math.PI) + Math.PI / 4);
    drawMark(c, mc.x, mc.y, R, { arc: clamp(phi / (1.5 * Math.PI)), dot: 0 });
    if (phi < TAU) {
      const a = -Math.PI / 4 - phi;
      c.strokeStyle = `rgba(234,90,21,${0.9 * bump(phi / TAU)})`; c.lineWidth = 3;
      c.beginPath(); c.moveTo(mc.x, mc.y); c.lineTo(mc.x + Math.cos(a) * R * 1.7, mc.y + Math.sin(a) * R * 1.7); c.stroke();
    }
    // trailing echoes of the dot
    for (let e = 3; e >= 1; e--) {
      const pe = TAU * E.inOutCubic(prog(t - e * 0.022, 1.38, 1.94));
      if (pe <= 0) continue;
      const q = dotRide(R, Math.min(pe, 1.75 * Math.PI) + Math.PI / 4);
      c.globalAlpha = 0.22 * (1 - e / 4);
      circle(c, mc.x + q.x, mc.y + q.y, R * 0.26, C.or);
    }
    c.globalAlpha = 1;
    const pop = E.outBack(prog(t, 1.36, 1.52), 2.2);
    const pulse = 1 + 0.32 * bump(prog(t, 1.9, 2.15));
    circle(c, mc.x + p.x, mc.y + p.y, R * 0.26 * pop * pulse, C.or);
    const sw = prog(t, 1.9, 2.5);
    if (sw > 0 && sw < 1) {
      c.strokeStyle = `rgba(234,90,21,${0.75 * (1 - sw)})`; c.lineWidth = 2.5;
      c.beginPath(); c.arc(mouth.x, mouth.y, R * 0.26 + R * 2.4 * E.outCubic(sw), 0, TAU); c.stroke();
    }
  }
  c.restore();
  if (dv > 0.9) fill(c, C.or, (dv - 0.9) / 0.1);
}

// ---------------------------------------------------------------- 02 kinetic type, rhythm cuts  (3.00 - 5.40)
const CUT = 0.3;
const CUTS = [
  // Tasks: heavy grotesk rising out of a baseline mask
  (c, lt) => {
    fill(c, C.or); UI = 'orange'; creep(c, 1 + lt * 0.12);
    const size = 400; font(c, HK, 800, size);
    const w = centerWord(c, 'Tasks', size, CAP_HK, -6);
    c.save(); c.beginPath(); c.rect(0, 0, W, w.base + 10); c.clip();
    c.fillStyle = C.bg;
    w.L.forEach((l, i) => {
      const u = E.outExpo(prog(lt, i * 0.022, i * 0.022 + 0.2));
      c.fillText(l.ch, w.x0 + l.x, w.base + (1 - u) * size * 0.85);
    });
    c.restore();
    circle(c, w.dotX, w.dotY, w.dr * E.outBack(prog(lt, 0.1, 0.2), 2.5), C.bg);
  },
  // Notes: serif italic whipping in from the right with a skew
  (c, lt) => {
    fill(c, C.bg); UI = 'dark'; creep(c, 1 + lt * 0.1);
    const size = 380; font(c, NR, 400, size, true);
    const w = centerWord(c, 'Notes', size, CAP_NR);
    const u = E.outExpo(prog(lt, 0, 0.22));
    c.translate((1 - u) * 1100, 0);
    c.transform(1, 0, -0.45 * (1 - u), 1, 0, 0); c.translate(0.45 * (1 - u) * w.base, 0);
    c.fillStyle = C.ink; c.fillText('Notes', w.x0, w.base);
    circle(c, w.dotX, w.dotY, w.dr, C.or);
  },
  // Focus: a literal focus pull, tracking closes and a ring tightens
  (c, lt) => {
    fill(c, C.warm); UI = 'light'; creep(c, 1 + lt * 0.08);
    const size = 360; font(c, HK, 200, size);
    const u = E.outExpo(prog(lt, 0, 0.24));
    const w = centerWord(c, 'Focus', size, CAP_HK, lerp(170, 4, u));
    const ring = lerp(1400, w.total * 0.62, u);
    c.strokeStyle = 'rgba(8,8,8,0.5)'; c.lineWidth = 2.5;
    c.beginPath(); c.arc(CX, CY, ring, 0, TAU); c.stroke();
    c.filter = `blur(${lerp(28, 0, E.outCubic(prog(lt, 0, 0.2))).toFixed(2)}px)`;
    c.fillStyle = C.bg;
    w.L.forEach(l => c.fillText(l.ch, w.x0 + l.x, w.base));
    circle(c, w.dotX, w.dotY, w.dr * 0.8, C.deep);
    c.filter = 'none';
  },
  // Meetings: counter-scrolling rows, outline against fill
  (c, lt) => {
    fill(c, C.bg); UI = 'dark';
    c.translate(CX, CY); c.rotate(-0.1); c.translate(-CX, -CY);
    const size = 150; font(c, HK, 800, size);
    const seg = c.measureText('Meetings').width + 70;
    for (let r = -4; r <= 4; r++) {
      const u = E.outExpo(prog(lt, Math.abs(r) * 0.018, Math.abs(r) * 0.018 + 0.18));
      if (u <= 0) continue;
      const dir = r % 2 === 0 ? 1 : -1;
      const off = (((dir * lt * 1900 + r * 260) % seg) + seg) % seg;
      const y = CY + size * 0.36 + r * 138 + (1 - u) * 90 * Math.sign(r || 1);
      c.globalAlpha = u;
      for (let x = -seg * 2 - off; x < W + seg * 2; x += seg) {
        if (r === 0) { c.fillStyle = C.or; c.fillText('Meetings', x, y); }
        else { c.strokeStyle = 'rgba(243,238,231,0.28)'; c.lineWidth = 1.6; c.strokeText('Meetings', x, y); }
      }
    }
    c.globalAlpha = 1;
  },
  // Reminders: letters drop in on a cascade
  (c, lt) => {
    fill(c, C.deep); UI = 'deep'; creep(c, 1 + lt * 0.1);
    const size = 290; font(c, HK, 700, size);
    const w = centerWord(c, 'Reminders', size, CAP_HK, -4);
    c.fillStyle = C.ink;
    w.L.forEach((l, i) => {
      const u = E.outExpo(prog(lt, i * 0.016, i * 0.016 + 0.2));
      if (u <= 0) return;
      c.save();
      c.translate(w.x0 + l.x + l.w / 2, w.base - (1 - u) * 380);
      c.rotate((1 - u) * -0.7); c.globalAlpha = clamp(u * 3);
      c.fillText(l.ch, -l.w / 2, 0);
      c.restore();
    });
    circle(c, w.dotX, w.dotY, w.dr * E.outBack(prog(lt, 0.14, 0.24), 2.5), C.warm);
  },
  // Bookmarks: wipe reveal led by an orange bar
  (c, lt) => {
    fill(c, C.ink); UI = 'light'; creep(c, 1 + lt * 0.08);
    const size = 300; font(c, NR, 400, size);
    const w = centerWord(c, 'Bookmarks', size, CAP_NR);
    const u = E.outExpo(prog(lt, 0, 0.22));
    const edge = w.x0 - 30 + (w.total + 60) * u;
    c.save(); c.beginPath(); c.rect(0, 0, edge, H); c.clip();
    c.translate((1 - u) * -80, 0);
    c.fillStyle = C.bg; c.fillText('Bookmarks', w.x0, w.base);
    circle(c, w.dotX, w.dotY, w.dr, C.or);
    c.restore();
    if (u < 0.999) { c.fillStyle = C.or; c.fillRect(edge, w.base - size * 0.8, 16, size * 1.02); }
  },
  // Money: sliced in half, halves arrive from opposite sides
  (c, lt) => {
    fill(c, C.bg); UI = 'dark'; creep(c, 1 + lt * 0.1);
    const size = 420; font(c, HK, 800, size);
    const w = centerWord(c, 'Money', size, CAP_HK, -8);
    const u = E.outExpo(prog(lt, 0, 0.22));
    const mid = w.base - (CAP_HK * size) / 2;
    for (const half of [-1, 1]) {
      c.save(); c.beginPath();
      if (half < 0) c.rect(0, 0, W, mid); else c.rect(0, mid, W, H - mid);
      c.clip(); c.translate(half * (1 - u) * 1500, 0);
      c.fillStyle = C.or;
      w.L.forEach(l => c.fillText(l.ch, w.x0 + l.x, w.base));
      circle(c, w.dotX, w.dotY, w.dr, C.ink);
      c.restore();
    }
    c.fillStyle = `rgba(243,238,231,${0.8 * (1 - u)})`; c.fillRect(0, mid - 1, W, 2);
  },
  // Learning: scale slam with a settle
  (c, lt) => {
    fill(c, C.or); UI = 'orange';
    const size = 360; font(c, NR, 400, size, true);
    const w = centerWord(c, 'Learning', size, CAP_NR);
    const u = E.outExpo(prog(lt, 0, 0.24));
    c.translate(CX, CY); c.rotate(lerp(0.14, 0, u)); c.scale(lerp(2.6, 1, u) * (1 + lt * 0.08), lerp(2.6, 1, u) * (1 + lt * 0.08)); c.translate(-CX, -CY);
    c.globalAlpha = clamp(u * 2.5);
    c.fillStyle = C.bg; c.fillText('Learning', w.x0, w.base);
    circle(c, w.dotX, w.dotY, w.dr, C.ink);
    c.globalAlpha = 1;
  },
];
function sCuts(c, t) {
  const k = Math.min(CUTS.length - 1, Math.floor((t - 3) / CUT));
  const lt = t - 3 - k * CUT;
  const sh = 9 * Math.exp(-lt * 24) * Math.sin(lt * 100);
  c.save(); c.translate(sh, -sh * 0.4);
  CUTS[k](c, lt);
  c.restore();
}

// ---------------------------------------------------------------- 03 shape morphs  (5.40 - 8.12)
function poly(th, n, phase) {
  const s = TAU / n;
  const a = ((((th - phase) % s) + s) % s) - s / 2;
  return Math.cos(Math.PI / n) / Math.cos(a);
}
const SH = [
  () => 1,
  th => 0.93 * Math.pow(Math.pow(Math.abs(Math.cos(th)), 4) + Math.pow(Math.abs(Math.sin(th)), 4), -0.25),
  th => 1.18 * poly(th, 3, -Math.PI / 2),
  th => 0.9 + 0.12 * Math.cos(6 * th),
  th => 1.02 * poly(th, 6, 0),
  th => 0.6 + 0.48 * Math.pow((1 + Math.cos(5 * (th + Math.PI / 2))) / 2, 2.4),
];
const SEQ = [0, 1, 2, 3, 4, 5, 0];
function shapeState(t) {
  let rot = 0, idx = 0, m = 0;
  for (let k = 0; k < 6; k++) {
    const s0 = 5.58 + k * 0.29;
    const e = E.inOutExpo(prog(t, s0, s0 + 0.23));
    rot += (e * Math.PI) / 3;
    if (t >= s0) { idx = k; m = e; }
  }
  return { a: SH[SEQ[idx]], b: SH[SEQ[idx + 1]], m, rot };
}
function cellState(tau) {
  const q = (tau - 7.2) / 0.24, f = Math.floor(q);
  const idx = ((f % 6) + 6) % 6;
  const m = E.inOutExpo(clamp((q - f) / 0.75));
  return { a: SH[idx], b: SH[(idx + 1) % 6], m, rot: ((f + m) * Math.PI) / 3 };
}
function shapePath(c, x, y, R, st, toSquircle = 0) {
  const N = 360;
  c.beginPath();
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU;
    let r = lerp(st.a(th - st.rot), st.b(th - st.rot), st.m);
    if (toSquircle) r = lerp(r, SH[1](th), toSquircle);
    const px = x + Math.cos(th) * r * R, py = y + Math.sin(th) * r * R;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
}
function sShapes(c, t) {
  fill(c, C.bg); UI = 'dark';
  const g = E.inOutExpo(prog(t, 7.26, 7.54));
  const intro = t2 => E.outBack(prog(t2, 5.4, 5.64), 1.5);
  const Rof = t2 => lerp(230, 46, E.inOutExpo(prog(t2, 7.26, 7.54))) * intro(t2);
  const back = 1 - g;

  // backdrop: crosshair, rings, registration brackets
  const ch = E.outExpo(prog(t, 5.4, 5.8));
  c.fillStyle = `rgba(243,238,231,${0.08 * back})`;
  c.fillRect(CX - (W / 2) * ch, CY - 0.5, W * ch, 1);
  c.fillRect(CX - 0.5, CY - (H / 2) * ch, 1, H * ch);
  c.save(); c.translate(CX, CY); c.rotate(t * 0.35);
  c.setLineDash([2, 12]); c.strokeStyle = `rgba(243,238,231,${0.32 * back * ch})`; c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, 370, 0, TAU * ch); c.stroke(); c.setLineDash([]);
  c.restore();
  c.strokeStyle = `rgba(243,238,231,${0.07 * back})`; c.lineWidth = 1;
  c.beginPath(); c.arc(CX, CY, 300, 0, TAU); c.stroke();
  const oa = t * 2.6;
  circle(c, CX + Math.cos(oa) * 370, CY + Math.sin(oa) * 370, 7 * ch * back, C.warm);
  let kick = 0;
  for (let k = 0; k < 6; k++) kick += bump(prog(t, 5.58 + k * 0.29, 5.58 + k * 0.29 + 0.23));
  const bd = lerp(520, 300, E.outExpo(prog(t, 5.42, 5.8))) + kick * 16;
  c.strokeStyle = `rgba(243,238,231,${0.6 * back * ch})`; c.lineWidth = 2;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const bx = CX + sx * bd, by = CY + sy * bd * 0.82;
    c.beginPath(); c.moveTo(bx, by - sy * 30); c.lineTo(bx, by); c.lineTo(bx - sx * 30, by); c.stroke();
  }

  // echo trails
  for (let k = 6; k >= 1; k--) {
    const tk = t - k * 0.03;
    if (tk < 5.4) continue;
    c.strokeStyle = `rgba(234,90,21,${0.55 * (1 - k / 7) * back})`; c.lineWidth = 2;
    shapePath(c, CX, CY, Rof(tk) * (1 + k * 0.045), shapeState(tk)); c.stroke();
  }

  // grid of cells, each morphing on a phase delay that ripples out from the centre
  const w2 = E.inOutExpo(prog(t, 7.75, 8.12));
  if (t > 7.3) {
    for (let j = -3; j <= 3; j++) for (let i = -5; i <= 5; i++) {
      if (!i && !j) continue;
      const d = Math.hypot(i, j * 1.1);
      const ap = E.outBack(prog(t, 7.3 + d * 0.035, 7.3 + d * 0.035 + 0.26), 2);
      if (ap <= 0) continue;
      const tau = t - d * 0.06;
      const r = 46 * ap * (0.86 + 0.14 * Math.sin(tau * 11 - d * 1.3));
      const spread = 1 + w2 * 1.8;
      const x = CX + i * 168 * spread, y = CY + j * 150 * spread;
      c.globalAlpha = 1 - w2;
      shapePath(c, x, y, r, cellState(tau));
      if (Math.round(d) % 2 === 0) { c.fillStyle = C.or; c.fill(); }
      else { c.strokeStyle = 'rgba(243,238,231,0.55)'; c.lineWidth = 2; c.stroke(); }
    }
    c.globalAlpha = 1;
  }

  if (t < 7.75) {
    const st = shapeState(t);
    const R = Rof(t);
    const sq = E.inOutCubic(prog(t, 7.52, 7.72));
    shapePath(c, CX, CY, R, st, sq);
    const gr = c.createLinearGradient(CX - R, CY - R, CX + R, CY + R);
    gr.addColorStop(0, '#F07A3A'); gr.addColorStop(0.55, C.or); gr.addColorStop(1, C.deep);
    c.fillStyle = gr; c.fill();
    return;
  }

  // the centre cell opens into a window onto the next scene
  const ww = lerp(88, W + 4, w2), wh = lerp(88, H + 4, w2), wr = lerp(26, 0, w2);
  c.save();
  c.beginPath(); c.roundRect(CX - ww / 2, CY - wh / 2, ww, wh, wr); c.clip();
  sWorld(c, t);
  c.setTransform(1, 0, 0, 1, 0, 0);
  fill(c, C.or, 1 - E.outCubic(prog(t, 7.75, 7.97)));
  c.restore();
  c.globalAlpha = 1;
}

// ---------------------------------------------------------------- 04 camera move  (7.75 - 9.95)
const GAP = 1340;
// move, settle, move: the camera lands on each block long enough to read it
function camWorld(t) {
  const u = E.inOutSine(prog(t, 7.75, 9.7));
  const m1 = E.inOutExpo(prog(t, 8.22, 8.62)), m2 = E.inOutExpo(prog(t, 8.86, 9.26));
  const drift = (t - 7.75) * 60;
  const whip = E.inExpo(prog(t, 9.62, 9.95));
  return {
    x: -140 + GAP * (m1 + m2) + drift + 5600 * whip,
    y: lerp(30, -40, u), s: lerp(1.12, 1.0, u), r: lerp(-0.03, 0.018, u) + 0.012 * (bump(prog(t, 8.22, 8.62)) - bump(prog(t, 8.86, 9.26))),
  };
}
function applyCam(c, cam, z) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.translate(CX, CY); c.rotate(cam.r * z);
  const sc = cam.s * (1 + (z - 1) * 0.22); c.scale(sc, sc);
  c.translate(-cam.x * z, -cam.y * z);
}
function maskLine(c, t, t0, x, base, size, draw) {
  const u = E.outExpo(prog(t, t0, t0 + 0.75));
  if (u <= 0) return;
  c.save();
  c.beginPath(); c.rect(x - 20, base - size * 1.05, 1400, size * 1.4); c.clip();
  c.translate(0, (1 - u) * size * 1.3);
  draw();
  c.restore();
}
function card(c, t, t0, x, y, w, h, body) {
  const u = E.outExpo(prog(t, t0, t0 + 0.7));
  if (u <= 0) return;
  c.save();
  c.translate(0, (1 - u) * 70);
  c.beginPath(); c.rect(x - 4, y - 4, w + 8, (h + 8) * u); c.clip();
  c.beginPath(); c.roundRect(x, y, w, h, 18);
  c.fillStyle = C.panel; c.fill(); c.strokeStyle = C.line; c.lineWidth = 1.5; c.stroke();
  body(t - t0);
  c.restore();
}
function cardTitle(c, x, y, text) {
  font(c, HK, 600, 26); c.fillStyle = C.ink; c.fillText(text, x + 30, y + 54);
  c.fillStyle = C.line; c.fillRect(x + 30, y + 80, 400, 1.5);
}
function cardTasks(c, t, b, x, y, w, h) {
  card(c, t, b.tb + 0.06, x, y, w, h, lt => {
    cardTitle(c, x, y, 'Today');
    const rows = [['Draft the weekly plan', '09:30'], ['Review meeting notes', '11:00'], ['Pay the electricity bill', '16:00']];
    rows.forEach(([label, time], k) => {
      const ry = y + 132 + k * 74;
      const a = E.outCubic(prog(lt, 0.15 + k * 0.07, 0.5 + k * 0.07));
      c.save(); c.globalAlpha = a; c.translate((1 - a) * 30, 0);
      const done = E.outCubic(prog(lt, 0.42, 0.62));
      c.beginPath(); c.roundRect(x + 30, ry - 16, 28, 28, 7);
      if (k === 0 && done > 0) { c.fillStyle = `rgba(234,90,21,${done})`; c.fill(); }
      c.strokeStyle = k === 0 && done > 0 ? C.or : C.mute; c.lineWidth = 2; c.stroke();
      if (k === 0 && done > 0) {
        c.save(); c.strokeStyle = C.bg; c.lineWidth = 3.5; c.lineCap = 'round'; c.lineJoin = 'round';
        c.setLineDash([40, 40]); c.lineDashOffset = 40 - 30 * done;
        c.beginPath(); c.moveTo(x + 37, ry - 2); c.lineTo(x + 43, ry + 4); c.lineTo(x + 52, ry - 8); c.stroke();
        c.restore();
      }
      font(c, HK, 400, 23);
      c.globalAlpha = a * (k === 0 ? 1 - 0.5 * done : 1);
      c.fillStyle = C.ink; c.fillText(label, x + 76, ry + 8);
      if (k === 0) c.fillRect(x + 76, ry, c.measureText(label).width * E.outCubic(prog(lt, 0.5, 0.75)), 2);
      c.globalAlpha = a;
      c.beginPath(); c.roundRect(x + w - 108, ry - 17, 78, 32, 7); c.fillStyle = C.chip; c.fill();
      if (k === 2) {
        const p = bump(prog(lt, 0.55, 0.85)) + bump(prog(lt, 0.9, 1.2));
        c.strokeStyle = `rgba(234,90,21,${0.9 * clamp(p)})`; c.lineWidth = 2; c.stroke();
      }
      font(c, HK, 500, 18); c.fillStyle = C.warm; c.textAlign = 'center';
      c.fillText(time, x + w - 69, ry + 6); c.textAlign = 'left';
      c.restore();
      if (k < 2) { c.fillStyle = C.line; c.fillRect(x + 30, ry + 37, w - 60, 1); }
    });
  });
}
function cardNotes(c, t, b, x, y, w, h) {
  card(c, t, b.tb + 0.06, x, y, w, h, lt => {
    cardTitle(c, x, y, 'Reading list');
    const rb = E.outBack(prog(lt, 0.3, 0.55), 2);
    c.save(); c.translate(x + w - 46, y + 30); c.scale(1, rb);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(18, 0); c.lineTo(18, 30); c.lineTo(9, 23); c.lineTo(0, 30); c.closePath();
    c.fillStyle = C.or; c.fill(); c.restore();
    const widths = [0.92, 0.78, 0.86, 0.55, 0.9, 0.62];
    widths.forEach((f, k) => {
      const u = E.outExpo(prog(lt, 0.12 + k * 0.045, 0.6 + k * 0.045));
      c.beginPath(); c.roundRect(x + 30, y + 118 + k * 30, (w - 60) * f * u, 11, 3);
      c.fillStyle = k === 2 ? C.or : C.bar; c.fill();
    });
    const u = E.outCubic(prog(lt, 0.45, 0.8));
    c.globalAlpha = u;
    c.beginPath(); c.roundRect(x + 30, y + h - 78, w - 60, 50, 8);
    c.fillStyle = C.chip; c.fill(); c.strokeStyle = C.line; c.lineWidth = 1.2; c.stroke();
    drawMark(c, x + 56, y + h - 53, 8, { dotColor: C.or });
    font(c, HK, 400, 19); c.fillStyle = C.mute; c.fillText('Saved from a link', x + 80, y + h - 46);
    c.globalAlpha = 1;
  });
}
function cardMeet(c, t, b, x, y, w, h) {
  card(c, t, b.tb + 0.06, x, y, w, h, lt => {
    cardTitle(c, x, y, 'Design sync');
    const n = 46, span = w - 60;
    const ap = E.outExpo(prog(lt, 0.1, 0.5));
    c.fillStyle = 'rgba(233,188,141,0.85)';
    for (let k = 0; k < n; k++) {
      const env = 0.35 + 0.65 * Math.sin((Math.PI * (k + 0.5)) / n);
      const hh = (6 + 44 * Math.abs(Math.sin(k * 0.61 + lt * 9)) * env) * ap;
      c.fillRect(x + 30 + (k * span) / n, y + 134 - hh / 2, 5, hh);
    }
    c.fillStyle = C.or; c.fillRect(x + 30 + span * ((lt * 0.5) % 1), y + 100, 2, 68);
    c.fillStyle = C.line; c.fillRect(x + 30, y + 190, w - 60, 1);
    font(c, HK, 600, 15); c.letterSpacing = '3px'; c.fillStyle = C.mute;
    c.fillText('ACTION ITEMS', x + 30, y + 230); c.letterSpacing = '0px';
    ['Send the revised brief', 'Book a follow-up call'].forEach((s, k) => {
      const u = E.outCubic(prog(lt, 0.35 + k * 0.1, 0.7 + k * 0.1));
      c.globalAlpha = u;
      const ry = y + 274 + k * 44;
      c.beginPath(); c.roundRect(x + 30 + (1 - u) * 24, ry - 12, 11, 11, 2); c.fillStyle = C.or; c.fill();
      font(c, HK, 400, 22); c.fillStyle = C.ink; c.fillText(s, x + 56 + (1 - u) * 24, ry);
    });
    c.globalAlpha = 1;
  });
}
const BLOCKS = [
  { tb: 7.98, label: '01', name: 'TASKS', l1: 'Timing and reminders', l2: 'on every task.', card: cardTasks },
  { tb: 8.4, label: '02', name: 'KNOWLEDGE', l1: 'Notes and bookmarks', l2: 'in one place.', card: cardNotes },
  { tb: 9.04, label: '03', name: 'MEETINGS', l1: 'Notes that become', l2: 'action items.', card: cardMeet },
];
let DUST = [];
function sWorld(c, t) {
  fill(c, C.bg); UI = 'dark';
  const cam = camWorld(t);

  applyCam(c, cam, 0.6);
  for (const [gx, gy] of [[-200, -120], [700, 220], [1400, -180]]) {
    const gr = c.createRadialGradient(gx, gy, 0, gx, gy, 720);
    gr.addColorStop(0, 'rgba(234,90,21,0.13)'); gr.addColorStop(1, 'rgba(234,90,21,0)');
    c.fillStyle = gr; c.fillRect(gx - 720, gy - 720, 1440, 1440);
  }
  c.fillStyle = 'rgba(243,238,231,0.045)';
  const gx0 = Math.floor((cam.x * 0.6 - 2000) / 140) * 140;
  for (let gx = gx0; gx < gx0 + 4200; gx += 140) c.fillRect(gx, -900, 1, 1800);
  for (let gy = -840; gy <= 840; gy += 140) c.fillRect(gx0, gy, 4200, 1);

  applyCam(c, cam, 1);
  BLOCKS.forEach((b, i) => {
    const bx = i * GAP, x = bx - 680;
    maskLine(c, t, b.tb, x, -112, 20, () => {
      font(c, HK, 600, 19); c.letterSpacing = '4px';
      c.fillStyle = C.or; c.fillText(b.label, x, -112);
      c.fillStyle = C.mute; c.fillText(b.name, x + 52, -112);
      c.letterSpacing = '0px';
    });
    maskLine(c, t, b.tb + 0.06, x, -32, 72, () => {
      font(c, NR, 300, 72); c.fillStyle = C.ink; c.fillText(b.l1, x, -32);
    });
    maskLine(c, t, b.tb + 0.12, x, 52, 72, () => {
      font(c, NR, 300, 72, true); c.fillStyle = C.warm; c.fillText(b.l2, x, 52);
    });
    b.card(c, t, b, bx + 60, -190, 460, 360);
  });

  applyCam(c, cam, 1.35);
  font(c, HK, 800, 500);
  c.strokeStyle = 'rgba(243,238,231,0.07)'; c.lineWidth = 2;
  BLOCKS.forEach((b, i) => {
    const u = E.outExpo(prog(t, b.tb, b.tb + 0.9));
    c.strokeText(b.label, i * GAP * 1.35 - 20, 470 + (1 - u) * 120);
  });

  applyCam(c, cam, 1.9);
  DUST.forEach(p => { c.globalAlpha = p.a; circle(c, p.x, p.y, p.r, C.warm); });
  c.globalAlpha = 1;
  c.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------------------------------------------------------------- 05 type as a mask  (9.95 - 11.00)
const M = { size: 430 };
function initMask() {
  tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, W, H);
  font(tctx, HK, 800, M.size);
  M.cap = tctx.measureText('H').actualBoundingBoxAscent;
  M.w = tctx.measureText('Cowork').width;
  M.x0 = CX - M.w / 2; M.base = CY + M.cap / 2;
  tctx.fillStyle = '#fff'; tctx.fillText('Cowork', M.x0, M.base);
  // find the middle of the C's left stroke to zoom out from
  const y = Math.round(M.base - M.cap / 2);
  const row = tctx.getImageData(0, y, W, 1).data;
  let a = -1, b = -1;
  for (let x = 0; x < W; x++) {
    const on = row[x * 4 + 3] > 128;
    if (on && a < 0) a = x;
    if (!on && a >= 0) { b = x; break; }
  }
  M.P = { x: (a + b) / 2, y };
  tctx.clearRect(0, 0, W, H);
}
function sMask(c, t) {
  fill(c, C.bg); UI = 'dark';
  const lt = t - 9.95;
  const e = E.outQuint(prog(t, 9.95, 10.8));
  const s = Math.exp(Math.log(28) * (1 - e));
  const sx = lerp(CX, M.P.x, e), sy = lerp(CY, M.P.y, e);

  // outlined echoes that peel away once the word has landed
  const pe = E.outExpo(prog(t, 10.32, 10.9));
  if (pe > 0) {
    c.save(); zoomAbout(c, M.P.x, M.P.y, s, sx, sy);
    font(c, HK, 800, M.size); c.lineWidth = 1.6;
    for (let k = 1; k <= 3; k++) {
      c.strokeStyle = `rgba(243,238,231,${0.22 / k})`;
      for (const dir of [-1, 1]) c.strokeText('Cowork', M.x0, M.base + dir * k * 132 * pe);
    }
    c.restore();
  }

  tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, W, H);
  tctx.globalCompositeOperation = 'source-over';
  zoomAbout(tctx, M.P.x, M.P.y, s, sx, sy);
  tctx.fillStyle = C.deep; tctx.fillRect(M.x0 - 400, M.base - 900, M.w + 800, 1400);
  const sw = 24, off = 300 * lt + 190 * (1 - Math.exp(-lt * 6));
  tctx.save(); tctx.translate(M.P.x, M.P.y); tctx.rotate(-0.55);
  tctx.fillStyle = C.or;
  const o = off % (sw * 2);
  for (let k = -80; k <= 80; k++) tctx.fillRect(k * sw * 2 - o, -2000, sw, 4000);
  tctx.restore();
  const hx = lerp(M.x0 - 600, M.x0 + M.w + 600, (lt / 1.05) % 1);
  const gr = tctx.createLinearGradient(hx - 300, 0, hx + 300, 0);
  gr.addColorStop(0, 'rgba(233,188,141,0)'); gr.addColorStop(0.5, 'rgba(233,188,141,0.55)'); gr.addColorStop(1, 'rgba(233,188,141,0)');
  tctx.fillStyle = gr; tctx.fillRect(M.x0 - 600, M.base - 900, M.w + 1200, 1400);
  // the word cuts the texture out
  tctx.globalCompositeOperation = 'destination-in';
  font(tctx, HK, 800, M.size); tctx.fillStyle = '#fff'; tctx.fillText('Cowork', M.x0, M.base);
  tctx.globalCompositeOperation = 'source-over';
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(tmp, 0, 0); c.restore();

  // venetian blinds close into the next section
  c.fillStyle = C.or;
  for (let i = 0; i < 12; i++) {
    const u = E.inOutExpo(prog(t, 10.74 + i * 0.01, 10.87 + i * 0.01));
    if (u <= 0) continue;
    if (i % 2 === 0) c.fillRect(0, i * 90, W * u, 90.5);
    else c.fillRect(W * (1 - u), i * 90, W * u, 90.5);
  }
}

// ---------------------------------------------------------------- 06 montage, rhythm cuts  (11.00 - 12.60)
const MCUT = 0.2;
const MONTAGE = [
  // field of marks, rotating on a diagonal phase
  (c, lt) => {
    fill(c, C.or); UI = 'orange'; creep(c, 1 + lt * 0.15);
    for (let j = -3; j <= 3; j++) for (let i = -6; i <= 6; i++) {
      const p = (i + j) * 0.4;
      const a = 0.2 + 0.8 * E.outExpo(prog(lt, 0.01 * Math.abs(i + j), 0.01 * Math.abs(i + j) + 0.14));
      drawMark(c, CX + i * 160, CY + j * 160, 30, { arc: a, rot: -lt * 7 - p, color: C.bg, dotColor: C.ink });
    }
  },
  // three panels, the word split across them
  (c, lt) => {
    fill(c, C.bg); UI = 'dark';
    const cols = [C.or, C.warm, C.deep], parts = ['Co', 'wo', 'rk'];
    font(c, NR, 400, 520, true);
    for (let i = 0; i < 3; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const off = dir * (1 - E.outExpo(prog(lt, i * 0.025, i * 0.025 + 0.16))) * H;
      c.save(); c.beginPath(); c.rect(i * 640, 0, 640, H); c.clip();
      c.fillStyle = cols[i]; c.fillRect(i * 640, off, 640, H);
      c.fillStyle = i === 2 ? C.ink : C.bg; c.textAlign = 'center';
      c.fillText(parts[i], i * 640 + 320, CY + 160 + off * 0.6 - lt * 120 * dir);
      c.textAlign = 'left';
      c.restore();
    }
  },
  // dial of counter-rotating arcs
  (c, lt) => {
    fill(c, C.warm); UI = 'light';
    const lens = [0.3, 0.62, 0.45, 0.75, 0.38, 0.55, 0.68];
    for (let i = 0; i < 7; i++) {
      const r = 70 + i * 70, dir = i % 2 ? -1 : 1;
      const g = E.outExpo(prog(lt, i * 0.012, i * 0.012 + 0.15));
      const a0 = dir * lt * (4 + i * 0.9) + i * 1.3;
      c.beginPath(); c.arc(CX, CY, r, a0, a0 + TAU * lens[i] * g);
      c.strokeStyle = i === 3 ? C.or : C.bg; c.lineWidth = 22; c.lineCap = 'butt'; c.stroke();
    }
    circle(c, CX, CY, 30 * E.outBack(prog(lt, 0, 0.12), 2), C.or);
  },
  // tunnel of rounded squares
  (c, lt) => {
    fill(c, C.bg); UI = 'dark';
    for (let k = 0; k < 14; k++) {
      const z = (lt * 3.4 + k / 14) % 1;
      const s = 34 * Math.exp(z * 4.3);
      c.save(); c.translate(CX, CY); c.rotate(z * 1.4 + lt * 1.2);
      c.globalAlpha = smooth(clamp(z * 4)) * (1 - smooth(clamp((z - 0.8) * 5)));
      c.beginPath(); c.roundRect(-s / 2, -s / 2, s, s, s * 0.14);
      c.strokeStyle = k % 4 === 0 ? C.warm : C.or; c.lineWidth = 2 + z * 7; c.stroke();
      c.restore();
    }
    c.globalAlpha = 1;
    circle(c, CX, CY, 14, C.or);
  },
  // tiled wordmark rows, grotesk against serif
  (c, lt) => {
    fill(c, C.ink); UI = 'light';
    c.translate(CX, CY); c.rotate(-0.08); c.translate(-CX, -CY);
    for (let r = -5; r <= 5; r++) {
      const serif = r % 2 !== 0;
      if (serif) font(c, NR, 400, 128, true); else font(c, HK, 800, 120);
      const seg = c.measureText('Cowork').width + 60;
      const dir = r % 2 === 0 ? 1 : -1;
      const off = (((dir * lt * 2600 + r * 310) % seg) + seg) % seg;
      c.fillStyle = r === 0 ? C.or : C.bg;
      for (let x = -seg * 2 - off; x < W + seg * 2; x += seg) c.fillText('Cowork', x, CY + 44 + r * 124);
    }
  },
  // a wave of bouncing dots with squash and stretch
  (c, lt) => {
    fill(c, C.deep); UI = 'deep';
    const floor = CY + 150;
    c.fillStyle = 'rgba(243,238,231,0.4)'; c.fillRect(0, floor, W, 2);
    for (let i = -5; i <= 5; i++) {
      const ph = Math.abs(Math.sin(lt * (Math.PI / MCUT) + i * 0.45));
      const h = 300 * ph;
      const sq = 1 - 0.38 * clamp(1 - h / 50);
      const r = 26;
      c.save(); c.translate(CX + i * 150, floor - r * sq - h);
      c.scale(1 / sq, sq); circle(c, 0, 0, r, C.ink); c.restore();
    }
  },
  // the mark at speed, motion blur does the drawing
  (c, lt) => {
    fill(c, C.bg); UI = 'dark';
    const sc = E.outBack(prog(lt, 0, 0.12), 2);
    c.strokeStyle = 'rgba(243,238,231,0.1)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(CX, CY, 400, 0, TAU); c.stroke();
    drawMark(c, CX, CY, 240 * lerp(0.8, 1, sc), { rot: -lt * 15 + 0.6, dotColor: C.or });
  },
  // radial burst
  (c, lt) => {
    fill(c, C.or); UI = 'orange';
    const a = E.outExpo(clamp(lt / 0.12)), b = E.outExpo(clamp(lt / 0.2));
    c.strokeStyle = C.bg; c.lineWidth = 10; c.lineCap = 'butt';
    for (let k = 0; k < 28; k++) {
      const th = (k / 28) * TAU + lt * 0.8;
      const r0 = lerp(60, 900, b), r1 = lerp(120, 1500, a);
      c.beginPath(); c.moveTo(CX + Math.cos(th) * r0, CY + Math.sin(th) * r0);
      c.lineTo(CX + Math.cos(th) * r1, CY + Math.sin(th) * r1); c.stroke();
    }
  },
];
function sMontage(c, t) {
  const k = Math.min(MONTAGE.length - 1, Math.floor((t - 11) / MCUT));
  const lt = t - 11 - k * MCUT;
  const sh = 7 * Math.exp(-lt * 26) * Math.sin(lt * 110);
  c.save(); c.translate(-sh * 0.5, sh);
  MONTAGE[k](c, lt);
  c.restore();
}

// ---------------------------------------------------------------- 07 lockup  (12.60 - 15.00)
const LK = { R: 78, size: 176, gap: 50 };
function initLockup(c) {
  font(c, HK, 500, LK.size);
  LK.cap = c.measureText('H').actualBoundingBoxAscent;
  LK.Tw = c.measureText('Cowork').width;
  const total = LK.R * 2.21 + LK.gap + LK.Tw;
  LK.mx = CX - total / 2 + LK.R * 1.23;
  LK.tx = LK.mx + LK.R * 0.98 + LK.gap;
  LK.bx = CX;
  LK.base = CY + LK.cap / 2;
}
function sLockup(c, t) {
  fill(c, C.bg); UI = 'dark';
  const R = LK.R;
  const mouth = { x: LK.bx + 0.72 * R, y: CY };
  if (t < 13.0) {
    const ir = E.inOutExpo(prog(t, 12.6, 13.0));
    circle(c, lerp(CX, mouth.x, ir), lerp(CY, mouth.y, ir), lerp(1250, 0.26 * R, ir), C.or);
    return;
  }
  const push = lerp(1, 1.03, E.inOutSine(prog(t, 13.0, 15.0)));
  c.save(); creep(c, push);

  const sl = E.inOutExpo(prog(t, 13.66, 14.24));
  const mx = lerp(LK.bx, LK.mx, sl);
  const ride = E.inOutCubic(prog(t, 13.02, 13.62));
  const p = dotRide(R, ride * TAU);

  const glow = E.outCubic(prog(t, 13.3, 14.2));
  if (glow > 0) {
    const gr = c.createRadialGradient(mx, CY, 0, mx, CY, 700);
    gr.addColorStop(0, `rgba(234,90,21,${0.12 * glow})`); gr.addColorStop(1, 'rgba(234,90,21,0)');
    c.fillStyle = gr; c.fillRect(mx - 700, CY - 700, 1400, 1400);
  }

  // wordmark letters rise through a baseline mask, left to right
  if (t > 13.7) {
    c.save();
    c.beginPath(); c.rect(mx + R * 0.98 + 14, 0, W, LK.base + 8); c.clip();
    font(c, HK, 500, LK.size); c.fillStyle = C.ink;
    const l = lay(c, 'Cowork');
    l.L.forEach((it, i) => {
      const u = E.outExpo(prog(t, 13.78 + i * 0.045, 14.5 + i * 0.045));
      c.fillText(it.ch, LK.tx + it.x + (1 - u) * -30, LK.base + (1 - u) * LK.cap * 1.3);
    });
    c.restore();
  }

  drawMark(c, mx, CY, R, { arc: p.arc, dot: 0 });
  for (let e = 3; e >= 1; e--) {
    const q = dotRide(R, E.inOutCubic(prog(t - e * 0.02, 13.02, 13.62)) * TAU);
    c.globalAlpha = 0.25 * (1 - e / 4) * bump(ride);
    circle(c, mx + q.x, CY + q.y, R * 0.26, C.or);
  }
  c.globalAlpha = 1;
  const pulse = 1 + 0.3 * bump(prog(t, 13.6, 13.82));
  circle(c, mx + p.x, CY + p.y, R * 0.26 * pulse, C.or);
  const sw = prog(t, 13.6, 14.2);
  if (sw > 0 && sw < 1) {
    c.strokeStyle = `rgba(234,90,21,${0.7 * (1 - sw)})`; c.lineWidth = 2;
    c.beginPath(); c.arc(mx + 0.72 * R, CY, R * 0.26 + R * 2.2 * E.outCubic(sw), 0, TAU); c.stroke();
  }

  // descriptor line
  const ce = E.outExpo(prog(t, 14.12, 14.85));
  if (ce > 0) {
    const y = CY + 170;
    font(c, NR, 400, 44, true);
    c.save(); c.beginPath(); c.rect(0, y - 50, W, 66); c.clip();
    c.globalAlpha = ce; c.fillStyle = C.warm; c.textAlign = 'center';
    c.fillText('A personal AI assistant', CX, y + (1 - ce) * 52);
    c.restore();
  }
  c.restore();
}

// ---------------------------------------------------------------- dispatch
function drawScene(c, t) {
  c.save();
  if (t < 3) sTitle(c, t);
  else if (t < 5.4) sCuts(c, t);
  else if (t < 8.12) sShapes(c, t);
  else if (t < 9.95) sWorld(c, t);
  else if (t < 11) sMask(c, t);
  else if (t < 12.6) sMontage(c, t);
  else sLockup(c, t);
  c.restore();
}

// ---------------------------------------------------------------- finishing: vignette, grain, interface
const SECTIONS = [
  [0, '01', 'Title'], [3, '02', 'Kinetic type'], [5.4, '03', 'Shape morphs'], [7.75, '04', 'Camera move'],
  [9.95, '05', 'Masks and reveals'], [11, '06', 'Rhythm cuts'], [12.6, '07', 'Logo lockup'],
];
let GRAIN = [], VIG = null;
function initPost() {
  const r = rng(1234);
  for (let k = 0; k < 6; k++) {
    const g = document.createElement('canvas'); g.width = g.height = 256;
    const gc = g.getContext('2d'), img = gc.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + ((r() + r() + r() - 1.5) / 1.5) * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    gc.putImageData(img, 0, 0);
    GRAIN.push(mctx.createPattern(g, 'repeat'));
  }
  VIG = mctx.createRadialGradient(CX, CY, H * 0.42, CX, CY, H * 1.15);
  VIG.addColorStop(0, 'rgba(0,0,0,0)'); VIG.addColorStop(1, 'rgba(0,0,0,0.42)');
  const d = rng(99);
  DUST = Array.from({ length: 70 }, () => ({ x: -1600 + d() * 9000, y: -620 + d() * 1240, r: 1.2 + d() * 2.6, a: 0.12 + d() * 0.3 }));
}
function timecode(t) {
  const f = Math.round(t * FPS);
  const ss = Math.floor(f / FPS), ff = f % FPS;
  return `00:00:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}
function drawUI(c, t) {
  const ov = prog(t, 2.95, 3.25) * (1 - prog(t, 12.45, 12.7));
  if (ov <= 0) return;
  const light = UI === 'light', orange = UI === 'orange';
  const txt = light || orange ? '8,8,8' : '243,238,231';
  const acc = light ? C.deep : orange ? C.bg : UI === 'deep' ? C.warm : C.or;
  c.save(); c.globalAlpha = ov;
  // top left: mark and name
  drawMark(c, 76, 64, 9, { color: `rgb(${txt})`, dotColor: acc });
  font(c, HK, 500, 21); c.fillStyle = `rgba(${txt},0.9)`; c.fillText('Cowork', 100, 71);
  c.textAlign = 'right'; c.fillStyle = `rgba(${txt},0.6)`; c.fillText('Motion reel', W - 64, 71); c.textAlign = 'left';
  // bottom left: section, animated in on change
  let si = 0; SECTIONS.forEach((s, i) => { if (t >= s[0]) si = i; });
  const [s0, num, name] = SECTIONS[si];
  const u = E.outExpo(prog(t, s0, s0 + 0.5));
  c.save(); c.beginPath(); c.rect(50, H - 84, 700, 40); c.clip();
  c.translate(0, (1 - u) * 30);
  font(c, HK, 600, 19); c.letterSpacing = '2px'; c.fillStyle = acc; c.fillText(num, 64, H - 54);
  font(c, HK, 500, 19); c.letterSpacing = '0px'; c.fillStyle = `rgba(${txt},0.85)`; c.fillText(name, 104, H - 54);
  c.restore();
  // bottom right: timecode on fixed cells so digits never jitter
  font(c, HK, 500, 19); c.fillStyle = `rgba(${txt},0.6)`; c.textAlign = 'center';
  const tc = timecode(t); let x = W - 64 - (tc.length - 3) * 12.5 - 3 * 7;
  for (const ch of tc) { const cw = ch === ':' ? 7 : 12.5; c.fillText(ch, x + cw / 2, H - 54); x += cw; }
  c.textAlign = 'left';
  // progress hairline
  c.fillStyle = `rgba(${txt},0.14)`; c.fillRect(64, H - 34, W - 128, 1.5);
  c.fillStyle = acc; c.fillRect(64, H - 34, (W - 128) * (t / DUR), 1.5);
  c.restore();
}
function post(c, t, frame) {
  c.save();
  c.fillStyle = VIG; c.fillRect(0, 0, W, H);
  const g = GRAIN[frame % GRAIN.length];
  const r = rng(frame + 7);
  c.translate(Math.floor(r() * 256), Math.floor(r() * 256));
  c.fillStyle = g;
  c.globalCompositeOperation = 'overlay'; c.globalAlpha = 0.13; c.fillRect(-256, -256, W + 512, H + 512);
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 0.018; c.fillRect(-256, -256, W + 512, H + 512);
  c.restore();
  drawUI(c, t);
}

// ---------------------------------------------------------------- entry points used by capture.mjs
window.renderFrame = (frame, samples = 6, shutter = 0.5) => {
  const t = frame / FPS;
  const dt = shutter / FPS;
  for (let i = 0; i < samples; i++) {
    // forward shutter so a frame on a cut never blends with the previous shot
    const ts = Math.min(DUR - 1e-4, t + 1e-5 + (samples > 1 ? (i / samples) * dt : 0));
    sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over'; sctx.filter = 'none';
    drawScene(sctx, ts);
    actx.globalAlpha = 1 / (i + 1); actx.drawImage(scene, 0, 0);
  }
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.globalAlpha = 1;
  mctx.drawImage(acc, 0, 0);
  post(mctx, t, frame);
};

(async () => {
  const faces = [
    new FontFace(HK, 'url(fonts/hanken-latin.woff2)', { weight: '100 900' }),
    new FontFace(NR, 'url(fonts/newsreader-latin.woff2)', { weight: '200 800' }),
    new FontFace(NR, 'url(fonts/newsreader-italic-latin.woff2)', { weight: '200 800', style: 'italic' }),
  ];
  await Promise.all(faces.map(f => f.load()));
  faces.forEach(f => document.fonts.add(f));
  font(sctx, HK, 800, 1000); CAP_HK = sctx.measureText('H').actualBoundingBoxAscent / 1000;
  font(sctx, NR, 400, 1000); CAP_NR = sctx.measureText('H').actualBoundingBoxAscent / 1000;
  initTitle(sctx); initMask(); initLockup(sctx); initPost();
  window.reelReady = true;
})().catch(e => { window.reelError = String(e && e.stack || e); });
})();
