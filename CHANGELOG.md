# Changelog

## Unreleased

### RouterDeck Console

- Add the separate `routerdeck-console` package, served at `/routerdeck/`, with
  an rpcd ACL and a `routerdeck` ucode plugin (`info`).
- Add a Preact client built with esbuild: ubus JSON-RPC login with batching and
  session-expiry recovery, a subsystem menu with flyouts, and MDI windows that
  open cascaded, move, resize, minimize and maximize inside the work area and
  restore with the session. Lists show their layout but no router data yet.
- Add a simulated `/ubus` endpoint to the preview server and unit/browser tests.
- Show live router data in object lists: interfaces and networks, addresses,
  routes, firewall filter/NAT/connections/zones, DHCP servers and leases, log;
  RouterOS-style flags, `;;; comment` lines, Find, sorting, column chooser,
  context menus and drag-and-drop rule order.
- Edit objects in windows with OK/Cancel/Apply/Disable/Comment/Copy/Remove;
  changes apply at once through the `routerdeck` rpcd plugin, which validates
  firewall changes with `fw4 check`, records a 100-entry Undo/Redo history and
  refuses to race LuCI's apply with rollback.
- Add Safe Mode with a procd watchdog that restores the snapshot when the
  console stops sending heartbeats, a ttyd terminal window, the Windows menu,
  a theme switch and RouterOS keyboard shortcuts.
- Add IPv6 > Addresses (static, prefix-assigned, DHCPv6 and link-local, with
  their pool and advertisement) and IPv6 > Routes (kernel and `route6`), and a
  Bridge window with bridges, ports (PVID, tagged VLANs) and bridge VLANs.
- Accept UCI section types with dashes such as `bridge-vlan` in the plugin.
- Add IP > DNS (dnsmasq settings and static A/AAAA/CNAME entries), DHCPv6
  bindings with Make Static, and Safe Mode takeover by another session.
- Add WiFi (interfaces, radios, registration table) and PPP client windows.
- Add Tools > Ping, Traceroute and Torch; Ping and Traceroute run as jobs
  outside rpcd so a slow probe never stalls other calls.
- Add Quick Set: Internet connection and NAT, LAN address and DHCP range, WiFi
  name and password, and identity as one change and one Undo step.
- New Terminal is now a RouterOS-style command line over the window models
  (print/find/add/set/remove/enable/disable/comment, export, ping, traceroute,
  undo, Tab completion, `?` help, history, Ctrl+X Safe Mode); the ttyd shell
  moved to New Shell.
- Fix focus being taken from a field the user already typed in when a window
  opens, and quick successive form edits overwriting each other.
- Add the System menu: Identity, Clock, NTP, Logging, Password, Packages,
  Scheduler (crontab, with Undo and Safe Mode), Startup (procd services),
  Resources, Backup download and Reboot.
- Add tabs and lists: Interfaces ▸ Ethernet, VLAN, WireGuard and peers; IP ▸
  ARP, Services, Firewall ▸ Address Lists, DHCP Networks and Options; IPv6 ▸
  Neighbors; Routing ▸ Rules.
- Add IP ▸ UPnP, IP ▸ Dynamic DNS and Queues ▸ SQM for routers with those
  packages.
- Add Tools ▸ Bandwidth Test (iperf3), IP Scan, Netwatch (a service on the
  router), Wake on LAN and Graphs, and a Traffic tab for interfaces.
- Undo/Redo carry a change over onto a file another program changed in other
  options; removed address-list entries leave nftables at once; changed
  WireGuard peers restart their interface.
- Install, upgrade and uninstall packages and check for updates (apk or
  opkg) as jobs with their output; add System ▸ Scripts with Run Script,
  running jobs and `run-script` for the scheduler and Netwatch; restore a
  backup after a check, flash firmware the router accepts, reset the
  configuration; add a Files window with uploads and downloads through cgi-io.
- Add System ▸ Users (rpcd logins with groups; passwords hashed with SHA-512
  crypt in the browser), Certificates (the web server's, ACME and trusted
  ones, parsed in the browser; regenerate, import, restore the previous),
  LEDs and Disks with mount points, swap and block-mount settings that mount
  and unmount at once.

### Removed

- Remove the LuCI theme and its companions (`luci-theme-routerdeck`,
  `luci-app-routerdeck`, `luci-app-routerdeck-workspace`), including the
  window and navigation work done on them after 0.1.0. RouterDeck is now only
  RouterDeck Console; the preview serves the console against the simulated
  router. [Installation](docs/installation.md#removing-the-old-luci-theme)
  shows how to remove the 0.1.0 packages from a router.

## 0.1.0 — 2026-10-16

- Installable OpenWrt LuCI dark/light theme with dynamic permitted navigation.
- Compact native forms, tables, modals and responsive mobile layout.
- Optional live system/network dashboard without a custom server API.
- Optional experimental multi-window workspace, geometry persistence, focus and
  conservative guards for unsaved forms and shared UCI changes.
- Bootstrap fallback and tested package installation/removal workflow.
- Local simulated preview, Playwright checks, isolated ARM OpenWrt guests.
- Official SDK APK/IPK builds, GitHub CI, Apache-2.0 source and bilingual README.

This is a prerelease. FriendlyWrt/NanoPi hardware, thermal sensors, CPU usage
percentage, WireGuard peer handshakes and arbitrary extension forms need further
validation or implementation.
