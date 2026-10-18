import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, NULL_SESSION } from '../../console/src/api/rpc.js';
import { createMockUbus, MOCK_LOGIN } from '../../scripts/mock-ubus.mjs';

// fetch() replacement that answers from the simulated rpcd and records bodies.
function mockFetch(ubus, log = []) {
 return async (url, options) => {
  const body = JSON.parse(options.body);
  log.push(body);
  const reply = Array.isArray(body) ? body.map(ubus.handle) : ubus.handle(body);
  return { ok: true, status: 200, json: async () => reply };
 };
}

test('login stores the session and calls in one tick share a batch', async () => {
 const log = [];
 const client = createClient({ fetch: mockFetch(createMockUbus(), log) });
 const session = await client.login(MOCK_LOGIN.username, MOCK_LOGIN.password);
 assert.match(session.sid, /^[0-9a-f]{32}$/);
 assert.equal(client.session, session.sid);
 assert.equal(log[0].params[0], NULL_SESSION);
 const [board, info] = await Promise.all([client.call('system', 'board'), client.call('system', 'info')]);
 assert.equal(board.release.distribution, 'OpenWrt');
 assert.ok(info.uptime > 0);
 assert.equal(log.length, 2);
 assert.ok(Array.isArray(log[1]) && log[1].length === 2);
 assert.deepEqual(log[1].map(item => item.params[0]), [session.sid, session.sid]);
});

test('wrong credentials are reported without leaking rpcd status codes', async () => {
 const client = createClient({ fetch: mockFetch(createMockUbus()) });
 await assert.rejects(client.login('root', 'wrong'), { code: 'auth', message: 'Wrong login or password' });
 assert.equal(client.session, null);
});

test('ubus statuses reject only the affected call in a batch', async () => {
 const client = createClient({ fetch: mockFetch(createMockUbus()) });
 await client.login(MOCK_LOGIN.username, MOCK_LOGIN.password);
 const [missingMethod, missingObject, board] = await Promise.allSettled([
  client.call('system', 'nope'), client.call('nowhere', 'info'), client.call('system', 'board')
 ]);
 assert.equal(missingMethod.reason.statusName, 'METHOD_NOT_FOUND');
 assert.equal(missingObject.reason.code, -32000);
 assert.equal(board.status, 'fulfilled');
});

test('an expired session clears the client and notifies once', async () => {
 let clock = 0, expired = 0;
 const ubus = createMockUbus({ now: () => clock, sessionTimeout: 10 });
 const client = createClient({ fetch: mockFetch(ubus), onExpired: () => expired++ });
 await client.login(MOCK_LOGIN.username, MOCK_LOGIN.password);
 clock = 5000;
 await client.call('system', 'info');
 clock = 14000; // sliding timeout: still valid 9 s after the last access
 await client.call('system', 'info');
 clock = 30000;
 const results = await Promise.allSettled([client.call('system', 'info'), client.call('system', 'board')]);
 assert.ok(results.every(result => result.reason?.expired));
 assert.equal(expired, 1);
 assert.equal(client.session, null);
 await assert.rejects(client.call('system', 'info'), { expired: true });
});

test('transport failures and HTTP errors become readable errors', async () => {
 const offline = createClient({ fetch: async () => { throw new TypeError('fetch failed'); } });
 offline.session = 'a'.repeat(32);
 await assert.rejects(offline.call('system', 'info'), { code: 'network', message: 'Router is unreachable' });
 const broken = createClient({ fetch: async () => ({ ok: false, status: 502 }) });
 broken.session = 'a'.repeat(32);
 await assert.rejects(broken.call('system', 'info'), { code: 'http', status: 502 });
});

test('logout destroys the session on the router', async () => {
 const ubus = createMockUbus();
 const client = createClient({ fetch: mockFetch(ubus) });
 await client.login(MOCK_LOGIN.username, MOCK_LOGIN.password);
 assert.equal(ubus.sessions.size, 1);
 await client.logout();
 assert.equal(ubus.sessions.size, 0);
 assert.equal(client.session, null);
});

test('the mock rejects malformed requests and client-supplied sessions', () => {
 const ubus = createMockUbus();
 assert.equal(ubus.handle({ jsonrpc: '2.0', id: 1, method: 'list' }).error.code, -32600);
 assert.equal(ubus.handle({ jsonrpc: '2.0', id: 2, method: 'call', params: [NULL_SESSION, 'system', 'board', {}] }).error.code, -32002);
 assert.equal(ubus.handle({ jsonrpc: '2.0', id: 3, method: 'call', params: [NULL_SESSION, 'session', 'login', { ubus_rpc_session: 'x' }] }).error.code, -32602);
});
