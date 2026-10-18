// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'preact/hooks';
import { Toolbar } from './Toolbar.jsx';
import { Menu } from './Menu.jsx';
import { MENU, visibleMenu } from './menu.js';
import { WorkArea } from '../mdi/WorkArea.jsx';
import { focusWindow } from '../mdi/focus.js';
import { manager, routerInfo, logout } from '../state.js';

function openWindow(kind) {
 focusWindow(manager.open(kind));
}

export function Desktop({ inert = false }) {
 useEffect(() => {
  const keys = event => {
   if (event.key === 'F6') {
    event.preventDefault();
    manager.cycle(event.shiftKey ? -1 : 1);
    const next = manager.active();
    if (next) focusWindow(next.id);
   } else if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyT') {
    event.preventDefault();
    openWindow('terminal');
   }
  };
  document.addEventListener('keydown', keys);
  return () => document.removeEventListener('keydown', keys);
 }, []);

 return (
  <div class="rd-desktop" inert={inert || undefined}>
   <Toolbar />
   <div class="rd-main">
    <div class="rd-brand" aria-hidden="true"><span>RouterDeck Console</span></div>
    <Menu items={visibleMenu(MENU, routerInfo.value?.capabilities)} onOpen={openWindow}
     onAction={action => { if (action === 'logout') logout(); }} />
    <WorkArea />
   </div>
  </div>
 );
}
