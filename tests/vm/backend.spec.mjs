// RouterDeck Console backend against real rpcd, through uhttpd's /ubus with a
// logged-in session (so the shipped ACL is exercised). Changes are made only
// in the disposable guest and are undone by each test.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const port = process.env.ROUTERDECK_VM_PORT || '8088';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
const NULL = '0'.repeat(32);

async function rpc(sid, object, method, args = {}) {
 const response = await fetch(`http://127.0.0.1:${port}/ubus`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [sid, object, method, args] }) });
 const body = await response.json();
 if (body.error) throw new Error(`${object}.${method}: ${body.error.message}`);
 expect(body.result[0]).toBe(0);
 return body.result[1];
}
const login = async () => (await rpc(NULL, 'session', 'login', { username: 'root', password })).ubus_rpc_session;
const ruleNames = () => ssh("uci -q show firewall | sed -n \"s/^firewall\\.[^.]*\\.name='\\(.*\\)'$/\\1/p\"").split('\n');
const addRule = name => ({ op: 'add', config: 'firewall', type: 'rule', values: { name, src: 'wan', proto: 'tcp', dest_port: '8443', target: 'ACCEPT' } });

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Backend checks run once');

let sid;
test.beforeAll(async () => {
 sid = await login();
 // Start from a clean Safe Mode and history state in the guest.
 ssh('/etc/init.d/routerdeck-safemode stop 2>/dev/null; rm -rf /var/run/routerdeck/safemode /var/run/routerdeck/last-rollback.json');
});

test('apply commits, reloads fw4 and records undoable history', async () => {
 const name = 'RD-Test-' + Date.now();
 const applied = await rpc(sid, 'routerdeck', 'apply', { description: 'Add rule ' + name, ops: [addRule(name)] });
 expect(applied).toMatchObject({ ok: true, changed: ['firewall'] });
 expect(ruleNames()).toContain(name);
 await expect.poll(() => ssh('nft list chain inet fw4 input_wan'), { timeout: 15000 }).toContain(name);
 await expect.poll(async () => Object.keys((await rpc(sid, 'routerdeck', 'fw_counters')).counters), { timeout: 15000 }).toContain(name);
 const history = await rpc(sid, 'routerdeck', 'history');
 expect(history.undo).toMatchObject({ id: applied.id, description: 'Add rule ' + name, user: 'root' });

 expect(await rpc(sid, 'routerdeck', 'undo')).toMatchObject({ ok: true, id: applied.id });
 expect(ruleNames()).not.toContain(name);
 expect((await rpc(sid, 'routerdeck', 'history')).redo).toMatchObject({ id: applied.id });
 expect(await rpc(sid, 'routerdeck', 'redo')).toMatchObject({ ok: true, id: applied.id });
 expect(ruleNames()).toContain(name);
 await rpc(sid, 'routerdeck', 'undo');
 expect(ruleNames()).not.toContain(name);
});

test('changes made outside the history block undo instead of overwriting them', async () => {
 const name = 'RD-Conflict-' + Date.now();
 await rpc(sid, 'routerdeck', 'apply', { description: 'Add rule ' + name, ops: [addRule(name)] });
 const section = ssh(`uci show firewall | grep "name='${name}'" | cut -d. -f2`);
 ssh(`uci set firewall.${section}.dest_port=9443 && uci commit firewall`);
 expect(await rpc(sid, 'routerdeck', 'undo')).toMatchObject({ ok: false, error: 'conflict' });
 expect(ruleNames()).toContain(name);
 ssh(`uci delete firewall.${section} && uci commit firewall && /etc/init.d/firewall reload`);
});

test('invalid input is rejected and leaves the configuration unchanged', async () => {
 const before = ssh('sha256sum /etc/config/firewall /etc/config/network /etc/config/dhcp');
 const rejected = await rpc(sid, 'routerdeck', 'apply', { description: 'Bad rule', ops: [{ op: 'add', config: 'firewall', type: 'rule', values: { name: 'RD-Bad', src: 'wan', dest_port: 'notaport', target: 'ACCEPT' } }] });
 expect(rejected).toMatchObject({ ok: false, error: 'rejected' });
 expect(rejected.details).toContain("invalid value 'notaport'");
 expect(await rpc(sid, 'routerdeck', 'apply', { ops: [{ op: 'set', config: 'rpcd', section: 'x', values: { timeout: '1' } }] })).toMatchObject({ ok: false, error: 'invalid' });
 expect(await rpc(sid, 'routerdeck', 'apply', { ops: [{ op: 'set', config: 'network', section: 'missing_section', values: { proto: 'none' } }] })).toMatchObject({ ok: false, error: 'missing' });
 expect(await rpc(sid, 'routerdeck', 'apply', { ops: [{ op: 'set', config: 'network', section: 'lan', values: { 'bad-key': 'x' } }] })).toMatchObject({ ok: false, error: 'invalid' });
 expect(ssh('sha256sum /etc/config/firewall /etc/config/network /etc/config/dhcp')).toBe(before);
 // uci leaves an empty delta file after a revert; nothing may stay staged.
 expect(ssh('find /var/run/routerdeck/uci -type f -size +0 | wc -l')).toBe('0');
});

test('a pending LuCI rollback makes apply wait instead of racing it', async () => {
 ssh('mkdir -p /var/run/rpcd/snapshot-files && touch /var/run/rpcd/snapshot-files/routerdeck-test');
 try {
  expect(await rpc(sid, 'routerdeck', 'apply', { ops: [addRule('RD-Busy')] })).toMatchObject({ ok: false, error: 'busy' });
 } finally {
  ssh('rm -f /var/run/rpcd/snapshot-files/routerdeck-test');
 }
 expect(ruleNames()).not.toContain('RD-Busy');
});

test('Safe Mode keeps or discards changes on exit', async () => {
 const kept = 'RD-Keep-' + Date.now(), dropped = 'RD-Drop-' + Date.now();
 expect(await rpc(sid, 'routerdeck', 'safemode', { action: 'enter' })).toMatchObject({ active: true, mine: true });
 await rpc(sid, 'routerdeck', 'apply', { description: 'Add rule ' + kept, ops: [addRule(kept)] });
 expect((await rpc(sid, 'routerdeck', 'safemode', { action: 'status' })).count).toBe(1);
 const other = await login();
 expect(await rpc(other, 'routerdeck', 'safemode', { action: 'enter' })).toMatchObject({ ok: false, error: 'taken', owner: 'root' });
 expect(await rpc(sid, 'routerdeck', 'safemode', { action: 'exit', keep: true })).toMatchObject({ active: false });
 expect(ruleNames()).toContain(kept);
 expect((await rpc(sid, 'routerdeck', 'history')).undo.description).toBe('Add rule ' + kept);
 await rpc(sid, 'routerdeck', 'undo');

 await rpc(sid, 'routerdeck', 'safemode', { action: 'enter' });
 await rpc(sid, 'routerdeck', 'apply', { description: 'Add rule ' + dropped, ops: [addRule(dropped)] });
 expect(ruleNames()).toContain(dropped);
 const exit = await rpc(sid, 'routerdeck', 'safemode', { action: 'exit', keep: false });
 expect(exit).toMatchObject({ active: false, restored: ['firewall'] });
 expect(ruleNames()).not.toContain(dropped);
 expect((await rpc(sid, 'routerdeck', 'history')).entries.some(entry => entry.description === 'Add rule ' + dropped)).toBe(false);
});

test('the watchdog rolls back when heartbeats stop', async () => {
 test.setTimeout(90000);
 const name = 'RD-Timeout-' + Date.now();
 const before = ssh('sha256sum /etc/config/firewall');
 await rpc(sid, 'routerdeck', 'safemode', { action: 'enter', timeout: 10 });
 await expect.poll(() => ssh('ubus call service list \'{"name":"routerdeck-safemode"}\''), { timeout: 10000 }).toContain('"running": true');
 await rpc(sid, 'routerdeck', 'apply', { description: 'Add rule ' + name, ops: [addRule(name)] });
 expect(ruleNames()).toContain(name);
 // No pings: the watchdog restores the snapshot after the 10 s timeout.
 await expect.poll(() => ssh('sha256sum /etc/config/firewall'), { timeout: 40000, intervals: [2000] }).toBe(before);
 const status = await rpc(sid, 'routerdeck', 'safemode', { action: 'status' });
 expect(status).toMatchObject({ active: false, last_rollback: { reason: 'timed out', configs: ['firewall'], user: 'root' } });
 expect(ssh('logread -e routerdeck | tail -n 1')).toContain('Safe Mode timed out: restored firewall');
 await expect.poll(() => ssh('nft list chain inet fw4 input_wan'), { timeout: 15000 }).not.toContain(name);
});

test('another session can take Safe Mode over and keep its changes protected', async () => {
 const name = 'RD-Takeover-' + Date.now();
 const before = ssh('sha256sum /etc/config/firewall');
 await rpc(sid, 'routerdeck', 'safemode', { action: 'enter' });
 await rpc(sid, 'routerdeck', 'apply', { description: 'Add rule ' + name, ops: [addRule(name)] });
 const other = await login();
 expect(await rpc(other, 'routerdeck', 'safemode', { action: 'status' })).toMatchObject({ active: true, mine: false, owner: 'root', count: 1 });
 expect(await rpc(other, 'routerdeck', 'safemode', { action: 'takeover' })).toMatchObject({ active: true, mine: true, count: 1 });
 expect(await rpc(sid, 'routerdeck', 'safemode', { action: 'status' })).toMatchObject({ active: true, mine: false });
 // The new owner undoes the first session's change.
 expect(await rpc(other, 'routerdeck', 'safemode', { action: 'exit', keep: false })).toMatchObject({ active: false, restored: ['firewall'] });
 expect(ssh('sha256sum /etc/config/firewall')).toBe(before);
 expect(ssh('logread -e routerdeck | grep -c "taken over"')).not.toBe('0');
});

test('ping and traceroute accept only plain hosts and report replies', async () => {
 expect(await rpc(sid, 'routerdeck', 'ping', { host: '127.0.0.1' })).toMatchObject({ ok: true, replied: true, host: '127.0.0.1', ttl: 64 });
 expect(await rpc(sid, 'routerdeck', 'ping', { host: '::1', family: 6, size: 100 })).toMatchObject({ ok: true, replied: true, size: 108 });
 expect(await rpc(sid, 'routerdeck', 'ping', { host: '127.0.0.1; reboot' })).toMatchObject({ ok: false, error: 'invalid' });
 expect(await rpc(sid, 'routerdeck', 'ping', { host: '-f' })).toMatchObject({ ok: false, error: 'invalid' });
 expect(await rpc(sid, 'routerdeck', 'ping', { host: 'no-such-host.invalid' })).toMatchObject({ ok: false, error: 'resolve' });
 const trace = await rpc(sid, 'routerdeck', 'traceroute', { host: '127.0.0.1', max: 3 });
 expect(trace.hops[0]).toMatchObject({ hop: 1, address: '127.0.0.1' });
});
