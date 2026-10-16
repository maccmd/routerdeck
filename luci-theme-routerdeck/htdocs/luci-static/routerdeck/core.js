/* SPDX-License-Identifier: Apache-2.0 */
(function (root) {
 'use strict';
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
 RD.init = function () {
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
  document.getElementById('rd-menu-search')?.addEventListener('input', event => {
   const query = event.target.value.trim().toLowerCase();
   document.querySelectorAll('.rd-nav-group').forEach(group => {
    let matches = 0;
    group.querySelectorAll('a').forEach(link => { link.hidden = !link.textContent.toLowerCase().includes(query); if (!link.hidden) matches++; });
    group.hidden = matches === 0;
   });
   const message = document.getElementById('rd-no-results');
   if (message) message.hidden = !!document.querySelector('.rd-nav-group:not([hidden])');
  });
  window.addEventListener('storage', event => { if (event.key === 'routerdeck.theme') RD.theme(event.newValue); });
 };
 RD.navigation = function (groups, active) {
  const el = RD.el, container = document.getElementById('rd-navigation');
  if (!container) return;
  container.replaceChildren(...groups.map(group => el('section', { class: 'rd-nav-group' }, [
   el('h2', {}, group.title),
   ...group.items.map(item => el('a', { href: item.href, class: item.id === active ? 'active' : '', 'aria-current': item.id === active ? 'page' : null }, [
    el('span', { class: 'rd-nav-symbol', 'aria-hidden': 'true' }, item.symbol || '◇'), el('span', {}, item.title), item.id === active ? el('span', { class: 'rd-active-mark', 'aria-hidden': 'true' }, '•') : null
   ]))
  ])), el('p', { id: 'rd-no-results', class: 'rd-muted', hidden: '' }, 'No matching pages'));
 };
 RD.badge = (label, kind = 'neutral') => RD.el('span', { class: 'rd-badge rd-' + kind }, label);
})(globalThis);
