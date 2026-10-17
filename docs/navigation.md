# Navigation and windows

This guide describes current `main`. The published v0.1.0 packages have a
separate experimental Workspace page; integrated windows require a
[build from current source](development.md#checks-and-builds).

## Open a page or a window

| Control | Result |
| --- | --- |
| Menu label | Navigate to the page normally |
| Window button beside a menu label | Open that page in a window, or focus its existing window |
| Interface, device or firewall zone link | Open the exact native editor, when available |
| Information button beside an object | Open its runtime details |
| Address, client or routing entry link | Open details and related configuration/diagnostic links |
| Related page link | Open that page in a window |
| Titlebar's **Open as a page** link | Navigate to the full page |
| Ctrl/Cmd-click on a page link | Keep the browser's normal new-tab behavior |

There is no separate Workspace menu in current source. Links inside a window
open related objects alongside it through the same window manager. Native page
tabs stay inside their existing window.

An object editor fills its RouterDeck window. Its title appears once in the
titlebar, the form scrolls, and Save/Dismiss remain accessible in the footer.
Dismiss returns to the underlying list. Native validation, confirmation and
error dialogs keep their usual behavior.

![Interface editor and active routes in two windows](screenshots/windows-dark.png)

## Arrange windows

Opening a new window automatically arranges it with the other visible windows.
One window fills the work area; two share equal columns, or rows if the area is
narrow. Three to six form a grid. Closing, minimizing or restoring a window
recalculates the layout. Focusing an already visible window preserves its
position and any customized split.

Drag a title to move its window. Near a work-area edge or corner, a preview
shows the snap position; the top edge maximizes. The titlebar's Layout button
also offers halves, quarters and a floating position. Hold Alt to drag freely,
or press Escape to cancel. Drag the bottom-right handle to resize a floating
window. Double-click the title to maximize or restore it.

Two full-height columns share a divider: drag it to change their proportions,
or double-click to return to equal widths. The taskbar's **Tile windows** button
resets the layout and restores minimized windows. **Show main page** minimizes
all windows. These operations preserve loaded forms and unsaved input.

The work area starts beside the sidebar, below the header and above the taskbar.
Windows stay inside it even when maximized. Drag the sidebar's right edge to
resize the menu; double-click to reset its width. Open windows adapt immediately.
Menu scroll position is retained across page navigation.

On mobile, one window is visible at a time and the taskbar switches between
them. The header's menu button stays accessible, and its drawer opens above the
window. Desktop tiling controls are hidden.

## Keyboard controls

| Focus / shortcut | Action |
| --- | --- |
| Ctrl/Cmd + K | Focus menu search |
| Window title + arrow keys | Move the window |
| Window title + Shift + arrows | Resize the window |
| Window title + Ctrl + Alt + Left/Right | Snap to the left/right half |
| Window title + Ctrl + Alt + Up/Down | Maximize / restore floating position |
| Resize handle + arrows | Resize the window |
| Column divider + Left/Right | Adjust the split; Shift makes a larger step |
| Column divider + Home/End | Move to the permitted split limits |
| Sidebar divider + Left/Right | Adjust menu width; Shift makes a larger step |
| Sidebar divider + Home/End | Move to the permitted width limits |
| Escape during a drag | Cancel and restore the previous position |

## Edits, saving and restoration

Edit and apply **one form at a time**: UCI staging belongs to the whole LuCI
session. Native **Save** stages changes; **Save & Apply** applies them through
LuCI's existing workflow. Dismiss or closing a window does not revert changes
already staged in LuCI. Use its Configuration / Changes dialog to inspect,
apply or revert those changes.

Closing or reloading an edited window asks before discarding browser input.
Standard save actions are blocked when another window or the background page
has edits, or when configuration changed since the form loaded. Reload stale
pages before editing further. Custom third-party save actions have not been
audited; use **Open as a page** for those applications.

Permitted page targets and window geometry are remembered in this browser;
form values, passwords and session tokens are not. Reloading restores the saved
layout but reloads its pages. Menu navigation restores windows minimized so the
requested page is visible. Cancelling the navigation warning preserves current
inputs. A narrow work area temporarily stacks saved columns and restores their
proportions when space is available again.

If navigation cannot load, RouterDeck retries up to three times with a five-second
limit per attempt. The resulting **Retry** button reloads only the menu and
preserves the current form and search. Installed pages and permissions remain
controlled by LuCI.

## Supported object links

| Source | Target / detail |
| --- | --- |
| Active IPv4/IPv6 routes, neighbours and rules: interface badge | Exact interface editor; information card with addresses, gateway, DNS, device, MTU, MAC, uptime, counters, errors, drops and firewall zones |
| Routing entry: Details | Displayed fields, available kernel metadata, related interface, address diagnostics, static routing and firewall |
| Interface list: interface name | Existing native interface form |
| Interface list or dashboard: physical device | Devices tab and exact existing device editor |
| Device information | Addresses, counters, errors, associated interfaces and related network pages |
| Firewall zone badge | Exact zone editor, resolved by configured name rather than row order |
| Dashboard interface and VPN row | Interface configuration and runtime details |
| Dashboard DHCP client / native lease hostname or MAC | Client addresses, MAC, DUID, remaining lease, available reservations and diagnostics |
| Existing DHCP reservation in a client card | Exact static lease editor |
| IP address in routing, lease tables or dashboard | Client details if the address matches a lease, otherwise address details and local interface links |
| Literal address or address:port in Connections | Address details and diagnostics, with the port removed from the diagnostic target |
| Address, gateway or DNS server in an interface card | Diagnostics prefilled with that address, waiting for a user command |
| Dashboard uptime / memory / load / connection card | System settings / system overview / load graph / connection list |
| Dashboard panel heading | Interfaces, DHCP, system settings, traffic graph or WireGuard status, when installed and permitted |
| Related navigation above native pages | Network, routing, DHCP/DNS, firewall, monitoring and system destinations relevant to the page |

Runtime-only devices are highlighted without opening a configuration-creating
form. Loopback gets a read-only card because LuCI hides it from the interface
editor. Missing or ambiguous objects produce a notice instead of selecting a
different row. Unavailable menu destinations do not produce links.

## Link format and integration boundaries

Example: `/cgi-bin/luci/admin/network/network?rd=interface%3Awan`.

The reserved `rd` parameter identifies an object, not an action. It supports
copied URLs, reload and browser Back/Forward without consuming LuCI's tab
fragments. Legacy `#rd:kind:name` links are also understood. The enhancer waits
for native grids, activates the containing tab and uses the existing Edit
button. Read-only buttons remain read-only. No link clicks Save, Apply, Add,
Reserve IP, Restart or a diagnostic command automatically.

Diagnostics accepts literal IPv4/IPv6 addresses, including IPv6 scope
identifiers. It prefills the input without resolving or executing arbitrary
URL text. Form tabs, external links, downloads, logout, action endpoints,
native dropdowns and existing third-party controls retain their behavior.

Detail cards use read-only RPC/UCI snapshots, separate from the native form's
mutable UCI model. Runtime details are labelled as a page-load snapshot. A DHCP
lease is never presented as proof that a client is online. Native polling and
dashboard updates can add new links without duplicating existing controls.

The optional dashboard works without this theme, but the theme supplies its
contextual links. Preview does not invent working router configuration links.
Arbitrary third-party tables and radio/peer-specific hardware flows are outside
the current coverage. See [validation](testing.md) and [compatibility](compatibility.md).

Light and mobile examples: [light desktop](screenshots/windows-light.png),
[mobile editor](screenshots/windows-mobile.png).
