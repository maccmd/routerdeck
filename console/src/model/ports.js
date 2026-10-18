// SPDX-License-Identifier: Apache-2.0
// Interfaces tabs beyond the device list: Ethernet ports with their link
// settings, VLAN devices, and WireGuard interfaces and peers. netifd applies
// speed, duplex and autonegotiation from `device` sections.
import interfaces from './interfaces.js';
import { zoneMembership } from './networks.js';
import { sections, list, truthy, invalid, NAME, zonesOf, zoneOptions, compact } from './common.js';
import { bytes, uptime } from '../lib/format.js';
import { parseCidr, parseCidr6 } from '../lib/ip.js';

const deviceSection = (data, name) => sections(data['uci:network'], 'device').find(section => section.name === name);
const SPEEDS = ['10', '100', '1000', '2500', '5000', '10000'];

export const ethernet = {
 id: 'ethernet',
 noun: 'Ethernet Port',
 sources: ['devices', 'netdev', 'uci:network'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 90 },
  { id: 'link', label: 'Link', width: 60 },
  { id: 'rate', label: 'Rate', width: 80, align: 'right', sort: (value, row) => row.speed ?? -1 },
  { id: 'duplex', label: 'Duplex', width: 60 },
  { id: 'autoneg', label: 'Auto Negotiation', width: 110 },
  { id: 'mtu', label: 'MTU', width: 60, align: 'right' },
  { id: 'mac', label: 'MAC Address', width: 130 },
  { id: 'master', label: 'Bridge', width: 80 }
 ],
 flagLegend: { R: 'link up', S: 'bridge port' },
 defaultSort: 'name',
 note: 'Speed and duplex apply only where the driver allows them; virtual NICs report no rate.',
 rows(data) {
  return Object.values(data.devices ?? {}).filter(device => device.devtype === 'ethernet' && !device.flags?.loopback && device.name !== 'lo' && !device.wireless).map(device => {
   const link = device.link ?? {}, status = data.netdev?.[device.name] ?? {}, section = deviceSection(data, device.name) ?? {};
   const fixed = section.speed || section.duplex;
   return {
    key: device.name, name: device.name, section: section['.name'], speed: link.speed > 0 ? link.speed : null,
    flags: (link.carrier ? 'R' : '') + (device.master ? 'S' : ''),
    cells: {
     name: device.name, link: link.carrier ? 'up' : 'down', rate: link.speed > 0 ? (link.speed >= 1000 ? `${link.speed / 1000} Gbps` : `${link.speed} Mbps`) : '',
     duplex: link.carrier && link.speed > 0 && ['full', 'half'].includes(link.duplex) ? link.duplex : '', autoneg: section.autoneg !== undefined ? (truthy(section.autoneg) ? 'on (set)' : 'off (set)') : fixed ? 'set by speed' : status.autoneg ? 'on' : status.autoneg === false ? 'off' : '',
     mtu: String(device.mtu ?? ''), mac: (device.mac ?? '').toUpperCase(), master: device.master ?? ''
    }
   };
  });
 },
 itemTitle: row => `Ethernet <${row.key}>`,
 itemStatus: row => [row.cells.link === 'up' ? 'link ok' : 'no link', row.cells.rate],
 fields: () => [
  { id: 'name', label: 'Name', type: 'static' },
  { id: 'rate', label: 'Rate', type: 'static' },
  { id: 'speed', label: 'Speed', type: 'select', options: [{ value: '', label: 'auto' }, ...SPEEDS.map(value => ({ value, label: `${value} Mbps` }))] },
  { id: 'duplex', label: 'Duplex', type: 'select', options: [{ value: '', label: 'auto' }, { value: 'full', label: 'full' }, { value: 'half', label: 'half' }] },
  { id: 'autoneg', label: 'Auto Negotiation', type: 'select', options: [{ value: '', label: 'driver default' }, { value: '1', label: 'on' }, { value: '0', label: 'off' }] }
 ],
 values(row, data) {
  const section = deviceSection(data, row.key) ?? {};
  return { name: row.key, rate: row.cells.rate || '—', speed: section.speed ?? '', duplex: section.duplex ?? '', autoneg: section.autoneg ?? '' };
 },
 save(values, row, data, { dirty = null } = {}) {
  if (values.duplex && !values.speed) invalid('speed', 'Choose a speed to fix the duplex');
  const changes = Object.fromEntries(Object.entries({ speed: values.speed || null, duplex: values.duplex || null, autoneg: values.autoneg || null }).filter(([key]) => !dirty || dirty.has(key)));
  if (!Object.keys(changes).length) return null;
  const description = `Change link settings of ${row.key}`;
  return row.section
   ? { description, ops: [{ op: 'set', config: 'network', section: row.section, values: changes }] }
   : { description, ops: [{ op: 'add', config: 'network', type: 'device', values: { name: row.key, ...changes } }] };
 }
};

// The VLAN devices of the Interface list, with the VLAN form.
export const vlans = {
 ...interfaces,
 id: 'vlans',
 noun: 'VLAN',
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'vid', label: 'VLAN ID', width: 70, align: 'right', sort: value => Number(value) || 0 },
  { id: 'ifname', label: 'Interface', width: 100 },
  { id: 'mtu', label: 'Actual MTU', width: 76, align: 'right' },
  { id: 'mac', label: 'MAC Address', width: 130 },
  { id: 'tx', label: 'Tx', width: 86, align: 'right' },
  { id: 'rx', label: 'Rx', width: 86, align: 'right' }
 ],
 addTypes: undefined,
 rows: data => interfaces.rows(data).filter(row => row.type === 'vlan').map(row => {
  const section = sections(data['uci:network'], 'device').find(item => item['.name'] === row.section) ?? {};
  return { ...row, cells: { ...row.cells, vid: section.vid ?? '', ifname: section.ifname ?? '' } };
 }),
 itemTitle: row => `VLAN <${row?.name ?? 'new'}>`,
 fields: (data, row) => interfaces.fields(data, row, { addType: 'vlan' }),
 defaults: data => interfaces.defaults(data, { addType: 'vlan' }),
 save: (values, row, data, options = {}) => interfaces.save({ ...values, type: 'vlan' }, row, data, { ...options, addType: 'vlan' })
};

/* --- WireGuard --------------------------------------------------------- */

const KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;
const short = key => key ? `${key.slice(0, 10)}…` : '';
const wgInterfaces = data => sections(data['uci:network'], 'interface').filter(section => section.proto === 'wireguard');

export const wireguard = {
 id: 'wireguard',
 noun: 'WireGuard Interface',
 sources: ['uci:network', 'uci:firewall', 'ifaces', 'wireguard'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 100 },
  { id: 'port', label: 'Listen Port', width: 80, align: 'right' },
  { id: 'addresses', label: 'Addresses', width: 160 },
  { id: 'mtu', label: 'MTU', width: 60, align: 'right' },
  { id: 'peers', label: 'Peers', width: 50, align: 'right' },
  { id: 'key', label: 'Public Key', width: 380 }
 ],
 flagLegend: { R: 'running', X: 'disabled' },
 defaultSort: 'name',
 status: data => data.wireguard?.available === false ? 'WireGuard needs the wireguard-tools and kmod-wireguard packages' : '',
 rows(data) {
  return wgInterfaces(data).map(section => {
   const name = section['.name'], live = data.wireguard?.interfaces?.[name];
   const up = (data.ifaces ?? []).find(item => item.interface === name)?.up;
   const disabled = truthy(section.disabled);
   return {
    key: name, section: name, disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (up ? 'R' : ''),
    cells: { name, port: section.listen_port ?? (live?.listen_port ? String(live.listen_port) : ''), addresses: list(section.addresses).join(', '), mtu: section.mtu ?? '', peers: String(sections(data['uci:network'], `wireguard_${name}`).length), key: live?.public_key ?? '' }
   };
  });
 },
 itemTitle: row => `WireGuard <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.flags.includes('R') ? 'running' : 'not running'],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'wg0' },
  { id: 'listen_port', label: 'Listen Port', type: 'number', placeholder: '51820' },
  { id: 'addresses', label: 'Addresses', type: 'list' },
  { id: 'mtu', label: 'MTU', type: 'number', placeholder: '1420' },
  { id: 'private_key', label: 'Private Key', type: 'password', placeholder: row ? 'unchanged' : 'generated on the router' },
  { id: 'public', label: 'Public Key', type: 'static', value: () => row?.cells.key || (row ? 'shown once the interface is up' : 'after saving') },
  { id: 'zone', label: 'Firewall Zone', type: 'select', allowEmpty: true, options: zoneOptions(data['uci:firewall']) }
 ],
 values(row, data) {
  const section = wgInterfaces(data).find(item => item['.name'] === row.section) ?? {};
  return { name: row.key, listen_port: section.listen_port ?? '', addresses: list(section.addresses), mtu: section.mtu ?? '', private_key: '', zone: zonesOf(data['uci:firewall'], row.key)[0] ?? '' };
 },
 defaults: data => ({ name: '', listen_port: '51820', addresses: [], mtu: '', private_key: '', zone: zoneOptions(data['uci:firewall']).find(zone => zone.value === 'lan')?.value ?? '' }),
 save(values, row, data, { dirty = null } = {}) {
  const name = row ? row.section : values.name.trim();
  if (!row) {
   if (!NAME.test(name) || name.length > 15) invalid('name', 'Use up to 15 letters, digits and underscores');
   if (sections(data['uci:network'], 'interface').some(section => section['.name'] === name)) invalid('name', `${name} already exists`);
  }
  if (values.listen_port && !(/^\d+$/.test(values.listen_port) && values.listen_port >= 1 && values.listen_port <= 65535)) invalid('listen_port', 'A port is 1 to 65535');
  for (const address of values.addresses ?? []) if (!parseCidr(address, { requirePrefix: true }) && !parseCidr6(address, { requirePrefix: true })) invalid('addresses', `${address} is not an address with a prefix`);
  if (values.mtu && !(/^\d+$/.test(values.mtu) && values.mtu >= 1280 && values.mtu <= 9000)) invalid('mtu', 'MTU is 1280 to 9000');
  if (values.private_key && !KEY.test(values.private_key.trim())) invalid('private_key', 'A WireGuard key is 44 characters of base64');
  // A new interface without a key gets one made on the router.
  const key = values.private_key ? values.private_key.trim() : row ? '' : '@generate:wireguard-key';
  const options = compact({ proto: 'wireguard', listen_port: values.listen_port, addresses: values.addresses ?? [], mtu: values.mtu, private_key: key });
  const ops = [];
  if (row) {
   const changes = Object.fromEntries(Object.entries(options).filter(([option]) => option !== 'proto' && (option === 'private_key' ? !!key : !dirty || dirty.has(option))));
   if (Object.keys(changes).length) ops.push({ op: 'set', config: 'network', section: name, values: changes });
  } else ops.push({ op: 'add', config: 'network', type: 'interface', name, values: options });
  if (!row || !dirty || dirty.has('zone')) ops.push(...zoneMembership(data, name, values.zone));
  return ops.length ? { description: row ? `Change WireGuard ${name}` : `Add WireGuard ${name}`, ops } : null;
 },
 remove: (rows, data) => ({
  description: `Remove WireGuard ${rows.map(row => row.key).join(', ')}`,
  ops: rows.flatMap(row => [
   { op: 'delete', config: 'network', section: row.section },
   ...sections(data['uci:network'], `wireguard_${row.key}`).map(peer => ({ op: 'delete', config: 'network', section: peer['.name'] })),
   ...zoneMembership(data, row.section, '')
  ])
 }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} WireGuard ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment WireGuard ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) })
};

function peerSections(data) {
 return wgInterfaces(data).flatMap(iface => sections(data['uci:network'], `wireguard_${iface['.name']}`).map(peer => ({ peer, iface: iface['.name'] })));
}

export const wireguardPeers = {
 id: 'wireguard-peers',
 noun: 'WireGuard Peer',
 sources: ['uci:network', 'wireguard'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'interface', label: 'Interface', width: 80 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'key', label: 'Public Key', width: 110 },
  { id: 'allowed', label: 'Allowed Address', width: 170 },
  { id: 'endpoint', label: 'Endpoint', width: 150 },
  { id: 'handshake', label: 'Last Handshake', width: 110, sort: (value, row) => row.age ?? Infinity },
  { id: 'rx', label: 'Rx', width: 80, align: 'right', sort: (value, row) => row.rx ?? -1 },
  { id: 'tx', label: 'Tx', width: 80, align: 'right', sort: (value, row) => row.tx ?? -1 }
 ],
 flagLegend: { X: 'disabled', C: 'connected (handshake within 3 minutes)' },
 defaultSort: null,
 rows(data) {
  const now = data.wireguard?.now;
  return peerSections(data).map(({ peer, iface }) => {
   const live = data.wireguard?.interfaces?.[iface]?.peers?.find(item => item.public_key === peer.public_key);
   const age = live?.latest_handshake && now ? now - live.latest_handshake : null;
   const disabled = truthy(peer.disabled);
   const host = peer.endpoint_host ? `${peer.endpoint_host.includes(':') ? `[${peer.endpoint_host}]` : peer.endpoint_host}${peer.endpoint_port ? `:${peer.endpoint_port}` : ''}` : '';
   return {
    key: peer['.name'], section: peer['.name'], iface, disabled, comment: peer.comment, age, rx: live?.rx_bytes, tx: live?.tx_bytes,
    flags: (disabled ? 'X' : '') + (age !== null && age < 180 ? 'C' : ''),
    cells: { interface: iface, name: peer.description ?? '', key: short(peer.public_key), allowed: list(peer.allowed_ips).join(', '), endpoint: host || live?.endpoint || '', handshake: age !== null ? `${uptime(age)} ago` : '', rx: live ? bytes(live.rx_bytes) : '', tx: live ? bytes(live.tx_bytes) : '' }
   };
  });
 },
 itemTitle: row => `WireGuard Peer <${row?.cells.name || row?.cells.key || 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.flags.includes('C') ? 'connected' : 'no recent handshake'],
 canAdd: data => wgInterfaces(data).length > 0,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'interface', label: 'Interface', type: row ? 'static' : 'select', options: wgInterfaces(data).map(section => ({ value: section['.name'], label: section['.name'] })) },
  { id: 'description', label: 'Name', type: 'text', placeholder: 'phone' },
  { id: 'public_key', label: 'Public Key', type: 'text' },
  { id: 'preshared_key', label: 'Preshared Key', type: 'password', placeholder: 'none' },
  { id: 'allowed_ips', label: 'Allowed Address', type: 'list' },
  { id: 'route_allowed_ips', label: 'Route Allowed Addresses', type: 'bool' },
  { id: 'endpoint_host', label: 'Endpoint Host', type: 'text', placeholder: 'none (the peer connects)' },
  { id: 'endpoint_port', label: 'Endpoint Port', type: 'number', placeholder: '51820' },
  { id: 'persistent_keepalive', label: 'Persistent Keepalive', type: 'number', placeholder: 'off' }
 ],
 values(row, data) {
  const peer = peerSections(data).find(item => item.peer['.name'] === row.section)?.peer ?? {};
  return {
   interface: row.iface, description: peer.description ?? '', public_key: peer.public_key ?? '', preshared_key: peer.preshared_key ?? '', allowed_ips: list(peer.allowed_ips),
   route_allowed_ips: truthy(peer.route_allowed_ips), endpoint_host: peer.endpoint_host ?? '', endpoint_port: peer.endpoint_port ?? '', persistent_keepalive: peer.persistent_keepalive ?? ''
  };
 },
 defaults: data => ({ interface: wgInterfaces(data)[0]?.['.name'] ?? '', description: '', public_key: '', preshared_key: '', allowed_ips: [], route_allowed_ips: false, endpoint_host: '', endpoint_port: '', persistent_keepalive: '' }),
 save(values, row, data) {
  if (!row && !values.interface) invalid('interface', 'Add a WireGuard interface first');
  if (!KEY.test(values.public_key.trim())) invalid('public_key', 'A WireGuard key is 44 characters of base64');
  if (values.preshared_key && !KEY.test(values.preshared_key.trim())) invalid('preshared_key', 'A preshared key is 44 characters of base64');
  for (const address of values.allowed_ips ?? []) if (!parseCidr(address) && !parseCidr6(address)) invalid('allowed_ips', `${address} is not an address or prefix`);
  if (values.endpoint_port && !(/^\d+$/.test(values.endpoint_port) && values.endpoint_port >= 1 && values.endpoint_port <= 65535)) invalid('endpoint_port', 'A port is 1 to 65535');
  if (values.persistent_keepalive && !(/^\d+$/.test(values.persistent_keepalive) && values.persistent_keepalive <= 65535)) invalid('persistent_keepalive', 'Keepalive is a number of seconds');
  const options = compact({
   description: values.description, public_key: values.public_key.trim(), preshared_key: values.preshared_key.trim(), allowed_ips: values.allowed_ips ?? [],
   route_allowed_ips: values.route_allowed_ips ? '1' : '', endpoint_host: values.endpoint_host, endpoint_port: values.endpoint_port, persistent_keepalive: values.persistent_keepalive
  });
  return row
   ? { description: `Change WireGuard peer ${values.description || short(values.public_key)}`, ops: [{ op: 'set', config: 'network', section: row.section, values: options }] }
   : { description: `Add WireGuard peer ${values.description || short(values.public_key)} to ${values.interface}`, ops: [{ op: 'add', config: 'network', type: `wireguard_${values.interface}`, values: options }] };
 },
 remove: rows => ({ description: `Remove WireGuard peer ${rows.map(row => row.cells.name || row.cells.key).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'network', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} WireGuard peer ${rows.map(row => row.cells.name || row.cells.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment WireGuard peer ${rows.map(row => row.cells.name || row.cells.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) })
};
