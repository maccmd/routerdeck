// SPDX-License-Identifier: Apache-2.0
// IPv6 > Addresses: static `ip6addr` entries, addresses a network assigned
// itself from a prefix (`ip6assign`, shown with the prefix as "From Pool"),
// addresses learned by DHCPv6/SLAAC and link-local addresses of devices.
import { sections, list, invalid, networkOptions } from './common.js';
import { parseCidr6, prefixFromMask6, addressKey } from '../lib/ip.js';

const scopeFlag = cidr => cidr?.linkLocal ? 'L' : 'G';

export default {
 id: 'addresses6',
 noun: 'IPv6 Address',
 sources: ['uci:network', 'uci:dhcp', 'ifaces', 'devices'],
 columns: [
  { id: 'flags', label: '', width: 34 },
  { id: 'address', label: 'Address', width: 230, sort: addressKey },
  { id: 'pool', label: 'From Pool', width: 190, sort: addressKey },
  { id: 'interface', label: 'Interface', width: 130 },
  { id: 'advertise', label: 'Advertise', width: 70 }
 ],
 flagLegend: { D: 'dynamic', G: 'global', L: 'link-local', I: 'invalid (not on the network)' },
 defaultSort: 'address',
 note: 'Pool addresses come from the network’s IPv6 assignment length (Interfaces ▸ Networks).',

 rows(data) {
  const runtime = new Map((data.ifaces ?? []).map(item => [item.interface, item]));
  const advertised = name => sections(data['uci:dhcp'], 'dhcp').some(server => server.interface === name && server.ra === 'server');
  const label = name => { const device = runtime.get(name)?.l3_device; return device ? `${name} (${device})` : name; };
  const rows = [], seen = new Set();
  for (const section of sections(data['uci:network'], 'interface')) {
   const name = section['.name'];
   if (section.proto !== 'static') continue;
   const live = runtime.get(name);
   const present = new Set((live?.['ipv6-address'] ?? []).map(item => parseCidr6(`${item.address}/${item.mask}`)?.cidr));
   list(section.ip6addr).forEach((entry, index) => {
    const cidr = parseCidr6(entry.includes('/') ? entry : `${entry}/128`);
    const valid = present.has(cidr?.cidr);
    if (cidr) seen.add(cidr.cidr);
    rows.push({
     key: `${name}#${index}`, iface: name, index, invalid: !valid,
     flags: (valid ? '' : 'I') + scopeFlag(cidr),
     cells: { address: cidr?.cidr ?? entry, pool: '', interface: label(name), advertise: '' }
    });
   });
  }
  for (const live of data.ifaces ?? []) {
   for (const assignment of live['ipv6-prefix-assignment'] ?? []) {
    const local = assignment['local-address'];
    if (!local) continue;
    const cidr = parseCidr6(`${local.address}/${local.mask}`);
    seen.add(cidr.cidr);
    rows.push({
     key: `pool:${live.interface}:${cidr.cidr}`, iface: live.interface, dynamic: true, readOnly: true, flags: 'D' + scopeFlag(cidr),
     cells: { address: cidr.cidr, pool: `${parseCidr6(assignment.address).address}/${assignment.mask}`, interface: label(live.interface), advertise: advertised(live.interface) ? 'yes' : 'no' }
    });
   }
   for (const address of live['ipv6-address'] ?? []) {
    const cidr = parseCidr6(`${address.address}/${address.mask}`);
    if (!cidr || seen.has(cidr.cidr)) continue;
    seen.add(cidr.cidr);
    rows.push({
     key: `dynamic:${live.interface}:${cidr.cidr}`, iface: live.interface, dynamic: true, readOnly: true, flags: 'D' + scopeFlag(cidr),
     cells: { address: cidr.cidr, pool: '', interface: label(live.interface), advertise: '' }
    });
   }
  }
  // Link-local addresses belong to devices, not to UCI networks.
  for (const device of Object.values(data.devices ?? {})) {
   for (const address of device.ip6addrs ?? []) {
    const cidr = parseCidr6(`${address.address}/${prefixFromMask6(address.netmask) ?? 64}`);
    if (!cidr?.linkLocal || seen.has(cidr.cidr + device.name)) continue;
    seen.add(cidr.cidr + device.name);
    rows.push({
     key: `link:${device.name}:${cidr.cidr}`, dynamic: true, readOnly: true, flags: 'DL',
     cells: { address: cidr.cidr, pool: '', interface: device.name, advertise: '' }
    });
   }
  }
  return rows;
 },

 itemTitle: row => `IPv6 Address <${row?.cells.address ?? 'new'}>`,
 itemStatus: row => [row.dynamic ? 'dynamic' : null, row.invalid ? 'invalid' : null, row.flags.includes('L') ? 'link-local' : 'global'],
 findCreated: (rows, values) => rows.find(row => row.iface === values.interface && row.cells.address === parseCidr6(values.address)?.cidr),
 canAdd: data => networkOptions(data['uci:network'], section => section.proto === 'static').length > 0,
 canRemove: row => !row.readOnly,
 toggleHint: 'OpenWrt cannot disable a single address',
 commentHint: 'OpenWrt cannot comment a single address',

 fields(data, row) {
  if (row?.readOnly) return [['address', 'Address'], ['pool', 'From Pool'], ['interface', 'Interface'], ['advertise', 'Advertise']].map(([id, label]) => ({ id, label, type: 'static' }));
  return [
   { id: 'address', label: 'Address', type: 'text', required: true, placeholder: 'fd00:88::1/64' },
   { id: 'network', label: 'Network', type: 'static', value: values => { const cidr = parseCidr6(values.address); return cidr ? `${cidr.network}/${cidr.prefix}` : ''; } },
   { id: 'interface', label: 'Interface', type: 'select', required: true, options: networkOptions(data['uci:network'], section => section.proto === 'static') }
  ];
 },
 values: row => row.readOnly ? { ...row.cells } : { address: row.cells.address, interface: row.iface },
 defaults: data => ({ address: '', interface: networkOptions(data['uci:network'], section => section.proto === 'static' && section['.name'] !== 'loopback')[0]?.value ?? '' }),

 save(values, row, data) {
  const cidr = parseCidr6(values.address, { requirePrefix: true });
  if (!cidr) invalid('address', 'Enter an IPv6 address with a prefix, for example fd00:88::1/64');
  if (cidr.address === cidr.network && cidr.prefix < 127) invalid('address', 'That is the network itself; add a host part such as ::1');
  const interfaces = sections(data['uci:network'], 'interface');
  const target = interfaces.find(section => section['.name'] === values.interface && section.proto === 'static');
  if (!target) invalid('interface', 'Choose a network with the static protocol');
  const lists = new Map();
  const current = name => {
   if (!lists.has(name)) lists.set(name, list(interfaces.find(section => section['.name'] === name).ip6addr));
   return lists.get(name);
  };
  if (row) current(row.iface).splice(row.index, 1, null);
  if (current(target['.name']).some(entry => entry && parseCidr6(entry.includes('/') ? entry : `${entry}/128`)?.address === cidr.address)) invalid('address', `${cidr.address} is already assigned to ${target['.name']}`);
  if (row && row.iface === target['.name']) current(target['.name'])[row.index] = cidr.cidr;
  else current(target['.name']).push(cidr.cidr);
  return {
   description: row ? `Change IPv6 address ${row.cells.address} to ${cidr.cidr} on ${target['.name']}` : `Add IPv6 address ${cidr.cidr} to ${target['.name']}`,
   ops: [...lists].map(([name, entries]) => ({ op: 'set', config: 'network', section: name, values: { ip6addr: entries.filter(Boolean) } }))
  };
 },

 remove(rows, data) {
  const byInterface = new Map();
  for (const row of rows.filter(row => !row.readOnly)) {
   if (!byInterface.has(row.iface)) byInterface.set(row.iface, list(sections(data['uci:network'], 'interface').find(section => section['.name'] === row.iface).ip6addr));
   byInterface.get(row.iface)[row.index] = null;
  }
  return {
   description: `Remove IPv6 address ${rows.map(row => row.cells.address).join(', ')}`,
   ops: [...byInterface].map(([name, entries]) => ({ op: 'set', config: 'network', section: name, values: { ip6addr: entries.filter(Boolean) } }))
  };
 }
};
