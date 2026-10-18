import test from 'node:test';
import assert from 'node:assert/strict';
import { clampRect, moveRect, resizeRect, cascadeRect, minimizedRect, CASCADE_STEP, MIN_SIZE } from '../../console/src/mdi/geometry.js';
import { createWindowManager } from '../../console/src/mdi/manager.js';
import { createStorage, memoryStorage } from '../../console/src/lib/storage.js';
import { MENU, visibleMenu } from '../../console/src/shell/menu.js';
import { WINDOW_KINDS } from '../../console/src/windows/kinds.js';
import * as format from '../../console/src/lib/format.js';

const area = { w: 1000, h: 600 };
const kinds = { list: { title: 'List', size: { w: 400, h: 300 } }, other: { title: 'Other', size: { w: 300, h: 200 } }, term: { title: 'Terminal', size: { w: 500, h: 300 }, multi: true } };
const manager = (storage = createStorage(memoryStorage())) => createWindowManager({ kinds, storage, area });

test('windows stay inside the work area', () => {
 assert.deepEqual(clampRect({ x: -50, y: 900, w: 400, h: 300 }, area), { x: 0, y: 300, w: 400, h: 300 });
 assert.deepEqual(clampRect({ x: 0, y: 0, w: 5000, h: 10 }, area), { x: 0, y: 0, w: 1000, h: MIN_SIZE.h });
 assert.deepEqual(moveRect({ x: 100, y: 100, w: 400, h: 300 }, 900, -500, area), { x: 600, y: 0, w: 400, h: 300 });
});

test('edges resize from the dragged side and respect the minimum size', () => {
 const start = { x: 100, y: 100, w: 400, h: 300 };
 assert.deepEqual(resizeRect(start, 'se', 50, 40, area), { x: 100, y: 100, w: 450, h: 340 });
 assert.deepEqual(resizeRect(start, 'w', -200, 0, area), { x: 0, y: 100, w: 500, h: 300 });
 assert.deepEqual(resizeRect(start, 'nw', 1000, 1000, area), { x: 500 - MIN_SIZE.w, y: 400 - MIN_SIZE.h, w: MIN_SIZE.w, h: MIN_SIZE.h });
 assert.deepEqual(resizeRect(start, 'e', 2000, 0, area), { x: 100, y: 100, w: 900, h: 300 });
});

test('cascade steps down-right and wraps when the next window would not fit', () => {
 assert.deepEqual(cascadeRect({ w: 400, h: 300 }, null, area), { x: 0, y: 0, w: 400, h: 300 });
 assert.deepEqual(cascadeRect({ w: 400, h: 300 }, { x: 24, y: 24 }, area), { x: 24 + CASCADE_STEP, y: 24 + CASCADE_STEP, w: 400, h: 300 });
 assert.deepEqual(cascadeRect({ w: 400, h: 300 }, { x: 590, y: 290 }, area), { x: 0, y: 0, w: 400, h: 300 });
 assert.deepEqual(minimizedRect(6, { w: 1000, h: 600 }), { x: 180, y: 548, w: 180, h: 26 });
});

test('opening a window never moves the windows already open', () => {
 const mdi = manager();
 const first = mdi.open('list');
 mdi.setRect(first, { x: 300, y: 200, w: 400, h: 300 });
 const before = mdi.list().find(win => win.id === first);
 mdi.open('other');
 mdi.open('term');
 const after = mdi.list().find(win => win.id === first);
 assert.deepEqual([after.x, after.y, after.w, after.h], [before.x, before.y, before.w, before.h]);
 assert.equal(mdi.list().length, 3);
});

test('single-instance kinds focus their window; terminals open again and cascade', () => {
 const mdi = manager();
 const list = mdi.open('list');
 mdi.open('other');
 assert.equal(mdi.open('list'), list);
 assert.equal(mdi.active().id, list);
 const one = mdi.open('term'), two = mdi.open('term');
 assert.notEqual(one, two);
 const [a, b] = [one, two].map(id => mdi.list().find(win => win.id === id));
 assert.notDeepEqual([a.x, a.y], [b.x, b.y]);
});

test('minimize, restore, maximize and close keep a sensible active window', () => {
 const mdi = manager();
 const a = mdi.open('list'), b = mdi.open('other');
 mdi.minimize(b);
 assert.equal(mdi.active().id, a);
 mdi.activate(b);
 assert.equal(mdi.list().find(win => win.id === b).minimized, false);
 mdi.toggleMaximize(a);
 assert.equal(mdi.active().id, a);
 assert.equal(mdi.list().find(win => win.id === a).maximized, true);
 mdi.close(a);
 assert.equal(mdi.active().id, b);
 mdi.cycle();
 assert.equal(mdi.active().id, b);
});

test('geometry is remembered per kind and the workspace is restored', () => {
 const storage = createStorage(memoryStorage());
 const first = manager(storage);
 const id = first.open('list');
 first.setRect(id, { x: 120, y: 80, w: 500, h: 320 });
 first.commit(id);
 first.open('other');
 first.minimize(first.list()[1].id);
 const second = manager(storage);
 second.restore();
 const restored = second.list();
 assert.deepEqual(restored.map(win => win.kind), ['list', 'other']);
 assert.deepEqual(['x', 'y', 'w', 'h'].map(key => restored[0][key]), [120, 80, 500, 320]);
 assert.equal(restored[1].minimized, true);
 second.close(restored[0].id);
 const reopenedId = second.open('list');
 const reopened = second.list().find(win => win.id === reopenedId);
 assert.deepEqual(['x', 'y', 'w', 'h'].map(key => reopened[key]), [120, 80, 500, 320]);
});

test('a smaller work area pulls windows back inside without saving that', () => {
 const storage = createStorage(memoryStorage());
 const mdi = manager(storage);
 const id = mdi.open('list');
 mdi.setRect(id, { x: 580, y: 280, w: 400, h: 300 });
 mdi.commit(id);
 mdi.setArea({ w: 700, h: 500 });
 const win = mdi.list()[0];
 assert.deepEqual([win.x, win.y], [300, 200]);
 assert.deepEqual(storage.get('geometry.list'), { x: 580, y: 280, w: 400, h: 300 });
});

test('corrupt or unknown saved workspace entries are ignored', () => {
 const storage = createStorage(memoryStorage());
 storage.set('workspace', [{ kind: 'gone', x: 0, y: 0, w: 1, h: 1 }, { kind: 'list', x: 'a' }, null]);
 const mdi = manager(storage);
 mdi.restore();
 assert.equal(mdi.list().length, 0);
 const broken = createStorage({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
 assert.equal(broken.get('workspace', 'fallback'), 'fallback');
 assert.doesNotThrow(() => broken.set('workspace', []));
});

test('menu items open known window kinds and hide missing capabilities', () => {
 const items = MENU.flatMap(item => item.children ?? [item]).filter(item => item.window);
 assert.ok(items.every(item => WINDOW_KINDS[item.window]));
 assert.equal(visibleMenu(MENU, {}).some(item => item.id === 'luci'), false);
 assert.equal(visibleMenu(MENU, { luci: true }).some(item => item.id === 'luci'), true);
 assert.deepEqual(visibleMenu(MENU).find(item => item.id === 'ip').children.map(item => item.label), ['Addresses', 'Routes', 'Firewall', 'DHCP Server', 'DNS']);
});

test('status values distinguish missing data from zero', () => {
 assert.equal(format.uptime(undefined), '—');
 assert.equal(format.uptime(59), '00:00:59');
 assert.equal(format.uptime(90061), '1d 01:01:01');
 assert.equal(format.load(0), '0.00');
 assert.equal(format.load(7864), '0.12');
 assert.equal(format.memoryUsage({ total: 100, available: 25 }), '75%');
 assert.equal(format.memoryUsage({}), '—');
 assert.equal(format.bytes(1536), '1.5 KiB');
});
