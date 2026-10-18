// SPDX-License-Identifier: Apache-2.0
// IP > DHCP Server: per-network `dhcp` sections and leases. Static leases are
// `host` sections; an active lease without one is dynamic and can be made
// static. A lease shows an address was handed out, not that a client is online.
import { sections, truthy, list, invalid, networkOptions, compact } from './common.js';
import { parseCidr, isIPv4, isMac, addressKey, formatIPv4, parseIPv4 } from '../lib/ip.js';
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
  const rows = sections(data['uci:dhcp'], 'host').map(host => {
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
