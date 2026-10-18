// SPDX-License-Identifier: Apache-2.0
// Pure window geometry. Child windows never leave the work area, like MDI
// children; coordinates are relative to the work area's top-left corner.

export const MIN_SIZE = Object.freeze({ w: 260, h: 140 });
export const CASCADE_STEP = 24;
export const MINIMIZED_SIZE = Object.freeze({ w: 180, h: 26 });
export const EDGES = Object.freeze(['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']);

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

export function clampRect(rect, area, min = MIN_SIZE) {
 const w = Math.round(clamp(rect.w, Math.min(min.w, area.w), area.w));
 const h = Math.round(clamp(rect.h, Math.min(min.h, area.h), area.h));
 return { x: Math.round(clamp(rect.x, 0, area.w - w)), y: Math.round(clamp(rect.y, 0, area.h - h)), w, h };
}

export function moveRect(start, dx, dy, area) {
 return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, area);
}

export function resizeRect(start, edge, dx, dy, area, min = MIN_SIZE) {
 const minW = Math.min(min.w, area.w), minH = Math.min(min.h, area.h);
 let { x, y, w, h } = start;
 if (edge.includes('e')) w = clamp(start.w + dx, minW, area.w - start.x);
 if (edge.includes('s')) h = clamp(start.h + dy, minH, area.h - start.y);
 if (edge.includes('w')) {
  x = clamp(start.x + dx, 0, start.x + start.w - minW);
  w = start.x + start.w - x;
 }
 if (edge.includes('n')) {
  y = clamp(start.y + dy, 0, start.y + start.h - minH);
  h = start.y + start.h - y;
 }
 return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

// The next window opens one step below and right of the previous one and
// wraps to the corner once it would no longer fit.
export function cascadeRect(size, previous, area) {
 let x = previous ? previous.x + CASCADE_STEP : 0;
 let y = previous ? previous.y + CASCADE_STEP : 0;
 if (x + Math.min(size.w, area.w) > area.w || y + Math.min(size.h, area.h) > area.h) x = y = 0;
 return clampRect({ x, y, w: size.w, h: size.h }, area);
}

export function minimizedRect(index, area) {
 const perRow = Math.max(1, Math.floor(area.w / MINIMIZED_SIZE.w));
 return {
  x: (index % perRow) * MINIMIZED_SIZE.w,
  y: Math.max(0, area.h - MINIMIZED_SIZE.h * (Math.floor(index / perRow) + 1)),
  w: MINIMIZED_SIZE.w,
  h: MINIMIZED_SIZE.h
 };
}
