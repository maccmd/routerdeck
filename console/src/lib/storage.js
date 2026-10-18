// SPDX-License-Identifier: Apache-2.0
// Web Storage can be missing or throw (private mode, blocked site data).
// Every access degrades to the fallback instead of breaking the interface.

export function createStorage(backend, prefix = 'routerdeck.console.') {
 return {
  get(key, fallback = null) {
   try {
    const raw = backend?.getItem(prefix + key);
    return raw == null ? fallback : JSON.parse(raw);
   } catch {
    return fallback;
   }
  },
  set(key, value) {
   try { backend?.setItem(prefix + key, JSON.stringify(value)); } catch {}
  },
  remove(key) {
   try { backend?.removeItem(prefix + key); } catch {}
  }
 };
}

export function memoryStorage() {
 const values = new Map();
 return {
  getItem: key => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key)
 };
}
