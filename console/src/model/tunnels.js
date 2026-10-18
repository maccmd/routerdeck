// SPDX-License-Identifier: Apache-2.0
// Interfaces ▸ Tunnels and Bonding: `interface` sections with the gre,
// gretap (EoIP), ipip and vxlan protocols, or bonding. A tunnel's own
// address lives on a companion static network on top of it ("@name"), the
// way OpenWrt sets tunnel addresses.
import { sections, list, truthy, invalid, NAME, zonesOf, zoneOptions, networkOptions, compact } from './common.js';
import { zoneMembership } from './networks.js';
import { parseCidr, parseCidr6, isIPv4, canonicalIPv6, formatIPv4, parseIPv4 } from '../lib/ip.js';

// Kernel device names netifd gives each protocol, so names must stay short.
export const TUNNELS = {
 gre: { label: 'GRE', family: 4, device: name => `gre4-${name}`, key: true },
 gretap: { label: 'EoIP (GRE TAP)', family: 4, device: name => `gre4t-${name}`, key: true, bridge: true },
 grev6: { label: 'GRE over IPv6', family: 6, device: name => `gre6-${name}`, key: true },
 grev6tap: { label: 'EoIP over IPv6', family: 6, device: name => `gre6t-${name}`, key: true, bridge: true },
 ipip: { label: 'IPIP', family: 4, device: name => `ipip-${name}` },
 vxlan: { label: 'VXLAN', family: 4, device: name => name, vni: true, bridge: true },
 vxlan6: { label: 'VXLAN over IPv6', family: 6, device: name => name, vni: true, bridge: true }
};

const companion = (data, name) => sections(data['uci:network'], 'interface').find(section => section.proto === 'static' && section.device === `@${name}`);
const live = (data, name) => (data.ifaces ?? []).find(item => item.interface === name);
const addressOf = section => section ? list(section.ipaddr)[0] ?? list(section.ip6addr)[0] ?? '' : '';

function networkName(data, name, values, ops) {
 // The address goes to <name>_addr, made or removed with it.
 const existing = companion(data, name);
 const address = String(values.address ?? '').trim();
 if (address) {
  const v6 = !!parseCidr6(address, { requirePrefix: true }) && !parseCidr(address, { requirePrefix: true });
  const option = v6 ? { ip6addr: [address], ipaddr: null } : { ipaddr: [address], ip6addr: null };
  if (existing) ops.push({ op: 'set', config: 'network', section: existing['.name'], values: option });
  else ops.push({ op: 'add', config: 'network', type: 'interface', name: `${name}_addr`, values: { proto: 'static', device: `@${name}`, ...(v6 ? { ip6addr: [address] } : { ipaddr: [address] }) } });
  return existing?.['.name'] ?? `${name}_addr`;
 }
 if (existing) ops.push({ op: 'delete', config: 'network', section: existing['.name'] });
 return name;
}

function checkAddress(values, id, family, { optional = true } = {}) {
 const value = String(values[id] ?? '').trim();
 if (!value) { if (!optional) invalid(id, 'Enter the address of the other end'); return ''; }
 if (family === 6 ? !canonicalIPv6(value) : !isIPv4(value)) invalid(id, family === 6 ? 'Enter an IPv6 address' : 'Enter an IPv4 address');
 return value;
}

export const tunnels = {
 id: 'tunnels',
 noun: 'Tunnel',
 sources: ['uci:network', 'uci:firewall', 'ifaces', 'protos'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 100 },
  { id: 'type', label: 'Type', width: 110 },
  { id: 'local', label: 'Local Address', width: 120 },
  { id: 'remote', label: 'Remote Address', width: 140 },
  { id: 'id', label: 'Key / VNI', width: 70 },
  { id: 'address', label: 'Tunnel Address', width: 130 },
  { id: 'device', label: 'Device', width: 90 },
  { id: 'mtu', label: 'MTU', width: 50, align: 'right', hidden: true }
 ],
 flagLegend: { R: 'running', X: 'disabled' },
 defaultSort: null,
 status: data => data.protos && !Object.keys(TUNNELS).some(proto => Object.hasOwn(data.protos, proto)) ? 'Tunnels need the gre, ipip or vxlan package (restart the network after installing)' : 'Each type needs its package: gre, ipip or vxlan',
 rows(data) {
  return sections(data['uci:network'], 'interface').filter(section => TUNNELS[section.proto]).map(section => {
   const name = section['.name'], kind = TUNNELS[section.proto], state = live(data, name);
   const disabled = truthy(section.disabled);
   return {
    key: name, section: name, disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (state?.up ? 'R' : ''),
    cells: {
     name, type: kind.label, local: section.ipaddr ?? section.ip6addr ?? '', remote: section.peeraddr ?? section.peer6addr ?? '',
     id: kind.vni ? section.vid ?? '' : section.ikey ?? '', address: addressOf(companion(data, name)), device: state?.l3_device ?? kind.device(name), mtu: section.mtu ?? ''
    }
   };
  });
 },
 itemTitle: row => `Tunnel <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.cells.type, row.disabled ? 'disabled' : row.flags.includes('R') ? 'running' : 'not running'],
 canAdd: data => !data.protos || Object.keys(TUNNELS).some(proto => Object.hasOwn(data.protos, proto)),
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'tun1' },
  { id: 'proto', label: 'Type', type: row ? 'static' : 'select', options: Object.entries(TUNNELS).filter(([proto]) => !data.protos || Object.hasOwn(data.protos, proto)).map(([value, kind]) => ({ value, label: kind.label })), value: values => TUNNELS[values.proto]?.label },
  { id: 'remote', label: 'Remote Address', type: 'text' },
  { id: 'local', label: 'Local Address', type: 'text', placeholder: 'from the route to the remote' },
  { id: 'key', label: 'Key', type: 'number', placeholder: 'none', visible: values => TUNNELS[values.proto]?.key },
  { id: 'vid', label: 'VNI', type: 'number', visible: values => TUNNELS[values.proto]?.vni },
  { id: 'port', label: 'UDP Port', type: 'number', placeholder: '4789', visible: values => TUNNELS[values.proto]?.vni },
  { id: 'address', label: 'Tunnel Address', type: 'text', placeholder: '10.255.0.1/30', visible: values => !TUNNELS[values.proto]?.bridge || !values.bridge },
  { id: 'bridge', label: 'Bridge Into', type: 'select', allowEmpty: true, options: networkOptions(data['uci:network'], section => section['.name'] !== 'loopback'), visible: values => values.proto === 'gretap' || values.proto === 'grev6tap' },
  { id: 'zone', label: 'Firewall Zone', type: 'select', allowEmpty: true, options: zoneOptions(data['uci:firewall']), visible: values => !values.bridge },
  { id: 'mtu', label: 'MTU', type: 'number', placeholder: 'automatic', tab: 'Advanced' },
  { id: 'ttl', label: 'TTL', type: 'number', placeholder: '64', tab: 'Advanced' },
  { id: 'tunlink', label: 'Through Network', type: 'select', allowEmpty: true, tab: 'Advanced', options: networkOptions(data['uci:network'], section => section['.name'] !== 'loopback') }
 ],
 values(row, data) {
  const section = data['uci:network'][row.section] ?? {};
  const network = companion(data, row.section)?.['.name'] ?? row.section;
  return {
   name: row.key, proto: section.proto, remote: section.peeraddr ?? section.peer6addr ?? '', local: section.ipaddr ?? section.ip6addr ?? '', key: section.ikey ?? '', vid: section.vid ?? '', port: section.port ?? '',
   address: addressOf(companion(data, row.section)), bridge: section.network ?? '', zone: zonesOf(data['uci:firewall'], network)[0] ?? '', mtu: section.mtu ?? '', ttl: section.ttl ?? '', tunlink: section.tunlink ?? ''
  };
 },
 defaults: data => ({ name: '', proto: Object.keys(TUNNELS).find(proto => !data.protos || Object.hasOwn(data.protos, proto)) ?? 'gre', remote: '', local: '', key: '', vid: '', port: '', address: '', bridge: '', zone: '', mtu: '', ttl: '', tunlink: '' }),
 save(values, row, data) {
  const kind = TUNNELS[values.proto];
  if (!kind) invalid('proto', 'Choose the tunnel type');
  const name = row ? row.section : String(values.name ?? '').trim();
  if (!row) {
   if (!NAME.test(name) || kind.device(name).length > 15) invalid('name', `Use letters, digits and _; up to ${15 - kind.device('').length} characters for ${kind.label}`);
   if (data['uci:network']?.[name]) invalid('name', `${name} already exists`);
  }
  const remote = checkAddress(values, 'remote', kind.family, { optional: false });
  const local = checkAddress(values, 'local', kind.family);
  if (kind.key && values.key && !(/^\d+$/.test(values.key) && Number(values.key) <= 4294967295)) invalid('key', 'A key is a number up to 4294967295');
  if (kind.vni && !(/^\d+$/.test(values.vid) && Number(values.vid) <= 16777215)) invalid('vid', 'A VNI is a number up to 16777215');
  if (values.port && !(/^\d+$/.test(values.port) && Number(values.port) >= 1 && Number(values.port) <= 65535)) invalid('port', 'A port is 1 to 65535');
  if (values.address && !parseCidr(values.address, { requirePrefix: true }) && !parseCidr6(values.address, { requirePrefix: true })) invalid('address', 'Enter an address with its prefix, such as 10.255.0.1/30');
  if (values.mtu && !(/^\d+$/.test(values.mtu) && Number(values.mtu) >= 576 && Number(values.mtu) <= 9000)) invalid('mtu', 'MTU is 576 to 9000');
  if (values.ttl && !(/^\d+$/.test(values.ttl) && Number(values.ttl) >= 1 && Number(values.ttl) <= 255)) invalid('ttl', 'TTL is 1 to 255');
  const v6 = kind.family === 6;
  const options = compact({
   proto: values.proto, [v6 ? 'peer6addr' : 'peeraddr']: remote, [v6 ? 'ip6addr' : 'ipaddr']: local, ikey: kind.key ? values.key : '', okey: kind.key ? values.key : '',
   vid: kind.vni ? values.vid : '', port: kind.vni ? values.port : '', network: kind.bridge && values.proto !== 'vxlan' && values.proto !== 'vxlan6' ? values.bridge : '', mtu: values.mtu, ttl: values.ttl, tunlink: values.tunlink
  });
  const ops = [row ? { op: 'set', config: 'network', section: name, values: options } : { op: 'add', config: 'network', type: 'interface', name, values: Object.fromEntries(Object.entries(options).filter(([, value]) => value !== null)) }];
  const bridged = kind.bridge && values.bridge;
  const network = networkName(data, name, bridged ? { address: '' } : values, ops);
  ops.push(...zoneMembership(data, network, bridged ? '' : values.zone));
  if (network !== name) ops.push(...zoneMembership(data, name, ''));
  return { description: row ? `Change tunnel ${name}` : `Add ${kind.label} tunnel ${name} to ${remote}`, ops };
 },
 remove: (rows, data) => ({
  description: `Remove tunnel ${rows.map(row => row.key).join(', ')}`,
  ops: rows.flatMap(row => {
   const extra = companion(data, row.section);
   return [
    { op: 'delete', config: 'network', section: row.section }, ...zoneMembership(data, row.section, ''),
    ...(extra ? [{ op: 'delete', config: 'network', section: extra['.name'] }, ...zoneMembership(data, extra['.name'], '')] : [])
   ];
  })
 }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} tunnel ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment tunnel ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) })
};

/* --- Bonding --------------------------------------------------------------- */

const MODES = ['balance-rr', 'active-backup', 'balance-xor', 'broadcast', '802.3ad', 'balance-tlb', 'balance-alb'];
const HASHES = ['layer2', 'layer2+3', 'layer3+4', 'encap2+3', 'encap3+4'];

function maskOf(prefix) {
 return formatIPv4(prefix ? (0xffffffff * 2 ** (32 - prefix)) % 2 ** 32 : 0);
}

export const bonding = {
 id: 'bonding',
 noun: 'Bond',
 sources: ['uci:network', 'uci:firewall', 'ifaces', 'devices', 'protos'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 100 },
  { id: 'mode', label: 'Mode', width: 110 },
  { id: 'slaves', label: 'Slaves', width: 200 },
  { id: 'address', label: 'Address', width: 130 },
  { id: 'device', label: 'Device', width: 90 }
 ],
 flagLegend: { R: 'running', X: 'disabled' },
 defaultSort: null,
 status: data => data.protos && !Object.hasOwn(data.protos, 'bonding') ? 'Bonding needs the proto-bonding and kmod-bonding packages' : 'Slaves leave their bridge or network while bonded',
 rows: data => sections(data['uci:network'], 'interface').filter(section => section.proto === 'bonding').map(section => {
  const name = section['.name'], state = live(data, name), disabled = truthy(section.disabled);
  const prefix = section.netmask && parseIPv4(section.netmask) !== null ? String(section.netmask).split('.').reduce((count, part) => count + Number(part).toString(2).replace(/0/g, '').length, 0) : null;
  return {
   key: name, section: name, disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (state?.up ? 'R' : ''),
   cells: { name, mode: section.bonding_policy ?? 'balance-rr', slaves: list(section.slaves).join(', '), address: section.ipaddr ? `${section.ipaddr}${prefix !== null ? `/${prefix}` : ''}` : '', device: `bond-${name}` }
  };
 }),
 itemTitle: row => `Bond <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.cells.mode, row.disabled ? 'disabled' : row.flags.includes('R') ? 'running' : 'not running'],
 canAdd: data => !data.protos || Object.hasOwn(data.protos, 'bonding'),
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => {
  const ethernet = Object.values(data.devices ?? {}).filter(device => device.devtype === 'ethernet').map(device => ({ value: device.name, label: device.name }));
  return [
   { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'bond0' },
   { id: 'slaves', label: 'Slaves', type: 'multi', options: ethernet },
   { id: 'mode', label: 'Mode', type: 'select', options: MODES.map(value => ({ value, label: value })) },
   { id: 'primary', label: 'Primary', type: 'select', allowEmpty: true, options: values => (values.slaves ?? []).map(value => ({ value, label: value })), visible: values => ['active-backup', 'balance-tlb', 'balance-alb'].includes(values.mode) },
   { id: 'hash', label: 'Transmit Hash Policy', type: 'select', options: HASHES.map(value => ({ value, label: value })), visible: values => ['balance-xor', '802.3ad', 'balance-tlb'].includes(values.mode) },
   { id: 'lacp_rate', label: 'LACP Rate', type: 'select', options: [{ value: 'slow', label: 'slow (30 s)' }, { value: 'fast', label: 'fast (1 s)' }], visible: values => values.mode === '802.3ad' },
   { id: 'monitoring', label: 'Link Monitoring', type: 'select', options: [{ value: 'mii', label: 'MII' }, { value: 'arp', label: 'ARP' }] },
   { id: 'miimon', label: 'MII Interval (ms)', type: 'number', placeholder: '100', visible: values => values.monitoring === 'mii' },
   { id: 'arp_interval', label: 'ARP Interval (ms)', type: 'number', placeholder: '1000', visible: values => values.monitoring === 'arp' },
   { id: 'arp_ip_target', label: 'ARP Targets', type: 'list', visible: values => values.monitoring === 'arp' },
   { id: 'address', label: 'Address', type: 'text', placeholder: '192.168.10.1/24' },
   { id: 'zone', label: 'Firewall Zone', type: 'select', allowEmpty: true, options: zoneOptions(data['uci:firewall']) }
  ];
 },
 values(row, data) {
  const section = data['uci:network'][row.section] ?? {};
  return {
   name: row.key, slaves: list(section.slaves), mode: section.bonding_policy ?? 'balance-rr', primary: section.primary ?? '', hash: section.xmit_hash_policy ?? 'layer2', lacp_rate: section.lacp_rate ?? 'slow',
   monitoring: section.link_monitoring ?? 'mii', miimon: section.miimon ?? '', arp_interval: section.arp_interval ?? '', arp_ip_target: list(section.arp_ip_target), address: row.cells.address, zone: zonesOf(data['uci:firewall'], row.key)[0] ?? ''
  };
 },
 defaults: () => ({ name: '', slaves: [], mode: 'active-backup', primary: '', hash: 'layer2', lacp_rate: 'slow', monitoring: 'mii', miimon: '100', arp_interval: '', arp_ip_target: [], address: '', zone: '' }),
 save(values, row, data) {
  const name = row ? row.section : String(values.name ?? '').trim();
  if (!row) {
   if (!NAME.test(name) || name.length > 10) invalid('name', 'Use up to 10 letters, digits or _ (the device is bond-<name>)');
   if (data['uci:network']?.[name]) invalid('name', `${name} already exists`);
  }
  if (!(values.slaves ?? []).length) invalid('slaves', 'Choose at least one Ethernet device');
  for (const id of ['miimon', 'arp_interval']) if (values[id] && !(/^\d+$/.test(values[id]) && Number(values[id]) <= 60000)) invalid(id, 'Milliseconds, up to 60000');
  for (const target of values.arp_ip_target ?? []) if (!isIPv4(target)) invalid('arp_ip_target', `${target} is not an IPv4 address`);
  if (values.monitoring === 'arp' && !(values.arp_ip_target ?? []).length) invalid('arp_ip_target', 'ARP monitoring needs at least one address to check');
  let ipaddr = '', netmask = '';
  if (values.address) {
   const cidr = parseCidr(values.address, { requirePrefix: true });
   if (!cidr) invalid('address', 'Enter an IPv4 address with its prefix, such as 192.168.10.1/24');
   ipaddr = values.address.split('/')[0];
   netmask = maskOf(cidr.prefix);
  }
  const mode = values.mode;
  const options = compact({
   proto: 'bonding', slaves: values.slaves, bonding_policy: mode, primary: ['active-backup', 'balance-tlb', 'balance-alb'].includes(mode) ? values.primary : '',
   xmit_hash_policy: ['balance-xor', '802.3ad', 'balance-tlb'].includes(mode) ? values.hash : '', lacp_rate: mode === '802.3ad' ? values.lacp_rate : '',
   link_monitoring: values.monitoring, miimon: values.monitoring === 'mii' ? values.miimon || '100' : '', arp_interval: values.monitoring === 'arp' ? values.arp_interval || '1000' : '',
   arp_ip_target: values.monitoring === 'arp' ? values.arp_ip_target : [], ipaddr, netmask
  });
  const ops = [row ? { op: 'set', config: 'network', section: name, values: options } : { op: 'add', config: 'network', type: 'interface', name, values: Object.fromEntries(Object.entries(options).filter(([, value]) => value !== null && !(Array.isArray(value) && !value.length))) }];
  ops.push(...zoneMembership(data, name, values.zone));
  return { description: row ? `Change bond ${name}` : `Add bond ${name} of ${values.slaves.join(', ')}`, ops };
 },
 remove: (rows, data) => ({ description: `Remove bond ${rows.map(row => row.key).join(', ')}`, ops: rows.flatMap(row => [{ op: 'delete', config: 'network', section: row.section }, ...zoneMembership(data, row.section, '')]) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} bond ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment bond ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) })
};
