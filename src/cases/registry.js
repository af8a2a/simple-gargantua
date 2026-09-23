// Immutable, explicit progression. No flags that silently enable later physics.
const definitions = [
  [0, 'Reference Integrator', null, 'ready', 'CPU FP64 Schwarzschild geodesics'],
  [1, 'Flat Space', 0, 'ready', 'Straight camera rays + UV grid'],
  [2, 'Schwarzschild Sky', 1, 'planned', 'Lensing + capture'],
  [3, 'Thin Disk Geometry', 2, 'planned', 'Thin disk intersections'],
  [4, 'Relativistic Disk', 3, 'planned', 'Orbital motion + frequency shift'],
  [5, 'Physical Spectrum', 4, 'planned', 'Black body spectrum'],
  [6, 'Slow-light / Observer', 5, 'planned', 'Travel time + moving observer'],
  [7, 'Beam Filtering', 6, 'planned', 'Beam footprint / anti-aliasing'],
  [8, 'Kerr Geometry', 2, 'planned', 'Spin / frame dragging; compare Schwarzschild sky'],
  [9, 'Kerr Physical Disk', 8, 'planned', 'Spin-dependent disk; also compare Case 5–7 at a=0'],
  [10, 'Volumetric GRRT', 9, 'planned', 'Emission + absorption integral'],
  [11, 'GRMHD / Polarization', 10, 'planned', 'Data-driven plasma + polarization'],
];
export const CASES = Object.freeze(definitions.map(([id, name, referenceId, status, mechanism]) => Object.freeze({
  id, name, previousId: id === 0 ? null : id-1, referenceId, status, mechanism, units: 'G=c=M=1',
})));
export function getCase(id) {
  const value = CASES.find(c => c.id === id);
  if (!value || value.status !== 'ready') throw new RangeError(`Case ${id} is not implemented`);
  return value;
}
