# Installation and recovery

Use the package format matching the installed **firmware**, not the CPU alone.
0.1.0 was validated with upstream OpenWrt 25.12.5 and 24.10.8 on armsr/armv8.
FriendlyWrt requires a separate check of its LuCI, ucode and package dependencies.
Keep Bootstrap installed and retain SSH access when changing designs.

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
# Optional, independent extensions:
apk add --allow-untrusted /tmp/luci-app-routerdeck-0.1.0-r1.apk
apk add --allow-untrusted /tmp/luci-app-routerdeck-workspace-0.1.0-r1.apk
```

## OpenWrt 24.10

```sh
opkg update
opkg install luci luci-theme-bootstrap
opkg install /tmp/luci-theme-routerdeck_0.1.0-r1_all.ipk
# Optional, independent extensions:
opkg install /tmp/luci-app-routerdeck_0.1.0-r1_all.ipk
opkg install /tmp/luci-app-routerdeck-workspace_0.1.0-r1_all.ipk
```

The base theme registers **RouterDeck** without selecting it automatically. In
LuCI choose **System → System → Language and Style → Design → RouterDeck** and
**Save & Apply**. Dashboard and Workspace appear under Status if installed.
Light/dark preference is per browser. The optional dashboard becomes the first
Status page; the original Overview remains available.

## Workspace

Workspace is experimental and optional. Open a permitted page from the selector.
Drag its title or use arrow keys on the title button to move it; Shift + arrows
resize. The bottom-right corner resizes with a pointer. Titlebar buttons reload,
minimize, maximize and close. Taskbar buttons restore and focus windows. Mobile
shows one window at a time. At most six windows may open, limiting polling load.

Edit and apply **one form at a time**. UCI staging belongs to the entire session.
Two edited windows cannot save concurrently through the standard LuCI action
buttons. After an apply, reload other windows before saving there. Closing an
edited window asks before discarding browser edits; already staged UCI changes
must still be applied or reverted using LuCI. Layout stores only allowed paths
and geometry; passwords, form values, session IDs and tokens are never stored.
Use normal full-page LuCI for third-party applications with custom save controls.

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
