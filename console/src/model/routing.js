// SPDX-License-Identifier: Apache-2.0
// Routing > Rules: policy routing from `rule` (IPv4) and `rule6` sections,
// next to the kernel's own rules, which show as dynamic.
import { sections, truthy, invalid, compact, networkOptions } from './common.js';
import { parseCidr, parseCidr6 } from '../lib/ip.js';

const ACTIONS = ['lookup', 'blackhole', 'prohibit', 'unreachable', 'throw'];
const tableOf = rule => rule.lookup ?? (rule.goto ? `goto ${rule.goto}` : '');

// netifd picks a priority when the section has none, so match on what is set.
function sameRule(live, section, family) {
 const from = live.from === 'all' ? '' : live.from ?? '';
 return live.family === family
  && (section.priority === undefined || String(live.priority) === String(section.priority))
  && (section.lookup === undefined || live.lookup === section.lookup)
  && (section.action === undefined || live.action === section.action)
  && from === (section.src ?? '') && (live.to ?? '') === (section.dest ?? '');
}

export const routingRules = {
 id: 'routing-rules',
 noun: 'Routing Rule',
 sources: ['uci:network', 'rules', 'ifaces'],
 columns: [
  { id: 'flags', label: '', width: 34 },
  { id: 'family', label: 'Family', width: 50 },
  { id: 'priority', label: 'Priority', width: 64, align: 'right', sort: value => Number(value) || 0 },
  { id: 'src', label: 'Src. Address', width: 140 },
  { id: 'dst', label: 'Dst. Address', width: 140 },
  { id: 'mark', label: 'Routing Mark', width: 90 },
  { id: 'in', label: 'Interface', width: 80 },
  { id: 'out', label: 'Out. Interface', width: 90 },
  { id: 'action', label: 'Action', width: 80 },
  { id: 'table', label: 'Table', width: 70 }
 ],
 flagLegend: { X: 'disabled', I: 'inverted', D: 'dynamic', A: 'active in the kernel' },
 defaultSort: 'priority',
 rows(data) {
  const live = data.rules?.rules ?? [], used = new Set();
  const rows = [];
  for (const [type, family] of [['rule', 4], ['rule6', 6]]) {
   for (const section of sections(data['uci:network'], type)) {
    const disabled = truthy(section.disabled);
    const index = live.findIndex((rule, position) => !used.has(position) && sameRule(rule, section, family));
    if (index >= 0 && !disabled) used.add(index);
    rows.push({
     key: section['.name'], section: section['.name'], type, disabled, comment: section.comment,
     flags: (disabled ? 'X' : '') + (truthy(section.invert) ? 'I' : '') + (index >= 0 && !disabled ? 'A' : ''),
     cells: { family: `ipv${family}`, priority: section.priority ?? '', src: section.src ?? '', dst: section.dest ?? '', mark: section.mark ?? '', in: section.in ?? '', out: section.out ?? '', action: section.action ?? 'lookup', table: section.action ? '' : section.lookup ?? (section.goto ? `goto ${section.goto}` : '') }
    });
   }
  }
  live.forEach((rule, index) => {
   if (used.has(index)) return;
   rows.push({
    key: `kernel:${rule.family}:${rule.priority}:${index}`, dynamic: true, readOnly: true, flags: 'D' + (rule.invert ? 'I' : '') + 'A',
    cells: { family: `ipv${rule.family}`, priority: String(rule.priority), src: rule.from === 'all' ? '' : rule.from ?? '', dst: rule.to ?? '', mark: rule.fwmark ?? '', in: rule.iif ?? '', out: rule.oif ?? '', action: rule.action ?? 'lookup', table: rule.action ? '' : tableOf(rule) }
   });
  });
  return rows;
 },
 itemTitle: row => `Routing Rule <${row?.cells.priority || 'new'}>`,
 itemStatus: row => [row.dynamic ? 'kernel rule' : row.disabled ? 'disabled' : row.flags.includes('A') ? 'active' : 'not active'],
 canAdd: () => true,
 canRemove: row => !row.readOnly,
 canToggle: row => !row.readOnly,
 canComment: row => !row.readOnly,
 fields(data, row) {
  if (row?.readOnly) return ['family', 'priority', 'src', 'dst', 'mark', 'in', 'out', 'action', 'table'].map(id => ({ id, label: routingRules.columns.find(column => column.id === id).label, type: 'static' }));
  const networks = [{ value: '', label: 'any' }, ...networkOptions(data['uci:network'], section => section['.name'] !== 'loopback')];
  return [
   { id: 'family', label: 'Family', type: row ? 'static' : 'select', options: [{ value: 'ipv4', label: 'IPv4' }, { value: 'ipv6', label: 'IPv6' }] },
   { id: 'priority', label: 'Priority', type: 'number', placeholder: 'chosen by netifd' },
   { id: 'src', label: 'Src. Address', type: 'text', placeholder: 'any' },
   { id: 'dest', label: 'Dst. Address', type: 'text', placeholder: 'any' },
   { id: 'in', label: 'Interface', type: 'select', options: networks },
   { id: 'out', label: 'Out. Interface', type: 'select', options: networks },
   { id: 'mark', label: 'Routing Mark', type: 'text', placeholder: '0x10/0xff' },
   { id: 'invert', label: 'Invert', type: 'bool' },
   { id: 'action', label: 'Action', type: 'select', options: ACTIONS.map(value => ({ value, label: value })) },
   { id: 'lookup', label: 'Table', type: 'combo', options: ['main', 'local', 'default'].map(value => ({ value, label: value })), placeholder: '100', visible: values => values.action === 'lookup' }
  ];
 },
 values(row, data) {
  if (row.readOnly) return { ...row.cells };
  const section = sections(data['uci:network'], row.type).find(item => item['.name'] === row.section) ?? {};
  return { family: row.type === 'rule6' ? 'ipv6' : 'ipv4', priority: section.priority ?? '', src: section.src ?? '', dest: section.dest ?? '', in: section.in ?? '', out: section.out ?? '', mark: section.mark ?? '', invert: truthy(section.invert), action: section.action ?? 'lookup', lookup: section.lookup ?? '' };
 },
 defaults: () => ({ family: 'ipv4', priority: '', src: '', dest: '', in: '', out: '', mark: '', invert: false, action: 'lookup', lookup: '' }),
 save(values, row) {
  const v6 = values.family === 'ipv6';
  const parse = value => v6 ? parseCidr6(value) : parseCidr(value);
  for (const id of ['src', 'dest']) if (values[id] && !parse(values[id])) invalid(id, `Enter an ${v6 ? 'IPv6' : 'IPv4'} address or prefix`);
  if (values.priority && !(/^\d+$/.test(values.priority) && Number(values.priority) < 32766 && Number(values.priority) > 0)) invalid('priority', 'Priority is 1 to 32765; 0, 32766 and 32767 belong to the kernel');
  if (values.mark && !/^(0x[0-9a-f]+|\d+)(\/(0x[0-9a-f]+|\d+))?$/i.test(values.mark)) invalid('mark', 'A mark is a number such as 0x10 or 0x10/0xff');
  if (values.action === 'lookup' && !/^([A-Za-z0-9_-]+)$/.test(values.lookup ?? '')) invalid('lookup', 'Name the routing table, for example 100 or main');
  const options = compact({
   priority: values.priority, src: values.src, dest: values.dest, in: values.in, out: values.out, mark: values.mark, invert: values.invert ? '1' : '',
   action: values.action === 'lookup' ? '' : values.action, lookup: values.action === 'lookup' ? values.lookup : ''
  });
  const name = `${values.priority || 'auto'} ${values.action === 'lookup' ? `→ ${values.lookup}` : values.action}`;
  return row
   ? { description: `Change routing rule ${name}`, ops: [{ op: 'set', config: 'network', section: row.section, values: options }] }
   : { description: `Add routing rule ${name}`, ops: [{ op: 'add', config: 'network', type: v6 ? 'rule6' : 'rule', values: options }] };
 },
 remove: rows => ({ description: `Remove routing rule ${rows.map(row => row.cells.priority || row.key).join(', ')}`, ops: rows.filter(row => !row.readOnly).map(row => ({ op: 'delete', config: 'network', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} routing rule ${rows.map(row => row.cells.priority || row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment routing rule ${rows.map(row => row.cells.priority || row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'network', section: row.section, values: { comment: comment || null } })) })
};
