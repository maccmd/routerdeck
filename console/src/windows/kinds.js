// SPDX-License-Identifier: Apache-2.0
// Window kinds opened from the menu. Lists are not connected to router data
// yet; their tabs and columns show the layout the data windows will use.

const flags = { label: '', width: 26 };

export const WINDOW_KINDS = {
 interfaces: {
  title: 'Interface List', icon: 'interfaces', size: { w: 780, h: 340 },
  tabs: [
   { label: 'Interface', columns: [flags, 'Name', 'Type', 'Actual MTU', 'MAC Address', 'Tx', 'Rx', 'Tx Packet (p/s)', 'Rx Packet (p/s)'] },
   { label: 'Networks', columns: [flags, 'Name', 'Protocol', 'Device', 'Uptime', 'Firewall Zone'] }
  ]
 },
 'ip-addresses': {
  title: 'Address List', icon: 'ip', size: { w: 520, h: 300 },
  tabs: [{ columns: [flags, 'Address', 'Network', 'Interface'] }]
 },
 'ip-routes': {
  title: 'Route List', icon: 'ip', size: { w: 720, h: 320 },
  tabs: [{ columns: [flags, 'Dst. Address', 'Gateway', 'Distance', 'Routing Table', 'Pref. Source', 'Interface'] }]
 },
 'ip-firewall': {
  title: 'Firewall', icon: 'ip', size: { w: 880, h: 360 },
  tabs: [
   { label: 'Filter Rules', columns: ['#', flags, 'Action', 'Chain', 'Src. Address', 'Dst. Address', 'Protocol', 'Src. Port', 'Dst. Port', 'In. Zone', 'Out. Zone', 'Bytes', 'Packets'] },
   { label: 'NAT', columns: ['#', flags, 'Action', 'Chain', 'Src. Address', 'Dst. Address', 'Protocol', 'Dst. Port', 'In. Zone', 'Out. Zone', 'To Addresses', 'To Ports', 'Bytes', 'Packets'] },
   { label: 'Connections', columns: ['Src. Address', 'Dst. Address', 'Protocol', 'Timeout', 'Bytes', 'Packets'], readOnly: true },
   { label: 'Zones', columns: [flags, 'Name', 'Input', 'Output', 'Forward', 'Masquerade', 'Networks'] }
  ]
 },
 'ip-dhcp-server': {
  title: 'DHCP Server', icon: 'ip', size: { w: 780, h: 320 },
  tabs: [
   { label: 'DHCP', columns: [flags, 'Name', 'Interface', 'Start', 'Limit', 'Lease Time'] },
   { label: 'Leases', columns: [flags, 'Address', 'MAC Address', 'Client ID', 'Server', 'Expires After', 'Status', 'Host Name'] }
  ]
 },
 log: {
  title: 'Log', icon: 'log', size: { w: 760, h: 360 },
  tabs: [{ columns: ['Time', 'Topics', 'Message'], readOnly: true }]
 },
 terminal: { title: 'Terminal', icon: 'terminal', size: { w: 700, h: 420 }, multi: true, body: 'terminal' }
};
