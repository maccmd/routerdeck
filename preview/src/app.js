/* SPDX-License-Identifier: Apache-2.0 */
(async function () {
 'use strict';
 const RD = RouterDeck, el = RD.el;
 const [device, menu] = await Promise.all(['/preview/mocks/device.json', '/preview/mocks/menu.json'].map(path => fetch(path).then(response => response.json())));
 device.history = Array.from({ length: 40 }, (_, index) => ({ rx: (320 + Math.sin(index * .7) * 120 + Math.cos(index * .3) * 190) * 1024, tx: (90 + Math.sin(index * .4) * 65) * 1024 }));
 let interfaces = structuredClone(device.interfaces);
 let rules = [{ name: 'Allow established connections', source: 'Any', destination: 'Any', protocol: 'Any', action: 'Accept' }, { name: 'Allow LAN to WAN', source: 'lan', destination: 'wan', protocol: 'Any', action: 'Accept' }, { name: 'Block unsolicited WAN traffic', source: 'wan', destination: 'Device', protocol: 'Any', action: 'Drop' }];
 const view = document.getElementById('preview-view');
 const entity = (kind, name, label = name) => el('a', { class: 'rd-entity-link', href: '/?rd=' + encodeURIComponent(kind + ':' + name) + '#interfaces' }, label);
 function enhanceDashboard() {
  const destinations = { interfaces: 'interfaces', devices: 'interfaces', firewall: 'firewall', system: 'system', logs: 'logs' };
  view.querySelectorAll('[data-rd-page]:not([data-rd-linked])').forEach(node => {
   const destination = destinations[node.dataset.rdPage];
   if (destination) { const link = el('a', { href: '#' + destination }, node.textContent); node.replaceChildren(link); }
   node.dataset.rdLinked = 'true';
  });
  view.querySelectorAll('[data-rd-entity]:not([data-rd-linked])').forEach(node => { node.replaceChildren(entity(node.dataset.rdEntity, node.dataset.rdName)); node.dataset.rdLinked = 'true'; });
  view.querySelectorAll('[data-rd-client]:not([data-rd-linked]), [data-rd-address]:not([data-rd-linked])').forEach(node => {
   const label = node.textContent; node.dataset.rdLinked = 'true';
   const lease = device.leases.find(item => [item.mac, item.duid, item.ip].filter(Boolean).includes(node.dataset.rdClient || label));
   if (!lease) return;
   node.replaceChildren(el('button', { type: 'button', class: 'rd-text-action', onclick: () => RD.windows.content('Client · ' + (lease.hostname || lease.ip), el('div', { class: 'rd-details' }, [
    el('dl', {}, Object.entries(lease).filter(([, value]) => value != null).flatMap(([key, value]) => [el('dt', {}, key), el('dd', {}, String(value))])),
    el('a', { href: '#interfaces' }, 'Interfaces')
   ]), 'client:' + lease.ip) }, label));
  });
 }
 const heading = (title, description) => el('div', { class: 'rd-page-heading' }, el('div', {}, [el('div', { class: 'rd-eyebrow' }, 'Preview / ' + title), el('h1', {}, title), el('p', {}, description)]));
 function notice(message) { view.prepend(el('div', { role: 'status', class: 'alert-message success' }, message)); }
 function dialog(title, fields, save) {
  const trigger = document.activeElement, form = el('form', {}), dlg = el('dialog', { 'aria-label': title }, [el('h2', {}, title), form]);
  for (const field of fields) {
   const input = field.options ? el('select', { name: field.name }, field.options.map(option => el('option', { value: option, selected: option === field.value ? '' : null }, option))) : el('input', { name: field.name, value: field.value || '', required: field.required ? '' : null, pattern: field.pattern, maxlength: '128' });
   form.append(el('label', { class: 'rd-field' }, [field.label, input]));
  }
  form.append(el('p', { class: 'rd-muted' }, 'Preview only. Nothing is sent to a router.'), el('div', { class: 'rd-dialog-actions' }, [el('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'), el('button', { type: 'submit', class: 'btn rd-primary cbi-button-save' }, 'Save preview')]));
  form.addEventListener('submit', event => { event.preventDefault(); save(Object.fromEntries(new FormData(form))); document.dispatchEvent(new Event('rd-preview-saved')); dlg.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); if (trigger?.isConnected) trigger.focus(); });
  document.body.append(dlg); dlg.showModal();
 }
 function renderInterfaces() {
  view.replaceChildren(heading('Interfaces', 'Logical interfaces and their current network state.'),
   el('div', { class: 'rd-toolbar' }, [RD.badge(interfaces.length + ' interfaces'), el('span', { class: 'rd-spacer' }), el('button', { class: 'btn rd-primary', onclick: () => editInterface() }, '+ Add interface')]),
   el('section', { class: 'rd-panel' }, RD.table(['Interface', 'Status', 'Protocol', 'Address', 'Device', 'Actions'], interfaces.map(iface => [entity('interface', iface.name), RD.badge(iface.up ? 'Up' : 'Down', iface.up ? 'success' : 'neutral'), iface.protocol, el('span', { class: 'rd-mono' }, iface.address), entity('device', iface.device), el('button', { class: 'btn', 'aria-label': 'Edit ' + iface.name, onclick: () => editInterface(iface) }, 'Edit')]))));
 }
 function editInterface(iface) {
  dialog(iface ? 'Edit ' + iface.name : 'Add interface', [
   { name: 'name', label: 'Interface name', value: iface?.name, required: true, pattern: '[A-Za-z0-9_\\-]{1,15}' },
   { name: 'protocol', label: 'Protocol', value: iface?.protocol || 'static', options: ['static', 'dhcp', 'dhcpv6', 'pppoe', 'wireguard'] },
   { name: 'address', label: 'Address / prefix (preview)', value: iface?.address },
   { name: 'device', label: 'Device', value: iface?.device || 'eth1' }
  ], values => {
   if (iface) Object.assign(iface, values); else interfaces.push({ ...values, up: false });
   renderInterfaces(); notice('Saved in preview memory. No router configuration was changed.');
  });
 }
 function renderFirewall() {
  view.replaceChildren(heading('Firewall', 'Traffic policy · simulated rules'), el('div', { class: 'rd-toolbar' }, [RD.badge(rules.length + ' rules'), el('span', { class: 'rd-spacer' }), el('button', { class: 'btn rd-primary', onclick: () => dialog('Add firewall rule', [
   { name: 'name', label: 'Rule name', required: true }, { name: 'source', label: 'Source zone', options: ['lan', 'wan', 'Any'] }, { name: 'destination', label: 'Destination zone', options: ['wan', 'lan', 'Device'] }, { name: 'action', label: 'Action', options: ['Accept', 'Drop', 'Reject'] }
  ], values => { rules.push({ ...values, protocol: 'Any' }); renderFirewall(); notice('Preview rule added.'); }) }, '+ Add rule')]), el('section', { class: 'rd-panel' }, RD.table(['Rule', 'Source', 'Destination', 'Protocol', 'Action'], rules.map(rule => [rule.name, rule.source, rule.destination, rule.protocol, RD.badge(rule.action, rule.action === 'Accept' ? 'success' : 'danger')]))));
 }
 function renderSystem() {
  const form = el('form', { class: 'cbi-map' }, [el('section', { class: 'cbi-section' }, [el('h3', {}, 'General settings'), el('label', { class: 'rd-field' }, ['Hostname', el('input', { name: 'hostname', value: device.hostname, required: '', pattern: '[A-Za-z0-9\\-]{1,63}' })]), el('label', { class: 'rd-field' }, ['Timezone', el('select', { name: 'timezone' }, ['UTC', 'Asia/Vladivostok', 'Europe/Berlin'].map(zone => el('option', {}, zone)))])]), el('div', { class: 'cbi-page-actions' }, el('button', { type: 'submit', class: 'btn rd-primary cbi-button-save' }, 'Save preview'))]);
  form.addEventListener('submit', event => { event.preventDefault(); device.hostname = new FormData(form).get('hostname'); document.querySelector('.rd-device strong').textContent = device.hostname; document.dispatchEvent(new Event('rd-preview-saved')); notice('Preview settings saved.'); });
  view.replaceChildren(heading('System settings', 'A preview of LuCI form components.'), form);
 }
 function render() {
  const page = location.hash.slice(1) || 'dashboard';
  RD.navigation(menu, page);
  const search = document.getElementById('rd-menu-search');
  if (search?.value) search.dispatchEvent(new Event('input', { bubbles: true }));
  if (page === 'interfaces') renderInterfaces();
  else if (page === 'firewall') renderFirewall();
  else if (page === 'system') renderSystem();
  else if (page === 'logs') view.replaceChildren(heading('System log', 'Simulated events for visual inspection.'), el('pre', { tabindex: '0' }, '12:45:03  netifd   Interface wan is now up\n12:45:03  udhcpc   Lease of 203.0.113.42 obtained\n12:45:04  dnsmasq  DHCPACK br-lan 192.0.2.101 studio-macbook\n12:45:05  firewall Reloading firewall due to ifup of wan\n12:45:06  system   All entries shown here are mock data.'));
  else { view.replaceChildren(RD.dashboard(device)); enhanceDashboard(); }
 }
 RD.init(); RD.initWindows(menu.flatMap(group => group.items).map(item => ({ title: item.title, href: '/' + item.href })), { preview: true, storageKey: 'windows-preview' });
 render(); window.addEventListener('hashchange', render);
 const target = new URLSearchParams(location.search).get('rd');
 if (target?.startsWith('interface:')) {
  const iface = interfaces.find(item => item.name === target.slice(10)); if (iface) editInterface(iface);
 } else if (target?.startsWith('device:')) {
  const name = target.slice(7);
  const associated = interfaces.filter(item => item.device === name);
  RD.windows.content('Device · ' + name, el('div', { class: 'rd-details' }, [el('p', {}, 'Preview device: ' + name), ...associated.map(iface => entity('interface', iface.name))]), 'device:' + name);
 }
 setInterval(() => {
  if (document.hidden || (location.hash && location.hash !== '#dashboard')) return;
  device.uptime += 5; const index = device.history.length;
  device.history.push({ rx: (350 + Math.sin(index * .7) * 150) * 1024, tx: (90 + Math.sin(index * .4) * 65) * 1024 });
  if (device.history.length > 60) device.history.shift();
  RD.updateDashboard(view.querySelector('.rd-dashboard'), device); enhanceDashboard();
 }, 5000);
})();
