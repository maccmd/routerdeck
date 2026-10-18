// SPDX-License-Identifier: Apache-2.0
// IP > Routes: kernel routes merged with static `route` sections. A static
// route present in the kernel is active (A); kernel-only routes are dynamic.
import { sections, truthy, invalid, networkOptions, compact } from './common.js';
import { parseCidr, maskToPrefix, isIPv4, addressKey } from '../lib/ip.js';

const TYPES = ['unicast', 'blackhole', 'unreachable', 'prohibit', 'throw'];

function staticTarget(section) {
 if (String(section.target ?? '').includes('/')) return parseCidr(section.target)?.cidr ?? section.target;
 const prefix = section.netmask ? maskToPrefix(section.netmask) : 32;
 return parseCidr(`${section.target}/${prefix}`)?.cidr ?? section.target;
}

function kernelDst(route) {
 if (route.dst === 'default') return '0.0.0.0/0';
 return route.dst.includes('/') ? route.dst : `${route.dst}/32`;
}

export default {
 id: 'routes',
 noun: 'Route',
 sources: ['uci:network', 'routes4', 'ifaces'],
 columns: [
  { id: 'flags', label: '', width: 40 },
  { id: 'dst', label: 'Dst. Address', width: 140, sort: addressKey },
  { id: 'gateway', label: 'Gateway', width: 120, sort: addressKey },
  { id: 'distance', label: 'Distance', width: 64, align: 'right', sort: value => Number(value) || 0 },
  { id: 'table', label: 'Routing Table', width: 96 },
  { id: 'prefsrc', label: 'Pref. Source', width: 110 },
  { id: 'interface', label: 'Interface', width: 120 },
  { id: 'type', label: 'Type', width: 80, hidden: true },
  { id: 'protocol', label: 'Protocol', width: 70, hidden: true }
 ],
 flagLegend: { X: 'disabled', D: 'dynamic', A: 'active', C: 'connect', S: 'static' },
 defaultSort: 'dst',
 filter: {
  id: 'table', label: 'Routing table', default: 'main',
  options: rows => ['all', ...new Set(rows.map(row => row.cells.table))].map(value => ({ value, label: value })),
  match: (row, value) => value === 'all' || row.cells.table === value
 },

 rows(data) {
  const devices = new Map((data.ifaces ?? []).map(item => [item.interface, item.l3_device ?? item.device]));
  const kernel = (data.routes4 ?? []).map(route => ({ route, dst: kernelDst(route), table: route.table ?? 'main', used: false }));
  const rows = [];
  for (const section of sections(data['uci:network'], 'route')) {
   const dst = staticTarget(section), table = section.table ?? 'main', type = section.type ?? 'unicast';
   const device = devices.get(section.interface);
   const disabled = truthy(section.disabled);
   const match = disabled ? null : kernel.find(entry => !entry.used && entry.dst === dst && entry.table === table &&
    (entry.route.type ?? 'unicast') === type && (!section.gateway || entry.route.gateway === section.gateway) && (!device || !entry.route.dev || entry.route.dev === device));
   if (match) match.used = true;
   rows.push({
    key: section['.name'], section: section['.name'],
    flags: (disabled ? 'X' : '') + (match ? 'A' : '') + 'S', disabled, comment: section.comment,
    cells: {
     dst, gateway: section.gateway ?? '', distance: section.metric ?? '0', table, prefsrc: section.source ?? match?.route.prefsrc ?? '',
     interface: device ? `${device} (${section.interface})` : section.interface ?? '', type, protocol: 'static'
    }
   });
  }
  for (const entry of kernel.filter(entry => !entry.used)) {
   const { route } = entry;
   const connect = route.protocol === 'kernel' && route.scope === 'link';
   rows.push({
    key: `kernel:${entry.table}:${entry.dst}:${route.gateway ?? ''}:${route.dev ?? ''}:${route.type ?? ''}:${route.metric ?? 0}`,
    dynamic: true, readOnly: true, route,
    flags: 'DA' + (connect ? 'C' : ''),
    cells: {
     dst: entry.dst, gateway: route.gateway ?? '', distance: String(route.metric ?? 0), table: entry.table, prefsrc: route.prefsrc ?? '',
     interface: route.dev ?? '', type: route.type ?? 'unicast', protocol: route.protocol ?? ''
    }
   });
  }
  return rows;
 },

 itemTitle: row => `Route <${row?.cells.dst ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled', row.flags.includes('A') ? 'active' : 'inactive', row.dynamic ? 'dynamic' : 'static'],
 canAdd: () => true,
 canRemove: row => !row.readOnly,
 canToggle: row => !row.readOnly,
 canComment: row => !row.readOnly,

 fields(data, row) {
  if (row?.readOnly) {
   return [
    { id: 'dst', label: 'Dst. Address', type: 'static' },
    { id: 'gateway', label: 'Gateway', type: 'static' },
    { id: 'interface', label: 'Interface', type: 'static' },
    { id: 'distance', label: 'Distance', type: 'static' },
    { id: 'table', label: 'Routing Table', type: 'static' },
    { id: 'prefsrc', label: 'Pref. Source', type: 'static' },
    { id: 'protocol', label: 'Protocol', type: 'static' },
    { id: 'type', label: 'Type', type: 'static' }
   ];
  }
  return [
   { id: 'dst', label: 'Dst. Address', type: 'text', required: true, placeholder: '0.0.0.0/0' },
   { id: 'gateway', label: 'Gateway', type: 'text', placeholder: '192.168.88.254' },
   { id: 'interface', label: 'Interface', type: 'select', required: true, options: networkOptions(data['uci:network']) },
   { id: 'distance', label: 'Distance', type: 'number', placeholder: '0' },
   { id: 'table', label: 'Routing Table', type: 'text', placeholder: 'main' },
   { id: 'type', label: 'Type', type: 'select', options: TYPES.map(value => ({ value, label: value })) },
   { id: 'prefsrc', label: 'Pref. Source', type: 'text' }
  ];
 },
 values(row, data) {
  if (row.readOnly) return { ...row.cells };
  const section = sections(data['uci:network'], 'route').find(item => item['.name'] === row.section);
  return { dst: row.cells.dst, gateway: section?.gateway ?? '', interface: section?.interface ?? '', distance: section?.metric ?? '', table: section?.table ?? '', type: section?.type ?? 'unicast', prefsrc: section?.source ?? '' };
 },
 defaults: data => ({ dst: '', gateway: '', interface: networkOptions(data['uci:network']).find(option => option.value === 'wan')?.value ?? '', distance: '', table: '', type: 'unicast', prefsrc: '' }),

 save(values, row) {
  const dst = parseCidr(values.dst);
  if (!dst) invalid('dst', 'Enter a destination such as 10.0.0.0/8 or 0.0.0.0/0');
  if (dst.address !== dst.network) invalid('dst', `Host bits are set; did you mean ${dst.network}/${dst.prefix}?`);
  if (values.gateway && !isIPv4(values.gateway)) invalid('gateway', 'Enter an IPv4 gateway address');
  if (!values.interface) invalid('interface', 'Choose the network this route uses');
  if (values.distance && !/^\d+$/.test(values.distance)) invalid('distance', 'Distance is a whole number');
  if (values.prefsrc && !isIPv4(values.prefsrc)) invalid('prefsrc', 'Enter an IPv4 source address');
  if (values.table && !/^[A-Za-z0-9_]+$/.test(values.table)) invalid('table', 'Use a table number or name');
  const options = compact({
   target: dst.cidr, gateway: values.gateway, interface: values.interface, metric: values.distance,
   table: values.table === 'main' ? '' : values.table, type: values.type === 'unicast' ? '' : values.type, source: values.prefsrc, netmask: ''
  });
  return row
   ? { description: `Change route ${row.cells.dst}`, ops: [{ op: 'set', config: 'network', section: row.section, values: options }] }
   : { description: `Add route ${dst.cidr}${values.gateway ? ' via ' + values.gateway : ''}`, ops: [{ op: 'add', config: 'network', type: 'route', values: options }] };
 },
 remove: rows => ({ description: `Remove route ${rows.map(row => row.cells.dst).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'network', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} route ${rows.map(row => row.cells.dst).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment route ${rows.map(row => row.cells.dst).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) }),
 copy: values => ({ ...values })
};

