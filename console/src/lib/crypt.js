// SPDX-License-Identifier: Apache-2.0
// SHA-256, SHA-512 and SHA-512-crypt ("$6$") without WebCrypto, which plain
// HTTP pages do not get. rpcd checks a login with crypt(3), so a password
// hashed here works there; certificates get their fingerprints here too.

const encoder = new TextEncoder();
const bytesOf = value => typeof value === 'string' ? encoder.encode(value) : value;

// Round constants and initial values are the fractional parts of the cube
// and square roots of the first primes, computed instead of copied.
function primes(count) {
 const found = [];
 for (let candidate = 2; found.length < count; candidate++) if (found.every(prime => candidate % prime)) found.push(candidate);
 return found;
}
function root(value, degree) {
 let guess = 1n << BigInt(Math.ceil(value.toString(2).length / degree) + 1);
 for (;;) {
  const next = ((BigInt(degree) - 1n) * guess + value / guess ** BigInt(degree - 1)) / BigInt(degree);
  if (next >= guess) return guess;
  guess = next;
 }
}
const fraction = (prime, degree, bits) => root(BigInt(prime) << BigInt(bits * degree), degree) & ((1n << BigInt(bits)) - 1n);

const P64 = primes(80), P8 = primes(8);
const K256 = Uint32Array.from(P64.slice(0, 64), prime => Number(fraction(prime, 3, 32)));
const H256 = Uint32Array.from(P8, prime => Number(fraction(prime, 2, 32)));
// 64-bit words as high and low 32-bit halves.
const K512 = new Uint32Array(160), H512 = new Uint32Array(16);
P64.forEach((prime, index) => { const value = fraction(prime, 3, 64); K512[index * 2] = Number(value >> 32n); K512[index * 2 + 1] = Number(value & 0xffffffffn); });
P8.forEach((prime, index) => { const value = fraction(prime, 2, 64); H512[index * 2] = Number(value >> 32n); H512[index * 2 + 1] = Number(value & 0xffffffffn); });

function pad(bytes, block, lengthBytes) {
 const total = Math.ceil((bytes.length + 1 + lengthBytes) / block) * block;
 const out = new Uint8Array(total);
 out.set(bytes);
 out[bytes.length] = 0x80;
 const bits = bytes.length * 8;
 const view = new DataView(out.buffer);
 view.setUint32(total - 4, bits >>> 0);
 view.setUint32(total - 8, Math.floor(bits / 0x100000000));
 return out;
}

export function sha256(input) {
 const data = pad(bytesOf(input), 64, 8), view = new DataView(data.buffer);
 const h = H256.slice(), w = new Uint32Array(64);
 const rotr = (x, n) => (x >>> n) | (x << (32 - n));
 for (let offset = 0; offset < data.length; offset += 64) {
  for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
  for (let i = 16; i < 64; i++) {
   const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
   const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
   w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  let [a, b, c, d, e, f, g, k] = h;
  for (let i = 0; i < 64; i++) {
   const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
   const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
   k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  [a, b, c, d, e, f, g, k].forEach((value, index) => { h[index] = (h[index] + value) >>> 0; });
 }
 const out = new Uint8Array(32), result = new DataView(out.buffer);
 h.forEach((value, index) => result.setUint32(index * 4, value));
 return out;
}

export function sha512(input) {
 const data = pad(bytesOf(input), 128, 16), view = new DataView(data.buffer);
 const h = H512.slice(), w = new Uint32Array(160);
 // (hi, lo) helpers; every value stays an unsigned 32-bit half.
 const rotrHi = (hi, lo, n) => n < 32 ? ((hi >>> n) | (lo << (32 - n))) >>> 0 : ((lo >>> (n - 32)) | (hi << (64 - n))) >>> 0;
 const rotrLo = (hi, lo, n) => n < 32 ? ((lo >>> n) | (hi << (32 - n))) >>> 0 : ((hi >>> (n - 32)) | (lo << (64 - n))) >>> 0;
 const shrHi = (hi, lo, n) => hi >>> n;
 const shrLo = (hi, lo, n) => ((lo >>> n) | (hi << (32 - n))) >>> 0;
 for (let offset = 0; offset < data.length; offset += 128) {
  for (let i = 0; i < 32; i++) w[i] = view.getUint32(offset + i * 4);
  for (let i = 16; i < 80; i++) {
   const xh = w[(i - 15) * 2], xl = w[(i - 15) * 2 + 1], yh = w[(i - 2) * 2], yl = w[(i - 2) * 2 + 1];
   const s0h = rotrHi(xh, xl, 1) ^ rotrHi(xh, xl, 8) ^ shrHi(xh, xl, 7), s0l = rotrLo(xh, xl, 1) ^ rotrLo(xh, xl, 8) ^ shrLo(xh, xl, 7);
   const s1h = rotrHi(yh, yl, 19) ^ rotrHi(yh, yl, 61) ^ shrHi(yh, yl, 6), s1l = rotrLo(yh, yl, 19) ^ rotrLo(yh, yl, 61) ^ shrLo(yh, yl, 6);
   let lo = (s0l >>> 0) + (s1l >>> 0) + w[(i - 16) * 2 + 1] + w[(i - 7) * 2 + 1];
   const hi = (s0h >>> 0) + (s1h >>> 0) + w[(i - 16) * 2] + w[(i - 7) * 2] + Math.floor(lo / 0x100000000);
   w[i * 2] = hi >>> 0;
   w[i * 2 + 1] = lo >>> 0;
  }
  const v = h.slice();
  for (let i = 0; i < 80; i++) {
   const [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, kh, kl] = v;
   const S1h = rotrHi(eh, el, 14) ^ rotrHi(eh, el, 18) ^ rotrHi(eh, el, 41), S1l = rotrLo(eh, el, 14) ^ rotrLo(eh, el, 18) ^ rotrLo(eh, el, 41);
   const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
   let t1l = kl + (S1l >>> 0) + (chl >>> 0) + K512[i * 2 + 1] + w[i * 2 + 1];
   const t1h = (kh + (S1h >>> 0) + (chh >>> 0) + K512[i * 2] + w[i * 2] + Math.floor(t1l / 0x100000000)) >>> 0;
   t1l >>>= 0;
   const S0h = rotrHi(ah, al, 28) ^ rotrHi(ah, al, 34) ^ rotrHi(ah, al, 39), S0l = rotrLo(ah, al, 28) ^ rotrLo(ah, al, 34) ^ rotrLo(ah, al, 39);
   const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
   let t2l = (S0l >>> 0) + (mjl >>> 0);
   const t2h = ((S0h >>> 0) + (mjh >>> 0) + Math.floor(t2l / 0x100000000)) >>> 0;
   t2l >>>= 0;
   const el2 = dl + t1l, eh2 = (dh + t1h + Math.floor(el2 / 0x100000000)) >>> 0;
   const al2 = t1l + t2l, ah2 = (t1h + t2h + Math.floor(al2 / 0x100000000)) >>> 0;
   v[14] = gh; v[15] = gl; v[12] = fh; v[13] = fl; v[10] = eh; v[11] = el;
   v[8] = eh2; v[9] = el2 >>> 0;
   v[6] = ch; v[7] = cl; v[4] = bh; v[5] = bl; v[2] = ah; v[3] = al;
   v[0] = ah2; v[1] = al2 >>> 0;
  }
  for (let i = 0; i < 16; i += 2) {
   const lo = h[i + 1] + v[i + 1];
   h[i] = (h[i] + v[i] + Math.floor(lo / 0x100000000)) >>> 0;
   h[i + 1] = lo >>> 0;
  }
 }
 const out = new Uint8Array(64), result = new DataView(out.buffer);
 h.forEach((value, index) => result.setUint32(index * 4, value));
 return out;
}

export const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

const concat = (...parts) => {
 const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
 let offset = 0;
 for (const part of parts) { out.set(part, offset); offset += part.length; }
 return out;
};
const repeat = (bytes, length) => {
 const out = new Uint8Array(length);
 for (let offset = 0; offset < length; offset += bytes.length) out.set(bytes.subarray(0, Math.min(bytes.length, length - offset)), offset);
 return out;
};

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ORDER = [[0, 21, 42], [22, 43, 1], [44, 2, 23], [3, 24, 45], [25, 46, 4], [47, 5, 26], [6, 27, 48], [28, 49, 7], [50, 8, 29], [9, 30, 51], [31, 52, 10],
 [53, 11, 32], [12, 33, 54], [34, 55, 13], [56, 14, 35], [15, 36, 57], [37, 58, 16], [59, 17, 38], [18, 39, 60], [40, 61, 19], [62, 20, 41]];
export const SALT = /^[A-Za-z0-9./]{1,16}$/;

// Ulrich Drepper's SHA-crypt with the default 5000 rounds.
export function sha512crypt(password, salt) {
 if (!SALT.test(salt)) throw new Error('A salt is 1 to 16 characters of [A-Za-z0-9./]');
 const p = bytesOf(password), s = bytesOf(salt);
 const b = sha512(concat(p, s, p));
 const parts = [p, s, repeat(b, p.length)];
 for (let length = p.length; length > 0; length >>= 1) parts.push(length & 1 ? b : p);
 const a = sha512(concat(...parts));
 const pSeq = repeat(sha512(repeat(p, p.length * p.length)), p.length);
 const sSeq = repeat(sha512(repeat(s, s.length * (16 + a[0]))), s.length);
 let c = a;
 for (let round = 0; round < 5000; round++) {
  const input = [round & 1 ? pSeq : c];
  if (round % 3) input.push(sSeq);
  if (round % 7) input.push(pSeq);
  input.push(round & 1 ? c : pSeq);
  c = sha512(concat(...input));
 }
 let text = '';
 const encode = (value, count) => { for (let i = 0; i < count; i++) { text += ITOA64[value & 63]; value >>>= 6; } };
 for (const [x, y, z] of ORDER) encode((c[x] << 16) | (c[y] << 8) | c[z], 4);
 encode(c[63], 2);
 return `$6$${salt}$${text}`;
}

export function randomSalt(random = length => crypto.getRandomValues(new Uint8Array(length))) {
 return Array.from(random(16), byte => ITOA64[byte & 63]).join('');
}
