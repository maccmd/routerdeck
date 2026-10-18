# RouterDeck

**RouterDeck Console** is a windowed management interface for OpenWrt,
modelled on the way desktop router tools such as MikroTik WinBox work: object
lists with flags and live counters, object windows, changes that apply at once
with Undo/Redo and Safe Mode, and a RouterOS-style command line. It talks to
rpcd over uhttpd's `/ubus` and edits UCI through its own rpcd plugin. LuCI is
not needed, but can stay installed next to it.

[Русский](README.ru.md) · [RouterDeck Console](docs/console.md) · [Installation](docs/installation.md) · [Development](docs/development.md) · [Compatibility](docs/compatibility.md) · [Validation](docs/testing.md)

![Interface list, firewall rules, a rule window and the command line in RouterDeck Console](docs/screenshots/console-light.png)

This README describes current `main`. The published **v0.1.0** prerelease was
an earlier LuCI theme (`luci-theme-routerdeck`, with an optional dashboard and
Workspace page). That theme has been removed from the source and is no longer
developed; see [removing it](docs/installation.md#removing-the-old-luci-theme).

## Features

- **Windows**: Quick Set, WiFi, Interfaces (Ethernet, VLAN, WireGuard and
  peers), Bridge, PPP, IP (addresses, ARP, routes, firewall with address lists,
  DHCP server, DNS, Dynamic DNS, services, UPnP), IPv6, Routing rules, Queues
  (SQM), the System menu (identity, clock, NTP, logging, password, packages,
  scheduler, startup, resources, backup, reboot) and the log are live object
  lists with RouterOS-style flags, comments, Find, sorting and context menus.
- **Tools**: Ping, Traceroute, Torch, Bandwidth Test (iperf3), IP Scan,
  Netwatch (a service on the router), Wake on LAN and traffic graphs.
- **Changes apply at once**, one change per Undo step, without a separate
  *Save & Apply*. **Safe Mode** rolls everything back when the console stops
  answering, for example after a change cut your own connection.
- **New Terminal** is a RouterOS-style command line over the same objects
  (`/ip firewall filter print`, `add`, `set`, `export`, Tab completion, `?`).
  **New Shell** embeds the router's shell through ttyd.

See [RouterDeck Console](docs/console.md) for the window-to-OpenWrt mapping,
the command line, how changes are made, access control and known limitations.

## Compatibility

| Firmware | Package | Validation |
| --- | --- | --- |
| OpenWrt 25.12.5, armsr/armv8 | `.apk`, noarch | Package lifecycle and console checks in QEMU |
| OpenWrt 24.10.8, armsr/armv8 | `.ipk`, all | Package lifecycle and console checks in QEMU |
| FriendlyWrt, NanoPi R3S-LTS | Not certified | Hardware/firmware validation pending |

See [the validation report](docs/testing.md) for exactly what was exercised.
The checks run in virtual machines; they do not establish real Ethernet or
Wi-Fi drivers, PPPoE negotiation or VPN connectivity on a physical device.

## Install

There is no published release of the console yet. Build the package from
source (see [Development](docs/development.md#checks-and-builds)), copy it to
`/tmp` on the router and install it:

```sh
# OpenWrt 25.12
apk add --allow-untrusted /tmp/routerdeck-console-0.1.0-r1.apk
# OpenWrt 24.10
opkg install /tmp/routerdeck-console_0.1.0-r1_all.ipk
```

Open `http://<router>/routerdeck/` and log in with a router account (root by
default). [Installation](docs/installation.md) lists the optional packages
that turn on more windows, and how to remove the console again.

## Develop on macOS

Node.js 22+, Python 3, QEMU and a running Docker installation are used for the
complete workflow. The local preview only needs Node.js.

```sh
npm ci
npm run dev                     # http://127.0.0.1:5173/routerdeck/ — simulated router
npx playwright install chromium webkit
./scripts/test.sh
./scripts/package.sh 25.12.5     # official SDK → dist/packages/25.12/*.apk
./scripts/package.sh 24.10.8     # official SDK → dist/packages/24.10/*.ipk
```

The preview runs the console against a simulated router (log in as `root`,
password `routerdeck`) and never talks to a real one. [VM setup](docs/development.md#openwrt-vm)
binds HTTP and SSH to loopback, uses QEMU user-mode networking and changes no
host network interfaces.

GitHub Actions runs the browser tests and builds the package from
checksum-pinned official SDKs. VM checks are a separate gate run locally; CI
does not pretend to run them.

## License

[Apache-2.0](LICENSE). The console bundles Preact (MIT); see [NOTICE](NOTICE).
RouterDeck uses original artwork and system fonts; no MikroTik code or assets
are included, and it is not affiliated with MikroTik or the OpenWrt project.
