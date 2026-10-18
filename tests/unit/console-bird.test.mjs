// Routing ▸ OSPF and BGP models over bird.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError } from '../../console/src/model/common.js';
import { areaId, birdStatus } from '../../console/src/model/bird.js';

const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);
const section = (type, name, index, values) => ({ '.type': type, '.name': name, '.index': index, ...values });
// birdc's state as the plugin reports it, for the sections below.
const BIRD = {
 installed: true, client: true, running: true, version: '2.19.2', file: 'routerdeck', error: null,
 protocols: [
  { name: 'rdx_device', proto: 'Device', table: '---', state: 'up', info: '', details: {} },
  { name: 'rd_ospf1', proto: 'OSPF', table: 'master4', state: 'up', info: 'Running', details: {}, imported: 2, exported: 1 },
  { name: 'rd_isp', proto: 'BGP', table: '---', state: 'up', info: 'Established', details: { 'BGP state': 'Established', 'Neighbor address': '192.0.2.1', 'Neighbor AS': '64500', 'Local AS': '65001', 'Neighbor ID': '192.0.2.1' }, imported: 3, exported: 1 },
  { name: 'rd_backup', proto: 'BGP', table: '---', state: 'start', info: 'Active        Socket: Connection refused', details: { 'BGP state': 'Active' } }
 ],
 neighbors: [{ protocol: 'rd_ospf1', router_id: '10.0.0.2', priority: 1, state: 'Full/DR', dead: '33.120', interface: 'br-lan', address: '192.168.1.2' }],
 lsas: [{ protocol: 'rd_ospf1', scope: 'Area 0.0.0.0', type: '0001', id: '10.0.0.2', router: '10.0.0.2', sequence: '80000002', age: 33, checksum: 'ba85' }, { protocol: 'rd_ospf1', scope: 'Global', type: '0005', id: '10.9.0.0', router: '10.0.0.2', sequence: '80000001', age: 151, checksum: 'd015' }],
 routes: [
  { dst: '10.9.0.0/24', type: 'unicast', protocol: 'rd_ospf1', best: true, ospf: 'E2', preference: 150, metric: '10/10000', gateway: '192.168.1.2', interface: 'br-lan' },
  { dst: '198.51.100.0/24', type: 'unicast', protocol: 'rd_isp', best: true, preference: 100, origin: 'AS64500i', gateway: '192.0.2.1', interface: 'eth0' }
 ]
};
const data = () => ({
 bird: structuredClone(BIRD),
 devices: { lo: {}, 'br-lan': {}, eth0: {}, eth1: {} },
 'uci:routerdeck': {
  ospf1: section('ospf', 'ospf1', 0, { redistribute: ['connected'] }),
  ospf6: section('ospf', 'ospf6', 1, { version: '3' }),
  backbone: section('ospf_area', 'backbone', 2, { instance: 'ospf1', area_id: '0.0.0.0' }),
  v6area: section('ospf_area', 'v6area', 3, { instance: 'ospf6', area_id: '0.0.0.0' }),
  cfg01: section('ospf_interface', 'cfg01', 4, { area: 'backbone', interface: ['br-lan'] }),
  isp: section('bgp', 'isp', 5, { as: '65001', remote_address: '192.0.2.1', remote_as: '64500', network: ['192.168.1.0/24'] }),
  backup: section('bgp', 'backup', 6, { as: '65001', remote_address: '192.0.2.9', remote_as: '64501' })
 }
});

test('area IDs are written in dotted form', () => {
 assert.equal(areaId('0'), '0.0.0.0');
 assert.equal(areaId('1'), '0.0.0.1');
 assert.equal(areaId('256'), '0.0.1.0');
 assert.equal(areaId('10.0.0.1'), '10.0.0.1');
 assert.equal(areaId('area'), null);
});

test('OSPF instances are named for bird and stay while areas use them', () => {
 const model = MODELS['ospf-instances'], state = data();
 const rows = model.rows(state);
 assert.deepEqual(rows.map(row => [row.key, row.flags, row.cells.state]), [['ospf1', 'R', 'running'], ['ospf6', '', '']]);
 const added = model.save({ ...model.defaults(), name: 'core', router_id: '10.255.0.1', redistribute: ['static', 'bgp'], originate_default: 'if-installed' }, null, state);
 assert.deepEqual(added.ops, [{ op: 'add', config: 'routerdeck', type: 'ospf', name: 'core', values: { router_id: '10.255.0.1', redistribute: ['static', 'bgp'], originate_default: 'if-installed' } }]);
 rejects(() => model.save({ ...model.defaults(), name: '1ospf' }, null, state), 'name');
 rejects(() => model.save({ ...model.defaults(), name: 'isp' }, null, state), 'name');
 rejects(() => model.save({ ...model.defaults(), name: 'x', router_id: 'fast' }, null, state), 'router_id');
 assert.equal(model.removeBlocked([rows[0]], state), 'ospf1 still has areas backbone');
 delete state['uci:routerdeck'].backbone;
 assert.deepEqual(model.rows(state)[0].cells.state, 'no areas');
});

test('the backbone cannot be a stub and an instance has each area once', () => {
 const model = MODELS['ospf-areas'], state = data();
 assert.deepEqual(model.save({ name: 'branch', instance: 'ospf1', area_id: '1', type: 'stub' }, null, state).ops[0].values, { instance: 'ospf1', area_id: '0.0.0.1', type: 'stub' });
 rejects(() => model.save({ name: 'core', instance: 'ospf1', area_id: '0', type: 'nssa' }, null, state), 'type');
 rejects(() => model.save({ name: 'again', instance: 'ospf1', area_id: '0.0.0.0', type: 'default' }, null, state), 'area_id');
 rejects(() => model.save({ name: 'lost', instance: 'nothing', area_id: '1', type: 'default' }, null, state), 'instance');
 assert.match(model.removeBlocked(model.rows(state).slice(0, 1), state), /backbone is used by 1 interface templates/);
});

test('interface templates match the address family and key length of their instance', () => {
 const model = MODELS['ospf-templates'], state = data();
 const options = model.fields(state, null).find(field => field.id === 'interface').options.map(option => option.value);
 assert.deepEqual(options, ['br-lan', 'eth0', 'eth1']);
 const change = model.save({ ...model.defaults(state), area: 'backbone', interface: ['eth1'], network: ['10.1.0.5/24'], cost: '20', type: 'ptp', hello: '1', dead: '4', auth: 'md5', auth_key: 'secret' }, null, state);
 assert.deepEqual(change.ops, [{ op: 'add', config: 'routerdeck', type: 'ospf_interface', values: { area: 'backbone', interface: ['eth1'], network: ['10.1.0.0/24'], cost: '20', type: 'ptp', hello: '1', dead: '4', auth: 'md5', auth_key: 'secret' } }]);
 assert.equal(change.description, 'Add OSPF interface template eth1, 10.1.0.0/24');
 rejects(() => model.save({ ...model.defaults(state), area: 'backbone' }, null, state), 'interface');
 rejects(() => model.save({ ...model.defaults(state), area: 'v6area', network: ['10.1.0.0/24'] }, null, state), 'network');
 rejects(() => model.save({ ...model.defaults(state), area: 'v6area', interface: ['eth1'], auth: 'md5', auth_key: 'x' }, null, state), 'auth');
 rejects(() => model.save({ ...model.defaults(state), area: 'backbone', interface: ['eth1'], auth: 'simple', auth_key: 'longer-than-8' }, null, state), 'auth_key');
 rejects(() => model.save({ ...model.defaults(state), area: 'backbone', interface: ['eth1'], auth: 'sha256', auth_key: 'has"quote' }, null, state), 'auth_key');
 rejects(() => model.save({ ...model.defaults(state), area: 'backbone', interface: ['eth1'], hello: '10', dead: '10' }, null, state), 'dead');
 assert.deepEqual(model.save({ ...model.defaults(state), area: 'v6area', network: ['2001:db8:1::1/64'], auth: 'sha256', auth_key: 'k' }, null, state).ops[0].values.network, ['2001:db8:1::/64']);
 assert.equal(model.rows(state)[0].label, 'br-lan');
});

test('neighbors, LSAs and routes come from birdc under their section names', () => {
 const state = data();
 assert.deepEqual(MODELS['ospf-neighbors'].rows(state).map(row => [row.flags, row.cells.instance, row.cells.state, row.cells.dead]), [['F', 'ospf1', 'Full/DR', '33 s']]);
 assert.deepEqual(MODELS['ospf-lsas'].rows(state).map(row => [row.cells.area, row.cells.type]), [['0.0.0.0', 'router'], ['AS', 'external']]);
 assert.deepEqual(MODELS['ospf-routes'].rows(state).map(row => [row.flags, row.cells.dst, row.cells.kind, row.cells.metric]), [['A', '10.9.0.0/24', 'external 2', '10/10000']]);
 assert.deepEqual(MODELS['bgp-routes'].rows(state).map(row => [row.cells.dst, row.cells.protocol, row.cells.kind]), [['198.51.100.0/24', 'isp', 'AS64500i']]);
 assert.deepEqual(MODELS['bgp-sessions'].rows(state).map(row => [row.flags, row.cells.name, row.cells.state, row.cells.prefixes, row.cells.error]), [
  ['E', 'isp', 'established', '3/1', ''], ['', 'backup', 'active', '', 'Socket: Connection refused']
 ]);
});

test('BGP connections keep one address family and quote nothing', () => {
 const model = MODELS['bgp-connections'], state = data();
 assert.deepEqual(model.rows(state).map(row => [row.key, row.flags, row.cells.state]), [['isp', 'E', 'established'], ['backup', '', 'active']]);
 assert.equal(model.defaults(state).as, '65001');
 const change = model.save({ ...model.defaults(state), name: 'ix', remote_address: '2001:DB8::2', remote_as: '64510', network: ['2001:db8:42::1/48'], multihop: '2', password: 'tcp-key' }, null, state);
 assert.deepEqual(change.ops[0].values, { as: '65001', remote_address: '2001:db8::2', remote_as: '64510', network: ['2001:db8:42::/48'], multihop: '2', password: 'tcp-key' });
 rejects(() => model.save({ ...model.defaults(state), name: 'ix', remote_address: '2001:db8::2', remote_as: '64510', network: ['10.0.0.0/8'] }, null, state), 'network');
 rejects(() => model.save({ ...model.defaults(state), name: 'ix', remote_address: '192.0.2.5', remote_as: '64510', local_address: '2001:db8::1' }, null, state), 'local_address');
 rejects(() => model.save({ ...model.defaults(state), name: 'ix', as: '0', remote_address: '192.0.2.5', remote_as: '64510' }, null, state), 'as');
 rejects(() => model.save({ ...model.defaults(state), name: 'ix', remote_address: '192.0.2.5', remote_as: '64510', hold_time: '2' }, null, state), 'hold_time');
 rejects(() => model.save({ ...model.defaults(state), name: 'ix', remote_address: '192.0.2.5', remote_as: '64510', password: 'back\\slash' }, null, state), 'password');
});

test('a hand-edited bird.conf is only shown', () => {
 const state = data();
 state.bird.file = 'edited';
 state.bird.protocols.push({ name: 'uplink', proto: 'BGP', table: '---', state: 'up', info: 'Established', details: { 'BGP state': 'Established', 'Neighbor address': '198.51.100.7', 'Neighbor AS': '64999' } });
 assert.equal(birdStatus(state, 'BGP'), '/etc/bird.conf was edited by hand, so it is only shown here');
 assert.equal(MODELS['bgp-connections'].canAdd(state), false);
 const shown = MODELS['bgp-connections'].rows(state).at(-1);
 assert.deepEqual([shown.key, shown.flags, shown.readOnly, shown.cells.remote], ['bird:uplink', 'DE', true, '198.51.100.7']);
 assert.equal(MODELS['bgp-connections'].canRemove(shown), false);
 assert.equal(birdStatus({ bird: { installed: false } }, 'OSPF'), 'OSPF needs the bird2 and bird2c packages');
 assert.match(birdStatus({ bird: { ...BIRD, error: 'bird: /etc/bird.conf:3:1 syntax error' } }, 'OSPF'), /did not take the configuration: bird: \/etc\/bird.conf:3:1/);
});
