// SPDX-License-Identifier: Apache-2.0
// Interfaces > Interface: Linux network devices with live traffic rates.
// Bridges and VLANs are `config device` sections; physical ports get one only
// when their MTU, MAC or comment is changed, as LuCI does.
import { sections, list, invalid, NAME } from './common.js';
import { isMac } from '../lib/ip.js';
import { bitrate, rate, bytes, count } from '../lib/format.js';

const PHYSICAL = ['ethernet', 'loopback', 'wlan'];

function deviceType(device, section) {
 if (section?.type === '8021q' || section?.type === '8021ad') return 'vlan';
 if (section?.type === 'bridge' || device?.bridge) return 'bridge';
 if (device?.flags?.loopback) return 'loopback';
 return device?.devtype ?? (device?.wireless ? 'wlan' : section ? 'configured' : 'unknown');
}

const sectionFor = (data, name) => sections(data['uci:network'], 'device').find(section => section.name === name);

export default {
 id: 'interfaces',
 noun: 'Interface',
 sources: ['devices', 'uci:network'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'type', label: 'Type', width: 80 },
  { id: 'mtu', label: 'Actual MTU', width: 76, align: 'right', sort: value => Number(value) || 0 },
  { id: 'mac', label: 'MAC Address', width: 130 },
  { id: 'tx', label: 'Tx', width: 86, align: 'right', sort: (value, row) => row.rates?.tx_bps ?? -1 },
  { id: 'rx', label: 'Rx', width: 86, align: 'right', sort: (value, row) => row.rates?.rx_bps ?? -1 },
  { id: 'txp', label: 'Tx Packet (p/s)', width: 96, align: 'right', sort: value => Number(value) || 0 },
  { id: 'rxp', label: 'Rx Packet (p/s)', width: 96, align: 'right', sort: value => Number(value) || 0 },
  { id: 'master', label: 'Master', width: 80, hidden: true }
 ],
 flagLegend: { R: 'running', S: 'slave (bridge port)', D: 'dynamic', I: 'not present' },
 defaultSort: 'name',

 rows(data) {
  const devices = data.devices ?? {};
  const configured = sections(data['uci:network'], 'device').filter(section => section.name);
  const rows = Object.values(devices).map(device => {
   const section = configured.find(item => item.name === device.name);
   const type = deviceType(device, section);
   const running = device.up && device.link?.carrier !== false;
   const dynamic = !section && !PHYSICAL.includes(type);
   return {
    key: device.name, name: device.name, section: section?.['.name'], device, rates: device.rates, type, dynamic,
    flags: (dynamic ? 'D' : '') + (running ? 'R' : '') + (device.master ? 'S' : ''), comment: section?.comment,
    cells: {
     name: device.name, type, mtu: String(device.mtu ?? ''), mac: (device.mac ?? '').toUpperCase(),
     tx: bitrate(device.rates?.tx_bps), rx: bitrate(device.rates?.rx_bps), txp: rate(device.rates?.tx_pps), rxp: rate(device.rates?.rx_pps),
     master: device.master ?? ''
    }
   };
  });
  for (const section of configured.filter(section => !devices[section.name])) {
   const type = deviceType(null, section);
   rows.push({ key: section.name, name: section.name, section: section['.name'], type, invalid: true, flags: 'I', comment: section.comment,
    cells: { name: section.name, type, mtu: section.mtu ?? '', mac: (section.macaddr ?? '').toUpperCase(), tx: '', rx: '', txp: '', rxp: '', master: '' } });
  }
  return rows;
 },

 itemTitle: row => `Interface <${row?.name ?? 'new'}>`,
 findCreated: (rows, values) => rows.find(row => row.key === values.name.trim()),
 itemStatus: row => [row.flags.includes('R') ? 'running' : 'not running', row.device?.link?.carrier ? 'link ok' : row.device ? 'no link' : 'not present', row.flags.includes('S') ? 'slave' : null, row.dynamic ? 'dynamic' : null],
 addTypes: [{ id: 'bridge', label: 'Bridge' }, { id: 'vlan', label: 'VLAN' }],
 canAdd: () => true,
 canRemove: row => !!row.section && ['bridge', 'vlan'].includes(row.type),
 canComment: row => !row.dynamic,
 toggleHint: 'Disable the network that uses this device instead',

 fields(data, row, { addType } = {}) {
  const type = row?.type ?? (addType === 'vlan' ? 'vlan' : 'bridge');
  const ports = Object.values(data.devices ?? {}).filter(device => device.devtype === 'ethernet' || device.wireless).map(device => ({ value: device.name, label: device.name }));
  const fields = [
   { id: 'name', label: 'Name', type: row ? 'static' : 'text', required: true, placeholder: type === 'vlan' ? 'eth1.10' : 'br-guest' },
   { id: 'type', label: 'Type', type: 'static' },
   { id: 'mtu', label: 'MTU', type: 'number', placeholder: String(row?.device?.mtu ?? 1500) },
   { id: 'macaddr', label: 'MAC Address', type: 'text', placeholder: row?.cells.mac || 'automatic' }
  ];
  if (type === 'bridge') fields.push({ id: 'ports', label: 'Ports', type: 'multi', options: ports });
  if (type === 'vlan') fields.push(
   { id: 'ifname', label: 'Interface', type: 'select', required: true, options: ports },
   { id: 'vid', label: 'VLAN ID', type: 'number', required: true }
  );
  if (row?.device) fields.push(
   { id: 'status', label: 'Link', type: 'static', tab: 'Status' },
   { id: 'rxBytes', label: 'Rx Bytes', type: 'static', tab: 'Status' },
   { id: 'txBytes', label: 'Tx Bytes', type: 'static', tab: 'Status' },
   { id: 'rxPackets', label: 'Rx Packets', type: 'static', tab: 'Status' },
   { id: 'txPackets', label: 'Tx Packets', type: 'static', tab: 'Status' },
   { id: 'errors', label: 'Rx / Tx Errors', type: 'static', tab: 'Status' },
   { id: 'drops', label: 'Rx / Tx Drops', type: 'static', tab: 'Status' },
   { id: 'traffic', label: '', type: 'graph', tab: 'Traffic', graphLabel: `${row.name} traffic`, series: () => row.device?.history ?? [] }
  );
  return fields;
 },
 values(row, data) {
  const section = sectionFor(data, row.name) ?? {};
  const stats = row.device?.stats ?? {}, link = row.device?.link ?? {};
  return {
   name: row.name, type: row.type, mtu: section.mtu ?? '', macaddr: section.macaddr ?? '', ports: list(section.ports),
   ifname: section.ifname ?? '', vid: section.vid ?? '',
   status: link.carrier ? `up${link.speed > 0 ? `, ${link.speed} Mbps ${link.duplex ?? ''}` : ''}` : 'down',
   rxBytes: bytes(stats.rx_bytes), txBytes: bytes(stats.tx_bytes), rxPackets: count(stats.rx_packets), txPackets: count(stats.tx_packets),
   errors: `${count(stats.rx_errors)} / ${count(stats.tx_errors)}`, drops: `${count(stats.rx_dropped)} / ${count(stats.tx_dropped)}`
  };
 },
 defaults: (data, { addType } = {}) => ({ name: '', type: addType === 'vlan' ? 'vlan' : 'bridge', mtu: '', macaddr: '', ports: [], ifname: '', vid: '' }),

 save(values, row, data, { dirty = null } = {}) {
  const name = row ? row.name : values.name.trim();
  if (!row) {
   if (!/^[A-Za-z0-9_.-]{1,15}$/.test(name)) invalid('name', 'Use up to 15 letters, digits, dots, dashes or underscores');
   if (data.devices?.[name] || sectionFor(data, name)) invalid('name', `${name} already exists`);
  }
  if (values.mtu && !(/^\d+$/.test(values.mtu) && values.mtu >= 576 && values.mtu <= 9000)) invalid('mtu', 'MTU is a number from 576 to 9000');
  if (values.macaddr && !isMac(values.macaddr)) invalid('macaddr', 'Enter a MAC address such as 02:00:00:00:00:01');
  const options = { mtu: values.mtu || null, macaddr: values.macaddr ? values.macaddr.toLowerCase() : null };
  if (values.type === 'bridge') options.ports = values.ports ?? [];
  if (values.type === 'vlan') {
   if (!values.ifname) invalid('ifname', 'Choose the parent interface');
   if (!(/^\d+$/.test(values.vid) && values.vid >= 1 && values.vid <= 4094)) invalid('vid', 'VLAN ID is a number from 1 to 4094');
   Object.assign(options, { ifname: values.ifname, vid: String(values.vid) });
  }
  if (!row) {
   if (!NAME.test(name.replace(/[.-]/g, '_'))) invalid('name', 'Invalid device name');
   return { description: `Add ${values.type === 'vlan' ? 'VLAN' : 'bridge'} ${name}`, ops: [{ op: 'add', config: 'network', type: 'device', values: { name, type: values.type === 'vlan' ? '8021q' : 'bridge', ...options } }] };
  }
  const changes = Object.fromEntries(Object.entries(options).filter(([key]) => !dirty || dirty.has(key)));
  if (!Object.keys(changes).length) return null;
  const description = `Change interface ${name}`;
  if (row.section) return { description, ops: [{ op: 'set', config: 'network', section: row.section, values: changes }] };
  return { description, ops: [{ op: 'add', config: 'network', type: 'device', values: { name, ...changes } }] };
 },
 remove: rows => ({ description: `Remove interface ${rows.map(row => row.name).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'network', section: row.section })) }),
 comment: (rows, comment) => ({
  description: `Comment interface ${rows.map(row => row.name).join(', ')}`,
  ops: rows.map(row => row.section
   ? { op: 'set', config: 'network', section: row.section, values: { comment: comment || null } }
   : { op: 'add', config: 'network', type: 'device', values: { name: row.name, comment: comment || null } })
 })
};
