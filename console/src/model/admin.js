// SPDX-License-Identifier: Apache-2.0
// System ▸ Users (rpcd logins), Certificates, LEDs and Disks (block-mount).
// Logins live in /etc/config/rpcd, LEDs in /etc/config/system and mount
// points in /etc/config/fstab, so they are undoable changes like any other.
// Certificates and unmounting are not.
import { sections, truthy, list, invalid, compact } from './common.js';

// A new section needs no options that would be removed.
const present = values => Object.fromEntries(Object.entries(values).filter(([, value]) => value != null));
import { bytes } from '../lib/format.js';
import { sha512crypt, randomSalt } from '../lib/crypt.js';
import { parseCertificates, fromBase64 } from '../lib/x509.js';

/* --- Users ----------------------------------------------------------------- */

const USERNAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}$/;
const GROUPS = [
 { value: 'full', label: 'full (read and change everything)' },
 { value: 'read', label: 'read (look, change nothing)' },
 { value: 'custom', label: 'custom ACL groups' }
];

function groupOf(login) {
 const read = login.read ?? [], write = login.write ?? [];
 if (read.includes('*') && write.includes('*')) return 'full';
 if (read.includes('*') && !write.length) return 'read';
 return 'custom';
}

function passwordText(kind) {
 if (kind?.startsWith('system:')) return `system account ${kind.slice(7)}`;
 return { hash: 'own password', none: 'none', other: 'unusable' }[kind] ?? '';
}

export const users = {
 id: 'users',
 noun: 'User',
 sources: ['users'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'name', label: 'Name', width: 140 },
  { id: 'group', label: 'Group', width: 80 },
  { id: 'password', label: 'Password', width: 170 },
  { id: 'acl', label: 'ACL Groups', width: 360 }
 ],
 flagLegend: { C: 'the account of this session' },
 defaultSort: 'name',
 status: () => 'Accounts that log in to this console and LuCI (rpcd logins)',
 rows: data => (data.users?.logins ?? []).map(login => {
  const group = groupOf(login);
  return {
   key: login.section, section: login.section, login, comment: login.comment, flags: login.username === data.users.current ? 'C' : '',
   cells: { name: login.username ?? '', group, password: passwordText(login.password), acl: group === 'custom' ? [...login.read.map(name => `${name} (read)`), ...login.write.map(name => `${name} (write)`)].join(', ') : '' }
  };
 }),
 itemTitle: row => `User <${row?.cells.name || 'new'}>`,
 itemStatus: row => [row.cells.group, row.flags ? 'logged in here' : ''],
 canAdd: () => true,
 canRemove: () => true,
 canComment: () => true,
 removeBlocked(rows, data) {
  if (rows.some(row => row.login.username === data.users.current)) return `You are logged in as ${data.users.current}; remove that account from another one`;
  const full = (data.users.logins ?? []).filter(login => groupOf(login) === 'full' && !rows.some(row => row.key === login.section));
  return full.length ? null : 'At least one account with the full group must stay';
 },
 fields(data, row) {
  const groups = Object.entries(data.users?.groups ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([value, label]) => ({ value, label: label ? `${value} — ${label}` : value }));
  const accounts = (data.users?.accounts ?? []).map(account => ({ value: account.name, label: account.name }));
  return [
   { id: 'name', label: 'Name', type: 'text' },
   { id: 'group', label: 'Group', type: 'select', options: GROUPS },
   { id: 'read', label: 'Read Groups', type: 'multi', options: groups, visible: values => values.group === 'custom' },
   { id: 'write', label: 'Write Groups', type: 'multi', options: groups, visible: values => values.group === 'custom' },
   { id: 'source', label: 'Password From', type: 'select', options: [{ value: 'own', label: 'its own password' }, { value: 'system', label: 'a system account (/etc/shadow)' }] },
   { id: 'account', label: 'System Account', type: 'select', options: accounts, visible: values => values.source === 'system' },
   { id: 'password', label: 'Password', type: 'password', placeholder: row?.login.password === 'hash' ? 'unchanged' : '', visible: values => values.source === 'own' },
   { id: 'confirm', label: 'Confirm Password', type: 'password', visible: values => values.source === 'own' },
   { id: 'note', label: '', type: 'note', value: () => 'The password is stored as a SHA-512 hash in /etc/config/rpcd. The group decides what the account may read and change; custom groups come from /usr/share/rpcd/acl.d.' }
  ];
 },
 values(row) {
  const kind = row.login.password ?? '';
  return {
   name: row.login.username ?? '', group: groupOf(row.login), read: row.login.read.filter(name => name !== '*'), write: row.login.write.filter(name => name !== '*'),
   source: kind.startsWith('system:') ? 'system' : 'own', account: kind.startsWith('system:') ? kind.slice(7) : 'root', password: '', confirm: ''
  };
 },
 defaults: () => ({ name: '', group: 'full', read: [], write: [], source: 'own', account: 'root', password: '', confirm: '' }),
 save(values, row, data, { salt = randomSalt() } = {}) {
  const name = String(values.name ?? '').trim();
  if (!USERNAME.test(name)) invalid('name', 'Use letters, digits, ".", "_" and "-"');
  if ((data.users?.logins ?? []).some(login => login.username === name && login.section !== row?.section)) invalid('name', `${name} already exists`);
  const access = values.group === 'full' ? { read: ['*'], write: ['*'] } : values.group === 'read' ? { read: ['*'], write: [] } : { read: values.read ?? [], write: values.write ?? [] };
  if (values.group === 'custom' && !access.read.length && !access.write.length) invalid('read', 'Choose at least one group');
  const options = { username: name, read: access.read, write: access.write };
  if (values.source === 'system') {
   if (!(data.users?.accounts ?? []).some(account => account.name === values.account)) invalid('account', 'Choose a system account');
   options.password = `$p$${values.account}`;
  } else if (values.password || !row || row.login.password !== 'hash') {
   if (!values.password) invalid('password', 'Enter a password');
   if (values.password !== values.confirm) invalid('confirm', 'The passwords do not match');
   options.password = sha512crypt(values.password, salt);
  }
  if (row && row.login.username === data.users?.current && values.group !== 'full' && groupOf(row.login) === 'full') invalid('group', 'This is the account you are logged in with; keep it full or change it from another account');
  return row
   ? { description: `Change user ${name}`, ops: [{ op: 'set', config: 'rpcd', section: row.section, values: compact(options) }] }
   : { description: `Add user ${name}`, ops: [{ op: 'add', config: 'rpcd', type: 'login', values: present(compact(options)) }] };
 },
 findCreated: (rows, values) => rows.find(row => row.cells.name === values.name),
 remove: rows => ({ description: `Remove user ${rows.map(row => row.cells.name).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'rpcd', section: row.section })) }),
 comment: (rows, comment) => ({ description: `Comment user ${rows.map(row => row.cells.name).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'rpcd', section: row.section, values: { comment: comment || null } })) })
};

/* --- Certificates ------------------------------------------------------------ */

const pad = value => String(value).padStart(2, '0');
const day = seconds => {
 if (!Number.isFinite(seconds)) return '';
 const date = new Date(seconds * 1000);
 return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
const keyText = cert => cert.keySize ? `${cert.keyType} ${cert.keySize}` : cert.keyType;
const colon = fingerprint => (fingerprint.match(/../g) ?? []).join(':').toUpperCase();

export function certificateRow(cert, extra = {}, now = Date.now() / 1000) {
 const expired = Number.isFinite(cert.notAfter) && cert.notAfter < now;
 const days = Number.isFinite(cert.notAfter) ? Math.floor((cert.notAfter - now) / 86400) : null;
 return {
  cert, expired, days, readOnly: true, tone: expired ? 'error' : days !== null && days < 30 ? 'warning' : undefined,
  flags: (extra.key ? 'K' : '') + (cert.authority ? 'A' : '') + (extra.trusted ? 'T' : '') + (expired ? 'E' : ''),
  cells: { name: extra.name ?? cert.name, common: cert.name, issuer: cert.selfSigned ? 'self-signed' : cert.issuerName, key: keyText(cert), expires: day(cert.notAfter), days: days === null ? '' : String(days), fingerprint: colon(cert.fingerprint) }
 };
}

const CERT_COLUMNS = [
 { id: 'flags', label: '', width: 36 },
 { id: 'name', label: 'Name', width: 160 },
 { id: 'common', label: 'Common Name', width: 200 },
 { id: 'issuer', label: 'Issuer', width: 180 },
 { id: 'key', label: 'Key', width: 90 },
 { id: 'expires', label: 'Expires', width: 90 },
 { id: 'days', label: 'Days Left', width: 70, align: 'right', sort: value => Number(value) || 0 },
 { id: 'fingerprint', label: 'SHA-256 Fingerprint', width: 300, hidden: true }
];

const certificateFields = () => [
 { id: 'subject', label: 'Subject', type: 'static' },
 { id: 'issuer', label: 'Issuer', type: 'static' },
 { id: 'names', label: 'Alternative Names', type: 'static' },
 { id: 'from', label: 'Valid From', type: 'static' },
 { id: 'until', label: 'Valid Until', type: 'static' },
 { id: 'key', label: 'Key', type: 'static' },
 { id: 'serial', label: 'Serial', type: 'static' },
 { id: 'fingerprint', label: 'SHA-256', type: 'static', wide: true },
 { id: 'file', label: 'File', type: 'static' }
];
const certificateValues = row => ({
 subject: row.cert.subject, issuer: row.cert.issuer, names: row.cert.names.join(', '), from: day(row.cert.notBefore), until: day(row.cert.notAfter),
 key: keyText(row.cert), serial: row.cert.serial, fingerprint: row.cells.fingerprint, file: row.file ?? ''
});

export const CERT_UPLOADS = ['/tmp/routerdeck-cert', '/tmp/routerdeck-key'];

export const certificates = {
 id: 'certificates',
 noun: 'Certificate',
 readOnly: true,
 sources: ['certificates'],
 columns: CERT_COLUMNS,
 flagLegend: { K: 'private key', A: 'authority', T: 'trusted', E: 'expired' },
 defaultSort: null,
 status: () => 'The web server certificate and ACME certificates; changing them restarts uhttpd and cannot be undone',
 rows(data) {
  const rows = [];
  for (const file of data.certificates?.certificates ?? []) {
   let parsed = [];
   try { parsed = parseCertificates(fromBase64(file.data)); } catch { parsed = []; }
   const [leaf] = parsed;
   const name = file.role === 'web' ? 'web server' : file.path.replace(/^.*\//, '');
   if (leaf) rows.push({ ...certificateRow(leaf, { key: file.key, name }), key: file.path, file: file.path, role: file.role, previous: file.previous, chain: parsed.length - 1 });
   else rows.push({ key: file.path, file: file.path, role: file.role, readOnly: true, tone: 'error', flags: '', cells: { name, common: 'cannot be read', issuer: '', key: '', expires: '', days: '', fingerprint: '' } });
  }
  return rows;
 },
 itemTitle: row => `Certificate <${row.cells.name}>`,
 itemStatus: row => [row.role === 'web' ? 'uhttpd' : row.role, row.expired ? 'expired' : row.days !== null ? `${row.days} days left` : ''],
 fields: certificateFields,
 values: row => row.cert ? certificateValues(row) : { file: row.file },
 tools: [
  {
   id: 'regenerate', label: 'Regenerate', cli: false, enabled: rows => rows.length === 1 && rows[0].role === 'web',
   run: () => ({ ask: { title: 'Regenerate', text: 'Make a new self-signed certificate for the web server? Browsers warn about it until you accept it again. The previous one is kept for Restore Previous.', submitLabel: 'Regenerate' }, call: ['routerdeck', 'certificate', { action: 'regenerate' }], notice: 'New certificate; the web server restarts', tone: 'warning' })
  },
  {
   id: 'import', label: 'Import…', cli: false, enabled: rows => rows.length <= 1 && rows.every(row => row.role === 'web'),
   run: () => ({
    upload: { multiple: true, accept: '.pem,.crt,.cer,.der,.key', paths: (file, files) => files.length === 1 ? CERT_UPLOADS : [/key/i.test(file.name) ? CERT_UPLOADS[1] : CERT_UPLOADS[0]] },
    check: ['routerdeck', 'certificate', { action: 'check' }],
    reject: result => result.key ? null : 'The private key is missing; choose the certificate and its key together',
    confirm: result => {
     const [cert] = parseCertificates(fromBase64(result.data));
     return { title: 'Import Certificate', text: `Use the certificate for ${cert?.commonName || cert?.subject || 'an unnamed subject'}, issued by ${cert?.selfSigned ? 'itself' : cert?.issuerName}, valid until ${day(cert?.notAfter)}, for the web server? It restarts, and the previous certificate is kept.`, submitLabel: 'Import' };
    },
    cancel: ['routerdeck', 'certificate', { action: 'discard' }],
    call: ['routerdeck', 'certificate', { action: 'import' }],
    notice: 'Certificate imported; the web server restarts', tone: 'warning'
   })
  },
  { id: 'previous', label: 'Restore Previous', cli: false, enabled: rows => rows.length === 1 && !!rows[0].previous, run: () => ({ ask: { title: 'Restore Previous', text: 'Go back to the previous web server certificate and key?', submitLabel: 'Restore' }, call: ['routerdeck', 'certificate', { action: 'previous' }], notice: 'Previous certificate restored; the web server restarts', tone: 'warning' }) }
 ]
};

export const trustedCertificates = {
 id: 'certificates-trusted',
 noun: 'Trusted Certificate',
 readOnly: true,
 sources: ['trusted'],
 columns: CERT_COLUMNS,
 flagLegend: { A: 'authority', T: 'trusted', E: 'expired' },
 defaultSort: 'common',
 status: data => data.trusted?.data ? `${data.trusted.path}, used by HTTPS clients on the router` : 'No CA bundle (install ca-bundle)',
 rows(data) {
  if (!data.trusted?.data) return [];
  let parsed = [];
  try { parsed = parseCertificates(fromBase64(data.trusted.data)); } catch { parsed = []; }
  return parsed.map((cert, index) => ({ ...certificateRow(cert, { trusted: true }), key: `${index}:${cert.fingerprint}`, file: data.trusted.path }));
 },
 itemTitle: row => `Trusted Certificate <${row.cells.common}>`,
 fields: certificateFields,
 values: certificateValues
};

/* --- LEDs -------------------------------------------------------------------- */

const TRIGGERS = ['none', 'default-on', 'timer', 'heartbeat', 'netdev'];

export const leds = {
 id: 'system-leds',
 noun: 'LED',
 sources: ['uci:system', 'leds', 'devices'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 140 },
  { id: 'led', label: 'LED', width: 150 },
  { id: 'trigger', label: 'Trigger', width: 100 },
  { id: 'detail', label: 'Device / Mode', width: 160 },
  { id: 'state', label: 'State', width: 60 }
 ],
 flagLegend: { D: 'not configured', I: 'not on this board', R: 'lit' },
 defaultSort: null,
 status: data => (data.leds?.leds ?? []).length ? `${data.leds.leds.length} LEDs in /sys/class/leds` : 'This board has no LEDs in /sys/class/leds',
 rows(data) {
  const live = new Map((data.leds?.leds ?? []).map(led => [led.name, led]));
  const configured = sections(data['uci:system'], 'led');
  const rows = configured.map(section => {
   const led = live.get(section.sysfs);
   return {
    key: section['.name'], section: section['.name'], comment: section.comment,
    flags: (led ? '' : 'I') + (led?.brightness > 0 ? 'R' : ''),
    cells: { name: section.name ?? '', led: section.sysfs ?? '', trigger: section.trigger ?? 'none', detail: section.trigger === 'netdev' ? `${section.dev ?? ''} ${list(section.mode).join('+')}`.trim() : section.trigger === 'timer' ? `${section.delayon ?? 500}/${section.delayoff ?? 500} ms` : '', state: led ? (led.brightness > 0 ? 'on' : 'off') : '' }
   };
  });
  for (const led of live.values()) {
   if (configured.some(section => section.sysfs === led.name)) continue;
   // Saving one creates its section, as Add would.
   rows.push({ key: `sysfs:${led.name}`, dynamic: true, led, flags: 'D' + (led.brightness > 0 ? 'R' : ''), cells: { name: '', led: led.name, trigger: led.trigger ?? '', detail: '', state: led.brightness > 0 ? 'on' : 'off' } });
  }
  return rows;
 },
 itemTitle: row => `LED <${row?.cells.name || row?.cells.led || 'new'}>`,
 itemStatus: row => [row.dynamic ? 'not configured' : row.cells.trigger, row.cells.state],
 canAdd: () => true,
 canRemove: row => !row.dynamic,
 canComment: row => !row.dynamic,
 fields(data) {
  const live = data.leds?.leds ?? [];
  const devices = Object.keys(data.devices ?? {}).sort().map(name => ({ value: name, label: name }));
  return [
   { id: 'name', label: 'Name', type: 'text' },
   { id: 'sysfs', label: 'LED', type: 'select', options: live.map(led => ({ value: led.name, label: led.name })) },
   { id: 'trigger', label: 'Trigger', type: 'select', options: values => [...new Set([...TRIGGERS, ...(live.find(led => led.name === values.sysfs)?.triggers ?? [])])].map(value => ({ value, label: value })) },
   { id: 'default', label: 'On at Start', type: 'bool', visible: values => values.trigger === 'none' },
   { id: 'dev', label: 'Device', type: 'select', options: devices, visible: values => values.trigger === 'netdev' },
   { id: 'mode', label: 'Mode', type: 'multi', options: [{ value: 'link', label: 'link' }, { value: 'tx', label: 'transmit' }, { value: 'rx', label: 'receive' }], visible: values => values.trigger === 'netdev' },
   { id: 'delayon', label: 'On (ms)', type: 'number', visible: values => values.trigger === 'timer' },
   { id: 'delayoff', label: 'Off (ms)', type: 'number', visible: values => values.trigger === 'timer' }
  ];
 },
 values(row, data) {
  const section = row.section ? data['uci:system'][row.section] : {};
  return { name: section.name ?? '', sysfs: section.sysfs ?? row.led?.name ?? '', trigger: section.trigger ?? (TRIGGERS.includes(row.led?.trigger) ? row.led.trigger : 'none'), default: truthy(section.default), dev: section.dev ?? '', mode: list(section.mode), delayon: section.delayon ?? '500', delayoff: section.delayoff ?? '500' };
 },
 defaults: (data, params) => ({ name: '', sysfs: data.leds?.leds?.[0]?.name ?? '', trigger: 'none', default: false, dev: '', mode: ['link', 'tx', 'rx'], delayon: '500', delayoff: '500' }),
 copy: values => values,
 save(values, row) {
  if (!values.name.trim()) invalid('name', 'Give the LED a name');
  if (!/^[A-Za-z0-9:_.+-]+$/.test(values.sysfs ?? '')) invalid('sysfs', 'Choose the LED');
  for (const id of ['delayon', 'delayoff']) if (values.trigger === 'timer' && !(/^\d+$/.test(values[id]) && Number(values[id]) <= 60000)) invalid(id, 'Milliseconds, 0 to 60000');
  if (values.trigger === 'netdev' && !values.dev) invalid('dev', 'Choose the device');
  const options = compact({
   name: values.name.trim(), sysfs: values.sysfs, trigger: values.trigger, default: values.trigger === 'none' ? (values.default ? '1' : '0') : '',
   dev: values.trigger === 'netdev' ? values.dev : '', mode: values.trigger === 'netdev' ? (values.mode ?? []).join(' ') : '',
   delayon: values.trigger === 'timer' ? values.delayon : '', delayoff: values.trigger === 'timer' ? values.delayoff : ''
  });
  return row?.section
   ? { description: `Change LED ${options.name}`, ops: [{ op: 'set', config: 'system', section: row.section, values: options }] }
   : { description: `Add LED ${options.name}`, ops: [{ op: 'add', config: 'system', type: 'led', values: present(options) }] };
 },
 remove: rows => ({ description: `Remove LED ${rows.map(row => row.cells.name).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'system', section: row.section })) }),
 comment: (rows, comment) => ({ description: `Comment LED ${rows.map(row => row.cells.name).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'system', section: row.section, values: { comment: comment || null } })) })
};

/* --- Disks and mount points ------------------------------------------------------ */

const PROTECTED = /^\/(|rom|overlay|tmp|tmp\/.*|dev|dev\/.*|proc|proc\/.*|sys|sys\/.*|boot)$/;

// One row per disk and per partition, with its file system and mount.
export function diskRows(disks) {
 const rows = [];
 const add = (name, size, extra) => {
  const path = `/dev/${name}`;
  const fs = disks?.filesystems?.[path] ?? {};
  const mount = (disks?.mounts ?? []).find(item => item.source === path || (item.source === '/dev/root' && fs.label === 'rootfs' && item.target === '/'));
  const use = mount ? disks.usage?.[mount.target] : null;
  rows.push({
   key: name, readOnly: true, mount, fs, flags: (mount ? 'M' : '') + (extra.removable ? 'R' : ''),
   cells: { name, size: bytes(size), type: fs.type ?? '', label: fs.label ?? '', uuid: fs.uuid ?? '', mounted: mount?.target ?? '', use: use ? `${bytes(use.used)} of ${bytes(use.size)}` : '', model: extra.model ?? '' }
  });
 };
 for (const device of disks?.devices ?? []) {
  add(device.name, device.size, { removable: device.removable, model: [device.vendor, device.model].filter(Boolean).join(' ') });
  for (const part of device.partitions) add(part.name, part.size, { removable: device.removable });
 }
 return rows;
}

export const disks = {
 id: 'disks',
 noun: 'Disk',
 readOnly: true,
 sources: ['disks'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 90 },
  { id: 'size', label: 'Size', width: 80, align: 'right' },
  { id: 'type', label: 'File System', width: 80 },
  { id: 'label', label: 'Label', width: 100 },
  { id: 'mounted', label: 'Mounted At', width: 130 },
  { id: 'use', label: 'Used', width: 150 },
  { id: 'uuid', label: 'UUID', width: 280, hidden: true },
  { id: 'model', label: 'Model', width: 150 }
 ],
 flagLegend: { M: 'mounted', R: 'removable' },
 defaultSort: null,
 status: data => data.disks?.block ? 'block-mount mounts what Mount Points list' : 'Mount Points need the block-mount package',
 rows: data => diskRows(data.disks),
 itemTitle: row => `Disk <${row.key}>`,
 fields: () => ['name', 'size', 'type', 'label', 'uuid', 'mounted', 'use', 'model'].map(id => ({ id, label: disks.columns.find(column => column.id === id).label, type: 'static' })),
 values: row => ({ ...row.cells }),
 tools: [
  { id: 'unmount', label: 'Unmount', enabled: rows => rows.length > 0 && rows.every(row => row.mount && !PROTECTED.test(row.mount.target)), run: rows => ({ calls: rows.map(row => ['routerdeck', 'unmount', { target: row.mount.target }]), notice: `Unmounted ${rows.map(row => row.mount.target).join(', ')}` }) },
  { id: 'mount-all', label: 'Mount All', enabled: () => true, run: () => ({ call: ['routerdeck', 'mount', {}], notice: 'block-mount mounted the configured mount points' }) }
 ]
};

// A mount point names its file system by UUID, label or device.
function deviceOptions(data, current) {
 const options = Object.entries(data.disks?.filesystems ?? {}).filter(([, fs]) => fs.type && fs.type !== 'swap').map(([path, fs]) => ({
  value: fs.uuid ? `uuid:${fs.uuid}` : `device:${path}`, label: `${path.replace('/dev/', '')} ${fs.type}${fs.label ? ` "${fs.label}"` : ''}${fs.uuid ? ` ${fs.uuid.slice(0, 8)}…` : ''}`
 }));
 if (current && !options.some(option => option.value === current)) options.unshift({ value: current, label: current.replace(':', ' ') });
 return options;
}
const sourceOf = section => section.uuid ? `uuid:${section.uuid}` : section.label ? `label:${section.label}` : section.device ? `device:${section.device}` : '';
const sourceOptions = value => {
 const [kind, ...rest] = String(value ?? '').split(':');
 const text = rest.join(':');
 return { uuid: kind === 'uuid' ? text : '', label: kind === 'label' ? text : '', device: kind === 'device' ? text : '' };
};
const FS_TYPES = ['', 'ext4', 'ext3', 'ext2', 'vfat', 'exfat', 'ntfs3', 'btrfs', 'f2fs', 'xfs'].map(value => ({ value, label: value || 'detect' }));

export const mounts = {
 id: 'disk-mounts',
 noun: 'Mount Point',
 sources: ['uci:fstab', 'disks'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'target', label: 'Mount Point', width: 140 },
  { id: 'source', label: 'File System', width: 260 },
  { id: 'fstype', label: 'Type', width: 70 },
  { id: 'options', label: 'Options', width: 140 }
 ],
 flagLegend: { X: 'disabled', M: 'mounted' },
 defaultSort: null,
 status: data => data.disks?.block ? '/etc/config/fstab; block-mount mounts enabled entries at once' : 'Install block-mount to mount file systems from here',
 rows: data => sections(data['uci:fstab'], 'mount').map(section => {
  const disabled = !truthy(section.enabled, true);
  const mounted = (data.disks?.mounts ?? []).some(mount => mount.target === section.target);
  return {
   key: section['.name'], section: section['.name'], disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (mounted ? 'M' : ''),
   cells: { target: section.target ?? '', source: sourceOf(section).replace(':', ' '), fstype: section.fstype ?? '', options: section.options ?? '' }
  };
 }),
 itemTitle: row => `Mount Point <${row?.cells.target || 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.flags.includes('M') ? 'mounted' : 'not mounted'],
 canAdd: data => !!data.disks?.block,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'source', label: 'File System', type: 'select', options: deviceOptions(data, row ? sourceOf(data['uci:fstab'][row.section]) : '') },
  { id: 'target', label: 'Mount Point', type: 'text', placeholder: '/mnt/usb' },
  { id: 'fstype', label: 'Type', type: 'select', options: FS_TYPES },
  { id: 'options', label: 'Options', type: 'text', placeholder: 'rw,noatime' },
  { id: 'check', label: 'Check at Start', type: 'bool' }
 ],
 values: (row, data) => {
  const section = data['uci:fstab'][row.section];
  return { source: sourceOf(section), target: section.target ?? '', fstype: section.fstype ?? '', options: section.options ?? '', check: truthy(section.enabled_fsck) };
 },
 defaults: data => ({ source: deviceOptions(data, '')[0]?.value ?? '', target: '/mnt/', fstype: '', options: '', check: false }),
 save(values, row, data) {
  if (!values.source) invalid('source', 'Choose the file system');
  if (!/^\/[A-Za-z0-9._\/-]+$/.test(values.target) || values.target.endsWith('/')) invalid('target', 'Enter a path such as /mnt/usb');
  if (PROTECTED.test(values.target)) invalid('target', `${values.target} belongs to the system`);
  if (sections(data['uci:fstab'], 'mount').some(section => section.target === values.target && section['.name'] !== row?.section)) invalid('target', `Something else mounts at ${values.target}`);
  if (values.options && !/^[A-Za-z0-9_=,.-]+$/.test(values.options)) invalid('options', 'Comma-separated mount options');
  const options = compact({ ...sourceOptions(values.source), target: values.target, fstype: values.fstype, options: values.options, enabled_fsck: values.check ? '1' : '' });
  return row
   ? { description: `Change mount point ${values.target}`, ops: [{ op: 'set', config: 'fstab', section: row.section, values: options }] }
   : { description: `Mount ${values.target}`, ops: [{ op: 'add', config: 'fstab', type: 'mount', values: { ...present(options), enabled: '1' } }] };
 },
 remove: rows => ({ description: `Remove mount point ${rows.map(row => row.cells.target).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'fstab', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} mount point ${rows.map(row => row.cells.target).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'fstab', section: row.section, values: { enabled: enable ? '1' : '0' } })) }),
 comment: (rows, comment) => ({ description: `Comment mount point ${rows.map(row => row.cells.target).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'fstab', section: row.section, values: { comment: comment || null } })) })
};

export const swaps = {
 id: 'disk-swap',
 noun: 'Swap',
 sources: ['uci:fstab', 'disks'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'source', label: 'Device', width: 260 },
  { id: 'size', label: 'Size', width: 80, align: 'right' },
  { id: 'used', label: 'Used', width: 80, align: 'right' }
 ],
 flagLegend: { X: 'disabled', A: 'active' },
 defaultSort: null,
 rows: data => sections(data['uci:fstab'], 'swap').map(section => {
  const disabled = !truthy(section.enabled, true);
  const fs = Object.entries(data.disks?.filesystems ?? {}).find(([path, item]) => (section.uuid && item.uuid === section.uuid) || (section.label && item.label === section.label) || path === section.device);
  const active = (data.disks?.swaps ?? []).find(swap => swap.source === (fs?.[0] ?? section.device));
  return { key: section['.name'], section: section['.name'], disabled, flags: (disabled ? 'X' : '') + (active ? 'A' : ''), cells: { source: sourceOf(section).replace(':', ' '), size: active ? bytes(active.size) : '', used: active ? bytes(active.used) : '' } };
 }),
 itemTitle: row => `Swap <${row?.cells.source || 'new'}>`,
 canAdd: data => !!data.disks?.block,
 canRemove: () => true,
 canToggle: () => true,
 fields: (data, row) => [{ id: 'source', label: 'Device', type: 'select', options: Object.entries(data.disks?.filesystems ?? {}).filter(([, fs]) => fs.type === 'swap').map(([path, fs]) => ({ value: fs.uuid ? `uuid:${fs.uuid}` : `device:${path}`, label: `${path} swap` })).concat(row ? [{ value: sourceOf(data['uci:fstab'][row.section]), label: sourceOf(data['uci:fstab'][row.section]) }] : []) }],
 values: (row, data) => ({ source: sourceOf(data['uci:fstab'][row.section]) }),
 defaults: () => ({ source: '' }),
 save(values, row) {
  if (!values.source) invalid('source', 'Choose a swap partition');
  const options = sourceOptions(values.source);
  return row
   ? { description: 'Change swap', ops: [{ op: 'set', config: 'fstab', section: row.section, values: compact(options) }] }
   : { description: 'Add swap', ops: [{ op: 'add', config: 'fstab', type: 'swap', values: { ...present(compact(options)), enabled: '1' } }] };
 },
 remove: rows => ({ description: 'Remove swap', ops: rows.map(row => ({ op: 'delete', config: 'fstab', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} swap`, ops: rows.map(row => ({ op: 'set', config: 'fstab', section: row.section, values: { enabled: enable ? '1' : '0' } })) })
};

export const mountSettings = {
 id: 'disk-settings',
 noun: 'Mount Settings',
 singleton: true,
 sources: ['uci:fstab', 'disks'],
 rows: data => data.disks?.block ? [{ key: 'global', section: sections(data['uci:fstab'], 'global')[0]?.['.name'] ?? null }] : [],
 itemTitle: () => 'Mount Settings',
 itemStatus: () => ['block-mount'],
 fields: () => [
  { id: 'auto_mount', label: 'Mount Unlisted', type: 'bool' },
  { id: 'anon_mount', label: 'Mount Under /mnt', type: 'bool' },
  { id: 'auto_swap', label: 'Use Unlisted Swap', type: 'bool' },
  { id: 'check_fs', label: 'Check Before Mounting', type: 'bool' },
  { id: 'delay_root', label: 'Wait for Root (s)', type: 'number' },
  { id: 'note', label: '', type: 'note', value: () => 'Unlisted file systems (a USB stick plugged in later) are mounted automatically when Mount Unlisted is on; Mount Under /mnt names their mount point after the device.' }
 ],
 values(row, data) {
  const section = row.section ? data['uci:fstab'][row.section] : {};
  return { auto_mount: truthy(section.auto_mount, true), anon_mount: truthy(section.anon_mount), auto_swap: truthy(section.auto_swap, true), check_fs: truthy(section.check_fs), delay_root: section.delay_root ?? '5' };
 },
 save(values, row, data, { dirty = null } = {}) {
  if (values.delay_root && !(/^\d+$/.test(values.delay_root) && Number(values.delay_root) <= 60)) invalid('delay_root', '0 to 60 seconds');
  const options = { auto_mount: values.auto_mount ? '1' : '0', anon_mount: values.anon_mount ? '1' : '0', auto_swap: values.auto_swap ? '1' : '0', check_fs: values.check_fs ? '1' : '0', delay_root: values.delay_root || null };
  const changes = Object.fromEntries(Object.entries(options).filter(([key]) => !dirty || dirty.has(key)));
  if (!Object.keys(changes).length) return null;
  return row.section
   ? { description: 'Change mount settings', ops: [{ op: 'set', config: 'fstab', section: row.section, values: changes }] }
   : { description: 'Change mount settings', ops: [{ op: 'add', config: 'fstab', type: 'global', values: present(compact(options)) }] };
 }
};
