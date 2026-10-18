// SPDX-License-Identifier: Apache-2.0
import { useLayoutEffect, useRef } from 'preact/hooks';
import { manager, windows } from '../state.js';
import { minimizedRect } from './geometry.js';
import { Window, MinimizedWindow } from './Window.jsx';
import { WindowBody } from '../windows/WindowBody.jsx';

// Below this width every window fills the work area.
const COMPACT_WIDTH = 560;

export function WorkArea() {
 const ref = useRef();
 useLayoutEffect(() => {
  const measure = () => {
   const box = ref.current.getBoundingClientRect();
   manager.setArea({ w: box.width, h: box.height });
  };
  // Measure before restoring the saved workspace so positions are not
  // clamped to a placeholder size first.
  measure();
  if (!manager.list().length) manager.restore();
  const observer = new ResizeObserver(measure);
  observer.observe(ref.current);
  return () => observer.disconnect();
 }, []);

 const list = windows.value, top = manager.active(), area = manager.area;
 const compact = area.w < COMPACT_WIDTH;
 return (
  <div class="rd-workarea" ref={ref} aria-label="Work area">
   {list.filter(win => !win.minimized).map(win => (
    <Window key={win.id} win={win} active={top?.id === win.id} compact={compact}>
     <WindowBody win={win} />
    </Window>
   ))}
   {list.filter(win => win.minimized).map((win, index) => (
    <MinimizedWindow key={win.id} win={win} rect={minimizedRect(index, area)} />
   ))}
  </div>
 );
}
