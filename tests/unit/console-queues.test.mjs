// Routing tables (rt_tables) and Simple Queues.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError } from '../../console/src/model/common.js';
import { parseTables, formatTables, tableNames } from '../../console/src/model/routing.js';
import { limitBits } from '../../console/src/model/extras.js';

const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);
// /etc/iproute2/rt_tables as OpenWrt 25.12.5 ships it, plus one table.
const RT = '#\n# reserved values\n#\n128\tprelocal\n255\tlocal\n254\tmain\n253\tdefault\n0\tunspec\n#\n# local\n#\n#1\tinr.ruhep\n100\tisp2\n';

test('rt_tables keeps comments and reserved lines', () => {
 assert.equal(formatTables(parseTables(RT)), RT);
 assert.deepEqual(tableNames({ tables: { text: RT } }), ['isp2']);
 assert.deepEqual(parseTables(''), []);
});

test('routing tables count their routes and rules; used ones stay', () => {
 const model = MODELS['routing-tables'];
 const data = {
  tables: { text: RT },
  'uci:network': { r1: { '.type': 'rule', '.name': 'r1', '.index': 0, lookup: 'isp2' }, r2: { '.type': 'rule', '.name': 'r2', '.index': 1, lookup: '42' } },
  routes4: [{ dst: '0.0.0.0/0', table: 'isp2' }, { dst: '10.0.0.0/8', table: 'main' }], routes6: []
 };
 const rows = model.rows(data);
 assert.deepEqual(rows.map(row => [row.cells.name, row.cells.id, row.cells.routes, row.cells.rules, row.flags]), [
  ['local', '255', '0', '0', 'D'], ['main', '254', '1', '0', 'D'], ['default', '253', '0', '0', 'D'], ['isp2', '100', '1', '1', ''], ['', '42', '0', '1', 'D']
 ]);
 assert.equal(model.defaults(data).id, '101');
 const added = model.save({ name: 'vpn', id: '101' }, null, data).ops[0];
 assert.equal(added.text, RT + '101\tvpn\n');
 assert.equal(added.expect, RT);
 rejects(() => model.save({ name: 'isp2', id: '150' }, null, data), 'name');
 rejects(() => model.save({ name: 'x', id: '254' }, null, data), 'id');
 rejects(() => model.save({ name: '1x', id: '150' }, null, data), 'name');
 assert.match(model.removeBlocked([rows[3]], data), /still has 1 routes and 1 rules/);
});

test('simple queues take rates in bits with k, M and G', () => {
 assert.equal(limitBits('512k'), 512000);
 assert.equal(limitBits('2.5M'), 2500000);
 assert.equal(limitBits('1G'), 1e9);
 assert.equal(limitBits('fast'), null);
 const model = MODELS['simple-queues'];
 const data = { 'uci:routerdeck': {}, 'uci:network': {}, queuestats: { devices: {}, rates: {} } };
 const change = model.save({ ...model.defaults(), name: 'tv', target: ['192.168.1.50', '192.168.1.64/27'], max_down: '20M', limit_at_down: '5M', priority: '2' }, null, data);
 assert.deepEqual(change.ops, [{ op: 'add', config: 'routerdeck', type: 'queue', name: 'tv', values: { target: ['192.168.1.50', '192.168.1.64/27'], max_down: '20M', limit_at_down: '5M', priority: '2' } }]);
 rejects(() => model.save({ ...model.defaults(), name: 'tv', target: ['192.168.1.50'] }, null, data), 'max_down');
 rejects(() => model.save({ ...model.defaults(), name: 'tv', target: ['nowhere'], max_down: '1M' }, null, data), 'target');
 rejects(() => model.save({ ...model.defaults(), name: 'tv', target: ['192.168.1.50'], max_down: '1M', limit_at_down: '2M' }, null, data), 'limit_at_down');
 rejects(() => model.save({ ...model.defaults(), name: 'tv', target: ['192.168.1.50'], max_up: '10 Mbps' }, null, data), 'max_up');
 const rows = model.rows({ ...data, 'uci:routerdeck': { tv: { '.type': 'queue', '.name': 'tv', '.index': 0, target: ['192.168.1.50'], max_down: '20M' } }, queuestats: { devices: { 'br-lan': { queues: { tv: { down: [2097152, 1400], up: [1024, 10] } } } }, rates: { tv: { up: 1200, down: 4100000 } } } });
 assert.deepEqual([rows[0].flags, rows[0].cells.max, rows[0].cells.rate, rows[0].cells.bytes], ['S', '∞/20M', '1.2 kbps/4.1 Mbps', '1.0 KiB/2.0 MiB']);
});
