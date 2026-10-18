// System menu models: identity, clock, NTP, logging, password, packages,
// the cron scheduler, startup services, resources and backup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError } from '../../console/src/model/common.js';
import { parseCrontab, formatCrontab, describeSchedule, localTime } from '../../console/src/model/system.js';

const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);
// Captured on OpenWrt 25.12.5 (uci show system).
const uciSystem = () => ({
 cfg01e48a: { '.anonymous': true, '.type': 'system', '.name': 'cfg01e48a', '.index': 0, hostname: 'OpenWrt', timezone: 'GMT0', zonename: 'UTC', ttylogin: '0', log_size: '128', urandom_seed: '0', log_proto: 'udp', conloglevel: '8', cronloglevel: '7' },
 ntp: { '.anonymous': false, '.type': 'timeserver', '.name': 'ntp', '.index': 1, server: ['0.openwrt.pool.ntp.org', '1.openwrt.pool.ntp.org'] }
});
const singleton = (id, data) => {
 const model = MODELS[id], row = model.rows(data)[0];
 return { model, row, values: model.values(row, data), save: (changes, extra = {}) => model.save({ ...model.values(row, data), ...changes }, row, data, { dirty: new Set(Object.keys(changes)), ...extra }) };
};

test('crontab lines keep their order, names and disabled entries', () => {
 const text = 'MAILTO=""\n# Reload WiFi at night\n0 4 * * * wifi reload\n#*/30 * * * * /usr/bin/check-wan\n# a plain remark\n\n5 * * * * logger hourly\n';
 const nodes = parseCrontab(text);
 assert.deepEqual(nodes.filter(node => node.type === 'entry').map(node => [node.name, node.schedule, node.command, node.disabled]), [
  ['Reload WiFi at night', '0 4 * * *', 'wifi reload', false], ['', '*/30 * * * *', '/usr/bin/check-wan', true], ['', '5 * * * *', 'logger hourly', false]
 ]);
 assert.equal(formatCrontab(nodes), text);
 assert.deepEqual(parseCrontab(''), []);
 assert.equal(formatCrontab([]), '');
 assert.equal(describeSchedule('*/5 * * * *'), 'every 5 minutes');
 assert.equal(describeSchedule('0 3 * * *'), 'daily at 03:00');
 assert.equal(describeSchedule('30 2 * * 0'), 'Sundays at 02:30');
 assert.equal(describeSchedule('0 */6 * * *'), 'every 6 hours at :00');
 assert.equal(describeSchedule('0 3 1 * *'), 'monthly on day 1 at 03:00');
 assert.equal(describeSchedule('0 3 1-5 * *'), '');
});

test('the scheduler rewrites the whole table, only if nobody changed it meanwhile', () => {
 const text = '# Reload WiFi at night\n0 4 * * * wifi reload\n#*/30 * * * * /usr/bin/check-wan\n';
 const data = { crontab: { text, crond: true, path: '/etc/crontabs/root' } };
 const model = MODELS['system-scheduler'], rows = model.rows(data);
 assert.deepEqual(rows.map(row => [row.cells.name, row.cells.when, row.flags]), [['Reload WiFi at night', 'daily at 04:00', ''], ['', 'every 30 minutes', 'X']]);
 const added = model.save({ name: 'Backup', schedule: '0  3 * * 0', command: '/root/backup.sh' }, null, data);
 assert.deepEqual(added.ops, [{ op: 'text', config: 'crontab', expect: text, text: text + '# Backup\n0 3 * * 0 /root/backup.sh\n' }]);
 assert.equal(model.toggle([rows[1]], true, data).ops[0].text, '# Reload WiFi at night\n0 4 * * * wifi reload\n*/30 * * * * /usr/bin/check-wan\n');
 assert.equal(model.remove([rows[0]], data).ops[0].text, '#*/30 * * * * /usr/bin/check-wan\n');
 assert.equal(model.comment([rows[1]], 'WAN check', data).ops[0].text, '# Reload WiFi at night\n0 4 * * * wifi reload\n# WAN check\n#*/30 * * * * /usr/bin/check-wan\n');
 rejects(() => model.save({ name: '', schedule: '0 3 * *', command: 'x' }, null, data), 'schedule');
 rejects(() => model.save({ name: '', schedule: '0 3 * * *', command: ' ' }, null, data), 'command');
});

test('clock, NTP and logging change only what was edited', () => {
 const data = { 'uci:system': uciSystem(), 'uci:network': {}, sysinfo: { localtime: 1792310400 }, timezones: { UTC: { tzstring: 'GMT0' }, 'Europe/Moscow': { tzstring: 'MSK-3' } } };
 const clock = singleton('system-clock', data);
 assert.equal(clock.model.fields(data).find(field => field.id === 'time').value(), localTime(1792310400));
 assert.equal(localTime(1792310400), '2026-10-18 08:00:00');
 assert.deepEqual(clock.save({ zonename: 'Europe/Moscow' }).ops, [{ op: 'set', config: 'system', section: 'cfg01e48a', values: { zonename: 'Europe/Moscow', timezone: 'MSK-3' } }]);
 rejects(() => clock.save({ zonename: 'Mars/Olympus' }), 'zonename');
 assert.deepEqual(clock.model.tools[0].run().call.slice(0, 2), ['luci', 'setLocaltime']);

 const ntp = singleton('system-ntp', data);
 assert.deepEqual(ntp.values, { enabled: true, server: ['0.openwrt.pool.ntp.org', '1.openwrt.pool.ntp.org'], use_dhcp: true, enable_server: false, interface: '' });
 assert.deepEqual(ntp.save({ server: ['192.0.2.123'], enable_server: true }).ops, [{ op: 'set', config: 'system', section: 'ntp', values: { server: ['192.0.2.123'], enable_server: '1' } }]);
 const bare = { ...data, 'uci:system': { cfg01e48a: uciSystem().cfg01e48a } };
 assert.equal(singleton('system-ntp', bare).save({ enabled: false }).ops[0].op, 'add');

 const logging = singleton('system-logging', data);
 assert.deepEqual(logging.save({ remote: '192.0.2.10', port: '1514' }).ops, [{ op: 'set', config: 'system', section: 'cfg01e48a', values: { log_ip: '192.0.2.10', log_port: '1514' } }]);
 rejects(() => logging.save({ size: '4' }), 'size');
 rejects(() => logging.save({ file: 'relative.log' }), 'file');
});

test('the password change is checked first and is not a configuration change', () => {
 const password = singleton('system-password', {});
 rejects(() => password.save({ old: 'a', next: 'b', confirm: 'c' }), 'confirm');
 rejects(() => password.save({ old: '', next: 'b', confirm: 'b' }), 'old');
 const change = password.save({ old: 'current', next: 'better', confirm: 'better' });
 assert.equal(change.ops, undefined);
 assert.deepEqual(change.verify, { username: null, password: 'current' });
 assert.deepEqual(change.call, ['luci', 'setPassword', { username: null, password: 'better' }]);
});

test('startup services are started, stopped and enabled through rc', () => {
 const data = { rc: { cron: { start: 50, enabled: true, running: false }, dnsmasq: { start: 19, enabled: true, running: true }, ttyd: { start: 99, enabled: false } } };
 const model = MODELS['system-startup'], rows = model.rows(data);
 assert.deepEqual(rows.map(row => [row.key, row.flags, row.cells.state]), [['cron', '', 'stopped'], ['dnsmasq', 'R', 'running'], ['ttyd', 'X', '']]);
 assert.deepEqual(model.toggle([rows[2]], true).calls, [['rc', 'init', { name: 'ttyd', action: 'enable' }]]);
 assert.deepEqual(model.tools.find(tool => tool.id === 'restart').run(rows.slice(0, 2)).calls, [['rc', 'init', { name: 'cron', action: 'restart' }], ['rc', 'init', { name: 'dnsmasq', action: 'restart' }]]);
});

test('packages, resources and backup show what the router reports', () => {
 const list = MODELS['system-packages'].rows({ packages: { manager: 'apk', packages: [{ name: 'dnsmasq', version: '2.91-r1', size: 248000, description: 'DNS', requested: true }, { name: 'libubox', version: '1', requested: false }] } });
 assert.deepEqual(list.map(row => [row.key, row.flags, row.cells.size]), [['dnsmasq', '', '242.2 KiB'], ['libubox', 'D', '']]);
 const data = { sysinfo: { uptime: 90061, load: [7864, 0, 0], memory: { total: 1048576, available: 524288 }, root: { total: 102400, avail: 51200 } }, board: { model: 'FriendlyElec NanoPi R4S', kernel: '6.12.94', release: { description: 'OpenWrt 25.12.5', target: 'rockchip/armv8' }, hostname: 'gw' } };
 const fields = MODELS['system-resources'].fields(data);
 const value = id => fields.find(field => field.id === id).value();
 assert.deepEqual([value('uptime'), value('load'), value('memory'), value('storage'), value('tmp')], ['1d 01:01:01', '0.12 / 0.00 / 0.00', '512.0 KiB of 1.0 MiB', '50.0 MiB of 100.0 MiB', '—']);
 const backup = MODELS['system-backup'].tools[0].run([], data);
 assert.equal(backup.download.url, '/cgi-bin/cgi-backup');
 assert.match(backup.download.filename, /^backup-gw-\d{4}-\d{2}-\d{2}\.tar\.gz$/);
});
