// SPDX-License-Identifier: Apache-2.0
// IP > DHCP Server: per-network `dhcp` sections and leases. Static leases are
// `host` sections; an active lease without one is dynamic and can be made
// static. A lease shows an address was handed out, not that a client is online.
import { sections, truthy, list, invalid, networkOptions, compact } from './common.js';
import { parseCidr, isIPv4, isMac, addressKey, formatIPv4, parseIPv4, parseIPv6 } from '../lib/ip.js';
import { uptime } from '../lib/format.js';

const LEASE_TIME = /^(\d+[smhdw]?|infinite)$/;
const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,62})$/;

function pool(data, section) {
 const network = sections(data['uci:network'], 'interface').find(item => item['.name'] === section.interface);
 const cidr = parseCidr(list(network?.ipaddr)[0] ?? '');
 if (!cidr) return '';
 const base = parseIPv4(cidr.network), start = Number(section.start ?? 100), limit = Number(section.limit ?? 150);
 return `${formatIPv4(base + start)}-${formatIPv4(base + start + limit - 1)}`;
}

export const servers = {
 id: 'dhcp-servers',
 noun: 'DHCP Server',
 sources: ['uci:dhcp', 'uci:network'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'name', label: 'Name', width: 90 },
  { id: 'interface', label: 'Interface', width: 90 },
  { id: 'pool', label: 'Address Pool', width: 200 },
  { id: 'start', label: 'Start', width: 50, align: 'right' },
  { id: 'limit', label: 'Limit', width: 50, align: 'right' },
  { id: 'leasetime', label: 'Lease Time', width: 76 }
 ],
 flagLegend: { X: 'disabled (ignore)' },
 defaultSort: null,
 rows(data) {
  return sections(data['uci:dhcp'], 'dhcp').map(section => {
   const disabled = truthy(section.ignore);
   return {
    key: section['.name'], section: section['.name'], disabled, comment: section.comment, flags: disabled ? 'X' : '',
    cells: { name: section['.name'], interface: section.interface ?? '', pool: disabled ? '' : pool(data, section), start: section.start ?? '100', limit: section.limit ?? '150', leasetime: section.leasetime ?? '12h' }
   };
  });
 },
 itemTitle: row => `DHCP Server <${row?.cells.name ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled'],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'interface', label: 'Interface', type: row ? 'static' : 'select', required: true, options: networkOptions(data['uci:network'], section => section['.name'] !== 'loopback') },
  { id: 'start', label: 'Start', type: 'number' },
  { id: 'limit', label: 'Limit', type: 'number' },
  { id: 'leasetime', label: 'Lease Time', type: 'text', placeholder: '12h' },
  { id: 'pool', label: 'Address Pool', type: 'static', value: values => pool(data, { interface: values.interface, start: values.start, limit: values.limit }) }
 ],
 values: row => ({ interface: row.cells.interface, start: row.cells.start, limit: row.cells.limit, leasetime: row.cells.leasetime }),
 defaults: data => ({ interface: networkOptions(data['uci:network'], section => section['.name'] !== 'loopback' && !sections(data['uci:dhcp'], 'dhcp').some(server => server.interface === section['.name']))[0]?.value ?? '', start: '100', limit: '150', leasetime: '12h' }),
 save(values, row, data) {
  if (!values.interface) invalid('interface', 'Choose a network');
  if (!/^\d+$/.test(values.start)) invalid('start', 'Start is a host number such as 100');
  if (!(/^\d+$/.test(values.limit) && Number(values.limit) > 0)) invalid('limit', 'Limit is the number of addresses');
  if (values.leasetime && !LEASE_TIME.test(values.leasetime)) invalid('leasetime', 'Use 12h, 30m, 2d or infinite');
  const options = compact({ interface: values.interface, start: values.start, limit: values.limit, leasetime: values.leasetime });
  if (row) return { description: `Change DHCP server ${row.cells.name}`, ops: [{ op: 'set', config: 'dhcp', section: row.section, values: options }] };
  if (sections(data['uci:dhcp'], 'dhcp').some(section => section['.name'] === values.interface)) invalid('interface', `A DHCP server for ${values.interface} already exists`);
  return { description: `Add DHCP server on ${values.interface}`, ops: [{ op: 'add', config: 'dhcp', type: 'dhcp', name: values.interface, values: options }] };
 },
 remove: rows => ({ description: `Remove DHCP server ${rows.map(row => row.cells.name).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'dhcp', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} DHCP server ${rows.map(row => row.cells.name).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'dhcp', section: row.section, values: { ignore: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment DHCP server ${rows.map(row => row.cells.name).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'dhcp', section: row.section, values: { comment: comment || null } })) })
};

const normalizeMac = mac => String(mac ?? '').toUpperCase();

export const leases = {
 id: 'dhcp-leases',
 noun: 'Lease',
 sources: ['leases', 'uci:dhcp'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'address', label: 'Address', width: 120, sort: addressKey },
  { id: 'mac', label: 'MAC Address', width: 130 },
  { id: 'clientId', label: 'Client ID', width: 120, hidden: true },
  { id: 'expires', label: 'Expires After', width: 96, sort: (value, row) => row.expires ?? -1 },
  { id: 'status', label: 'Status', width: 64 },
  { id: 'hostname', label: 'Host Name', width: 140 },
  { id: 'leasetime', label: 'Lease Time', width: 76, hidden: true }
 ],
 flagLegend: { X: 'disabled', D: 'dynamic' },
 defaultSort: 'address',
 note: 'A lease shows an address was handed out; it does not prove the client is online.',

 rows(data) {
  const active = (data.leases?.dhcp_leases ?? []).map(lease => ({ ...lease, used: false }));
  const rows = sections(data['uci:dhcp'], 'host').filter(host => host.ip || host.mac).map(host => {
   const macs = list(host.mac).map(normalizeMac);
   const lease = active.find(item => !item.used && (macs.includes(normalizeMac(item.macaddr)) || host.ip && item.ipaddr === host.ip));
   if (lease) lease.used = true;
   const disabled = !truthy(host.enable, true);
   return {
    key: host['.name'], section: host['.name'], disabled, comment: host.comment, expires: lease?.expires,
    flags: disabled ? 'X' : '',
    cells: { address: host.ip ?? '', mac: macs.join(' '), clientId: host.duid ?? '', expires: lease ? uptime(lease.expires) : '', status: lease ? 'bound' : 'waiting', hostname: host.name ?? '', leasetime: host.leasetime ?? '' }
   };
  });
  for (const lease of active.filter(item => !item.used)) {
   rows.push({
    key: `lease:${lease.macaddr ?? lease.duid}:${lease.ipaddr}`, dynamic: true, lease, expires: lease.expires, flags: 'D',
    cells: { address: lease.ipaddr, mac: normalizeMac(lease.macaddr), clientId: lease.duid ?? '', expires: uptime(lease.expires), status: 'bound', hostname: lease.hostname ?? '', leasetime: '' }
   });
  }
  return rows;
 },

 itemTitle: row => `DHCP Lease <${row?.cells.address ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : null, row.dynamic ? 'dynamic' : 'static', row.cells?.status],
 canAdd: () => true,
 canRemove: row => !row.dynamic,
 canToggle: row => !row.dynamic,
 canComment: row => !row.dynamic,
 tools: [{
  id: 'make-static', label: 'Make Static', enabled: rows => rows.length > 0 && rows.every(row => row.dynamic),
  run: (rows, data) => {
   const hosts = sections(data['uci:dhcp'], 'host');
   const ops = rows.map(row => {
    const name = HOSTNAME.test(row.lease.hostname ?? '') && !hosts.some(host => host.name === row.lease.hostname) ? row.lease.hostname : null;
    return { op: 'add', config: 'dhcp', type: 'host', values: compact({ name, mac: row.lease.macaddr?.toLowerCase(), ip: row.lease.ipaddr, dns: name ? '1' : '' }) };
   });
   return { description: `Make lease static ${rows.map(row => row.cells.address).join(', ')}`, ops };
  }
 }],

 fields: (data, row) => row?.dynamic
  ? ['address', 'mac', 'clientId', 'expires', 'status', 'hostname'].map(id => ({ id, label: leases.columns.find(column => column.id === id).label, type: 'static' }))
  : [
   { id: 'address', label: 'Address', type: 'text', required: true, placeholder: '192.168.88.10' },
   { id: 'mac', label: 'MAC Address', type: 'text', required: true, placeholder: '02:00:00:00:00:01' },
   { id: 'hostname', label: 'Host Name', type: 'text' },
   { id: 'leasetime', label: 'Lease Time', type: 'text', placeholder: 'server default' },
   { id: 'status', label: 'Status', type: 'static' },
   { id: 'expires', label: 'Expires After', type: 'static' }
  ],
 values: row => ({ ...row.cells, mac: row.cells.mac.toLowerCase() }),
 defaults: () => ({ address: '', mac: '', hostname: '', leasetime: '', status: '', expires: '' }),
 save(values, row, data) {
  if (!isIPv4(values.address)) invalid('address', 'Enter an IPv4 address');
  if (!isMac(values.mac)) invalid('mac', 'Enter a MAC address such as 02:00:00:00:00:01');
  if (values.hostname && !HOSTNAME.test(values.hostname)) invalid('hostname', 'Use letters, digits and dashes');
  if (values.leasetime && !LEASE_TIME.test(values.leasetime)) invalid('leasetime', 'Use 12h, 30m, 2d or infinite');
  const clash = sections(data['uci:dhcp'], 'host').find(host => host['.name'] !== row?.section && (host.ip === values.address || list(host.mac).map(normalizeMac).includes(normalizeMac(values.mac))));
  if (clash) invalid(clash.ip === values.address ? 'address' : 'mac', `Already reserved by ${clash.name || clash.ip}`);
  const options = compact({ ip: values.address, mac: values.mac.toLowerCase(), name: values.hostname, leasetime: values.leasetime, dns: values.hostname ? '1' : '' });
  return row
   ? { description: `Change static lease ${values.address}`, ops: [{ op: 'set', config: 'dhcp', section: row.section, values: options }] }
   : { description: `Add static lease ${values.address}`, ops: [{ op: 'add', config: 'dhcp', type: 'host', values: options }] };
 },
 remove: rows => ({ description: `Remove static lease ${rows.map(row => row.cells.address).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'dhcp', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} static lease ${rows.map(row => row.cells.address).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'dhcp', section: row.section, values: { enable: enable ? null : '0' } })) }),
 comment: (rows, comment) => ({ description: `Comment static lease ${rows.map(row => row.cells.address).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'dhcp', section: row.section, values: { comment: comment || null } })) })
};

// DHCPv6 bindings (odhcpd): active leases and `host` sections with a DUID.
// A static binding fixes the address suffix (`hostid`); the prefix comes
// from the network.
const hostidOf = address => {
 const value = parseIPv6(String(address ?? '').split('/')[0]);
 return value === null ? '' : (value & 0xffffffffffffffffn).toString(16);
};

export const bindings6 = {
 id: 'dhcp6-bindings',
 noun: 'DHCPv6 Binding',
 sources: ['leases', 'uci:dhcp'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'address', label: 'Address', width: 230, sort: addressKey },
  { id: 'duid', label: 'DUID', width: 220 },
  { id: 'iaid', label: 'IAID', width: 70, hidden: true },
  { id: 'expires', label: 'Expires After', width: 96, sort: (value, row) => row.expires ?? -1 },
  { id: 'status', label: 'Status', width: 64 },
  { id: 'hostname', label: 'Host Name', width: 140 }
 ],
 flagLegend: { X: 'disabled', D: 'dynamic' },
 defaultSort: 'address',
 rows(data) {
  const active = (data.leases?.dhcp6_leases ?? []).map(lease => ({ ...lease, used: false }));
  const rows = sections(data['uci:dhcp'], 'host').filter(host => host.duid).map(host => {
   const lease = active.find(item => !item.used && String(item.duid).toLowerCase() === String(host.duid).toLowerCase());
   if (lease) lease.used = true;
   const disabled = !truthy(host.enable, true);
   return {
    key: host['.name'], section: host['.name'], disabled, comment: host.comment, expires: lease?.expires, flags: disabled ? 'X' : '',
    cells: { address: lease ? (lease.ip6addrs ?? [lease.ip6addr]).join(' ') : host.hostid ? `::${host.hostid}` : '', duid: host.duid, iaid: lease?.iaid != null ? String(lease.iaid) : '', expires: lease ? uptime(lease.expires) : '', status: lease ? 'bound' : 'waiting', hostname: host.name ?? '' }
   };
  });
  for (const lease of active.filter(item => !item.used)) {
   rows.push({
    key: `lease6:${lease.duid}:${lease.iaid}`, dynamic: true, lease, expires: lease.expires, flags: 'D',
    cells: { address: (lease.ip6addrs ?? [lease.ip6addr]).filter(Boolean).join(' '), duid: lease.duid ?? '', iaid: lease.iaid != null ? String(lease.iaid) : '', expires: uptime(lease.expires), status: 'bound', hostname: lease.hostname ?? '' }
   });
  }
  return rows;
 },
 itemTitle: row => `DHCPv6 Binding <${row?.cells.hostname || row?.cells.duid || 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : null, row.dynamic ? 'dynamic' : 'static', row.cells?.status],
 canAdd: () => true,
 canRemove: row => !row.dynamic,
 canToggle: row => !row.dynamic,
 canComment: row => !row.dynamic,
 tools: [{
  id: 'make-static6', label: 'Make Static', enabled: rows => rows.length > 0 && rows.every(row => row.dynamic && row.lease?.duid),
  run: rows => ({
   description: `Make DHCPv6 binding static ${rows.map(row => row.cells.hostname || row.cells.duid).join(', ')}`,
   ops: rows.map(row => ({ op: 'add', config: 'dhcp', type: 'host', values: compact({ name: HOSTNAME.test(row.lease.hostname ?? '') ? row.lease.hostname : '', duid: row.lease.duid, hostid: hostidOf(row.lease.ip6addrs?.[0] ?? row.lease.ip6addr) }) }))
  })
 }],
 fields: (data, row) => row?.dynamic
  ? ['address', 'duid', 'iaid', 'expires', 'status', 'hostname'].map(id => ({ id, label: bindings6.columns.find(column => column.id === id).label, type: 'static' }))
  : [
   { id: 'duid', label: 'DUID', type: 'text', required: true, placeholder: '000100012a3b4c5d525400aa1002' },
   { id: 'hostid', label: 'Address Suffix', type: 'text', placeholder: 'hex, e.g. 10' },
   { id: 'hostname', label: 'Host Name', type: 'text' },
   { id: 'leasetime', label: 'Lease Time', type: 'text', placeholder: 'server default' },
   { id: 'status', label: 'Status', type: 'static' }
  ],
 values(row, data) {
  if (row.dynamic) return { ...row.cells };
  const host = sections(data['uci:dhcp'], 'host').find(item => item['.name'] === row.section) ?? {};
  return { duid: host.duid ?? '', hostid: host.hostid ?? '', hostname: host.name ?? '', leasetime: host.leasetime ?? '', status: row.cells.status };
 },
 defaults: () => ({ duid: '', hostid: '', hostname: '', leasetime: '', status: '' }),
 save(values, row, data) {
  if (!/^[0-9a-f]{4,260}$/i.test(values.duid)) invalid('duid', 'A DUID is hexadecimal, for example 000100012a3b4c5d525400aa1002');
  if (values.hostid && !/^[0-9a-f]{1,16}$/i.test(values.hostid)) invalid('hostid', 'The suffix is up to 16 hexadecimal digits');
  if (values.hostname && !HOSTNAME.test(values.hostname)) invalid('hostname', 'Use letters, digits and dashes');
  if (values.leasetime && !LEASE_TIME.test(values.leasetime)) invalid('leasetime', 'Use 12h, 30m, 2d or infinite');
  const clash = sections(data['uci:dhcp'], 'host').find(host => host['.name'] !== row?.section && String(host.duid ?? '').toLowerCase() === values.duid.toLowerCase());
  if (clash) invalid('duid', `Already reserved by ${clash.name || clash['.name']}`);
  const options = compact({ duid: values.duid.toLowerCase(), hostid: values.hostid.toLowerCase(), name: values.hostname, leasetime: values.leasetime });
  return row
   ? { description: `Change DHCPv6 binding ${values.hostname || values.duid}`, ops: [{ op: 'set', config: 'dhcp', section: row.section, values: options }] }
   : { description: `Add DHCPv6 binding ${values.hostname || values.duid}`, ops: [{ op: 'add', config: 'dhcp', type: 'host', values: options }] };
 },
 remove: rows => ({ description: `Remove DHCPv6 binding ${rows.map(row => row.cells.hostname || row.cells.duid).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'dhcp', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} DHCPv6 binding ${rows.map(row => row.cells.hostname || row.cells.duid).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'dhcp', section: row.section, values: { enable: enable ? null : '0' } })) }),
 comment: (rows, comment) => ({ description: `Comment DHCPv6 binding ${rows.map(row => row.cells.hostname || row.cells.duid).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'dhcp', section: row.section, values: { comment: comment || null } })) })
};

/* --- DHCP networks and options ----------------------------------------- */

// dnsmasq option codes RouterOS shows as network settings, numeric or named.
const KNOWN = { 3: 'router', 6: 'dns-server', 15: 'domain-name', 42: 'ntp-server', 119: 'domain-search', 121: 'classless-static-route' };
const codeOf = name => {
 const plain = String(name).replace(/^option6?:/, '');
 return Object.keys(KNOWN).find(code => KNOWN[code] === plain) ?? plain;
};

// "6,192.0.2.1,192.0.2.2" → { code: '6', value: '192.0.2.1,192.0.2.2' }.
// Entries with a tag or other dnsmasq syntax keep the code they start with.
export function splitOption(entry) {
 const textValue = String(entry ?? '');
 if (/^tag:/.test(textValue)) return { code: textValue.split(',')[0], value: textValue.split(',').slice(1).join(','), tagged: true };
 const comma = textValue.indexOf(',');
 return comma < 0 ? { code: codeOf(textValue), value: '' } : { code: codeOf(textValue.slice(0, comma)), value: textValue.slice(comma + 1) };
}

// dnsmasq hands out DHCPv4 unless odhcpd is made the main DHCP server.
const odhcpdServes = data => truthy(sections(data['uci:dhcp'], 'odhcpd')[0]?.maindhcp);

function routerAddress(data, section) {
 const network = sections(data['uci:network'], 'interface').find(item => item['.name'] === section.interface);
 return parseCidr(list(network?.ipaddr)[0] ?? '');
}

export const dhcpNetworks = {
 id: 'dhcp-networks',
 noun: 'DHCP Network',
 sources: ['uci:dhcp', 'uci:network'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'address', label: 'Address', width: 130, sort: addressKey },
  { id: 'interface', label: 'Interface', width: 80 },
  { id: 'gateway', label: 'Gateway', width: 120 },
  { id: 'dns', label: 'DNS Servers', width: 170 },
  { id: 'domain', label: 'Domain', width: 90 },
  { id: 'ntp', label: 'NTP Servers', width: 130 }
 ],
 flagLegend: { X: 'server disabled (ignore)' },
 defaultSort: null,
 note: 'Empty values hand out this router: dnsmasq answers DNS itself and announces itself as the gateway.',
 status: data => odhcpdServes(data) ? 'odhcpd serves DHCPv4 here (maindhcp), and it ignores these dnsmasq options' : '',
 rows(data) {
  const domain = sections(data['uci:dhcp'], 'dnsmasq')[0]?.domain ?? '';
  return sections(data['uci:dhcp'], 'dhcp').map(section => {
   const cidr = routerAddress(data, section);
   const options = list(section.dhcp_option).map(splitOption);
   const value = code => options.find(option => option.code === code && !option.tagged)?.value ?? '';
   const router = cidr?.address ?? 'router';
   return {
    key: section['.name'], section: section['.name'], disabled: truthy(section.ignore), flags: truthy(section.ignore) ? 'X' : '', options,
    cells: { address: cidr ? `${cidr.network}/${cidr.prefix}` : '', interface: section.interface ?? '', gateway: value('3') || router, dns: value('6') || router, domain: value('15') || domain, ntp: value('42') }
   };
  });
 },
 itemTitle: row => `DHCP Network <${row?.cells.address || row?.key}>`,
 itemStatus: row => [row.disabled ? 'server disabled' : 'server enabled'],
 fields: () => [
  { id: 'address', label: 'Address', type: 'static' },
  { id: 'gateway', label: 'Gateway', type: 'text', placeholder: 'this router' },
  { id: 'dns', label: 'DNS Servers', type: 'list' },
  { id: 'domain', label: 'Domain', type: 'text', placeholder: 'the local domain' },
  { id: 'ntp', label: 'NTP Servers', type: 'list' }
 ],
 values(row) {
  const value = code => row.options.find(option => option.code === code && !option.tagged)?.value ?? '';
  return { address: row.cells.address, gateway: value('3'), dns: value('6').split(',').filter(Boolean), domain: value('15'), ntp: value('42').split(',').filter(Boolean) };
 },
 save(values, row, data, { dirty = null } = {}) {
  const ip = address => isIPv4(address);
  if (values.gateway && !ip(values.gateway)) invalid('gateway', 'Enter an IPv4 address');
  for (const server of values.dns ?? []) if (!ip(server)) invalid('dns', `${server} is not an IPv4 address`);
  for (const server of values.ntp ?? []) if (!ip(server)) invalid('ntp', `${server} is not an IPv4 address`);
  if (values.domain && !/^[A-Za-z0-9.-]+$/.test(values.domain)) invalid('domain', 'Enter a domain such as home.arpa');
  const wanted = { 3: values.gateway, 6: (values.dns ?? []).join(','), 15: values.domain, 42: (values.ntp ?? []).join(',') };
  const field = { 3: 'gateway', 6: 'dns', 15: 'domain', 42: 'ntp' };
  const touched = Object.keys(wanted).filter(code => !dirty || dirty.has(field[code]));
  if (!touched.length) return null;
  const section = sections(data['uci:dhcp'], 'dhcp').find(item => item['.name'] === row.section);
  const kept = list(section.dhcp_option).filter(entry => { const option = splitOption(entry); return option.tagged || !touched.includes(option.code); });
  const added = touched.filter(code => wanted[code]).map(code => `${code},${wanted[code]}`);
  return { description: `Change DHCP network ${row.cells.address || row.key}`, ops: [{ op: 'set', config: 'dhcp', section: row.section, values: { dhcp_option: [...kept, ...added] } }] };
 }
};

export const dhcpOptions = {
 id: 'dhcp-options',
 noun: 'DHCP Option',
 sources: ['uci:dhcp'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'server', label: 'Server', width: 90 },
  { id: 'code', label: 'Code', width: 60, align: 'right', sort: value => Number(value) || 0 },
  { id: 'name', label: 'Name', width: 150 },
  { id: 'value', label: 'Value', width: 260 }
 ],
 flagLegend: { F: 'sent even when the client does not ask' },
 defaultSort: null,
 status: data => odhcpdServes(data) ? 'odhcpd serves DHCPv4 here (maindhcp), and it ignores these dnsmasq options' : '',
 rows(data) {
  const rows = [];
  for (const section of sections(data['uci:dhcp'], 'dhcp')) {
   for (const [option, force] of [['dhcp_option', false], ['dhcp_option_force', true]]) {
    list(section[option]).forEach((entry, index) => {
     const parsed = splitOption(entry);
     rows.push({ key: `${section['.name']}:${option}:${index}`, section: section['.name'], option, index, force, flags: force ? 'F' : '',
      cells: { server: section.interface ?? section['.name'], code: parsed.code, name: KNOWN[parsed.code] ?? '', value: parsed.value } });
    });
   }
  }
  return rows;
 },
 itemTitle: row => `DHCP Option <${row ? `${row.cells.server} ${row.cells.code}` : 'new'}>`,
 itemStatus: row => [row.force ? 'forced' : 'on request'],
 canAdd: data => sections(data['uci:dhcp'], 'dhcp').length > 0,
 canRemove: () => true,
 fields: data => [
  { id: 'server', label: 'Server', type: 'select', options: sections(data['uci:dhcp'], 'dhcp').map(section => ({ value: section['.name'], label: section.interface ?? section['.name'] })) },
  { id: 'code', label: 'Code', type: 'combo', options: Object.entries(KNOWN).map(([value, label]) => ({ value, label: `${value} ${label}` })) },
  { id: 'value', label: 'Value', type: 'text', placeholder: '192.0.2.1,192.0.2.2' },
  { id: 'force', label: 'Force', type: 'bool' }
 ],
 values: row => ({ server: row.section, code: row.cells.code, value: row.cells.value, force: row.force }),
 defaults: data => ({ server: sections(data['uci:dhcp'], 'dhcp')[0]?.['.name'] ?? '', code: '', value: '', force: false }),
 save(values, row, data) {
  const code = String(values.code ?? '').trim();
  if (!/^\d{1,3}$/.test(code) || Number(code) < 1 || Number(code) > 254) invalid('code', 'An option code is 1 to 254');
  if (/[\n]/.test(values.value)) invalid('value', 'A value is one line');
  const entry = values.value === '' ? code : `${code},${values.value.trim()}`;
  const target = values.force ? 'dhcp_option_force' : 'dhcp_option';
  const lists = new Map();
  const of = (section, option) => {
   const key = `${section}:${option}`;
   if (!lists.has(key)) lists.set(key, { section, option, entries: list(sections(data['uci:dhcp'], 'dhcp').find(item => item['.name'] === section)?.[option]) });
   return lists.get(key).entries;
  };
  if (row) of(row.section, row.option)[row.index] = null;
  of(values.server, target).push(entry);
  return {
   description: row ? `Change DHCP option ${code}` : `Add DHCP option ${code}`,
   ops: [...lists.values()].map(item => ({ op: 'set', config: 'dhcp', section: item.section, values: { [item.option]: item.entries.filter(value => value !== null) } }))
  };
 },
 remove(rows, data) {
  const lists = new Map();
  for (const row of rows) {
   const key = `${row.section}:${row.option}`;
   if (!lists.has(key)) lists.set(key, { section: row.section, option: row.option, entries: list(sections(data['uci:dhcp'], 'dhcp').find(item => item['.name'] === row.section)?.[row.option]) });
   lists.get(key).entries[row.index] = null;
  }
  return { description: `Remove DHCP option ${rows.map(row => row.cells.code).join(', ')}`, ops: [...lists.values()].map(item => ({ op: 'set', config: 'dhcp', section: item.section, values: { [item.option]: item.entries.filter(value => value !== null) } })) };
 }
};
