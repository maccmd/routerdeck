// SPDX-License-Identifier: Apache-2.0
// Object list grid: fixed 20px rows, only the visible slice is rendered, so
// thousands of connections or log lines stay fast. A comment is shown as its
// own ";;; text" line above the object, as RouterOS lists do.
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

export const ROW = 20;
const OVERSCAN = 8;

function lines(rows) {
 const result = [];
 for (const row of rows) {
  if (row.comment) result.push({ type: 'comment', row });
  result.push({ type: 'row', row });
 }
 return result;
}

export function Grid({ columns, rows, selection, onSelection, onOpen, onContextMenu, onHeaderMenu, sort, onSort, draggable = false, onReorder, follow = false, flagLegend = {}, empty = 'No items', label, gridRef }) {
 const scroller = useRef();
 const [view, setView] = useState({ top: 0, height: 400 });
 const [cursor, setCursor] = useState(null);
 const [drop, setDrop] = useState(null);
 const anchor = useRef(null), dragging = useRef(null), atBottom = useRef(true);
 const items = useMemo(() => lines(rows), [rows]);
 const keys = useMemo(() => rows.map(row => row.key), [rows]);
 const template = columns.map(column => column.width + 'px').join(' ') + ' minmax(0, 1fr)';
 const width = columns.reduce((sum, column) => sum + column.width, 0);

 useLayoutEffect(() => {
  const node = scroller.current;
  const measure = () => setView({ top: node.scrollTop, height: node.clientHeight });
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(node);
  return () => observer.disconnect();
 }, []);

 // The log follows new entries while the view is at the bottom.
 useLayoutEffect(() => {
  const node = scroller.current;
  if (follow && atBottom.current) node.scrollTop = node.scrollHeight;
 }, [items.length, follow]);

 const start = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
 const end = Math.min(items.length, Math.ceil((view.top + view.height) / ROW) + OVERSCAN);

 function select(row, event) {
  const next = new Set(event?.ctrlKey || event?.metaKey ? selection : []);
  if (event?.shiftKey && anchor.current && keys.includes(anchor.current)) {
   const [from, to] = [keys.indexOf(anchor.current), keys.indexOf(row.key)].sort((a, b) => a - b);
   keys.slice(from, to + 1).forEach(key => next.add(key));
  } else if ((event?.ctrlKey || event?.metaKey) && next.has(row.key)) next.delete(row.key);
  else {
   next.add(row.key);
   anchor.current = row.key;
  }
  setCursor(row.key);
  onSelection(next);
 }

 function reveal(key) {
  const index = items.findIndex(item => item.type === 'row' && item.row.key === key);
  const node = scroller.current;
  if (index < 0 || !node) return;
  const top = index * ROW, header = ROW + 1;
  if (top < node.scrollTop) node.scrollTop = Math.max(0, top - (items[index - 1]?.type === 'comment' ? ROW : 0));
  else if (top + ROW > node.scrollTop + node.clientHeight - header) node.scrollTop = top + ROW - node.clientHeight + header;
 }

 function onKeyDown(event) {
  if (!rows.length) return;
  const current = keys.indexOf(cursor ?? [...selection].at(-1));
  const page = Math.max(1, Math.floor(view.height / ROW) - 2);
  const target = { ArrowDown: current + 1, ArrowUp: current - 1, PageDown: current + page, PageUp: current - page, Home: 0, End: keys.length - 1 }[event.key];
  if (target !== undefined) {
   event.preventDefault();
   const row = rows[Math.max(0, Math.min(keys.length - 1, current < 0 ? 0 : target))];
   select(row, { shiftKey: event.shiftKey });
   reveal(row.key);
  } else if (event.key === 'Enter' && current >= 0) {
   event.preventDefault();
   onOpen?.(rows[current]);
  } else if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
   event.preventDefault();
   onSelection(new Set(keys));
  }
 }

 function dragStart(event, row) {
  if (!selection.has(row.key)) select(row, {});
  dragging.current = selection.has(row.key) ? keys.filter(key => selection.has(key)) : [row.key];
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragging.current.join(','));
 }

 function dragOver(event, row) {
  if (!dragging.current) return;
  event.preventDefault();
  const box = event.currentTarget.getBoundingClientRect();
  const position = event.clientY - box.top < box.height / 2 ? 'before' : 'after';
  if (drop?.key !== row.key || drop?.position !== position) setDrop({ key: row.key, position });
 }

 function dropOn(event, row) {
  event.preventDefault();
  const moved = dragging.current, position = drop?.position ?? 'before';
  dragging.current = null;
  setDrop(null);
  if (moved && !moved.includes(row.key)) onReorder?.(moved, row.key, position);
 }

 const sortMark = id => sort?.id === id ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
 const legend = flags => [...(flags ?? '')].map(flag => `${flag} – ${flagLegend[flag] ?? flag}`).join('\n');

 return (
  <div class="rd-grid-scroll" ref={node => { scroller.current = node; if (gridRef) gridRef.current = node; }} tabIndex={0} role="grid" aria-label={label} aria-rowcount={rows.length + 1} aria-multiselectable="true"
   onScroll={event => {
    const node = event.currentTarget;
    atBottom.current = node.scrollTop + node.clientHeight >= node.scrollHeight - ROW;
    setView({ top: node.scrollTop, height: node.clientHeight });
   }}
   onKeyDown={onKeyDown}
   onContextMenu={event => { if (event.target === scroller.current || event.target.classList.contains('rd-grid-body')) { event.preventDefault(); onSelection(new Set()); onContextMenu?.(event, null); } }}>
   <div class="rd-grid-head" role="row" style={{ gridTemplateColumns: template, minWidth: width + 'px' }}
    onContextMenu={event => { event.preventDefault(); onHeaderMenu?.(event); }}>
    {columns.map(column => (
     <div key={column.id} role="columnheader" class={`rd-grid-th${column.align === 'right' ? ' is-right' : ''}`}
      aria-sort={sort?.id === column.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort?.(column.id)} title={column.label ? `Sort by ${column.label}` : 'Flags'}>
      {column.label}{sortMark(column.id)}
     </div>
    ))}
    <div role="presentation" />
   </div>
   <div class="rd-grid-body" style={{ height: items.length * ROW + 'px', minWidth: width + 'px' }}>
    {!rows.length && <div class="rd-grid-empty">{empty}</div>}
    {items.slice(start, end).map((item, offset) => {
     const index = start + offset, row = item.row, selected = selection.has(row.key);
     const top = index * ROW;
     if (item.type === 'comment') {
      return (
       <div key={'c:' + row.key} class={`rd-grid-comment${selected ? ' is-selected' : ''}`} style={{ top: top + 'px' }}
        onPointerDown={event => { if (event.button === 0) select(row, event); }} onDblClick={() => onOpen?.(row)}>
        ;;; {row.comment}
       </div>
      );
     }
     const classes = ['rd-grid-row', selected && 'is-selected', cursor === row.key && 'is-cursor', row.disabled && 'is-disabled', row.dynamic && 'is-dynamic', row.invalid && 'is-invalid', row.tone && 'tone-' + row.tone,
      drop?.key === row.key && 'drop-' + drop.position].filter(Boolean).join(' ');
     return (
      <div key={row.key} role="row" aria-selected={selected ? 'true' : 'false'} data-key={row.key} class={classes} style={{ top: top + 'px', gridTemplateColumns: template }}
       draggable={draggable} onDragStart={event => dragStart(event, row)} onDragOver={event => dragOver(event, row)} onDrop={event => dropOn(event, row)}
       onDragEnd={() => { dragging.current = null; setDrop(null); }}
       onPointerDown={event => { if (event.button === 0) select(row, event); }}
       onDblClick={() => onOpen?.(row)}
       onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!selected) select(row, {}); onContextMenu?.(event, row); }}>
       {columns.map(column => (
        <div key={column.id} role="gridcell" class={`rd-grid-td${column.align === 'right' ? ' is-right' : ''}${column.id === 'flags' ? ' is-flags' : ''}`}
         title={column.id === 'flags' ? legend(row.flags) : row.cells[column.id] || undefined}>
         {column.id === 'flags' ? row.flags : row.cells[column.id]}
        </div>
       ))}
       <div role="presentation" />
      </div>
     );
    })}
   </div>
  </div>
 );
}
