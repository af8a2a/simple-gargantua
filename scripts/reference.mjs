import { mkdir, writeFile } from 'node:fs/promises';
import { traceSchwarzschild } from '../src/reference/schwarzschild.js';
import { REGRESSION_RAYS } from '../src/reference/regression-rays.js';

const rays = REGRESSION_RAYS.map(({ id, ray, options, expected }) => ({
  id, input: ray, expected, result: traceSchwarzschild(ray, options),
}));
const result = { schemaVersion: 1, caseId: 0, units: 'G=c=M=1',
  integrator: 'Dormand-Prince 5(4), CPU IEEE-754 binary64',
  directionConvention: 'past-directed; static observer local frame; finite escape sphere', rays };
const out = new URL('../output/reference/case-00.json', import.meta.url);
await mkdir(new URL('.', out), { recursive: true });
await writeFile(out, JSON.stringify(result, null, 2)+'\n');
console.table(rays.map(({id, result: r}) => ({ id, status: r.status, rMin: r.closestApproach, winding: r.winding, steps: r.diagnostics.acceptedSteps, nullError: r.diagnostics.maxNullResidual })));
console.log(`Reference dataset: ${out.pathname}`);
if (rays.some(r => r.result.status !== r.expected)) process.exitCode = 1;
