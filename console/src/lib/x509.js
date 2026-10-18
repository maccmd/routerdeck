// SPDX-License-Identifier: Apache-2.0
// Just enough of X.509 to list certificates: names, validity, key, the
// subject alternative names, whether it is an authority, and the SHA-256
// fingerprint. PEM bundles and single DER files (uhttpd's px5g) both work.
import { sha256, hex } from './crypt.js';

const NAMES = { '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU', '1.2.840.113549.1.9.1': 'emailAddress' };
const KEYS = { '1.2.840.113549.1.1.1': 'RSA', '1.2.840.10045.2.1': 'EC', '1.3.101.112': 'Ed25519', '1.3.101.113': 'Ed448' };
const CURVES = { '1.2.840.10045.3.1.7': 'P-256', '1.3.132.0.34': 'P-384', '1.3.132.0.35': 'P-521' };

export class CertificateError extends Error {}

function read(bytes, offset) {
 if (offset + 2 > bytes.length) throw new CertificateError('truncated');
 const tag = bytes[offset];
 let length = bytes[offset + 1], start = offset + 2;
 if (length & 0x80) {
  const count = length & 0x7f;
  if (!count || count > 4) throw new CertificateError('bad length');
  length = 0;
  for (let i = 0; i < count; i++) length = length * 256 + bytes[start + i];
  start += count;
 }
 if (start + length > bytes.length) throw new CertificateError('truncated');
 return { tag, start, end: start + length, length };
}

function children(bytes, node) {
 const list = [];
 for (let offset = node.start; offset < node.end;) {
  const child = read(bytes, offset);
  list.push(child);
  offset = child.end;
 }
 return list;
}

function oid(bytes, node) {
 const parts = [];
 let value = 0;
 for (let i = node.start; i < node.end; i++) {
  value = value * 128 + (bytes[i] & 0x7f);
  if (!(bytes[i] & 0x80)) {
   if (!parts.length) parts.push(Math.min(2, Math.floor(value / 40)), value - Math.min(2, Math.floor(value / 40)) * 40);
   else parts.push(value);
   value = 0;
  }
 }
 return parts.join('.');
}

function text(bytes, node) {
 const slice = bytes.subarray(node.start, node.end);
 if (node.tag === 0x1e) return String.fromCharCode(...Array.from({ length: slice.length / 2 }, (unused, i) => slice[i * 2] * 256 + slice[i * 2 + 1]));
 return new TextDecoder().decode(slice);
}

function name(bytes, node) {
 const parts = [];
 for (const set of children(bytes, node)) for (const pair of children(bytes, set)) {
  const [type, value] = children(bytes, pair);
  parts.push([NAMES[oid(bytes, type)] ?? oid(bytes, type), text(bytes, value)]);
 }
 return parts;
}

function time(bytes, node) {
 const value = text(bytes, node);
 const match = node.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(value) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(value);
 if (!match) return null;
 const year = node.tag === 0x17 ? (Number(match[1]) < 50 ? 2000 : 1900) + Number(match[1]) : Number(match[1]);
 return Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)) / 1000;
}

const integerBits = (bytes, node) => {
 let start = node.start;
 while (start < node.end - 1 && bytes[start] === 0) start++;
 return (node.end - start) * 8;
};

export function parseDer(bytes) {
 const certificate = read(bytes, 0);
 const [tbs] = children(bytes, certificate);
 const fields = children(bytes, tbs);
 let index = fields[0].tag === 0xa0 ? 1 : 0;
 const serial = hex(bytes.subarray(fields[index].start, fields[index].end));
 index += 2;
 const issuer = name(bytes, fields[index++]);
 const [notBefore, notAfter] = children(bytes, fields[index++]).map(node => time(bytes, node));
 const subject = name(bytes, fields[index++]);
 const [algorithm, key] = children(bytes, fields[index++]);
 const [keyOid, params] = children(bytes, algorithm);
 const keyType = KEYS[oid(bytes, keyOid)] ?? oid(bytes, keyOid);
 let keySize = null;
 if (keyType === 'RSA') {
  const inner = read(bytes, key.start + 1);
  keySize = integerBits(bytes, children(bytes, inner)[0]);
 } else if (keyType === 'EC' && params?.tag === 0x06) keySize = CURVES[oid(bytes, params)] ?? oid(bytes, params);
 const names = [];
 let authority = false;
 for (const extra of fields.slice(index)) {
  if (extra.tag !== 0xa3) continue;
  for (const extension of children(bytes, children(bytes, extra)[0])) {
   const parts = children(bytes, extension), id = oid(bytes, parts[0]), value = parts.at(-1);
   const inner = read(bytes, value.start);
   if (id === '2.5.29.17') {
    for (const general of children(bytes, inner)) {
     if (general.tag === 0x82) names.push(text(bytes, general));
     else if (general.tag === 0x87 && general.length === 4) names.push(Array.from(bytes.subarray(general.start, general.end)).join('.'));
    }
   } else if (id === '2.5.29.19') authority = children(bytes, inner).some(node => node.tag === 0x01 && bytes[node.start] !== 0);
  }
 }
 const dn = parts => parts.map(([type, value]) => `${type}=${value}`).join(', ');
 const field = (parts, type) => parts.find(([key]) => key === type)?.[1] ?? '';
 return {
  serial, subject: dn(subject), issuer: dn(issuer), commonName: field(subject, 'CN'), organization: field(subject, 'O'),
  // Some authorities have no common name; their unit or organization names them.
  name: field(subject, 'CN') || field(subject, 'OU') || field(subject, 'O'),
  issuerName: field(issuer, 'CN') || field(issuer, 'OU') || field(issuer, 'O'), notBefore, notAfter, keyType, keySize, names, authority,
  selfSigned: dn(subject) === dn(issuer), fingerprint: hex(sha256(bytes.subarray(0, certificate.end)))
 };
}

export function fromBase64(value) {
 const binary = atob(value);
 return Uint8Array.from(binary, char => char.charCodeAt(0));
}

// All certificates in a file's bytes: PEM blocks, or one DER certificate.
export function parseCertificates(bytes) {
 const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 64)));
 if (!head.includes('-----BEGIN')) return bytes.length ? [parseDer(bytes)] : [];
 const blocks = new TextDecoder().decode(bytes).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
 return blocks.map(block => parseDer(fromBase64(block.replace(/-----[A-Z ]+-----|\s/g, ''))));
}
