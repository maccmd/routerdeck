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
  if (file.endsWith('.js')) { new Function(text); count++; }
  if (file.endsWith('/navigation.ut')) { new Function(text.match(/<script>([\s\S]*)<\/script>/)[1]); count++; }
  if (file.endsWith('.json')) { JSON.parse(text); count++; }
 }
}
await check(join(root, 'luci-theme-routerdeck'));
await check(join(root, 'luci-app-routerdeck'));
await check(join(root, 'luci-app-routerdeck-workspace'));
await check(join(root, 'routerdeck-console/root'));
await check(join(root, 'preview'));
console.log(`Validated ${count} JavaScript and JSON sources, including inline navigation.`);
