// SPDX-License-Identifier: Apache-2.0
// ubus JSON-RPC client for uhttpd-mod-ubus. Calls issued in the same tick are
// sent as one JSON-RPC batch, so a refresh of several windows is one request.

export const NULL_SESSION = '00000000000000000000000000000000';

const UBUS_STATUS = ['OK', 'INVALID_COMMAND', 'INVALID_ARGUMENT', 'METHOD_NOT_FOUND', 'NOT_FOUND',
 'NO_DATA', 'PERMISSION_DENIED', 'TIMEOUT', 'NOT_SUPPORTED', 'UNKNOWN_ERROR', 'CONNECTION_FAILED',
 'NO_MEMORY', 'PARSE_ERROR', 'SYSTEM_ERROR'];
// uhttpd: -32001 session not found, -32002 access denied (expired or revoked session).
const SESSION_ERRORS = new Set([-32001, -32002]);

export class RpcError extends Error {
 constructor(message, details = {}) {
  super(message);
  this.name = 'RpcError';
  Object.assign(this, details);
 }
}

export const ubusStatusName = code => UBUS_STATUS[code] || 'UNKNOWN_' + code;

export function createClient({ endpoint = '/ubus', fetch: request = (...args) => globalThis.fetch(...args), onExpired = () => {}, timeout = 20000 } = {}) {
 let sid = null, nextId = 1, queue = [], scheduled = false;

 function failAll(batch, error) {
  batch.forEach(item => item.reject(error));
 }

 async function send(batch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let payload;
  try {
   const response = await request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch.length === 1 ? batch[0].body : batch.map(item => item.body)),
    credentials: 'same-origin',
    cache: 'no-store',
    signal: controller.signal
   });
   if (!response.ok) return failAll(batch, new RpcError(`Router replied with HTTP ${response.status}`, { code: 'http', status: response.status }));
   payload = await response.json();
  } catch (cause) {
   const aborted = cause?.name === 'AbortError';
   return failAll(batch, new RpcError(aborted ? 'Router did not reply in time' : 'Router is unreachable', { code: aborted ? 'timeout' : 'network', cause }));
  } finally {
   clearTimeout(timer);
  }
  const replies = new Map((Array.isArray(payload) ? payload : [payload]).map(reply => [reply?.id, reply]));
  let expired = false;
  for (const item of batch) {
   const reply = replies.get(item.id);
   const where = { object: item.object, method: item.method };
   if (!reply) { item.reject(new RpcError('Router reply is incomplete', { code: 'protocol', ...where })); continue; }
   if (reply.error) {
    const error = new RpcError(reply.error.message || 'Request failed', { code: reply.error.code, ...where });
    if (SESSION_ERRORS.has(reply.error.code) && item.session !== NULL_SESSION) {
     error.expired = true;
     expired ||= item.session === sid;
    }
    item.reject(error);
    continue;
   }
   const [status, data] = Array.isArray(reply.result) ? reply.result : [9];
   if (status === 0) item.resolve(data ?? null);
   else item.reject(new RpcError(`${item.object}.${item.method}: ${ubusStatusName(status)}`, { code: 'ubus', status, statusName: ubusStatusName(status), ...where }));
  }
  if (expired) {
   sid = null;
   onExpired();
  }
 }

 function flush() {
  scheduled = false;
  const batch = queue;
  queue = [];
  if (batch.length) send(batch);
 }

 function call(object, method, args = {}, { session } = {}) {
  const useSession = session ?? sid;
  if (!useSession) return Promise.reject(new RpcError('Not logged in', { code: -32002, expired: true, object, method }));
  return new Promise((resolve, reject) => {
   const id = nextId++;
   queue.push({ id, object, method, session: useSession, resolve, reject,
    body: { jsonrpc: '2.0', id, method: 'call', params: [useSession, object, method, args] } });
   if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
   }
  });
 }

 async function login(username, password) {
  let data;
  try {
   data = await call('session', 'login', { username, password }, { session: NULL_SESSION });
  } catch (error) {
   // rpcd answers PERMISSION_DENIED for unknown users and wrong passwords alike.
   if (error.status === 6) throw new RpcError('Wrong login or password', { code: 'auth' });
   throw error;
  }
  if (typeof data?.ubus_rpc_session !== 'string') throw new RpcError('Router reply has no session', { code: 'protocol' });
  sid = data.ubus_rpc_session;
  return { sid, username: data.data?.username ?? username, timeout: data.timeout };
 }

 async function logout() {
  const current = sid;
  sid = null;
  if (current) await call('session', 'destroy', {}, { session: current }).catch(() => {});
 }

 return {
  call, login, logout,
  get session() { return sid; },
  set session(value) { sid = value || null; }
 };
}
