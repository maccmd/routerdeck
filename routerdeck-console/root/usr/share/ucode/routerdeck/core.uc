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
export const CONFIGS = [ 'network', 'firewall', 'dhcp', 'wireless', 'system', 'dropbear', 'uhttpd', 'crontab' ];
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
		if (saved != null && saved != config_text(name)) {
			write_config(name, saved);
			push(changed, name);
		}
	}
	announce(changed);
	history_save(filter(history_load(), entry => !entry.safemode));
	write_json(LAST_ROLLBACK, { time: time(), user: state.user, reason, configs: changed });
	log_message(sprintf('Safe Mode %s: restored %s', reason, length(changed) ? join(', ', changed) : 'nothing (no changes)'));
	safe_clear();
	return changed;
};
