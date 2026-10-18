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

// IPv6 as a BigInt, accepting "::" compression and an embedded IPv4 tail.
export function parseIPv6(text) {
 let value = String(text ?? '').trim().replace(/%[\w.-]+$/, '');
 if (!/^[0-9a-f:.]+$/i.test(value) || !value.includes(':') || (value.match(/::/g) ?? []).length > 1) return null;
 const tail = /:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
 if (tail) {
  const v4 = parseIPv4(tail[1]);
  if (v4 === null) return null;
  value = value.slice(0, -tail[1].length) + (v4 >>> 16).toString(16) + ':' + (v4 & 0xffff).toString(16);
 }
 const [head, rest] = value.split('::');
 const left = head ? head.split(':') : [], right = rest ? rest.split(':') : [];
 const missing = 8 - left.length - right.length;
 if (value.includes('::') ? missing < 1 : missing !== 0) return null;
 const groups = [...left, ...Array(value.includes('::') ? missing : 0).fill('0'), ...right];
 if (groups.length !== 8 || !groups.every(group => /^[0-9a-f]{1,4}$/i.test(group))) return null;
 return groups.reduce((result, group) => (result << 16n) | BigInt(parseInt(group, 16)), 0n);
}

export const isIPv6 = text => parseIPv6(text) !== null;

// RFC 5952 text: lowercase, longest zero run compressed.
export function formatIPv6(value) {
 const groups = Array.from({ length: 8 }, (unused, index) => Number((value >> BigInt(112 - index * 16)) & 0xffffn).toString(16));
 let best = [-1, 0], run = [-1, 0];
 groups.forEach((group, index) => {
  if (group === '0') {
   run = run[0] < 0 ? [index, 1] : [run[0], run[1] + 1];
   if (run[1] > best[1]) best = run.slice();
  } else run = [-1, 0];
 });
 if (best[1] < 2) return groups.join(':');
 return `${groups.slice(0, best[0]).join(':')}::${groups.slice(best[0] + best[1]).join(':')}`;
}

export const canonicalIPv6 = text => { const value = parseIPv6(text); return value === null ? null : formatIPv6(value); };

// "2001:db8::1/64" or a bare address (prefix 128 unless required).
export function parseCidr6(text, { requirePrefix = false } = {}) {
 const match = /^([0-9a-f:.]+)(?:\/(\d{1,3}))?$/i.exec(String(text ?? '').trim());
 if (!match || (requirePrefix && match[2] === undefined)) return null;
 const value = parseIPv6(match[1]), prefix = match[2] === undefined ? 128 : Number(match[2]);
 if (value === null || prefix > 128) return null;
 const mask = prefix === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);
 const address = formatIPv6(value);
 return { address, prefix, network: formatIPv6(value & mask), cidr: `${address}/${prefix}`, linkLocal: (value >> 118n) === 0x3fan };
}

export function prefixFromMask6(mask) {
 const value = parseIPv6(mask);
 if (value === null) return null;
 const bits = value.toString(2).padStart(128, '0');
 return /^1*0*$/.test(bits) ? (bits.indexOf('0') === -1 ? 128 : bits.indexOf('0')) : null;
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

// Sort key: IPv4, then IPv6, numerically with prefix; other text after them.
export function addressKey(text) {
 const [address, prefix] = String(text ?? '').replace(/^\[|\](?=:\d+$)/g, '').split('/');
 const value = parseIPv4(address);
 if (value !== null) return `0${String(value).padStart(10, '0')}/${String(prefix ?? 32).padStart(3, '0')}`;
 const v6 = parseIPv6(address);
 if (v6 !== null) return `1${v6.toString(16).padStart(32, '0')}/${String(prefix ?? 128).padStart(3, '0')}`;
 return `2${String(text ?? '')}`;
}

// Whether an address lies in network/prefix, for IPv4 and IPv6 alike.
export function inPrefix(address, network, prefix) {
 const v4 = parseIPv4(address), net4 = parseIPv4(network);
 if (v4 !== null || net4 !== null) {
  if (v4 === null || net4 === null || !(prefix >= 0 && prefix <= 32)) return false;
  const size = 2 ** (32 - prefix);
  return Math.floor(v4 / size) === Math.floor(net4 / size);
 }
 const v6 = parseIPv6(address), net6 = parseIPv6(network);
 if (v6 === null || net6 === null || !(prefix >= 0 && prefix <= 128)) return false;
 const shift = BigInt(128 - prefix);
 return v6 >> shift === net6 >> shift;
}
