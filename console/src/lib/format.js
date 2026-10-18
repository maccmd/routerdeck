// SPDX-License-Identifier: Apache-2.0
// Value formatting. Missing values render as an em dash, never as zero.

const pad = value => String(value).padStart(2, '0');

export function uptime(seconds) {
 if (!Number.isFinite(seconds) || seconds < 0) return '—';
 const days = Math.floor(seconds / 86400);
 const clock = `${pad(Math.floor(seconds % 86400 / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(Math.floor(seconds % 60))}`;
 return days ? `${days}d ${clock}` : clock;
}

// procd reports load averages as fixed-point values scaled by 65536.
export function load(value) {
 return Number.isFinite(value) ? (value / 65536).toFixed(2) : '—';
}

export function memoryUsage(memory) {
 const total = memory?.total, free = memory?.available ?? memory?.free;
 if (!Number.isFinite(total) || !Number.isFinite(free) || total <= 0) return '—';
 return Math.round(100 * (total - free) / total) + '%';
}

export function bytes(value) {
 if (!Number.isFinite(value) || value < 0) return '—';
 const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
 let index = 0;
 while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
 return index ? `${value.toFixed(1)} ${units[index]}` : `${Math.round(value)} B`;
}

// Link rates in bits per second, as network equipment reports them.
export function bitrate(value) {
 if (!Number.isFinite(value) || value < 0) return '';
 const units = ['bps', 'kbps', 'Mbps', 'Gbps'];
 let index = 0;
 while (value >= 1000 && index < units.length - 1) { value /= 1000; index++; }
 return `${index ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}

export function rate(value) {
 return Number.isFinite(value) && value >= 0 ? String(Math.round(value)) : '';
}

export function count(value) {
 return Number.isFinite(value) ? String(value) : '';
}

export function clock(milliseconds) {
 if (!Number.isFinite(milliseconds)) return '';
 const date = new Date(milliseconds);
 return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// A round scale: 1, 2 or 5 times a power of ten, at least the value.
export function niceMax(value) {
 if (!(value > 0)) return 1000;
 const power = 10 ** Math.floor(Math.log10(value));
 return [1, 2, 5, 10].map(step => step * power).find(step => step >= value);
}
