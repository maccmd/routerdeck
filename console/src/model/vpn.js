// SPDX-License-Identifier: Apache-2.0
// PPP ▸ PPPoE Servers and Secrets (rp-pppoe-server, pppd's secrets files),
// Interfaces ▸ OpenVPN (/etc/config/openvpn) and IP ▸ IPsec (strongSwan's
// /etc/config/ipsec: remotes, tunnels and proposals).
import { sections, list, truthy, invalid, NAME, zonesOf, zoneOptions, networkOptions, compact } from './common.js';
import { zoneMembership } from './networks.js';
import { parseCidr, parseCidr6, isIPv4, canonicalIPv6, formatIPv4 } from '../lib/ip.js';
import { bytes, uptime } from '../lib/format.js';

const present = values => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && !(Array.isArray(value) && !value.length)));
const PORT = value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
const HOST = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/;

/* --- PPPoE server ----------------------------------------------------------- */

// Sessions get pppd options from a file the console keeps, so the
// authentication method matches the Secrets list.
export const PPPOE_OPTIONS = '/etc/ppp/pppoe-server-routerdeck';
const AUTH = [{ value: 'chap', label: 'CHAP' }, { value: 'pap', label: 'PAP' }, { value: 'mschap-v2', label: 'MS-CHAPv2' }];

export function pppoeOptionsText({ auth = 'chap', dns = [] } = {}) {
 return [
  '# Written by RouterDeck Console for its PPPoE servers',
  `require-${auth}`, 'lcp-echo-interval 10', 'lcp-echo-failure 2', 'mru 1492', 'mtu 1492', 'proxyarp', 'nodefaultroute', 'noipdefault',
  ...dns.map(server => `ms-dns ${server}`)
 ].join('\n') + '\n';
}
export function parsePppoeOptions(text) {
 const lines = String(text ?? '').split('\n');
 return { auth: AUTH.find(item => lines.includes(`require-${item.value}`))?.value ?? 'chap', dns: lines.map(line => /^ms-dns\s+(\S+)/.exec(line)?.[1]).filter(Boolean) };
}

export const pppoeServers = {
 id: 'ppp-servers',
 noun: 'PPPoE Server',
 sources: ['uci:pppoe', 'uci:network', 'pppfiles'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 100 },
  { id: 'interface', label: 'Interface', width: 80 },
  { id: 'service', label: 'Service', width: 120 },
  { id: 'local', label: 'Local Address', width: 110 },
  { id: 'remote', label: 'First Remote', width: 110 },
  { id: 'sessions', label: 'Max Sessions', width: 90, align: 'right' }
 ],
 flagLegend: { X: 'disabled' },
 defaultSort: null,
 status: data => data.pppfiles?.server ? 'Clients log in with the accounts in Secrets' : 'A PPPoE server needs the rp-pppoe-server package',
 rows: data => sections(data['uci:pppoe'], 'pppoe_server').map(section => {
  const disabled = !truthy(section.enabled, true);
  return {
   key: section['.name'], section: section['.name'], disabled, comment: section.comment, flags: disabled ? 'X' : '',
   cells: { name: section['.name'], interface: section.interface ?? '', service: list(section.service_name).join(', '), local: section.localip ?? '', remote: section.firstremoteip ?? '', sessions: section.maxsessions ?? '' }
  };
 }),
 itemTitle: row => `PPPoE Server <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled'],
 canAdd: data => !!data.pppfiles?.server,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: data => [
  { id: 'interface', label: 'Interface', type: 'select', options: networkOptions(data['uci:network'], section => section['.name'] !== 'loopback') },
  { id: 'service_name', label: 'Service Names', type: 'list' },
  { id: 'ac_name', label: 'AC Name', type: 'text', placeholder: 'the host name' },
  { id: 'localip', label: 'Local Address', type: 'text', placeholder: '10.67.0.1' },
  { id: 'firstremoteip', label: 'First Remote Address', type: 'text', placeholder: '10.67.0.2' },
  { id: 'maxsessions', label: 'Max Sessions', type: 'number' },
  { id: 'maxsessionsperpeer', label: 'Sessions per Client', type: 'number', placeholder: 'no limit' },
  { id: 'auth', label: 'Authentication', type: 'select', options: AUTH, tab: 'Sessions' },
  { id: 'dns', label: 'DNS Servers', type: 'list', tab: 'Sessions' },
  { id: 'mss', label: 'MSS Clamp', type: 'number', placeholder: '1468', tab: 'Sessions' },
  { id: 'timeout', label: 'Idle Timeout (s)', type: 'number', placeholder: '60', tab: 'Sessions' },
  { id: 'note', label: '', type: 'note', tab: 'Sessions', value: () => `Authentication and DNS apply to every PPPoE server here; they are kept in ${PPPOE_OPTIONS}.` }
 ],
 values: (row, data) => {
  const section = data['uci:pppoe'][row.section] ?? {};
  return {
   interface: section.interface ?? '', service_name: list(section.service_name), ac_name: section.ac_name ?? '', localip: section.localip ?? '', firstremoteip: section.firstremoteip ?? '',
   maxsessions: section.maxsessions ?? '64', maxsessionsperpeer: section.maxsessionsperpeer ?? '', mss: section.mss ?? '', timeout: section.timeout ?? '', ...parsePppoeOptions(data.pppfiles?.options)
  };
 },
 defaults: data => ({ interface: 'lan', service_name: [], ac_name: '', localip: '10.67.0.1', firstremoteip: '10.67.0.2', maxsessions: '64', maxsessionsperpeer: '', mss: '', timeout: '', ...parsePppoeOptions(data.pppfiles?.options) }),
 save(values, row, data) {
  if (!values.interface) invalid('interface', 'Choose the network clients dial in from');
  for (const id of ['localip', 'firstremoteip']) if (!isIPv4(values[id])) invalid(id, 'Enter an IPv4 address');
  if (!(/^\d+$/.test(values.maxsessions) && Number(values.maxsessions) >= 1 && Number(values.maxsessions) <= 65534)) invalid('maxsessions', '1 to 65534');
  for (const id of ['maxsessionsperpeer', 'mss', 'timeout']) if (values[id] && !/^\d+$/.test(values[id])) invalid(id, 'A whole number');
  for (const server of values.dns ?? []) if (!isIPv4(server)) invalid('dns', `${server} is not an IPv4 address`);
  for (const name of values.service_name ?? []) if (!/^[A-Za-z0-9._-]+$/.test(name)) invalid('service_name', 'Service names are letters, digits, ".", "_" and "-"');
  if (values.ac_name && !/^[A-Za-z0-9._-]+$/.test(values.ac_name)) invalid('ac_name', 'Letters, digits, ".", "_" and "-"');
  // The init script passes -N and -O even when they are unset, so both stay set.
  const options = compact({
   interface: values.interface, service_name: values.service_name ?? [], ac_name: values.ac_name, localip: values.localip, firstremoteip: values.firstremoteip,
   maxsessions: values.maxsessions, maxsessionsperpeer: values.maxsessionsperpeer, mss: values.mss, timeout: values.timeout, optionsfile: PPPOE_OPTIONS
  });
  const text = pppoeOptionsText(values);
  const ops = [row ? { op: 'set', config: 'pppoe', section: row.section, values: options } : { op: 'add', config: 'pppoe', type: 'pppoe_server', values: present(options) }];
  if (text !== (data.pppfiles?.options ?? '')) ops.push({ op: 'text', config: 'pppoe-options', text, expect: data.pppfiles?.options ?? '' });
  return { description: row ? `Change PPPoE server ${row.key}` : `Add a PPPoE server on ${values.interface}`, ops };
 },
 remove: rows => ({ description: `Remove PPPoE server ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'pppoe', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} PPPoE server ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'pppoe', section: row.section, values: { enabled: enable ? null : '0' } })) }),
 comment: (rows, comment) => ({ description: `Comment PPPoE server ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'pppoe', section: row.section, values: { comment: comment || null } })) })
};

/* --- Secrets: /etc/ppp/chap-secrets and pap-secrets, kept the same ---------- */

const QUOTE = value => /^[^\s"#]+$/.test(value) ? value : `"${value.replace(/"/g, '')}"`;

// client server secret [addresses...]; other lines stay as they are.
export function parseSecrets(text) {
 const nodes = [];
 for (const line of String(text ?? '').replace(/\n$/, '').split('\n')) {
  if (!text) break;
  const words = [...line.matchAll(/"([^"]*)"|(\S+)/g)].map(match => match[1] ?? match[2]);
  if (!line.trim().startsWith('#') && words.length >= 3) nodes.push({ type: 'secret', name: words[0], server: words[1], password: words[2], address: words.slice(3).join(' ') });
  else nodes.push({ type: 'raw', text: line });
 }
 return nodes;
}
export function formatSecrets(nodes) {
 const lines = nodes.map(node => node.type === 'raw' ? node.text : [QUOTE(node.name), QUOTE(node.server || '*'), QUOTE(node.password), node.address].filter(Boolean).join(' '));
 return lines.length ? lines.join('\n') + '\n' : '';
}

function secretsChange(data, nodes, description) {
 const text = formatSecrets(nodes);
 return { description, ops: [
  { op: 'text', config: 'chap-secrets', text, expect: data.pppfiles?.chap ?? '' },
  { op: 'text', config: 'pap-secrets', text, expect: data.pppfiles?.pap ?? '' }
 ] };
}

export const pppSecrets = {
 id: 'ppp-secrets',
 noun: 'PPP Secret',
 sources: ['pppfiles'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'name', label: 'Name', width: 140 },
  { id: 'server', label: 'Service', width: 100 },
  { id: 'address', label: 'Remote Address', width: 140 }
 ],
 flagLegend: {},
 defaultSort: 'name',
 status: () => '/etc/ppp/chap-secrets and pap-secrets; pppd reads them at each login',
 rows: data => parseSecrets(data.pppfiles?.chap).map((node, index) => ({ node, index })).filter(item => item.node.type === 'secret').map(({ node, index }) => ({
  key: `secret${index}`, index, cells: { name: node.name, server: node.server === '*' ? 'any' : node.server, address: node.address === '*' || !node.address ? 'from the pool' : node.address }
 })),
 itemTitle: row => `PPP Secret <${row?.cells.name ?? 'new'}>`,
 canAdd: () => true,
 canRemove: () => true,
 fields: () => [
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'password', label: 'Password', type: 'password' },
  { id: 'server', label: 'Service', type: 'text', placeholder: '* (any)' },
  { id: 'address', label: 'Remote Address', type: 'text', placeholder: '* (from the pool)' }
 ],
 values: (row, data) => {
  const node = parseSecrets(data.pppfiles?.chap)[row.index];
  return { name: node.name, password: node.password, server: node.server === '*' ? '' : node.server, address: node.address === '*' ? '' : node.address };
 },
 defaults: () => ({ name: '', password: '', server: '', address: '' }),
 save(values, row, data) {
  const name = String(values.name ?? '').trim();
  if (!/^[^\s"#]{1,64}$/.test(name)) invalid('name', 'A name without spaces or quotes');
  if (!values.password || /["\n]/.test(values.password)) invalid('password', 'Enter a password without quotes');
  if (values.server && !/^[^\s"#]+$/.test(values.server)) invalid('server', 'One word, or empty for any');
  if (values.address && !isIPv4(values.address)) invalid('address', 'An IPv4 address, or empty for the pool');
  const nodes = parseSecrets(data.pppfiles?.chap);
  if (nodes.some((node, index) => node.type === 'secret' && node.name === name && index !== row?.index)) invalid('name', `${name} already has a secret`);
  const node = { type: 'secret', name, server: values.server || '*', password: values.password, address: values.address || '*' };
  if (row) nodes[row.index] = node;
  else nodes.push(node);
  return secretsChange(data, nodes, row ? `Change PPP secret ${name}` : `Add PPP secret ${name}`);
 },
 remove(rows, data) {
  const drop = new Set(rows.map(row => row.index));
  return secretsChange(data, parseSecrets(data.pppfiles?.chap).filter((node, index) => !drop.has(index)), `Remove PPP secret ${rows.map(row => row.cells.name).join(', ')}`);
 }
};

/* --- OpenVPN ------------------------------------------------------------------ */

const ROLES = [{ value: 'client', label: 'client' }, { value: 'server', label: 'server' }, { value: 'file', label: 'from a configuration file' }];
const roleOf = section => section.config ? 'file' : truthy(section.client) || section.remote ? 'client' : 'server';
const subnetText = section => {
 const words = String(section.server ?? '').split(/\s+/);
 if (words.length !== 2 || !isIPv4(words[0]) || !isIPv4(words[1])) return '';
 const prefix = words[1].split('.').reduce((count, part) => count + Number(part).toString(2).replace(/0/g, '').length, 0);
 return `${words[0]}/${prefix}`;
};
const maskOf = prefix => formatIPv4(prefix ? (0xffffffff * 2 ** (32 - prefix)) % 2 ** 32 : 0);
const PATH = /^\/[\w./-]+$/;

export const openvpn = {
 id: 'openvpn',
 noun: 'OpenVPN Instance',
 sources: ['uci:openvpn', 'uci:network', 'uci:firewall', 'openvpn'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 120 },
  { id: 'role', label: 'Role', width: 80 },
  { id: 'proto', label: 'Protocol', width: 80 },
  { id: 'port', label: 'Port', width: 60, align: 'right' },
  { id: 'remote', label: 'Remote / Subnet', width: 200 },
  { id: 'device', label: 'Device', width: 90 }
 ],
 flagLegend: { R: 'running', X: 'disabled' },
 defaultSort: null,
 status: data => data.openvpn?.installed ? 'Certificates and keys are files on the router (System ▸ Files uploads them)' : 'OpenVPN needs the openvpn-mbedtls or openvpn-openssl package',
 rows: data => sections(data['uci:openvpn'], 'openvpn').map(section => {
  const name = section['.name'], disabled = !truthy(section.enabled), running = !!data.openvpn?.instances?.[name]?.running;
  const role = roleOf(section);
  return {
   key: name, section: name, disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (running ? 'R' : ''),
   cells: { name, role: role === 'file' ? 'file' : role, proto: section.proto ?? (role === 'file' ? '' : 'udp'), port: section.port ?? '', remote: role === 'file' ? section.config : role === 'client' ? list(section.remote).join(', ') : subnetText(section), device: section.dev ?? '' }
  };
 }),
 itemTitle: row => `OpenVPN <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.flags.includes('R') ? 'running' : 'not running'],
 canAdd: data => !!data.openvpn?.installed,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'office' },
  { id: 'role', label: 'Role', type: 'select', options: ROLES },
  { id: 'config', label: 'Configuration File', type: 'text', placeholder: '/etc/openvpn/office.ovpn', visible: values => values.role === 'file' },
  { id: 'remote', label: 'Remote', type: 'list', visible: values => values.role === 'client' },
  { id: 'subnet', label: 'Client Subnet', type: 'text', placeholder: '10.8.0.0/24', visible: values => values.role === 'server' },
  { id: 'proto', label: 'Protocol', type: 'select', options: ['udp', 'tcp-client', 'tcp-server', 'udp6', 'tcp6-client', 'tcp6-server'].map(value => ({ value, label: value })), visible: values => values.role !== 'file' },
  { id: 'port', label: 'Port', type: 'number', placeholder: '1194', visible: values => values.role !== 'file' },
  { id: 'dev', label: 'Device', type: 'text', placeholder: 'tun_office', visible: values => values.role !== 'file' },
  { id: 'username', label: 'User', type: 'text', placeholder: 'none', visible: values => values.role !== 'server' },
  { id: 'password', label: 'Password', type: 'password', visible: values => values.role !== 'server' && !!values.username },
  { id: 'zone', label: 'Firewall Zone', type: 'select', allowEmpty: true, options: zoneOptions(data['uci:firewall']) },
  { id: 'ca', label: 'CA Certificate', type: 'text', placeholder: '/etc/openvpn/ca.crt', tab: 'Keys', visible: values => values.role !== 'file' },
  { id: 'cert', label: 'Certificate', type: 'text', tab: 'Keys', visible: values => values.role !== 'file' },
  { id: 'key', label: 'Key', type: 'text', tab: 'Keys', visible: values => values.role !== 'file' },
  { id: 'dh', label: 'DH Parameters', type: 'text', placeholder: 'none (ECDH)', tab: 'Keys', visible: values => values.role === 'server' },
  { id: 'tls_crypt', label: 'TLS Crypt Key', type: 'text', placeholder: 'none', tab: 'Keys', visible: values => values.role !== 'file' },
  { id: 'data_ciphers', label: 'Data Ciphers', type: 'text', placeholder: 'AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305', tab: 'Advanced', visible: values => values.role !== 'file' },
  { id: 'keepalive', label: 'Keepalive', type: 'text', placeholder: '10 60', tab: 'Advanced', visible: values => values.role !== 'file' },
  { id: 'push', label: 'Push to Clients', type: 'list', tab: 'Advanced', visible: values => values.role === 'server' },
  { id: 'route', label: 'Routes', type: 'list', tab: 'Advanced', visible: values => values.role !== 'file' },
  { id: 'client_to_client', label: 'Client to Client', type: 'bool', tab: 'Advanced', visible: values => values.role === 'server' },
  { id: 'verb', label: 'Log Level', type: 'number', placeholder: '3', tab: 'Advanced' }
 ],
 values(row, data) {
  const section = data['uci:openvpn'][row.section] ?? {};
  return {
   name: row.key, role: roleOf(section), config: section.config ?? '', remote: list(section.remote), subnet: subnetText(section), proto: section.proto ?? 'udp', port: section.port ?? '', dev: section.dev ?? '',
   username: section.username ?? '', password: section.password ?? '', zone: zonesOf(data['uci:firewall'], row.key)[0] ?? '', ca: section.ca ?? '', cert: section.cert ?? '', key: section.key ?? '', dh: section.dh ?? '',
   tls_crypt: section.tls_crypt ?? '', data_ciphers: section.data_ciphers ?? '', keepalive: section.keepalive ?? '', push: list(section.push), route: list(section.route), client_to_client: truthy(section.client_to_client), verb: section.verb ?? ''
  };
 },
 defaults: () => ({ name: '', role: 'client', config: '', remote: [], subnet: '10.8.0.0/24', proto: 'udp', port: '', dev: '', username: '', password: '', zone: '', ca: '', cert: '', key: '', dh: '', tls_crypt: '', data_ciphers: '', keepalive: '10 60', push: [], route: [], client_to_client: false, verb: '' }),
 save(values, row, data) {
  const name = row ? row.section : String(values.name ?? '').trim();
  if (!row) {
   if (!NAME.test(name) || name.length > 11) invalid('name', 'Use up to 11 letters, digits or _');
   if (data['uci:openvpn']?.[name]) invalid('name', `${name} already exists`);
  }
  const role = values.role;
  if (role === 'file' && !PATH.test(values.config)) invalid('config', 'Enter the path of an .ovpn file on the router');
  if (role === 'client' && !(values.remote ?? []).length) invalid('remote', 'Enter the server, as host or host port');
  for (const remote of role === 'client' ? values.remote : []) { const [host, port, extra] = remote.trim().split(/\s+/); if (!HOST.test(host ?? '') || (port && !PORT(port)) || extra) invalid('remote', `${remote} is not "host" or "host port"`); }
  const subnet = role === 'server' ? parseCidr(values.subnet, { requirePrefix: true }) : null;
  if (role === 'server' && (!subnet || subnet.prefix > 30)) invalid('subnet', 'Enter the client subnet, such as 10.8.0.0/24');
  if (values.port && !PORT(values.port)) invalid('port', 'A port is 1 to 65535');
  if (values.dev && !/^(tun|tap)[A-Za-z0-9_]{0,12}$/.test(values.dev)) invalid('dev', 'A device name starting with tun or tap, up to 15 characters');
  for (const id of ['ca', 'cert', 'key', 'dh', 'tls_crypt']) if (role !== 'file' && values[id] && !PATH.test(values[id])) invalid(id, 'An absolute path on the router');
  if (role !== 'file' && !values.ca) invalid('ca', 'OpenVPN with TLS needs the CA certificate');
  if (role === 'server' && (!values.cert || !values.key)) invalid('cert', 'A server needs its certificate and key');
  if (values.keepalive && !/^\d+ \d+$/.test(values.keepalive)) invalid('keepalive', 'Interval and timeout, such as 10 60');
  if (values.verb && !(/^\d+$/.test(values.verb) && Number(values.verb) <= 11)) invalid('verb', '0 to 11');
  const file = role === 'file';
  const dev = file ? '' : values.dev || `tun_${name}`.slice(0, 15);
  const options = compact({
   config: file ? values.config : '', client: role === 'client' ? '1' : '', remote: role === 'client' ? values.remote : [], nobind: role === 'client' ? '1' : '',
   server: subnet ? `${subnet.network} ${maskOf(subnet.prefix)}` : '', topology: subnet ? 'subnet' : '', proto: file ? '' : values.proto, port: file ? '' : values.port, dev,
   username: role !== 'server' ? values.username : '', password: role !== 'server' && values.username ? values.password : '',
   ca: file ? '' : values.ca, cert: file ? '' : values.cert, key: file ? '' : values.key, dh: role === 'server' ? values.dh || 'none' : '', tls_crypt: file ? '' : values.tls_crypt,
   data_ciphers: file ? '' : values.data_ciphers, keepalive: file ? '' : values.keepalive, push: role === 'server' ? values.push : [], route: file ? [] : values.route,
   client_to_client: role === 'server' && values.client_to_client ? '1' : '', persist_key: file ? '' : '1', persist_tun: file ? '' : '1', verb: values.verb
  });
  const ops = [row ? { op: 'set', config: 'openvpn', section: name, values: options } : { op: 'add', config: 'openvpn', type: 'openvpn', name, values: { ...present(options), enabled: '1' } }];
  // A network on the tunnel device lets the firewall zone cover it.
  if (values.zone && dev) {
   if (!data['uci:network']?.[name]) ops.push({ op: 'add', config: 'network', type: 'interface', name, values: { proto: 'none', device: dev } });
   ops.push(...zoneMembership(data, name, values.zone));
  } else if (data['uci:network']?.[name]?.proto === 'none') ops.push(...zoneMembership(data, name, ''));
  return { description: row ? `Change OpenVPN ${name}` : `Add OpenVPN ${role} ${name}`, ops };
 },
 remove: (rows, data) => ({ description: `Remove OpenVPN ${rows.map(row => row.key).join(', ')}`, ops: rows.flatMap(row => [
  { op: 'delete', config: 'openvpn', section: row.section },
  ...(data['uci:network']?.[row.section]?.proto === 'none' ? [{ op: 'delete', config: 'network', section: row.section }, ...zoneMembership(data, row.section, '')] : [])
 ]) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} OpenVPN ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'openvpn', section: row.section, values: { enabled: enable ? '1' : '0' } })) }),
 comment: (rows, comment) => ({ description: `Comment OpenVPN ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'openvpn', section: row.section, values: { comment: comment || null } })) })
};

/* --- IPsec (strongSwan swanctl) ------------------------------------------------- */

const ENCRYPTION = ['aes128', 'aes192', 'aes256', 'aes128gcm16', 'aes256gcm16', 'chacha20poly1305', '3des'];
const HASHES = ['sha256', 'sha384', 'sha512', 'sha1', 'md5'];
const GROUPS = ['modp2048', 'modp3072', 'modp4096', 'ecp256', 'ecp384', 'ecp521', 'curve25519', 'modp1536', 'modp1024'];
const options = values => values.map(value => ({ value, label: value }));
const proposalOptions = data => sections(data['uci:ipsec'], 'crypto_proposal').map(section => ({ value: section['.name'], label: section['.name'] }));

export const ipsecPeers = {
 id: 'ipsec-peers',
 noun: 'IPsec Peer',
 sources: ['uci:ipsec', 'ipsec'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'gateway', label: 'Address', width: 140 },
  { id: 'exchange', label: 'Exchange', width: 70 },
  { id: 'auth', label: 'Authentication', width: 110 },
  { id: 'policies', label: 'Policies', width: 160 },
  { id: 'state', label: 'State', width: 100 }
 ],
 flagLegend: { X: 'disabled', E: 'established' },
 defaultSort: null,
 status: data => !data.ipsec?.installed ? 'IPsec needs strongswan-minimal and strongswan-swanctl'
  : data.ipsec.legacy ? 'Both the ipsec and the swanctl services are enabled; disable ipsec in System ▸ Startup, or swanctl cannot load these' : 'strongSwan (swanctl) from /etc/config/ipsec',
 rows: data => sections(data['uci:ipsec'], 'remote').map(section => {
  const name = section['.name'], disabled = !truthy(section.enabled), sa = (data.ipsec?.sas ?? []).find(item => item.name === name);
  return {
   key: name, section: name, disabled, comment: section.comment, flags: (disabled ? 'X' : '') + (sa?.state === 'ESTABLISHED' ? 'E' : ''),
   cells: { name, gateway: section.gateway ?? '', exchange: section.keyexchange ?? 'ikev2', auth: section.authentication_method ?? 'psk', policies: list(section.tunnel).join(', '), state: sa?.state?.toLowerCase() ?? '' }
  };
 }),
 itemTitle: row => `IPsec Peer <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.cells.state || 'not established'],
 canAdd: () => true,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'branch' },
  { id: 'gateway', label: 'Address', type: 'text', placeholder: 'the other end, or %any' },
  { id: 'local_ip', label: 'Local Address', type: 'text', placeholder: '%any' },
  { id: 'keyexchange', label: 'Exchange', type: 'select', options: options(['ikev2', 'ikev1']) },
  { id: 'authentication_method', label: 'Authentication', type: 'select', options: [{ value: 'psk', label: 'pre-shared key' }, { value: 'pubkey', label: 'certificate' }] },
  { id: 'pre_shared_key', label: 'Secret', type: 'password', visible: values => values.authentication_method === 'psk' },
  { id: 'local_cert', label: 'Certificate', type: 'text', placeholder: 'file in /etc/swanctl/x509', visible: values => values.authentication_method === 'pubkey' },
  { id: 'local_key', label: 'Private Key', type: 'text', placeholder: 'file in /etc/swanctl/private', visible: values => values.authentication_method === 'pubkey' },
  { id: 'ca_cert', label: 'CA Certificate', type: 'text', placeholder: 'file in /etc/swanctl/x509ca', visible: values => values.authentication_method === 'pubkey' },
  { id: 'local_identifier', label: 'My ID', type: 'text', placeholder: 'the local address' },
  { id: 'remote_identifier', label: 'Remote ID', type: 'text', placeholder: 'the remote address' },
  { id: 'crypto_proposal', label: 'IKE Proposals', type: 'multi', options: proposalOptions(data), tab: 'Advanced' },
  { id: 'tunnel', label: 'Policies', type: 'multi', options: sections(data['uci:ipsec'], 'tunnel').map(section => ({ value: section['.name'], label: section['.name'] })), tab: 'Advanced' },
  { id: 'mobike', label: 'MOBIKE', type: 'bool', tab: 'Advanced' },
  { id: 'encap', label: 'Force UDP Encapsulation', type: 'bool', tab: 'Advanced' },
  { id: 'dpddelay', label: 'DPD Interval', type: 'text', placeholder: '30s', tab: 'Advanced' },
  { id: 'keyingtries', label: 'Keying Tries', type: 'number', placeholder: '3', tab: 'Advanced' }
 ],
 values(row, data) {
  const section = data['uci:ipsec'][row.section] ?? {};
  return {
   name: row.key, gateway: section.gateway ?? '', local_ip: section.local_ip ?? '', keyexchange: section.keyexchange ?? 'ikev2', authentication_method: section.authentication_method ?? 'psk', pre_shared_key: section.pre_shared_key ?? '',
   local_cert: section.local_cert ?? '', local_key: section.local_key ?? '', ca_cert: section.ca_cert ?? '', local_identifier: section.local_identifier ?? '', remote_identifier: section.remote_identifier ?? '',
   crypto_proposal: list(section.crypto_proposal), tunnel: list(section.tunnel), mobike: truthy(section.mobike, true), encap: truthy(section.encap), dpddelay: section.dpddelay ?? '', keyingtries: section.keyingtries ?? ''
  };
 },
 defaults: data => ({ name: '', gateway: '', local_ip: '', keyexchange: 'ikev2', authentication_method: 'psk', pre_shared_key: '', local_cert: '', local_key: '', ca_cert: '', local_identifier: '', remote_identifier: '', crypto_proposal: proposalOptions(data).slice(0, 1).map(option => option.value), tunnel: [], mobike: true, encap: false, dpddelay: '', keyingtries: '' }),
 save(values, row, data) {
  const name = row ? row.section : String(values.name ?? '').trim();
  if (!row) {
   if (!NAME.test(name)) invalid('name', 'Use letters, digits and _');
   if (data['uci:ipsec']?.[name]) invalid('name', `${name} already exists in /etc/config/ipsec`);
  }
  const host = value => value === '%any' || isIPv4(value) || !!canonicalIPv6(value) || HOST.test(value);
  if (!values.gateway || !host(values.gateway)) invalid('gateway', 'An address, host name or %any');
  if (values.local_ip && !host(values.local_ip)) invalid('local_ip', 'An address of this router, or %any');
  if (values.authentication_method === 'psk' && String(values.pre_shared_key ?? '').length < 8) invalid('pre_shared_key', 'A secret of at least 8 characters');
  if (values.authentication_method === 'pubkey' && (!values.local_cert || !values.local_key)) invalid('local_cert', 'Name the certificate and key files');
  for (const id of ['local_identifier', 'remote_identifier']) if (values[id] && /\s/.test(values[id])) invalid(id, 'An identity has no spaces');
  if (values.dpddelay && !/^\d+[smh]?$/.test(values.dpddelay)) invalid('dpddelay', 'Such as 30s');
  if (!(values.crypto_proposal ?? []).length) invalid('crypto_proposal', 'Choose at least one proposal (add them on the Proposals tab)');
  const psk = values.authentication_method === 'psk';
  const result = compact({
   gateway: values.gateway, local_ip: values.local_ip, keyexchange: values.keyexchange, authentication_method: values.authentication_method, pre_shared_key: psk ? values.pre_shared_key : '',
   local_cert: psk ? '' : values.local_cert, local_key: psk ? '' : values.local_key, ca_cert: psk ? '' : values.ca_cert, local_identifier: values.local_identifier, remote_identifier: values.remote_identifier,
   crypto_proposal: values.crypto_proposal, tunnel: values.tunnel ?? [], mobike: values.mobike ? '' : '0', encap: values.encap ? '1' : '', dpddelay: values.dpddelay, keyingtries: values.keyingtries
  });
  return row
   ? { description: `Change IPsec peer ${name}`, ops: [{ op: 'set', config: 'ipsec', section: name, values: result }] }
   : { description: `Add IPsec peer ${name}`, ops: [{ op: 'add', config: 'ipsec', type: 'remote', name, values: { ...present(result), enabled: '1' } }] };
 },
 remove: rows => ({ description: `Remove IPsec peer ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'ipsec', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} IPsec peer ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'ipsec', section: row.section, values: { enabled: enable ? '1' : '0' } })) }),
 comment: (rows, comment) => ({ description: `Comment IPsec peer ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'ipsec', section: row.section, values: { comment: comment || null } })) })
};

const peerOf = (data, tunnel) => sections(data['uci:ipsec'], 'remote').find(section => list(section.tunnel).includes(tunnel));

export const ipsecPolicies = {
 id: 'ipsec-policies',
 noun: 'IPsec Policy',
 sources: ['uci:ipsec', 'ipsec'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'peer', label: 'Peer', width: 100 },
  { id: 'local', label: 'Src. Address', width: 170 },
  { id: 'remote', label: 'Dst. Address', width: 170 },
  { id: 'action', label: 'Start', width: 70 },
  { id: 'state', label: 'State', width: 90 }
 ],
 flagLegend: { I: 'no peer uses it', A: 'installed (traffic is protected)' },
 defaultSort: null,
 rows: data => sections(data['uci:ipsec'], 'tunnel').map(section => {
  const name = section['.name'], peer = peerOf(data, name);
  const child = (data.ipsec?.sas ?? []).flatMap(sa => sa.children ?? []).find(item => item.name === name);
  return {
   key: name, section: name, comment: section.comment, flags: (peer ? '' : 'I') + (child?.state === 'INSTALLED' ? 'A' : ''),
   cells: { name, peer: peer?.['.name'] ?? '', local: list(section.local_subnet).join(', '), remote: list(section.remote_subnet).join(', '), action: section.startaction ?? 'route', state: child?.state?.toLowerCase() ?? '' }
  };
 }),
 itemTitle: row => `IPsec Policy <${row?.key ?? 'new'}>`,
 itemStatus: row => [row.cells.peer ? `peer ${row.cells.peer}` : 'no peer', row.cells.state],
 canAdd: () => true,
 canRemove: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'branch_lan' },
  { id: 'peer', label: 'Peer', type: 'select', allowEmpty: true, options: sections(data['uci:ipsec'], 'remote').map(section => ({ value: section['.name'], label: section['.name'] })) },
  { id: 'local_subnet', label: 'Src. Address', type: 'list' },
  { id: 'remote_subnet', label: 'Dst. Address', type: 'list' },
  { id: 'crypto_proposal', label: 'ESP Proposals', type: 'multi', options: proposalOptions(data) },
  { id: 'startaction', label: 'Start', type: 'select', options: [{ value: 'route', label: 'on traffic' }, { value: 'start', label: 'at once' }, { value: 'none', label: 'never (the peer starts)' }] },
  { id: 'closeaction', label: 'When Closed', type: 'select', options: [{ value: 'none', label: 'nothing' }, { value: 'start', label: 'start again' }, { value: 'trap', label: 'wait for traffic' }], tab: 'Advanced' },
  { id: 'dpdaction', label: 'On Dead Peer', type: 'select', options: [{ value: 'none', label: 'nothing' }, { value: 'restart', label: 'restart' }, { value: 'clear', label: 'clear' }, { value: 'trap', label: 'wait for traffic' }], tab: 'Advanced' },
  { id: 'rekeytime', label: 'Rekey Time', type: 'text', placeholder: '1h', tab: 'Advanced' }
 ],
 values(row, data) {
  const section = data['uci:ipsec'][row.section] ?? {};
  return {
   name: row.key, peer: peerOf(data, row.section)?.['.name'] ?? '', local_subnet: list(section.local_subnet), remote_subnet: list(section.remote_subnet), crypto_proposal: list(section.crypto_proposal),
   startaction: section.startaction ?? 'route', closeaction: section.closeaction ?? 'none', dpdaction: section.dpdaction ?? 'none', rekeytime: section.rekeytime ?? ''
  };
 },
 defaults: data => ({ name: '', peer: sections(data['uci:ipsec'], 'remote')[0]?.['.name'] ?? '', local_subnet: [], remote_subnet: [], crypto_proposal: proposalOptions(data).slice(0, 1).map(option => option.value), startaction: 'route', closeaction: 'none', dpdaction: 'restart', rekeytime: '' }),
 save(values, row, data) {
  const name = row ? row.section : String(values.name ?? '').trim();
  if (!row) {
   if (!NAME.test(name)) invalid('name', 'Use letters, digits and _');
   if (data['uci:ipsec']?.[name]) invalid('name', `${name} already exists in /etc/config/ipsec`);
  }
  for (const id of ['local_subnet', 'remote_subnet']) {
   if (!(values[id] ?? []).length) invalid(id, 'Enter at least one network, such as 192.168.1.0/24');
   for (const subnet of values[id]) if (!parseCidr(subnet, { requirePrefix: true }) && !parseCidr6(subnet, { requirePrefix: true })) invalid(id, `${subnet} is not a network`);
  }
  if (!(values.crypto_proposal ?? []).length) invalid('crypto_proposal', 'Choose at least one proposal');
  if (values.rekeytime && !/^\d+[smhd]?$/.test(values.rekeytime)) invalid('rekeytime', 'Such as 1h');
  const result = compact({ local_subnet: values.local_subnet, remote_subnet: values.remote_subnet, crypto_proposal: values.crypto_proposal, startaction: values.startaction, closeaction: values.closeaction, dpdaction: values.dpdaction, rekeytime: values.rekeytime });
  const ops = [row ? { op: 'set', config: 'ipsec', section: name, values: result } : { op: 'add', config: 'ipsec', type: 'tunnel', name, values: present(result) }];
  // A policy belongs to one peer, which lists it.
  for (const peer of sections(data['uci:ipsec'], 'remote')) {
   const tunnels = list(peer.tunnel), has = tunnels.includes(name), wants = peer['.name'] === values.peer;
   if (has !== wants) ops.push({ op: 'set', config: 'ipsec', section: peer['.name'], values: { tunnel: wants ? [...tunnels, name] : tunnels.filter(item => item !== name) } });
  }
  return { description: row ? `Change IPsec policy ${name}` : `Add IPsec policy ${name}`, ops };
 },
 remove: (rows, data) => ({ description: `Remove IPsec policy ${rows.map(row => row.key).join(', ')}`, ops: rows.flatMap(row => [
  { op: 'delete', config: 'ipsec', section: row.section },
  ...sections(data['uci:ipsec'], 'remote').filter(peer => list(peer.tunnel).includes(row.section)).map(peer => ({ op: 'set', config: 'ipsec', section: peer['.name'], values: { tunnel: list(peer.tunnel).filter(item => item !== row.section) } }))
 ]) }),
 comment: (rows, comment) => ({ description: `Comment IPsec policy ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'ipsec', section: row.section, values: { comment: comment || null } })) })
};

export const ipsecProposals = {
 id: 'ipsec-proposals',
 noun: 'IPsec Proposal',
 sources: ['uci:ipsec'],
 columns: [
  { id: 'flags', label: '', width: 26 },
  { id: 'name', label: 'Name', width: 120 },
  { id: 'encryption', label: 'Encryption', width: 140 },
  { id: 'hash', label: 'Hash', width: 80 },
  { id: 'group', label: 'DH Group', width: 100 },
  { id: 'used', label: 'Used By', width: 200 }
 ],
 flagLegend: {},
 defaultSort: null,
 rows: data => sections(data['uci:ipsec'], 'crypto_proposal').map(section => {
  const users = [...sections(data['uci:ipsec'], 'remote'), ...sections(data['uci:ipsec'], 'tunnel')].filter(item => list(item.crypto_proposal).includes(section['.name'])).map(item => item['.name']);
  return { key: section['.name'], section: section['.name'], users, comment: section.comment, cells: { name: section['.name'], encryption: section.encryption_algorithm ?? '', hash: section.hash_algorithm ?? '', group: section.dh_group ?? '', used: users.join(', ') } };
 }),
 itemTitle: row => `IPsec Proposal <${row?.key ?? 'new'}>`,
 canAdd: () => true,
 canRemove: () => true,
 canComment: () => true,
 removeBlocked: rows => rows.find(row => row.users.length) ? `${rows.find(row => row.users.length).key} is used by ${rows.find(row => row.users.length).users.join(', ')}` : null,
 fields: (data, row) => [
  { id: 'name', label: 'Name', type: row ? 'static' : 'text', placeholder: 'aes256_sha256' },
  { id: 'encryption_algorithm', label: 'Encryption', type: 'select', options: options(ENCRYPTION) },
  { id: 'hash_algorithm', label: 'Hash', type: 'select', allowEmpty: true, options: options(HASHES), visible: values => !/gcm|poly1305/.test(values.encryption_algorithm) },
  { id: 'dh_group', label: 'DH Group', type: 'select', allowEmpty: true, options: options(GROUPS) },
  { id: 'prf_algorithm', label: 'PRF', type: 'select', allowEmpty: true, options: options(HASHES.map(value => `prf${value}`)), tab: 'Advanced' }
 ],
 values: (row, data) => {
  const section = data['uci:ipsec'][row.section] ?? {};
  return { name: row.key, encryption_algorithm: section.encryption_algorithm ?? 'aes256', hash_algorithm: section.hash_algorithm ?? '', dh_group: section.dh_group ?? '', prf_algorithm: section.prf_algorithm ?? '' };
 },
 defaults: () => ({ name: '', encryption_algorithm: 'aes256', hash_algorithm: 'sha256', dh_group: 'modp2048', prf_algorithm: '' }),
 save(values, row, data) {
  const name = row ? row.section : String(values.name ?? '').trim();
  if (!row) {
   if (!NAME.test(name)) invalid('name', 'Use letters, digits and _');
   if (data['uci:ipsec']?.[name]) invalid('name', `${name} already exists in /etc/config/ipsec`);
  }
  const aead = /gcm|poly1305/.test(values.encryption_algorithm);
  if (!aead && !values.hash_algorithm) invalid('hash_algorithm', 'Choose a hash; only GCM and ChaCha20 need none');
  const result = compact({ encryption_algorithm: values.encryption_algorithm, hash_algorithm: aead ? '' : values.hash_algorithm, dh_group: values.dh_group, prf_algorithm: values.prf_algorithm });
  return row
   ? { description: `Change IPsec proposal ${name}`, ops: [{ op: 'set', config: 'ipsec', section: name, values: result }] }
   : { description: `Add IPsec proposal ${name}`, ops: [{ op: 'add', config: 'ipsec', type: 'crypto_proposal', name, values: present(result) }] };
 },
 remove: rows => ({ description: `Remove IPsec proposal ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'ipsec', section: row.section })) }),
 comment: (rows, comment) => ({ description: `Comment IPsec proposal ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'ipsec', section: row.section, values: { comment: comment || null } })) })
};

// swanctl --list-sas, as the plugin reports it.
export const ipsecActive = {
 id: 'ipsec-active',
 noun: 'Security Association',
 readOnly: true,
 sources: ['ipsec'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 140 },
  { id: 'state', label: 'State', width: 100 },
  { id: 'local', label: 'Local', width: 160 },
  { id: 'remote', label: 'Remote', width: 160 },
  { id: 'established', label: 'Established', width: 90 },
  { id: 'bytes', label: 'In / Out', width: 140 }
 ],
 flagLegend: { E: 'established', I: 'installed' },
 defaultSort: null,
 rows: data => (data.ipsec?.sas ?? []).flatMap(sa => [
  { key: `ike:${sa.name}:${sa.id}`, readOnly: true, flags: sa.state === 'ESTABLISHED' ? 'E' : '', cells: { name: sa.name, state: sa.state?.toLowerCase() ?? '', local: sa.local ?? '', remote: sa.remote ?? '', established: Number.isFinite(sa.established) ? uptime(sa.established) : '', bytes: '' } },
  ...(sa.children ?? []).map(child => ({ key: `child:${sa.name}:${child.name}:${child.id}`, readOnly: true, flags: child.state === 'INSTALLED' ? 'I' : '', cells: { name: `  ${child.name}`, state: child.state?.toLowerCase() ?? '', local: child.local ?? '', remote: child.remote ?? '', established: '', bytes: `${bytes(child.in ?? 0)} / ${bytes(child.out ?? 0)}` } }))
 ]),
 itemTitle: row => `SA <${row.cells.name.trim()}>`,
 fields: () => ['name', 'state', 'local', 'remote', 'established', 'bytes'].map(id => ({ id, label: ipsecActive.columns.find(column => column.id === id).label, type: 'static' })),
 values: row => ({ ...row.cells })
};
