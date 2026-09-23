import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { blackholeFragmentShader as fragment, blackholeVertexShader as vertex } from '../js/shaders.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const embedded = readFileSync(join(root, 'index.html'), 'utf8').match(/var blackholeFragmentShader = ("[^\n]*");/);
assert.ok(embedded, 'Standalone shader must be present');
assert.equal(JSON.parse(embedded[1]), fragment, 'Run npm run build to synchronize index.html');
const browser = await chromium.launch({ headless: true, channel: process.argv.includes('--edge') ? 'msedge' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
try {
  const page = await browser.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<canvas id="test"></canvas>');
  await page.addScriptTag({ path: join(root, 'lib/three.min.js') });
  const result = await page.evaluate(({ fragment, vertex }) => {
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('test') });
    renderer.setSize(1, 1);
    if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Float render targets required');
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uFov: { value: 0.74 },
      uCamPos: { value: new THREE.Vector3(8, 0, 0) }, uCamForward: { value: new THREE.Vector3(-1, 0, 0) },
      uCamRight: { value: new THREE.Vector3(0, 0, -1) }, uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uSpin: { value: 0.75 }, uSteps: { value: 1 }, uDiskBrightness: { value: 1 }, uGlow: { value: 0 },
      uExposure: { value: 1 }, uStarDensity: { value: 0 },
      uAlpha: { value: 0.28 }, uLength: { value: 2 }, uUneven: { value: false },
      uTestStep: { value: 0.1 }, uTestMomentumScale: { value: 1 },
    };
    const materials = [];
    const make = source => {
      const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: source, uniforms, depthTest: false, depthWrite: false });
      materials.push(material); return material;
    };
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2), quad = new THREE.Mesh(geometry); scene.add(quad);
    const render = material => {
      quad.material = material; renderer.setRenderTarget(target); renderer.render(scene, camera);
      const out = new Float32Array(4); renderer.readRenderTargetPixels(target, 0, 0, 1, 1, out); return Array.from(out);
    };
    const functions = fragment.slice(0, fragment.lastIndexOf('void main()'));
    const slab = make(functions + `
uniform float uAlpha; uniform float uLength; uniform bool uUneven;
void main() {
  vec3 intensity = vec3(0.0); float transmission = 1.0;
  for (int i=0; i<256; i++) {
    if (i>=int(uSteps)) break;
    float weight = uUneven ? (mod(float(i),2.0)<0.5 ? 0.5 : 1.5) : 1.0;
    vec2 transfer = volumeTransfer(uAlpha, uLength*weight/float(uSteps));
    intensity += vec3(1.0,0.5,0.25)*transfer.y*transmission;
    transmission *= transfer.x;
  }
  gl_FragColor = vec4(intensity,transmission);
}`);
    const slabs = [];
    for (const [alpha, length] of [[0.28, 2], [0, 2], [1e-8, 2], [0.28, 0], [10, 10]]) {
      for (const steps of [1, 2, 20, 40, 100, 256]) for (const uneven of [false, true]) {
        if (uneven && steps === 1) continue;
        uniforms.uAlpha.value = alpha; uniforms.uLength.value = length;
        uniforms.uSteps.value = steps; uniforms.uUneven.value = uneven;
        slabs.push({ alpha, length, steps, uneven, actual: render(slab) });
      }
    }
    const path = make(functions + `
uniform float uTestMomentumScale;
void main() {
  float a=0.5*uSpin; vec3 x=vec3(8.0,0.0,0.1);
  vec4 p=pastDirectedMomentum(x,normalize(vec3(-1.0,0.2,0.01)),a);
  vec4 u=diskFourVelocity(x,sqrt(64.0-a*a),a);
  float base=fluidFramePathLength(p,u,0.3);
  float scaled=fluidFramePathLength(p*uTestMomentumScale,u,0.3/uTestMomentumScale);
  float rest=fluidFramePathLength(vec4(2.0,1.0,0.0,0.0),vec4(1.0,0.0,0.0,0.0),0.3);
  float zero=fluidFramePathLength(p,u,0.0)+fluidFramePathLength(p,u,-0.3);
  gl_FragColor=vec4(base,scaled,rest,zero);
}`);
    const paths = [];
    for (const spin of [0, 0.75, 0.998]) for (const scale of [0.1, 1, 7, 100]) {
      uniforms.uSpin.value = spin; uniforms.uTestMomentumScale.value = scale;
      paths.push({ spin, scale, actual: render(path) });
    }
    // Exercise the production volume block on the same equatorial ray segment.
    // This ray never crosses the discrete disk surface or an escape boundary.
    let source = fragment.replace('vec4 pk = pastDirectedMomentum(xKs, nKs, aDim);',
      'vec4 pk = pastDirectedMomentum(xKs, nKs, aDim);\n  pk *= uTestMomentumScale;');
    if (source === fragment) throw new Error('Momentum injection point not found');
    const stepped = source.replace('    hamStep(x, pk, aDim, dlam);', '    dlam = uTestStep;\n    hamStep(x, pk, aDim, dlam);');
    if (stepped === source) throw new Error('Step injection point not found');
    const marker = stepped.indexOf('  // Keep accumulated foreground emission');
    if (marker < 0) throw new Error('Composition marker not found');
    source = 'uniform float uTestStep; uniform float uTestMomentumScale;\n' + stepped.slice(0, marker) + '\n gl_FragColor=vec4(color,transmittance);\n}';
    const production = make(source);
    const rays = [];
    for (const spin of [0, 0.75, 0.998]) for (const scale of [1, 7]) for (const steps of [4, 8, 16, 32, 64, 128]) {
      uniforms.uSpin.value = spin; uniforms.uSteps.value = steps;
      uniforms.uTestMomentumScale.value = scale; uniforms.uTestStep.value = 0.8 / steps / scale;
      rays.push({ spin, scale, steps, actual: render(production) });
    }
    const glError = renderer.getContext().getError();
    materials.forEach(m => m.dispose()); target.dispose(); geometry.dispose(); renderer.dispose();
    return { slabs, paths, rays, glError };
  }, { fragment, vertex });
  assert.deepEqual(errors, [], 'Shaders must compile without errors'); assert.equal(result.glError, 0);
  let slabError = 0, normalizationError = 0;
  const distance = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  for (const c of result.slabs) {
    const transmission = Math.exp(-c.alpha * c.length);
    const emissionLength = c.alpha === 0 ? c.length : -Math.expm1(-c.alpha * c.length) / c.alpha;
    const error = distance(c.actual, [emissionLength, emissionLength / 2, emissionLength / 4, transmission]);
    assert.ok(error < 3e-5, `Beer-Lambert slab ${JSON.stringify(c)} error=${error}`); slabError = Math.max(slabError, error);
  }
  for (const c of result.paths) {
    const [base, scaled, rest, zero] = c.actual;
    assert.ok(base > 0 && Number.isFinite(base)); assert.ok(Math.abs(base - scaled) < 2e-7, 'Affine normalization must not change length');
    assert.ok(Math.abs(rest - 0.6) < 1e-7); assert.equal(zero, 0);
  }
  const convergence = [];
  for (const spin of [0, 0.75, 0.998]) {
    const cases = result.rays.filter(c => c.spin === spin && c.scale === 1);
    const reference = cases.at(-1).actual;
    const errors = cases.map(c => ({ steps: c.steps, error: distance(c.actual, reference) }));
    assert.ok(reference[3] < 0.99 && reference[3] > 0.01 && reference[0] > 0, 'Must exercise absorption and emission');
    assert.ok(errors[3].error < 3e-5, `Fine integration must converge: ${JSON.stringify(errors)}`);
    assert.ok(errors[3].error < errors[0].error * 0.2 + 2e-6, 'Refinement must reduce midpoint quadrature error');
    for (const c of cases) {
      const scaled = result.rays.find(r => r.spin === spin && r.scale === 7 && r.steps === c.steps);
      const error = distance(c.actual, scaled.actual); normalizationError = Math.max(normalizationError, error);
      assert.ok(error < 3e-5, 'Production radiative transfer must be independent of momentum normalization');
    }
    convergence.push({ spin, errors, reference });
  }
  console.log(JSON.stringify({ slabCases: result.slabs.length, pathCases: result.paths.length, slabError, normalizationError, convergence }, null, 2));
  console.log('PASS: Beer-Lambert absorption, emission integration, affine normalization and production step convergence');
} finally { await browser.close(); }
