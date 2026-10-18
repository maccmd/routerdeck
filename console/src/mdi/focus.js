// SPDX-License-Identifier: Apache-2.0
// Keyboard focus follows window activation after the next render.
import { manager } from '../state.js';

const nextFrame = callback => requestAnimationFrame(() => requestAnimationFrame(callback));

export function focusWindow(id) {
 nextFrame(() => {
  const node = [...document.querySelectorAll('[data-window-id]')].find(element => element.dataset.windowId === id);
  node?.querySelector('.rd-win-label')?.focus({ preventScroll: true });
 });
}

export function focusAfterClose() {
 const next = manager.active();
 if (next) focusWindow(next.id);
 else nextFrame(() => document.querySelector('.rd-menu .rd-menu-item')?.focus({ preventScroll: true }));
}
