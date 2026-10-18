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
packages="routerdeck-console"
for package in $packages; do
 rm -rf "package/$package"
 cp -a "/work/$package" package/
done
# Only our architecture-independent package is built. Its dependencies are
# resolved by the target's own package manager, preserving firmware versions.
if ! grep -q '^CONFIG_PACKAGE_routerdeck-console=m' .config 2>/dev/null; then
cat > .config <<'CONFIG'
CONFIG_PACKAGE_routerdeck-console=m
CONFIG_SIGNED_PACKAGES=n
CONFIG_ALL_NONSHARED=n
CONFIG_ALL_KMODS=n
CONFIG_ALL=n
CONFIG_AUTOREMOVE=n
CONFIG_BUILD_LOG=y
CONFIG
make defconfig
fi
make $(for package in $packages; do printf "package/%s/clean " "$package"; done)
make $(for package in $packages; do printf "package/%s/compile " "$package"; done) V=s -j2
# Earlier builds may have left other packages in dist/ and in the SDK volume.
rm -rf "/work/dist/packages/$series"
mkdir -p "/work/dist/packages/$series"
for package in $packages; do
 find bin/packages -name "$package[-_]*.$extension" -exec cp '{}' "/work/dist/packages/$series/" \;
done
cd "/work/dist/packages/$series"
sha256sum *."$extension" > SHA256SUMS
