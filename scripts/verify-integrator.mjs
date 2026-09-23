import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { blackholeFragmentShader, blackholeVertexShader } from '../js/shaders.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const embedded = html.match(/var blackholeFragmentShader = ("[^\n]*");/);
assert.ok(embedded, 'Standalone entry point must embed the shader');
assert.equal(JSON.parse(embedded[1]), blackholeFragmentShader, 'Run npm run build to synchronize index.html');

const browser = await chromium.launch({
  headless: true,
  channel: process.argv.includes('--edge') ? 'msedge' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<canvas id="test"></canvas>');
  await page.addScriptTag({ path: join(root, 'lib/three.min.js') });
  const cases = await page.evaluate(({ fragment, vertex }) => {
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('test') });
    renderer.setSize(1, 1);
    if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Float render targets required');
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.FloatType, minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter, depthBuffer: false,
    });
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(geometry);
    scene.add(quad);
    const functions = fragment.slice(0, fragment.lastIndexOf('void main()'));
    const results = [];
    // An off-axis ray exercises all three spatial momentum components.
    // In a stationary, axisymmetric metric, p_t and L_z must be conserved;
    // the null Hamiltonian must remain close to zero throughout integration.
    for (const spin of [0, 0.75, 0.99]) {
      const material = new THREE.ShaderMaterial({
        vertexShader: vertex, depthTest: false, depthWrite: false,
        fragmentShader: functions + `
void main() {
  vec3 x = vec3(4.0, 2.0, 1.0);
  vec3 n = normalize(vec3(-1.0, 0.1, -0.2));
  float a = ${spin.toFixed(8)} * M;
  vec4 t, xx, yy, zz;
  kerrSchildGinv(x, a, t, xx, yy, zz);
  vec4 p = vec4(0.0, n);
  float A = t.x, B = 2.0 * dot(t.yzw, n);
  float C = dot(p, ginvApply(t, xx, yy, zz, p));
  p.x = (-B + sqrt(B * B - 4.0 * A * C)) / (2.0 * A);
  float initialPt = p.x, initialPz = p.w;
  float initialLz = x.x * p.z - x.y * p.y;
  float maxH = abs(0.5 * dot(p, ginvApply(t, xx, yy, zz, p)));
  float maxPtError = 0.0, maxLzError = 0.0;
  for (int i = 0; i < 50; i++) {
    hamStep(x, p, a, 0.01);
    kerrSchildGinv(x, a, t, xx, yy, zz);
    maxH = max(maxH, abs(0.5 * dot(p, ginvApply(t, xx, yy, zz, p))));
    maxPtError = max(maxPtError, abs(p.x - initialPt));
    maxLzError = max(maxLzError, abs(x.x * p.z - x.y * p.y - initialLz));
  }
  gl_FragColor = vec4(maxPtError, maxH, maxLzError, p.w - initialPz);
}`,
      });
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const values = new Float32Array(4);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, values);
      const [ptError, nullError, angularMomentumError, pzChange] = values;
      results.push({ spin, ptError, nullError, angularMomentumError, pzChange });
      material.dispose();
    }
    if (renderer.getContext().getError() !== 0) throw new Error('WebGL error during integrator check');
    target.dispose(); geometry.dispose(); renderer.dispose();
    return results;
  }, { fragment: blackholeFragmentShader, vertex: blackholeVertexShader });
  assert.deepEqual(errors, [], 'GLSL must compile and execute without errors');
  for (const result of cases) {
    const label = `spin=${result.spin}`;
    assert.ok(Object.values(result).every(Number.isFinite), `${label}: finite output`);
    assert.equal(result.ptError, 0, `${label}: p_t must remain unchanged`);
    assert.ok(result.nullError < 2e-5, `${label}: null Hamiltonian error ${result.nullError}`);
    assert.ok(result.angularMomentumError < 2e-5, `${label}: L_z error ${result.angularMomentumError}`);
    assert.ok(Math.abs(result.pzChange) > 1e-7, `${label}: off-axis p_z must evolve`);
  }
  console.log(JSON.stringify(cases, null, 2));
  console.log('PASS: integrator invariants and standalone shader synchronization');
} finally {
  await browser.close();
}
