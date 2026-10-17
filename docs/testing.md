# Validation report — 2026-10-17

This report separates current `main` checks from the published v0.1.0 baseline.
The preview uses simulated data. Real integration checks run against isolated
OpenWrt ARM guests; neither establishes compatibility with physical router hardware.

## Current source

| Layer | Latest result / scope |
| --- | --- |
| Syntax | 13 JavaScript/JSON sources pass, including inline navigation |
| Unit | 21 tests pass: sampling, missing data, storage failures, target validation, menu recovery and window URL allowlists |
| Preview | 32 Playwright tests pass: Chromium and WebKit × 4 viewports × 4 scenarios |
| OpenWrt 25.12.5 window guards | 4 tests pass: Chromium/WebKit × desktop/mobile, with native forms and tiled windows on desktop |
| OpenWrt 25.12.5 interaction review | Contextual editors, window placement, menu recovery and stable dashboard refreshes; details below |
| OpenWrt 24.10.8 | Earlier contextual-link checks pass; latest integrated windows, navigation recovery and editor presentation have not been revalidated |
| SDK builds | Official 25.12.5 and 24.10.8 SDK builds pass: three APKs and three IPKs, with checksums |

Preview viewports are **1920×1080, 1440×900, 1280×800 and 390×844**.
The focused native window suite uses **1440×900 and 390×844**. Its apply-event
test dispatches `uci-applied` to check stale-window handling without applying
router configuration. The full native suite and package installation/removal
lifecycle have not been rerun for this final source revision.

## Behavior covered

### Navigation and contextual links

- Menu labels navigate normally; adjacent window buttons open or focus a window.
  Keyboard activation, duplicate prevention, minimized restoration after page
  navigation and cancellation of the native unsaved-edits warning were checked.
- Search hides the complete menu row. Dark/light themes, a 181-pixel sidebar and
  the 390-pixel mobile viewport were reviewed. The sidebar can be resized while
  windows remain inside the available work area.
- Chromium fault injection on 25.12.5 verified recovery after failed menu data
  and theme-core requests. Three held menu requests stop after about 16 seconds;
  Retry restores all 23 permitted entries without losing an unsaved hostname.
  Failed optional window scripts do not prevent menu rendering.
- Native contextual flows on 25.12.5 include Routing → WAN/LAN, interface →
  bridge, interface details → firewall zone, dashboard object links, query
  reload and browser Back across objects. Address diagnostics are prefilled
  without running a command.
- Earlier 24.10.8 checks covered WAN/bridge/zone editors, IPv6 diagnostic
  prefilling and dashboard client → static lease editor. The temporary lease
  fixture was restored. These checks predate the latest window changes.

### Window layout and form guards

- Preview regression covers automatic two- and three-window arrangement,
  reflow on close/minimize/restore, edge/corner snapping, drag cancellation,
  maximize/restore, layout controls, the shared divider and persisted split
  proportions. Loaded documents and edited inputs survive layout changes.
- Manual Chromium checks cover three-to-six-window grids, Alt to suppress
  snapping, keyboard snapping and divider reset. Narrowing the work area stacks
  columns; widening it restores the saved split.
- Native Interfaces and Routing were displayed side by side at 1920×1080 and
  resized from 50/50 to 40/60 without reloading the route document. Opening
  Diagnostics creates a three-window grid; closing it restores two columns.
- Maximizing, dragging toward the menu, resizing the sidebar to 420 pixels and
  restoring oversized saved geometry keep windows clear of the menu and header.
  Mobile navigation opens above the active window.
- Native regressions cover close/save guards and stale state in sibling windows
  and the background page. The final four-test run passed in both browsers at
  both viewport sizes.

### Native editors in a single window

Chromium and WebKit on 25.12.5 were used to open LAN from Routing and to edit it
from a menu-opened Interfaces window. The form fills its iframe with one title,
no inner window border or backdrop, and visible, hit-testable Save/Dismiss
buttons. The hidden background list is excluded from focus and accessibility
queries. Native General/Advanced/DHCP tabs and Dismiss work on desktop and mobile.

Chromium also covered the bridge editor, light/dark themes and resizing beside
Routing. An invalid gateway was rejected by native validation. A native Save
with unchanged input staged LuCI's default-value normalizations; these were
reverted through Configuration / Changes, and a UCI query confirmed **zero
pending configurations**. No changes were applied. The changes dialog retained
its ordinary modal role and border. Dependency-hidden mobile fields stay hidden.
WebKit also confirmed that full-page editors keep their original modal presentation.

### Dashboard refreshes

Across three native five-second refreshes, Chromium recorded no layout shifts.
The chart updated while root/table/link nodes, focus and page scroll stayed
intact. On mobile, horizontal table scroll remained at 100 pixels across two
refreshes, with no document overflow. Renderer checks also covered row insertion,
reordering/removal, duplicate-MAC IPv4/IPv6 leases, unavailable data and recovery,
and literal rendering of hostile hostname text.

## Visual examples

Reviewed captures from the disposable OpenWrt 25.12.5 guest:

![Dark editor and routes](screenshots/windows-dark.png)

[Light desktop](screenshots/windows-light.png) · [Mobile editor](screenshots/windows-mobile.png)

The addresses and hostname in these captures belong to the test guest. Browser
reports and raw captures remain under ignored `output/playwright/`.

## Published v0.1.0 baseline

The [report at the v0.1.0 tag](https://github.com/maccmd/routerdeck/blob/v0.1.0/docs/testing.md)
records 4 unit tests, 32 preview tests, 17 real LuCI checks per firmware and one
package lifecycle check per firmware. Both 25.12.5 and 24.10.8 were exercised.
Those checks included native authentication/logout, standard configuration
pages, hostname Save & Apply with restoration, applying inside the original
Workspace, Bootstrap switching and package removal/reinstallation with unchanged
network/firewall/DHCP configuration hashes.

That baseline applies to the published packages and their separate Workspace
page. It is not a claim that every lifecycle or Apply scenario was repeated for
current integrated windows. See [release notes](releases/v0.1.0.md).

## Environment and limits

- macOS Apple Silicon, QEMU HVF, two vCPUs and private guest LANs. HTTP/SSH are
  forwarded only to 127.0.0.1; no host interfaces or routes are changed.
- OpenWrt 25.12.5: ARM `virt`, kernel 6.12.94, LuCI core `128a7812`.
- OpenWrt 24.10.8 baseline: ARM `virt`, kernel 6.6.144, LuCI core `cac97ed`.
- Official image/SDK filenames and SHA-256 hashes are pinned in
  [scripts/releases.json](../scripts/releases.json). The test runner uses
  Node.js 22+ and locked Playwright 1.64.1.
- CI runs preview tests and SDK builds. Native VM tests remain local; commands
  are in [Development](development.md). Authentication traces are disabled.

QEMU HTTP occasionally resets static asset requests or stalls the initial LuCI
view load, including unchanged LuCI resources. Affected manual checks and earlier
regressions were repeated after recovery; failed renders were not counted as
successful checks. The final focused native suite passed all four cases in one run.
WebKit's known polling-XHR cancellation is ignored only during intentional
close-all; other page errors remain test failures.

No physical NanoPi/FriendlyWrt device, real PPPoE session, WireGuard peer handshake,
hardware sensor, firmware flash or backup restoration has been tested. Custom
third-party save actions and radio/peer-specific hardware flows need separate
validation. See [Compatibility](compatibility.md) for feature limits.
