# RouterDeck

A compact dark and light theme for **OpenWrt LuCI**, inspired by the information
density of desktop network tools. Real LuCI forms, real package installation,
and a separate live dashboard. No frontend framework runs on the router.

[Русский](README.ru.md) · [Installation](docs/installation.md) · [Development](docs/development.md) · [Compatibility](docs/compatibility.md)

![RouterDeck running in OpenWrt 25.12.5](docs/screenshots/luci-dark.png)

## What ships in 0.1

- **`luci-theme-routerdeck`**: dark/light switching without reloading, persistent
  browser preference, searchable navigation generated from the permitted LuCI
  menu, compact forms/tables/dialogs, responsive sidebar, keyboard navigation.
- **`luci-app-routerdeck`**, optional: uptime, load average, RAM, storage, WAN
  address and sampled traffic, connection count, logical interfaces, DHCP leases,
  and basic WireGuard interface state using existing ubus/rpcd services.
- **`luci-app-routerdeck-workspace`**, optional: native LuCI windows with move,
  resize, minimize/maximize, task switching, saved geometry and unsaved-form guards.
- Bootstrap remains installed. Installing RouterDeck registers it without
  changing the current design. Removing the selected theme restores Bootstrap.

This is an **MVP / preview release**, not a declaration of universal compatibility.
The optional workspace is experimental and requires editing one form at a time. CPU utilization,
temperature sensors, WireGuard peer handshakes and client presence detection are
not implemented; the dashboard does not invent these values.

## Compatibility

| Firmware | Package | Validation |
| --- | --- | --- |
| OpenWrt 25.12.5, armsr/armv8 | `.apk`, noarch | QEMU on Apple Silicon |
| OpenWrt 24.10.8, armsr/armv8 | `.ipk`, all | QEMU on Apple Silicon |
| FriendlyWrt, NanoPi R3S-LTS | Not certified | Hardware/firmware validation pending |

See [the test report](docs/testing.md) for exactly what was exercised. These are
browser/UI and configuration lifecycle checks; they do not establish hardware
acceleration, PPPoE negotiation, VPN connectivity or firmware flashing support
on a physical device.

## Install

Download packages for your firmware's package manager from
[GitHub Releases](https://github.com/maccmd/routerdeck/releases). Verify the
matching `SHA256SUMS-apk` or `SHA256SUMS-ipk`, then copy the files to `/tmp` on your
router. Keep a working SSH connection while changing themes.

```sh
# OpenWrt 25.12: install LuCI if it is not installed yet
apk update
apk add luci luci-theme-bootstrap
apk add --allow-untrusted /tmp/luci-theme-routerdeck-0.1.0-r1.apk
# Optional dashboard:
apk add --allow-untrusted /tmp/luci-app-routerdeck-0.1.0-r1.apk
# Optional experimental workspace / Необязательный оконный режим:
apk add --allow-untrusted /tmp/luci-app-routerdeck-workspace-0.1.0-r1.apk
```

Select **System → System → Language and Style → Design → RouterDeck**, then
**Save & Apply**. Dashboard appears under Status when the optional package is
installed. Root's existing password and the usual LuCI session are used.

For OpenWrt 24.10 use `opkg update`, `opkg install luci luci-theme-bootstrap`,
then `opkg install /tmp/luci-theme-routerdeck_0.1.0-r1_all.ipk` and optionally
`opkg install /tmp/luci-app-routerdeck_0.1.0-r1_all.ipk`.

## Restore / uninstall

```sh
uci set luci.main.mediaurlbase='/luci-static/bootstrap'
uci commit luci
# 25.12:
apk del luci-app-routerdeck-workspace luci-app-routerdeck luci-theme-routerdeck
# 24.10: opkg remove luci-app-routerdeck-workspace luci-app-routerdeck luci-theme-routerdeck
```

Omit optional package names that were not installed. Refresh the browser.
See [recovery instructions](docs/installation.md#recovery) if a stale page remains.

## Develop on macOS

Node.js 22+, Python 3, QEMU and a running Docker installation are used for the
complete workflow. The local preview only needs Node.js.

```sh
npm ci
npm run dev                     # http://127.0.0.1:5173 — mock data
npx playwright install chromium webkit
./scripts/test.sh
./scripts/package.sh 25.12.5     # official SDK → dist/packages/25.12/*.apk
./scripts/package.sh 24.10.8     # official SDK → dist/packages/24.10/*.ipk
```

The preview is visibly marked as simulated and never talks to a router. Build
output from `npm run build` is a static preview, **not** an OpenWrt package.

[VM setup](docs/development.md#openwrt-vm) binds HTTP and SSH to loopback, uses QEMU
user-mode networking and changes no host network interfaces. Real VM tests:

```sh
npm run test:vm
npx playwright test --config playwright.lifecycle.config.mjs
```

GitHub Actions runs preview tests and builds all three packages from checksum-pinned
official SDKs. A matching `v*` tag publishes a GitHub prerelease and checksums.
VM checks are a separate release gate run locally; CI does not pretend to run them.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for LuCI integration attribution.
The design uses original artwork and system fonts; no MikroTik assets are bundled.
