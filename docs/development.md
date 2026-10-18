# Development

## Dependencies

Node.js 22+, npm and Python 3. Docker is needed for official Linux SDKs; QEMU is
needed for VM tests. On macOS Apple Silicon, `brew install qemu` supplies the
hypervisor-backed ARM emulator. Docker Desktop or another Docker runtime must
already be running. No privileged container or host networking is used.

```sh
npm ci
npx playwright install chromium webkit
npm run dev
```

Preview binds **127.0.0.1:5173**. Its JSON fixtures and mock forms are not shipped
to the router. `npm run dev` also builds RouterDeck Console and serves it at
`/routerdeck/` with a simulated `/ubus` endpoint (`scripts/mock-ubus.mjs`; log in
as `root` with password `routerdeck`). `npm run dev:console` rebuilds the console
on every source change. Theme, dashboard and window renderers are shared with LuCI;
the real data adapter is separate. Never use preview as proof of router behavior.

## Source layout

- `luci-theme-routerdeck`: ucode header/footer/auth integration and shared CSS.
- `luci-theme-routerdeck/ucode/template/themes/routerdeck/navigation.ut`: inline
  LuCI menu loading, retries and page/window controls.
- `luci-theme-routerdeck/htdocs/luci-static/resources/routerdeck-links.js`:
  permitted object links, native editor targets and read-only detail cards.
- `luci-app-routerdeck`: dashboard renderer and existing ubus/rpcd adapter.
- `luci-theme-routerdeck/htdocs/luci-static/routerdeck/windows.js`: native page
  windows, layout, editor presentation and form guards.
- `luci-app-routerdeck-workspace`: compatibility redirect for old bookmarks.
- `console`: RouterDeck Console client sources (Preact, bundled by esbuild).
  `src/api/rpc.js` is the ubus JSON-RPC client, `src/mdi` the window manager.
- `routerdeck-console`: the console's OpenWrt package: rpcd ACL, the `routerdeck`
  ucode plugin and the generated `htdocs/routerdeck` bundle (not committed).
- `preview`: simulated data and interactive visual development environment.
- `tests`: unit, preview, real LuCI and package lifecycle checks.
- `scripts`: pinned downloads, official SDK package builds, disposable VM tools.

## Checks and builds

```sh
npm run check
npm test
npm run build
npm run test:e2e
./scripts/package.sh 25.12.5
./scripts/package.sh 24.10.8
```

Syntax checks include the inline navigation script. Unit tests cover adapters,
context targets and failure recovery. Preview tests exercise both browsers at
desktop/mobile sizes; they do not validate native LuCI forms or RPC permissions.
The [validation report](testing.md) records the latest results and remaining gaps.

`npm run build` builds the console bundle into `routerdeck-console/htdocs` and the
static theme preview into `dist/preview`. `scripts/package.sh` rebuilds the console
bundle on the host before the SDK build, so it needs `npm ci` first; the SDK
container itself has no Node. Package scripts download the official
SDK, verify the pinned SHA-256, and build via OpenWrt `BuildPackage` inside an
amd64 Linux container. The packages are architecture-independent. Docker volumes
cache extracted SDKs; `.cache` holds downloads. The fixed `SOURCE_DATE_EPOCH`
controls package timestamps. No toolchain binaries are committed.
Outputs are `dist/packages/25.12/*.apk` and `dist/packages/24.10/*.ipk`, each
with `SHA256SUMS`. Published assets and unreleased builds can have identical
filenames until the next version bump; keep their output directories separate.

The SDK need not build LuCI itself: runtime dependencies are resolved from the
target firmware's feeds. SDK warnings about absent LuCI source packages are
expected in this minimal build. The target package manager must resolve all
declared dependencies; never force dependency bypasses on a router.

## OpenWrt VM

The ARM `virt` image verifies LuCI behavior, not NanoPi peripherals. QEMU uses
HVF on Apple Silicon and TCG elsewhere. Each guest has an isolated LAN and a
second user-mode NAT interface for package downloads. Only loopback HTTP/SSH
forwards are created; no tap, bridge, host interface or host route is configured.

```sh
python3 scripts/vm.py prepare --version 25.12.5
python3 scripts/vm.py start --version 25.12.5
python3 scripts/vm.py provision --version 25.12.5  # first boot only
python3 scripts/vm.py install --version 25.12.5
```

The install helper selects RouterDeck in this disposable guest. RouterDeck Console
is then available at `http://127.0.0.1:8088/routerdeck/` (login `root` with the
guest password). For repeated
builds with the same package version, remove the guest's RouterDeck packages
before installing again so the package manager does not retain old files.

25.12 uses HTTP `127.0.0.1:8088`, SSH `127.0.0.1:2222`; 24.10 uses 8089/2223.
The temporary guest root password and SSH key live under ignored `.cache/vm/`.
Read the password locally to log in; never commit it or attach credential-bearing
traces. Provisioning touches only the disposable guest. It gives the guest a
fixed private LAN IP and installs standard LuCI/firewall packages.

```sh
npm run test:vm
npx playwright test --config playwright.lifecycle.config.mjs
```

For a focused desktop/mobile window-guard check on the running 25.12 guest:

```sh
npm run test:vm -- tests/vm/workspace.spec.mjs \
  --project=chromium-1440 --project=webkit-1440 \
  --project=chromium-390 --project=webkit-390
```

The spec retains its historical `workspace` filename but tests windows opened
from ordinary pages. It uses an apply event to test stale-state handling without
applying configuration. For full tests against the separately prepared 24.10 guest:

```sh
ROUTERDECK_VM_PORT=8089 ROUTERDECK_SSH_PORT=2223 npm run test:vm
ROUTERDECK_VM_PORT=8089 ROUTERDECK_SSH_PORT=2223 npx playwright test --config playwright.lifecycle.config.mjs
python3 scripts/vm.py stop --version 24.10.8
```

The full VM suite changes a disposable hostname and restores it. Lifecycle tests
change the guest design, remove/reinstall RouterDeck packages and verify network/firewall/
DHCP hashes remain unchanged. Do not aim these tests at a production router.
Authentication traces are disabled. Screenshots and reports go to ignored
`output/playwright/`; reviewed non-secret examples are copied to `docs/screenshots`.

## Releases

CI runs Chromium/WebKit preview checks and builds APK/IPK through the same SDK
scripts. Real-VM tests are a local release gate. Update all package versions,
`package.json`/lockfile, asset version strings and release notes together.
A theme change also needs the affected asset cache suffixes updated in the
header/footer and preview entrypoint. Document changes after the published tag
under **Unreleased** in `CHANGELOG.md`; keep versioned release notes historical.
A matching `v*` Git tag publishes packages, checksums and a prerelease. Stable
status requires physical FriendlyWrt/NanoPi testing and a broader extension audit.
