// SPDX-License-Identifier: Apache-2.0
// IP > ARP and IPv6 > Neighbors from the kernel's neighbour table, and
// IP > Services: the web server, SSH and the web terminal with their ports.
import { sections, list, truthy, invalid, compact, networkOptions } from './common.js';
import { addressKey } from '../lib/ip.js';

const COMPLETE = ['REACHABLE', 'STALE', 'DELAY', 'PROBE', 'PERMANENT', 'NOARP'];
const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,62})$/;

function neighborModel({ id, family, title }) {
 return {
  id,
  noun: 'Neighbor',
  readOnly: family === 6,
  sources: ['neighbors', 'leases', 'uci:dhcp', 'uci:network', 'ifaces'],
  columns: [
   { id: 'flags', label: '', width: 34 },
   { id: 'address', label: 'Address', width: family === 6 ? 230 : 120, sort: addressKey },
   { id: 'mac', label: 'MAC Address', width: 130 },
   { id: 'interface', label: 'Interface', width: 110 },
   { id: 'state', label: 'State', width: 90 },
   { id: 'host', label: 'Host Name', width: 120 }
  ],
  flagLegend: family === 6 ? { D: 'dynamic', C: 'complete', I: 'invalid', R: 'router' } : { D: 'dynamic', C: 'complete', I: 'invalid', S: 'static DHCP lease' },
  defaultSort: 'address',
  note: `${title} comes from the kernel; Make Static reserves the address with a DHCP static lease.`,
  rows(data) {
   const names = new Map();
   for (const lease of [...(data.leases?.dhcp_leases ?? []), ...(data.leases?.dhcp6_leases ?? [])]) if (lease.hostname) names.set((lease.macaddr ?? '').toLowerCase(), lease.hostname);
   const hosts = sections(data['uci:dhcp'], 'host');
   const networks = new Map((data.ifaces ?? []).map(item => [item.l3_device, item.interface]));
   return (data.neighbors?.neighbors ?? []).filter(item => item.family === family).map(item => {
    const mac = (item.mac ?? '').toLowerCase();
    const host = hosts.find(entry => list(entry.mac).map(value => value.toLowerCase()).includes(mac));
    const complete = !!mac && COMPLETE.includes(item.state), invalid = item.state === 'FAILED' || item.state === 'INCOMPLETE';
    return {
     key: `${item.dev}:${item.address}`, readOnly: true, dynamic: true, neighbor: item, staticHost: !!host,
     flags: 'D' + (complete ? 'C' : '') + (invalid ? 'I' : '') + (item.router ? 'R' : '') + (host ? 'S' : ''),
     tone: invalid ? 'error' : undefined,
     cells: { address: item.address, mac: mac.toUpperCase(), interface: networks.has(item.dev) ? `${item.dev} (${networks.get(item.dev)})` : item.dev, state: item.state.toLowerCase(), host: host?.name ?? names.get(mac) ?? '' }
    };
   });
  },
  itemTitle: row => `${title} <${row.cells.address}>`,
  itemStatus: row => [row.cells.state],
  fields: () => ['address', 'mac', 'interface', 'state', 'host'].map(column => ({ id: column, label: { address: 'Address', mac: 'MAC Address', interface: 'Interface', state: 'State', host: 'Host Name' }[column], type: 'static' })),
  values: row => ({ ...row.cells }),
  tools: family === 4 ? [{
   id: 'make-static', label: 'Make Static', enabled: rows => rows.length > 0 && rows.every(row => row.neighbor.mac && !row.staticHost),
   run: (rows, data) => {
    const hosts = sections(data['uci:dhcp'], 'host');
    return {
     description: `Make static ${rows.map(row => row.cells.address).join(', ')}`,
     ops: rows.map(row => {
      const name = HOSTNAME.test(row.cells.host) && !hosts.some(host => host.name === row.cells.host) ? row.cells.host : '';
      return { op: 'add', config: 'dhcp', type: 'host', values: compact({ name, mac: row.neighbor.mac.toLowerCase(), ip: row.cells.address, dns: name ? '1' : '' }) };
     })
    };
   }
  }] : []
 };
}

export const arp = neighborModel({ id: 'ip-arp', family: 4, title: 'ARP' });
export const neighbors6 = neighborModel({ id: 'ipv6-neighbors', family: 6, title: 'Neighbor' });

/* --- IP > Services ----------------------------------------------------- */

const portOf = entries => {
 const match = /:(\d+)$/.exec(list(entries)[0] ?? '');
 return match ? match[1] : '';
};
const withPort = (entries, port) => list(entries).map(entry => entry.replace(/:\d+$/, `:${port}`));
const validPort = port => /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;

export const ipServices = {
 id: 'ip-services',
 noun: 'Service',
 sources: ['uci:uhttpd', 'uci:dropbear', 'uci:ttyd', 'uci:network'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 80 },
  { id: 'port', label: 'Port', width: 60, align: 'right', sort: value => Number(value) || 0 },
  { id: 'from', label: 'Available From', width: 220 },
  { id: 'notes', label: 'Notes', width: 220 }
 ],
 flagLegend: { X: 'disabled' },
 defaultSort: null,
 note: 'A new web port or address moves this console; turn on Safe Mode first.',
 rows(data) {
  const rows = [];
  for (const section of sections(data['uci:uhttpd'], 'uhttpd')) {
   const http = list(section.listen_http), https = list(section.listen_https);
   rows.push({ key: `www:${section['.name']}`, kind: 'www', section: section['.name'], flags: http.length ? '' : 'X', disabled: !http.length,
    cells: { name: 'www', port: portOf(http), from: http.map(entry => entry.replace(/:\d+$/, '')).join(', '), notes: truthy(section.rfc1918_filter, true) ? 'RFC 1918 filter' : '' } });
   rows.push({ key: `www-ssl:${section['.name']}`, kind: 'www-ssl', section: section['.name'], flags: https.length ? '' : 'X', disabled: !https.length,
    cells: { name: 'www-ssl', port: portOf(https), from: https.map(entry => entry.replace(/:\d+$/, '')).join(', '), notes: truthy(section.redirect_https) ? 'HTTP redirects here' : '' } });
  }
  for (const section of sections(data['uci:dropbear'], 'dropbear')) {
   const disabled = !truthy(section.enable, true);
   rows.push({ key: `ssh:${section['.name']}`, kind: 'ssh', section: section['.name'], disabled, flags: disabled ? 'X' : '',
    cells: { name: 'ssh', port: section.Port ?? '22', from: section.Interface ?? 'all networks', notes: section.PasswordAuth === 'off' ? 'keys only' : section.RootPasswordAuth === 'off' ? 'no root password' : 'passwords allowed' } });
  }
  for (const section of sections(data['uci:ttyd'], 'ttyd')) {
   rows.push({ key: `ttyd:${section['.name']}`, kind: 'ttyd', section: section['.name'], flags: '',
    cells: { name: 'ttyd', port: section.port ?? '7681', from: section.interface ? section.interface.replace(/^@/, '') : 'all networks', notes: truthy(section.ssl) ? 'TLS' : 'New Shell' } });
  }
  return rows;
 },
 itemTitle: row => `Service <${row.cells.name}>`,
 itemStatus: row => [row.disabled ? 'disabled' : 'enabled'],
 canToggle: row => row.kind === 'ssh',
 toggleHint: 'Only SSH can be switched off here; the web server serves this console',
 fields(data, row) {
  const networks = [{ value: '', label: 'all networks' }, ...networkOptions(data['uci:network'], section => section['.name'] !== 'loopback')];
  const fields = [{ id: 'name', label: 'Name', type: 'static' }, { id: 'port', label: 'Port', type: 'number' }];
  if (row.kind === 'www') fields.push({ id: 'rfc1918', label: 'RFC 1918 Filter', type: 'bool' });
  if (row.kind === 'www-ssl') fields.push({ id: 'redirect', label: 'Redirect HTTP to HTTPS', type: 'bool' });
  if (row.kind === 'ssh') fields.push(
   { id: 'interface', label: 'Available From', type: 'select', options: networks },
   { id: 'password', label: 'Password Login', type: 'bool' },
   { id: 'root', label: 'Root Password Login', type: 'bool' }
  );
  if (row.kind === 'ttyd') fields.push({ id: 'interface', label: 'Available From', type: 'select', options: networks });
  return fields;
 },
 values(row, data) {
  const config = { www: 'uci:uhttpd', 'www-ssl': 'uci:uhttpd', ssh: 'uci:dropbear', ttyd: 'uci:ttyd' }[row.kind];
  const section = Object.values(data[config] ?? {}).find(item => item['.name'] === row.section) ?? {};
  return {
   name: row.cells.name, port: row.cells.port, rfc1918: truthy(section.rfc1918_filter, true), redirect: truthy(section.redirect_https),
   interface: row.kind === 'ssh' ? section.Interface ?? '' : (section.interface ?? '').replace(/^@/, ''), password: section.PasswordAuth !== 'off', root: section.RootPasswordAuth !== 'off'
  };
 },
 save(values, row, data, { dirty = null } = {}) {
  const changed = id => !dirty || dirty.has(id);
  if (changed('port') && !validPort(values.port)) invalid('port', 'A port is 1 to 65535');
  const section = row.section, description = `Change service ${row.cells.name}`;
  if (row.kind === 'www' || row.kind === 'www-ssl') {
   const option = row.kind === 'www' ? 'listen_http' : 'listen_https';
   const current = data['uci:uhttpd'][section]?.[option];
   const changes = {};
   if (changed('port')) changes[option] = list(current).length ? withPort(current, values.port) : [`0.0.0.0:${values.port}`, `[::]:${values.port}`];
   if (row.kind === 'www' && changed('rfc1918')) changes.rfc1918_filter = values.rfc1918 ? '1' : '0';
   if (row.kind === 'www-ssl' && changed('redirect')) changes.redirect_https = values.redirect ? '1' : '0';
   return Object.keys(changes).length ? { description, ops: [{ op: 'set', config: 'uhttpd', section, values: changes }] } : null;
  }
  if (row.kind === 'ssh') {
   const changes = {};
   if (changed('port')) changes.Port = values.port;
   if (changed('interface')) changes.Interface = values.interface || null;
   if (changed('password')) changes.PasswordAuth = values.password ? 'on' : 'off';
   if (changed('root')) changes.RootPasswordAuth = values.root ? 'on' : 'off';
   return Object.keys(changes).length ? { description, ops: [{ op: 'set', config: 'dropbear', section, values: changes }] } : null;
  }
  const changes = {};
  if (changed('port')) changes.port = values.port;
  if (changed('interface')) changes.interface = values.interface ? `@${values.interface}` : null;
  return Object.keys(changes).length ? { description, ops: [{ op: 'set', config: 'ttyd', section, values: changes }] } : null;
 },
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} SSH`, ops: rows.map(row => ({ op: 'set', config: 'dropbear', section: row.section, values: { enable: enable ? '1' : '0' } })) })
};
