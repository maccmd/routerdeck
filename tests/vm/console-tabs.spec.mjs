// New tabs and lists against a real guest: address lists in nftables,
// WireGuard keys and peers in the kernel, policy rules in `ip rule`, DHCP
// options in dnsmasq's configuration, a service port and the ARP table.
// Every change is undone or removed again.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8' }).trim();
const probe = command => { try { return ssh(command); } catch { return ''; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Tab checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ hasText: text });
const lan = ssh('uci get network.lan.ipaddr').split('/')[0];
const prefix = lan.split('.').slice(0, 3).join('.');
// ttyd is optional, so its file may be missing.
const configs = 'sha256sum /etc/config/network /etc/config/firewall /etc/config/dhcp /etc/config/ttyd 2>/dev/null; true';
let before;
// QEMU answers DHCP on the LAN itself, so dnsmasq refuses to serve it
// unless forced; the DHCP option check needs dnsmasq's configuration.
test.beforeAll(() => {
 ssh("uci set dhcp.lan.force='1'; uci commit dhcp; /etc/init.d/dnsmasq reload");
 before = ssh(configs);
});
test.afterAll(() => {
 expect(ssh(configs)).toBe(before);
 ssh('uci -q delete dhcp.lan.force; uci commit dhcp; /etc/init.d/dnsmasq reload');
});

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

async function open(page, ...labels) {
 for (const label of labels) await page.getByRole('menuitem', { name: label, exact: true }).click();
}
const undo = page => page.getByRole('button', { name: 'Undo' }).click();

test('an address list becomes an nftables set', async ({ page }) => {
 await open(page, 'IP', 'Firewall');
 const firewall = win(page, 'Firewall');
 await firewall.getByRole('tab', { name: 'Address Lists' }).click();
 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 const entry = win(page, 'New Address List Entry');
 await entry.getByLabel('List:').fill('rdlist');
 await entry.getByLabel('Address:').fill('192.0.2.0/25');
 await entry.getByRole('button', { name: 'OK' }).click();
 await expect(row(firewall, '192.0.2.0/25')).toContainText('rdlist');
 await expect.poll(() => probe('nft list set inet fw4 rdlist'), { timeout: 15000 }).toContain('192.0.2.0/25');
 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 await win(page, 'New Address List Entry').getByLabel('List:').fill('rdlist');
 await win(page, 'New Address List Entry').getByLabel('Address:').fill('198.51.100.7');
 await win(page, 'New Address List Entry').getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('nft list set inet fw4 rdlist'), { timeout: 15000 }).toContain('198.51.100.7');
 // fw4 reload alone would keep a removed address in the set.
 await row(firewall, '192.0.2.0/25').click();
 await page.keyboard.press('Delete');
 await expect.poll(() => probe('nft list set inet fw4 rdlist'), { timeout: 15000 }).not.toContain('192.0.2.0/25');
 expect(probe('nft list set inet fw4 rdlist')).toContain('198.51.100.7');
 for (let step = 0; step < 3; step++) await undo(page);
 await expect.poll(() => probe('nft list set inet fw4 rdlist 2>&1'), { timeout: 15000 }).not.toContain('198.51.100.7');
});

test('a WireGuard interface gets a key made on the router, and a peer', async ({ page }) => {
 test.skip(!probe('[ -x /usr/bin/wg ] && echo yes'), 'wireguard-tools is not installed');
 test.skip(!probe('ubus call network get_proto_handlers | grep -c wireguard || true').match(/^[1-9]/), 'netifd has not loaded WireGuard (restart the network after installing it)');
 const peerKey = ssh('wg genkey | wg pubkey');
 await open(page, 'Interfaces');
 const list = win(page, 'Interface List');
 await list.getByRole('tab', { name: 'WireGuard', exact: true }).click();
 await list.getByRole('button', { name: 'Add', exact: true }).click();
 const wg = win(page, 'New WireGuard Interface');
 await wg.getByLabel('Name:').fill('rdwg');
 await wg.getByLabel('Listen Port:').fill('51899');
 await wg.getByLabel('Addresses:').fill('10.199.0.1/24');
 await wg.getByLabel('Firewall Zone:').selectOption('');
 await wg.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('wg show rdwg public-key'), { timeout: 20000 }).toMatch(/^[A-Za-z0-9+/]{43}=$/);
 expect(ssh('uci get network.rdwg.private_key')).toMatch(/^[A-Za-z0-9+/]{43}=$/);
 await expect(row(list, 'rdwg')).toContainText(ssh('wg show rdwg public-key'));

 await list.getByRole('tab', { name: 'WireGuard Peers' }).click();
 await list.getByRole('button', { name: 'Add', exact: true }).click();
 const peer = win(page, 'New WireGuard Peer');
 await peer.getByLabel('Interface:').selectOption('rdwg');
 await peer.getByLabel('Name:').fill('rdpeer');
 await peer.getByLabel('Public Key:').fill(peerKey);
 await peer.getByLabel('Allowed Address:').fill('10.199.0.2/32');
 await peer.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('wg show rdwg allowed-ips'), { timeout: 20000 }).toContain(`${peerKey}\t10.199.0.2/32`);

 await list.getByRole('tab', { name: 'WireGuard', exact: true }).click();
 await row(list, 'rdwg').click();
 await page.keyboard.press('Delete');
 await expect.poll(() => probe('ip link show rdwg 2>&1 || true'), { timeout: 20000 }).toContain('does not exist');
 expect(ssh('uci show network | grep -c wireguard_rdwg || true')).toBe('0');
});

test('a routing rule reaches ip rule; DHCP gateway reaches dnsmasq', async ({ page }) => {
 await open(page, 'Routing', 'Rules');
 const rules = win(page, 'Routing Rules');
 await rules.getByRole('button', { name: 'Add', exact: true }).click();
 const rule = win(page, 'New Routing Rule');
 await rule.getByLabel('Priority:').fill('1199');
 await rule.getByLabel('Src. Address:').fill('10.199.0.0/16');
 await rule.getByLabel('Table:').fill('199');
 await rule.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => ssh('ip rule'), { timeout: 15000 }).toContain('1199:\tfrom 10.199.0.0/16 lookup 199');
 await expect(row(rules, '10.199.0.0/16').locator('.is-flags')).toHaveText('A');
 await undo(page);
 await expect.poll(() => ssh('ip rule'), { timeout: 15000 }).not.toContain('10.199.0.0/16');

 await open(page, 'IP', 'DHCP Server');
 const dhcp = win(page, 'DHCP Server');
 await dhcp.getByRole('tab', { name: 'Networks' }).click();
 await row(dhcp, `${prefix}.0/24`).dblclick();
 const network = win(page, `DHCP Network <${prefix}.0/24>`);
 await network.getByLabel('Gateway:').fill(`${prefix}.254`);
 await network.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => ssh('cat /var/etc/dnsmasq.conf.*'), { timeout: 15000 }).toContain(`dhcp-option=lan,3,${prefix}.254`);
 await undo(page);
 await expect.poll(() => ssh('cat /var/etc/dnsmasq.conf.*'), { timeout: 15000 }).not.toContain(`${prefix}.254`);
});

test('ARP shows the console host; a ttyd port change reaches ttyd', async ({ page }) => {
 await open(page, 'IP', 'ARP');
 const arp = win(page, 'ARP List');
 const host = arp.locator('.rd-grid-row').filter({ has: page.getByRole('gridcell', { name: `${prefix}.2`, exact: true }) });
 await expect(host).toContainText(':');
 await expect(host.locator('.is-flags')).toHaveText(/^DC/);

 test.skip(!probe('uci -q get ttyd.@ttyd[0].command'), 'ttyd is not installed in this guest');
 await open(page, 'IP', 'Services');
 const services = win(page, 'IP Service List');
 await row(services, 'ttyd').dblclick();
 const ttyd = win(page, 'Service <ttyd>');
 await ttyd.getByLabel('Port:').fill('7682');
 await ttyd.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('netstat -ltn | grep -c ":7682 " || true'), { timeout: 20000 }).not.toBe('0');
 await undo(page);
 await expect.poll(() => probe('netstat -ltn | grep -c ":7681 " || true'), { timeout: 20000 }).not.toBe('0');
});
