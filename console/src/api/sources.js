// SPDX-License-Identifier: Apache-2.0
// Router data sources shared by windows, with their refresh intervals.
import { useEffect, useState } from 'preact/hooks';
import { createPoller } from './poller.js';
import { client } from '../state.js';

export const poller = createPoller();

const uci = config => () => client.call('uci', 'get', { config }).then(reply => reply?.values ?? {});
const counterDelta = (now, before) => Number.isFinite(now) && Number.isFinite(before) && now >= before ? now - before : null;

// Rates come from counter deltas over measured time. The first sample and
// counter resets produce no rate rather than a wrong one.
let lastDevices = null;
async function devices() {
 const reply = await client.call('luci-rpc', 'getNetworkDevices');
 const time = performance.now();
 const seconds = lastDevices ? (time - lastDevices.time) / 1000 : 0;
 for (const [name, device] of Object.entries(reply ?? {})) {
  const before = lastDevices?.reply[name]?.stats, stats = device.stats;
  if (!before || !stats || seconds <= 0) continue;
  const per = (key, factor = 1) => { const delta = counterDelta(stats[key], before[key]); return delta === null ? null : delta * factor / seconds; };
  device.rates = { tx_bps: per('tx_bytes', 8), rx_bps: per('rx_bytes', 8), tx_pps: per('tx_packets'), rx_pps: per('rx_packets') };
 }
 lastDevices = { time, reply };
 return reply;
}

// The log is read incrementally by entry id and kept to 1000 lines.
let logState = { entries: [], after: 0 };
async function log() {
 const reply = await client.call('routerdeck', 'log', { after: logState.after, lines: 1000 });
 if (reply.mode !== 'ubus') logState = { entries: reply.entries, after: 0 };
 else if (reply.entries.length) logState = { entries: [...logState.entries, ...reply.entries].slice(-1000), after: reply.entries.at(-1).id };
 return { mode: reply.mode, entries: logState.entries };
}

// iwinfo per wireless device: radio state and connected stations.
async function wifi() {
 const devices = (await client.call('iwinfo', 'devices'))?.devices ?? [];
 const details = await Promise.all(devices.map(device => Promise.all([
  client.call('iwinfo', 'info', { device }).catch(() => null),
  client.call('iwinfo', 'assoclist', { device }).catch(() => null)
 ])));
 return Object.fromEntries(devices.map((device, index) => [device, { info: details[index][0], stations: details[index][1]?.results ?? [] }]));
}

export const SOURCES = {
 'uci:network': [uci('network'), 5000],
 'uci:firewall': [uci('firewall'), 5000],
 'uci:dhcp': [uci('dhcp'), 5000],
 'uci:system': [uci('system'), 5000],
 // Configurations of optional packages read as empty when missing.
 'uci:uhttpd': [() => uci('uhttpd')().catch(() => ({})), 10000],
 'uci:dropbear': [() => uci('dropbear')().catch(() => ({})), 10000],
 'uci:ttyd': [() => uci('ttyd')().catch(() => ({})), 10000],
 neighbors: [() => client.call('routerdeck', 'neighbors'), 3000],
 'uci:upnpd': [() => uci('upnpd')().catch(() => ({})), 5000],
 'uci:ddns': [() => uci('ddns')().catch(() => ({})), 5000],
 'uci:sqm': [() => uci('sqm')().catch(() => ({})), 5000],
 upnp: [() => client.call('routerdeck', 'upnp').catch(() => ({ mappings: [] })), 5000],
 ddns: [() => client.call('routerdeck', 'ddns').catch(() => ({ services: {}, providers: [] })), 5000],
 qdisc: [() => client.call('routerdeck', 'qdisc').catch(() => ({ devices: {} })), 3000],
 rules: [() => client.call('routerdeck', 'rules'), 5000],
 wireguard: [() => client.call('routerdeck', 'wireguard').catch(() => ({ available: false, interfaces: {} })), 3000],
 // Optional objects: without LuCI or procd's rc, these read as empty.
 timezones: [() => client.call('luci', 'getTimezones').then(reply => reply ?? null, () => null), 600000],
 rc: [() => client.call('rc', 'list').then(reply => reply ?? {}, () => ({})), 5000],
 packages: [() => client.call('routerdeck', 'packages'), 60000],
 crontab: [() => client.call('routerdeck', 'crontab'), 5000],
 'uci:wireless': [() => client.call('uci', 'get', { config: 'wireless' }).then(reply => reply?.values ?? {}, () => ({})), 5000],
 // netifd's network.wireless rejects uhttpd's session argument; luci-rpc wraps it.
 wireless: [() => client.call('luci-rpc', 'getWirelessDevices').then(reply => reply ?? {}, () => ({})), 3000],
 wifi: [wifi, 2000],
 protos: [() => client.call('network', 'get_proto_handlers').then(reply => reply ?? {}), 30000],
 devices: [devices, 1000],
 ifaces: [() => client.call('network.interface', 'dump').then(reply => reply?.interface ?? []), 2000],
 routes4: [() => client.call('routerdeck', 'routes', { family: 4 }).then(reply => reply?.routes ?? []), 3000],
 routes6: [() => client.call('routerdeck', 'routes', { family: 6 }).then(reply => reply?.routes ?? []), 3000],
 netdev: [() => client.call('network.device', 'status').then(reply => reply ?? {}), 3000],
 counters: [() => client.call('routerdeck', 'fw_counters'), 2000],
 conntrack: [() => client.call('routerdeck', 'conntrack', { limit: 2048 }), 2000],
 leases: [() => client.call('luci-rpc', 'getDHCPLeases'), 3000],
 log: [log, 1000],
 terminal: [() => client.call('routerdeck', 'terminal'), 5000],
 history: [() => client.call('routerdeck', 'history'), 5000],
 sysinfo: [() => client.call('system', 'info'), 5000],
 board: [() => client.call('system', 'board'), 60000],
 safemode: [() => client.call('routerdeck', 'safemode', { action: 'status' }), 5000]
};

export function resetSources() {
 lastDevices = null;
 logState = { entries: [], after: 0 };
 poller.reset();
}

function snapshot(keys) {
 const data = {}, errors = [];
 let loading = false;
 for (const key of keys) {
  const state = poller.state(key);
  data[key] = state.value;
  if (state.error) errors.push(state.error);
  else if (state.value === undefined) loading = true;
 }
 return { data, errors, loading };
}

// Subscribe a component to sources while `active` (e.g. not minimized).
export function useSources(keys, active = true) {
 const id = keys.join('|');
 const [state, setState] = useState(() => snapshot(keys));
 useEffect(() => {
  if (!active) return undefined;
  setState(snapshot(keys));
  const stop = keys.map(key => {
   const [load, every] = SOURCES[key];
   return poller.subscribe(key, load, every, () => setState(snapshot(keys)));
  });
  return () => stop.forEach(unsubscribe => unsubscribe());
 }, [id, active]);
 return state;
}
