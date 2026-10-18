// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { systemInfo, routerInfo, refreshSystemInfo } from '../state.js';
import { uptime, load, memoryUsage } from '../lib/format.js';

const POLL_MS = 5000;

export function Toolbar() {
 // Polling also keeps the rpcd session alive while the console is open.
 useEffect(() => {
  const timer = setInterval(() => { if (!document.hidden) refreshSystemInfo().catch(() => {}); }, POLL_MS);
  return () => clearInterval(timer);
 }, []);
 const info = systemInfo.value, backend = routerInfo.value;
 return (
  <header class="rd-toolbar" role="toolbar" aria-label="Session">
   <button type="button" class="rd-tbtn" disabled title="Undo" aria-label="Undo"><Icon name="undo" /></button>
   <button type="button" class="rd-tbtn" disabled title="Redo" aria-label="Redo"><Icon name="redo" /></button>
   <button type="button" class="rd-tbtn rd-safe" disabled aria-pressed="false" title="Safe Mode is not available yet">Safe Mode</button>
   <span class="rd-session">Session: <strong>{location.host}</strong>{backend?.mock && ' (simulated)'}</span>
   {!backend && <span class="rd-warning" role="status">RouterDeck rpcd plugin unavailable</span>}
   <span class="rd-spacer" />
   <dl class="rd-infofields" aria-label="System status">
    <div><dt>Uptime</dt><dd>{uptime(info?.uptime)}</dd></div>
    <div><dt>Load</dt><dd>{load(info?.load?.[0])}</dd></div>
    <div><dt>Memory</dt><dd>{memoryUsage(info?.memory)}</dd></div>
   </dl>
  </header>
 );
}
