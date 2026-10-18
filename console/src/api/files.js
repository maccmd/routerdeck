// SPDX-License-Identifier: Apache-2.0
// Files go to and from the router through cgi-io, with this session: the
// rpcd ACL decides which paths may be read or written.
import { client } from '../state.js';

// A file chosen by the user, or null when the dialog is cancelled; with
// `multiple`, a list of files.
export function pickFile(accept = '', multiple = false) {
 return new Promise(resolve => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = multiple;
  input.style.display = 'none';
  let done = false;
  const finish = file => { if (done) return; done = true; input.remove(); resolve(file); };
  input.addEventListener('change', () => finish(multiple ? (input.files?.length ? [...input.files] : null) : input.files?.[0] ?? null));
  input.addEventListener('cancel', () => finish(null));
  document.body.append(input);
  input.click();
 });
}

export class TransferError extends Error {
 constructor(message) {
  super(message);
  this.name = 'TransferError';
 }
}

// cgi-io reads the fields in order: the session and the destination come
// before the data. Progress is reported for large firmware images.
export function uploadFile(path, file, { onProgress = () => {} } = {}) {
 return new Promise((resolve, reject) => {
  const form = new FormData();
  form.append('sessionid', client.session);
  form.append('filename', path);
  form.append('filedata', file, file.name ?? 'upload');
  const request = new XMLHttpRequest();
  request.open('POST', '/cgi-bin/cgi-upload');
  request.upload.addEventListener('progress', event => { if (event.lengthComputable) onProgress(event.loaded / event.total); });
  request.addEventListener('load', () => {
   if (request.status !== 200) return reject(new TransferError(request.status === 403 ? `This account may not write ${path}` : `The router answered HTTP ${request.status}`));
   try { resolve(JSON.parse(request.responseText)); } catch { resolve({}); }
  });
  request.addEventListener('error', () => reject(new TransferError('The upload was interrupted')));
  request.send(form);
 });
}

function save(blob, filename) {
 const link = document.createElement('a');
 link.href = URL.createObjectURL(blob);
 link.download = filename;
 document.body.append(link);
 link.click();
 link.remove();
 setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

// A backup (cgi-backup) or any file the ACL allows (cgi-download).
export async function downloadFile({ url = '/cgi-bin/cgi-download', path, filename }) {
 const body = new URLSearchParams({ sessionid: client.session, filename });
 if (path) body.set('path', path);
 const response = await fetch(url, { method: 'POST', body, credentials: 'same-origin' });
 if (!response.ok) throw new TransferError(response.status === 403 ? `This account may not read ${path ?? 'this file'}` : `The router answered HTTP ${response.status}`);
 save(await response.blob(), filename);
}
