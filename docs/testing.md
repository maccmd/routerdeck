# Validation report — 2026-10-18

RouterDeck Console is checked at three levels: unit tests of the models and
the command line, browser tests against a simulated router, and checks
against real OpenWrt guests in QEMU. None of them establishes compatibility
with physical router hardware.

## Current source

| Layer | Latest result / scope |
| --- | --- |
| Syntax | `npm run check`: the ACL and JSON fixtures parse |
| Unit | 121 tests pass: window models on data captured from OpenWrt 25.12.5, the command line, the window manager, the RPC client, the poller and the tools |
| Browser | 396 Playwright tests pass in Chromium and WebKit at 1920×1080, 1440×900, 1280×800 and 390×844 against the simulated router; 132 are skipped by design at the 390-pixel phone width, which the console does not target |
| OpenWrt 25.12.5 | 68 console checks pass in Chromium against the guest; the package lifecycle check passes |
| OpenWrt 24.10.8 | 64 console checks pass and 4 skip (no ttyd or Wi-Fi radios in that guest); the package lifecycle check passes |
| SDK builds | Official 25.12.5 and 24.10.8 SDK builds pass: one APK and one IPK, with checksums |

## What the guest checks cover

Each check undoes its own changes and compares the affected configuration
before and after.

- **Backend** (`tests/vm/backend.spec.mjs`): JSON-RPC with a real session and
  ACL; apply, fw4 reload and the history; changes made outside the history
  blocking Undo; Undo carrying a change over onto options another program
  wrote; invalid input rejected without a trace; waiting for a pending LuCI
  rollback; Safe Mode keep/discard, the watchdog's timeout rollback and a
  takeover by another session; diagnostics jobs outside rpcd.
- **Windows and the command line**: static routes, addresses and IPv6 routes
  in the kernel; firewall rules in nftables; address lists as nftables sets;
  bridges with VLAN filtering; WireGuard interfaces with a key made on the
  router and a peer; policy rules in `ip rule`; DHCP options and static DNS
  answered by dnsmasq; a ttyd port change; the time zone, a cron job that
  runs, a procd service stopped and started, the password set through rpcd
  and a backup download; Quick Set as one Undo step, and a LAN address change
  rolled back by Safe Mode after the console lost the router.
- **Optional packages**: UPnP starting miniupnpd, a dynamic DNS updater, an
  SQM queue putting cake on the WAN device, an iperf3 test against the
  router, IP Scan, Netwatch running as a service, Wake on LAN through
  etherwake.
- **Tools**: Ping, Traceroute and Torch against the guest.
- **Maintenance** (`console-maintenance`): a package installed and removed
  through apk or opkg with its output; a script run from its window and from
  the scheduler's wrapper; Files uploading, downloading and removing through
  cgi-io; firmware the router rejects is not flashed; a backup made on the
  router restored after a check, with the reboot that follows.
- **Administration** (`console-admin`): a user logging in through rpcd with
  its own password; the web server certificate regenerated, imported and
  restored; a mount point mounted, unmounted and mounted again; LEDs and
  disks.
- **Advanced settings** (`console-advanced`): IP Settings in the kernel;
  FastPath, mangle and raw rules and zone logging in nftables; advanced DNS
  options and a pool in dnsmasq; 802.11r and the access list in hostapd.
- **Tunnels and VPN** (`console-vpn`): GRE and VXLAN tunnels with their
  addresses in the kernel; a bond of dummy devices; an L2TP client starting
  xl2tpd and a PPPoE server with the console's options; an OpenVPN server and
  a client on the same router connecting to each other; an IPsec peer, policy
  and proposal loaded by swanctl.
- **Routing and queues** (`console-queues`, `console-bird`): a named table
  holding a route; a simple queue slowing this test's own download to
  4 Mbit/s until Undo lifts it; Graphing running as a service and its history
  in the window; OSPF reaching a full adjacency with a second bird in a
  network namespace bridged into the LAN, installing its route and
  announcing the router's networks, and a BGP session with it; bird.conf ends
  as the package installed it.
- **WiFi** (25.12 only): an access point and a client on `mac80211_hwsim`
  radios; an SSID change reconfigures hostapd at once and Undo reconnects the
  client. **Shell** (25.12 only): the router shell through ttyd.
- **Lifecycle** (`tests/lifecycle/console.spec.mjs`): install from
  `dist/packages`, log in, Safe Mode and a running job, removal mid-Safe Mode
  (no files, processes or runtime state left, configuration unchanged) and
  reinstallation.

Checks that need software the guest lacks skip with the reason: the 24.10
guest has no ttyd or Wi-Fi radios.

## Environment and limits

- macOS Apple Silicon, QEMU HVF, two vCPUs and private guest LANs. HTTP/SSH are
  forwarded only to 127.0.0.1; no host interfaces or routes are changed.
- OpenWrt 25.12.5 and 24.10.8, ARM `virt` (`armsr/armv8`). Official image and
  SDK filenames and SHA-256 hashes are pinned in
  [scripts/releases.json](../scripts/releases.json).
- Node.js 22+, Playwright 1.64.1 (locked). Authentication traces are disabled.
- CI runs the browser tests and the SDK builds. Guest checks are local; the
  commands are in [Development](development.md#openwrt-vm).

Not tested: a physical NanoPi or FriendlyWrt device, real Ethernet and Wi-Fi
drivers, hardware offloading, a PPPoE session with a real access
concentrator, WireGuard, IPsec or OpenVPN with a remote peer, OSPF or BGP with
another vendor's router, flashing firmware that the router accepts, hardware
sensors.
See [Compatibility](compatibility.md) and
[Known limitations](console.md#known-limitations).
