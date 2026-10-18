# Compatibility

| Target | RouterDeck Console |
| --- | --- |
| OpenWrt 25.12.5 ARM64 `armsr/armv8` | Native APK; package lifecycle and console checks in QEMU, Wi-Fi on `mac80211_hwsim` radios, terminal through ttyd |
| OpenWrt 24.10.8 ARM64 `armsr/armv8` | Native IPK; package lifecycle and console checks in QEMU (no ttyd or Wi-Fi radios in that guest) |
| Other 25.12/24.10 patch releases | Not individually tested |
| FriendlyWrt | Not certified; needs rpcd with ucode support, ucode modules and firewall4 |
| NanoPi R3S-LTS | No physical device tested |
| OpenWrt 23.05 and older | Not tested |
| Builds with iptables firewall3 | Unsupported: the console needs firewall4 |

The package is architecture-independent, but that does not prove that every
vendor firmware ships the same rpcd, ucode and netifd behaviour. The package
manager must resolve every declared dependency; never force a dependency
bypass on a router. [Validation](testing.md) records what was exercised.

## Differences between 25.12 and 24.10

The console reads both and writes in the form each release uses:

- 24.10 stores the LAN address as `ipaddr` + `netmask`; the console shows it as
  CIDR, and Undo restores the original file byte for byte.
- 24.10's busybox `ip` has no JSON output and prints no route protocol, so
  routes are parsed from text and an IPv6 route from `ip6assign` shows as
  connected (C).
- Packages come from opkg on 24.10 and apk on 25.12.
- On 24.10 netifd learns the WireGuard protocol only after the network is
  restarted once after installing it; the WireGuard tab says so.
- `ddns-scripts` on 24.10 is a plain init script rather than a procd service;
  the plugin starts it after a change.

## What the windows do not establish

The checks run in virtual machines. They do not cover real Ethernet and Wi-Fi
drivers, hardware offloading, NAT throughput, PPPoE negotiation with a real
access concentrator, WireGuard handshakes with a remote peer, or temperature
and fan sensors. See [Known limitations](console.md#known-limitations) for
what the console itself does not model.
