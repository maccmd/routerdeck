// Simulated rpcd behind uhttpd's /ubus JSON-RPC endpoint, for the local
// preview and browser tests only. Reply shapes follow uhttpd-mod-ubus and rpcd:
// `result: [status, data?]`, JSON-RPC errors for sessions and unknown objects.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createMockRouter } from './mock-router.mjs';

export const MOCK_LOGIN = Object.freeze({ username: 'root', password: 'routerdeck' });
const NULL_SESSION = '0'.repeat(32);
const board = JSON.parse(readFileSync(new URL('../console/mock/board.json', import.meta.url), 'utf8'));

const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const result = (id, status, data) => ({ jsonrpc: '2.0', id, result: data === undefined ? [status] : [status, data] });

export function createMockUbus({ now = () => Date.now(), sessionTimeout = 300, login = MOCK_LOGIN, version = '0.0.0', safeTimeout } = {}) {
 const sessions = new Map();
 const started = now();
 // Each login gets its own simulated router, so parallel browser tests and
 // preview visitors never see each other's changes.
 const routerOf = sid => sessions.get(sid)?.router;
 const user = sid => sessions.get(sid)?.username ?? 'root';

 function systemInfo() {
  const seconds = Math.floor((now() - started) / 1000);
  const wave = Math.sin(seconds / 30);
  return {
   localtime: Math.floor(now() / 1000),
   uptime: 1063212 + seconds,
   load: [Math.round((.12 + .05 * wave) * 65536), Math.round(.09 * 65536), Math.round(.07 * 65536)],
   memory: { total: 2048 * 1048576, free: 1310 * 1048576, shared: 9 * 1048576, buffered: 0, available: 1475 * 1048576, cached: 210 * 1048576 },
   root: { total: 29360128, free: 28154000, used: 1206128, avail: 28154000 },
   tmp: { total: 1048576, free: 1040000, used: 8576, avail: 1040000 },
   swap: { total: 0, free: 0 }
  };
 }

 const objects = {
  session: {
   login(args) {
    if (args.username !== login.username || args.password !== login.password) return [6];
    const sid = randomBytes(16).toString('hex');
    sessions.set(sid, { username: args.username, expires: now() + sessionTimeout * 1000, router: createMockRouter({ now, safeTimeout }) });
    return [0, { ubus_rpc_session: sid, timeout: sessionTimeout, expires: sessionTimeout, acls: { 'access-group': { 'routerdeck-console': ['read', 'write'] } }, data: { username: args.username } }];
   },
   destroy(args, sid) {
    sessions.delete(sid);
    return [0];
   }
  },
  system: {
   board: () => [0, board],
   info: () => [0, systemInfo()]
  },
  routerdeck: {
   info: (args, sid) => [0, {
    version, api: 1, mock: true, user: sessions.get(sid)?.username,
    capabilities: { luci: false, ttyd: false, nft: true, ip_json: true, log_read: true, luci_rpc: true, wireless: true }
   }],
   routes: (args, sid) => [0, { routes: args.family === 6 ? routerOf(sid).routes6() : routerOf(sid).routes4() }],
   fw_counters: (args, sid) => [0, routerOf(sid).counters()],
   conntrack: (args, sid) => [0, routerOf(sid).conntrack()],
   diag: (args, sid) => [0, routerOf(sid).diag(args)],
   log: (args, sid) => [0, routerOf(sid).log(args)],
   terminal: (args, sid) => [0, routerOf(sid).terminal()],
   history: (args, sid) => [0, routerOf(sid).history()],
   apply: (args, sid) => [0, routerOf(sid).apply(args, user(sid))],
   undo: (args, sid) => [0, routerOf(sid).undo()],
   redo: (args, sid) => [0, routerOf(sid).redo()],
   safemode: (args, sid) => [0, routerOf(sid).safemode(args, sid, user(sid))]
  },
  uci: {
   get: (args, sid) => { const values = routerOf(sid).uci(args.config); return values ? [0, { values }] : [4]; }
  },
  'luci-rpc': {
   getNetworkDevices: (args, sid) => [0, routerOf(sid).devices()],
   getWirelessDevices: (args, sid) => [0, routerOf(sid).wirelessStatus()],
   getDHCPLeases: (args, sid) => [0, routerOf(sid).leases()]
  },
  'network.interface': {
   dump: (args, sid) => [0, { interface: routerOf(sid).ifaces() }]
  },
  'network.device': {
   status: (args, sid) => [0, routerOf(sid).netdev()]
  },
  network: {
   get_proto_handlers: () => [0, { dhcp: {}, dhcpv6: {}, ppp: {}, pppoe: {}, static: {}, wireguard: {} }]
  },
  iwinfo: {
   devices: (args, sid) => [0, { devices: Object.keys(routerOf(sid).wifi()) }],
   info: (args, sid) => { const entry = routerOf(sid).wifi()[args.device]; return entry ? [0, entry.info] : [4]; },
   assoclist: (args, sid) => { const entry = routerOf(sid).wifi()[args.device]; return entry ? [0, { results: entry.stations }] : [4]; }
  }
 };

 function handle(message) {
  const id = message?.id ?? null;
  if (message?.jsonrpc !== '2.0' || message.method !== 'call' || !Array.isArray(message.params) || message.params.length < 3) return error(id, -32600, 'Invalid request');
  const [sid, object, method, args = {}] = message.params;
  if (typeof sid !== 'string' || typeof object !== 'string' || typeof method !== 'string' || typeof args !== 'object' || args === null) return error(id, -32602, 'Invalid parameters');
  if ('ubus_rpc_session' in args) return error(id, -32602, 'Invalid parameters');
  const anonymous = sid === NULL_SESSION && object === 'session' && method === 'login';
  if (!anonymous) {
   const session = sessions.get(sid);
   if (!session || session.expires <= now()) {
    sessions.delete(sid);
    return error(id, -32002, 'Access denied');
   }
   session.expires = now() + sessionTimeout * 1000;
  }
  routerOf(sid)?.watchdog();
  const target = objects[object];
  if (!target) return error(id, -32000, 'Object not found');
  if (!Object.hasOwn(target, method)) return result(id, 3);
  const [status, data] = target[method](args, sid);
  return result(id, status, data);
 }

 async function handler(request, response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
   size += chunk.length;
   if (size > 65536) {
    response.writeHead(413);
    return response.end();
   }
   chunks.push(chunk);
  }
  let body;
  try {
   const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
   body = Array.isArray(payload) ? payload.map(handle) : handle(payload);
  } catch {
   body = error(null, -32700, 'Parse error');
  }
  response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
 }

 return { handle, handler, sessions };
}
