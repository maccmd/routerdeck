// SPDX-License-Identifier: Apache-2.0
// Files on the router: browse directories, upload, download, create folders
// and remove. Transfers go through cgi-io with this session. File changes
// are not configuration changes: Undo and Safe Mode do not cover them.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Grid } from '../list/Grid.jsx';
import { client, manager } from '../state.js';
import { errorText, notify } from '../api/actions.js';
import { pickFile, uploadFile, downloadFile } from '../api/files.js';
import { askConfirm, askText } from '../shell/overlays.jsx';
import { FILE_COLUMNS, fileRows, joinPath, parentPath, normalPath } from '../model/files.js';

export function FilesWindow({ win, active }) {
 const [path, setPath] = useState(win.params?.path ?? '/');
 const [typed, setTyped] = useState(path);
 const [listing, setListing] = useState(null);
 const [error, setError] = useState(null);
 const [loadError, setLoadError] = useState(null);
 const [busy, setBusy] = useState(false);
 const [selection, setSelection] = useState(() => new Set());
 const [sort, setSort] = useState(null);
 const loading = useRef(0);

 async function load(target = path) {
  const serial = ++loading.current;
  try {
   const reply = await client.call('routerdeck', 'files', { path: target });
   if (serial !== loading.current) return;
   if (!reply?.ok) throw new Error(reply?.message ?? 'The router did not list it');
   setListing(reply);
   setLoadError(null);
  } catch (failure) {
   if (serial === loading.current) setLoadError(errorText(failure));
  }
 }

 useEffect(() => {
  if (!active) return undefined;
  load(path);
  const timer = setInterval(() => load(path), 5000);
  return () => clearInterval(timer);
 }, [path, active]);

 function go(target) {
  const next = normalPath(target);
  if (!next) return setError('Enter an absolute path such as /tmp');
  setPath(next);
  setTyped(next);
  setSelection(new Set());
  setListing(null);
  manager.update(win.id, { params: { path: next } });
 }

 const rows = useMemo(() => {
  const list = fileRows(listing);
  if (!sort) return list;
  const column = FILE_COLUMNS.find(item => item.id === sort.id);
  const key = column.sort ?? (value => value);
  return list.slice().sort((a, b) => {
   const left = key(a.cells[column.id], a), right = key(b.cells[column.id], b);
   return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true })) * (sort.dir === 'asc' ? 1 : -1);
  });
 }, [listing, sort]);
 const selected = rows.filter(row => selection.has(row.key));

 async function run(action) {
  setBusy(true);
  setError(null);
  try {
   await action();
  } catch (failure) {
   setError(errorText(failure));
  } finally {
   setBusy(false);
   load();
  }
 }

 const upload = () => run(async () => {
  const file = await pickFile();
  if (!file) return;
  if (rows.some(row => row.key === file.name) && !await askConfirm({ title: 'Upload', text: `${joinPath(path, file.name)} exists. Replace it?`, submitLabel: 'Replace' })) return;
  await uploadFile(joinPath(path, file.name), file);
  notify(`Uploaded ${joinPath(path, file.name)}`);
 });
 const download = (items = selected) => run(async () => {
  for (const row of items.filter(item => item.file)) await downloadFile({ path: joinPath(path, row.key), filename: row.key });
 });
 const folder = () => run(async () => {
  const name = await askText({ title: 'New Folder', label: `Name in ${path}` });
  if (!name?.trim()) return;
  if (/\//.test(name)) throw new Error('A folder name has no "/"');
  const reply = await client.call('routerdeck', 'file_mkdir', { path: joinPath(path, name.trim()) });
  if (!reply?.ok) throw new Error(reply?.message);
 });
 const remove = () => run(async () => {
  const names = selected.map(row => row.key);
  if (!names.length || !await askConfirm({ title: 'Remove', text: `Remove ${names.length === 1 ? joinPath(path, names[0]) : `${names.length} items from ${path}`}? This cannot be undone.`, submitLabel: 'Remove' })) return;
  for (const name of names) {
   const reply = await client.call('routerdeck', 'file_remove', { path: joinPath(path, name) });
   if (!reply?.ok) throw new Error(reply?.message);
  }
  setSelection(new Set());
 });

 return (
  <div class="rd-list-body rd-files" onKeyDown={event => { if (event.key === 'Delete' && !event.target.matches('input')) { event.preventDefault(); remove(); } }}>
   <form class="rd-list-toolbar" role="toolbar" aria-label="File actions" onSubmit={event => { event.preventDefault(); go(typed); }}>
    <button type="button" class="rd-tool-text" disabled={path === '/' || busy} onClick={() => go(parentPath(path))}>Up</button>
    <input class="rd-files-path" aria-label="Path" value={typed} onInput={event => setTyped(event.currentTarget.value)} />
    <button type="submit" class="rd-tool-text" disabled={busy}>Go</button>
    <button type="button" class="rd-tool-text" disabled={busy} onClick={upload}>Upload…</button>
    <button type="button" class="rd-tool-text" disabled={busy || !selected.some(row => row.file)} onClick={() => download()}>Download</button>
    <button type="button" class="rd-tool-text" disabled={busy} onClick={folder}>New Folder</button>
    <button type="button" class="rd-tool-text" disabled={busy || !selected.length} onClick={remove}>Remove</button>
   </form>
   <Grid label="File list" columns={FILE_COLUMNS} rows={rows} selection={selection} onSelection={setSelection}
    onOpen={row => row.directory ? go(joinPath(path, row.key)) : row.file && download([row])}
    sort={sort} onSort={id => setSort(sort?.id !== id ? { id, dir: 'asc' } : sort.dir === 'asc' ? { id, dir: 'desc' } : null)}
    empty={listing ? 'Empty folder' : loadError ? 'Not available' : 'Loading…'} />
   {(error || loadError) && <div class="rd-list-error" role="alert"><span>{error ?? loadError}</span></div>}
   <div class="rd-statusbar" role="status">
    <span>{rows.length} items{selected.length ? ` (${selected.length} selected)` : ''}{listing?.truncated ? ', only the first 2000 shown' : ''}</span>
    <span class="rd-status-note">Uploads, downloads and removals are not undoable</span>
   </div>
  </div>
 );
}
