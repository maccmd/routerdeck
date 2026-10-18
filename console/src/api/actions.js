// SPDX-License-Identifier: Apache-2.0
// Changes go through the routerdeck plugin: one call applies, validates,
// reloads services and records the change for Undo.
import { signal } from '@preact/signals';
import { client, board, user } from '../state.js';
import { NULL_SESSION } from './rpc.js';
import { poller } from './sources.js';
import { pickFile, uploadFile, downloadFile } from './files.js';
import { askConfirm } from '../shell/overlays.jsx';
import { openWindow, openJob } from '../windows/open.js';

export const notice = signal(null);

export function notify(text, tone = 'info') {
 notice.value = { text, tone, at: Date.now() };
}

export class ActionError extends Error {
 constructor(result) {
  super(result?.message || 'The router did not accept the change');
  this.name = 'ActionError';
  this.code = result?.error;
  this.details = result?.details;
 }
}

const AFFECTED = ['history', 'safemode', 'routes4', 'routes6', 'netdev', 'counters', 'ifaces', 'devices', 'leases', 'wireless', 'wifi', 'crontab', 'rc', 'sysinfo', 'wireguard', 'rules', 'neighbors', 'upnp', 'ddns', 'qdisc', 'netwatch', 'packages', 'jobs', 'users', 'certificates', 'leds', 'disks', 'sysctl', 'pppfiles', 'openvpn', 'ipsec', 'bird', 'tables', 'queuestats'];
const affected = key => key.startsWith('uci:') || AFFECTED.includes(key);

// Services reload about a second after a commit; look again once they have.
function refreshAfterChange() {
 poller.refresh(affected);
 setTimeout(() => poller.refresh(affected), 1500);
 setTimeout(() => poller.refresh(affected), 4000);
}

// Models describe what to do as data, so they stay testable without a
// router: `ops` are configuration changes (one Undo step each); `call` and
// `calls` are other rpcd calls such as starting a service; `verify` checks
// a password first; `download` fetches a file with this session. Steps run
// in this order, and any of them may be left out:
//   ask      a confirmation before anything happens
//   upload   a file the user picks, sent to `upload.path` on the router
//   check    an rpcd call whose reply `reject` may refuse and `confirm`
//            turns into a question; refusing or declining runs `cancel`
//   call(s), download, then
//   job      a package operation or script, shown in its own window
//   open     another window, such as Install Package
export async function perform(change) {
 if (!change) return null;
 if (change.ops) return apply(change);
 if (change.ask && !await askConfirm(change.ask)) return null;
 if (change.verify) {
  let session;
  try {
   session = await client.call('session', 'login', { username: change.verify.username ?? user.value ?? 'root', password: change.verify.password }, { session: NULL_SESSION });
  } catch (failure) {
   throw new ActionError({ message: failure.status === 6 ? 'The current password is wrong' : failure.message });
  }
  await client.call('session', 'destroy', {}, { session: session.ubus_rpc_session }).catch(() => {});
 }
 if (change.upload) {
  // Several files (a certificate and its key) go where `paths` says.
  const picked = await pickFile(change.upload.accept, !!change.upload.multiple);
  if (!picked) return null;
  const files = [].concat(picked);
  for (const file of files) {
   let shown = -1;
   for (const path of change.upload.paths ? change.upload.paths(file, files) : [change.upload.path]) {
    await uploadFile(path, file, {
     onProgress: share => {
      const percent = Math.floor(share * 10) * 10;
      if (percent !== shown && file.size > 1024 * 1024) { shown = percent; notify(`Uploading ${file.name}: ${percent}%`); }
     }
    }).catch(failure => { throw new ActionError({ message: failure.message }); });
   }
  }
 }
 if (change.check) {
  const [object, method, args = {}] = change.check;
  const result = await client.call(object, method, args);
  if (result?.ok === false) throw new ActionError(result);
  const problem = change.reject?.(result);
  if (problem) {
   if (change.cancel) await client.call(...change.cancel).catch(() => {});
   throw new ActionError({ message: problem });
  }
  if (change.confirm && !await askConfirm(change.confirm(result))) {
   if (change.cancel) await client.call(...change.cancel).catch(() => {});
   return null;
  }
 }
 for (const [object, method, args = {}] of change.calls ?? (change.call ? [change.call] : [])) {
  // A username left empty means the account of this session.
  const result = await client.call(object, method, 'username' in args && !args.username ? { ...args, username: user.value ?? 'root' } : args);
  if (result && (result.ok === false || result.result === false)) throw new ActionError(result);
 }
 if (change.download) await downloadFile(change.download).catch(failure => { throw new ActionError({ message: failure.message }); });
 if (change.job) openJob(change.job);
 if (change.open) openWindow(change.open);
 poller.refresh(affected);
 setTimeout(() => poller.refresh(affected), 1500);
 if (change.notice) notify(change.notice, change.tone);
 return { ok: true };
}

export async function apply(change) {
 if (!change?.ops?.length) return null;
 const result = await client.call('routerdeck', 'apply', { description: change.description, ops: change.ops });
 if (!result?.ok) throw new ActionError(result);
 refreshAfterChange();
 // The identity in the title follows a new host name once it is set.
 if (change.ops.some(op => op.config === 'system')) setTimeout(() => client.call('system', 'board').then(identity => { board.value = identity; }, () => {}), 2000);
 if (change.notice) notify(change.notice, 'warning');
 if (result.safemode_released) notify('Safe Mode ended after 100 changes; the changes were kept', 'warning');
 return result;
}

async function step(direction) {
 const result = await client.call('routerdeck', direction);
 if (!result?.ok) throw new ActionError(result);
 refreshAfterChange();
 notify(`${direction === 'undo' ? 'Undone' : 'Redone'}: ${result.description}`);
 return result;
}

export const undo = () => step('undo');
export const redo = () => step('redo');

export async function safemode(action, options = {}) {
 const result = await client.call('routerdeck', 'safemode', { action, ...options });
 if (!result?.ok) throw new ActionError(result);
 poller.refresh(key => key === 'safemode' || affected(key));
 return result;
}

export function errorText(error) {
 return error?.details ? `${error.message}: ${error.details}` : error?.message ?? String(error);
}
