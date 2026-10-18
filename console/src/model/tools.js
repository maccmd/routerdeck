// SPDX-License-Identifier: Apache-2.0
// Ping, Traceroute and Torch: rows from diagnostic job results and from
// connection-tracking samples. The windows are in windows/ToolWindows.jsx.
import { bitrate, rate, bytes, uptime } from '../lib/format.js';
import { inPrefix, parseCidr, parseCidr6, isMac, addressKey } from '../lib/ip.js';
import { sections, truthy, list, invalid, compact } from './common.js';

// Host names and addresses the plugin accepts; no leading '-'.
export const HOST = /^[A-Za-z0-9:][A-Za-z0-9.:-]{0,252}$/;

export const ms = value => Number.isFinite(value) ? `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms` : '';

function spread(times) {
 if (!times.length) return { min: null, avg: null, max: null, stdev: null };
 let min = Infinity, max = -Infinity, sum = 0;
 for (const time of times) { min = Math.min(min, time); max = Math.max(max, time); sum += time; }
 const avg = sum / times.length;
 const stdev = Math.sqrt(times.reduce((total, time) => total + (time - avg) ** 2, 0) / times.length);
 return { min, avg, max, stdev };
}

// One row per echo request, in the order they were sent.
export function pingView(results) {
 let address = null, error = null;
 const rows = [], times = [];
 for (const item of results) {
  if (item.error) error = item.message ?? item.error;
  else if (item.seq === undefined) address = item.address ?? address;
  else {
   const replied = Number.isFinite(item.time);
   if (replied) times.push(item.time);
   rows.push({
    key: String(item.seq), tone: replied ? undefined : 'error',
    cells: { seq: String(item.seq), host: item.host ?? address ?? '', time: ms(item.time), size: item.size === undefined ? '' : String(item.size), ttl: item.ttl === undefined ? '' : String(item.ttl), status: replied ? '' : item.status ?? 'timeout' }
   });
  }
 }
 const sent = rows.length, received = times.length;
 return { rows, address, error, sent, received, loss: sent ? Math.round(100 * (sent - received) / sent) : null, ...spread(times) };
}

// Each round probes every hop once; a hop's statistics cover all rounds.
// Only the hops of the latest round are shown: once the destination answers,
// the hops behind it are no longer probed.
export function traceView(results) {
 let address = null, error = null, rounds = 0, latest = [];
 const hops = new Map();
 for (const item of results) {
  if (item.error) error = item.message ?? item.error;
  else if (item.round === undefined) address = item.address ?? address;
  else {
   rounds = item.round;
   latest = item.hops.map(probe => probe.hop);
   for (const probe of item.hops) {
    const hop = hops.get(probe.hop) ?? { sent: 0, times: [], address: null, last: null, status: null };
    hop.sent++;
    if (probe.address) hop.address = probe.address;
    hop.last = Number.isFinite(probe.time) ? probe.time : null;
    if (hop.last !== null) hop.times.push(hop.last);
    hop.status = probe.status || null;
    hops.set(probe.hop, hop);
   }
  }
 }
 const rows = latest.map(number => {
  const hop = hops.get(number), stats = spread(hop.times), lost = hop.sent - hop.times.length;
  return {
   key: String(number), tone: hop.times.length ? undefined : 'error',
   cells: {
    hop: String(number), address: hop.address ?? '', loss: `${Math.round(100 * lost / hop.sent)}%`, sent: String(hop.sent),
    last: hop.last === null ? 'timeout' : ms(hop.last), avg: ms(stats.avg), best: ms(stats.min), worst: ms(stats.max), stdev: ms(stats.stdev), status: hop.status ?? ''
   }
  };
 });
 return { rows, address, error, rounds, reached: address !== null && rows.some(row => row.cells.address === address) };
}

/* --- Torch ------------------------------------------------------------- */

const ZERO = { tx_bytes: 0, rx_bytes: 0, tx_packets: 0, rx_packets: 0 };
export const flowKey = entry => [entry.family, entry.protocol, entry.src, entry.sport ?? entry.type ?? '', entry.dst, entry.dport ?? entry.id ?? ''].join(' ');

// Per-connection rates from two connection-tracking samples. A connection
// missing from a complete previous sample is new and counts from zero; when
// the previous sample was cut short, its rate is unknown rather than wrong.
export function flowSample(reply, previous, time) {
 const entries = reply?.entries ?? [];
 const complete = !(reply?.count > entries.length);
 const seconds = previous ? (time - previous.time) / 1000 : 0;
 const map = new Map();
 const flows = entries.map(entry => {
  let key = flowKey(entry);
  while (map.has(key)) key += '+';
  map.set(key, entry);
  const before = previous?.map.get(key);
  const reset = before && (entry.tx_bytes < before.tx_bytes || entry.rx_bytes < before.rx_bytes);
  const base = before && !reset ? before : before || previous?.complete ? ZERO : null;
  const per = (field, factor) => base && seconds > 0 && Number.isFinite(entry[field]) ? (entry[field] - (base[field] ?? 0)) * factor / seconds : null;
  return { ...entry, key, tx_bps: per('tx_bytes', 8), rx_bps: per('rx_bytes', 8), tx_pps: per('tx_packets', 1), rx_pps: per('rx_packets', 1) };
 });
 return { time, map, complete, flows, count: reply?.count ?? entries.length, available: reply?.available !== false };
}

// Main-table unicast routes, longest prefix first, to find the device a
// connection's endpoint is reached through.
export function routeIndex(routes4, routes6) {
 const list = [];
 for (const [routes, family] of [[routes4, 4], [routes6, 6]]) {
  for (const route of routes ?? []) {
   if (!route.dev || (route.type && route.type !== 'unicast') || (route.table && route.table !== 'main')) continue;
   const [network, length] = route.dst === 'default' ? [family === 4 ? '0.0.0.0' : '::', 0] : String(route.dst).split('/');
   list.push({ family, network, prefix: length === undefined ? (family === 4 ? 32 : 128) : Number(length), dev: route.dev });
  }
 }
 return list.sort((a, b) => b.prefix - a.prefix);
}

export function localAddresses(ifaces) {
 const set = new Set();
 for (const item of ifaces ?? []) {
  for (const entry of [...(item['ipv4-address'] ?? []), ...(item['ipv6-address'] ?? [])]) set.add(entry.address);
  for (const entry of item['ipv6-prefix-assignment'] ?? []) if (entry['local-address']) set.add(entry['local-address'].address);
 }
 return set;
}

// Devices Torch can watch: the layer 3 devices of interfaces that are up.
export function torchDevices(ifaces) {
 const devices = new Map();
 for (const item of ifaces ?? []) {
  if (!item.up || !item.l3_device || item.l3_device === 'lo') continue;
  devices.set(item.l3_device, [...(devices.get(item.l3_device) ?? []), item.interface]);
 }
 return [...devices].map(([value, names]) => ({ value, label: `${value} (${names.join(', ')})` }));
}

// "a.b.c.d", "a.b.c.d/nn" or an IPv6 equivalent; null when it is neither.
export function addressMatcher(text) {
 const value = String(text ?? '').trim();
 if (!value) return () => true;
 const parsed = value.includes(':') ? parseCidr6(value) : parseCidr(value);
 if (!parsed) return null;
 const network = parsed.address ?? parsed.network, prefix = parsed.prefix;
 return address => !!address && inPrefix(address, network, prefix);
}

const endpoint = (address, port, withPort) => !withPort || !port ? address ?? '' : address?.includes(':') ? `[${address}]:${port}` : `${address ?? ''}:${port}`;

// Rows grouped by the collected fields. On a device, Tx is what the device
// sends and Rx what it receives: the original direction of a connection is
// received where its source is and sent where its (translated) destination
// is. Without a device, Tx is the original direction and Rx the replies.
export function torchView(sample, { device = '', routes = [], local = new Set(), protocol = '', src = '', dst = '', port = '', collect = ['protocol', 'src', 'dst', 'port'] } = {}) {
 const matchSrc = addressMatcher(src) ?? (() => false), matchDst = addressMatcher(dst) ?? (() => false);
 const cache = new Map();
 const deviceOf = address => {
  if (!address || local.has(address)) return null;
  if (!cache.has(address)) {
   const family = address.includes(':') ? 6 : 4;
   cache.set(address, routes.find(route => route.family === family && inPrefix(address, route.network, route.prefix))?.dev ?? null);
  }
  return cache.get(address);
 };
 const groups = new Map(), totals = { tx_bps: 0, rx_bps: 0, tx_pps: 0, rx_pps: 0 };
 const fields = new Set(collect);
 for (const flow of sample?.flows ?? []) {
  if (protocol && flow.protocol !== protocol) continue;
  if (port && flow.sport !== port && flow.dport !== port) continue;
  if (!matchSrc(flow.src) || !matchDst(flow.dst)) continue;
  let outbound = true;
  if (device) {
   if (deviceOf(flow.src) === device) outbound = false;
   else if (deviceOf(flow.reply_src ?? flow.dst) !== device) continue;
  }
  const rates = outbound
   ? { tx_bps: flow.tx_bps, rx_bps: flow.rx_bps, tx_pps: flow.tx_pps, rx_pps: flow.rx_pps }
   : { tx_bps: flow.rx_bps, rx_bps: flow.tx_bps, tx_pps: flow.rx_pps, rx_pps: flow.tx_pps };
  const cells = {
   family: flow.family ?? '', protocol: fields.has('protocol') ? flow.protocol : '',
   src: endpoint(fields.has('src') ? flow.src : '', flow.sport, fields.has('port')), dst: endpoint(fields.has('dst') ? flow.dst : '', flow.dport, fields.has('port'))
  };
  const key = [cells.family, cells.protocol, cells.src, cells.dst].join(' ');
  const group = groups.get(key) ?? { key, cells, flows: 0, tx_bps: null, rx_bps: null, tx_pps: null, rx_pps: null };
  group.flows++;
  for (const [name, value] of Object.entries(rates)) {
   if (value === null) continue;
   group[name] = (group[name] ?? 0) + value;
   totals[name] += value;
  }
  groups.set(key, group);
 }
 const rows = [...groups.values()].map(group => ({
  key: group.key, total: (group.tx_bps ?? 0) + (group.rx_bps ?? 0),
  values: { tx: group.tx_bps ?? -1, rx: group.rx_bps ?? -1, txp: group.tx_pps ?? -1, rxp: group.rx_pps ?? -1, flows: group.flows },
  cells: { ...group.cells, tx: bitrate(group.tx_bps), rx: bitrate(group.rx_bps), txp: rate(group.tx_pps), rxp: rate(group.rx_pps), flows: String(group.flows) }
 })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
 return { rows, totals, invalid: [!addressMatcher(src) && 'src', !addressMatcher(dst) && 'dst'].filter(Boolean) };
}

/* --- Bandwidth test (iperf3) ------------------------------------------- */

// Intervals as rows, per direction; the summary lines give the averages.
// Without --bidir roles, the direction follows the test: a client sends
// unless it receives (-R); a one-off server receives.
export function bandwidthView(results, job = {}) {
 const rows = [], points = [], totals = {};
 let error = null, status = '';
 const fallback = job.mode === 'server' ? 'rx' : job.direction === 'receive' ? 'rx' : 'tx';
 for (const item of results) {
  if (item.error) error = item.message ?? item.error;
  else if (item.status) status = item.status;
  else if (Number.isFinite(item.bps)) {
   const direction = item.role ? (item.role === 'RX' ? 'rx' : 'tx') : fallback;
   if (item.summary) {
    // Both ends report; the receiver's figure is what arrived.
    if (!totals[direction] || item.summary === 'receiver') totals[direction] = item.bps;
    continue;
   }
   rows.push({ key: `${direction}:${item.start}`, cells: { time: `${item.start.toFixed(0)}-${item.end.toFixed(0)} s`, direction: direction === 'tx' ? 'send' : 'receive', rate: bitrate(item.bps), transferred: bytes(item.bytes), lost: item.lost === null || item.lost === undefined ? '' : String(item.lost) } });
   const at = item.end * 1000, point = points.find(entry => entry.t === at) ?? (points.push({ t: at }), points.at(-1));
   point[direction] = item.bps;
  }
 }
 return { rows, points, totals, error, status };
}

/* --- IP scan ----------------------------------------------------------- */

export function scanView(results, data = {}) {
 const found = new Map(), names = new Map();
 for (const lease of data.leases?.dhcp_leases ?? []) if (lease.hostname) names.set(lease.ipaddr, lease.hostname);
 for (const host of sections(data['uci:dhcp'], 'host')) for (const address of list(host.ip)) if (host.name) names.set(address, host.name);
 let total = 0, scanned = 0, macs = {}, error = null;
 for (const item of results) {
  if (item.error) error = item.message ?? item.error;
  if (item.total) total = item.total;
  if (item.scanned) scanned = item.scanned;
  if (item.macs) macs = item.macs;
  if (item.address) found.set(item.address, item);
 }
 const rows = [...found.values()].sort((a, b) => addressKey(a.address).localeCompare(addressKey(b.address))).map(item => ({
  key: item.address, cells: { address: item.address, mac: (macs[item.address] ?? '').toUpperCase(), name: names.get(item.address) ?? '', time: ms(item.time), ttl: String(item.ttl ?? '') }
 }));
 return { rows, total, scanned, error, done: results.some(item => item.macs) };
}

/* --- Netwatch ---------------------------------------------------------- */

export const netwatch = {
 id: 'netwatch',
 noun: 'Netwatch Host',
 sources: ['uci:routerdeck', 'netwatch'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'host', label: 'Host', width: 160, sort: addressKey },
  { id: 'interval', label: 'Interval', width: 70, align: 'right', sort: value => parseFloat(value) || 0 },
  { id: 'timeout', label: 'Timeout', width: 70, align: 'right' },
  { id: 'status', label: 'Status', width: 70 },
  { id: 'since', label: 'Since', width: 110, sort: (value, row) => row.age ?? Infinity },
  { id: 'rtt', label: 'Last RTT', width: 80, align: 'right' }
 ],
 flagLegend: { X: 'disabled', U: 'up', D: 'down' },
 defaultSort: null,
 status: data => data.netwatch && !data.netwatch.running && sections(data['uci:routerdeck'], 'netwatch').some(section => !truthy(section.disabled)) ? 'The netwatch service is not running yet' : 'Checked on the router by the routerdeck-netwatch service, also while this console is closed',
 rows(data) {
  const live = data.netwatch?.hosts ?? {}, now = data.netwatch?.now;
  return sections(data['uci:routerdeck'], 'netwatch').map(section => {
   const state = live[section['.name']], disabled = truthy(section.disabled);
   const age = state?.since && now ? now - state.since : null;
   return {
    key: section['.name'], section: section['.name'], disabled, comment: section.comment, age,
    tone: state?.status === 'down' && !disabled ? 'error' : undefined,
    flags: (disabled ? 'X' : '') + (!disabled && state?.status === 'up' ? 'U' : '') + (!disabled && state?.status === 'down' ? 'D' : ''),
    cells: { host: section.host ?? '', interval: `${section.interval ?? '10'} s`, timeout: `${section.timeout ?? '1'} s`, status: disabled ? '' : state?.status ?? 'unknown', since: age !== null ? `${uptime(age)} ago` : '', rtt: ms(state?.rtt) }
   };
  });
 },
 itemTitle: row => `Netwatch <${row?.cells.host || 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.cells.status],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: () => [
  { id: 'host', label: 'Host', type: 'text', placeholder: '8.8.8.8 or a name' },
  { id: 'interval', label: 'Interval (s)', type: 'number' },
  { id: 'timeout', label: 'Timeout (s)', type: 'number' },
  { id: 'up', label: 'On Up', type: 'text', tab: 'Up', placeholder: 'a shell command, e.g. logger -t wan up' },
  { id: 'down', label: 'On Down', type: 'text', tab: 'Down', placeholder: 'a shell command, e.g. /etc/init.d/network restart' }
 ],
 values(row, data) {
  const section = sections(data['uci:routerdeck'], 'netwatch').find(item => item['.name'] === row.section) ?? {};
  return { host: section.host ?? '', interval: section.interval ?? '10', timeout: section.timeout ?? '1', up: section.up ?? '', down: section.down ?? '' };
 },
 defaults: () => ({ host: '', interval: '10', timeout: '1', up: '', down: '' }),
 save(values, row) {
  if (!HOST.test(values.host.trim())) invalid('host', 'Enter an address or host name');
  if (!(/^\d+$/.test(values.interval) && Number(values.interval) >= 1 && Number(values.interval) <= 86400)) invalid('interval', 'Interval is 1 to 86400 seconds');
  if (!(/^\d+$/.test(values.timeout) && Number(values.timeout) >= 1 && Number(values.timeout) <= 10)) invalid('timeout', 'Timeout is 1 to 10 seconds');
  for (const id of ['up', 'down']) if (/\n/.test(values[id])) invalid(id, 'A command is one line');
  const options = compact({ host: values.host.trim(), interval: values.interval, timeout: values.timeout, up: values.up, down: values.down });
  return row
   ? { description: `Change netwatch ${options.host}`, ops: [{ op: 'set', config: 'routerdeck', section: row.section, values: options }] }
   : { description: `Watch ${options.host}`, ops: [{ op: 'add', config: 'routerdeck', type: 'netwatch', values: options }] };
 },
 remove: rows => ({ description: `Stop watching ${rows.map(row => row.cells.host).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'routerdeck', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} netwatch ${rows.map(row => row.cells.host).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment netwatch ${rows.map(row => row.cells.host).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { comment: comment || null } })) })
};

/* --- Wake on LAN ------------------------------------------------------- */

export const wakeOnLan = {
 id: 'tool-wol',
 noun: 'Wake on LAN',
 singleton: true,
 action: { label: 'Send' },
 sources: ['leases', 'uci:dhcp', 'devices'],
 rows: () => [{ key: 'wol', section: 'wol' }],
 itemTitle: () => 'Wake on LAN',
 itemStatus: () => ['etherwake'],
 fields(data) {
  const known = new Map();
  for (const host of sections(data['uci:dhcp'], 'host')) for (const mac of list(host.mac)) if (isMac(mac)) known.set(mac.toLowerCase(), host.name ?? '');
  for (const lease of data.leases?.dhcp_leases ?? []) if (isMac(lease.macaddr ?? '')) known.set(lease.macaddr.toLowerCase(), known.get(lease.macaddr.toLowerCase()) || lease.hostname || '');
  const devices = Object.values(data.devices ?? {}).filter(device => device.up && !device.flags?.loopback && device.name !== 'lo');
  return [
   { id: 'mac', label: 'MAC Address', type: 'combo', options: [...known].map(([value, name]) => ({ value, label: name ? `${value} ${name}` : value })) },
   { id: 'interface', label: 'Interface', type: 'select', options: devices.map(device => ({ value: device.name, label: device.name })) },
   { id: 'note', label: '', type: 'note', value: () => 'Sends a magic packet on that network. The computer must have wake on LAN enabled in its firmware and network card.' }
  ];
 },
 values: (row, data) => ({ mac: '', interface: data?.devices?.['br-lan'] ? 'br-lan' : '' }),
 save(values) {
  const mac = String(values.mac ?? '').trim().split(/\s+/)[0];
  if (!isMac(mac)) invalid('mac', 'Enter a MAC address such as 00:11:22:33:44:55');
  if (!values.interface) invalid('interface', 'Choose the network the computer is on');
  return { description: `Wake ${mac}`, call: ['routerdeck', 'wol', { mac: mac.toLowerCase(), interface: values.interface }], notice: `Magic packet sent to ${mac.toLowerCase()} on ${values.interface}` };
 }
};

/* --- Graphing ----------------------------------------------------------------- */

// The router keeps averages per period, as RouterOS does.
export const GRAPH_PERIODS = [
 { id: 'day', label: 'Daily (5 minute average)', seconds: 86400 },
 { id: 'week', label: 'Weekly (30 minute average)', seconds: 7 * 86400 },
 { id: 'month', label: 'Monthly (2 hour average)', seconds: 30 * 86400 },
 { id: 'year', label: 'Yearly (1 day average)', seconds: 365 * 86400 }
];

export function graphSources(names = []) {
 const label = name => name === 'cpu' ? 'CPU' : name === 'memory' ? 'Memory' : name.replace(/^interface:/, '');
 return names.map(name => ({ name, label: label(name), kind: name.startsWith('interface:') ? 'traffic' : 'percent' }))
  .sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'percent' ? -1 : 1));
}

// Points as the graph draws them: rx/tx in bits per second for interfaces,
// one value in percent for CPU and memory.
export function graphPoints(series, kind) {
 return (series ?? []).map(([start, first, second]) => kind === 'traffic' ? { t: start * 1000, rx: first, tx: second } : { t: start * 1000, value: first });
}

export const graphingSettings = {
 id: 'graphing-settings',
 noun: 'Graphing Settings',
 singleton: true,
 sources: ['uci:routerdeck', 'devices'],
 rows: () => [{ key: 'graphing', section: 'graphing' }],
 itemTitle: () => 'Graphing Settings',
 itemStatus: () => ['routerdeck-graphing'],
 fields: data => [
  { id: 'enabled', label: 'Enabled', type: 'bool' },
  { id: 'interfaces', label: 'Interfaces', type: 'multi', options: Object.keys(data.devices ?? {}).filter(name => name !== 'lo').sort().map(value => ({ value, label: value })) },
  { id: 'resources', label: 'CPU and Memory', type: 'bool' },
  { id: 'store', label: 'Store on Flash', type: 'bool' },
  { id: 'note', label: '', type: 'note', value: () => 'With no interface chosen, every interface is graphed. The history is kept in RAM; Store on Flash also saves it once an hour, so it survives a reboot, at the cost of a write to flash every hour.' }
 ],
 values(row, data) {
  const section = data['uci:routerdeck']?.graphing ?? {};
  return { enabled: truthy(section.enabled), interfaces: list(section.interfaces), resources: truthy(section.resources, true), store: truthy(section.store) };
 },
 save(values, row, data) {
  const options = { enabled: values.enabled ? '1' : '0', interfaces: values.interfaces ?? [], resources: values.resources ? null : '0', store: values.store ? '1' : null };
  return data['uci:routerdeck']?.graphing
   ? { description: `${values.enabled ? 'Change' : 'Turn off'} graphing`, ops: [{ op: 'set', config: 'routerdeck', section: 'graphing', values: compact(options) }] }
   : { description: 'Turn on graphing', ops: [{ op: 'add', config: 'routerdeck', type: 'graphing', name: 'graphing', values: Object.fromEntries(Object.entries(compact(options)).filter(([, value]) => value !== null && !(Array.isArray(value) && !value.length))) }] };
 }
};
