import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../luci-theme-routerdeck/htdocs/luci-static/routerdeck/core.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const RD = context.RouterDeck;
test('traffic rates handle first samples, counter resets and missing data', () => {
 assert.equal(RD.rate(1000, 6000, 5), 1000);
 assert.equal(RD.rate(undefined, 6000, 5), null);
 assert.equal(RD.rate(6000, 1000, 5), null);
 assert.equal(RD.rate(1000, 6000, 0), null);
 assert.equal(RD.rate(0, 0, 5), 0);
});
test('unavailable is different from zero', () => {
 assert.equal(RD.bytes(null), 'Unavailable');
 assert.equal(RD.bytes(0), '0 B');
 assert.equal(RD.bytes(.5), '1 B');
 assert.equal(RD.bytes(1024), '1.0 KiB');
 assert.equal(RD.uptime(null), 'Unavailable');
 assert.equal(RD.uptime(0), '0h 0m');
 assert.equal(RD.uptime(90061), '1d 1h 1m');
});
test('unavailable localStorage never breaks rendering', () => {
 assert.equal(RD.storage.get('windows', 'fallback'), 'fallback');
 assert.doesNotThrow(() => RD.storage.set('windows', []));
});
