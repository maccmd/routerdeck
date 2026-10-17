import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('../../luci-theme-routerdeck/ucode/template/themes/routerdeck/navigation.ut', import.meta.url), 'utf8');
const source = template.match(/<script>([\s\S]*)<\/script>/)[1];
const tree = { children: { admin: { children: { status: { title: 'Status', children: {
 dashboard: { title: 'Dashboard', action: { type: 'view', path: 'routerdeck/dashboard' } }
} } } } } };

function setup(fetchMenu) {
 const element = tag => ({ tag, children: [], attributes: {}, listeners: {},
  setAttribute(key, value) { this.attributes[key] = value; },
  addEventListener(name, callback) { this.listeners[name] = callback; },
  replaceChildren(...nodes) { this.children = nodes; }
 });
 const navigation = element('nav'), tabs = element('div');
 const state = { attempts: 0, rendered: 0, initialized: 0, reloads: 0, filters: 0 };
 const menu = {
  menu: null,
  // Like LuCI, a failed request remains cached until explicitly invalidated.
  load() { return this.menu ??= Promise.resolve().then(() => fetchMenu(++state.attempts)); },
  getChildren(node) { return Object.entries(node.children || {}).map(([name, child]) => ({ ...child, name })); }
 };
 const search = { value: 'dash', dispatchEvent() { state.filters++; } };
 const context = vm.createContext({
  console: { warn() {} }, URL, Event,
  setTimeout: (callback, ms) => setTimeout(callback, ms >= 1000 ? 30 : 1), clearTimeout,
  document: {
   scripts: [], hidden: false,
   getElementById: id => ({ 'rd-navigation': navigation, tabmenu: tabs, 'rd-menu-search': search })[id],
   createElement: element
  },
  location: { reload() { state.reloads++; } },
  _: value => value,
  RouterDeck: {
   init() { state.initialized++; },
   navigation(groups) { state.rendered++; state.groups = groups; navigation.replaceChildren(element('a')); },
   initWindows(pages) { state.pages = pages; }
  },
  L: {
   loaded: true, env: { dispatchpath: ['admin', 'status', 'dashboard'] },
   url: (...path) => '/cgi-bin/luci/' + path.join('/'),
   require: name => name === 'ui' ? Promise.resolve({ menu }) : Promise.reject(new Error('Optional module unavailable'))
  }
 });
 context.window = context;
 vm.runInContext(source, context);
 return { state, navigation, context };
}

async function until(condition) {
 const end = Date.now() + 2000;
 while (!condition()) {
  if (Date.now() > end) assert.fail('Navigation did not reach the expected state');
  await new Promise(resolve => setTimeout(resolve, 2));
 }
}
const retryButton = nav => nav.children.find(node => node.tag === 'button');

test('navigation retries a cached rejected menu request and keeps optional failures independent', async () => {
 const { state, navigation } = setup(attempt => attempt === 1 ? Promise.reject(new Error('Connection reset')) : tree);
 await until(() => state.rendered === 1);
 assert.equal(state.attempts, 2);
 assert.equal(state.initialized, 1);
 assert.equal(state.filters, 1, 'search entered during loading is reapplied');
 assert.equal(navigation.attributes['aria-busy'], 'false');
 assert.equal(state.groups[0].items[0].href, '/cgi-bin/luci/admin/status/dashboard');
 assert.equal(state.reloads, 0);
});

test('three failures expose Retry; retry recovers in place and repeated clicks do not duplicate requests', async () => {
 let offline = true;
 const { state, navigation } = setup(() => offline ? Promise.reject(new Error('Offline')) : tree);
 await until(() => retryButton(navigation));
 assert.equal(state.attempts, 3);
 assert.equal(navigation.attributes['aria-busy'], 'false');
 assert.equal(navigation.children[0].textContent, 'Navigation could not be loaded.');
 offline = false;
 const retry = retryButton(navigation).listeners.click;
 retry(); retry();
 await until(() => state.rendered === 1);
 assert.equal(state.attempts, 4);
 assert.equal(state.initialized, 1);
 assert.equal(state.reloads, 0);
});

test('a request that never settles cannot leave the navigation loading forever', async () => {
 const { state, navigation } = setup(() => new Promise(() => {}));
 await until(() => retryButton(navigation));
 assert.equal(state.attempts, 3);
 assert.equal(state.rendered, 0);
 assert.equal(navigation.attributes['aria-busy'], 'false');
});

test('window menu includes the stock Overview template but excludes call endpoints and other templates', async () => {
 const menu = structuredClone(tree);
 Object.assign(menu.children.admin.children.status.children, {
  overview: { title: 'Overview', action: { type: 'template', path: 'admin_status/index' } },
  action: { title: 'Action', action: { type: 'call', path: 'example' } },
  other: { title: 'Other template', action: { type: 'template', path: 'example' } }
 });
 const { state } = setup(() => menu);
 await until(() => state.pages);
 const paths = Array.from(state.pages, page => page.href);
 assert.ok(paths.includes('/cgi-bin/luci/admin/status/overview'));
 assert.ok(paths.includes('/cgi-bin/luci/admin/status/dashboard'));
 assert.ok(!paths.includes('/cgi-bin/luci/admin/status/action'));
 assert.ok(!paths.includes('/cgi-bin/luci/admin/status/other'));
});

test('late core asset execution preserves the initialized theme and extensions', async () => {
 const core = await readFile(new URL('../../luci-theme-routerdeck/htdocs/luci-static/routerdeck/core.js', import.meta.url), 'utf8');
 const context = vm.createContext({});
 vm.runInContext(core, context);
 const original = context.RouterDeck;
 original.dashboard = () => 'existing renderer';
 vm.runInContext(core, context);
 assert.equal(context.RouterDeck, original);
 assert.equal(context.RouterDeck.dashboard(), 'existing renderer');
});
