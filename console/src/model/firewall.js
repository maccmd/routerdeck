// SPDX-License-Identifier: Apache-2.0
// IP > Firewall: Filter Rules (`rule`), NAT (`redirect`, `nat` and zone
// masquerading), Zones (`zone` + `forwarding`) and Connections (conntrack).
// Rule order is the section order; drag and drop rewrites it.
import { sections, truthy, list, text, invalid, NAME, zoneOptions, counterKeys, reorderOps, compact, networkOptions } from './common.js';
import { bytes, count, uptime } from '../lib/format.js';
import { addressKey, compressIPv6 } from '../lib/ip.js';

const ACTIONS = ['accept', 'drop', 'reject', 'notrack'];
const POLICIES = ['ACCEPT', 'REJECT', 'DROP'];
const PROTOCOLS = ['tcp udp', 'tcp', 'udp', 'icmp', 'all'];
const PORTS = /^!?\s*\d{1,5}([-:]\d{1,5})?(\s+\d{1,5}([-:]\d{1,5})?)*$/;

function chainOf(section) {
 if (section.src && section.dest) return 'forward';
 return section.src ? 'input' : 'output';
}

function counterCells(data, keys, section) {
 const key = keys.keys.get(section['.name']);
 const counter = keys.ambiguous(key) ? null : data.counters?.counters?.[key];
 return { packets: counter ? count(counter[0]) : '', bytes: counter ? bytes(counter[1]) : '', counter };
}

function checkPorts(values, ...ids) {
 for (const id of ids) if (values[id] && !PORTS.test(values[id].trim())) invalid(id, 'Enter ports such as 80, 8000-8080 or "80 443"');
}

function negatable(value) {
 const textValue = text(value);
 return { negate: textValue.startsWith('!'), value: textValue.replace(/^!\s*/, '') };
}
const withNegation = field => field?.value ? `${field.negate ? '!' : ''}${field.value.trim()}` : '';


export const filterRules = {
 id: 'fw-filter',
 noun: 'Firewall Rule',
 sources: ['uci:firewall', 'counters'],
 ordered: true,
 columns: [
  { id: 'number', label: '#', width: 34, align: 'right', sort: value => Number(value) },
  { id: 'flags', label: '', width: 26 },
  { id: 'action', label: 'Action', width: 66 },
  { id: 'chain', label: 'Chain', width: 64 },
  { id: 'src', label: 'Src. Address', width: 120, sort: addressKey },
  { id: 'dst', label: 'Dst. Address', width: 120, sort: addressKey },
  { id: 'proto', label: 'Protocol', width: 74 },
  { id: 'sport', label: 'Src. Port', width: 70 },
  { id: 'dport', label: 'Dst. Port', width: 70 },
  { id: 'in', label: 'In. Zone', width: 66 },
  { id: 'out', label: 'Out. Zone', width: 66 },
  { id: 'family', label: 'Family', width: 56, hidden: true },
  { id: 'bytes', label: 'Bytes', width: 84, align: 'right', sort: (value, row) => row.counter?.[1] ?? -1 },
  { id: 'packets', label: 'Packets', width: 70, align: 'right', sort: (value, row) => row.counter?.[0] ?? -1 }
 ],
 flagLegend: { X: 'disabled' },
 note: 'Counters reset whenever the firewall reloads.',

 rows(data) {
  const keys = counterKeys(data['uci:firewall'], ['rule']);
  return sections(data['uci:firewall'], 'rule').map((section, index) => {
   const disabled = !truthy(section.enabled, true);
   const counters = counterCells(data, keys, section);
   return {
    key: section['.name'], section: section['.name'], disabled, comment: section.name, counter: counters.counter,
    flags: disabled ? 'X' : '',
    cells: {
     number: String(index), action: String(section.target ?? 'drop').toLowerCase(), chain: chainOf(section),
     src: text(section.src_ip), dst: text(section.dest_ip), proto: text(section.proto) || 'tcp udp',
     sport: text(section.src_port), dport: text(section.dest_port), in: section.src ?? '', out: section.dest ?? '',
     family: section.family ?? 'any', bytes: counters.bytes, packets: counters.packets
    }
   };
  });
 },

 itemTitle: row => `Rule <${row ? row.comment || '#' + row.cells.number : 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled'],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,

 fields(data) {
  const zones = zoneOptions(data['uci:firewall'], { any: true });
  return [
   { id: 'chain', label: 'Chain', type: 'select', options: ['input', 'forward', 'output'].map(value => ({ value, label: value })) },
   { id: 'src', label: 'In. Zone', type: 'select', options: zones, visible: values => values.chain !== 'output' },
   { id: 'dest', label: 'Out. Zone', type: 'select', options: zones, visible: values => values.chain !== 'input' },
   { id: 'family', label: 'Family', type: 'select', options: [{ value: '', label: 'any' }, { value: 'ipv4', label: 'ipv4' }, { value: 'ipv6', label: 'ipv6' }] },
   { id: 'proto', label: 'Protocol', type: 'combo', options: PROTOCOLS.map(value => ({ value, label: value })) },
   { id: 'src_ip', label: 'Src. Address', type: 'negatable' },
   { id: 'dest_ip', label: 'Dst. Address', type: 'negatable' },
   { id: 'src_port', label: 'Src. Port', type: 'negatable', visible: values => /tcp|udp/.test(values.proto || 'tcp udp') },
   { id: 'dest_port', label: 'Dst. Port', type: 'negatable', visible: values => /tcp|udp/.test(values.proto || 'tcp udp') },
   { id: 'icmp_type', label: 'ICMP Type', type: 'list', visible: values => /icmp/.test(values.proto) },
   { id: 'src_mac', label: 'Src. MAC Address', type: 'negatable', tab: 'Advanced' },
   { id: 'mark', label: 'Mark', type: 'text', tab: 'Advanced', placeholder: '0x10/0xff' },
   { id: 'limit', label: 'Limit', type: 'text', tab: 'Advanced', placeholder: '10/second' },
   { id: 'limit_burst', label: 'Limit Burst', type: 'number', tab: 'Advanced' },
   { id: 'target', label: 'Action', type: 'select', tab: 'Action', options: ACTIONS.map(value => ({ value, label: value })) },
   { id: 'bytes', label: 'Bytes', type: 'static', tab: 'Statistics' },
   { id: 'packets', label: 'Packets', type: 'static', tab: 'Statistics' }
  ];
 },
 values(row, data) {
  const section = sections(data['uci:firewall'], 'rule').find(item => item['.name'] === row.section) ?? {};
  return {
   chain: chainOf(section), src: section.src ?? '', dest: section.dest ?? '', family: section.family ?? '', proto: text(section.proto) || 'tcp udp',
   src_ip: negatable(section.src_ip), dest_ip: negatable(section.dest_ip), src_port: negatable(section.src_port), dest_port: negatable(section.dest_port),
   icmp_type: list(section.icmp_type), src_mac: negatable(section.src_mac), mark: section.mark ?? '', limit: section.limit ?? '', limit_burst: section.limit_burst ?? '',
   target: String(section.target ?? 'drop').toLowerCase(), bytes: row.cells.bytes, packets: row.cells.packets
  };
 },
 defaults: data => ({
  chain: 'input', src: zoneOptions(data['uci:firewall']).find(zone => zone.value === 'wan')?.value ?? '*', dest: '', family: '', proto: 'tcp udp',
  src_ip: negatable(''), dest_ip: negatable(''), src_port: negatable(''), dest_port: negatable(''), icmp_type: [], src_mac: negatable(''),
  mark: '', limit: '', limit_burst: '', target: 'accept', bytes: '', packets: ''
 }),

 save(values, row) {
  const flat = { ...values, src_port: values.src_port?.value, dest_port: values.dest_port?.value };
  checkPorts(flat, 'src_port', 'dest_port');
  if (values.chain !== 'output' && !values.src) invalid('src', 'Choose the zone traffic comes from');
  if (values.chain !== 'input' && !values.dest) invalid('dest', 'Choose the zone traffic goes to');
  if (values.limit_burst && !/^\d+$/.test(values.limit_burst)) invalid('limit_burst', 'Limit burst is a whole number');
  const ports = /tcp|udp/.test(values.proto || 'tcp udp');
  const options = compact({
   src: values.chain === 'output' ? '' : values.src, dest: values.chain === 'input' ? '' : values.dest, family: values.family,
   proto: values.proto === 'tcp udp' ? '' : values.proto, src_ip: withNegation(values.src_ip), dest_ip: withNegation(values.dest_ip),
   src_port: ports ? withNegation(values.src_port) : '', dest_port: ports ? withNegation(values.dest_port) : '',
   icmp_type: /icmp/.test(values.proto) ? values.icmp_type ?? [] : [], src_mac: withNegation(values.src_mac),
   mark: values.mark, limit: values.limit, limit_burst: values.limit_burst, target: values.target.toUpperCase()
  });
  return row
   ? { description: `Change firewall rule ${row.comment || '#' + row.cells.number}`, ops: [{ op: 'set', config: 'firewall', section: row.section, values: options }] }
   : { description: `Add firewall rule (${values.chain} ${values.target})`, ops: [{ op: 'add', config: 'firewall', type: 'rule', values: options }] };
 },
 remove: rows => ({ description: `Remove firewall rule ${rows.map(row => row.comment || '#' + row.cells.number).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'firewall', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} firewall rule ${rows.map(row => row.comment || '#' + row.cells.number).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'firewall', section: row.section, values: { enabled: enable ? null : '0' } })) }),
 comment: (rows, comment) => ({ description: `Comment firewall rule ${rows.map(row => '#' + row.cells.number).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'firewall', section: row.section, values: { name: comment || null } })) }),
 order: (names, data) => ({ description: 'Move firewall rule', ops: reorderOps('firewall', data['uci:firewall'], names, ['rule']) }),
 copy: values => ({ ...values })
};

// NAT rows come from three section types; `kind` says which one.
function natRow(data, keys, section, kind, index) {
 const disabled = !truthy(section.enabled, true);
 const counters = counterCells(data, keys, section);
 const base = { section: section['.name'], kind, disabled, comment: section.name, counter: counters.counter, flags: disabled ? 'X' : '' };
 if (kind === 'redirect' && String(section.target ?? 'DNAT').toUpperCase() === 'DNAT') {
  return { ...base, key: section['.name'], cells: {
   number: String(index), action: 'dst-nat', chain: 'dstnat', src: text(section.src_ip), dst: text(section.src_dip), proto: text(section.proto) || 'tcp udp',
   dport: text(section.src_dport), in: section.src ?? '', out: section.dest ?? '', to: text(section.dest_ip), toPorts: text(section.dest_port), bytes: counters.bytes, packets: counters.packets } };
 }
 if (kind === 'redirect') {
  return { ...base, key: section['.name'], cells: {
   number: String(index), action: 'src-nat', chain: 'srcnat', src: text(section.src_ip), dst: text(section.dest_ip), proto: text(section.proto) || 'tcp udp',
   dport: text(section.dest_port), in: '', out: section.dest ?? '', to: text(section.src_dip), toPorts: text(section.src_dport), bytes: counters.bytes, packets: counters.packets } };
 }
 const target = String(section.target ?? 'MASQUERADE').toUpperCase();
 return { ...base, key: section['.name'], cells: {
  number: String(index), action: { SNAT: 'src-nat', MASQUERADE: 'masquerade', ACCEPT: 'accept' }[target] ?? target.toLowerCase(), chain: 'srcnat',
  src: text(section.src_ip), dst: text(section.dest_ip), proto: text(section.proto) || 'all', dport: text(section.dest_port), in: '', out: section.src ?? '',
  to: text(section.snat_ip), toPorts: text(section.snat_port), bytes: counters.bytes, packets: counters.packets } };
}

export const natRules = {
 id: 'fw-nat',
 noun: 'NAT Rule',
 sources: ['uci:firewall', 'counters'],
 ordered: true,
 columns: [
  { id: 'number', label: '#', width: 34, align: 'right', sort: value => Number(value) },
  { id: 'flags', label: '', width: 30 },
  { id: 'action', label: 'Action', width: 80 },
  { id: 'chain', label: 'Chain', width: 60 },
  { id: 'src', label: 'Src. Address', width: 110, sort: addressKey },
  { id: 'dst', label: 'Dst. Address', width: 110, sort: addressKey },
  { id: 'proto', label: 'Protocol', width: 70 },
  { id: 'dport', label: 'Dst. Port', width: 70 },
  { id: 'in', label: 'In. Zone', width: 64 },
  { id: 'out', label: 'Out. Zone', width: 64 },
  { id: 'to', label: 'To Addresses', width: 110 },
  { id: 'toPorts', label: 'To Ports', width: 64 },
  { id: 'bytes', label: 'Bytes', width: 80, align: 'right', sort: (value, row) => row.counter?.[1] ?? -1 },
  { id: 'packets', label: 'Packets', width: 66, align: 'right', sort: (value, row) => row.counter?.[0] ?? -1 }
 ],
 flagLegend: { X: 'disabled', D: 'dynamic (zone masquerading)' },
 note: 'Counters reset whenever the firewall reloads. Zone masquerading has no counters.',

 rows(data) {
  const firewall = data['uci:firewall'];
  const keys = counterKeys(firewall, ['redirect', 'nat']);
  const rows = [];
  sections(firewall, 'redirect').forEach(section => rows.push(natRow(data, keys, section, 'redirect', rows.length)));
  sections(firewall, 'nat').forEach(section => rows.push(natRow(data, keys, section, 'nat', rows.length)));
  for (const zone of sections(firewall, 'zone').filter(zone => truthy(zone.masq))) {
   const disabled = !truthy(zone.enabled, true);
   rows.push({
    key: `masq:${zone['.name']}`, kind: 'masq', zone: zone['.name'], dynamic: true, disabled, flags: (disabled ? 'X' : '') + 'D', comment: `Masquerade ${zone.name}`,
    cells: { number: String(rows.length), action: 'masquerade', chain: 'srcnat', src: text(zone.masq_src), dst: text(zone.masq_dest), proto: 'all', dport: '', in: '', out: zone.name, to: '', toPorts: '', bytes: '', packets: '' }
   });
  }
  return rows;
 },

 itemTitle: row => `NAT Rule <${row ? row.comment || '#' + row.cells.number : 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled', row.kind === 'masq' ? 'zone masquerading' : null],
 canAdd: () => true,
 canRemove: row => row.kind !== 'masq',
 canToggle: row => row.kind !== 'masq',
 canComment: row => row.kind !== 'masq',
 canOrder: (rows, target) => rows.every(row => row.kind === target?.kind && row.kind !== 'masq'),

 fields(data, row) {
  if (row?.kind === 'masq') return [
   { id: 'chain', label: 'Chain', type: 'static' }, { id: 'action', label: 'Action', type: 'static' }, { id: 'out', label: 'Out. Zone', type: 'static' },
   { id: 'hint', label: '', type: 'static' }
  ];
  const zones = zoneOptions(data['uci:firewall']);
  const dst = values => values.chain === 'dstnat';
  return [
   { id: 'chain', label: 'Chain', type: row ? 'static' : 'select', options: [{ value: 'dstnat', label: 'dstnat' }, { value: 'srcnat', label: 'srcnat' }] },
   { id: 'action', label: 'Action', type: 'select', visible: values => values.chain === 'srcnat' && row?.kind !== 'redirect',
     options: [{ value: 'masquerade', label: 'masquerade' }, { value: 'src-nat', label: 'src-nat' }, { value: 'accept', label: 'accept' }] },
   { id: 'in', label: 'In. Zone', type: 'select', options: zones, visible: dst },
   { id: 'out', label: 'Out. Zone', type: 'select', options: zones, allowEmpty: values => dst(values), visible: values => !dst(values) || !!values.out },
   { id: 'proto', label: 'Protocol', type: 'combo', options: PROTOCOLS.map(value => ({ value, label: value })) },
   { id: 'src', label: 'Src. Address', type: 'text' },
   { id: 'dst', label: 'Dst. Address', type: 'text' },
   { id: 'dport', label: 'Dst. Port', type: 'text', visible: values => /tcp|udp/.test(values.proto || 'tcp udp') },
   { id: 'to', label: 'To Addresses', type: 'text', visible: values => dst(values) || values.action === 'src-nat' || row?.kind === 'redirect' },
   { id: 'toPorts', label: 'To Ports', type: 'text', visible: values => (dst(values) || values.action === 'src-nat' || row?.kind === 'redirect') && /tcp|udp/.test(values.proto || 'tcp udp') },
   { id: 'bytes', label: 'Bytes', type: 'static', tab: 'Statistics' },
   { id: 'packets', label: 'Packets', type: 'static', tab: 'Statistics' }
  ];
 },
 values: row => ({ ...row.cells, hint: row.kind === 'masq' ? 'Enable or disable masquerading in the zone settings.' : '' }),
 defaults: data => ({ chain: 'dstnat', action: 'masquerade', in: zoneOptions(data['uci:firewall']).find(zone => zone.value === 'wan')?.value ?? '', out: '', proto: 'tcp udp', src: '', dst: '', dport: '', to: '', toPorts: '', bytes: '', packets: '' }),

 save(values, row) {
  checkPorts(values, 'dport', 'toPorts');
  const proto = values.proto === 'tcp udp' ? '' : values.proto;
  if (values.chain === 'dstnat') {
   if (!values.in) invalid('in', 'Choose the zone the traffic arrives from');
   if (!values.to && !values.toPorts) invalid('to', 'Enter the internal address or port to forward to');
   const options = compact({ target: 'DNAT', src: values.in, dest: values.out, proto, src_ip: values.src, src_dip: values.dst, src_dport: values.dport, dest_ip: values.to, dest_port: values.toPorts });
   return row
    ? { description: `Change NAT rule ${row.comment || '#' + row.cells.number}`, ops: [{ op: 'set', config: 'firewall', section: row.section, values: options }] }
    : { description: `Add dst-nat ${values.dport ? 'port ' + values.dport + ' ' : ''}to ${values.to}${values.toPorts ? ':' + values.toPorts : ''}`, ops: [{ op: 'add', config: 'firewall', type: 'redirect', values: options }] };
  }
  if (!values.out) invalid('out', 'Choose the zone the traffic leaves through');
  if (row?.kind === 'redirect') {
   const options = compact({ target: 'SNAT', dest: values.out, proto, src_ip: values.src, dest_ip: values.dst, dest_port: values.dport, src_dip: values.to, src_dport: values.toPorts });
   return { description: `Change NAT rule ${row.comment || '#' + row.cells.number}`, ops: [{ op: 'set', config: 'firewall', section: row.section, values: options }] };
  }
  if (values.action === 'src-nat' && !values.to) invalid('to', 'Enter the address to translate to');
  const target = { masquerade: 'MASQUERADE', 'src-nat': 'SNAT', accept: 'ACCEPT' }[values.action];
  const options = compact({ target, src: values.out, proto, src_ip: values.src, dest_ip: values.dst, dest_port: values.dport, snat_ip: target === 'SNAT' ? values.to : '', snat_port: target === 'SNAT' ? values.toPorts : '' });
  return row
   ? { description: `Change NAT rule ${row.comment || '#' + row.cells.number}`, ops: [{ op: 'set', config: 'firewall', section: row.section, values: options }] }
   : { description: `Add ${values.action} via ${values.out}`, ops: [{ op: 'add', config: 'firewall', type: 'nat', values: options }] };
 },
 remove: rows => ({ description: `Remove NAT rule ${rows.map(row => row.comment || '#' + row.cells.number).join(', ')}`, ops: rows.filter(row => row.section).map(row => ({ op: 'delete', config: 'firewall', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} NAT rule ${rows.map(row => row.comment || '#' + row.cells.number).join(', ')}`, ops: rows.filter(row => row.section).map(row => ({ op: 'set', config: 'firewall', section: row.section, values: { enabled: enable ? null : '0' } })) }),
 comment: (rows, comment) => ({ description: `Comment NAT rule ${rows.map(row => '#' + row.cells.number).join(', ')}`, ops: rows.filter(row => row.section).map(row => ({ op: 'set', config: 'firewall', section: row.section, values: { name: comment || null } })) }),
 order: (names, data) => ({ description: 'Move NAT rule', ops: reorderOps('firewall', data['uci:firewall'], names, ['redirect', 'nat']) }),
 copy: values => ({ ...values })
};

export const zones = {
 id: 'fw-zones',
 noun: 'Zone',
 sources: ['uci:firewall', 'uci:network'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'name', label: 'Name', width: 90 },
  { id: 'input', label: 'Input', width: 70 },
  { id: 'output', label: 'Output', width: 70 },
  { id: 'forward', label: 'Forward', width: 70 },
  { id: 'masq', label: 'Masquerade', width: 80 },
  { id: 'mtu_fix', label: 'MSS Clamping', width: 90, hidden: true },
  { id: 'networks', label: 'Networks', width: 140 },
  { id: 'forwards', label: 'Forward To', width: 120 }
 ],
 flagLegend: { X: 'disabled' },
 defaultSort: null,

 rows(data) {
  const firewall = data['uci:firewall'];
  return sections(firewall, 'zone').map(zone => {
   const disabled = !truthy(zone.enabled, true);
   return {
    key: zone['.name'], section: zone['.name'], name: zone.name, disabled, flags: disabled ? 'X' : '',
    cells: {
     name: zone.name ?? '', input: zone.input ?? 'DROP', output: zone.output ?? 'DROP', forward: zone.forward ?? 'DROP',
     masq: truthy(zone.masq) ? 'yes' : '', mtu_fix: truthy(zone.mtu_fix) ? 'yes' : '', networks: list(zone.network).join(', '),
     forwards: sections(firewall, 'forwarding').filter(item => item.src === zone.name && truthy(item.enabled, true)).map(item => item.dest).join(', ')
    }
   };
  });
 },

 itemTitle: row => `Zone <${row?.name ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled'],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 commentHint: 'Zones have no comment option',

 fields(data, row) {
  const policy = POLICIES.map(value => ({ value, label: value }));
  return [
   { id: 'name', label: 'Name', type: row ? 'static' : 'text', required: true, placeholder: 'guest' },
   { id: 'input', label: 'Input', type: 'select', options: policy },
   { id: 'output', label: 'Output', type: 'select', options: policy },
   { id: 'forward', label: 'Forward', type: 'select', options: policy },
   { id: 'masq', label: 'Masquerade', type: 'bool' },
   { id: 'mtu_fix', label: 'MSS Clamping', type: 'bool' },
   { id: 'network', label: 'Networks', type: 'multi', options: networkOptions(data['uci:network']) },
   { id: 'forwards', label: 'Forward To', type: 'multi', options: zoneOptions(data['uci:firewall']).filter(zone => zone.value !== row?.name) }
  ];
 },
 values(row, data) {
  const zone = sections(data['uci:firewall'], 'zone').find(item => item['.name'] === row.section) ?? {};
  return {
   name: zone.name ?? '', input: zone.input ?? 'DROP', output: zone.output ?? 'DROP', forward: zone.forward ?? 'DROP',
   masq: truthy(zone.masq), mtu_fix: truthy(zone.mtu_fix), network: list(zone.network),
   forwards: sections(data['uci:firewall'], 'forwarding').filter(item => item.src === zone.name).map(item => item.dest)
  };
 },
 defaults: () => ({ name: '', input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', masq: false, mtu_fix: false, network: [], forwards: [] }),

 save(values, row, data) {
  const firewall = data['uci:firewall'];
  const name = row ? row.name : values.name.trim();
  if (!row) {
   if (!NAME.test(name) || name.length > 15) invalid('name', 'Use up to 15 letters, digits or underscores');
   if (sections(firewall, 'zone').some(zone => zone.name === name)) invalid('name', `Zone ${name} already exists`);
  }
  const options = compact({ name, input: values.input, output: values.output, forward: values.forward, masq: values.masq ? '1' : '', mtu_fix: values.mtu_fix ? '1' : '', network: values.network ?? [] });
  const ops = [row ? { op: 'set', config: 'firewall', section: row.section, values: options } : { op: 'add', config: 'firewall', type: 'zone', values: options }];
  const current = sections(firewall, 'forwarding').filter(item => item.src === name);
  for (const forwarding of current.filter(item => !values.forwards.includes(item.dest))) ops.push({ op: 'delete', config: 'firewall', section: forwarding['.name'] });
  for (const dest of values.forwards.filter(dest => !current.some(item => item.dest === dest))) ops.push({ op: 'add', config: 'firewall', type: 'forwarding', values: { src: name, dest } });
  return { description: row ? `Change zone ${name}` : `Add zone ${name}`, ops };
 },
 // Like RouterOS with an interface list in use: a referenced zone stays.
 removeBlocked(rows, data) {
  const firewall = data['uci:firewall'];
  for (const row of rows) {
   const users = ['rule', 'redirect', 'nat'].flatMap(type => sections(firewall, type)).filter(section => section.src === row.name || section.dest === row.name);
   if (users.length) return `Zone ${row.name} is used by ${users.length} firewall rule${users.length === 1 ? '' : 's'}`;
  }
  return null;
 },
 remove(rows, data) {
  const ops = [];
  for (const row of rows) {
   ops.push({ op: 'delete', config: 'firewall', section: row.section });
   for (const forwarding of sections(data['uci:firewall'], 'forwarding').filter(item => item.src === row.name || item.dest === row.name)) ops.push({ op: 'delete', config: 'firewall', section: forwarding['.name'] });
  }
  return { description: `Remove zone ${rows.map(row => row.name).join(', ')}`, ops };
 },
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} zone ${rows.map(row => row.name).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'firewall', section: row.section, values: { enabled: enable ? null : '0' } })) })
};

export const connections = {
 id: 'connections',
 noun: 'Connection',
 sources: ['conntrack'],
 readOnly: true,
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'proto', label: 'Protocol', width: 64 },
  { id: 'src', label: 'Src. Address', width: 190, sort: addressKey },
  { id: 'dst', label: 'Dst. Address', width: 190, sort: addressKey },
  { id: 'state', label: 'TCP State', width: 96 },
  { id: 'timeout', label: 'Timeout', width: 80, align: 'right', sort: (value, row) => row.timeout },
  { id: 'bytes', label: 'Bytes', width: 80, align: 'right', sort: (value, row) => row.bytes },
  { id: 'packets', label: 'Packets', width: 64, align: 'right', sort: value => Number(value) || 0 },
  { id: 'family', label: 'Family', width: 50, hidden: true }
 ],
 flagLegend: { A: 'assured', U: 'unreplied' },
 defaultSort: null,
 status: data => data.conntrack ? `${data.conntrack.count} tracked of ${data.conntrack.max}${data.conntrack.entries.length < data.conntrack.count ? `, first ${data.conntrack.entries.length} shown` : ''}` : '',
 rows(data) {
  const endpoint = (address, port) => {
   const host = compressIPv6(address);
   return port ? (host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`) : host;
  };
  return (data.conntrack?.entries ?? []).map(entry => ({
   key: `${entry.family}|${entry.protocol}|${entry.src}|${entry.sport}|${entry.dst}|${entry.dport}`,
   timeout: entry.timeout, bytes: entry.bytes, readOnly: true,
   flags: (entry.flags.includes('ASSURED') ? 'A' : '') + (entry.flags.includes('UNREPLIED') ? 'U' : ''),
   cells: {
    proto: entry.protocol, src: endpoint(entry.src, entry.sport), dst: endpoint(entry.dst, entry.dport), state: entry.state ?? '',
    timeout: uptime(entry.timeout), bytes: bytes(entry.bytes), packets: count(entry.packets), family: entry.family
   }
  }));
 },
 itemTitle: row => `Connection <${row.cells.src} → ${row.cells.dst}>`,
 fields: () => ['proto', 'src', 'dst', 'state', 'timeout', 'bytes', 'packets'].map(id => ({ id, label: connections.columns.find(column => column.id === id).label, type: 'static' })),
 values: row => ({ ...row.cells })
};

