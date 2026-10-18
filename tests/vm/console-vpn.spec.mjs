// Tunnels, a bond, an L2TP client, the PPPoE server, OpenVPN and IPsec
// against a real guest with gre, vxlan, proto-bonding, kmod-dummy, xl2tpd,
// rp-pppoe-server, openvpn and strongSwan installed. Each check skips
// without its package and undoes its changes.
import { test, expect } from '@playwright/test';
import { readFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ssh = (command, input) => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
const probe = command => { try { return ssh(command); } catch { return ''; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();
const has = path => probe(`[ -x ${path} ] && echo yes`) === 'yes';
const proto = name => probe('ubus call network get_proto_handlers').includes(`"${name}"`);

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ has: scope.page().getByRole('gridcell', { name: text, exact: true }) });
const add = scope => scope.getByRole('button', { name: 'Add', exact: true }).click();
const tab = (scope, name) => scope.getByRole('tab', { name, exact: true }).click();
const undo = page => page.getByRole('button', { name: 'Undo' }).click();
const files = 'sha256sum /etc/config/network /etc/config/firewall /etc/config/pppoe /etc/config/openvpn /etc/config/ipsec /etc/ppp/chap-secrets 2>/dev/null; true';
let before;
test.beforeAll(() => { before = ssh(files); });
test.afterAll(() => expect(ssh(files)).toBe(before));

test.beforeEach(async ({ page }) => {
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 page.consoleErrors = errors;
 await page.goto('/routerdeck/');
 await page.evaluate(() => localStorage.clear());
 await page.getByLabel('Password', { exact: true }).fill(password);
 await page.getByRole('button', { name: 'Connect' }).click();
 await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
});
test.afterEach(async ({ page }) => expect(page.consoleErrors ?? []).toEqual([]));

async function interfaces(page, name) {
 await page.getByRole('menuitem', { name: 'Interfaces', exact: true }).click();
 const list = win(page, 'Interface List');
 await tab(list, name);
 return list;
}

test('GRE and VXLAN tunnels reach the kernel with their addresses', async ({ page }) => {
 test.skip(!proto('gre') || !proto('vxlan'), 'netifd has no gre or vxlan protocol (install gre and vxlan, then restart the network)');
 const list = await interfaces(page, 'Tunnels');
 await add(list);
 const gre = win(page, 'New Tunnel');
 await gre.getByLabel('Name:').fill('rdgre');
 await gre.getByLabel('Remote Address:').fill('192.0.2.99');
 await gre.getByLabel('Key:').fill('77');
 await gre.getByLabel('Tunnel Address:').fill('10.255.9.1/30');
 await gre.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('ip addr show gre4-rdgre 2>&1'), { timeout: 20000 }).toContain('inet 10.255.9.1/30');
 expect(probe('ip -d link show gre4-rdgre')).toMatch(/ikey 0\.0\.0\.77|key 77|ikey 77/);
 await add(list);
 const vxlan = win(page, 'New Tunnel');
 await vxlan.getByLabel('Name:').fill('rdvx');
 await vxlan.getByLabel('Type:').selectOption('vxlan');
 await vxlan.getByLabel('Remote Address:').fill('192.0.2.98');
 await vxlan.getByLabel('VNI:').fill('99');
 await vxlan.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('ip -d link show rdvx 2>&1'), { timeout: 20000 }).toMatch(/vxlan/);
 // ip-tiny shows the device kind, not its VNI; the configuration holds it.
 expect(ssh('uci get network.rdvx.vid')).toBe('99');
 await expect(row(list, 'rdgre').locator('.is-flags')).toHaveText('R', { timeout: 10000 });
 await undo(page);
 await undo(page);
 await expect.poll(() => probe('ip link show gre4-rdgre 2>&1; ip link show rdvx 2>&1'), { timeout: 20000 }).not.toMatch(/^\d+: (gre4-rdgre|rdvx)/m);
});

test('a bond enslaves its devices in the kernel', async ({ page }) => {
 test.skip(!proto('bonding'), 'netifd has no bonding protocol (install proto-bonding and kmod-bonding)');
 test.skip(probe('ip link add rddum0 type dummy && ip link add rddum1 type dummy && echo yes') !== 'yes', 'kmod-dummy is not installed');
 try {
  const list = await interfaces(page, 'Bonding');
  await add(list);
  const bond = win(page, 'New Bond');
  await bond.getByLabel('Name:').fill('rdbond');
  await bond.getByRole('group', { name: 'Slaves:' }).getByLabel('rddum0').check();
  await bond.getByRole('group', { name: 'Slaves:' }).getByLabel('rddum1').check();
  await bond.getByLabel('Mode:').selectOption('balance-xor');
  await bond.getByLabel('Address:').fill('10.254.9.1/24');
  await bond.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => probe('cat /proc/net/bonding/bond-rdbond 2>&1'), { timeout: 20000 }).toMatch(/Slave Interface: rddum0[\s\S]*Slave Interface: rddum1/);
  expect(probe('cat /proc/net/bonding/bond-rdbond')).toContain('Bonding Mode: load balancing (xor)');
  await expect.poll(() => probe('ip addr show bond-rdbond'), { timeout: 10000 }).toContain('inet 10.254.9.1/24');
  await undo(page);
  await expect.poll(() => probe('[ -e /proc/net/bonding/bond-rdbond ] && echo present || echo gone'), { timeout: 20000 }).toBe('gone');
 } finally {
  probe('ip link del rddum0; ip link del rddum1; true');
 }
});

test('an L2TP client starts xl2tpd; a PPPoE server runs with the console options', async ({ page }) => {
 test.skip(!proto('l2tp') || !has('/usr/sbin/pppoe-server'), 'xl2tpd or rp-pppoe-server is not installed');
 const dialed = () => Number(probe('logread | grep -c "xl2tpd.*Connecting to host 192.0.2.97" || true') || 0);
 const dialedBefore = dialed();
 await page.getByRole('menuitem', { name: 'PPP', exact: true }).click();
 const ppp = win(page, 'PPP');
 await add(ppp);
 const client = win(page, 'New PPP Client');
 await client.getByLabel('Name:', { exact: true }).fill('rdl2tp');
 await client.getByLabel('Type:').selectOption('l2tp');
 await client.getByLabel('Server:').fill('192.0.2.97');
 await client.getByLabel('User:').fill('rduser');
 await client.getByLabel('Firewall Zone:').selectOption('');
 await client.getByRole('button', { name: 'OK' }).click();
 // xl2tpd is a service of its own; netifd hands it the new connection.
 await expect.poll(dialed, { timeout: 20000 }).toBeGreaterThan(dialedBefore);
 await expect.poll(() => probe('ifstatus rdl2tp'), { timeout: 10000 }).toContain('"proto": "l2tp"');

 await tab(ppp, 'Secrets');
 await add(ppp);
 const secret = win(page, 'New PPP Secret');
 await secret.getByLabel('Name:').fill('rdclient');
 await secret.getByLabel('Password:').fill('rd-ppp-pass');
 await secret.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('cat /etc/ppp/chap-secrets')).toContain('rdclient * rd-ppp-pass *');
 expect(ssh('ls -l /etc/ppp/chap-secrets | cut -c1-10')).toBe('-rw-------');
 expect(ssh('cat /etc/ppp/pap-secrets')).toBe(ssh('cat /etc/ppp/chap-secrets'));

 await tab(ppp, 'PPPoE Servers');
 await add(ppp);
 const server = win(page, 'New PPPoE Server');
 await server.getByLabel('Interface:').selectOption('lan');
 await server.getByRole('textbox', { name: 'Service Names:' }).fill('rdtest');
 await server.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe("pgrep -fa '^/usr/sbin/pppoe-server' || echo none"), { timeout: 20000 }).toMatch(/-S rdtest -I br-lan .*-O \/etc\/ppp\/pppoe-server-routerdeck/);
 expect(ssh('cat /etc/ppp/pppoe-server-routerdeck')).toContain('require-chap');
 for (let step = 0; step < 3; step++) await undo(page);
 await expect.poll(() => probe("pgrep -f '^/usr/sbin/pppoe-server' || echo none"), { timeout: 20000 }).toBe('none');
 expect(probe('ifstatus rdl2tp >/dev/null 2>&1 && echo present || echo gone')).toBe('gone');
 // The options file stays (empty), as Undo writes back an empty file.
 probe('[ -s /etc/ppp/pppoe-server-routerdeck ] || rm -f /etc/ppp/pppoe-server-routerdeck');
});

test('an OpenVPN server and a client on the router connect to each other', async ({ page }) => {
 test.setTimeout(120000);
 test.skip(!has('/usr/sbin/openvpn'), 'openvpn is not installed');
 const dir = await mkdtemp(join(tmpdir(), 'rdovpn-'));
 const openssl = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
 openssl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '30', '-subj', '/CN=rd-ca', '-keyout', 'ca.key', '-out', 'ca.crt');
 for (const [name, usage] of [['server', 'serverAuth'], ['client', 'clientAuth']]) {
  openssl('req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', `/CN=rd-${name}`, '-keyout', `${name}.key`, '-out', `${name}.csr`);
  execFileSync('sh', ['-c', `printf 'extendedKeyUsage=${usage}\\nkeyUsage=digitalSignature,keyAgreement\\n' > ${name}.ext && openssl x509 -req -in ${name}.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 30 -extfile ${name}.ext -out ${name}.crt`], { cwd: dir, stdio: 'ignore' });
 }
 ssh('mkdir -p /etc/openvpn/rdtest');
 for (const file of ['ca.crt', 'server.crt', 'server.key', 'client.crt', 'client.key']) ssh(`cat > /etc/openvpn/rdtest/${file}`, await readFile(join(dir, file), 'utf8'));
 try {
  const list = await interfaces(page, 'OpenVPN');
  for (const [name, role] of [['rdsrv', 'server'], ['rdcli', 'client']]) {
   await add(list);
   const form = win(page, 'New OpenVPN Instance');
   await form.getByLabel('Name:').fill(name);
   await form.getByLabel('Role:').selectOption(role);
   if (role === 'server') await form.getByLabel('Client Subnet:').fill('10.98.0.0/24');
   else await form.getByRole('textbox', { name: 'Remote:' }).fill('127.0.0.1 11940');
   await form.getByLabel('Port:').fill(role === 'server' ? '11940' : '');
   await tab(form, 'Keys');
   await form.getByLabel('CA Certificate:').fill('/etc/openvpn/rdtest/ca.crt');
   await form.getByLabel('Certificate:', { exact: true }).fill(`/etc/openvpn/rdtest/${role}.crt`);
   await form.getByLabel('Key:', { exact: true }).fill(`/etc/openvpn/rdtest/${role}.key`);
   await form.getByRole('button', { name: 'OK' }).click();
   await expect(row(list, name)).toBeVisible();
  }
  // The client got its address from the server, so TLS and the push worked.
  await expect.poll(() => probe('ip addr show tun_rdcli 2>&1'), { timeout: 60000, intervals: [2000] }).toMatch(/inet 10\.98\.0\.\d+/);
  await expect(row(list, 'rdsrv').locator('.is-flags')).toHaveText('R');
  await expect(row(list, 'rdcli').locator('.is-flags')).toHaveText('R');
  await undo(page);
  await undo(page);
  await expect.poll(() => probe("pgrep -f '^/usr/sbin/openvpn.*rd(srv|cli)' || echo none"), { timeout: 20000 }).toBe('none');
 } finally {
  probe('rm -rf /etc/openvpn/rdtest');
 }
});

test('an IPsec peer, policy and proposal become a swanctl connection', async ({ page }) => {
 test.skip(!has('/usr/sbin/swanctl'), 'strongSwan (swanctl) is not installed');
 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: 'IPsec', exact: true }).click();
 const ipsec = win(page, 'IPsec');
 await tab(ipsec, 'Proposals');
 await add(ipsec);
 const proposal = win(page, 'New IPsec Proposal');
 await proposal.getByLabel('Name:').fill('rdprop');
 await proposal.getByRole('button', { name: 'OK' }).click();
 await tab(ipsec, 'Peers');
 await add(ipsec);
 const peer = win(page, 'New IPsec Peer');
 await peer.getByLabel('Name:').fill('rdpeer');
 await peer.getByLabel('Address:', { exact: true }).fill('192.0.2.77');
 await peer.getByLabel('Secret:').fill('rd-ipsec-secret');
 await tab(peer, 'Advanced');
 await peer.getByRole('group', { name: 'IKE Proposals:' }).getByLabel('rdprop').check();
 await peer.getByRole('button', { name: 'OK' }).click();
 await tab(ipsec, 'Policies');
 await add(ipsec);
 const policy = win(page, 'New IPsec Policy');
 await policy.getByLabel('Name:').fill('rdpol');
 await policy.getByLabel('Peer:').selectOption('rdpeer');
 await policy.getByRole('textbox', { name: 'Src. Address:' }).fill('10.91.0.0/24');
 await policy.getByRole('textbox', { name: 'Dst. Address:' }).fill('10.92.0.0/24');
 await policy.getByRole('group', { name: 'ESP Proposals:' }).getByLabel('rdprop').check();
 await policy.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('swanctl --list-conns 2>&1'), { timeout: 30000 }).toMatch(/rdpeer: IKEv2[\s\S]*rdpol: TUNNEL[\s\S]*local:\s+10\.91\.0\.0\/24[\s\S]*remote:\s+10\.92\.0\.0\/24/);
 expect(probe('swanctl --list-pols 2>&1')).toContain('rdpol');
 for (let step = 0; step < 3; step++) await undo(page);
 await expect.poll(() => probe('swanctl --list-conns 2>&1'), { timeout: 30000 }).not.toContain('rdpeer');
});
