import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'output');
mkdirSync(outDir, { recursive: true });

const spins = [0, 0.5, 0.9];
const browser = await chromium.launch({
  headless: true,
  channel: 'msedge',
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=default'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

for (const a of spins) {
  const url = `http://127.0.0.1:8765/index.html?quality=high&static=1&auto=0&el=0.30&az=0.7&dist=17&a=${a}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // wait for fps or error
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => ({
      fps: document.getElementById('fps')?.textContent,
      err: (() => {
        const el = document.getElementById('boot-error');
        return el && !el.classList.contains('hidden') ? el.textContent : null;
      })(),
      meta: document.getElementById('kerr-meta')?.textContent,
      spin: document.getElementById('spin-val')?.textContent,
    }));
    if ((s.fps && s.fps !== '--' && parseFloat(s.fps) > 0) || s.err) {
      logs.push(`[a=${a}] ${JSON.stringify(s)}`);
      break;
    }
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(6000);
  const shot = join(outDir, `kerr-a${String(a).replace('.', '')}.png`);
  await page.screenshot({ path: shot, fullPage: false, timeout: 30000 });
  logs.push(`shot ${shot}`);
}

await browser.close();
console.log(logs.join('\n'));
