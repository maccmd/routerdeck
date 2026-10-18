// IP Settings, IP Pool, Mangle, Raw, firewall settings and the WiFi access list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError } from '../../console/src/model/common.js';
import { setSysctl, SYSCTL_KEYS } from '../../console/src/model/ipsettings.js';
import { mangleChain } from '../../console/src/model/firewall.js';

const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);
const fixture = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/router.json', import.meta.url), 'utf8'));
const wireless = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/wireless.json', import.meta.url), 'utf8'));

test('sysctl.conf keeps its other lines; keys are replaced in place or appended', () => {
 const text = '# User defined entries\nnet.ipv4.ip_forward=1\nvm.swappiness = 10\n';
 assert.equal(setSysctl(text, { 'net.ipv4.ip_forward': '0', 'net.netfilter.nf_conntrack_max': '65536' }), '# User defined entries\nnet.ipv4.ip_forward=0\nvm.swappiness = 10\nnet.netfilter.nf_conntrack_max=65536\n');
 assert.equal(setSysctl(text, { 'vm.swappiness': null }), '# User defined entries\nnet.ipv4.ip_forward=1\n');
 assert.equal(setSysctl('', { 'net.ipv4.ip_forward': '1' }), 'net.ipv4.ip_forward=1\n');
 assert.ok(SYSCTL_KEYS.includes('net.ipv4.conf.default.rp_filter'));
});

test('IP Settings write only what changed, both rp_filter keys at once', () => {
 const model = MODELS['ip-settings'];
 const data = { sysctl: { values: { 'net.ipv4.ip_forward': '1', 'net.ipv4.conf.all.rp_filter': '0', 'net.netfilter.nf_conntrack_max': '47104' }, text: '# mine\n' } };
 const row = model.rows(data)[0], values = model.values(row, data);
 assert.deepEqual(values, { ip_forward: true, rp_filter: '0', conntrack_max: '47104' });
 assert.deepEqual(model.fields(data).map(field => field.id), ['ip_forward', 'rp_filter', 'conntrack_max', 'note']);
 const change = model.save({ ...values, rp_filter: '2' }, row, data, { dirty: new Set(['rp_filter']) });
 assert.deepEqual(change.ops, [{ op: 'text', config: 'sysctl', text: '# mine\nnet.ipv4.conf.all.rp_filter=2\nnet.ipv4.conf.default.rp_filter=2\n', expect: '# mine\n' }]);
 assert.equal(model.save(values, row, data, { dirty: new Set() }), null);
 rejects(() => model.save({ ...values, conntrack_max: '10' }, row, data, { dirty: new Set(['conntrack_max']) }), 'conntrack_max');
});

test('IP pools turn ranges into start and limit inside the network', () => {
 const model = MODELS['ip-pools'];
 const data = { ...structuredClone(fixture), leases: { dhcp_leases: [{ ipaddr: '192.168.77.120' }, { ipaddr: '192.168.77.5' }] } };
 const [lan] = model.rows(data);
 assert.deepEqual([lan.key, lan.cells.ranges, lan.cells.size, lan.cells.used], ['lan', '192.168.77.100-192.168.77.249', '150', '1']);
 assert.deepEqual(model.save({ ranges: '192.168.77.20 - 192.168.77.29' }, lan).ops, [{ op: 'set', config: 'dhcp', section: 'lan', values: { start: '20', limit: '10' } }]);
 rejects(() => model.save({ ranges: '192.168.77.0-192.168.77.10' }, lan), 'ranges');
 rejects(() => model.save({ ranges: '192.168.77.50-192.168.77.40' }, lan), 'ranges');
 rejects(() => model.save({ ranges: 'everything' }, lan), 'ranges');
});

test('mangle rules choose their chain as fw4 does', () => {
 assert.equal(mangleChain({ src: 'lan', dest: '*' }), 'prerouting');
 assert.equal(mangleChain({ src: 'lan' }), 'input');
 assert.equal(mangleChain({ src: '*' }), 'input');
 assert.equal(mangleChain({ src: 'lan', dest: 'wan' }), 'forward');
 assert.equal(mangleChain({ src: '*', dest: '*' }), 'forward');
 assert.equal(mangleChain({ src: '*', dest: 'wan' }), 'postrouting');
 assert.equal(mangleChain({}), 'output');
 assert.equal(mangleChain({ dest: 'wan' }), 'output');
 const model = MODELS['fw-mangle'];
 const data = { ...structuredClone(fixture), counters: { counters: {} } };
 const values = { ...model.defaults(data), chain: 'postrouting', dest: 'wan', target: 'dscp', set_dscp: 'af41' };
 const options = model.save(values, null, data).ops[0].values;
 assert.deepEqual([options.src, options.dest, options.target, options.set_dscp], ['*', 'wan', 'DSCP', 'AF41']);
 assert.equal(mangleChain(options), 'postrouting');
 rejects(() => model.save({ ...values, chain: 'forward', src: 'lan', dest: '*' }, null, data), 'dest');
 rejects(() => model.save({ ...values, set_dscp: '99' }, null, data), 'set_dscp');
 rejects(() => model.save({ ...values, target: 'mark', set_xmark: 'nope' }, null, data), 'set_xmark');
 const raw = MODELS['fw-raw'];
 rejects(() => raw.save({ ...raw.defaults(data), src: '*' }, null, data), 'src');
 assert.equal(raw.save({ ...raw.defaults(data), target: 'helper', set_helper: 'ftp' }, null, data).ops[0].values.set_helper, 'ftp');
});

test('the filter list leaves mangle and raw rules to their tabs', () => {
 const data = { ...structuredClone(fixture), counters: { counters: {} } };
 data['uci:firewall'].mangle1 = { '.type': 'rule', '.name': 'mangle1', '.index': 90, src: 'lan', dest: '*', target: 'MARK', set_xmark: '0x10' };
 data['uci:firewall'].raw1 = { '.type': 'rule', '.name': 'raw1', '.index': 91, src: 'lan', target: 'NOTRACK' };
 assert.ok(!MODELS['fw-filter'].rows(data).some(row => ['mangle1', 'raw1'].includes(row.key)));
 assert.deepEqual(MODELS['fw-mangle'].rows(data).map(row => [row.key, row.cells.chain, row.cells.value]), [['mangle1', 'prerouting', '0x10']]);
 assert.deepEqual(MODELS['fw-raw'].rows(data).map(row => [row.key, row.cells.action]), [['raw1', 'notrack']]);
});

test('firewall settings keep the SYN flood option the file uses and offload with FastPath', () => {
 const model = MODELS['fw-settings'];
 const data = structuredClone(fixture);
 const row = model.rows(data)[0], values = model.values(row, data);
 assert.equal(values.synflood, true);
 const change = model.save({ ...values, synflood: false, flow_offloading: true }, row, data, { dirty: new Set(['synflood', 'flow_offloading']) });
 assert.deepEqual(change.ops[0].values, { syn_flood: '0', synflood_rate: null, synflood_burst: null, flow_offloading: '1', flow_offloading_hw: null });
 rejects(() => model.save({ ...values, synflood_rate: 'fast' }, row, data, { dirty: new Set(['synflood_rate']) }), 'synflood_rate');
});

test('the WiFi access list keeps one policy per access point', () => {
 const model = MODELS['wifi-access-list'];
 const data = structuredClone(wireless);
 const ap = Object.values(data['uci:wireless']).find(section => section['.type'] === 'wifi-iface' && (section.mode ?? 'ap') === 'ap')['.name'];
 const first = model.save({ mac: '52:54:00:AA:00:01', iface: ap, action: 'deny' }, null, data);
 assert.deepEqual(first.ops, [{ op: 'set', config: 'wireless', section: ap, values: { macfilter: 'deny', maclist: ['52:54:00:aa:00:01'] } }]);
 data['uci:wireless'][ap].macfilter = 'deny';
 data['uci:wireless'][ap].maclist = ['52:54:00:aa:00:01'];
 const rows = model.rows(data);
 assert.deepEqual(rows.map(row => [row.cells.mac, row.cells.action]), [['52:54:00:aa:00:01', 'deny']]);
 rejects(() => model.save({ mac: '52:54:00:aa:00:02', iface: ap, action: 'allow' }, null, data), 'action');
 rejects(() => model.save({ mac: '52:54:00:aa:00:01', iface: ap, action: 'deny' }, null, data), 'mac');
 rejects(() => model.save({ mac: 'nope', iface: ap, action: 'deny' }, null, data), 'mac');
 assert.deepEqual(model.remove(rows, data).ops, [{ op: 'set', config: 'wireless', section: ap, values: { maclist: null, macfilter: null } }]);
 // The access point form edits the same filter.
 const wifi = MODELS['wifi-interfaces'];
 const apRow = wifi.rows({ ...data, wireless: {}, wifi: {} }).find(row => row.key === ap);
 const values = wifi.values(apRow, data);
 assert.deepEqual([values.macfilter, values.maclist], ['deny', ['52:54:00:aa:00:01']]);
 rejects(() => wifi.save({ ...values, ieee80211r: true, mobility_domain: 'xyz' }, apRow, data, { dirty: new Set(['ieee80211r', 'mobility_domain']) }), 'mobility_domain');
 const roaming = wifi.save({ ...values, ieee80211r: true, mobility_domain: '4f57' }, apRow, data, { dirty: new Set(['ieee80211r', 'mobility_domain']) });
 assert.deepEqual(roaming.ops[0].values, { ieee80211r: '1', mobility_domain: '4f57', ft_over_ds: '0', ft_psk_generate_local: null });
});
