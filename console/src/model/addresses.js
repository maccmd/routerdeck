// SPDX-License-Identifier: Apache-2.0
// IP > Addresses: every address of statically configured networks, plus
// addresses a network obtained dynamically (DHCP, PPP), shown read-only.
import { sections, list, invalid, networkOptions } from './common.js';
import { parseCidr, maskToPrefix, addressKey } from '../lib/ip.js';

function staticAddresses(section) {
 const prefix = section.netmask ? maskToPrefix(section.netmask) : null;
 return list(section.ipaddr).map(entry => entry.includes('/') || prefix === null ? entry : `${entry}/${prefix}`);
}

function deviceOf(data, name) {
 return data.ifaces?.find(item => item.interface === name)?.l3_device ?? sections(data['uci:network'], 'interface').find(item => item['.name'] === name)?.device;
}

const label = (data, name) => {
 const device = deviceOf(data, name);
 return device ? `${name} (${device})` : name;
};

export default {
 id: 'addresses',
 noun: 'Address',
 sources: ['uci:network', 'ifaces'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'address', label: 'Address', width: 150, sort: addressKey },
  { id: 'network', label: 'Network', width: 120, sort: addressKey },
  { id: 'interface', label: 'Interface', width: 150 }
 ],
 flagLegend: { D: 'dynamic', I: 'invalid (network is down)' },
 defaultSort: 'address',

 rows(data) {
  const runtime = new Map((data.ifaces ?? []).map(item => [item.interface, item]));
  const rows = [];
  for (const section of sections(data['uci:network'], 'interface')) {
   const name = section['.name'];
   if (section.proto !== 'static') continue;
   const live = runtime.get(name);
   staticAddresses(section).forEach((entry, index) => {
    const cidr = parseCidr(entry);
    const present = live?.['ipv4-address']?.some(item => `${item.address}/${item.mask}` === cidr?.cidr);
    rows.push({
     key: `${name}#${index}`, iface: name, index,
     flags: present ? '' : 'I', invalid: !present,
     cells: { address: cidr?.cidr ?? entry, network: cidr?.network ?? '', interface: label(data, name) }
    });
   });
  }
  for (const item of data.ifaces ?? []) {
   if (item.proto === 'static') continue;
   for (const address of item['ipv4-address'] ?? []) {
    const cidr = parseCidr(`${address.address}/${address.mask}`);
    rows.push({
     key: `dynamic:${item.interface}:${cidr.cidr}`, iface: item.interface, dynamic: true, readOnly: true, flags: 'D',
     cells: { address: cidr.cidr, network: cidr.network, interface: label(data, item.interface) }
    });
   }
  }
  return rows;
 },

 itemTitle: row => `Address <${row?.cells.address ?? 'new'}>`,
 findCreated: (rows, values) => rows.find(row => row.iface === values.interface && row.cells.address === parseCidr(values.address)?.cidr),
 itemStatus: row => [row.dynamic ? 'dynamic' : null, row.invalid ? 'invalid' : null],
 canAdd: data => networkOptions(data['uci:network'], section => section.proto === 'static').length > 0,
 canRemove: row => !row.readOnly,
 toggleHint: 'OpenWrt cannot disable a single address',
 commentHint: 'OpenWrt cannot comment a single address',

 fields(data) {
  return [
   { id: 'address', label: 'Address', type: 'text', required: true, placeholder: '192.168.88.1/24' },
   { id: 'network', label: 'Network', type: 'static', value: values => parseCidr(values.address)?.network ?? '' },
   { id: 'interface', label: 'Interface', type: 'select', required: true,
     options: networkOptions(data['uci:network'], section => section.proto === 'static').map(option => ({ ...option, label: label(data, option.value) })) }
  ];
 },
 values: row => ({ address: row.cells.address, interface: row.iface }),
 defaults: data => ({ address: '', interface: networkOptions(data['uci:network'], section => section.proto === 'static' && section['.name'] !== 'loopback')[0]?.value ?? '' }),

 save(values, row, data) {
  const cidr = parseCidr(values.address, { requirePrefix: true });
  if (!cidr) invalid('address', 'Enter an IPv4 address with a prefix, for example 192.168.88.1/24');
  if (cidr.prefix === 0) invalid('address', 'Prefix /0 is not an interface address');
  const target = sections(data['uci:network'], 'interface').find(section => section['.name'] === values.interface && section.proto === 'static');
  if (!target) invalid('interface', 'Choose a network with the static protocol');
  const lists = new Map();
  const current = name => {
   if (!lists.has(name)) lists.set(name, staticAddresses(sections(data['uci:network'], 'interface').find(section => section['.name'] === name)));
   return lists.get(name);
  };
  if (row) current(row.iface).splice(row.index, 1, null);
  if (current(target['.name']).some(entry => entry && parseCidr(entry)?.address === cidr.address)) invalid('address', `${cidr.address} is already assigned to ${target['.name']}`);
  if (row && row.iface === target['.name']) current(target['.name'])[row.index] = cidr.cidr;
  else current(target['.name']).push(cidr.cidr);
  return {
   description: row ? `Change address ${row.cells.address} to ${cidr.cidr} on ${target['.name']}` : `Add address ${cidr.cidr} to ${target['.name']}`,
   ops: [...lists].map(([name, entries]) => ({ op: 'set', config: 'network', section: name, values: { ipaddr: entries.filter(Boolean), netmask: null } }))
  };
 },

 remove(rows, data) {
  const byInterface = new Map();
  for (const row of rows.filter(row => !row.readOnly)) {
   if (!byInterface.has(row.iface)) byInterface.set(row.iface, staticAddresses(sections(data['uci:network'], 'interface').find(section => section['.name'] === row.iface)));
   byInterface.get(row.iface)[row.index] = null;
  }
  return {
   description: `Remove address ${rows.map(row => row.cells.address).join(', ')}`,
   ops: [...byInterface].map(([name, entries]) => ({ op: 'set', config: 'network', section: name, values: { ipaddr: entries.filter(Boolean), netmask: null } }))
  };
 }
};
