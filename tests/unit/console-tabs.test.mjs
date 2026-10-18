// Tabs added to existing windows and the new IP/Routing lists: address
// lists, DHCP networks and options, Ethernet, VLAN, WireGuard, routing rules,
// ARP and IP services. Runtime shapes follow the plugin on OpenWrt 25.12.5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError } from '../../console/src/model/common.js';
import { splitOption } from '../../console/src/model/dhcp.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/router.json', import.meta.url), 'utf8'));
const data = () => structuredClone(fixture);
const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);
const section = (type, name, index, values) => ({ '.anonymous': true, '.type': type, '.name': name, '.index': index, ...values });

test('address lists are fw4 ipset entries; rules pick one list with its direction', () => {
 const input = data();
 input['uci:firewall'].blk = section('ipset', 'blk', 30, { name: 'blocklist', family: 'ipv4', match: ['net'], entry: ['198.51.100.0/24', '203.0.113.66'] });
 input['uci:firewall'].empty = section('ipset', 'empty', 31, { name: 'later', family: 'ipv6', match: ['net'] });
 const model = MODELS['fw-address-lists'], rows = model.rows(input);
 assert.deepEqual(rows.map(row => [row.cells.list, row.cells.address, row.flags]), [['blocklist', '198.51.100.0/24', ''], ['blocklist', '203.0.113.66', ''], ['later', '', 'E']]);
 // A new entry joins its list; a new list is a new ipset section.
 assert.deepEqual(model.save({ list: 'blocklist', address: '192.0.2.9' }, null, input).ops, [{ op: 'set', config: 'firewall', section: 'blk', values: { entry: ['198.51.100.0/24', '203.0.113.66', '192.0.2.9'] } }]);
 assert.deepEqual(model.save({ list: 'admins', address: '192.0.2.7/24' }, null, input).ops, [{ op: 'add', config: 'firewall', type: 'ipset', values: { name: 'admins', family: 'ipv4', match: ['net'], entry: ['192.0.2.0/24'] } }]);
 rejects(() => model.save({ list: 'blocklist', address: '2001:db8::1' }, null, input), 'address');
 rejects(() => model.save({ list: 'blocklist', address: '203.0.113.66' }, null, input), 'address');
 rejects(() => model.save({ list: 'bad name', address: '192.0.2.1' }, null, input), 'list');
 assert.deepEqual(model.remove([rows[0]], input).ops, [{ op: 'set', config: 'firewall', section: 'blk', values: { entry: ['203.0.113.66'] } }]);
 assert.deepEqual(model.toggle([rows[0], rows[1]], false).ops, [{ op: 'set', config: 'firewall', section: 'blk', values: { enabled: '0' } }]);

 const rules = MODELS['fw-filter'], ruleRow = rules.rows(input)[0];
 const values = rules.values(ruleRow, input);
 assert.deepEqual([values.src_list, values.dst_list], ['', '']);
 assert.equal(rules.save({ ...values, src_list: 'blocklist' }, ruleRow, input).ops[0].values.ipset, 'blocklist src');
 rejects(() => rules.save({ ...values, src_list: 'blocklist', dst_list: 'later' }, ruleRow, input), 'dst_list');
 input['uci:firewall'][ruleRow.section].ipset = 'blocklist dest';
 assert.equal(rules.values(ruleRow, input).dst_list, 'blocklist');
});

test('DHCP networks and options edit the same dhcp_option list', () => {
 assert.deepEqual(splitOption('6,192.0.2.1,192.0.2.2'), { code: '6', value: '192.0.2.1,192.0.2.2' });
 assert.deepEqual(splitOption('option:dns-server,192.0.2.1'), { code: '6', value: '192.0.2.1' });
 assert.equal(splitOption('tag:guest,3').tagged, true);
 const input = data();
 input['uci:dhcp'].lan.dhcp_option = ['42,192.168.77.1', 'option:dns-server,9.9.9.9', 'tag:guest,3'];
 const networks = MODELS['dhcp-networks'], row = networks.rows(input).find(item => item.key === 'lan');
 assert.deepEqual(row.cells, { address: '192.168.77.0/24', interface: 'lan', gateway: '192.168.77.1', dns: '9.9.9.9', domain: 'lan', ntp: '192.168.77.1' });
 const values = networks.values(row);
 const change = networks.save({ ...values, gateway: '192.168.77.254', dns: [] }, row, input, { dirty: new Set(['gateway', 'dns']) });
 assert.deepEqual(change.ops[0].values.dhcp_option, ['42,192.168.77.1', 'tag:guest,3', '3,192.168.77.254']);
 rejects(() => networks.save({ ...values, gateway: 'router' }, row, input, { dirty: new Set(['gateway']) }), 'gateway');

 const options = MODELS['dhcp-options'], rows = options.rows(input);
 assert.deepEqual(rows.map(item => [item.cells.server, item.cells.code, item.cells.name, item.cells.value]), [['lan', '42', 'ntp-server', '192.168.77.1'], ['lan', '6', 'dns-server', '9.9.9.9'], ['lan', 'tag:guest', '', '3']]);
 assert.deepEqual(options.save({ server: 'lan', code: '252', value: '"\\n"', force: true }, null, input).ops, [{ op: 'set', config: 'dhcp', section: 'lan', values: { dhcp_option_force: ['252,"\\n"'] } }]);
 assert.deepEqual(options.save({ ...options.values(rows[0]), value: '192.168.77.2' }, rows[0], input).ops[0].values.dhcp_option, ['option:dns-server,9.9.9.9', 'tag:guest,3', '42,192.168.77.2']);
 rejects(() => options.save({ server: 'lan', code: 'abc', value: '', force: false }, null, input), 'code');
});

test('Ethernet link settings go to the port device section; VLANs use the VLAN form', () => {
 const input = data();
 input.devices.eth1.link = { carrier: true, speed: 1000, duplex: 'full' };
 const model = MODELS.ethernet, rows = model.rows(input);
 assert.deepEqual(rows.map(row => [row.key, row.cells.rate, row.cells.duplex, row.flags]).sort(), [['eth0', '', '', 'RS'], ['eth1', '1 Gbps', 'full', 'R']]);
 const eth1 = rows.find(row => row.key === 'eth1');
 assert.deepEqual(model.save({ ...model.values(eth1, input), speed: '100', duplex: 'full' }, eth1, input, { dirty: new Set(['speed', 'duplex']) }).ops,
  [{ op: 'add', config: 'network', type: 'device', values: { name: 'eth1', speed: '100', duplex: 'full' } }]);
 rejects(() => model.save({ ...model.values(eth1, input), speed: '', duplex: 'half' }, eth1, input, { dirty: new Set(['duplex']) }), 'speed');

 input['uci:network'].v10 = section('device', 'v10', 30, { name: 'eth1.10', type: '8021q', ifname: 'eth1', vid: '10' });
 assert.deepEqual(MODELS.vlans.rows(input).map(row => [row.key, row.cells.vid, row.cells.ifname, row.flags]), [['eth1.10', '10', 'eth1', 'I']]);
 assert.equal(MODELS.vlans.save({ name: 'eth1.20', mtu: '', macaddr: '', ifname: 'eth1', vid: '20' }, null, input).ops[0].values.type, '8021q');
});

test('WireGuard keys are made on the router; peers show their handshake', () => {
 const input = data();
 input['uci:network'].wg0 = section('interface', 'wg0', 30, { proto: 'wireguard', private_key: 'oK56DE9Ue9zK76rAc8pBl6opph+1v36lm7cXXsQKrQM=', listen_port: '51820', addresses: ['10.8.0.1/24'] });
 input['uci:network'].peer = section('wireguard_wg0', 'peer', 31, { description: 'phone', public_key: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=', allowed_ips: ['10.8.0.2/32'] });
 input.wireguard = { available: true, now: 1000, interfaces: { wg0: { public_key: 'Q0bVxMq8yDtW3gKIdWnHpcWbF8fZ2+0JxHf6mRb5zVk=', listen_port: 51820, peers: [{ public_key: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=', latest_handshake: 958, rx_bytes: 2048, tx_bytes: 4096, allowed_ips: ['10.8.0.2/32'] }] } } };
 const model = MODELS.wireguard, row = model.rows(input)[0];
 assert.deepEqual([row.cells.port, row.cells.addresses, row.cells.peers, row.cells.key], ['51820', '10.8.0.1/24', '1', 'Q0bVxMq8yDtW3gKIdWnHpcWbF8fZ2+0JxHf6mRb5zVk=']);
 // The private key never comes back into the form.
 assert.equal(model.values(row, input).private_key, '');
 const added = model.save({ ...model.defaults(input), name: 'wg1', addresses: ['10.9.0.1/24'] }, null, input);
 assert.equal(added.ops[0].values.private_key, '@generate:wireguard-key');
 assert.deepEqual(model.save({ ...model.values(row, input), mtu: '1380' }, row, input, { dirty: new Set(['mtu']) }).ops, [{ op: 'set', config: 'network', section: 'wg0', values: { mtu: '1380' } }]);
 rejects(() => model.save({ ...model.values(row, input), private_key: 'short' }, row, input, { dirty: new Set(['private_key']) }), 'private_key');
 assert.deepEqual(model.remove([row], input).ops.map(op => [op.op, op.section]), [['delete', 'wg0'], ['delete', 'peer']]);

 const peers = MODELS['wireguard-peers'], peer = peers.rows(input)[0];
 assert.deepEqual([peer.flags, peer.cells.name, peer.cells.handshake, peer.cells.rx], ['C', 'phone', '00:00:42 ago', '2.0 KiB']);
 const peerAdded = peers.save({ ...peers.defaults(input), public_key: 'Q0bVxMq8yDtW3gKIdWnHpcWbF8fZ2+0JxHf6mRb5zVk=', allowed_ips: ['10.8.0.3/32'], endpoint_host: 'vpn.example.org', endpoint_port: '51820' }, null, input);
 assert.equal(peerAdded.ops[0].type, 'wireguard_wg0');
 rejects(() => peers.save({ ...peers.defaults(input), public_key: 'nope' }, null, input), 'public_key');
});

test('routing rules join UCI sections with the kernel rules', () => {
 const input = data();
 input['uci:network'].r1 = section('rule', 'r1', 30, { src: '192.168.77.128/25', lookup: '100', priority: '1000' });
 input['uci:network'].r2 = section('rule6', 'r2', 31, { dest: '2001:db8::/32', action: 'prohibit', disabled: '1' });
 input.rules = { rules: [{ family: 4, priority: 0, from: 'all', lookup: 'local' }, { family: 4, priority: 1000, from: '192.168.77.128/25', lookup: '100' }, { family: 4, priority: 32766, from: 'all', lookup: 'main' }] };
 const model = MODELS['routing-rules'], rows = model.rows(input);
 assert.deepEqual(rows.map(row => [row.cells.family, row.cells.priority, row.flags, row.cells.action, row.cells.table]), [
  ['ipv4', '1000', 'A', 'lookup', '100'], ['ipv6', '', 'X', 'prohibit', ''], ['ipv4', '0', 'DA', 'lookup', 'local'], ['ipv4', '32766', 'DA', 'lookup', 'main']
 ]);
 assert.deepEqual(model.save({ ...model.defaults(), src: '10.0.0.0/8', in: 'lan', lookup: '200', priority: '1100' }, null, input).ops, [{ op: 'add', config: 'network', type: 'rule', values: { priority: '1100', src: '10.0.0.0/8', dest: null, in: 'lan', out: null, mark: null, invert: null, action: null, lookup: '200' } }]);
 rejects(() => model.save({ ...model.defaults(), lookup: '200', priority: '32766' }, null, input), 'priority');
 rejects(() => model.save({ ...model.defaults(), family: 'ipv6', src: '10.0.0.0/8', lookup: 'main' }, null, input), 'src');
 assert.equal(model.canRemove(rows[2]), false);
});

test('ARP rows come from the neighbour table; Make Static reserves a lease', () => {
 const input = data();
 input.neighbors = { neighbors: [
  { family: 4, address: '192.168.77.2', dev: 'br-lan', mac: '52:55:c0:a8:4d:02', router: false, state: 'REACHABLE' },
  { family: 4, address: '192.168.77.250', dev: 'br-lan', router: false, state: 'FAILED' },
  { family: 6, address: 'fe80::2', dev: 'eth1', mac: '52:56:00:00:00:02', router: true, state: 'STALE' }
 ] };
 input.leases = { dhcp_leases: [{ hostname: 'laptop', macaddr: '52:55:c0:a8:4d:02', ipaddr: '192.168.77.2' }] };
 const arp = MODELS['ip-arp'], rows = arp.rows(input);
 assert.deepEqual(rows.map(row => [row.cells.address, row.flags, row.cells.host, row.cells.interface]), [['192.168.77.2', 'DC', 'laptop', 'br-lan (lan)'], ['192.168.77.250', 'DI', '', 'br-lan (lan)']]);
 const tool = arp.tools[0];
 assert.equal(tool.enabled([rows[1]]), false);
 assert.deepEqual(tool.run([rows[0]], input).ops, [{ op: 'add', config: 'dhcp', type: 'host', values: { name: 'laptop', mac: '52:55:c0:a8:4d:02', ip: '192.168.77.2', dns: '1' } }]);
 assert.deepEqual(MODELS['ipv6-neighbors'].rows(input).map(row => [row.cells.address, row.flags]), [['fe80::2', 'DCR']]);
});

test('IP services change ports of uhttpd, dropbear and ttyd', () => {
 const input = data();
 input['uci:uhttpd'] = { main: { '.type': 'uhttpd', '.name': 'main', '.index': 0, listen_http: ['0.0.0.0:80', '[::]:80'], listen_https: ['0.0.0.0:443', '[::]:443'], rfc1918_filter: '1' } };
 input['uci:dropbear'] = { main: { '.type': 'dropbear', '.name': 'main', '.index': 0, enable: '1', PasswordAuth: 'on', RootPasswordAuth: 'on', Port: '22' } };
 input['uci:ttyd'] = { t: section('ttyd', 't', 0, { interface: '@lan', command: '/bin/login' }) };
 const model = MODELS['ip-services'], rows = model.rows(input);
 assert.deepEqual(rows.map(row => [row.cells.name, row.cells.port, row.cells.from]), [['www', '80', '0.0.0.0, [::]'], ['www-ssl', '443', '0.0.0.0, [::]'], ['ssh', '22', 'all networks'], ['ttyd', '7681', 'lan']]);
 const save = (row, changes) => model.save({ ...model.values(row, input), ...changes }, row, input, { dirty: new Set(Object.keys(changes)) });
 assert.deepEqual(save(rows[0], { port: '8080' }).ops, [{ op: 'set', config: 'uhttpd', section: 'main', values: { listen_http: ['0.0.0.0:8080', '[::]:8080'] } }]);
 assert.deepEqual(save(rows[2], { port: '2222', password: false }).ops, [{ op: 'set', config: 'dropbear', section: 'main', values: { Port: '2222', PasswordAuth: 'off' } }]);
 assert.deepEqual(save(rows[3], { interface: '' }).ops, [{ op: 'set', config: 'ttyd', section: 't', values: { interface: null } }]);
 rejects(() => save(rows[0], { port: '70000' }), 'port');
 assert.equal(model.canToggle(rows[0]), false);
 assert.deepEqual(model.toggle([rows[2]], false).ops[0].values, { enable: '0' });
});
