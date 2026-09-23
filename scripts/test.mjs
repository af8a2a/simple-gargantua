import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Expand paths ourselves: consistent on Node 20+ and Windows shells.
async function findTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findTests(path));
    else if (entry.name.endsWith('.test.mjs')) files.push(path);
  }
  return files.sort();
}
const files = await findTests(fileURLToPath(new URL('../tests', import.meta.url)));
if (!files.length) throw new Error('No reference tests found');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
