// Packages, scripts, jobs, backup restore, firmware and the Files listing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError } from '../../console/src/model/common.js';
import { taskView, packageJob, firmwareQuestion, RUN_SCRIPT } from '../../console/src/model/system.js';
import { fileRows, normalPath, parentPath, joinPath, permissions } from '../../console/src/model/files.js';
import { createCli } from '../../console/src/cli/engine.js';

const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);
// apk's database and `apk list --upgradable` as the plugin reports them.
const packageData = () => ({ packages: { manager: 'apk', upgradable: { dnsmasq: '2.91-r2' }, packages: [
 { name: 'dnsmasq', version: '2.91-r1', size: 248000, description: 'DNS and DHCP server', requested: true },
 { name: 'libpcap1', version: '1.10.6-r1', size: 180000, requested: false }
] } });

test('packages show updates and dependencies; tools describe package jobs', () => {
 const model = MODELS['system-packages'], data = packageData();
 const rows = model.rows(data);
 assert.deepEqual(rows.map(row => [row.key, row.flags, row.cells.update]), [['dnsmasq', 'U', '2.91-r2'], ['libpcap1', 'D', '']]);
 const tool = id => model.tools.find(item => item.id === id);
 assert.equal(tool('upgrade').enabled(rows), false);
 assert.deepEqual(tool('upgrade').run(rows.slice(0, 1)), { job: { title: 'Upgrade dnsmasq', task: { tool: 'package', operation: 'upgrade', names: ['dnsmasq'] } } });
 const uninstall = tool('uninstall').run(rows.slice(1));
 assert.match(uninstall.ask.text, /^Uninstall libpcap1\? .*cannot be undone/);
 assert.deepEqual(uninstall.job.task, { tool: 'package', operation: 'remove', names: ['libpcap1'] });
 assert.deepEqual(tool('check-for-updates').run([]), packageJob('update'));
 assert.equal(packageJob('update').job.title, 'Check for updates');
 assert.deepEqual(tool('install').run([]), { open: 'system-package-install' });
});

test('Install Package takes names and refuses what is invalid or installed', () => {
 const model = MODELS['package-install'], data = packageData();
 const save = names => model.save({ names }, model.rows(data)[0], data);
 assert.deepEqual(save(' tcpdump,  iperf3 ').job.task, { tool: 'package', operation: 'install', names: ['tcpdump', 'iperf3'] });
 rejects(() => save(''), 'names');
 rejects(() => save('rm -rf'), 'names');
 rejects(() => save('--force'), 'names');
 rejects(() => save('dnsmasq'), 'names');
 assert.deepEqual(save('dnsmasq nano').job.task.names, ['dnsmasq', 'nano']);
});

test('job output: lines, the command, truncation and the exit code', () => {
 assert.deepEqual(taskView([{ command: 'apk add nano' }, { line: '(1/1) Installing nano' }, { truncated: 5000 }, { exit: 0 }]), {
  lines: ['(1/1) Installing nano', '… output after 5000 lines is not shown'], exit: 0, error: null, command: 'apk add nano', stopped: false
 });
 assert.deepEqual(taskView([{ error: 'invalid', message: 'Invalid package operation' }]), { lines: [], exit: null, error: 'Invalid package operation', command: null, stopped: false });
 assert.equal(taskView([{ line: 'Terminated' }, { exit: 143, stopped: true }]).stopped, true);
});

test('scripts keep several lines in UCI and run by name', () => {
 const model = MODELS['system-scripts'];
 const data = { 'uci:routerdeck': {
  cfg2692bd: { '.anonymous': true, '.type': 'netwatch', '.name': 'cfg2692bd', '.index': 0, host: '192.0.2.1' },
  backup: { '.anonymous': false, '.type': 'script', '.name': 'backup', '.index': 1, source: '#!/bin/sh\n# nightly\nsysupgrade -b /tmp/b.tar.gz\n\nlogger done\n', comment: 'Nightly backup' }
 } };
 const [row] = model.rows(data);
 assert.deepEqual([row.key, row.comment, row.cells.lines, row.cells.source], ['backup', 'Nightly backup', '4', 'sysupgrade -b /tmp/b.tar.gz']);
 const added = model.save({ name: 'report', source: 'echo one\r\necho two' }, null, data);
 assert.deepEqual(added.ops, [{ op: 'add', config: 'routerdeck', type: 'script', name: 'report', values: { source: 'echo one\necho two' } }]);
 rejects(() => model.save({ name: 'backup', source: 'true' }, null, data), 'name');
 rejects(() => model.save({ name: 'bad-name', source: 'true' }, null, data), 'name');
 rejects(() => model.save({ name: 'x', source: '  \n' }, null, data), 'source');
 assert.deepEqual(model.save({ ...model.values(row, data), source: 'true' }, row, data).ops, [{ op: 'set', config: 'routerdeck', section: 'backup', values: { source: 'true' } }]);
 assert.deepEqual(model.tools[0].run([row]), { job: { title: 'Script backup', task: { tool: 'script', name: 'backup' } } });
 assert.match(model.fields(data, row).find(field => field.id === 'how').value({ name: 'backup' }), new RegExp(`${RUN_SCRIPT} backup$`));
});

test('running jobs list scripts and package operations with their age', () => {
 const model = MODELS['system-script-jobs'];
 const rows = model.rows({ jobs: { now: 1000, jobs: [
  { id: 'a', tool: 'script', name: 'backup', started: 940 }, { id: 'b', tool: 'package', operation: 'install', names: ['nano'], started: 990 }, { id: 'c', tool: 'ping', host: '192.0.2.1', started: 999 }
 ] } });
 assert.deepEqual(rows.map(row => [row.key, row.cells.what, row.cells.running]), [['a', 'script backup', '00:01:00'], ['b', 'install nano', '00:00:10']]);
 const stop = model.tools.find(tool => tool.id === 'stop');
 assert.equal(stop.enabled(rows), false);
 assert.deepEqual(stop.run(rows.slice(0, 1)).calls, [['routerdeck', 'task', { action: 'stop', id: 'a' }]]);
});

test('restore and firmware upload, check and ask before anything changes', () => {
 const restore = MODELS['system-backup'].tools.find(tool => tool.id === 'restore').run([], {});
 assert.equal(restore.upload.path, '/tmp/routerdeck-backup.tar.gz');
 assert.deepEqual(restore.check, ['routerdeck', 'restore', { action: 'check' }]);
 assert.match(restore.confirm({ count: 41 }).text, /^Restore 41 files from this backup and reboot\?/);
 assert.deepEqual(restore.cancel, ['routerdeck', 'restore', { action: 'discard' }]);
 const flash = MODELS['system-firmware'].save({ keep: false });
 assert.equal(flash.reject({ valid: false, tests: { fwtool_signature: true, fwtool_device_match: false } }), 'The router rejected this image (failed: fwtool_device_match); it was not flashed');
 assert.equal(flash.reject({ valid: true }), null);
 assert.deepEqual(flash.call, ['routerdeck', 'firmware', { action: 'flash', keep: false }]);
 assert.match(firmwareQuestion({ size: 8 * 1024 * 1024, sha256: 'ab'.repeat(32), allow_backup: true }, true).text, /\(8\.0 MiB, SHA-256 abababababababab…\)\. Flash it and keep the settings\?/);
 assert.match(firmwareQuestion({ allow_backup: false }, true).text, /erase the settings/);
});

test('file listings: directories first, links, sizes and permissions; paths', () => {
 const rows = fileRows({ entries: [
  { name: 'shadow', type: 'file', size: 512, mtime: 0, mode: 0o600 },
  { name: 'config', type: 'directory', size: 4096, mtime: 0, mode: 0o755 },
  { name: 'localtime', type: 'link', link: '/tmp/localtime', target: 'file', size: 14, mode: 0o777 },
  { name: 'gone', type: 'link', link: '/nowhere', target: null, mode: 0o777 }
 ] });
 assert.deepEqual(rows.map(row => [row.key, row.cells.type, row.cells.size, row.cells.mode, row.directory, row.file]), [
  ['config', 'directory', '', 'rwxr-xr-x', true, false], ['gone', 'link to nothing', '', 'rwxrwxrwx', false, false],
  ['localtime', 'link to file', '14 B', 'rwxrwxrwx', false, true], ['shadow', 'file', '512 B', 'rw-------', false, true]
 ]);
 assert.equal(rows.find(row => row.key === 'localtime').cells.name, 'localtime → /tmp/localtime');
 assert.equal(normalPath(' /etc//config/./../config/ '), '/etc/config');
 assert.equal(normalPath('etc'), null);
 assert.equal(normalPath('/..'), '/');
 assert.equal(parentPath('/etc/config'), '/etc');
 assert.equal(parentPath('/etc'), '/');
 assert.equal(joinPath('/', 'tmp'), '/tmp');
 assert.equal(permissions(0o4755), 'rwxr-xr-x');
});

test('the command line streams scripts and package operations', async () => {
 const lines = [], started = [];
 const results = { script: [{ line: 'hello' }, { exit: 0 }], package: [{ command: 'apk add nano' }, { line: 'Installing nano' }, { exit: 1 }] };
 const cli = createCli({
  load: async () => ({ ...packageData(), 'uci:routerdeck': { hello: { '.type': 'script', '.name': 'hello', '.index': 0, source: 'echo hello' } } }),
  apply: async change => started.push(change),
  undo: async () => {}, redo: async () => {},
  createJob: (onUpdate, options) => ({ start: async task => { started.push({ ...task, method: options?.method }); onUpdate({ results: results[task.tool], running: false, error: null }); }, stop() {} }),
  out: { line: text => lines.push(text), live: () => ({ update() {}, end() {} }) },
  identity: () => 'OpenWrt'
 });
 await cli.run('/system script run hello');
 await cli.run('/system package install nano');
 await cli.run('/system package uninstall libpcap1');
 assert.deepEqual(started.map(item => [item.tool, item.method, item.name ?? item.names?.join(' ')]), [['script', 'task', 'hello'], ['package', 'task', 'nano'], ['package', 'task', 'libpcap1']]);
 assert.deepEqual(lines, ['hello', 'Installing nano', 'failure: exited with code 1', 'Installing nano', 'failure: exited with code 1']);
});
