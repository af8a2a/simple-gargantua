import { add, dot, normalize, scale } from '../core/math.js';
import { dopriStep, locateEvent } from './dopri.js';

export const HORIZON = 2;
export const PHOTON_SPHERE = 3;
export const CRITICAL_IMPACT = 3 * Math.sqrt(3);
export const DEFAULT_OPTIONS = Object.freeze({
  absoluteTolerance: 1e-14, relativeTolerance: 1e-13,
  escapeRadius: 1000, horizonEpsilon: 1e-6,
  initialStep: 0.1, maxStep: 20, minStep: 1e-13,
  maxSteps: 200000, maxAffine: 1e7,
  diskInner: 6, diskOuter: 20,
});

function validate(position, direction, o) {
  for (const v of [position, direction]) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new RangeError('Expected finite three-vectors');
  }
  for (const key of Object.keys(DEFAULT_OPTIONS)) {
    if (!Number.isFinite(o[key]) || o[key] <= 0) throw new RangeError(`Invalid ${key}`);
  }
  const r = Math.hypot(...position);
  if (r <= HORIZON + o.horizonEpsilon || r >= o.escapeRadius) throw new RangeError('Camera must be outside capture surface and inside escape sphere');
  if (o.diskInner <= HORIZON || o.diskOuter <= o.diskInner) throw new RangeError('Invalid disk annulus');
  if (!Number.isInteger(o.maxSteps) || o.minStep > o.maxStep) throw new RangeError('Invalid step limits');
}

/**
 * CPU FP64 null geodesics in G=c=M=1. Spherical symmetry reduces the orbit
 * exactly to its plane, without polar-coordinate singularities.
 * y = [areal radius r, dr/dlambda, unwrapped plane angle phi, elapsed |t|].
 * E=1; L=b; r''=L²(r-3)/r⁴, phi'=L/r², |t|'=1/(1-2/r).
 * direction is measured in the STATIC observer's orthonormal spatial frame,
 * expressed along global Cartesian axes; it is not coordinate dx/dlambda.
 * Positive lambda follows a past-directed ray (p_t=+1, t=-elapsed).
 */
export function traceSchwarzschild({ position, direction }, options = {}) {
  for (const key of Object.keys(options)) if (!(key in DEFAULT_OPTIONS)) throw new RangeError(`Unknown option: ${key}`);
  const o = { ...DEFAULT_OPTIONS, ...options };
  if (2 + o.horizonEpsilon === 2) throw new RangeError('Capture surface must be representably outside the horizon');
  validate(position, direction, o);
  const r0 = Math.hypot(...position), er0 = normalize(position), n = normalize(direction);
  const nr = Math.max(-1, Math.min(1, dot(n, er0)));
  const tangent = add(n, scale(er0, -nr));
  const nt = Math.hypot(...tangent);
  // For radial rays the arbitrary plane has no physical effect.
  const helper = Math.abs(er0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const et0 = nt > 1e-14 ? scale(tangent, 1 / nt) : normalize(add(helper, scale(er0, -dot(helper, er0))));
  const b = nt > 1e-14 ? r0 * nt / Math.sqrt(1 - 2 / r0) : 0;
  const rhs = ([r, v]) => [v, b*b*(r-3)/(r*r*r*r), b/(r*r), 1/(1-2/r)];
  const basis = phi => ({
    er: add(scale(er0, Math.cos(phi)), scale(et0, Math.sin(phi))),
    et: add(scale(er0, -Math.sin(phi)), scale(et0, Math.cos(phi))),
  });
  const spatial = y => scale(basis(y[2]).er, y[0]);
  const nullResidual = y => Math.abs(y[1]*y[1] + (1-2/y[0])*b*b/(y[0]*y[0]) - 1);
  const captureRadius = HORIZON + o.horizonEpsilon;
  let y = [r0, nr, 0, 0], affine = 0, h = o.initialStep;
  let closestApproach = r0, acceptedSteps = 0, rejectedSteps = 0, maxNullResidual = nullResidual(y);
  let status = 'unresolved', reason = 'step-budget';
  const diskIntersections = [];
  // Coplanar rays have no isolated intersections; report the degeneracy.
  const diskCoplanar = Math.hypot(er0[1], et0[1]) < 1e-13;
  let nextDiskAngle = ((Math.atan2(-er0[1], et0[1]) % Math.PI) + Math.PI) % Math.PI;
  if (nextDiskAngle < 1e-12) nextDiskAngle += Math.PI; // exclude camera self-hit

  for (let attempt = 0; attempt < o.maxSteps; attempt++) {
    if (affine >= o.maxAffine) { reason = 'affine-budget'; break; }
    h = Math.min(h, o.maxStep, o.maxAffine - affine, 0.15*y[0],
      b > 0 ? 0.05*y[0]*y[0]/b : Infinity,
      y[1] < 0 ? 0.2*(y[0]-HORIZON)/Math.max(Math.abs(y[1]), 1e-6) : Infinity);
    if (h < o.minStep || affine + h === affine) { reason = 'step-underflow'; break; }
    const trial = dopriStep(rhs, y, h);
    const error = Math.max(...trial.error.map((e, i) => Math.abs(e)/(o.absoluteTolerance + o.relativeTolerance*Math.max(Math.abs(y[i]), Math.abs(trial.next[i])))));
    if (!trial.next.every(Number.isFinite) || !Number.isFinite(error)) { reason = 'non-finite'; break; }
    const factor = error === 0 ? 5 : Math.max(0.1, Math.min(5, 0.9*Math.pow(error, -0.2)));
    if (error > 1) { rejectedSteps++; h *= Math.min(1, factor); continue; }
    let next = trial.next, used = h;
    if (next[0] <= captureRadius) {
      const event = locateEvent(rhs, y, h, s => s[0]-captureRadius);
      next = event.state; used = event.step; status = 'captured'; reason = 'capture-surface';
    } else if (next[0] >= o.escapeRadius && next[1] > 0) {
      const event = locateEvent(rhs, y, h, s => s[0]-o.escapeRadius);
      next = event.state; used = event.step; status = 'escaped'; reason = 'escape-surface';
    }
    if (y[1] < 0 && next[1] >= 0) {
      closestApproach = Math.min(closestApproach, locateEvent(rhs, y, used, s => s[1]).state[0]);
    }
    if (!diskCoplanar && b > 0 && next[2] >= nextDiskAngle) {
      const event = locateEvent(rhs, y, used, s => s[2]-nextDiskAngle);
      const at = event.state;
      if (at[0] >= o.diskInner && at[0] <= o.diskOuter) {
        const point = spatial(at);
        diskIntersections.push({ position: point, radius: at[0], azimuth: Math.atan2(point[2], point[0]),
          planeAngle: at[2], halfOrbit: Math.floor(at[2]/Math.PI), travelTime: at[3], affine: affine+event.step });
      }
      nextDiskAngle += Math.PI;
    }
    y = next; affine += used; acceptedSteps++;
    closestApproach = Math.min(closestApproach, y[0]);
    maxNullResidual = Math.max(maxNullResidual, nullResidual(y));
    if (status !== 'unresolved') break;
    h *= factor;
  }
  const { er, et } = basis(y[2]);
  const f = 1-2/y[0];
  const velocity = add(scale(er, y[1]), scale(et, b/y[0]));
  const covariantP = add(scale(er, y[1]/f), scale(et, b/y[0]));
  return {
    status, reason, captured: status === 'captured',
    // Direction at the FINITE escape sphere, in areal Cartesian coordinates.
    // Compare GPU and CPU at the same sphere; this is not an infinity estimate.
    escapedDirection: status === 'escaped' ? normalize(velocity) : null,
    closestApproach, diskIntersections, diskCoplanar, travelTime: y[3], affine,
    impactParameter: b, winding: y[2]/(2*Math.PI), planeAngle: y[2],
    photon: { x: [-y[3], ...spatial(y)], p: [1, ...covariantP] },
    diagnostics: { acceptedSteps, rejectedSteps, maxNullResidual, finalNullResidual: nullResidual(y) },
    settings: o,
  };
}

// Inward launch at a finite radius with precisely specified L/E (not r*sin a).
export function rayFromImpact(impactParameter, radius = 100) {
  if (!Number.isFinite(radius) || radius <= 2 || !Number.isFinite(impactParameter) || impactParameter < 0) throw new RangeError('Invalid impact ray');
  const s = impactParameter*Math.sqrt(1-2/radius)/radius;
  if (s > 1) throw new RangeError('Impact parameter is inaccessible at this radius');
  return { position: [radius, 0, 0], direction: [-Math.sqrt(1-s*s), s, 0] };
}
