// SPDX-License-Identifier: Apache-2.0
// IP > Routes and IPv6 > Routes: kernel routes merged with static `route` /
// `route6` sections. A static route present in the kernel is active (A);
// kernel-only routes are dynamic.
import { sections, truthy, invalid, networkOptions, compact } from './common.js';
import { parseCidr, parseCidr6, maskToPrefix, isIPv4, canonicalIPv6, addressKey } from '../lib/ip.js';

const TYPES = ['unicast', 'blackhole', 'unreachable', 'prohibit', 'throw'];

const FAMILIES = {
 4: {
  id: 'routes', noun: 'Route', section: 'route', source: 'routes4', any: '0.0.0.0/0', host: 32,
  cidr: text => parseCidr(text), address: text => isIPv4(text) ? text : null,
  example: { dst: '10.0.0.0/8 or 0.0.0.0/0', gateway: '192.168.88.254' }, sourceLabel: 'Pref. Source'
 },
 6: {
  id: 'routes6', noun: 'IPv6 Route', section: 'route6', source: 'routes6', any: '::/0', host: 128,
  cidr: text => parseCidr6(text), address: text => canonicalIPv6(text),
  example: { dst: '2001:db8::/32 or ::/0', gateway: 'fe80::1' }, sourceLabel: 'Src. Prefix'
 }
};

export function createRoutesModel(family) {
 const f = FAMILIES[family];

 function staticTarget(section) {
  const target = String(section.target ?? '');
  if (family === 6 || target.includes('/')) return f.cidr(target.includes('/') ? target : `${target}/${f.host}`)?.cidr ?? target;
  const prefix = section.netmask ? maskToPrefix(section.netmask) : 32;
  return f.cidr(`${target}/${prefix}`)?.cidr ?? target;
 }

 function kernelDst(route) {
  if (route.dst === 'default') return f.any;
  return f.cidr(route.dst.includes('/') ? route.dst : `${route.dst}/${f.host}`)?.cidr ?? route.dst;
 }

 const gatewayOf = value => value ? f.address(value) ?? value : '';

 return {
  id: f.id,
  noun: f.noun,
  sources: ['uci:network', f.source, 'ifaces'],
  columns: [
   { id: 'flags', label: '', width: 40 },
   { id: 'dst', label: 'Dst. Address', width: family === 6 ? 200 : 140, sort: addressKey },
   { id: 'gateway', label: 'Gateway', width: family === 6 ? 170 : 120, sort: addressKey },
   { id: 'distance', label: 'Distance', width: 72, align: 'right', sort: value => Number(value) || 0 },
   { id: 'table', label: 'Routing Table', width: 96 },
   { id: 'prefsrc', label: f.sourceLabel, width: family === 6 ? 150 : 110 },
   { id: 'interface', label: 'Interface', width: 120 },
   { id: 'type', label: 'Type', width: 80, hidden: family === 4 },
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
   const kernel = (data[f.source] ?? []).map(route => ({ route, dst: kernelDst(route), gateway: gatewayOf(route.gateway), table: route.table ?? 'main', used: false }));
   const rows = [];
   for (const section of sections(data['uci:network'], f.section)) {
    const dst = staticTarget(section), table = section.table ?? 'main', type = section.type ?? 'unicast';
    const device = devices.get(section.interface), gateway = gatewayOf(section.gateway);
    const disabled = truthy(section.disabled);
    const match = disabled ? null : kernel.find(entry => !entry.used && entry.dst === dst && entry.table === table &&
     (entry.route.type ?? 'unicast') === type && (!gateway || entry.gateway === gateway) && (!device || !entry.route.dev || entry.route.dev === device));
    if (match) match.used = true;
    rows.push({
     key: section['.name'], section: section['.name'],
     flags: (disabled ? 'X' : '') + (match ? 'A' : '') + 'S', disabled, comment: section.comment,
     cells: {
      dst, gateway, distance: section.metric ?? '0', table, prefsrc: section.source ?? match?.route.prefsrc ?? '',
      interface: device ? `${device} (${section.interface})` : section.interface ?? '', type, protocol: 'static'
     }
    });
   }
   for (const entry of kernel.filter(entry => !entry.used)) {
    const { route } = entry;
    // A connected network: a kernel route without gateway. Busybox `ip` prints
    // no protocol, and IPv6 routes carry no link scope.
    const kernelRoute = route.protocol === 'kernel' || !route.protocol;
    const connect = !route.gateway && !route.type && kernelRoute && (family === 6 || route.scope === 'link');
    rows.push({
     key: `kernel:${entry.table}:${entry.dst}:${entry.gateway}:${route.dev ?? ''}:${route.type ?? ''}:${route.metric ?? 0}:${route.from ?? ''}`,
     dynamic: true, readOnly: true, route,
     flags: 'DA' + (connect ? 'C' : ''),
     cells: {
      dst: entry.dst, gateway: entry.gateway, distance: String(route.metric ?? 0), table: entry.table, prefsrc: route.prefsrc ?? route.from ?? '',
      interface: route.dev ?? '', type: route.type ?? 'unicast', protocol: route.protocol ?? ''
     }
    });
   }
   return rows;
  },

  itemTitle: row => `${f.noun} <${row?.cells.dst ?? 'new'}>`,
  itemStatus: row => [row.disabled ? 'disabled' : 'enabled', row.flags.includes('A') ? 'active' : 'inactive', row.dynamic ? 'dynamic' : 'static'],
  canAdd: () => true,
  canRemove: row => !row.readOnly,
  canToggle: row => !row.readOnly,
  canComment: row => !row.readOnly,

  fields(data, row) {
   if (row?.readOnly) {
    return [['dst', 'Dst. Address'], ['gateway', 'Gateway'], ['interface', 'Interface'], ['distance', 'Distance'], ['table', 'Routing Table'], ['prefsrc', f.sourceLabel], ['protocol', 'Protocol'], ['type', 'Type']]
     .map(([id, label]) => ({ id, label, type: 'static' }));
   }
   return [
    { id: 'dst', label: 'Dst. Address', type: 'text', required: true, placeholder: f.any },
    { id: 'gateway', label: 'Gateway', type: 'text', placeholder: f.example.gateway },
    { id: 'interface', label: 'Interface', type: 'select', required: true, options: networkOptions(data['uci:network']) },
    { id: 'distance', label: 'Distance', type: 'number', placeholder: family === 6 ? '1024' : '0' },
    { id: 'table', label: 'Routing Table', type: 'text', placeholder: 'main' },
    { id: 'type', label: 'Type', type: 'select', options: TYPES.map(value => ({ value, label: value })) },
    { id: 'prefsrc', label: f.sourceLabel, type: 'text' }
   ];
  },
  values(row, data) {
   if (row.readOnly) return { ...row.cells };
   const section = sections(data['uci:network'], f.section).find(item => item['.name'] === row.section);
   return { dst: row.cells.dst, gateway: section?.gateway ?? '', interface: section?.interface ?? '', distance: section?.metric ?? '', table: section?.table ?? '', type: section?.type ?? 'unicast', prefsrc: section?.source ?? '' };
  },
  defaults: data => ({ dst: '', gateway: '', interface: networkOptions(data['uci:network']).find(option => option.value === (family === 6 ? 'wan6' : 'wan'))?.value ?? '', distance: '', table: '', type: 'unicast', prefsrc: '' }),

  save(values, row) {
   const dst = f.cidr(values.dst);
   if (!dst) invalid('dst', `Enter a destination such as ${f.example.dst}`);
   if (dst.address !== dst.network) invalid('dst', `Host bits are set; did you mean ${dst.network}/${dst.prefix}?`);
   if (values.gateway && !f.address(values.gateway)) invalid('gateway', `Enter an IPv${family} gateway address`);
   if (!values.interface) invalid('interface', 'Choose the network this route uses');
   if (values.distance && !/^\d+$/.test(values.distance)) invalid('distance', 'Distance is a whole number');
   if (values.prefsrc && !(family === 6 ? parseCidr6(values.prefsrc) : isIPv4(values.prefsrc))) invalid('prefsrc', family === 6 ? 'Enter a source prefix such as 2001:db8::/48' : 'Enter an IPv4 source address');
   if (values.table && !/^[A-Za-z0-9_]+$/.test(values.table)) invalid('table', 'Use a table number or name');
   const options = compact({
    target: dst.cidr, gateway: values.gateway ? f.address(values.gateway) : '', interface: values.interface, metric: values.distance,
    table: values.table === 'main' ? '' : values.table, type: values.type === 'unicast' ? '' : values.type, source: values.prefsrc
   });
   if (family === 4) options.netmask = null;
   const noun = f.noun.toLowerCase();
   return row
    ? { description: `Change ${noun} ${row.cells.dst}`, ops: [{ op: 'set', config: 'network', section: row.section, values: options }] }
    : { description: `Add ${noun} ${dst.cidr}${values.gateway ? ' via ' + options.gateway : ''}`, ops: [{ op: 'add', config: 'network', type: f.section, values: options }] };
  },
  remove: rows => ({ description: `Remove ${f.noun.toLowerCase()} ${rows.map(row => row.cells.dst).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'network', section: row.section })) }),
  toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} ${f.noun.toLowerCase()} ${rows.map(row => row.cells.dst).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { disabled: enable ? null : '1' } })) }),
  comment: (rows, comment) => ({ description: `Comment ${f.noun.toLowerCase()} ${rows.map(row => row.cells.dst).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) }),
  copy: values => ({ ...values })
 };
}

export const routes = createRoutesModel(4);
export const routes6 = createRoutesModel(6);
export default routes;
