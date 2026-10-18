// IP Settings in the kernel, FastPath, mangle and raw rules in nftables,
// advanced DNS options and a pool in dnsmasq, and WiFi roaming and the
// access list in hostapd (where the guest has hwsim radios). Every change is
// undone, and the files are compared before and after.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ssh = command => execFileSync('sh', ['scripts/vm-ssh.sh', command], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
const probe = command => { try { return ssh(command); } catch { return ''; } };
const password = (await readFile('.cache/vm/password', 'utf8')).trim();

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName, viewport }) => browserName !== 'chromium' || viewport.width !== 1440, 'Checks run once');

const win = (page, title) => page.getByRole('dialog', { name: title, exact: true });
const row = (scope, text) => scope.locator('.rd-grid-row').filter({ has: scope.page().getByRole('gridcell', { name: text, exact: true }) });
const undo = page => page.getByRole('button', { name: 'Undo' }).click();
// The 24.10 guest has no wireless configuration.
const files = 'sha256sum /etc/sysctl.conf /etc/config/firewall /etc/config/dhcp /etc/config/wireless 2>/dev/null; true';
let before, prefix;
// QEMU answers DHCP on the LAN, so dnsmasq serves it only when forced.
test.beforeAll(() => {
 prefix = ssh('uci get network.lan.ipaddr').split('/')[0].split('.').slice(0, 3).join('.');
 ssh("uci set dhcp.lan.force='1'; uci commit dhcp; /etc/init.d/dnsmasq reload");
 before = ssh(files);
});
test.afterAll(() => {
 expect(ssh(files)).toBe(before);
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

async function openIp(page, label) {
 await page.getByRole('menuitem', { name: 'IP', exact: true }).click();
 await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('IP Settings reach the kernel at once; Undo puts the old value back', async ({ page }) => {
 const max = ssh('cat /proc/sys/net/netfilter/nf_conntrack_max');
 const rp = ssh('cat /proc/sys/net/ipv4/conf/all/rp_filter');
 await openIp(page, 'Settings');
 const settings = win(page, 'IP Settings');
 await settings.getByLabel('RP Filter:').selectOption(rp === '2' ? '1' : '2');
 await settings.getByRole('tab', { name: 'Connections' }).click();
 await expect(settings.getByLabel('Max Connections:')).toHaveValue(max);
 await settings.getByLabel('Max Connections:').fill('65000');
 await settings.getByRole('button', { name: 'Apply' }).click();
 await expect.poll(() => ssh('cat /proc/sys/net/netfilter/nf_conntrack_max')).toBe('65000');
 expect(ssh('cat /proc/sys/net/ipv4/conf/default/rp_filter')).toBe(rp === '2' ? '1' : '2');
 expect(ssh('grep -c nf_conntrack_max=65000 /etc/sysctl.conf')).toBe('1');
 await undo(page);
 await expect.poll(() => ssh('cat /proc/sys/net/netfilter/nf_conntrack_max')).toBe(max);
 expect(ssh('cat /proc/sys/net/ipv4/conf/all/rp_filter')).toBe(rp);
});

test('FastPath, mangle and raw rules and zone logging reach nftables', async ({ page }) => {
 await openIp(page, 'Firewall');
 const firewall = win(page, 'Firewall');
 await firewall.getByRole('tab', { name: 'Settings' }).click();
 await firewall.getByRole('tab', { name: 'FastPath' }).click();
 await firewall.getByLabel('FastPath (Software Offload):').check();
 await firewall.getByRole('button', { name: 'Apply' }).click();
 await expect.poll(() => probe('nft list flowtables 2>/dev/null'), { timeout: 15000 }).toContain('flowtable ft');

 await firewall.getByRole('tab', { name: 'Mangle' }).click();
 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 const mark = win(page, 'New Mangle Rule');
 await mark.getByLabel('In. Zone:').selectOption('lan');
 await mark.getByLabel('Protocol:').fill('udp');
 await mark.getByLabel('Dst. Port:', { exact: true }).fill('5353');
 await mark.getByRole('tab', { name: 'Action' }).click();
 await mark.getByLabel('New Mark:').fill('0x77/0xff');
 await mark.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('nft list chain inet fw4 mangle_prerouting'), { timeout: 15000 }).toMatch(/udp dport 5353 .*meta mark set/);

 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 const dscp = win(page, 'New Mangle Rule');
 await dscp.getByLabel('Chain:').selectOption('postrouting');
 await dscp.getByLabel('Out. Zone:').selectOption('wan');
 await dscp.getByLabel('Protocol:').fill('tcp');
 await dscp.getByLabel('Dst. Port:', { exact: true }).fill('22');
 await dscp.getByRole('tab', { name: 'Action' }).click();
 await dscp.getByLabel('Action:').selectOption('dscp');
 await dscp.getByLabel('New DSCP:').fill('CS6');
 await dscp.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('nft list chain inet fw4 mangle_postrouting'), { timeout: 15000 }).toMatch(/tcp dport 22 .*dscp set cs6/);

 await firewall.getByRole('tab', { name: 'Raw' }).click();
 await firewall.getByRole('button', { name: 'Add', exact: true }).click();
 const raw = win(page, 'New Raw Rule');
 await raw.getByLabel('In. Zone:').selectOption('lan');
 await raw.getByLabel('Dst. Address:', { exact: true }).fill('198.51.100.9');
 await raw.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('nft list chain inet fw4 notrack_lan 2>&1'), { timeout: 15000 }).toMatch(/198\.51\.100\.9 .*notrack/);

 await firewall.getByRole('tab', { name: 'Zones' }).click();
 // "wan" is also in the Forward To column of lan; pick the zone by its section.
 await firewall.locator(`.rd-grid-row[data-key="${ssh("uci -X show firewall | sed -n \"s/^firewall\\.\\([^.]*\\)\\.name='wan'$/\\1/p\"")}"]`).dblclick();
 const zone = win(page, 'Zone <wan>');
 await zone.getByRole('tab', { name: 'Advanced' }).click();
 await zone.getByLabel('Log Dropped:').check();
 await zone.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('nft list ruleset'), { timeout: 15000 }).toMatch(/log prefix "(drop|reject) wan (in|out|forward)/);

 for (let step = 0; step < 5; step++) await undo(page);
 await expect.poll(() => probe('nft list flowtables 2>/dev/null'), { timeout: 15000 }).not.toContain('flowtable ft');
 expect(probe('nft list ruleset')).not.toContain('198.51.100.9');
 expect(probe('nft list ruleset')).not.toMatch(/dport 5353 .*meta mark set/);
});

test('advanced DNS options and a smaller pool reach dnsmasq', async ({ page }) => {
 await openIp(page, 'DNS');
 const dns = win(page, 'DNS Settings');
 await dns.getByRole('tab', { name: 'Advanced' }).click();
 await dns.getByLabel('Max Concurrent Queries:').fill('321');
 await dns.getByLabel('Filter IPv6 Answers:').check();
 await dns.getByRole('button', { name: 'Apply' }).click();
 await expect.poll(() => probe('cat /var/etc/dnsmasq.conf.*'), { timeout: 15000 }).toContain('dns-forward-max=321');
 expect(probe('cat /var/etc/dnsmasq.conf.*')).toMatch(/filter-AAAA|filter-rr=AAAA/);

 await openIp(page, 'Pool');
 const pools = win(page, 'IP Pool');
 await row(pools, 'lan').dblclick();
 const pool = win(page, 'IP Pool <lan>');
 await pool.getByLabel('Addresses:').fill(`${prefix}.50-${prefix}.59`);
 await pool.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('cat /var/etc/dnsmasq.conf.*'), { timeout: 15000 }).toContain(`dhcp-range=set:lan,${prefix}.50,${prefix}.59`);
 await undo(page);
 await undo(page);
 await expect.poll(() => probe('cat /var/etc/dnsmasq.conf.*'), { timeout: 15000 }).not.toContain('dns-forward-max=321');
});

test('802.11r and the access list reach hostapd', async ({ page }) => {
 test.skip(!probe('uci show wireless | grep -c RD-Test || true').match(/^[1-9]/), 'This guest has no RD-Test access point on hwsim radios');
 await page.getByRole('menuitem', { name: 'WiFi', exact: true }).click();
 const wifi = win(page, 'WiFi');
 await row(wifi, 'RD-Test').first().dblclick();
 const iface = page.getByRole('dialog', { name: /^WiFi Interface </ });
 await iface.getByRole('tab', { name: 'Roaming' }).click();
 await iface.getByLabel('Fast Roaming (802.11r):').check();
 await iface.getByLabel('Mobility Domain:').fill('4f57');
 await iface.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('cat /var/run/hostapd-*.conf'), { timeout: 30000 }).toContain('mobility_domain=4f57');

 await wifi.getByRole('tab', { name: 'Access List' }).click();
 await wifi.getByRole('button', { name: 'Add', exact: true }).click();
 const entry = win(page, 'New Access List Entry');
 await entry.getByLabel('MAC Address:').fill('02:00:00:aa:bb:cc');
 await entry.getByRole('button', { name: 'OK' }).click();
 await expect.poll(() => probe('cat /var/run/hostapd-*.conf'), { timeout: 30000 }).toMatch(/macaddr_acl=0/);
 expect(probe('cat /var/run/hostapd-*.maclist')).toContain('02:00:00:aa:bb:cc');
 await undo(page);
 await undo(page);
 await expect.poll(() => probe('cat /var/run/hostapd-*.conf'), { timeout: 30000 }).not.toContain('mobility_domain=4f57');
});
