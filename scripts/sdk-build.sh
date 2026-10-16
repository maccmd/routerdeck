#!/bin/bash
set -euo pipefail
version=${ROUTERDECK_SDK_VERSION:?Set ROUTERDECK_SDK_VERSION}
case "$version" in 25.12.5) series=25.12; extension=apk ;; 24.10.8) series=24.10; extension=ipk ;; *) exit 2 ;; esac
cd /sdk
if [ ! -f .routerdeck-sdk-version ]; then
 tar --zstd -xf "/work/.cache/openwrt-sdk-$version.tar.zst" --strip-components=1
 printf '%s\n' "$version" > .routerdeck-sdk-version
fi
test "$(cat .routerdeck-sdk-version)" = "$version"
for package in luci-theme-routerdeck luci-app-routerdeck luci-app-routerdeck-workspace; do
 rm -rf "package/$package"
 cp -a "/work/$package" package/
done
# Only our architecture-independent packages are built. Their LuCI dependencies
# are resolved by the target's own package manager, preserving firmware versions.
if ! grep -q '^CONFIG_PACKAGE_luci-app-routerdeck-workspace=m' .config 2>/dev/null; then
cat > .config <<'CONFIG'
CONFIG_PACKAGE_luci-theme-routerdeck=m
CONFIG_PACKAGE_luci-app-routerdeck=m
CONFIG_PACKAGE_luci-app-routerdeck-workspace=m
CONFIG_SIGNED_PACKAGES=n
CONFIG_ALL_NONSHARED=n
CONFIG_ALL_KMODS=n
CONFIG_ALL=n
CONFIG_AUTOREMOVE=n
CONFIG_BUILD_LOG=y
CONFIG
make defconfig
fi
make package/luci-theme-routerdeck/clean package/luci-app-routerdeck/clean package/luci-app-routerdeck-workspace/clean
make package/luci-theme-routerdeck/compile package/luci-app-routerdeck/compile package/luci-app-routerdeck-workspace/compile V=s -j2
mkdir -p "/work/dist/packages/$series"
find bin/packages -name "*routerdeck*.$extension" -exec cp '{}' "/work/dist/packages/$series/" \;
cd "/work/dist/packages/$series"
sha256sum *."$extension" > SHA256SUMS
