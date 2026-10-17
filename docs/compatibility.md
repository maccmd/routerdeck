# Compatibility

| Target | Published v0.1.0 | Current `main` |
| --- | --- | --- |
| OpenWrt 25.12.5 ARM64 `armsr/armv8` | Native APK, real LuCI and package lifecycle in QEMU | Integrated windows, contextual links and native form guards checked in QEMU |
| OpenWrt 24.10.8 ARM64 `armsr/armv8` | Native IPK, real LuCI and package lifecycle in QEMU | Earlier contextual links checked; latest window/navigation/editor changes not revalidated |
| Other 25.12/24.10 patch releases | Not individually tested | Not individually tested |
| FriendlyWrt | Not certified | Requires matching modern ucode LuCI and firmware-specific validation |
| NanoPi R3S-LTS | No physical device tested | No physical device tested |
| Older Lua-only LuCI and snapshots | Unsupported | Unsupported |

The packages are noarch/all, but that does not prove compatibility with every
firmware vendor's modified LuCI. Bootstrap is a required fallback dependency.
No changes are made to core LuCI files, RPC methods, authentication or ACL grants.
Current build results and the distinction between focused checks and the full
release lifecycle are recorded in [Validation](testing.md).

## What the dashboard means

- CPU shows **1-minute load average**, not utilization percentage.
- WAN traffic is sampled from byte counters, in bytes/second; the first sample,
  missing counters and counter resets produce an unavailable gap.
- WAN selection is the first IPv4 default-route interface. Multi-WAN policy and
  IPv6-only WAN detection need a future adapter.
- DHCP entries are **leases**, not proof that a client is connected now.
- WireGuard uses interface state and aggregate counters. No peer handshakes or
  reachability claim is made; a running interface is not a verified VPN tunnel.
- Thermal sensors and connection medium detection are unavailable in 0.1.
- Optional RPC data can be unavailable under restricted accounts. RouterDeck
  does not grant broader permissions to make these values appear.

## Window limits

Current windows are part of the theme; v0.1.0 uses a separate Workspace page.
Frames isolate LuCI globals,
IDs and modal state while keeping ordinary same-origin sessions and CSRF checks.
Standard save/apply actions are guarded against concurrent edited or stale
windows, including the background page. Third-party forms with custom actions
have not been audited; use normal navigation for those. A browser reload does
not restore field values. Native
LuCI controls still own UCI staging, rollback, uploads and session expiry.

OpenWrt enforces same-origin framing on these tested releases. RouterDeck does
not disable frame protections. Firmware with stricter `frame-ancestors 'none'`
may reject frames; use the window’s “Open as a page” link.

## Limits of validation

The v0.1.0 baseline includes native pages and hostname Save & Apply. Current
window checks cover layout, validation, Save/revert and form guards; the latest
Apply path has not been rerun end to end. These tests do not establish
real Ethernet/Wi-Fi drivers, NAT performance, PPPoE negotiation, WireGuard peer
connectivity, flash safety or backup restoration on hardware. Firmware flashing,
package upgrades and network configuration are still the standard LuCI features;
RouterDeck styles their original pages. No such destructive operations are run
as part of the UI smoke tests.
