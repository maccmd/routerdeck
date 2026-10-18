// SPDX-License-Identifier: Apache-2.0
// System settings kept in /etc/config/system.
import { sections, invalid } from './common.js';

const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,62})$/;

// The router's name, as RouterOS calls it: the host name.
export const systemIdentity = {
 id: 'system-identity',
 noun: 'Identity',
 singleton: true,
 sources: ['uci:system'],
 rows: data => sections(data['uci:system'], 'system').slice(0, 1).map(section => ({ key: section['.name'], section: section['.name'] })),
 itemTitle: () => 'Identity',
 itemStatus: () => [],
 fields: () => [{ id: 'name', label: 'Name', type: 'text' }],
 values: (row, data) => ({ name: sections(data['uci:system'], 'system').find(section => section['.name'] === row.section)?.hostname ?? '' }),
 save(values, row) {
  if (!HOSTNAME.test(values.name)) invalid('name', 'Use letters, digits and hyphens, up to 63 characters');
  return { description: `Set identity ${values.name}`, ops: [{ op: 'set', config: 'system', section: row.section, values: { hostname: values.name } }] };
 }
};
