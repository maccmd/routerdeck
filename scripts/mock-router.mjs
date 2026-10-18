// Simulated router state behind the mock /ubus endpoint (preview and browser
// tests only). Configuration starts from data captured on OpenWrt 25.12.5,
// plus a few clients, a port forward and a static route. Changes, history,
// Undo and Safe Mode follow the routerdeck rpcd plugin's behaviour.
import { readFileSync } from 'node:fs';

const captured = JSON.parse(readFileSync(new URL('../tests/fixtures/openwrt-25.12/router.json', import.meta.url), 'utf8'));
const NAME = /^[A-Za-z0-9_]+$/;
const PORTS = /^!?\s*\d{1,5}([-:]\d{1,5})?(\s+\d{1,5}([-:]\d{1,5})?)*$/;
const CONFIGS = ['network', 'firewall', 'dhcp'];
const clone = value => structuredClone(value);
const section = (type, name, index, values, anonymous = false) => ({ '.anonymous': anonymous, '.type': type, '.name': name, '.index': index, ...values });

function initialConfigs() {
 const network = clone(captured['uci:network']), firewall = clone(captured['uci:firewall']), dhcp = clone(captured['uci:dhcp']);
 network.lan.ipaddr = '192.168.88.1/24';
 network.static_lab = section('route', 'static_lab', 20, { interface: 'lan', target: '10.10.0.0/16', gateway: '192.168.88.2', comment: 'Lab network behind the test switch' });
 firewall.cfg1192bd = section('redirect', 'cfg1192bd', 20, { name: 'Web server', target: 'DNAT', src: 'wan', dest: 'lan', proto: 'tcp', src_dport: '8080', dest_ip: '192.168.88.10', dest_port: '80' }, true);
 firewall.cfg1292bd = section('rule', 'cfg1292bd', 21, { name: 'Block-Telnet', src: 'lan', dest: 'wan', proto: 'tcp', dest_port: '23', target: 'REJECT', enabled: '0' }, true);
 dhcp.cfg1392bd = section('host', 'cfg1392bd', 20, { name: 'nas', mac: '52:54:00:aa:10:01', ip: '192.168.88.10', dns: '1' }, true);
 return { network, firewall, dhcp };
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
 let safe = null, lastRollback = null;
 const started = now();
 const seconds = () => Math.max(0, (now() - started) / 1000);
 const text = config => JSON.stringify(configs[config]);

 function sectionsOf(config, type) {
  return Object.values(configs[config]).filter(item => item['.type'] === type).sort((a, b) => a['.index'] - b['.index']);
 }

 function setValues(target, values) {
  for (const [key, value] of Object.entries(values ?? {})) {
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
   for (const key of Object.keys(op.values ?? {})) if (!NAME.test(key)) return { ok: false, error: 'invalid', message: `Invalid value for ${key}` };
   if (op.op === 'add') {
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
  const status = extra => ({ ok: true, active: !!safe, mine: !!safe && safe.sid === sid, owner: safe?.user, count: safe?.count ?? 0, limit: 100, timeout: safe?.timeout ?? safeTimeout, last_rollback: lastRollback, ...extra });
  if (action === 'status') return status();
  if (action === 'ping') { if (safe?.sid === sid) safe.heartbeat = now(); return status(); }
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
   if (item.proto === 'dhcp') {
    live['ipv4-address'] = [{ address: '203.0.113.42', mask: 24 }];
    live.route = [{ target: '0.0.0.0', mask: 0, nexthop: '203.0.113.1', source: '203.0.113.42/32' }];
    live.data = { dhcpserver: '203.0.113.1', leasetime: 86400 };
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

 function conntrack() {
  const t = Math.floor(seconds());
  const entries = Array.from({ length: 48 }, (unused, index) => {
   const client = CLIENTS[index % CLIENTS.length];
   const tcp = index % 4 !== 3;
   return {
    family: 'ipv4', protocol: tcp ? 'tcp' : 'udp', timeout: tcp ? 7440 - ((t + index * 37) % 7000) : 30 + (index % 30), packets: 10 + index * 7 + t, bytes: (10 + index * 7 + t) * 640,
    flags: tcp ? ['ASSURED'] : index % 2 ? ['UNREPLIED'] : [], state: tcp ? 'ESTABLISHED' : undefined,
    src: client.ipaddr, dst: `198.51.100.${(index * 7) % 250 + 1}`, sport: String(40000 + index * 13), dport: tcp ? (index % 2 ? '443' : '80') : '53'
   };
  });
  return { available: true, count: entries.length, max: 16384, entries };
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
  return { dhcp_leases: CLIENTS.map((client, index) => ({ ...client, expires: Math.max(1, 43200 - index * 3600 - t) })), dhcp6_leases: [] };
 }

 function history_() {
  const summary = entry => entry ? { id: entry.id, description: entry.description, time: entry.time, user: entry.user } : null;
  return { undo: summary(history.filter(entry => !entry.undone).at(-1)), redo: summary(history.find(entry => entry.undone)), entries: history.map(entry => ({ ...summary(entry), configs: entry.configs, undone: entry.undone, safemode: entry.safemode })) };
 }

 return {
  watchdog,
  uci: config => configs[config] ? clone(configs[config]) : null,
  devices, ifaces, routes4, counters, conntrack, log, leases,
  history: history_, apply, undo: () => step('undo'), redo: () => step('redo'), safemode,
  terminal: () => ({ installed: false, running: false, port: 7681, ssl: false, interface: '@lan', url_override: null })
 };
}
