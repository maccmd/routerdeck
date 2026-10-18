// SPDX-License-Identifier: Apache-2.0
// Helpers shared by window models (descriptors). A model turns ubus/UCI
// snapshots into list rows and turns form values back into UCI operations.

export const NAME = /^[A-Za-z0-9_]+$/;

export class ValidationError extends Error {
 constructor(field, message) {
  super(message);
  this.name = 'ValidationError';
  this.field = field;
 }
}

export const invalid = (field, message) => { throw new ValidationError(field, message); };

export function sections(values, type) {
 return Object.values(values ?? {}).filter(section => section['.type'] === type).sort((a, b) => a['.index'] - b['.index']);
}

export function allSections(values) {
 return Object.values(values ?? {}).sort((a, b) => a['.index'] - b['.index']);
}

export function truthy(value, fallback = false) {
 if (value == null || value === '') return fallback;
 return ['1', 'yes', 'on', 'true', 'enabled'].includes(String(value).toLowerCase());
}

// UCI options may hold one value, a space-separated string or a list.
export function list(value) {
 if (value == null || value === '') return [];
 return Array.isArray(value) ? value.slice() : String(value).split(/\s+/).filter(Boolean);
}

export const text = value => value == null ? '' : Array.isArray(value) ? value.join(' ') : String(value);

// Empty strings remove an option; the backend treats null the same way.
export function compact(values) {
 return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? value : value === '' || value == null ? null : String(value)]));
}

export function changedValues(next, previous) {
 return Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(value ?? null) !== JSON.stringify(previous?.[key] ?? null)));
}

// The firewall zone(s) a logical interface belongs to.
export function zonesOf(firewall, network) {
 return sections(firewall, 'zone').filter(zone => list(zone.network).includes(network)).map(zone => zone.name);
}

export function zoneOptions(firewall, { any = false } = {}) {
 const zones = sections(firewall, 'zone').map(zone => ({ value: zone.name, label: zone.name }));
 return any ? [{ value: '*', label: 'any' }, ...zones] : zones;
}

export function networkOptions(network, filter = () => true) {
 return sections(network, 'interface').filter(filter).map(section => ({ value: section['.name'], label: section['.name'] }));
}

// fw4 names nftables rules after `option name`, else the section id.
export function counterKeys(firewall, types) {
 const keys = new Map(), seen = new Map();
 for (const type of types) {
  sections(firewall, type).forEach((section, index) => {
   const key = section.name ?? (section['.anonymous'] ? `@${type}[${index}]` : section['.name']);
   keys.set(section['.name'], key);
   seen.set(key, (seen.get(key) ?? 0) + 1);
  });
 }
 return { keys, ambiguous: key => (seen.get(key) ?? 0) > 1 };
}

// Reorder the sections of `types` to follow `orderedNames`, keeping every
// other section of the configuration where it is.
export function reorderOps(config, values, orderedNames, types) {
 const all = allSections(values).map(section => section['.name']);
 const movable = new Set(allSections(values).filter(section => types.includes(section['.type'])).map(section => section['.name']));
 const queue = orderedNames.filter(name => movable.has(name));
 queue.push(...all.filter(name => movable.has(name) && !queue.includes(name)));
 const result = all.map(name => movable.has(name) ? queue.shift() : name);
 return [{ op: 'order', config, sections: result }];
}

export const quoted = value => value ? ` ${value}` : '';

// The first IPv4 address of a network section as CIDR text, also for the
// legacy ipaddr + netmask form OpenWrt 24.10 still writes.
export function firstCidr(section) {
 const first = list(section?.ipaddr)[0];
 if (!first || first.includes('/')) return first ?? '';
 const bits = String(section.netmask ?? '').split('.').map(Number);
 if (bits.length !== 4 || bits.some(part => !(part >= 0 && part <= 255))) return first;
 const prefix = bits.reduce((count, part) => count + part.toString(2).replace(/0/g, '').length, 0);
 return `${first}/${prefix}`;
}
