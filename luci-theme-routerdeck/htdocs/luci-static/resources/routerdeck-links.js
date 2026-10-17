/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require baseclass';
'require ui';
'require rpc';

const callNetworks = rpc.declare({ object: 'network.interface', method: 'dump', expect: { interface: [] } });
const callDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });
const callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
// Read snapshots instead of loading another view's mutable UCI model.
const callConfig = rpc.declare({ object: 'uci', method: 'get', params: ['config'], expect: { values: {} } });
const pages = {
 interfaces: ['admin/network/network'], devices: ['admin/network/network'],
 routes: ['admin/status/routesj', 'admin/status/routes'], routing: ['admin/network/routes'],
 firewall: ['admin/network/firewall/zones', 'admin/network/firewall'],
 rules: ['admin/network/firewall/rules'], forwards: ['admin/network/firewall/forwards'],
 firewallStatus: ['admin/status/nftables', 'admin/status/iptables'],
 dhcp: ['admin/network/dhcp'], dns: ['admin/network/dns', 'admin/network/dhcp'],
 diagnostics: ['admin/network/diagnostics'], wireless: ['admin/network/wireless'],
 overview: ['admin/status/overview'], dashboard: ['admin/status/dashboard'],
 system: ['admin/system/system'], processes: ['admin/status/processes'], logs: ['admin/status/logs', 'admin/status/syslog'],
 load: ['admin/status/realtime/load'], bandwidth: ['admin/status/realtime/bandwidth'],
 connections: ['admin/status/realtime/connections'], vpn: ['admin/status/wireguard']
};
const labels = { interfaces: 'Interfaces', devices: 'Devices', routes: 'Active routes', routing: 'Static routes & rules', firewall: 'Firewall zones', rules: 'Traffic rules', forwards: 'Port forwards', firewallStatus: 'Active firewall', dhcp: 'DHCP leases & reservations', dns: 'DNS settings', diagnostics: 'Diagnostics', wireless: 'Wireless', overview: 'System overview', dashboard: 'Dashboard', system: 'System settings', processes: 'Processes', logs: 'System log', load: 'Load graphs', bandwidth: 'Traffic graphs', connections: 'Connections', vpn: 'WireGuard status' };
const kinds = { interface: 'interfaces', device: 'devices', zone: 'firewall', lease: 'dhcp', diagnostic: 'diagnostics', section: 'interfaces' };
const list = value => Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []);
const sections = (config, type) => Object.entries(config || {}).filter(([, value]) => value['.type'] === type).map(([id, value]) => ({ ...value, '.name': id }));
const text = node => Array.from(node.childNodes).filter(child => child.nodeType === 3).map(child => child.textContent).join('').trim().replace(/:\s*$/, '');
const blocked = node => node.closest('a, button, select, .cbi-dropdown, .cbi-dynlist, .cbi-tooltip, [data-rd-linked]');

return baseclass.extend({
 parseTarget: function (hash) {
  const match = /^#rd:(interface|device|zone|lease|diagnostic|section):(.+)$/.exec(hash || '');
  if (!match) return null;
  try {
   const name = decodeURIComponent(match[2]);
   if (!name || name.length > 128 || /[\x00-\x1f\x7f]/.test(name)) return null;
   return { kind: match[1], name };
  } catch (_) { return null; }
 },
 hash: function (kind, name) { return Object.hasOwn(kinds, kind) ? '#rd:' + kind + ':' + encodeURIComponent(name) : ''; },
 address: function (value) {
  // Only literal host addresses, never a network prefix or command-line option.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return value.split('.').every(part => Number(part) <= 255);
  if (!/^[\da-f:]+(?:%[\w.-]+)?$/i.test(value) || !value.includes(':')) return false;
  try { new URL('http://[' + value.split('%')[0] + ']/'); return true; } catch (_) { return false; }
 },
 endpointAddress: function (value) {
  if (this.address(value)) return value;
  const match = /^\[([^\]]+)\](?::[\w-]+)?$/.exec(value) || /^(\d{1,3}(?:\.\d{1,3}){3}):[\w-]+$/.exec(value);
  return match && this.address(match[1]) ? match[1] : null;
 },
 init: async function (tree) {
  if (this.started) return;
  this.started = true;
  this.current = L.env.dispatchpath.join('/');
  this.root = document.getElementById('maincontent');
  if (!this.root) return;
  this.paths = this.pagePaths(tree);
  this.related();
  const read = promise => L.resolveDefault(promise, {});
  const [nets, devices, leases, networkConfig, firewallConfig, dhcpConfig] = await Promise.all([
   L.resolveDefault(callNetworks(), []), read(callDevices()), read(callLeases()),
   this.paths.interfaces ? read(callConfig('network')) : {},
   this.paths.firewall ? read(callConfig('firewall')) : {},
   this.paths.dhcp ? read(callConfig('dhcp')) : {}
  ]);
  this.nets = nets; this.devices = devices; this.leases = [...(leases.dhcp_leases || []), ...(leases.dhcp6_leases || [])];
  this.config = { network: networkConfig, firewall: firewallConfig, dhcp: dhcpConfig };
  RouterDeck.links = this;
  this.observer = new MutationObserver(() => this.schedule());
  window.addEventListener('hashchange', () => { if (this.handled !== this.requestedHash()) this.schedule(); });
  this.scan();
  // An unavailable or removed destination must not silently open a different object.
  this.targetTimer = setTimeout(() => {
   if (this.parseTarget(this.requestedHash()) && this.handled !== this.requestedHash()) this.unavailable();
  }, 12000);
 },
 pagePaths: function (tree) {
  const allowed = new Set();
  const walk = (node, path) => ui.menu.getChildren(node).forEach(child => {
   const next = path.concat(child.name); allowed.add(next.join('/'));
   // getChildren checks dependencies/ACLs and resolves aliases. Retain the
   // original children when descending into an alias such as Firewall.
   walk(node.children?.[child.name] || child, next);
  });
  walk(tree, []);
  return Object.fromEntries(Object.entries(pages).map(([key, paths]) => [key, paths.find(path => allowed.has(path))]));
 },
 requestedHash: function () {
  const target = new URL(location.href).searchParams.get('rd');
  if (target == null) return location.hash;
  const separator = target.indexOf(':');
  return separator < 0 ? '' : this.hash(target.slice(0, separator), target.slice(separator + 1));
 },
 url: function (page, kind, name) {
  const path = this.paths?.[page];
  return path ? L.url(...path.split('/')) + (kind ? '?rd=' + encodeURIComponent(kind + ':' + name) : '') : null;
 },
 addressValue: function (address, label) {
  return this.address(address) ? this.link('diagnostics', label || address, 'diagnostic', address) || label || address : label || address;
 },
 targetUrl: function (kind, name) { return this.url(kinds[kind], kind, name); },
 activate: function (event, href) {
  event.stopPropagation();
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (RouterDeck.windows?.open(href, { trigger: event.currentTarget })) { event.preventDefault(); return; }
  ui.hideModal();
  const url = new URL(href, location.href);
  if (url.pathname === location.pathname && url.search === location.search && url.hash === location.hash && this.parseTarget(this.requestedHash())) {
   event.preventDefault(); this.handled = null; this.schedule();
  }
 },
 link: function (page, label, kind, name) {
  const href = this.url(page, kind, name);
  return href ? E('a', { href, class: 'rd-context-link', click: event => this.activate(event, href) }, label || _(labels[page])) : null;
 },
 related: function () {
  const path = this.current;
  let keys;
  if (/network\/firewall|status\/(nftables|iptables)/.test(path)) keys = ['firewall', 'rules', 'forwards', 'firewallStatus', 'interfaces', 'connections', 'logs'];
  else if (/network\/(dhcp|dns)/.test(path)) keys = ['dhcp', 'dns', 'interfaces', 'diagnostics', 'routes'];
  else if (/network\/wireless|status\/(wireless|channel_analysis)/.test(path)) keys = ['wireless', 'interfaces', 'dhcp', 'bandwidth', 'logs'];
  else if (/network|status\/(routes|wireguard|realtime)/.test(path)) keys = ['interfaces', 'devices', 'routes', 'routing', 'firewall', 'dhcp', 'diagnostics'];
  else if (/status\/(dashboard|overview)/.test(path)) keys = ['interfaces', 'dhcp', 'routes', 'firewall', 'diagnostics', 'logs'];
  else if (/system|status\/(processes|logs|syslog)/.test(path)) keys = ['system', 'overview', 'processes', 'load', 'logs'];
  else return;
  const links = keys.filter(key => this.paths[key] && (this.paths[key] !== path || key === 'devices')).map(key => this.link(key, null, key === 'devices' ? 'section' : null, 'device'));
  if (links.length) this.root.prepend(E('nav', { class: 'rd-related', 'aria-label': _('Related pages') }, [E('span', {}, _('Related')), ...links]));
 },
 schedule: function () {
  if (this.scheduled) return;
  this.scheduled = setTimeout(() => { this.scheduled = null; this.scan(); }, 80);
 },
 scan: function () {
  this.observer.disconnect();
  try {
   this.enhance();
   this.openTarget();
  } finally { this.observer.observe(document.body, { childList: true, subtree: true }); }
 },
 entity: function (node, kind, name) {
  if (!name || blocked(node)) return;
  const href = this.targetUrl(kind, name);
  if (!href) return;
  const link = E('a', { href, class: 'rd-entity-link', title: _('Open settings') + ': ' + name, click: event => {
   if (kind === 'interface' && name === 'loopback' && !event.button && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); this.showEntity(kind, name); }
   else this.activate(event, href);
  } }, []);
  if (kind === 'interface' && name === 'loopback') link.setAttribute('data-rd-page-navigation', '');
  link.append(...node.childNodes); node.append(link); node.dataset.rdLinked = 'true';
  if (kind === 'interface' || kind === 'device') node.append(this.detailsButton(_('Details') + ': ' + name, () => this.showEntity(kind, name)));
 },
 detailsButton: function (label, handler, caption) {
  return E('button', { type: 'button', class: caption ? 'rd-text-action' : 'rd-detail-button', 'aria-label': label, title: label, click: event => { event.preventDefault(); event.stopPropagation(); handler(); } }, caption || 'ⓘ');
 },
 enhance: function () {
  // Only stable LuCI widgets and explicit RouterDeck markers; never parse arbitrary app text.
  const surface = document.body;
  surface.querySelectorAll('.ifacebadge').forEach(node => {
   if (blocked(node)) return;
   let name = text(node), physical = /^\(.+\)$/.test(name);
   if (physical) name = name.slice(1, -1);
   if (!physical && this.nets.some(net => net.interface === name)) this.entity(node, 'interface', name);
   else if (Object.hasOwn(this.devices, name)) this.entity(node, 'device', name);
  });
  surface.querySelectorAll('.ifacebadge > span:last-child, .ifacebox-body > small').forEach(node => {
   const name = node.textContent.trim();
   if (!node.children.length && Object.hasOwn(this.devices, name)) this.entity(node, 'device', name);
  });
  // Read-only status inside the native interface editor, including its modal.
  // Dropdown choices and other editable widgets remain native controls.
  surface.querySelectorAll('.ifacebadge.large .nowrap:not([data-rd-linked])').forEach(node => {
   if (blocked(node)) return;
   const value = text(node), ip = value.split('/')[0];
   if (!Object.hasOwn(this.devices, value) && !this.address(ip)) return;
   const valueNode = E('span', {}, value);
   Array.from(node.childNodes).filter(child => child.nodeType === 3).forEach(child => child.remove());
   node.append(valueNode);
   if (Object.hasOwn(this.devices, value)) this.entity(valueNode, 'device', value);
   else valueNode.replaceChildren(this.detailsButton(_('Address details') + ': ' + ip, () => this.showAddress(ip), value));
   node.dataset.rdLinked = 'true';
  });
  surface.querySelectorAll('.zonebadge > strong').forEach(node => {
   if (sections(this.config.firewall, 'zone').some(zone => zone.name === node.textContent.trim())) this.entity(node, 'zone', node.textContent.trim());
  });
  this.root.querySelectorAll('[data-rd-entity]').forEach(node => this.entity(node, node.dataset.rdEntity, node.dataset.rdName));
  this.root.querySelectorAll('[data-rd-page]:not([data-rd-linked])').forEach(node => {
   const href = this.url(node.dataset.rdPage);
   if (href) { const link = E('a', { href, class: 'rd-entity-link' }); link.append(...node.childNodes); node.append(link); }
   node.dataset.rdLinked = 'true';
  });
  if (/admin\/status\/routesj?$/.test(this.current)) this.enhanceRoutes();
  this.root.querySelectorAll('#connections tr').forEach(row => {
   const cells = Array.from(row.querySelectorAll(':scope > td'));
   [cells[2], cells[3]].filter(Boolean).forEach(node => {
    const label = node.textContent.trim(), address = this.endpointAddress(label);
    if (address && !node.children.length) node.replaceChildren(this.detailsButton(_('Address details') + ': ' + address, () => this.showAddress(address), label));
   });
  });
  this.root.querySelectorAll('#status_leases td, #status_leases6 td, [data-rd-address]').forEach(node => this.addressLink(node));
  this.root.querySelectorAll('#status_leases tr, #status_leases6 tr').forEach(row => {
   if (row.dataset.rdDetails || !row.querySelector('td')) return;
   const cells = Array.from(row.querySelectorAll('td'));
   const values = cells.map(cell => cell.textContent.trim().toLowerCase());
   const lease = this.leases.find(lease => list(lease.ip6addrs).concat(lease.ipaddr || lease.ip6addr || [], lease.macaddr || [], lease.duid || []).some(value => values.includes(value.toLowerCase())));
   if (lease) {
    let linked = false;
    cells.forEach(cell => {
     const label = cell.textContent.trim();
     if (!cell.children.length && [lease.hostname, lease.macaddr, lease.duid].filter(Boolean).some(value => value.toLowerCase() === label.toLowerCase())) {
      cell.replaceChildren(this.detailsButton(_('Client details') + ': ' + label, () => this.showClient(lease), label)); linked = true;
     }
    });
    if (!linked) cells[0].append(this.detailsButton(_('Client details'), () => this.showClient(lease)));
    row.dataset.rdDetails = 'true';
   }
  });
  this.root.querySelectorAll('[data-rd-client]:not([data-rd-linked])').forEach(node => {
   const value = node.dataset.rdClient;
   const lease = this.leases.find(item => item.macaddr === value || item.duid === value || item.ipaddr === value || item.ip6addr === value);
   if (lease) { const label = node.textContent; node.replaceChildren(this.detailsButton(_('Client details') + ': ' + label, () => this.showClient(lease), label)); }
   node.dataset.rdLinked = 'true';
  });
  this.root.querySelectorAll('.ifacebox-head > strong').forEach(node => {
   if (!node.querySelector('button')) this.entity(node, 'interface', node.textContent.trim());
  });
 },
 addressLink: function (node) {
  const label = node.textContent.trim();
  const address = node.hasAttribute('data-rd-address') ? label.split('/')[0] : label;
  if (node.children.length || !this.address(address) || blocked(node)) return;
  node.replaceChildren(this.detailsButton(_('Address details') + ': ' + address, () => this.showAddress(address), label));
 },
 enhanceRoutes: function () {
  this.root.querySelectorAll('.cbi-section table').forEach(table => {
   const headers = Array.from(table.querySelectorAll('th')).map(node => node.textContent.trim());
   table.querySelectorAll('tr').forEach(row => {
    const cells = Array.from(row.querySelectorAll(':scope > td'));
    if (row.dataset.rdDetails || cells.length !== headers.length || !cells.length) return;
    const values = cells.map(cell => cell.textContent.replace(/ⓘ/g, '').trim());
    const raw = cells[0].querySelector('[data-tooltip]')?.getAttribute('data-tooltip');
    const button = this.detailsButton(_('Entry details'), () => this.showEntry(headers, values, raw), _('Details'));
    button.classList.add('rd-entry-details');
    if (values[0] === '#') { button.classList.add('rd-entry-standalone'); cells[0].replaceChildren(button); }
    else cells[cells.length - 1].append(button);
    cells.forEach(cell => {
     this.addressLink(cell);
     // Route prefixes and neighbour MACs are objects too, not dead table text.
     if (!cell.children.length && (/^[\da-f:.]+\/\d+$/i.test(cell.textContent.trim()) || /^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(cell.textContent.trim())))
      cell.replaceChildren(this.detailsButton(_('Entry details'), () => this.showEntry(headers, values, raw), cell.textContent.trim()));
    });
    row.dataset.rdDetails = 'true';
   });
  });
 },
 modal: function (title, entries, actions, note) {
  const focus = document.activeElement;
  const close = () => { ui.hideModal(); if (focus?.isConnected) focus.focus(); };
  const body = E('div', { class: 'rd-details' }, [
   E('dl', {}, entries.filter(([, value]) => value != null && value !== '').map(([key, value]) => [E('dt', {}, _(key)), E('dd', {}, value instanceof Node ? value : String(value))]).flat()),
   note ? E('p', { class: 'rd-muted' }, note) : E([]),
   E('div', { class: 'rd-detail-actions' }, actions.filter(Boolean))
  ]);
  if (RouterDeck.windows) return RouterDeck.windows.content(title, body, title + ':' + entries.map(([key, value]) => key + '=' + (value instanceof Node ? value.textContent : value)).join('|'), focus);
  body.append(E('div', { class: 'right' }, E('button', { type: 'button', class: 'btn', click: close }, _('Close'))));
  ui.showModal(title, body);
 },
 showEntity: function (kind, name) {
  const net = this.nets.find(item => item.interface === name), deviceName = kind === 'interface' ? net?.l3_device || net?.device : name;
  const device = this.devices[deviceName] || {};
  const zones = sections(this.config.firewall, 'zone').filter(zone => list(zone.network).includes(name));
  const addresses = net ? [...(net['ipv4-address'] || []), ...(net['ipv6-address'] || [])].map(ip => ip.address + '/' + ip.mask).join(', ') : null;
  const gateway = net?.route?.filter(route => (route.target === '0.0.0.0' || route.target === '::') && route.mask === 0).map(route => route.nexthop).filter(Boolean).join(', ');
  const associated = this.nets.filter(item => (item.l3_device || item.device) === deviceName);
  this.modal((kind === 'interface' ? _('Interface') : _('Device')) + ' · ' + name, [
   ['Name', name], ['State', (kind === 'interface' ? net?.up : device.up) == null ? null : (kind === 'interface' ? net.up : device.up) ? _('Up') : _('Down')],
   ['Protocol', net?.proto], ['Device', deviceName && deviceName !== 'lo' ? this.link('devices', deviceName, 'device', deviceName) || deviceName : deviceName],
   ['Addresses', addresses ? E('span', {}, addresses.split(', ').map((ip, index) => [index ? ', ' : '', this.addressValue(ip.split('/')[0], ip)]).flat()) : null],
   ['Gateway', gateway ? E('span', {}, gateway.split(', ').map((ip, index) => [index ? ', ' : '', this.addressValue(ip)]).flat()) : null],
   ['DNS servers', net?.['dns-server']?.length ? E('span', {}, list(net['dns-server']).map((ip, index) => [index ? ', ' : '', this.addressValue(ip)]).flat()) : null],
   ['Uptime', net?.uptime == null ? null : RouterDeck.uptime(net.uptime)], ['MAC address', device.mac || device.macaddr], ['MTU', device.mtu], ['Device type', device.devtype],
   ['Link speed', device.link?.speed > 0 ? device.link.speed + ' Mbit/s' : null], ['Duplex', device.link?.duplex !== 'unknown' ? device.link?.duplex : null],
   ['Device addresses', kind === 'device' ? [...(device.ipaddrs || []), ...(device.ip6addrs || [])].map(ip => ip.address).join(', ') : null],
   ['Received', device.stats?.rx_bytes == null ? null : RouterDeck.bytes(device.stats.rx_bytes)], ['Sent', device.stats?.tx_bytes == null ? null : RouterDeck.bytes(device.stats.tx_bytes)],
   ['Packets received', device.stats?.rx_packets], ['Packets sent', device.stats?.tx_packets],
   ['Receive errors', device.stats?.rx_errors], ['Transmit errors', device.stats?.tx_errors], ['Receive drops', device.stats?.rx_dropped], ['Transmit drops', device.stats?.tx_dropped], ['Firewall zones', zones.map(zone => zone.name).join(', ')]
  ], [
   name !== 'loopback' && name !== 'lo' ? this.link(kinds[kind], _('Configure') + ' ' + name, kind, name) : null,
   kind === 'interface' && deviceName && deviceName !== 'lo' ? this.link('devices', _('Device') + ' ' + deviceName, 'device', deviceName) : null,
   ...zones.map(zone => this.link('firewall', _('Zone') + ' ' + zone.name, 'zone', zone.name)),
   ...(kind === 'device' ? associated.filter(item => item.interface !== 'loopback').map(item => this.link('interfaces', _('Interface') + ' ' + item.interface, 'interface', item.interface)) : []),
   this.link('routes'), this.link('routing'), this.link('dhcp'), this.link('diagnostics')
  ], name === 'loopback' ? _('Loopback is managed by the system and is not exposed in the LuCI interface editor.') : _('Runtime snapshot from this page load. Refresh the page for current counters.'));
 },
 showClient: function (lease) {
  const ips = list(lease.ip6addrs).concat(lease.ipaddr || lease.ip6addr || []);
  const reservations = sections(this.config.dhcp, 'host').filter(host =>
   (lease.macaddr && list(host.mac).some(mac => mac.toLowerCase() === lease.macaddr.toLowerCase())) ||
   (lease.duid && host.duid?.toLowerCase() === lease.duid.toLowerCase()));
  this.modal(_('DHCP client') + ' · ' + (lease.hostname || ips[0] || lease.macaddr || lease.duid), [
   ['Hostname', lease.hostname], ['Addresses', ips.join(', ')], ['MAC address', lease.macaddr], ['DUID', lease.duid], ['Interface', lease.interface],
   ['Lease remaining at page load', lease.expires === false ? _('Unlimited') : Number.isFinite(lease.expires) ? RouterDeck.uptime(lease.expires) : null],
   ['Static reservation', reservations.length ? reservations.map(host => host.name || host.ip || host['.name']).join(', ') : _('No matching reservation available')]
  ], [
   ...reservations.map(host => this.link('dhcp', _('Edit reservation') + ' · ' + (host.name || host.ip || host['.name']), 'lease', host['.name'])),
   ...ips.filter(ip => this.address(ip)).map(ip => this.link('diagnostics', _('Diagnose') + ' ' + ip, 'diagnostic', ip)),
   lease.interface && this.nets.some(net => net.interface === lease.interface) ? this.link('interfaces', _('Configure interface'), 'interface', lease.interface) : null,
   this.link('dhcp'), this.link('dns')
  ], _('A DHCP lease does not establish that a device is currently online.'));
 },
 showAddress: function (address) {
  const lease = this.leases.find(item => list(item.ip6addrs).concat(item.ipaddr || item.ip6addr || []).includes(address));
  if (lease) return this.showClient(lease);
  const nets = this.nets.filter(net => [...(net['ipv4-address'] || []), ...(net['ipv6-address'] || [])].some(ip => ip.address === address));
  this.modal(_('IP address') + ' · ' + address, [['Address', address], ['Local interfaces', nets.map(net => net.interface).join(', ')]], [
   this.link('diagnostics', _('Diagnose') + ' ' + address, 'diagnostic', address),
   ...nets.map(net => this.link('interfaces', _('Interface') + ' ' + net.interface, 'interface', net.interface)), this.link('routes'), this.link('dhcp')
  ], _('Diagnostics opens with this address filled in. Choose a command there to run it.'));
 },
 showEntry: function (headers, values, raw) {
  const names = values.map(value => value.replace(/^\(|\)$/g, ''));
  const actions = [];
  names.forEach(name => {
   if (this.nets.some(net => net.interface === name)) actions.push(this.link('interfaces', _('Interface') + ' ' + name, 'interface', name));
   else if (Object.hasOwn(this.devices, name)) actions.push(this.link('devices', _('Device') + ' ' + name, 'device', name));
   if (this.address(name)) actions.push(this.link('diagnostics', _('Diagnose') + ' ' + name, 'diagnostic', name));
  });
  const entries = headers.map((header, index) => [header, values[index]]);
  if (raw) { try { const value = JSON.parse(raw); if (value && typeof value === 'object') entries.push([_('Kernel details'), E('pre', {}, JSON.stringify(value, null, 2))]); } catch (_) {} }
  this.modal(_('Routing entry'), entries, [...actions, this.link('routing'), this.link('firewall')], _('This is runtime state. Connected and dynamically learned routes are configured through their interface or routing service.'));
 },
 reveal: function (node) {
  const panes = []; let parent = node;
  while (parent && parent !== this.root) { if (parent.hasAttribute('data-tab') && !parent.matches('li')) panes.unshift(parent); parent = parent.parentElement; }
  panes.forEach(pane => {
   const menu = pane.parentElement?.previousElementSibling;
   if (!menu?.classList.contains('cbi-tabmenu')) return;
   Array.from(menu.children).find(item => item.dataset.tab === pane.dataset.tab)?.querySelector('a')?.click();
  });
  node.classList.add('rd-target');
  node.scrollIntoView({ block: 'center' });
 },
 openTarget: function () {
  const target = this.parseTarget(this.requestedHash());
  if (!target || this.handled === this.requestedHash()) return;
  const expected = this.paths[kinds[target.kind]];
  if (!expected || this.current !== expected) return;
  // A hash change must not replace an already open edit form.
  if (document.body.classList.contains('modal-overlay-active')) return;
  if (target.kind === 'diagnostic') {
   const inputs = Array.from(this.root.querySelectorAll('.diag-action')).map(node => node.previousElementSibling).filter(node => node?.matches('input[type="text"]'));
   if (!inputs.length) return;
   if (!this.address(target.name)) return this.unavailable();
   inputs.forEach(input => { input.value = target.name; });
   this.handled = this.requestedHash(); inputs[0].focus();
   return;
  }
  if (target.kind === 'section') {
   if (target.name !== 'device') return this.unavailable();
   const section = document.getElementById('cbi-network-device');
   if (!section) return;
   this.handled = this.requestedHash(); this.reveal(section); return;
  }
  if (target.kind === 'interface' && target.name === 'loopback') { this.handled = this.requestedHash(); this.showEntity('interface', 'loopback'); return; }
  let config = 'network', type = target.kind, id = target.name, editable = true;
  if (type === 'device') {
   const devices = sections(this.config.network, 'device').filter(device => device.name === target.name);
   if (devices.length > 1) return this.unavailable();
   id = devices[0]?.['.name'] || 'dev:' + target.name; editable = !!devices.length;
  } else if (type === 'zone') {
   config = 'firewall'; const zones = sections(this.config.firewall, 'zone').filter(zone => zone.name === target.name);
   if (zones.length !== 1) return this.unavailable(); id = zones[0]['.name'];
  } else if (type === 'lease') { config = 'dhcp'; type = 'host'; }
  const grid = document.getElementById('cbi-' + config + '-' + type);
  const row = Array.from(grid?.querySelectorAll('[data-sid]') || []).find(node => node.dataset.sid === id);
  if (!row) { if (grid) this.unavailable(); return; }
  this.handled = this.requestedHash(); this.reveal(row);
  const edit = row.querySelector('.cbi-button-edit');
  if (editable && edit && !edit.disabled) edit.click();
  else if (!editable) this.notice(_('Device found. Use its Configure button to create a device configuration.'));
 },
 notice: function (message) {
  this.root.querySelector('.rd-target-notice')?.remove();
  this.root.prepend(E('div', { class: 'alert-message notice rd-target-notice', role: 'status' }, message));
 },
 unavailable: function () {
  this.handled = this.requestedHash();
  this.notice(_('This object is unavailable in this view. It may have been removed or your account may not have access. Select an existing entry below.'));
 }
});
