# Installation and recovery

Use the package format matching the installed **firmware**, not the CPU alone.
The published v0.1.0 was validated with upstream OpenWrt 25.12.5 and 24.10.8 on
armsr/armv8. Current window changes have been exercised on 25.12.5; see the
[validation report](testing.md) for the exact scope. FriendlyWrt requires a
separate check of its LuCI, ucode and package dependencies. Keep Bootstrap
installed and retain SSH access when changing designs.

## Choose a source

| Source | Window behavior | Packages to install |
| --- | --- | --- |
| Published v0.1.0 prerelease | Separate experimental Workspace page | Theme; optional dashboard and Workspace |
| Current `main` | Windows throughout the theme, automatic arrangement and contextual editors | Theme; optional dashboard. Workspace is only a legacy URL redirect |

For current source, follow [the build instructions](development.md#checks-and-builds).
Output is under `dist/packages/25.12/` or `dist/packages/24.10/`, with a `SHA256SUMS`
file in each directory. The unreleased builds still use the 0.1.0-r1 filenames,
so keep their packages and checksums separate from downloaded release assets.
The commands below show a fresh installation. For repeated development installs,
remove the RouterDeck packages from the disposable guest first, then run its
`install` helper described in [Development](development.md#openwrt-vm). A normal
install of an unchanged version may leave the previous files in place.

## Download and verify

Download the versioned packages and matching checksums from
[Releases](https://github.com/maccmd/routerdeck/releases). On macOS:

```sh
shasum -a 256 -c SHA256SUMS-apk
# For IPK downloads: shasum -a 256 -c SHA256SUMS-ipk
```

Copy the desired packages to `/tmp` on the router. These are unsigned third-party
packages; `--allow-untrusted` is limited to this explicit local APK installation.
RouterDeck does not alter package repositories or disable their signature checks.

## OpenWrt 25.12

```sh
apk update
apk add luci luci-theme-bootstrap
apk add --allow-untrusted /tmp/luci-theme-routerdeck-0.1.0-r1.apk
# Optional dashboard:
apk add --allow-untrusted /tmp/luci-app-routerdeck-0.1.0-r1.apk
# v0.1.0 Workspace, or the current-source legacy URL redirect:
apk add --allow-untrusted /tmp/luci-app-routerdeck-workspace-0.1.0-r1.apk
```

## OpenWrt 24.10

```sh
opkg update
opkg install luci luci-theme-bootstrap
opkg install /tmp/luci-theme-routerdeck_0.1.0-r1_all.ipk
# Optional dashboard:
opkg install /tmp/luci-app-routerdeck_0.1.0-r1_all.ipk
# v0.1.0 Workspace, or the current-source legacy URL redirect:
opkg install /tmp/luci-app-routerdeck-workspace_0.1.0-r1_all.ipk
```

The base theme registers **RouterDeck** without selecting it automatically. In
LuCI choose **System → System → Language and Style → Design → RouterDeck** and
**Save & Apply**. Dashboard appears under Status if installed.
Light/dark preference is per browser. The optional dashboard becomes the first
Status page; the original Overview remains available.

## Windows in current source

Click a menu label to navigate normally; use its adjacent window button to open
that page alongside the current one. Entity links open native editors or detail
cards. Windows arrange automatically and remain inside the work area, keeping
the menu accessible. Up to six can remain open; mobile shows one at a time.

Edit and apply **one form at a time**. Save stages changes in LuCI; Save & Apply
applies them. Browser layout is remembered, but form values are not. See
[Navigation and windows](navigation.md) for placement, shortcuts, form guards,
supported object links and restoration behavior.

## Recovery

From SSH, restore Bootstrap independently of the RouterDeck UI:

```sh
uci set luci.main.mediaurlbase='/luci-static/bootstrap'
uci commit luci
rm -f /tmp/luci-indexcache.*
rm -rf /tmp/luci-modulecache
```

Reload LuCI, using a hard refresh if needed. If Bootstrap was manually removed,
reinstall `luci-theme-bootstrap` with the firmware's package manager first.
No firmware flash or network reset is needed to restore the design.

## Uninstall

Remove optional packages first, then the base theme. Omit extensions that were
not installed. When the active theme is removed, its package hook selects
Bootstrap and removes the RouterDeck design entry.

```sh
# OpenWrt 25.12
apk del luci-app-routerdeck-workspace luci-app-routerdeck luci-theme-routerdeck
# OpenWrt 24.10
opkg remove luci-app-routerdeck-workspace luci-app-routerdeck luci-theme-routerdeck
```

Network, firewall and DHCP configurations are not changed by installation or
removal. Browser appearance/layout preferences can be removed separately by
clearing this router site's local storage.
