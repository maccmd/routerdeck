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
const psk = encryption => /psk|sae/.test(encryption ?? '');

// Roaming (802.11r/k/v), management frame protection, limits and the MAC
// filter of an access point.
const ADVANCED_IFACE = [
 { id: 'ieee80211r', label: 'Fast Roaming (802.11r)', type: 'bool', tab: 'Roaming' },
 { id: 'mobility_domain', label: 'Mobility Domain', type: 'text', placeholder: '4f57', tab: 'Roaming', visible: values => values.ieee80211r },
 { id: 'ft_over_ds', label: 'Roam Over the Wire', type: 'bool', tab: 'Roaming', visible: values => values.ieee80211r },
 { id: 'ft_psk_generate_local', label: 'Generate Keys Locally', type: 'bool', tab: 'Roaming', visible: values => values.ieee80211r && psk(values.encryption) },
 { id: 'ieee80211k', label: 'Radio Measurement (802.11k)', type: 'bool', tab: 'Roaming' },
 { id: 'bss_transition', label: 'BSS Transition (802.11v)', type: 'bool', tab: 'Roaming' },
 { id: 'ieee80211w', label: 'Management Frame Protection', type: 'select', options: [['', 'default'], ['0', 'disabled'], ['1', 'optional'], ['2', 'required']].map(([value, label]) => ({ value, label })) },
 { id: 'maxassoc', label: 'Max Clients', type: 'number', placeholder: 'no limit' },
 { id: 'max_inactivity', label: 'Inactivity Timeout (s)', type: 'number', placeholder: '300' },
 { id: 'disassoc_low_ack', label: 'Drop Clients on Low ACK', type: 'bool' },
 { id: 'wmm', label: 'WMM', type: 'bool' },
 { id: 'dtim_period', label: 'DTIM Interval', type: 'number', placeholder: '2' },
 { id: 'wpa_group_rekey', label: 'Group Key Interval (s)', type: 'number', placeholder: '600', visible: values => needsKey(values.encryption) },
 { id: 'macfilter', label: 'MAC Filter', type: 'select', tab: 'Access List', options: [['', 'off'], ['allow', 'allow only listed'], ['deny', 'deny listed']].map(([value, label]) => ({ value, label })) },
 { id: 'maclist', label: 'MAC Addresses', type: 'list', tab: 'Access List', visible: values => !!values.macfilter }
];

function advancedValues(section) {
 return {
  ieee80211r: truthy(section.ieee80211r), mobility_domain: section.mobility_domain ?? '', ft_over_ds: truthy(section.ft_over_ds), ft_psk_generate_local: truthy(section.ft_psk_generate_local),
  ieee80211k: truthy(section.ieee80211k), bss_transition: truthy(section.bss_transition), ieee80211w: section.ieee80211w ?? '', maxassoc: section.maxassoc ?? '',
  max_inactivity: section.max_inactivity ?? '', disassoc_low_ack: truthy(section.disassoc_low_ack, true), wmm: truthy(section.wmm, true), dtim_period: section.dtim_period ?? '',
  wpa_group_rekey: section.wpa_group_rekey ?? '', macfilter: ['allow', 'deny'].includes(section.macfilter) ? section.macfilter : '', maclist: list(section.maclist)
 };
}

const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
function advancedOptions(values) {
 if (values.ieee80211r && values.mobility_domain && !/^[0-9a-fA-F]{4}$/.test(values.mobility_domain)) invalid('mobility_domain', 'Four hexadecimal digits, the same on every access point of the network');
 for (const [id, low, high] of [['maxassoc', 1, 2007], ['max_inactivity', 10, 86400], ['dtim_period', 1, 255], ['wpa_group_rekey', 0, 86400]]) {
  if (values[id] && !(/^\d+$/.test(values[id]) && Number(values[id]) >= low && Number(values[id]) <= high)) invalid(id, `${low} to ${high}`);
 }
 const macs = (values.maclist ?? []).map(mac => mac.trim().toLowerCase()).filter(Boolean);
 const bad = macs.find(mac => !MAC.test(mac));
 if (bad) invalid('maclist', `${bad} is not a MAC address`);
 return {
  ieee80211r: values.ieee80211r ? '1' : '', mobility_domain: values.ieee80211r ? values.mobility_domain : '', ft_over_ds: values.ieee80211r ? (values.ft_over_ds ? '1' : '0') : '',
  ft_psk_generate_local: values.ieee80211r && values.ft_psk_generate_local ? '1' : '', ieee80211k: values.ieee80211k ? '1' : '', bss_transition: values.bss_transition ? '1' : '',
  ieee80211w: values.ieee80211w, maxassoc: values.maxassoc, max_inactivity: values.max_inactivity, disassoc_low_ack: values.disassoc_low_ack === false ? '0' : '',
  wmm: values.wmm === false ? '0' : '', dtim_period: values.dtim_period, wpa_group_rekey: values.wpa_group_rekey,
  macfilter: values.macfilter, maclist: values.macfilter ? [...new Set(macs)] : []
 };
}

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
  ...ADVANCED_IFACE.map(field => ({ ...field, tab: field.tab ?? 'Advanced', visible: values => values.mode === 'ap' && (field.visible?.(values) ?? true) })),
  { id: 'channel', label: 'Channel', type: 'static', tab: 'Status' },
  { id: 'bssid', label: 'BSSID', type: 'static', tab: 'Status' },
  { id: 'clients', label: 'Clients', type: 'static', tab: 'Status' }
 ],
 values(row, data) {
  const section = sections(data['uci:wireless'], 'wifi-iface').find(item => item['.name'] === row.section) ?? {};
  return {
   ssid: section.ssid ?? '', mode: section.mode ?? 'ap', device: section.device ?? '', network: list(section.network), encryption: section.encryption ?? 'none', key: section.key ?? '',
   hidden: truthy(section.hidden), isolate: truthy(section.isolate), channel: row.cells.channel || '—', bssid: row.cells.bssid || '—', clients: row.cells.clients || '—',
   ...advancedValues(section)
  };
 },
 defaults: data => ({ ssid: '', mode: 'ap', device: sections(data['uci:wireless'], 'wifi-device')[0]?.['.name'] ?? '', network: ['lan'], encryption: 'sae-mixed', key: '', hidden: false, isolate: false, ...advancedValues({}) }),

 save(values, row, data, { dirty = null } = {}) {
  if (!values.ssid || new TextEncoder().encode(values.ssid).length > 32) invalid('ssid', 'An SSID has 1 to 32 bytes');
  if (!values.device) invalid('device', 'Choose a radio');
  if (needsKey(values.encryption) && !(values.key.length >= 8 && values.key.length <= 63)) invalid('key', 'A passphrase has 8 to 63 characters');
  const advanced = values.mode === 'ap' ? advancedOptions(values) : {};
  const options = compact({
   ssid: values.ssid, mode: values.mode, device: values.device, network: values.network ?? [], encryption: values.encryption,
   key: needsKey(values.encryption) ? values.key : '', hidden: values.mode === 'ap' && values.hidden ? '1' : '', isolate: values.mode === 'ap' && values.isolate ? '1' : '',
   ...advanced
  });
  // A new access point gets only the advanced options that were set.
  const added = Object.fromEntries(Object.entries(options).filter(([key, value]) => !(key in advanced) || (value !== null && !(Array.isArray(value) && !value.length))));
  if (!row) return { description: `Add WiFi ${values.mode === 'sta' ? 'client' : 'network'} ${values.ssid}`, ops: [{ op: 'add', config: 'wireless', type: 'wifi-iface', values: added }] };
  const related = { key: ['encryption'], encryption: ['key'], mobility_domain: ['ieee80211r'], ft_over_ds: ['ieee80211r'], ft_psk_generate_local: ['ieee80211r'], maclist: ['macfilter'] };
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
  { id: 'beacon_int', label: 'Beacon Interval (TU)', type: 'number', placeholder: '100', tab: 'Advanced' },
  { id: 'rts', label: 'RTS Threshold', type: 'number', placeholder: 'off', tab: 'Advanced' },
  { id: 'frag', label: 'Fragmentation', type: 'number', placeholder: 'off', tab: 'Advanced' },
  { id: 'distance', label: 'Distance (m)', type: 'number', placeholder: 'auto', tab: 'Advanced' },
  { id: 'cell_density', label: 'Cell Density', type: 'select', tab: 'Advanced', options: [['', 'disabled'], ['1', 'normal'], ['2', 'high'], ['3', 'very high']].map(([value, label]) => ({ value, label })) },
  { id: 'legacy_rates', label: 'Legacy 802.11b Rates', type: 'bool', tab: 'Advanced' },
  { id: 'noscan', label: 'Ignore Overlapping Networks', type: 'bool', tab: 'Advanced' },
  { id: 'hardware', label: 'Hardware', type: 'static', tab: 'Status' },
  { id: 'hwmodes', label: 'Modes', type: 'static', tab: 'Status', value: () => row?.info?.hwmodes_text ?? '—' }
 ],
 values(row, data) {
  const radio = sections(data['uci:wireless'], 'wifi-device').find(item => item['.name'] === row.section) ?? {};
  return {
   band: radio.band ?? '2g', channel: radio.channel ?? 'auto', htmode: radio.htmode ?? '', country: radio.country ?? '', txpower: radio.txpower ?? '', hardware: row.cells.hardware,
   beacon_int: radio.beacon_int ?? '', rts: radio.rts ?? '', frag: radio.frag ?? '', distance: radio.distance ?? '', cell_density: ['1', '2', '3'].includes(radio.cell_density) ? radio.cell_density : '', legacy_rates: truthy(radio.legacy_rates), noscan: truthy(radio.noscan)
  };
 },
 save(values, row, data, { dirty = null } = {}) {
  if (!(values.channel === 'auto' || /^\d{1,3}$/.test(values.channel))) invalid('channel', 'Use auto or a channel number');
  const limits = { '2g': [1, 14], '5g': [32, 177], '6g': [1, 233], '60g': [1, 6] }[values.band];
  if (values.channel !== 'auto' && limits && !(Number(values.channel) >= limits[0] && Number(values.channel) <= limits[1])) invalid('channel', `Channels on ${BANDS[values.band]} are ${limits[0]}–${limits[1]}`);
  if (values.country && !/^[A-Z]{2}$|^00$/.test(values.country)) invalid('country', 'Use a two-letter country code such as US or DE');
  if (values.txpower && !(/^\d+$/.test(values.txpower) && values.txpower <= 30)) invalid('txpower', 'Tx power is a whole number of dBm up to 30');
  for (const [id, low, high] of [['beacon_int', 15, 65535], ['rts', 0, 2347], ['frag', 256, 2346], ['distance', 1, 114750]]) {
   if (values[id] && !(/^\d+$/.test(values[id]) && Number(values[id]) >= low && Number(values[id]) <= high)) invalid(id, `${low} to ${high}`);
  }
  const options = compact({
   band: values.band, channel: values.channel, htmode: values.htmode, country: values.country, txpower: values.txpower,
   beacon_int: values.beacon_int, rts: values.rts, frag: values.frag, distance: values.distance, cell_density: values.cell_density,
   legacy_rates: values.legacy_rates ? '1' : '', noscan: values.noscan ? '1' : ''
  });
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

// The MAC filter of each access point, one row per listed address. OpenWrt
// keeps one policy per access point (allow only listed, or deny listed), so
// an entry's action is its access point's policy.
export const wifiAccessList = {
 id: 'wifi-access-list',
 noun: 'Access List Entry',
 sources: ['uci:wireless', 'wireless', 'wifi'],
 columns: [
  { id: 'flags', label: '', width: 30 },
  { id: 'mac', label: 'MAC Address', width: 140 },
  { id: 'interface', label: 'Interface', width: 160 },
  { id: 'action', label: 'Action', width: 80 },
  { id: 'connected', label: 'Connected', width: 80 }
 ],
 flagLegend: { X: 'MAC filter off on this interface', C: 'connected now' },
 defaultSort: null,
 status: () => 'An access point either allows only the listed clients or denies them',
 rows(data) {
  const rows = [];
  for (const section of sections(data['uci:wireless'], 'wifi-iface').filter(item => (item.mode ?? 'ap') === 'ap')) {
   const live = runtimeOf(data, section['.name']);
   const policy = section.macfilter ?? 'disable';
   for (const mac of list(section.maclist)) {
    const connected = (live.stations ?? []).some(station => station.mac?.toLowerCase() === mac.toLowerCase());
    rows.push({
     key: `${section['.name']}|${mac}`, section: section['.name'], mac: mac.toLowerCase(), disabled: policy === 'disable',
     flags: (policy === 'disable' ? 'X' : '') + (connected ? 'C' : ''),
     cells: { mac: mac.toLowerCase(), interface: section.ssid ?? section['.name'], action: policy === 'disable' ? '' : policy, connected: connected ? 'yes' : '' }
    });
   }
  }
  return rows;
 },
 itemTitle: row => `Access List <${row?.cells.mac ?? 'new'}>`,
 itemStatus: row => [row.cells.action || 'filter off'],
 canAdd: data => sections(data['uci:wireless'], 'wifi-iface').some(item => (item.mode ?? 'ap') === 'ap'),
 canRemove: () => true,
 fields: data => [
  { id: 'mac', label: 'MAC Address', type: 'text', placeholder: '00:11:22:33:44:55' },
  { id: 'iface', label: 'Interface', type: 'select', options: sections(data['uci:wireless'], 'wifi-iface').filter(item => (item.mode ?? 'ap') === 'ap').map(item => ({ value: item['.name'], label: item.ssid ?? item['.name'] })) },
  { id: 'action', label: 'Action', type: 'select', options: [{ value: 'allow', label: 'allow (only listed clients connect)' }, { value: 'deny', label: 'deny' }] },
  { id: 'note', label: '', type: 'note', value: values => values.action === 'allow' ? 'With allow, every client not on the list of this access point is refused, this computer included if it uses this WiFi.' : 'Listed clients cannot connect to this access point.' }
 ],
 values: (row, data) => ({ mac: row.mac, iface: row.section, action: data['uci:wireless'][row.section]?.macfilter === 'allow' ? 'allow' : 'deny' }),
 defaults: data => {
  const first = sections(data['uci:wireless'], 'wifi-iface').find(item => (item.mode ?? 'ap') === 'ap');
  return { mac: '', iface: first?.['.name'] ?? '', action: first?.macfilter === 'allow' ? 'allow' : 'deny' };
 },
 save(values, row, data) {
  const mac = String(values.mac ?? '').trim().toLowerCase();
  if (!MAC.test(mac)) invalid('mac', 'Enter a MAC address such as 00:11:22:33:44:55');
  const target = data['uci:wireless'][values.iface];
  if (!target) invalid('iface', 'Choose the access point');
  const ops = [];
  // Moving an entry first takes it off its old access point.
  if (row && row.section !== values.iface) ops.push(...removeOps(data, [row]));
  const others = list(target.maclist).map(item => item.toLowerCase()).filter(item => item !== (row?.section === values.iface ? row.mac : null));
  const policy = target.macfilter ?? 'disable';
  if (policy !== 'disable' && policy !== values.action && others.length) invalid('action', `${target.ssid ?? values.iface} already ${policy === 'allow' ? 'allows only' : 'denies'} its listed clients; one access point has one policy`);
  if (others.includes(mac)) invalid('mac', `${mac} is already listed for ${target.ssid ?? values.iface}`);
  ops.push({ op: 'set', config: 'wireless', section: values.iface, values: { macfilter: values.action, maclist: [...others, mac] } });
  return { description: `${values.action === 'allow' ? 'Allow' : 'Deny'} ${mac} on ${target.ssid ?? values.iface}`, ops };
 },
 findCreated: (rows, values) => rows.find(row => row.section === values.iface && row.mac === String(values.mac).trim().toLowerCase()),
 remove: (rows, data) => ({ description: `Remove ${rows.map(row => row.mac).join(', ')} from the access list`, ops: removeOps(data, rows) })
};

// With its last entry gone, an access point stops filtering.
function removeOps(data, rows) {
 const bySection = new Map();
 for (const row of rows) bySection.set(row.section, [...(bySection.get(row.section) ?? []), row.mac]);
 return [...bySection].map(([section, macs]) => {
  const rest = list(data['uci:wireless'][section]?.maclist).filter(mac => !macs.includes(mac.toLowerCase()));
  return { op: 'set', config: 'wireless', section, values: rest.length ? { maclist: rest } : { maclist: null, macfilter: null } };
 });
}
