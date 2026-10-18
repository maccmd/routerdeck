// SPDX-License-Identifier: Apache-2.0
// The Files window: a directory listing from the routerdeck plugin as rows.
import { bytes } from '../lib/format.js';

const TYPES = { file: 'file', directory: 'directory', link: 'link', char: 'device', block: 'device', fifo: 'pipe', socket: 'socket' };

export function joinPath(dir, name) {
 return `${dir === '/' ? '' : dir}/${name}`;
}

export function parentPath(path) {
 const parts = path.split('/').filter(Boolean);
 parts.pop();
 return '/' + parts.join('/');
}

// Absolute, without "." and ".." segments; null when it cannot be one.
export function normalPath(text) {
 const value = String(text ?? '').trim();
 if (!value.startsWith('/')) return null;
 const parts = [];
 for (const part of value.split('/')) {
  if (!part || part === '.') continue;
  if (part === '..') parts.pop();
  else parts.push(part);
 }
 return '/' + parts.join('/');
}

export function permissions(mode) {
 if (!Number.isFinite(mode)) return '';
 return [6, 3, 0].map(shift => ['r', 'w', 'x'].map((letter, index) => mode & (1 << (shift + 2 - index)) ? letter : '-').join('')).join('');
}

const pad = value => String(value).padStart(2, '0');
// Modification times are shown in this computer's time zone.
export function fileTime(seconds) {
 if (!Number.isFinite(seconds)) return '';
 const date = new Date(seconds * 1000);
 return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export const FILE_COLUMNS = [
 { id: 'name', label: 'Name', width: 260 },
 { id: 'type', label: 'Type', width: 90 },
 { id: 'size', label: 'Size', width: 90, align: 'right', sort: (value, row) => row.size ?? -1 },
 { id: 'modified', label: 'Last Modified', width: 150, sort: (value, row) => row.mtime ?? 0 },
 { id: 'mode', label: 'Permissions', width: 90 }
];

// Directories first, then files, each by name.
export function fileRows(listing) {
 return (listing?.entries ?? []).map(entry => {
  const directory = entry.type === 'directory' || (entry.type === 'link' && entry.target === 'directory');
  return {
   key: entry.name, directory, file: entry.type === 'file' || (entry.type === 'link' && entry.target === 'file'),
   size: directory ? null : entry.size, mtime: entry.mtime,
   cells: {
    name: entry.type === 'link' ? `${entry.name} → ${entry.link ?? '?'}` : entry.name,
    type: entry.type === 'link' ? `link to ${TYPES[entry.target] ?? 'nothing'}` : TYPES[entry.type] ?? entry.type ?? '',
    size: directory || !Number.isFinite(entry.size) ? '' : bytes(entry.size),
    modified: fileTime(entry.mtime),
    mode: permissions(entry.mode)
   }
  };
 }).sort((a, b) => (b.directory - a.directory) || a.key.localeCompare(b.key));
}
