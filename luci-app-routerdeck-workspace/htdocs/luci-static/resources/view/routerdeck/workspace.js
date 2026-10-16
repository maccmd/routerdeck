'use strict';
'require view';
'require ui';

function script(path) {
 return new Promise((resolve, reject) => {
  const tag = E('script', { src: L.resource('../routerdeck/' + path) });
  tag.onload = resolve; tag.onerror = reject; document.head.appendChild(tag);
 });
}
return view.extend({
 load: function () {
  document.head.appendChild(E('link', { rel: 'stylesheet', href: L.resource('../routerdeck/workspace.css') }));
  return (window.RouterDeck ? Promise.resolve() : script('core.js'))
   .then(() => script('workspace.js')).then(() => ui.menu.load());
 },
 render: function (tree) {
  const pages = [];
  function visit(node, path, titles) {
   for (const child of ui.menu.getChildren(node)) {
    const route = path.concat(child.name), labels = titles.concat(_(child.title));
    if (child.action?.type === 'view' && child.action.path !== 'routerdeck/workspace')
     pages.push({ title: labels.join(' / '), href: L.url(...route) });
    visit(child, route, labels);
   }
  }
  visit(tree.children?.admin || {}, ['admin'], []);
  return RouterDeck.workspace(pages, { frameStyle: L.resource('../routerdeck/workspace-frame.css'), storageKey: 'workspace' });
 },
 handleSaveApply: null, handleSave: null, handleReset: null
});
