// SPDX-License-Identifier: Apache-2.0
// Session toolbar: Undo, Redo, Safe Mode, the session, notices and status.
import { useEffect } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { systemInfo, routerInfo, refreshSystemInfo, perTab, theme, setTheme } from '../state.js';
import { useSources } from '../api/sources.js';
import { undo, redo, safemode, notify, notice, errorText } from '../api/actions.js';
import { uptime, load, memoryUsage, clock } from '../lib/format.js';

const POLL_MS = 5000;
const PING_MS = 10000;
const THEMES = { system: 'Theme: follow system', light: 'Theme: light', dark: 'Theme: dark' };

function SafeMode({ state }) {
 const mine = !!state?.mine, taken = state?.active && !mine;
 // Heartbeats keep running in background tabs; the router rolls back when
 // they stop for the Safe Mode timeout.
 useEffect(() => {
  if (!mine) return undefined;
  const timer = setInterval(() => safemode('ping').catch(() => {}), PING_MS);
  return () => clearInterval(timer);
 }, [mine]);

 // Report a rollback that happened while this tab was away.
 useEffect(() => {
  const rollback = state?.last_rollback, since = perTab.get('safemode-since', 0);
  // The router reports whole seconds; compare at that precision.
  if (!rollback || !since || rollback.time < Math.floor(since / 1000) || perTab.get('safemode-reported') === rollback.time) return;
  perTab.set('safemode-reported', rollback.time);
  perTab.remove('safemode-since');
  notify(`Safe Mode ${rollback.reason} at ${clock(rollback.time * 1000)}${rollback.configs?.length ? `: restored ${rollback.configs.join(', ')}` : ''}`, 'warning');
 }, [state?.last_rollback?.time]);

 async function toggle() {
  try {
   if (mine) {
    await safemode('exit', { keep: true });
    perTab.remove('safemode-since');
    notify('Safe Mode off; changes kept');
   } else {
    perTab.set('safemode-since', Date.now());
    await safemode('enter');
    notify(`Safe Mode on: changes are undone if this console stops responding for ${state?.timeout ?? 120} s`);
   }
  } catch (error) {
   notify(errorText(error), 'error');
  }
 }

 async function discard() {
  try {
   const result = await safemode('exit', { keep: false });
   perTab.remove('safemode-since');
   notify(result.restored?.length ? `Safe Mode changes undone: restored ${result.restored.join(', ')}` : 'Safe Mode off; nothing to undo');
  } catch (error) {
   notify(errorText(error), 'error');
  }
 }

 return (
  <>
   <button type="button" class={`rd-tbtn rd-safe${mine ? ' is-on' : ''}`} aria-pressed={mine ? 'true' : 'false'} disabled={!state || taken} onClick={toggle}
    title={taken ? `Safe Mode is used by ${state.owner}` : mine ? `Safe Mode: ${state.count} of ${state.limit} changes. Click to keep them and leave Safe Mode.` : 'Undo changes automatically if this console loses the router'}>
    Safe Mode
   </button>
   {mine && <button type="button" class="rd-tbtn" onClick={discard} title="Leave Safe Mode and undo its changes">Undo Safe Mode changes</button>}
  </>
 );
}

export function Toolbar() {
 const { data } = useSources(['history', 'safemode']);
 useEffect(() => {
  const timer = setInterval(() => { if (!document.hidden) refreshSystemInfo().catch(() => {}); }, POLL_MS);
  return () => clearInterval(timer);
 }, []);
 useEffect(() => {
  const keys = event => {
   if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z' || event.target.matches?.('input, textarea, select')) return;
   event.preventDefault();
   (event.shiftKey ? redo : undo)().catch(error => notify(errorText(error), 'error'));
  };
  document.addEventListener('keydown', keys);
  return () => document.removeEventListener('keydown', keys);
 }, []);
 useEffect(() => {
  if (!notice.value) return undefined;
  const timer = setTimeout(() => { notice.value = null; }, notice.value.tone === 'info' ? 6000 : 15000);
  return () => clearTimeout(timer);
 }, [notice.value]);

 const info = systemInfo.value, backend = routerInfo.value, history = data.history;
 const step = action => action().catch(error => notify(errorText(error), 'error'));
 const nextTheme = { system: 'light', light: 'dark', dark: 'system' }[theme.value];
 return (
  <header class="rd-toolbar" role="toolbar" aria-label="Session">
   <button type="button" class="rd-tbtn" disabled={!history?.undo} onClick={() => step(undo)} aria-label="Undo" title={history?.undo ? `Undo: ${history.undo.description}` : 'Nothing to undo'}><Icon name="undo" /></button>
   <button type="button" class="rd-tbtn" disabled={!history?.redo} onClick={() => step(redo)} aria-label="Redo" title={history?.redo ? `Redo: ${history.redo.description}` : 'Nothing to redo'}><Icon name="redo" /></button>
   {backend && <SafeMode state={data.safemode} />}
   <span class="rd-session">Session: <strong>{location.host}</strong>{backend?.mock && ' (simulated)'}</span>
   {!backend && <span class="rd-warning" role="status">RouterDeck rpcd plugin unavailable</span>}
   <span class={`rd-notice${notice.value ? ' tone-' + notice.value.tone : ''}`} role="status" aria-live="polite">{notice.value?.text ?? ''}</span>
   <dl class="rd-infofields" aria-label="System status">
    <div><dt>Uptime</dt><dd>{uptime(info?.uptime)}</dd></div>
    <div><dt>Load</dt><dd>{load(info?.load?.[0])}</dd></div>
    <div><dt>Memory</dt><dd>{memoryUsage(info?.memory)}</dd></div>
   </dl>
   <button type="button" class="rd-tbtn" aria-label={`${THEMES[theme.value]}. Switch to ${nextTheme}`} title={THEMES[theme.value]} onClick={() => setTheme(nextTheme)}>
    <Icon name={theme.value === 'dark' ? 'moon' : theme.value === 'light' ? 'sun' : 'contrast'} />
   </button>
  </header>
 );
}

