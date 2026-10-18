// SPDX-License-Identifier: Apache-2.0
// One MDI child window: title bar drag, edge/corner resize, minimize,
// maximize within the work area, close. Escape cancels a drag.
import { useRef } from 'preact/hooks';
import { Icon } from '../shell/icons.jsx';
import { EDGES, moveRect, resizeRect } from './geometry.js';
import { manager } from '../state.js';
import { focusWindow, focusAfterClose } from './focus.js';

const KEY_STEP = 10;
const isEditable = target => target?.matches?.('input, textarea, select, [contenteditable="true"]');

export function Window({ win, active, compact, children }) {
 const titleId = 'rd-win-title-' + win.id.replace(/\W/g, '-');
 const maximized = win.maximized || compact;
 const dragging = useRef(null);

 function startDrag(event, mode) {
  if (event.button !== 0 || maximized) return;
  event.preventDefault();
  event.stopPropagation();
  manager.activate(win.id);
  const handle = event.currentTarget, area = manager.area;
  const start = { x: win.x, y: win.y, w: win.w, h: win.h }, originX = event.clientX, originY = event.clientY;
  handle.setPointerCapture(event.pointerId);
  document.documentElement.classList.add('rd-dragging');
  const move = moveEvent => {
   const dx = moveEvent.clientX - originX, dy = moveEvent.clientY - originY;
   manager.setRect(win.id, mode === 'move' ? moveRect(start, dx, dy, area) : resizeRect(start, mode, dx, dy, area));
  };
  const finish = commit => {
   handle.removeEventListener('pointermove', move);
   handle.removeEventListener('pointerup', done);
   handle.removeEventListener('pointercancel', cancel);
   document.removeEventListener('keydown', escape, true);
   document.documentElement.classList.remove('rd-dragging');
   if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
   dragging.current = null;
   if (commit) manager.commit(win.id);
   else manager.setRect(win.id, start);
  };
  const done = () => finish(true);
  const cancel = () => finish(false);
  const escape = keyEvent => {
   if (keyEvent.key !== 'Escape') return;
   keyEvent.preventDefault();
   keyEvent.stopImmediatePropagation();
   finish(false);
  };
  dragging.current = mode;
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', done);
  handle.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', escape, true);
 }

 function close() {
  manager.close(win.id);
  focusAfterClose();
 }

 function onTitleKey(event) {
  if (maximized) return;
  const dx = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[event.key] ?? 0;
  const dy = { ArrowUp: -KEY_STEP, ArrowDown: KEY_STEP }[event.key] ?? 0;
  if (!dx && !dy) return;
  event.preventDefault();
  const start = { x: win.x, y: win.y, w: win.w, h: win.h };
  manager.setRect(win.id, event.shiftKey ? resizeRect(start, 'se', dx, dy, manager.area) : moveRect(start, dx, dy, manager.area));
  manager.commit(win.id);
 }

 function onKeyDown(event) {
  if (event.key === 'F4' || event.key === 'Escape' && !isEditable(event.target)) {
   event.preventDefault();
   event.stopPropagation();
   close();
  }
 }

 const style = maximized ? { zIndex: win.z } : { left: win.x + 'px', top: win.y + 'px', width: win.w + 'px', height: win.h + 'px', zIndex: win.z };
 const control = (action, label, icon, onClick) => (
  <button type="button" class="rd-win-btn" data-action={action} aria-label={`${label} ${win.title}`} title={label}
   onPointerDown={event => event.stopPropagation()} onClick={onClick}>
   <Icon name={icon} size={14} />
  </button>
 );

 return (
  <section class={`rd-win${active ? ' is-active' : ''}${maximized ? ' is-max' : ''}`} style={style}
   role="dialog" aria-labelledby={titleId} data-window-id={win.id} data-kind={win.kind}
   onPointerDown={() => { if (!active) manager.activate(win.id); }} onKeyDown={onKeyDown}>
   <header class="rd-win-title" onPointerDown={event => startDrag(event, 'move')}
    onDblClick={() => { if (!compact) manager.toggleMaximize(win.id); }}>
    <span class="rd-win-label" id={titleId} tabIndex={0} onKeyDown={onTitleKey}
     title="Drag to move. Arrow keys move, Shift + arrows resize.">{win.title}</span>
    {control('minimize', 'Minimize', 'minimize', () => { manager.minimize(win.id); focusAfterClose(); })}
    {!compact && control('maximize', win.maximized ? 'Restore' : 'Maximize', win.maximized ? 'restore' : 'maximize', () => { manager.toggleMaximize(win.id); focusWindow(win.id); })}
    {control('close', 'Close', 'close', close)}
   </header>
   <div class="rd-win-body">{children}</div>
   {!maximized && EDGES.map(edge => (
    <div key={edge} class={`rd-win-resize rd-win-resize-${edge}`} aria-hidden="true" onPointerDown={event => startDrag(event, edge)} />
   ))}
  </section>
 );
}

export function MinimizedWindow({ win, rect }) {
 return (
  <div class="rd-min" data-window-id={win.id} style={{ left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px', zIndex: 100000 }}>
   <button type="button" class="rd-min-restore" onClick={() => { manager.activate(win.id); focusWindow(win.id); }} aria-label={`Restore ${win.title}`}>
    <span>{win.title}</span>
   </button>
   <button type="button" class="rd-win-btn" data-action="close" aria-label={`Close ${win.title}`} title="Close"
    onClick={() => { manager.close(win.id); focusAfterClose(); }}>
    <Icon name="close" size={14} />
   </button>
  </div>
 );
}
