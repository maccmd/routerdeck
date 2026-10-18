// SPDX-License-Identifier: Apache-2.0
// Main menu grouped by subsystem. `window` opens an MDI window kind; items
// whose `requires` capability is missing are hidden rather than greyed out.

export const MENU = [
 { id: 'interfaces', label: 'Interfaces', icon: 'interfaces', window: 'interfaces' },
 { id: 'bridge', label: 'Bridge', icon: 'bridge', window: 'bridge' },
 { id: 'ip', label: 'IP', icon: 'ip', children: [
  { id: 'ip-addresses', label: 'Addresses', window: 'ip-addresses' },
  { id: 'ip-routes', label: 'Routes', window: 'ip-routes' },
  { id: 'ip-firewall', label: 'Firewall', window: 'ip-firewall' },
  { id: 'ip-dhcp-server', label: 'DHCP Server', window: 'ip-dhcp-server' },
  { id: 'ip-dns', label: 'DNS', window: 'ip-dns' }
 ] },
 { id: 'ipv6', label: 'IPv6', icon: 'ipv6', children: [
  { id: 'ipv6-addresses', label: 'Addresses', window: 'ipv6-addresses' },
  { id: 'ipv6-routes', label: 'Routes', window: 'ipv6-routes' }
 ] },
 { id: 'log', label: 'Log', icon: 'log', window: 'log' },
 { id: 'terminal', label: 'New Terminal', icon: 'terminal', window: 'terminal' },
 { id: 'windows', label: 'Windows', icon: 'window', children: [
  { id: 'windows-cascade', label: 'Cascade', action: 'cascade' },
  { id: 'windows-tile', label: 'Tile', action: 'tile' },
  { id: 'windows-minimize', label: 'Minimize All', action: 'minimize-all' },
  { id: 'windows-close', label: 'Close All', action: 'close-all' }
 ] },
 { separator: true },
 { id: 'luci', label: 'LuCI', icon: 'luci', href: '/cgi-bin/luci/', requires: 'luci' },
 { id: 'exit', label: 'Exit', icon: 'exit', action: 'logout' }
];

export function visibleMenu(menu, capabilities = {}) {
 return menu
  .filter(item => !item.requires || capabilities[item.requires])
  .map(item => item.children ? { ...item, children: visibleMenu(item.children, capabilities) } : item)
  .filter(item => !item.children || item.children.length);
}
