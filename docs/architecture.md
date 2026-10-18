# Architecture

Current source as of 2026-10-17. The primary target is OpenWrt 25.12; the
25.12/24.10 validation boundaries are in [Compatibility](compatibility.md).
The theme, monitoring app and simulated preview have separate responsibilities.

## Owning sources inspected

Initial integration research was performed on 2026-10-16:

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

The footer includes `navigation.ut` directly in the page so an interrupted
request for a separate menu script cannot strand the sidebar. It uses
`ui.menu.load()` and `ui.menu.getChildren()` rather than a hard-coded menu,
preserving alternate modes and nested tabs. Menu data gets up to three attempts,
each bounded to five seconds; a failed cached LuCI request is cleared before
retrying. Persistent failure shows a Retry button that reloads only navigation,
preserving the current form. Search is reapplied after recovery.

Header statistics and contextual/window enhancements initialize independently
of menu rendering. A failed theme core download has a shared recovery promise
for navigation and Dashboard; late duplicate core execution preserves existing
extensions. Installed applications, dependency checks and ACL filtering remain
owned by LuCI. The theme contains no ACL files, server handlers, UCI form
replacements or polling implementation for configuration changes.

Appearance lives in `localStorage` under `routerdeck.theme`. Access failures are
caught. Dynamic text uses text nodes; values are never concatenated into HTML.
No credentials, sessions or tokens are persisted by RouterDeck.

## Contextual navigation

`routerdeck-links.js` adds ACL-filtered related pages, entity links and detail
cards to stable native widgets. Typed query parameters locate existing native
forms; the enhancer does not implement configuration writes or diagnostic
execution. Read-only RPC snapshots do not share a view's mutable UCI model.
See [the navigation map and behavior](navigation.md) for supported transitions,
missing-object handling and validation limits.

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
than fictional rates. History is bounded to 60 samples on a fixed time axis.
Polling pauses while the page is hidden. Value bindings update in place;
tables retain rows by interface name or client identity and address. Unchanged
links, keyboard focus and table scroll positions survive refreshes. Contextual
links on new entries are decorated before paint instead of rebuilding the page.

The dashboard's renderer is shared with preview, while its data adapter is only
used in LuCI. No fixture data is included in either router package. The app is
usable with Bootstrap, although RouterDeck provides its intended layout.

## Windows on every page

The theme owns `windows.js` and `windows.css`. There is no separate Workspace
menu or picker. Menu labels navigate normally; adjacent window buttons and
contextual entity links open movable, resizable windows over the current page.
The button is a separate keyboard control, remains visible on touch screens and
shows whether its window already exists. Repeated use focuses that window.
Native form tabs keep their normal behavior. Ctrl/Cmd-click and the window's
“Open as a page” link provide ordinary navigation.
The legacy workspace package only redirects old bookmarks to Overview.

Only same-origin view routes and containers from the ACL-filtered LuCI menu,
plus the stock read-only `admin_status/index` Overview template, can open.
A validated `rd` query identifies an interface, device, zone, reservation
or diagnostic address. Logout, action endpoints, arbitrary queries, downloads
and external URLs are not intercepted. Details about addresses, clients and
routing entries open lightweight windows; their links open the same native editors.

Each iframe keeps its own LuCI runtime, IDs, modal state and session/CSRF checks.
A same-origin parent controller handles windows opened from inside other windows.
No nested desktop, cross-origin message bridge or authentication bypass is used.
The early `rdwindow` marker removes duplicate navigation before the first paint.
Long native modal forms scroll internally and keep their action buttons accessible.

Inside a window, `presentEditor()` observes native modal/map state and promotes
an active `.modal.cbi-modal` editor into the window's content area. Its native
heading supplies the outer title; the form becomes an accessible region while
the underlying list is hidden. The original DOM, LuCI map stack, validation and
save handlers remain intact. A frame-only CSS class removes the duplicate inner
border/backdrop and keeps actions below the scrolling map. Closing the editor
restores its original dialog attributes and list; confirmation/error dialogs
retain their normal presentation. Observers are removed on frame reload/close.

Input/change tracking conservatively marks forms edited. Closing or reloading
asks before discarding those edits. Standard saves and submits are blocked when
another form is edited or the current form is stale. The main background page
participates in the same guard. Native `uci-applied`/`uci-reverted` events mark
other pages stale until reload. This does not replace session-wide UCI staging;
custom third-party save controls have not been audited.

At most six windows open. Mobile shows one window with a task switcher. The
window area starts to the right of the desktop sidebar, below the header and
above the task switcher. Moving, resizing, maximizing and restoring old layouts
all respect these bounds. Sidebar and chrome resizing recompute the area.
On mobile the header remains reachable, and the navigation drawer covers windows.
The user-facing controls and keyboard shortcuts are documented in
[Navigation and windows](navigation.md#arrange-windows).

Snap slots are normalized to the work area, with eight-pixel gutters. Floating
restore geometry remains separate, so tearing off or maximizing a snapped
window does not lose its previous size. A narrow work area transposes full-height
column slots into rows without overwriting the saved split. Visible windows
automatically form a grid on creation, close, minimize and restore. Ordinary
focus changes and storage restoration preserve the existing geometry. Automatic
arrangement excludes minimized windows; the explicit taskbar tiler includes
them. One visible window fills the work area. Two adjacent
full-height columns share a draggable, keyboard-accessible divider. These
operations never recreate frame documents. Pointer cancellation restores the
original geometry; pointer capture and an iframe shield keep drags continuous.

Primary menu navigation restores existing windows minimized in the destination,
so they do not cover the requested page. A per-tab session marker carries only
the destination path; cancelling the unsaved-edits navigation prompt leaves the
current windows and inputs intact. Normal page loads recreate frame documents,
so native beforeunload guards still apply to edited forms.
Storage contains permitted paths and geometry only, never submitted field values,
passwords or tokens. Minimized windows retain their in-memory forms.

## RouterDeck Console

`routerdeck-console` is independent of LuCI and of this theme. Its Preact client
(`console/`, bundled by esbuild on the host) is served from `/www/routerdeck` and
calls rpcd through uhttpd's `/ubus` with a `session login` session. Calls made in
the same tick share one JSON-RPC batch; a shared poller loads each data source
once per interval for all windows and pauses while the page is hidden.

Window models (`console/src/model`) turn UCI and runtime snapshots into rows and
form values back into operations. The `routerdeck` ucode plugin
(`/usr/share/rpcd/ucode/routerdeck`, helpers in `/usr/share/ucode/routerdeck`)
applies them: a private UCI delta directory, commit, a before/after `fw4 check`
comparison, `config.change` events and a 100-entry history for Undo/Redo in
`/var/run/routerdeck`. rpcd's own `uci apply` is not used: it commits every
staged change of the session, has one global rollback slot whose timeout cannot
be extended, and blocks all commits while armed. Safe Mode keeps its own
snapshot; the `routerdeck-safemode` procd service restores it when the client's
heartbeats stop, so a pending rollback survives an rpcd reload.

Ping and Traceroute run as background jobs (`/usr/libexec/routerdeck/diag`)
because rpcd handles one call at a time; the plugin's `diag` method starts,
reads and stops them. Torch computes per-connection rates in the client from
two connection-tracking samples. The command line (`console/src/cli`) parses
RouterOS-style commands and runs them through the same window models, so a
command and the matching window produce identical operations.

See [RouterDeck Console](console.md) for behaviour, the object mapping and limits.

## Packaging and licensing

All four packages use the official `rules.mk`, `package.mk` and `BuildPackage` macros.
The SDK emits native APK v3 or IPK packages with dependencies and lifecycle hooks.
No archives are renamed to package extensions. Sources remain uncompiled ucode,
avoiding bytecode coupling to the build host's ucode version.

Bootstrap integration is Apache-2.0 and attributed in `NOTICE` and the template.
All new code and the original SVG mark are Apache-2.0. The console bundle includes Preact and Preact Signals (MIT), with their notices in `/www/routerdeck/licenses.txt`. Argon/Desktop were read as
references only. No external fonts, CDN scripts, analytics or telemetry are used.
