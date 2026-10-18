// Quick Set against data captured from a real OpenWrt 25.12.5 guest, with
// the hwsim access point captured on the same release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError } from '../../console/src/model/common.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/router.json', import.meta.url), 'utf8'));
const wireless = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/wireless.json', import.meta.url), 'utf8'));
const data = () => ({ ...structuredClone(fixture), 'uci:wireless': structuredClone(wireless['uci:wireless']), 'uci:system': { cfg01e48a: { '.anonymous': true, '.type': 'system', '.name': 'cfg01e48a', '.index': 0, hostname: 'OpenWrt', timezone: 'UTC' } } });
const model = MODELS['quick-set'];
const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);

function save(input, changes) {
 const row = model.rows(input)[0];
 return model.save({ ...model.values(row, input), ...changes }, row, input, { dirty: new Set(Object.keys(changes)) });
}

test('Quick Set reads the default wan and lan networks, DHCP, WiFi and identity', () => {
 const input = data();
 const values = model.values(model.rows(input)[0], input);
 assert.deepEqual(values, {
  wanProto: 'dhcp', wanAddress: '', wanGateway: '', wanDns: [], pppUser: '', pppPassword: '', nat: true,
  lanAddress: '192.168.77.1/24', dhcpServer: true, dhcpRange: '192.168.77.100-192.168.77.249',
  ssid: 'RD-Test', wifiKey: 'routerdeck-test', wifiEnabled: true, hostname: 'OpenWrt'
 });
 const fields = model.fields(input, model.rows(input)[0]).filter(field => field.visible?.(values) ?? true);
 assert.deepEqual([...new Set(fields.map(field => field.tab))], ['Internet', 'Local Network', 'WiFi', 'System']);
 assert.equal(fields.find(field => field.id === 'wifiTargets').value(), 'RD-Test on radio0');
});

test('Quick Set turns every edit into one change with one description', () => {
 const input = data();
 const change = save(input, { wanProto: 'static', wanAddress: '203.0.113.2/24', wanGateway: '203.0.113.1', wanDns: ['9.9.9.9'], lanAddress: '192.168.88.1/24', dhcpRange: '192.168.88.10-192.168.88.254', ssid: 'Home', wifiKey: 'correct-horse', hostname: 'home-router' });
 assert.equal(change.description, 'Quick Set: Internet static 203.0.113.2/24, LAN 192.168.88.1/24, DHCP server, WiFi Home, WiFi password, identity home-router');
 assert.deepEqual(change.ops, [
  { op: 'set', config: 'network', section: 'wan', values: { ipaddr: '203.0.113.2/24', netmask: null, gateway: '203.0.113.1', username: null, password: null, proto: 'static', dns: ['9.9.9.9'] } },
  { op: 'set', config: 'network', section: 'lan', values: { ipaddr: '192.168.88.1/24', netmask: null } },
  { op: 'set', config: 'dhcp', section: 'lan', values: { ignore: null, start: '10', limit: '245' } },
  { op: 'set', config: 'wireless', section: 'default_radio0', values: { ssid: 'Home' } },
  { op: 'set', config: 'wireless', section: 'default_radio0', values: { key: 'correct-horse' } },
  { op: 'set', config: 'system', section: 'cfg01e48a', values: { hostname: 'home-router' } }
 ]);
 assert.equal(change.notice, 'The LAN address is now 192.168.88.1. Continue at http://192.168.88.1/routerdeck/');
 // Untouched settings produce no operations.
 assert.equal(save(input, {}), null);
});

test('Quick Set switches the Internet connection and cleans up the old one', () => {
 const input = data();
 Object.assign(input['uci:network'].wan, { proto: 'static', ipaddr: '203.0.113.2', netmask: '255.255.255.0', gateway: '203.0.113.1', dns: ['9.9.9.9'] });
 assert.equal(model.values(model.rows(input)[0], input).wanAddress, '203.0.113.2/24');
 assert.deepEqual(save(input, { wanProto: 'pppoe', pppUser: 'customer@isp.example', pppPassword: 'secret' }).ops, [
  { op: 'set', config: 'network', section: 'wan', values: { ipaddr: null, netmask: null, gateway: null, dns: null, username: 'customer@isp.example', password: 'secret', proto: 'pppoe' } }
 ]);
 assert.deepEqual(save(input, { wanProto: 'dhcp' }).ops[0].values, { ipaddr: null, netmask: null, gateway: null, dns: null, username: null, password: null, proto: 'dhcp' });
 assert.deepEqual(save(input, { nat: false }).ops, [{ op: 'set', config: 'firewall', section: 'cfg03dc81', values: { masq: null } }]);
});

test('Quick Set keeps further LAN addresses and enables WiFi with its radio', () => {
 const input = data();
 input['uci:network'].lan.ipaddr = ['192.168.77.1/24', '10.9.0.1/24'];
 assert.deepEqual(save(input, { lanAddress: '192.168.50.1/24' }).ops[0].values, { ipaddr: ['192.168.50.1/24', '10.9.0.1/24'], netmask: null });
 input['uci:wireless'].radio0.disabled = '1';
 input['uci:wireless'].default_radio0.disabled = '1';
 assert.equal(model.values(model.rows(input)[0], input).wifiEnabled, false);
 assert.deepEqual(save(input, { wifiEnabled: true }).ops, [
  { op: 'set', config: 'wireless', section: 'default_radio0', values: { disabled: null } },
  { op: 'set', config: 'wireless', section: 'radio0', values: { disabled: null } }
 ]);
 // An open network gets WPA2 with its first password.
 input['uci:wireless'].default_radio0.encryption = 'none';
 assert.deepEqual(save(input, { wifiKey: 'correct-horse' }).ops[0].values, { key: 'correct-horse', encryption: 'psk2' });
});

test('Quick Set rejects settings that would break the router', () => {
 const input = data();
 rejects(() => save(input, { lanAddress: '192.168.88.0/24' }), 'lanAddress');
 rejects(() => save(input, { lanAddress: '192.168.88.1' }), 'lanAddress');
 rejects(() => save(input, { lanAddress: '10.0.0.1/31' }), 'lanAddress');
 rejects(() => save(input, { dhcpRange: '192.168.99.10-192.168.99.20' }), 'dhcpRange');
 rejects(() => save(input, { dhcpRange: '192.168.77.200-192.168.77.100' }), 'dhcpRange');
 rejects(() => save(input, { wanProto: 'static', wanAddress: '203.0.113.2/24', wanGateway: '198.51.100.1' }), 'wanGateway');
 rejects(() => save(input, { wanProto: 'pppoe', pppUser: '' }), 'pppUser');
 rejects(() => save(input, { wifiKey: 'short' }), 'wifiKey');
 rejects(() => save(input, { ssid: 'x'.repeat(33) }), 'ssid');
 rejects(() => save(input, { hostname: 'bad name' }), 'hostname');
});
