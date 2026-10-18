// SPDX-License-Identifier: Apache-2.0
// IP ▸ Settings: kernel settings kept in /etc/sysctl.conf, which OpenWrt
// leaves to the administrator, and IP ▸ Pool: the address ranges of the
// DHCP servers. Both are undoable changes like any other.
import { sections, invalid, firstCidr } from './common.js';
import { parseCidr, parseIPv4, formatIPv4 } from '../lib/ip.js';

// Settings shown, as RouterOS's IP Settings names them.
const SETTINGS = [
 { id: 'ip_forward', key: 'net.ipv4.ip_forward', label: 'IP Forward', type: 'bool' },
 { id: 'ip6_forward', key: 'net.ipv6.conf.all.forwarding', label: 'IPv6 Forward', type: 'bool' },
 { id: 'rp_filter', key: 'net.ipv4.conf.all.rp_filter', also: ['net.ipv4.conf.default.rp_filter'], label: 'RP Filter', type: 'select', options: [['0', 'no'], ['1', 'strict'], ['2', 'loose']] },
 { id: 'accept_redirects', key: 'net.ipv4.conf.all.accept_redirects', label: 'Accept Redirects', type: 'bool' },
 { id: 'send_redirects', key: 'net.ipv4.conf.all.send_redirects', label: 'Send Redirects', type: 'bool' },
 { id: 'accept_source_route', key: 'net.ipv4.conf.all.accept_source_route', label: 'Accept Source Route', type: 'bool' },
 { id: 'tcp_syncookies', key: 'net.ipv4.tcp_syncookies', label: 'TCP SYN Cookies', type: 'bool' },
 { id: 'icmp_ratelimit', key: 'net.ipv4.icmp_ratelimit', label: 'ICMP Rate Limit (ms)', type: 'number', range: [0, 100000] },
 { id: 'icmp_broadcasts', key: 'net.ipv4.icmp_echo_ignore_broadcasts', label: 'Ignore Broadcast Pings', type: 'bool' },
 { id: 'arp_timeout', key: 'net.ipv4.neigh.default.base_reachable_time_ms', label: 'ARP Timeout (ms)', type: 'number', range: [1000, 3600000], tab: 'Neighbors' },
 { id: 'neighbors_max', key: 'net.ipv4.neigh.default.gc_thresh3', label: 'Max Neighbor Entries', type: 'number', range: [128, 1048576], tab: 'Neighbors' },
 { id: 'neighbors6_max', key: 'net.ipv6.neigh.default.gc_thresh3', label: 'Max IPv6 Neighbors', type: 'number', range: [128, 1048576], tab: 'Neighbors' },
 { id: 'conntrack_max', key: 'net.netfilter.nf_conntrack_max', label: 'Max Connections', type: 'number', range: [1024, 4194304], tab: 'Connections' },
 { id: 'tcp_established', key: 'net.netfilter.nf_conntrack_tcp_timeout_established', label: 'TCP Established Timeout (s)', type: 'number', range: [60, 1209600], tab: 'Connections' },
 { id: 'udp_timeout', key: 'net.netfilter.nf_conntrack_udp_timeout', label: 'UDP Timeout (s)', type: 'number', range: [1, 3600], tab: 'Connections' },
 { id: 'udp_stream', key: 'net.netfilter.nf_conntrack_udp_timeout_stream', label: 'UDP Stream Timeout (s)', type: 'number', range: [1, 86400], tab: 'Connections' },
 { id: 'conntrack_acct', key: 'net.netfilter.nf_conntrack_acct', label: 'Count Bytes Per Connection', type: 'bool', tab: 'Connections' }
];
export const SYSCTL_KEYS = SETTINGS.flatMap(setting => [setting.key, ...(setting.also ?? [])]);

// Edits /etc/sysctl.conf line by line: a key keeps its line, a new key is
// appended, and everything else in the file stays as it was.
export function setSysctl(text, changes) {
 const lines = text ? String(text).replace(/\n$/, '').split('\n') : [];
 const pending = new Map(Object.entries(changes));
 const out = [];
 for (const line of lines) {
  const key = /^\s*([a-z0-9_.-]+)\s*=/.exec(line)?.[1];
  if (key && pending.has(key)) {
   const value = pending.get(key);
   pending.delete(key);
   if (value !== null) out.push(`${key}=${value}`);
  } else out.push(line);
 }
 for (const [key, value] of pending) if (value !== null) out.push(`${key}=${value}`);
 return out.length ? out.join('\n') + '\n' : '';
}

export const ipSettings = {
 id: 'ip-settings',
 noun: 'IP Settings',
 singleton: true,
 sources: ['sysctl'],
 rows: data => data.sysctl ? [{ key: 'settings', section: 'settings' }] : [],
 itemTitle: () => 'IP Settings',
 itemStatus: data => [],
 fields: data => [
  ...SETTINGS.filter(setting => data.sysctl?.values?.[setting.key] !== undefined).map(setting => ({
   id: setting.id, label: setting.label, type: setting.type, tab: setting.tab, options: setting.options?.map(([value, label]) => ({ value, label }))
  })),
  { id: 'note', label: '', type: 'note', value: () => `Kept in ${data.sysctl?.path ?? '/etc/sysctl.conf'} and applied at once. FastPath (flow offloading) is in IP ▸ Firewall ▸ Settings.` }
 ],
 values(row, data) {
  const values = {};
  for (const setting of SETTINGS) {
   const current = data.sysctl?.values?.[setting.key];
   if (current === undefined) continue;
   values[setting.id] = setting.type === 'bool' ? current !== '0' : current;
  }
  return values;
 },
 save(values, row, data, { dirty = null } = {}) {
  const changes = {};
  for (const setting of SETTINGS) {
   if (dirty && !dirty.has(setting.id)) continue;
   if (values[setting.id] === undefined) continue;
   let value = values[setting.id];
   if (setting.type === 'bool') value = value ? '1' : '0';
   else if (setting.type === 'number') {
    if (!/^\d+$/.test(String(value)) || Number(value) < setting.range[0] || Number(value) > setting.range[1]) invalid(setting.id, `${setting.label.replace(/ \(.*\)$/, '')} is ${setting.range[0]} to ${setting.range[1]}`);
    value = String(Number(value));
   }
   for (const key of [setting.key, ...(setting.also ?? [])]) changes[key] = String(value);
  }
  if (!Object.keys(changes).length) return null;
  const before = data.sysctl?.text ?? '';
  return { description: 'Change IP settings', ops: [{ op: 'text', config: 'sysctl', text: setSysctl(before, changes), expect: before }] };
 }
};

/* --- IP Pool -------------------------------------------------------------- */

function poolOf(data, section) {
 const network = sections(data['uci:network'], 'interface').find(item => item['.name'] === section.interface);
 const cidr = parseCidr(firstCidr(network));
 if (!cidr || cidr.prefix > 30) return null;
 const base = parseIPv4(cidr.network), size = 2 ** (32 - cidr.prefix);
 const start = Number(section.start ?? 100), limit = Number(section.limit ?? 150);
 return { base, size, first: base + start, last: base + start + limit - 1, cidr };
}

export const ipPools = {
 id: 'ip-pools',
 noun: 'IP Pool',
 sources: ['uci:dhcp', 'uci:network', 'leases'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'ranges', label: 'Addresses', width: 230 },
  { id: 'size', label: 'Size', width: 60, align: 'right', sort: value => Number(value) || 0 },
  { id: 'used', label: 'Used', width: 60, align: 'right', sort: value => Number(value) || 0 }
 ],
 flagLegend: { X: 'DHCP server ignores this network' },
 defaultSort: null,
 status: () => 'The address pools of the DHCP servers (start and limit of each dhcp section)',
 rows(data) {
  const leases = data.leases?.dhcp_leases ?? [];
  return sections(data['uci:dhcp'], 'dhcp').map(section => {
   const pool = poolOf(data, section);
   if (!pool) return null;
   const used = leases.filter(lease => { const address = parseIPv4(lease.ipaddr); return address !== null && address >= pool.first && address <= pool.last; }).length;
   const disabled = section.ignore === '1';
   return { key: section['.name'], section: section['.name'], disabled, pool, flags: disabled ? 'X' : '', cells: { name: section['.name'], ranges: `${formatIPv4(pool.first)}-${formatIPv4(pool.last)}`, size: String(pool.last - pool.first + 1), used: String(used) } };
  }).filter(Boolean);
 },
 itemTitle: row => `IP Pool <${row.key}>`,
 itemStatus: row => [`${row.cells.used} of ${row.cells.size} leased`],
 fields: () => [
  { id: 'name', label: 'Name', type: 'static' },
  { id: 'ranges', label: 'Addresses', type: 'text', placeholder: '192.168.1.100-192.168.1.249' },
  { id: 'network', label: 'Network', type: 'static' }
 ],
 values: row => ({ name: row.key, ranges: row.cells.ranges, network: `${row.pool.cidr.network}/${row.pool.cidr.prefix}` }),
 save(values, row) {
  const match = /^\s*(\S+)\s*-\s*(\S+)\s*$/.exec(values.ranges ?? '');
  const first = match && parseIPv4(match[1]), last = match && parseIPv4(match[2]);
  const { base, size } = row.pool;
  if (first === null || last === null || !match) invalid('ranges', 'Enter a range such as 192.168.1.100-192.168.1.249');
  if (first > last) invalid('ranges', 'The range starts after it ends');
  if (first <= base || last >= base + size - 1) invalid('ranges', `The range must lie inside ${row.pool.cidr.network}/${row.pool.cidr.prefix}, without its network and broadcast addresses`);
  return { description: `Change pool ${row.key} to ${formatIPv4(first)}-${formatIPv4(last)}`, ops: [{ op: 'set', config: 'dhcp', section: row.section, values: { start: String(first - base), limit: String(last - first + 1) } }] };
 }
};
