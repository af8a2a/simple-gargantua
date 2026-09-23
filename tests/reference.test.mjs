import test from 'node:test';
import assert from 'node:assert/strict';
import { traceSchwarzschild as trace, rayFromImpact, CRITICAL_IMPACT } from '../src/reference/schwarzschild.js';
import { REGRESSION_RAYS } from '../src/reference/regression-rays.js';
import { angle, dot, normalize } from '../src/core/math.js';

const close = (a,b,tol,label='') => assert.ok(Math.abs(a-b) < tol, `${label}: ${a} vs ${b}, tolerance ${tol}`);

test('fixed regression rays: fate, null constraint, monotonic time, finite state', () => {
  for (const { id, ray, options, expected } of REGRESSION_RAYS) {
    const r = trace(ray, options);
    assert.equal(r.status, expected, id);
    assert.ok(r.diagnostics.maxNullResidual < 1e-9, id);
    assert.ok(r.travelTime > 0 && r.affine > 0, id);
    assert.ok([...r.photon.x, ...r.photon.p].every(Number.isFinite), id);
    assert.equal(r.photon.p[0], 1);
    assert.equal(r.photon.x[0], -r.travelTime);
    assert.equal(r.escapedDirection !== null, expected === 'escaped');
    if (id === 'multiple-orbit') assert.ok(r.winding > 3);
    if (r.status === 'escaped') close(Math.hypot(...r.photon.x.slice(1)), r.settings.escapeRadius, 1e-9);
    else close(Math.hypot(...r.photon.x.slice(1)), 2+r.settings.horizonEpsilon, 1e-12);
  }
});

test('radial rays agree with analytic affine distance and Schwarzschild coordinate time', () => {
  const tortoise = r => r+2*Math.log(r-2);
  for (const direction of [[1,0,0], [-1,0,0]]) {
    const result = trace({ position: [30,0,0], direction }, { escapeRadius: 300 });
    const end = direction[0] > 0 ? 300 : 2+result.settings.horizonEpsilon;
    close(result.affine, Math.abs(end-30), 1e-10, 'affine distance');
    close(result.travelTime, Math.abs(tortoise(end)-tortoise(30)), 2e-7, 'coordinate time');
    close(result.winding, 0, 1e-15);
  }
});

test('exact photon sphere remains at r=3, with phi=lambda/sqrt(3) and dt=3dlambda', () => {
  const r = trace({ position: [3,0,0], direction: [0,1,0] }, { maxAffine: 100 });
  assert.equal(r.status, 'unresolved'); assert.equal(r.reason, 'affine-budget');
  close(r.impactParameter, CRITICAL_IMPACT, 2e-15);
  close(r.closestApproach, 3, 1e-13);
  close(r.planeAngle, 100/Math.sqrt(3), 1e-11);
  close(r.travelTime, 300, 1e-10);
});

// Independent first-integral quadrature. r = turningRadius+s² removes the
// integrable turning-point singularity; it does not reuse the ODE or RK method.
function scatteringQuadrature(b, start, end) {
  const turning = 2*b/Math.sqrt(3)*Math.cos(Math.acos(-3*Math.sqrt(3)/b)/3);
  const deriv = 2*b*b*(turning-3)/(turning**4);
  const integral = (radius, time) => {
    const max = Math.sqrt(radius-turning), n = 16384, h = max/n;
    const sample = s => {
      const r = turning+s*s;
      // Factored numerator avoids cancellation at the cubic root.
      const potential = (r-turning)*(r*r+r*turning+turning*turning-b*b)/(r*r*r);
      const weight = s === 0 ? 2/Math.sqrt(deriv) : 2*s/Math.sqrt(potential);
      return weight*(time ? 1/(1-2/r) : b/(r*r));
    };
    let sum = sample(0)+sample(max);
    for (let i=1; i<n; i++) sum += (i%2 ? 4 : 2)*sample(i*h);
    return sum*h/3;
  };
  return { turning, phi: integral(start,false)+integral(end,false), time: integral(start,true)+integral(end,true) };
}

test('closest radius, deflection and travel time agree with independent first-integral quadrature', () => {
  for (const b of [6, 5.20, 10]) {
    const r = trace(rayFromImpact(b,100), { escapeRadius: 200 });
    const q = scatteringQuadrature(b,100,200);
    close(r.closestApproach, q.turning, 3e-9, 'turning root');
    close(r.planeAngle, q.phi, 2e-8, 'deflection');
    close(r.travelTime, q.time, 2e-7, 'time');
  }
});

test('weak-field far-observer deflection approaches 4M/b', () => {
  const b = 1000;
  const ray = rayFromImpact(b,1e6);
  const r = trace(ray, { escapeRadius: 2e6, maxStep: 10000 });
  assert.equal(r.status, 'escaped');
  const deflection = angle(normalize(ray.direction), r.escapedDirection);
  assert.ok(Math.abs(deflection/(4/b)-1) < .005, `deflection=${deflection}`);
});

test('tightening tolerances converges, including near-critical multi-orbit rays', () => {
  for (const b of [6, 5.2, CRITICAL_IMPACT*(1+1e-6), CRITICAL_IMPACT*(1+1e-8)]) {
    const ray = rayFromImpact(b);
    const results = [1e-8,1e-13,1e-14].map(t => trace(ray, { relativeTolerance: t, absoluteTolerance: t*.1 }));
    assert.ok(results.every(r => r.status === 'escaped'));
    const e0 = angle(results[0].escapedDirection, results[2].escapedDirection);
    const e1 = angle(results[1].escapedDirection, results[2].escapedDirection);
    assert.ok(e1 < e0*.15, `b=${b}, angular errors ${e0} -> ${e1}`);
    assert.ok(e1 < (b < 5.197 ? 2e-4 : 1e-7));
    assert.ok(Math.abs(results[1].travelTime-results[2].travelTime) < Math.abs(results[0].travelTime-results[2].travelTime));
    assert.ok(results[1].diagnostics.maxNullResidual < results[0].diagnostics.maxNullResidual);
  }
});

test('disk intersections are refined, ordered, complete under step changes, and ignore self-hits', () => {
  const ray = rayFromImpact(CRITICAL_IMPACT*(1+1e-6));
  // Rotate the orbital plane about Z; intersections are y=0 in the world frame.
  const rotate = ([x,y,z]) => [(x-y)/Math.sqrt(2),(x+y)/Math.sqrt(2),z];
  const tilted = { position: rotate(ray.position), direction: rotate(ray.direction) };
  const a = trace(tilted, { diskInner: 2.5, diskOuter: 200 });
  const b = trace(tilted, { diskInner: 2.5, diskOuter: 200, maxStep: .25 });
  assert.ok(a.diskIntersections.length >= 4);
  assert.equal(a.diskIntersections.length, b.diskIntersections.length);
  a.diskIntersections.forEach((hit,i) => {
    close(hit.position[1],0,1e-10);
    close(hit.radius,b.diskIntersections[i].radius,1e-5);
    close(hit.travelTime,b.diskIntersections[i].travelTime,1e-4);
    assert.ok(hit.affine > 0 && hit.travelTime > 0);
    if (i) assert.ok(hit.travelTime > a.diskIntersections[i-1].travelTime);
  });
  const coplanar = trace({ position: [100,0,0], direction: [-.99,0,.1] });
  assert.equal(coplanar.diskCoplanar,true); assert.deepEqual(coplanar.diskIntersections,[]);
});

test('spherical symmetry: rotate rays and rotate output directions without changing scalars', () => {
  const rotate = ([x,y,z]) => [z,x,y];
  const ray = rayFromImpact(6);
  const a = trace(ray), b = trace({ position: rotate(ray.position), direction: rotate(ray.direction) });
  assert.equal(a.status,b.status);
  close(a.travelTime,b.travelTime,1e-9); close(a.closestApproach,b.closestApproach,1e-10);
  assert.ok(angle(rotate(a.escapedDirection),b.escapedDirection) < 1e-10);
  // Four-momentum in areal Cartesian coordinates obeys the inverse metric.
  const p = a.photon.p.slice(1), x = a.photon.x.slice(1), r = Math.hypot(...x), er = normalize(x);
  close(dot(p,p)-(2/r)*dot(p,er)**2-1/(1-2/r),0,1e-9);
});

test('budget exhaustion is unresolved, and malformed input is rejected', () => {
  const ray = rayFromImpact(6);
  const r = trace(ray, { maxSteps: 1 });
  assert.equal(r.status,'unresolved'); assert.equal(r.captured,false); assert.equal(r.escapedDirection,null);
  assert.equal(trace(ray,{ minStep: .2, initialStep: .1 }).reason, 'step-underflow');
  for (const options of [{ typoTolerance: 1e-10 }, { horizonEpsilon: 1e-20 }, { relativeTolerance: 0 }, { maxSteps: 1.5 }, { escapeRadius: 50 }, { maxStep: NaN }]) assert.throws(() => trace(ray, options), RangeError);
  assert.throws(() => trace({ position: [0,0,0], direction: [1,0,0] }),RangeError);
  assert.throws(() => trace({ position: [30,0,0], direction: [0,0,0] }),RangeError);
});
