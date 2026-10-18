// SPDX-License-Identifier: Apache-2.0
// A RouterOS-style command line over the same models as the windows: menus
// such as /ip/address with print, find, add, set, remove, enable, disable,
// comment and export, plus ping, traceroute, undo and redo. Property names
// come from the form labels, so the CLI and the windows always agree.
// Everything around it is injected: data loading, applying changes, jobs
// and output, so it runs unchanged in unit tests.
import { MODELS } from '../model/index.js';
import { ValidationError } from '../model/common.js';
import { tokenize, quote, propertyName, pick, CliError } from './parser.js';
import { pingView, traceView, ms } from '../model/tools.js';

const TREE = {
 interface: { model: 'interfaces', export: false, children: {
  bridge: { model: 'bridges', children: { port: { model: 'bridge-ports' }, vlan: { model: 'bridge-vlans' } } },
  network: { model: 'networks' },
  'pppoe-client': { model: 'ppp' },
  wifi: { model: 'wifi-interfaces', children: { radio: { model: 'wifi-radios' }, 'registration-table': { model: 'wifi-registration' } } }
 } },
 ip: { children: {
  address: { model: 'addresses' },
  route: { model: 'routes' },
  firewall: { children: { filter: { model: 'fw-filter' }, nat: { model: 'fw-nat' }, connection: { model: 'connections' }, zone: { model: 'fw-zones' } } },
  'dhcp-server': { model: 'dhcp-servers', children: { lease: { model: 'dhcp-leases' } } },
  dns: { model: 'dns-settings', children: { static: { model: 'dns-static' } } }
 } },
 ipv6: { children: {
  address: { model: 'addresses6' },
  route: { model: 'routes6' },
  'dhcp-server': { children: { binding: { model: 'dhcp6-bindings' } } }
 } },
 log: { model: 'log' },
 system: { commands: ['reboot'], children: {
  identity: { model: 'system-identity' }, clock: { model: 'system-clock' }, ntp: { children: { client: { model: 'system-ntp' } } },
  logging: { model: 'system-logging' }, package: { model: 'system-packages' }, scheduler: { model: 'system-scheduler' },
  startup: { model: 'system-startup' }, resource: { model: 'system-resources' }, history: { special: 'history' }
 } },
 tool: { commands: ['traceroute', 'torch'] }
};

function build(spec, name, parent) {
 const node = { name, parent, model: spec.model ? MODELS[spec.model] : null, special: spec.special, exportable: spec.export !== false, extra: spec.commands ?? [], children: {} };
 for (const [child, childSpec] of Object.entries(spec.children ?? {})) node.children[child] = build(childSpec, child, node);
 return node;
}

export const ROOT = build({ children: TREE }, '', null);
export const pathOf = node => !node.parent ? '/' : `${pathOf(node.parent) === '/' ? '' : pathOf(node.parent)}/${node.name}`;

const ROOT_COMMANDS = ['ping', 'undo', 'redo', 'export', 'quit'];
const HELP = {
 print: 'Print the items', find: 'Show the numbers of matching items', add: 'Create a new item', set: 'Change item properties', remove: 'Remove items',
 enable: 'Enable items', disable: 'Disable items', comment: 'Set the comment of items', export: 'Print the configuration as commands',
 ping: 'Send ICMP echo requests', traceroute: 'Trace the route to a host', torch: 'Watch traffic per connection (opens a window)',
 undo: 'Undo the last change', redo: 'Redo the last undone change', quit: 'Close this terminal', reboot: 'Reboot the router (asks first)', '..': 'Go up one level', '/': 'Go to the top level'
};
const YES = ['yes', 'true', 'on', '1'], NO = ['no', 'false', 'off', '0'];

function commandsOf(node) {
 const model = node.model, list = [];
 if (model) {
  list.push('print');
  if (!model.singleton) list.push('find');
  if (!model.readOnly && model.save) {
   if (!model.singleton && model.canAdd) list.push('add');
   list.push('set');
   if (model.remove) list.push('remove');
   if (model.toggle) list.push('enable', 'disable');
   if (model.comment) list.push('comment');
   if (node.exportable) list.push('export');
  }
  for (const tool of model.tools ?? []) list.push(tool.id);
 }
 if (node.special) list.push('print');
 if (node.special === 'history') list.push('undo', 'redo');
 return [...list, ...node.extra];
}

function compare(column, a, b) {
 const key = column.sort ?? (value => value);
 const left = key(a.cells[column.id] ?? '', a), right = key(b.cells[column.id] ?? '', b);
 if (typeof left === 'number' && typeof right === 'number') return left - right;
 return String(left).localeCompare(String(right), undefined, { numeric: true });
}

function sortedRows(model, data) {
 const rows = model.rows(data);
 const column = model.defaultSort && model.columns?.find(item => item.id === model.defaultSort);
 return column ? rows.slice().sort((a, b) => compare(column, a, b)) : rows;
}

// Form fields with their property names; notes are not properties.
function fieldsOf(model, data, row, params = {}) {
 const seen = new Set();
 return (model.fields?.(data, row, params) ?? []).filter(field => field.label && field.type !== 'note').map(field => {
  let name = propertyName(field.label) || field.id;
  if (seen.has(name)) name = field.id;
  seen.add(name);
  return { ...field, name };
 });
}

function display(field, value, values) {
 if (field.type === 'static' && field.value) return String(field.value(values) ?? '');
 if (value == null) return '';
 if (field.type === 'bool') return value ? 'yes' : 'no';
 if (field.type === 'negatable') return value?.value ? `${value.negate ? '!' : ''}${value.value}` : '';
 if (Array.isArray(value)) return value.join(',');
 return String(value);
}

const optionsOf = (field, values) => (typeof field.options === 'function' ? field.options(values) : field.options) ?? [];

function parseValue(field, text, values) {
 const choose = item => {
  const options = optionsOf(field, values);
  const allowEmpty = typeof field.allowEmpty === 'function' ? field.allowEmpty(values) : field.allowEmpty;
  if (item === '' && allowEmpty) return '';
  const lower = item.toLowerCase();
  const found = options.find(option => String(option.value) === item) ?? options.find(option => String(option.value).toLowerCase() === lower || String(option.label).toLowerCase() === lower);
  if (!found) throw new CliError(`input does not match any value of ${field.name}: ${options.map(option => option.value).filter(value => value !== '').join(', ') || 'none available'}`);
  return found.value;
 };
 switch (field.type) {
  case 'bool':
   if (YES.includes(text.toLowerCase())) return true;
   if (NO.includes(text.toLowerCase())) return false;
   throw new CliError(`${field.name} is yes or no`);
  case 'select': return choose(text);
  case 'multi': return text.split(',').map(item => item.trim()).filter(Boolean).map(choose);
  case 'list': return text.split(',').map(item => item.trim()).filter(Boolean);
  case 'negatable': return text.startsWith('!') ? { negate: true, value: text.slice(1) } : { negate: false, value: text };
  default: return text;
 }
}

// Properties of an item: its form values, then the list columns.
function properties(model, row, data) {
 const result = new Map();
 if (model.fields && model.values) {
  let values = null;
  try { values = model.values(row, data); } catch { values = null; }
  if (values) {
   for (const field of fieldsOf(model, data, row)) {
    if (field.visible && !field.visible(values)) continue;
    result.set(field.name, display(field, values[field.id], values));
   }
  }
 }
 for (const column of model.columns ?? []) {
  if (column.id === 'flags' || column.label === '#') continue;
  const name = propertyName(column.label) || column.id;
  if (!result.has(name)) result.set(name, String(row.cells?.[column.id] ?? ''));
 }
 return result;
}

function conditionsOf(words) {
 const conditions = [];
 for (const word of words) {
  if (!word.op && ['where', 'and'].includes(word.text)) continue;
  if (word.op) conditions.push({ name: word.key, op: word.op, value: word.value });
  else if (word.text.startsWith('!')) conditions.push({ name: word.text.slice(1), op: 'no' });
  else conditions.push({ name: word.text, op: 'yes' });
 }
 return conditions;
}

function matches(conditions, model, row, data) {
 if (!conditions.length) return true;
 const props = properties(model, row, data);
 props.set('disabled', row.disabled ? 'yes' : 'no');
 props.set('dynamic', row.dynamic ? 'yes' : 'no');
 props.set('comment', row.comment ?? '');
 return conditions.every(condition => {
  const name = pick([...props.keys()], condition.name);
  if (!name) throw new CliError(`no such property ${condition.name}`);
  const value = props.get(name);
  if (condition.op === '=') return value === condition.value;
  if (condition.op === '!=') return value !== condition.value;
  if (condition.op === '~') {
   try { return new RegExp(condition.value).test(value); } catch { throw new CliError(`invalid regular expression ${condition.value}`); }
  }
  const set = value !== '' && value !== 'no' && value !== 'false';
  return condition.op === 'yes' ? set : !set;
 });
}

function wrap(pairs, indent, width = 100) {
 const lines = [];
 let line = '';
 for (const pair of pairs) {
  if (line && indent + line.length + 1 + pair.length > width) { lines.push(line); line = pair; }
  else line = line ? `${line} ${pair}` : pair;
 }
 if (line) lines.push(line);
 return lines;
}

const flagsHeader = model => {
 const entries = Object.entries(model.flagLegend ?? {});
 return entries.length ? `Flags: ${entries.map(([flag, text]) => `${flag} - ${text.toUpperCase()}`).join('; ')}` : null;
};

export function createCli({ load, apply, undo, redo, createJob, out, user = 'root', identity = () => 'router', safe = () => false, openWindow = () => {}, close = () => {}, reboot = async () => {}, now = () => new Date() }) {
 let current = ROOT;
 let running = null;
 // A question such as "Reboot, yes? [y/N]:" waits for the next line.
 let pending = null;
 const numbering = new Map();

 const prompt = () => pending ? pending.question : `[${user}@${identity()}] ${safe() ? '<SAFE> ' : ''}${current === ROOT ? '' : pathOf(current)}> `;

 // Leading words name a menu (absolute with "/", "..", abbreviations
 // allowed); the first word that is not a menu is the command.
 function resolve(words) {
  let node = current, index = 0, command = null, moved = false;
  for (; index < words.length && !command; index++) {
   const word = words[index];
   if (word.op || word.bracket || word.quoted) break;
   const segments = word.text.split('/');
   for (let position = 0; position < segments.length; position++) {
    const segment = segments[position];
    if (segment === '') { if (position === 0) { node = ROOT; moved = true; } continue; }
    if (segment === '..') { node = node.parent ?? ROOT; moved = true; continue; }
    const children = Object.keys(node.children), commands = commandsOf(node);
    const names = [...new Set([...children, ...commands, ...ROOT_COMMANDS])];
    const name = pick(names, segment);
    if (!name) throw new CliError(names.some(item => item.startsWith(segment)) ? `ambiguous command name ${segment}` : `bad command name ${segment} (line 1 column ${word.start + 1})`);
    if (children.includes(name) && !(commands.includes(name) || ROOT_COMMANDS.includes(name))) { node = node.children[name]; moved = true; continue; }
    if (position !== segments.length - 1) throw new CliError(`bad command name ${segments.slice(position + 1).join('/')}`);
    command = name;
   }
  }
  if (!command && index < words.length) throw new CliError(`expected command name (line 1 column ${words[index].start + 1})`);
  return { node, command, args: words.slice(index), moved };
 }

 // How an item is named in messages and matched by name: its name, else
 // the first column (an address, a destination), else its key.
 function rowName(row, model) {
  const first = model?.columns?.find(column => column.id !== 'flags' && column.label !== '#');
  return row.cells?.name || (first && row.cells?.[first.id]) || row.key;
 }

 // Items by number from the last print, by name, or [find ...].
 function selectRows(node, model, data, words) {
  const rows = sortedRows(model, data);
  const keys = numbering.get(pathOf(node)) ?? rows.map(row => row.key);
  const chosen = new Map();
  for (const word of words) {
   if (word.bracket !== undefined) {
    const inner = tokenize(word.bracket);
    if (!inner.length || pick(['find'], inner[0].text) !== 'find') throw new CliError('only [find ...] is supported here');
    const conditions = conditionsOf(inner.slice(1));
    for (const row of rows) if (matches(conditions, model, row, data)) chosen.set(row.key, row);
    continue;
   }
   for (const item of word.text.split(',').filter(Boolean)) {
    const row = /^\d+$/.test(item) ? rows.find(entry => entry.key === keys[Number(item)]) : rows.find(entry => rowName(entry, model) === item || entry.key === item);
    if (!row) throw new CliError(`no such item (${item})`);
    chosen.set(row.key, row);
   }
  }
  return [...chosen.values()];
 }

 function editProperties(fields, base, words) {
  const byName = new Map(fields.map(field => [field.name, field]));
  const values = { ...base }, dirty = new Set();
  let comment, disabled;
  for (const word of words) {
   if (word.op !== '=') throw new CliError(`expected name=value (line 1 column ${word.start + 1})`);
   const name = pick([...new Set([...byName.keys(), 'comment', 'disabled'])], word.key);
   if (!name) throw new CliError(`expected end of command: unknown property ${word.key}`);
   const field = byName.get(name);
   if (!field) {
    if (name === 'comment') comment = word.value;
    else disabled = parseValue({ type: 'bool', name }, word.value);
    continue;
   }
   if (field.type === 'static' || field.readOnly) throw new CliError(`${name} cannot be changed`);
   values[field.id] = parseValue(field, word.value, values);
   dirty.add(field.id);
  }
  return { values, dirty, comment, disabled };
 }

 function supported(model, edited) {
  if (edited.comment !== undefined && !model.comment) throw new CliError(`failure: ${model.commentHint ?? `${model.noun} items have no comment`}`);
  if (edited.disabled !== undefined && !model.toggle) throw new CliError(`failure: ${model.toggleHint ?? `${model.noun} items cannot be disabled`}`);
  return edited;
 }

 function failure(error, fields = []) {
  if (error instanceof ValidationError) {
   const field = fields.find(item => item.id === error.field);
   return new CliError(`failure: ${error.message}${field ? ` (${field.name})` : ''}`);
  }
  return error;
 }

 async function save(model, fields, build) {
  let change;
  try { change = build(); } catch (error) { throw failure(error, fields); }
  return change ? apply(change) : null;
 }

 async function print(node, args) {
  if (node.special) return printSpecial(node);
  const model = node.model, data = await load(model.sources);
  const flags = new Set(args.filter(word => !word.op).map(word => word.text));
  if (model.singleton) {
   const row = model.rows(data)[0];
   if (!row) throw new CliError(`${model.noun} is not available on this router`);
   const props = [...properties(model, row, data)];
   const width = Math.max(...props.map(([name]) => name.length));
   for (const [name, value] of props) out.line(`${name.padStart(width + 2)}: ${value}`.trimEnd());
   return;
  }
  const whereAt = args.findIndex(word => !word.op && word.text === 'where');
  const conditions = whereAt >= 0 ? conditionsOf(args.slice(whereAt + 1)) : [];
  // Like RouterOS, a filtered print keeps the numbers of the full list.
  const all = sortedRows(model, data);
  numbering.set(pathOf(node), all.map(row => row.key));
  const numbers = new Map(all.map((row, index) => [row.key, index]));
  const rows = all.filter(row => matches(conditions, model, row, data));
  if (flags.has('count-only')) return out.line(String(rows.length));
  const header = flagsHeader(model);
  if (header) out.line(header);
  const numberWidth = Math.max(1, String(Math.max(0, all.length - 1)).length);
  const flagWidth = Math.max(0, ...all.map(row => (row.flags ?? '').length));
  const lead = (index, flagText) => ` ${String(index).padStart(numberWidth)} ${(flagText ?? '').padEnd(flagWidth)}${flagWidth ? ' ' : ''}`;
  if (flags.has('detail')) {
   rows.forEach(row => {
    const prefix = lead(numbers.get(row.key), row.flags), indent = ' '.repeat(prefix.length);
    const pairs = [...properties(model, row, data)].filter(([, value]) => value !== '').map(([name, value]) => `${name}=${quote(value)}`);
    const lines = wrap(pairs, prefix.length);
    if (row.comment) lines.unshift(`;;; ${row.comment}`);
    lines.forEach((line, position) => out.line((position ? indent : prefix) + line));
    out.line('');
   });
   return;
  }
  const columns = (model.columns ?? []).filter(column => column.id !== 'flags' && column.label !== '#' && !column.hidden);
  const names = columns.map(column => (propertyName(column.label) || column.id).toUpperCase());
  const cell = (row, column) => String(row.cells?.[column.id] ?? '');
  const widths = columns.map((column, index) => Math.min(48, Math.max(names[index].length, ...rows.map(row => cell(row, column).length))));
  const format = values => values.map((value, index) => {
   const text = value.length > widths[index] ? value.slice(0, widths[index] - 1) + '…' : value;
   return columns[index].align === 'right' ? text.padStart(widths[index]) : text.padEnd(widths[index]);
  }).join('  ');
  out.line(`Columns: ${names.join(', ')}`);
  out.line((lead('#', '') + format(names)).trimEnd());
  rows.forEach(row => {
   const index = numbers.get(row.key);
   if (row.comment) {
    out.line(`${lead(index, row.flags)};;; ${row.comment}`);
    out.line(' '.repeat(lead(index, '').length) + format(columns.map(column => cell(row, column))).trimEnd());
   } else out.line((lead(index, row.flags) + format(columns.map(column => cell(row, column)))).trimEnd());
  });
 }

 async function printSpecial(node) {
  const data = await load(['history']);
  const entries = data.history?.entries ?? [];
  out.line('Flags: U - UNDONE; S - SAFE MODE');
  out.line('Columns: ACTION, BY, TIME');
  entries.forEach((entry, index) => {
   const flags = (entry.undone ? 'U' : ' ') + (entry.safemode ? 'S' : ' ');
   const time = entry.time ? new Date(entry.time * 1000).toLocaleString() : '';
   out.line(` ${String(index).padStart(2)} ${flags} ${String(entry.description ?? '').padEnd(48).slice(0, 48)}  ${String(entry.user ?? '').padEnd(8)}  ${time}`.trimEnd());
  });
 }

 async function edit(node, command, args) {
  const model = node.model, data = await load(model.sources);
  const positional = args.filter(word => !word.op), named = args.filter(word => word.op);
  if (command === 'add') {
   const params = {};
   const typeWord = model.addTypes && named.find(word => word.op === '=' && word.key === 'type');
   if (model.addTypes) {
    const type = model.addTypes.find(item => item.id === typeWord?.value);
    if (!type) throw new CliError(`add needs type=${model.addTypes.map(item => item.id).join('|')}`);
    params.addType = type.id;
   }
   if (!model.canAdd(data)) throw new CliError(`failure: a ${model.noun.toLowerCase()} cannot be added here now`);
   const fields = fieldsOf(model, data, null, params);
   const edited = supported(model, editProperties(fields, model.defaults(data, params), named.filter(word => word !== typeWord)));
   // Comment and state belong to the same change, so one Undo takes the
   // whole add back; their operations name the new section as $new.
   return save(model, fields, () => {
    const change = model.save(edited.values, null, data, { dirty: edited.dirty, ...params });
    const first = change?.ops.find(op => op.op === 'add');
    if (!first) return change;
    if (!first.ref) first.ref = '$new';
    const created = { key: first.ref, section: first.ref, cells: { name: edited.values.name ?? '' } };
    if (edited.comment && model.comment) change.ops.push(...model.comment([created], edited.comment, data).ops);
    if (edited.disabled && model.toggle) change.ops.push(...model.toggle([created], false, data).ops);
    return change;
   });
  }
  const rows = model.singleton ? model.rows(data).slice(0, 1) : selectRows(node, model, data, command === 'comment' ? positional.slice(0, 1) : positional);
  if (!rows.length) throw new CliError('no such item');
  const name = row => rowName(row, model);
  if (command === 'set') {
   for (const row of rows) {
    if (row.readOnly) throw new CliError(`failure: ${name(row)} is dynamic and cannot be changed`);
    const fields = fieldsOf(model, data, row);
    const edited = supported(model, editProperties(fields, model.values(row, data), named));
    if (edited.dirty.size) await save(model, fields, () => model.save(edited.values, row, data, { dirty: edited.dirty }));
    const fresh = edited.dirty.size ? await load(model.sources) : data;
    const current = model.rows(fresh).find(item => item.key === row.key) ?? row;
    if (edited.disabled !== undefined && model.toggle && edited.disabled !== !!current.disabled) await apply(model.toggle([current], !edited.disabled, fresh));
    if (edited.comment !== undefined && model.comment) await apply(model.comment([current], edited.comment, fresh));
   }
   return;
  }
  if (command === 'remove') {
   const blocked = rows.find(row => !model.canRemove?.(row));
   if (blocked) throw new CliError(`failure: ${name(blocked)} cannot be removed${blocked.dynamic ? ' (dynamic)' : ''}`);
   const reason = model.removeBlocked?.(rows, data);
   if (reason) throw new CliError(`failure: ${reason}`);
   return apply(model.remove(rows, data));
  }
  if (command === 'enable' || command === 'disable') {
   const blocked = rows.find(row => !model.canToggle?.(row));
   if (blocked) throw new CliError(`failure: ${name(blocked)} cannot be ${command}d${model.toggleHint ? `; ${model.toggleHint}` : ''}`);
   return apply(model.toggle(rows, command === 'enable', data));
  }
  if (command === 'comment') {
   const blocked = rows.find(row => !model.canComment?.(row));
   if (blocked) throw new CliError(`failure: ${name(blocked)} cannot have a comment${model.commentHint ? `; ${model.commentHint}` : ''}`);
   const text = named.find(word => word.key === 'comment')?.value ?? positional[1]?.text ?? '';
   return apply(model.comment(rows, text, data));
  }
  const tool = model.tools?.find(item => item.id === command);
  if (tool) {
   if (!tool.enabled(rows)) throw new CliError(`failure: ${tool.label} does not apply to these items`);
   return apply(tool.run(rows, data));
  }
  throw new CliError(`bad command name ${command}`);
 }

 async function exportNode(node, sensitive, lines) {
  const model = node.model;
  if (model && node.exportable && !model.readOnly && model.save && model.values) {
   const data = await load(model.sources);
   const rows = sortedRows(model, data).filter(row => !row.readOnly && !row.dynamic);
   const addable = !model.singleton && !!model.canAdd;
   let defaults = {};
   try { defaults = addable ? model.defaults(data, {}) : {}; } catch { defaults = {}; }
   const body = [];
   for (const row of rows) {
    const values = model.values(row, data);
    const fields = fieldsOf(model, data, addable ? null : row).filter(field => !['static', 'note'].includes(field.type) && !field.readOnly && (field.visible?.(values) ?? true));
    const pairs = [];
    for (const field of fields) {
     const text = display(field, values[field.id], values);
     if (text === '' || (field.type === 'password' && !sensitive)) continue;
     // Defaults may depend on the router (the first free network), so only
     // switches left at their default are omitted.
     if (field.type === 'bool' && addable && (defaults[field.id] ?? false) === values[field.id]) continue;
     pairs.push(`${field.name}=${quote(text)}`);
    }
    if (row.disabled) pairs.push('disabled=yes');
    if (row.comment) pairs.push(`comment=${quote(row.comment)}`);
    if (model.singleton) { if (pairs.length) body.push(`set ${pairs.join(' ')}`); }
    else if (addable) body.push(`add ${pairs.join(' ')}`.trim());
    else if (pairs.length) body.push(`set [ find name=${quote(rowName(row, model))} ] ${pairs.join(' ')}`);
   }
   if (body.length) lines.push(pathOf(node), ...body);
  }
  for (const child of Object.values(node.children)) await exportNode(child, sensitive, lines);
 }

 async function runExport(node, args) {
  const sensitive = args.some(word => !word.op && word.text === 'show-sensitive');
  const data = await load(['board']);
  const lines = [`# ${now().toISOString().replace('T', ' ').slice(0, 19)} by RouterDeck Console`, `# ${data.board?.release?.description ?? 'OpenWrt'} on ${data.board?.model ?? 'unknown hardware'}`];
  await exportNode(node, sensitive, lines);
  if (!sensitive) lines.push('# passwords and keys are hidden; add show-sensitive to include them');
  lines.forEach(line => out.line(line));
 }

 function interval(text) {
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(String(text));
  if (!match) throw new CliError(`interval is like 1s or 500ms`);
  return Math.round(Number(match[1]) * (match[2] === 'ms' ? 1 : 1000));
 }

 function diagArgs(tool, args, extra) {
  const named = Object.fromEntries(args.filter(word => word.op === '=').map(word => [pick(['address', 'count', 'size', 'interval', 'max-hops', 'protocol'], word.key) ?? word.key, word.value]));
  const address = named.address ?? args.find(word => !word.op)?.text;
  if (!address) throw new CliError(`${tool} needs an address`);
  const job = { tool, host: address, family: address.includes(':') ? 6 : 0, ...extra };
  if (named.count !== undefined) job.count = Number(named.count);
  if (named.size !== undefined) job.size = Number(named.size);
  if (named.interval !== undefined) job.interval = interval(named.interval);
  if (named['max-hops'] !== undefined) job.max = Number(named['max-hops']);
  if (named.protocol !== undefined) job.protocol = named.protocol;
  for (const key of Object.keys(named)) if (!['address', 'count', 'size', 'interval', 'max-hops', 'protocol'].includes(key)) throw new CliError(`expected end of command: unknown property ${key}`);
  return job;
 }

 async function ping(args) {
  const request = diagArgs('ping', args, {});
  out.line('  SEQ HOST                                     SIZE TTL TIME       STATUS');
  let printed = 0, last = null;
  const job = createJob(state => {
   last = state;
   const view = pingView(state.results);
   for (; printed < view.rows.length; printed++) {
    const cells = view.rows[printed].cells;
    out.line(`${cells.seq.padStart(5)} ${cells.host.padEnd(40)} ${cells.size.padStart(4)} ${cells.ttl.padStart(3)} ${cells.time.padEnd(10)} ${cells.status}`.trimEnd(), cells.status ? 'error' : undefined);
   }
  });
  running = job;
  try { await job.start(request); } finally { running = null; }
  const view = pingView(last?.results ?? []);
  if (last?.error || view.error) throw new CliError(last?.error ?? view.error);
  const rtt = view.received ? ` min-rtt=${ms(view.min)} avg-rtt=${ms(view.avg)} max-rtt=${ms(view.max)}` : '';
  out.line(`    sent=${view.sent} received=${view.received} packet-loss=${view.loss ?? 0}%${rtt}`.replace(/ ms/g, 'ms'));
 }

 async function traceroute(args) {
  const request = diagArgs('traceroute', args, {});
  const block = out.live();
  let last = null;
  const job = createJob(state => {
   last = state;
   const view = traceView(state.results);
   block.update([
    ' #  ADDRESS                          LOSS  SENT  LAST      AVG       BEST      WORST     STD-DEV   STATUS',
    ...view.rows.map(row => {
     const c = row.cells;
     return ` ${c.hop.padStart(2)}  ${c.address.padEnd(31)} ${c.loss.padStart(5)} ${c.sent.padStart(5)}  ${[c.last, c.avg, c.best, c.worst, c.stdev].map(value => value.replace(' ms', 'ms').padEnd(9)).join(' ')} ${c.status}`.trimEnd();
    })
   ]);
  });
  running = job;
  try { await job.start(request); } finally { running = null; block.end(); }
  const view = traceView(last?.results ?? []);
  if (last?.error || view.error) throw new CliError(last?.error ?? view.error);
 }

 async function execute(node, command, args) {
  switch (command) {
   case 'print': return print(node, args);
   case 'find': {
    const model = node.model, data = await load(model.sources);
    const rows = sortedRows(model, data);
    const keys = numbering.get(pathOf(node)) ?? rows.map(row => row.key);
    const found = rows.filter(row => matches(conditionsOf(args), model, row, data)).map(row => keys.indexOf(row.key)).filter(index => index >= 0);
    return out.line(found.join(',') || 'no items');
   }
   case 'export': return runExport(node.model || node === ROOT || Object.keys(node.children).length ? node : ROOT, args);
   case 'ping': return ping(args);
   case 'traceroute': return traceroute(args);
   case 'torch': openWindow('tool-torch'); return out.line('Torch is open in its own window');
   case 'reboot':
    pending = { question: 'Reboot, yes? [y/N]: ', action: async () => { await reboot(); out.line('system will reboot shortly'); } };
    return;
   case 'undo': return undo();
   case 'redo': return redo();
   case 'quit': return close();
   default: return edit(node, command, args);
  }
 }

 async function run(line) {
  if (pending) {
   const { action } = pending;
   pending = null;
   if (/^y(es)?$/i.test(line.trim())) return action();
   return out.line('action cancelled');
  }
  const words = tokenize(line);
  if (!words.length) return;
  const { node, command, args, moved } = resolve(words);
  if (!command) { if (moved) current = node; return; }
  await execute(node, command, args);
 }

 /* --- Help and completion --------------------------------------------- */

 // What may follow the text before the cursor, with descriptions.
 function choices(text) {
  let words;
  try { words = tokenize(text); } catch { return { prefix: '', items: [] }; }
  const partial = text === '' || /\s$/.test(text) ? null : words.at(-1);
  const before = partial ? words.slice(0, -1) : words;
  let context;
  try { context = resolve(before); } catch { return { prefix: '', items: [] }; }
  if (!context.command) {
   let node = context.node, prefix = partial?.text ?? '';
   if (partial && !partial.op && prefix.includes('/')) {
    const segments = prefix.split('/');
    prefix = segments.pop();
    for (const [position, segment] of segments.entries()) {
     if (segment === '' && position === 0) node = ROOT;
     else if (segment === '..') node = node.parent ?? ROOT;
     else if (node.children[segment]) node = node.children[segment];
     else if (segment !== '') return { prefix, items: [] };
    }
   }
   const items = [
    ...Object.entries(node.children).map(([name, child]) => ({ name, help: child.model?.noun ?? 'menu', suffix: ' ' })),
    ...commandsOf(node).map(name => ({ name, help: HELP[name] ?? node.model?.tools?.find(tool => tool.id === name)?.label ?? '', suffix: ' ' })),
    ...(node === ROOT ? ROOT_COMMANDS.filter(name => !commandsOf(node).includes(name)).map(name => ({ name, help: HELP[name], suffix: ' ' })) : []),
    ...(node !== ROOT ? [{ name: '..', help: HELP['..'], suffix: ' ' }] : [])
   ];
   return { prefix, items };
  }
  const { node, command } = context, model = node.model;
  if (['ping', 'traceroute'].includes(command)) {
   const names = command === 'ping' ? ['address', 'count', 'size', 'interval'] : ['address', 'count', 'interval', 'max-hops', 'protocol'];
   return { prefix: partial?.op ? '' : partial?.text ?? '', items: partial?.op ? [] : names.map(name => ({ name, help: '', suffix: '=' })) };
  }
  if (!model) return { prefix: partial?.text ?? '', items: command === 'export' ? [{ name: 'show-sensitive', help: 'include passwords and keys', suffix: ' ' }] : [] };
  const data = lastData.get(model.id);
  const addType = model.addTypes?.find(type => type.id === before.find(word => word.key === 'type')?.value)?.id;
  const fields = data ? fieldsOf(model, data, model.singleton ? model.rows(data)[0] ?? null : null, addType ? { addType } : {}) : [];
  if (partial?.op) {
   if (partial.key === 'type' && model.addTypes) return { prefix: partial.value, items: model.addTypes.map(type => ({ name: type.id, help: type.label, suffix: ' ' })) };
   const field = fields.find(item => item.name === pick(fields.map(entry => entry.name), partial.key));
   const values = field ? (field.type === 'bool' ? ['yes', 'no'] : optionsOf(field, data ? model.defaults?.(data, {}) ?? {} : {}).map(option => String(option.value)).filter(Boolean)) : [];
   return { prefix: partial.value, items: values.map(name => ({ name, help: '', suffix: ' ' })) };
  }
  const prefix = partial?.text ?? '';
  if (command === 'print') return { prefix, items: [{ name: 'detail', help: 'all properties', suffix: ' ' }, { name: 'count-only', help: 'only the number of items', suffix: ' ' }, { name: 'where', help: 'only matching items', suffix: ' ' }, ...(before.some(word => word.text === 'where') ? fields.map(field => ({ name: field.name, help: field.label, suffix: '=' })) : [])] };
  if (command === 'add' && model.addTypes && !addType) return { prefix, items: [{ name: 'type', help: `first choose ${model.addTypes.map(type => type.id).join('|')}`, suffix: '=' }] };
  if (['add', 'set'].includes(command)) {
   return { prefix, items: [...fields.filter(field => field.type !== 'static').map(field => ({ name: field.name, help: `${field.label}${field.type === 'select' ? ` (${optionsOf(field, {}).map(option => option.value).filter(Boolean).slice(0, 8).join('|')})` : ''}`, suffix: '=' })), ...(model.comment ? [{ name: 'comment', help: 'Comment', suffix: '=' }] : []), ...(model.toggle ? [{ name: 'disabled', help: 'yes or no', suffix: '=' }] : [])] };
  }
  if (command === 'export') return { prefix, items: [{ name: 'show-sensitive', help: 'include passwords and keys', suffix: ' ' }] };
  return { prefix, items: [] };
 }

 // Completion needs field options, so the last data of each menu is kept.
 const lastData = new Map();
 async function prepare(text) {
  try {
   const words = tokenize(text);
   const { node } = resolve(words.filter(word => !word.op).slice(0, -1));
   if (node.model && !lastData.has(node.model.id)) lastData.set(node.model.id, await load(node.model.sources));
  } catch {
   // Nothing to prepare for an incomplete or invalid line.
  }
 }

 async function complete(text) {
  await prepare(text);
  const { prefix, items } = choices(text);
  const found = items.filter(item => item.name.startsWith(prefix));
  if (!found.length) return { text, options: [] };
  if (found.length === 1) return { text: text.slice(0, text.length - prefix.length) + found[0].name + found[0].suffix, options: [] };
  let common = found[0].name;
  for (const item of found) while (!item.name.startsWith(common)) common = common.slice(0, -1);
  return { text: text.slice(0, text.length - prefix.length) + common, options: found.map(item => item.name + (item.suffix === '=' ? '=' : '')) };
 }

 async function help(text) {
  await prepare(text);
  const { prefix, items } = choices(text);
  const found = items.filter(item => item.name.startsWith(prefix));
  const width = Math.max(0, ...found.map(item => item.name.length));
  return found.map(item => `${(item.name + (item.suffix === '=' ? '=' : '')).padEnd(width + 2)}-- ${item.help}`.trimEnd());
 }

 return {
  run: async line => {
   try {
    await run(line);
   } catch (error) {
    const message = error instanceof CliError ? error.message : error instanceof ValidationError ? `failure: ${error.message}` : `failure: ${error?.details ? `${error.message}: ${error.details}` : error?.message ?? error}`;
    out.line(message, 'error');
   }
  },
  complete, help, prompt,
  interrupt: () => running?.stop(),
  busy: () => !!running,
  path: () => pathOf(current)
 };
}
