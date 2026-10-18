// SPDX-License-Identifier: Apache-2.0
// Window models by id.
import interfaces from './interfaces.js';
import networks from './networks.js';
import addresses from './addresses.js';
import routes from './routes.js';
import log from './log.js';
import { filterRules, natRules, zones, connections } from './firewall.js';
import { servers, leases } from './dhcp.js';

export const MODELS = Object.fromEntries([interfaces, networks, addresses, routes, filterRules, natRules, connections, zones, servers, leases, log].map(model => [model.id, model]));
