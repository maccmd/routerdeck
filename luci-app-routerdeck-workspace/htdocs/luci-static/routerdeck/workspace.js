/* SPDX-License-Identifier: Apache-2.0 */
(function () {
 'use strict';
 const RD = RouterDeck, el = RD.el;
 RD.workspace = function (candidates, options = {}) {
  // Only exact, ACL-filtered menu URLs supplied by the LuCI adapter can open.
  const pages = candidates.filter(page => {
   try { const url = new URL(page.href, location.href); return url.origin === location.origin && !url.username && !url.password; } catch (_) { return false; }
  });
  const allowed = new Map(pages.map(page => [page.href, page]));
  const storageKey = options.storageKey || 'workspace-preview';
  const windows = [], stage = el('div', { class:'rd-workspace-stage' }), tasks = el('div', { class:'rd-taskbar', 'aria-label':'Open windows' });
  const empty = el('p', { class:'rd-workspace-empty' }, 'Choose a page to open a window. Layout is saved on this browser.');
  stage.append(empty);
  const picker = el('select', { 'aria-label':'Page to open' }, pages.map(page => el('option', { value:page.href }, page.title)));
  let z = 0;
  const save = () => RD.storage.set(storageKey, windows.map(win => ({ href:win.page.href, x:win.x, y:win.y, w:win.w, h:win.h, maximized:win.maximized, minimized:win.minimized })));
  const modified = () => windows.filter(win => win.dirty);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || low));
  const status = win => {
   win.status.textContent = win.stale ? 'Configuration changed in another window. Reload before editing.' : win.dirty ? 'Form edited · apply, or reload to discard browser edits' : 'Standard LuCI page';
   win.title.textContent = (win.dirty ? '● ' : '') + win.page.title;
  };
  function layout(win) {
   const width = stage.clientWidth, height = stage.clientHeight;
   win.w = clamp(win.w, Math.min(360,width), width); win.h = clamp(win.h, 240, height);
   win.x = clamp(win.x, 0, width - win.w); win.y = clamp(win.y, 0, height - win.h);
   Object.assign(win.node.style, win.maximized ? { left:'0px', top:'0px', width:width+'px', height:height+'px', resize:'none' } : { left:win.x+'px', top:win.y+'px', width:win.w+'px', height:win.h+'px', resize:'' });
  }
  function activate(win, focus = false) {
   win.minimized = false; win.node.hidden = false; win.node.style.zIndex = ++z;
   windows.forEach(item => { item.node.classList.toggle('rd-window-active', item === win); item.task.setAttribute('aria-pressed', String(item === win)); });
   if (focus) win.title.focus();
   save();
  }
  function close(win, confirmed = false) {
   if (!confirmed && win.dirty && !confirm('Close this edited form? Browser edits will be lost. Changes already saved to UCI remain pending until applied or reverted in LuCI.')) return;
   win.observer.disconnect(); win.node.remove(); win.task.remove(); windows.splice(windows.indexOf(win),1);
   empty.hidden = windows.length > 0; save();
   if (windows.length) activate(windows[windows.length-1], true); else picker.focus();
  }
  function open(href, saved = {}) {
   if (!allowed.has(href)) return;
   const existing = windows.find(win => win.page.href === href);
   if (existing) return activate(existing, true);
   if (windows.length >= 6) { alert('Six windows are open. Close a window before opening another to limit router polling.'); return; }
   const win = { page:allowed.get(href), x:24*windows.length, y:24*windows.length, w:760, h:520, ...saved, dirty:false, stale:false };
   // Saved storage controls geometry only, never page data, sessions or tokens.
   win.page = allowed.get(href);
   win.title = el('button', { class:'rd-window-title', title:'Drag to move. Arrow keys move; Shift + arrows resize.' }, win.page.title);
   win.frame = el('iframe', { title:win.page.title, src:win.page.href });
   win.status = el('div', { class:'rd-window-status', role:'status' }, 'Standard LuCI page');
   const control = (name, symbol, handler) => el('button', { type:'button', 'aria-label':name+' '+win.page.title, 'data-action':name.toLowerCase(), onclick:handler }, symbol);
   const bar = el('div', { class:'rd-window-titlebar' }, [win.title,
    control('Reload','↻', () => {
     if (win.dirty && !confirm('Reload and discard browser edits? Changes already saved to UCI remain pending.')) return;
     win.dirty = false; win.stale = false; status(win); win.frame.contentWindow.location.reload();
    }),
    control('Minimize','−', () => { win.minimized = true; win.node.hidden = true; win.task.setAttribute('aria-pressed','false'); save(); win.task.focus(); }),
    control('Maximize','□', () => { win.maximized = !win.maximized; layout(win); save(); }),
    control('Close','×', () => close(win))]);
   win.node = el('section', { class:'rd-window', 'aria-label':win.page.title }, [bar,win.status,win.frame]);
   win.task = el('button', { type:'button', 'aria-pressed':'false', onclick:() => activate(win,true) }, win.page.title);
   windows.push(win); stage.append(win.node); tasks.append(win.task); empty.hidden = true;
   layout(win); activate(win);
   if (saved.minimized) { win.minimized = true; win.node.hidden = true; win.task.setAttribute('aria-pressed','false'); }
   win.node.addEventListener('pointerdown', () => activate(win));
   win.title.addEventListener('keydown', event => {
    const delta = { ArrowLeft:[-10,0], ArrowRight:[10,0], ArrowUp:[0,-10], ArrowDown:[0,10] }[event.key];
    if (!delta || win.maximized) return;
    event.preventDefault();
    if (event.shiftKey) { win.w += delta[0]; win.h += delta[1]; } else { win.x += delta[0]; win.y += delta[1]; }
    layout(win); save();
   });
   let drag;
   win.title.addEventListener('pointerdown', event => {
    if (event.button !== 0 || win.maximized || matchMedia('(max-width:760px)').matches) return;
    drag = { x:event.clientX-win.x, y:event.clientY-win.y };
    win.title.setPointerCapture(event.pointerId); stage.classList.add('rd-window-moving');
   });
   win.title.addEventListener('pointermove', event => { if (drag) { win.x=event.clientX-drag.x; win.y=event.clientY-drag.y; layout(win); } });
   const finish = () => { drag=null; stage.classList.remove('rd-window-moving'); save(); };
   win.title.addEventListener('pointerup', finish); win.title.addEventListener('lostpointercapture', finish);
   win.observer = new ResizeObserver(() => {
    if (!win.minimized && !win.maximized && !matchMedia('(max-width:760px)').matches) { win.w=win.node.offsetWidth; win.h=win.node.offsetHeight; save(); }
   });
   win.observer.observe(win.node);
   win.frame.addEventListener('load', () => {
    try {
     const doc = win.frame.contentDocument;
     if (!doc) return;
     if (options.frameStyle) doc.head.append(el('link', { rel:'stylesheet', href:options.frameStyle }));
     doc.addEventListener('pointerdown', () => activate(win), true);
     doc.addEventListener('focusin', () => activate(win), true);
     const edited = event => { if (event.target.matches('input:not([type="search"]),select,textarea')) { win.dirty=true; status(win); } };
     doc.addEventListener('input', edited, true); doc.addEventListener('change', edited, true);
     // LuCI keeps UCI staging at session scope. Never let a stale window apply
     // or silently combine two edited forms. Native handlers run unchanged
     // only after this conservative guard permits the action.
     doc.addEventListener('click', event => {
      if (!event.target.closest('.cbi-button-apply,.cbi-button-save,.cbi-button-positive,.cbi-page-actions')) return;
      if (win.stale || windows.some(other => other !== win && other.dirty)) {
       event.preventDefault(); event.stopImmediatePropagation();
       alert(win.stale ? 'Reload this window before saving: another window changed the configuration.' : 'Another window has edited fields. Apply or discard that form before saving here. No save was sent.');
      }
     }, true);
     doc.addEventListener('uci-applied', () => {
      win.dirty=false; status(win);
      windows.filter(other => other !== win).forEach(other => { other.stale=true; status(other); });
     });
     doc.addEventListener('uci-reverted', () => {
      win.dirty=false; status(win);
      windows.filter(other => other !== win).forEach(other => { other.stale=true; status(other); });
     });
     win.frame.contentWindow.addEventListener('beforeunload', event => { if (win.dirty) { event.preventDefault(); event.returnValue=''; } });
    } catch (_) { win.status.textContent='This page left the local LuCI origin. Open it in the regular interface.'; }
   });
   save(); return win;
  }
  const root = el('div', { class:'rd-workspace' }, [el('h2', {}, 'Workspace'), el('p', { class:'rd-workspace-note' }, 'Experimental · Each window is a standard LuCI page. Edit and apply one form at a time: UCI changes are shared by the session. Other windows must reload after an apply. Mobile uses one visible window with the taskbar below.'),
   el('div', { class:'rd-workspace-tools' }, [picker,el('button', { type:'button', class:'btn', onclick:() => open(picker.value) }, 'Open window'),el('button', { type:'button', class:'btn', onclick:() => {
    if (modified().length && !confirm('Close all edited forms? Browser edits will be lost. Saved UCI changes remain pending.')) return;
    [...windows].forEach(win => close(win,true));
   } }, 'Close all windows')]),stage,tasks]);
  const onUnload = event => { if (modified().length) { event.preventDefault(); event.returnValue=''; } };
  window.addEventListener('beforeunload',onUnload);
  window.addEventListener('resize',() => windows.forEach(layout));
  // Restore only geometry and permitted routes. Never restore submitted values.
  requestAnimationFrame(() => {
   const saved = RD.storage.get(storageKey,[]);
   if (Array.isArray(saved)) saved.slice(0,6).forEach(item => { if (item && allowed.has(item.href)) open(item.href, { x:item.x,y:item.y,w:item.w,h:item.h,maximized:!!item.maximized,minimized:!!item.minimized }); });
  });
  return root;
 };
})();
