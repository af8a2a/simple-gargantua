export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const scale = (a, s) => a.map(v => v * s);
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export function normalize(a) {
  const n = Math.hypot(...a);
  if (!Number.isFinite(n) || n === 0) throw new RangeError('Expected a finite nonzero vector');
  return scale(a, 1 / n);
}
export const angle = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
