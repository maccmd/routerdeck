// SPDX-License-Identifier: Apache-2.0
// PPP: point-to-point client networks (PPPoE and plain PPP). In OpenWrt they
// are `interface` sections with a PPP protocol; netifd runs pppd for them.
import { sections, truthy, invalid, NAME, zonesOf, zoneOptions, compact } from './common.js';
import { zoneMembership } from './networks.js';
import { uptime } from '../lib/format.js';

const PPP = ['pppoe', 'ppp', 'pppoa', 'l2tp', 'pptp'];

export const pppClients = {
 id: 'ppp',
 noun: 'PPP Client',
 sources: ['uci:network', 'uci:firewall', 'ifaces', 'devices', 'protos'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 100 },
  { id: 'type', label: 'Type', width: 70 },
  { id: 'device', label: 'Device', width: 90 },
  { id: 'user', label: 'User', width: 120 },
  { id: 'service', label: 'Service', width: 90 },
  { id: 'uptime', label: 'Uptime', width: 100, sort: (value, row) => row.uptime ?? -1 },
  { id: 'local', label: 'Local Address', width: 120 },
  { id: 'remote', label: 'Remote Address', width: 120 },
  { id: 'zone', label: 'Firewall Zone', width: 90, hidden: true }
 ],
 flagLegend: { R: 'connected', X: 'disabled' },
 defaultSort: null,
 status: data => data.protos && !Object.hasOwn(data.protos, 'pppoe') ? 'PPPoE needs the ppp-mod-pppoe package' : '',
 rows(data) {
  const runtime = new Map((data.ifaces ?? []).map(item => [item.interface, item]));
  return sections(data['uci:network'], 'interface').filter(section => PPP.includes(section.proto)).map(section => {
   const name = section['.name'], live = runtime.get(name);
   const disabled = truthy(section.disabled);
   const address = live?.['ipv4-address']?.[0];
   return {
    key: name, section: name, disabled, comment: section.comment, uptime: live?.up ? live.uptime : null,
    flags: (disabled ? 'X' : '') + (live?.up ? 'R' : ''),
    cells: {
     name, type: section.proto, device: live?.l3_device ?? section.device ?? '', user: section.username ?? '', service: section.service ?? '',
     uptime: live?.up ? uptime(live.uptime) : '', local: address ? address.address : '', remote: address?.ptpaddress ?? live?.route?.[0]?.nexthop ?? '',
     zone: zonesOf(data['uci:firewall'], name).join(', ')
    }
   };
  });
 },
 itemTitle: row => `PPP Client <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.flags.includes('R') ? 'connected' : 'disconnected'],
 canAdd: data => !data.protos || Object.hasOwn(data.protos, 'pppoe'),
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', required: true, placeholder: 'pppoe_out' },
  { id: 'proto', label: 'Type', type: row ? 'static' : 'select', options: PPP.filter(proto => !data.protos || Object.hasOwn(data.protos, proto)).map(value => ({ value, label: value })) },
  { id: 'device', label: 'Device', type: 'select', allowEmpty: true, options: Object.values(data.devices ?? {}).filter(device => device.devtype === 'ethernet' || device.devtype === 'vlan' || device.bridge).map(device => ({ value: device.name, label: device.name })) },
  { id: 'username', label: 'User', type: 'text' },
  { id: 'password', label: 'Password', type: 'password' },
  { id: 'service', label: 'Service Name', type: 'text', visible: values => values.proto === 'pppoe', placeholder: 'any' },
  { id: 'ac', label: 'AC Name', type: 'text', visible: values => values.proto === 'pppoe', placeholder: 'any' },
  { id: 'peerdns', label: 'Use Peer DNS', type: 'bool' },
  { id: 'defaultroute', label: 'Add Default Route', type: 'bool' },
  { id: 'keepalive', label: 'Keepalive', type: 'text', placeholder: '5 1 (failures, interval)' },
  { id: 'mtu', label: 'MTU', type: 'number', placeholder: '1492' },
  { id: 'zone', label: 'Firewall Zone', type: 'select', allowEmpty: true, options: zoneOptions(data['uci:firewall']) }
 ],
 values(row, data) {
  const section = sections(data['uci:network'], 'interface').find(item => item['.name'] === row.section) ?? {};
  return {
   name: row.key, proto: section.proto, device: section.device ?? '', username: section.username ?? '', password: section.password ?? '', service: section.service ?? '', ac: section.ac ?? '',
   peerdns: truthy(section.peerdns, true), defaultroute: truthy(section.defaultroute, true), keepalive: section.keepalive ?? '', mtu: section.mtu ?? '', zone: zonesOf(data['uci:firewall'], row.key)[0] ?? ''
  };
 },
 defaults: data => ({ name: '', proto: 'pppoe', device: '', username: '', password: '', service: '', ac: '', peerdns: true, defaultroute: true, keepalive: '', mtu: '', zone: zoneOptions(data['uci:firewall']).find(zone => zone.value === 'wan')?.value ?? '' }),
 save(values, row, data, { dirty = null } = {}) {
  const name = row ? row.section : values.name.trim();
  if (!row) {
   if (!NAME.test(name)) invalid('name', 'Use letters, digits and underscores');
   if (sections(data['uci:network'], 'interface').some(section => section['.name'] === name)) invalid('name', `${name} already exists`);
  }
  if (values.proto === 'pppoe' && !values.device) invalid('device', 'PPPoE needs the Ethernet device it dials on');
  if (values.keepalive && !/^\d+( \d+)?$/.test(values.keepalive)) invalid('keepalive', 'Use failures and interval, for example 5 1');
  if (values.mtu && !(/^\d+$/.test(values.mtu) && values.mtu >= 576 && values.mtu <= 1500)) invalid('mtu', 'MTU is 576 to 1500');
  const options = compact({
   proto: values.proto, device: values.device, username: values.username, password: values.password,
   service: values.proto === 'pppoe' ? values.service : '', ac: values.proto === 'pppoe' ? values.ac : '',
   peerdns: values.peerdns ? '' : '0', defaultroute: values.defaultroute ? '' : '0', keepalive: values.keepalive, mtu: values.mtu
  });
  const ops = [];
  if (row) {
   const changes = Object.fromEntries(Object.entries(options).filter(([key]) => !dirty || dirty.has(key)));
   if (Object.keys(changes).length) ops.push({ op: 'set', config: 'network', section: name, values: changes });
  } else ops.push({ op: 'add', config: 'network', type: 'interface', name, values: options });
  if (!row || !dirty || dirty.has('zone')) ops.push(...zoneMembership(data, name, values.zone));
  return ops.length ? { description: row ? `Change PPP client ${name}` : `Add ${values.proto} client ${name}`, ops } : null;
 },
 remove: (rows, data) => ({ description: `Remove PPP client ${rows.map(row => row.key).join(', ')}`, ops: rows.flatMap(row => [{ op: 'delete', config: 'network', section: row.section }, ...zoneMembership(data, row.section, '')]) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} PPP client ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment PPP client ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) })
};

