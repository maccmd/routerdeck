// Simulated router state behind the mock /ubus endpoint (preview and browser
// tests only). Configuration starts from data captured on OpenWrt 25.12.5,
// plus a few clients, a port forward and a static route. Changes, history,
// Undo and Safe Mode follow the routerdeck rpcd plugin's behaviour.
import { readFileSync } from 'node:fs';

const captured = JSON.parse(readFileSync(new URL('../tests/fixtures/openwrt-25.12/router.json', import.meta.url), 'utf8'));
const capturedWifi = JSON.parse(readFileSync(new URL('../tests/fixtures/openwrt-25.12/wireless.json', import.meta.url), 'utf8'));
const NAME = /^[A-Za-z0-9_]+$/;
const TYPE = /^[A-Za-z0-9_-]+$/;
const PORTS = /^!?\s*\d{1,5}([-:]\d{1,5})?(\s+\d{1,5}([-:]\d{1,5})?)*$/;
const CONFIGS = ['network', 'firewall', 'dhcp', 'wireless', 'system', 'dropbear', 'uhttpd', 'ttyd', 'crontab'];
// Configurations kept as whole texts rather than UCI sections.
const FILES = ['crontab'];
const clone = value => structuredClone(value);
const section = (type, name, index, values, anonymous = false) => ({ '.anonymous': anonymous, '.type': type, '.name': name, '.index': index, ...values });

function initialConfigs() {
 const network = clone(captured['uci:network']), firewall = clone(captured['uci:firewall']), dhcp = clone(captured['uci:dhcp']);
 network.lan.ipaddr = '192.168.88.1/24';
 network.static_lab = section('route', 'static_lab', 20, { interface: 'lan', target: '10.10.0.0/16', gateway: '192.168.88.2', comment: 'Lab network behind the test switch' });
 network.lan.ip6addr = ['fd00:88::1/64'];
 network.static_lab6 = section('route6', 'static_lab6', 21, { interface: 'lan', target: '2001:db8:100::/48', gateway: 'fd00:88::2', comment: 'Lab IPv6 prefix' });
 network.cfg1592bd = section('device', 'cfg1592bd', 22, { name: 'br-iot', type: 'bridge', ports: ['eth2', 'eth3'], igmp_snooping: '1' }, true);
 network.cfg1692bd = section('bridge-vlan', 'cfg1692bd', 23, { device: 'br-iot', vlan: '10', ports: ['eth2:u*', 'eth3:t'] }, true);
 network.cfg1792bd = section('bridge-vlan', 'cfg1792bd', 24, { device: 'br-iot', vlan: '20', ports: ['eth3:t'], comment: 'Cameras' }, true);
 firewall.cfg1192bd = section('redirect', 'cfg1192bd', 20, { name: 'Web server', target: 'DNAT', src: 'wan', dest: 'lan', proto: 'tcp', src_dport: '8080', dest_ip: '192.168.88.10', dest_port: '80' }, true);
 firewall.cfg1292bd = section('rule', 'cfg1292bd', 21, { name: 'Block-Telnet', src: 'lan', dest: 'wan', proto: 'tcp', dest_port: '23', target: 'REJECT', enabled: '0' }, true);
 dhcp.cfg1392bd = section('host', 'cfg1392bd', 20, { name: 'nas', mac: '52:54:00:aa:10:01', ip: '192.168.88.10', dns: '1', duid: '000100012a3b4c5d525400aa1001', hostid: '10' }, true);
 dhcp.cfg1892bd = section('domain', 'cfg1892bd', 21, { name: 'printer.lan', ip: '192.168.88.122' }, true);
 dhcp.cfg1992bd = section('cname', 'cfg1992bd', 22, { cname: 'files.lan', target: 'nas.lan', comment: 'Shared folders' }, true);
 network.wg0 = section('interface', 'wg0', 26, { proto: 'wireguard', private_key: 'oK56DE9Ue9zK76rAc8pBl6opph+1v36lm7cXXsQKrQM=', listen_port: '51820', addresses: ['10.8.0.1/24'] });
 network.cfg2092bd = section('wireguard_wg0', 'cfg2092bd', 27, { description: 'phone', public_key: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=', allowed_ips: ['10.8.0.2/32'], persistent_keepalive: '25' }, true);
 network.cfg2192bd = section('rule', 'cfg2192bd', 28, { src: '192.168.88.128/25', lookup: '100', priority: '1000', comment: 'Upper half via table 100' }, true);
 firewall.cfg2292bd = section('ipset', 'cfg2292bd', 22, { name: 'blocklist', family: 'ipv4', match: ['net'], entry: ['198.51.100.0/24', '203.0.113.66'] }, true);
 dhcp.lan.dhcp_option = ['42,192.168.88.1'];
 network.pppoe_backup = section('interface', 'pppoe_backup', 25, { proto: 'pppoe', device: 'eth1', username: 'customer@isp.example', password: 'not-a-real-password', service: 'internet', disabled: '1', comment: 'Backup line' });
 const wireless = clone(capturedWifi['uci:wireless']);
 const system = {
  cfg01e48a: section('system', 'cfg01e48a', 0, { hostname: 'routerdeck-preview', timezone: 'UTC', zonename: 'UTC', log_size: '128', log_proto: 'udp', conloglevel: '8', cronloglevel: '7' }, true),
  ntp: section('timeserver', 'ntp', 1, { server: ['0.openwrt.pool.ntp.org', '1.openwrt.pool.ntp.org'] })
 };
 // Values captured on OpenWrt 25.12.5.
 const dropbear = { main: section('dropbear', 'main', 0, { enable: '1', PasswordAuth: 'on', RootPasswordAuth: 'on', Port: '22' }) };
 const uhttpd = { main: section('uhttpd', 'main', 0, { listen_http: ['0.0.0.0:80', '[::]:80'], listen_https: ['0.0.0.0:443', '[::]:443'], redirect_https: '0', home: '/www', rfc1918_filter: '1', cert: '/etc/uhttpd.crt', key: '/etc/uhttpd.key', ubus_prefix: '/ubus' }) };
 const ttyd = { cfg2392bd: section('ttyd', 'cfg2392bd', 0, { interface: '@lan', command: '/bin/login' }, true) };
 const crontab = '# Reload WiFi at night\n0 4 * * * wifi reload\n#*/30 * * * * /usr/bin/check-wan\n';
 return { network, firewall, dhcp, wireless, system, dropbear, uhttpd, ttyd, crontab };
}

const CLIENTS = [
 { hostname: 'nas', macaddr: '52:54:00:aa:10:01', ipaddr: '192.168.88.10' },
 { hostname: 'laptop', macaddr: '52:54:00:aa:10:02', ipaddr: '192.168.88.120' },
 { hostname: 'phone', macaddr: '52:54:00:aa:10:03', ipaddr: '192.168.88.121' },
 { hostname: 'printer', macaddr: '52:54:00:aa:10:04', ipaddr: '192.168.88.122' },
 { macaddr: '52:54:00:aa:10:05', ipaddr: '192.168.88.123' }
];
const LOG_TEXT = [
 [3, 6, 'dnsmasq-dhcp', 'DHCPACK(br-lan) 192.168.88.120 52:54:00:aa:10:02 laptop'],
 [3, 6, 'dnsmasq', 'query[A] openwrt.org from 192.168.88.121'],
 [10, 6, 'dropbear', 'Child connection from 192.168.88.120:52144'],
 [0, 6, 'kernel', 'br-lan: port 1(eth1) entered forwarding state'],
 [3, 4, 'odhcpd', 'A default route is present but there is no public prefix on lan'],
 [3, 6, 'netifd', 'Network device \'eth0\' link is up'],
 [3, 3, 'ntpd', 'Failed to resolve 0.openwrt.pool.ntp.org'],
 [3, 5, 'firewall', 'Reloading firewall due to ifupdate of wan (eth0)']
];
const FACILITIES = ['kern', 'user', 'mail', 'daemon', 'auth', 'syslog', 'lpr', 'news', 'uucp', 'cron', 'authpriv'];
const SEVERITIES = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];

export function createMockRouter({ now = () => Date.now(), safeTimeout = 120 } = {}) {
 let configs = initialConfigs();
 let history = [], historyId = 0, serial = 0x14;
 let safe = null, lastRollback = null, lastReboot = null;
 const started = now();
 const seconds = () => Math.max(0, (now() - started) / 1000);
 const text = config => JSON.stringify(configs[config]);

 function sectionsOf(config, type) {
  return Object.values(configs[config]).filter(item => item['.type'] === type).sort((a, b) => a['.index'] - b['.index']);
 }

 function setValues(target, values) {
  for (let [key, value] of Object.entries(values ?? {})) {
   // The plugin makes new WireGuard keys on the router; so does the mock.
   if (value === '@generate:wireguard-key') value = Buffer.from(Array.from({ length: 32 }, (unused, index) => (index * 37 + serial) % 256)).toString('base64');
   if (value == null || value === '' || (Array.isArray(value) && !value.length)) delete target[key];
   else target[key] = value;
  }
 }

 function stage(next, ops) {
  const created = {};
  const resolve = name => typeof name === 'string' && name.startsWith('$') ? created[name] : name;
  for (const op of ops) {
   const values = next[op?.config];
   if (!CONFIGS.includes(op?.config)) return { ok: false, error: 'invalid', message: `Configuration ${op?.config} cannot be changed here` };
   if (FILES.includes(op.config)) {
    if (op.op !== 'text' || typeof op.text !== 'string') return { ok: false, error: 'invalid', message: `${op.config} takes a text` };
    if (op.expect != null && op.expect !== next[op.config]) return { ok: false, error: 'conflict', message: `${op.config} was changed meanwhile; look again and repeat the change` };
    next[op.config] = op.text;
    continue;
   }
   for (const key of Object.keys(op.values ?? {})) if (!NAME.test(key)) return { ok: false, error: 'invalid', message: `Invalid value for ${key}` };
   if (op.op === 'add') {
    if (typeof op.type !== 'string' || !TYPE.test(op.type)) return { ok: false, error: 'invalid', message: 'Invalid section type' };
    const name = op.name ?? `cfg${(serial++).toString(16).padStart(2, '0')}92bd`;
    if (op.name && (!NAME.test(op.name) || values[op.name])) return { ok: false, error: 'exists', message: `${op.name} already exists` };
    values[name] = section(op.type, name, Math.max(-1, ...Object.values(values).map(item => item['.index'])) + 1, {}, !op.name);
    setValues(values[name], op.values);
    if (op.ref) created[op.ref] = name;
    continue;
   }
   if (op.op === 'order') {
    op.sections.map(resolve).forEach((name, index) => { if (values[name]) values[name]['.index'] = index; });
    continue;
   }
   const target = values[resolve(op.section)];
   if (!target) return { ok: false, error: 'missing', message: `${op.config} ${op.section} no longer exists` };
   if (op.op === 'delete') delete values[resolve(op.section)];
   else if (op.op === 'unset') (op.options ?? []).forEach(option => delete target[option]);
   else if (op.op === 'set') setValues(target, op.values);
   else return { ok: false, error: 'invalid', message: `Unknown operation ${op.op}` };
  }
  return { ok: true, created };
 }

 // Imitates `fw4 check`: invalid ports skip a section with a warning.
 function firewallProblems(firewall) {
  const problems = [];
  Object.values(firewall).forEach(item => {
   for (const option of ['src_port', 'dest_port', 'src_dport']) {
    if (item[option] !== undefined && !PORTS.test(String(item[option]).trim())) problems.push(`[!] Section ${item['.name']} (${item.name ?? ''}) option '${option}' specifies invalid value '${item[option]}'`);
   }
  });
  return problems;
 }

 function restoreSafe(reason) {
  configs = clone(safe.snapshot);
  history = history.filter(entry => !entry.safemode);
  lastRollback = { time: Math.floor(now() / 1000), user: safe.user, reason, configs: CONFIGS };
  safe = null;
 }

 // The watchdog runs on every request instead of a timer.
 function watchdog() {
  if (safe && now() - safe.heartbeat > safe.timeout * 1000) restoreSafe('timed out');
 }

 function apply({ description, ops }, user) {
  if (!Array.isArray(ops) || !ops.length) return { ok: false, error: 'invalid', message: 'No changes were sent' };
  const next = clone(configs);
  const staged = stage(next, ops);
  if (!staged.ok) return staged;
  const changed = CONFIGS.filter(config => JSON.stringify(next[config]) !== text(config));
  if (changed.includes('firewall')) {
   const before = new Set(firewallProblems(configs.firewall));
   const problems = firewallProblems(next.firewall).filter(line => !before.has(line));
   if (problems.length) return { ok: false, error: 'rejected', message: 'The firewall rejected this change', details: problems.join('\n') };
  }
  if (!changed.length) return { ok: true, changed: [], created: staged.created };
  const entry = { id: ++historyId, time: Math.floor(now() / 1000), user, description: description || 'Change configuration', configs: changed, before: {}, after: {}, safemode: !!safe, undone: false };
  for (const config of changed) { entry.before[config] = clone(configs[config]); entry.after[config] = clone(next[config]); }
  configs = next;
  history = [...history.filter(item => !item.undone), entry].slice(-100);
  let released = false;
  if (safe && ++safe.count > 100) { safe = null; released = true; history.forEach(item => { item.safemode = false; }); }
  return { ok: true, id: entry.id, changed, created: staged.created, safemode_released: released };
 }

 function step(direction) {
  const target = direction === 'undo' ? history.filter(entry => !entry.undone).at(-1) : history.find(entry => entry.undone);
  if (!target) return { ok: false, error: 'empty', message: direction === 'undo' ? 'Nothing to undo' : 'Nothing to redo' };
  const expected = direction === 'undo' ? target.after : target.before, wanted = direction === 'undo' ? target.before : target.after;
  for (const config of target.configs) if (JSON.stringify(configs[config]) !== JSON.stringify(expected[config])) return { ok: false, error: 'conflict', message: `${config} was changed outside this history, so ${direction} is not possible` };
  for (const config of target.configs) configs[config] = clone(wanted[config]);
  target.undone = direction === 'undo';
  return { ok: true, id: target.id, description: target.description, configs: target.configs };
 }

 function safemode({ action, keep, timeout }, sid, user) {
  const status = extra => ({ ok: true, active: !!safe, mine: !!safe && safe.sid === sid, owner: safe?.user, count: safe?.count ?? 0, limit: 100, timeout: safe?.timeout ?? safeTimeout, heartbeat_age: safe ? Math.floor((now() - safe.heartbeat) / 1000) : null, last_rollback: lastRollback, ...extra });
  if (action === 'status') return status();
  if (action === 'ping') { if (safe?.sid === sid) safe.heartbeat = now(); return status(); }
  if (action === 'takeover') {
   if (!safe) return { ok: false, error: 'empty', message: 'Safe Mode is not active' };
   safe.sid = sid; safe.user = user; safe.heartbeat = now();
   return status();
  }
  // Test-only: another session (another tab) holds Safe Mode.
  if (action === '__other') { if (!safe) safe = { sid: 'other', user: 'root', count: 0, timeout: safeTimeout, snapshot: clone(configs) }; safe.sid = 'other'; safe.heartbeat = now(); return status(); }
  // Test-only: behave as if heartbeats stopped and the timeout passed.
  if (action === '__expire') { if (safe) restoreSafe('timed out'); return status(); }
  if (action === 'enter') {
   if (safe && safe.sid !== sid) return { ok: false, error: 'taken', message: `Safe Mode is used by ${safe.user}`, owner: safe.user };
   if (!safe) safe = { sid, user, count: 0, timeout: timeout >= 10 && timeout <= 600 ? timeout : safeTimeout, snapshot: clone(configs) };
   safe.heartbeat = now();
   return status();
  }
  if (action === 'exit') {
   if (safe && safe.sid !== sid) return { ok: false, error: 'taken', message: `Safe Mode belongs to ${safe.user}`, owner: safe.user };
   if (!safe) return status({ restored: [] });
   if (keep === false) {
    const changed = CONFIGS.filter(config => JSON.stringify(safe.snapshot[config]) !== text(config));
    restoreSafe('exited without keeping changes');
    lastRollback.configs = changed;
    return status({ restored: changed });
   }
   safe = null;
   history.forEach(entry => { entry.safemode = false; });
   return status({ restored: [] });
  }
  return { ok: false, error: 'invalid', message: 'Unknown Safe Mode action' };
 }

 /* Runtime state derived from configuration and time. */

 const LINK_LOCAL = { 'br-lan': 'fe80::5054:ff:fe12:3456', eth1: 'fe80::5054:ff:fe12:3457', 'br-iot': 'fe80::5054:ff:fe12:3460' };

 function devices() {
  const t = seconds();
  const traffic = (base, rate) => Math.floor(base + rate * t + rate * 4 * Math.sin(t / 7));
  const make = (name, devtype, mac, rx, tx, extra = {}) => ({
   name, devtype, mac, up: true, mtu: 1500, type: 1, flags: { up: true, loopback: devtype === 'loopback' }, link: { carrier: true, speed: devtype === 'ethernet' ? 1000 : -1, duplex: devtype === 'ethernet' ? 'full' : 'unknown' },
   stats: { rx_bytes: traffic(rx, rx / 20000), tx_bytes: traffic(tx, tx / 20000), rx_packets: traffic(rx / 900, rx / 18000000), tx_packets: traffic(tx / 900, tx / 18000000), rx_errors: 0, tx_errors: 0, rx_dropped: 0, tx_dropped: 0 }, ...extra
  });
  const configured = sectionsOf('network', 'device');
  const result = {
   // As in the captured guest: eth0 is the LAN bridge port, eth1 is WAN.
   eth0: make('eth0', 'ethernet', '52:54:00:12:34:56', 1_203_456_789, 9_234_567_890, { master: 'br-lan' }),
   eth1: make('eth1', 'ethernet', '52:54:00:12:34:57', 9_812_345_678, 1_234_567_890),
   'br-lan': make('br-lan', 'bridge', '52:54:00:12:34:56', 1_103_456_789, 9_034_567_890, { bridge: true, ports: ['eth0'] }),
   eth2: make('eth2', 'ethernet', '52:54:00:12:34:58', 45_678_901, 12_345_678, { master: 'br-iot' }),
   eth3: make('eth3', 'ethernet', '52:54:00:12:34:59', 23_456_789, 34_567_890, { master: 'br-iot' }),
   'br-iot': make('br-iot', 'bridge', '52:54:00:12:34:60', 67_890_123, 45_678_901, { bridge: true, ports: ['eth2', 'eth3'] }),
   lo: { ...make('lo', 'loopback', '00:00:00:00:00:00', 12_345_678, 12_345_678), devtype: undefined, type: 772, flags: { up: true, loopback: true } },
   wg0: { ...make('wg0', 'wireguard', '', 34_567_890, 23_456_789), mtu: 1420 }
  };
  for (const item of configured) {
   if (!item.name || result[item.name]) continue;
   result[item.name] = make(item.name, item.type === '8021q' ? 'vlan' : 'bridge', '02:00:00:00:00:10', 0, 0, item.type === 'bridge' ? { bridge: true } : {});
  }
  for (const [name, device] of Object.entries(result)) {
   const config = configured.find(item => item.name === name);
   if (config?.mtu) device.mtu = Number(config.mtu);
   if (config?.macaddr) device.mac = config.macaddr;
   if (config?.type === 'bridge') { device.bridge = true; device.ports = [].concat(config.ports ?? []).filter(port => result[port]); }
   device.ip6addrs = LINK_LOCAL[name] ? [{ address: LINK_LOCAL[name], netmask: 'ffff:ffff:ffff:ffff::' }] : [];
  }
  return result;
 }

 // network.device status, with the bridge fields the Bridge window reads.
 function netdev() {
  const result = {};
  for (const [name, device] of Object.entries(devices())) {
   const entry = { present: true, type: device.bridge ? 'bridge' : 'Network device', up: device.up, carrier: true, devtype: device.devtype, mtu: device.mtu, macaddr: device.mac };
   if (device.bridge) {
    const vlans = sectionsOf('network', 'bridge-vlan').filter(vlan => vlan.device === name);
    entry['bridge-members'] = device.ports;
    entry['bridge-attributes'] = { stp: false, igmp_snooping: false, vlan_filtering: vlans.length > 0 };
    if (vlans.length) entry['bridge-vlans'] = vlans.map(vlan => ({ id: Number(vlan.vlan), local: vlan.local !== '0', ports: [].concat(vlan.ports ?? []) }));
   }
   result[name] = entry;
  }
  return result;
 }

 function ifaces() {
  const uptime = 1063212 + Math.floor(seconds());
  return sectionsOf('network', 'interface').filter(item => item.disabled !== '1').map(item => {
   const name = item['.name'];
   const device = item.device ?? name;
   const live = { interface: name, up: true, pending: false, available: true, autostart: item.auto !== '0', dynamic: false, uptime, l3_device: device, proto: item.proto ?? 'none', device, 'ipv4-address': [], 'ipv6-address': [], route: [], 'dns-server': [] };
   if (item.proto === 'static') live['ipv4-address'] = [].concat(item.ipaddr ?? []).map(entry => ({ address: entry.split('/')[0], mask: Number(entry.split('/')[1] ?? 32) }));
   if (item.proto === 'static') live['ipv6-address'] = [].concat(item.ip6addr ?? []).map(entry => ({ address: entry.split('/')[0], mask: Number(entry.split('/')[1] ?? 128) }));
   live['ipv6-prefix-assignment'] = item.ip6assign ? [{ address: 'fd50:b8c1:5fb2::', mask: Number(item.ip6assign), 'local-address': { address: 'fd50:b8c1:5fb2::1', mask: Number(item.ip6assign) } }] : [];
   if (item.proto === 'dhcpv6') {
    live['ipv6-address'] = [{ address: '2001:db8:42::1234', mask: 128, preferred: 3600, valid: 7200 }];
    live['ipv6-prefix'] = [{ address: '2001:db8:4200::', mask: 56 }];
   }
   if (item.proto === 'dhcp') {
    live['ipv4-address'] = [{ address: '203.0.113.42', mask: 24 }];
    live.route = [{ target: '0.0.0.0', mask: 0, nexthop: '203.0.113.1', source: '203.0.113.42/32' }];
    live.data = { dhcpserver: '203.0.113.1', leasetime: 86400 };
    live['dns-server'] = ['203.0.113.1'];
   }
   return live;
  });
 }

 function routes4() {
  const result = [];
  for (const live of ifaces()) {
   for (const address of live['ipv4-address']) {
    const prefix = address.mask, parts = address.address.split('.').map(Number);
    const value = parts.reduce((sum, part) => sum * 256 + part, 0), size = 2 ** (32 - prefix);
    const network = [24, 16, 8, 0].map(shift => Math.floor(Math.floor(value / size) * size / 2 ** shift) % 256).join('.');
    if (prefix < 32 && live.interface !== 'loopback') result.push({ dst: `${network}/${prefix}`, dev: live.l3_device, protocol: 'kernel', scope: 'link', prefsrc: address.address, flags: [] });
    result.push({ type: 'local', dst: address.address, dev: live.l3_device, table: 'local', protocol: 'kernel', scope: 'host', prefsrc: address.address, flags: [] });
   }
   for (const route of live.route) result.unshift({ dst: 'default', gateway: route.nexthop, dev: live.l3_device, protocol: 'static', prefsrc: route.source.split('/')[0], flags: [] });
  }
  const devicesByName = new Map(ifaces().map(item => [item.interface, item.l3_device]));
  for (const route of sectionsOf('network', 'route').filter(item => item.disabled !== '1')) {
   const entry = { dst: route.target.includes('/') ? route.target : `${route.target}/32`, dev: devicesByName.get(route.interface), protocol: 'static', flags: [] };
   if (route.gateway) entry.gateway = route.gateway;
   if (route.metric) entry.metric = Number(route.metric);
   if (route.table && route.table !== 'main') entry.table = route.table;
   if (route.type && route.type !== 'unicast') entry.type = route.type;
   result.push(entry);
  }
  return result;
 }

 // netifd and iwinfo views of the radios, following the configuration.
 function wirelessStatus() {
  const result = {};
  for (const radio of sectionsOf('wireless', 'wifi-device')) {
   const up = radio.disabled !== '1';
   const ifaces = sectionsOf('wireless', 'wifi-iface').filter(item => item.device === radio['.name']);
   result[radio['.name']] = {
    up, pending: false, autostart: true, disabled: !up, retry_setup_failed: false, config: { type: 'mac80211', band: radio.band, channel: radio.channel, htmode: radio.htmode, country: radio.country },
    interfaces: ifaces.map((item, index) => ({ section: item['.name'], config: { mode: item.mode, ssid: item.ssid, encryption: item.encryption, network: [].concat(item.network ?? []), disabled: item.disabled === '1' }, ...(up && item.disabled !== '1' ? { ifname: `phy${radio['.name'].replace(/\D/g, '')}-${item.mode === 'sta' ? 'sta' : 'ap'}${index}` } : {}), vlans: [], stations: [] }))
   };
  }
  return result;
 }

 function wifi() {
  const result = {};
  const template = capturedWifi.wifi['phy0-ap0'];
  for (const [radioName, state] of Object.entries(wirelessStatus())) {
   const radio = sectionsOf('wireless', 'wifi-device').find(item => item['.name'] === radioName);
   for (const iface of state.interfaces.filter(item => item.ifname)) {
    const ap = iface.config.mode !== 'sta';
    const channel = radio.channel === 'auto' ? 6 : Number(radio.channel);
    result[iface.ifname] = {
     info: { ...template.info, ssid: iface.config.ssid, mode: ap ? 'Master' : 'Client', channel, frequency: 2407 + channel * 5, htmode: radio.htmode, country: radio.country, txpower: Number(radio.txpower ?? 30) },
     stations: ap ? CLIENTS.slice(1, 3).map((client, index) => ({ ...template.stations[0], mac: client.macaddr, signal: -48 - index * 9, connected_time: 600 + index * 1800 + Math.floor(seconds()) })) : []
    };
   }
  }
  return result;
 }

 function routes6() {
  const live = ifaces(), byName = new Map(live.map(item => [item.interface, item.l3_device]));
  const result = [{ dst: 'default', from: '2001:db8:42::1234', gateway: 'fe80::1', dev: 'eth1', protocol: 'static', metric: 512, flags: [], pref: 'medium' }];
  for (const item of live) {
   for (const address of item['ipv6-address']) if (item.proto === 'static') result.push({ dst: address.address.replace(/::?[0-9a-f]*$/i, '::') + '/' + address.mask, dev: item.l3_device, protocol: 'kernel', metric: 256, flags: [] });
   for (const assignment of item['ipv6-prefix-assignment']) result.push({ dst: 'fd50:b8c1:5fb2::/64', dev: item.l3_device, protocol: 'static', metric: 1024, flags: [] }, { type: 'unreachable', dst: `${assignment.address}/48`, dev: 'lo', protocol: 'static', metric: 2147483647, flags: [] });
  }
  for (const name of ['br-lan', 'eth1', 'br-iot']) result.push({ dst: 'fe80::/64', dev: name, protocol: 'kernel', metric: 256, flags: [] });
  for (const route of sectionsOf('network', 'route6').filter(item => item.disabled !== '1')) {
   const entry = { dst: route.target, dev: byName.get(route.interface), protocol: 'static', metric: Number(route.metric ?? 1024), flags: [] };
   if (route.gateway) entry.gateway = route.gateway;
   if (route.table && route.table !== 'main') entry.table = route.table;
   if (route.type && route.type !== 'unicast') entry.type = route.type;
   result.push(entry);
  }
  result.push({ type: 'local', dst: '::1', dev: 'lo', table: 'local', protocol: 'kernel', metric: 0, flags: [] }, { type: 'local', dst: 'fd50:b8c1:5fb2::1', dev: 'br-lan', table: 'local', protocol: 'kernel', metric: 0, flags: [] });
  return result;
 }

 function counters() {
  const t = seconds(), result = {};
  sectionsOf('firewall', 'rule').concat(sectionsOf('firewall', 'redirect')).forEach((item, index) => {
   if (item.enabled === '0') return;
   const key = item.name ?? `@${item['.type']}[${sectionsOf('firewall', item['.type']).indexOf(item)}]`;
   const packets = Math.floor((index + 1) * 13 + t * (index % 3));
   result[key] = [packets, packets * 96];
  });
  return { available: true, counters: result };
 }

 // Byte counters grow at a steady per-flow rate, so Torch shows stable rates.
 function conntrack() {
  const t = seconds();
  const entries = Array.from({ length: 48 }, (unused, index) => {
   const client = CLIENTS[index % CLIENTS.length];
   const tcp = index % 4 !== 3;
   const txRate = 120 + index * 40, rxRate = index % 7 === 0 ? 180000 + index * 1000 : 400 + index * 90;
   const txBytes = Math.floor(5000 + index * 700 + txRate * t), rxBytes = Math.floor(9000 + index * 900 + rxRate * t);
   const txPackets = Math.floor(txBytes / 120), rxPackets = Math.floor(rxBytes / 1200);
   const dst = `198.51.100.${(index * 7) % 250 + 1}`, sport = String(40000 + index * 13), dport = tcp ? (index % 2 ? '443' : '80') : '53';
   return {
    family: 'ipv4', protocol: tcp ? 'tcp' : 'udp', timeout: tcp ? 7440 - ((Math.floor(t) + index * 37) % 7000) : 30 + (index % 30),
    packets: txPackets + rxPackets, bytes: txBytes + rxBytes, tx_packets: txPackets, tx_bytes: txBytes, rx_packets: rxPackets, rx_bytes: rxBytes,
    flags: tcp ? ['ASSURED'] : index % 2 ? ['UNREPLIED'] : [], state: tcp ? 'ESTABLISHED' : undefined,
    src: client.ipaddr, dst, sport, dport, reply_src: dst, reply_dst: '203.0.113.42'
   };
  });
  const icmp = Math.floor(t);
  entries.push({ family: 'ipv4', protocol: 'icmp', timeout: 29, packets: 2 * icmp + 2, bytes: (2 * icmp + 2) * 84, tx_packets: icmp + 1, tx_bytes: (icmp + 1) * 84, rx_packets: icmp + 1, rx_bytes: (icmp + 1) * 84, flags: [], src: '192.168.88.120', dst: '192.168.88.1', type: '8', code: '0', id: '311', reply_src: '192.168.88.1', reply_dst: '192.168.88.120' });
  entries.push({ family: 'ipv6', protocol: 'tcp', timeout: 7000, packets: 0, bytes: 0, tx_packets: Math.floor(10 + t), tx_bytes: Math.floor(2000 + 900 * t), rx_packets: Math.floor(20 + 4 * t), rx_bytes: Math.floor(30000 + 6000 * t), flags: ['ASSURED'], state: 'ESTABLISHED', src: 'fd00:88::5c1', dst: '2001:db8:200::80', sport: '51000', dport: '443', reply_src: '2001:db8:200::80', reply_dst: 'fd00:88::5c1' });
  for (const entry of entries.slice(-1)) { entry.packets = entry.tx_packets + entry.rx_packets; entry.bytes = entry.tx_bytes + entry.rx_bytes; }
  return { available: true, count: entries.length, max: 16384, entries };
 }

 // Ping and Traceroute jobs. Results are derived from the time since the
 // start, so every poll sees a consistent, growing list.
 const jobs = new Map();
 const HOST = /^[A-Za-z0-9:][A-Za-z0-9.:-]{0,252}$/;
 const ADDRESS = /^(\d+\.){3}\d+$|:/;
 const resolveHost = host => ADDRESS.test(host) ? host : host === 'openwrt.org' ? '198.51.100.80' : host.endsWith('.lan') ? '192.168.88.10' : null;
 const pathTo = address => address.startsWith('192.168.88.') || address.startsWith('fd00:88:') ? [address] : ['10.0.2.2', '100.64.0.1', null, '203.0.113.1', address];
 function jobResults(job) {
  const { args } = job, address = resolveHost(args.host);
  if (!address) return [{ error: 'resolve', message: `${args.tool}: bad address '${args.host}'` }];
  const end = job.stopped ?? now();
  const done = Math.floor((end - job.started - 100) / args.interval) + 1;
  const total = Math.max(0, args.count ? Math.min(args.count, done) : done);
  const results = [{ address }];
  for (let index = 0; index < total; index++) {
   if (args.tool === 'ping') {
    const lost = address.endsWith('.250') || (address === '198.51.100.80' && index % 5 === 3);
    const local = address.startsWith('192.168.88.');
    results.push(lost ? { seq: index, status: 'timeout' } : { seq: index, host: address, size: args.size + 8, ttl: local ? 64 : 57, time: Math.round((local ? 0.31 + (index % 3) * 0.05 : 12.4 + (index % 4) * 1.3) * 1000) / 1000 });
   } else {
    const path = pathTo(address).slice(0, args.max);
    results.push({ round: index + 1, hops: path.map((hop, position) => {
     const silent = hop === null || address.endsWith('.250') || (position === 1 && index % 3 === 2);
     return { hop: position + 1, address: silent ? null : hop, time: silent ? null : Math.round((0.4 + position * 3.1 + (index % 4) * 0.7) * 1000) / 1000, status: null };
    }) });
   }
  }
  return results;
 }
 function diag(args) {
  if (args.action === 'start') {
   if (!['ping', 'traceroute'].includes(args.tool)) return { ok: false, error: 'invalid', message: 'Unknown tool' };
   if (typeof args.host !== 'string' || !HOST.test(args.host)) return { ok: false, error: 'invalid', message: 'Enter an address or host name' };
   const within = (value, low, high, fallback) => Number.isInteger(value) && value >= low && value <= high ? value : fallback;
   const job = {
    tool: args.tool, host: args.host, family: args.family === 4 || args.family === 6 ? args.family : 0, size: within(args.size, 16, 65500, 56), count: within(args.count, 0, 100000, 0),
    interval: within(args.interval, 200, 60000, 1000), timeout: within(args.timeout, 1, 10, 1), max: within(args.max, 1, 30, 15), protocol: args.protocol === 'udp' ? 'udp' : 'icmp'
   };
   const id = (++serial).toString(16).padStart(16, '0');
   jobs.set(id, { args: job, started: now(), stopped: null });
   return { ok: true, id, ...job };
  }
  const job = jobs.get(args.id);
  if (args.action === 'stop') { if (job && !job.stopped) job.stopped = now(); return { ok: true }; }
  if (args.action !== 'poll') return { ok: false, error: 'invalid', message: 'Unknown action' };
  if (!job) return { ok: false, error: 'gone', message: 'This job has ended' };
  const results = jobResults(job), from = Number.isInteger(args.from) ? args.from : 0;
  const finished = results[0]?.error || (job.args.count && results.length - 1 >= job.args.count);
  return { ok: true, running: !job.stopped && !finished, results: results.slice(from), next: results.length };
 }

 function log({ after = 0, lines = 1000 } = {}) {
  const t = Math.floor(seconds()), base = Math.floor(started / 1000) - 600;
  const total = 40 + Math.floor(t / 5);
  const entries = [];
  for (let id = Math.max(1, after + 1, total - lines + 1); id <= total; id++) {
   const [facility, severity, tag, message] = LOG_TEXT[id % LOG_TEXT.length];
   const time = id <= 40 ? (base + id * 15) * 1000 : started + (id - 40) * 5000;
   entries.push({ id, time, source: tag === 'kernel' ? 'kernel' : 'syslog', facility: FACILITIES[facility], severity: SEVERITIES[severity], tag, message });
  }
  return { mode: 'ubus', entries };
 }

 function leases() {
  const t = Math.floor(seconds());
  return {
   dhcp_leases: CLIENTS.map((client, index) => ({ ...client, expires: Math.max(1, 43200 - index * 3600 - t) })),
   dhcp6_leases: [
    { expires: Math.max(1, 3600 - t), hostname: 'nas', duid: '000100012a3b4c5d525400aa1001', iaid: 1, ip6addr: 'fd50:b8c1:5fb2::10', ip6addrs: ['fd50:b8c1:5fb2::10/128'] },
    { expires: Math.max(1, 3000 - t), hostname: 'laptop', duid: '000100012a3b4c5d525400aa1002', iaid: 1, ip6addr: 'fd50:b8c1:5fb2::5c1', ip6addrs: ['fd50:b8c1:5fb2::5c1/128'] }
   ]
  };
 }

 function history_() {
  const summary = entry => entry ? { id: entry.id, description: entry.description, time: entry.time, user: entry.user } : null;
  return { undo: summary(history.filter(entry => !entry.undone).at(-1)), redo: summary(history.find(entry => entry.undone)), entries: history.map(entry => ({ ...summary(entry), configs: entry.configs, undone: entry.undone, safemode: entry.safemode })) };
 }

 // procd's rc list, captured on OpenWrt 25.12.5 and trimmed.
 const services = {
  boot: { start: 10, stop: 90, enabled: true }, system: { start: 10, enabled: true, running: true }, log: { start: 12, stop: 89, enabled: true, running: true },
  rpcd: { start: 12, enabled: true, running: true }, dnsmasq: { start: 19, enabled: true, running: true }, dropbear: { start: 19, stop: 50, enabled: true, running: true },
  firewall: { start: 19, enabled: true, running: false }, network: { start: 20, stop: 90, enabled: true, running: true }, odhcpd: { start: 35, stop: 85, enabled: true, running: true },
  cron: { start: 50, enabled: true, running: true }, uhttpd: { start: 50, enabled: true, running: true }, sysntpd: { start: 98, enabled: true, running: true }, ttyd: { start: 99, enabled: false, running: false }
 };
 function serviceAction(name, action) {
  const service = services[name];
  if (!service || !['start', 'stop', 'restart', 'reload', 'enable', 'disable'].includes(action)) return false;
  if (action === 'enable' || action === 'disable') service.enabled = action === 'enable';
  else if (service.running !== undefined) service.running = action !== 'stop';
  return true;
 }
 const PACKAGES = [['base-files', '1701-r29097', 'Base filesystem for OpenWrt', 52000, true], ['busybox', '1.37.0-r6', 'Core utilities for embedded Linux', 312000, true], ['dnsmasq', '2.91-r1', 'DNS and DHCP server', 248000, true],
  ['dropbear', '2025.88-r1', 'Small SSH2 client/server', 205000, true], ['firewall4', '2025.10.10-r1', 'nftables based firewall', 58000, true], ['kmod-wireguard', '6.12.94-r1', 'WireGuard secure network tunnel', 61000, false],
  ['libubox20260213', '2026.02.13-r1', 'Basic utility library', 41000, false], ['luci', '26.288', 'LuCI interface', 0, true], ['odhcpd-ipv6only', '2025.11.20-r1', 'DHCPv6 and RA server', 98000, true],
  ['routerdeck-console', '0.1.0-r1', 'RouterDeck Console', 260000, true], ['rpcd', '2025.11.30-r1', 'OpenWrt ubus RPC backend server', 42000, true], ['uhttpd', '2025.10.03-r1', 'Tiny HTTP server', 52000, true]];
 let localOffset = 0;

 return {
  watchdog,
  neighbors: () => ({ neighbors: [
   ...CLIENTS.slice(0, 4).map((client, index) => ({ family: 4, address: client.ipaddr, dev: 'br-lan', mac: client.macaddr, router: false, state: index % 2 ? 'STALE' : 'REACHABLE' })),
   { family: 4, address: '192.168.88.250', dev: 'br-lan', router: false, state: 'FAILED' },
   { family: 4, address: '203.0.113.1', dev: 'eth0', mac: '52:54:00:ff:00:01', router: false, state: 'REACHABLE' },
   { family: 6, address: 'fe80::1', dev: 'eth0', mac: '52:54:00:ff:00:01', router: true, state: 'STALE' },
   { family: 6, address: 'fd00:88::5c1', dev: 'br-lan', mac: '52:54:00:aa:10:02', router: false, state: 'REACHABLE' }
  ] }),
  rules: () => {
   const list = [{ family: 4, priority: 0, from: 'all', lookup: 'local' }];
   for (const rule of sectionsOf('network', 'rule').filter(item => item.disabled !== '1')) list.push({ family: 4, priority: Number(rule.priority ?? 32765), from: rule.src ?? 'all', ...(rule.dest ? { to: rule.dest } : {}), ...(rule.action ? { action: rule.action } : { lookup: rule.lookup ?? 'main' }) });
   for (const rule of sectionsOf('network', 'rule6').filter(item => item.disabled !== '1')) list.push({ family: 6, priority: Number(rule.priority ?? 32765), from: rule.src ?? 'all', ...(rule.dest ? { to: rule.dest } : {}), ...(rule.action ? { action: rule.action } : { lookup: rule.lookup ?? 'main' }) });
   list.push({ family: 4, priority: 32766, from: 'all', lookup: 'main' }, { family: 4, priority: 32767, from: 'all', lookup: 'default' }, { family: 6, priority: 0, from: 'all', lookup: 'local' }, { family: 6, priority: 32766, from: 'all', lookup: 'main' });
   return { rules: list };
  },
  wireguard: () => {
   const t = Math.floor(now() / 1000), interfaces = {};
   for (const iface of sectionsOf('network', 'interface').filter(item => item.proto === 'wireguard' && item.disabled !== '1')) {
    interfaces[iface['.name']] = { public_key: 'Q0bVxMq8yDtW3gKIdWnHpcWbF8fZ2+0JxHf6mRb5zVk=', listen_port: Number(iface.listen_port ?? 51820), peers: sectionsOf('network', `wireguard_${iface['.name']}`).filter(peer => peer.disabled !== '1').map((peer, index) => ({
     public_key: peer.public_key, preshared: !!peer.preshared_key, endpoint: index ? null : '198.51.100.7:40312', allowed_ips: [].concat(peer.allowed_ips ?? []),
     latest_handshake: index ? 0 : t - 42, rx_bytes: index ? 0 : 1843200 + Math.floor(seconds()) * 900, tx_bytes: index ? 0 : 9437184 + Math.floor(seconds()) * 2400, keepalive: peer.persistent_keepalive ? Number(peer.persistent_keepalive) : null
    })) };
   }
   return { available: true, now: t, interfaces };
  },
  packages: () => ({ manager: 'apk', packages: PACKAGES.map(([name, version, description, size, requested]) => ({ name, version, description, size, requested })) }),
  crontab: () => ({ text: configs.crontab, path: '/etc/crontabs/root', crond: true }),
  services: () => clone(services), serviceAction,
  setLocaltime: seconds => { localOffset = seconds * 1000 - now(); return true; },
  setPassword: (username, password) => typeof password === 'string' && password.length > 0,
  reboot: () => { lastReboot = now(); },
  uci: config => configs[config] && !FILES.includes(config) ? clone(configs[config]) : null,
  devices, netdev, ifaces, routes4, routes6, counters, conntrack, log, leases, wirelessStatus, wifi, diag,
  history: history_, apply, undo: () => step('undo'), redo: () => step('redo'), safemode,
  terminal: () => ({ installed: false, running: false, port: 7681, ssl: false, interface: '@lan', url_override: null })
 };
}
