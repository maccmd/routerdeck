#!/bin/sh
# Build using OpenWrt's official SDK / BuildPackage, never a renamed archive.
set -eu
cd "$(dirname "$0")/.."
version=${1:-25.12.5}
case "$version" in 25.12.5|24.10.8) ;; *) echo 'Supported SDKs: 25.12.5, 24.10.8' >&2; exit 2 ;; esac
python3 scripts/download.py "$version" sdk
# The console bundle is built on the host; the SDK container has no Node.
[ -d node_modules/esbuild ] || { echo "Run npm ci before packaging" >&2; exit 2; }
node scripts/build-console.mjs
docker build --platform linux/amd64 -t routerdeck-sdk -f scripts/sdk.Dockerfile scripts
docker run --rm --platform linux/amd64 \
 -v "$PWD:/work" -v "routerdeck-sdk-$version:/sdk" \
 -e "ROUTERDECK_SDK_VERSION=$version" -e "SOURCE_DATE_EPOCH=1792108800" \
 routerdeck-sdk bash /work/scripts/sdk-build.sh
