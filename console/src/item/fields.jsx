// SPDX-License-Identifier: Apache-2.0
import { TrafficGraph } from '../shell/graph.jsx';
// Form controls for object windows. Values are plain strings, booleans,
// arrays (lists, multi-select) or { negate, value } for "!"-capable fields.

function options(field, value) {
 const list = field.options ?? [];
 const missing = value && !list.some(option => option.value === value) ? [{ value, label: value }] : [];
 return [...(field.allowEmpty ? [{ value: '', label: '—' }] : []), ...missing, ...list];
}

function ListControl({ id, value, onChange, disabled }) {
 const items = value?.length ? value : [''];
 const set = (index, next) => onChange(items.map((item, position) => position === index ? next : item).filter((item, position, all) => item !== '' || position === all.length - 1));
 return (
  <div class="rd-field-list">
   {items.map((item, index) => (
    <div class="rd-field-list-row" key={index}>
     <input id={index === 0 ? id : undefined} value={item} disabled={disabled} aria-label={index ? `Value ${index + 1}` : undefined} onInput={event => set(index, event.currentTarget.value)} />
     <button type="button" class="rd-mini" aria-label="Remove value" disabled={disabled || (items.length === 1 && !item)} onClick={() => onChange(items.filter((entry, position) => position !== index).filter(Boolean))}>−</button>
    </div>
   ))}
   <button type="button" class="rd-mini rd-mini-add" aria-label="Add value" disabled={disabled || !items.at(-1)} onClick={() => onChange([...items.filter(Boolean), ''])}>+</button>
  </div>
 );
}

export function Field({ field: spec, value, values, onChange, error, disabled }) {
 // Options may depend on other fields, e.g. the ports of the chosen bridge.
 const field = typeof spec.options === 'function' ? { ...spec, options: spec.options(values) } : spec;
 const id = 'rd-field-' + field.id + '-' + field.key;
 const describedBy = error ? id + '-error' : undefined;
 let control;
 switch (field.type) {
  case 'static':
   control = <output id={id} class="rd-field-static" aria-labelledby={id + '-label'}>{field.value ? field.value(values) : Array.isArray(value) ? value.join(', ') : value || '—'}</output>;
   break;
  case 'graph':
   control = <TrafficGraph points={field.series(values)} label={field.graphLabel ?? 'Traffic'} />;
   break;
  case 'note':
   control = <p id={id} class="rd-field-note">{field.value(values)}</p>;
   break;
  case 'bool':
   control = <input id={id} type="checkbox" checked={!!value} disabled={disabled} onChange={event => onChange(event.currentTarget.checked)} />;
   break;
  case 'select':
   control = (
    <select id={id} value={value ?? ''} disabled={disabled} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} onChange={event => onChange(event.currentTarget.value)}>
     {options({ ...field, allowEmpty: typeof field.allowEmpty === 'function' ? field.allowEmpty(values) : field.allowEmpty }, value).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
   );
   break;
  case 'combo':
   control = (
    <>
     <input id={id} list={id + '-options'} value={value ?? ''} disabled={disabled} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} onInput={event => onChange(event.currentTarget.value)} />
     <datalist id={id + '-options'}>{(field.options ?? []).map(option => <option key={option.value} value={option.value} />)}</datalist>
    </>
   );
   break;
  case 'multi':
   control = (
    <div id={id} class="rd-field-multi" role="group" aria-labelledby={id + '-label'}>
     {(field.options ?? []).map(option => (
      <label key={option.value}>
       <input type="checkbox" disabled={disabled} checked={(value ?? []).includes(option.value)}
        onChange={event => onChange(event.currentTarget.checked ? [...(value ?? []), option.value] : (value ?? []).filter(item => item !== option.value))} />
       {option.label}
      </label>
     ))}
     {!(field.options ?? []).length && <span class="rd-muted">none available</span>}
    </div>
   );
   break;
  case 'list':
   control = <ListControl id={id} value={value} disabled={disabled} onChange={onChange} />;
   break;
  case 'textarea':
   control = <textarea id={id} class="rd-field-code" rows={field.rows ?? 12} spellcheck={false} value={value ?? ''} disabled={disabled} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} onInput={event => onChange(event.currentTarget.value)} />;
   break;
  case 'negatable':
   control = (
    <div class="rd-field-negatable">
     <label class="rd-negate" title="Match everything except this value">
      <input type="checkbox" aria-label={`Not ${field.label}`} disabled={disabled} checked={!!value?.negate} onChange={event => onChange({ ...value, negate: event.currentTarget.checked })} />!
     </label>
     <input id={id} value={value?.value ?? ''} disabled={disabled} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} onInput={event => onChange({ ...value, value: event.currentTarget.value })} />
    </div>
   );
   break;
  default:
   control = (
    <input id={id} type={field.type === 'password' ? 'password' : 'text'} inputMode={field.type === 'number' ? 'numeric' : undefined}
     autocomplete={field.type === 'password' ? 'new-password' : 'off'} spellcheck={false} placeholder={field.placeholder} value={value ?? ''}
     disabled={disabled} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} onInput={event => onChange(event.currentTarget.value)} />
   );
 }
 return (
  <div class={`rd-field${field.wide ? ' is-wide' : ''}`}>
   <label class="rd-field-label" id={id + '-label'} for={['static', 'multi', 'note'].includes(field.type) ? undefined : id}>{field.label}{field.label && ':'}</label>
   <div class="rd-field-control">
    {control}
    {error && <div class="rd-field-error" id={id + '-error'}>{error}</div>}
   </div>
  </div>
 );
}
