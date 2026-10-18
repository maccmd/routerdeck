// SPDX-License-Identifier: Apache-2.0
// Bridge: bridges (`config device` of type bridge), their ports (the device's
// `ports` list) and VLANs (`config bridge-vlan`). A bridge with any VLAN
// section filters VLANs; ports in a VLAN are tagged (":t") or untagged, and
// "*" marks the port's PVID.
import { sections, list, truthy, invalid, compact } from './common.js';
import { isMac } from '../lib/ip.js';
import { bitrate } from '../lib/format.js';

const bridgesOf = data => sections(data['uci:network'], 'device').filter(section => section.type === 'bridge' && section.name);
const vlansOf = (data, bridge) => sections(data['uci:network'], 'bridge-vlan').filter(section => section.device === bridge);

// "eth1:t*" -> { port: 'eth1', tagged: true, pvid: true }
export function parseVlanPort(entry) {
 const [port, flags = ''] = String(entry).split(':');
 return { port, tagged: flags.includes('t'), pvid: flags.includes('*') };
}
const formatVlanPort = ({ port, tagged, pvid }) => `${port}:${tagged ? 't' : 'u'}${pvid ? '*' : ''}`;

function pvidOf(data, bridge, port) {
 const untagged = vlansOf(data, bridge).flatMap(vlan => list(vlan.ports).map(parseVlanPort).filter(item => item.port === port && !item.tagged).map(item => ({ ...item, vid: vlan.vlan })));
 return (untagged.find(item => item.pvid) ?? (untagged.length === 1 ? untagged[0] : null))?.vid ?? '';
}

function usersOf(data, bridge) {
 return sections(data['uci:network'], 'interface').filter(section => section.device === bridge || String(section.device ?? '').startsWith(bridge + '.')).map(section => section['.name']);
}

const portOptions = data => Object.values(data.devices ?? {})
 .filter(device => (device.devtype === 'ethernet' || device.devtype === 'vlan' || device.wireless) && !device.bridge)
 .map(device => ({ value: device.name, label: device.name }))
 .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));

export const bridges = {
 id: 'bridges',
 noun: 'Bridge',
 sources: ['uci:network', 'devices', 'netdev'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'mtu', label: 'Actual MTU', width: 76, align: 'right', sort: value => Number(value) || 0 },
  { id: 'mac', label: 'MAC Address', width: 130 },
  { id: 'ports', label: 'Ports', width: 150 },
  { id: 'stp', label: 'STP', width: 50 },
  { id: 'igmp', label: 'IGMP Snooping', width: 100 },
  { id: 'vlan', label: 'VLAN Filtering', width: 96 },
  { id: 'tx', label: 'Tx', width: 86, align: 'right', hidden: true },
  { id: 'rx', label: 'Rx', width: 86, align: 'right', hidden: true }
 ],
 flagLegend: { R: 'running', D: 'dynamic', I: 'not created yet: OpenWrt creates a bridge once a network uses it' },
 defaultSort: 'name',
 note: 'OpenWrt creates a bridge once a network uses it. A bridge filters VLANs as soon as it has one.',

 rows(data) {
  const devices = data.devices ?? {}, status = data.netdev ?? {};
  const rows = bridgesOf(data).map(section => {
   const device = devices[section.name], live = status[section.name];
   const filtering = live?.['bridge-attributes']?.vlan_filtering ?? vlansOf(data, section.name).length > 0;
   return {
    key: section.name, name: section.name, section: section['.name'], device, comment: section.comment, invalid: !device,
    flags: device ? (device.up ? 'R' : '') : 'I',
    cells: {
     name: section.name, mtu: String(device?.mtu ?? section.mtu ?? ''), mac: (device?.mac ?? section.macaddr ?? '').toUpperCase(),
     ports: list(section.ports).join(' '), stp: truthy(section.stp) ? 'yes' : '', igmp: truthy(section.igmp_snooping) ? 'yes' : '',
     vlan: filtering ? 'yes' : '', tx: bitrate(device?.rates?.tx_bps), rx: bitrate(device?.rates?.rx_bps)
    }
   };
  });
  for (const device of Object.values(devices).filter(device => device.bridge && !rows.some(row => row.key === device.name))) {
   rows.push({
    key: device.name, name: device.name, device, dynamic: true, readOnly: true, flags: 'D' + (device.up ? 'R' : ''),
    cells: { name: device.name, mtu: String(device.mtu ?? ''), mac: (device.mac ?? '').toUpperCase(), ports: (device.ports ?? []).join(' '), stp: '', igmp: '', vlan: '', tx: bitrate(device.rates?.tx_bps), rx: bitrate(device.rates?.rx_bps) }
   });
  }
  return rows;
 },

 itemTitle: row => `Bridge <${row?.name ?? 'new'}>`,
 itemStatus: row => [row.invalid ? 'not created: no network uses it' : row.flags.includes('R') ? 'running' : 'not running', row.cells?.vlan ? 'VLAN filtering' : null, row.dynamic ? 'dynamic' : null],
 findCreated: (rows, values) => rows.find(row => row.key === values.name.trim()),
 canAdd: () => true,
 canRemove: row => !row.readOnly,
 canComment: row => !row.readOnly,
 toggleHint: 'Disable the network that uses this bridge instead',

 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', required: true, placeholder: 'br-guest' },
  { id: 'mtu', label: 'MTU', type: 'number', placeholder: row?.cells.mtu || '1500' },
  { id: 'macaddr', label: 'MAC Address', type: 'text', placeholder: row?.cells.mac || 'automatic' },
  { id: 'stp', label: 'STP', type: 'bool' },
  { id: 'igmp_snooping', label: 'IGMP Snooping', type: 'bool' },
  { id: 'bridge_empty', label: 'Up Without Ports', type: 'bool' },
  { id: 'ports', label: 'Ports', type: 'static', tab: 'Status' },
  { id: 'vlan', label: 'VLAN Filtering', type: 'static', tab: 'Status' }
 ],
 values(row, data) {
  const section = bridgesOf(data).find(item => item.name === row.name) ?? {};
  return { name: row.name, mtu: section.mtu ?? '', macaddr: section.macaddr ?? '', stp: truthy(section.stp), igmp_snooping: truthy(section.igmp_snooping), bridge_empty: truthy(section.bridge_empty), ports: row.cells.ports || 'none', vlan: row.cells.vlan || 'no' };
 },
 defaults: () => ({ name: '', mtu: '', macaddr: '', stp: false, igmp_snooping: false, bridge_empty: true, ports: '', vlan: '' }),

 save(values, row, data, { dirty = null } = {}) {
  const name = row ? row.name : values.name.trim();
  if (!row) {
   if (!/^[A-Za-z0-9_.-]{1,15}$/.test(name)) invalid('name', 'Use up to 15 letters, digits, dots, dashes or underscores');
   if (data.devices?.[name] || sections(data['uci:network'], 'device').some(section => section.name === name)) invalid('name', `${name} already exists`);
  }
  if (values.mtu && !(/^\d+$/.test(values.mtu) && values.mtu >= 576 && values.mtu <= 9000)) invalid('mtu', 'MTU is a number from 576 to 9000');
  if (values.macaddr && !isMac(values.macaddr)) invalid('macaddr', 'Enter a MAC address such as 02:00:00:00:00:01');
  const options = compact({ mtu: values.mtu, macaddr: values.macaddr.toLowerCase(), stp: values.stp ? '1' : '', igmp_snooping: values.igmp_snooping ? '1' : '', bridge_empty: values.bridge_empty ? '1' : '' });
  if (!row) return { description: `Add bridge ${name}`, ops: [{ op: 'add', config: 'network', type: 'device', values: { name, type: 'bridge', ...options } }] };
  const changes = Object.fromEntries(Object.entries(options).filter(([key]) => !dirty || dirty.has(key)));
  return Object.keys(changes).length ? { description: `Change bridge ${name}`, ops: [{ op: 'set', config: 'network', section: row.section, values: changes }] } : null;
 },
 removeBlocked(rows, data) {
  for (const row of rows) {
   const users = usersOf(data, row.name);
   if (users.length) return `Bridge ${row.name} is used by network ${users.join(', ')}`;
  }
  return null;
 },
 remove: (rows, data) => ({
  description: `Remove bridge ${rows.map(row => row.name).join(', ')}`,
  ops: rows.flatMap(row => [{ op: 'delete', config: 'network', section: row.section }, ...vlansOf(data, row.name).map(vlan => ({ op: 'delete', config: 'network', section: vlan['.name'] }))])
 }),
 comment: (rows, comment) => ({ description: `Comment bridge ${rows.map(row => row.name).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) })
};

// Remove a port from a bridge and from that bridge's VLANs.
function detachOps(data, bridge, port) {
 const section = bridgesOf(data).find(item => item.name === bridge);
 const ops = [{ op: 'set', config: 'network', section: section['.name'], values: { ports: list(section.ports).filter(item => item !== port) } }];
 for (const vlan of vlansOf(data, bridge)) {
  const ports = list(vlan.ports);
  const kept = ports.filter(entry => parseVlanPort(entry).port !== port);
  if (kept.length !== ports.length) ops.push({ op: 'set', config: 'network', section: vlan['.name'], values: { ports: kept } });
 }
 return ops;
}

export const bridgePorts = {
 id: 'bridge-ports',
 noun: 'Bridge Port',
 sources: ['uci:network', 'devices'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'interface', label: 'Interface', width: 110 },
  { id: 'bridge', label: 'Bridge', width: 100 },
  { id: 'pvid', label: 'PVID', width: 56, align: 'right', sort: value => Number(value) || 0 },
  { id: 'tagged', label: 'Tagged VLANs', width: 120 },
  { id: 'link', label: 'Link', width: 120 }
 ],
 flagLegend: { R: 'running', I: 'not present', D: 'dynamic (added by another service)' },
 defaultSort: null,

 rows(data) {
  const devices = data.devices ?? {}, rows = [];
  for (const bridge of bridgesOf(data)) {
   const configured = list(bridge.ports);
   const tagged = port => vlansOf(data, bridge.name).filter(vlan => list(vlan.ports).map(parseVlanPort).some(item => item.port === port && item.tagged)).map(vlan => vlan.vlan).join(' ');
   const linkOf = device => !device ? '' : device.link?.carrier ? `up${device.link.speed > 0 ? ` ${device.link.speed} Mbps` : ''}` : 'down';
   for (const port of configured) {
    const device = devices[port];
    rows.push({
     key: `${bridge.name}:${port}`, port, bridge: bridge.name, invalid: !device, flags: !device ? 'I' : device.up && device.link?.carrier !== false ? 'R' : '',
     cells: { interface: port, bridge: bridge.name, pvid: String(pvidOf(data, bridge.name, port)), tagged: tagged(port), link: linkOf(device) }
    });
   }
   // Wireless and other services add members at runtime.
   for (const port of (devices[bridge.name]?.ports ?? []).filter(port => !configured.includes(port))) {
    rows.push({ key: `${bridge.name}:${port}`, port, bridge: bridge.name, dynamic: true, readOnly: true, flags: 'D' + (devices[port]?.up ? 'R' : ''), cells: { interface: port, bridge: bridge.name, pvid: '', tagged: '', link: linkOf(devices[port]) } });
   }
  }
  return rows;
 },

 itemTitle: row => `Bridge Port <${row?.port ?? 'new'}>`,
 itemStatus: row => [row.flags.includes('R') ? 'running' : 'not running', row.dynamic ? 'dynamic' : null],
 findCreated: (rows, values) => rows.find(row => row.port === values.interface && row.bridge === values.bridge),
 canAdd: data => bridgesOf(data).length > 0,
 canRemove: row => !row.readOnly,
 toggleHint: 'Remove the port from the bridge instead',
 commentHint: 'OpenWrt has no comment for a bridge port',

 fields: (data, row) => [
  { id: 'interface', label: 'Interface', type: 'select', required: true, options: portOptions(data) },
  { id: 'bridge', label: 'Bridge', type: 'select', required: true, options: bridgesOf(data).map(bridge => ({ value: bridge.name, label: bridge.name })) },
  { id: 'pvid', label: 'PVID', type: 'static', value: values => String(pvidOf(data, values.bridge, values.interface) || 'none (set it in VLANs)') }
 ],
 values: row => ({ interface: row.port, bridge: row.bridge }),
 defaults: data => {
  const used = new Set(bridgesOf(data).flatMap(bridge => list(bridge.ports)));
  return { interface: portOptions(data).find(option => !used.has(option.value))?.value ?? '', bridge: bridgesOf(data)[0]?.name ?? '' };
 },

 save(values, row, data) {
  if (!values.interface) invalid('interface', 'Choose a port');
  const bridge = bridgesOf(data).find(item => item.name === values.bridge);
  if (!bridge) invalid('bridge', 'Choose a bridge');
  if (row && row.port === values.interface && row.bridge === values.bridge) return null;
  const owner = bridgesOf(data).find(item => list(item.ports).includes(values.interface) && !(row && item.name === row.bridge && values.interface === row.port));
  if (owner) invalid('interface', `${values.interface} is already a port of ${owner.name}`);
  const ops = row ? detachOps(data, row.bridge, row.port) : [];
  const ports = row && row.bridge === bridge.name ? list(bridge.ports).filter(item => item !== row.port) : list(bridge.ports);
  const target = ops.find(op => op.section === bridge['.name'] && 'ports' in op.values);
  if (target) target.values.ports = [...target.values.ports, values.interface];
  else ops.push({ op: 'set', config: 'network', section: bridge['.name'], values: { ports: [...ports, values.interface] } });
  return { description: row ? `Move bridge port ${row.port} to ${values.interface} on ${bridge.name}` : `Add ${values.interface} to bridge ${bridge.name}`, ops };
 },
 remove(rows, data) {
  // Each removal is computed from the same data; intersecting the resulting
  // port lists of a section combines several removals into one write.
  const ops = [];
  for (const row of rows.filter(row => !row.readOnly)) ops.push(...detachOps(data, row.bridge, row.port));
  const merged = new Map();
  for (const op of ops) merged.set(op.section, { ...op, values: { ports: (merged.get(op.section)?.values.ports ?? op.values.ports).filter(entry => op.values.ports.includes(entry)) } });
  return { description: `Remove bridge port ${rows.map(row => row.port).join(', ')}`, ops: [...merged.values()] };
 }
};

export const bridgeVlans = {
 id: 'bridge-vlans',
 noun: 'Bridge VLAN',
 sources: ['uci:network', 'netdev'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'bridge', label: 'Bridge', width: 100 },
  { id: 'vlan', label: 'VLAN ID', width: 64, align: 'right', sort: value => Number(value) || 0 },
  { id: 'tagged', label: 'Tagged', width: 150 },
  { id: 'untagged', label: 'Untagged', width: 150 },
  { id: 'pvid', label: 'PVID Ports', width: 120 },
  { id: 'local', label: 'Bridge Member', width: 96, hidden: true }
 ],
 flagLegend: { I: 'not active on the bridge' },
 defaultSort: null,
 note: 'Adding the first VLAN turns on VLAN filtering for that bridge. Use Safe Mode when it carries your connection.',

 rows(data) {
  return sections(data['uci:network'], 'bridge-vlan').map(section => {
   const ports = list(section.ports).map(parseVlanPort);
   const live = (data.netdev?.[section.device]?.['bridge-vlans'] ?? []).some(vlan => String(vlan.id) === String(section.vlan));
   return {
    key: section['.name'], section: section['.name'], comment: section.comment, invalid: !live, flags: live ? '' : 'I',
    cells: {
     bridge: section.device ?? '', vlan: String(section.vlan ?? ''), tagged: ports.filter(item => item.tagged).map(item => item.port).join(' '),
     untagged: ports.filter(item => !item.tagged).map(item => item.port).join(' '), pvid: ports.filter(item => item.pvid).map(item => item.port).join(' '),
     local: truthy(section.local, true) ? 'yes' : 'no'
    }
   };
  });
 },

 itemTitle: row => `Bridge VLAN <${row ? `${row.cells.bridge} ${row.cells.vlan}` : 'new'}>`,
 itemStatus: row => [row.invalid ? 'not active' : 'active'],
 canAdd: data => bridgesOf(data).length > 0,
 canRemove: () => true,
 canComment: () => true,
 toggleHint: 'Bridge VLANs cannot be disabled; remove the VLAN instead',

 fields(data) {
  const ports = values => list(bridgesOf(data).find(bridge => bridge.name === values.bridge)?.ports).map(port => ({ value: port, label: port }));
  return [
   { id: 'bridge', label: 'Bridge', type: 'select', required: true, options: bridgesOf(data).map(bridge => ({ value: bridge.name, label: bridge.name })) },
   { id: 'vlan', label: 'VLAN ID', type: 'number', required: true, placeholder: '10' },
   { id: 'tagged', label: 'Tagged', type: 'multi', options: ports },
   { id: 'untagged', label: 'Untagged', type: 'multi', options: ports },
   { id: 'pvid', label: 'PVID Ports', type: 'multi', options: values => (values.untagged ?? []).map(port => ({ value: port, label: port })) },
   { id: 'local', label: 'Bridge Member', type: 'bool' }
  ];
 },
 values(row, data) {
  const section = sections(data['uci:network'], 'bridge-vlan').find(item => item['.name'] === row.section) ?? {};
  const ports = list(section.ports).map(parseVlanPort);
  return { bridge: section.device ?? '', vlan: String(section.vlan ?? ''), tagged: ports.filter(item => item.tagged).map(item => item.port), untagged: ports.filter(item => !item.tagged).map(item => item.port), pvid: ports.filter(item => item.pvid).map(item => item.port), local: truthy(section.local, true) };
 },
 defaults: data => ({ bridge: bridgesOf(data)[0]?.name ?? '', vlan: '', tagged: [], untagged: [], pvid: [], local: true }),

 save(values, row, data) {
  const bridge = bridgesOf(data).find(item => item.name === values.bridge);
  if (!bridge) invalid('bridge', 'Choose a bridge');
  if (!(/^\d+$/.test(values.vlan) && values.vlan >= 1 && values.vlan <= 4094)) invalid('vlan', 'VLAN ID is a number from 1 to 4094');
  const others = vlansOf(data, bridge.name).filter(vlan => vlan['.name'] !== row?.section);
  if (others.some(vlan => String(vlan.vlan) === String(Number(values.vlan)))) invalid('vlan', `VLAN ${values.vlan} already exists on ${bridge.name}`);
  const both = values.tagged.filter(port => values.untagged.includes(port));
  if (both.length) invalid('untagged', `${both.join(', ')} cannot be tagged and untagged in the same VLAN`);
  const pvid = values.pvid.filter(port => values.untagged.includes(port));
  for (const port of pvid) {
   const clash = others.find(vlan => list(vlan.ports).map(parseVlanPort).some(item => item.port === port && item.pvid));
   if (clash) invalid('pvid', `${port} already has PVID ${clash.vlan}`);
  }
  const ports = [...values.tagged.map(port => ({ port, tagged: true, pvid: false })), ...values.untagged.map(port => ({ port, tagged: false, pvid: pvid.includes(port) }))].map(formatVlanPort);
  const options = { device: bridge.name, vlan: String(Number(values.vlan)), ports, local: values.local ? null : '0' };
  return row
   ? { description: `Change VLAN ${options.vlan} on ${bridge.name}`, ops: [{ op: 'set', config: 'network', section: row.section, values: options }] }
   : { description: `Add VLAN ${options.vlan} to ${bridge.name}`, ops: [{ op: 'add', config: 'network', type: 'bridge-vlan', values: options }] };
 },
 remove: rows => ({ description: `Remove bridge VLAN ${rows.map(row => `${row.cells.bridge} ${row.cells.vlan}`).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'network', section: row.section })) }),
 comment: (rows, comment) => ({ description: `Comment bridge VLAN ${rows.map(row => `${row.cells.bridge} ${row.cells.vlan}`).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) })
};
