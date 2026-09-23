import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, '..', 'output');
mkdirSync(outDir, { recursive: true });

const url =
  process.argv[2] ||
  'http://127.0.0.1:8765/index.html?quality=high&static=1&auto=0&el=0.22&az=0.55&dist=12.5';
const shot = process.argv[3] || join(outDir, 'blackhole-high.png');

const browser = await chromium.launch({
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=default',
    '--enable-gpu-rasterization',
  ],
});

const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page
  .waitForFunction(
    () => {
      const t = document.getElementById('fps')?.textContent || '';
      return t && t !== '--' && parseFloat(t) > 0;
    },
    { timeout: 40000 },
  )
  .catch(() => logs.push('[wait] fps timeout'));
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const canvas = document.getElementById('viewport');
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
  const w = canvas.width;
  const h = canvas.height;

  // Sample disk-ish bands: left, center-left, center-right, right near mid height
  const samples = {};
  const grab = (x, y) => {
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(x), Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Array.from(px);
  };

  // In WebGL, readPixels origin is bottom-left
  samples.left = grab(w * 0.22, h * 0.42);
  samples.leftMid = grab(w * 0.32, h * 0.38);
  samples.rightMid = grab(w * 0.68, h * 0.38);
  samples.right = grab(w * 0.78, h * 0.42);
  samples.topArc = grab(w * 0.5, h * 0.78);
  samples.horizon = grab(w * 0.5, h * 0.5);
  samples.bg = grab(w * 0.08, h * 0.12);

  return {
    fps: document.getElementById('fps')?.textContent,
    res: document.getElementById('res')?.textContent,
    quality: document.getElementById('quality')?.textContent,
    canvasSize: [w, h],
    samples,
  };
});

const dataUrl = await page.evaluate(() =>
  document.getElementById('viewport')?.toDataURL('image/png'),
);
if (dataUrl?.startsWith('data:image/png;base64,')) {
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(shot, buf);
  console.log('WROTE', shot, buf.length);
}

await browser.close();
console.log(JSON.stringify({ info, logs }, null, 2));
