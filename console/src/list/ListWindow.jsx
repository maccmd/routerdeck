// SPDX-License-Identifier: Apache-2.0
// A list window: tabs, the + − ✓ ✗ comment toolbar, filter, Find, the grid
// and a status bar. Every change is applied at once through the plugin.
import { useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shell/icons.jsx';
import { Grid } from './Grid.jsx';
import { MODELS } from '../model/index.js';
import { useSources } from '../api/sources.js';
import { apply, errorText } from '../api/actions.js';
import { openItem } from '../windows/open.js';
import { openContextMenu, askText } from '../shell/overlays.jsx';
import { preferences, manager } from '../state.js';
import { ItemForm } from '../item/ItemWindow.jsx';
import { focusAfterClose } from '../mdi/focus.js';

function compare(column, a, b) {
 const key = column.sort ?? (value => value);
 const left = key(a.cells[column.id] ?? '', a), right = key(b.cells[column.id] ?? '', b);
 if (typeof left === 'number' && typeof right === 'number') return left - right;
 return String(left).localeCompare(String(right), undefined, { numeric: true });
}

function useModelView(model, active) {
 const sources = useSources(model.sources, active);
 const ready = !sources.loading && model.sources.every(key => sources.data[key] !== undefined);
 const rows = useMemo(() => ready ? model.rows(sources.data) : [], [ready, ...model.sources.map(key => sources.data[key])]);
 return { ...sources, ready, rows };
}

function TabList({ model, active, kind }) {
 const view = useModelView(model, active);
 const [selection, setSelection] = useState(() => new Set());
 const [find, setFind] = useState('');
 const [filter, setFilter] = useState(model.filter?.default ?? null);
 const [sort, setSort] = useState(model.defaultSort ? { id: model.defaultSort, dir: 'asc' } : null);
 const [hidden, setHidden] = useState(() => new Set(preferences.get('columns.' + model.id, model.columns.filter(column => column.hidden).map(column => column.id))));
 const [error, setError] = useState(null);
 const [busy, setBusy] = useState(false);
 const findRef = useRef(), gridRef = useRef();

 const columns = model.columns.filter(column => !hidden.has(column.id));
 const filtered = useMemo(() => {
  let rows = view.rows;
  if (model.filter && filter) rows = rows.filter(row => model.filter.match(row, filter));
  const needle = find.trim().toLowerCase();
  if (needle) rows = rows.filter(row => [row.comment, ...columns.map(column => row.cells[column.id])].some(value => String(value ?? '').toLowerCase().includes(needle)));
  if (sort) {
   const column = model.columns.find(item => item.id === sort.id);
   if (column) rows = rows.slice().sort((a, b) => compare(column, a, b) * (sort.dir === 'asc' ? 1 : -1));
  }
  return rows;
 }, [view.rows, find, filter, sort, hidden]);

 const selected = view.rows.filter(row => selection.has(row.key));
 const can = (test, rows = selected) => rows.length > 0 && rows.every(row => test?.(row) ?? false);
 const editable = !model.readOnly;
 const ordered = model.ordered && !sort && !find && !(model.filter && filter && filter !== 'all');

 async function run(change) {
  if (!change) return;
  setBusy(true);
  setError(null);
  try {
   await apply(typeof change === 'function' ? change() : change);
  } catch (failure) {
   setError(errorText(failure));
  } finally {
   setBusy(false);
   // Buttons are disabled while busy; keep keyboard shortcuts in this list.
   setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) gridRef.current?.focus({ preventScroll: true }); });
  }
 }

 // Actions take the rows explicitly: a context menu acts on the row that was
 // right-clicked even before the selection state has re-rendered.
 const actions = {
  add: () => { if (editable && model.canAdd?.(view.data) && !model.addTypes) openItem(model.id); },
  remove: (rows = selected) => {
   if (!can(model.canRemove, rows)) return;
   const blocked = model.removeBlocked?.(rows, view.data);
   if (blocked) return setError(blocked);
   run(() => model.remove(rows, view.data));
  },
  enable: (rows = selected) => can(model.canToggle, rows) && run(() => model.toggle(rows, true, view.data)),
  disable: (rows = selected) => can(model.canToggle, rows) && run(() => model.toggle(rows, false, view.data)),
  comment: async (rows = selected) => {
   if (!can(model.canComment, rows)) return;
   const text = await askText({ title: `Comment ${rows.length === 1 ? model.noun : rows.length + ' items'}`, label: 'Comment', value: rows[0].comment ?? '' });
   if (text !== null) run(() => model.comment(rows, text.trim(), view.data));
  }
 };

 function addMenu(event) {
  if (!model.addTypes) return actions.add();
  const box = event.currentTarget.getBoundingClientRect();
  openContextMenu({ clientX: box.left, clientY: box.bottom }, model.addTypes.map(type => ({ label: type.label, onSelect: () => openItem(model.id, null, { addType: type.id }) })));
 }

 function rowMenu(event, row) {
  const rows = row ? (selection.has(row.key) ? selected : [row]) : [];
  openContextMenu(event, [
   row && { label: 'Open', onSelect: () => openItem(model.id, row) },
   editable && model.canAdd?.(view.data) && !model.addTypes && { label: 'Add New', onSelect: () => openItem(model.id) },
   ...(model.addTypes && editable ? model.addTypes.map(type => ({ label: `Add ${type.label}`, onSelect: () => openItem(model.id, null, { addType: type.id }) })) : []),
   row && model.copy && !row.readOnly && { label: 'Copy', onSelect: () => openItem(model.id, null, { copyFrom: row.key }) },
   row && null,
   model.toggle && { label: 'Enable', disabled: !can(model.canToggle, rows), onSelect: () => actions.enable(rows) },
   model.toggle && { label: 'Disable', disabled: !can(model.canToggle, rows), onSelect: () => actions.disable(rows) },
   model.comment && { label: 'Comment', disabled: !can(model.canComment, rows), onSelect: () => actions.comment(rows) },
   ...(model.tools ?? []).map(tool => ({ label: tool.label, disabled: !tool.enabled(rows), onSelect: () => run(() => tool.run(rows, view.data)) })),
   model.remove && { label: 'Remove', disabled: !can(model.canRemove, rows), onSelect: () => actions.remove(rows) }
  ].filter(item => item !== false && item !== undefined));
 }

 function columnMenu(event) {
  openContextMenu(event, model.columns.filter(column => column.label).map(column => ({
   label: column.label, checked: !hidden.has(column.id),
   onSelect: () => {
    const next = new Set(hidden);
    next.has(column.id) ? next.delete(column.id) : next.add(column.id);
    setHidden(next);
    preferences.set('columns.' + model.id, [...next]);
   }
  })));
 }

 function onKeyDown(event) {
  const ctrl = event.ctrlKey && !event.metaKey && !event.altKey;
  if (event.target.matches('input, select, textarea') && event.key !== 'Escape') return;
  const action = event.key === 'Insert' ? 'add' : event.key === 'Delete' ? 'remove' : ctrl && event.key === 'e' ? 'enable' : ctrl && event.key === 'd' ? 'disable' : ctrl && event.key === 'm' ? 'comment' : null;
  if (ctrl && event.key === 'f') { event.preventDefault(); findRef.current?.focus(); return; }
  if (!action || !editable) return;
  event.preventDefault();
  if (action === 'add') model.addTypes ? addMenu({ currentTarget: event.currentTarget.querySelector('[data-tool="add"]') }) : actions.add();
  else actions[action]();
 }

 const tool = (id, label, onClick, enabled, hint) => (
  <button type="button" class="rd-tool" data-tool={id} title={enabled ? label : hint ?? label} aria-label={label} disabled={!enabled || busy} onClick={onClick}>
   <Icon name={id} />
  </button>
 );

 const total = view.rows.length, shown = filtered.length;
 return (
  <div class="rd-list-body" onKeyDown={onKeyDown}>
   <div class="rd-list-toolbar" role="toolbar" aria-label="List actions">
    {editable && tool('add', model.addTypes ? 'Add…' : 'Add', addMenu, !!model.canAdd?.(view.data))}
    {editable && tool('remove', 'Remove', () => actions.remove(), can(model.canRemove), model.remove ? null : 'Cannot be removed')}
    {editable && tool('enable', 'Enable', () => actions.enable(), !!model.toggle && can(model.canToggle), model.toggleHint)}
    {editable && tool('disable', 'Disable', () => actions.disable(), !!model.toggle && can(model.canToggle), model.toggleHint)}
    {editable && tool('comment', 'Comment', () => actions.comment(), !!model.comment && can(model.canComment), model.commentHint)}
    {(model.tools ?? []).map(item => (
     <button type="button" key={item.id} class="rd-tool-text" disabled={!item.enabled(selected) || busy} onClick={() => run(() => item.run(selected, view.data))}>{item.label}</button>
    ))}
    {model.filter && (
     <select class="rd-filter" aria-label={model.filter.label} value={filter} onChange={event => setFilter(event.currentTarget.value)}>
      {model.filter.options(view.rows).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
     </select>
    )}
    <span class="rd-spacer" />
    <input class="rd-find" type="search" placeholder="Find" aria-label="Find" ref={findRef} value={find} onInput={event => setFind(event.currentTarget.value)} />
   </div>
   <Grid label={model.noun + ' list'} gridRef={gridRef} columns={columns} rows={filtered} selection={selection} flagLegend={model.flagLegend}
    onSelection={setSelection} onOpen={row => openItem(model.id, row)} onContextMenu={rowMenu} onHeaderMenu={columnMenu}
    sort={sort} onSort={id => setSort(sort?.id !== id ? { id, dir: 'asc' } : sort.dir === 'asc' ? { id, dir: 'desc' } : null)}
    draggable={ordered && editable && !!model.order} follow={model.follow}
    onReorder={(moved, target, position) => {
     const targetRow = view.rows.find(row => row.key === target);
     if (model.canOrder && !model.canOrder(view.rows.filter(row => moved.includes(row.key)), targetRow)) return setError('These items cannot be moved there');
     const order = view.rows.map(row => row.key).filter(key => !moved.includes(key));
     order.splice(order.indexOf(target) + (position === 'after' ? 1 : 0), 0, ...moved);
     run(() => model.order(order.map(key => view.rows.find(row => row.key === key)?.section).filter(Boolean), view.data));
    }}
    empty={view.ready ? (find ? 'Nothing matches' : 'No items') : view.errors.length ? 'Not available' : 'Loading…'} />
   {(error || view.errors.length > 0) && (
    <div class="rd-list-error" role="alert">
     <span>{error ?? `Could not read data: ${errorText(view.errors[0])}`}</span>
     {error && <button type="button" class="rd-win-btn" aria-label="Dismiss" onClick={() => setError(null)}><Icon name="close" size={12} /></button>}
    </div>
   )}
   <div class="rd-statusbar" role="status">
    <span>{shown === total ? `${total} items` : `${shown} items out of ${total}`}{selected.length ? ` (${selected.length} selected)` : ''}</span>
    {model.status && <span class="rd-status-extra">{model.status(view.data)}</span>}
    {model.note && <span class="rd-status-note" title={model.note}>{model.note}</span>}
   </div>
  </div>
 );
}

export function ListWindow({ spec, kind, win, active }) {
 const [tab, setTab] = useState(() => Math.min(preferences.get('tab.' + kind, 0), spec.tabs.length - 1));
 const choose = index => { setTab(index); preferences.set('tab.' + kind, index); };
 return (
  <div class="rd-list">
   {spec.tabs.length > 1 && (
    <div class="rd-tabs" role="tablist" onKeyDown={event => {
     const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
     if (!step) return;
     event.preventDefault();
     const next = (tab + step + spec.tabs.length) % spec.tabs.length;
     choose(next);
     event.currentTarget.children[next]?.focus();
    }}>
     {spec.tabs.map((item, index) => (
      <button type="button" role="tab" class="rd-tab" key={item.label} aria-selected={index === tab ? 'true' : 'false'} tabIndex={index === tab ? 0 : -1} onClick={() => choose(index)}>{item.label}</button>
     ))}
    </div>
   )}
   {MODELS[spec.tabs[tab].model].singleton
    // Settings tabs (IP > DNS) are a form, as in RouterOS.
    ? <ItemForm key={spec.tabs[tab].model} model={MODELS[spec.tabs[tab].model]} singleton active={active} idPrefix={win.id.replace(/\W/g, '')}
       onClose={() => { manager.close(win.id); focusAfterClose(); }} />
    : <TabList key={spec.tabs[tab].model} model={MODELS[spec.tabs[tab].model]} active={active} kind={kind} />}
  </div>
 );
}
