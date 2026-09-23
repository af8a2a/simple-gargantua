import test from 'node:test';
import assert from 'node:assert/strict';
import { orbitCamera, cameraRay } from '../src/core/camera.js';
import { angle, cross, dot } from '../src/core/math.js';
import { CASES, getCase } from '../src/cases/registry.js';

test('camera has right-handed basis and exact center ray; top-left pixel convention', () => {
  const c = orbitCamera({ azimuth: 0, elevation: 0 });
  assert.ok(angle(cameraRay(c,50,50,101,101),[0,0,-1]) < 1e-14);
  assert.ok(angle(cross(c.right,c.up),c.forward.map(v => -v)) < 1e-14);
  const topLeft = cameraRay(c,0,0,101,101);
  assert.ok(topLeft[0] < 0 && topLeft[1] > 0 && topLeft[2] < 0);
  const top = cameraRay(c,50,0,101,101);
  assert.ok(Math.abs(Math.atan2(top[1],-top[2])-Math.atan(100/101*Math.tan(c.fov/2))) < 1e-14);
  for (const elevation of [-1.5,0,1.5]) {
    const camera = orbitCamera({ azimuth: 1.1, elevation });
    assert.ok(Math.abs(dot(camera.forward,camera.up)) < 1e-14);
  }
});

test('case ladder retains every predecessor and blocks unimplemented physics', () => {
  assert.equal(CASES.length,12);
  for (const c of CASES) {
    assert.equal(c.previousId,c.id === 0 ? null : c.id-1);
    assert.equal(c.units,'G=c=M=1');
    if (c.status === 'planned') assert.throws(() => getCase(c.id));
  }
  assert.equal(getCase(0).name,'Reference Integrator');
  assert.equal(getCase(1).referenceId,0);
  assert.equal(CASES[8].referenceId,2); // Kerr sky's physical A/B is Schwarzschild sky
});
