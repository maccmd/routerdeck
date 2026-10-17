import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function setup() {
 const context = vm.createContext({ baseclass: { extend: value => value }, rpc: { declare: () => () => Promise.resolve({}) }, URL,
  ui: { menu: { getChildren: node => Object.entries(node.children || {}).filter(([, child]) => child.satisfied && child.title).map(([name, child]) => ({ ...child, name })) } },
  L: { url: (...parts) => '/cgi-bin/luci/' + parts.join('/') }, _: value => value });
 const links = vm.runInContext('(function(){' + readFileSync('luci-theme-routerdeck/htdocs/luci-static/resources/routerdeck-links.js', 'utf8') + '})()', context);
 return { links, context };
}

test('deep targets round-trip literal names and reject malformed or unsupported actions', () => {
 const { links } = setup();
 for (const [kind, name] of [['interface','wan'], ['device','eth0.10'], ['device','br:guest'], ['zone','guest network'], ['lease','cfg00ab'], ['diagnostic','fe80::1%eth0']]) {
  const parsed = links.parseTarget(links.hash(kind, name));
  assert.equal(parsed.kind, kind); assert.equal(parsed.name, name);
 }
 for (const hash of ['#rd:apply:network', '#rd:interface:', '#rd:device:%ZZ', '#rd:device:%00', '#rd:interface:' + 'a'.repeat(129), '#device=eth0']) assert.equal(links.parseTarget(hash), null);
});

test('diagnostic targets accept literal host addresses but never commands or prefixes', () => {
 const { links } = setup();
 for (const address of ['10.0.2.2', '0.0.0.0', '255.255.255.255', '::1', 'fe80::1%eth0', '2001:db8::10']) assert.equal(links.address(address), true, address);
 for (const address of ['256.0.0.1','1.2.3','10.0.2.0/24','--help',';reboot','host.example',':::', 'fe80::1%eth0\n', 'http://10.0.2.2']) assert.equal(links.address(address), false, address);
});

test('links are absent without a permitted destination and encode object names in the query', () => {
 const { links } = setup();
 links.paths = { interfaces: 'admin/network/network' };
 assert.equal(links.targetUrl('zone', 'lan'), null);
 assert.equal(links.targetUrl('device', 'eth0'), null);
 assert.equal(links.targetUrl('interface', 'x/#?'), '/cgi-bin/luci/admin/network/network?rd=interface%3Ax%2F%23%3F');
});

function targetFixture(kind, name, config, rowId) {
 const { links, context } = setup();
 let clicks = 0, revealed = false, notice = false;
 const row = { dataset: { sid: rowId }, querySelector: () => ({ disabled: false, click: () => clicks++ }) };
 const grid = { querySelectorAll: () => [row] };
 context.location = { hash: links.hash(kind, name), href: 'http://router/cgi-bin/luci/admin/network/network' + links.hash(kind, name) };
 context.document = { body: { classList: { contains: () => false } }, getElementById: () => grid };
 links.current = 'admin/network/network';
 links.paths = { devices: links.current, interfaces: links.current };
 links.config = { network: config };
 links.reveal = node => { revealed = node === row; };
 links.notice = () => { notice = true; };
 links.openTarget();
 return { get clicks() { return clicks; }, revealed, notice, links };
}

test('an unconfigured runtime device is revealed without creating a UCI section', () => {
 const result = targetFixture('device', 'eth1', {}, 'dev:eth1');
 assert.equal(result.revealed, true); assert.equal(result.clicks, 0); assert.equal(result.notice, true);
});

test('configured devices resolve by exact UCI name and open the existing editor once', () => {
 const result = targetFixture('device', 'br-lan', { cfg001: { '.type': 'device', name: 'br-lan' } }, 'cfg001');
 assert.equal(result.revealed, true); assert.equal(result.clicks, 1);
 result.links.openTarget(); // handled target does not reopen on polling updates
 assert.equal(result.clicks, 1);
});

test('missing and ambiguous devices never open an unrelated row', () => {
 const missing = targetFixture('interface', 'missing', {}, 'wan');
 assert.equal(missing.clicks, 0); assert.equal(missing.notice, true);
 const ambiguous = targetFixture('device', 'br-lan', { a: { '.type': 'device', name: 'br-lan' }, b: { '.type': 'device', name: 'br-lan' } }, 'a');
 assert.equal(ambiguous.clicks, 0); assert.equal(ambiguous.notice, true);
});


test('menu dependencies and denied parent branches remove contextual destinations', () => {
 const { links } = setup();
 const node = (title, children = {}, satisfied = true) => ({ title, children, satisfied });
 const paths = links.pagePaths({ children: { admin: node('Admin', {
  network: node('Network', { network: node('Interfaces'), wireless: node('Wireless', {}, false), firewall: node('Firewall', { zones: node('Zones'), rules: node('Rules') }, false) }),
  status: node('Status', { routesj: node('Routing', {}, false), routes: node('Routing') })
 }) } });
 assert.equal(paths.interfaces, 'admin/network/network');
 assert.equal(paths.routes, 'admin/status/routes');
 assert.equal(paths.wireless, undefined); assert.equal(paths.firewall, undefined); assert.equal(paths.rules, undefined);
});


test('query targets survive percent signs and take precedence over native tab hashes', () => {
 const { links, context } = setup();
 links.paths = { devices: 'admin/network/network' };
 const name = 'eth0%guest';
 context.location = { href: 'http://router' + links.targetUrl('device', name) + '#native-tab', hash: '#native-tab' };
 assert.equal(links.parseTarget(links.requestedHash()).name, name);
});


test('connection endpoints keep the port out of the diagnostic address', () => {
 const { links } = setup();
 assert.equal(links.endpointAddress('10.0.2.2:443'), '10.0.2.2');
 assert.equal(links.endpointAddress('[2001:db8::1]:https'), '2001:db8::1');
 assert.equal(links.endpointAddress('host.example:https'), null);
 assert.equal(links.endpointAddress('[::1]:--help;reboot'), null);
});
