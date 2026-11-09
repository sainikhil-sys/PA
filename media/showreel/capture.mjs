// Renders the reel in headless Chromium and encodes it with ffmpeg.
//   node media/showreel/capture.mjs --stills 1.0,4.2,9.1 [--out dir]      PNG stills at those times
//   node media/showreel/capture.mjs --video out/cowork-reel.mp4 [--workers 6]
// Frames are a pure function of time, so the video is split across workers that each
// encode one segment; the segments are then joined without re-encoding.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const FPS = 60, FRAMES = 900;
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const samples = Number(opt('samples') ?? 6);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

// Prefer the cached Chromium build when the installed Playwright expects a newer one.
const cached = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe');
async function open() {
  const browser = await chromium.launch({
    executablePath: process.env.REEL_CHROME ?? (fs.existsSync(cached) ? cached : undefined),
    args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.reelReady || window.reelError, null, { timeout: 30000 });
  const err = await page.evaluate(() => window.reelError);
  if (err) throw new Error(err);
  const frame = async n => {
    const data = await page.evaluate(([f, s]) => {
      window.renderFrame(f, s);
      return document.getElementById('c').toDataURL('image/png');
    }, [n, samples]);
    return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
  };
  return { browser, frame };
}

function encoder(out) {
  const ff = spawn('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-tune', 'film',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-r', String(FPS), out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  return {
    write: async buf => { if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); },
    end: () => { ff.stdin.end(); return done; },
  };
}

if (opt('stills')) {
  const out = path.resolve(opt('out') ?? path.join(root, 'out', 'stills'));
  fs.mkdirSync(out, { recursive: true });
  const { browser, frame } = await open();
  for (const s of opt('stills').split(',')) {
    const n = Math.round(Number(s) * FPS);
    fs.writeFileSync(path.join(out, `f${String(n).padStart(3, '0')}.png`), await frame(n));
  }
  await browser.close();
  console.log('stills written to', out);
} else if (opt('video')) {
  const out = path.resolve(opt('video'));
  const workers = Number(opt('workers') ?? 6);
  const segDir = path.join(path.dirname(out), 'segments');
  fs.mkdirSync(segDir, { recursive: true });
  const per = Math.ceil(FRAMES / workers);
  const t0 = Date.now();
  let rendered = 0;
  const segs = await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = w * per, b = Math.min(FRAMES, a + per);
    const seg = path.join(segDir, `seg${w}.mp4`);
    const { browser, frame } = await open();
    const enc = encoder(seg);
    for (let n = a; n < b; n++) {
      await enc.write(await frame(n));
      if (++rendered % 60 === 0) console.log(`${rendered}/${FRAMES} frames  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    await enc.end();
    await browser.close();
    return seg;
  }));
  const list = path.join(segDir, 'list.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
  await new Promise((res, rej) => {
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' });
    ff.on('close', c => (c === 0 ? res() : rej(new Error(`concat exited ${c}`))));
  });
  fs.rmSync(segDir, { recursive: true, force: true });
  console.log('video written to', out, `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

server.close();
