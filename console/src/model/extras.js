// SPDX-License-Identifier: Apache-2.0
// Optional services, shown when their packages are installed: UPnP and
// NAT-PMP (miniupnpd), dynamic DNS (ddns-scripts) and smart queue management
// (sqm-scripts). Each keeps its own UCI configuration.
import { sections, truthy, list, invalid, NAME, compact, networkOptions, reorderOps } from './common.js';
import { bytes, count, uptime } from '../lib/format.js';
import { parseCidr } from '../lib/ip.js';

const PORTS = /^\d{1,5}(-\d{1,5})?$/;
const kbit = value => /^\d+$/.test(value) && Number(value) >= 0 && Number(value) <= 100000000;
const changed = (dirty, id) => !dirty || dirty.has(id);

/* --- UPnP -------------------------------------------------------------- */

const upnpSection = data => sections(data['uci:upnpd'], 'upnpd')[0];

export const upnpSettings = {
 id: 'upnp-settings',
 noun: 'UPnP',
 singleton: true,
 sources: ['uci:upnpd', 'uci:network'],
 rows: data => upnpSection(data) ? [{ key: 'upnp', section: upnpSection(data)['.name'] }] : [],
 itemTitle: () => 'UPnP',
 itemStatus: () => ['miniupnpd'],
 fields: data => {
  const networks = networkOptions(data['uci:network'], section => section['.name'] !== 'loopback');
  return [
   { id: 'enabled', label: 'Enabled', type: 'bool' },
   { id: 'enable_upnp', label: 'UPnP IGD', type: 'bool' },
   { id: 'enable_natpmp', label: 'NAT-PMP / PCP', type: 'bool' },
   { id: 'secure_mode', label: 'Secure Mode', type: 'bool' },
   { id: 'external_iface', label: 'External Interface', type: 'select', options: [{ value: '', label: 'automatic (default route)' }, ...networks] },
   { id: 'internal_iface', label: 'Internal Interface', type: 'select', options: networks },
   { id: 'download', label: 'Download (kbit/s)', type: 'number' },
   { id: 'upload', label: 'Upload (kbit/s)', type: 'number' },
   { id: 'note', label: '', type: 'note', value: () => 'Secure Mode lets a device open ports only to itself. Mappings last until the device removes them or the service restarts.' }
  ];
 },
 values(row, data) {
  const section = upnpSection(data) ?? {};
  return {
   enabled: truthy(section.enabled), enable_upnp: truthy(section.enable_upnp, true), enable_natpmp: truthy(section.enable_natpmp, true), secure_mode: truthy(section.secure_mode, true),
   external_iface: section.external_iface ?? '', internal_iface: list(section.internal_iface)[0] ?? 'lan', download: section.download ?? '', upload: section.upload ?? ''
  };
 },
 save(values, row, data, { dirty = null } = {}) {
  for (const id of ['download', 'upload']) if (values[id] && !kbit(values[id])) invalid(id, 'Enter a speed in kbit/s');
  const options = { enabled: values.enabled ? '1' : '0', enable_upnp: values.enable_upnp ? '1' : '0', enable_natpmp: values.enable_natpmp ? '1' : '0', secure_mode: values.secure_mode ? '1' : '0', external_iface: values.external_iface || null, internal_iface: values.internal_iface || null, download: values.download || null, upload: values.upload || null };
  const changes = Object.fromEntries(Object.entries(options).filter(([id]) => changed(dirty, id)));
  return Object.keys(changes).length ? { description: 'Change UPnP settings', ops: [{ op: 'set', config: 'upnpd', section: row.section, values: changes }] } : null;
 }
};

export const upnpMappings = {
 id: 'upnp-mappings',
 noun: 'UPnP Mapping',
 readOnly: true,
 sources: ['upnp'],
 columns: [
  { id: 'protocol', label: 'Protocol', width: 70 },
  { id: 'external', label: 'External Port', width: 90, align: 'right', sort: value => Number(value) },
  { id: 'address', label: 'Internal Address', width: 130 },
  { id: 'internal', label: 'Internal Port', width: 90, align: 'right', sort: value => Number(value) },
  { id: 'expires', label: 'Expires In', width: 100, sort: (value, row) => row.left ?? Infinity },
  { id: 'description', label: 'Description', width: 260 }
 ],
 defaultSort: 'external',
 note: 'Ports opened by devices on the LAN; they are not part of the configuration.',
 rows: data => (data.upnp?.mappings ?? []).map(item => {
  const left = item.expires ? item.expires - (data.upnp.now ?? 0) : null;
  return {
   key: `${item.protocol}:${item.external_port}`, readOnly: true, dynamic: true, left,
   cells: { protocol: item.protocol.toLowerCase(), external: String(item.external_port), address: item.address, internal: String(item.internal_port), expires: left === null ? 'never' : uptime(Math.max(0, left)), description: item.description }
  };
 }),
 itemTitle: row => `UPnP Mapping <${row.cells.protocol} ${row.cells.external}>`,
 fields: () => upnpMappings.columns.map(column => ({ id: column.id, label: column.label, type: 'static' })),
 values: row => ({ ...row.cells })
};

export const upnpRules = {
 id: 'upnp-rules',
 noun: 'UPnP Rule',
 sources: ['uci:upnpd'],
 ordered: true,
 columns: [
  { id: 'number', label: '#', width: 34, align: 'right', sort: value => Number(value) },
  { id: 'action', label: 'Action', width: 70 },
  { id: 'external', label: 'External Ports', width: 110 },
  { id: 'address', label: 'Internal Address', width: 130 },
  { id: 'internal', label: 'Internal Ports', width: 110 }
 ],
 defaultSort: null,
 note: 'The first matching rule decides which ports devices may open; order matters.',
 rows: data => sections(data['uci:upnpd'], 'perm_rule').map((section, index) => ({
  key: section['.name'], section: section['.name'], comment: section.comment,
  cells: { number: String(index), action: section.action ?? 'deny', external: section.ext_ports ?? '', address: section.int_addr ?? '', internal: section.int_ports ?? '' }
 })),
 itemTitle: row => `UPnP Rule <${row?.comment || row?.cells.number || 'new'}>`,
 itemStatus: row => [row.cells.action],
 canAdd: data => !!upnpSection(data),
 canRemove: () => true,
 canComment: () => true,
 fields: () => [
  { id: 'action', label: 'Action', type: 'select', options: [{ value: 'allow', label: 'allow' }, { value: 'deny', label: 'deny' }] },
  { id: 'ext_ports', label: 'External Ports', type: 'text', placeholder: '1024-65535' },
  { id: 'int_addr', label: 'Internal Address', type: 'text', placeholder: '192.168.1.0/24' },
  { id: 'int_ports', label: 'Internal Ports', type: 'text', placeholder: '1024-65535' }
 ],
 values: row => ({ action: row.cells.action, ext_ports: row.cells.external, int_addr: row.cells.address, int_ports: row.cells.internal }),
 defaults: () => ({ action: 'allow', ext_ports: '1024-65535', int_addr: '', int_ports: '1024-65535' }),
 save(values, row) {
  for (const id of ['ext_ports', 'int_ports']) if (!PORTS.test(values[id])) invalid(id, 'Enter a port or a range such as 1024-65535');
  if (!parseCidr(values.int_addr)) invalid('int_addr', 'Enter an IPv4 address or prefix');
  const options = { action: values.action, ext_ports: values.ext_ports, int_addr: values.int_addr, int_ports: values.int_ports };
  return row
   ? { description: `Change UPnP rule ${row.comment || '#' + row.cells.number}`, ops: [{ op: 'set', config: 'upnpd', section: row.section, values: options }] }
   : { description: `Add UPnP rule ${values.action} ${values.int_addr}`, ops: [{ op: 'add', config: 'upnpd', type: 'perm_rule', values: options }] };
 },
 remove: rows => ({ description: `Remove UPnP rule ${rows.map(row => row.comment || '#' + row.cells.number).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'upnpd', section: row.section })) }),
 comment: (rows, comment) => ({ description: `Comment UPnP rule ${rows.map(row => '#' + row.cells.number).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'upnpd', section: row.section, values: { comment: comment || null } })) }),
 order: (names, data) => ({ description: 'Move UPnP rule', ops: reorderOps('upnpd', data['uci:upnpd'], names, ['perm_rule']) })
};

/* --- Dynamic DNS ------------------------------------------------------- */

const SOURCES = [{ value: 'network', label: 'network address' }, { value: 'interface', label: 'device address' }, { value: 'web', label: 'checked on the web' }];

export const ddnsServices = {
 id: 'ddns-services',
 noun: 'Dynamic DNS Service',
 sources: ['uci:ddns', 'uci:network', 'ddns'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'provider', label: 'Provider', width: 130 },
  { id: 'domain', label: 'Domain', width: 180 },
  { id: 'interface', label: 'Interface', width: 70 },
  { id: 'address', label: 'Registered Address', width: 150 },
  { id: 'updated', label: 'Last Update', width: 110, sort: (value, row) => row.age ?? Infinity }
 ],
 flagLegend: { X: 'disabled', R: 'updater running', 6: 'IPv6' },
 defaultSort: null,
 rows(data) {
  return sections(data['uci:ddns'], 'service').map(section => {
   const live = data.ddns?.services?.[section['.name']] ?? {};
   const disabled = !truthy(section.enabled);
   const age = live.updated && data.ddns?.now ? data.ddns.now - live.updated : null;
   return {
    key: section['.name'], section: section['.name'], disabled, comment: section.comment, age,
    flags: (disabled ? 'X' : '') + (live.running ? 'R' : '') + (truthy(section.use_ipv6) ? '6' : ''),
    cells: { name: section['.name'], provider: section.service_name ?? (section.update_url ? 'custom URL' : ''), domain: section.domain ?? '', interface: section.interface ?? '', address: live.ip ?? '', updated: age !== null ? `${uptime(age)} ago` : '' }
   };
  });
 },
 itemTitle: row => `Dynamic DNS <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.flags.includes('R') ? 'running' : 'stopped', row.cells.address],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields(data, row) {
  const networks = networkOptions(data['uci:network'], section => section['.name'] !== 'loopback');
  return [
   { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'home' },
   { id: 'provider', label: 'Provider', type: 'select', options: [{ value: '', label: 'custom update URL' }, ...(data.ddns?.providers ?? []).map(value => ({ value, label: value }))] },
   { id: 'update_url', label: 'Update URL', type: 'text', placeholder: 'https://[USERNAME]:[PASSWORD]@example.net/update?host=[DOMAIN]&ip=[IP]', visible: values => !values.provider },
   { id: 'domain', label: 'Domain', type: 'text', placeholder: 'home.example.org' },
   { id: 'lookup_host', label: 'Lookup Host', type: 'text', placeholder: 'the domain' },
   { id: 'username', label: 'Username', type: 'text' },
   { id: 'password', label: 'Password', type: 'password' },
   { id: 'use_ipv6', label: 'IPv6', type: 'bool' },
   { id: 'interface', label: 'Interface', type: 'select', options: networks, tab: 'Address' },
   { id: 'ip_source', label: 'Address From', type: 'select', options: SOURCES, tab: 'Address' },
   { id: 'ip_network', label: 'Network', type: 'select', options: networks, tab: 'Address', visible: values => values.ip_source === 'network' },
   { id: 'ip_interface', label: 'Device', type: 'text', placeholder: 'eth1', tab: 'Address', visible: values => values.ip_source === 'interface' },
   { id: 'ip_url', label: 'Check URL', type: 'text', placeholder: 'http://checkip.dyndns.org', tab: 'Address', visible: values => values.ip_source === 'web' },
   { id: 'check_interval', label: 'Check Every (minutes)', type: 'number', placeholder: '10', tab: 'Address' }
  ];
 },
 values(row, data) {
  const section = sections(data['uci:ddns'], 'service').find(item => item['.name'] === row.section) ?? {};
  return {
   name: row.key, provider: section.service_name ?? '', update_url: section.update_url ?? '', domain: section.domain ?? '', lookup_host: section.lookup_host ?? '', username: section.username ?? '', password: section.password ?? '',
   use_ipv6: truthy(section.use_ipv6), interface: section.interface ?? 'wan', ip_source: section.ip_source ?? 'network', ip_network: section.ip_network ?? 'wan', ip_interface: section.ip_interface ?? '', ip_url: section.ip_url ?? '', check_interval: section.check_interval ?? ''
  };
 },
 defaults: data => ({ name: '', provider: data.ddns?.providers?.[0] ?? '', update_url: '', domain: '', lookup_host: '', username: '', password: '', use_ipv6: false, interface: 'wan', ip_source: 'network', ip_network: 'wan', ip_interface: '', ip_url: '', check_interval: '' }),
 save(values, row, data) {
  const name = row ? row.section : values.name.trim();
  if (!row && (!NAME.test(name) || sections(data['uci:ddns'], 'service').some(section => section['.name'] === name))) invalid('name', 'Use a new name of letters, digits and underscores');
  if (!values.provider && !/^https?:\/\//.test(values.update_url)) invalid('update_url', 'Enter the provider\'s update URL, or choose a provider');
  if (!/^[A-Za-z0-9*.-]+$/.test(values.domain)) invalid('domain', 'Enter the name to update, such as home.example.org');
  if (values.check_interval && !(/^\d+$/.test(values.check_interval) && Number(values.check_interval) >= 1)) invalid('check_interval', 'Minutes, at least 1');
  const options = compact({
   service_name: values.provider, update_url: values.provider ? '' : values.update_url, domain: values.domain, lookup_host: values.lookup_host || values.domain, username: values.username, password: values.password,
   use_ipv6: values.use_ipv6 ? '1' : '', interface: values.interface, ip_source: values.ip_source, ip_network: values.ip_source === 'network' ? values.ip_network : '',
   ip_interface: values.ip_source === 'interface' ? values.ip_interface : '', ip_url: values.ip_source === 'web' ? values.ip_url : '', check_interval: values.check_interval, check_unit: values.check_interval ? 'minutes' : ''
  });
  return row
   ? { description: `Change dynamic DNS ${name}`, ops: [{ op: 'set', config: 'ddns', section: name, values: options }] }
   : { description: `Add dynamic DNS ${name}`, ops: [{ op: 'add', config: 'ddns', type: 'service', name, values: { ...options, enabled: '1' } }] };
 },
 remove: rows => ({ description: `Remove dynamic DNS ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'ddns', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} dynamic DNS ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'ddns', section: row.section, values: { enabled: enable ? '1' : '0' } })) }),
 comment: (rows, comment) => ({ description: `Comment dynamic DNS ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'ddns', section: row.section, values: { comment: comment || null } })) }),
 tools: [{
  id: 'update', label: 'Update Now', enabled: rows => rows.length > 0,
  run: rows => ({ description: 'Restart dynamic DNS updates', calls: [['rc', 'init', { name: 'ddns', action: 'restart' }]], notice: `Updating ${rows.map(row => row.key).join(', ')}` })
 }]
};

/* --- Queues (SQM) ------------------------------------------------------ */

const SCRIPTS = ['piece_of_cake.qos', 'layer_cake.qos', 'simple.qos', 'simplest.qos', 'simplest_tbf.qos'];

export const sqmQueues = {
 id: 'sqm-queues',
 noun: 'Queue',
 sources: ['uci:sqm', 'devices', 'qdisc'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 90 },
  { id: 'interface', label: 'Interface', width: 80 },
  { id: 'download', label: 'Download', width: 90, align: 'right', sort: value => parseFloat(value) || 0 },
  { id: 'upload', label: 'Upload', width: 90, align: 'right', sort: value => parseFloat(value) || 0 },
  { id: 'qdisc', label: 'Queue Type', width: 80 },
  { id: 'script', label: 'Script', width: 120 },
  { id: 'sent', label: 'Sent', width: 90, align: 'right' },
  { id: 'dropped', label: 'Dropped', width: 70, align: 'right' }
 ],
 flagLegend: { X: 'disabled', R: 'shaping' },
 defaultSort: null,
 note: 'SQM shapes a WAN link a little below its real speed so queues stay short; set the speeds slightly under what the line delivers.',
 rows(data) {
  const speed = value => /^\d+$/.test(value ?? '') ? (Number(value) >= 1000 ? `${Number(value) / 1000} Mbps` : `${value} kbps`) : '';
  return sections(data['uci:sqm'], 'queue').map(section => {
   const disabled = !truthy(section.enabled);
   const live = data.qdisc?.devices?.[section.interface];
   const shaping = !disabled && live && live.handle !== '0:' && live.kind !== 'noqueue';
   return {
    key: section['.name'], section: section['.name'], disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (shaping ? 'R' : ''),
    cells: { name: section['.name'], interface: section.interface ?? '', download: speed(section.download), upload: speed(section.upload), qdisc: section.qdisc ?? 'fq_codel', script: section.script ?? 'simple.qos', sent: shaping ? bytes(live.bytes) : '', dropped: shaping ? count(live.dropped) : '' }
   };
  });
 },
 itemTitle: row => `Queue <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.flags.includes('R') ? 'shaping' : 'not shaping'],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'wan' },
  { id: 'interface', label: 'Interface', type: 'select', options: Object.values(data.devices ?? {}).filter(device => !device.flags?.loopback && device.name !== 'lo').map(device => ({ value: device.name, label: device.name })) },
  { id: 'download', label: 'Download (kbit/s)', type: 'number', placeholder: '0 = no shaping' },
  { id: 'upload', label: 'Upload (kbit/s)', type: 'number', placeholder: '0 = no shaping' },
  { id: 'qdisc', label: 'Queue Type', type: 'select', options: ['cake', 'fq_codel'].map(value => ({ value, label: value })) },
  { id: 'script', label: 'Script', type: 'select', options: SCRIPTS.map(value => ({ value, label: value })) },
  { id: 'linklayer', label: 'Link Layer', type: 'select', options: [{ value: 'none', label: 'none' }, { value: 'ethernet', label: 'Ethernet (VDSL, cable)' }, { value: 'atm', label: 'ATM (ADSL)' }], tab: 'Link Layer' },
  { id: 'overhead', label: 'Per-Packet Overhead', type: 'number', placeholder: '0', tab: 'Link Layer', visible: values => values.linklayer !== 'none' }
 ],
 values(row, data) {
  const section = sections(data['uci:sqm'], 'queue').find(item => item['.name'] === row.section) ?? {};
  return { name: row.key, interface: section.interface ?? '', download: section.download ?? '0', upload: section.upload ?? '0', qdisc: section.qdisc ?? 'cake', script: section.script ?? 'piece_of_cake.qos', linklayer: section.linklayer ?? 'none', overhead: section.overhead ?? '' };
 },
 defaults: data => ({ name: '', interface: Object.keys(data.devices ?? {}).find(name => name === 'eth1' || name === 'wan') ?? '', download: '0', upload: '0', qdisc: 'cake', script: 'piece_of_cake.qos', linklayer: 'none', overhead: '' }),
 save(values, row, data) {
  const name = row ? row.section : values.name.trim();
  if (!row && (!NAME.test(name) || sections(data['uci:sqm'], 'queue').some(section => section['.name'] === name))) invalid('name', 'Use a new name of letters, digits and underscores');
  if (!values.interface) invalid('interface', 'Choose the device to shape, usually the WAN');
  for (const id of ['download', 'upload']) if (!kbit(values[id] || '0')) invalid(id, 'Enter a speed in kbit/s');
  if (values.overhead && !/^-?\d+$/.test(values.overhead)) invalid('overhead', 'Overhead is a number of bytes');
  const options = compact({ interface: values.interface, download: values.download || '0', upload: values.upload || '0', qdisc: values.qdisc, script: values.script, linklayer: values.linklayer, overhead: values.linklayer === 'none' ? '' : values.overhead });
  return row
   ? { description: `Change queue ${name}`, ops: [{ op: 'set', config: 'sqm', section: name, values: options }] }
   : { description: `Add queue ${name}`, ops: [{ op: 'add', config: 'sqm', type: 'queue', name, values: { ...options, enabled: '1' } }] };
 },
 remove: rows => ({ description: `Remove queue ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'sqm', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} queue ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'sqm', section: row.section, values: { enabled: enable ? '1' : '0' } })) }),
 comment: (rows, comment) => ({ description: `Comment queue ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'sqm', section: row.section, values: { comment: comment || null } })) })
};

/* --- Simple Queues --------------------------------------------------------------- */

const LIMIT = /^\d+(\.\d+)?[kKmMgG]?$/;
const LIMIT_UNITS = { '': 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6, g: 1e9, G: 1e9 };
export const limitBits = text => { const match = /^(\d+(?:\.\d+)?)([kKmMgG]?)$/.exec(String(text ?? '')); return match ? Number(match[1]) * LIMIT_UNITS[match[2]] : null; };

// Per-address limits shaped by RouterDeck's queues script (HTB on the LAN
// device for download, on an ifb device for upload), like RouterOS's
// simple queues: target, max limit and a guaranteed rate.
export const simpleQueues = {
 id: 'simple-queues',
 noun: 'Simple Queue',
 sources: ['uci:routerdeck', 'uci:network', 'queuestats'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 120 },
  { id: 'target', label: 'Target', width: 170 },
  { id: 'max', label: 'Max Limit (up/down)', width: 130 },
  { id: 'rate', label: 'Rate (up/down)', width: 160 },
  { id: 'bytes', label: 'Bytes (up/down)', width: 150 },
  { id: 'interface', label: 'Interface', width: 70, hidden: true }
 ],
 flagLegend: { X: 'disabled', S: 'shaping on the router' },
 defaultSort: null,
 status: data => {
  const errors = Object.values(data.queuestats?.devices ?? {}).flatMap(device => device.errors ?? []).filter(error => !/Warning:/.test(error));
  return errors.length ? `tc: ${errors[0]}` : 'HTB on the LAN device and an ifb device; FastPath-offloaded connections are still shaped';
 },
 rows: data => sections(data['uci:routerdeck'], 'queue').map(section => {
  const disabled = truthy(section.disabled), name = section['.name'];
  const live = Object.values(data.queuestats?.devices ?? {}).map(device => device.queues?.[name]).find(Boolean);
  const rate = data.queuestats?.rates?.[name];
  return {
   key: name, section: name, disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (live ? 'S' : ''),
   cells: {
    name, target: list(section.target).join(', '), max: `${section.max_up || '∞'}/${section.max_down || '∞'}`,
    rate: rate ? `${bitrateText(rate.up)}/${bitrateText(rate.down)}` : '', bytes: live ? `${bytes(live.up?.[0] ?? 0)}/${bytes(live.down?.[0] ?? 0)}` : '', interface: section.interface ?? 'lan'
   }
  };
 }),
 itemTitle: row => `Simple Queue <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.flags.includes('S') ? 'shaping' : 'not set up'],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'laptop' },
  { id: 'target', label: 'Target', type: 'list' },
  { id: 'max_up', label: 'Max Upload', type: 'text', placeholder: '10M (no limit when empty)' },
  { id: 'max_down', label: 'Max Download', type: 'text', placeholder: '50M' },
  { id: 'limit_at_up', label: 'Limit At Upload', type: 'text', placeholder: 'guaranteed, such as 1M', tab: 'Advanced' },
  { id: 'limit_at_down', label: 'Limit At Download', type: 'text', placeholder: '5M', tab: 'Advanced' },
  { id: 'priority', label: 'Priority', type: 'select', tab: 'Advanced', options: ['1', '2', '3', '4', '5', '6', '7', '8'].map(value => ({ value, label: value === '1' ? '1 (highest)' : value === '8' ? '8 (lowest)' : value })) },
  { id: 'interface', label: 'LAN Network', type: 'select', tab: 'Advanced', options: networkOptions(data['uci:network'], section => section['.name'] !== 'loopback') }
 ],
 values: (row, data) => {
  const section = data['uci:routerdeck'][row.section] ?? {};
  return { name: row.key, target: list(section.target), max_up: section.max_up ?? '', max_down: section.max_down ?? '', limit_at_up: section.limit_at_up ?? '', limit_at_down: section.limit_at_down ?? '', priority: section.priority ?? '8', interface: section.interface ?? 'lan' };
 },
 defaults: () => ({ name: '', target: [], max_up: '', max_down: '', limit_at_up: '', limit_at_down: '', priority: '8', interface: 'lan' }),
 save(values, row, data) {
  const name = row ? row.section : String(values.name ?? '').trim();
  if (!row) {
   if (!NAME.test(name)) invalid('name', 'Use letters, digits and _');
   if (data['uci:routerdeck']?.[name]) invalid('name', `${name} is already used in /etc/config/routerdeck`);
  }
  if (!(values.target ?? []).length) invalid('target', 'Enter the addresses or networks to limit');
  for (const target of values.target) if (!parseCidr(target) && !/^[0-9a-fA-F:]+(\/\d{1,3})?$/.test(target)) invalid('target', `${target} is not an address or network`);
  for (const id of ['max_up', 'max_down', 'limit_at_up', 'limit_at_down']) if (values[id] && !LIMIT.test(values[id])) invalid(id, 'A rate such as 512k, 10M or 1G (bits per second)');
  if (!values.max_up && !values.max_down) invalid('max_down', 'Set an upload or a download limit');
  for (const [at, max] of [['limit_at_up', 'max_up'], ['limit_at_down', 'max_down']]) if (values[at] && values[max] && limitBits(values[at]) > limitBits(values[max])) invalid(at, 'The guaranteed rate cannot exceed the maximum');
  const options = compact({ target: values.target, max_up: values.max_up, max_down: values.max_down, limit_at_up: values.limit_at_up, limit_at_down: values.limit_at_down, priority: values.priority === '8' ? '' : values.priority, interface: values.interface === 'lan' ? '' : values.interface });
  return row
   ? { description: `Change simple queue ${name}`, ops: [{ op: 'set', config: 'routerdeck', section: name, values: options }] }
   : { description: `Add simple queue ${name}`, ops: [{ op: 'add', config: 'routerdeck', type: 'queue', name, values: Object.fromEntries(Object.entries(options).filter(([, value]) => value !== null)) }] };
 },
 remove: rows => ({ description: `Remove simple queue ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'routerdeck', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} simple queue ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment simple queue ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { comment: comment || null } })) })
};

function bitrateText(value) {
 if (!Number.isFinite(value)) return '—';
 const units = ['bps', 'kbps', 'Mbps', 'Gbps'];
 let index = 0;
 while (value >= 1000 && index < units.length - 1) { value /= 1000; index++; }
 return `${index ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}
