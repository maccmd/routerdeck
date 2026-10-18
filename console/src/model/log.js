// SPDX-License-Identifier: Apache-2.0
// Log: the system log tail, newest last, refreshed every second.
import { clock } from '../lib/format.js';

const TONES = { emerg: 'error', alert: 'error', crit: 'error', err: 'error', warning: 'warning' };

export default {
 id: 'log',
 noun: 'Log Entry',
 sources: ['log'],
 readOnly: true,
 follow: true,
 columns: [
  { id: 'time', label: 'Time', width: 76, sort: (value, row) => row.time ?? row.id },
  { id: 'topics', label: 'Topics', width: 150 },
  { id: 'message', label: 'Message', width: 640 }
 ],
 defaultSort: null,
 rows(data) {
  return (data.log?.entries ?? []).map(entry => ({
   key: String(entry.id), id: entry.id, time: entry.time, readOnly: true, tone: TONES[entry.severity],
   cells: {
    time: entry.time ? clock(entry.time) : (entry.time_text ?? '').split(' ').slice(-2, -1)[0] ?? '',
    topics: [entry.facility, entry.severity].filter(Boolean).join(', '),
    message: entry.tag ? `${entry.tag}: ${entry.message}` : entry.message
   }
  }));
 },
 itemTitle: row => `Log Entry <${row.cells.time}>`,
 fields: () => [
  { id: 'time', label: 'Time', type: 'static' },
  { id: 'topics', label: 'Topics', type: 'static' },
  { id: 'message', label: 'Message', type: 'static', wide: true }
 ],
 values: row => ({ ...row.cells })
};
