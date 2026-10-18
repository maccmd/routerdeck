# Installation and removal

RouterDeck ships one package, `routerdeck-console`. Use the package format of
the installed **firmware**: APK for OpenWrt 25.12, IPK for 24.10. Both were
exercised on upstream OpenWrt 25.12.5 and 24.10.8 (armsr/armv8) in QEMU; see
the [validation report](testing.md) for the exact scope. FriendlyWrt and other
vendor firmware need their own check. Keep SSH access while trying the
console on a router you depend on.

## Build the package

There is no published release of the console yet. Build it with
[the official SDKs](development.md#checks-and-builds):

```sh
npm ci
./scripts/package.sh 25.12.5     # dist/packages/25.12/routerdeck-console-0.1.0-r1.apk
./scripts/package.sh 24.10.8     # dist/packages/24.10/routerdeck-console_0.1.0-r1_all.ipk
```

Each output directory has a `SHA256SUMS` file. Copy the package to `/tmp` on
the router. It is an unsigned third-party package: `--allow-untrusted` applies
to this one local APK installation; RouterDeck does not change package
repositories or turn off their signature checks.

## Install

```sh
# OpenWrt 25.12
apk add --allow-untrusted /tmp/routerdeck-console-0.1.0-r1.apk
# OpenWrt 24.10
opkg install /tmp/routerdeck-console_0.1.0-r1_all.ipk
```

Open `http://<router>/routerdeck/` and log in with a router account (root by
default). The package depends on rpcd with its ucode, luci-rpc and iwinfo
modules, the ucode fs/ubus/uci modules, uhttpd with `/ubus`, and firewall4.
Standard OpenWrt images with LuCI already have all of them; the package
manager installs whatever is missing.

Some windows appear only when the software behind them is installed:

| Window | Package |
| --- | --- |
| New Shell | `ttyd` |
| PPP (PPPoE) | `ppp-mod-pppoe` |
| WireGuard | `wireguard-tools`, `kmod-wireguard` (restart the network after installing) |
| IP ▸ IPsec | `strongswan-minimal`, `strongswan-swanctl` |
| Routing ▸ OSPF, BGP | `bird2`, `bird2c` |
| IP ▸ UPnP | `miniupnpd-nftables` |
| IP ▸ Dynamic DNS | `ddns-scripts` |
| Queues | `sqm-scripts` |
| Tools ▸ Bandwidth Test | `iperf3` |
| Tools ▸ Wake on LAN | `etherwake` |

Serve the router over HTTPS where untrusted users share the network. ttyd then
needs SSL too, or the browser blocks the embedded shell.

Reinstalling the same version (as during development) may leave the previous
files in place; remove the package first, then install the new build.

## Remove

```sh
# OpenWrt 25.12
apk del routerdeck-console
# OpenWrt 24.10
opkg remove routerdeck-console
```

Removal stops the Safe Mode watchdog and Netwatch, ends running diagnostics
and deletes the runtime state in `/var/run/routerdeck`. Configuration in
`/etc/config` stays as it is, including `/etc/config/routerdeck` (Netwatch
hosts). Window positions and command history live in the browser's local
storage for the router's address and can be cleared there.

## Removing the old LuCI theme

The published v0.1.0 prerelease installed a LuCI theme instead of the console:
`luci-theme-routerdeck`, optionally with `luci-app-routerdeck` (dashboard) and
`luci-app-routerdeck-workspace`. They are no longer developed. To remove them,
omitting the packages that were not installed:

```sh
# OpenWrt 25.12
apk del luci-app-routerdeck-workspace luci-app-routerdeck luci-theme-routerdeck
# OpenWrt 24.10
opkg remove luci-app-routerdeck-workspace luci-app-routerdeck luci-theme-routerdeck
```

When the RouterDeck design was selected, its removal hook switches LuCI back
to Bootstrap. If LuCI still shows a broken page, select Bootstrap from SSH and
reload the browser:

```sh
uci set luci.main.mediaurlbase='/luci-static/bootstrap'
uci commit luci
rm -f /tmp/luci-indexcache.*
rm -rf /tmp/luci-modulecache
```

If Bootstrap itself was removed, reinstall `luci-theme-bootstrap` first. The
console and the old theme are independent: either can be installed without
the other.
