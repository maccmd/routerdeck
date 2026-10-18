// Window models against data captured from a real OpenWrt 25.12.5 guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError, reorderOps } from '../../console/src/model/common.js';
import { parseCidr, maskToPrefix, compressIPv6, addressKey, isIPv6 } from '../../console/src/lib/ip.js';
import { zoneMembership } from '../../console/src/model/networks.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/router.json', import.meta.url), 'utf8'));
const data = () => structuredClone(fixture);
const byKey = (rows, key) => rows.find(row => row.key === key);
const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);

test('IP helpers parse, compress and sort addresses', () => {
 assert.deepEqual(parseCidr('192.168.77.1/24'), { address: '192.168.77.1', prefix: 24, network: '192.168.77.0', cidr: '192.168.77.1/24' });
 assert.equal(parseCidr('300.1.1.1/24'), null);
 assert.equal(parseCidr('10.0.0.1', { requirePrefix: true }), null);
 assert.equal(maskToPrefix('255.255.255.0'), 24);
 assert.equal(maskToPrefix('255.0.255.0'), null);
 assert.equal(compressIPv6('fe80:0000:0000:0000:5054:00ff:fe12:3457'), 'fe80::5054:ff:fe12:3457');
 assert.ok(addressKey('9.0.0.0/8') < addressKey('10.0.0.0/8'));
 assert.ok(isIPv6('fd50:b8c1:5fb2::1') && !isIPv6('10.0.0.1'));
});

test('interfaces show devices with flags and computed rates', () => {
 const input = data();
 input.devices['br-lan'].rates = { tx_bps: 1536000, rx_bps: 800, tx_pps: 12, rx_pps: 3 };
 const rows = MODELS.interfaces.rows(input);
 assert.deepEqual(rows.map(row => row.name).sort(), ['br-lan', 'eth0', 'eth1', 'lo']);
 assert.equal(byKey(rows, 'eth0').flags, 'RS');
 assert.equal(byKey(rows, 'br-lan').type, 'bridge');
 assert.equal(byKey(rows, 'br-lan').cells.tx, '1.5 Mbps');
 assert.equal(byKey(rows, 'lo').type, 'loopback');
 // A bridge section changes only what was edited; a physical port gets a new section.
 assert.deepEqual(MODELS.interfaces.save({ ...MODELS.interfaces.values(byKey(rows, 'br-lan'), input), mtu: '1400' }, byKey(rows, 'br-lan'), input, { dirty: new Set(['mtu']) }).ops,
  [{ op: 'set', config: 'network', section: 'cfg030f15', values: { mtu: '1400' } }]);
 assert.deepEqual(MODELS.interfaces.save({ ...MODELS.interfaces.values(byKey(rows, 'eth1'), input), macaddr: '02:00:00:00:00:01' }, byKey(rows, 'eth1'), input, { dirty: new Set(['macaddr']) }).ops,
  [{ op: 'add', config: 'network', type: 'device', values: { name: 'eth1', macaddr: '02:00:00:00:00:01' } }]);
 const vlan = MODELS.interfaces.save({ name: 'eth0.10', type: 'vlan', ifname: 'eth0', vid: '10', mtu: '', macaddr: '' }, null, input);
 assert.deepEqual(vlan.ops[0].values, { name: 'eth0.10', type: '8021q', mtu: null, macaddr: null, ifname: 'eth0', vid: '10' });
 rejects(() => MODELS.interfaces.save({ name: 'eth0', type: 'bridge', ports: [] }, null, input), 'name');
});

test('networks and zone membership', () => {
 const input = data();
 const rows = MODELS.networks.rows(input);
 assert.deepEqual(rows.map(row => [row.key, row.flags, row.cells.protocol, row.cells.zone]), [
  ['loopback', 'R', 'static', ''], ['lan', 'R', 'static', 'lan'], ['wan', 'R', 'dhcp', 'wan'], ['wan6', 'R', 'dhcpv6', 'wan']
 ]);
 const added = MODELS.networks.save({ ...MODELS.networks.defaults(), name: 'guest', device: 'eth0', zone: 'lan' }, null, input);
 assert.equal(added.ops[0].name, 'guest');
 assert.deepEqual(added.ops[1], { op: 'set', config: 'firewall', section: 'cfg02dc81', values: { network: ['lan', 'guest'] } });
 rejects(() => MODELS.networks.save({ ...MODELS.networks.defaults(), name: 'lan' }, null, input), 'name');
 assert.deepEqual(zoneMembership(input, 'wan6', 'lan').map(op => op.values.network), [['lan', 'wan6'], ['wan']]);
 const lan = byKey(rows, 'lan');
 assert.equal(MODELS.networks.save(MODELS.networks.values(lan, input), lan, input, { dirty: new Set() }), null);
 const removed = MODELS.networks.remove([byKey(rows, 'wan6')], input);
 assert.deepEqual(removed.ops.map(op => op.op + ':' + op.config), ['delete:network', 'set:firewall']);
});

test('addresses edit the list of the right network', () => {
 const input = data();
 const rows = MODELS.addresses.rows(input);
 assert.deepEqual(rows.map(row => [row.cells.address, row.flags, row.cells.interface]), [
  ['127.0.0.1/8', '', 'loopback (lo)'], ['192.168.77.1/24', '', 'lan (br-lan)'], ['10.0.2.15/24', 'D', 'wan (eth1)']
 ]);
 const add = MODELS.addresses.save({ address: '192.168.78.1/24', interface: 'lan' }, null, input);
 assert.deepEqual(add.ops, [{ op: 'set', config: 'network', section: 'lan', values: { ipaddr: ['192.168.77.1/24', '192.168.78.1/24'], netmask: null } }]);
 rejects(() => MODELS.addresses.save({ address: '192.168.77.1/24', interface: 'lan' }, null, input), 'address');
 rejects(() => MODELS.addresses.save({ address: '192.168.77.9', interface: 'lan' }, null, input), 'address');
 rejects(() => MODELS.addresses.save({ address: '10.9.9.9/24', interface: 'wan' }, null, input), 'interface');
 const lan = byKey(rows, 'lan#0');
 assert.deepEqual(MODELS.addresses.save({ address: '192.168.77.2/24', interface: 'loopback' }, lan, input).ops.map(op => [op.section, op.values.ipaddr]),
  [['lan', []], ['loopback', ['127.0.0.1/8', '192.168.77.2/24']]]);
 // The legacy ipaddr + netmask form becomes a CIDR list.
 input['uci:network'].lan.ipaddr = '192.168.77.1';
 input['uci:network'].lan.netmask = '255.255.255.0';
 assert.equal(MODELS.addresses.rows(input).find(row => row.iface === 'lan').cells.address, '192.168.77.1/24');
});

test('routes merge kernel and static entries', () => {
 const input = data();
 input['uci:network'].static1 = { '.type': 'route', '.name': 'static1', '.index': 9, '.anonymous': false, interface: 'wan', target: '10.99.0.0', netmask: '255.255.0.0', gateway: '10.0.2.2', metric: '5' };
 input['uci:network'].off = { '.type': 'route', '.name': 'off', '.index': 10, '.anonymous': false, interface: 'lan', target: '172.16.0.0/12', disabled: '1' };
 input.routes4.push({ dst: '10.99.0.0/16', gateway: '10.0.2.2', dev: 'eth1', protocol: 'static', metric: 5, flags: [] });
 const rows = MODELS.routes.rows(input);
 assert.equal(byKey(rows, 'static1').flags, 'AS');
 assert.equal(byKey(rows, 'off').flags, 'XS');
 assert.equal(rows.filter(row => row.cells.dst === '10.99.0.0/16').length, 1);
 const main = rows.filter(row => MODELS.routes.filter.match(row, 'main'));
 assert.deepEqual(main.filter(row => row.dynamic).map(row => [row.cells.dst, row.flags]), [['0.0.0.0/0', 'DA'], ['10.0.2.0/24', 'DAC'], ['192.168.77.0/24', 'DAC']]);
 assert.ok(rows.some(row => row.cells.table === 'local'));
 const save = MODELS.routes.save({ ...MODELS.routes.values(byKey(rows, 'static1'), input), distance: '7' }, byKey(rows, 'static1'), input);
 assert.deepEqual(save.ops[0].values, { target: '10.99.0.0/16', gateway: '10.0.2.2', interface: 'wan', metric: '7', table: null, type: null, source: null, netmask: null });
 rejects(() => MODELS.routes.save({ ...MODELS.routes.defaults(input), dst: '10.0.0.1/8' }, null, input), 'dst');
});

test('filter rules map fw4 sections, counters and order', () => {
 const input = data();
 const rows = MODELS['fw-filter'].rows(input);
 assert.equal(rows.length, 9);
 const [packets, octets] = input.counters.counters['Allow-DHCP-Renew'];
 assert.deepEqual(rows[0].cells, { number: '0', action: 'accept', chain: 'input', src: '', dst: '', proto: 'udp', sport: '', dport: '68', in: 'wan', out: '', family: 'ipv4', bytes: `${octets} B`, packets: String(packets) });
 delete input.counters.counters['Allow-DHCP-Renew'];
 assert.equal(MODELS['fw-filter'].rows(input)[0].cells.bytes, '');
 assert.equal(byKey(rows, 'cfg0a92bd').cells.packets, String(input.counters.counters['Allow-ICMPv6-Input'][0]));
 assert.equal(byKey(rows, 'cfg0b92bd').cells.chain, 'forward');
 const rule = MODELS['fw-filter'].save({ ...MODELS['fw-filter'].defaults(input), dest_port: { negate: false, value: '8443' }, proto: 'tcp' }, null, input);
 assert.deepEqual(rule.ops[0], { op: 'add', config: 'firewall', type: 'rule', values: { src: 'wan', dest: null, family: null, proto: 'tcp', src_ip: null, dest_ip: null, src_port: null, dest_port: '8443', icmp_type: [], src_mac: null, mark: null, limit: null, limit_burst: null, target: 'ACCEPT' } });
 rejects(() => MODELS['fw-filter'].save({ ...MODELS['fw-filter'].defaults(input), dest_port: { negate: false, value: 'http' } }, null, input), 'dest_port');
 const negated = MODELS['fw-filter'].save({ ...MODELS['fw-filter'].defaults(input), src_ip: { negate: true, value: '10.0.0.0/8' } }, null, input);
 assert.equal(negated.ops[0].values.src_ip, '!10.0.0.0/8');
 // Moving the last rule first keeps defaults, zones and forwardings in place.
 const order = MODELS['fw-filter'].order([rows.at(-1).key, ...rows.slice(0, -1).map(row => row.key)], input).ops[0].sections;
 assert.deepEqual(order.slice(0, 5), ['cfg01e63d', 'cfg02dc81', 'cfg03dc81', 'cfg04ad58', 'cfg0d92bd']);
 assert.equal(order.length, Object.keys(input['uci:firewall']).length);
});

test('NAT shows zone masquerading and builds DNAT and SNAT sections', () => {
 const input = data();
 const rows = MODELS['fw-nat'].rows(input);
 assert.deepEqual(rows.map(row => [row.cells.action, row.cells.out, row.flags]), [['masquerade', 'wan', 'D']]);
 const forward = MODELS['fw-nat'].save({ ...MODELS['fw-nat'].defaults(input), dport: '8080', to: '192.168.77.10', toPorts: '80', proto: 'tcp' }, null, input);
 assert.deepEqual(forward.ops[0].values, { target: 'DNAT', src: 'wan', dest: null, proto: 'tcp', src_ip: null, src_dip: null, src_dport: '8080', dest_ip: '192.168.77.10', dest_port: '80' });
 const snat = MODELS['fw-nat'].save({ ...MODELS['fw-nat'].defaults(input), chain: 'srcnat', action: 'src-nat', out: 'wan', to: '10.0.2.15', proto: 'all' }, null, input);
 assert.equal(snat.ops[0].type, 'nat');
 assert.equal(snat.ops[0].values.snat_ip, '10.0.2.15');
 rejects(() => MODELS['fw-nat'].save({ ...MODELS['fw-nat'].defaults(input), to: '' }, null, input), 'to');
});

test('zones refuse removal while rules use them', () => {
 const input = data();
 const rows = MODELS['fw-zones'].rows(input);
 assert.deepEqual(rows.map(row => [row.name, row.cells.forwards, row.cells.masq]), [['lan', 'wan', ''], ['wan', '', 'yes']]);
 assert.match(MODELS['fw-zones'].removeBlocked([rows[1]], input), /used by 9 firewall rules/);
 const guest = MODELS['fw-zones'].save({ ...MODELS['fw-zones'].defaults(), name: 'guest', forwards: ['wan'] }, null, input);
 assert.deepEqual(guest.ops.map(op => [op.op, op.type, op.values?.dest]), [['add', 'zone', undefined], ['add', 'forwarding', 'wan']]);
 const lan = MODELS['fw-zones'].save({ ...MODELS['fw-zones'].values(rows[0], input), forwards: [] }, rows[0], input);
 assert.deepEqual(lan.ops.at(-1), { op: 'delete', config: 'firewall', section: 'cfg04ad58' });
});

test('connections, DHCP servers and leases', () => {
 const input = data();
 const connections = MODELS.connections.rows(input);
 assert.ok(connections.every(row => row.cells.src && row.cells.proto));
 assert.ok(connections.some(row => row.cells.src.startsWith('[fe80::')));
 const servers = MODELS['dhcp-servers'].rows(input);
 assert.deepEqual(servers.map(row => [row.cells.name, row.flags, row.cells.pool]), [['lan', '', '192.168.77.100-192.168.77.249'], ['wan', 'X', '']]);
 input.leases.dhcp_leases = [{ expires: 3600, hostname: 'laptop', macaddr: '52:54:00:aa:bb:cc', ipaddr: '192.168.77.120' }, { expires: 60, hostname: 'phone', macaddr: '52:54:00:dd:ee:ff', ipaddr: '192.168.77.121' }];
 input['uci:dhcp'].phone = { '.type': 'host', '.name': 'phone', '.index': 9, '.anonymous': false, name: 'phone', mac: '52:54:00:DD:EE:FF', ip: '192.168.77.121' };
 const leases = MODELS['dhcp-leases'].rows(input);
 assert.deepEqual(leases.map(row => [row.cells.address, row.flags, row.cells.status, row.cells.expires]), [['192.168.77.121', '', 'bound', '00:01:00'], ['192.168.77.120', 'D', 'bound', '01:00:00']]);
 const tool = MODELS['dhcp-leases'].tools[0];
 assert.equal(tool.enabled([leases[1]]), true);
 assert.equal(tool.enabled(leases), false);
 assert.deepEqual(tool.run([leases[1]], input).ops[0].values, { name: 'laptop', mac: '52:54:00:aa:bb:cc', ip: '192.168.77.120', dns: '1' });
 assert.throws(() => MODELS['dhcp-leases'].save({ address: '192.168.77.121', mac: '02:00:00:00:00:09', hostname: '', leasetime: '' }, null, input), /Already reserved by phone/);
});

test('log entries keep their order and highlight problems', () => {
 const rows = MODELS.log.rows({ log: { entries: [
  { id: 1, time: Date.UTC(2026, 9, 18, 8, 0, 0), facility: 'daemon', severity: 'warning', tag: 'odhcpd', message: 'no prefix' },
  { id: 2, time: Date.UTC(2026, 9, 18, 8, 0, 1), facility: 'kern', severity: 'err', message: 'link down' }
 ] } });
 assert.deepEqual(rows.map(row => [row.key, row.tone, row.cells.topics, row.cells.message]), [['1', 'warning', 'daemon, warning', 'odhcpd: no prefix'], ['2', 'error', 'kern, err', 'link down']]);
});

test('reordering keeps sections of other types in place', () => {
 const values = { a: { '.name': 'a', '.type': 'zone', '.index': 0 }, b: { '.name': 'b', '.type': 'rule', '.index': 1 }, c: { '.name': 'c', '.type': 'forwarding', '.index': 2 }, d: { '.name': 'd', '.type': 'rule', '.index': 3 } };
 assert.deepEqual(reorderOps('firewall', values, ['d', 'b'], ['rule'])[0].sections, ['a', 'd', 'c', 'b']);
 assert.deepEqual(reorderOps('firewall', values, ['d'], ['rule'])[0].sections, ['a', 'd', 'c', 'b']);
});

test('IPv6 helpers canonicalize, validate and find networks', async () => {
 const ip = await import('../../console/src/lib/ip.js');
 assert.equal(ip.canonicalIPv6('2001:DB8:0:0:1:0:0:1'), '2001:db8::1:0:0:1');
 assert.equal(ip.canonicalIPv6('1::2::3'), null);
 assert.equal(ip.canonicalIPv6('2001:db8::1:2:3:4:5:6'), null);
 assert.deepEqual(ip.parseCidr6('fd50:b8c1:5fb2::1/60'), { address: 'fd50:b8c1:5fb2::1', prefix: 60, network: 'fd50:b8c1:5fb2::', cidr: 'fd50:b8c1:5fb2::1/60', linkLocal: false });
 assert.equal(ip.parseCidr6('fe80::1/64').linkLocal, true);
 assert.equal(ip.prefixFromMask6('ffff:ffff:ffff:fff0::'), 60);
 assert.ok(ip.addressKey('10.0.0.1') < ip.addressKey('::1') && ip.addressKey('fd00::/8') < ip.addressKey('fe80::/64'));
});

test('IPv6 addresses: static, pool, DHCPv6 and link-local', () => {
 const input = data();
 const rows = MODELS.addresses6.rows(input);
 assert.deepEqual(rows.map(row => [row.cells.address, row.flags, row.cells.pool, row.cells.interface, row.cells.advertise]), [
  ['fd50:b8c1:5fb2::1/60', 'DG', 'fd50:b8c1:5fb2::/60', 'lan (br-lan)', 'yes'],
  ['fec0::5054:ff:fe12:3457/64', 'DG', '', 'wan6 (eth1)', ''],
  ['fe80::5054:ff:fe12:3457/64', 'DL', '', 'eth1', ''],
  ['fe80::5054:ff:fe12:3456/64', 'DL', '', 'br-lan', '']
 ]);
 const add = MODELS.addresses6.save({ address: 'FD00:88::1/64', interface: 'lan' }, null, input);
 assert.deepEqual(add.ops, [{ op: 'set', config: 'network', section: 'lan', values: { ip6addr: ['fd00:88::1/64'] } }]);
 rejects(() => MODELS.addresses6.save({ address: 'fd00:88::/64', interface: 'lan' }, null, input), 'address');
 rejects(() => MODELS.addresses6.save({ address: 'fd00:88::1', interface: 'lan' }, null, input), 'address');
 input['uci:network'].lan.ip6addr = ['fd00:88::1/64'];
 rejects(() => MODELS.addresses6.save({ address: 'fd00:88:0::1/64', interface: 'lan' }, null, input), 'address');
 const listed = MODELS.addresses6.rows(input).find(row => row.key === 'lan#0');
 assert.equal(listed.flags, 'IG');
 assert.deepEqual(MODELS.addresses6.remove([listed], input).ops[0].values, { ip6addr: [] });
});

test('IPv6 routes from the kernel and route6 sections', () => {
 const input = data();
 input['uci:network'].lab6 = { '.type': 'route6', '.name': 'lab6', '.index': 9, '.anonymous': false, interface: 'lan', target: '2001:db8:100::/48', gateway: 'FD50:B8C1:5FB2::2' };
 input.routes6.push({ dst: '2001:db8:100::/48', gateway: 'fd50:b8c1:5fb2::2', dev: 'br-lan', protocol: 'static', metric: 1024, flags: [] });
 const rows = MODELS.routes6.rows(input);
 assert.equal(rows.find(row => row.key === 'lab6').flags, 'AS');
 assert.equal(rows.find(row => row.key === 'lab6').cells.gateway, 'fd50:b8c1:5fb2::2');
 const main = rows.filter(row => MODELS.routes6.filter.match(row, 'main'));
 const flags = dst => main.filter(row => row.cells.dst === dst).map(row => row.flags);
 assert.deepEqual(flags('::/0'), ['DA']);
 assert.equal(main.find(row => row.cells.dst === '::/0').cells.prefsrc, 'fec0::/64');
 assert.deepEqual(flags('fe80::/64'), ['DAC', 'DAC']);
 assert.deepEqual(flags('fd50:b8c1:5fb2::/48'), ['DA']);
 const save = MODELS.routes6.save({ ...MODELS.routes6.defaults(input), dst: '2001:DB8:200::/48', gateway: 'FE80:0:0::1', interface: 'wan6' }, null, input);
 assert.deepEqual(save.ops[0], { op: 'add', config: 'network', type: 'route6', values: { target: '2001:db8:200::/48', gateway: 'fe80::1', interface: 'wan6', metric: null, table: null, type: null, source: null } });
 rejects(() => MODELS.routes6.save({ ...MODELS.routes6.defaults(input), dst: '2001:db8::1/32', interface: 'wan6' }, null, input), 'dst');
 rejects(() => MODELS.routes6.save({ ...MODELS.routes6.defaults(input), dst: '::/0', gateway: '10.0.0.1', interface: 'wan6' }, null, input), 'gateway');
});

test('bridges, ports and VLANs', async () => {
 const { parseVlanPort } = await import('../../console/src/model/bridge.js');
 const input = data();
 const bridges = MODELS.bridges.rows(input);
 assert.deepEqual(bridges.map(row => [row.name, row.flags, row.cells.ports, row.cells.vlan]), [['br-lan', 'R', 'eth0', '']]);
 assert.equal(MODELS.bridges.removeBlocked(bridges, input), 'Bridge br-lan is used by network lan');
 assert.deepEqual(MODELS.bridges.save({ ...MODELS.bridges.defaults(), name: 'br-iot', stp: true }, null, input).ops[0].values, { name: 'br-iot', type: 'bridge', mtu: null, macaddr: null, stp: '1', igmp_snooping: null, bridge_empty: '1' });

 const ports = MODELS['bridge-ports'].rows(input);
 assert.deepEqual(ports.map(row => [row.key, row.flags, row.cells.pvid]), [['br-lan:eth0', 'R', '']]);
 assert.deepEqual(MODELS['bridge-ports'].save({ interface: 'eth1', bridge: 'br-lan' }, null, input).ops, [{ op: 'set', config: 'network', section: 'cfg030f15', values: { ports: ['eth0', 'eth1'] } }]);
 rejects(() => MODELS['bridge-ports'].save({ interface: 'eth0', bridge: 'br-lan' }, null, input), 'interface');

 input['uci:network'].v10 = { '.type': 'bridge-vlan', '.name': 'v10', '.index': 10, '.anonymous': false, device: 'br-lan', vlan: '10', ports: ['eth0:u*'] };
 input['uci:network'].v20 = { '.type': 'bridge-vlan', '.name': 'v20', '.index': 11, '.anonymous': false, device: 'br-lan', vlan: '20', ports: ['eth0:t'] };
 assert.deepEqual(parseVlanPort('eth0:t*'), { port: 'eth0', tagged: true, pvid: true });
 assert.deepEqual(MODELS['bridge-ports'].rows(input).map(row => [row.cells.pvid, row.cells.tagged]), [['10', '20']]);
 const vlans = MODELS['bridge-vlans'].rows(input);
 assert.deepEqual(vlans.map(row => [row.cells.vlan, row.cells.tagged, row.cells.untagged, row.cells.pvid, row.flags]), [['10', '', 'eth0', 'eth0', 'I'], ['20', 'eth0', '', '', 'I']]);
 rejects(() => MODELS['bridge-vlans'].save({ bridge: 'br-lan', vlan: '20', tagged: [], untagged: [], pvid: [], local: true }, null, input), 'vlan');
 rejects(() => MODELS['bridge-vlans'].save({ bridge: 'br-lan', vlan: '30', tagged: ['eth0'], untagged: ['eth0'], pvid: [], local: true }, null, input), 'untagged');
 rejects(() => MODELS['bridge-vlans'].save({ bridge: 'br-lan', vlan: '30', tagged: [], untagged: ['eth0'], pvid: ['eth0'], local: true }, null, input), 'pvid');
 assert.deepEqual(MODELS['bridge-vlans'].save({ bridge: 'br-lan', vlan: '030', tagged: [], untagged: ['eth0'], pvid: [], local: false }, null, input).ops[0].values, { device: 'br-lan', vlan: '30', ports: ['eth0:u'], local: '0' });
 // Removing a port also removes it from the bridge's VLANs.
 const removed = MODELS['bridge-ports'].remove(MODELS['bridge-ports'].rows(input), input);
 assert.deepEqual(removed.ops.map(op => [op.section, op.values.ports]), [['cfg030f15', []], ['v10', []], ['v20', []]]);
 assert.deepEqual(MODELS.bridges.remove(MODELS.bridges.rows(input), input).ops.map(op => op.section), ['cfg030f15', 'v10', 'v20']);
});
