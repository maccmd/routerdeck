// SPDX-License-Identifier: Apache-2.0
// MDI window state. Windows open where their kind was last placed, cascade
// when that spot is taken, and never rearrange other windows on their own.

import { cascadeRect, clampRect } from './geometry.js';

const isRect = rect => !!rect && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key]));

export function createWindowManager({ kinds, storage, area = { w: 1024, h: 640 } }) {
 let windows = [], z = 0, serial = 0;
 const listeners = new Set();

 const emit = () => listeners.forEach(listener => listener(windows));
 const find = id => windows.find(win => win.id === id);
 const patch = (id, values) => { windows = windows.map(win => win.id === id ? { ...win, ...values } : win); };
 const latest = () => windows.reduce((last, win) => !last || win.opened > last.opened ? win : last, null);
 const saveWorkspace = () => storage.set('workspace', windows
  .slice().sort((a, b) => a.z - b.z)
  .map(({ kind, x, y, w, h, minimized, maximized, params, title, instance, geometry }) => ({ kind, x, y, w, h, minimized, maximized, params, title, instance, geometry })));

 function active() {
  return windows.filter(win => !win.minimized).reduce((top, win) => !top || win.z > top.z ? win : top, null);
 }

 function activate(id) {
  if (!find(id)) return;
  patch(id, { minimized: false, z: ++z });
  saveWorkspace();
  emit();
 }

 // `instance` makes a window unique (an object's item window); `geometry`
 // names whose remembered size and position it uses.
 function open(kind, saved = null, { params = saved?.params, title = saved?.title, instance = saved?.instance, geometry = saved?.geometry ?? kind } = {}) {
  const spec = kinds[kind];
  if (!spec) throw new Error('Unknown window kind: ' + kind);
  if (!saved && (instance || !spec.multi)) {
   const existing = windows.find(win => instance ? win.instance === instance : win.kind === kind);
   if (existing) {
    activate(existing.id);
    return existing.id;
   }
  }
  const remembered = saved ?? storage.get('geometry.' + geometry);
  const size = { w: remembered?.w ?? spec.size.w, h: remembered?.h ?? spec.size.h };
  let rect = isRect(remembered) ? clampRect({ ...remembered, ...size }, area) : cascadeRect(size, latest(), area);
  if (!saved) {
   // A second terminal must not hide exactly behind the first one.
   for (let step = 0; step < 50 && windows.some(win => win.x === rect.x && win.y === rect.y); step++) rect = cascadeRect(size, rect, area);
  }
  const id = kind + ':' + (++serial);
  windows = [...windows, { id, kind, title: title ?? spec.title, params, instance, geometry, ...rect, minimized: !!saved?.minimized, maximized: !!saved?.maximized, z: ++z, opened: serial }];
  saveWorkspace();
  emit();
  return id;
 }

 function close(id) {
  if (!find(id)) return;
  windows = windows.filter(win => win.id !== id);
  saveWorkspace();
  emit();
 }

 function minimize(id) {
  if (!find(id)) return;
  patch(id, { minimized: true });
  saveWorkspace();
  emit();
 }

 function toggleMaximize(id) {
  const win = find(id);
  if (!win) return;
  patch(id, { maximized: !win.maximized, minimized: false, z: ++z });
  saveWorkspace();
  emit();
 }

 // Live geometry while dragging; persisted only by commit().
 function setRect(id, rect) {
  if (!find(id) || !isRect(rect)) return;
  patch(id, clampRect(rect, area));
  emit();
 }

 function commit(id) {
  const win = find(id);
  if (!win) return;
  storage.set('geometry.' + (win.geometry ?? win.kind), { x: win.x, y: win.y, w: win.w, h: win.h });
  saveWorkspace();
 }

 function setArea(next) {
  if (!next || next.w <= 0 || next.h <= 0 || next.w === area.w && next.h === area.h) return;
  area = { w: Math.round(next.w), h: Math.round(next.h) };
  windows = windows.map(win => ({ ...win, ...clampRect(win, area) }));
  emit();
 }

 function update(id, values) {
  if (!find(id)) return;
  patch(id, values);
  saveWorkspace();
  emit();
 }

 // Explicit arrangement commands; opening windows never rearranges others.
 function cascadeAll() {
  let previous = null;
  for (const win of windows.slice().sort((a, b) => a.z - b.z)) {
   const rect = cascadeRect({ w: win.w, h: win.h }, previous, area);
   patch(win.id, { ...rect, minimized: false, maximized: false });
   previous = rect;
  }
  saveWorkspace();
  emit();
 }

 function tileAll() {
  const visible = windows.filter(win => !win.minimized).sort((a, b) => a.opened - b.opened);
  if (!visible.length) return;
  const columns = Math.ceil(Math.sqrt(visible.length)), rows = Math.ceil(visible.length / columns);
  visible.forEach((win, index) => {
   const column = index % columns, row = Math.floor(index / columns);
   const w = Math.floor(area.w / columns), h = Math.floor(area.h / rows);
   patch(win.id, { ...clampRect({ x: column * w, y: row * h, w, h }, area), maximized: false });
  });
  saveWorkspace();
  emit();
 }

 function minimizeAll() {
  windows = windows.map(win => ({ ...win, minimized: true }));
  saveWorkspace();
  emit();
 }

 function closeAll() {
  windows = [];
  saveWorkspace();
  emit();
 }

 function cycle(step = 1) {
  if (!windows.length) return;
  const ordered = windows.slice().sort((a, b) => a.opened - b.opened);
  const current = ordered.indexOf(active());
  const next = ordered[(current + step + ordered.length) % ordered.length];
  activate(next.id);
 }

 function restore() {
  const saved = storage.get('workspace', []);
  if (!Array.isArray(saved)) return;
  for (const item of saved) if (kinds[item?.kind] && isRect(item)) open(item.kind, item);
 }

 // Logout closes windows but keeps the remembered workspace for next login.
 function reset() {
  windows = [];
  emit();
 }

 return {
  open, close, minimize, toggleMaximize, activate, setRect, commit, setArea, cycle, restore, reset, active, update,
  cascadeAll, tileAll, minimizeAll, closeAll,
  get area() { return area; },
  list: () => windows,
  subscribe(listener) {
   listeners.add(listener);
   return () => listeners.delete(listener);
  }
 };
}
