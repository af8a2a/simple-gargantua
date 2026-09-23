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
const browser = await chromium.launch({
  headless: true, channel: process.argv.includes('--edge') ? 'msedge' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<canvas id="test"></canvas>');
  await page.addScriptTag({ path: join(root, 'lib/three.min.js') });
  const results = await page.evaluate(({ fragment, vertex }) => {
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('test') });
    renderer.setSize(1, 1);
    if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Float render targets required');
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.FloatType, minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter, depthBuffer: false,
    });
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2), quad = new THREE.Mesh(geometry);
    scene.add(quad);
    const functions = fragment.slice(0, fragment.lastIndexOf('void main()'));
    const run = body => {
      const material = new THREE.ShaderMaterial({
        vertexShader: vertex, fragmentShader: functions + '\nvoid main(){\n' + body + '\n}',
        uniforms: { uTime: { value: 0 }, uDiskBrightness: { value: 1 } },
        depthTest: false, depthWrite: false,
      });
      quad.material = material; renderer.setRenderTarget(target); renderer.render(scene, camera);
      const values = new Float32Array(4);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, values);
      material.dispose();
      return Array.from(values);
    };
    // Static and zero-Lz circular Schwarzschild sources at r=6M, observed
    // both at infinity and at the actual finite camera position.
    const schwarzschild = run(`
  vec3 x = vec3(3.0, 0.0, 0.0);
  vec4 p = pastDirectedMomentum(x, vec3(-1.0, 0.0, 0.0), 0.0);
  vec4 staticSource = coordinateFourVelocity(x, vec3(0.0), 0.0);
  vec4 observer = coordinateFourVelocity(vec3(15.5, 0.0, 0.0), vec3(0.0), 0.0);
  float observed = dot(p, observer);
  gl_FragColor = vec4(frequencyShift(p, staticSource, p.x),
                     diskFrequencyShift(x, p, 3.0, 0.0, p.x),
                     frequencyShift(p, staticSource, observed),
                     diskFrequencyShift(x, p, 3.0, 0.0, observed));
`);
    const identity = run(`
  vec3 x = vec3(3.0, 0.7, 0.2);
  vec4 p = pastDirectedMomentum(x, normalize(-x), 0.375);
  vec4 u = coordinateFourVelocity(x, vec3(-0.08, 0.1, 0.0), 0.375);
  float nu = dot(p, u);
  gl_FragColor = vec4(frequencyShift(p, u, nu), frequencyShift(7.0*p, u, 7.0*nu),
                     frequencyShift(0.0001*p, u, 0.0001*nu), nu);
`);
    const circular = [];
    const heights = [];
    for (const spin of [0, 0.75, 0.99, 0.998]) {
      for (const radius of ['iscoR(aStar) + 0.01', '3.0', '8.0']) {
        // Radial covectors remain valid escaping-energy rays even inside the
        // ergosphere; tangential directions are tested farther out.
        for (const tangent of radius.startsWith('isco') ? [0] : [-0.25, 0, 0.25]) {
          const values = run(`
  float aStar = ${spin.toFixed(8)}, a = aStar * M;
  float r = ${radius}, rho = sqrt(r*r+a*a);
  vec3 x = vec3(rho, 0.0, 0.0);
  vec3 n = vec3(-sqrt(1.0-(${tangent.toFixed(8)})*(${tangent.toFixed(8)})), ${tangent.toFixed(8)}, 0.0);
  vec4 p = pastDirectedMomentum(x, n, a);
  vec4 observer = coordinateFourVelocity(vec3(sqrt(15.5*15.5+a*a), 0.0, 0.0), vec3(0.0), a);
  float nu = p.x * observer.x;
  float g = diskFrequencyShift(x, p, r, a, nu);
  float scaledG = diskFrequencyShift(x, 0.0001*p, r, a, 0.0001*nu);
  gl_FragColor = vec4(g, p.x, diskFourVelocity(x, r, a).x, abs(g-scaledG));
`);
          circular.push({ spin, radius, tangent, values });
        }
      }
      // The thick-disk extension must be normalized at its actual off-plane
      // location, not with equatorial metric coefficients.
      const pos = [2.5, 0.4, 0.5];
      const u = run(`
  float a = ${spin.toFixed(8)} * M;
  vec3 x = vec3(2.5, 0.4, 0.5);
  float rEq = sqrt(dot(x.xy,x.xy)-a*a);
  gl_FragColor = diskFourVelocity(x, rEq, a);
`);
      heights.push({ spin, pos, u });
    }
    // At these shifted temperatures the palette and hot highlight saturate.
    // Doubling g must therefore multiply all observed intensity by 2^4.
    const bolometric = run(`
  vec3 lo = sampleDiskKerr(1.1, 0.7, 3.0, 0.99, 0.7, 13.0, 1.0);
  vec3 hi = sampleDiskKerr(1.1, 0.7, 6.0, 0.99, 0.7, 13.0, 1.0);
  vec3 dark = sampleDiskKerr(1.1, 0.7, 0.0, 0.99, 0.7, 13.0, 1.0);
  gl_FragColor = vec4(length(lo), length(hi), length(dark), frequencyShift(vec4(1.0), vec4(0.0), 1.0));
`);
    if (renderer.getContext().getError() !== 0) throw new Error('WebGL error');
    target.dispose(); geometry.dispose(); renderer.dispose();
    return { schwarzschild, identity, circular, heights, bolometric };
  }, { fragment, vertex });
  assert.deepEqual(errors, [], 'GLSL must compile and execute without errors');
  const near = (actual, expected, label, tolerance = 2e-5) => {
    assert.ok(Number.isFinite(actual), `${label}: finite output`);
    assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
      `${label}: actual=${actual}, expected=${expected}`);
  };
  const staticG = Math.sqrt(1 - 1/3), circularG = Math.sqrt(1 - 1.5/3);
  const observerUt = 1 / Math.sqrt(1 - 1/15.5);
  [staticG, circularG, staticG*observerUt, circularG*observerUt].forEach((g, i) =>
    near(results.schwarzschild[i], g, `Schwarzschild case ${i}`));
  results.identity.slice(0, 3).forEach((g, i) => near(g, 1, `Same observer case ${i}`));
  assert.ok(results.identity[3] > 0, 'Past-directed momentum must give positive measured frequency');
  const isco = spin => {
    const z1 = 1 + Math.cbrt(1-spin*spin)*(Math.cbrt(1+spin)+Math.cbrt(1-spin));
    const z2 = Math.sqrt(3*spin*spin+z1*z1);
    return 0.5*(3+z2-Math.sqrt((3-z1)*(3+z1+2*z2)));
  };
  let maxFrequencyError = 0;
  for (const { spin, radius, tangent, values } of results.circular) {
    const a = spin*0.5, r = radius.startsWith('isco') ? isco(spin)+0.01 : Number(radius);
    // Independent Boyer-Lindquist circular-orbit reference. At fixed r,theta,
    // u^t and Omega equal their KS values; p_phi=x*p_y-y*p_x is invariant.
    const omega = Math.sqrt(0.5)/(r**1.5+a*Math.sqrt(0.5));
    const ut = (r**1.5+a*Math.sqrt(0.5))/(r**0.75*Math.sqrt(r**1.5-1.5*Math.sqrt(r)+2*a*Math.sqrt(0.5)));
    const [g, pt, measuredUt, scaleError] = values;
    const lz = Math.sqrt(r*r+a*a)*tangent;
    const expected = observerUt / (ut*(1+omega*lz/pt));
    const label = `spin=${spin}, r=${r}, tangent=${tangent}`;
    assert.ok(pt > 0 && g > 0, `${label}: positive escaping photon energy and frequency ratio`);
    near(measuredUt, ut, `${label}: normalized emitter`);
    near(g, expected, `${label}: circular redshift`);
    near(scaleError, 0, `${label}: affine normalization invariance`);
    maxFrequencyError = Math.max(maxFrequencyError, Math.abs(g-expected));
  }
  const doppler = results.circular.filter(r => r.spin===0 && r.radius==='3.0').map(r=>r.values[0]);
  assert.ok(doppler[0] > doppler[1] && doppler[1] > doppler[2], 'Approaching emission must be bluer than receding emission');
  for (const { spin, pos: [x,y,z], u } of results.heights) {
    const a=spin*0.5, s=x*x+y*y+z*z-a*a;
    const r=Math.sqrt((s+Math.sqrt(s*s+4*a*a*z*z))/2);
    const f=r**3/(r**4+a*a*z*z);
    const lp=u[0]+(r*x+a*y)/(r*r+a*a)*u[1]+(r*y-a*x)/(r*r+a*a)*u[2]+z/r*u[3];
    const norm=-(u[0]**2)+u[1]**2+u[2]**2+u[3]**2+f*lp*lp;
    near(norm,-1,`Off-plane four-velocity spin=${spin}`);
  }
  const [lo, hi, dark, invalid] = results.bolometric;
  assert.ok(lo > 0 && hi > lo, 'Emission must respond to g');
  near(hi/lo,16,'Bolometric frequency transformation');
  near(dark,0,'Zero frequency ratio must not emit');
  near(invalid,0,'Invalid emitter must not produce infinite frequency');
  console.log(JSON.stringify({schwarzschild:results.schwarzschild,circularCases:results.circular.length,maxFrequencyError,
    doppler:{approaching:doppler[0],transverse:doppler[1],receding:doppler[2]},
    offPlaneCases:results.heights.length,bolometricRatio:hi/lo},null,2));
  console.log('PASS: physical frequency ratios, finite observer, Doppler direction, normalization and bolometric scaling');
} finally { await browser.close(); }
