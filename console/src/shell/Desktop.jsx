// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'preact/hooks';
import { Toolbar } from './Toolbar.jsx';
import { Menu } from './Menu.jsx';
import { MENU, visibleMenu } from './menu.js';
import { WorkArea } from '../mdi/WorkArea.jsx';
import { focusWindow } from '../mdi/focus.js';
import { Overlays, askConfirm } from './overlays.jsx';
import { notify, errorText } from '../api/actions.js';
import { openWindow } from '../windows/open.js';
import { resetSources } from '../api/sources.js';
import { manager, routerInfo, logout, client, board } from '../state.js';

const ACTIONS = {
 logout: () => { resetSources(); logout(); },
 cascade: () => manager.cascadeAll(),
 tile: () => manager.tileAll(),
 'minimize-all': () => manager.minimizeAll(),
 'close-all': () => manager.closeAll(),
 reset: async () => {
  if (!await askConfirm({ title: 'Reset Configuration', text: `Erase every setting and installed package of ${board.value?.hostname ?? 'the router'} and reboot with the firmware's defaults? The router comes back at its default address; Undo and Safe Mode cannot take this back.`, submitLabel: 'Reset' })) return;
  try {
   const result = await client.call('routerdeck', 'reset');
   if (result?.ok === false) throw new Error(result.message);
   notify('The configuration is being reset; the router reboots with its defaults', 'warning');
  } catch (failure) {
   notify(`Reset failed: ${errorText(failure)}`, 'error');
  }
 },
 reboot: async () => {
  if (!await askConfirm({ title: 'Reboot', text: `Reboot ${board.value?.hostname ?? 'the router'} now? Open windows reconnect after you log in again.`, submitLabel: 'Reboot' })) return;
  try {
   await client.call('system', 'reboot');
   notify('The router is rebooting', 'warning');
  } catch (failure) {
   notify(`Reboot failed: ${errorText(failure)}`, 'error');
  }
 }
};

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
    <Menu items={visibleMenu(MENU, routerInfo.value?.capabilities)} onOpen={openWindow} onAction={action => ACTIONS[action]?.()} />
    <WorkArea />
   </div>
   <Overlays />
  </div>
 );
}
