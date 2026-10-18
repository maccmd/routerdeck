// SPDX-License-Identifier: Apache-2.0
// System menu: identity, clock, NTP, logging, password, packages, the cron
// scheduler, scripts, startup services, resources, backup and firmware.
// Settings live in /etc/config/system; the scheduler edits
// /etc/crontabs/root as a whole; scripts are sections of
// /etc/config/routerdeck.
import { sections, truthy, list, invalid, compact, networkOptions, NAME } from './common.js';
import { uptime, load, bytes } from '../lib/format.js';
import { isIPv4, canonicalIPv6 } from '../lib/ip.js';

const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,62})$/;
const systemSection = data => sections(data['uci:system'], 'system')[0];
const changed = (dirty, ...ids) => ids.some(id => !dirty || dirty.has(id));
const pick = (values, dirty, map) => Object.fromEntries(Object.entries(map).filter(([field]) => changed(dirty, field)).map(([field, option]) => [option, values[field]]));

// procd reports local time as seconds since the epoch in the router's zone.
export function localTime(seconds) {
 if (!Number.isFinite(seconds)) return '';
 return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// The router's name, as RouterOS calls it: the host name.
export const systemIdentity = {
 id: 'system-identity',
 noun: 'Identity',
 singleton: true,
 sources: ['uci:system'],
 rows: data => sections(data['uci:system'], 'system').slice(0, 1).map(section => ({ key: section['.name'], section: section['.name'] })),
 itemTitle: () => 'Identity',
 itemStatus: () => [],
 fields: () => [{ id: 'name', label: 'Name', type: 'text' }],
 values: (row, data) => ({ name: sections(data['uci:system'], 'system').find(section => section['.name'] === row.section)?.hostname ?? '' }),
 save(values, row) {
  if (!HOSTNAME.test(values.name)) invalid('name', 'Use letters, digits and hyphens, up to 63 characters');
  return { description: `Set identity ${values.name}`, ops: [{ op: 'set', config: 'system', section: row.section, values: { hostname: values.name } }] };
 }
};

export const systemClock = {
 id: 'system-clock',
 noun: 'Clock',
 singleton: true,
 sources: ['uci:system', 'sysinfo', 'timezones'],
 rows: data => systemSection(data) ? [{ key: 'clock', section: systemSection(data)['.name'], zones: !!data.timezones }] : [],
 itemTitle: () => 'Clock',
 itemStatus: row => [row.zones ? '' : 'time zone list needs LuCI'],
 fields(data) {
  const zones = Object.keys(data.timezones ?? {}).sort();
  return [
   { id: 'time', label: 'Time', type: 'static', value: () => localTime(data.sysinfo?.localtime) },
   zones.length
    ? { id: 'zonename', label: 'Time Zone Name', type: 'select', options: zones.map(zone => ({ value: zone, label: zone })) }
    : { id: 'zonename', label: 'Time Zone Name', type: 'text', placeholder: 'UTC' },
   { id: 'timezone', label: 'Time Zone', type: 'static', value: values => data.timezones?.[values.zonename]?.tzstring ?? values.timezone }
  ];
 },
 values(row, data) {
  const section = systemSection(data) ?? {};
  return { zonename: section.zonename ?? 'UTC', timezone: section.timezone ?? 'UTC' };
 },
 save(values, row, data, { dirty = null } = {}) {
  if (!changed(dirty, 'zonename')) return null;
  const tz = data.timezones ? data.timezones[values.zonename]?.tzstring : values.zonename;
  if (!tz) invalid('zonename', 'Choose a time zone from the list');
  return { description: `Set time zone ${values.zonename}`, ops: [{ op: 'set', config: 'system', section: row.section, values: { zonename: values.zonename, timezone: tz } }] };
 },
 tools: [{
  id: 'set-time', label: 'Set From This Computer', enabled: rows => rows.every(row => row.zones),
  run: () => ({ description: 'Set the router clock', call: ['luci', 'setLocaltime', { localtime: Math.floor(Date.now() / 1000) }], notice: 'The router clock was set from this computer' })
 }]
};

export const ntpClient = {
 id: 'system-ntp',
 noun: 'NTP',
 singleton: true,
 sources: ['uci:system', 'uci:network'],
 rows: data => systemSection(data) ? [{ key: 'ntp', section: 'ntp' }] : [],
 itemTitle: () => 'NTP Client',
 itemStatus: () => ['sysntpd'],
 fields: data => [
  { id: 'enabled', label: 'Enabled', type: 'bool' },
  { id: 'server', label: 'Servers', type: 'list' },
  { id: 'use_dhcp', label: 'Use DHCP Advertised Servers', type: 'bool' },
  { id: 'enable_server', label: 'NTP Server', type: 'bool' },
  { id: 'interface', label: 'Server Interface', type: 'select', allowEmpty: true, options: networkOptions(data['uci:network'], section => section['.name'] !== 'loopback'), visible: values => values.enable_server }
 ],
 values(row, data) {
  const section = data['uci:system']?.ntp ?? {};
  return { enabled: truthy(section.enabled, true), server: list(section.server), use_dhcp: truthy(section.use_dhcp, true), enable_server: truthy(section.enable_server), interface: section.interface ?? '' };
 },
 save(values, row, data, { dirty = null } = {}) {
  for (const server of values.server ?? []) if (!/^[A-Za-z0-9.:-]+$/.test(server)) invalid('server', `${server} is not a host name or address`);
  const options = compact({ enabled: values.enabled ? '1' : '0', server: values.server ?? [], use_dhcp: values.use_dhcp ? '1' : '0', enable_server: values.enable_server ? '1' : '0', interface: values.enable_server ? values.interface : '' });
  const fields = { enabled: 'enabled', server: 'server', use_dhcp: 'use_dhcp', enable_server: 'enable_server', interface: 'interface' };
  const changes = Object.fromEntries(Object.entries(fields).filter(([field]) => changed(dirty, field)).map(([field, option]) => [option, options[option]]));
  if (!Object.keys(changes).length) return null;
  const exists = !!data['uci:system']?.ntp;
  return { description: 'Change NTP settings', ops: exists ? [{ op: 'set', config: 'system', section: 'ntp', values: changes }] : [{ op: 'add', config: 'system', type: 'timeserver', name: 'ntp', values: { ...options } }] };
 }
};

const LEVELS = ['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug'].map((label, index) => ({ value: String(index + 1), label }));
export const systemLogging = {
 id: 'system-logging',
 noun: 'Logging',
 singleton: true,
 sources: ['uci:system'],
 rows: data => systemSection(data) ? [{ key: 'logging', section: systemSection(data)['.name'] }] : [],
 itemTitle: () => 'Logging',
 itemStatus: () => ['logd'],
 fields: () => [
  { id: 'size', label: 'Buffer Size (KiB)', type: 'number', placeholder: '64' },
  { id: 'remote', label: 'Remote Server', type: 'text', placeholder: 'none' },
  { id: 'port', label: 'Remote Port', type: 'number', placeholder: '514', visible: values => !!values.remote },
  { id: 'proto', label: 'Remote Protocol', type: 'select', options: [{ value: 'udp', label: 'UDP' }, { value: 'tcp', label: 'TCP' }], visible: values => !!values.remote },
  { id: 'file', label: 'Log File', type: 'text', placeholder: 'only the memory buffer' },
  { id: 'console', label: 'Console Level', type: 'select', options: LEVELS },
  { id: 'cron', label: 'Cron Level', type: 'select', options: [{ value: '5', label: 'debug' }, { value: '8', label: 'normal' }, { value: '9', label: 'warning' }] }
 ],
 values(row, data) {
  const section = systemSection(data) ?? {};
  return { size: section.log_size ?? '', remote: section.log_ip ?? '', port: section.log_port ?? '', proto: section.log_proto ?? 'udp', file: section.log_file ?? '', console: section.conloglevel ?? '7', cron: section.cronloglevel ?? '8' };
 },
 save(values, row, data, { dirty = null } = {}) {
  if (values.size && !(/^\d+$/.test(values.size) && Number(values.size) >= 8 && Number(values.size) <= 65536)) invalid('size', 'Buffer size is 8 to 65536 KiB');
  if (values.remote && !isIPv4(values.remote) && !canonicalIPv6(values.remote)) invalid('remote', 'Enter the address of the syslog server');
  if (values.port && !(/^\d+$/.test(values.port) && Number(values.port) >= 1 && Number(values.port) <= 65535)) invalid('port', 'A port is 1 to 65535');
  if (values.file && !/^\/[\w./-]+$/.test(values.file)) invalid('file', 'Enter an absolute path such as /tmp/system.log');
  const changes = compact(pick(values, dirty, { size: 'log_size', remote: 'log_ip', port: 'log_port', proto: 'log_proto', file: 'log_file', console: 'conloglevel', cron: 'cronloglevel' }));
  return Object.keys(changes).length ? { description: 'Change logging', ops: [{ op: 'set', config: 'system', section: row.section, values: changes }] } : null;
 }
};

// Not a configuration change: rpcd sets the password, and Undo cannot
// take it back.
export const systemPassword = {
 id: 'system-password',
 noun: 'Password',
 singleton: true,
 sources: [],
 rows: () => [{ key: 'password', section: 'password' }],
 itemTitle: () => 'Password',
 itemStatus: () => ['not undoable'],
 fields: () => [
  { id: 'old', label: 'Old Password', type: 'password' },
  { id: 'next', label: 'New Password', type: 'password' },
  { id: 'confirm', label: 'Confirm Password', type: 'password' },
  { id: 'note', label: '', type: 'note', value: () => 'Changes the password of the account this console is logged in with. Undo cannot restore the old one.' }
 ],
 values: () => ({ old: '', next: '', confirm: '' }),
 save(values) {
  if (!values.old) invalid('old', 'Enter the current password');
  if (!values.next) invalid('next', 'Enter a new password');
  if (values.next !== values.confirm) invalid('confirm', 'The passwords do not match');
  return { description: 'Change password', verify: { username: null, password: values.old }, call: ['luci', 'setPassword', { username: null, password: values.next }], notice: 'Password changed' };
 }
};

/* --- Packages ------------------------------------------------------------ */

export const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/;
const OPERATION = { update: 'Check for updates', install: 'Install', remove: 'Uninstall', upgrade: 'Upgrade' };
const PACKAGE_NOTE = 'Package operations change the firmware and cannot be undone; Safe Mode does not cover them.';

export function packageJob(operation, names = []) {
 return { job: { title: `${OPERATION[operation]} ${names.join(' ')}`.trim(), task: { tool: 'package', operation, names } } };
}

export const packages = {
 id: 'system-packages',
 noun: 'Package',
 readOnly: true,
 sources: ['packages'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 220 },
  { id: 'version', label: 'Version', width: 170 },
  { id: 'update', label: 'Available', width: 150 },
  { id: 'size', label: 'Size', width: 80, align: 'right', sort: (value, row) => row.size ?? -1 },
  { id: 'description', label: 'Description', width: 420 }
 ],
 flagLegend: { D: 'installed as a dependency', U: 'update available' },
 defaultSort: 'name',
 status: data => data.packages?.manager ? `${data.packages.manager}; Check For Updates refreshes the package lists` : 'no package database found',
 note: PACKAGE_NOTE,
 rows: data => (data.packages?.packages ?? []).map(item => {
  const update = data.packages.upgradable?.[item.name] ?? '';
  return {
   key: item.name, readOnly: true, size: item.size, update, flags: (item.requested ? '' : 'D') + (update ? 'U' : ''),
   cells: { name: item.name, version: item.version ?? '', update, size: Number.isFinite(item.size) ? bytes(item.size) : '', description: item.description ?? '' }
  };
 }),
 itemTitle: row => `Package <${row.key}>`,
 fields: () => ['name', 'version', 'update', 'size', 'description'].map(id => ({ id, label: packages.columns.find(column => column.id === id).label, type: 'static' })),
 values: row => ({ ...row.cells }),
 tools: [
  { id: 'install', label: 'Install…', cli: false, enabled: () => true, run: () => ({ open: 'system-package-install' }) },
  {
   id: 'uninstall', label: 'Uninstall', enabled: rows => rows.length > 0,
   run: rows => ({ ask: { title: 'Uninstall', text: `Uninstall ${rows.map(row => row.key).join(', ')}? The package manager refuses when other packages need them. ${PACKAGE_NOTE}`, submitLabel: 'Uninstall' }, ...packageJob('remove', rows.map(row => row.key)) })
  },
  { id: 'upgrade', label: 'Upgrade', enabled: rows => rows.length > 0 && rows.every(row => row.update), run: rows => packageJob('upgrade', rows.map(row => row.key)) },
  { id: 'check-for-updates', label: 'Check For Updates', enabled: () => true, run: () => packageJob('update') }
 ]
};

export const packageInstall = {
 id: 'package-install',
 noun: 'Package',
 singleton: true,
 sources: ['packages'],
 action: { label: 'Install' },
 rows: data => data.packages?.manager ? [{ key: 'install', section: 'install' }] : [],
 itemTitle: () => 'Install Package',
 itemStatus: () => [],
 fields: data => [
  { id: 'names', label: 'Packages', type: 'text', placeholder: 'tcpdump iperf3' },
  { id: 'note', label: '', type: 'note', value: () => `${data.packages?.manager ?? 'The package manager'} installs them with their dependencies from the configured feeds. If it cannot find a package, run Check For Updates first. ${PACKAGE_NOTE}` }
 ],
 values: () => ({ names: '' }),
 defaults: () => ({ names: '' }),
 save(values, row, data) {
  const names = String(values.names ?? '').trim().split(/[\s,]+/).filter(Boolean);
  if (!names.length || names.some(name => !PACKAGE.test(name))) invalid('names', 'Enter package names such as tcpdump');
  const installed = new Set((data.packages?.packages ?? []).map(item => item.name));
  const already = names.filter(name => installed.has(name));
  if (already.length === names.length) invalid('names', `${already.join(', ')} ${already.length > 1 ? 'are' : 'is'} already installed`);
  return packageJob('install', names);
 }
};

// Output of a package operation or a script: lines, then the exit code.
export function taskView(results) {
 const lines = [];
 let exit = null, error = null, command = null, stopped = false;
 for (const item of results ?? []) {
  if (item.error) error = item.message ?? item.error;
  else if (item.command) command = item.command;
  else if (item.line !== undefined) lines.push(item.line);
  else if (item.truncated) lines.push(`… output after ${item.truncated} lines is not shown`);
  else if (item.exit !== undefined) { exit = item.exit; stopped = !!item.stopped; }
 }
 return { lines, exit, error, command, stopped };
}

/* --- Scheduler (cron) --------------------------------------------------- */

const FIELD = /^[0-9A-Za-z*,/-]+$/;
const ENTRY = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/;
const entryOf = line => {
 const match = ENTRY.exec(line.trim());
 return match && match.slice(1, 6).every(part => FIELD.test(part)) ? { schedule: match.slice(1, 6).join(' '), command: match[6] } : null;
};

// Lines stay as they are; a "# name" line right above an entry is its name,
// and a commented-out entry is a disabled one.
export function parseCrontab(text) {
 const nodes = [];
 for (const line of String(text ?? '').replace(/\n$/, '').split('\n')) {
  if (line === '' && !nodes.length && !text) continue;
  const disabled = /^#\s*\S/.test(line) ? entryOf(line.replace(/^#\s*/, '')) : null;
  const entry = disabled ? null : entryOf(line);
  const previous = nodes.at(-1);
  if (entry || disabled) {
   const named = previous?.type === 'raw' && /^#\s*/.test(previous.text) && !entryOf(previous.text.replace(/^#\s*/, ''));
   if (named) nodes.pop();
   nodes.push({ type: 'entry', name: named ? previous.text.replace(/^#\s*/, '') : '', ...(entry ?? disabled), disabled: !!disabled });
  } else nodes.push({ type: 'raw', text: line });
 }
 return nodes;
}

export function formatCrontab(nodes) {
 const lines = nodes.flatMap(node => node.type === 'raw' ? [node.text] : [...(node.name ? [`# ${node.name}`] : []), `${node.disabled ? '#' : ''}${node.schedule} ${node.command}`]);
 return lines.length ? lines.join('\n') + '\n' : '';
}

const pad = value => String(value).padStart(2, '0');
export function describeSchedule(schedule) {
 const [minute, hour, day, month, weekday] = schedule.split(' ');
 const everyMinutes = /^\*\/(\d+)$/.exec(minute);
 if (everyMinutes && [hour, day, month, weekday].every(part => part === '*')) return `every ${everyMinutes[1]} minutes`;
 if (minute === '*' && [hour, day, month, weekday].every(part => part === '*')) return 'every minute';
 if (/^\d+$/.test(minute) && hour === '*' && [day, month, weekday].every(part => part === '*')) return `hourly at :${pad(minute)}`;
 const everyHours = /^\*\/(\d+)$/.exec(hour);
 if (/^\d+$/.test(minute) && everyHours && [day, month, weekday].every(part => part === '*')) return `every ${everyHours[1]} hours at :${pad(minute)}`;
 if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
  const time = `${pad(hour)}:${pad(minute)}`;
  if ([day, month, weekday].every(part => part === '*')) return `daily at ${time}`;
  const days = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };
  if (day === '*' && month === '*' && days[weekday]) return `${days[weekday]}s at ${time}`;
  if (/^\d+$/.test(day) && month === '*' && weekday === '*') return `monthly on day ${day} at ${time}`;
 }
 return '';
}

const SCHEDULES = ['*/5 * * * *', '0 * * * *', '0 3 * * *', '0 3 * * 0', '0 3 1 * *'].map(value => ({ value, label: `${value}  (${describeSchedule(value)})` }));

function crontabChange(data, nodes, description) {
 return { description, ops: [{ op: 'text', config: 'crontab', text: formatCrontab(nodes), expect: data.crontab?.text ?? '' }] };
}

export const scheduler = {
 id: 'system-scheduler',
 noun: 'Scheduled Job',
 sources: ['crontab'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'name', label: 'Name', width: 160 },
  { id: 'schedule', label: 'Schedule', width: 110 },
  { id: 'when', label: 'When', width: 170 },
  { id: 'command', label: 'Command', width: 360 }
 ],
 flagLegend: { X: 'disabled' },
 defaultSort: null,
 status: data => data.crontab && !data.crontab.crond ? 'crond is not installed' : `${data.crontab?.path ?? '/etc/crontabs/root'}; times are the router's local time`,
 rows(data) {
  return parseCrontab(data.crontab?.text).map((node, index) => ({ node, index })).filter(item => item.node.type === 'entry').map(({ node, index }) => ({
   key: `job${index}`, index, disabled: node.disabled, flags: node.disabled ? 'X' : '',
   cells: { name: node.name, schedule: node.schedule, when: describeSchedule(node.schedule), command: node.command }
  }));
 },
 itemTitle: row => `Scheduled Job <${row?.cells.name || row?.cells.command || 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled'],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 fields: () => [
  { id: 'name', label: 'Name', type: 'text', placeholder: 'optional' },
  { id: 'schedule', label: 'Schedule', type: 'combo', options: SCHEDULES, placeholder: 'minute hour day month weekday' },
  { id: 'when', label: 'When', type: 'static', value: values => describeSchedule(values.schedule ?? '') || '—' },
  { id: 'command', label: 'Command', type: 'text', placeholder: '/etc/init.d/network restart' }
 ],
 values: row => ({ name: row.cells.name, schedule: row.cells.schedule, command: row.cells.command }),
 defaults: () => ({ name: '', schedule: '0 3 * * *', command: '' }),
 save(values, row, data) {
  const schedule = String(values.schedule ?? '').trim().split(/\s+/).join(' ');
  if (schedule.split(' ').length !== 5 || !schedule.split(' ').every(part => FIELD.test(part))) invalid('schedule', 'A schedule has five fields: minute hour day month weekday, for example 0 3 * * *');
  if (!values.command.trim() || /\n/.test(values.command)) invalid('command', 'Enter the command to run');
  if (/\n|^#/.test(values.name)) invalid('name', 'A name is one line');
  const nodes = parseCrontab(data.crontab?.text);
  const entry = { type: 'entry', name: values.name.trim(), schedule, command: values.command.trim(), disabled: row ? row.disabled : false };
  if (row) nodes[row.index] = entry;
  else nodes.push(entry);
  return crontabChange(data, nodes, row ? `Change scheduled job ${entry.name || entry.command}` : `Add scheduled job ${entry.name || entry.command}`);
 },
 remove(rows, data) {
  const drop = new Set(rows.map(row => row.index));
  return crontabChange(data, parseCrontab(data.crontab?.text).filter((node, index) => !drop.has(index)), `Remove scheduled job ${rows.map(row => row.cells.name || row.cells.command).join(', ')}`);
 },
 toggle(rows, enable, data) {
  const nodes = parseCrontab(data.crontab?.text);
  for (const row of rows) nodes[row.index] = { ...nodes[row.index], disabled: !enable };
  return crontabChange(data, nodes, `${enable ? 'Enable' : 'Disable'} scheduled job ${rows.map(row => row.cells.name || row.cells.command).join(', ')}`);
 },
 canComment: () => true,
 comment(rows, comment, data) {
  const nodes = parseCrontab(data.crontab?.text);
  for (const row of rows) nodes[row.index] = { ...nodes[row.index], name: comment.replace(/\n/g, ' ') };
  return crontabChange(data, nodes, `Name scheduled job ${rows.map(row => row.cells.command).join(', ')}`);
 }
};

/* --- Scripts ------------------------------------------------------------- */

export const RUN_SCRIPT = '/usr/libexec/routerdeck/run-script';
const firstLine = source => String(source ?? '').split('\n').find(line => line.trim() && !line.trim().startsWith('#'))?.trim() ?? '';

export const scripts = {
 id: 'system-scripts',
 noun: 'Script',
 sources: ['uci:routerdeck'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'name', label: 'Name', width: 160 },
  { id: 'lines', label: 'Lines', width: 60, align: 'right', sort: value => Number(value) || 0 },
  { id: 'source', label: 'Source', width: 420 }
 ],
 flagLegend: {},
 defaultSort: 'name',
 status: () => `Shell scripts run as root; the scheduler and Netwatch run one with ${RUN_SCRIPT} <name>`,
 rows: data => sections(data['uci:routerdeck'], 'script').map(section => ({
  key: section['.name'], section: section['.name'], comment: section.comment,
  cells: { name: section['.name'], lines: String(String(section.source ?? '').split('\n').filter(line => line.trim()).length), source: firstLine(section.source) }
 })),
 itemTitle: row => `Script <${row?.key ?? 'new'}>`,
 itemStatus: row => [`${row.cells.lines} lines`],
 canAdd: () => true,
 canRemove: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'letters, digits and _' },
  { id: 'source', label: 'Source', type: 'textarea', wide: true },
  { id: 'how', label: '', type: 'note', value: values => values.name ? `Run it with Run Script, from the scheduler or Netwatch: ${RUN_SCRIPT} ${values.name}` : 'Saved scripts can run from the scheduler or Netwatch.' }
 ],
 values: (row, data) => ({ name: row.key, source: data['uci:routerdeck']?.[row.section]?.source ?? '' }),
 defaults: () => ({ name: '', source: '' }),
 copy: values => ({ ...values, name: '' }),
 save(values, row, data) {
  const source = String(values.source ?? '').replace(/\r\n?/g, '\n');
  if (!source.trim()) invalid('source', 'Enter the commands of the script');
  if (source.length > 65536) invalid('source', 'A script is up to 64 KiB');
  if (row) return { description: `Change script ${row.key}`, ops: [{ op: 'set', config: 'routerdeck', section: row.section, values: { source } }] };
  const name = String(values.name ?? '').trim();
  if (!NAME.test(name)) invalid('name', 'Use letters, digits and _');
  if (data['uci:routerdeck']?.[name]) invalid('name', `${name} is already used in /etc/config/routerdeck`);
  return { description: `Add script ${name}`, ops: [{ op: 'add', config: 'routerdeck', type: 'script', name, values: { source } }] };
 },
 findCreated: (rows, values) => rows.find(row => row.key === values.name),
 remove: rows => ({ description: `Remove script ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'routerdeck', section: row.section })) }),
 comment: (rows, comment) => ({ description: `Comment script ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'routerdeck', section: row.section, values: { comment: comment || null } })) }),
 tools: [{ id: 'run', label: 'Run Script', enabled: rows => rows.length === 1, run: rows => ({ job: { title: `Script ${rows[0].key}`, task: { tool: 'script', name: rows[0].key } } }) }]
};

const JOB_TITLE = { script: job => `script ${job.name}`, package: job => `${(OPERATION[job.operation] ?? job.operation ?? '').toLowerCase()} ${(job.names ?? []).join(' ')}`.trim() };

// Scripts and package operations running on the router right now. Ages
// come from the router's clock, which may differ from this computer's.
export const scriptJobs = {
 id: 'system-script-jobs',
 noun: 'Job',
 readOnly: true,
 sources: ['jobs'],
 columns: [
  { id: 'type', label: 'Type', width: 80 },
  { id: 'what', label: 'What', width: 300 },
  { id: 'running', label: 'Running For', width: 110, sort: (value, row) => row.age ?? 0 }
 ],
 defaultSort: null,
 status: () => 'Scripts keep running when their window is closed',
 rows: data => (data.jobs?.jobs ?? []).filter(job => JOB_TITLE[job.tool]).map(job => {
  const age = Number.isFinite(job.started) && Number.isFinite(data.jobs.now) ? Math.max(0, data.jobs.now - job.started) : null;
  return { key: job.id, readOnly: true, job, age, cells: { type: job.tool, what: JOB_TITLE[job.tool](job), running: age === null ? '' : uptime(age) } };
 }),
 itemTitle: row => `Job <${row.cells.what}>`,
 fields: () => [{ id: 'type', label: 'Type', type: 'static' }, { id: 'what', label: 'What', type: 'static' }, { id: 'running', label: 'Running For', type: 'static' }],
 values: row => ({ ...row.cells }),
 tools: [
  { id: 'output', label: 'Show Output', cli: false, enabled: rows => rows.length === 1, run: rows => ({ job: { title: rows[0].cells.what, attach: rows[0].key } }) },
  { id: 'stop', label: 'Stop', enabled: rows => rows.length > 0 && rows.every(row => row.job.tool === 'script'), run: rows => ({ calls: rows.map(row => ['routerdeck', 'task', { action: 'stop', id: row.key }]), notice: `Stopped ${rows.map(row => row.cells.what).join(', ')}` }) }
 ]
};

/* --- Startup (procd services) ------------------------------------------ */

const rc = (rows, action, label) => ({
 description: `${label} ${rows.map(row => row.key).join(', ')}`,
 calls: rows.map(row => ['rc', 'init', { name: row.key, action }]),
 notice: `${label}: ${rows.map(row => row.key).join(', ')}`
});

export const startup = {
 id: 'system-startup',
 noun: 'Service',
 sources: ['rc'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 180 },
  { id: 'start', label: 'Start', width: 60, align: 'right', sort: value => Number(value) || 0 },
  { id: 'stop', label: 'Stop', width: 60, align: 'right', sort: value => Number(value) || 0 },
  { id: 'state', label: 'State', width: 120 }
 ],
 flagLegend: { X: 'not started at boot', R: 'running' },
 defaultSort: 'start',
 status: () => 'Starting and stopping services is not a configuration change and cannot be undone',
 rows: data => Object.entries(data.rc ?? {}).map(([name, item]) => ({
  key: name, disabled: !item.enabled, flags: (item.enabled ? '' : 'X') + (item.running ? 'R' : ''),
  cells: { name, start: item.start === undefined ? '' : String(item.start), stop: item.stop === undefined ? '' : String(item.stop), state: item.running === undefined ? '' : item.running ? 'running' : 'stopped' }
 })),
 itemTitle: row => `Service <${row.key}>`,
 itemStatus: row => [row.disabled ? 'not started at boot' : 'started at boot', row.cells.state],
 canToggle: () => true,
 toggle: (rows, enable) => rc(rows, enable ? 'enable' : 'disable', enable ? 'Enable at boot' : 'Disable at boot'),
 tools: [
  { id: 'start', label: 'Start', enabled: rows => rows.length > 0, run: rows => rc(rows, 'start', 'Start') },
  { id: 'stop', label: 'Stop', enabled: rows => rows.length > 0, run: rows => rc(rows, 'stop', 'Stop') },
  { id: 'restart', label: 'Restart', enabled: rows => rows.length > 0, run: rows => rc(rows, 'restart', 'Restart') }
 ],
 fields: () => ['name', 'start', 'stop', 'state'].map(id => ({ id, label: startup.columns.find(column => column.id === id).label, type: 'static' })),
 values: row => ({ ...row.cells })
};

/* --- Resources and backup ---------------------------------------------- */

export const resources = {
 id: 'system-resources',
 noun: 'Resources',
 singleton: true,
 readOnly: true,
 sources: ['sysinfo', 'board'],
 rows: data => data.sysinfo ? [{ key: 'resources', section: 'resources' }] : [],
 itemTitle: () => 'Resources',
 itemStatus: () => [],
 fields(data) {
  const info = data.sysinfo ?? {}, board = data.board ?? {};
  const value = text => () => text || '—';
  return [
   { id: 'uptime', label: 'Uptime', type: 'static', value: value(uptime(info.uptime)) },
   { id: 'version', label: 'Version', type: 'static', value: value(board.release?.description) },
   { id: 'kernel', label: 'Kernel', type: 'static', value: value(board.kernel) },
   { id: 'board', label: 'Board', type: 'static', value: value(board.model) },
   { id: 'architecture', label: 'Architecture', type: 'static', value: value(board.release?.target ?? board.system) },
   { id: 'load', label: 'CPU Load', type: 'static', value: value(info.load ? info.load.map(load).join(' / ') : '') },
   { id: 'memory', label: 'Free Memory', type: 'static', value: value(info.memory ? `${bytes(info.memory.available ?? info.memory.free)} of ${bytes(info.memory.total)}` : '') },
   { id: 'storage', label: 'Free Storage', type: 'static', value: value(info.root ? `${bytes(info.root.avail * 1024)} of ${bytes(info.root.total * 1024)}` : '') },
   { id: 'tmp', label: 'Free /tmp', type: 'static', value: value(info.tmp ? `${bytes(info.tmp.avail * 1024)} of ${bytes(info.tmp.total * 1024)}` : '') }
  ];
 },
 values: () => ({})
};

export const BACKUP_UPLOAD = '/tmp/routerdeck-backup.tar.gz';
export const FIRMWARE_UPLOAD = '/tmp/routerdeck-firmware.bin';

export const backup = {
 id: 'system-backup',
 noun: 'Backup',
 singleton: true,
 readOnly: true,
 sources: ['board'],
 rows: () => [{ key: 'backup', section: 'backup' }],
 itemTitle: () => 'Backup',
 itemStatus: () => ['sysupgrade -b / -r'],
 fields: () => [{ id: 'note', label: '', type: 'note', value: () => 'The backup holds /etc/config and the other files sysupgrade keeps, passwords and keys included, so store it safely. Restoring one replaces the configuration and reboots the router; Undo cannot take it back.' }],
 values: () => ({}),
 tools: [
  {
   id: 'download', label: 'Download Backup', enabled: () => true,
   run: (rows, data) => ({ description: 'Download a backup', download: { url: '/cgi-bin/cgi-backup', filename: `backup-${data.board?.hostname ?? 'router'}-${new Date().toISOString().slice(0, 10)}.tar.gz` } })
  },
  {
   id: 'restore', label: 'Restore Backup…', enabled: () => true,
   run: () => ({
    upload: { path: BACKUP_UPLOAD, accept: '.tar.gz,.tgz,application/gzip' },
    check: ['routerdeck', 'restore', { action: 'check' }],
    confirm: result => ({ title: 'Restore Backup', text: `Restore ${result.count} files from this backup and reboot? The current configuration is replaced. Undo and Safe Mode cannot take this back.`, submitLabel: 'Restore and Reboot' }),
    cancel: ['routerdeck', 'restore', { action: 'discard' }],
    call: ['routerdeck', 'restore', { action: 'apply' }],
    notice: 'The backup was restored; the router is rebooting', tone: 'warning'
   })
  }
 ]
};

const kib = size => Number.isFinite(size) ? bytes(size) : 'an unknown size';

export function firmwareQuestion(result, keep) {
 return {
  title: 'Flash Firmware',
  text: `The router accepted this image (${kib(result.size)}, SHA-256 ${String(result.sha256 ?? '').slice(0, 16)}…). Flash it ${keep && result.allow_backup ? 'and keep the settings' : 'and erase the settings'}? The router reboots when it is done; do not power it off meanwhile.`,
  submitLabel: 'Flash'
 };
}

// sysupgrade checks the image first; one the router rejects is never flashed.
export const firmware = {
 id: 'system-firmware',
 noun: 'Firmware',
 singleton: true,
 sources: ['board'],
 action: { label: 'Upload…' },
 rows: data => data.board ? [{ key: 'firmware', section: 'firmware' }] : [],
 itemTitle: () => 'Firmware',
 itemStatus: () => ['sysupgrade'],
 fields: data => [
  { id: 'current', label: 'Current', type: 'static', value: () => data.board?.release?.description ?? '—' },
  { id: 'target', label: 'Target', type: 'static', value: () => data.board?.release?.target ?? '—' },
  { id: 'board', label: 'Board', type: 'static', value: () => data.board?.board_name ?? '—' },
  { id: 'keep', label: 'Keep Settings', type: 'bool' },
  { id: 'note', label: '', type: 'note', value: () => 'Choose a sysupgrade image built for this board. The router checks it before anything is flashed, and you confirm once more. Flashing reboots the router; Undo and Safe Mode cannot take it back.' }
 ],
 values: () => ({ keep: true }),
 defaults: () => ({ keep: true }),
 save: values => ({
  upload: { path: FIRMWARE_UPLOAD, accept: '.bin,.img,.itb,.gz,.trx,.chk' },
  check: ['routerdeck', 'firmware', { action: 'check' }],
  reject: result => result.valid ? null : `The router rejected this image${Object.entries(result.tests ?? {}).some(([, passed]) => !passed) ? ` (failed: ${Object.entries(result.tests).filter(([, passed]) => !passed).map(([name]) => name).join(', ')})` : ''}; it was not flashed`,
  confirm: result => firmwareQuestion(result, values.keep),
  cancel: ['routerdeck', 'firmware', { action: 'discard' }],
  call: ['routerdeck', 'firmware', { action: 'flash', keep: !!values.keep }],
  notice: 'Flashing the firmware; the router reboots when it is done', tone: 'warning'
 })
};
