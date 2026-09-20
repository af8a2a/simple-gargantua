import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'output');
mkdirSync(outDir, { recursive: true });

const url = process.argv[2] || 'http://127.0.0.1:8765/index.html?quality=low&static=1&auto=0';
const useEdge = process.argv.includes('--edge');
const channel = useEdge ? 'msedge' : undefined;

const browser = await chromium.launch({
  headless: true,
  channel,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--enable-webgl2',
    '--use-gl=angle',
    '--use-angle=default',
    '--enable-gpu-rasterization',
    '--disable-gpu-sandbox',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => logs.push(`[reqfail] ${req.url()} ${req.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });

// Wait for either FPS update or boot error
for (let i = 0; i < 40; i++) {
  const snap = await page.evaluate(() => ({
    fps: document.getElementById('fps')?.textContent,
    err: (() => {
      const el = document.getElementById('boot-error');
      return el && !el.classList.contains('hidden') ? el.textContent : null;
    })(),
    status: document.getElementById('boot-status')?.textContent,
    statusHidden: document.getElementById('boot-status')?.classList.contains('hidden'),
    quality: document.getElementById('quality')?.textContent,
  }));
  if ((snap.fps && snap.fps !== '--') || snap.err) {
    logs.push(`[snap@${i}] ${JSON.stringify(snap)}`);
    break;
  }
  if (i === 0 || i % 5 === 0) logs.push(`[snap@${i}] ${JSON.stringify(snap)}`);
  await page.waitForTimeout(500);
}

await page.waitForTimeout(2000);

const stats = await page.evaluate(() => {
  const canvas = document.getElementById('viewport');
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
  const w = canvas?.width || 0;
  const h = canvas?.height || 0;
  let nonzero = 0;
  let sum = 0;
  if (gl && w > 0 && h > 0) {
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const step = Math.max(1, Math.floor((w * h) / 20000));
    for (let i = 0; i < w * h; i += step) {
      const o = i * 4;
      const s = buf[o] + buf[o + 1] + buf[o + 2];
      sum += s;
      if (s > 12) nonzero++;
    }
  }

  // Also sample canvas via 2d copy if possible
  let dataUrlLen = 0;
  let center = null;
  try {
    const dataUrl = canvas.toDataURL('image/png');
    dataUrlLen = dataUrl.length;
  } catch (e) {
    dataUrlLen = -1;
  }

  return {
    fps: document.getElementById('fps')?.textContent,
    res: document.getElementById('res')?.textContent,
    quality: document.getElementById('quality')?.textContent,
    bootError: (() => {
      const el = document.getElementById('boot-error');
      return el && !el.classList.contains('hidden') ? el.textContent : '';
    })(),
    bootStatusHidden: document.getElementById('boot-status')?.classList.contains('hidden'),
    canvasSize: [w, h],
    cssSize: [canvas?.style.width, canvas?.style.height],
    nonzeroSamples: nonzero,
    pixelSum: sum,
    dataUrlLen,
  };
});

const fullShot = join(outDir, useEdge ? 'edge-full.png' : 'chrome-full.png');
await page.screenshot({ path: fullShot, fullPage: false, timeout: 30000 });
console.log('FULL', fullShot);

const canvasShot = join(outDir, useEdge ? 'edge-canvas.png' : 'chrome-canvas.png');
try {
  await page.locator('#viewport').screenshot({ path: canvasShot, timeout: 30000 });
  console.log('CANVAS', canvasShot);
} catch (e) {
  logs.push(`[canvas-shot] ${e.message}`);
}

await browser.close();
console.log(JSON.stringify({ useEdge, channel, stats, logs }, null, 2));
