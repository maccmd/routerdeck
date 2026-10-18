// Tunnels, bonding, the PPPoE server and secrets, OpenVPN and IPsec models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError } from '../../console/src/model/common.js';
import { parseSecrets, formatSecrets, pppoeOptionsText, parsePppoeOptions } from '../../console/src/model/vpn.js';

const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);
const fixture = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/router.json', import.meta.url), 'utf8'));
const base = () => ({ ...structuredClone(fixture), ifaces: [], protos: { gre: {}, gretap: {}, ipip: {}, vxlan: {}, bonding: {} }, devices: { eth0: { name: 'eth0', devtype: 'ethernet' }, eth1: { name: 'eth1', devtype: 'ethernet' } } });

test('a tunnel gets a companion network for its address and leaves with it', () => {
 const model = MODELS.tunnels, data = base();
 const change = model.save({ ...model.defaults(data), name: 'tun1', proto: 'gre', remote: '192.0.2.9', key: '7', address: '10.255.0.1/30', zone: 'lan' }, null, data);
 assert.deepEqual(change.ops.slice(0, 2), [
  { op: 'add', config: 'network', type: 'interface', name: 'tun1', values: { proto: 'gre', peeraddr: '192.0.2.9', ikey: '7', okey: '7' } },
  { op: 'add', config: 'network', type: 'interface', name: 'tun1_addr', values: { proto: 'static', device: '@tun1', ipaddr: ['10.255.0.1/30'] } }
 ]);
 assert.ok(change.ops.some(op => op.config === 'firewall' && op.values.network?.includes('tun1_addr')));
 data['uci:network'].tun1 = { '.type': 'interface', '.name': 'tun1', '.index': 50, proto: 'gre', peeraddr: '192.0.2.9', ikey: '7' };
 data['uci:network'].tun1_addr = { '.type': 'interface', '.name': 'tun1_addr', '.index': 51, proto: 'static', device: '@tun1', ipaddr: ['10.255.0.1/30'] };
 const [row] = model.rows(data);
 assert.deepEqual([row.cells.type, row.cells.address, row.cells.device, row.cells.id], ['GRE', '10.255.0.1/30', 'gre4-tun1', '7']);
 assert.deepEqual(model.remove([row], data).ops.filter(op => op.op === 'delete').map(op => op.section), ['tun1', 'tun1_addr']);
 const cleared = model.save({ ...model.values(row, data), address: '' }, row, data);
 assert.ok(cleared.ops.some(op => op.op === 'delete' && op.section === 'tun1_addr'));
 rejects(() => model.save({ ...model.defaults(data), name: 'much_too_long', proto: 'gretap', remote: '192.0.2.9' }, null, data), 'name');
 rejects(() => model.save({ ...model.defaults(data), name: 't6', proto: 'grev6', remote: '192.0.2.9' }, null, data), 'remote');
 rejects(() => model.save({ ...model.defaults(data), name: 'vx', proto: 'vxlan', remote: '192.0.2.9', vid: '' }, null, data), 'vid');
});

test('a bond writes its slaves, policy and address as proto-bonding reads them', () => {
 const model = MODELS.bonding, data = base();
 const change = model.save({ ...model.defaults(), name: 'bond0', slaves: ['eth0', 'eth1'], mode: '802.3ad', hash: 'layer3+4', lacp_rate: 'fast', address: '192.168.40.1/23' }, null, data);
 assert.deepEqual(change.ops[0].values, { proto: 'bonding', slaves: ['eth0', 'eth1'], bonding_policy: '802.3ad', xmit_hash_policy: 'layer3+4', lacp_rate: 'fast', link_monitoring: 'mii', miimon: '100', ipaddr: '192.168.40.1', netmask: '255.255.254.0' });
 rejects(() => model.save({ ...model.defaults(), name: 'bond0', slaves: [] }, null, data), 'slaves');
 rejects(() => model.save({ ...model.defaults(), name: 'bond_much_too_long', slaves: ['eth0'] }, null, data), 'name');
 rejects(() => model.save({ ...model.defaults(), name: 'b', slaves: ['eth0'], monitoring: 'arp' }, null, data), 'arp_ip_target');
});

test('PPP secrets keep the file; both secrets files change together', () => {
 const text = '#USERNAME  PROVIDER  PASSWORD  IPADDRESS\nalice * wonderland *\n"bob smith" pppoe "s3cret" 10.67.0.9\n';
 const nodes = parseSecrets(text);
 assert.deepEqual(nodes.filter(node => node.type === 'secret').map(node => [node.name, node.server, node.password, node.address]), [['alice', '*', 'wonderland', '*'], ['bob smith', 'pppoe', 's3cret', '10.67.0.9']]);
 assert.equal(formatSecrets(nodes), '#USERNAME  PROVIDER  PASSWORD  IPADDRESS\nalice * wonderland *\n"bob smith" pppoe s3cret 10.67.0.9\n');
 const model = MODELS['ppp-secrets'], data = { pppfiles: { chap: text, pap: '' } };
 const rows = model.rows(data);
 assert.deepEqual(rows.map(row => [row.cells.name, row.cells.address]), [['alice', 'from the pool'], ['bob smith', '10.67.0.9']]);
 const change = model.save({ name: 'carol', password: 'pw-carol', server: '', address: '' }, null, data);
 assert.deepEqual(change.ops.map(op => [op.config, op.expect]), [['chap-secrets', text], ['pap-secrets', '']]);
 assert.ok(change.ops[0].text.endsWith('carol * pw-carol *\n'));
 rejects(() => model.save({ name: 'alice', password: 'x' }, null, data), 'name');
 rejects(() => model.save({ name: 'dave', password: 'has"quote' }, null, data), 'password');
});

test('PPPoE servers always set sessions and the options file the console writes', () => {
 assert.deepEqual(parsePppoeOptions(pppoeOptionsText({ auth: 'pap', dns: ['192.0.2.53'] })), { auth: 'pap', dns: ['192.0.2.53'] });
 const model = MODELS['ppp-servers'];
 const data = { ...base(), 'uci:pppoe': {}, pppfiles: { options: '', server: true } };
 const change = model.save({ ...model.defaults(data), interface: 'lan', auth: 'chap', dns: [] }, null, data);
 assert.deepEqual(change.ops[0], { op: 'add', config: 'pppoe', type: 'pppoe_server', values: { interface: 'lan', localip: '10.67.0.1', firstremoteip: '10.67.0.2', maxsessions: '64', optionsfile: '/etc/ppp/pppoe-server-routerdeck' } });
 assert.equal(change.ops[1].config, 'pppoe-options');
 assert.match(change.ops[1].text, /^require-chap$/m);
 rejects(() => model.save({ ...model.defaults(data), localip: 'x' }, null, data), 'localip');
});

test('OpenVPN servers turn the subnet into server and topology; a zone gets a network', () => {
 const model = MODELS.openvpn;
 const data = { ...base(), 'uci:openvpn': {}, openvpn: { installed: true, instances: {} } };
 const change = model.save({ ...model.defaults(), name: 'srv', role: 'server', subnet: '10.98.0.0/24', port: '11940', ca: '/etc/openvpn/ca.crt', cert: '/etc/openvpn/s.crt', key: '/etc/openvpn/s.key', zone: 'lan' }, null, data);
 const values = change.ops[0].values;
 assert.deepEqual([values.server, values.topology, values.dev, values.dh, values.enabled, values.client], ['10.98.0.0 255.255.255.0', 'subnet', 'tun_srv', 'none', '1', undefined]);
 assert.deepEqual(change.ops[1], { op: 'add', config: 'network', type: 'interface', name: 'srv', values: { proto: 'none', device: 'tun_srv' } });
 rejects(() => model.save({ ...model.defaults(), name: 'c', role: 'client', remote: ['bad host name'], ca: '/x' }, null, data), 'remote');
 rejects(() => model.save({ ...model.defaults(), name: 'c', role: 'client', remote: ['vpn.example.net 1194'] }, null, data), 'ca');
 rejects(() => model.save({ ...model.defaults(), name: 'f', role: 'file', config: 'relative.ovpn' }, null, data), 'config');
 const file = model.save({ ...model.defaults(), name: 'f', role: 'file', config: '/etc/openvpn/f.ovpn' }, null, data).ops[0].values;
 assert.deepEqual(file, { config: '/etc/openvpn/f.ovpn', enabled: '1' });
});

test('IPsec policies belong to one peer; proposals in use stay', () => {
 const data = { 'uci:ipsec': {
  p1: { '.type': 'crypto_proposal', '.name': 'p1', '.index': 0, encryption_algorithm: 'aes256', hash_algorithm: 'sha256', dh_group: 'modp2048' },
  a: { '.type': 'remote', '.name': 'a', '.index': 1, enabled: '1', gateway: '192.0.2.1', crypto_proposal: ['p1'], tunnel: ['t1'] },
  b: { '.type': 'remote', '.name': 'b', '.index': 2, enabled: '1', gateway: '192.0.2.2', crypto_proposal: ['p1'] },
  t1: { '.type': 'tunnel', '.name': 't1', '.index': 3, local_subnet: ['10.1.0.0/24'], remote_subnet: ['10.2.0.0/24'], crypto_proposal: ['p1'] }
 }, ipsec: { installed: true, sas: [] } };
 const policies = MODELS['ipsec-policies'];
 const [row] = policies.rows(data);
 const moved = policies.save({ ...policies.values(row, data), peer: 'b' }, row, data);
 assert.deepEqual(moved.ops.slice(1), [{ op: 'set', config: 'ipsec', section: 'a', values: { tunnel: [] } }, { op: 'set', config: 'ipsec', section: 'b', values: { tunnel: ['t1'] } }]);
 rejects(() => policies.save({ ...policies.values(row, data), local_subnet: ['nope'] }, row, data), 'local_subnet');
 const proposals = MODELS['ipsec-proposals'];
 assert.equal(proposals.removeBlocked(proposals.rows(data), data), 'p1 is used by a, b, t1');
 assert.deepEqual(proposals.save({ name: 'gcm', encryption_algorithm: 'aes256gcm16', hash_algorithm: 'sha256', dh_group: 'ecp256', prf_algorithm: '' }, null, data).ops[0].values, { encryption_algorithm: 'aes256gcm16', dh_group: 'ecp256' });
 const peers = MODELS['ipsec-peers'];
 rejects(() => peers.save({ ...peers.defaults(data), name: 'c', gateway: '192.0.2.3', pre_shared_key: 'short' }, null, data), 'pre_shared_key');
 assert.equal(peers.save({ ...peers.defaults(data), name: 'c', gateway: '192.0.2.3', pre_shared_key: 'long-enough' }, null, data).ops[0].values.enabled, '1');
});
