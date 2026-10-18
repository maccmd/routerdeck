// SPDX-License-Identifier: Apache-2.0
// Words of a RouterOS-style command line. Spaces separate words; "..."
// quotes (with \" and \\ escapes); [ ... ] holds a sub-command such as
// [find name=lan]; name=value, name!=value and name~regex are arguments.

export class CliError extends Error {
 constructor(message) {
  super(message);
  this.name = 'CliError';
 }
}

function closingBracket(line, from) {
 let depth = 0, quoted = false;
 for (let i = from; i < line.length; i++) {
  const ch = line[i];
  if (quoted) {
   if (ch === '\\') i++;
   else if (ch === '"') quoted = false;
  } else if (ch === '"') quoted = true;
  else if (ch === '[') depth++;
  else if (ch === ']' && --depth === 0) return i;
 }
 return -1;
}

export function tokenize(line) {
 const words = [];
 let i = 0;
 while (i < line.length) {
  if (/\s/.test(line[i])) { i++; continue; }
  const word = { text: '', start: i, quoted: false };
  while (i < line.length && !/\s/.test(line[i])) {
   const ch = line[i];
   if (ch === '"') {
    word.quoted = true;
    i++;
    let closed = false;
    while (i < line.length) {
     if (line[i] === '\\' && i + 1 < line.length) { word.text += line[i + 1]; i += 2; continue; }
     if (line[i] === '"') { closed = true; i++; break; }
     word.text += line[i++];
    }
    if (!closed) throw new CliError('unterminated quote');
   } else if (ch === '[' && word.text === '' && !word.op) {
    const end = closingBracket(line, i);
    if (end < 0) throw new CliError('missing ]');
    word.bracket = line.slice(i + 1, end).trim();
    i = end + 1;
   } else if ((ch === '=' || ch === '~') && !word.op && word.text !== '' && !word.quoted) {
    word.op = ch === '=' && word.text.endsWith('!') ? '!=' : ch;
    word.key = word.op === '!=' ? word.text.slice(0, -1) : word.text;
    word.text = '';
    i++;
   } else {
    word.text += ch;
    i++;
   }
  }
  word.end = i;
  if (word.op) word.value = word.text;
  words.push(word);
 }
 return words;
}

// A value as the CLI prints it: bare when that is unambiguous, else quoted.
export function quote(value) {
 const text = String(value ?? '');
 return /^[A-Za-z0-9_.:/@+*,-]+$/.test(text) ? text : `"${text.replace(/["\\]/g, '\\$&')}"`;
}

// Property names follow the form labels: "Src. Address" is src-address.
export function propertyName(label) {
 return String(label ?? '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[.:]/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The one name that starts with `prefix`, as RouterOS accepts abbreviations.
export function pick(names, prefix) {
 if (names.includes(prefix)) return prefix;
 const matches = names.filter(name => name.startsWith(prefix));
 return matches.length === 1 ? matches[0] : null;
}
