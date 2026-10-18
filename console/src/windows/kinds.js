// SPDX-License-Identifier: Apache-2.0
// Window kinds. List windows show one model per tab; `item` windows show one
// object; terminals may be opened several times.

export const WINDOW_KINDS = {
 interfaces: { title: 'Interface List', size: { w: 840, h: 380 }, tabs: [{ label: 'Interface', model: 'interfaces' }, { label: 'Networks', model: 'networks' }] },
 'ip-addresses': { title: 'Address List', size: { w: 500, h: 300 }, tabs: [{ label: 'Addresses', model: 'addresses' }] },
 'ip-routes': { title: 'Route List', size: { w: 760, h: 340 }, tabs: [{ label: 'Routes', model: 'routes' }] },
 'ip-firewall': { title: 'Firewall', size: { w: 960, h: 420 }, tabs: [
  { label: 'Filter Rules', model: 'fw-filter' }, { label: 'NAT', model: 'fw-nat' }, { label: 'Connections', model: 'connections' }, { label: 'Zones', model: 'fw-zones' }
 ] },
 bridge: { title: 'Bridge', size: { w: 820, h: 340 }, tabs: [{ label: 'Bridge', model: 'bridges' }, { label: 'Ports', model: 'bridge-ports' }, { label: 'VLANs', model: 'bridge-vlans' }] },
 'ipv6-addresses': { title: 'IPv6 Address List', size: { w: 720, h: 320 }, tabs: [{ label: 'Addresses', model: 'addresses6' }] },
 'ipv6-routes': { title: 'IPv6 Route List', size: { w: 900, h: 360 }, tabs: [{ label: 'Routes', model: 'routes6' }] },
 'ip-dhcp-server': { title: 'DHCP Server', size: { w: 780, h: 340 }, tabs: [{ label: 'DHCP', model: 'dhcp-servers' }, { label: 'Leases', model: 'dhcp-leases' }, { label: 'DHCPv6 Bindings', model: 'dhcp6-bindings' }] },
 'ip-dns': { title: 'DNS Settings', size: { w: 560, h: 380 }, tabs: [{ label: 'Settings', model: 'dns-settings' }, { label: 'Static', model: 'dns-static' }] },
 log: { title: 'Log', size: { w: 860, h: 420 }, tabs: [{ label: 'Log', model: 'log' }] },
 terminal: { title: 'Terminal', size: { w: 720, h: 440 }, multi: true, body: 'terminal' },
 item: { title: 'Object', size: { w: 480, h: 320 }, multi: true, body: 'item' }
};
