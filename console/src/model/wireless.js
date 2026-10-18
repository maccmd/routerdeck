// SPDX-License-Identifier: Apache-2.0
// WiFi: `wifi-iface` sections (access points and clients), `wifi-device`
// radios, and the registration table of connected stations (iwinfo).
// Runtime state comes from netifd (network.wireless status) and iwinfo.
import { sections, list, truthy, invalid, networkOptions, compact } from './common.js';
import { uptime, bitrate } from '../lib/format.js';

const SECURITY = [
 { value: 'none', label: 'open' },
 { value: 'owe', label: 'OWE (opportunistic encryption)' },
 { value: 'psk2', label: 'WPA2-PSK' },
 { value: 'psk-mixed', label: 'WPA/WPA2-PSK' },
 { value: 'sae', label: 'WPA3-SAE' },
 { value: 'sae-mixed', label: 'WPA2/WPA3' }
];
const needsKey = encryption => !['none', 'owe', ''].includes(encryption ?? 'none');
const BANDS = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz', '60g': '60 GHz' };
const WIDTHS = ['HT20', 'HT40', 'VHT20', 'VHT40', 'VHT80', 'VHT160', 'HE20', 'HE40', 'HE80', 'HE160', 'EHT20', 'EHT40', 'EHT80', 'EHT160', 'EHT320'];

// netifd's runtime view of one wifi-iface section: its device name and radio.
function runtimeOf(data, section) {
 for (const [radio, state] of Object.entries(data.wireless ?? {})) {
  const entry = (state.interfaces ?? []).find(item => item.section === section);
  if (entry) return { radio, state, ifname: entry.ifname, info: data.wifi?.[entry.ifname]?.info, stations: data.wifi?.[entry.ifname]?.stations ?? [] };
 }
 return {};
}

export const wifiInterfaces = {
 id: 'wifi-interfaces',
 noun: 'WiFi Interface',
 sources: ['uci:wireless', 'wireless', 'wifi', 'uci:network'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 110 },
  { id: 'ssid', label: 'SSID', width: 140 },
  { id: 'mode', label: 'Mode', width: 70 },
  { id: 'radio', label: 'Radio', width: 70 },
  { id: 'channel', label: 'Channel', width: 110 },
  { id: 'security', label: 'Security', width: 110 },
  { id: 'network', label: 'Network', width: 90 },
  { id: 'clients', label: 'Clients', width: 60, align: 'right', sort: value => Number(value) || 0 },
  { id: 'bssid', label: 'BSSID', width: 130, hidden: true }
 ],
 flagLegend: { R: 'running', X: 'disabled', I: 'radio not available' },
 defaultSort: null,

 rows(data) {
  const radios = new Set(sections(data['uci:wireless'], 'wifi-device').map(radio => radio['.name']));
  return sections(data['uci:wireless'], 'wifi-iface').map(section => {
   const live = runtimeOf(data, section['.name']);
   const disabled = truthy(section.disabled);
   const running = !disabled && !!live.info;
   const invalid = !radios.has(section.device);
   return {
    key: section['.name'], section: section['.name'], disabled, invalid, comment: section.comment,
    flags: (disabled ? 'X' : '') + (running ? 'R' : '') + (invalid ? 'I' : ''),
    cells: {
     name: live.ifname ?? section['.name'], ssid: section.ssid ?? '', mode: section.mode ?? 'ap', radio: section.device ?? '',
     channel: live.info ? `${live.info.channel} (${live.info.frequency} MHz)` : '', security: SECURITY.find(item => item.value === (section.encryption ?? 'none'))?.label ?? section.encryption,
     network: list(section.network).join(' '), clients: section.mode === 'sta' ? '' : String(live.stations?.length ?? 0), bssid: live.info?.bssid ?? ''
    }
   };
  });
 },

 itemTitle: row => `WiFi Interface <${row?.cells.ssid || row?.key || 'new'}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.flags.includes('R') ? 'running' : 'not running', row.cells?.mode === 'sta' && row.flags.includes('R') ? 'connected' : null],
 canAdd: data => sections(data['uci:wireless'], 'wifi-device').length > 0,
 canRemove: () => true,
 canToggle: () => true,
 canComment: () => true,

 fields: data => [
  { id: 'ssid', label: 'SSID', type: 'text', required: true, placeholder: 'MyNetwork' },
  { id: 'mode', label: 'Mode', type: 'select', options: [{ value: 'ap', label: 'access point' }, { value: 'sta', label: 'client (station)' }] },
  { id: 'device', label: 'Radio', type: 'select', options: sections(data['uci:wireless'], 'wifi-device').map(radio => ({ value: radio['.name'], label: `${radio['.name']} (${BANDS[radio.band] ?? radio.band ?? '?'})` })) },
  { id: 'network', label: 'Network', type: 'multi', options: networkOptions(data['uci:network'], section => section['.name'] !== 'loopback') },
  { id: 'encryption', label: 'Security', type: 'select', options: SECURITY },
  { id: 'key', label: 'Passphrase', type: 'password', visible: values => needsKey(values.encryption) },
  { id: 'hidden', label: 'Hide SSID', type: 'bool', visible: values => values.mode === 'ap' },
  { id: 'isolate', label: 'Isolate Clients', type: 'bool', visible: values => values.mode === 'ap' },
  { id: 'channel', label: 'Channel', type: 'static', tab: 'Status' },
  { id: 'bssid', label: 'BSSID', type: 'static', tab: 'Status' },
  { id: 'clients', label: 'Clients', type: 'static', tab: 'Status' }
 ],
 values(row, data) {
  const section = sections(data['uci:wireless'], 'wifi-iface').find(item => item['.name'] === row.section) ?? {};
  return {
   ssid: section.ssid ?? '', mode: section.mode ?? 'ap', device: section.device ?? '', network: list(section.network), encryption: section.encryption ?? 'none', key: section.key ?? '',
   hidden: truthy(section.hidden), isolate: truthy(section.isolate), channel: row.cells.channel || '—', bssid: row.cells.bssid || '—', clients: row.cells.clients || '—'
  };
 },
 defaults: data => ({ ssid: '', mode: 'ap', device: sections(data['uci:wireless'], 'wifi-device')[0]?.['.name'] ?? '', network: ['lan'], encryption: 'sae-mixed', key: '', hidden: false, isolate: false }),

 save(values, row, data, { dirty = null } = {}) {
  if (!values.ssid || new TextEncoder().encode(values.ssid).length > 32) invalid('ssid', 'An SSID has 1 to 32 bytes');
  if (!values.device) invalid('device', 'Choose a radio');
  if (needsKey(values.encryption) && !(values.key.length >= 8 && values.key.length <= 63)) invalid('key', 'A passphrase has 8 to 63 characters');
  const options = compact({
   ssid: values.ssid, mode: values.mode, device: values.device, network: values.network ?? [], encryption: values.encryption,
   key: needsKey(values.encryption) ? values.key : '', hidden: values.mode === 'ap' && values.hidden ? '1' : '', isolate: values.mode === 'ap' && values.isolate ? '1' : ''
  });
  if (!row) return { description: `Add WiFi ${values.mode === 'sta' ? 'client' : 'network'} ${values.ssid}`, ops: [{ op: 'add', config: 'wireless', type: 'wifi-iface', values: options }] };
  const related = { key: ['encryption'], encryption: ['key'] };
  const changes = Object.fromEntries(Object.entries(options).filter(([key]) => !dirty || dirty.has(key) || (related[key] ?? []).some(other => dirty.has(other))));
  return Object.keys(changes).length ? { description: `Change WiFi ${values.ssid}`, ops: [{ op: 'set', config: 'wireless', section: row.section, values: changes }] } : null;
 },
 remove: rows => ({ description: `Remove WiFi ${rows.map(row => row.cells.ssid).join(', ')}`, ops: rows.map(row => ({ op: 'delete', config: 'wireless', section: row.section })) }),
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} WiFi ${rows.map(row => row.cells.ssid).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'wireless', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment WiFi ${rows.map(row => row.cells.ssid).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'wireless', section: row.section, values: { comment: comment || null } })) })
};

export const wifiRadios = {
 id: 'wifi-radios',
 noun: 'Radio',
 sources: ['uci:wireless', 'wireless', 'wifi'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'name', label: 'Name', width: 80 },
  { id: 'band', label: 'Band', width: 70 },
  { id: 'channel', label: 'Channel', width: 120 },
  { id: 'width', label: 'Width', width: 70 },
  { id: 'country', label: 'Country', width: 60 },
  { id: 'txpower', label: 'Tx Power', width: 70, align: 'right' },
  { id: 'hardware', label: 'Hardware', width: 140 }
 ],
 flagLegend: { R: 'running', X: 'disabled' },
 defaultSort: null,
 rows(data) {
  return sections(data['uci:wireless'], 'wifi-device').map(radio => {
   const state = data.wireless?.[radio['.name']];
   const info = (state?.interfaces ?? []).map(item => data.wifi?.[item.ifname]?.info).find(Boolean);
   const disabled = truthy(radio.disabled);
   return {
    key: radio['.name'], section: radio['.name'], disabled, info, comment: radio.comment, flags: (disabled ? 'X' : '') + (state?.up ? 'R' : ''),
    cells: {
     name: radio['.name'], band: BANDS[radio.band] ?? radio.band ?? '', channel: info ? `${info.channel} (${radio.channel === 'auto' ? 'auto' : 'fixed'})` : radio.channel ?? 'auto',
     width: radio.htmode ?? '', country: radio.country ?? '', txpower: info ? `${info.txpower} dBm` : radio.txpower ? `${radio.txpower} dBm` : '', hardware: info?.hardware?.name ?? radio.path ?? ''
    }
   };
  });
 },
 itemTitle: row => `Radio <${row?.key}>`,
 itemStatus: row => [row.disabled ? 'disabled' : row.flags.includes('R') ? 'running' : 'not running'],
 canToggle: () => true,
 canComment: () => true,
 fields: (data, row) => [
  { id: 'band', label: 'Band', type: 'select', options: Object.entries(BANDS).map(([value, label]) => ({ value, label })) },
  { id: 'channel', label: 'Channel', type: 'text', placeholder: 'auto' },
  { id: 'htmode', label: 'Width', type: 'select', allowEmpty: true, options: (row?.info?.htmodes ?? WIDTHS).map(value => ({ value, label: value })) },
  { id: 'country', label: 'Country', type: 'text', placeholder: 'US' },
  { id: 'txpower', label: 'Tx Power (dBm)', type: 'number', placeholder: 'driver default' },
  { id: 'hardware', label: 'Hardware', type: 'static', tab: 'Status' },
  { id: 'hwmodes', label: 'Modes', type: 'static', tab: 'Status', value: () => row?.info?.hwmodes_text ?? '—' }
 ],
 values(row, data) {
  const radio = sections(data['uci:wireless'], 'wifi-device').find(item => item['.name'] === row.section) ?? {};
  return { band: radio.band ?? '2g', channel: radio.channel ?? 'auto', htmode: radio.htmode ?? '', country: radio.country ?? '', txpower: radio.txpower ?? '', hardware: row.cells.hardware };
 },
 save(values, row, data, { dirty = null } = {}) {
  if (!(values.channel === 'auto' || /^\d{1,3}$/.test(values.channel))) invalid('channel', 'Use auto or a channel number');
  const limits = { '2g': [1, 14], '5g': [32, 177], '6g': [1, 233], '60g': [1, 6] }[values.band];
  if (values.channel !== 'auto' && limits && !(Number(values.channel) >= limits[0] && Number(values.channel) <= limits[1])) invalid('channel', `Channels on ${BANDS[values.band]} are ${limits[0]}–${limits[1]}`);
  if (values.country && !/^[A-Z]{2}$|^00$/.test(values.country)) invalid('country', 'Use a two-letter country code such as US or DE');
  if (values.txpower && !(/^\d+$/.test(values.txpower) && values.txpower <= 30)) invalid('txpower', 'Tx power is a whole number of dBm up to 30');
  const options = compact({ band: values.band, channel: values.channel, htmode: values.htmode, country: values.country, txpower: values.txpower });
  const changes = Object.fromEntries(Object.entries(options).filter(([key]) => !dirty || dirty.has(key)));
  return Object.keys(changes).length ? { description: `Change radio ${row.key}`, ops: [{ op: 'set', config: 'wireless', section: row.section, values: changes }] } : null;
 },
 toggle: (rows, enable) => ({ description: `${enable ? 'Enable' : 'Disable'} radio ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'wireless', section: row.section, values: { disabled: enable ? null : '1' } })) }),
 comment: (rows, comment) => ({ description: `Comment radio ${rows.map(row => row.key).join(', ')}`, ops: rows.map(row => ({ op: 'set', config: 'wireless', section: row.section, values: { comment: comment || null } })) })
};

export const wifiRegistration = {
 id: 'wifi-registration',
 noun: 'Registration',
 sources: ['wireless', 'wifi', 'leases'],
 readOnly: true,
 columns: [
  { id: 'mac', label: 'MAC Address', width: 130 },
  { id: 'interface', label: 'Interface', width: 100 },
  { id: 'ssid', label: 'SSID', width: 120 },
  { id: 'signal', label: 'Signal', width: 70, align: 'right', sort: (value, row) => row.signal ?? -999 },
  { id: 'tx', label: 'Tx Rate', width: 80, align: 'right', sort: (value, row) => row.txRate ?? 0 },
  { id: 'rx', label: 'Rx Rate', width: 80, align: 'right', sort: (value, row) => row.rxRate ?? 0 },
  { id: 'uptime', label: 'Uptime', width: 90, sort: (value, row) => row.connected ?? 0 },
  { id: 'hostname', label: 'Host Name', width: 120 }
 ],
 flagLegend: {},
 defaultSort: null,
 rows(data) {
  const names = new Map((data.leases?.dhcp_leases ?? []).map(lease => [String(lease.macaddr).toUpperCase(), lease.hostname]));
  const rows = [];
  for (const [ifname, entry] of Object.entries(data.wifi ?? {})) {
   if (entry.info?.mode !== 'Master') continue;
   for (const station of entry.stations ?? []) {
    const mac = String(station.mac).toUpperCase();
    rows.push({
     key: `${ifname}:${mac}`, readOnly: true, signal: station.signal, txRate: station.tx?.rate, rxRate: station.rx?.rate, connected: station.connected_time,
     cells: { mac, interface: ifname, ssid: entry.info.ssid ?? '', signal: `${station.signal} dBm`, tx: bitrate((station.tx?.rate ?? 0) * 1000), rx: bitrate((station.rx?.rate ?? 0) * 1000), uptime: uptime(station.connected_time), hostname: names.get(mac) ?? '' }
    });
   }
  }
  return rows;
 },
 itemTitle: row => `Registration <${row.cells.mac}>`,
 fields: () => wifiRegistration.columns.map(column => ({ id: column.id, label: column.label, type: 'static' })),
 values: row => ({ ...row.cells })
};
