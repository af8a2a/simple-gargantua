import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, '..', 'output');
mkdirSync(outDir, { recursive: true });

const url =
  process.argv[2] ||
  'http://127.0.0.1:8765/index.html?quality=low&static=1&auto=0&el=0.32&az=0.6&dist=13';
const shot = process.argv[3] || join(outDir, 'blackhole-1.png');
const useGpu = process.argv.includes('--gpu');

const launchArgs = useGpu
  ? [
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--use-gl=angle',
      '--use-angle=default',
      '--enable-gpu-rasterization',
    ]
  : [
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
    ];

const browser = await chromium.launch({ headless: true, args: launchArgs });

const page = await browser.newPage({
  viewport: { width: 960, height: 600 },
  deviceScaleFactor: 1,
});

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Wait until at least one FPS sample appears or timeout
await page
  .waitForFunction(
    () => {
      const t = document.getElementById('fps')?.textContent || '';
      return t && t !== '--' && parseFloat(t) > 0;
    },
    { timeout: 45000 },
  )
  .catch(() => {
    logs.push('[wait] fps never updated');
  });

await page.waitForTimeout(2000);

const info = await page.evaluate(() => {
  const canvas = document.getElementById('viewport');
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
  let rendererName = null;
  let vendor = null;
  let glError = null;
  if (gl) {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    rendererName = dbg
      ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    vendor = gl.getParameter(gl.VENDOR);
    glError = gl.getError();
  }
  // Sample a few pixels via readPixels
  let pixels = null;
  if (gl) {
    const w = canvas.width;
    const h = canvas.height;
    const samples = [
      [Math.floor(w * 0.5), Math.floor(h * 0.5)],
      [Math.floor(w * 0.6), Math.floor(h * 0.45)],
      [Math.floor(w * 0.55), Math.floor(h * 0.5)],
      [10, 10],
    ];
    pixels = samples.map(([x, y]) => {
      const px = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return Array.from(px);
    });
  }

  const dataUrl = canvas?.toDataURL('image/png') || '';
  return {
    fps: document.getElementById('fps')?.textContent,
    res: document.getElementById('res')?.textContent,
    quality: document.getElementById('quality')?.textContent,
    canvasSize: canvas ? [canvas.width, canvas.height] : null,
    vendor,
    rendererName,
    glError,
    pixels,
    dataUrlLength: dataUrl.length,
  };
});

const dataUrl = await page.evaluate(() =>
  document.getElementById('viewport')?.toDataURL('image/png'),
);

if (dataUrl && dataUrl.startsWith('data:image/png;base64,')) {
  const b64 = dataUrl.replace('data:image/png;base64,', '');
  writeFileSync(shot, Buffer.from(b64, 'base64'));
  console.log('WROTE_CANVAS', shot, 'bytes', Buffer.from(b64, 'base64').length);
} else {
  try {
    await page.screenshot({ path: shot, timeout: 20000 });
    console.log('WROTE_PAGE', shot);
  } catch (e) {
    logs.push(`[screenshot] ${e.message}`);
  }
}

await browser.close();
console.log(JSON.stringify({ useGpu, info, logs }, null, 2));
