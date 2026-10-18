// SPDX-License-Identifier: Apache-2.0
// IP > Firewall: Filter Rules, Mangle and Raw (all `rule` sections, told
// apart by their target), NAT (`redirect`, `nat` and zone masquerading),
// Zones (`zone` + `forwarding`), Settings (`defaults`) and Connections
// (conntrack). Rule order is the section order; drag and drop rewrites it.
import { sections, truthy, list, text, invalid, NAME, zoneOptions, counterKeys, reorderOps, compact, networkOptions } from './common.js';
import { bytes, count, uptime } from '../lib/format.js';
import { addressKey, compressIPv6, parseCidr, parseCidr6 } from '../lib/ip.js';

const ACTIONS = ['accept', 'drop', 'reject'];
const targetOf = section => String(section.target ?? 'drop').toLowerCase();
const isFilter = section => ACTIONS.includes(targetOf(section));
const POLICIES = ['ACCEPT', 'REJECT', 'DROP'];
const PROTOCOLS = ['tcp udp', 'tcp', 'udp', 'icmp', 'all'];
const PORTS = /^!?\s*\d{1,5}([-:]\d{1,5})?(\s+\d{1,5}([-:]\d{1,5})?)*$/;
const LIMIT = /^\d+\/(second|minute|hour|day)$/;

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

// A rule names one address list (fw4 ipset) with its direction: "name src".
function ruleList(section, firewall) {
 const match = /^(!?)(\S+)(?:\s+(src|dest))?/.exec(text(section.ipset));
 if (!match) return { src_list: '', dst_list: '' };
 const set = sections(firewall, 'ipset').find(item => item.name === match[2]);
 const direction = match[3] ?? (list(set?.match).some(item => item.startsWith('dest')) ? 'dest' : 'src');
 const name = match[1] + match[2];
 return direction === 'dest' ? { src_list: '', dst_list: name } : { src_list: name, dst_list: '' };
}
const listOptions = firewall => sections(firewall, 'ipset').filter(set => set.name).map(set => ({ value: set.name, label: set.name }));


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
  return sections(data['uci:firewall'], 'rule').filter(isFilter).map((section, index) => {
   const disabled = !truthy(section.enabled, true);
   const counters = counterCells(data, keys, section);
   return {
    key: section['.name'], section: section['.name'], disabled, comment: section.name, counter: counters.counter,
    flags: disabled ? 'X' : '',
    cells: {
     number: String(index), action: targetOf(section), chain: chainOf(section),
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
   { id: 'src_list', label: 'Src. Address List', type: 'select', tab: 'Advanced', allowEmpty: true, options: listOptions(data['uci:firewall']) },
   { id: 'dst_list', label: 'Dst. Address List', type: 'select', tab: 'Advanced', allowEmpty: true, options: listOptions(data['uci:firewall']) },
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
   icmp_type: list(section.icmp_type), src_mac: negatable(section.src_mac), ...ruleList(section, data['uci:firewall']),
   mark: section.mark ?? '', limit: section.limit ?? '', limit_burst: section.limit_burst ?? '',
   target: String(section.target ?? 'drop').toLowerCase(), bytes: row.cells.bytes, packets: row.cells.packets
  };
 },
 defaults: data => ({
  chain: 'input', src: zoneOptions(data['uci:firewall']).find(zone => zone.value === 'wan')?.value ?? '*', dest: '', family: '', proto: 'tcp udp',
  src_ip: negatable(''), dest_ip: negatable(''), src_port: negatable(''), dest_port: negatable(''), icmp_type: [], src_mac: negatable(''), src_list: '', dst_list: '',
  mark: '', limit: '', limit_burst: '', target: 'accept', bytes: '', packets: ''
 }),

 save(values, row) {
  const flat = { ...values, src_port: values.src_port?.value, dest_port: values.dest_port?.value };
  checkPorts(flat, 'src_port', 'dest_port');
  if (values.chain !== 'output' && !values.src) invalid('src', 'Choose the zone traffic comes from');
  if (values.chain !== 'input' && !values.dest) invalid('dest', 'Choose the zone traffic goes to');
  if (values.limit_burst && !/^\d+$/.test(values.limit_burst)) invalid('limit_burst', 'Limit burst is a whole number');
  if (values.src_list && values.dst_list) invalid('dst_list', 'An OpenWrt rule matches one address list');
  const ports = /tcp|udp/.test(values.proto || 'tcp udp');
  const options = compact({
   src: values.chain === 'output' ? '' : values.src, dest: values.chain === 'input' ? '' : values.dest, family: values.family,
   proto: values.proto === 'tcp udp' ? '' : values.proto, src_ip: withNegation(values.src_ip), dest_ip: withNegation(values.dest_ip),
   src_port: ports ? withNegation(values.src_port) : '', dest_port: ports ? withNegation(values.dest_port) : '',
   icmp_type: /icmp/.test(values.proto) ? values.icmp_type ?? [] : [], src_mac: withNegation(values.src_mac),
   ipset: values.src_list ? `${values.src_list} src` : values.dst_list ? `${values.dst_list} dest` : '',
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

/* --- Mangle and Raw: rules whose target marks, changes DSCP or skips
   connection tracking. fw4 picks their chain from the zones they name. --- */

const MANGLE_CHAINS = ['prerouting', 'input', 'forward', 'output', 'postrouting'];
const DSCP = ['CS0', 'CS1', 'CS2', 'CS3', 'CS4', 'CS5', 'CS6', 'CS7', 'AF11', 'AF12', 'AF13', 'AF21', 'AF22', 'AF23', 'AF31', 'AF32', 'AF33', 'AF41', 'AF42', 'AF43', 'EF', 'LE'];
const HELPERS = ['ftp', 'tftp', 'sip', 'irc', 'pptp', 'snmp', 'amanda', 'h323', 'rtsp', 'netbios-ns'];
const MARK = /^0x[0-9a-fA-F]{1,8}(\/0x[0-9a-fA-F]{1,8})?$|^\d{1,10}(\/\d{1,10})?$/;

// fw4's choice of mangle chain (fw4.uc): zones on both sides, or "any" on
// both, is forward; any to a zone is postrouting; a zone to any is
// prerouting; a source alone is input; no source is output.
export function mangleChain(section) {
 const src = section.src, dest = section.dest;
 if ((src === '*' && dest === '*') || (src && src !== '*' && dest && dest !== '*')) return 'forward';
 if (src === '*' && dest) return 'postrouting';
 if (src && src !== '*' && dest === '*') return 'prerouting';
 if (src && !dest) return 'input';
 return 'output';
}

function zonesFor(chain, values) {
 if (chain === 'prerouting') return { src: values.src, dest: '*' };
 if (chain === 'input') return { src: values.src, dest: '' };
 if (chain === 'forward') return { src: values.src, dest: values.dest };
 if (chain === 'postrouting') return { src: '*', dest: values.dest };
 return { src: '', dest: values.dest === '*' ? '' : values.dest };
}

const matchFields = data => [
 { id: 'family', label: 'Family', type: 'select', options: [{ value: '', label: 'any' }, { value: 'ipv4', label: 'ipv4' }, { value: 'ipv6', label: 'ipv6' }] },
 { id: 'proto', label: 'Protocol', type: 'combo', options: PROTOCOLS.map(value => ({ value, label: value })) },
 { id: 'src_ip', label: 'Src. Address', type: 'negatable' },
 { id: 'dest_ip', label: 'Dst. Address', type: 'negatable' },
 { id: 'src_port', label: 'Src. Port', type: 'negatable', visible: values => /tcp|udp/.test(values.proto || 'tcp udp') },
 { id: 'dest_port', label: 'Dst. Port', type: 'negatable', visible: values => /tcp|udp/.test(values.proto || 'tcp udp') },
 { id: 'src_mac', label: 'Src. MAC Address', type: 'negatable', tab: 'Advanced' },
 { id: 'mark', label: 'Mark', type: 'text', tab: 'Advanced', placeholder: '0x10/0xff' },
 { id: 'src_list', label: 'Src. Address List', type: 'select', tab: 'Advanced', allowEmpty: true, options: listOptions(data['uci:firewall']) },
 { id: 'dst_list', label: 'Dst. Address List', type: 'select', tab: 'Advanced', allowEmpty: true, options: listOptions(data['uci:firewall']) }
];
const matchValues = (section, firewall) => ({
 family: section.family ?? '', proto: text(section.proto) || 'tcp udp', src_ip: negatable(section.src_ip), dest_ip: negatable(section.dest_ip),
 src_port: negatable(section.src_port), dest_port: negatable(section.dest_port), src_mac: negatable(section.src_mac), mark: section.mark ?? '', ...ruleList(section, firewall)
});
const emptyMatch = () => ({ family: '', proto: 'tcp udp', src_ip: negatable(''), dest_ip: negatable(''), src_port: negatable(''), dest_port: negatable(''), src_mac: negatable(''), mark: '', src_list: '', dst_list: '' });
function matchOptions(values) {
 checkPorts({ ...values, src_port: values.src_port?.value, dest_port: values.dest_port?.value }, 'src_port', 'dest_port');
 if (values.mark && !MARK.test(values.mark)) invalid('mark', 'A mark such as 0x10 or 0x10/0xff');
 if (values.src_list && values.dst_list) invalid('dst_list', 'An OpenWrt rule matches one address list');
 const ports = /tcp|udp/.test(values.proto || 'tcp udp');
 return {
  family: values.family, proto: values.proto === 'tcp udp' ? '' : values.proto, src_ip: withNegation(values.src_ip), dest_ip: withNegation(values.dest_ip),
  src_port: ports ? withNegation(values.src_port) : '', dest_port: ports ? withNegation(values.dest_port) : '', src_mac: withNegation(values.src_mac), mark: values.mark,
  ipset: values.src_list ? `${values.src_list} src` : values.dst_list ? `${values.dst_list} dest` : ''
 };
}

function ruleTable({ id, noun, targets, columns, chainOf: chainFor, fields, values, defaults, options, describe }) {
 return {
  id, noun, sources: ['uci:firewall', 'counters'], ordered: true, columns, flagLegend: { X: 'disabled' },
  note: 'Counters reset whenever the firewall reloads.',
  rows(data) {
   const keys = counterKeys(data['uci:firewall'], ['rule']);
   return sections(data['uci:firewall'], 'rule').filter(section => targets.includes(targetOf(section))).map((section, index) => {
    const disabled = !truthy(section.enabled, true);
    const counters = counterCells(data, keys, section);
    return {
     key: section['.name'], section: section['.name'], disabled, comment: section.name, counter: counters.counter, flags: disabled ? 'X' : '',
     cells: { number: String(index), action: targetOf(section), chain: chainFor(section), src: text(section.src_ip), dst: text(section.dest_ip), proto: text(section.proto) || 'tcp udp', dport: text(section.dest_port), in: section.src ?? '', out: section.dest ?? '', value: describe(section), bytes: counters.bytes, packets: counters.packets }
    };
   });
  },
  itemTitle: row => `${noun} <${row ? row.comment || '#' + row.cells.number : 'new'}>`,
  itemStatus: row => [row.disabled ? 'disabled' : 'enabled'],
  canAdd: () => true, canRemove: () => true, canToggle: () => true, canComment: () => true,
  fields, values: (row, data) => values(sections(data['uci:firewall'], 'rule').find(item => item['.name'] === row.section) ?? {}, data, row), defaults,
  save(values, row, data) {
   const result = compact(options(values, data));
   return row
    ? { description: `Change ${noun.toLowerCase()} ${row.comment || '#' + row.cells.number}`, ops: [{ op: 'set', config: 'firewall', section: row.section, values: result }] }
    : { description: `Add ${noun.toLowerCase()} (${values.chain ?? 'prerouting'} ${values.target})`, ops: [{ op: 'add', config: 'firewall', type: 'rule', values: result }] };
  },
  remove: rows => ({ description: `Remove ${noun.toLowerCase()} ${rows.map(row => row.comment || '#' + row.cells.number).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'firewall', section: row.section })) }),
  toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} ${noun.toLowerCase()} ${rows.map(row => row.comment || '#' + row.cells.number).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'firewall', section: row.section, values: { enabled: enable ? null : '0' } })) }),
  comment: (rows, comment) => ({ description: `Comment ${noun.toLowerCase()} ${rows.map(row => '#' + row.cells.number).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'firewall', section: row.section, values: { name: comment || null } })) }),
  order: (names, data) => ({ description: `Move ${noun.toLowerCase()}`, ops: reorderOps('firewall', data['uci:firewall'], names, ['rule']) }),
  copy: values => ({ ...values })
 };
}

const tableColumns = valueLabel => [
 { id: 'number', label: '#', width: 34, align: 'right', sort: value => Number(value) },
 { id: 'flags', label: '', width: 26 },
 { id: 'action', label: 'Action', width: 66 },
 { id: 'chain', label: 'Chain', width: 80 },
 { id: 'value', label: valueLabel, width: 110 },
 { id: 'src', label: 'Src. Address', width: 120, sort: addressKey },
 { id: 'dst', label: 'Dst. Address', width: 120, sort: addressKey },
 { id: 'proto', label: 'Protocol', width: 74 },
 { id: 'dport', label: 'Dst. Port', width: 70 },
 { id: 'in', label: 'In. Zone', width: 66 },
 { id: 'out', label: 'Out. Zone', width: 66 },
 { id: 'bytes', label: 'Bytes', width: 84, align: 'right', sort: (value, row) => row.counter?.[1] ?? -1 },
 { id: 'packets', label: 'Packets', width: 70, align: 'right', sort: (value, row) => row.counter?.[0] ?? -1 }
];

export const mangleRules = ruleTable({
 id: 'fw-mangle', noun: 'Mangle Rule', targets: ['mark', 'dscp'], columns: tableColumns('New Value'), chainOf: mangleChain,
 describe: section => targetOf(section) === 'dscp' ? section.set_dscp ?? '' : section.set_xmark ?? section.set_mark ?? '',
 fields(data) {
  const zones = zoneOptions(data['uci:firewall']), any = zoneOptions(data['uci:firewall'], { any: true });
  return [
   { id: 'chain', label: 'Chain', type: 'select', options: MANGLE_CHAINS.map(value => ({ value, label: value })) },
   { id: 'src', label: 'In. Zone', type: 'select', options: values => values.chain === 'input' || values.chain === 'forward' ? any : zones, visible: values => ['prerouting', 'input', 'forward'].includes(values.chain) },
   { id: 'dest', label: 'Out. Zone', type: 'select', options: values => values.chain === 'forward' ? any : zones, allowEmpty: values => values.chain === 'output', visible: values => ['forward', 'postrouting', 'output'].includes(values.chain) },
   ...matchFields(data),
   { id: 'target', label: 'Action', type: 'select', tab: 'Action', options: [{ value: 'mark', label: 'mark packet' }, { value: 'dscp', label: 'change DSCP' }] },
   { id: 'set_xmark', label: 'New Mark', type: 'text', tab: 'Action', placeholder: '0x10 or 0x10/0xff', visible: values => values.target === 'mark' },
   { id: 'set_dscp', label: 'New DSCP', type: 'combo', tab: 'Action', options: DSCP.map(value => ({ value, label: value })), visible: values => values.target === 'dscp' },
   { id: 'bytes', label: 'Bytes', type: 'static', tab: 'Statistics' },
   { id: 'packets', label: 'Packets', type: 'static', tab: 'Statistics' }
  ];
 },
 values: (section, data, row) => ({
  chain: mangleChain(section), src: section.src === '*' ? '*' : section.src ?? '', dest: section.dest ?? '', ...matchValues(section, data['uci:firewall']),
  target: targetOf(section), set_xmark: section.set_xmark ?? section.set_mark ?? '', set_dscp: section.set_dscp ?? '', bytes: row.cells.bytes, packets: row.cells.packets
 }),
 defaults: data => ({ chain: 'prerouting', src: zoneOptions(data['uci:firewall']).find(zone => zone.value === 'lan')?.value ?? '', dest: '', ...emptyMatch(), target: 'mark', set_xmark: '', set_dscp: 'CS1' }),
 options(values) {
  const zones = zonesFor(values.chain, values);
  if (['prerouting', 'input', 'forward'].includes(values.chain) && !zones.src) invalid('src', 'Choose the zone traffic comes from');
  if (['forward', 'postrouting'].includes(values.chain) && !zones.dest) invalid('dest', 'Choose the zone traffic goes to');
  if (values.chain === 'forward' && (zones.src === '*') !== (zones.dest === '*')) invalid('dest', 'For forward, name zones on both sides or "any" on both');
  if (values.target === 'mark' && !MARK.test(values.set_xmark)) invalid('set_xmark', 'A mark such as 0x10 or 0x10/0xff');
  if (values.target === 'dscp' && !(DSCP.includes(String(values.set_dscp).toUpperCase()) || (/^\d+$/.test(values.set_dscp) && Number(values.set_dscp) < 64))) invalid('set_dscp', 'A DSCP class such as CS1 or EF, or 0 to 63');
  return { ...zones, ...matchOptions(values), target: values.target.toUpperCase(), set_xmark: values.target === 'mark' ? values.set_xmark : '', set_mark: '', set_dscp: values.target === 'dscp' ? String(values.set_dscp).toUpperCase() : '' };
 }
});

export const rawRules = ruleTable({
 id: 'fw-raw', noun: 'Raw Rule', targets: ['notrack', 'helper'], columns: tableColumns('Helper'), chainOf: () => 'prerouting',
 describe: section => section.set_helper ?? '',
 fields: data => [
  { id: 'src', label: 'In. Zone', type: 'select', options: zoneOptions(data['uci:firewall']) },
  ...matchFields(data),
  { id: 'target', label: 'Action', type: 'select', tab: 'Action', options: [{ value: 'notrack', label: 'notrack' }, { value: 'helper', label: 'connection helper' }] },
  { id: 'set_helper', label: 'Helper', type: 'combo', tab: 'Action', options: HELPERS.map(value => ({ value, label: value })), visible: values => values.target === 'helper' },
  { id: 'bytes', label: 'Bytes', type: 'static', tab: 'Statistics' },
  { id: 'packets', label: 'Packets', type: 'static', tab: 'Statistics' }
 ],
 values: (section, data, row) => ({ src: section.src ?? '', ...matchValues(section, data['uci:firewall']), target: targetOf(section), set_helper: section.set_helper ?? '', bytes: row.cells.bytes, packets: row.cells.packets }),
 defaults: data => ({ src: zoneOptions(data['uci:firewall']).find(zone => zone.value === 'lan')?.value ?? '', ...emptyMatch(), target: 'notrack', set_helper: 'ftp' }),
 options(values) {
  if (!values.src || values.src === '*') invalid('src', 'fw4 skips connection tracking for traffic from one zone; choose it');
  if (values.target === 'helper' && !/^[a-z0-9-]+$/.test(values.set_helper ?? '')) invalid('set_helper', 'Choose a helper such as ftp or sip');
  return { src: values.src, dest: '', ...matchOptions(values), target: values.target.toUpperCase(), set_helper: values.target === 'helper' ? values.set_helper : '' };
 }
});

// The `defaults` section: policies for traffic no zone covers, SYN flood
// protection and flow offloading (FastPath).
export const firewallSettings = {
 id: 'fw-settings',
 noun: 'Firewall Settings',
 singleton: true,
 sources: ['uci:firewall'],
 rows: data => [{ key: 'defaults', section: sections(data['uci:firewall'], 'defaults')[0]?.['.name'] ?? null }],
 itemTitle: () => 'Firewall Settings',
 itemStatus: () => ['fw4 defaults'],
 fields: () => {
  const policy = POLICIES.map(value => ({ value, label: value }));
  return [
   { id: 'input', label: 'Input', type: 'select', options: policy },
   { id: 'output', label: 'Output', type: 'select', options: policy },
   { id: 'forward', label: 'Forward', type: 'select', options: policy },
   { id: 'drop_invalid', label: 'Drop Invalid', type: 'bool' },
   { id: 'synflood', label: 'SYN Flood Protection', type: 'bool' },
   { id: 'synflood_rate', label: 'SYN Rate', type: 'text', placeholder: '25/second', visible: values => values.synflood },
   { id: 'synflood_burst', label: 'SYN Burst', type: 'number', placeholder: '50', visible: values => values.synflood },
   { id: 'tcp_syncookies', label: 'TCP SYN Cookies', type: 'bool' },
   { id: 'flow_offloading', label: 'FastPath (Software Offload)', type: 'bool', tab: 'FastPath' },
   { id: 'flow_offloading_hw', label: 'Hardware Offload', type: 'bool', tab: 'FastPath', visible: values => values.flow_offloading },
   { id: 'note', label: '', type: 'note', tab: 'FastPath', value: () => 'Established connections skip the firewall rules and queues once offloaded, like RouterOS FastTrack: faster, but Torch, SQM and per-rule counters no longer see that traffic. Hardware offload needs a capable switch or SoC.' }
  ];
 },
 values(row, data) {
  const section = row.section ? data['uci:firewall'][row.section] : {};
  return {
   input: section.input ?? 'ACCEPT', output: section.output ?? 'ACCEPT', forward: section.forward ?? 'ACCEPT', drop_invalid: truthy(section.drop_invalid),
   synflood: truthy(section.synflood_protect ?? section.syn_flood), synflood_rate: section.synflood_rate ?? '', synflood_burst: section.synflood_burst ?? '',
   tcp_syncookies: truthy(section.tcp_syncookies, true), flow_offloading: truthy(section.flow_offloading), flow_offloading_hw: truthy(section.flow_offloading_hw)
  };
 },
 save(values, row, data, { dirty = null } = {}) {
  if (values.synflood_rate && !LIMIT.test(values.synflood_rate)) invalid('synflood_rate', 'A rate such as 25/second');
  if (values.synflood_burst && !/^\d+$/.test(values.synflood_burst)) invalid('synflood_burst', 'A whole number');
  const section = row.section ? data['uci:firewall'][row.section] : {};
  // fw4 reads syn_flood as well as synflood_protect; keep whichever is used.
  const synKey = section.synflood_protect !== undefined || section.syn_flood === undefined ? 'synflood_protect' : 'syn_flood';
  const all = {
   input: values.input, output: values.output, forward: values.forward, drop_invalid: values.drop_invalid ? '1' : null, [synKey]: values.synflood ? '1' : '0',
   synflood_rate: values.synflood && values.synflood_rate ? values.synflood_rate : null, synflood_burst: values.synflood && values.synflood_burst ? values.synflood_burst : null,
   tcp_syncookies: values.tcp_syncookies ? null : '0', flow_offloading: values.flow_offloading ? '1' : null, flow_offloading_hw: values.flow_offloading && values.flow_offloading_hw ? '1' : null
  };
  const fieldOf = { [synKey]: 'synflood' };
  const changes = Object.fromEntries(Object.entries(all).filter(([key]) => !dirty || dirty.has(fieldOf[key] ?? key) || (key.startsWith('synflood') && dirty.has('synflood')) || (key === 'flow_offloading_hw' && dirty.has('flow_offloading'))));
  if (!Object.keys(changes).length) return null;
  return row.section
   ? { description: 'Change firewall settings', ops: [{ op: 'set', config: 'firewall', section: row.section, values: changes }] }
   : { description: 'Change firewall settings', ops: [{ op: 'add', config: 'firewall', type: 'defaults', values: Object.fromEntries(Object.entries(all).filter(([, value]) => value !== null)) }] };
 }
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
   { id: 'forwards', label: 'Forward To', type: 'multi', options: zoneOptions(data['uci:firewall']).filter(zone => zone.value !== row?.name) },
   { id: 'family', label: 'Family', type: 'select', tab: 'Advanced', options: [{ value: '', label: 'any' }, { value: 'ipv4', label: 'ipv4' }, { value: 'ipv6', label: 'ipv6' }] },
   { id: 'device', label: 'Covered Devices', type: 'list', tab: 'Advanced' },
   { id: 'subnet', label: 'Covered Subnets', type: 'list', tab: 'Advanced' },
   { id: 'masq6', label: 'IPv6 Masquerade', type: 'bool', tab: 'Advanced' },
   { id: 'masq_src', label: 'Masquerade Sources', type: 'list', tab: 'Advanced', visible: values => values.masq || values.masq6 },
   { id: 'masq_dest', label: 'Masquerade Destinations', type: 'list', tab: 'Advanced', visible: values => values.masq || values.masq6 },
   { id: 'log', label: 'Log Dropped', type: 'bool', tab: 'Advanced' },
   { id: 'log_limit', label: 'Log Limit', type: 'text', tab: 'Advanced', placeholder: '10/minute', visible: values => values.log },
   { id: 'auto_helper', label: 'Automatic Helpers', type: 'bool', tab: 'Advanced' },
   { id: 'helper', label: 'Helpers', type: 'list', tab: 'Advanced', visible: values => !values.auto_helper }
  ];
 },
 values(row, data) {
  const zone = sections(data['uci:firewall'], 'zone').find(item => item['.name'] === row.section) ?? {};
  return {
   name: zone.name ?? '', input: zone.input ?? 'DROP', output: zone.output ?? 'DROP', forward: zone.forward ?? 'DROP',
   masq: truthy(zone.masq), mtu_fix: truthy(zone.mtu_fix), network: list(zone.network),
   forwards: sections(data['uci:firewall'], 'forwarding').filter(item => item.src === zone.name).map(item => item.dest),
   family: zone.family ?? '', device: list(zone.device), subnet: list(zone.subnet), masq6: truthy(zone.masq6), masq_src: list(zone.masq_src), masq_dest: list(zone.masq_dest),
   log: truthy(zone.log), log_limit: zone.log_limit ?? '', auto_helper: truthy(zone.auto_helper, true), helper: list(zone.helper)
  };
 },
 defaults: () => ({ name: '', input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', masq: false, mtu_fix: false, network: [], forwards: [], family: '', device: [], subnet: [], masq6: false, masq_src: [], masq_dest: [], log: false, log_limit: '', auto_helper: true, helper: [] }),

 save(values, row, data) {
  const firewall = data['uci:firewall'];
  const name = row ? row.name : values.name.trim();
  if (!row) {
   if (!NAME.test(name) || name.length > 15) invalid('name', 'Use up to 15 letters, digits or underscores');
   if (sections(firewall, 'zone').some(zone => zone.name === name)) invalid('name', `Zone ${name} already exists`);
  }
  if (values.log_limit && !LIMIT.test(values.log_limit)) invalid('log_limit', 'A limit such as 10/minute');
  for (const subnet of values.subnet ?? []) if (!parseCidr(subnet.replace(/^!/, '')) && !parseCidr6(subnet.replace(/^!/, ''))) invalid('subnet', `${subnet} is not a subnet`);
  const masquerading = values.masq || values.masq6;
  const options = compact({
   name, input: values.input, output: values.output, forward: values.forward, masq: values.masq ? '1' : '', mtu_fix: values.mtu_fix ? '1' : '', network: values.network ?? [],
   family: values.family, device: values.device ?? [], subnet: values.subnet ?? [], masq6: values.masq6 ? '1' : '', masq_src: masquerading ? values.masq_src ?? [] : [], masq_dest: masquerading ? values.masq_dest ?? [] : [],
   log: values.log ? '1' : '', log_limit: values.log ? values.log_limit : '', auto_helper: values.auto_helper === false ? '0' : '', helper: values.auto_helper === false ? values.helper ?? [] : []
  });
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


/* --- Address lists (fw4 ipset) ----------------------------------------- */

function addressOf(value) {
 const textValue = String(value ?? '').trim();
 const v4 = parseCidr(textValue);
 if (v4) return { family: 'ipv4', value: textValue.includes('/') ? `${v4.network}/${v4.prefix}` : v4.address };
 const v6 = parseCidr6(textValue);
 if (v6) return { family: 'ipv6', value: textValue.includes('/') ? `${v6.network}/${v6.prefix}` : v6.address };
 return null;
}

// RouterOS lists addresses; fw4 keeps them as entries of a named set.
// A list without entries still shows, so it can be filled or removed.
export const addressLists = {
 id: 'fw-address-lists',
 noun: 'Address List Entry',
 sources: ['uci:firewall'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'list', label: 'List', width: 140 },
  { id: 'address', label: 'Address', width: 200, sort: addressKey },
  { id: 'family', label: 'Family', width: 60 },
  { id: 'used', label: 'Used By Rules', width: 110, align: 'right' }
 ],
 flagLegend: { X: 'list disabled', E: 'empty list' },
 defaultSort: 'list',
 note: 'fw4 keeps address lists as ipset sections; rules use them on their Advanced tab.',
 rows(data) {
  const firewall = data['uci:firewall'], rows = [];
  const rules = [...sections(firewall, 'rule'), ...sections(firewall, 'redirect')];
  for (const set of sections(firewall, 'ipset').filter(item => item.name)) {
   const disabled = !truthy(set.enabled, true);
   const used = String(rules.filter(rule => text(rule.ipset).replace(/^!/, '').split(/\s+/)[0] === set.name).length);
   const entries = list(set.entry);
   const base = { section: set['.name'], set: set.name, disabled, family: set.family ?? 'ipv4' };
   if (!entries.length) rows.push({ ...base, key: `${set['.name']}:empty`, empty: true, flags: (disabled ? 'X' : '') + 'E', cells: { list: set.name, address: '', family: base.family, used } });
   entries.forEach((entry, index) => rows.push({ ...base, key: `${set['.name']}:${index}`, index, flags: disabled ? 'X' : '', cells: { list: set.name, address: entry, family: base.family, used } }));
  }
  return rows;
 },
 itemTitle: row => `Address List Entry <${row?.cells.address || row?.cells.list || 'new'}>`,
 itemStatus: row => [row.disabled ? 'list disabled' : 'list enabled', row.empty ? 'empty list' : null],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 toggleHint: 'OpenWrt enables and disables whole lists',
 commentHint: 'OpenWrt has no comments on list entries',
 fields: data => [
  { id: 'list', label: 'List', type: 'combo', options: listOptions(data['uci:firewall']), placeholder: 'blocklist' },
  { id: 'address', label: 'Address', type: 'text', placeholder: '192.0.2.0/24 or 2001:db8::1' }
 ],
 values: row => ({ list: row.set, address: row.cells.address }),
 defaults: data => ({ list: listOptions(data['uci:firewall'])[0]?.value ?? '', address: '' }),
 save(values, row, data) {
  const name = values.list.trim();
  if (!NAME.test(name)) invalid('list', 'A list name has letters, digits and underscores');
  const address = addressOf(values.address);
  if (!address) invalid('address', 'Enter an address or a prefix such as 192.0.2.0/24');
  const firewall = data['uci:firewall'];
  const target = sections(firewall, 'ipset').find(set => set.name === name);
  if (target && (target.family ?? 'ipv4') !== address.family) invalid('address', `${name} holds ${target.family ?? 'ipv4'} addresses`);
  const lists = new Map();
  const entries = set => { if (!lists.has(set['.name'])) lists.set(set['.name'], list(set.entry)); return lists.get(set['.name']); };
  if (row && !row.empty) entries(sections(firewall, 'ipset').find(set => set['.name'] === row.section))[row.index] = null;
  if (target && entries(target).includes(address.value)) invalid('address', `${address.value} is already in ${name}`);
  const ops = [];
  if (target) entries(target).push(address.value);
  for (const [section, values] of lists) ops.push({ op: 'set', config: 'firewall', section, values: { entry: values.filter(Boolean) } });
  if (!target) ops.push({ op: 'add', config: 'firewall', type: 'ipset', values: { name, family: address.family, match: ['net'], entry: [address.value] } });
  return { description: row && !row.empty ? `Change ${row.set} entry ${row.cells.address} to ${address.value}` : `Add ${address.value} to address list ${name}`, ops };
 },
 remove(rows, data) {
  const firewall = data['uci:firewall'], ops = [], lists = new Map();
  for (const row of rows) {
   if (row.empty) { ops.push({ op: 'delete', config: 'firewall', section: row.section }); continue; }
   const set = sections(firewall, 'ipset').find(item => item['.name'] === row.section);
   if (!lists.has(row.section)) lists.set(row.section, list(set.entry));
   lists.get(row.section)[row.index] = null;
  }
  for (const [section, entries] of lists) ops.push({ op: 'set', config: 'firewall', section, values: { entry: entries.filter(Boolean) } });
  return { description: `Remove ${rows.map(row => row.cells.address || `list ${row.set}`).join(', ')}`, ops };
 },
 removeBlocked: rows => {
  const used = rows.find(row => row.empty && row.cells.used !== '0');
  return used ? `A rule still uses the list ${used.set}` : null;
 },
 toggle: (rows, enable) => {
  const sets = [...new Map(rows.map(row => [row.section, row.set]))];
  return { description: `${enable ? 'Enable' : 'Disable'} address list ${sets.map(([, name]) => name).join(', ')}`, ops: sets.map(([section]) => ({ op: 'set', config: 'firewall', section, values: { enabled: enable ? null : '0' } })) };
 }
};
