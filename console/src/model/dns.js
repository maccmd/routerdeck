// SPDX-License-Identifier: Apache-2.0
// IP > DNS: dnsmasq settings (a single form, like RouterOS's DNS settings
// dialog) and static entries: `domain` sections (A/AAAA) and `cname` sections.
import { sections, list, truthy, invalid, compact } from './common.js';
import { isIPv4, canonicalIPv6, addressKey } from '../lib/ip.js';

const SERVER = /^(\/[^/\s]+\/)?([0-9a-fA-F.:]+)(#[0-9]{1,5})?$/;
const DNS_NAME = /^(\*\.)?[A-Za-z0-9]([A-Za-z0-9-]{0,62})(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}))*\.?$/;

// dnsmasq options of the Advanced tab; `on` is dnsmasq's default in
// OpenWrt's stock configuration.
const ADVANCED = [
 { id: 'domainneeded', label: "Don't Forward Plain Names", type: 'bool', on: true },
 { id: 'boguspriv', label: 'Filter Private Reverse Lookups', type: 'bool', on: true },
 { id: 'localise_queries', label: 'Localise Queries', type: 'bool', on: true },
 { id: 'expandhosts', label: 'Expand Hosts', type: 'bool', on: true },
 { id: 'strictorder', label: 'Query Servers in Order', type: 'bool' },
 { id: 'allservers', label: 'Query All Servers', type: 'bool' },
 { id: 'filter_aaaa', label: 'Filter IPv6 Answers', type: 'bool' },
 { id: 'filter_a', label: 'Filter IPv4 Answers', type: 'bool' },
 { id: 'nonegcache', label: "Don't Cache Negative Answers", type: 'bool' },
 { id: 'min_cache_ttl', label: 'Cache Min TTL (s)', type: 'number', range: [0, 3600] },
 { id: 'max_cache_ttl', label: 'Cache Max TTL (s)', type: 'number', range: [0, 604800] },
 { id: 'ednspacket_max', label: 'Max UDP Packet Size', type: 'number', range: [512, 4096] },
 { id: 'dnsforwardmax', label: 'Max Concurrent Queries', type: 'number', range: [1, 10000] },
 { id: 'port', label: 'DNS Port', type: 'number', range: [0, 65535] },
 { id: 'rebind_localhost', label: 'Allow Rebind to Localhost', type: 'bool' },
 { id: 'rebind_domain', label: 'Rebind Allowed Domains', type: 'list' },
 { id: 'addnhosts', label: 'Additional Hosts Files', type: 'list' },
 { id: 'dnssec', label: 'DNSSEC (dnsmasq-full)', type: 'bool' },
 { id: 'dnsseccheckunsigned', label: 'Check Unsigned Zones', type: 'bool', on: true }
];

export const dnsSettings = {
 id: 'dns-settings',
 noun: 'DNS Settings',
 singleton: true,
 sources: ['uci:dhcp', 'ifaces'],
 rows(data) {
  const section = sections(data['uci:dhcp'], 'dnsmasq')[0];
  return section ? [{ key: section['.name'], section: section['.name'] }] : [];
 },
 itemTitle: () => 'DNS Settings',
 itemStatus: () => ['dnsmasq'],
 fields(data) {
  const dynamic = [...new Set((data.ifaces ?? []).flatMap(item => item['dns-server'] ?? []))];
  return [
   { id: 'server', label: 'Servers', type: 'list' },
   { id: 'dynamic', label: 'Dynamic Servers', type: 'static', value: () => dynamic.join(', ') || 'none' },
   { id: 'noresolv', label: 'Ignore Dynamic Servers', type: 'bool' },
   { id: 'remote', label: 'Allow Remote Requests', type: 'bool' },
   { id: 'cachesize', label: 'Cache Size', type: 'number', placeholder: '1000' },
   { id: 'domain', label: 'Local Domain', type: 'text', placeholder: 'lan' },
   { id: 'rebind_protection', label: 'Rebind Protection', type: 'bool' },
   { id: 'logqueries', label: 'Log Queries', type: 'bool' },
   ...ADVANCED.map(field => ({ ...field, tab: 'Advanced' }))
  ];
 },
 values(row, data) {
  const section = sections(data['uci:dhcp'], 'dnsmasq').find(item => item['.name'] === row.section) ?? {};
  return {
   server: list(section.server), noresolv: truthy(section.noresolv), remote: !truthy(section.localservice, true),
   cachesize: section.cachesize ?? '', domain: section.domain ?? '', rebind_protection: truthy(section.rebind_protection, true), logqueries: truthy(section.logqueries),
   ...Object.fromEntries(ADVANCED.map(field => [field.id, field.type === 'bool' ? truthy(section[field.id], field.on ?? false) : field.type === 'list' ? list(section[field.id]) : section[field.id] ?? '']))
  };
 },
 save(values, row, data, { dirty = null } = {}) {
  for (const server of values.server ?? []) if (!SERVER.test(server) || !(isIPv4(SERVER.exec(server)[2]) || canonicalIPv6(SERVER.exec(server)[2]))) invalid('server', `${server} is not a server address (use 192.0.2.53, 2001:db8::53, address#port or /domain/address)`);
  if (values.cachesize && !(/^\d+$/.test(values.cachesize) && Number(values.cachesize) <= 10000)) invalid('cachesize', 'Cache size is a number of entries up to 10000');
  if (values.domain && !DNS_NAME.test(values.domain)) invalid('domain', 'Enter a domain such as lan or home.arpa');
  for (const field of ADVANCED.filter(item => item.range)) {
   const value = values[field.id];
   if (value && !(/^\d+$/.test(value) && Number(value) >= field.range[0] && Number(value) <= field.range[1])) invalid(field.id, `${field.range[0]} to ${field.range[1]}`);
  }
  for (const domain of values.rebind_domain ?? []) if (!DNS_NAME.test(domain.replace(/^\/|\/$/g, ''))) invalid('rebind_domain', `${domain} is not a domain`);
  for (const file of values.addnhosts ?? []) if (!/^\/[\w./-]+$/.test(file)) invalid('addnhosts', `${file} is not an absolute path`);
  const options = compact({
   server: values.server ?? [], noresolv: values.noresolv ? '1' : '', localservice: values.remote ? '0' : '1', cachesize: values.cachesize,
   domain: values.domain, local: values.domain ? `/${values.domain}/` : '', rebind_protection: values.rebind_protection ? '1' : '0', logqueries: values.logqueries ? '1' : '',
   ...Object.fromEntries(ADVANCED.map(field => [field.id, field.type === 'bool' ? (values[field.id] ? '1' : '0') : values[field.id] ?? '']))
  });
  const fieldOf = { localservice: 'remote', local: 'domain' };
  const changes = Object.fromEntries(Object.entries(options).filter(([key]) => !dirty || dirty.has(fieldOf[key] ?? key)));
  return Object.keys(changes).length ? { description: 'Change DNS settings', ops: [{ op: 'set', config: 'dhcp', section: row.section, values: changes }] } : null;
 }
};

export const dnsStatic = {
 id: 'dns-static',
 noun: 'Static DNS Entry',
 sources: ['uci:dhcp'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'name', label: 'Name', width: 200 },
  { id: 'type', label: 'Type', width: 60 },
  { id: 'address', label: 'Address / Target', width: 220, sort: addressKey }
 ],
 flagLegend: {},
 defaultSort: 'name',
 rows(data) {
  const domains = sections(data['uci:dhcp'], 'domain').map(section => ({
   key: section['.name'], section: section['.name'], kind: 'domain', comment: section.comment, flags: '',
   cells: { name: section.name ?? '', type: String(section.ip ?? '').includes(':') ? 'AAAA' : 'A', address: section.ip ?? '' }
  }));
  const cnames = sections(data['uci:dhcp'], 'cname').map(section => ({
   key: section['.name'], section: section['.name'], kind: 'cname', comment: section.comment, flags: '',
   cells: { name: section.cname ?? '', type: 'CNAME', address: section.target ?? '' }
  }));
  return [...domains, ...cnames];
 },
 itemTitle: row => `DNS Static <${row?.cells.name ?? 'new'}>`,
 itemStatus: row => [row.cells.type],
 canAdd: () => true,
 canRemove: () => true,
 canComment: () => true,
 toggleHint: 'dnsmasq static entries cannot be disabled; remove the entry instead',
 fields: (data, row) => [
  { id: 'type', label: 'Type', type: row ? 'static' : 'select', options: ['A', 'AAAA', 'CNAME'].map(value => ({ value, label: value })) },
  { id: 'name', label: 'Name', type: 'text', required: true, placeholder: 'nas.lan' },
  { id: 'address', label: 'Address', type: 'text', required: true, visible: values => values.type !== 'CNAME', placeholder: '192.168.88.10' },
  { id: 'target', label: 'CNAME', type: 'text', required: true, visible: values => values.type === 'CNAME', placeholder: 'nas.lan' }
 ],
 values: row => ({ type: row.cells.type, name: row.cells.name, address: row.kind === 'domain' ? row.cells.address : '', target: row.kind === 'cname' ? row.cells.address : '' }),
 defaults: () => ({ type: 'A', name: '', address: '', target: '' }),
 save(values, row) {
  if (!DNS_NAME.test(values.name)) invalid('name', 'Enter a host name such as nas.lan');
  if (values.type === 'CNAME') {
   if (!DNS_NAME.test(values.target)) invalid('target', 'Enter the name this one points to');
   const options = { cname: values.name, target: values.target };
   return row ? { description: `Change CNAME ${values.name}`, ops: [{ op: 'set', config: 'dhcp', section: row.section, values: options }] } : { description: `Add CNAME ${values.name} to ${values.target}`, ops: [{ op: 'add', config: 'dhcp', type: 'cname', values: options }] };
  }
  const address = values.type === 'AAAA' ? canonicalIPv6(values.address) : isIPv4(values.address) ? values.address : null;
  if (!address) invalid('address', values.type === 'AAAA' ? 'Enter an IPv6 address' : 'Enter an IPv4 address');
  const options = { name: values.name, ip: address };
  return row ? { description: `Change DNS entry ${values.name}`, ops: [{ op: 'set', config: 'dhcp', section: row.section, values: options }] } : { description: `Add DNS entry ${values.name} ${address}`, ops: [{ op: 'add', config: 'dhcp', type: 'domain', values: options }] };
 },
 remove: rows => ({ description: `Remove DNS entry ${rows.map(row => row.cells.name).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'dhcp', section: row.section })) }),
 comment: (rows, comment) => ({ description: `Comment DNS entry ${rows.map(row => row.cells.name).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'dhcp', section: row.section, values: { comment: comment || null } })) })
};
