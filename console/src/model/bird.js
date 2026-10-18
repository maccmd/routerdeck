// SPDX-License-Identifier: Apache-2.0
// Routing ▸ OSPF and BGP over bird. The plugin writes /etc/bird.conf from the
// ospf, ospf_area, ospf_interface and bgp sections of /etc/config/routerdeck,
// naming each protocol rd_<section>, and reports bird's state from birdc.
// A bird.conf edited by hand is left alone; its protocols are only shown.
import { sections, list, truthy, invalid, compact } from './common.js';
import { parseCidr, parseCidr6, isIPv4, canonicalIPv6 } from '../lib/ip.js';

// bird's symbols start with a letter.
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const DEVICE = /^[A-Za-z0-9_.@*?-]{1,15}$/;
// Keys are written between double quotes.
const KEY = /^[\x20\x21\x23-\x5b\x5d-\x7e]+$/;
const within = (value, low, high) => /^\d+$/.test(String(value)) && Number(value) >= low && Number(value) <= high;
const present = values => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && !(Array.isArray(value) && !value.length)));
const choices = values => values.map(value => typeof value === 'string' ? { value, label: value } : value);
const names = rows => rows.map(row => row.key).join(', ');

const protocolOf = (data, name) => (data.bird?.protocols ?? []).find(item => item.name === `rd_${name}`);
const protocolType = (data, name) => (data.bird?.protocols ?? []).find(item => item.name === name)?.proto;
// Protocols of a hand-written bird.conf, shown next to RouterDeck's own.
const foreign = (data, proto) => data.bird?.file === 'routerdeck' ? [] : (data.bird?.protocols ?? []).filter(item => item.proto === proto && !item.name.startsWith('rd_'));
const sectionName = name => name.startsWith('rd_') ? name.slice(3) : name;
const writable = data => !!data.bird?.installed && data.bird.file !== 'edited';

export function birdStatus(data, what) {
 const bird = data.bird ?? {};
 if (!bird.installed) return `${what} needs the bird2 and bird2c packages`;
 if (bird.error) return `bird did not take the configuration: ${bird.error}`;
 if (bird.file === 'edited') return '/etc/bird.conf was edited by hand, so it is only shown here';
 if (!bird.client) return 'Install bird2c to see what bird is doing';
 if (!bird.running) return 'bird is not running';
 return `bird ${bird.version}`;
}

// "0", "1" or "0.0.0.1": OSPF area IDs in dotted form.
export function areaId(text) {
 const value = String(text ?? '').trim();
 if (/^\d+$/.test(value) && Number(value) <= 4294967295) {
  const number = Number(value);
  return [24, 16, 8, 0].map(shift => Math.floor(number / 2 ** shift) % 256).join('.');
 }
 return isIPv4(value) ? value : null;
}

// A network as bird wants it: the address of the network and its length.
function prefixOf(text, v6) {
 const parsed = v6 ? parseCidr6(text, { requirePrefix: true }) : parseCidr(text, { requirePrefix: true });
 return parsed ? `${parsed.network}/${parsed.prefix}` : null;
}

function checkName(name, data) {
 if (!NAME.test(name)) invalid('name', 'Start with a letter; then letters, digits and _ (at most 32)');
 if (data['uci:routerdeck']?.[name]) invalid('name', `${name} is already used in /etc/config/routerdeck`);
}

const ORIGINATE = choices([{ value: 'never', label: 'never' }, { value: 'if-installed', label: 'if installed' }, { value: 'always', label: 'always' }]);

/* --- OSPF ------------------------------------------------------------------- */

export const ospfInstances = {
 id: 'ospf-instances',
 noun: 'OSPF Instance',
 sources: ['uci:routerdeck', 'bird'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'version', label: 'Version', width: 60 },
  { id: 'router_id', label: 'Router ID', width: 110 },
  { id: 'redistribute', label: 'Redistribute', width: 150 },
  { id: 'originate', label: 'Originate Default', width: 110, hidden: true },
  { id: 'state', label: 'State', width: 110 }
 ],
 flagLegend: { X: 'disabled', R: 'running', D: 'dynamic (written by hand)' },
 defaultSort: null,
 status: data => birdStatus(data, 'OSPF'),
 rows: data => [
  ...sections(data['uci:routerdeck'], 'ospf').map(section => {
   const name = section['.name'], disabled = truthy(section.disabled), protocol = protocolOf(data, name);
   const areas = sections(data['uci:routerdeck'], 'ospf_area').filter(area => area.instance === name && !truthy(area.disabled));
   return {
    key: name, section: name, disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (protocol?.state === 'up' ? 'R' : ''),
    cells: {
     name, version: section.version === '3' ? '3' : '2', router_id: section.router_id ?? '', redistribute: list(section.redistribute).join(', '), originate: section.originate_default ?? 'never',
     state: disabled ? '' : !areas.length ? 'no areas' : protocol ? (protocol.info || protocol.state).toLowerCase() : ''
    }
   };
  }),
  ...foreign(data, 'OSPF').map(protocol => ({
   key: `bird:${protocol.name}`, readOnly: true, dynamic: true, flags: 'D' + (protocol.state === 'up' ? 'R' : ''),
   cells: { name: protocol.name, version: protocol.table === 'master6' ? '3' : '2', router_id: '', redistribute: '', originate: '', state: (protocol.info || protocol.state).toLowerCase() }
  }))
 ],
 itemTitle: row => `OSPF Instance <${row?.cells.name ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.cells.state || 'not running'],
 canAdd: data => writable(data),
 canRemove: row => !row.readOnly,
 canToggle: row => !row.readOnly,
 canComment: row => !row.readOnly,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'ospf1' },
  { id: 'version', label: 'Version', type: 'select', options: [{ value: '2', label: '2 (IPv4)' }, { value: '3', label: '3 (IPv6)' }] },
  { id: 'router_id', label: 'Router ID', type: 'text', placeholder: 'chosen by bird when empty' },
  { id: 'redistribute', label: 'Redistribute', type: 'multi', options: choices(['connected', 'static', 'bgp']) },
  { id: 'originate_default', label: 'Originate Default', type: 'select', options: ORIGINATE }
 ],
 values: (row, data) => {
  const section = data['uci:routerdeck'][row.section] ?? {};
  return { name: row.key, version: section.version === '3' ? '3' : '2', router_id: section.router_id ?? '', redistribute: list(section.redistribute), originate_default: section.originate_default ?? 'never' };
 },
 defaults: () => ({ name: '', version: '2', router_id: '', redistribute: [], originate_default: 'never' }),
 save(values, row, data) {
  const name = row ? row.section : String(values.name ?? '').trim();
  if (!row) checkName(name, data);
  if (values.router_id && !isIPv4(values.router_id)) invalid('router_id', 'An IPv4 address, such as 10.255.0.1');
  const result = compact({ version: values.version === '3' ? '3' : '', router_id: values.router_id, redistribute: values.redistribute ?? [], originate_default: values.originate_default === 'never' ? '' : values.originate_default });
  return row
   ? { description: `Change OSPF instance ${name}`, ops: [{ op: 'set', config: 'routerdeck', section: name, values: result }] }
   : { description: `Add OSPF instance ${name}`, ops: [{ op: 'add', config: 'routerdeck', type: 'ospf', name, values: present(result) }] };
 },
 removeBlocked(rows, data) {
  for (const row of rows) {
   const used = sections(data['uci:routerdeck'], 'ospf_area').filter(area => area.instance === row.section).map(area => area['.name']);
   if (used.length) return `${row.key} still has areas ${used.join(', ')}`;
  }
  return null;
 },
 remove: rows => ({ description: `Remove OSPF instance ${names(rows)}`, ops: rows.map(row => ({ op: 'delete', config: 'routerdeck', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} OSPF instance ${names(rows)}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment OSPF instance ${names(rows)}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { comment: comment || null } })) })
};

const instanceOptions = data => sections(data['uci:routerdeck'], 'ospf').map(section => ({ value: section['.name'], label: section['.name'] }));

export const ospfAreas = {
 id: 'ospf-areas',
 noun: 'OSPF Area',
 sources: ['uci:routerdeck', 'bird'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'instance', label: 'Instance', width: 100 },
  { id: 'area_id', label: 'Area ID', width: 100 },
  { id: 'type', label: 'Type', width: 70 },
  { id: 'templates', label: 'Templates', width: 70, align: 'right' }
 ],
 flagLegend: { X: 'disabled' },
 defaultSort: null,
 status: data => birdStatus(data, 'OSPF'),
 rows: data => sections(data['uci:routerdeck'], 'ospf_area').map(section => {
  const name = section['.name'], disabled = truthy(section.disabled);
  return {
   key: name, section: name, disabled, comment: section.comment, flags: disabled ? 'X' : '',
   cells: { name, instance: section.instance ?? '', area_id: section.area_id ?? '0.0.0.0', type: section.type ?? 'default', templates: String(sections(data['uci:routerdeck'], 'ospf_interface').filter(item => item.area === name).length) }
  };
 }),
 itemTitle: row => `OSPF Area <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled'],
 canAdd: data => writable(data),
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'backbone' },
  { id: 'instance', label: 'Instance', type: 'select', options: instanceOptions(data) },
  { id: 'area_id', label: 'Area ID', type: 'text', placeholder: '0.0.0.0 is the backbone' },
  { id: 'type', label: 'Type', type: 'select', options: choices(['default', 'stub', 'nssa']) }
 ],
 values: (row, data) => {
  const section = data['uci:routerdeck'][row.section] ?? {};
  return { name: row.key, instance: section.instance ?? '', area_id: section.area_id ?? '0.0.0.0', type: section.type ?? 'default' };
 },
 defaults: data => ({ name: '', instance: instanceOptions(data)[0]?.value ?? '', area_id: '0.0.0.0', type: 'default' }),
 save(values, row, data) {
  const name = row ? row.section : String(values.name ?? '').trim();
  if (!row) checkName(name, data);
  if (!values.instance || !sections(data['uci:routerdeck'], 'ospf').some(section => section['.name'] === values.instance)) invalid('instance', 'Add an OSPF instance first');
  const id = areaId(values.area_id);
  if (!id) invalid('area_id', 'An area ID such as 0.0.0.0 or 1');
  if (id === '0.0.0.0' && values.type !== 'default') invalid('type', 'The backbone area 0.0.0.0 cannot be a stub or NSSA');
  const twin = sections(data['uci:routerdeck'], 'ospf_area').find(area => area['.name'] !== name && area.instance === values.instance && (area.area_id ?? '0.0.0.0') === id);
  if (twin) invalid('area_id', `${values.instance} already has area ${id} (${twin['.name']})`);
  const result = compact({ instance: values.instance, area_id: id, type: values.type === 'default' ? '' : values.type });
  return row
   ? { description: `Change OSPF area ${name}`, ops: [{ op: 'set', config: 'routerdeck', section: name, values: result }] }
   : { description: `Add OSPF area ${name}`, ops: [{ op: 'add', config: 'routerdeck', type: 'ospf_area', name, values: present(result) }] };
 },
 removeBlocked(rows, data) {
  for (const row of rows) {
   const used = sections(data['uci:routerdeck'], 'ospf_interface').filter(item => item.area === row.section).length;
   if (used) return `${row.key} is used by ${used} interface templates`;
  }
  return null;
 },
 remove: rows => ({ description: `Remove OSPF area ${names(rows)}`, ops: rows.map(row => ({ op: 'delete', config: 'routerdeck', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} OSPF area ${names(rows)}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment OSPF area ${names(rows)}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { comment: comment || null } })) })
};

const AUTH = choices([{ value: 'none', label: 'none' }, { value: 'simple', label: 'simple (OSPFv2)' }, { value: 'md5', label: 'MD5 (OSPFv2)' }, { value: 'sha256', label: 'HMAC-SHA-256' }]);
const KEY_LENGTH = { simple: 8, md5: 16, sha256: 64 };

function areaOf(data, name) {
 const area = data['uci:routerdeck']?.[name];
 return area?.['.type'] === 'ospf_area' ? area : null;
}

const templateLabel = section => [...list(section.interface), ...list(section.network)].join(', ') || section['.name'];

export const ospfTemplates = {
 id: 'ospf-templates',
 noun: 'Interface Template',
 sources: ['uci:routerdeck', 'devices', 'bird'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'interfaces', label: 'Interfaces', width: 130 },
  { id: 'networks', label: 'Networks', width: 140 },
  { id: 'area', label: 'Area', width: 100 },
  { id: 'cost', label: 'Cost', width: 50, align: 'right' },
  { id: 'priority', label: 'Priority', width: 60, align: 'right' },
  { id: 'type', label: 'Network Type', width: 100 },
  { id: 'auth', label: 'Authentication', width: 100, hidden: true }
 ],
 flagLegend: { X: 'disabled', P: 'passive' },
 defaultSort: null,
 status: data => birdStatus(data, 'OSPF'),
 rows: data => sections(data['uci:routerdeck'], 'ospf_interface').map(section => {
  const disabled = truthy(section.disabled);
  return {
   key: section['.name'], section: section['.name'], label: templateLabel(section), disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (truthy(section.passive) ? 'P' : ''),
   cells: {
    interfaces: list(section.interface).join(', '), networks: list(section.network).join(', '), area: section.area ?? '', cost: section.cost ?? '10', priority: section.priority ?? '1',
    type: { broadcast: 'broadcast', ptp: 'point-to-point', ptmp: 'point-to-multipoint' }[section.type] ?? 'detected', auth: section.auth ?? 'none'
   }
  };
 }),
 itemTitle: row => `Interface Template <${row?.label ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled'],
 canAdd: data => writable(data),
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => {
  const current = row ? list(data['uci:routerdeck']?.[row.section]?.interface) : [];
  const devices = [...new Set([...Object.keys(data.devices ?? {}).filter(name => name !== 'lo').sort(), ...current])];
  return [
   { id: 'interface', label: 'Interfaces', type: 'multi', options: choices(devices) },
   { id: 'network', label: 'Networks', type: 'list' },
   { id: 'area', label: 'Area', type: 'select', options: sections(data['uci:routerdeck'], 'ospf_area').map(area => ({ value: area['.name'], label: `${area['.name']} (${area.instance ?? '?'} ${area.area_id ?? '0.0.0.0'})` })) },
   { id: 'cost', label: 'Cost', type: 'number', placeholder: '10' },
   { id: 'priority', label: 'Priority', type: 'number', placeholder: '1' },
   { id: 'type', label: 'Network Type', type: 'select', options: choices([{ value: 'auto', label: 'detected' }, 'broadcast', { value: 'ptp', label: 'point-to-point' }, { value: 'ptmp', label: 'point-to-multipoint' }]) },
   { id: 'passive', label: 'Passive', type: 'bool' },
   { id: 'hello', label: 'Hello Interval', type: 'number', placeholder: '10 s', tab: 'Advanced' },
   { id: 'dead', label: 'Dead Interval', type: 'number', placeholder: '4 hello intervals', tab: 'Advanced' },
   { id: 'auth', label: 'Authentication', type: 'select', options: AUTH, tab: 'Advanced' },
   { id: 'auth_key', label: 'Authentication Key', type: 'password', tab: 'Advanced', visible: values => values.auth && values.auth !== 'none' }
  ];
 },
 values: (row, data) => {
  const section = data['uci:routerdeck'][row.section] ?? {};
  return {
   interface: list(section.interface), network: list(section.network), area: section.area ?? '', cost: section.cost ?? '', priority: section.priority ?? '', type: section.type ?? 'auto', passive: truthy(section.passive),
   hello: section.hello ?? '', dead: section.dead ?? '', auth: section.auth ?? 'none', auth_key: section.auth_key ?? ''
  };
 },
 defaults: data => ({ interface: [], network: [], area: sections(data['uci:routerdeck'], 'ospf_area')[0]?.['.name'] ?? '', cost: '', priority: '', type: 'auto', passive: false, hello: '', dead: '', auth: 'none', auth_key: '' }),
 save(values, row, data) {
  const area = areaOf(data, values.area);
  if (!area) invalid('area', 'Add an OSPF area first');
  const v3 = data['uci:routerdeck']?.[area.instance]?.version === '3';
  const interfaces = (values.interface ?? []).filter(Boolean);
  for (const device of interfaces) if (!DEVICE.test(device)) invalid('interface', `${device} is not an interface name`);
  const networks = [];
  for (const text of (values.network ?? []).map(item => item.trim()).filter(Boolean)) {
   const prefix = prefixOf(text, v3);
   if (!prefix) invalid('network', `${text} is not an ${v3 ? 'IPv6' : 'IPv4'} network such as ${v3 ? '2001:db8:1::/64' : '10.0.0.0/24'} (the instance runs OSPFv${v3 ? 3 : 2})`);
   networks.push(prefix);
  }
  if (!interfaces.length && !networks.length) invalid('interface', 'Choose interfaces or enter networks');
  if (values.cost && !within(values.cost, 1, 65535)) invalid('cost', 'From 1 to 65535');
  if (values.priority && !within(values.priority, 0, 255)) invalid('priority', 'From 0 to 255; 0 never becomes the designated router');
  if (values.hello && !within(values.hello, 1, 65535)) invalid('hello', 'Seconds, from 1');
  if (values.dead && !within(values.dead, 2, 65535)) invalid('dead', 'Seconds, from 2');
  if (values.dead && Number(values.dead) <= Number(values.hello || 10)) invalid('dead', 'Longer than the hello interval');
  const auth = values.auth ?? 'none';
  if (v3 && (auth === 'simple' || auth === 'md5')) invalid('auth', 'OSPFv3 authenticates only with HMAC-SHA-256');
  if (auth !== 'none') {
   const key = values.auth_key ?? '';
   if (!key) invalid('auth_key', 'Enter the key the neighbors use');
   if (!KEY.test(key)) invalid('auth_key', 'Printable characters without " and \\');
   if (key.length > KEY_LENGTH[auth]) invalid('auth_key', `At most ${KEY_LENGTH[auth]} characters for this authentication`);
  }
  const result = compact({
   area: values.area, interface: interfaces, network: networks, cost: values.cost, priority: values.priority, type: values.type === 'auto' ? '' : values.type, passive: values.passive ? '1' : '',
   hello: values.hello, dead: values.dead, auth: auth === 'none' ? '' : auth, auth_key: auth === 'none' ? '' : values.auth_key
  });
  const label = [...interfaces, ...networks].join(', ');
  return row
   ? { description: `Change OSPF interface template ${label}`, ops: [{ op: 'set', config: 'routerdeck', section: row.section, values: result }] }
   : { description: `Add OSPF interface template ${label}`, ops: [{ op: 'add', config: 'routerdeck', type: 'ospf_interface', values: present(result) }] };
 },
 remove: rows => ({ description: `Remove OSPF interface template ${rows.map(row => row.label).join('; ')}`, ops: rows.map(row => ({ op: 'delete', config: 'routerdeck', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} OSPF interface template ${rows.map(row => row.label).join('; ')}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: 'Comment OSPF interface template', ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { comment: comment || null } })) })
};

const staticFields = model => () => model.columns.filter(column => column.label).map(column => ({ id: column.id, label: column.label, type: 'static' }));

export const ospfNeighbors = {
 id: 'ospf-neighbors',
 noun: 'OSPF Neighbor',
 readOnly: true,
 sources: ['bird'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'instance', label: 'Instance', width: 100 },
  { id: 'router_id', label: 'Router ID', width: 110 },
  { id: 'address', label: 'Address', width: 140 },
  { id: 'interface', label: 'Interface', width: 90 },
  { id: 'priority', label: 'Priority', width: 60, align: 'right' },
  { id: 'state', label: 'State', width: 110 },
  { id: 'dead', label: 'Dead In', width: 70, align: 'right' }
 ],
 flagLegend: { F: 'full adjacency' },
 defaultSort: null,
 status: data => birdStatus(data, 'OSPF'),
 rows: data => (data.bird?.neighbors ?? []).map(item => ({
  key: `${item.protocol}:${item.router_id}:${item.interface}:${item.address}`, readOnly: true, flags: /^Full/.test(item.state) ? 'F' : '',
  cells: { instance: sectionName(item.protocol), router_id: item.router_id, address: item.address, interface: item.interface, priority: String(item.priority), state: item.state, dead: `${Math.round(Number(item.dead) || 0)} s` }
 })),
 itemTitle: row => `OSPF Neighbor <${row.cells.router_id}>`,
 values: row => ({ ...row.cells })
};
ospfNeighbors.fields = staticFields(ospfNeighbors);

const LSA_TYPES = {
 '0001': 'router', '0002': 'network', '0003': 'summary-network', '0004': 'summary-asbr', '0005': 'external', '0007': 'nssa-external',
 '2001': 'router', '2002': 'network', '2003': 'inter-area-prefix', '2004': 'inter-area-router', '4005': 'external', '2007': 'nssa-external', '0008': 'link', '2009': 'intra-area-prefix'
};

export const ospfLsas = {
 id: 'ospf-lsas',
 noun: 'LSA',
 readOnly: true,
 sources: ['bird'],
 columns: [
  { id: 'instance', label: 'Instance', width: 90 },
  { id: 'area', label: 'Area', width: 90 },
  { id: 'type', label: 'Type', width: 120 },
  { id: 'id', label: 'ID', width: 110 },
  { id: 'originator', label: 'Originator', width: 110 },
  { id: 'sequence', label: 'Sequence', width: 80 },
  { id: 'age', label: 'Age', width: 50, align: 'right', sort: value => Number(value) || 0 },
  { id: 'checksum', label: 'Checksum', width: 70 }
 ],
 defaultSort: null,
 status: data => birdStatus(data, 'OSPF'),
 rows: data => (data.bird?.lsas ?? []).map(item => {
  const area = /^Area (\S+)/.exec(item.scope ?? '')?.[1] ?? (item.scope === 'Global' ? 'AS' : item.scope ?? '');
  return {
   key: `${item.protocol}:${item.scope}:${item.type}:${item.id}:${item.router}`, readOnly: true, flags: '',
   cells: { instance: sectionName(item.protocol), area, type: LSA_TYPES[item.type] ?? item.type, id: item.id, originator: item.router, sequence: item.sequence, age: String(item.age), checksum: item.checksum }
  };
 }),
 itemTitle: row => `LSA <${row.cells.type} ${row.cells.id}>`,
 values: row => ({ ...row.cells })
};
ospfLsas.fields = staticFields(ospfLsas);

/* --- BGP -------------------------------------------------------------------- */

export const bgpConnections = {
 id: 'bgp-connections',
 noun: 'BGP Connection',
 sources: ['uci:routerdeck', 'bird'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 100 },
  { id: 'remote', label: 'Remote Address', width: 140 },
  { id: 'remote_as', label: 'Remote AS', width: 80, align: 'right' },
  { id: 'as', label: 'Local AS', width: 80, align: 'right' },
  { id: 'networks', label: 'Networks', width: 150 },
  { id: 'redistribute', label: 'Redistribute', width: 120, hidden: true },
  { id: 'state', label: 'State', width: 100 }
 ],
 flagLegend: { X: 'disabled', E: 'established', D: 'dynamic (written by hand)' },
 defaultSort: null,
 status: data => birdStatus(data, 'BGP'),
 rows: data => [
  ...sections(data['uci:routerdeck'], 'bgp').map(section => {
   const name = section['.name'], disabled = truthy(section.disabled), protocol = protocolOf(data, name);
   const state = protocol?.details?.['BGP state'] ?? protocol?.info ?? '';
   return {
    key: name, section: name, disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (state === 'Established' ? 'E' : ''),
    cells: { name, remote: section.remote_address ?? '', remote_as: section.remote_as ?? '', as: section.as ?? '', networks: list(section.network).join(', '), redistribute: list(section.redistribute).join(', '), state: disabled ? '' : state.toLowerCase() }
   };
  }),
  ...foreign(data, 'BGP').map(protocol => ({
   key: `bird:${protocol.name}`, readOnly: true, dynamic: true, flags: 'D' + (protocol.details?.['BGP state'] === 'Established' ? 'E' : ''),
   cells: { name: protocol.name, remote: protocol.details?.['Neighbor address'] ?? '', remote_as: protocol.details?.['Neighbor AS'] ?? '', as: protocol.details?.['Local AS'] ?? '', networks: '', redistribute: '', state: (protocol.details?.['BGP state'] ?? protocol.info ?? '').toLowerCase() }
  }))
 ],
 itemTitle: row => `BGP Connection <${row?.cells.name ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.cells.state || 'not running'],
 canAdd: data => writable(data),
 canRemove: row => !row.readOnly,
 canToggle: row => !row.readOnly,
 canComment: row => !row.readOnly,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'isp' },
  { id: 'as', label: 'Local AS', type: 'number', placeholder: '65001' },
  { id: 'remote_address', label: 'Remote Address', type: 'text', placeholder: '192.0.2.1 or 2001:db8::1' },
  { id: 'remote_as', label: 'Remote AS', type: 'number', placeholder: '65000; the local AS for iBGP' },
  { id: 'network', label: 'Networks', type: 'list' },
  { id: 'redistribute', label: 'Redistribute', type: 'multi', options: choices(['connected', 'static', 'ospf', 'bgp']) },
  { id: 'originate_default', label: 'Originate Default', type: 'select', options: ORIGINATE },
  { id: 'local_address', label: 'Local Address', type: 'text', placeholder: 'chosen by the routing table', tab: 'Advanced' },
  { id: 'router_id', label: 'Router ID', type: 'text', placeholder: 'chosen by bird when empty', tab: 'Advanced' },
  { id: 'multihop', label: 'Multihop TTL', type: 'number', placeholder: 'directly connected for eBGP', tab: 'Advanced' },
  { id: 'hold_time', label: 'Hold Time', type: 'number', placeholder: '240 s', tab: 'Advanced' },
  { id: 'password', label: 'TCP MD5 Key', type: 'password', tab: 'Advanced' }
 ],
 values: (row, data) => {
  const section = data['uci:routerdeck'][row.section] ?? {};
  return {
   name: row.key, as: section.as ?? '', remote_address: section.remote_address ?? '', remote_as: section.remote_as ?? '', network: list(section.network), redistribute: list(section.redistribute),
   originate_default: section.originate_default ?? 'never', local_address: section.local_address ?? '', router_id: section.router_id ?? '', multihop: section.multihop ?? '', hold_time: section.hold_time ?? '', password: section.password ?? ''
  };
 },
 // A new connection keeps the local AS of the others.
 defaults: data => ({ name: '', as: sections(data['uci:routerdeck'], 'bgp')[0]?.as ?? '', remote_address: '', remote_as: '', network: [], redistribute: [], originate_default: 'never', local_address: '', router_id: '', multihop: '', hold_time: '', password: '' }),
 save(values, row, data) {
  const name = row ? row.section : String(values.name ?? '').trim();
  if (!row) checkName(name, data);
  if (!within(values.as, 1, 4294967295)) invalid('as', 'An AS number from 1 to 4294967295');
  const remote = String(values.remote_address ?? '').trim();
  const v6 = remote.includes(':');
  const address = v6 ? canonicalIPv6(remote) : isIPv4(remote) ? remote : null;
  if (!address) invalid('remote_address', 'The IPv4 or IPv6 address of the neighbor');
  if (!within(values.remote_as, 1, 4294967295)) invalid('remote_as', 'An AS number from 1 to 4294967295');
  const local = String(values.local_address ?? '').trim();
  if (local && !(v6 ? canonicalIPv6(local) : isIPv4(local))) invalid('local_address', `An ${v6 ? 'IPv6' : 'IPv4'} address of this router, like the remote address`);
  const networks = [];
  for (const text of (values.network ?? []).map(item => item.trim()).filter(Boolean)) {
   const prefix = prefixOf(text, v6);
   if (!prefix) invalid('network', `${text} is not an ${v6 ? 'IPv6' : 'IPv4'} network such as ${v6 ? '2001:db8:1::/48' : '203.0.113.0/24'} (the neighbor is ${v6 ? 'IPv6' : 'IPv4'})`);
   if (!networks.includes(prefix)) networks.push(prefix);
  }
  if (values.router_id && !isIPv4(values.router_id)) invalid('router_id', 'An IPv4 address, such as 10.255.0.1');
  if (values.multihop && !within(values.multihop, 1, 255)) invalid('multihop', 'A TTL from 1 to 255');
  if (values.hold_time && !(within(values.hold_time, 3, 65535) || values.hold_time === '0')) invalid('hold_time', '0, or from 3 to 65535 seconds');
  if (values.password && (!KEY.test(values.password) || values.password.length > 80)) invalid('password', 'Printable characters without " and \\, at most 80');
  const result = compact({
   as: values.as, remote_address: v6 ? address : remote, remote_as: values.remote_as, network: networks, redistribute: values.redistribute ?? [], originate_default: values.originate_default === 'never' ? '' : values.originate_default,
   local_address: local ? (v6 ? canonicalIPv6(local) : local) : '', router_id: values.router_id, multihop: values.multihop, hold_time: values.hold_time, password: values.password
  });
  return row
   ? { description: `Change BGP connection ${name}`, ops: [{ op: 'set', config: 'routerdeck', section: name, values: result }] }
   : { description: `Add BGP connection ${name}`, ops: [{ op: 'add', config: 'routerdeck', type: 'bgp', name, values: present(result) }] };
 },
 remove: rows => ({ description: `Remove BGP connection ${names(rows)}`, ops: rows.map(row => ({ op: 'delete', config: 'routerdeck', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} BGP connection ${names(rows)}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment BGP connection ${names(rows)}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { comment: comment || null } })) })
};

export const bgpSessions = {
 id: 'bgp-sessions',
 noun: 'BGP Session',
 readOnly: true,
 sources: ['bird'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 100 },
  { id: 'remote', label: 'Remote Address', width: 140 },
  { id: 'remote_as', label: 'Remote AS', width: 80, align: 'right' },
  { id: 'remote_id', label: 'Remote ID', width: 110 },
  { id: 'state', label: 'State', width: 100 },
  { id: 'since', label: 'Since', width: 100 },
  { id: 'prefixes', label: 'Prefixes (in/out)', width: 110 },
  { id: 'error', label: 'Last Error', width: 200 }
 ],
 flagLegend: { E: 'established' },
 defaultSort: null,
 status: data => birdStatus(data, 'BGP'),
 rows: data => (data.bird?.protocols ?? []).filter(item => item.proto === 'BGP').map(item => {
  const details = item.details ?? {}, state = details['BGP state'] ?? item.info ?? item.state;
  return {
   key: item.name, readOnly: true, flags: state === 'Established' ? 'E' : '',
   cells: {
    name: sectionName(item.name), remote: details['Neighbor address'] ?? '', remote_as: details['Neighbor AS'] ?? '', remote_id: details['Neighbor ID'] ?? '', state: state.toLowerCase(), since: item.since ?? '',
    prefixes: state === 'Established' ? `${item.imported ?? 0}/${item.exported ?? 0}` : '', error: details['Last error'] ?? (state === 'Established' ? '' : /Socket:|Error:/.test(item.info ?? '') ? item.info.replace(/^\S+\s+/, '') : '')
   }
  };
 }),
 itemTitle: row => `BGP Session <${row.cells.name}>`,
 values: row => ({ ...row.cells })
};
bgpSessions.fields = staticFields(bgpSessions);

// Routes bird learned by OSPF or BGP, the best one marked active.
function birdRoutes(id, proto, noun) {
 const model = {
  id,
  noun,
  readOnly: true,
  sources: ['bird'],
  columns: [
   { id: 'flags', label: '', width: 30 },
   { id: 'dst', label: 'Dst. Address', width: 150 },
   { id: 'gateway', label: 'Gateway', width: 130 },
   { id: 'interface', label: 'Interface', width: 80 },
   { id: 'protocol', label: proto === 'OSPF' ? 'Instance' : 'Connection', width: 90 },
   { id: 'kind', label: proto === 'OSPF' ? 'Type' : 'AS Path', width: 90 },
   { id: 'distance', label: 'Preference', width: 70, align: 'right' },
   { id: 'metric', label: 'Metric', width: 60, align: 'right' }
  ],
  flagLegend: { A: 'active (the best route bird has)' },
  defaultSort: null,
  status: data => birdStatus(data, proto) + (data.bird?.truncated ? '; only the first 2000 routes are shown' : ''),
  rows: data => (data.bird?.routes ?? []).filter(route => protocolType(data, route.protocol) === proto).map(route => ({
   key: `${route.protocol}:${route.dst}:${route.gateway ?? ''}:${route.interface ?? ''}`, readOnly: true, flags: route.best ? 'A' : '',
   cells: {
    dst: route.dst, gateway: route.gateway ?? '', interface: route.interface ?? '', protocol: sectionName(route.protocol),
    kind: proto === 'OSPF' ? { I: 'intra-area', IA: 'inter-area', E1: 'external 1', E2: 'external 2' }[route.ospf] ?? '' : route.origin ?? '', distance: String(route.preference ?? ''), metric: route.metric ?? ''
   }
  })),
  itemTitle: row => `${noun} <${row.cells.dst}>`,
  values: row => ({ ...row.cells })
 };
 model.fields = staticFields(model);
 return model;
}

export const ospfRoutes = birdRoutes('ospf-routes', 'OSPF', 'OSPF Route');
export const bgpRoutes = birdRoutes('bgp-routes', 'BGP', 'BGP Route');
