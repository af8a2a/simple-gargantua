import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const server = await startServer(0);
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true,
    channel: process.argv.includes('--edge') || (process.platform === 'win32' && !process.argv.includes('--chromium')) ? 'msedge' : undefined,
    args: process.argv.includes('--software') ? ['--use-angle=swiftshader', '--enable-unsafe-webgpu'] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url+'/?case=1');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('WebGPU / Slang') || !document.querySelector('#error').hidden);
  assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
  await page.locator('#compare').click();
  await page.waitForFunction(() => document.querySelector('#comparison').textContent.includes('PASS') || !document.querySelector('#error').hidden);
  assert.match(await page.locator('#comparison').textContent(), /PASS/);

  // Actual GPU readback, independent CPU camera directions, non-multiple-of-8
  // sizes, varied bases/FOV and HDR/presentation values. No screenshot-only pass.
  const result = await page.evaluate(async () => {
    const { WebGPURenderer } = await import('/src/render/webgpu-renderer.js');
    const { orbitCamera, cameraRay } = await import('/src/core/camera.js');
    const { angle } = await import('/src/core/math.js');
    const canvas = document.createElement('canvas');
    const errors = [];
    const renderer = await WebGPURenderer.create(canvas, e => errors.push(e.message));
    let maxAngle = 0, count = 0, peakRadiance = 0, pixelError = 0;
    const configurations = [
      { width: 65, height: 49, elevation: 0, azimuth: 0, fov: 1 },
      { width: 47, height: 81, elevation: 1.4, azimuth: 2, fov: 2 },
      { width: 93, height: 51, elevation: -.6, azimuth: -1.7, fov: .3 },
    ];
    try {
      renderer.device.pushErrorScope('validation');
      for (const config of configurations) {
        renderer.resize(config.width, config.height);
        const camera = orbitCamera(config);
        renderer.render(camera);
        const rays = await renderer.readDirections();
        for (let y=0;y<config.height;y++) for (let x=0;x<config.width;x++) {
          const i=4*(y*config.width+x), d=Array.from(rays.subarray(i,i+3));
          if (!d.every(Number.isFinite) || rays[i+3] !== 1 || Math.hypot(...d) < .99) throw new Error('Invalid GPU ray');
          maxAngle=Math.max(maxAngle,angle(cameraRay(camera,x,y,config.width,config.height),d)); count++;
        }
      }
      // Axis +Z is HDR 3.0 in the compute texture. Read both its float value
      // and the display pixel to check exposure, tone mapping and sRGB exactly once.
      renderer.resize(1,1);
      const camera = orbitCamera({ azimuth: Math.PI, elevation: 0 });
      for (const exposure of [.5, 2]) {
        renderer.render(camera, { exposure });
        const staging = renderer.device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = renderer.device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: renderer.hdr }, { buffer: staging, bytesPerRow: 256 }, [1,1]);
        renderer.device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const hdr = Array.from(new Float32Array(staging.getMappedRange().slice(0,16)));
        staging.unmap(); staging.destroy(); peakRadiance = Math.max(peakRadiance, ...hdr.slice(0,3));
        const check = document.createElement('canvas'); check.width = check.height = 1;
        const ctx = check.getContext('2d'); ctx.drawImage(canvas,0,0);
        const pixel = ctx.getImageData(0,0,1,1).data;
        const expected = hdr.slice(0,3).map(c => { const v=1-Math.exp(-c*exposure); return (v<=.0031308 ? 12.92*v : 1.055*v**(1/2.4)-.055)*255; });
        pixelError = Math.max(pixelError, ...expected.map((v,i) => Math.abs(v-pixel[i])));
      }
      await renderer.device.queue.onSubmittedWorkDone();
      const error = await renderer.device.popErrorScope(); if (error) errors.push(error.message);
      return { maxAngle, count, peakRadiance, pixelError, errors, adapter: { vendor: renderer.adapterInfo?.vendor, architecture: renderer.adapterInfo?.architecture, device: renderer.adapterInfo?.device, description: renderer.adapterInfo?.description }, features: Array.from(renderer.device.features) };
    } finally { renderer.destroy(); }
  });
  assert.deepEqual(result.errors,[]);
  assert.ok(result.maxAngle < 1e-6, JSON.stringify(result));
  assert.ok(result.peakRadiance >= 3, JSON.stringify(result));
  assert.ok(result.pixelError < 2, JSON.stringify(result));
  await mkdir(new URL('../output/verification/', import.meta.url), { recursive: true });
  await page.screenshot({ fullPage: true, path: new URL('../output/verification/flat-grid.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
  await page.locator('#debug').selectOption('direction');
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.locator('#compare').click();
  await page.waitForFunction(() => document.querySelector('#comparison').textContent.includes('PASS'));
  await page.locator('#run-reference').click();
  await page.waitForFunction(() => document.querySelectorAll('#reference-results tr').length === 11);
  await page.screenshot({ fullPage: true, path: new URL('../output/verification/reference.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
  assert.equal(await page.locator('#download').isEnabled(),true);
  await page.locator('#case-select').selectOption('1');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('WebGPU / Slang'));
  assert.deepEqual(errors,[]);
  // Case 0 must remain available with WebGPU absent.
  const cpuPage = await browser.newPage();
  await cpuPage.addInitScript(() => Object.defineProperty(navigator,'gpu',{ value: undefined }));
  await cpuPage.goto(url+'/?case=0');
  await cpuPage.waitForFunction(() => document.querySelectorAll('#reference-results tr').length === 11);
  await cpuPage.locator('#case-select').selectOption('1');
  await cpuPage.waitForFunction(() => !document.querySelector('#error').hidden);
  assert.match(await cpuPage.locator('#error').textContent(),/WebGPU/);
  result.browser = browser.version();
  result.requestedBackend = process.argv.includes('--software') ? 'swiftshader' : 'default';
  await writeFile(new URL('../output/verification/webgpu.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log('WebGPU + Slang verification passed:', JSON.stringify(result,null,2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
