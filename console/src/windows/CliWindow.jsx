// SPDX-License-Identifier: Apache-2.0
// New Terminal: the RouterOS-style command line (cli/engine.js). Tab
// completes, ? lists what may follow, Up/Down recall earlier commands,
// Ctrl+C stops ping or traceroute, Ctrl+L clears, Ctrl+X toggles Safe Mode.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createCli } from '../cli/engine.js';
import { SOURCES, useSources } from '../api/sources.js';
import { apply, undo, redo, safemode, errorText } from '../api/actions.js';
import { createJob } from '../api/diag.js';
import { client, manager, preferences, user, board } from '../state.js';
import { focusAfterClose, focusWindow } from '../mdi/focus.js';

const SCROLLBACK = 2000;
const HISTORY = 100;

// Wraps names into columns, as a terminal lists completions.
function columns(names, width = 96) {
 const size = Math.max(...names.map(name => name.length)) + 2;
 const perLine = Math.max(1, Math.floor(width / size));
 const lines = [];
 for (let index = 0; index < names.length; index += perLine) lines.push(names.slice(index, index + perLine).map(name => name.padEnd(size)).join('').trimEnd());
 return lines;
}

export function CliWindow({ win, active }) {
 const output = useRef([]);
 const serial = useRef(0);
 const [, setVersion] = useState(0);
 const [input, setInput] = useState('');
 const [busy, setBusy] = useState(false);
 const history = useRef(preferences.get('cli.history', []));
 const recall = useRef(null);
 const inputRef = useRef(), scrollRef = useRef();
 const { data } = useSources(['safemode'], active);
 const safe = useRef(false);
 safe.current = !!(data.safemode?.active && data.safemode?.mine);

 const print = entry => {
  output.current.push({ id: ++serial.current, ...entry });
  if (output.current.length > SCROLLBACK) output.current.splice(0, output.current.length - SCROLLBACK);
  setVersion(version => version + 1);
 };

 const cli = useMemo(() => createCli({
  load: async keys => Object.fromEntries(await Promise.all(keys.map(async key => [key, await SOURCES[key][0]()]))),
  apply, undo, redo,
  createJob: onUpdate => createJob(client, { onUpdate }),
  out: {
   line: (text, tone) => print({ text, tone }),
   // A block that is redrawn in place, like traceroute's table.
   live: () => {
    const entry = { id: ++serial.current, lines: [] };
    output.current.push(entry);
    return { update: lines => { entry.lines = lines; setVersion(version => version + 1); }, end: () => {} };
   }
  },
  user: user.value ?? 'root',
  identity: () => board.value?.hostname ?? 'router',
  safe: () => safe.current,
  openWindow: kind => focusWindow(manager.open(kind)),
  close: () => { manager.close(win.id); focusAfterClose(); }
 }), []);

 useEffect(() => {
  print({ text: `RouterDeck Console command line on ${board.value?.release?.description ?? 'OpenWrt'}`, tone: 'muted' });
  print({ text: 'Menus and commands follow RouterOS: /ip address print, /interface bridge add name=br1, /export.', tone: 'muted' });
  print({ text: 'Tab completes, ? shows what can follow, Up/Down recall commands, Ctrl+C stops, Ctrl+X toggles Safe Mode.', tone: 'muted' });
  print({ text: '' });
 }, []);

 useLayoutEffect(() => {
  const node = scrollRef.current;
  if (node) node.scrollTop = node.scrollHeight;
 });

 const echo = suffix => print({ text: cli.prompt() + input + suffix, tone: 'echo' });

 // Lines typed while a command runs wait their turn, as in a terminal.
 const queue = useRef([]);
 const draining = useRef(false);
 async function drain() {
  if (draining.current) return;
  draining.current = true;
  setBusy(true);
  while (queue.current.length) {
   const line = queue.current.shift();
   print({ text: cli.prompt() + line, tone: 'echo' });
   if (line.trim()) {
    history.current = [...history.current.filter(item => item !== line), line].slice(-HISTORY);
    preferences.set('cli.history', history.current);
   }
   await cli.run(line);
  }
  draining.current = false;
  setBusy(false);
 }

 function submit() {
  queue.current.push(input);
  setInput('');
  recall.current = null;
  drain();
 }

 async function toggleSafeMode() {
  try {
   if (safe.current) {
    await safemode('exit', { keep: true });
    print({ text: '[Safe Mode released]', tone: 'muted' });
   } else {
    await safemode('enter');
    print({ text: '[Safe Mode taken]', tone: 'muted' });
   }
  } catch (failure) {
   print({ text: `failure: ${errorText(failure)}`, tone: 'error' });
  }
 }

 async function onKeyDown(event) {
  const key = event.key, ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
  if (ctrl && key.toLowerCase() === 'c') {
   event.preventDefault();
   if (busy) { queue.current = []; cli.interrupt(); }
   else { echo('^C'); setInput(''); }
   return;
  }
  if (ctrl && key.toLowerCase() === 'l') { event.preventDefault(); output.current = []; setVersion(version => version + 1); return; }
  if (ctrl && key.toLowerCase() === 'x') { event.preventDefault(); toggleSafeMode(); return; }
  if (key === 'Enter') { event.preventDefault(); submit(); return; }
  if (busy) { if (key === 'Tab' || key === '?') event.preventDefault(); return; }
  if (key === 'Tab') {
   event.preventDefault();
   const result = await cli.complete(input);
   if (result.options.length) { echo(''); columns(result.options).forEach(text => print({ text })); }
   setInput(result.text);
   return;
  }
  // "?" outside quotes asks for help, as in RouterOS.
  if (key === '?' && ((input.match(/"/g) ?? []).length % 2 === 0)) {
   event.preventDefault();
   const lines = await cli.help(input);
   echo('?');
   (lines.length ? lines : ['no completions']).forEach(text => print({ text }));
   return;
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
   event.preventDefault();
   const list = history.current;
   if (!list.length) return;
   let index = recall.current ?? list.length;
   index = key === 'ArrowUp' ? Math.max(0, index - 1) : Math.min(list.length, index + 1);
   recall.current = index;
   setInput(index === list.length ? '' : list[index]);
  }
 }

 return (
  <div class="rd-cli" ref={scrollRef} onClick={() => { if (!window.getSelection()?.toString()) inputRef.current?.focus({ preventScroll: true }); }}>
   <div class="rd-cli-output" role="log" aria-label="Terminal output" aria-live="polite">
    {output.current.map(entry => entry.lines
     ? entry.lines.map((text, index) => <div key={`${entry.id}:${index}`} class="rd-cli-text">{text || ' '}</div>)
     : <div key={entry.id} class={`rd-cli-text${entry.tone ? ' is-' + entry.tone : ''}`}>{entry.text || ' '}</div>)}
   </div>
   <div class={`rd-cli-input${busy ? ' is-busy' : ''}`}>
    <span class="rd-cli-prompt">{cli.prompt()}</span>
    <input ref={inputRef} data-autofocus value={input} aria-label={busy ? 'Command (running; Ctrl+C stops)' : 'Command'} spellcheck={false} autocomplete="off" autocapitalize="off"
     onInput={event => { setInput(event.currentTarget.value); recall.current = null; }} onKeyDown={onKeyDown} />
   </div>
  </div>
 );
}
