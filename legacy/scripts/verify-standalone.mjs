import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'output');
mkdirSync(outDir, { recursive: true });

const url = process.argv[2] || 'http://127.0.0.1:8765/index.html?quality=medium&static=1&auto=0';
const shot = process.argv[3] || join(outDir, 'standalone-check.png');

const browser = await chromium.launch({
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=default',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
  .catch((e) => logs.push(`[wait] ${e.message}`));

await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const err = document.getElementById('boot-error');
  const status = document.getElementById('boot-status');
  const canvas = document.getElementById('viewport');
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
  const w = canvas?.width || 0;
  const h = canvas?.height || 0;
  let pixel = null;
  if (gl && w && h) {
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(w * 0.55), Math.floor(h * 0.45), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    pixel = Array.from(px);
  }
  let dataLen = 0;
  try {
    dataLen = (canvas?.toDataURL('image/png') || '').length;
  } catch (_) {}

  return {
    fps: document.getElementById('fps')?.textContent,
    res: document.getElementById('res')?.textContent,
    quality: document.getElementById('quality')?.textContent,
    bootErrorVisible: err && !err.classList.contains('hidden') && err.textContent,
    bootErrorText: err?.textContent?.slice(0, 500) || '',
    bootStatusHidden: status?.classList.contains('hidden'),
    canvasSize: [w, h],
    pixel,
    dataLen,
  };
});

const dataUrl = await page.evaluate(() => document.getElementById('viewport')?.toDataURL('image/png'));
if (dataUrl?.startsWith('data:image/png;base64,')) {
  writeFileSync(shot, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('WROTE', shot);
}

await browser.close();
console.log(JSON.stringify({ info, logs }, null, 2));
