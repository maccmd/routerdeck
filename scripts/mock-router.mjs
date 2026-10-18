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
const CONFIGS = ['network', 'firewall', 'dhcp', 'wireless', 'system', 'dropbear', 'uhttpd', 'ttyd', 'upnpd', 'ddns', 'sqm', 'routerdeck', 'crontab'];
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
 // Package defaults captured on OpenWrt 25.12.5 (miniupnpd, ddns-scripts, sqm-scripts).
 const upnpd = {
  config: section('upnpd', 'config', 0, { enabled: '1', enable_natpmp: '1', enable_upnp: '1', secure_mode: '1', log_output: '0', download: '1024', upload: '512', internal_iface: 'lan', port: '5000', upnp_lease_file: '/var/run/miniupnpd.leases', igdv1: '1' }),
  cfg2492bd: section('perm_rule', 'cfg2492bd', 1, { action: 'allow', ext_ports: '1024-65535', int_addr: '0.0.0.0/0', int_ports: '1024-65535', comment: 'Allow high ports' }, true),
  cfg2592bd: section('perm_rule', 'cfg2592bd', 2, { action: 'deny', ext_ports: '0-65535', int_addr: '0.0.0.0/0', int_ports: '0-65535', comment: 'Default deny' }, true)
 };
 const ddns = {
  global: section('ddns', 'global', 0, { ddns_dateformat: '%F %R', ddns_loglines: '250', upd_privateip: '0' }),
  home: section('service', 'home', 1, { enabled: '1', service_name: 'duckdns.org', lookup_host: 'routerdeck-preview.duckdns.org', domain: 'routerdeck-preview.duckdns.org', username: 'NA', password: 'not-a-real-token', interface: 'wan', ip_source: 'network', ip_network: 'wan', use_api_check: '0' }),
  myddns_ipv6: section('service', 'myddns_ipv6', 2, { update_url: 'http://[USERNAME]:[PASSWORD]@your.provider.net/nic/update?hostname=[DOMAIN]&myip=[IP]', lookup_host: 'yourhost.example.com', domain: 'yourhost.example.com', username: 'your_username', password: 'your_password', use_ipv6: '1', interface: 'wan6', ip_source: 'network', ip_network: 'wan6' })
 };
 const sqm = { eth0: section('queue', 'eth0', 0, { enabled: '1', interface: 'eth0', download: '85000', upload: '10000', qdisc: 'cake', script: 'piece_of_cake.qos', linklayer: 'none' }) };
 const routerdeck = { cfg2692bd: section('netwatch', 'cfg2692bd', 0, { host: '203.0.113.1', interval: '10', timeout: '1', down: 'logger -t netwatch-demo gateway lost', comment: 'Upstream gateway' }, true), cfg2792bd: section('netwatch', 'cfg2792bd', 1, { host: '192.168.88.250', interval: '30', timeout: '1' }, true) };
 const crontab = '# Reload WiFi at night\n0 4 * * * wifi reload\n#*/30 * * * * /usr/bin/check-wan\n';
 return { network, firewall, dhcp, wireless, system, dropbear, uhttpd, ttyd, upnpd, ddns, sqm, routerdeck, crontab };
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
 // iperf3 one line per second; a scan answers 32 addresses per second.
 function bandwidthResults(job) {
  const { args } = job, elapsed = Math.floor(((job.stopped ?? now()) - job.started) / 1000);
  if (args.mode === 'server') return [{ status: `Server listening on ${args.port}` }];
  if (!resolveHost(args.host)) return [{ error: 'iperf', message: `error - unable to connect to server - server may not be running` }];
  const results = [{ status: `Connecting to host ${args.host}, port ${args.port}` }];
  const roles = args.direction === 'both' ? ['TX', 'RX'] : [null];
  for (let second = 0; second < Math.min(elapsed, args.duration); second++) {
   for (const role of roles) {
    const bps = (role === 'RX' || args.direction === 'receive' ? 480e6 : 920e6) + (second % 3) * 4e6;
    results.push({ role, start: second, end: second + 1, bytes: bps / 8, bps, summary: null, lost: args.protocol === 'udp' ? second % 2 : null });
   }
  }
  if (elapsed >= args.duration) for (const role of roles) for (const summary of ['sender', 'receiver']) results.push({ role, start: 0, end: args.duration, bytes: 1e8, bps: (role === 'RX' || args.direction === 'receive' ? 482e6 : 924e6) - (summary === 'receiver' ? 2e6 : 0), summary, lost: null });
  return results;
 }
 function scanResults(job) {
  const [base, prefix] = job.args.network.split('/'), size = 2 ** (32 - Number(prefix));
  const start = base.split('.').reduce((value, part) => value * 256 + Number(part), 0);
  const first = start - (start % size), hosts = size - 2;
  const scanned = Math.min(hosts, Math.floor(((job.stopped ?? now()) - job.started) / 1000 + 1) * 32);
  const dotted = value => [24, 16, 8, 0].map(shift => Math.floor(value / 2 ** shift) % 256).join('.');
  const results = [{ total: hosts }];
  const answering = new Map([['192.168.88.1', '52:54:00:12:34:56'], ...CLIENTS.slice(0, 4).map(client => [client.ipaddr, client.macaddr])]);
  // Append-only, batch by batch, like the job runner on the router.
  for (let batch = 0; batch * 32 < scanned; batch++) {
   for (let index = batch * 32 + 1; index <= Math.min(scanned, batch * 32 + 32); index++) {
    const address = dotted(first + index);
    if (answering.has(address)) results.push({ address, time: address.endsWith('.1') ? 0.08 : 0.4 + index % 5 * 0.1, ttl: 64 });
   }
   results.push({ scanned: Math.min(scanned, batch * 32 + 32) });
  }
  if (scanned >= hosts) results.push({ macs: Object.fromEntries([...answering].filter(([address]) => results.some(item => item.address === address))) });
  return results;
 }
 function jobResults(job) {
  if (job.args.tool === 'bandwidth') return bandwidthResults(job);
  if (job.args.tool === 'scan') return scanResults(job);
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
   if (!['ping', 'traceroute', 'bandwidth', 'scan'].includes(args.tool)) return { ok: false, error: 'invalid', message: 'Unknown tool' };
   if (args.tool === 'scan' ? !/^(\d{1,3}\.){3}\d{1,3}\/(2[2-9]|30)$/.test(args.network ?? '') : !(args.tool === 'bandwidth' && args.mode === 'server') && (typeof args.host !== 'string' || !HOST.test(args.host))) return { ok: false, error: 'invalid', message: args.tool === 'scan' ? 'Enter a network from /22 to /30, such as 192.168.1.0/24' : 'Enter an address or host name' };
   const within = (value, low, high, fallback) => Number.isInteger(value) && value >= low && value <= high ? value : fallback;
   const job = {
    tool: args.tool, host: args.host, family: args.family === 4 || args.family === 6 ? args.family : 0, size: within(args.size, 16, 65500, 56), count: within(args.count, 0, 100000, 0),
    interval: within(args.interval, 200, 60000, 1000), timeout: within(args.timeout, 1, 10, 1), max: within(args.max, 1, 30, 15), protocol: args.protocol === 'udp' ? 'udp' : args.tool === 'bandwidth' ? 'tcp' : 'icmp',
    mode: args.mode === 'server' ? 'server' : 'client', direction: ['receive', 'both'].includes(args.direction) ? args.direction : 'send', duration: within(args.duration, 1, 300, 10), port: within(args.port, 1, 65535, 5201), network: args.network ?? null
   };
   const id = (++serial).toString(16).padStart(16, '0');
   jobs.set(id, { args: job, started: now(), stopped: null });
   return { ok: true, id, ...job };
  }
  if (args.action === 'list') {
   settle();
   const running = [...jobs].filter(([, job]) => ['package', 'script'].includes(job.args.tool) ? taskResults(job).at(-1)?.exit === undefined : !job.stopped);
   return { ok: true, now: Math.floor(now() / 1000), jobs: running.map(([id, job]) => ({ id, tool: job.args.tool, started: Math.floor(job.started / 1000), host: job.args.host, name: job.args.name, operation: job.args.operation, names: job.args.names })) };
  }
  const job = jobs.get(args.id);
  if (args.action === 'stop') {
   if (job && ['package', 'script'].includes(job.args.tool)) return { ok: false, error: 'denied', message: 'Stop scripts from the Scripts window' };
   if (job && !job.stopped) job.stopped = now();
   return { ok: true };
  }
  if (args.action !== 'poll') return { ok: false, error: 'invalid', message: 'Unknown action' };
  if (!job) return { ok: false, error: 'gone', message: 'This job has ended' };
  if (['package', 'script'].includes(job.args.tool)) {
   const results = taskResults(job), from = Number.isInteger(args.from) ? args.from : 0;
   settle();
   return { ok: true, running: results.at(-1)?.exit === undefined, results: results.slice(from), next: results.length };
  }
  const results = jobResults(job), from = Number.isInteger(args.from) ? args.from : 0;
  const finished = results.some(item => item.error) || (job.args.tool === 'bandwidth' ? job.args.mode === 'client' && results.some(item => item.summary === 'receiver') : job.args.tool === 'scan' ? results.some(item => item.macs) : job.args.count && results.length - 1 >= job.args.count);
  return { ok: true, running: !job.stopped && !finished, results: results.slice(from), next: results.length };
 }

 // Package operations and scripts: one output line every 200 ms, then the
 // exit code. A finished package operation changes the installed list once.
 const REPOSITORY = { tcpdump: ['4.99.6-r1', 'Network monitoring and data acquisition tool', 410000, ['libpcap1']], libpcap1: ['1.10.6-r1', 'Low-level packet capture library', 180000, []], iperf3: ['3.19-r1', 'Internet Protocol bandwidth measuring tool', 98000, []], nano: ['8.4-r1', 'An enhanced clone of the Pico text editor', 150000, []], ttyd: ['1.7.7-r2', 'Share your terminal over the web', 90000, []] };
 function taskLines(job) {
  const { args } = job;
  if (args.tool === 'script') {
   const source = configs.routerdeck[args.name]?.source ?? '';
   const lines = [], exit = /^\s*exit (\d+)/m.exec(source);
   for (const line of source.split('\n')) { const echo = /^\s*echo (.*)$/.exec(line); if (echo) lines.push({ line: echo[1].replace(/^["']|["']$/g, '') }); }
   return [...lines, { exit: exit ? Number(exit[1]) : 0 }];
  }
  const command = `apk ${{ update: 'update', install: 'add', remove: 'del', upgrade: 'upgrade' }[args.operation]} ${args.names.join(' ')}`.trim();
  if (args.operation === 'update') return [{ command }, { line: ' [https://downloads.openwrt.org/releases/25.12.5/packages/aarch64_generic/base/packages.adb]' }, { line: ' [https://downloads.openwrt.org/releases/25.12.5/packages/aarch64_generic/packages/packages.adb]' }, { line: 'OK: 9871 distinct packages available' }, { exit: 0 }];
  if (args.operation === 'install') {
   const missing = args.names.filter(name => !REPOSITORY[name] && !packageList.some(item => item.name === name));
   if (missing.length) return [{ command }, { line: `ERROR: unable to select packages:` }, ...missing.map(name => ({ line: `  ${name} (no such package):` })), { exit: 1 }];
   const wanted = [...new Set(args.names.flatMap(name => [...(REPOSITORY[name]?.[3] ?? []), name]))].filter(name => !packageList.some(item => item.name === name));
   return [{ command }, ...wanted.map((name, index) => ({ line: `(${index + 1}/${wanted.length}) Installing ${name} (${REPOSITORY[name][0]})` })), { line: `OK: 27.4 MiB in ${packageList.length + wanted.length} packages` }, { exit: 0 }];
  }
  if (args.operation === 'remove') {
   const needed = args.names.find(name => ['busybox', 'libubox20260213', 'rpcd'].includes(name));
   if (needed) return [{ command }, { line: `ERROR: ${needed} is required by other packages` }, { exit: 1 }];
   return [{ command }, ...args.names.map((name, index) => ({ line: `(${index + 1}/${args.names.length}) Purging ${name}` })), { line: 'OK: 26.8 MiB' }, { exit: 0 }];
  }
  return [{ command }, ...args.names.map((name, index) => ({ line: `(${index + 1}/${args.names.length}) Upgrading ${name} (${packageList.find(item => item.name === name)?.version} -> ${upgradable[name]})` })), { line: 'OK' }, { exit: 0 }];
 }
 function taskResults(job) {
  const lines = taskLines(job);
  const shown = job.stopped ? Math.floor((job.stopped - job.started) / 200) : Math.floor((now() - job.started) / 200) + 1;
  if (job.stopped && shown < lines.length) return [...lines.slice(0, shown).filter(item => item.exit === undefined), { exit: 143, stopped: true }];
  return lines.slice(0, shown);
 }
 function settle() {
  for (const job of jobs.values()) {
   if (job.args.tool !== 'package' || job.applied || job.stopped) continue;
   const results = taskResults(job);
   if (results.at(-1)?.exit === undefined) continue;
   job.applied = true;
   if (results.at(-1).exit !== 0) continue;
   const { operation, names } = job.args;
   if (operation === 'install') for (const name of results.filter(item => /Installing (\S+)/.test(item.line ?? '')).map(item => /Installing (\S+)/.exec(item.line)[1])) packageList.push({ name, version: REPOSITORY[name][0], description: REPOSITORY[name][1], size: REPOSITORY[name][2], requested: names.includes(name) });
   if (operation === 'remove') packageList = packageList.filter(item => !names.includes(item.name));
   if (operation === 'upgrade') for (const name of names) { const item = packageList.find(entry => entry.name === name); if (item && upgradable[name]) { item.version = upgradable[name]; delete upgradable[name]; } }
  }
 }
 function task(args) {
  if (args.action === 'stop') { const job = jobs.get(args.id); if (job?.args.tool === 'script' && !job.stopped) job.stopped = now(); return { ok: true }; }
  if (args.tool === 'package') {
   if (!['update', 'install', 'remove', 'upgrade'].includes(args.operation)) return { ok: false, error: 'invalid', message: 'Unknown package operation' };
   const names = args.operation === 'update' ? [] : Array.isArray(args.names) ? args.names : [];
   if (args.operation !== 'update' && (!names.length || names.some(name => !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/.test(name)))) return { ok: false, error: 'invalid', message: 'Enter package names such as tcpdump' };
   settle();
   if ([...jobs.values()].some(job => job.args.tool === 'package' && !job.applied && !job.stopped)) return { ok: false, error: 'busy', message: 'Another package operation is running; wait for it to finish' };
   const id = (++serial).toString(16).padStart(16, '0');
   jobs.set(id, { args: { tool: 'package', manager: 'apk', operation: args.operation, names }, started: now(), stopped: null });
   return { ok: true, id, tool: 'package', manager: 'apk', operation: args.operation, names };
  }
  if (args.tool === 'script') {
   if (configs.routerdeck[args.name]?.['.type'] !== 'script') return { ok: false, error: 'missing', message: `There is no script ${args.name}` };
   const id = (++serial).toString(16).padStart(16, '0');
   jobs.set(id, { args: { tool: 'script', name: args.name }, started: now(), stopped: null });
   return { ok: true, id, tool: 'script', name: args.name };
  }
  return { ok: false, error: 'invalid', message: 'Unknown task' };
 }

 /* A small file system for the Files window and uploads. */
 const fileSystem = new Map();
 const mtime = Math.floor(started / 1000) - 86400;
 const addFile = (path, content, mode = 0o644) => fileSystem.set(path, { type: 'file', content: Buffer.from(content), mtime, mode });
 for (const dir of ['/', '/etc', '/etc/config', '/etc/crontabs', '/tmp', '/root', '/www', '/proc', '/usr']) fileSystem.set(dir, { type: 'directory', mtime, mode: 0o755 });
 for (const config of ['network', 'firewall', 'dhcp', 'system', 'wireless']) addFile(`/etc/config/${config}`, `# ${config} of the simulated router\n`, 0o600);
 addFile('/etc/banner', '  RouterDeck preview\n');
 addFile('/tmp/dhcp.leases', CLIENTS.map(client => `0 ${client.macaddr} ${client.ipaddr} ${client.hostname ?? '*'} *`).join('\n') + '\n');
 fileSystem.set('/etc/localtime', { type: 'link', link: '/tmp/localtime', mtime, mode: 0o777 });
 const parentOf = path => path.replace(/\/[^/]+$/, '') || '/';
 const PROTECTED = /^\/(proc|sys|dev|rom)(\/|$)/;
 function files({ path = '/' } = {}) {
  if (!fileSystem.get(path) || fileSystem.get(path).type !== 'directory') return { ok: false, error: 'missing', message: `${path} is not a directory` };
  const entries = [...fileSystem].filter(([name]) => name !== '/' && parentOf(name) === path).map(([name, entry]) => ({ name: name.slice(name.lastIndexOf('/') + 1), type: entry.type, size: entry.type === 'file' ? entry.content.length : 4096, mtime: entry.mtime, mode: entry.mode, ...(entry.type === 'link' ? { link: entry.link, target: null } : {}) }));
  return { ok: true, path, entries: entries.sort((a, b) => a.name.localeCompare(b.name)), truncated: false };
 }
 function fileRemove({ path }) {
  if (!path || path === '/' || PROTECTED.test(path)) return { ok: false, error: 'denied', message: `${path} cannot be removed here` };
  const entry = fileSystem.get(path);
  if (!entry) return { ok: false, error: 'missing', message: `${path} no longer exists` };
  if (entry.type === 'directory' && [...fileSystem.keys()].some(name => name !== path && parentOf(name) === path)) return { ok: false, error: 'not-empty', message: `${path} is not empty` };
  fileSystem.delete(path);
  return { ok: true };
 }
 function fileMkdir({ path }) {
  if (!path || PROTECTED.test(path)) return { ok: false, error: 'denied', message: `${path} cannot be created here` };
  if (fileSystem.has(path)) return { ok: false, error: 'exists', message: `${path} already exists` };
  if (fileSystem.get(parentOf(path))?.type !== 'directory') return { ok: false, error: 'failed', message: `Could not create ${path}` };
  fileSystem.set(path, { type: 'directory', mtime: Math.floor(now() / 1000), mode: 0o755 });
  return { ok: true };
 }
 // What cgi-io does for the preview server.
 function writeFile(path, content) {
  if (PROTECTED.test(path) || fileSystem.get(parentOf(path))?.type !== 'directory') return false;
  fileSystem.set(path, { type: 'file', content: Buffer.from(content), mtime: Math.floor(now() / 1000), mode: 0o600 });
  return true;
 }
 const readFile = path => fileSystem.get(path)?.type === 'file' ? fileSystem.get(path).content : null;

 // A fake image is "valid" when it starts with this marker.
 const FIRMWARE_MARK = 'ROUTERDECK-TEST-FIRMWARE';
 function restore({ action }) {
  const file = '/tmp/routerdeck-backup.tar.gz', content = readFile(file);
  if (action === 'discard') { fileSystem.delete(file); return { ok: true }; }
  if (!content) return { ok: false, error: 'missing', message: 'Upload a backup first' };
  if (content[0] !== 0x1f || content[1] !== 0x8b) { fileSystem.delete(file); return { ok: false, error: 'invalid', message: 'This is not a configuration backup (a .tar.gz of files from /etc)' }; }
  const names = ['etc/config/dhcp', 'etc/config/firewall', 'etc/config/network', 'etc/config/system', 'etc/config/wireless', 'etc/dropbear/authorized_keys', 'etc/passwd', 'etc/shadow'];
  if (action === 'check') return { ok: true, size: content.length, count: names.length, files: names };
  if (safe) return { ok: false, error: 'safemode', message: 'Leave Safe Mode before restoring a backup' };
  fileSystem.delete(file);
  lastReboot = now();
  return { ok: true, rebooting: true };
 }
 function firmware({ action, keep }) {
  const file = '/tmp/routerdeck-firmware.bin', content = readFile(file);
  if (action === 'discard') { fileSystem.delete(file); return { ok: true }; }
  if (!content) return { ok: false, error: 'missing', message: 'Upload a firmware image first' };
  const valid = content.subarray(0, FIRMWARE_MARK.length).toString() === FIRMWARE_MARK;
  if (action === 'check') return { ok: true, size: content.length, sha256: 'a'.repeat(64), valid, forceable: true, allow_backup: true, tests: { fwtool_signature: true, fwtool_device_match: valid } };
  if (!valid) return { ok: false, error: 'invalid', message: 'The router rejected this image, so it is not flashed' };
  if (safe) return { ok: false, error: 'safemode', message: 'Leave Safe Mode before flashing firmware' };
  flashing = { keep: keep !== false, at: now() };
  return { ok: true, keep: keep !== false };
 }
 let flashing = null;

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
  cron: { start: 50, enabled: true, running: true }, uhttpd: { start: 50, enabled: true, running: true }, sysntpd: { start: 98, enabled: true, running: true }, ttyd: { start: 99, enabled: false, running: false },
  ddns: { start: 95, stop: 10, enabled: true, running: true }, miniupnpd: { start: 94, enabled: true, running: true }, sqm: { start: 50, enabled: true, running: false }
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
 let packageList = PACKAGES.map(([name, version, description, size, requested]) => ({ name, version, description, size, requested }));
 const upgradable = { dnsmasq: '2.91-r2', uhttpd: '2025.10.03-r2' };

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
  upnp: () => {
   const t = Math.floor(now() / 1000);
   return { installed: true, now: t, mappings: configs.upnpd.config?.enabled === '1' ? [
    { protocol: 'UDP', external_port: 3074, address: '192.168.88.121', internal_port: 3074, expires: 0, description: 'Game console' },
    { protocol: 'TCP', external_port: 51413, address: '192.168.88.120', internal_port: 51413, expires: t + 3600 - Math.floor(seconds()), description: 'Transmission at 192.168.88.120:51413' }
   ] : [] };
  },
  ddns: () => ({
   installed: true, now: Math.floor(now() / 1000),
   services: Object.fromEntries(sectionsOf('ddns', 'service').map(item => [item['.name'], item.enabled === '1' ? { ip: '203.0.113.42', updated: Math.floor(started / 1000) - 600, running: true } : { ip: null, updated: null, running: false }])),
   providers: ['afraid.org-v2-token', 'cloudflare.com-v4', 'duckdns.org', 'dynv6.com', 'freedns.42.pl', 'he.net', 'no-ip.com', 'ovh.com']
  }),
  qdisc: () => {
   const t = Math.floor(seconds()), devices = {};
   for (const name of ['eth0', 'eth1', 'br-lan', 'eth2', 'eth3']) devices[name] = { kind: 'fq_codel', handle: '0:', bytes: 1000000 + t * 5000, packets: 1000 + t * 5, dropped: 0 };
   for (const queue of sectionsOf('sqm', 'queue').filter(item => item.enabled === '1')) devices[queue.interface] = { kind: queue.qdisc ?? 'cake', handle: '8001:', bytes: 90000000 + t * 120000, packets: 80000 + t * 100, dropped: 12 + Math.floor(t / 10) };
   return { devices };
  },
  netwatch: () => {
   const t = Math.floor(now() / 1000);
   const hosts = Object.fromEntries(sectionsOf('routerdeck', 'netwatch').filter(item => item.disabled !== '1').map(item => {
    const up = !item.host.endsWith('.250');
    return [item['.name'], { host: item.host, status: up ? 'up' : 'down', since: Math.floor(started / 1000) - (up ? 3600 : 120), rtt: up ? 11.6 : null, checked: t }];
   }));
   return { running: Object.keys(hosts).length > 0, now: t, hosts };
  },
  wol: ({ mac }) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac ?? '') ? { ok: true } : { ok: false, error: 'invalid', message: 'Enter a MAC address such as 00:11:22:33:44:55' },
  packages: () => { settle(); return { manager: 'apk', packages: clone(packageList), upgradable: { ...upgradable } }; },
  task, files, fileRemove, fileMkdir, writeFile, readFile, restore, firmware,
  reset: () => safe ? { ok: false, error: 'safemode', message: 'Leave Safe Mode before resetting the configuration' } : (lastReboot = now(), { ok: true, rebooting: true }),
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
