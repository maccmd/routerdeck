// SPDX-License-Identifier: Apache-2.0
// Window models by id.
import interfaces from './interfaces.js';
import networks from './networks.js';
import addresses from './addresses.js';
import { routes, routes6 } from './routes.js';
import addresses6 from './addresses6.js';
import { bridges, bridgePorts, bridgeVlans } from './bridge.js';
import log from './log.js';
import { filterRules, natRules, zones, connections, addressLists } from './firewall.js';
import { servers, leases, bindings6, dhcpNetworks, dhcpOptions } from './dhcp.js';
import { ethernet, vlans, wireguard, wireguardPeers } from './ports.js';
import { routingRules } from './routing.js';
import { arp, neighbors6, ipServices } from './services.js';
import { upnpSettings, upnpMappings, upnpRules, ddnsServices, sqmQueues } from './extras.js';
import { netwatch, wakeOnLan } from './tools.js';
import { dnsSettings, dnsStatic } from './dns.js';
import { wifiInterfaces, wifiRadios, wifiRegistration } from './wireless.js';
import { pppClients } from './ppp.js';
import { quickSet } from './quickset.js';
import { users, certificates, trustedCertificates, leds, disks, mounts, swaps, mountSettings } from './admin.js';
import { systemIdentity, systemClock, ntpClient, systemLogging, systemPassword, packages, packageInstall, scheduler, scripts, scriptJobs, startup, resources, backup, firmware } from './system.js';

export const MODELS = Object.fromEntries([users, certificates, trustedCertificates, leds, disks, mounts, swaps, mountSettings, netwatch, wakeOnLan, upnpSettings, upnpMappings, upnpRules, ddnsServices, sqmQueues, ethernet, vlans, wireguard, wireguardPeers, addressLists, dhcpNetworks, dhcpOptions, routingRules, arp, neighbors6, ipServices, interfaces, networks, addresses, routes, addresses6, routes6, bridges, bridgePorts, bridgeVlans, filterRules, natRules, connections, zones, servers, leases, bindings6, dnsSettings, dnsStatic, wifiInterfaces, wifiRadios, wifiRegistration, pppClients, quickSet, systemIdentity, systemClock, ntpClient, systemLogging, systemPassword, packages, packageInstall, scheduler, scripts, scriptJobs, startup, resources, backup, firmware, log].map(model => [model.id, model]));
