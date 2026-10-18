// SPDX-License-Identifier: Apache-2.0
// Context menus and small prompts are drawn above every window.
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';

export const contextMenu = signal(null);
export const prompt = signal(null);

// items: [{ label, onSelect, disabled, checked } | null for a separator]
export function openContextMenu(event, items) {
 contextMenu.value = { x: event.clientX, y: event.clientY, items: items.filter((item, index, all) => item || (index > 0 && all[index - 1])), opener: document.activeElement };
}

export function askText({ title, label, value = '', multiline = false, submitLabel = 'OK' }) {
 return new Promise(resolve => { prompt.value = { title, label, value, multiline, submitLabel, resolve, opener: document.activeElement }; });
}

// Resolves true when confirmed, false otherwise.
export function askConfirm({ title, text, submitLabel = 'OK' }) {
 return new Promise(resolve => { prompt.value = { title, text, confirm: true, submitLabel, resolve: result => resolve(result !== null), opener: document.activeElement }; });
}

function ContextMenu({ menu }) {
 const ref = useRef();
 const [position, setPosition] = useState({ left: menu.x, top: menu.y });
 const close = (restore = true) => {
  contextMenu.value = null;
  if (restore) menu.opener?.focus?.({ preventScroll: true });
 };
 useEffect(() => {
  const box = ref.current.getBoundingClientRect();
  setPosition({ left: Math.max(0, Math.min(menu.x, innerWidth - box.width - 4)), top: Math.max(0, Math.min(menu.y, innerHeight - box.height - 4)) });
  ref.current.querySelector('button:not(:disabled)')?.focus();
  const outside = event => { if (!ref.current?.contains(event.target)) close(false); };
  document.addEventListener('pointerdown', outside, true);
  return () => document.removeEventListener('pointerdown', outside, true);
 }, [menu]);
 function onKeyDown(event) {
  const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement);
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
   event.preventDefault();
   buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }
 }
 return (
  <div class="rd-context" role="menu" ref={ref} style={{ left: position.left + 'px', top: position.top + 'px' }} onKeyDown={onKeyDown}>
   {menu.items.map((item, index) => item
    ? <button type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked === undefined ? undefined : String(item.checked)} key={index} disabled={item.disabled}
      onClick={() => { close(); item.onSelect(); }}>
      {item.checked !== undefined && <span class="rd-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>}{item.label}
     </button>
    : <div class="rd-context-sep" role="separator" key={index} />)}
  </div>
 );
}

function Prompt({ request }) {
 const [value, setValue] = useState(request.value);
 const field = useRef();
 useEffect(() => { field.current?.focus(); field.current?.select?.(); }, []);
 const finish = result => {
  prompt.value = null;
  request.opener?.focus?.({ preventScroll: true });
  request.resolve(result);
 };
 const Field = request.multiline ? 'textarea' : 'input';
 return (
  <div class="rd-prompt-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) finish(null); }}>
   <form class="rd-prompt" role="dialog" aria-modal="true" aria-labelledby="rd-prompt-title"
    onSubmit={event => { event.preventDefault(); finish(value); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); } }}>
    <h2 id="rd-prompt-title">{request.title}</h2>
    {request.confirm
     ? <p class="rd-prompt-text">{request.text}</p>
     : (
      <label class="rd-prompt-field">{request.label}
       <Field ref={field} value={value} rows={request.multiline ? 4 : undefined} onInput={event => setValue(event.currentTarget.value)} />
      </label>
     )}
    <div class="rd-prompt-actions">
     <button type="submit" class="rd-button" ref={node => { if (request.confirm && node && !field.current) { field.current = node; node.focus(); } }}>{request.submitLabel}</button>
     <button type="button" class="rd-button" onClick={() => finish(null)}>Cancel</button>
    </div>
   </form>
  </div>
 );
}

export function Overlays() {
 return (
  <>
   {contextMenu.value && <ContextMenu menu={contextMenu.value} key={contextMenu.value.x + ':' + contextMenu.value.y} />}
   {prompt.value && <Prompt request={prompt.value} />}
  </>
 );
}
