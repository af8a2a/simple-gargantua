import { traceSchwarzschild } from './schwarzschild.js';
import { REGRESSION_RAYS } from './regression-rays.js';

self.onmessage = () => {
  try {
    const rays = REGRESSION_RAYS.map(({ id, ray, options, expected }) => ({ id, expected, input: ray, result: traceSchwarzschild(ray, options) }));
    self.postMessage({ schemaVersion: 1, units: 'G=c=M=1', caseId: 0, rays });
  } catch (error) { self.postMessage({ error: error.message }); }
};
