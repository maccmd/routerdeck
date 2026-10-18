// SPDX-License-Identifier: Apache-2.0
// Interfaces > Networks: OpenWrt logical interfaces (`network.interface`).
// RouterOS has no direct equivalent, but protocol, device and firewall zone
// live here in OpenWrt; addresses are edited in IP > Addresses.
import { sections, truthy, list, invalid, NAME, zonesOf, zoneOptions, compact } from './common.js';
import { isIPv4 } from '../lib/ip.js';
import { uptime } from '../lib/format.js';

const PROTOCOLS = ['static', 'dhcp', 'dhcpv6', 'pppoe', 'none'];

function deviceOptions(data, current) {
 const names = new Set([...Object.keys(data.devices ?? {}), ...sections(data['uci:network'], 'device').map(section => section.name).filter(Boolean)]);
 if (current) names.add(current);
 return [...names].sort().map(value => ({ value, label: value }));
}

export default {
 id: 'networks',
 noun: 'Network',
 sources: ['uci:network', 'uci:firewall', 'uci:dhcp', 'ifaces', 'devices'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'protocol', label: 'Protocol', width: 80 },
  { id: 'device', label: 'Device', width: 100 },
  { id: 'uptime', label: 'Uptime', width: 100, sort: (value, row) => row.uptime ?? -1 },
  { id: 'zone', label: 'Firewall Zone', width: 100 }
 ],
 flagLegend: { X: 'disabled', R: 'running', D: 'dynamic' },
 defaultSort: null,

 rows(data) {
  const runtime = new Map((data.ifaces ?? []).map(item => [item.interface, item]));
  const rows = sections(data['uci:network'], 'interface').map(section => {
   const name = section['.name'], live = runtime.get(name);
   const disabled = truthy(section.disabled);
   return {
    key: name, section: name, disabled, comment: section.comment, uptime: live?.up ? live.uptime : null,
    flags: (disabled ? 'X' : '') + (live?.up ? 'R' : ''),
    cells: { name, protocol: section.proto ?? 'none', device: live?.l3_device ?? section.device ?? '', uptime: live?.up ? uptime(live.uptime) : '', zone: zonesOf(data['uci:firewall'], name).join(', ') }
   };
  });
  for (const live of data.ifaces ?? []) {
   if (runtime.has(live.interface) && rows.some(row => row.key === live.interface)) continue;
   rows.push({
    key: `dynamic:${live.interface}`, dynamic: true, readOnly: true, uptime: live.up ? live.uptime : null,
    flags: 'D' + (live.up ? 'R' : ''),
    cells: { name: live.interface, protocol: live.proto, device: live.l3_device ?? live.device ?? '', uptime: live.up ? uptime(live.uptime) : '', zone: zonesOf(data['uci:firewall'], live.interface).join(', ') }
   });
  }
  return rows;
 },

 itemTitle: row => `Network <${row?.cells.name ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled', row.flags.includes('R') ? 'running' : 'not running', row.dynamic ? 'dynamic' : null],
 canAdd: () => true,
 canRemove: row => !row.readOnly && row.key !== 'loopback',
 canToggle: row => !row.readOnly && row.key !== 'loopback',
 canComment: row => !row.readOnly,

 fields(data, row) {
  const section = row && sections(data['uci:network'], 'interface').find(item => item['.name'] === row.section);
  const protocol = values => values.proto;
  return [
   { id: 'name', label: 'Name', type: row ? 'static' : 'text', required: true, placeholder: 'guest' },
   { id: 'proto', label: 'Protocol', type: 'select', options: [...new Set([...PROTOCOLS, section?.proto].filter(Boolean))].map(value => ({ value, label: value })) },
   { id: 'device', label: 'Device', type: 'select', allowEmpty: true, options: deviceOptions(data, section?.device) },
   { id: 'auto', label: 'Bring up on boot', type: 'bool' },
   { id: 'zone', label: 'Firewall Zone', type: 'select', allowEmpty: true, options: zoneOptions(data['uci:firewall']) },
   { id: 'gateway', label: 'Gateway', type: 'text', visible: values => protocol(values) === 'static', placeholder: 'none' },
   { id: 'ip6assign', label: 'IPv6 Assignment Length', type: 'number', visible: values => protocol(values) === 'static', placeholder: 'disabled' },
   { id: 'dns', label: 'DNS Servers', type: 'list', visible: values => ['static', 'dhcp', 'pppoe'].includes(protocol(values)) },
   { id: 'hostname', label: 'Hostname to Send', type: 'text', visible: values => protocol(values) === 'dhcp' },
   { id: 'peerdns', label: 'Use Peer DNS', type: 'bool', visible: values => ['dhcp', 'dhcpv6', 'pppoe'].includes(protocol(values)) },
   { id: 'username', label: 'PPPoE User', type: 'text', visible: values => protocol(values) === 'pppoe' },
   { id: 'password', label: 'PPPoE Password', type: 'password', visible: values => protocol(values) === 'pppoe' }
  ];
 },
 values(row, data) {
  const section = sections(data['uci:network'], 'interface').find(item => item['.name'] === row.section) ?? {};
  return {
   name: row.cells.name, proto: section.proto ?? 'none', device: section.device ?? '', auto: truthy(section.auto, true),
   zone: zonesOf(data['uci:firewall'], row.cells.name)[0] ?? '', gateway: section.gateway ?? '', ip6assign: section.ip6assign ?? '', dns: list(section.dns),
   hostname: section.hostname ?? '', peerdns: truthy(section.peerdns, true), username: section.username ?? '', password: section.password ?? ''
  };
 },
 defaults: () => ({ name: '', proto: 'static', device: '', auto: true, zone: '', gateway: '', ip6assign: '', dns: [], hostname: '', peerdns: true, username: '', password: '' }),

 // For an existing network only the fields edited in the window are written,
 // so untouched options keep their exact form in /etc/config/network.
 save(values, row, data, { dirty = null } = {}) {
  const name = row ? row.section : values.name.trim();
  if (!row) {
   if (!NAME.test(name)) invalid('name', 'Use letters, digits and underscores');
   if (sections(data['uci:network'], 'interface').some(section => section['.name'] === name)) invalid('name', `${name} already exists`);
  }
  if (values.gateway && !isIPv4(values.gateway)) invalid('gateway', 'Enter an IPv4 gateway address');
  if (values.ip6assign && !(/^\d+$/.test(values.ip6assign) && values.ip6assign >= 48 && values.ip6assign <= 64)) invalid('ip6assign', 'Use a prefix length from 48 to 64, or leave it empty');
  for (const server of values.dns ?? []) if (!isIPv4(server) && !server.includes(':')) invalid('dns', `${server} is not an IP address`);
  const options = compact({
   proto: values.proto, device: values.device, auto: values.auto ? '' : '0',
   gateway: values.proto === 'static' ? values.gateway : '', ip6assign: values.proto === 'static' ? values.ip6assign : '', dns: values.dns ?? [],
   hostname: values.proto === 'dhcp' ? values.hostname : '', peerdns: ['dhcp', 'dhcpv6', 'pppoe'].includes(values.proto) && !values.peerdns ? '0' : '',
   username: values.proto === 'pppoe' ? values.username : '', password: values.proto === 'pppoe' ? values.password : ''
  });
  const ops = [];
  if (row) {
   const changes = Object.fromEntries(Object.entries(options).filter(([key]) => !dirty || dirty.has(key) || dirty.has('proto')));
   if (Object.keys(changes).length) ops.push({ op: 'set', config: 'network', section: name, values: changes });
  } else ops.push({ op: 'add', config: 'network', type: 'interface', name, values: options });
  if (!row || !dirty || dirty.has('zone')) ops.push(...zoneMembership(data, name, values.zone));
  if (!ops.length) return null;
  return { description: row ? `Change network ${name}` : `Add network ${name} (${values.proto})`, ops };
 },
 remove(rows, data) {
  const ops = [];
  for (const row of rows) {
   ops.push({ op: 'delete', config: 'network', section: row.section });
   ops.push(...zoneMembership(data, row.section, ''));
   for (const server of sections(data['uci:dhcp'], 'dhcp').filter(section => section.interface === row.section)) ops.push({ op: 'delete', config: 'dhcp', section: server['.name'] });
  }
  return { description: `Remove network ${rows.map(row => row.section).join(', ')}`, ops };
 },
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} network ${rows.map(row => row.section).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment network ${rows.map(row => row.section).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) })
};

// Move a network to exactly one zone (or none), touching only zones that change.
export function zoneMembership(data, network, zone) {
 const ops = [];
 for (const section of sections(data['uci:firewall'], 'zone')) {
  const members = list(section.network);
  const has = members.includes(network), wants = section.name === zone;
  if (has === wants) continue;
  ops.push({ op: 'set', config: 'firewall', section: section['.name'], values: { network: wants ? [...members, network] : members.filter(item => item !== network) } });
 }
 return ops;
}

