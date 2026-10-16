/* SPDX-License-Identifier: Apache-2.0 */
(function (RD) {
 'use strict';
 const el = RD.el;
 const missing = value => value == null || value === '' ? 'Unavailable' : value;
 const panel = (title, hint, content, note) => el('section', { class: 'rd-panel' }, [el('div', { class: 'rd-panel-head' }, [el('h2', {}, title), el('small', {}, hint)]), content, note ? el('div', { class: 'rd-panel-note' }, note) : null]);
 const kv = entries => el('dl', { class: 'rd-kv' }, entries.map(([label, value]) => [el('dt', {}, label), el('dd', {}, missing(value))]));
 const stat = (label, value, detail, percent, unit) => el('section', { class: 'rd-stat' }, [
  el('div', { class: 'rd-stat-label' }, [label, el('span', { 'aria-hidden': 'true' }, '↗')]),
  el('strong', { class: 'rd-stat-value' }, [missing(value), unit ? el('small', {}, ' ' + unit) : null]),
  percent != null ? el('div', { class: 'rd-meter', role: 'meter', 'aria-label': label, 'aria-valuenow': Math.round(percent), 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('span', { style: 'width:' + Math.max(0, Math.min(100, percent)) + '%' })) : null,
  el('div', { class: 'rd-stat-detail' }, detail)
 ]);
 RD.table = function (headers, rows, empty) {
  return el('div', { class: 'rd-table-wrap', tabindex: '0', role: 'region', 'aria-label': headers.join(', ') }, el('table', { class: 'rd-table table' }, [
   el('thead', {}, el('tr', {}, headers.map(header => el('th', { scope: 'col' }, header)))),
   el('tbody', {}, rows.length ? rows.map(row => el('tr', {}, row.map(cell => el('td', {}, cell)))) : el('tr', {}, el('td', { colspan: headers.length, class: 'rd-empty' }, empty || 'No data available')))
  ]));
 };
 RD.chart = function (history) {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'rd-chart'); svg.setAttribute('viewBox', '0 0 640 160'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'WAN received and transmitted traffic, recent samples');
  const add = (tag, attrs) => { const node = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); svg.append(node); };
  [10, 45, 80, 115, 150].forEach(y => add('line', { x1: 0, x2: 640, y1: y, y2: y, class: 'rd-chart-grid' }));
  const points = history.slice(-60), max = Math.max(1024, ...points.flatMap(point => [point.rx || 0, point.tx || 0]));
  for (const [key, color] of [['rx', 'var(--rd-accent)'], ['tx', 'var(--rd-green)']]) {
   // A gap in sampling is a gap in the line, never fabricated traffic.
   let path = '', drawing = false;
   points.forEach((point, index) => {
    if (!Number.isFinite(point[key])) { drawing = false; return; }
    const x = (index / Math.max(points.length - 1, 1)) * 640, y = 150 - point[key] / max * 130;
    path += (drawing ? ' L' : ' M') + x.toFixed(1) + ',' + y.toFixed(1); drawing = true;
   });
   add('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
  }
  return svg;
 };
 RD.dashboard = function (data) {
  const mem = data.memory, used = mem?.total ? mem.total - (mem.available ?? mem.free ?? 0) : null;
  const percent = used == null ? null : 100 * used / mem.total;
  const rate = value => Number.isFinite(value) ? RD.bytes(value) + '/s' : 'Sampling…';
  const history = data.history || [], sample = history.at(-1) || {};
  const deviceRows = (data.leases || []).map(device => [el('strong', {}, missing(device.hostname)), el('span', { class: 'rd-mono' }, missing(device.ip)), el('span', { class: 'rd-mono' }, missing(device.mac)), missing(device.connection), RD.badge(device.status || 'Lease', 'neutral')]);
  const interfaceRows = (data.interfaces || []).map(iface => [el('strong', {}, iface.name), RD.badge(iface.up ? 'Up' : 'Down', iface.up ? 'success' : 'neutral'), missing(iface.protocol), el('span', { class: 'rd-mono' }, missing(iface.address)), el('span', { class: 'rd-mono' }, iface.device || '—')]);
  return el('div', { class: 'rd-dashboard' }, [
   el('div', { class: 'rd-page-heading' }, [el('div', {}, [el('div', { class: 'rd-eyebrow' }, 'Status / Overview'), el('h1', {}, 'Dashboard'), el('p', {}, 'A clear view of your network.')]), el('span', { class: 'rd-live' }, [el('span', { class: 'rd-dot' }), data.demo ? 'Demo data' : 'Updates every 5s'])]),
   data.error ? el('div', { class: 'alert-message warning', role: 'status' }, 'Some device data is unavailable. Check connectivity and access permissions.') : null,
   el('div', { class: 'rd-stats-grid' }, [
    stat('System uptime', data.uptime == null ? null : RD.uptime(data.uptime), missing(data.model)),
    stat('Memory usage', percent == null ? null : Math.round(percent), used == null ? 'No memory data' : RD.bytes(used) + ' of ' + RD.bytes(mem.total), percent, '%'),
    stat('CPU load · 1 minute', data.load == null ? null : data.load.toFixed(2), 'Load average, not CPU utilization'),
    stat('Active connections', data.connections, 'Tracked by the system firewall')
   ]),
   el('div', { class: 'rd-grid' }, [
    panel('WAN traffic', data.wan?.device || 'No WAN detected', [
     el('div', { class: 'rd-traffic-legend' }, [el('div', {}, [el('span', { class: 'rd-rx' }, '↓'), el('small', {}, 'Download'), el('strong', {}, rate(sample.rx))]), el('div', {}, [el('span', { class: 'rd-tx' }, '↑'), el('small', {}, 'Upload'), el('strong', {}, rate(sample.tx))])]),
     RD.chart(history), el('div', { class: 'rd-chart-labels' }, [el('span', {}, 'Recent samples'), el('span', {}, history.length < 2 ? 'Waiting for samples' : 'Now')])
    ], data.wan ? 'WAN ' + missing(data.wan.address) + ' · Connected ' + RD.uptime(data.wan.uptime) : 'WAN data is unavailable'),
    panel('System information', 'Device', el('div', { class: 'rd-panel-body' }, kv([
     ['Hostname', data.hostname], ['Firmware', data.firmware], ['Platform', data.platform], ['Kernel', data.kernel], ['Temperature', data.temperature], ['Storage', data.storage]
    ])))
   ]),
   panel('Network interfaces', (data.interfaces || []).length + ' configured', RD.table(['Interface', 'Status', 'Protocol', 'Address', 'Device'], interfaceRows), 'Interface state is reported by netifd.'),
   el('div', { style: 'height:18px' }),
   panel('DHCP clients', (data.leases || []).length + ' leases', RD.table(['Hostname', 'IP address', 'MAC address', 'Connection', 'Status'], deviceRows, data.leases == null ? 'DHCP leases unavailable or permission denied' : 'No DHCP leases reported'), 'A DHCP lease does not establish that a device is currently online.'),
   el('div', { style: 'height:18px' }),
   panel('VPN interfaces', 'WireGuard', (data.vpn || []).length ? RD.table(['Interface', 'Status', 'Received', 'Sent', 'Latest handshake'], data.vpn.map(vpn => [vpn.name, RD.badge(vpn.up ? 'Up' : 'Down', vpn.up ? 'success' : 'neutral'), RD.bytes(vpn.rx), RD.bytes(vpn.tx), missing(vpn.handshake)])) : el('div', { class: 'rd-empty' }, 'No WireGuard interfaces reported'), 'Interface up does not establish peer connectivity. Peer handshake data is unavailable in this version.')
  ]);
 };
})(globalThis.RouterDeck);
