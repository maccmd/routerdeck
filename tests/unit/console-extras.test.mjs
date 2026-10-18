// UPnP, dynamic DNS and SQM queues: configurations as the packages install
// them on OpenWrt 25.12.5, and the plugin's runtime shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError } from '../../console/src/model/common.js';

const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);
const section = (type, name, index, values, anonymous = false) => ({ '.anonymous': anonymous, '.type': type, '.name': name, '.index': index, ...values });
const network = { lan: section('interface', 'lan', 0, { proto: 'static' }), wan: section('interface', 'wan', 1, { proto: 'dhcp' }) };

test('UPnP settings, live mappings and ordered permission rules', () => {
 const data = {
  'uci:network': network,
  'uci:upnpd': {
   config: section('upnpd', 'config', 0, { enabled: '0', enable_natpmp: '1', enable_upnp: '1', secure_mode: '1', download: '1024', upload: '512', internal_iface: 'lan', port: '5000' }),
   a: section('perm_rule', 'a', 1, { action: 'allow', ext_ports: '1024-65535', int_addr: '0.0.0.0/0', int_ports: '1024-65535', comment: 'Allow high ports' }, true),
   b: section('perm_rule', 'b', 2, { action: 'deny', ext_ports: '0-65535', int_addr: '0.0.0.0/0', int_ports: '0-65535', comment: 'Default deny' }, true)
  },
  upnp: { now: 1000, mappings: [{ protocol: 'TCP', external_port: 51413, address: '192.168.1.20', internal_port: 51413, expires: 4600, description: 'torrent' }, { protocol: 'UDP', external_port: 3074, address: '192.168.1.21', internal_port: 3074, expires: 0, description: 'game' }] }
 };
 const settings = MODELS['upnp-settings'], row = settings.rows(data)[0];
 assert.deepEqual(settings.values(row, data), { enabled: false, enable_upnp: true, enable_natpmp: true, secure_mode: true, external_iface: '', internal_iface: 'lan', download: '1024', upload: '512' });
 assert.deepEqual(settings.save({ ...settings.values(row, data), enabled: true }, row, data, { dirty: new Set(['enabled']) }).ops, [{ op: 'set', config: 'upnpd', section: 'config', values: { enabled: '1' } }]);
 rejects(() => settings.save({ ...settings.values(row, data), download: 'fast' }, row, data, { dirty: new Set(['download']) }), 'download');
 assert.deepEqual(MODELS['upnp-mappings'].rows(data).map(item => [item.cells.protocol, item.cells.external, item.cells.expires]), [['tcp', '51413', '01:00:00'], ['udp', '3074', 'never']]);
 const rules = MODELS['upnp-rules'], list = rules.rows(data);
 assert.deepEqual(list.map(item => [item.comment, item.cells.action]), [['Allow high ports', 'allow'], ['Default deny', 'deny']]);
 assert.deepEqual(rules.order(['b', 'a'], data).ops, [{ op: 'order', config: 'upnpd', sections: ['config', 'b', 'a'] }]);
 rejects(() => rules.save({ action: 'allow', ext_ports: '80,443', int_addr: '192.168.1.0/24', int_ports: '80' }, null, data), 'ext_ports');
});

test('dynamic DNS services: provider or URL, and the address last registered', () => {
 const data = {
  'uci:network': network,
  'uci:ddns': {
   global: section('ddns', 'global', 0, { ddns_loglines: '250' }),
   home: section('service', 'home', 1, { enabled: '1', service_name: 'duckdns.org', domain: 'home.duckdns.org', lookup_host: 'home.duckdns.org', username: 'NA', password: 'token', interface: 'wan', ip_source: 'network', ip_network: 'wan' }),
   v6: section('service', 'v6', 2, { update_url: 'http://example.net/update?ip=[IP]', domain: 'v6.example.net', use_ipv6: '1', interface: 'wan6' })
  },
  ddns: { now: 2000, services: { home: { ip: '203.0.113.42', updated: 1400, running: true }, v6: { ip: null, updated: null, running: false } }, providers: ['cloudflare.com-v4', 'duckdns.org'] }
 };
 const model = MODELS['ddns-services'], rows = model.rows(data);
 assert.deepEqual(rows.map(row => [row.key, row.flags, row.cells.provider, row.cells.address, row.cells.updated]), [['home', 'R', 'duckdns.org', '203.0.113.42', '00:10:00 ago'], ['v6', 'X6', 'custom URL', '', '']]);
 const added = model.save({ ...model.defaults(data), name: 'office', provider: '', update_url: 'https://dyn.example.org/u?h=[DOMAIN]&ip=[IP]', domain: 'office.example.org' }, null, data);
 assert.deepEqual(added.ops[0], { op: 'add', config: 'ddns', type: 'service', name: 'office', values: { service_name: null, update_url: 'https://dyn.example.org/u?h=[DOMAIN]&ip=[IP]', domain: 'office.example.org', lookup_host: 'office.example.org', username: null, password: null, use_ipv6: null, interface: 'wan', ip_source: 'network', ip_network: 'wan', ip_interface: null, ip_url: null, check_interval: null, check_unit: null, enabled: '1' } });
 rejects(() => model.save({ ...model.defaults(data), name: 'office', provider: '', update_url: 'nope', domain: 'x.example.org' }, null, data), 'update_url');
 rejects(() => model.save({ ...model.defaults(data), name: 'home', domain: 'x.example.org' }, null, data), 'name');
 assert.deepEqual(model.tools[0].run(rows).calls, [['rc', 'init', { name: 'ddns', action: 'restart' }]]);
});

test('SQM queues show whether shaping is active on the device', () => {
 const data = {
  'uci:sqm': { eth1: section('queue', 'eth1', 0, { enabled: '1', interface: 'eth1', download: '85000', upload: '10000', qdisc: 'cake', script: 'piece_of_cake.qos', linklayer: 'none' }) },
  devices: { eth1: { name: 'eth1' }, lo: { name: 'lo', flags: { loopback: true } } },
  qdisc: { devices: { eth1: { kind: 'cake', handle: '8001:', bytes: 1048576, packets: 900, dropped: 3 } } }
 };
 const model = MODELS['sqm-queues'], row = model.rows(data)[0];
 assert.deepEqual([row.flags, row.cells.download, row.cells.upload, row.cells.sent, row.cells.dropped], ['R', '85 Mbps', '10 Mbps', '1.0 MiB', '3']);
 data.qdisc.devices.eth1 = { kind: 'fq_codel', handle: '0:' };
 assert.equal(model.rows(data)[0].flags, '');
 assert.deepEqual(model.fields(data, row).find(field => field.id === 'interface').options, [{ value: 'eth1', label: 'eth1' }]);
 assert.deepEqual(model.save({ ...model.values(row, data), upload: '9000' }, row, data).ops[0].values.upload, '9000');
 rejects(() => model.save({ ...model.values(row, data), download: '85 Mbit' }, row, data), 'download');
 assert.deepEqual(model.toggle([row], false).ops, [{ op: 'set', config: 'sqm', section: 'eth1', values: { enabled: '0' } }]);
});
