// SPDX-License-Identifier: Apache-2.0
// Application state shared by the shell: session, router identity, windows.

import { signal } from '@preact/signals';
import { createClient } from './api/rpc.js';
import { createStorage } from './lib/storage.js';
import { createWindowManager } from './mdi/manager.js';
import { WINDOW_KINDS } from './windows/kinds.js';

const webStorage = name => { try { return globalThis[name] ?? null; } catch { return null; } };
// Per-browser preferences (layout, columns, theme) and per-tab session data.
export const preferences = createStorage(webStorage('localStorage'));
export const perTab = createStorage(webStorage('sessionStorage'));

export const theme = signal(['light', 'dark'].includes(preferences.get('theme')) ? preferences.get('theme') : 'system');
export function applyTheme() {
 const root = globalThis.document?.documentElement;
 if (!root) return;
 if (theme.value === 'system') delete root.dataset.theme;
 else root.dataset.theme = theme.value;
}
export function setTheme(value) {
 theme.value = value;
 preferences.set('theme', value);
 applyTheme();
}

export const phase = signal('starting'); // starting | login | desktop
export const expired = signal(false);
export const user = signal(null);
export const board = signal(null);
export const systemInfo = signal(null);
export const routerInfo = signal(null);

export const client = createClient({
 onExpired() {
  perTab.remove('session');
  if (phase.value === 'desktop') expired.value = true;
  else phase.value = 'login';
 }
});

export const manager = createWindowManager({ kinds: WINDOW_KINDS, storage: preferences });
export const windows = signal(manager.list());
manager.subscribe(list => { windows.value = list; });

async function loadRouter() {
 const [identity, info, backend] = await Promise.all([
  client.call('system', 'board'),
  client.call('system', 'info'),
  // The console still works without its rpcd plugin; the toolbar reports it.
  client.call('routerdeck', 'info').catch(() => null)
 ]);
 board.value = identity;
 systemInfo.value = info;
 routerInfo.value = backend;
}

export async function start() {
 const saved = perTab.get('session');
 if (typeof saved?.sid === 'string') {
  client.session = saved.sid;
  try {
   await loadRouter();
   user.value = saved.username;
   phase.value = 'desktop';
   return;
  } catch {
   client.session = null;
   perTab.remove('session');
  }
 }
 phase.value = 'login';
}

export async function login(username, password) {
 const session = await client.login(username, password);
 try {
  await loadRouter();
 } catch (error) {
  // A login without access to basic system data is unusable; do not leave it open.
  await client.logout();
  throw error;
 }
 perTab.set('session', { sid: session.sid, username: session.username });
 user.value = session.username;
 // After an expired session the desktop and its windows stay as they were.
 expired.value = false;
 phase.value = 'desktop';
}

export async function logout() {
 await client.logout();
 perTab.remove('session');
 manager.reset();
 expired.value = false;
 phase.value = 'login';
}

export async function refreshSystemInfo() {
 systemInfo.value = await client.call('system', 'info');
}
