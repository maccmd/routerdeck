// SPDX-License-Identifier: Apache-2.0
// Opening windows from menus, lists and keyboard shortcuts.
import { manager } from '../state.js';
import { focusWindow } from '../mdi/focus.js';
import { MODELS } from '../model/index.js';

export function openWindow(kind) {
 focusWindow(manager.open(kind));
}

// One window per existing object; every "new" window is separate.
export function openItem(modelId, row = null, extra = {}) {
 const model = MODELS[modelId];
 const title = row ? model.itemTitle(row) : `New ${extra.addType ? model.addTypes?.find(type => type.id === extra.addType)?.label ?? model.noun : model.noun}`;
 const id = manager.open('item', null, {
  params: { model: modelId, key: row?.key ?? null, ...extra },
  title,
  instance: row ? `${modelId}:${row.key}` : undefined,
  geometry: 'item.' + modelId
 });
 focusWindow(id);
 return id;
}

// A package operation or a script, with its output in its own window.
// `attach` shows a job that is already running.
export function openJob({ title, task = null, attach = null }) {
 const id = manager.open('job', null, { params: { task, id: attach }, title, instance: attach ? `job:${attach}` : undefined, geometry: 'job' });
 focusWindow(id);
 return id;
}
