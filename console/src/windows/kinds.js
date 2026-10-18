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
 'ip-dhcp-server': { title: 'DHCP Server', size: { w: 760, h: 320 }, tabs: [{ label: 'DHCP', model: 'dhcp-servers' }, { label: 'Leases', model: 'dhcp-leases' }] },
 log: { title: 'Log', size: { w: 860, h: 420 }, tabs: [{ label: 'Log', model: 'log' }] },
 terminal: { title: 'Terminal', size: { w: 720, h: 440 }, multi: true, body: 'terminal' },
 item: { title: 'Object', size: { w: 480, h: 320 }, multi: true, body: 'item' }
};
