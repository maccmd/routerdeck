// SPDX-License-Identifier: Apache-2.0
// Shared live data. Each source is loaded once per interval however many
// windows show it. All sources due in a tick start together, so the rpc
// client sends them as one JSON-RPC batch. Nothing is polled while the page
// is hidden or no window subscribes.

export function createPoller({ tick = 1000, hidden = () => globalThis.document?.hidden ?? false, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval } = {}) {
 const sources = new Map();
 let timer = null;

 function source(key, load, every) {
  if (!sources.has(key)) sources.set(key, { key, load, every, listeners: new Set(), value: undefined, error: null, at: 0, pending: null, version: 0 });
  const entry = sources.get(key);
  entry.every = Math.min(entry.every, every);
  return entry;
 }

 function notify(entry) {
  entry.listeners.forEach(listener => listener(entry));
 }

 // A newer request (from refresh) supersedes an older one still in flight.
 function fetch(entry) {
  if (entry.pending) return entry.pending;
  const version = ++entry.version;
  const current = () => version === entry.version;
  entry.pending = Promise.resolve().then(entry.load).then(value => {
   if (current()) { entry.value = value; entry.error = null; }
  }, error => {
   if (current()) entry.error = error;
  }).finally(() => {
   if (!current()) return;
   entry.at = now();
   entry.pending = null;
   notify(entry);
  });
  return entry.pending;
 }

 function due() {
  if (hidden()) return;
  const time = now();
  for (const entry of sources.values()) if (entry.listeners.size && time - entry.at >= entry.every - tick / 2) fetch(entry);
 }

 function ensureTimer() {
  const active = [...sources.values()].some(entry => entry.listeners.size);
  if (active && !timer) timer = setTimer(due, tick);
  if (!active && timer) { clearTimer(timer); timer = null; }
 }

 return {
  subscribe(key, load, every, listener) {
   const entry = source(key, load, every);
   entry.listeners.add(listener);
   ensureTimer();
   if (entry.value !== undefined || entry.error) listener(entry);
   const loaded = entry.value !== undefined || entry.error;
   if (!entry.pending && (!loaded || now() - entry.at >= Math.min(every, 1000))) fetch(entry);
   return () => {
    entry.listeners.delete(listener);
    ensureTimer();
   };
  },
  // Reload now, e.g. after a change; `match` selects keys (all when omitted).
  refresh(match = () => true) {
   const pending = [];
   for (const entry of sources.values()) {
    if (!match(entry.key)) continue;
    entry.pending = null;
    pending.push(fetch(entry));
   }
   return Promise.all(pending);
  },
  // Forget cached values, e.g. after logging out.
  reset() {
   for (const entry of sources.values()) { entry.value = undefined; entry.error = null; entry.at = 0; entry.version++; entry.pending = null; }
  },
  state(key) {
   const entry = sources.get(key);
   return { value: entry?.value, error: entry?.error ?? null, at: entry?.at ?? 0 };
  }
 };
}
