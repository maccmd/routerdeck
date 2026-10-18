import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let count = 0;
async function check(path) {
 for (const entry of await readdir(path, { withFileTypes: true })) {
  const file = join(path, entry.name);
  if (entry.isDirectory()) { await check(file); continue; }
  const text = await readFile(file, 'utf8');
  if (file.endsWith('.json')) { JSON.parse(text); count++; }
 }
}
await check(join(root, 'routerdeck-console/root'));
await check(join(root, 'console/mock'));
await check(join(root, 'tests/fixtures'));
console.log(`Validated ${count} JSON sources.`);
