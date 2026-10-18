// SPDX-License-Identifier: Apache-2.0
// IPv4 helpers for validation, display and sorting. IPv6 is validated
// loosely; the router remains the authority for anything it accepts.

export function parseIPv4(text) {
 const parts = String(text ?? '').trim().split('.');
 if (parts.length !== 4 || !parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;
 return parts.reduce((value, part) => value * 256 + Number(part), 0);
}

export const isIPv4 = text => parseIPv4(text) !== null;

export const formatIPv4 = value => [24, 16, 8, 0].map(shift => Math.floor(value / 2 ** shift) % 256).join('.');

export function maskToPrefix(mask) {
 const value = parseIPv4(mask);
 if (value === null) return null;
 const bits = value.toString(2).padStart(32, '0');
 return /^1*0*$/.test(bits) ? bits.indexOf('0') === -1 ? 32 : bits.indexOf('0') : null;
}

export function networkOf(address, prefix) {
 const value = parseIPv4(address);
 if (value === null || !(prefix >= 0 && prefix <= 32)) return null;
 const size = 2 ** (32 - prefix);
 return formatIPv4(Math.floor(value / size) * size);
}

// "a.b.c.d/nn" or "a.b.c.d" (prefix 32 unless required).
export function parseCidr(text, { requirePrefix = false } = {}) {
 const match = /^([0-9.]+)(?:\/(\d{1,2}))?$/.exec(String(text ?? '').trim());
 if (!match || (requirePrefix && match[2] === undefined)) return null;
 const prefix = match[2] === undefined ? 32 : Number(match[2]);
 if (!isIPv4(match[1]) || prefix > 32) return null;
 return { address: match[1], prefix, network: networkOf(match[1], prefix), cidr: `${match[1]}/${prefix}` };
}

export function isIPv6(text) {
 const value = String(text ?? '').trim().replace(/%[\w.-]+$/, '');
 if (!/^[0-9a-f:.]+$/i.test(value) || !value.includes(':') || (value.match(/::/g) ?? []).length > 1) return false;
 const groups = value.split(':');
 return groups.length >= 3 && groups.length <= 8 && groups.every(group => group.length <= 4 || isIPv4(group));
}

// conntrack prints IPv6 addresses fully expanded; show them compressed.
export function compressIPv6(text) {
 if (!String(text).includes(':')) return text;
 const groups = String(text).split(':').map(group => group.replace(/^0+(?=.)/, ''));
 let best = [-1, 0], run = [-1, 0];
 groups.forEach((group, index) => {
  if (group === '0') {
   run = run[0] < 0 ? [index, 1] : [run[0], run[1] + 1];
   if (run[1] > best[1]) best = run.slice();
  } else run = [-1, 0];
 });
 if (best[1] < 2) return groups.join(':');
 const head = groups.slice(0, best[0]).join(':'), tail = groups.slice(best[0] + best[1]).join(':');
 return `${head}::${tail}`;
}

export const isMac = text => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(String(text ?? '').trim());

// Sort key: IPv4 numerically (with prefix), everything else as text after it.
export function addressKey(text) {
 const [address, prefix] = String(text ?? '').split('/');
 const value = parseIPv4(address);
 return value === null ? `1${String(text ?? '')}` : `0${String(value).padStart(10, '0')}/${String(prefix ?? 32).padStart(2, '0')}`;
}
