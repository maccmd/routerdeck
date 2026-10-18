// SPDX-License-Identifier: Apache-2.0
// Ping, Traceroute and Torch: rows from diagnostic job results and from
// connection-tracking samples. The windows are in windows/ToolWindows.jsx.
import { bitrate, rate } from '../lib/format.js';
import { inPrefix, parseCidr, parseCidr6 } from '../lib/ip.js';

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
