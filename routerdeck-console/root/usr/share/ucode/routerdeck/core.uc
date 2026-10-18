// SPDX-License-Identifier: Apache-2.0
// Shared state for the RouterDeck rpcd plugin and the Safe Mode watchdog:
// configuration snapshots, the action history and the Safe Mode record.
'use strict';

import { readfile, writefile, rename, unlink, mkdir, lsdir } from 'fs';
import { connect } from 'ubus';

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
export const FILES = { crontab: '/etc/crontabs/root' };
export const CONFIGS = [ 'network', 'firewall', 'dhcp', 'wireless', 'system', 'dropbear', 'uhttpd', 'ttyd', 'crontab' ];
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

export function config_text(name) {
	return readfile(FILES[name] ?? '/etc/config/' + name) ?? '';
};

export function write_config(name, text) {
	return write_text(FILES[name] ?? '/etc/config/' + name, text);
};

// procd reloads the services registered for a changed configuration.
export function announce(names) {
	let bus = connect();
	if (!bus)
		return false;
	for (let name in names) {
		// crond has no configuration trigger; it reads its tables at start.
		if (name == 'crontab')
			system('/etc/init.d/cron restart >/dev/null 2>&1');
		else
			bus.call('service', 'event', { type: 'config.change', data: { package: name } });
	}
	bus.disconnect();
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
		}
	}
	announce(changed);
	history_save(filter(history_load(), entry => !entry.safemode));
	write_json(LAST_ROLLBACK, { time: time(), user: state.user, reason, configs: changed });
	log_message(sprintf('Safe Mode %s: restored %s', reason, length(changed) ? join(', ', changed) : 'nothing (no changes)'));
	safe_clear();
	return changed;
};
