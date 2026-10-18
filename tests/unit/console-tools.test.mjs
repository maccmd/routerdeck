import test from 'node:test';
import assert from 'node:assert/strict';
import { pingView, traceView, flowSample, routeIndex, localAddresses, torchDevices, torchView, addressMatcher, HOST } from '../../console/src/model/tools.js';
import { createJob } from '../../console/src/api/diag.js';
import { inPrefix } from '../../console/src/lib/ip.js';

test('ping rows keep every sequence number, lost replies included', () => {
 const view = pingView([
  { address: '192.0.2.1' },
  { seq: 0, host: '192.0.2.1', size: 64, ttl: 57, time: 12.4 },
  { seq: 1, status: 'timeout' },
  { seq: 2, host: '192.0.2.1', size: 64, ttl: 57, time: 15 },
  { seq: 3, status: 'sendto: Network unreachable' }
 ]);
 assert.deepEqual(view.rows.map(row => [row.cells.seq, row.cells.host, row.cells.time, row.cells.status, row.tone]), [
  ['0', '192.0.2.1', '12.4 ms', '', undefined], ['1', '192.0.2.1', '', 'timeout', 'error'], ['2', '192.0.2.1', '15.0 ms', '', undefined], ['3', '192.0.2.1', '', 'sendto: Network unreachable', 'error']
 ]);
 assert.deepEqual([view.sent, view.received, view.loss, view.min, view.max], [4, 2, 50, 12.4, 15]);
 assert.equal(view.avg, 13.7);
 assert.equal(pingView([{ error: 'resolve', message: "ping: bad address 'x.invalid'" }]).error, "ping: bad address 'x.invalid'");
 assert.equal(pingView([]).loss, null);
});

test('traceroute statistics cover every round, and hops past the destination drop out', () => {
 const view = traceView([
  { address: '192.0.2.9' },
  { round: 1, hops: [{ hop: 1, address: '10.0.2.2', time: 1 }, { hop: 2, address: null, time: null }, { hop: 3, address: '192.0.2.9', time: 10 }, { hop: 4, address: null, time: null }] },
  { round: 2, hops: [{ hop: 1, address: '10.0.2.2', time: 3 }, { hop: 2, address: '100.64.0.1', time: 5 }, { hop: 3, address: '192.0.2.9', time: 12, status: '!H' }] }
 ]);
 assert.deepEqual(view.rows.map(row => [row.cells.hop, row.cells.address, row.cells.loss, row.cells.sent, row.cells.last, row.cells.avg, row.cells.best, row.cells.worst, row.cells.stdev, row.cells.status]), [
  ['1', '10.0.2.2', '0%', '2', '3.00 ms', '2.00 ms', '1.00 ms', '3.00 ms', '1.00 ms', ''],
  ['2', '100.64.0.1', '50%', '2', '5.00 ms', '5.00 ms', '5.00 ms', '5.00 ms', '0.00 ms', ''],
  ['3', '192.0.2.9', '0%', '2', '12.0 ms', '11.0 ms', '10.0 ms', '12.0 ms', '1.00 ms', '!H']
 ]);
 assert.deepEqual([view.rounds, view.reached], [2, true]);
 const silent = traceView([{ address: '192.0.2.250' }, { round: 1, hops: [{ hop: 1, address: null, time: null }] }]);
 assert.deepEqual([silent.rows[0].cells.last, silent.rows[0].cells.loss, silent.rows[0].tone, silent.reached], ['timeout', '100%', 'error', false]);
});

test('connection rates come from byte deltas; new connections count from zero', () => {
 const flow = (sport, tx, rx) => ({ family: 'ipv4', protocol: 'tcp', src: '192.168.88.10', sport, dst: '198.51.100.1', dport: '443', tx_bytes: tx, rx_bytes: rx, tx_packets: tx / 100, rx_packets: rx / 1000 });
 const first = flowSample({ count: 1, entries: [flow('1000', 1000, 10000)] }, null, 0);
 assert.equal(first.flows[0].tx_bps, null);
 const second = flowSample({ count: 2, entries: [flow('1000', 2000, 30000), flow('2000', 500, 1000)] }, first, 2000);
 assert.deepEqual(second.flows.map(item => [item.tx_bps, item.rx_bps, item.tx_pps, item.rx_pps]), [[4000, 80000, 5, 10], [2000, 4000, 2.5, .5]]);
 // A reused tuple with smaller counters is a new connection.
 const third = flowSample({ count: 1, entries: [flow('1000', 100, 100)] }, second, 3000);
 assert.equal(third.flows[0].tx_bps, 800);
 // After a truncated sample, a connection seen for the first time has no rate yet.
 const truncated = flowSample({ count: 5000, entries: [flow('1000', 200, 200)] }, null, 0);
 assert.equal(flowSample({ count: 2, entries: [flow('1000', 300, 300), flow('3000', 900, 900)] }, truncated, 1000).flows[1].tx_bps, null);
});

test('Torch orients rates to the watched device and groups by the collected fields', () => {
 const ifaces = [
  { interface: 'lan', up: true, l3_device: 'br-lan', 'ipv4-address': [{ address: '192.168.88.1', mask: 24 }], 'ipv6-prefix-assignment': [{ address: 'fd00:88::', mask: 64, 'local-address': { address: 'fd00:88::1', mask: 64 } }] },
  { interface: 'wan', up: true, l3_device: 'eth1', 'ipv4-address': [{ address: '203.0.113.42', mask: 24 }] },
  { interface: 'wan6', up: true, l3_device: 'eth1' },
  { interface: 'loopback', up: true, l3_device: 'lo', 'ipv4-address': [{ address: '127.0.0.1', mask: 8 }] },
  { interface: 'guest', up: false, l3_device: 'br-guest' }
 ];
 assert.deepEqual(torchDevices(ifaces), [{ value: 'br-lan', label: 'br-lan (lan)' }, { value: 'eth1', label: 'eth1 (wan, wan6)' }]);
 const routes = routeIndex(
  [{ dst: 'default', gateway: '203.0.113.1', dev: 'eth1' }, { dst: '192.168.88.0/24', dev: 'br-lan' }, { dst: '203.0.113.0/24', dev: 'eth1' }, { type: 'local', dst: '192.168.88.1', dev: 'br-lan', table: 'local' }],
  [{ dst: 'fd00:88::/64', dev: 'br-lan' }, { type: 'unreachable', dst: 'fd00:88::/48', dev: 'lo' }]
 );
 const local = localAddresses(ifaces);
 const download = { family: 'ipv4', protocol: 'tcp', src: '192.168.88.10', sport: '40000', dst: '198.51.100.1', dport: '443', reply_src: '198.51.100.1', reply_dst: '203.0.113.42', tx_bps: 1000, rx_bps: 50000, tx_pps: 2, rx_pps: 5 };
 const second = { ...download, sport: '40001', tx_bps: 500, rx_bps: 2000, tx_pps: 1, rx_pps: 1 };
 const forward = { family: 'ipv4', protocol: 'tcp', src: '198.51.100.7', sport: '50000', dst: '203.0.113.42', dport: '8080', reply_src: '192.168.88.10', reply_dst: '198.51.100.7', tx_bps: 300, rx_bps: 9000, tx_pps: 1, rx_pps: 3 };
 const router = { family: 'ipv4', protocol: 'udp', src: '203.0.113.42', sport: '123', dst: '198.51.100.9', dport: '123', reply_src: '198.51.100.9', reply_dst: '203.0.113.42', tx_bps: 80, rx_bps: 80, tx_pps: 1, rx_pps: 1 };
 const sample = { flows: [download, second, forward, router] };
 const view = (options = {}) => torchView(sample, { routes, local, ...options });
 // On the LAN bridge, downloads are sent (Tx) to the client.
 const lan = view({ device: 'br-lan' });
 assert.deepEqual(lan.rows.map(row => [row.cells.src, row.cells.dst, row.cells.tx, row.cells.rx]), [
  ['192.168.88.10:40000', '198.51.100.1:443', '50.0 kbps', '1.0 kbps'],
  ['198.51.100.7:50000', '203.0.113.42:8080', '300 bps', '9.0 kbps'],
  ['192.168.88.10:40001', '198.51.100.1:443', '2.0 kbps', '500 bps']
 ]);
 // On the WAN device the same download is received (Rx); the router's own traffic shows too.
 const wan = view({ device: 'eth1' });
 assert.deepEqual(wan.rows.map(row => [row.cells.src, row.cells.tx, row.cells.rx]), [
  ['192.168.88.10:40000', '1.0 kbps', '50.0 kbps'], ['198.51.100.7:50000', '9.0 kbps', '300 bps'], ['192.168.88.10:40001', '500 bps', '2.0 kbps'], ['203.0.113.42:123', '80 bps', '80 bps']
 ]);
 assert.deepEqual(wan.totals, { tx_bps: 10580, rx_bps: 52380, tx_pps: 7, rx_pps: 8 });
 // Collecting addresses only adds connections up.
 const grouped = view({ device: 'br-lan', collect: ['src', 'dst'] });
 assert.deepEqual(grouped.rows.map(row => [row.cells.src, row.cells.dst, row.cells.protocol, row.cells.flows, row.cells.tx]), [['192.168.88.10', '198.51.100.1', '', '2', '52.0 kbps'], ['198.51.100.7', '203.0.113.42', '', '1', '300 bps']]);
 // Filters match the original direction.
 assert.deepEqual(view({ src: '192.168.88.0/24' }).rows.length, 2);
 assert.deepEqual(view({ port: '123' }).rows.map(row => row.cells.protocol), ['udp']);
 assert.deepEqual(view({ protocol: 'udp', device: 'br-lan' }).rows, []);
 assert.deepEqual(view({ dst: '203.0.113.' }).invalid, ['dst']);
});

test('addresses match prefixes of either family', () => {
 assert.equal(inPrefix('192.168.88.10', '192.168.88.0', 24), true);
 assert.equal(inPrefix('192.168.89.10', '192.168.88.0', 24), false);
 assert.equal(inPrefix('fd00:88::5c1', 'fd00:88::', 64), true);
 assert.equal(inPrefix('fd00:89::1', 'fd00:88::', 64), false);
 assert.equal(inPrefix('192.168.88.10', 'fd00::', 8), false);
 assert.equal(addressMatcher('')('anything'), true);
 assert.equal(addressMatcher('2001:db8::/32')('2001:db8:1::1'), true);
 assert.equal(addressMatcher('nonsense'), null);
 assert.equal(HOST.test('openwrt.org'), true);
 assert.equal(HOST.test('-f'), false);
 assert.equal(HOST.test('1.1.1.1; reboot'), false);
});

function fakeRouter(results) {
 const calls = [];
 let next = 0, running = true;
 return {
  calls,
  client: {
   async call(object, method, args) {
    calls.push(args.action);
    if (args.action === 'start') return { ok: true, id: 'job1' };
    if (args.action === 'stop') { running = false; next = results.length - 1; return { ok: true }; }
    const from = args.from;
    const available = results.slice(from, next = Math.min(results.length, next + 1));
    return { ok: true, running, results: available, next: from + available.length };
   }
  }
 };
}

test('a job is read until it ends, and Stop reads the last results once', async () => {
 const router = fakeRouter([{ address: 'a' }, { seq: 0, time: 1 }, { seq: 1, time: 2 }]);
 const updates = [];
 const job = createJob(router.client, { wait: () => new Promise(resolve => setTimeout(resolve, 1)), onUpdate: state => updates.push(state) });
 const finished = job.start({ tool: 'ping', host: 'a' });
 // The poll loop reads one result per round; Stop picks up the rest.
 await new Promise(resolve => setTimeout(resolve, 3));
 await job.stop();
 await finished;
 const state = job.state();
 assert.equal(state.running, false);
 assert.deepEqual(state.results.map(item => item.seq ?? item.address), ['a', 0, 1]);
 assert.equal(router.calls.filter(call => call === 'stop').length, 1);
 // No result is appended twice although the poll loop and Stop both read.
 assert.equal(new Set(state.results).size, state.results.length);
});

test('a job that fails to start reports why', async () => {
 const job = createJob({ call: async () => ({ ok: false, message: 'Too many pings and traceroutes are running; stop one first' }) }, { wait: () => Promise.resolve() });
 await job.start({ tool: 'ping', host: 'a' });
 assert.deepEqual(job.state(), { results: [], running: false, error: 'Too many pings and traceroutes are running; stop one first' });
});

test('bandwidth results split by direction; summaries give the averages', async () => {
 const { bandwidthView } = await import('../../console/src/model/tools.js');
 const view = bandwidthView([
  { status: 'Connecting to host 192.0.2.9, port 5201' },
  { role: 'TX', start: 0, end: 1, bytes: 115e6, bps: 920e6, summary: null },
  { role: 'RX', start: 0, end: 1, bytes: 60e6, bps: 480e6, summary: null },
  { role: 'TX', start: 0, end: 1, bytes: 115e6, bps: 921e6, summary: 'sender' },
  { role: 'TX', start: 0, end: 1, bytes: 115e6, bps: 919e6, summary: 'receiver' },
  { role: 'RX', start: 0, end: 1, bytes: 60e6, bps: 480e6, summary: 'receiver' }
 ], { direction: 'both' });
 assert.deepEqual(view.rows.map(row => [row.cells.direction, row.cells.rate]), [['send', '920.0 Mbps'], ['receive', '480.0 Mbps']]);
 assert.deepEqual(view.totals, { tx: 919e6, rx: 480e6 });
 assert.deepEqual(view.points, [{ t: 1000, tx: 920e6, rx: 480e6 }]);
 // Without roles: a one-off server receives, a client sends unless reversed.
 assert.equal(bandwidthView([{ role: null, start: 0, end: 1, bytes: 1, bps: 8, summary: null }], { mode: 'server' }).rows[0].cells.direction, 'receive');
 assert.equal(bandwidthView([{ role: null, start: 0, end: 1, bytes: 1, bps: 8, summary: null }], { direction: 'receive' }).rows[0].cells.direction, 'receive');
 assert.equal(bandwidthView([{ error: 'iperf', message: 'error - unable to connect to server' }]).error, 'error - unable to connect to server');
});

test('a scan lists answering hosts by address with MACs and names', async () => {
 const { scanView } = await import('../../console/src/model/tools.js');
 const view = scanView([{ total: 14 }, { address: '192.168.77.3', time: 0.19, ttl: 255 }, { address: '192.168.77.1', time: 0.09, ttl: 64 }, { scanned: 14 }, { macs: { '192.168.77.3': '52:55:c0:a8:4d:03' } }],
  { leases: { dhcp_leases: [{ ipaddr: '192.168.77.3', hostname: 'laptop' }] } });
 assert.deepEqual(view.rows.map(row => [row.cells.address, row.cells.mac, row.cells.name, row.cells.time]), [['192.168.77.1', '', '', '0.09 ms'], ['192.168.77.3', '52:55:C0:A8:4D:03', 'laptop', '0.19 ms']]);
 assert.deepEqual([view.total, view.scanned, view.done], [14, 14, true]);
});

test('netwatch hosts and Wake on LAN', async () => {
 const { MODELS } = await import('../../console/src/model/index.js');
 const { niceMax } = await import('../../console/src/lib/format.js');
 const data = {
  'uci:routerdeck': { a: { '.type': 'netwatch', '.name': 'a', '.index': 0, host: '8.8.8.8', interval: '10', timeout: '1', down: 'logger down' }, b: { '.type': 'netwatch', '.name': 'b', '.index': 1, host: '192.0.2.1', disabled: '1' } },
  netwatch: { running: true, now: 1000, hosts: { a: { host: '8.8.8.8', status: 'down', since: 940, rtt: null } } }
 };
 const model = MODELS.netwatch, rows = model.rows(data);
 assert.deepEqual(rows.map(row => [row.cells.host, row.flags, row.cells.status, row.cells.since]), [['8.8.8.8', 'D', 'down', '00:01:00 ago'], ['192.0.2.1', 'X', '', '']]);
 assert.deepEqual(model.save({ host: '1.1.1.1', interval: '5', timeout: '2', up: '', down: 'ifup wan' }, null, data).ops, [{ op: 'add', config: 'routerdeck', type: 'netwatch', values: { host: '1.1.1.1', interval: '5', timeout: '2', up: null, down: 'ifup wan' } }]);
 assert.throws(() => model.save({ host: '-x', interval: '5', timeout: '1', up: '', down: '' }, null, data));
 const wol = MODELS['tool-wol'];
 assert.deepEqual(wol.save({ mac: '52:54:00:AA:10:02 laptop', interface: 'br-lan' }).call, ['routerdeck', 'wol', { mac: '52:54:00:aa:10:02', interface: 'br-lan' }]);
 assert.throws(() => wol.save({ mac: 'nope', interface: 'br-lan' }));
 assert.equal(wol.action.label, 'Send');
 assert.deepEqual([niceMax(0), niceMax(1300), niceMax(48e6), niceMax(9.2e8)], [1000, 2000, 5e7, 1e9]);
});
