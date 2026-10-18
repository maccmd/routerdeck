# Changelog

## Unreleased

### RouterDeck Console (experimental)

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

### Navigation and windows

- Move windows into the theme on every page. Menu labels navigate normally;
  adjacent window buttons open or focus a window. The former Workspace package
  now redirects old bookmarks to Overview and has no menu entry.
- Add interface/device/zone editors, routing and client detail cards, related
  pages and address diagnostics through permitted native LuCI routes.
- Automatically arrange visible windows on open, close, minimize and restore;
  add edge/corner snapping, layout controls and a shared column divider.
- Keep the sidebar and header accessible during dragging and maximization;
  persist window positions and sidebar width without reloading edited forms.
- Present native object editors directly inside their RouterDeck window with
  one title, a scrolling form and a persistent Save/Dismiss footer.
- Add page-specific menu icons, preserved navigation scroll and bounded menu
  loading retries with an explicit Retry action after failure.

### Fixes

- Update dashboard values, chart paths and table rows in place so polling
  preserves scroll, focus and contextual links.
- Improve login layout, button contrast/spacing, split-button actions,
  field/button alignment and native modal action visibility.
- Prevent username autofill from populating menu search on password pages.
- Remove duplicate checkbox/radio decoration and preserve dependency-hidden
  native fields on mobile.
- Extend preview and native window regression coverage; document current-source
  behavior separately from the published v0.1.0 validation baseline.

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
