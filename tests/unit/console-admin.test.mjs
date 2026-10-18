// Users, certificates, LEDs and disks; the hashes and X.509 parsing behind them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { MODELS } from '../../console/src/model/index.js';
import { ValidationError } from '../../console/src/model/common.js';
import { sha256, sha512, sha512crypt, hex, randomSalt, SALT } from '../../console/src/lib/crypt.js';
import { parseCertificates, fromBase64 } from '../../console/src/lib/x509.js';
import { diskRows } from '../../console/src/model/admin.js';

const rejects = (fn, field) => assert.throws(fn, error => error instanceof ValidationError && error.field === field);
const certificates = JSON.parse(await readFile(new URL('../fixtures/openwrt-25.12/certificates.json', import.meta.url), 'utf8'));

test('SHA-256 and SHA-512 match node:crypto for every padding case', () => {
 for (const length of [0, 1, 55, 56, 63, 64, 111, 112, 127, 128, 1000]) {
  const data = randomBytes(length);
  assert.equal(hex(sha256(data)), createHash('sha256').update(data).digest('hex'));
  assert.equal(hex(sha512(data)), createHash('sha512').update(data).digest('hex'));
 }
});

test('SHA-512-crypt matches crypt(3) and OpenSSL', () => {
 // The example of the SHA-crypt specification, then `openssl passwd -6`.
 assert.equal(sha512crypt('Hello world!', 'saltstring'), '$6$saltstring$svn8UoSVapNtMuq1ukKS4tPQd8iKwSMHWjl/O817G3uBnIFNjnQJuesI68u4OTLiBFdcbYEdFCoEOfaS35inz1');
 assert.equal(sha512crypt('correct horse battery staple', 'rdsalt1234567890'), '$6$rdsalt1234567890$DUTEC1arpNLsq6jXu3gbPn1vtknrF.6yOXLrHyzBB0gecckMSvfx7MXTW1f4S6Oweh67UDQCv0etLf98.b8zZ1');
 assert.equal(sha512crypt('x'.repeat(100), 'ab'), '$6$ab$Dl9IhjoQKEbFzT0mHUojnmKfO/iaqCONKYMJae6A6BamPi8p5W8x7BIsEQTkgeX2qGN0TnWVc1L7jgOlphKFW.');
 assert.equal(sha512crypt('пароль', 'Zz.9/'), '$6$Zz.9/$yg8FfJBxpIlU6FVvyGQaYv8ul09XE01IMvzaA9QJh1fwO1704TVwBi6bewVCPW1qio.FlCC/a5ZVhcuOJJp6/0');
 assert.throws(() => sha512crypt('x', 'bad$salt'));
 assert.match(randomSalt(), SALT);
 assert.equal(randomSalt(length => new Uint8Array(length).fill(1)), '/'.repeat(16));
});

test('X.509: uhttpd DER and a PEM bundle, as openssl x509 shows them', () => {
 const [web] = parseCertificates(fromBase64(certificates.web));
 assert.deepEqual({ ...web, notBefore: undefined }, {
  serial: '7c0901ec8e648ec3', subject: 'C=ZZ, ST=Somewhere, L=Unknown, O=OpenWrt410daaec, CN=OpenWrt', issuer: 'C=ZZ, ST=Somewhere, L=Unknown, O=OpenWrt410daaec, CN=OpenWrt',
  commonName: 'OpenWrt', organization: 'OpenWrt410daaec', name: 'OpenWrt', issuerName: 'OpenWrt', notBefore: undefined, notAfter: Date.UTC(2027, 10, 17, 9, 58, 2) / 1000,
  keyType: 'EC', keySize: 'P-256', names: ['OpenWrt'], authority: false, selfSigned: true, fingerprint: 'cb35875441a582db57060f38cc7fd7b4b66e6104d78cdf0bdbff6958a0de832c'
 });
 const trusted = parseCertificates(fromBase64(certificates.trusted));
 assert.deepEqual(trusted.map(cert => [cert.name, cert.keyType, cert.keySize, cert.authority]), [
  ['ACCVRAIZ1', 'RSA', 4096, true], ['AC RAIZ FNMT-RCM SERVIDORES SEGUROS', 'EC', 'P-384', true], ['AC RAIZ FNMT-RCM', 'RSA', 4096, true]
 ]);
 assert.equal(trusted[0].fingerprint, '9a6ec012e1a7da9dbe34194d478ad7c0db1822fb071df12981496ed104384113');
});

test('users map groups to rpcd ACL lists and store a SHA-512 hash', () => {
 const model = MODELS.users;
 const data = { users: { current: 'root', groups: { 'luci-base': 'Basic LuCI' }, accounts: [{ name: 'root' }, { name: 'daemon' }], logins: [
  { section: 'cfg02f8be', username: 'root', password: 'system:root', read: ['*'], write: ['*'] },
  { section: 'cfg03', username: 'noc', password: 'hash', read: ['luci-base'], write: [], comment: 'NOC' }
 ] } };
 const rows = model.rows(data);
 assert.deepEqual(rows.map(row => [row.cells.name, row.flags, row.cells.group, row.cells.password, row.cells.acl]), [['root', 'C', 'full', 'system account root', ''], ['noc', '', 'custom', 'own password', 'luci-base (read)']]);
 const added = model.save({ ...model.defaults(), name: 'ops', group: 'read', password: 'Hello world!', confirm: 'Hello world!' }, null, data, { salt: 'saltstring' });
 assert.deepEqual(added.ops, [{ op: 'add', config: 'rpcd', type: 'login', values: { username: 'ops', read: ['*'], write: [], password: '$6$saltstring$svn8UoSVapNtMuq1ukKS4tPQd8iKwSMHWjl/O817G3uBnIFNjnQJuesI68u4OTLiBFdcbYEdFCoEOfaS35inz1' } }]);
 // An unchanged password stays as it is.
 assert.deepEqual(model.save({ ...model.values(rows[1]), group: 'full' }, rows[1], data).ops[0].values, { username: 'noc', read: ['*'], write: ['*'] });
 assert.equal(model.save({ ...model.values(rows[1]), source: 'system', account: 'daemon' }, rows[1], data).ops[0].values.password, '$p$daemon');
 rejects(() => model.save({ ...model.defaults(), name: 'root', password: 'a', confirm: 'a' }, null, data), 'name');
 rejects(() => model.save({ ...model.defaults(), name: 'x y', password: 'a', confirm: 'a' }, null, data), 'name');
 rejects(() => model.save({ ...model.defaults(), name: 'ops', password: '' }, null, data), 'password');
 rejects(() => model.save({ ...model.defaults(), name: 'ops', password: 'a', confirm: 'b' }, null, data), 'confirm');
 rejects(() => model.save({ ...model.defaults(), name: 'ops', group: 'custom', password: 'a', confirm: 'a' }, null, data), 'read');
 rejects(() => model.save({ ...model.values(rows[0]), group: 'read' }, rows[0], data), 'group');
 assert.match(model.removeBlocked([rows[0]], data), /logged in as root/);
 assert.equal(model.removeBlocked([rows[1]], data), null);
});

test('LEDs: configured sections, board LEDs to set up, trigger options', () => {
 const model = MODELS['system-leds'];
 const data = {
  'uci:system': { led_lan: { '.type': 'led', '.name': 'led_lan', '.index': 0, name: 'LAN', sysfs: 'green:lan', trigger: 'netdev', dev: 'br-lan', mode: 'link tx' } },
  leds: { leds: [{ name: 'green:lan', brightness: 1, triggers: ['none', 'netdev', 'mmc0'] }, { name: 'red:sys', brightness: 0, trigger: 'heartbeat', triggers: ['none', 'heartbeat'] }] },
  devices: { 'br-lan': {}, eth0: {} }
 };
 const rows = model.rows(data);
 assert.deepEqual(rows.map(row => [row.key, row.flags, row.cells.detail]), [['led_lan', 'R', 'br-lan link+tx'], ['sysfs:red:sys', 'D', '']]);
 const setup = model.save({ ...model.values(rows[1], data), name: 'System' }, rows[1], data);
 assert.deepEqual(setup.ops, [{ op: 'add', config: 'system', type: 'led', values: { name: 'System', sysfs: 'red:sys', trigger: 'heartbeat' } }]);
 const trigger = model.fields(data).find(field => field.id === 'trigger');
 assert.deepEqual(trigger.options({ sysfs: 'green:lan' }).map(option => option.value), ['none', 'default-on', 'timer', 'heartbeat', 'netdev', 'mmc0']);
 rejects(() => model.save({ ...model.values(rows[0], data), trigger: 'timer', delayon: 'x' }, rows[0], data), 'delayon');
});

const disks = {
 block: true,
 devices: [{ name: 'sda', size: 32e9, removable: true, vendor: 'Generic', model: 'Flash Drive', partitions: [{ name: 'sda1', size: 31e9 }] }, { name: 'vda', size: 109051904, partitions: [] }],
 filesystems: { '/dev/sda1': { type: 'ext4', label: 'usb', uuid: 'aaaa-bbbb' }, '/dev/vda': { type: 'ext4', label: 'rootfs', uuid: 'ffff' } },
 mounts: [{ source: '/dev/root', target: '/', fstype: 'ext4' }, { source: '/dev/sda1', target: '/mnt/usb', fstype: 'ext4' }],
 usage: { '/': { size: 100 * 1024 * 1024, used: 30 * 1024 * 1024 }, '/mnt/usb': { size: 2 ** 30, used: 2 ** 29 } }
};

test('disks list partitions with their file systems; only data mounts unmount', () => {
 const rows = diskRows(disks);
 assert.deepEqual(rows.map(row => [row.key, row.flags, row.cells.mounted, row.cells.use, row.cells.model]), [
  ['sda', 'R', '', '', 'Generic Flash Drive'], ['sda1', 'MR', '/mnt/usb', '512.0 MiB of 1.0 GiB', ''], ['vda', 'M', '/', '30.0 MiB of 100.0 MiB', '']
 ]);
 const unmount = MODELS.disks.tools.find(tool => tool.id === 'unmount');
 assert.equal(unmount.enabled([rows[2]]), false);
 assert.deepEqual(unmount.run([rows[1]]).calls, [['routerdeck', 'unmount', { target: '/mnt/usb' }]]);
});

test('mount points name file systems by UUID and refuse system paths', () => {
 const model = MODELS['disk-mounts'];
 const data = { disks, 'uci:fstab': { global: { '.type': 'global', '.name': 'global', '.index': 0 }, m1: { '.type': 'mount', '.name': 'm1', '.index': 1, target: '/mnt/usb', uuid: 'aaaa-bbbb', enabled: '1' } } };
 const [row] = model.rows(data);
 assert.deepEqual([row.flags, row.cells.source], ['M', 'uuid aaaa-bbbb']);
 assert.deepEqual(model.save({ source: 'uuid:aaaa-bbbb', target: '/mnt/data', fstype: 'ext4', options: 'rw,noatime', check: true }, null, data).ops,
  [{ op: 'add', config: 'fstab', type: 'mount', values: { uuid: 'aaaa-bbbb', target: '/mnt/data', fstype: 'ext4', options: 'rw,noatime', enabled_fsck: '1', enabled: '1' } }]);
 rejects(() => model.save({ source: 'uuid:aaaa-bbbb', target: '/tmp' }, null, data), 'target');
 rejects(() => model.save({ source: 'uuid:aaaa-bbbb', target: '/mnt/usb' }, null, data), 'target');
 rejects(() => model.save({ source: 'uuid:aaaa-bbbb', target: '/mnt/x', options: 'rw;reboot' }, null, data), 'options');
 assert.deepEqual(model.toggle([row], false).ops, [{ op: 'set', config: 'fstab', section: 'm1', values: { enabled: '0' } }]);
});
