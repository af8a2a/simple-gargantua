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
  const checks = await page.evaluate(({ fragment, vertex }) => {
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
    const run = body => {
      const material = new THREE.ShaderMaterial({
        vertexShader: vertex, depthTest: false, depthWrite: false,
        fragmentShader: functions + '\nvoid main() {\n' + body + '\n}',
      });
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const values = new Float32Array(4);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, values);
      material.dispose();
      return Array.from(values);
    };
    const invariants = [];
    const backtraces = [];
    for (const spin of [0, 0.75, 0.99]) {
      // Off-axis rays exercise all three spatial momentum components.
      const [ptError, nullError, angularMomentumError, pzChange] = run(`
  vec3 x = vec3(4.0, 2.0, 1.0);
  vec3 n = normalize(vec3(-1.0, 0.1, -0.2));
  float a = ${spin.toFixed(8)} * M;
  vec4 p = pastDirectedMomentum(x, n, a);
  vec4 t, xx, yy, zz;
  kerrSchildGinv(x, a, t, xx, yy, zz);
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
`);
      invariants.push({ spin, ptError, nullError, angularMomentumError, pzChange });

      // Test supported near/default/far camera distances and central/off-axis
      // directions. Reversing ALL momentum components and affine time must
      // trace the same spatial path, with opposite four-momentum.
      for (const distance of [5.5, 15.5, 36]) for (const offset of [0, 0.3]) {
        const [maxTimeDerivative, alignment, nullError, reversalError] = run(`
  float a = ${spin.toFixed(8)} * M;
  vec3 x = ${distance.toFixed(8)} * normalize(vec3(0.7, 0.6, 0.34));
  vec3 n = normalize(-normalize(x) + ${offset.toFixed(8)} * normalize(vec3(-0.6, 0.7, 0.0)));
  vec4 p = pastDirectedMomentum(x, n, a);
  vec3 reversedX = x;
  vec4 reversedP = -p;
  vec4 t, xx, yy, zz;
  kerrSchildGinv(x, a, t, xx, yy, zz);
  vec4 tangent = ginvApply(t, xx, yy, zz, p);
  float maxDt = tangent.x;
  float alignment = dot(normalize(tangent.yzw), n);
  float maxH = abs(0.5 * dot(p, tangent));
  float reversalError = 0.0;
  for (int i = 0; i < 50; i++) {
    hamStep(x, p, a, 0.01);
    hamStep(reversedX, reversedP, a, -0.01);
    kerrSchildGinv(x, a, t, xx, yy, zz);
    tangent = ginvApply(t, xx, yy, zz, p);
    maxDt = max(maxDt, tangent.x);
    maxH = max(maxH, abs(0.5 * dot(p, tangent)));
    reversalError = max(reversalError, length(x - reversedX) + length(p + reversedP));
  }
  gl_FragColor = vec4(maxDt, alignment, maxH, reversalError);
`);
        backtraces.push({ spin, distance, offset, maxTimeDerivative, alignment, nullError, reversalError });
      }
    }
    // Schwarzschild outgoing light traced into the past: dr/dlambda = -E,
    // with E=(r0-1)/(r0+1) for the unit inward covector used at the camera.
    const [radialError, transverseError, maxTimeDerivative, energyError] = run(`
  const float r0 = 5.5;
  const float energy = (r0 - 1.0) / (r0 + 1.0);
  vec3 x = vec3(r0, 0.0, 0.0);
  vec4 p = pastDirectedMomentum(x, vec3(-1.0, 0.0, 0.0), 0.0);
  float maxDt = -1e20;
  for (int i = 0; i < 100; i++) {
    hamStep(x, p, 0.0, 0.01);
    vec4 t, xx, yy, zz;
    kerrSchildGinv(x, 0.0, t, xx, yy, zz);
    maxDt = max(maxDt, dot(t, p));
  }
  gl_FragColor = vec4(abs(x.x - (r0 - energy)), length(x.yz), maxDt, abs(p.x - energy));
`);
    if (renderer.getContext().getError() !== 0) throw new Error('WebGL error during integrator check');
    target.dispose(); geometry.dispose(); renderer.dispose();
    return { invariants, backtraces, radial: { radialError, transverseError, maxTimeDerivative, energyError } };
  }, { fragment: blackholeFragmentShader, vertex: blackholeVertexShader });
  assert.deepEqual(errors, [], 'GLSL must compile and execute without errors');
  for (const result of checks.invariants) {
    const label = `spin=${result.spin}`;
    assert.ok(Object.values(result).every(Number.isFinite), `${label}: finite output`);
    assert.equal(result.ptError, 0, `${label}: p_t must remain unchanged`);
    assert.ok(result.nullError < 2e-5, `${label}: null Hamiltonian error ${result.nullError}`);
    assert.ok(result.angularMomentumError < 2e-5, `${label}: L_z error ${result.angularMomentumError}`);
    assert.ok(Math.abs(result.pzChange) > 1e-7, `${label}: off-axis p_z must evolve`);
  }
  for (const result of checks.backtraces) {
    const label = `spin=${result.spin}, distance=${result.distance}, offset=${result.offset}`;
    assert.ok(Object.values(result).every(Number.isFinite), `${label}: finite output`);
    assert.ok(result.maxTimeDerivative < 0, `${label}: coordinate time must decrease`);
    assert.ok(result.alignment > 0.9, `${label}: trace must head into the viewing cone`);
    assert.ok(result.nullError < 2e-5, `${label}: null Hamiltonian error ${result.nullError}`);
    assert.ok(result.reversalError < 2e-5, `${label}: full four-momentum reversal must preserve the path`);
  }
  assert.ok(Object.values(checks.radial).every(Number.isFinite));
  assert.ok(checks.radial.radialError < 2e-5, 'Radial trace must match the Schwarzschild analytical solution');
  assert.equal(checks.radial.transverseError, 0, 'Radial ray must remain radial');
  assert.ok(checks.radial.maxTimeDerivative < 0, 'Radial ray must trace into the past');
  assert.ok(checks.radial.energyError < 1e-6, 'Radial ray must retain its analytical energy');
  console.log(JSON.stringify({
    invariants: checks.invariants,
    backtraces: {
      cases: checks.backtraces.length,
      maxTimeDerivative: Math.max(...checks.backtraces.map(r => r.maxTimeDerivative)),
      maxNullError: Math.max(...checks.backtraces.map(r => r.nullError)),
      maxReversalError: Math.max(...checks.backtraces.map(r => r.reversalError)),
    },
    radial: checks.radial,
  }, null, 2));
  console.log('PASS: invariants, past-directed backtraces, analytical radial ray, and standalone synchronization');
} finally {
  await browser.close();
}
