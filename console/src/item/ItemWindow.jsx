// SPDX-License-Identifier: Apache-2.0
// An object window: tabbed fields on the left, OK / Cancel / Apply /
// Disable / Comment / Copy / Remove on the right, a status bar below.
// Fields the user has not touched keep following live router data.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MODELS } from '../model/index.js';
import { ValidationError } from '../model/common.js';
import { useSources } from '../api/sources.js';
import { apply, errorText } from '../api/actions.js';
import { askText } from '../shell/overlays.jsx';
import { openItem } from '../windows/open.js';
import { manager } from '../state.js';
import { focusAfterClose } from '../mdi/focus.js';
import { Field } from './fields.jsx';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function ItemWindow({ win, active }) {
 const params = win.params ?? {};
 const model = MODELS[params.model];
 const sources = useSources(model?.sources ?? [], active && !!model);
 const ready = !!model && model.sources.every(key => sources.data[key] !== undefined);
 const rows = useMemo(() => ready ? model.rows(sources.data) : [], [ready, ...(model?.sources ?? []).map(key => sources.data[key])]);
 const row = params.key ? rows.find(item => item.key === params.key) ?? null : null;
 const creating = !params.key;
 const [initial, setInitial] = useState(null);
 const [edits, setEdits] = useState({});
 const [baseAtEdit, setBaseAtEdit] = useState({});
 const [errors, setErrors] = useState({});
 const [message, setMessage] = useState(null);
 const [busy, setBusy] = useState(false);
 const [tab, setTab] = useState(0);
 const created = useRef(null);
 const close = () => { manager.close(win.id); focusAfterClose(); };

 // A new object's defaults are taken once, when its data first arrives.
 useEffect(() => {
  if (!ready || !creating || initial) return;
  const source = params.copyFrom && rows.find(item => item.key === params.copyFrom);
  setInitial(source ? (model.copy ? model.copy(model.values(source, sources.data)) : model.values(source, sources.data)) : model.defaults(sources.data, params));
 }, [ready]);

 // After Apply on a new object the window becomes that object's window.
 useEffect(() => {
  if (!created.current || !ready) return;
  const { result, values } = created.current;
  const found = rows.find(item => item.key === result.created?.$new || item.section === result.created?.$new) ?? (model.findCreated?.(rows, values));
  if (!found) return;
  created.current = null;
  manager.update(win.id, { params: { model: params.model, key: found.key }, instance: `${params.model}:${found.key}`, title: model.itemTitle(found) });
  setEdits({});
 }, [rows]);

 useEffect(() => {
  if (row && model) {
   const title = model.itemTitle(row);
   if (title !== win.title) manager.update(win.id, { title });
  }
 }, [row && model?.itemTitle(row)]);

 if (!model) return <div class="rd-item-missing">Unknown object type.</div>;
 if (!ready) return <div class="rd-item-missing">{sources.errors.length ? `Could not read data: ${errorText(sources.errors[0])}` : 'Loading…'}</div>;
 if (!creating && !row) {
  return (
   <div class="rd-item-missing">
    <p>This {model.noun.toLowerCase()} no longer exists on the router.</p>
    <button type="button" class="rd-button" onClick={close}>Close</button>
   </div>
  );
 }

 const base = creating ? initial ?? {} : model.values(row, sources.data);
 const values = { ...base, ...edits };
 const dirty = new Set(Object.keys(edits).filter(key => !same(edits[key], base[key])));
 const fields = model.fields(sources.data, row, params).map(field => ({ ...field, key: win.id.replace(/\W/g, '') })).filter(field => field.visible?.(values) ?? true);
 const tabs = [...new Set(fields.map(field => field.tab ?? 'General'))];
 const current = tabs[Math.min(tab, tabs.length - 1)];
 const readOnly = model.readOnly || row?.readOnly;
 const changedOnRouter = [...dirty].some(key => key in baseAtEdit && !same(baseAtEdit[key], base[key]));

 function edit(id, value) {
  if (!(id in baseAtEdit)) setBaseAtEdit({ ...baseAtEdit, [id]: base[id] });
  setEdits({ ...edits, [id]: value });
  if (errors[id]) setErrors({ ...errors, [id]: null });
 }

 async function run(change, after) {
  setBusy(true);
  setMessage(null);
  try {
   const result = await apply(change);
   after?.(result);
  } catch (failure) {
   setMessage(errorText(failure));
  } finally {
   setBusy(false);
  }
 }

 async function save(closeAfter) {
  if (readOnly || (!creating && !dirty.size)) return closeAfter ? close() : undefined;
  let change;
  try {
   change = model.save(values, row, sources.data, { dirty, ...params });
  } catch (failure) {
   if (!(failure instanceof ValidationError)) throw failure;
   setErrors({ [failure.field]: failure.message });
   const index = tabs.indexOf(fields.find(field => field.id === failure.field)?.tab ?? 'General');
   if (index >= 0) setTab(index);
   return;
  }
  if (!change) return closeAfter ? close() : setEdits({});
  const first = change.ops.find(op => op.op === 'add');
  if (creating && first && !first.ref) first.ref = '$new';
  await run(change, result => {
   setErrors({});
   if (closeAfter) return close();
   if (creating) created.current = { result, values };
   else { setEdits({}); setBaseAtEdit({}); }
  });
 }

 async function comment() {
  const text = await askText({ title: `Comment ${model.noun}`, label: 'Comment', value: row.comment ?? '' });
  if (text !== null) run(model.comment([row], text.trim(), sources.data));
 }

 const status = row ? (model.itemStatus?.(row) ?? []).filter(Boolean) : ['new'];
 return (
  <form class="rd-item" onSubmit={event => { event.preventDefault(); save(true); }}
   onKeyDown={event => { if (event.key === 'Enter' && event.target.matches('input:not([type="checkbox"])')) { event.preventDefault(); save(true); } }}>
   <div class="rd-item-main">
    {tabs.length > 1 && (
     <div class="rd-tabs" role="tablist">
      {tabs.map((name, index) => (
       <button type="button" role="tab" key={name} class="rd-tab" aria-selected={name === current ? 'true' : 'false'} tabIndex={name === current ? 0 : -1} onClick={() => setTab(index)}>{name}</button>
      ))}
     </div>
    )}
    <div class="rd-item-fields" role={tabs.length > 1 ? 'tabpanel' : undefined}>
     {fields.filter(field => (field.tab ?? 'General') === current).map(field => (
      <Field key={field.id} field={field} value={values[field.id]} values={values} error={errors[field.id]}
       disabled={readOnly || busy} onChange={value => edit(field.id, value)} />
     ))}
    </div>
    {message && <div class="rd-item-error" role="alert">{message}</div>}
   </div>
   <div class="rd-item-buttons">
    <button type="submit" class="rd-button" disabled={busy}>OK</button>
    <button type="button" class="rd-button" onClick={close}>Cancel</button>
    {!readOnly && <button type="button" class="rd-button" disabled={busy || (!creating && !dirty.size)} onClick={() => save(false)}>Apply</button>}
    {row && model.toggle && !readOnly && (
     <button type="button" class="rd-button" disabled={busy || !model.canToggle?.(row)} title={model.canToggle?.(row) ? undefined : model.toggleHint}
      onClick={() => run(model.toggle([row], row.disabled, sources.data))}>{row.disabled ? 'Enable' : 'Disable'}</button>
    )}
    {row && model.comment && !readOnly && <button type="button" class="rd-button" disabled={busy || !model.canComment?.(row)} onClick={comment}>Comment</button>}
    {row && model.copy && !readOnly && <button type="button" class="rd-button" onClick={() => openItem(model.id, null, { copyFrom: row.key })}>Copy</button>}
    {row && model.remove && !readOnly && (
     <button type="button" class="rd-button" disabled={busy || !model.canRemove?.(row)}
      onClick={() => { const blocked = model.removeBlocked?.([row], sources.data); blocked ? setMessage(blocked) : run(model.remove([row], sources.data), close); }}>Remove</button>
    )}
    {row && (model.tools ?? []).filter(tool => tool.enabled([row])).map(tool => (
     <button type="button" key={tool.id} class="rd-button" disabled={busy} onClick={() => run(tool.run([row], sources.data), close)}>{tool.label}</button>
    ))}
   </div>
   <div class="rd-statusbar rd-item-status" role="status">
    {status.map(word => <span key={word}>{word}</span>)}
    {dirty.size > 0 && <span class="rd-status-note">{changedOnRouter ? 'changed on the router since you started editing' : 'not applied'}</span>}
   </div>
  </form>
 );
}
