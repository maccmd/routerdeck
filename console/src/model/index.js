// SPDX-License-Identifier: Apache-2.0
// Window models by id.
import interfaces from './interfaces.js';
import networks from './networks.js';
import addresses from './addresses.js';
import { routes, routes6 } from './routes.js';
import addresses6 from './addresses6.js';
import { bridges, bridgePorts, bridgeVlans } from './bridge.js';
import log from './log.js';
import { filterRules, natRules, zones, connections } from './firewall.js';
import { servers, leases } from './dhcp.js';

export const MODELS = Object.fromEntries([interfaces, networks, addresses, routes, addresses6, routes6, bridges, bridgePorts, bridgeVlans, filterRules, natRules, connections, zones, servers, leases, log].map(model => [model.id, model]));
