// SPDX-License-Identifier: Apache-2.0
// Tools: Ping, Traceroute and Torch. Settings on top, Start/Stop on the
// right, results below and a summary in the status bar. Ping and Traceroute
// run as jobs on the router; Torch samples connection tracking every second.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Grid } from '../list/Grid.jsx';
import { Field } from '../item/fields.jsx';
import { client, manager } from '../state.js';
import { createJob } from '../api/diag.js';
import { useSources } from '../api/sources.js';
import { errorText } from '../api/actions.js';
import { focusAfterClose, focusWindow } from '../mdi/focus.js';
import { HOST, ms, pingView, traceView, flowSample, routeIndex, localAddresses, torchDevices, torchView } from '../model/tools.js';
import { bitrate, rate } from '../lib/format.js';

function useJob() {
 const [state, setState] = useState({ results: [], running: false, error: null });
 const mounted = useRef(true);
 const job = useMemo(() => createJob(client, { onUpdate: next => { if (mounted.current) setState(next); } }), []);
 useEffect(() => () => { mounted.current = false; job.stop(); }, []);
 return [state, job];
}

function readNumber(text, low, high, { optional = false, integer = true, scale = 1 } = {}) {
 const value = String(text ?? '').trim();
 if (!value && optional) return { value: 0 };
 const number = Number(value);
 if (!value || !Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < low || number > high) return { error: `Use ${integer ? 'a whole number' : 'a number'} from ${low} to ${high}` };
 return { value: Math.round(number * scale) };
}

const readers = {
 host: text => HOST.test(String(text ?? '').trim()) ? { value: text.trim() } : { error: 'Enter an address or host name' },
 family: text => ({ value: text === '4' ? 4 : text === '6' ? 6 : 0 }),
 protocol: text => ({ value: text === 'udp' ? 'udp' : 'icmp' }),
 whole: (low, high, optional) => text => readNumber(text, low, high, { optional }),
 seconds: (low, high) => text => readNumber(text, low, high, { integer: false, scale: 1000 })
};

function readForm(values, spec) {
 const args = {}, errors = {};
 for (const [id, read] of Object.entries(spec)) {
  const result = read(values[id]);
  if (result.error) errors[id] = result.error;
  else args[id] = result.value;
 }
 return { args, errors, ok: !Object.keys(errors).length };
}

const FAMILY = { id: 'family', label: 'Address Family', type: 'select', options: [{ value: '', label: 'auto' }, { value: '4', label: 'IPv4' }, { value: '6', label: 'IPv6' }] };

function ToolLayout({ win, fields, values, errors = {}, onChange, running, onStart, onStop, status, children }) {
 const prefix = win.id.replace(/\W/g, '');
 return (
  <form class="rd-diag" onSubmit={event => { event.preventDefault(); if (!running) onStart(); }}>
   <div class="rd-diag-fields">
    {fields.map(field => (
     <Field key={field.id} field={{ ...field, key: prefix }} value={values[field.id]} values={values} error={errors[field.id]}
      disabled={running && !field.live} onChange={value => onChange(field.id, value)} />
    ))}
   </div>
   <div class="rd-diag-buttons">
    <button type="submit" class="rd-button" disabled={running}>Start</button>
    <button type="button" class="rd-button" disabled={!running} onClick={onStop}>Stop</button>
    <button type="button" class="rd-button" onClick={() => { manager.close(win.id); focusAfterClose(); }}>Close</button>
    <button type="button" class="rd-button" onClick={() => focusWindow(manager.open(win.kind))}>New Window</button>
   </div>
   <div class="rd-diag-results">{children}</div>
   <div class="rd-statusbar rd-diag-status" role="status">{status}</div>
  </form>
 );
}

function Results({ columns, rows, label, empty, follow = false, sort = null, onSort }) {
 const [selection, setSelection] = useState(() => new Set());
 return <Grid columns={columns} rows={rows} selection={selection} onSelection={setSelection} label={label} empty={empty} follow={follow} sort={sort} onSort={onSort} />;
}

// Settings survive a reload with the rest of the workspace.
function useForm(win, defaults) {
 const [values, setValues] = useState(() => ({ ...defaults, ...win.params?.form }));
 const [errors, setErrors] = useState({});
 const change = (id, value) => { setValues(current => ({ ...current, [id]: value })); setErrors(current => ({ ...current, [id]: undefined })); };
 const remember = title => manager.update(win.id, { title, params: { ...win.params, form: values } });
 return { values, errors, setErrors, change, remember };
}

const PING_COLUMNS = [
 { id: 'seq', label: 'Seq #', width: 60, align: 'right' },
 { id: 'host', label: 'Host', width: 220 },
 { id: 'time', label: 'Time', width: 90, align: 'right' },
 { id: 'size', label: 'Reply Size', width: 80, align: 'right' },
 { id: 'ttl', label: 'TTL', width: 50, align: 'right' },
 { id: 'status', label: 'Status', width: 160 }
];

export function PingWindow({ win }) {
 const form = useForm(win, { host: '', family: '', size: '56', count: '', interval: '1', timeout: '1' });
 const [state, job] = useJob();
 const view = useMemo(() => pingView(state.results), [state.results]);
 function start() {
  const { args, errors, ok } = readForm(form.values, {
   host: readers.host, family: readers.family, size: readers.whole(16, 65500), count: readers.whole(1, 100000, true),
   interval: readers.seconds(0.2, 60), timeout: readers.whole(1, 10)
  });
  form.setErrors(errors);
  if (!ok) return;
  form.remember(`Ping ${args.host}`);
  job.start({ tool: 'ping', ...args });
 }
 const fields = [
  { id: 'host', label: 'Ping To', type: 'text', placeholder: 'address or host name' },
  FAMILY,
  { id: 'size', label: 'Packet Size', type: 'number' },
  { id: 'count', label: 'Count', type: 'number', placeholder: 'until stopped' },
  { id: 'interval', label: 'Interval (s)', type: 'number' },
  { id: 'timeout', label: 'Timeout (s)', type: 'number' }
 ];
 const error = state.error ?? view.error;
 return (
  <ToolLayout win={win} fields={fields} values={form.values} errors={form.errors} onChange={form.change} running={state.running} onStart={start} onStop={() => job.stop()}
   status={error ? <span class="rd-diag-error">{error}</span> : (
    <>
     <span>{view.sent} sent</span>
     <span>{view.received} received</span>
     <span>{view.loss ?? 0}% packet loss</span>
     {view.received > 0 && <span>min/avg/max {ms(view.min)} / {ms(view.avg)} / {ms(view.max)}</span>}
     <span class="rd-status-note">{state.running ? 'running' : ''}</span>
    </>
   )}>
   <Results columns={PING_COLUMNS} rows={view.rows} label="Ping results" empty={state.running ? 'Waiting for the first reply…' : 'Enter an address and press Start'} follow />
  </ToolLayout>
 );
}

const TRACE_COLUMNS = [
 { id: 'hop', label: '#', width: 36, align: 'right' },
 { id: 'address', label: 'Address', width: 220 },
 { id: 'loss', label: 'Loss', width: 56, align: 'right' },
 { id: 'sent', label: 'Sent', width: 50, align: 'right' },
 { id: 'last', label: 'Last', width: 76, align: 'right' },
 { id: 'avg', label: 'Avg.', width: 76, align: 'right' },
 { id: 'best', label: 'Best', width: 76, align: 'right' },
 { id: 'worst', label: 'Worst', width: 76, align: 'right' },
 { id: 'stdev', label: 'Std. Dev.', width: 76, align: 'right' },
 { id: 'status', label: 'Status', width: 70 }
];

export function TracerouteWindow({ win }) {
 const form = useForm(win, { host: '', family: '', protocol: 'icmp', max: '15', timeout: '1', count: '', interval: '1' });
 const [state, job] = useJob();
 const view = useMemo(() => traceView(state.results), [state.results]);
 function start() {
  const { args, errors, ok } = readForm(form.values, {
   host: readers.host, family: readers.family, protocol: readers.protocol, max: readers.whole(1, 30), timeout: readers.whole(1, 10),
   count: readers.whole(1, 100000, true), interval: readers.seconds(1, 60)
  });
  form.setErrors(errors);
  if (!ok) return;
  form.remember(`Traceroute ${args.host}`);
  job.start({ tool: 'traceroute', ...args });
 }
 const fields = [
  { id: 'host', label: 'Traceroute To', type: 'text', placeholder: 'address or host name' },
  FAMILY,
  { id: 'protocol', label: 'Protocol', type: 'select', options: [{ value: 'icmp', label: 'ICMP' }, { value: 'udp', label: 'UDP' }] },
  { id: 'max', label: 'Max Hops', type: 'number' },
  { id: 'timeout', label: 'Timeout (s)', type: 'number' },
  { id: 'count', label: 'Count', type: 'number', placeholder: 'until stopped' },
  { id: 'interval', label: 'Interval (s)', type: 'number' }
 ];
 const error = state.error ?? view.error;
 return (
  <ToolLayout win={win} fields={fields} values={form.values} errors={form.errors} onChange={form.change} running={state.running} onStart={start} onStop={() => job.stop()}
   status={error ? <span class="rd-diag-error">{error}</span> : (
    <>
     <span>{view.rounds} {view.rounds === 1 ? 'round' : 'rounds'}</span>
     {view.rounds > 0 && <span>{view.reached ? `${view.address} reached in ${view.rows.length} ${view.rows.length === 1 ? 'hop' : 'hops'}` : `${view.address ?? 'destination'} not reached`}</span>}
     <span class="rd-status-note">{state.running ? 'running' : ''}</span>
    </>
   )}>
   <Results columns={TRACE_COLUMNS} rows={view.rows} label="Traceroute hops" empty={state.running ? 'Probing…' : 'Enter an address and press Start'} />
  </ToolLayout>
 );
}

const TORCH_COLUMNS = [
 { id: 'family', label: 'Family', width: 52 },
 { id: 'protocol', label: 'Protocol', width: 70 },
 { id: 'src', label: 'Src.', width: 210 },
 { id: 'dst', label: 'Dst.', width: 210 },
 { id: 'tx', label: 'Tx Rate', width: 90, align: 'right', numeric: true },
 { id: 'rx', label: 'Rx Rate', width: 90, align: 'right', numeric: true },
 { id: 'txp', label: 'Tx Packet Rate', width: 100, align: 'right', numeric: true },
 { id: 'rxp', label: 'Rx Packet Rate', width: 100, align: 'right', numeric: true },
 { id: 'flows', label: 'Connections', width: 84, align: 'right', numeric: true }
];
const COLLECT = [{ value: 'protocol', label: 'Protocol' }, { value: 'src', label: 'Src. Address' }, { value: 'dst', label: 'Dst. Address' }, { value: 'port', label: 'Port' }];

function useTorch(running) {
 const [sample, setSample] = useState(null);
 const [error, setError] = useState(null);
 useEffect(() => {
  if (!running) return undefined;
  let stopped = false, previous = null, timer;
  async function tick() {
   try {
    const reply = await client.call('routerdeck', 'conntrack', { limit: 8192 });
    if (stopped) return;
    previous = flowSample(reply, previous, performance.now());
    setSample(previous);
    setError(null);
   } catch (failure) {
    if (!stopped) setError(errorText(failure));
   }
   if (!stopped) timer = setTimeout(tick, 1000);
  }
  tick();
  return () => { stopped = true; clearTimeout(timer); };
 }, [running]);
 return { sample, error };
}

export function TorchWindow({ win, active }) {
 const form = useForm(win, { device: null, protocol: '', src: '', dst: '', port: '', collect: COLLECT.map(item => item.value) });
 const [running, setRunning] = useState(false);
 const [sort, setSort] = useState(null);
 const torch = useTorch(running);
 const { data } = useSources(['ifaces', 'routes4', 'routes6'], active);
 const devices = useMemo(() => torchDevices(data.ifaces), [data.ifaces]);
 const routes = useMemo(() => routeIndex(data.routes4, data.routes6), [data.routes4, data.routes6]);
 const local = useMemo(() => localAddresses(data.ifaces), [data.ifaces]);
 // Like RouterOS, Torch watches one device; the LAN bridge is the usual one.
 const device = form.values.device ?? (devices.find(item => item.value === 'br-lan') ?? devices[0])?.value ?? '';
 const values = { ...form.values, device };
 const view = useMemo(() => torchView(torch.sample, { ...values, routes, local, port: values.port.trim() }), [torch.sample, routes, local, ...Object.values(values)]);
 const rows = useMemo(() => {
  if (!sort) return view.rows;
  const column = TORCH_COLUMNS.find(item => item.id === sort.id);
  const key = row => column.numeric ? row.values[column.id] : row.cells[column.id];
  return view.rows.slice().sort((a, b) => (column.numeric ? key(a) - key(b) : String(key(a)).localeCompare(String(key(b)), undefined, { numeric: true })) * (sort.dir === 'asc' ? 1 : -1));
 }, [view.rows, sort]);
 const errors = Object.fromEntries(view.invalid.map(id => [id, 'Use an address or a prefix like 192.168.88.0/24']));
 const fields = [
  { id: 'device', label: 'Interface', type: 'select', live: true, options: [{ value: '', label: 'all' }, ...devices] },
  { id: 'protocol', label: 'Protocol', type: 'select', live: true, options: [{ value: '', label: 'any' }, ...['tcp', 'udp', 'icmp', 'icmpv6', 'gre', 'sctp'].map(value => ({ value, label: value }))] },
  { id: 'src', label: 'Src. Address', type: 'text', live: true, placeholder: 'any' },
  { id: 'dst', label: 'Dst. Address', type: 'text', live: true, placeholder: 'any' },
  { id: 'port', label: 'Port', type: 'text', live: true, placeholder: 'any' },
  { id: 'collect', label: 'Collect', type: 'multi', live: true, options: COLLECT }
 ];
 const unavailable = torch.sample && !torch.sample.available;
 return (
  <ToolLayout win={win} fields={fields} values={values} errors={errors} onChange={form.change} running={running}
   onStart={() => { form.remember('Torch'); setRunning(true); }} onStop={() => setRunning(false)}
   status={torch.error || unavailable ? <span class="rd-diag-error">{torch.error ?? 'Connection tracking is not available on this router'}</span> : (
    <>
     <span>Tx {bitrate(view.totals.tx_bps) || '0 bps'}</span>
     <span>Rx {bitrate(view.totals.rx_bps) || '0 bps'}</span>
     <span>{rate(view.totals.tx_pps) || 0} / {rate(view.totals.rx_pps) || 0} packets/s</span>
     <span class="rd-status-note" title="Torch measures connections tracked by the firewall; traffic the firewall does not track, such as bridged frames, is not shown">
      {torch.sample && torch.sample.count > torch.sample.flows.length ? `first ${torch.sample.flows.length} of ${torch.sample.count} connections` : running ? 'running' : 'from connection tracking'}
     </span>
    </>
   )}>
   <Results columns={TORCH_COLUMNS} rows={rows} label="Torch traffic" empty={running ? 'No matching traffic' : 'Press Start to watch traffic'}
    sort={sort} onSort={id => setSort(current => current?.id === id ? (current.dir === 'desc' ? { id, dir: 'asc' } : null) : { id, dir: 'desc' })} />
  </ToolLayout>
 );
}
