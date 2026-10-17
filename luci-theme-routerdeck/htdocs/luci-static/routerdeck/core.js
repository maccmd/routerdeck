/* SPDX-License-Identifier: Apache-2.0 */
(function (root) {
 'use strict';
 // A timed-out script can still arrive after a recovery request has completed.
 // Keep the existing theme, listeners and extensions when that happens.
 if (typeof root.RouterDeck?.init === 'function') return;
 const RD = root.RouterDeck = {};
 RD.el = function (tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
   if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
   else if (value != null) node.setAttribute(key, String(value));
  }
  for (const child of [children].flat(Infinity)) {
   if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
 };
 // Original outline icons. Inline SVG avoids icon fonts, external assets and
 // platform-specific Unicode glyphs; currentColor follows theme and selection.
 const iconPaths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v4h-7z M14 11h7v10h-7z M3 14h7v7H3z',
  overview: 'M4 3h16a1 1 0 0 1 1 1v12H3V4a1 1 0 0 1 1-1Z M8 21h8 M12 16v5 M6 9h3l2-3 3 7 2-4h2',
  workspace: 'M3 3h14v4H7v10H3z M7 7h14v14H7z M7 11h14',
  routes: 'M6 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M18 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M6 6v2a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v2 M14 5h7 M18 2l3 3-3 3',
  routing: 'M12 2v20 M3 5h14l4 4-4 4H3z M12 17h7',
  firewallStatus: 'M12 2 21 6v6c0 5-5 8-9 10-4-2-9-5-9-10V6Z M5 12h4l2-4 3 8 2-4h3',
  logs: 'M4 2h11l5 5v15H4z M15 2v5h5 M8 11h8 M8 15h8 M8 19h5',
  processes: 'M6 6h12v12H6z M9 9h6v6H9z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4',
  realtime: 'M3 3v18h18 M6 15l4-5 4 3 6-8',
  vpn: 'M8 10V6a4 4 0 0 1 8 0v4 M5 10h14v12H5z M12 14v4 M2 14h3 M19 14h3',
  system: 'M18.84 9.17 19.15 10.08 21.78 9.92 21.78 14.08 19.15 13.92 18.84 14.83 18.41 15.70 20.39 17.45 17.45 20.39 15.70 18.41 14.83 18.84 13.92 19.15 14.08 21.78 9.92 21.78 10.08 19.15 9.17 18.84 8.30 18.41 6.55 20.39 3.61 17.45 5.59 15.70 5.16 14.83 4.85 13.92 2.22 14.08 2.22 9.92 4.85 10.08 5.16 9.17 5.59 8.30 3.61 6.55 6.55 3.61 8.30 5.59 9.17 5.16 10.08 4.85 9.92 2.22 14.08 2.22 13.92 4.85 14.83 5.16 15.70 5.59 17.45 3.61 20.39 6.55 18.41 8.30Z M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  administration: 'M8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M9 21H2v-3a6 6 0 0 1 9-5 M17 10l5 2v4c0 3-3 5-5 6-2-1-5-3-5-6v-4Z M15 16l1.5 1.5L19 14',
  software: 'M3 7l9-5 9 5v10l-9 5-9-5Z M3 7l9 5 9-5 M12 12v10 M7.5 4.5l9 5v4',
  startup: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M10 7l7 5-7 5Z',
  scheduled: 'M12 21H3V4h17v5 M3 8h17 M7 2v4 M16 2v4 M17 12a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z M17 14v3l2 1',
  upgrade: 'M7 17H6a4 4 0 0 1 0-8h.5C7 6 9.5 4 12.5 4S18 6.2 18 9a4 4 0 0 1 0 8h-1 M12 11v11 M8 18l4 4 4-4',
  firmware: 'M3 14h18v7H3z M6 18h.01 M9 18h.01 M12 14V2 M8 6l4-4 4 4',
  reboot: 'M20 10a8 8 0 1 0 0 5 M20 3v7h-7',
  interfaces: 'M8 2h8v6H8z M12 8v5 M5 13h14 M5 13v3 M19 13v3 M2 16h6v6H2z M16 16h6v6h-6z',
  dhcp: 'M3 2h18v7H3z M6 5.5h.01 M9 5.5h.01 M3 14h16 M16 11l3 3-3 3 M21 19H5 M8 16l-3 3 3 3',
  dns: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  diagnostics: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z M16 16l6 6 M4 10h3l2-3 3 6 2-3h2',
  firewall: 'M12 2 21 6v6c0 5-5 8-9 10-4-2-9-5-9-10V6Z M4 9h16 M4 14h16 M12 2v7 M8 9v5 M16 9v5 M12 14v8',
  wireless: 'M2 7a16 16 0 0 1 20 0 M5 11a11 11 0 0 1 14 0 M8 15a6 6 0 0 1 8 0 M12 19h.01',
  switch: 'M2 7h20v13H2z M5 11h3v4H5z M10.5 11h3v4h-3z M16 11h3v4h-3z M5 3v4 M19 3v4',
  logout: 'M10 3H3v18h7 M14 7l6 5-6 5 M8 12h12',
  terminal: 'M3 4h18v16H3z M6 8l4 4-4 4 M13 16h5',
  extension: 'M3 3h6v3a3 3 0 1 0 6 0V3h6v6h-3a3 3 0 1 0 0 6h3v6h-6v-3a3 3 0 1 0-6 0v3H3z'
 };
 // Full paths distinguish the configuration view from its status counterpart.
 const menuIcons = {
  'admin/status/routes': 'routes', 'admin/status/routesj': 'routes',
  'admin/status/firewall': 'firewallStatus', 'admin/status/nftables': 'firewallStatus', 'admin/status/iptables': 'firewallStatus',
  'admin/network/routes': 'routing', 'admin/network/network': 'interfaces'
 };
 const iconAliases = {
  dashboard: 'dashboard', overview: 'overview', workspace: 'workspace',
  routes: 'routes', routesj: 'routes', routing: 'routing', nftables: 'firewallStatus', iptables: 'firewallStatus',
  logs: 'logs', syslog: 'logs', dmesg: 'logs', processes: 'processes', realtime: 'realtime',
  wireguard: 'vpn', openvpn: 'vpn', vpn: 'vpn', system: 'system', admin: 'administration', administration: 'administration',
  'package-manager': 'software', packages: 'software', opkg: 'software', software: 'software',
  startup: 'startup', crontab: 'scheduled', scheduled: 'scheduled', attendedsysupgrade: 'upgrade', flash: 'firmware', reboot: 'reboot',
  network: 'interfaces', interfaces: 'interfaces', dhcp: 'dhcp', dns: 'dns', diagnostics: 'diagnostics', firewall: 'firewall',
  wireless: 'wireless', switch: 'switch', logout: 'logout', terminal: 'terminal',
  load: 'realtime', bandwidth: 'realtime', connections: 'interfaces', channel_analysis: 'wireless'
 };
 RD.menuIconName = function (id) {
  const parts = String(id || '').split('/').filter(Boolean), path = parts.slice(0, 3).join('/');
  if (Object.hasOwn(menuIcons, path)) return menuIcons[path];
  const name = parts.length > 2 ? parts[2] : parts.at(-1);
  return Object.hasOwn(iconAliases, name) ? iconAliases[name] : 'extension';
 };
 RD.icon = function (name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const key = Object.hasOwn(iconPaths, name) ? name : 'extension';
  for (const [attr, value] of Object.entries({ viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', 'data-rd-icon': key })) svg.setAttribute(attr, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', iconPaths[key]); svg.append(path);
  return svg;
 };
 RD.storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem('routerdeck.' + key)) ?? fallback; } catch (_) { return fallback; } },
  set(key, value) { try { localStorage.setItem('routerdeck.' + key, JSON.stringify(value)); } catch (_) {} }
 };
 RD.bytes = function (value, decimals = 1) {
  if (!Number.isFinite(value) || value < 0) return 'Unavailable';
  const index = Math.max(0, Math.min(4, Math.floor(Math.log2(value || 1) / 10)));
  return (value / Math.pow(1024, index)).toFixed(index ? decimals : 0) + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][index];
 };
 RD.uptime = function (value) {
  if (!Number.isFinite(value) || value < 0) return 'Unavailable';
  const days = Math.floor(value / 86400), hours = Math.floor(value / 3600) % 24, minutes = Math.floor(value / 60) % 60;
  return (days ? days + 'd ' : '') + hours + 'h ' + minutes + 'm';
 };
 RD.rate = function (previous, current, elapsed) {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current < previous || elapsed <= 0) return null;
  return (current - previous) / elapsed;
 };
 RD.theme = function (value) {
  const theme = value === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.darkmode = String(theme === 'dark');
  try { localStorage.setItem('routerdeck.theme', theme); } catch (_) {}
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
   button.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme');
   button.textContent = theme === 'dark' ? '☼' : '◐';
  });
  document.dispatchEvent(new CustomEvent('routerdeck-theme', { detail: theme }));
 };
 // LuCI validates the fields; the theme only makes its errors visible.
 RD.initValidation = function () {
  if (RD.validationReady) return;
  RD.validationReady = true;
  const errors = new WeakMap();
  let sequence = 0;
  const translate = message => typeof root._ === 'function' ? root._(message) : message;
  const clear = field => {
   const error = errors.get(field);
   if (!error) return;
   const describedBy = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== error.id);
   if (describedBy.length) field.setAttribute('aria-describedby', describedBy.join(' '));
   else field.removeAttribute('aria-describedby');
   field.removeAttribute('aria-invalid');
   error.remove(); errors.delete(field);
  };
  const show = field => {
   const container = field.closest('.cbi-value-field');
   const message = field.getAttribute('data-tooltip');
   if (!container || !field.closest('.cbi-map') || !message) return;
   let error = errors.get(field);
   if (!error) {
    error = RD.el('div', { id: 'rd-field-error-' + ++sequence, class: 'rd-field-error', 'aria-live': 'polite' });
    container.insertBefore(error, container.querySelector(':scope > .cbi-value-description'));
    errors.set(field, error);
    field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
   }
   let hint = '';
   if (field.getAttribute('placeholder') === '0.0.0.0/0') hint = translate('Include the prefix length, e.g. 1.1.1.1/32 for one host.');
   if (field.getAttribute('placeholder') === '::/0') hint = translate('Include the prefix length, e.g. 2001:db8::1/128 for one host.');
   const text = [message, hint].filter(Boolean).join(' ');
   if (error.textContent !== text) error.textContent = text;
   field.setAttribute('aria-invalid', 'true');
  };
  // A blur may validate pasted text during a pointer press. Defer reflow until
  // release so the message cannot move Save away from the pointer mid-click.
  let pointerDown = false;
  const pending = new Set();
  const update = field => field.classList.contains('cbi-input-invalid') ? show(field) : clear(field);
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  const released = () => {
   pointerDown = false;
   setTimeout(() => { for (const field of pending) if (field.isConnected) update(field); pending.clear(); }, 0);
  };
  document.addEventListener('pointerup', released, true);
  document.addEventListener('pointercancel', released, true);
  const validated = event => { if (pointerDown) pending.add(event.target); else update(event.target); };
  document.addEventListener('validation-failure', validated);
  document.addEventListener('validation-success', validated);
  document.addEventListener('tooltip-open', event => {
   // The same error already has a persistent, accessible message below the field.
   event.target.classList.toggle('rd-inline-tooltip', errors.has(event.detail.target));
  });
  document.addEventListener('click', event => {
   const button = event.target.closest('button.cbi-button-positive, button.cbi-button-save');
   const scope = button?.closest('.cbi-modal') || (button?.closest('.cbi-page-actions') ? document.getElementById('maincontent') : null);
   if (!scope || button.disabled) return;
   const fields = [...scope.querySelectorAll('.cbi-input-invalid')].filter(field => !field.closest('.hidden') && !field.disabled);
   fields.forEach(show);
   if (!fields.length) return;
   // Let the native save handler reject invalid data before focusing the error.
   // Do not replace handlers, bypass validation, or write any configuration.
   setTimeout(() => {
    const field = fields.find(node => node.isConnected && node.classList.contains('cbi-input-invalid'));
    if (!field || !button.isConnected) return;
    const panes = [];
    for (let node = field.parentElement; node && node !== scope; node = node.parentElement) {
     if (node.matches('[data-tab-title][data-tab-active="false"]')) panes.unshift(node);
    }
    for (const pane of panes) {
     const menu = pane.parentElement.previousElementSibling;
     const tab = [...(menu?.children || [])].find(node => node.dataset.tab === pane.dataset.tab);
     tab?.querySelector('a')?.click();
    }
    field.scrollIntoView({ block: 'center', behavior: 'instant' });
    field.focus({ preventScroll: true });
   }, 0);
  }, true);
 };
 RD.initSidebarResize = function () {
  const sidebar = document.getElementById('rd-sidebar'), handle = document.getElementById('rd-nav-resize');
  if (!sidebar || !handle || handle.dataset.ready) return;
  handle.dataset.ready = 'true';
  const key = 'navigation.width', min = 180;
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= 420 ? value : null;
  let preferred = valid(RD.storage.get(key, null)), drag = null;
  const desktop = () => matchMedia('(min-width: 761px)').matches;
  const max = () => Math.max(min, Math.min(420, window.innerWidth - 440));
  const sync = () => {
   handle.setAttribute('aria-valuemin', min);
   handle.setAttribute('aria-valuemax', max());
   handle.setAttribute('aria-valuenow', Math.round(sidebar.getBoundingClientRect().width));
  };
  const apply = value => {
   preferred = value;
   if (value == null) document.documentElement.style.removeProperty('--rd-nav-width');
   else document.documentElement.style.setProperty('--rd-nav-width', value + 'px');
   sync();
  };
  const set = value => apply(Math.round(Math.max(min, Math.min(max(), value))));
  const finish = commit => {
   if (!drag) return;
   const previous = drag; drag = null;
   document.body.classList.remove('rd-resizing-nav');
   if (!commit) apply(previous.preferred);
   else RD.storage.set(key, preferred);
   if (handle.hasPointerCapture(previous.id)) handle.releasePointerCapture(previous.id);
  };
  apply(preferred);
  handle.addEventListener('pointerdown', event => {
   if (event.button !== 0 || !desktop() || drag) return;
   event.preventDefault();
   drag = { id: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width, preferred };
   handle.setPointerCapture(event.pointerId);
   handle.focus({ preventScroll: true });
   document.body.classList.add('rd-resizing-nav');
  });
  handle.addEventListener('pointermove', event => {
   if (drag?.id === event.pointerId) set(drag.width + event.clientX - drag.x);
  });
  handle.addEventListener('pointerup', event => { if (drag?.id === event.pointerId) finish(true); });
  handle.addEventListener('pointercancel', () => finish(false));
  handle.addEventListener('lostpointercapture', () => finish(false));
  handle.addEventListener('dblclick', () => {
   if (!desktop()) return;
   finish(false); apply(null); RD.storage.set(key, null);
  });
  handle.addEventListener('keydown', event => {
   if (!desktop()) return;
   if (event.key === 'Escape' && drag) { event.preventDefault(); finish(false); return; }
   const width = sidebar.getBoundingClientRect().width, step = event.shiftKey ? 40 : 10;
   const value = { ArrowLeft: width - step, ArrowRight: width + step, Home: min, End: max() }[event.key];
   if (value == null) return;
   event.preventDefault(); set(value); RD.storage.set(key, preferred);
  });
  window.addEventListener('blur', () => finish(false));
  window.addEventListener('resize', () => { finish(false); sync(); });
  window.addEventListener('storage', event => {
   if (event.key === 'routerdeck.' + key && !drag) apply(valid(RD.storage.get(key, null)));
  });
 };
 RD.init = function () {
  RD.initSidebarResize();
  RD.initValidation();
  RD.theme(document.documentElement.dataset.theme);
  document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => RD.theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')));
  const toggle = document.getElementById('rd-menu-toggle'), backdrop = document.getElementById('rd-backdrop'), sidebar = document.getElementById('rd-sidebar');
  const close = () => { document.body.classList.remove('rd-nav-open'); toggle?.setAttribute('aria-expanded', 'false'); if (backdrop) backdrop.hidden = true; };
  toggle?.addEventListener('click', () => {
   if (document.body.classList.contains('rd-nav-open')) return close();
   document.body.classList.add('rd-nav-open'); toggle.setAttribute('aria-expanded', 'true'); backdrop.hidden = false;
   document.getElementById('rd-menu-search')?.focus();
  });
  backdrop?.addEventListener('click', close);
  sidebar?.addEventListener('click', event => { if (event.target.closest('a')) close(); });
  document.addEventListener('keydown', event => {
   if (event.key === 'Escape' && document.body.classList.contains('rd-nav-open')) { close(); toggle?.focus(); }
   if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (matchMedia('(max-width: 760px)').matches && !document.body.classList.contains('rd-nav-open')) toggle?.click();
    document.getElementById('rd-menu-search')?.focus();
   }
  });
  // Keep navigation search separate from LuCI's unowned password inputs.
  // It filters locally and must never submit a page or a password form.
  document.getElementById('rd-menu-search-form')?.addEventListener('submit', event => event.preventDefault());
  let searchScrollTop = null;
  document.getElementById('rd-menu-search')?.addEventListener('input', event => {
   const query = event.target.value.trim().toLowerCase();
   const navigation = document.getElementById('rd-navigation');
   if (query && searchScrollTop == null) searchScrollTop = navigation?.scrollTop ?? 0;
   document.querySelectorAll('.rd-nav-group').forEach(group => {
    let matches = 0;
    group.querySelectorAll('.rd-nav-item').forEach(row => { row.hidden = !row.querySelector('.rd-nav-link').textContent.toLowerCase().includes(query); if (!row.hidden) matches++; });
    group.hidden = matches === 0;
   });
   const message = document.getElementById('rd-no-results');
   if (message) message.hidden = !!document.querySelector('.rd-nav-group:not([hidden])');
   if (!query && searchScrollTop != null) {
    if (navigation) navigation.scrollTop = searchScrollTop;
    searchScrollTop = null;
   }
  });
  window.addEventListener('storage', event => { if (event.key === 'routerdeck.theme') RD.theme(event.newValue); });
 };
 RD.navigation = function (groups, active) {
  const el = RD.el, container = document.getElementById('rd-navigation');
  if (!container) return;
  const initialized = container.dataset.rdScrollReady === 'true';
  const storageKey = 'routerdeck.navigation.scroll';
  const topLevel = window.self === window.top;
  let scrollTop = initialized ? container.scrollTop : 0;
  if (!initialized && topLevel) {
   try {
    const saved = Number(sessionStorage.getItem(storageKey));
    if (Number.isFinite(saved) && saved >= 0) scrollTop = saved;
   } catch (_) {}
  }
  container.replaceChildren(...groups.map(group => el('section', { class: 'rd-nav-group' }, [
   el('h2', {}, group.title),
   ...group.items.map(item => el('div', { class: 'rd-nav-item' + (item.id === active ? ' active' : '') },
    el('a', { href: item.href, class: 'rd-nav-link', title: item.title, 'data-rd-page-navigation': '', 'aria-current': item.id === active ? 'page' : null }, [
     el('span', { class: 'rd-nav-symbol', 'aria-hidden': 'true' }, RD.icon(item.icon || RD.menuIconName(item.id))), el('span', { class: 'rd-nav-label' }, item.title)
    ])))
  ])), el('p', { id: 'rd-no-results', class: 'rd-muted', hidden: '' }, 'No matching pages'));
  RD.windows?.decorateNavigation?.(container);
  container.scrollTop = scrollTop;
  // Move only the sidebar, and only when its active link is outside the viewport.
  const current = container.querySelector('[aria-current="page"]');
  if (current) {
   const viewport = container.getBoundingClientRect(), link = current.getBoundingClientRect();
   if (link.top < viewport.top) container.scrollTop -= viewport.top - link.top + 8;
   else if (link.bottom > viewport.bottom) container.scrollTop += link.bottom - viewport.bottom + 8;
  }
  if (!initialized) {
   const remember = () => {
    // Embedded workspace pages share storage with their parent but have no visible menu.
    if (!topLevel || document.getElementById('rd-menu-search')?.value.trim()) return;
    try { sessionStorage.setItem(storageKey, String(container.scrollTop)); } catch (_) {}
   };
   container.addEventListener('scroll', remember, { passive: true });
   container.addEventListener('click', remember, { capture: true });
   window.addEventListener('pagehide', remember);
   container.dataset.rdScrollReady = 'true';
  }
 };
 RD.badge = (label, kind = 'neutral') => RD.el('span', { class: 'rd-badge rd-' + kind }, label);
})(globalThis);
