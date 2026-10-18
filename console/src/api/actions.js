// SPDX-License-Identifier: Apache-2.0
// Changes go through the routerdeck plugin: one call applies, validates,
// reloads services and records the change for Undo.
import { signal } from '@preact/signals';
import { client } from '../state.js';
import { poller } from './sources.js';

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

const AFFECTED = ['history', 'safemode', 'routes4', 'routes6', 'netdev', 'counters', 'ifaces', 'devices', 'leases', 'wireless', 'wifi'];
const affected = key => key.startsWith('uci:') || AFFECTED.includes(key);

// Services reload about a second after a commit; look again once they have.
function refreshAfterChange() {
 poller.refresh(affected);
 setTimeout(() => poller.refresh(affected), 1500);
 setTimeout(() => poller.refresh(affected), 4000);
}

export async function apply(change) {
 if (!change?.ops?.length) return null;
 const result = await client.call('routerdeck', 'apply', { description: change.description, ops: change.ops });
 if (!result?.ok) throw new ActionError(result);
 refreshAfterChange();
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
