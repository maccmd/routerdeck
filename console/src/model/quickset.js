// SPDX-License-Identifier: Apache-2.0
// Quick Set: the settings a home router needs on one form, applied as one
// change and undone in one step: the Internet connection, the LAN address
// and its DHCP server, the WiFi name and password, and the router's name.
// It edits the `wan` and `lan` networks of OpenWrt's default layout.
import { sections, truthy, list, invalid, compact } from './common.js';
import { parseCidr, maskToPrefix, parseIPv4, formatIPv4, isIPv4, canonicalIPv6 } from '../lib/ip.js';

const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,62})$/;
const WAN_PROTOS = [{ value: 'dhcp', label: 'Automatic (DHCP)' }, { value: 'static', label: 'Static' }, { value: 'pppoe', label: 'PPPoE' }];
const needsKey = encryption => !['none', 'owe', ''].includes(encryption ?? 'none');

function cidrOf(section) {
 const first = list(section?.ipaddr)[0];
 if (!first) return '';
 if (first.includes('/')) return first;
 return `${first}/${(section.netmask ? maskToPrefix(section.netmask) : null) ?? 32}`;
}

function parts(data) {
 const network = data['uci:network'], firewall = data['uci:firewall'], wireless = data['uci:wireless'];
 const named = name => sections(network, 'interface').find(section => section['.name'] === name);
 const aps = sections(wireless, 'wifi-iface').filter(section => (section.mode ?? 'ap') === 'ap' && list(section.network).includes('lan'));
 return {
  wan: named('wan'), lan: named('lan'), aps,
  radios: sections(wireless, 'wifi-device').filter(radio => aps.some(ap => ap.device === radio['.name'])),
  wanZone: sections(firewall, 'zone').find(zone => list(zone.network).includes('wan')),
  server: sections(data['uci:dhcp'], 'dhcp').find(section => section.interface === 'lan'),
  system: sections(data['uci:system'], 'system')[0]
 };
}

function pool(lanCidr, server) {
 const cidr = parseCidr(lanCidr);
 if (!cidr || !server) return '';
 const base = parseIPv4(cidr.network), start = Number(server.start ?? 100), limit = Number(server.limit ?? 150);
 return `${formatIPv4(base + start)}-${formatIPv4(base + start + limit - 1)}`;
}

export const quickSet = {
 id: 'quick-set',
 noun: 'Quick Set',
 singleton: true,
 sources: ['uci:network', 'uci:firewall', 'uci:dhcp', 'uci:wireless', 'uci:system', 'ifaces'],
 rows: data => parts(data).lan ? [{ key: 'quick-set', section: 'lan' }] : [],
 itemTitle: () => 'Quick Set',
 itemStatus: () => ['one change, one Undo step'],
 fields(data) {
  const { wan, aps, wanZone, server, system } = parts(data);
  const live = (data.ifaces ?? []).find(item => item.interface === 'wan');
  const current = live?.up ? [live['ipv4-address']?.[0] && `${live['ipv4-address'][0].address}/${live['ipv4-address'][0].mask}`, live.route?.find(route => route.target === '0.0.0.0')?.nexthop && `via ${live.route.find(route => route.target === '0.0.0.0').nexthop}`].filter(Boolean).join(' ') || 'up, no IPv4 address' : 'down';
  return [
   { id: 'noWan', tab: 'Internet', label: 'Internet', type: 'static', value: () => 'This router has no network named wan', visible: () => !wan },
   { id: 'wanProto', tab: 'Internet', label: 'Address Acquisition', type: 'select', options: WAN_PROTOS, visible: () => !!wan },
   { id: 'wanAddress', tab: 'Internet', label: 'IP Address', type: 'text', placeholder: '203.0.113.2/24', visible: values => !!wan && values.wanProto === 'static' },
   { id: 'wanGateway', tab: 'Internet', label: 'Gateway', type: 'text', placeholder: '203.0.113.1', visible: values => !!wan && values.wanProto === 'static' },
   { id: 'wanDns', tab: 'Internet', label: 'DNS Servers', type: 'list', visible: values => !!wan && values.wanProto === 'static' },
   { id: 'pppUser', tab: 'Internet', label: 'PPPoE User', type: 'text', visible: values => !!wan && values.wanProto === 'pppoe' },
   { id: 'pppPassword', tab: 'Internet', label: 'PPPoE Password', type: 'password', visible: values => !!wan && values.wanProto === 'pppoe' },
   { id: 'wanNow', tab: 'Internet', label: 'Now', type: 'static', value: () => current, visible: () => !!wan },
   { id: 'nat', tab: 'Internet', label: 'NAT', type: 'bool', visible: () => !!wanZone },
   { id: 'lanAddress', tab: 'Local Network', label: 'IP Address', type: 'text', placeholder: '192.168.88.1/24' },
   { id: 'dhcpServer', tab: 'Local Network', label: 'DHCP Server', type: 'bool', visible: () => !!server },
   { id: 'dhcpRange', tab: 'Local Network', label: 'DHCP Server Range', type: 'text', placeholder: '192.168.88.100-192.168.88.249', visible: values => !!server && values.dhcpServer },
   { id: 'lanNote', tab: 'Local Network', label: '', type: 'note',
     value: () => 'A new address moves this console. Turn on Safe Mode first, then open the new address and take Safe Mode over to keep the change; otherwise it is undone after two minutes.' },
   { id: 'ssid', tab: 'WiFi', label: 'Network Name', type: 'text', visible: () => aps.length > 0 },
   { id: 'wifiKey', tab: 'WiFi', label: 'WiFi Password', type: 'password', visible: () => aps.length > 0 },
   { id: 'wifiEnabled', tab: 'WiFi', label: 'WiFi Enabled', type: 'bool', visible: () => aps.length > 0 },
   { id: 'wifiTargets', tab: 'WiFi', label: 'Access Points', type: 'static', value: () => aps.map(ap => `${ap.ssid ?? ap['.name']} on ${ap.device}`).join(', '), visible: () => aps.length > 0 },
   { id: 'hostname', tab: 'System', label: 'Router Identity', type: 'text', visible: () => !!system }
  ];
 },
 values(row, data) {
  const { wan, lan, aps, radios, wanZone, server, system } = parts(data);
  return {
   wanProto: ['dhcp', 'static', 'pppoe'].includes(wan?.proto) ? wan.proto : wan?.proto ?? 'dhcp',
   wanAddress: wan?.proto === 'static' ? cidrOf(wan) : '', wanGateway: wan?.gateway ?? '', wanDns: list(wan?.dns),
   pppUser: wan?.username ?? '', pppPassword: wan?.password ?? '', nat: truthy(wanZone?.masq),
   lanAddress: cidrOf(lan), dhcpServer: !!server && !truthy(server.ignore), dhcpRange: pool(cidrOf(lan), server),
   ssid: aps[0]?.ssid ?? '', wifiKey: aps[0]?.key ?? '',
   wifiEnabled: aps.some(ap => !truthy(ap.disabled)) && radios.some(radio => !truthy(radio.disabled)),
   hostname: system?.hostname ?? ''
  };
 },
 save(values, row, data, { dirty = null } = {}) {
  const { wan, lan, aps, radios, wanZone, server, system } = parts(data);
  const changed = (...ids) => ids.some(id => !dirty || dirty.has(id));
  const ops = [], summary = [];
  let notice = null;

  if (wan && changed('wanProto', 'wanAddress', 'wanGateway', 'wanDns', 'pppUser', 'pppPassword')) {
   const wasStatic = wan.proto === 'static';
   const clear = { ipaddr: null, netmask: null, gateway: null, ...(wasStatic ? { dns: null } : {}), username: null, password: null };
   if (values.wanProto === 'static') {
    const cidr = parseCidr(values.wanAddress, { requirePrefix: true });
    if (!cidr || cidr.prefix < 1 || cidr.prefix > 32) invalid('wanAddress', 'Enter the address with a prefix, for example 203.0.113.2/24');
    if (!isIPv4(values.wanGateway)) invalid('wanGateway', 'Enter the gateway address your provider gave you');
    if (cidr.prefix < 31 && parseCidr(`${values.wanGateway}/${cidr.prefix}`).network !== cidr.network) invalid('wanGateway', `The gateway must be in ${cidr.network}/${cidr.prefix}`);
    for (const server of values.wanDns ?? []) if (!isIPv4(server) && !canonicalIPv6(server)) invalid('wanDns', `${server} is not an address`);
    ops.push({ op: 'set', config: 'network', section: 'wan', values: { ...clear, proto: 'static', ipaddr: cidr.cidr, gateway: values.wanGateway, dns: values.wanDns?.length ? values.wanDns : null } });
    summary.push(`Internet static ${cidr.cidr}`);
   } else if (values.wanProto === 'pppoe') {
    if (!values.pppUser) invalid('pppUser', 'PPPoE needs the user name from your provider');
    ops.push({ op: 'set', config: 'network', section: 'wan', values: { ...clear, proto: 'pppoe', ...compact({ username: values.pppUser, password: values.pppPassword }) } });
    summary.push('Internet PPPoE');
   } else if (values.wanProto === 'dhcp') {
    ops.push({ op: 'set', config: 'network', section: 'wan', values: { ...clear, proto: 'dhcp' } });
    summary.push('Internet DHCP');
   } else invalid('wanProto', 'Choose how the router gets its Internet address');
  }
  if (wanZone && changed('nat')) {
   ops.push({ op: 'set', config: 'firewall', section: wanZone['.name'], values: { masq: values.nat ? '1' : null } });
   summary.push(values.nat ? 'NAT on' : 'NAT off');
  }

  const lanCidr = parseCidr(values.lanAddress, { requirePrefix: true });
  if (changed('lanAddress')) {
   if (!lanCidr || lanCidr.prefix < 8 || lanCidr.prefix > 30) invalid('lanAddress', 'Enter the address with a prefix from /8 to /30, for example 192.168.88.1/24');
   const size = 2 ** (32 - lanCidr.prefix), offset = parseIPv4(lanCidr.address) - parseIPv4(lanCidr.network);
   if (offset === 0 || offset === size - 1) invalid('lanAddress', `${lanCidr.address} is the network or broadcast address of ${lanCidr.network}/${lanCidr.prefix}`);
   // Further addresses of the LAN stay as they are.
   const rest = list(lan.ipaddr).slice(1).map(entry => entry.includes('/') || !lan.netmask ? entry : `${entry}/${maskToPrefix(lan.netmask)}`);
   ops.push({ op: 'set', config: 'network', section: 'lan', values: { ipaddr: Array.isArray(lan.ipaddr) || rest.length ? [lanCidr.cidr, ...rest] : lanCidr.cidr, netmask: null } });
   summary.push(`LAN ${lanCidr.cidr}`);
   notice = `The LAN address is now ${lanCidr.address}. Continue at http://${lanCidr.address}/routerdeck/`;
  }
  if (server && changed('dhcpServer', 'dhcpRange')) {
   const options = { ignore: values.dhcpServer ? null : '1' };
   if (values.dhcpServer && changed('dhcpRange')) {
    const [first, last] = String(values.dhcpRange ?? '').split('-').map(item => item.trim());
    const network = lanCidr ?? parseCidr(cidrOf(lan));
    const inside = address => isIPv4(address) && parseCidr(`${address}/${network.prefix}`).network === network.network;
    if (!inside(first) || !inside(last) || parseIPv4(first) > parseIPv4(last)) invalid('dhcpRange', `Enter a range inside ${network.network}/${network.prefix}, for example ${pool(network.cidr, { start: 100, limit: 150 })}`);
    options.start = String(parseIPv4(first) - parseIPv4(network.network));
    options.limit = String(parseIPv4(last) - parseIPv4(first) + 1);
   }
   ops.push({ op: 'set', config: 'dhcp', section: server['.name'], values: options });
   summary.push(values.dhcpServer ? 'DHCP server' : 'DHCP server off');
  }

  if (aps.length && changed('ssid')) {
   if (!values.ssid || new TextEncoder().encode(values.ssid).length > 32) invalid('ssid', 'A network name has 1 to 32 bytes');
   for (const ap of aps) ops.push({ op: 'set', config: 'wireless', section: ap['.name'], values: { ssid: values.ssid } });
   summary.push(`WiFi ${values.ssid}`);
  }
  if (aps.length && changed('wifiKey')) {
   if (!(values.wifiKey.length >= 8 && values.wifiKey.length <= 63)) invalid('wifiKey', 'A WiFi password has 8 to 63 characters');
   // An open network becomes WPA2; WPA3 and mixed modes keep their security.
   for (const ap of aps) ops.push({ op: 'set', config: 'wireless', section: ap['.name'], values: { key: values.wifiKey, ...(needsKey(ap.encryption) ? {} : { encryption: 'psk2' }) } });
   summary.push('WiFi password');
  }
  if (aps.length && changed('wifiEnabled')) {
   for (const ap of aps) ops.push({ op: 'set', config: 'wireless', section: ap['.name'], values: { disabled: values.wifiEnabled ? null : '1' } });
   if (values.wifiEnabled) for (const radio of radios) if (truthy(radio.disabled)) ops.push({ op: 'set', config: 'wireless', section: radio['.name'], values: { disabled: null } });
   summary.push(values.wifiEnabled ? 'WiFi on' : 'WiFi off');
  }

  if (system && changed('hostname')) {
   if (!HOSTNAME.test(values.hostname)) invalid('hostname', 'Use letters, digits and hyphens, up to 63 characters');
   ops.push({ op: 'set', config: 'system', section: system['.name'], values: { hostname: values.hostname } });
   summary.push(`identity ${values.hostname}`);
  }
  return ops.length ? { description: `Quick Set: ${summary.join(', ')}`, ops, notice } : null;
 }
};
