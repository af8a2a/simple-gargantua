import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, '..', 'output');
mkdirSync(outDir, { recursive: true });

const url =
  'http://127.0.0.1:8765/index.html?quality=high&static=1&auto=0&el=0.22&az=0.55&dist=12.5';

const browser = await chromium.launch({
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=default',
  ],
});

const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);

// Interact: change quality to ultra, drag canvas
await page.click('button[data-quality="ultra"]');
await page.waitForTimeout(800);

const box = await page.locator('#viewport').boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.42, {
    steps: 12,
  });
  await page.mouse.up();
}

await page.waitForTimeout(2000);

await page.screenshot({
  path: join(outDir, 'blackhole-full-ui.png'),
  fullPage: false,
});

const info = await page.evaluate(() => ({
  fps: document.getElementById('fps')?.textContent,
  res: document.getElementById('res')?.textContent,
  quality: document.getElementById('quality')?.textContent,
  bri: document.getElementById('bri-val')?.textContent,
  title: document.querySelector('.hud-title h1')?.textContent,
  hasControls: !!document.querySelector('.hud-controls'),
  hasStatus: !!document.querySelector('.hud-status'),
}));

await browser.close();
console.log(JSON.stringify({ info, logs }, null, 2));
console.log('WROTE', join(outDir, 'blackhole-full-ui.png'));
