/* SPDX-License-Identifier: Apache-2.0 */
(function () {
 'use strict';
 const RD = globalThis.RouterDeck;
 if (!RD || typeof RD.initWindows === 'function') return;
 const el = RD.el;
 const targetKinds = new Set(['interface', 'device', 'zone', 'lease', 'diagnostic', 'section']);
 // A menu route is the authority, never a URL supplied by storage or a frame.
 RD.windowDestination = function (href, pages, base = location.href, preview = false) {
  try {
   const url = new URL(href, base), origin = new URL(base).origin;
   if (url.origin !== origin || url.username || url.password) return null;
   if ([...url.searchParams.keys()].some(key => !['rd', 'rdwindow'].includes(key))) return null;
   if (url.searchParams.getAll('rd').length > 1) return null;
   const target = url.searchParams.get('rd');
   if (target != null) {
    const colon = target.indexOf(':'), kind = target.slice(0, colon), name = target.slice(colon + 1);
    if (!targetKinds.has(kind) || !name || name.length > 128 || /[\x00-\x1f\x7f]/.test(name)) return null;
   }
   const page = pages.find(item => {
    const allowed = new URL(item.href, base);
    return allowed.origin === origin && allowed.pathname.replace(/\/$/, '') === url.pathname.replace(/\/$/, '') && (!preview || allowed.hash === url.hash);
   });
   if (!page || (!preview && url.hash && !url.hash.startsWith('#rd:'))) return null;
   if (!preview && url.hash.startsWith('#rd:')) {
    const match = /^#rd:(interface|device|zone|lease|diagnostic|section):(.+)$/.exec(url.hash);
    if (!match || target != null) return null;
    const name = decodeURIComponent(match[2]);
    if (!name || name.length > 128 || /[\x00-\x1f\x7f]/.test(name)) return null;
    url.searchParams.set('rd', match[1] + ':' + name); url.hash = '';
   }
   url.searchParams.delete('rdwindow');
   const detail = url.searchParams.get('rd');
   return { href: url.pathname + url.search + url.hash, title: detail ? detail.slice(detail.indexOf(':') + 1) + ' · ' + page.title : page.title };
  } catch (_) { return null; }
 };
 RD.initWindows = function (pages, options = {}) {
  if (RD.windows) return RD.windows;
  // Same-origin children share the parent's manager and never create desktops.
  if (window.parent !== window) {
   try {
    if (window.parent.RouterDeck?.windows) {
     RD.windows = window.parent.RouterDeck.windows;
     RD.windows.attach(window);
     return RD.windows;
    }
   } catch (_) {}
   return null;
  }
  const windows = [], attached = new WeakSet(), mobile = matchMedia('(max-width:760px)');
  const stage = el('div', { class: 'rd-windows', 'aria-label': 'Open windows' });
  const tasks = el('div', { class: 'rd-taskbar', 'aria-label': 'Window switcher' });
  const taskItems = el('div', { class: 'rd-task-items' });
  const snapPreview = el('div', { class: 'rd-snap-preview', hidden: '', 'aria-hidden': 'true' }, el('span'));
  const divider = el('div', { class: 'rd-window-divider', role: 'separator', tabindex: '0', hidden: '', 'aria-label': 'Resize side-by-side windows', 'aria-orientation': 'vertical', title: 'Drag to resize both windows. Arrow keys adjust; double-click to equalize.' });
  stage.append(snapPreview, divider);
  const presets = [
   ['left', 'Left half', [0, 0, .5, 1]], ['right', 'Right half', [.5, 0, .5, 1]],
   ['top', 'Top half', [0, 0, 1, .5]], ['bottom', 'Bottom half', [0, .5, 1, .5]],
   ['top-left', 'Top left', [0, 0, .5, .5]], ['top-right', 'Top right', [.5, 0, .5, .5]],
   ['bottom-left', 'Bottom left', [0, .5, .5, .5]], ['bottom-right', 'Bottom right', [.5, .5, .5, .5]]
  ];
  const validSlot = slot => Array.isArray(slot) && slot.length === 4 && slot.every(Number.isFinite) &&
   slot[0] >= 0 && slot[1] >= 0 && slot[2] >= 1 / 6 && slot[3] >= 1 / 6 && slot[0] + slot[2] <= 1.000001 && slot[1] + slot[3] <= 1.000001;
  const glyph = (slot = [0, 0, .5, 1]) => el('span', { class: 'rd-layout-glyph', 'aria-hidden': 'true' }, el('i', { style: 'left:' + slot[0] * 100 + '%;top:' + slot[1] * 100 + '%;width:' + slot[2] * 100 + '%;height:' + slot[3] * 100 + '%' }));
  const background = { title: 'Main page', dirty: false, stale: false, realm: window };
  const storageKey = options.storageKey || 'windows';
  const navigationKey = 'routerdeck.page-navigation';
  let showMainOnRestore = false;
  try {
   const next = sessionStorage.getItem(navigationKey); sessionStorage.removeItem(navigationKey);
   if (next) {
    const target = new URL(next, location.href);
    showMainOnRestore = target.origin === location.origin && (location.pathname === target.pathname || location.pathname.startsWith(target.pathname.replace(/\/$/, '') + '/'));
   }
  } catch (_) {}
  const clamp = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
  let active, z = 0, restoring = false, cancelDrag, clearDragSnap, splitPair;
  const resolve = (href, base) => RD.windowDestination(href, pages, base || location.href, !!options.preview);
  const participants = () => [background, ...windows.filter(win => win.frame)];
  function closeNavigation(doc = document) {
   doc.body.classList.remove('rd-nav-open');
   doc.getElementById('rd-menu-toggle')?.setAttribute('aria-expanded', 'false');
   const backdrop = doc.getElementById('rd-backdrop'); if (backdrop) backdrop.hidden = true;
  }
  function syncNavigationWindows() {
   document.querySelectorAll('.rd-nav-window').forEach(button => {
    const existing = windows.some(win => win.key === button.dataset.windowHref);
    const label = (existing ? 'Show window: ' : 'Open in a window: ') + button.dataset.pageTitle;
    button.dataset.windowOpen = String(existing);
    button.title = label; button.setAttribute('aria-label', label);
   });
  }
  function decorateNavigation(container = document.getElementById('rd-navigation')) {
   // Hidden frame sidebars must not create controls owned by the parent.
   if (!container || container.ownerDocument !== document) return;
   container.querySelectorAll('.rd-nav-item').forEach(row => {
    const link = row.querySelector('.rd-nav-link');
    if (!link || row.querySelector('.rd-nav-window')) return;
    const destination = resolve(link.href); if (!destination) return;
    const title = link.querySelector('.rd-nav-label').textContent;
    const button = el('button', { type: 'button', class: 'rd-nav-window', 'data-window-href': destination.href, 'data-page-title': title,
     onclick: () => { if (open(destination.href, { trigger: button })) closeNavigation(); }
    }, RD.icon('workspace'));
    row.append(button);
   });
   syncNavigationWindows();
  }
  const save = () => {
   if (restoring) return;
   RD.storage.set(storageKey, windows.filter(win => win.page).map(win => ({ href: win.page.href, x: win.x, y: win.y, w: win.w, h: win.h, snap: win.snap, maximized: win.maximized, minimized: win.minimized })));
   tasks.hidden = !windows.length;
   tile.disabled = windows.length < 2;
   tile.title = windows.length < 2 ? 'Open at least two windows to arrange them' : 'Arrange all open windows without overlap';
   document.body.classList.toggle('rd-has-windows', !!windows.length);
  };
  function status(win) {
   if (win === background) {
    let banner = document.getElementById('rd-background-stale');
    if (win.stale && !banner) {
     banner = el('div', { id: 'rd-background-stale', class: 'alert-message warning', role: 'status' }, [
      'Settings changed in another window. Reload this page before saving. ',
      el('button', { type: 'button', class: 'btn', onclick: () => { if (!background.dirty || confirm('Reload this page and discard its unsaved edits?')) { background.dirty = false; location.reload(); } } }, 'Reload page')
     ]);
     document.querySelector('#maincontent')?.prepend(banner);
    }
    return;
   }
   const title = win.editorTitle || win.title;
   win.label.textContent = (win.dirty ? '● ' : '') + title;
   win.node.setAttribute('aria-label', title);
   win.task.textContent = title; win.task.title = title;
   win.status.hidden = !win.stale && !win.dirty;
   win.status.textContent = win.stale ? 'Settings changed elsewhere. Reload before saving.' : 'Unsaved changes';
   win.node.classList.toggle('rd-window-stale', win.stale);
  }
  function layout(win) {
   const area = workArea(), { width, height } = area;
   if (!mobile.matches) {
    win.w = clamp(win.w, Math.min(360, width), width);
    win.h = clamp(win.h, Math.min(280, height), height);
    win.x = clamp(win.x, area.left, area.right - win.w); win.y = clamp(win.y, area.top, area.bottom - win.h);
   }
   const full = win.maximized || mobile.matches, slot = displaySlot(win.snap, area);
   const box = full ? { x: area.left, y: area.top, w: width, h: height } : slot ? slotRect(slot, area) : win;
   // Stored positions remain viewport coordinates, including older layouts.
   // The stage itself excludes navigation, header and the window switcher.
   Object.assign(win.node.style, { left: (box.x - area.left) + 'px', top: (box.y - area.top) + 'px', width: box.w + 'px', height: box.h + 'px' });
   win.node.dataset.layout = win.maximized ? 'maximized' : slot ? presets.find(item => sameSlot(item[2], slot))?.[0] || 'tiled' : 'floating';
   win.resize.hidden = full;
   win.maximize.setAttribute('aria-label', (win.maximized ? 'Restore ' : 'Maximize ') + win.title);
   win.maximize.title = win.maximized ? 'Restore size' : 'Maximize';
   win.maximize.replaceChildren(RD.icon(win.maximized ? 'workspace' : 'overview'));
   win.layoutOptions?.forEach((button, index) => {
    button.disabled = !fits(presets[index][2], area);
    button.setAttribute('aria-pressed', String(!win.maximized && sameSlot(slot, presets[index][2])));
   });
   syncDivider();
  }
  const sameSlot = (a, b) => !!a && !!b && a.every((value, index) => value === b[index]);
  function displaySlot(slot, area) {
   // Keep a saved side-by-side layout readable after the sidebar grows or
   // the viewport narrows. Widening restores the original split and ratio.
   return slot && area.width < 728 && slot[1] === 0 && slot[3] === 1 && slot[2] < 1
    ? [0, slot[0], 1, slot[2]] : slot;
  }
  function slotRect(slot, area = workArea()) {
   const [x, y, w, h] = slot, gap = 8;
   const left = Math.round(area.width * x) + (x > 0 ? gap / 2 : 0);
   const top = Math.round(area.height * y) + (y > 0 ? gap / 2 : 0);
   const right = Math.round(area.width * (x + w)) - (x + w < .999999 ? gap / 2 : 0);
   const bottom = Math.round(area.height * (y + h)) - (y + h < .999999 ? gap / 2 : 0);
   return { x: area.left + left, y: area.top + top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  }
  function fits(slot, area = workArea()) {
   const box = slotRect(slot, area);
   return box.w >= Math.min(360, area.width) && box.h >= Math.min(280, area.height);
  }
  function closeLayouts(focus = false) {
   windows.forEach(win => {
    if (!win.layoutMenu || win.layoutMenu.hidden) return;
    win.layoutMenu.hidden = true; win.layoutButton.setAttribute('aria-expanded', 'false');
    if (focus) win.layoutButton.focus({ preventScroll: true });
   });
  }
  function place(win, target) {
   closeLayouts();
   if (target === 'maximize') win.maximized = true;
   else { win.maximized = false; win.snap = presets.find(item => item[0] === target)?.[2].slice() || null; }
   layout(win); activate(win, true);
  }
  function arrangeWindows(items = windows.filter(win => !win.minimized)) {
   if (mobile.matches || !items.length) return;
   cancelDrag?.(); closeLayouts();
   const area = workArea(), count = items.length;
   // Prefer two columns for a pair. With more windows choose a grid that
   // keeps native forms readable; the last row fills its available width.
   let columns = count > 1 && area.width >= 728 ? 2 : 1;
   if (count > 2) {
    let best = Infinity;
    for (let cols = 1; cols <= Math.min(3, count); cols++) {
     const rows = Math.ceil(count / cols), w = (area.width - (cols - 1) * 8) / cols, h = (area.height - (rows - 1) * 8) / rows;
     const score = Math.max(0, 360 - w) / 36 + Math.max(0, 280 - h) / 28 + Math.abs(Math.log(Math.max(1, w) / Math.max(1, h) / 1.4)) + (cols * rows - count) * .15;
     if (score < best) { best = score; columns = cols; }
    }
   }
   const rows = Math.ceil(count / columns);
   items.forEach((win, index) => {
    const row = Math.floor(index / columns), inRow = Math.min(columns, count - row * columns);
    win.snap = [(index % columns) / inRow, row / rows, 1 / inRow, 1 / rows];
    win.maximized = false; layout(win);
   });
  }
  function tileWindows() {
   if (mobile.matches || windows.length < 2) return;
   windows.forEach(win => { win.minimized = false; });
   arrangeWindows(windows);
   activate(active || windows.at(-1), true);
  }
  function edgeTarget(x, y, area) {
   const side = x <= area.left + 24 ? 'left' : x >= area.right - 24 ? 'right' : null;
   const corner = y <= area.top + 80 ? 'top' : y >= area.bottom - 80 ? 'bottom' : null;
   for (const id of [side && corner && corner + '-' + side, side, y <= area.top + 24 ? 'maximize' : y >= area.bottom - 24 ? 'bottom' : null]) {
    if (id === 'maximize') return id;
    const preset = presets.find(item => item[0] === id);
    if (preset && fits(preset[2], area)) return id;
   }
   return null;
  }
  function previewSnap(target) {
   snapPreview.hidden = !target;
   if (!target) return;
   const area = workArea(), preset = presets.find(item => item[0] === target);
   const box = slotRect(preset?.[2] || [0, 0, 1, 1], area);
   Object.assign(snapPreview.style, { left: box.x - area.left + 'px', top: box.y - area.top + 'px', width: box.w + 'px', height: box.h + 'px' });
   snapPreview.firstChild.textContent = preset?.[1] || 'Maximize';
  }
  function detach(win) {
   if (!win.snap && !win.maximized) return;
   const box = win.node.getBoundingClientRect();
   win.snap = null; win.maximized = false;
   Object.assign(win, { x: box.x, y: box.y, w: box.width, h: box.height });
  }
  function syncDivider() {
   splitPair = null; divider.hidden = true;
   const visible = windows.filter(win => !win.minimized);
   if (mobile.matches || visible.length !== 2 || visible.some(win => !win.snap || win.maximized)) return;
   const [left, right] = visible.slice().sort((a, b) => a.snap[0] - b.snap[0]), a = left.snap, b = right.snap;
   if (a[0] !== 0 || a[1] !== 0 || b[1] !== 0 || a[3] !== 1 || b[3] !== 1 || Math.abs(a[2] - b[0]) > .000001 || Math.abs(b[0] + b[2] - 1) > .000001) return;
   const area = workArea(); if (area.width < 728) return;
   splitPair = [left, right]; divider.hidden = false;
   divider.style.left = Math.round(area.width * a[2]) - 4 + 'px';
   divider.setAttribute('aria-valuemin', Math.ceil(364 / area.width * 100));
   divider.setAttribute('aria-valuemax', Math.floor((1 - 364 / area.width) * 100));
   divider.setAttribute('aria-valuenow', Math.round(a[2] * 100));
   divider.setAttribute('aria-valuetext', Math.round(a[2] * 100) + '% / ' + Math.round(b[2] * 100) + '%');
  }
  function splitAt(ratio, pair = splitPair) {
   if (!pair) return;
   const area = workArea(), min = Math.min(.5, 364 / area.width);
   ratio = clamp(ratio, min, 1 - min);
   pair[0].snap = [0, 0, ratio, 1]; pair[1].snap = [ratio, 0, 1 - ratio, 1];
   pair.forEach(layout);
  }
  function workArea() {
   const right = document.documentElement.clientWidth, viewportHeight = innerHeight;
   const left = mobile.matches ? 0 : clamp(document.querySelector('.rd-sidebar')?.getBoundingClientRect().right || 0, 0, right);
   const top = clamp(document.querySelector('.rd-topbar')?.getBoundingClientRect().bottom || 0, 0, viewportHeight);
   const bottom = Math.max(top, tasks.hidden ? viewportHeight - 56 : tasks.getBoundingClientRect().top - 8);
   const area = { left, top, right, bottom, width: right - left, height: bottom - top };
   Object.assign(stage.style, { left: left + 'px', top: top + 'px', width: area.width + 'px', height: area.height + 'px' });
   return area;
  }
  function resize(win, width, height) {
   const area = workArea();
   win.w = clamp(width, Math.min(360, area.right - win.x), area.right - win.x);
   win.h = clamp(height, Math.min(280, area.bottom - win.y), area.bottom - win.y);
   layout(win);
  }
  function visibility() {
   windows.forEach(win => {
    win.node.hidden = win.minimized || (mobile.matches && active !== win);
    win.node.classList.toggle('rd-window-active', win === active && !win.minimized);
    win.task.setAttribute('aria-pressed', String(win === active && !win.minimized));
   });
   syncNavigationWindows();
   syncDivider();
  }
  function showMainPage() {
   cancelDrag?.(); closeLayouts();
   windows.forEach(win => { win.minimized = true; }); active = null; visibility(); save();
  }
  function activate(win, focus = false) {
   const wasMinimized = win.minimized;
   win.minimized = false; active = win; win.node.style.zIndex = ++z;
   if (wasMinimized && !restoring) arrangeWindows();
   visibility(); if (focus) win.label.focus({ preventScroll: true }); save();
  }
  function close(win, confirmed = false) {
   if (!confirmed && win.dirty && !confirm('Close this window and discard its unsaved edits? Changes already saved remain pending in LuCI.')) return;
   cancelDrag?.();
   win.stopEditor?.();
   win.dirty = false; win.node.remove(); win.task.remove();
   windows.splice(windows.indexOf(win), 1);
   if (!win.minimized) arrangeWindows();
   if (active === win) {
    active = windows.filter(item => !item.minimized).at(-1);
    if (active) activate(active, true);
    else {
     const trigger = mobile.matches && win.trigger?.closest('.rd-sidebar') ? document.getElementById('rd-menu-toggle') : win.trigger;
     if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
   }
   visibility(); save();
  }
  function guard(event, owner) {
   if (!owner.stale && !participants().some(other => other !== owner && other.dirty)) return;
   event.preventDefault(); event.stopImmediatePropagation();
   alert(owner.stale ? 'Reload this page before saving: settings changed in another window.' : 'Another window has unsaved changes. Save and apply or discard them before saving here. No save was sent.');
  }
  function presentEditor(win, realm) {
   const doc = realm.document;
   let modal, heading, attributes;
   const restore = () => {
    if (!attributes) return;
    for (const [key, value] of attributes) {
     if (value == null) modal.removeAttribute(key); else modal.setAttribute(key, value);
    }
    attributes = null;
   };
   const sync = () => {
    const next = doc.querySelector('#modal_overlay > .modal');
    if (next !== modal) {
     restore(); modalObserver.disconnect(); modal = next;
     if (modal) modalObserver.observe(modal, { childList: true, attributes: true, attributeFilter: ['class'] });
    }
    const nextHeading = modal?.querySelector(':scope > h4');
    if (nextHeading !== heading) {
     headingObserver.disconnect(); heading = nextHeading;
     if (heading) headingObserver.observe(heading, { childList: true, subtree: true, characterData: true });
    }
    // Preserve LuCI's modal map stack and handlers. Only its presentation is
    // promoted into the existing window; errors and confirmations stay dialogs.
    const editor = doc.body.classList.contains('modal-overlay-active') && modal?.matches('.cbi-modal') && modal.querySelector(':scope > .cbi-map:not(.hidden)');
    const title = editor ? heading?.textContent.trim() || win.title : null;
    doc.documentElement.classList.toggle('rd-window-editor', !!editor);
    if (editor) {
     attributes ||= ['role', 'aria-modal', 'aria-label'].map(key => [key, modal.getAttribute(key)]);
     modal.setAttribute('role', 'region'); modal.removeAttribute('aria-modal'); modal.setAttribute('aria-label', title);
    } else restore();
    if (win.editorTitle !== title) { win.editorTitle = title; status(win); }
   };
   // Observe only the modal shell and title, not live counters or form inputs.
   const modalObserver = new realm.MutationObserver(sync), headingObserver = new realm.MutationObserver(sync), bodyObserver = new realm.MutationObserver(sync);
   bodyObserver.observe(doc.body, { childList: true, attributes: true, attributeFilter: ['class'] });
   sync();
   return () => { bodyObserver.disconnect(); modalObserver.disconnect(); headingObserver.disconnect(); restore(); };
  }
  function attach(realm) {
   const doc = realm.document;
   if (attached.has(doc)) return;
   const owner = realm === window ? background : windows.find(win => win.frame?.contentWindow === realm);
   if (!owner) return;
   if (owner.document && owner.document !== doc) { owner.dirty = false; owner.stale = false; status(owner); }
   owner.document = doc;
   attached.add(doc); owner.realm = realm;
   if (realm !== window) {
    owner.stopEditor?.();
    doc.documentElement.classList.add('rd-window-frame');
    doc.documentElement.dataset.theme = document.documentElement.dataset.theme;
    doc.documentElement.dataset.darkmode = document.documentElement.dataset.darkmode;
    doc.addEventListener('pointerdown', () => { closeLayouts(); activate(owner); }, true);
    doc.addEventListener('focusin', () => { if (active !== owner) activate(owner); }, true);
    owner.stopEditor = presentEditor(owner, realm);
   }
   const edited = event => {
    if (!event.target.matches('input:not([type="search"]):not([type="button"]),select,textarea') || !event.target.closest('.cbi-map,form:not([role="search"])')) return;
    owner.dirty = true; status(owner);
   };
   doc.addEventListener('input', edited, true); doc.addEventListener('change', edited, true);
   doc.addEventListener('click', event => {
    // LuCI controls retain their native validation, staging and apply handlers.
    if (event.target.closest('.cbi-button-apply,.cbi-button-save,.cbi-button-positive,.cbi-button-reset,.cbi-button-negative,.cbi-page-actions button')) guard(event, owner);
   }, true);
   doc.addEventListener('submit', event => { if (!event.target.matches('[role="search"]')) guard(event, owner); }, true);
   const changed = () => {
    owner.dirty = false; owner.stale = false; status(owner);
    participants().filter(other => other !== owner).forEach(other => { other.stale = true; status(other); });
   };
   doc.addEventListener('uci-applied', changed); doc.addEventListener('uci-reverted', changed);
   doc.addEventListener('rd-preview-saved', () => { owner.dirty = false; status(owner); });
   doc.addEventListener('click', event => {
    if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
    if (link.closest('.rd-sidebar') || link.hasAttribute('data-rd-page-navigation')) {
     // The label is ordinary page navigation. Only the adjacent button opens
     // a window. Bring the requested page into view after a native reload too.
     if (realm === window) {
      const samePage = link.href === location.href;
      if (options.preview && !samePage && background.dirty) {
       if (!confirm('Leave this page and discard its unsaved edits?')) { event.preventDefault(); return; }
       background.dirty = false; status(background);
      }
      if (samePage) event.preventDefault();
      if (samePage || options.preview) showMainPage();
      else {
       // Minimize only in the destination document. If beforeunload is
       // cancelled, the edited window stays visible with its inputs intact.
       try { sessionStorage.setItem(navigationKey, new URL(link.href).pathname); } catch (_) {}
      }
      closeNavigation();
      if (samePage) document.getElementById('maincontent')?.focus({ preventScroll: true });
     }
     return;
    }
    if (link.closest('#tabmenu,.cbi-tabmenu,.tabs') || link.getAttribute('href') === '#') return;
    const destination = resolve(link.href, realm.location.href);
    if (!destination) return;
    event.preventDefault(); event.stopImmediatePropagation();
    open(destination.href, { trigger: link });
    closeNavigation(doc);
   }, true);
   realm.addEventListener('beforeunload', event => {
    if (owner.dirty || realm === window && windows.some(win => win.dirty)) { event.preventDefault(); event.returnValue = ''; }
   });
  }
  function create(title, key, saved = {}) {
   const existing = windows.find(win => win.key === key);
   if (existing) { if (saved.trigger) existing.trigger = saved.trigger; activate(existing, true); return { existing }; }
   if (windows.length >= 6) { alert('Six windows are open. Close one to open another.'); return {}; }
   const area = workArea();
   const win = { title, key, x: area.left + 24 + windows.length * 24, y: area.top + 18 + windows.length * 24, w: mobile.matches ? 760 : Math.min(960, area.width - 48), h: Math.max(520, area.height - 100), dirty: false, stale: false, ...saved };
   win.snap = validSlot(saved.snap) ? saved.snap.slice() : null;
   win.label = el('button', { type: 'button', class: 'rd-window-title', title: 'Drag to an edge to snap. Arrow keys move; Shift + arrows resize. Ctrl + Alt + arrows snap or restore.' }, title);
   win.status = el('div', { class: 'rd-window-status', role: 'status', hidden: '' });
   const control = (name, icon, click) => el('button', { type: 'button', class: 'rd-window-control', 'aria-label': name + ' ' + title, title: name, 'data-action': name.toLowerCase(), onclick: click }, icon);
   win.reload = control('Reload', RD.icon('reboot'), () => {
    if (win.dirty && !confirm('Reload this window and discard its unsaved edits? Changes already saved remain pending in LuCI.')) return;
    win.dirty = false; win.stale = false; status(win);
    win.frame?.contentWindow.location.reload();
   });
   win.maximize = control('Maximize', RD.icon('overview'), () => { closeLayouts(); win.maximized = !win.maximized; layout(win); save(); });
   win.layoutButton = control('Layout', glyph(), () => {
    const show = win.layoutMenu.hidden; closeLayouts();
    if (show) { layout(win); win.layoutMenu.hidden = false; win.layoutButton.setAttribute('aria-expanded', 'true'); win.layoutMenu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true }); }
   });
   win.layoutButton.setAttribute('aria-expanded', 'false');
   win.layoutOptions = presets.map(([id, label, slot]) => el('button', { type: 'button', 'data-snap': id, onclick: () => place(win, id) }, [glyph(slot), label]));
   win.layoutMenu = el('div', { class: 'rd-window-layout-menu', role: 'group', 'aria-label': 'Window layout', hidden: '' }, [
    ...win.layoutOptions,
    el('button', { type: 'button', onclick: () => place(win, 'maximize') }, [glyph([0, 0, 1, 1]), 'Maximize']),
    el('button', { type: 'button', onclick: () => place(win, 'floating') }, [glyph([.15, .15, .7, .7]), 'Floating window']),
    el('p', {}, 'Drag to an edge to snap. Hold Alt to move freely.')
   ]);
   const bar = el('div', { class: 'rd-window-titlebar' }, [win.label, win.layoutButton, win.reload,
    control('Minimize', '−', () => { closeLayouts(); win.minimized = true; active = windows.filter(item => item !== win && !item.minimized).at(-1); arrangeWindows(); visibility(); save(); win.task.focus(); }),
    win.maximize, control('Close', '×', () => close(win))]);
   win.resize = el('button', { type: 'button', class: 'rd-window-resize', 'aria-label': 'Resize ' + title, title: 'Drag to resize. Arrow keys resize.' }, '');
   win.node = el('section', { class: 'rd-window', role: 'dialog', 'aria-modal': 'false', 'aria-label': title }, [bar, win.layoutMenu, win.status]);
   win.task = el('button', { type: 'button', 'aria-pressed': 'false', title, onclick: () => activate(win, true) }, title);
   windows.push(win); stage.append(win.node); taskItems.append(win.task);
   win.node.addEventListener('pointerdown', () => { if (active !== win) activate(win); });
   win.label.addEventListener('dblclick', () => win.maximize.click());
   const keyMove = (event, resizing) => {
    const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
    if (!delta || mobile.matches || cancelDrag) return;
    if (event.ctrlKey && event.altKey && !resizing) {
     const target = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'maximize', ArrowDown: 'floating' }[event.key];
     const slot = presets.find(item => item[0] === target)?.[2];
     event.preventDefault(); if (!slot || fits(slot)) place(win, target); return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || win.maximized) return;
    event.preventDefault();
    detach(win);
    if (resizing || event.shiftKey) resize(win, win.w + delta[0], win.h + delta[1]);
    else { win.x += delta[0]; win.y += delta[1]; layout(win); }
    save();
   };
   win.label.addEventListener('keydown', event => keyMove(event, false));
   win.resize.addEventListener('keydown', event => keyMove(event, true));
   [win.label, win.resize].forEach(handle => {
    let start;
    handle.addEventListener('pointerdown', event => {
     if (event.button !== 0 || mobile.matches || handle === win.resize && win.maximized) return;
     cancelDrag?.(); closeLayouts();
     event.preventDefault(); handle.focus({ preventScroll: true });
     const box = win.node.getBoundingClientRect();
     start = { id: event.pointerId, px: event.clientX, py: event.clientY, x: win.x, y: win.y, w: win.w, h: win.h,
      anchor: clamp((event.clientX - box.x) / box.width, 0, 1), offsetY: event.clientY - box.y,
      original: { x: win.x, y: win.y, w: win.w, h: win.h, snap: win.snap, maximized: win.maximized } };
     cancelDrag = () => finish(false);
     clearDragSnap = () => { if (start) start.target = null; previewSnap(null); };
     handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
     if (!start || event.pointerId !== start.id) return;
     if (!start.moving) {
      if (Math.hypot(event.clientX - start.px, event.clientY - start.py) < 4) return;
      start.moving = true; stage.classList.add('rd-window-moving');
      if (handle === win.resize) {
       detach(win); Object.assign(start, { x: win.x, y: win.y, w: win.w, h: win.h });
      } else if (win.maximized || win.snap) {
       // Tear off a snapped/maximized window at its floating size, keeping
       // the title under the pointer instead of jumping back to old coordinates.
       win.snap = null; win.maximized = false;
       win.x = event.clientX - start.anchor * win.w; win.y = event.clientY - start.offsetY; layout(win);
       Object.assign(start, { px: event.clientX, py: event.clientY, x: win.x, y: win.y });
      }
     }
     if (handle === win.resize) resize(win, start.w + event.clientX - start.px, start.h + event.clientY - start.py);
     else {
      win.x = start.x + event.clientX - start.px; win.y = start.y + event.clientY - start.py; layout(win);
      start.target = event.altKey ? null : edgeTarget(event.clientX, event.clientY, workArea()); previewSnap(start.target);
     }
    });
    const finish = (commit, event) => {
     if (!start) return;
     const previous = start; start = null; cancelDrag = null; clearDragSnap = null;
     stage.classList.remove('rd-window-moving'); previewSnap(null);
     if (!commit) Object.assign(win, previous.original);
     else if (previous.moving && previous.target && !event?.altKey) place(win, previous.target);
     layout(win); save();
     if (handle.hasPointerCapture(previous.id)) handle.releasePointerCapture(previous.id);
    };
    handle.addEventListener('pointerup', event => finish(true, event));
    handle.addEventListener('pointercancel', () => finish(false)); handle.addEventListener('lostpointercapture', () => finish(false));
   });
   layout(win);
   // Arrange only when membership changes. Focusing an existing window or
   // restoring a saved layout must preserve the user's positions and split.
   if (!restoring) arrangeWindows();
   activate(win, !restoring);
   if (saved.minimized) { win.minimized = true; visibility(); }
   return { win };
  }
  function open(href, options = {}) {
   const page = resolve(href); if (!page) return false;
   const { win } = create(page.title, page.href, options);
   if (!win) return true;
   win.page = page;
   const fullPage = el('a', { class: 'rd-window-control', href: page.href, 'data-rd-page-navigation': '', title: 'Open as a page', 'aria-label': 'Open as a page: ' + page.title }, '↗');
   win.reload.before(fullPage);
   const src = new URL(page.href, location.href); src.searchParams.set('rdwindow', '1');
   win.frame = el('iframe', { title: page.title, src: src.pathname + src.search + src.hash });
   win.frame.addEventListener('load', () => {
    try {
     const doc = win.frame.contentDocument;
     if (!doc || win.frame.contentWindow.location.origin !== location.origin) throw new Error('origin');
     if (doc.querySelector('body.rd-login')) { win.status.hidden = false; win.status.textContent = 'Session expired. Sign in again to continue.'; return; }
     attach(win.frame.contentWindow);
    } catch (_) { win.status.hidden = false; win.status.textContent = 'Unable to load this page. Close this window and sign in again.'; }
   });
   win.node.append(win.frame, win.resize); save(); return true;
  }
  function content(title, body, key = title, trigger) {
   const { win } = create(title, 'detail:' + key, { trigger, w: 640, h: 540 });
   if (!win) return;
   win.reload.hidden = true;
   // Cross-frame DOM is adopted with its click handlers intact.
   const container = el('div', { class: 'rd-window-content' }); container.append(body);
   win.node.append(container, win.resize); save();
  }
  const closeAll = el('button', { type: 'button', class: 'rd-window-close-all', title: 'Close all windows', 'aria-label': 'Close all windows', onclick: () => {
   if (windows.some(win => win.dirty) && !confirm('Close all windows and discard their unsaved edits? Changes already saved remain pending in LuCI.')) return;
   [...windows].forEach(win => close(win, true));
  } }, '×');
  const showPage = el('button', { type: 'button', title: 'Show main page', 'aria-label': 'Show main page', onclick: showMainPage }, RD.icon('dashboard'));
  const tile = el('button', { type: 'button', class: 'rd-tile-windows', 'aria-label': 'Tile windows', onclick: tileWindows }, [glyph(), 'Tile windows']);
  tasks.append(showPage, tile, taskItems, closeAll); tasks.hidden = true;
  document.body.append(stage, tasks);
  RD.windows = { open, content, attach, resolve, decorateNavigation };
  let splitDrag;
  const finishSplit = commit => {
   if (!splitDrag) return;
   const previous = splitDrag; splitDrag = null; cancelDrag = null;
   stage.classList.remove('rd-window-moving');
   if (!commit) { previous.pair.forEach((win, index) => { win.snap = previous.slots[index]; }); previous.pair.forEach(layout); }
   save();
   if (divider.hasPointerCapture(previous.id)) divider.releasePointerCapture(previous.id);
  };
  divider.addEventListener('pointerdown', event => {
   if (event.button || !splitPair) return;
   cancelDrag?.(); closeLayouts(); event.preventDefault(); divider.focus({ preventScroll: true });
   splitDrag = { id: event.pointerId, pair: splitPair, slots: splitPair.map(win => win.snap.slice()) };
   cancelDrag = () => finishSplit(false); divider.setPointerCapture(event.pointerId); stage.classList.add('rd-window-moving');
  });
  divider.addEventListener('pointermove', event => {
   if (!splitDrag || event.pointerId !== splitDrag.id) return;
   const area = workArea(); splitAt((event.clientX - area.left) / area.width, splitDrag.pair);
  });
  divider.addEventListener('pointerup', () => finishSplit(true));
  divider.addEventListener('pointercancel', () => finishSplit(false));
  divider.addEventListener('lostpointercapture', () => finishSplit(false));
  divider.addEventListener('dblclick', () => { splitAt(.5); save(); });
  divider.addEventListener('keydown', event => {
   if (!splitPair || cancelDrag) return;
   const ratio = splitPair[0].snap[2], step = event.shiftKey ? .1 : .02;
   const next = { ArrowLeft: ratio - step, ArrowRight: ratio + step, Home: 0, End: 1 }[event.key];
   if (next == null) return;
   event.preventDefault(); splitAt(next); save();
  });
  decorateNavigation();
  attach(window);
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.rd-window-layout-menu,[data-action="layout"]')) closeLayouts(); }, true);
  document.addEventListener('keydown', event => {
   if (event.key === 'Escape' && (cancelDrag || windows.some(win => !win.layoutMenu.hidden))) {
    event.preventDefault(); event.stopPropagation(); cancelDrag?.(); closeLayouts(true);
   }
   if (event.key === 'Alt') clearDragSnap?.();
  });
  window.addEventListener('blur', () => { cancelDrag?.(); closeLayouts(); });
  new MutationObserver(() => windows.forEach(win => {
   try {
    const html = win.frame?.contentDocument?.documentElement;
    if (html) { html.dataset.theme = document.documentElement.dataset.theme; html.dataset.darkmode = document.documentElement.dataset.darkmode; }
   } catch (_) {}
  })).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const relayout = () => { cancelDrag?.(); workArea(); windows.forEach(layout); visibility(); };
  window.addEventListener('resize', relayout);
  // Sidebar resizing does not fire a viewport resize event. Also observe the
  // chrome so zoom, taskbar scrollbars and mobile navigation keep correct bounds.
  const chromeResize = new ResizeObserver(relayout);
  [document.querySelector('.rd-sidebar'), document.querySelector('.rd-topbar'), tasks].filter(Boolean).forEach(node => chromeResize.observe(node));
  requestAnimationFrame(() => {
   restoring = true;
   const stored = RD.storage.get(storageKey, []);
   if (Array.isArray(stored)) stored.slice(0, 6).forEach(item => {
    if (!item || !resolve(item.href)) return;
    open(item.href, { x: item.x, y: item.y, w: item.w, h: item.h, snap: item.snap, maximized: !!item.maximized, minimized: showMainOnRestore || !!item.minimized });
   });
   active = windows.filter(win => !win.minimized).at(-1); visibility();
   restoring = false; save();
  });
  return RD.windows;
 };
})();
