'use strict';
'require view';
'require rpc';
'require poll';
'require fs';

const callBoard = rpc.declare({ object: 'system', method: 'board', expect: { '': {} } });
const callInfo = rpc.declare({ object: 'system', method: 'info', expect: { '': {} } });
const callInterfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { interface: [] } });
const callDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });
const callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });

function script(path) {
 return new Promise((resolve, reject) => {
  const tag = document.createElement('script');
  tag.src = path; tag.onload = resolve; tag.onerror = () => reject(new Error('Unable to load RouterDeck assets'));
  document.head.appendChild(tag);
 });
}

return view.extend({
 load: function () {
  this.history = []; this.previous = null;
  if (!document.querySelector('[data-rd-components]')) {
   document.head.appendChild(E('link', { rel: 'stylesheet', href: L.resource('../routerdeck/components.css'), 'data-rd-components': '' }));
  }
  return (window.RouterDeck ? Promise.resolve() : script(L.resource('../routerdeck/core.js')))
   .then(() => window.RouterDeck.dashboard ? null : script(L.resource('../routerdeck/dashboard.js')))
   .then(() => this.fetch());
 },
 fetch: function () {
  return Promise.all([
   L.resolveDefault(callBoard(), {}), L.resolveDefault(callInfo(), {}),
   L.resolveDefault(callInterfaces(), []), L.resolveDefault(callDevices(), {}),
   L.resolveDefault(callLeases(), null), L.resolveDefault(fs.trimmed('/proc/sys/net/netfilter/nf_conntrack_count'), null)
  ]).then(([board, info, nets, devices, leases, count]) => {
   const wan = nets.find(net => (net.route || []).some(route => route.target === '0.0.0.0' && route.mask === 0));
   const device = wan?.l3_device, stats = devices[device]?.stats, now = performance.now();
   const sameDevice = this.previous != null && this.previous.device === device;
   const dt = this.previous ? (now - this.previous.time) / 1000 : 0;
   this.history.push({ rx: sameDevice ? RouterDeck.rate(this.previous.rx, stats?.rx_bytes, dt) : null, tx: sameDevice ? RouterDeck.rate(this.previous.tx, stats?.tx_bytes, dt) : null });
   this.history = this.history.slice(-60);
   this.previous = { device, time: now, rx: stats?.rx_bytes, tx: stats?.tx_bytes };
   const addr = net => (net['ipv4-address'] || []).map(ip => ip.address + '/' + ip.mask).join(', ') || (net['ipv6-address'] || []).map(ip => ip.address + '/' + ip.mask).join(', ');
   return {
    hostname: board.hostname, model: board.model, firmware: board.release?.description, platform: board.release?.target, kernel: board.kernel,
    uptime: info.uptime, load: info.load?.[0] == null ? null : info.load[0] / 65536, memory: info.memory,
    connections: count != null && /^\d+$/.test(count) ? Number(count) : null,
    temperature: null, storage: info.root?.total ? RouterDeck.bytes((info.root.total - info.root.free) * 1024) + ' / ' + RouterDeck.bytes(info.root.total * 1024) : null,
    wan: wan ? { device, address: addr(wan), uptime: wan.uptime } : null, history: this.history,
    interfaces: nets.filter(net => net.interface !== 'loopback').map(net => ({ name: net.interface, up: net.up, protocol: net.proto, address: addr(net), device: net.l3_device || net.device })),
    leases: leases ? [...(leases.dhcp_leases || []), ...(leases.dhcp6_leases || [])].map(lease => ({ hostname: lease.hostname, ip: lease.ipaddr || lease.ip6addr || lease.ip6addrs?.join(', '), mac: lease.macaddr, connection: null, status: 'Lease' })) : null,
    vpn: nets.filter(net => net.proto === 'wireguard').map(net => ({ name: net.interface, up: net.up, rx: devices[net.l3_device]?.stats?.rx_bytes, tx: devices[net.l3_device]?.stats?.tx_bytes })),
    error: !board.hostname || info.uptime == null
   };
  });
 },
 render: function (data) {
  const container = E('div', {}, RouterDeck.dashboard(data));
  poll.add(() => {
   if (document.hidden || container.contains(document.activeElement)) return Promise.resolve();
   return this.fetch().then(next => container.replaceChildren(RouterDeck.dashboard(next)));
  }, 5);
  return container;
 },
 handleSaveApply: null,
 handleSave: null,
 handleReset: null
});
