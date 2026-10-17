/* SPDX-License-Identifier: Apache-2.0 */
(function (RD) {
 'use strict';
 const el = RD.el;
 const missing = value => value == null || value === '' ? 'Unavailable' : value;
 const panel = (title, hint, content, note, page) => el('section', { class: 'rd-panel' }, [el('div', { class: 'rd-panel-head' }, [el('h2', { 'data-rd-page': page }, title), el('small', {}, hint)]), content, note ? el('div', { class: 'rd-panel-note' }, note) : null]);
 const kv = entries => el('dl', { class: 'rd-kv' }, entries.map(([label, value]) => [el('dt', {}, label), el('dd', {}, missing(value))]));
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
  for (const [key, color] of [['rx', 'var(--rd-accent)'], ['tx', 'var(--rd-green)']])
   add('path', { 'data-series': key, fill: 'none', stroke: color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
  updateChart(svg, history);
  return svg;
 };
 function updateChart(svg, history) {
  const points = history.slice(-60), max = Math.max(1024, ...points.flatMap(point => [point.rx || 0, point.tx || 0]));
  for (const key of ['rx', 'tx']) {
   // Keep a fixed 60-sample time axis, including while the history fills up.
   // A gap in sampling is a gap in the line, never fabricated traffic.
   let path = '', drawing = false;
   points.forEach((point, index) => {
    if (!Number.isFinite(point[key])) { drawing = false; return; }
    const x = (60 - points.length + index) / 59 * 640, y = 150 - point[key] / max * 130;
    path += (drawing ? ' L' : ' M') + x.toFixed(1) + ',' + y.toFixed(1); drawing = true;
   });
   const line = svg.querySelector('[data-series="' + key + '"]');
   if (line.getAttribute('d') !== path) line.setAttribute('d', path);
  }
 }
 // Each binding owns only its value. Unchanged links, focused controls and
 // scrollable tables survive polling and optional contextual-link decoration.
 const dashboards = new WeakMap();
 const replace = (node, value) => node.replaceChildren(...[value].flat(Infinity).filter(item => item != null));
 function tracked(read, write) {
  let previous;
  return data => {
   const value = read(data), signature = JSON.stringify(value) ?? 'undefined';
   if (signature === previous) return;
   previous = signature; write(value);
  };
 }
 RD.updateDashboard = function (root, data) {
  const updates = dashboards.get(root);
  if (!updates) return;
  const focus = root.contains(document.activeElement) ? document.activeElement : null;
  updates.forEach(update => update(data));
  // Decorate new/changed entities before paint, without briefly showing bare
  // table cells whose widths differ from their linked versions.
  if (root.isConnected) RD.links?.scan?.();
  if (focus?.isConnected && document.activeElement !== focus) focus.focus({ preventScroll: true });
 };
 RD.dashboard = function (data) {
  const updates = [];
  const bind = (read, write) => updates.push(tracked(read, write));
  const slot = (read, render = missing, tag = 'span', attrs = {}) => {
   const node = el(tag, attrs); bind(read, value => replace(node, render(value))); return node;
  };
  const memory = data => {
   const total = data.memory?.total, used = total ? total - (data.memory.available ?? data.memory.free ?? 0) : null;
   return { total, used, percent: used == null ? null : 100 * used / total };
  };
  const entity = (kind, name) => el('span', { 'data-rd-entity': kind, 'data-rd-name': name }, name || '—');
  const addresses = value => value ? value.split(', ').map((ip, index) => [index ? ', ' : null, el('span', { 'data-rd-address': '', class: 'rd-mono' }, ip)]) : '—';
  const state = up => RD.badge(up ? 'Up' : 'Down', up ? 'success' : 'neutral');
  const stat = (label, value, detail, percent, unit, page) => {
   const meter = percent ? el('div', { class: 'rd-meter', role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('span')) : null;
   if (meter) bind(percent, value => {
    meter.style.visibility = value == null ? 'hidden' : '';
    if (value == null) meter.removeAttribute('aria-valuenow'); else meter.setAttribute('aria-valuenow', Math.round(value));
    meter.firstChild.style.width = Math.max(0, Math.min(100, value || 0)) + '%';
   });
   return el('section', { class: 'rd-stat' }, [
    el('div', { class: 'rd-stat-label' }, el('span', { 'data-rd-page': page }, label)),
    el('strong', { class: 'rd-stat-value' }, [slot(value), unit ? el('small', {}, ' ' + unit) : null]), meter,
    slot(detail, missing, 'div', { class: 'rd-stat-detail' })
   ]);
  };
  const table = (headers, read, key, cells, empty, hideEmptyHeader = false) => {
   const wrapper = RD.table(headers, []), body = wrapper.querySelector('tbody'), head = wrapper.querySelector('thead');
   const emptyRow = body.firstElementChild, emptyCell = emptyRow.firstElementChild;
   let rows = new Map();
   updates.push(data => {
    const items = read(data) || [], next = new Map(), occurrences = new Map();
    head.hidden = hideEmptyHeader && !items.length;
    if (items.length) emptyRow.remove();
    let cursor = body.firstElementChild;
    items.forEach(item => {
     const id = JSON.stringify(key(item)), count = occurrences.get(id) || 0, unique = id + ':' + count;
     occurrences.set(id, count + 1);
     let row = rows.get(unique);
     if (!row) {
      const node = el('tr');
      const update = cells.map(([readCell, renderCell = missing]) => {
       const cell = el('td'); node.append(cell);
       return tracked(readCell, value => replace(cell, renderCell(value)));
      });
      row = { node, update };
     }
     row.update.forEach(update => update(item));
     if (row.node !== cursor) body.insertBefore(row.node, cursor);
     cursor = row.node.nextElementSibling; next.set(unique, row);
    });
    rows.forEach((row, key) => { if (!next.has(key)) row.node.remove(); }); rows = next;
    if (!items.length) {
     const message = typeof empty === 'function' ? empty(data) : empty || 'No data available';
     if (emptyCell.textContent !== message) emptyCell.textContent = message;
     if (emptyRow.parentNode !== body) body.append(emptyRow);
    }
   });
   return wrapper;
  };
  const chart = RD.chart([]); bind(data => data.history || [], history => updateChart(chart, history));
  const rate = key => slot(data => data.history?.at(-1)?.[key], value => Number.isFinite(value) ? RD.bytes(value) + '/s' : 'Sampling…', 'strong');
  const warning = el('div', { class: 'alert-message warning', role: 'status', hidden: '' }, 'Some device data is unavailable. Check connectivity and access permissions.');
  bind(data => !!data.error, error => { warning.hidden = !error; });
  const root = el('div', { class: 'rd-dashboard' }, [
   el('div', { class: 'rd-page-heading' }, [el('div', {}, [el('div', { class: 'rd-eyebrow' }, 'Status / Overview'), el('h1', {}, 'Dashboard'), el('p', {}, 'A clear view of your network.')]), el('span', { class: 'rd-live' }, [el('span', { class: 'rd-dot' }), slot(data => !!data.demo, demo => demo ? 'Demo data' : 'Updates every 5s')])]), warning,
   el('div', { class: 'rd-stats-grid' }, [
    stat('System uptime', data => data.uptime == null ? null : RD.uptime(data.uptime), data => data.model, null, null, 'system'),
    stat('Memory usage', data => memory(data).percent == null ? null : Math.round(memory(data).percent), data => memory(data).used == null ? 'No memory data' : RD.bytes(memory(data).used) + ' of ' + RD.bytes(memory(data).total), data => memory(data).percent, '%', 'overview'),
    stat('CPU load · 1 minute', data => data.load == null ? null : data.load.toFixed(2), () => 'Load average, not CPU utilization', null, null, 'load'),
    stat('Active connections', data => data.connections, () => 'Tracked by the system firewall', null, null, 'connections')
   ]),
   el('div', { class: 'rd-grid' }, [
    panel('WAN traffic', slot(data => data.wan?.device, device => device ? entity('device', device) : 'No WAN detected'), [
     el('div', { class: 'rd-traffic-legend' }, [el('div', {}, [el('span', { class: 'rd-rx' }, '↓'), el('small', {}, 'Download'), rate('rx')]), el('div', {}, [el('span', { class: 'rd-tx' }, '↑'), el('small', {}, 'Upload'), rate('tx')])]),
     chart, el('div', { class: 'rd-chart-labels' }, [el('span', {}, 'Recent samples'), slot(data => (data.history || []).length < 2, waiting => waiting ? 'Waiting for samples' : 'Now')])
    ], slot(data => data.wan ? 'WAN ' + missing(data.wan.address) + ' · Connected ' + RD.uptime(data.wan.uptime) : 'WAN data is unavailable'), 'bandwidth'),
    panel('System information', 'Device', el('div', { class: 'rd-panel-body' }, kv([
     ['Hostname', slot(data => data.hostname)], ['Firmware', slot(data => data.firmware)], ['Platform', slot(data => data.platform)], ['Kernel', slot(data => data.kernel)], ['Temperature', slot(data => data.temperature)], ['Storage', slot(data => data.storage)]
    ])), null, 'system')
   ]),
   panel('Network interfaces', slot(data => (data.interfaces || []).length, count => count + ' configured'), table(['Interface', 'Status', 'Protocol', 'Address', 'Device'], data => data.interfaces, iface => iface.name, [
    [iface => iface.name, name => entity('interface', name)], [iface => !!iface.up, state], [iface => iface.protocol], [iface => iface.address, addresses], [iface => iface.device, name => entity('device', name)]
   ]), 'Interface state is reported by netifd.', 'interfaces'),
   el('div', { style: 'height:18px' }),
   panel('DHCP clients', slot(data => (data.leases || []).length, count => count + ' leases'), table(['Hostname', 'IP address', 'MAC address', 'Lease remaining', 'Status'], data => data.leases, device => [device.mac || device.duid, device.ip], [
    [device => [device.mac || device.duid || device.ip, device.hostname], ([id, name]) => el('strong', { 'data-rd-client': id }, missing(name))],
    [device => device.ip, addresses], [device => device.mac, mac => el('span', { class: 'rd-mono' }, missing(mac))],
    [device => device.expires, expires => expires === false ? 'Unlimited' : expires == null ? 'Unavailable' : RD.uptime(expires)],
    [device => device.status || 'Lease', status => RD.badge(status, 'neutral')]
   ], data => data.leases == null ? 'DHCP leases unavailable or permission denied' : 'No DHCP leases reported'), 'A lease does not establish that a device is currently online.', 'dhcp'),
   el('div', { style: 'height:18px' }),
   panel('VPN interfaces', 'WireGuard', table(['Interface', 'Status', 'Received', 'Sent', 'Latest handshake'], data => data.vpn, vpn => vpn.name, [
    [vpn => vpn.name, name => entity('interface', name)], [vpn => !!vpn.up, state], [vpn => vpn.rx, RD.bytes], [vpn => vpn.tx, RD.bytes], [vpn => vpn.handshake]
   ], 'No WireGuard interfaces reported', true), 'Interface up does not establish peer connectivity. Open WireGuard status for peer details when available.', 'vpn')
  ]);
  dashboards.set(root, updates); RD.updateDashboard(root, data); return root;
 };
})(globalThis.RouterDeck);
