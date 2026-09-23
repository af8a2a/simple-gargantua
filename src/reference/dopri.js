// Dormand–Prince 5(4), IEEE-754 binary64 throughout (no Float32Array).
const A = [[], [1/5], [3/40, 9/40], [44/45, -56/15, 32/9],
  [19372/6561, -25360/2187, 64448/6561, -212/729],
  [9017/3168, -355/33, 46732/5247, 49/176, -5103/18656],
  [35/384, 0, 500/1113, 125/192, -2187/6784, 11/84]];
const B4 = [5179/57600, 0, 7571/16695, 393/640, -92097/339200, 187/2100, 1/40];

export function dopriStep(rhs, state, h) {
  const k = [];
  for (let stage = 0; stage < 7; stage++) {
    k.push(rhs(state.map((v, j) => v + h * A[stage].reduce((s, a, i) => s + a * k[i][j], 0))));
  }
  const next = state.map((v, j) => v + h * A[6].reduce((s, a, i) => s + a * k[i][j], 0));
  const error = state.map((_, j) => h * B4.reduce((s, b, i) => s + ((A[6][i] ?? 0) - b) * k[i][j], 0));
  return { next, error };
}

// Refine an event inside an already accepted step by reintegration, never by
// linearly interpolating a curved geodesic. Angular step caps isolate roots.
export function locateEvent(rhs, state, h, value) {
  let lo = 0, hi = h;
  const sign = Math.sign(value(state));
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const next = dopriStep(rhs, state, mid).next;
    if (Math.sign(value(next)) === sign) lo = mid; else hi = mid;
    if (hi - lo <= 4 * Number.EPSILON * Math.max(1, h)) break;
  }
  const step = (lo + hi) / 2;
  return { state: dopriStep(rhs, state, step).next, step };
}
