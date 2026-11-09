// Synthesised sound design for the reel, timed to the same cue points as reel.js.
//   node media/showreel/sound.mjs out/sound.wav
import fs from 'node:fs';
import path from 'node:path';

const SR = 48000, DUR = 15, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const sendL = new Float32Array(N), sendR = new Float32Array(N);
const TAU = Math.PI * 2;

let seed = 7;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function put(i, v, pan, send) {
  if (i < 0 || i >= N) return;
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  L[i] += v * gl; R[i] += v * gr;
  sendL[i] += v * gl * send; sendR[i] += v * gr * send;
}

// pitched voice with an exponential glide and attack / exponential decay envelope
function tone(t0, dur, { f0, f1 = f0, amp = 0.2, att = 0.005, decay = 6, pan = 0, send = 0.2, partials = [[1, 1]] }) {
  const i0 = Math.round(t0 * SR), n = Math.round(dur * SR);
  const ph = partials.map(() => 0);
  for (let k = 0; k < n; k++) {
    const t = k / SR, u = k / n;
    const f = f0 * Math.pow(f1 / f0, u);
    const env = Math.min(1, t / att) * Math.exp(-decay * t) * Math.min(1, (n - k) / (SR * 0.01));
    let v = 0;
    partials.forEach(([m, a], p) => { ph[p] += (TAU * f * m) / SR; v += Math.sin(ph[p]) * a; });
    put(i0 + k, v * env * amp, pan, send);
  }
}

// filtered noise with a time-varying cutoff (Chamberlin state-variable filter)
function noise(t0, dur, { fc0, fc1 = fc0, q = 0.7, amp = 0.2, shape = u => Math.sin(Math.PI * u), mode = 'band', pan = 0, send = 0.3 }) {
  const i0 = Math.round(t0 * SR), n = Math.round(dur * SR);
  let low = 0, band = 0;
  for (let k = 0; k < n; k++) {
    const u = k / n;
    const fc = fc0 * Math.pow(fc1 / fc0, u);
    const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR);
    const x = rand() * 2 - 1;
    low += f * band; const high = x - low - q * band; band += f * high;
    const v = mode === 'band' ? band : mode === 'low' ? low : high;
    put(i0 + k, v * shape(u) * amp, pan, send);
  }
}

const kick = (t, amp = 0.6, dec = 7) => {
  const i0 = Math.round(t * SR), n = Math.round(0.9 * SR); let ph = 0;
  for (let k = 0; k < n; k++) {
    const s = k / SR;
    ph += (TAU * (44 + 120 * Math.exp(-s * 32))) / SR;
    put(i0 + k, Math.sin(ph) * Math.exp(-s * dec) * Math.min(1, s / 0.002) * amp, 0, 0.05);
  }
  noise(t, 0.02, { fc0: 3500, amp: amp * 0.5, shape: u => 1 - u, send: 0.05 });
};
const tick = (t, f = 2400, amp = 0.08, pan = 0) => noise(t, 0.035, { fc0: f, q: 0.25, amp, shape: u => Math.pow(1 - u, 3), pan, send: 0.25 });
const pluck = (t, f, amp = 0.06, pan = 0) => tone(t, 0.5, { f0: f, amp, decay: 9, pan, send: 0.45, partials: [[1, 1], [2, 0.3], [3, 0.08]] });
const whoosh = (t, dur, a, b, amp = 0.25, rise = true) =>
  noise(t, dur, { fc0: a, fc1: b, q: 0.5, amp, shape: rise ? u => Math.pow(u, 2.2) * (1 - Math.pow(u, 40)) : u => Math.pow(1 - u, 1.6) * Math.min(1, u * 30) });
const pad = (t0, dur, freqs, amp) => freqs.forEach((f, i) => {
  const i0 = Math.round(t0 * SR), n = Math.round(dur * SR); let ph = rand() * TAU;
  for (let k = 0; k < n; k++) {
    const u = k / n;
    ph += (TAU * f * (1 + 0.0015 * Math.sin(k / SR * 0.7 * TAU + i))) / SR;
    put(i0 + k, Math.sin(ph) * amp * Math.sin(Math.PI * u) ** 0.7, i % 2 ? 0.35 : -0.35, 0.5);
  }
});

const A = 440, note = st => A * Math.pow(2, st / 12);
const SCALE = [-12, -9, -7, -5, -2, 0, 3, 5, 7, 10, 12]; // A minor pentatonic around A4

// 01 title
pad(0, 3.05, [55, 110, 164.8], 0.05);
noise(0.0, 0.6, { fc0: 600, fc1: 4000, amp: 0.05, shape: u => Math.sin(Math.PI * u) });
for (let i = 0; i < 6; i++) pluck(0.36 + i * 0.06, note(SCALE[4 + i]), 0.045, -0.5 + i * 0.2);
tone(1.38, 0.56, { f0: 300, f1: 900, amp: 0.035, att: 0.2, decay: 0.5, send: 0.4 });
whoosh(1.38, 0.56, 800, 5000, 0.08);
tone(1.92, 0.4, { f0: 1100, f1: 520, amp: 0.09, decay: 14, send: 0.4 });
kick(1.92, 0.25, 12);
whoosh(2.42, 0.58, 300, 7000, 0.32);
tone(2.42, 0.58, { f0: 110, f1: 440, amp: 0.05, att: 0.4, decay: 0, send: 0.2 });

// 02 kinetic type, a hit on every cut
for (let k = 0; k < 8; k++) {
  const t = 3 + k * 0.3;
  kick(t, k === 0 ? 0.75 : 0.45, k === 0 ? 5 : 9);
  tick(t, 2000 + k * 300, 0.1, k % 2 ? 0.4 : -0.4);
  pluck(t, note(SCALE[[5, 7, 6, 8, 5, 9, 7, 10][k]]), 0.05, k % 2 ? -0.3 : 0.3);
  tick(t + 0.15, 6000, 0.035, k % 2 ? -0.5 : 0.5);
}

// 03 shape morphs: a blip per morph, ripple of ticks when the grid appears
kick(5.4, 0.5, 8);
for (let k = 0; k < 6; k++) {
  const t = 5.58 + k * 0.29;
  tone(t, 0.3, { f0: note(SCALE[3 + k]), amp: 0.06, att: 0.04, decay: 8, send: 0.5, partials: [[1, 1], [2, 0.15]] });
  whoosh(t - 0.04, 0.27, 1500, 6000, 0.05);
}
for (let k = 0; k < 40; k++) {
  const u = k / 40;
  tick(7.3 + u * 0.5 + rand() * 0.02, 3000 + rand() * 4000, 0.05 * (1 - u * 0.7), rand() * 1.6 - 0.8);
}
whoosh(7.7, 0.4, 400, 3000, 0.16);

// 04 camera move
pad(7.9, 2.1, [73.4, 110, 146.8, 220], 0.04);
kick(8.0, 0.3, 8);
for (const tb of [7.98, 8.4, 9.04]) { pluck(tb + 0.05, note(0), 0.05, -0.3); pluck(tb + 0.12, note(7), 0.04, 0.3); tick(tb + 0.48, 4000, 0.04); }
whoosh(9.56, 0.4, 300, 9000, 0.4);
whoosh(8.18, 0.44, 500, 3500, 0.1); whoosh(8.82, 0.44, 500, 3500, 0.1);

// 05 masks and reveals
kick(9.95, 0.7, 5);
noise(9.95, 0.85, { fc0: 6000, fc1: 300, q: 0.6, amp: 0.14, shape: u => Math.pow(1 - u, 1.5) });
pad(9.95, 1.0, [82.4, 123.5, 164.8], 0.035);
for (let i = 0; i < 12; i++) tick(10.74 + i * 0.01, 1500 + i * 250, 0.05, i % 2 ? 0.6 : -0.6);

// 06 montage, faster hits
for (let k = 0; k < 8; k++) {
  const t = 11 + k * 0.2;
  kick(t, 0.5, 10);
  tick(t, 2600 + k * 200, 0.09, k % 2 ? 0.5 : -0.5);
  tick(t + 0.1, 7000, 0.04, k % 2 ? -0.5 : 0.5);
  pluck(t, note(SCALE[[5, 8, 6, 9, 7, 10, 8, 10][k]]), 0.04);
}
whoosh(12.6, 0.4, 5000, 400, 0.18, false);

// 07 lockup
tone(13.02, 0.6, { f0: 330, f1: 660, amp: 0.03, att: 0.3, decay: 1, send: 0.5 });
kick(13.62, 0.5, 4);
[110, 164.8, 220, 277.2, 329.6, 493.9].forEach((f, i) =>
  tone(13.62, 1.38, { f0: f, amp: 0.05 - i * 0.004, att: 0.03, decay: 1.6, pan: (i % 2 ? 1 : -1) * 0.25, send: 0.6, partials: [[1, 1], [2, 0.12]] }));
tone(14.12, 0.88, { f0: 880, amp: 0.03, att: 0.01, decay: 4, send: 0.7, partials: [[1, 1], [2.76, 0.3]] });

// reverb: Schroeder combs and allpasses on the send bus
function reverb(inp, offs) {
  const out = new Float32Array(N);
  for (const [d, g] of [[1557, 0.8], [1617, 0.8], [1491, 0.79], [1422, 0.78]].map(([d, g]) => [d + offs, g])) {
    const buf = new Float32Array(d); let p = 0, lp = 0;
    for (let i = 0; i < N; i++) {
      const y = buf[p]; lp = y * 0.7 + lp * 0.3;
      buf[p] = inp[i] + lp * g; p = (p + 1) % d; out[i] += y * 0.25;
    }
  }
  for (const d of [225 + offs, 556 + offs]) {
    const buf = new Float32Array(d); let p = 0;
    for (let i = 0; i < N; i++) { const b = buf[p]; const y = -out[i] + b; buf[p] = out[i] + b * 0.5; out[i] = y; p = (p + 1) % d; }
  }
  return out;
}
const wl = reverb(sendL, 0), wr = reverb(sendR, 23);

// master: sum, high-pass, gentle saturation, normalise, fade the last few frames
let peak = 0, hl = 0, hr = 0, pl = 0, pr = 0;
const hp = Math.exp(-TAU * 25 / SR);
for (let i = 0; i < N; i++) {
  let l = L[i] + wl[i] * 0.55, r = R[i] + wr[i] * 0.55;
  hl = hp * (hl + l - pl); pl = l; hr = hp * (hr + r - pr); pr = r;
  l = Math.tanh(hl * 1.4); r = Math.tanh(hr * 1.4);
  const fade = Math.min(1, (N - i) / (SR * 0.3));
  L[i] = l * fade; R[i] = r * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.89 / peak;
const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const d = (rand() - rand()) / 32768; // TPDF dither
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain + d)) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain + d)) * 32767), 46 + i * 4);
}
const file = path.resolve(process.argv[2] ?? 'sound.wav');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, out);
console.log('wrote', file, 'peak before gain', peak.toFixed(3));
