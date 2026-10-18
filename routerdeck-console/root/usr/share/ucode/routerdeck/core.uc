// SPDX-License-Identifier: Apache-2.0
// Shared state for the RouterDeck rpcd plugin and the Safe Mode watchdog:
// configuration snapshots, the action history and the Safe Mode record.
'use strict';

import { readfile, writefile, rename, unlink, mkdir, lsdir, rmdir, access } from 'fs';
import { connect } from 'ubus';
import { cursor } from 'uci';

export const RUN = '/var/run/routerdeck';
export const HISTORY = RUN + '/history.json';
export const HISTORY_ID = RUN + '/history-id.json';
export const SAFE = RUN + '/safemode';
export const LAST_ROLLBACK = RUN + '/last-rollback.json';
export const DELTA = RUN + '/uci';
// Ping and Traceroute jobs, one directory each.
export const DIAG = RUN + '/diag';
// Configurations the console edits and Safe Mode protects. Most are UCI
// files in /etc/config; FILES names the others, edited as whole texts.
export const FILES = {
	crontab: '/etc/crontabs/root', sysctl: '/etc/sysctl.conf',
	'chap-secrets': '/etc/ppp/chap-secrets', 'pap-secrets': '/etc/ppp/pap-secrets', 'pppoe-options': '/etc/ppp/pppoe-server-routerdeck',
	rt_tables: '/etc/iproute2/rt_tables'
};
export const CONFIGS = [
	'network', 'firewall', 'dhcp', 'wireless', 'system', 'dropbear', 'uhttpd', 'ttyd', 'upnpd', 'ddns', 'sqm', 'routerdeck', 'crontab', 'rpcd', 'fstab', 'sysctl',
	'pppoe', 'openvpn', 'ipsec', 'chap-secrets', 'pap-secrets', 'pppoe-options', 'rt_tables'
];
// Files only root may read.
const PRIVATE = [ 'chap-secrets', 'pap-secrets' ];
// Routing ▸ OSPF and BGP write bird's configuration while it is the
// packaged one or starts with this marker.
export const BIRD_CONF = '/etc/bird.conf';
export const BIRD_MARKER = '# Written by RouterDeck Console';
export const BIRD_STATE = RUN + '/bird.json';
export const HISTORY_LIMIT = 100;
export const HISTORY_BYTES = 2 * 1024 * 1024;
export const SAFE_LIMIT = 100;
export const SAFE_TIMEOUT = 120;

export function ensure_dirs() {
	for (let dir in [ RUN, DELTA, SAFE, SAFE + '/snapshot', DIAG ])
		mkdir(dir, 0700);
};

export function read_json(path, fallback) {
	let text = readfile(path);
	if (text == null)
		return fallback;
	try {
		return json(text);
	}
	catch (e) {
		return fallback;
	}
};

// Write to a temporary file and rename, so readers never see half a file.
export function write_text(path, text) {
	if (writefile(path + '.routerdeck-tmp', text) == null)
		return false;
	return rename(path + '.routerdeck-tmp', path) == true;
};

export function write_json(path, value) {
	return write_text(path, sprintf('%J', value));
};

// Checksums apk or opkg recorded for the /etc/bird.conf bird2 or bird3
// installed, to tell the packaged file from one edited by hand.
export function bird_package_sums() {
	let sums = [];
	for (let path in [ '/lib/apk/packages/bird2.conffiles_static', '/lib/apk/packages/bird3.conffiles_static', '/usr/lib/opkg/status' ])
		for (let line in split(readfile(path) ?? '', '\n')) {
			let found = match(line, /^ ?\/etc\/bird\.conf ([0-9a-f]+)$/);
			if (found)
				push(sums, found[1]);
		}
	return sums;
};

export function config_text(name) {
	return readfile(FILES[name] ?? '/etc/config/' + name) ?? '';
};

export function write_config(name, text) {
	let path = FILES[name] ?? '/etc/config/' + name;
	let written = write_text(path, text);
	if (written && name in PRIVATE)
		system([ '/bin/chmod', '600', path ]);
	return written;
};

// Services of optional packages. procd reloads only services it has
// registered: opkg enables them at installation without starting them, and
// some are not procd services at all (ddns-scripts on 24.10). Such a service
// would ignore changes until the next boot, so it is restarted.
const SERVICES = { upnpd: 'miniupnpd', ddns: 'ddns', sqm: 'sqm', dropbear: 'dropbear', uhttpd: 'uhttpd', ttyd: 'ttyd', pppoe: 'pppoe-server', openvpn: 'openvpn', ipsec: 'swanctl' };

function start_unregistered(bus, name) {
	let service = SERVICES[name];
	if (!service || readfile('/etc/init.d/' + service) == null)
		return;
	let listed = bus.call('service', 'list', { name: service });
	if (listed?.[service] != null || system([ '/etc/init.d/' + service, 'enabled' ]) != 0)
		return;
	// A plain init script reloads its running processes, which also ends
	// those of removed sections, and starts the new ones.
	if (index(readfile('/etc/init.d/' + service), 'USE_PROCD=1') < 0)
		system(sprintf('/etc/init.d/%s reload; /etc/init.d/%s start', service, service));
	else
		system([ '/etc/init.d/' + service, 'restart' ]);
}

// The text of every section of one type, to tell whether those changed.
function sections_text(text, type) {
	let found = '', current = false;
	for (let line in split(text ?? '', '\n')) {
		let head = match(line, /^config[ \t]+([^ \t]+)/);
		if (head)
			current = head[1] == type;
		if (current)
			found += line + '\n';
	}
	return found;
}

// procd reloads the services registered for a changed configuration.
export function announce(names) {
	let bus = connect();
	if (!bus)
		return false;
	for (let name in names) {
		// rpcd reads logins at every login; block-mount and sysctl are
		// handled by sync_mounts and sync_sysctl. None needs a reload.
		// pppd reads its secrets and options at every session.
		if (name in [ 'rpcd', 'fstab', 'sysctl', 'chap-secrets', 'pap-secrets', 'pppoe-options', 'rt_tables' ])
			continue;
		// crond has no configuration trigger; it reads its tables at start.
		if (name == 'crontab')
			system('/etc/init.d/cron restart >/dev/null 2>&1');
		// Netwatch runs only with hosts to watch, so it may not be registered
		// with procd yet; it is enabled and restarted directly.
		// Simple Queues are set up again from the configuration.
		else if (name == 'routerdeck')
			system('/etc/init.d/routerdeck-netwatch enable; /etc/init.d/routerdeck-netwatch restart >/dev/null 2>&1; /etc/init.d/routerdeck-graphing enable; /etc/init.d/routerdeck-graphing restart >/dev/null 2>&1; /usr/libexec/routerdeck/queues >/dev/null 2>&1; /usr/libexec/routerdeck/bird >/dev/null 2>&1');
		else {
			bus.call('service', 'event', { type: 'config.change', data: { package: name } });
			start_unregistered(bus, name);
		}
	}
	bus.disconnect();
	return true;
};

// LEDs are set by a plain init script, not by procd's reload of `system`.
export function sync_leds(before_text, after_text) {
	if (sections_text(before_text, 'led') == sections_text(after_text, 'led'))
		return false;
	system('/etc/init.d/led start >/dev/null 2>&1');
	return true;
};

// Mount points: those removed or disabled are unmounted, then block-mount
// mounts what the configuration enables.
function mount_targets(text) {
	let targets = {}, current = null;
	for (let line in split(text ?? '', '\n')) {
		let words = match(trim(line), /^(config|option)[ \t]+([^ \t]+)([ \t]+'?([^']*)'?)?$/);
		if (!words)
			continue;
		if (words[1] == 'config')
			current = words[2] == 'mount' ? { enabled: true } : null;
		else if (current && words[2] == 'target')
			targets[words[4]] = current;
		else if (current && words[2] == 'enabled')
			current.enabled = !(words[4] in [ '0', 'no', 'off', 'false' ]);
	}
	return targets;
}

export function sync_mounts(before_text, after_text) {
	let before = mount_targets(before_text), after = mount_targets(after_text);
	for (let target, mount in before)
		if (mount.enabled && !after[target]?.enabled && index(readfile('/proc/mounts') ?? '', ' ' + target + ' ') >= 0)
			system(sprintf("umount '%s' >/dev/null 2>&1", replace(target, "'", '')));
	if (access('/sbin/block', 'x'))
		system('/sbin/block mount >/dev/null 2>&1');
	return true;
};

// Kernel settings in /etc/sysctl.conf take effect at once. A setting taken
// out of the file goes back to the value it had before the console first
// changed it (kept until reboot, when the files apply anew).
const SYSCTL_KEY = /^[a-z0-9_]+(\.[a-z0-9_-]+)+$/;
const SYSCTL_ORIGINAL = RUN + '/sysctl-original.json';

function sysctl_values(text) {
	let values = {};
	for (let line in split(text ?? '', '\n')) {
		let pair = match(trim(line), /^([a-z0-9_.-]+)[ \t]*=[ \t]*(.*)$/);
		if (pair && match(pair[1], SYSCTL_KEY))
			values[pair[1]] = trim(pair[2]);
	}
	return values;
}

export const sysctl_path = key => '/proc/sys/' + replace(key, /\./g, '/');

export function sync_sysctl(before_text, after_text) {
	let before = sysctl_values(before_text), after = sysctl_values(after_text);
	let originals = read_json(SYSCTL_ORIGINAL, {});
	for (let key, value in after) {
		if (originals[key] == null) {
			let current = readfile(sysctl_path(key));
			if (current != null)
				originals[key] = trim(current);
		}
		if (before[key] != value)
			writefile(sysctl_path(key), value);
	}
	for (let key, value in before)
		if (!(key in after) && originals[key] != null)
			writefile(sysctl_path(key), originals[key]);
	ensure_dirs();
	write_json(SYSCTL_ORIGINAL, originals);
	return true;
};

// Address lists (fw4 ipsets) with their static entries, read from the text
// of /etc/config/firewall as uci writes it.
function firewall_sets(text) {
	let sets = {}, current = null;
	for (let line in split(text ?? '', '\n')) {
		let words = match(trim(line), /^(config|option|list)[ \t]+([^ \t]+)([ \t]+'?([^']*)'?)?$/);
		if (!words)
			continue;
		if (words[1] == 'config') {
			current = words[2] == 'ipset' ? { entries: [], enabled: true } : null;
			continue;
		}
		if (!current)
			continue;
		if (words[1] == 'option' && words[2] == 'name') {
			current.name = words[4];
			sets[current.name] = current;
		}
		else if (words[1] == 'option' && words[2] == 'enabled')
			current.enabled = !(words[4] in [ '0', 'no', 'off', 'false' ]);
		else if (words[1] == 'list' && words[2] == 'entry')
			push(current.entries, words[4]);
	}
	return sets;
}

// `fw4 reload` only adds to sets that already exist, so an address taken
// off a list would stay in nftables until a restart. Sets that lost static
// entries are flushed and reloaded at once; removed sets are deleted. Sets
// without static entries (filled at runtime, e.g. by dnsmasq) are left alone.
export function sync_firewall_sets(before_text, after_text) {
	let before = firewall_sets(before_text), after = firewall_sets(after_text);
	let flush = [], gone = [];
	for (let name, set in before) {
		let next = after[name];
		if (!next || !next.enabled)
			push(gone, name);
		else if (length(filter(set.entries, entry => !(entry in next.entries))))
			push(flush, name);
	}
	if (!length(flush) && !length(gone))
		return false;
	for (let name in flush)
		system([ '/usr/sbin/nft', 'flush', 'set', 'inet', 'fw4', name ]);
	system('/sbin/fw4 reload >/dev/null 2>&1');
	for (let name in gone)
		system(sprintf('/usr/sbin/nft delete set inet fw4 %s >/dev/null 2>&1', name));
	return true;
};

// WireGuard peers are `wireguard_<interface>` sections; netifd reads them
// only when it sets the interface up, so a reload does not apply them.
function wireguard_peers(text) {
	let peers = {}, current = null;
	for (let line in split(text ?? '', '\n')) {
		let head = match(line, /^config[ \t]+([^ \t]+)/);
		if (head) {
			let iface = match(head[1], /^wireguard_(.+)$/);
			current = iface ? iface[1] : null;
			if (current)
				peers[current] = (peers[current] ?? '') + line + '\n';
			continue;
		}
		if (current)
			peers[current] += line + '\n';
	}
	return peers;
}

export function restart_wireguard(before_text, after_text) {
	let before = wireguard_peers(before_text), after = wireguard_peers(after_text), restarted = [];
	for (let iface in uniq([ ...keys(before), ...keys(after) ])) {
		if (before[iface] != after[iface] && index('\n' + after_text, "\nconfig interface '" + iface + "'") >= 0) {
			system([ '/sbin/ifup', iface ]);
			push(restarted, iface);
		}
	}
	return restarted;
};

/* --- Merging a change into a file someone else touched ------------------ */

let merge_serial = 0;

// Loads a configuration text with its own uci cursor, apart from /etc/config.
function with_config(name, text, action) {
	let dir = sprintf('%s/merge.%d.%d', RUN, time(), ++merge_serial);
	mkdir(dir, 0700);
	mkdir(dir + '/delta', 0700);
	writefile(dir + '/' + name, text);
	let ctx = cursor(dir, dir + '/delta');
	ctx.load(name);
	let result = action(ctx, dir);
	for (let file in lsdir(dir + '/delta') ?? [])
		unlink(dir + '/delta/' + file);
	rmdir(dir + '/delta');
	for (let file in lsdir(dir) ?? [])
		unlink(dir + '/' + file);
	rmdir(dir);
	return result;
}

const same = (a, b) => sprintf('%J', a) == sprintf('%J', b);
const exists_in = (config, entry) => config[split(entry, ':')[0]] != null;
const layout = config => map(sort(keys(config), (a, b) => config[a]['.index'] - config[b]['.index']), name => name + ':' + config[name]['.type']);

// Applies the change from_text → to_text to current_text, which another
// program changed meanwhile (miniupnpd writes its UUID, for example). This
// is safe only when sections were neither added, removed nor moved outside
// this history, so section names still mean the same sections, and when
// none of the options this change touched were changed outside it. Returns
// the merged text, or null when the change cannot be carried over.
export function merge_config(name, from_text, to_text, current_text) {
	if (FILES[name])
		return null;
	let from = with_config(name, from_text, ctx => ctx.get_all(name));
	let to = with_config(name, to_text, ctx => ctx.get_all(name));
	let now = with_config(name, current_text, ctx => ctx.get_all(name));
	if (type(from) != 'object' || type(to) != 'object' || type(now) != 'object' || !same(layout(from), layout(now)))
		return null;
	let ops = [];
	for (let section in uniq([ ...keys(from), ...keys(to) ])) {
		let a = from[section], b = to[section], c = now[section];
		if (a && !b) {
			// A section this change added goes only if nobody edited it since.
			for (let option in uniq([ ...keys(a), ...keys(c) ]))
				if (substr(option, 0, 1) != '.' && !same(a[option], c[option]))
					return null;
			push(ops, [ 'delete', section ]);
		}
		else if (!a && b)
			push(ops, [ 'create', section, b ]);
		else {
			for (let option in uniq([ ...keys(a), ...keys(b) ])) {
				if (substr(option, 0, 1) == '.' || same(a[option], b[option]))
					continue;
				if (!same(c[option], a[option]))
					return null;
				push(ops, [ 'set', section, option, b[option] ]);
			}
		}
	}
	let moved = !same(layout(from), filter(layout(to), entry => exists_in(from, entry)));
	return with_config(name, current_text, (ctx, dir) => {
		for (let op in ops) {
			if (op[0] == 'delete')
				ctx.delete(name, op[1]);
			else if (op[0] == 'create') {
				ctx.set(name, op[1], op[2]['.type']);
				for (let option, value in op[2])
					if (substr(option, 0, 1) != '.')
						ctx.set(name, op[1], option, value);
			}
			else if (op[3] == null)
				ctx.delete(name, op[1], op[2]);
			else
				ctx.set(name, op[1], op[2], op[3]);
		}
		if (moved) {
			let position = 0;
			for (let entry in layout(to))
				ctx.reorder(name, split(entry, ':')[0], position++);
		}
		ctx.commit(name);
		return readfile(dir + '/' + name);
	});
};

// LuCI's apply with rollback keeps snapshots here until it is confirmed.
// Changing configuration meanwhile would be overwritten by its rollback.
export function luci_rollback_pending() {
	let files = lsdir('/var/run/rpcd/snapshot-files');
	return files != null && length(files) > 0;
};

export function log_message(message) {
	system([ '/usr/bin/logger', '-t', 'routerdeck', '-p', 'daemon.notice', message ]);
};

export function history_load() {
	let entries = read_json(HISTORY, []);
	return type(entries) == 'array' ? entries : [];
};

export function history_save(entries) {
	while (length(entries) > HISTORY_LIMIT || length(entries) > 1 && length(sprintf('%J', entries)) > HISTORY_BYTES)
		shift(entries);
	ensure_dirs();
	return write_json(HISTORY, entries);
};

export function safe_state() {
	let state = read_json(SAFE + '/state.json', null);
	return type(state) == 'object' ? state : null;
};

export function safe_heartbeat() {
	return int(readfile(SAFE + '/heartbeat') ?? '0');
};

export function safe_clear() {
	for (let name in CONFIGS)
		unlink(SAFE + '/snapshot/' + name);
	unlink(SAFE + '/heartbeat');
	unlink(SAFE + '/state.json');
};

// Restore configurations saved when Safe Mode was entered. Only files that
// differ are written and announced. Safe Mode history entries are dropped,
// because restoring the snapshot already undid them.
export function safe_restore(state, reason) {
	let changed = [];
	for (let name in state.configs ?? CONFIGS) {
		let saved = readfile(SAFE + '/snapshot/' + name);
		let current = config_text(name);
		if (saved != null && saved != current) {
			write_config(name, saved);
			push(changed, name);
			if (name == 'firewall')
				sync_firewall_sets(current, saved);
			if (name == 'network')
				restart_wireguard(current, saved);
			if (name == 'fstab')
				sync_mounts(current, saved);
			if (name == 'sysctl')
				sync_sysctl(current, saved);
			if (name == 'system')
				sync_leds(current, saved);
		}
	}
	announce(changed);
	history_save(filter(history_load(), entry => !entry.safemode));
	write_json(LAST_ROLLBACK, { time: time(), user: state.user, reason, configs: changed });
	log_message(sprintf('Safe Mode %s: restored %s', reason, length(changed) ? join(', ', changed) : 'nothing (no changes)'));
	safe_clear();
	return changed;
};
