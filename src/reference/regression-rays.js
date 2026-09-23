import { CRITICAL_IMPACT, rayFromImpact } from './schwarzschild.js';

// Stable input definitions, independent of rendered pixels and graphics drivers.
export const REGRESSION_RAYS = [
  { id: 'radial-outward', ray: { position: [30, 0, 0], direction: [1, 0, 0] }, expected: 'escaped' },
  { id: 'radial-inward', ray: { position: [30, 0, 0], direction: [-1, 0, 0] }, expected: 'captured' },
  { id: 'weak-deflection', ray: rayFromImpact(40, 1000), options: { escapeRadius: 2000 }, expected: 'escaped' },
  { id: 'near-photon-sphere', ray: { position: [3.01, 0, 0], direction: [0, 1, 0] }, expected: 'escaped' },
  { id: 'b-5.00', ray: rayFromImpact(5), expected: 'captured' },
  { id: 'b-5.19', ray: rayFromImpact(5.19), expected: 'captured' },
  { id: 'b-5.20', ray: rayFromImpact(5.20), expected: 'escaped' },
  { id: 'b-6.00', ray: rayFromImpact(6), expected: 'escaped' },
  { id: 'critical-inside', ray: rayFromImpact(CRITICAL_IMPACT*(1-1e-6)), expected: 'captured' },
  { id: 'critical-outside', ray: rayFromImpact(CRITICAL_IMPACT*(1+1e-6)), expected: 'escaped' },
  { id: 'multiple-orbit', ray: rayFromImpact(CRITICAL_IMPACT*(1+1e-8)), expected: 'escaped' },
];
