# Architecture

Current source as of 2026-10-18. RouterDeck is one OpenWrt package,
`routerdeck-console`. The primary target is OpenWrt 25.12; 24.10 is supported
too. Validation boundaries are in [Compatibility](compatibility.md).

## References

- The [WinBox overview](https://mikrotik.com/winbox) and RouterOS
  documentation informed the product direction: subsystem menus, object lists
  with flags, object windows, Safe Mode and the command-line syntax. No
  proprietary assets or code are reused.
- Official OpenWrt [25.12.5](https://downloads.openwrt.org/releases/25.12.5/targets/armsr/armv8/)
  and [24.10.8](https://downloads.openwrt.org/releases/24.10.8/targets/armsr/armv8/)
  ARM images and SDKs, whose rpcd, uhttpd, netifd, firewall4, dnsmasq, odhcpd
  and procd behaviour the console was checked against. Exact hashes are in
  `scripts/releases.json`.

## Client

The Preact client (`console/`, bundled by esbuild on the host) is served from
`/www/routerdeck` and calls rpcd through uhttpd's `/ubus` with a
`session login` session; nothing from LuCI is required. Calls made in the same
tick share one JSON-RPC batch; a shared poller loads each data source once per
interval for all windows and pauses while the page is hidden. An expired
session asks to log in again over the open windows.

Windows live in an MDI work area (`console/src/mdi`). The open windows, their
positions, columns, theme, tool settings and command history are kept in the
browser's local storage for the router's address; the session id stays in the
tab's session storage. Passwords and form values are never stored.

Window models (`console/src/model`) are plain descriptors: columns, flags,
which data sources they need, how runtime and UCI snapshots become rows, the
fields of the object form, and how form values become operations. The generic
list and object windows (`console/src/list`, `console/src/item`) work with any
model, so all windows behave alike. The command line (`console/src/cli`)
parses RouterOS-style commands and runs them through the same models, so a
command and the matching window produce identical operations.

Actions that are not configuration changes (rpcd calls such as `rc init`, a
password change, a backup download) are described by models as data and run
by `perform()` in `console/src/api/actions.js`, so models stay testable
without a router.

## Router side

The `routerdeck` ucode plugin (`/usr/share/rpcd/ucode/routerdeck`, helpers in
`/usr/share/ucode/routerdeck`) reads what the stock ubus objects do not
provide (routes, conntrack, counters, neighbours, jobs) and applies changes:
a private UCI delta directory, commit, a before/after `fw4 check` comparison,
`config.change` events and a 100-entry history for Undo/Redo in
`/var/run/routerdeck`. rpcd's own `uci apply` is not used: it commits every
staged change of the session, has one global rollback slot whose timeout cannot
be extended, and blocks all commits while armed. Undo and Redo merge at the
level of UCI options when another program changed other options of a file
since.

Safe Mode keeps its own snapshot; the `routerdeck-safemode` procd service
restores it when the client's heartbeats stop, so a pending rollback survives
an rpcd reload.

Ping, Traceroute, Bandwidth Test and IP Scan run as background jobs
(`/usr/libexec/routerdeck/diag`) because rpcd handles one call at a time; the
plugin's `diag` method starts, reads and stops them. Torch computes
per-connection rates in the client from two connection-tracking samples.
Netwatch is a procd service (`routerdeck-netwatch`) reading
`/etc/config/routerdeck`.

The ACL file `/usr/share/rpcd/acl.d/routerdeck-console.json` grants exactly
the objects, methods and UCI configurations the windows use; see
[Access and security](console.md#access-and-security).

See [RouterDeck Console](console.md) for behaviour, the object mapping and
limits.

## Packaging and licensing

The package uses the official `rules.mk`, `package.mk` and `BuildPackage`
macros. The SDK emits native APK v3 or IPK packages with dependencies and
lifecycle hooks; no archives are renamed to package extensions. Router-side
sources remain uncompiled ucode, avoiding bytecode coupling to the build
host's ucode version.

All RouterDeck code and the SVG mark are Apache-2.0. The console bundle
includes Preact and Preact Signals (MIT), with their notices in
`/www/routerdeck/licenses.txt`. No external fonts, CDN scripts, analytics or
telemetry are used.
