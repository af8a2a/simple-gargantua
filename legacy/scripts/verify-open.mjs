import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'output');
mkdirSync(outDir, { recursive: true });

const mode = process.argv[2] || 'file'; // file | http
const useEdge = process.argv.includes('--edge');

let url;
if (mode === 'file') {
  url = 'file:///E:/Gargantua/index.html?quality=low&static=1&auto=0';
} else {
  url = 'http://127.0.0.1:8765/index.html?quality=low&static=1&auto=0';
}

const browser = await chromium.launch({
  headless: true,
  channel: useEdge ? 'msedge' : undefined,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=default',
    '--allow-file-access-from-files',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

let snap = null;
for (let i = 0; i < 30; i++) {
  snap = await page.evaluate(() => {
    const fps = document.getElementById('fps')?.textContent;
    const errEl = document.getElementById('boot-error');
    return {
      fps,
      res: document.getElementById('res')?.textContent,
      quality: document.getElementById('quality')?.textContent,
      err: errEl && !errEl.classList.contains('hidden') ? errEl.textContent : null,
      statusHidden: document.getElementById('boot-status')?.classList.contains('hidden'),
      hasThree: typeof window.THREE !== 'undefined',
    };
  });
  if ((snap.fps && snap.fps !== '--') || snap.err) break;
  await page.waitForTimeout(400);
}

await page.waitForTimeout(1500);

const shot = join(outDir, `edge-${mode}.png`);
await page.screenshot({ path: shot, fullPage: false, timeout: 30000 });

await browser.close();
console.log(JSON.stringify({ mode, useEdge, url, snap, logs, shot }, null, 2));
