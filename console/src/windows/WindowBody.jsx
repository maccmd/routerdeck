// SPDX-License-Identifier: Apache-2.0
// Window contents by kind. Lists show their final layout but are not yet
// connected to router data; the status bar says so instead of faking rows.
import { useState } from 'preact/hooks';
import { Icon } from '../shell/icons.jsx';
import { WINDOW_KINDS } from './kinds.js';
import { routerInfo } from '../state.js';

const TOOLS = [['add', 'Add'], ['remove', 'Remove'], ['enable', 'Enable'], ['disable', 'Disable'], ['comment', 'Comment']];

function ListLayout({ spec }) {
 const [tab, setTab] = useState(0);
 const current = spec.tabs[tab];
 return (
  <div class="rd-list">
   {spec.tabs.length > 1 && (
    <div class="rd-tabs" role="tablist">
     {spec.tabs.map((item, index) => (
      <button type="button" role="tab" class="rd-tab" key={item.label} aria-selected={index === tab ? 'true' : 'false'}
       tabIndex={index === tab ? 0 : -1} onClick={() => setTab(index)}>{item.label}</button>
     ))}
    </div>
   )}
   <div class="rd-list-toolbar" role="toolbar" aria-label="List actions">
    {!current.readOnly && TOOLS.map(([tool, label]) => (
     <button type="button" class="rd-tool" data-tool={tool} key={tool} disabled title={label} aria-label={label}><Icon name={tool} /></button>
    ))}
    <button type="button" class="rd-tool" data-tool="filter" disabled title="Filter" aria-label="Filter"><Icon name="filter" /></button>
    <span class="rd-spacer" />
    <input class="rd-find" type="search" placeholder="Find" aria-label="Find" disabled />
   </div>
   <div class="rd-grid-wrap">
    <table class="rd-grid">
     <thead>
      <tr>{current.columns.map((column, index) => {
       const label = typeof column === 'string' ? column : column.label;
       return <th key={index} scope="col" style={typeof column === 'object' ? { width: column.width + 'px' } : undefined}>{label}</th>;
      })}</tr>
     </thead>
     <tbody>
      <tr><td class="rd-grid-empty" colSpan={current.columns.length}>Not connected to router data yet</td></tr>
     </tbody>
    </table>
   </div>
   <div class="rd-statusbar" role="status">0 items</div>
  </div>
 );
}

function TerminalLayout() {
 const ttyd = routerInfo.value?.capabilities?.ttyd;
 return (
  <div class="rd-terminal">
   <p>{ttyd ? 'ttyd is installed. The terminal is not connected yet.' : 'Terminal needs the ttyd package on the router.'}</p>
   {!ttyd && <p><code>apk add ttyd</code> (OpenWrt 25.12) or <code>opkg install ttyd</code> (24.10)</p>}
  </div>
 );
}

export function WindowBody({ kind }) {
 const spec = WINDOW_KINDS[kind];
 return spec.body === 'terminal' ? <TerminalLayout /> : <ListLayout spec={spec} />;
}
