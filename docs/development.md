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

`npm run dev` builds the console and serves it at
**http://127.0.0.1:5173/routerdeck/** with a simulated `/ubus` endpoint
(`scripts/mock-ubus.mjs`; log in as `root` with password `routerdeck`). Each
login gets its own simulated router (`scripts/mock-router.mjs`), started from
configuration captured on OpenWrt 25.12.5 (`tests/fixtures`), so parallel tests
never share state. `npm run dev:console` also rebuilds the console on every
source change; set `PORT` to serve on another port. Never use the preview as
proof of router behaviour.

## Source layout

- `console/src`: the client (Preact, bundled by esbuild). `api/rpc.js` is the
  ubus JSON-RPC client, `api/sources.js` the shared data sources, `mdi` the
  window manager, `list` and `item` the generic list and object windows.
- `console/src/model`: window models mapping UCI and runtime data to rows and
  forms back to UCI operations; unit-tested against captured router data.
- `console/src/cli`: the RouterOS-style command line over the same models.
- `routerdeck-console`: the OpenWrt package: rpcd ACL, the `routerdeck` ucode
  plugin and its helper module, the diagnostics runner, the Safe Mode watchdog
  and Netwatch services, and the generated `htdocs/routerdeck` bundle (not
  committed).
- `tests`: unit tests (`tests/unit`), browser tests against the simulated
  router (`tests/e2e`), checks against a real guest (`tests/vm`) and the package
  lifecycle (`tests/lifecycle`).
- `scripts`: the preview server and simulated router, pinned downloads,
  official SDK package builds and disposable VM tools.

## Checks and builds

```sh
npm run check
npm test
npm run build
npm run test:e2e
./scripts/package.sh 25.12.5
./scripts/package.sh 24.10.8
```

`npm run check` validates the JSON sources (ACL, fixtures). Unit tests cover
the models, the command line, the window manager, the RPC client and the
poller. Browser tests exercise Chromium and WebKit at four viewport sizes
against the simulated router; they do not validate rpcd, ACLs or services.
The [validation report](testing.md) records the latest results and gaps.

`npm run build` builds the console bundle into `routerdeck-console/htdocs`.
`scripts/package.sh` rebuilds it on the host before the SDK build, so it needs
`npm ci` first; the SDK container itself has no Node. The script downloads
the official SDK, verifies the pinned SHA-256 and builds through OpenWrt's
`BuildPackage` inside an amd64 Linux container. The package is
architecture-independent. Docker volumes cache extracted SDKs; `.cache` holds
downloads. The fixed `SOURCE_DATE_EPOCH` controls package timestamps. No
toolchain binaries are committed. Outputs are `dist/packages/25.12/*.apk` and
`dist/packages/24.10/*.ipk`, each with `SHA256SUMS`.

The SDK does not build the package's dependencies: they are resolved from the
target firmware's feeds. SDK warnings about absent feed packages are expected
in this minimal build.

## OpenWrt VM

The ARM `virt` image verifies OpenWrt behaviour, not NanoPi peripherals. QEMU
uses HVF on Apple Silicon and TCG elsewhere. Each guest has an isolated LAN and
a second user-mode NAT interface for package downloads. Only loopback HTTP/SSH
forwards are created; no tap, bridge, host interface or host route is configured.

```sh
python3 scripts/vm.py prepare --version 25.12.5
python3 scripts/vm.py start --version 25.12.5
python3 scripts/vm.py provision --version 25.12.5  # first boot only
python3 scripts/vm.py install --version 25.12.5
```

The console is then available at `http://127.0.0.1:8088/routerdeck/` (login
`root` with the guest password). 25.12 uses HTTP `127.0.0.1:8088` and SSH
`127.0.0.1:2222`; 24.10 uses 8089/2223. The temporary guest root password and
SSH key live under ignored `.cache/vm/`. Read the password locally to log in;
never commit it or attach credential-bearing traces. Provisioning touches only
the disposable guest: it gives the guest a fixed private LAN address and
installs the standard LuCI and firewall packages. For repeated builds with the
same package version, remove `routerdeck-console` from the guest before
installing again so the package manager does not keep old files.

While developing, `./scripts/console-push.sh` copies the current bundle and
backend files into the running guest without a package build (set
`ROUTERDECK_SSH_PORT=2223` for 24.10); files are created by root and existing
directories keep their owners. Reinstall the package afterwards to test
packaging.

Checks against the guest, each undoing its own changes:

```sh
npm run test:vm -- --project=chromium-1440
npx playwright test --config playwright.lifecycle.config.mjs
```

Some checks need optional packages in the guest (ttyd, wireguard-tools and
kmod-wireguard, miniupnpd-nftables, ddns-scripts, sqm-scripts, iperf3,
etherwake, and `kmod-mac80211-hwsim` with `wpad` for WiFi) and skip without
them. For the 24.10 guest:

```sh
ROUTERDECK_VM_PORT=8089 ROUTERDECK_SSH_PORT=2223 npm run test:vm -- --project=chromium-1440
ROUTERDECK_VM_PORT=8089 ROUTERDECK_SSH_PORT=2223 npx playwright test --config playwright.lifecycle.config.mjs
python3 scripts/vm.py stop --version 24.10.8
```

The lifecycle test removes and reinstalls the package and verifies that the
network, firewall, DHCP, rpcd and uhttpd configurations stay unchanged. Do
not aim these tests at a production router. Authentication traces are
disabled. Screenshots and reports go to ignored `output/playwright/`; reviewed
non-secret examples are copied to `docs/screenshots`.

## Releases

CI runs the Chromium/WebKit browser tests and builds APK/IPK through the same
SDK scripts. Real-VM tests are a local release gate. Update the package
version in `routerdeck-console/Makefile`, `package.json` and the lockfile
together with the release notes. Document changes after the published tag
under **Unreleased** in `CHANGELOG.md`; keep versioned release notes
historical. A matching `v*` Git tag publishes packages, checksums and a
prerelease. Stable status requires physical FriendlyWrt/NanoPi testing.
