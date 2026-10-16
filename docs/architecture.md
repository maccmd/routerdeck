# Architecture and source research

Research date: 2026-10-16. Primary target: OpenWrt 25.12, with a separately tested
24.10 build. This repository intentionally separates the theme, monitoring app
and simulated preview.

## Owning sources inspected

- [LuCI 25.12, commit 75a306d](https://github.com/openwrt/luci/tree/75a306df84a020c57a631ef5b4c02ace56d93387): Bootstrap `header.ut`, `footer.ut`, `sysauth.ut`, `menu-bootstrap.js`; base `header.ut`, `footer.ut`, `luci.js`, `ui.js`, ACLs; status/system/network views and `luci.mk`.
- [Argon, commit 539e3e1](https://github.com/jerrykuku/luci-theme-argon/tree/539e3e1db56b2348c3655615540e45638b797c73): ucode theme templates, packaging, appearance architecture. Argon confirms that a ucode theme can preserve standard LuCI widgets while providing custom navigation and appearance. Its configuration, Lua code and assets were not copied.
- [Desktop, commit d99a6f0](https://github.com/doumeki/luci-theme-desktop/tree/d99a6f0100185bcbbb2176c99b3bf1d813a206fe): iframe window shell, bridge, menu and package architecture. It also carries a Lua compatibility dependency. RouterDeck does not adopt its controller, link interception or message bridge.
- [Official WinBox overview](https://mikrotik.com/winbox) and [WinBox 4 release description](https://forum.mikrotik.com/t/winbox-v4-0-1-released/268595): compact tables, left navigation, dark mode, window switching and workspaces informed the product direction. No proprietary assets or code are reused.
- Official OpenWrt [25.12.5](https://downloads.openwrt.org/releases/25.12.5/targets/armsr/armv8/) and [24.10.8](https://downloads.openwrt.org/releases/24.10.8/targets/armsr/armv8/) ARM images and SDKs. Exact hashes are in `scripts/releases.json`.

## Theme boundaries

`luci-theme-routerdeck` installs ucode templates under
`/usr/share/ucode/luci/template/themes/routerdeck` and web assets under
`/www/luci-static`. It depends on `luci-theme-bootstrap` and uses the installed
Bootstrap base CSS. A native HTML login form posts the standard `luci_username`
and `luci_password` fields to the original dispatcher, without waiting for a
JavaScript login view. The small theme header retains password and
initramfs warnings; the generic **LuCI** header/footer still initialize sessions,
tokens, rollback confirmation and the client runtime.

`menu-routerdeck.js` uses `ui.menu.load()` and `ui.menu.getChildren()` rather than
a hard-coded menu. It preserves alternate modes and nested tabs. Installed
applications, dependency checks and ACL filtering remain owned by LuCI. The
theme contains no ACL files, server handlers, UCI form replacements or polling
implementation for configuration changes.

Appearance lives in `localStorage` under `routerdeck.theme`. Access failures are
caught. Dynamic text uses text nodes; values are never concatenated into HTML.
No credentials, sessions or tokens are persisted by RouterDeck.

## Dashboard boundaries

`luci-app-routerdeck` contributes a menu entry and a regular LuCI `view`.
Its menu depends on the existing `luci-mod-status-index` ACL. It adds no grants
to rpcd, no shell commands and no custom HTTP API. Optional calls fail to an
unavailable state under restricted accounts.

| Value | Existing provider |
| --- | --- |
| Hostname/model/firmware/kernel | `system.board` |
| Uptime/load/RAM/filesystem | `system.info` |
| Interfaces/WAN | `network.interface.dump` |
| Interface counters | `luci-rpc.getNetworkDevices` |
| DHCP leases | `luci-rpc.getDHCPLeases` |
| Connection count | `file.read` of `nf_conntrack_count`, existing status ACL |

Traffic uses deltas of byte counters and monotonic elapsed time. The first
sample, counter resets, missing data and device changes produce gaps rather
than fictional rates. History is bounded to 60 samples. Polling pauses while
the page is hidden or a dashboard table has keyboard focus.

The dashboard's renderer is shared with preview, while its data adapter is only
used in LuCI. No fixture data is included in either router package. The app is
usable with Bootstrap, although RouterDeck provides its intended layout.

## Window extension

`luci-app-routerdeck-workspace` is separate from both the theme and dashboard.
It opens only exact same-origin view URLs from the ACL-filtered LuCI menu.
Each iframe keeps its own LuCI runtime, IDs, modal state and native session/CSRF
handling. The parent adds presentation styles and interaction guards; it does
not proxy requests, copy tokens, remove frame protections or patch LuCI globals.

The controller saves only allowed paths and geometry. It tracks input/change
activity conservatively and confirms closing or reloading edited forms. Native
save/apply buttons are blocked when another form is edited. The core LuCI
`uci-applied` event clears the applied form and marks other windows stale until
reload. This does not replace session-wide UCI staging. Custom third-party save
controls have not been audited and should use ordinary page navigation.

At most six windows open. Mobile uses full-size windows and the taskbar.
Keyboard arrows move a focused title; Shift + arrows resize. Minimizing keeps
form state in memory; closing discards it only after confirmation when edited.
No cross-origin postMessage protocol or iframe authentication bypass is used.

## Packaging and licensing

All three packages use the official `rules.mk`, `package.mk` and `BuildPackage` macros.
The SDK emits native APK v3 or IPK packages with dependencies and lifecycle hooks.
No archives are renamed to package extensions. Sources remain uncompiled ucode,
avoiding bytecode coupling to the build host's ucode version.

Bootstrap integration is Apache-2.0 and attributed in `NOTICE` and the template.
All new code and the original SVG mark are Apache-2.0. Argon/Desktop were read as
references only. No external fonts, CDN scripts, analytics or telemetry are used.
