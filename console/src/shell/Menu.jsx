// SPDX-License-Identifier: Apache-2.0
// Vertical main menu. Items with children open a flyout to the right on
// hover, click, Enter or ArrowRight; ArrowLeft or Escape closes it.
import { useState, useRef, useEffect } from 'preact/hooks';
import { Icon } from './icons.jsx';

const focusable = root => [...(root?.querySelectorAll(':scope > li > .rd-menu-item') ?? [])];

function moveFocus(items, event) {
 const index = items.indexOf(document.activeElement);
 const target = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
 if (target === undefined || !items.length) return false;
 event.preventDefault();
 items[(target + items.length) % items.length].focus();
 return true;
}

export function Menu({ items, onOpen, onAction }) {
 const [openId, setOpenId] = useState(null);
 const rootRef = useRef();
 const flyoutRef = useRef();
 const focusFlyout = useRef(false);

 useEffect(() => {
  if (!openId) return;
  if (focusFlyout.current) {
   focusFlyout.current = false;
   focusable(flyoutRef.current)[0]?.focus();
  }
  const outside = event => { if (!rootRef.current?.parentElement.contains(event.target)) setOpenId(null); };
  document.addEventListener('pointerdown', outside, true);
  return () => document.removeEventListener('pointerdown', outside, true);
 }, [openId]);

 function choose(item) {
  setOpenId(null);
  if (item.window) onOpen(item.window);
  else if (item.action) onAction(item.action);
 }

 function openSubmenu(id, withFocus) {
  focusFlyout.current = withFocus;
  setOpenId(id);
 }

 function closeSubmenu(parentId) {
  setOpenId(null);
  rootRef.current?.querySelector(`[data-menu-id="${parentId}"]`)?.focus();
 }

 function entry(item, index) {
  if (item.separator) return <li role="separator" class="rd-menu-sep" key={'sep' + index} />;
  const common = { class: 'rd-menu-item', role: 'menuitem', tabIndex: index === 0 ? 0 : -1, 'data-menu-id': item.id };
  const body = [<Icon name={item.icon} />, <span class="rd-menu-label">{item.label}</span>];
  if (item.children) {
   const open = openId === item.id;
   return (
    <li role="none" class="rd-menu-entry" key={item.id}
     onPointerEnter={event => { if (event.pointerType === 'mouse') openSubmenu(item.id, false); }}
     onPointerLeave={event => { if (event.pointerType === 'mouse' && openId === item.id) setOpenId(null); }}>
     <button type="button" {...common} aria-haspopup="menu" aria-expanded={open ? 'true' : 'false'}
      onClick={() => openSubmenu(item.id, false)}
      onKeyDown={event => {
       if (['ArrowRight', 'Enter', ' '].includes(event.key)) { event.preventDefault(); openSubmenu(item.id, true); }
      }}>
      {body}<span class="rd-menu-arrow"><Icon name="chevron" size={12} /></span>
     </button>
     {open && (
      <ul class="rd-flyout" role="menu" aria-label={item.label} ref={flyoutRef}
       onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'ArrowLeft' || event.key === 'Escape') { event.preventDefault(); closeSubmenu(item.id); return; }
        moveFocus(focusable(flyoutRef.current), event);
       }}>
       {item.children.map(child => (
        <li role="none" key={child.id}>
         <button type="button" class="rd-menu-item" role="menuitem" tabIndex={-1} data-menu-id={child.id} onClick={() => choose(child)}>
          <span class="rd-menu-label">{child.label}</span>
         </button>
        </li>
       ))}
      </ul>
     )}
    </li>
   );
  }
  if (item.href) {
   return (
    <li role="none" class="rd-menu-entry" key={item.id}>
     <a {...common} href={item.href} target="_blank" rel="noopener">{body}</a>
    </li>
   );
  }
  return (
   <li role="none" class="rd-menu-entry" key={item.id}>
    <button type="button" {...common} onClick={() => choose(item)}>{body}</button>
   </li>
  );
 }

 return (
  <nav class="rd-menu" aria-label="Main menu">
   <ul role="menu" aria-label="Main menu" aria-orientation="vertical" ref={rootRef}
    onKeyDown={event => {
     if (event.key === 'Escape' && openId) { event.preventDefault(); setOpenId(null); return; }
     moveFocus(focusable(rootRef.current), event);
    }}>
    {items.map(entry)}
   </ul>
  </nav>
 );
}
