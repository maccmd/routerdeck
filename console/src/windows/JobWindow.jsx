// SPDX-License-Identifier: Apache-2.0
// The output of a package operation or a script running on the router. The
// job starts once; its id is kept with the window, so after a reload the
// window reads the same job again instead of starting it twice. Closing the
// window leaves a script running; Stop ends it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { client, manager } from '../state.js';
import { createJob } from '../api/diag.js';
import { poller } from '../api/sources.js';
import { focusAfterClose } from '../mdi/focus.js';
import { taskView } from '../model/system.js';

export function JobWindow({ win }) {
 const params = win.params ?? {};
 const [state, setState] = useState({ results: [], running: !!(params.task || params.id), error: null });
 const mounted = useRef(true);
 const output = useRef();
 const job = useMemo(() => createJob(client, {
  method: 'task',
  onUpdate: next => { if (mounted.current) setState(next); },
  onStarted: id => manager.update(win.id, { params: { ...params, id } })
 }), []);

 useEffect(() => {
  if (params.id) job.attach(params.id);
  else if (params.task) job.start(params.task);
  return () => { mounted.current = false; job.detach(); };
 }, []);

 // Installed packages and services change with the job; look again when it ends.
 useEffect(() => { if (!state.running) poller.refresh(key => ['packages', 'jobs', 'rc'].includes(key) || key.startsWith('uci:')); }, [state.running]);

 const view = useMemo(() => taskView(state.results), [state.results]);
 useLayoutEffect(() => {
  const node = output.current;
  if (node && node.scrollHeight - node.scrollTop - node.clientHeight < 40) node.scrollTop = node.scrollHeight;
 }, [view.lines.length]);

 const script = params.task?.tool === 'script' || /^script /.test(win.title ?? '');
 const error = state.error === 'This job has ended' && params.id && !state.results.length ? 'This job ended before the window opened again; its output is gone' : state.error ?? view.error;
 const status = error
  ? <span class="rd-diag-error">{error}</span>
  : state.running ? <span>running…</span>
   : view.exit === null || view.stopped ? <span>stopped</span>
    : view.exit === 0 ? <span>finished</span>
     : <span class="rd-diag-error">failed with exit code {view.exit}</span>;
 return (
  <div class="rd-job">
   <div class="rd-job-main">
    {view.command && <div class="rd-job-command">{view.command}</div>}
    <pre class="rd-job-output" ref={output} role="log" aria-label="Output" tabIndex={0}>{view.lines.join('\n')}{!view.lines.length && (state.running ? 'Waiting for output…' : '')}</pre>
   </div>
   <div class="rd-diag-buttons">
    {script && <button type="button" class="rd-button" disabled={!state.running} onClick={() => job.stop()}>Stop</button>}
    <button type="button" class="rd-button" onClick={() => { manager.close(win.id); focusAfterClose(); }}>Close</button>
   </div>
   <div class="rd-statusbar rd-diag-status" role="status">
    {status}
    <span class="rd-status-note">{script ? 'A script keeps running when this window is closed' : 'A package operation always runs to its end'}</span>
   </div>
  </div>
 );
}
