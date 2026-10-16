'use strict';
'require baseclass';
'require ui';
'require rpc';
'require poll';

const board = rpc.declare({ object: 'system', method: 'board', expect: { '': {} } });
const info = rpc.declare({ object: 'system', method: 'info', expect: { '': {} } });
const interfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { interface: [] } });

return baseclass.extend({
 __init__: function () {
  RouterDeck.init();
  ui.menu.load().then(tree => this.render(tree)).catch(() => {
   document.getElementById('rd-navigation').replaceChildren(E('p', {}, _('Navigation unavailable. Reload this page.')));
  });
  // Poll only methods already permitted by the logged-in user's ACLs.
  const update = () => {
   if (document.hidden) return Promise.resolve();
   return Promise.all([L.resolveDefault(info(), {}), L.resolveDefault(interfaces(), [])]).then(([system, nets]) => {
    const memory = system.memory, wan = nets.find(net => (net.route || []).some(route => route.target === '0.0.0.0' && route.mask === 0));
    const values = [
     ['Uptime', RouterDeck.uptime(system.uptime)],
     ['Load', Array.isArray(system.load) ? (system.load[0] / 65536).toFixed(2) : '—'],
     ['RAM', memory?.total ? Math.round(100 * (memory.total - (memory.available ?? memory.free)) / memory.total) + '%' : '—'],
     ['WAN', wan ? (wan.up ? 'Up' : 'Down') : '—']
    ];
    document.getElementById('rd-header-stats')?.replaceChildren(...values.map(([label, value]) => E('span', {}, [E('small', {}, label), E('strong', {}, value)])));
   });
  };
  update();
  poll.add(update, 10);
 },
 render: function (tree) {
  const mode = L.env.dispatchpath[0] || 'admin';
  const current = L.env.dispatchpath.slice(0, 3).join('/');
  const symbols = { overview: '▦', dashboard: '▦', workspace: '▣', interfaces: '⇄', firewall: '⬡', wireless: '◉', routes: '⑂', routesj: '⑂', dhcp: '⇌', system: '⚙', admin: '♙', packages: '▤', startup: '▷', processes: '≋', logs: '≡', reboot: '⏻', flash: '↥' };
  const groups = ui.menu.getChildren(tree.children?.[mode] || tree).map(group => {
   const children = ui.menu.getChildren(group);
   return { title: _(group.title), items: (children.length ? children : [group]).map(child => {
    const path = children.length ? [mode, group.name, child.name] : [mode, child.name];
    return { id: path.join('/'), href: L.url(...path), title: _(child.title), symbol: symbols[child.name] || '◇' };
   }) };
  });
  // Preserve alternate LuCI modes supplied by installed applications.
  const modes = ui.menu.getChildren(tree).filter(child => child.name !== mode);
  if (modes.length) groups.push({ title: _('Other modes'), items: modes.map(child => ({ id: child.name, href: L.url(child.name), title: _(child.title) })) });
  RouterDeck.navigation(groups, current);
  let node = tree;
  L.env.dispatchpath.slice(0, 3).forEach(segment => { node = node?.children?.[segment]; });
  if (node) this.tabs(node, L.env.dispatchpath.slice(0, 3), 3);
 },
 tabs: function (node, path, depth) {
  const children = ui.menu.getChildren(node);
  if (!children.length) return;
  const container = document.getElementById('tabmenu');
  container.style.display = '';
  container.appendChild(E('ul', { class: 'tabs' }, children.map(child => E('li', { class: L.env.dispatchpath[depth] === child.name ? 'active' : '' }, E('a', { href: L.url(...path, child.name) }, _(child.title))))));
  const active = children.find(child => child.name === L.env.dispatchpath[depth]);
  if (active) this.tabs(active, path.concat(active.name), depth + 1);
 }
});
