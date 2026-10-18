// SPDX-License-Identifier: Apache-2.0
// Main menu grouped by subsystem. `window` opens an MDI window kind; items
// whose `requires` capability is missing are hidden rather than greyed out.

export const MENU = [
 { id: 'quick-set', label: 'Quick Set', icon: 'quickset', window: 'quick-set' },
 { id: 'wifi', label: 'WiFi', icon: 'wireless', window: 'wifi', requires: 'wireless' },
 { id: 'interfaces', label: 'Interfaces', icon: 'interfaces', window: 'interfaces' },
 { id: 'bridge', label: 'Bridge', icon: 'bridge', window: 'bridge' },
 { id: 'ppp', label: 'PPP', icon: 'ppp', window: 'ppp' },
 { id: 'ip', label: 'IP', icon: 'ip', children: [
  { id: 'ip-addresses', label: 'Addresses', window: 'ip-addresses' },
  { id: 'ip-arp', label: 'ARP', window: 'ip-arp' },
  { id: 'ip-routes', label: 'Routes', window: 'ip-routes' },
  { id: 'ip-firewall', label: 'Firewall', window: 'ip-firewall' },
  { id: 'ip-ipsec', label: 'IPsec', window: 'ip-ipsec', requires: 'ipsec' },
  { id: 'ip-dhcp-server', label: 'DHCP Server', window: 'ip-dhcp-server' },
  { id: 'ip-dns', label: 'DNS', window: 'ip-dns' },
  { id: 'ip-pool', label: 'Pool', window: 'ip-pool' },
  { id: 'ip-ddns', label: 'Dynamic DNS', window: 'ip-ddns', requires: 'ddns' },
  { id: 'ip-services', label: 'Services', window: 'ip-services' },
  { id: 'ip-settings', label: 'Settings', window: 'ip-settings' },
  { id: 'ip-upnp', label: 'UPnP', window: 'ip-upnp', requires: 'upnp' }
 ] },
 { id: 'ipv6', label: 'IPv6', icon: 'ipv6', children: [
  { id: 'ipv6-addresses', label: 'Addresses', window: 'ipv6-addresses' },
  { id: 'ipv6-neighbors', label: 'Neighbors', window: 'ipv6-neighbors' },
  { id: 'ipv6-routes', label: 'Routes', window: 'ipv6-routes' }
 ] },
 { id: 'routing', label: 'Routing', icon: 'routing', children: [
  { id: 'routing-rules', label: 'Rules', window: 'routing-rules' },
  { id: 'routing-tables', label: 'Tables', window: 'routing-tables' }
 ] },
 { id: 'queues', label: 'Queues', icon: 'queues', window: 'queues' },
 { id: 'system', label: 'System', icon: 'system', children: [
  { id: 'system-identity', label: 'Identity', window: 'system-identity' },
  { id: 'system-clock', label: 'Clock', window: 'system-clock' },
  { id: 'system-ntp', label: 'NTP Client', window: 'system-ntp' },
  { id: 'system-logging', label: 'Logging', window: 'system-logging' },
  { id: 'system-password', label: 'Password', window: 'system-password', requires: 'luci_object' },
  { id: 'system-users', label: 'Users', window: 'system-users' },
  { id: 'system-certificates', label: 'Certificates', window: 'system-certificates' },
  { id: 'system-packages', label: 'Packages', window: 'system-packages' },
  { id: 'system-scheduler', label: 'Scheduler', window: 'system-scheduler', requires: 'cron' },
  { id: 'system-scripts', label: 'Scripts', window: 'system-scripts' },
  { id: 'system-startup', label: 'Startup', window: 'system-startup', requires: 'rc' },
  { id: 'system-resources', label: 'Resources', window: 'system-resources' },
  { id: 'system-leds', label: 'LEDs', window: 'system-leds' },
  { id: 'system-disks', label: 'Disks', window: 'system-disks' },
  { id: 'system-backup', label: 'Backup', window: 'system-backup', requires: 'backup' },
  { id: 'system-firmware', label: 'Firmware', window: 'system-firmware', requires: 'sysupgrade' },
  { id: 'system-reset', label: 'Reset Configuration', action: 'reset', requires: 'sysupgrade' },
  { id: 'system-reboot', label: 'Reboot', action: 'reboot' }
 ] },
 { id: 'files', label: 'Files', icon: 'files', window: 'files', requires: 'upload' },
 { id: 'log', label: 'Log', icon: 'log', window: 'log' },
 { id: 'tools', label: 'Tools', icon: 'tools', children: [
  { id: 'tool-ping', label: 'Ping', window: 'tool-ping' },
  { id: 'tool-traceroute', label: 'Traceroute', window: 'tool-traceroute' },
  { id: 'tool-torch', label: 'Torch', window: 'tool-torch' },
  { id: 'tool-bandwidth', label: 'Bandwidth Test', window: 'tool-bandwidth', requires: 'iperf3' },
  { id: 'tool-scan', label: 'IP Scan', window: 'tool-scan' },
  { id: 'tool-netwatch', label: 'Netwatch', window: 'tool-netwatch' },
  { id: 'tool-wol', label: 'Wake on LAN', window: 'tool-wol', requires: 'etherwake' },
  { id: 'tool-graphs', label: 'Graphs', window: 'tool-graphs' },
  { id: 'tool-graphing', label: 'Graphing', window: 'tool-graphing' }
 ] },
 { id: 'terminal', label: 'New Terminal', icon: 'terminal', window: 'terminal' },
 { id: 'shell', label: 'New Shell', icon: 'shell', window: 'shell' },
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
