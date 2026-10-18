// SPDX-License-Identifier: Apache-2.0
// A small line chart: bit rates for the Traffic tab of an interface, Tools >
// Graphs and the bandwidth test (points are { t: ms, tx, rx }), and with
// `format` and `max` other values such as CPU load in percent.
import { bitrate, niceMax } from '../lib/format.js';

const WIDTH = 300;

export function TrafficGraph({ points = [], seconds = 300, height = 120, label = 'Traffic', lines = [{ key: 'tx', label: 'Tx', tone: 'tx' }, { key: 'rx', label: 'Rx', tone: 'rx' }], format = bitrate, max = null, end = null }) {
 const now = end ?? points.at(-1)?.t ?? 0;
 const visible = points.filter(point => now - point.t <= seconds * 1000);
 const scale = max ?? niceMax(Math.max(0, ...visible.flatMap(point => lines.map(line => point[line.key] ?? 0))));
 const x = t => WIDTH - (now - t) / 1000 / seconds * WIDTH;
 const y = value => height - (value / scale) * (height - 2) - 1;
 const path = key => visible.filter(point => Number.isFinite(point[key])).map((point, index) => `${index ? 'L' : 'M'}${x(point.t).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
 const last = visible.at(-1) ?? {};
 return (
  <figure class="rd-graph">
   <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" style={{ height: height + 'px' }} role="img"
    aria-label={`${label}: ${lines.map(line => `${line.label} ${format(last[line.key]) || 'no data'}`).join(', ')}`}>
    {[0.25, 0.5, 0.75].map(share => <line key={share} class="rd-graph-grid" x1="0" x2={WIDTH} y1={height * share} y2={height * share} vector-effect="non-scaling-stroke" />)}
    {lines.map(line => <path key={line.key} class={`rd-graph-line tone-${line.tone}`} d={path(line.key)} vector-effect="non-scaling-stroke" />)}
   </svg>
   <figcaption>
    <span class="rd-graph-scale" title={`The last ${seconds >= 172800 ? `${Math.round(seconds / 86400)} days` : seconds >= 7200 ? `${Math.round(seconds / 3600)} hours` : seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`}`}>max {format(scale)}</span>
    {lines.map(line => <span key={line.key} class={`rd-graph-key tone-${line.tone}`}>{line.label}: {format(last[line.key]) || '—'}</span>)}
   </figcaption>
  </figure>
 );
}
