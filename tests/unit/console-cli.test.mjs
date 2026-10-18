// The RouterOS-style command line against data captured from a real
// OpenWrt 25.12.5 guest. Changes are captured instead of applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCli } from '../../console/src/cli/engine.js';
import { tokenize, quote, propertyName, pick, CliError } from '../../console/src/cli/parser.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/router.json', import.meta.url), 'utf8'));
const wireless = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/wireless.json', import.meta.url), 'utf8'));
const routerData = () => ({
 ...structuredClone(fixture), ...structuredClone(wireless),
 'uci:system': { cfg01e48a: { '.anonymous': true, '.type': 'system', '.name': 'cfg01e48a', '.index': 0, hostname: 'OpenWrt' } },
 protos: { dhcp: {}, static: {}, pppoe: {} }, board: { model: 'QEMU virt', release: { description: 'OpenWrt 25.12.5' } },
 history: { entries: [{ id: 1, description: 'Add rule', user: 'root', time: 1792300000, undone: false, safemode: true }] }
});

function session({ data = routerData(), job } = {}) {
 const lines = [], applied = [], blocks = [];
 const cli = createCli({
  load: async keys => Object.fromEntries(keys.map(key => [key, data[key]])),
  apply: async change => { applied.push(change); return { ok: true, created: { $new: 'cfgnew' } }; },
  undo: async () => applied.push('undo'), redo: async () => applied.push('redo'),
  createJob: job ?? (() => ({ start: async () => {}, stop() {} })),
  out: { line: text => lines.push(text), live: () => { const block = { lines: [], ended: false }; blocks.push(block); return { update: next => { block.lines = next; }, end: () => { block.ended = true; } }; } },
  identity: () => 'OpenWrt', now: () => new Date('2026-10-18T08:00:00Z')
 });
 const run = async line => { lines.length = 0; await cli.run(line); return lines.slice(); };
 return { cli, run, applied, blocks, data };
}

test('words: quotes, escapes, [find ...] and name=value arguments', () => {
 assert.deepEqual(tokenize('set 0 comment="a \\"b\\" c" name!=lan comment~^x [find name="x y"]').map(word => [word.text, word.key, word.op, word.value, word.bracket]), [
  ['set', undefined, undefined, undefined, undefined], ['0', undefined, undefined, undefined, undefined], ['a "b" c', 'comment', '=', 'a "b" c', undefined],
  ['lan', 'name', '!=', 'lan', undefined], ['^x', 'comment', '~', '^x', undefined], ['', undefined, undefined, undefined, 'find name="x y"']
 ]);
 assert.throws(() => tokenize('set comment="open'), CliError);
 assert.throws(() => tokenize('remove [find'), CliError);
 assert.equal(quote('lan'), 'lan');
 assert.equal(quote('two words'), '"two words"');
 assert.equal(quote(''), '""');
 assert.equal(propertyName('Src. Address'), 'src-address');
 assert.equal(propertyName('Interval (s)'), 'interval');
 assert.equal(pick(['address', 'route', 'dns', 'dhcp-server'], 'ad'), 'address');
 assert.equal(pick(['dns', 'dhcp-server'], 'd'), null);
});

test('menus are entered by path, abbreviation and ..; the prompt shows where', async () => {
 const { cli, run } = session();
 assert.equal(cli.prompt(), '[root@OpenWrt] > ');
 await run('ip fire');
 assert.equal(cli.prompt(), '[root@OpenWrt] /ip/firewall> ');
 await run('filter');
 assert.equal(cli.path(), '/ip/firewall/filter');
 await run('..');
 await run('/interface/bridge');
 assert.equal(cli.path(), '/interface/bridge');
 await run('/');
 assert.equal(cli.path(), '/');
 assert.deepEqual(await run('/ip d'), ['ambiguous command name d']);
 assert.deepEqual(await run('/ip/foo'), ['bad command name foo (line 1 column 1)']);
 // A command after a path runs there without moving.
 await run('/ip address print count-only');
 assert.equal(cli.path(), '/');
});

test('print shows flags, columns, comments and keeps numbers when filtered', async () => {
 const { run } = session();
 assert.deepEqual(await run('/ip address print'), [
  'Flags: D - DYNAMIC; I - INVALID (NETWORK IS DOWN)',
  'Columns: ADDRESS, NETWORK, INTERFACE',
  ' #   ADDRESS          NETWORK       INTERFACE',
  ' 0 D 10.0.2.15/24     10.0.2.0      wan (eth1)',
  ' 1   127.0.0.1/8      127.0.0.0     loopback (lo)',
  ' 2   192.168.77.1/24  192.168.77.0  lan (br-lan)'
 ]);
 const filtered = await run('/ip firewall filter print where src-address~fe80');
 assert.equal(filtered[3], ' 4 ;;; Allow-MLD');
 assert.deepEqual(await run('/ip firewall filter print count-only where protocol=udp'), ['3']);
 assert.deepEqual(await run('/ip firewall filter find where protocol=udp'), ['0,3,8']);
 const detail = await run('/ip address print detail where interface=lan');
 assert.deepEqual(detail, ['Flags: D - DYNAMIC; I - INVALID (NETWORK IS DOWN)', ' 2   address=192.168.77.1/24 network=192.168.77.0 interface=lan', '']);
 const dns = await run('/ip dns print');
 assert.ok(dns.includes('            local-domain: lan'));
 assert.ok(dns.includes('                 servers:'));
 assert.ok((await run('/system history print')).some(line => line.includes(' S Add rule')));
});

test('set, enable, disable, comment and remove go through the window models', async () => {
 const { run, applied } = session();
 await run('/ip firewall filter set 0 dst-port=69 action=drop');
 assert.equal(applied[0].description, 'Change firewall rule Allow-DHCP-Renew');
 assert.deepEqual([applied[0].ops[0].values.dest_port, applied[0].ops[0].values.target], ['69', 'DROP']);
 await run('/ip firewall filter disable 1,2');
 assert.equal(applied[1].description, 'Disable firewall rule Allow-Ping, Allow-IGMP');
 await run('/ip firewall filter remove [find chain=forward]');
 assert.deepEqual(applied[2].ops.map(op => op.op), ['delete', 'delete', 'delete']);
 await run('/ip dns set servers=9.9.9.9,1.1.1.1 allow-remote=yes');
 assert.deepEqual(applied[3].ops[0].values, { server: ['9.9.9.9', '1.1.1.1'], localservice: '0' });
 await run('/system identity set name=gw');
 assert.deepEqual(applied[4].ops, [{ op: 'set', config: 'system', section: 'cfg01e48a', values: { hostname: 'gw' } }]);
 // Items can be named instead of numbered.
 await run('/interface network set lan comment="LAN side"');
 assert.equal(applied[5].description, 'Comment network lan');
 await run('/undo');
 assert.equal(applied[6], 'undo');
});

test('add creates an item with its comment in one change', async () => {
 const { run, applied } = session();
 await run('/interface bridge add name=br-guest comment="Guests"');
 assert.equal(applied.length, 1);
 assert.equal(applied[0].ops[0].op, 'add');
 assert.equal(applied[0].ops[0].ref, '$new');
 assert.equal(applied[0].ops[0].values.name, 'br-guest');
 // The comment is part of the same change, aimed at the new section.
 assert.deepEqual(applied[0].ops[1], { op: 'set', config: 'network', section: '$new', values: { comment: 'Guests' } });
 await run('/ip firewall filter add chain=input protocol=tcp dst-port=8444 comment=cli disabled=yes');
 assert.deepEqual(applied.at(-1).ops.slice(1), [{ op: 'set', config: 'firewall', section: '$new', values: { name: 'cli' } }, { op: 'set', config: 'firewall', section: '$new', values: { enabled: '0' } }]);
 assert.deepEqual(await run('/interface bridge add name=br-x disabled=yes'), ['failure: Disable the network that uses this bridge instead']);
 assert.deepEqual(await run('/ip address set 2 comment=x'), ['failure: OpenWrt cannot comment a single address']);
 await run('/interface add type=vlan name=eth1.10 interface=eth1 vlan-id=10');
 assert.ok(applied.at(-1).description.includes('eth1.10'));
 assert.deepEqual(await run('/interface add name=x'), ['add needs type=bridge|vlan']);
});

test('mistakes are reported the way RouterOS reports them', async () => {
 const { run, applied } = session();
 assert.deepEqual(await run('/ip firewall filter set 0 dest-port=80'), ['expected end of command: unknown property dest-port']);
 assert.deepEqual(await run('/ip firewall filter set 0 action=allow'), ['input does not match any value of action: accept, drop, reject, notrack']);
 assert.deepEqual(await run('/ip address set 99 address=1.1.1.1/8'), ['no such item (99)']);
 assert.deepEqual(await run('/ip address set 0 address=10.0.2.16/24'), ['failure: 10.0.2.15/24 is dynamic and cannot be changed']);
 assert.deepEqual(await run('/ip address add address=nonsense interface=lan'), ['failure: Enter an IPv4 address with a prefix, for example 192.168.88.1/24 (address)']);
 assert.deepEqual(await run('/ip route remove 0'), ['failure: 0.0.0.0/0 cannot be removed (dynamic)']);
 assert.deepEqual(applied, []);
});

test('export prints the configuration as commands and hides secrets unless asked', async () => {
 const { run } = session();
 assert.deepEqual(await run('/ip address export'), [
  '# 2026-10-18 08:00:00 by RouterDeck Console', '# OpenWrt 25.12.5 on QEMU virt',
  '/ip/address', 'add address=127.0.0.1/8 interface=loopback', 'add address=192.168.77.1/24 interface=lan',
  '# passwords and keys are hidden; add show-sensitive to include them'
 ]);
 const wifi = await run('/interface wifi export');
 assert.ok(wifi.includes('add ssid=RD-Test mode=ap radio=radio0 network=lan security=psk2'));
 assert.ok((await run('/interface wifi export show-sensitive')).some(line => line.includes('passphrase=routerdeck-test')));
 const all = await run('/export');
 assert.ok(['/interface/bridge', '/ip/firewall/filter', '/ip/dns', '/system/identity'].every(path => all.includes(path)));
 assert.ok(!all.includes('/ip/firewall/connection') && !all.includes('/log'));
});

test('ping prints each reply and a summary; traceroute redraws its table', async () => {
 const results = [{ address: '192.0.2.1' }, { seq: 0, host: '192.0.2.1', size: 64, ttl: 57, time: 12.4 }, { seq: 1, status: 'timeout' }];
 const started = [];
 const job = onUpdate => ({
  start: async args => { started.push(args); onUpdate({ results: results.slice(0, 2), running: true }); onUpdate({ results, running: false }); },
  stop() {}
 });
 const { run, blocks } = session({ job });
 const output = await run('/ping 192.0.2.1 count=2 interval=500ms');
 assert.deepEqual(started[0], { tool: 'ping', host: '192.0.2.1', family: 0, count: 2, interval: 500 });
 assert.equal(output.length, 4);
 assert.match(output[1], /^ {4}0 192\.0\.2\.1 +64 +57 12\.4 ms$/);
 assert.match(output[2], /timeout$/);
 assert.equal(output[3], '    sent=2 received=1 packet-loss=50% min-rtt=12.4ms avg-rtt=12.4ms max-rtt=12.4ms');
 results.splice(0, results.length, { address: '192.0.2.9' }, { round: 1, hops: [{ hop: 1, address: '10.0.2.2', time: 0.4 }, { hop: 2, address: '192.0.2.9', time: 9 }] });
 await run('/tool traceroute 192.0.2.9 count=1');
 assert.equal(blocks[0].lines.length, 3);
 assert.match(blocks[0].lines[2], /^ {2}2 {2}192\.0\.2\.9 /);
 assert.equal(blocks[0].ended, true);
 assert.deepEqual(await run('/ping'), ['ping needs an address']);
});

test('System menus print and change settings; reboot asks first', async () => {
 const data = routerData();
 data['uci:system'].cfg01e48a.cronloglevel = '8';
 data.crontab = { text: '# Nightly\n0 4 * * * wifi reload\n', crond: true };
 data.sysinfo = { uptime: 61, load: [0, 0, 0], memory: { total: 1048576, available: 524288 }, root: { total: 1024, avail: 512 } };
 data.rc = { cron: { start: 50, enabled: true, running: true } };
 let rebooted = 0;
 const { cli, run, applied } = session({ data });
 assert.deepEqual(await run('/system scheduler print'), ['Flags: X - DISABLED', 'Columns: NAME, SCHEDULE, WHEN, COMMAND', ' # NAME     SCHEDULE   WHEN            COMMAND', ' 0 Nightly  0 4 * * *  daily at 04:00  wifi reload']);
 await run('/system scheduler add schedule="*/5 * * * *" command="logger tick" name=tick');
 assert.equal(applied[0].ops[0].text, '# Nightly\n0 4 * * * wifi reload\n# tick\n*/5 * * * * logger tick\n');
 await run('/system startup restart cron');
 assert.deepEqual(applied[1].calls, [['rc', 'init', { name: 'cron', action: 'restart' }]]);
 assert.ok((await run('/system resource print')).includes('        uptime: 00:01:01'));
 // Reboot is confirmed on the next line, as in RouterOS.
 const confirmed = createCli({ load: async keys => Object.fromEntries(keys.map(key => [key, data[key]])), out: { line: () => {} }, reboot: async () => { rebooted++; } });
 await confirmed.run('/system reboot');
 assert.equal(confirmed.prompt(), 'Reboot, yes? [y/N]: ');
 await confirmed.run('n');
 assert.equal(rebooted, 0);
 await confirmed.run('/system reboot');
 await confirmed.run('y');
 assert.equal(rebooted, 1);
 assert.equal(cli.prompt(), '[root@OpenWrt] > ');
});

test('Tab completes menus, commands, properties and values; ? lists them', async () => {
 const { cli } = session();
 assert.deepEqual(await cli.complete('/ip ad'), { text: '/ip address ', options: [] });
 assert.deepEqual(await cli.complete('/ip/fi'), { text: '/ip/firewall ', options: [] });
 assert.deepEqual(await cli.complete('/ip firewall filter add ch'), { text: '/ip firewall filter add chain=', options: [] });
 assert.deepEqual(await cli.complete('/ip firewall filter add chain=f'), { text: '/ip firewall filter add chain=forward ', options: [] });
 assert.deepEqual((await cli.complete('/ip d')).options, ['dhcp-server', 'dns']);
 const help = await cli.help('/ip ');
 assert.ok(help.includes('address      -- Address'));
 assert.ok((await cli.help('/ip firewall filter add ')).some(line => line.startsWith('action=') && line.includes('accept|drop|reject|notrack')));
});
