# RouterDeck Console

RouterDeck Console is a separate, experimental management interface for
OpenWrt, modelled on the way desktop router tools such as MikroTik WinBox
work. It is not a LuCI theme and does not need LuCI. It talks to rpcd over
uhttpd's `/ubus` JSON-RPC endpoint and edits UCI through its own rpcd plugin.
RouterDeck is not affiliated with MikroTik and uses none of its code or artwork.

[Russian plan and status](console-plan.ru.md) · [Development](development.md) · [Architecture](architecture.md#routerdeck-console)

![Interface list, firewall rules, a rule window and the command line in RouterDeck Console](screenshots/console-light.png)

Dark theme: [screenshot](screenshots/console-dark.png). Both show the simulated router of the development preview.

## What it does

- **Windows instead of pages.** A menu item opens a window inside the work
  area. Windows open cascaded where that kind of window was last placed and
  overlap; nothing is rearranged automatically. *Windows ▸ Cascade / Tile /
  Minimize All / Close All* arrange them on request. The open windows and
  their positions come back after a reload or the next login.
- **Object lists.** Each list has a `+ − ✓ ✗` and comment toolbar, Find, a
  flags column, `;;; comment` lines above commented objects, sorting, a column
  chooser (right-click a column header), multi-select, a context menu and a
  status bar with `N items (M selected)`. Data refreshes every one to five
  seconds without losing selection or scroll position.
- **Object windows.** Double-click or Enter opens an object: fields on the
  left, **OK / Cancel / Apply / Disable / Comment / Copy / Remove** on the
  right, a status bar below. Fields you have not touched keep following live
  data; the status bar says when the object changed on the router while you
  were editing it.
- **Changes apply at once.** OK, Apply, `✓ ✗`, Remove and drag-and-drop write
  the change, reload the affected service and record it. There is no
  separate *Save & Apply* step.
- **Undo / Redo** (toolbar, Ctrl+Z / Ctrl+Shift+Z) step through the last 100
  changes. A change made outside the console (LuCI, `uci` in a shell) blocks undoing
  across it instead of overwriting it.
- **Safe Mode** (toolbar, or Ctrl+X in the command line). While it is on, the
  router undoes every change made since you switched it on if this console
  stops answering for 120 seconds — for example after a change cut your own
  connection. Clicking it again keeps the changes; *Undo Safe Mode changes*
  restores the snapshot immediately. After 100 changes Safe Mode ends and keeps
  them. Another session (a new tab, or the console at a new address) sees who
  holds Safe Mode and can *Take over Safe Mode* to keep protecting the changes,
  or *Undo its changes* at once.
- **Quick Set** (first menu item) puts the Internet connection (DHCP, static
  or PPPoE) and NAT, the LAN address with its DHCP range, the WiFi name,
  password and on/off, and the router identity on one form. Everything edited
  is one change and one Undo step. A new LAN address moves the console: turn on
  Safe Mode first, then open the new address and take Safe Mode over to keep
  the change — otherwise it is undone after two minutes.
- **Tools.** *Ping* lists every request, lost ones included, with loss and
  min/avg/max; *Traceroute* probes every hop once per round, like mtr, and keeps
  loss, last, average, best, worst and deviation per hop; *Torch* shows Tx/Rx
  rates per connection on a chosen device, filtered by protocol, addresses and
  port and grouped by the fields you collect. *Bandwidth Test* runs iperf3
  against another iperf3 or waits as a one-off server; *IP Scan* pings a
  network and lists who answers with MAC and host name; *Netwatch* pings hosts
  from the router itself and runs commands when they go up or down; *Wake on
  LAN* sends a magic packet; *Graphs* and the *Traffic* tab of an interface
  draw live Tx/Rx.
- **System.** Identity, Clock (time zone, set from this computer), NTP,
  Logging, Password, Users, Certificates, Packages (install, upgrade,
  uninstall, check for updates), Scheduler (cron), Scripts, Startup (procd
  services), Resources, LEDs, Disks (with mount points and swap), Backup
  (download and restore), Firmware (sysupgrade), Reset Configuration and
  Reboot.
- **Files.** Browse the router's file system, upload, download, create
  folders and remove files.
- **Terminal.** *New Terminal* (Alt+T) is a command line in the RouterOS style
  (see [Command line](#command-line)). *New Shell* embeds the router's shell
  through [ttyd](https://github.com/tsl0922/ttyd), which asks for its own login.

## Windows and OpenWrt objects

| Window | OpenWrt source | Flags | Notes |
| --- | --- | --- | --- |
| Interfaces ▸ Interface | Linux network devices (`luci-rpc getNetworkDevices`), `network.device` sections | R running, S bridge port, D dynamic, I not present | Live Tx/Rx bit and packet rates. Bridges and VLANs can be added; MTU and MAC edited |
| Interfaces ▸ Networks | `network.interface` sections and runtime state | R running, X disabled, D dynamic | OpenWrt-specific: protocol, device, firewall zone, PPPoE/DHCP options |
| IP ▸ Addresses | `ipaddr` of static networks; addresses obtained by DHCP/PPP | D dynamic, I network down | A single address cannot be disabled or commented in UCI |
| IP ▸ Routes | kernel routes (`ip -j route`, busybox fallback) and `route` sections | X, D, A active, C connect, S static | Filter by routing table; static routes are matched to kernel routes |
| IP ▸ Firewall ▸ Filter Rules | `rule` sections in order, nftables counters | X disabled | Drag to reorder; comment is the rule `name`; counters reset on every fw4 reload |
| IP ▸ Firewall ▸ NAT | `redirect` (dst-nat), `nat` (src-nat, masquerade), zone masquerading | X, D zone masquerading | New src-nat rules are `nat` sections |
| IP ▸ Firewall ▸ Connections | `/proc/net/nf_conntrack` | A assured, U unreplied | First 2048 entries |
| IP ▸ Firewall ▸ Zones | `zone` and `forwarding` sections | X disabled | A zone used by rules cannot be removed; Advanced: family, covered devices and subnets, IPv6 masquerading and its sources and destinations, logging, connection helpers |
| IP ▸ Firewall ▸ Mangle | `rule` sections with target MARK or DSCP | X disabled | Mark packets or change DSCP in prerouting, input, forward, output or postrouting; fw4 picks the chain from the zones, and the form sets them that way |
| IP ▸ Firewall ▸ Raw | `rule` sections with target NOTRACK or HELPER | X disabled | Skip connection tracking, or attach a connection helper, for traffic from one zone |
| IP ▸ Firewall ▸ Settings | the `defaults` section | — | Policies, invalid packets, SYN flood protection, SYN cookies and FastPath (software and hardware flow offloading) |
| IP ▸ Settings | `/etc/sysctl.conf` and `/proc/sys` | — | Forwarding, RP filter, redirects, source routing, SYN cookies, ICMP rate, neighbour table and connection tracking limits and timeouts; applied at once, and Undo writes back the value from before the first change |
| IP ▸ Pool | `start` and `limit` of each `dhcp` section | X ignored | The range of a DHCP server, with how many addresses are leased |
| Bridge ▸ Bridge | `device` sections of type bridge | R running, D dynamic, I not created yet | OpenWrt creates a bridge only once a network uses it; STP, IGMP snooping, MTU, MAC |
| Bridge ▸ Ports | the bridge's `ports` list; members added at runtime | R running, I missing, D dynamic | PVID and tagged VLANs per port; removing a port also removes it from the bridge's VLANs |
| Bridge ▸ VLANs | `bridge-vlan` sections | I not active | Tagged, untagged and PVID ports; one PVID per port; the first VLAN turns on VLAN filtering |
| IPv6 ▸ Addresses | static `ip6addr`, addresses assigned from a prefix (`ip6assign`), DHCPv6/SLAAC, link-local | D dynamic, G global, L link-local, I not on the network | *From Pool* shows the assigned prefix; *Advertise* whether router advertisements are on |
| IPv6 ▸ Routes | kernel IPv6 routes and `route6` sections | X, D, A, C, S | Source-specific routes show their source prefix |
| IP ▸ DHCP Server ▸ DHCP | `dhcp` sections | X ignored | Address pool from the network's first address |
| IP ▸ DHCP Server ▸ Leases | active DHCPv4 leases and `host` sections | X disabled, D dynamic | *Make Static* reserves a dynamic lease. A lease does not prove a client is online |
| IP ▸ DHCP Server ▸ DHCPv6 Bindings | odhcpd's DHCPv6 leases and `host` sections with a DUID | X, D | *Make Static* stores the DUID and a host ID, so the client keeps its address suffix |
| IP ▸ DNS ▸ Settings | the `dnsmasq` section | — | Servers, dynamic servers from the networks, remote requests, cache, local domain, rebind protection, query log; Advanced: forwarding rules, AAAA/A filtering, cache TTLs, packet size, concurrent queries, port, rebind exceptions, extra hosts files, DNSSEC (dnsmasq-full) |
| IP ▸ DNS ▸ Static | `domain` (A/AAAA) and `cname` sections | X disabled | Answered by dnsmasq at once |
| WiFi ▸ WiFi Interfaces | `wifi-iface` sections and runtime state (`luci-rpc getWirelessDevices`, iwinfo) | R running, X disabled | Access points and stations: SSID, radio, networks, security and passphrase, hidden SSID, client isolation; roaming (802.11r with mobility domain, 802.11k, 802.11v), management frame protection, client limits, inactivity, WMM, DTIM, group rekeying, MAC filter |
| WiFi ▸ Radios | `wifi-device` sections | X disabled | Band, channel, width, country, Tx power; beacon interval, RTS and fragmentation thresholds, distance, cell density, legacy rates |
| WiFi ▸ Access List | `macfilter` and `maclist` of each access point | X filter off, C connected | One policy per access point, as OpenWrt has it: allow only listed clients, or deny listed ones |
| WiFi ▸ Registration | iwinfo association lists | — | Connected clients with signal, rates, uptime and DHCP host names |
| PPP | `interface` sections with a PPP protocol | R connected, X disabled | PPPoE and other PPP clients: user, password, service, AC, peer DNS, default route, keepalive, MTU, zone |
| Quick Set | `wan` and `lan` networks, their DHCP server and zone, LAN access points, `system` | — | One change for everything edited; see above |
| Interfaces ▸ Ethernet | Ethernet devices, link state, `device` sections | R link up, S bridge port | Speed, duplex and autonegotiation in the port's `device` section, where the driver allows them |
| Interfaces ▸ VLAN | `device` sections of type 8021q | R, I | The VLAN form of the device list |
| Interfaces ▸ WireGuard, WireGuard Peers | `interface` sections with proto wireguard, `wireguard_<interface>` peers, `wg show` | R running, X disabled; C handshake within 3 min | A new interface gets a private key made on the router; peers changes restart the interface |
| IP ▸ ARP, IPv6 ▸ Neighbors | the kernel's neighbour table (`ip neigh`) | D, C complete, I failed, S static lease, R router | *Make Static* reserves a DHCP lease |
| IP ▸ Firewall ▸ Address Lists | fw4 `ipset` sections and their entries | X list disabled, E empty | Rules use a list on their Advanced tab; removed entries leave nftables at once |
| IP ▸ DHCP Server ▸ Networks, Options | `dhcp_option` of each DHCP server | X, F forced | dnsmasq options: gateway (3), DNS (6), domain (15), NTP (42) and any other code |
| IP ▸ Services | uhttpd, dropbear and ttyd | X disabled | Ports and where SSH and ttyd listen; a new web port moves this console |
| IP ▸ UPnP | `upnpd` (miniupnpd) and its lease file | — | Settings, live mappings, ordered permission rules |
| IP ▸ Dynamic DNS | `ddns` service sections (ddns-scripts) and its run directory | X, R updater running, 6 IPv6 | Provider list from ddns-scripts or a custom update URL |
| Routing ▸ Rules | `rule` and `rule6` sections, `ip rule` | X, I invert, D kernel rule, A active | Policy routing to other tables |
| Queues ▸ SQM | `queue` sections (sqm-scripts), `tc` | X, R shaping | cake or fq_codel per device with link-layer settings |
| System ▸ … | `/etc/config/system`, `/etc/crontabs/root`, `rc list`, apk/opkg databases | — | Scheduler jobs: "# name" lines name them, commented-out jobs are disabled |
| System ▸ Packages | apk or opkg: installed packages, `apk list --upgradable` / `opkg list-upgradable` | D dependency, U update available | Install, Upgrade, Uninstall and Check For Updates run the package manager as a job and show its output; not undoable |
| System ▸ Scripts | `script` sections in `/etc/config/routerdeck` (the source keeps its lines) | — | *Run Script* shows the output; the scheduler and Netwatch run one with `/usr/libexec/routerdeck/run-script <name>`; *Jobs* lists running scripts and stops them |
| System ▸ Backup, Firmware, Reset Configuration | `sysupgrade -b`, `-r`, image check through procd's `validate_firmware_image`, `firstboot` | — | A backup and an image are uploaded, checked and confirmed before anything changes; an image the router rejects is never flashed; reset needs the overlay of squashfs images |
| Files | the file system through the plugin, transfers through cgi-io | — | Uploads, downloads and removals are not undoable; `/proc`, `/sys`, `/dev` and `/rom` cannot be changed |
| System ▸ Users | `login` sections of `/etc/config/rpcd` and the ACL groups in `/usr/share/rpcd/acl.d` | C this session's account | Groups full, read or custom ACL groups; a new password is hashed (SHA-512 crypt) in the browser, or the login uses a system account's password; the account you are logged in with cannot be removed |
| System ▸ Certificates | uhttpd's certificate and key, ACME certificates in `/etc/ssl/acme`, the CA bundle | K private key, A authority, T trusted, E expired | Parsed in the browser; Regenerate (px5g), Import (PEM or DER, certificate and key) and Restore Previous restart uhttpd and are not undoable |
| System ▸ LEDs | `led` sections of `/etc/config/system`, `/sys/class/leds` | D not set up, I not on this board, R lit | Triggers none, default-on, timer, heartbeat, netdev and those the LED offers; `/etc/init.d/led` applies them |
| System ▸ Disks | `/sys/block`, `block info`, `/proc/mounts`, `df`; `mount`, `swap` and `global` of `/etc/config/fstab` | M mounted, R removable; X, A active swap | Mount points name file systems by UUID and are mounted or unmounted at once (block-mount); Unmount and Mount All are not changes |
| Tools ▸ Bandwidth Test, IP Scan | `bandwidth` and `scan` jobs of the same runner | — | Need iperf3 for the bandwidth test |
| Tools ▸ Netwatch | `netwatch` sections in `/etc/config/routerdeck`, `routerdeck-netwatch` service | U up, D down, X disabled | Commands run on changes, not on the first check |
| Tools ▸ Wake on LAN | etherwake | — | Shown when etherwake is installed |
| Tools ▸ Ping, Traceroute | `ping` and `traceroute` jobs run by `/usr/libexec/routerdeck/diag` | — | Run outside rpcd; end when stopped, finished, unread for 15 seconds, or after an hour |
| Tools ▸ Torch | `/proc/net/nf_conntrack` every second | — | Rates from byte counters of tracked connections, oriented to the chosen device by the routing table |
| Log | logd (`log read`), `logread` fallback | — | Last 1000 lines, follows new entries |

Comments on routes, networks, devices, DHCP servers and static leases are
stored as `option comment`, which netifd and dnsmasq ignore.

## Keyboard

| Keys | Action |
| --- | --- |
| Insert / Delete | Add / remove in a list |
| Ctrl+E / Ctrl+D | Enable / disable the selection |
| Ctrl+M | Comment the selection |
| Ctrl+F | Find in the list |
| Enter, double-click | Open the selected object |
| Arrows, Shift+arrows, Ctrl+A | Move and extend the selection |
| Esc, F4 | Close the window |
| F6 / Shift+F6 | Next / previous window |
| Alt+T | New terminal (command line) |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Window title + arrows / Shift+arrows | Move / resize the window |

## Command line

*New Terminal* opens a command line that follows RouterOS: menus, then a
command, then `name=value` properties. It works on the same objects as the
windows, so every command is one change with one Undo step, and the property
names come from the form labels (*Src. Address* is `src-address`).

```
[root@OpenWrt] > /ip firewall filter print where protocol=udp
[root@OpenWrt] > /ip firewall filter add chain=input in-zone=wan protocol=tcp dst-port=8443 action=accept comment=web
[root@OpenWrt] > /ip address
[root@OpenWrt] /ip/address> add address=10.9.0.1/24 interface=lan
[root@OpenWrt] /ip/address> /interface bridge vlan print detail
[root@OpenWrt] > /ip dhcp-server lease make-static [find host-name=nas]
[root@OpenWrt] > /ping 192.0.2.1 count=4
[root@OpenWrt] > /export
```

- Menus: `/interface` (`bridge`, `bridge port`, `bridge vlan`, `ethernet`,
  `vlan`, `wireguard`, `wireguard peers`, `network`, `pppoe-client`, `wifi`,
  `wifi radio`, `wifi registration-table`, `wifi access-list`), `/ip` (`address`, `arp`, `route`,
  `firewall filter|nat|mangle|raw|address-list|connection|zone|settings`,
  `settings`, `pool`, `dhcp-server`,
  `dhcp-server network|lease|option`, `dns`, `dns static`, `ddns`, `service`,
  `upnp`, `upnp mapping|rule`), `/ipv6` (`address`, `neighbor`, `route`,
  `dhcp-server binding`), `/routing rule`, `/queue sqm`, `/log`, `/system`
  (`identity`, `clock`, `ntp client`, `logging`, `package` with `install`,
  `uninstall`, `upgrade` and `check-for-updates`, `scheduler`, `script` with
  `run` and `script job`, `startup`, `resource`, `leds`, `history`, and
  `reboot` and `reset-configuration`, which ask first), `/user`,
  `/certificate` (`trusted`), `/disk` (`mount`, `swap`, `settings`) and `/tool`
  (`traceroute`, `torch`, `bandwidth-test`, `ip-scan`, `netwatch`, `wol`).
  `/ip address` and
  `/ip/address` are the same; `..` goes up, `/` to the top; any unique
  abbreviation works (`/ip fi f pr`).
- Commands: `print` (`detail`, `count-only`, `where name=value`, `!=`, `~regex`,
  `disabled`, `!dynamic`), `find`, `add`, `set`, `remove`, `enable`, `disable`,
  `comment` and object tools such as `make-static`. Items are named by the
  number from the last `print` (a filtered print keeps the full numbers), by
  name, or with `[find ...]`. `comment=` and `disabled=` work with `add` and
  `set`.
- `export` prints a menu and everything below it as commands; passwords and
  keys appear only with `export show-sensitive`.
- `/ping` and `/tool traceroute` (`count`, `size`, `interval`, `max-hops`,
  `protocol`) stream results until done or Ctrl+C. `/undo`, `/redo`, `/quit`.
- Tab completes menus, commands, properties and their values; `?` lists what
  can follow. Up/Down recall earlier commands (kept in this browser), Ctrl+L
  clears, Ctrl+X toggles Safe Mode, and the prompt shows `<SAFE>` while it is on.

## Installation

Build the package and install `routerdeck-console` as described in
[Installation](installation.md), then open `http://<router>/routerdeck/` and
log in with a router account (root by default). Some windows need extra
packages, listed on the same page; the menu hides UPnP, Dynamic DNS, Queues,
Bandwidth Test and Wake on LAN until theirs is installed.

## How changes are made

Every action is one call to the `routerdeck` rpcd object (`apply`, `undo`,
`redo`, `safemode`). The plugin changes only `network`, `firewall`, `dhcp`,
`wireless`, `system`, `dropbear`, `uhttpd`, `ttyd`, `upnpd`, `ddns`, `sqm`,
`routerdeck`, `rpcd`, `fstab`, `/etc/crontabs/root` and `/etc/sysctl.conf`, and:

1. refuses to run while LuCI is waiting to confirm an *apply with rollback*,
   so the two rollbacks cannot overwrite each other;
2. stages the operations in a private UCI delta directory and commits only
   them, never other sessions' or a shell's pending `uci` changes;
3. runs `fw4 check` before and after firewall changes and rejects a change that
   makes fw4 skip a section as invalid (fw4 itself would only warn);
4. announces `config.change` so procd reloads the affected services;
5. keeps the previous and new file contents for Undo and Redo in
   `/var/run/routerdeck` (cleared at reboot). When another program changed
   other options of the file meanwhile (miniupnpd writes its UUID, for
   example), Undo and Redo carry the change over onto the file as it is;
   when sections were added, removed or moved, or the same options changed,
   they refuse;
6. after firewall changes, flushes the nftables sets of address lists that lost
   entries and deletes removed ones, because `fw4 reload` only adds to sets;
   after changes to WireGuard peers, restarts that interface, because netifd
   reads peers only when it brings the interface up; after changes to mount
   points, unmounts those removed or disabled and runs `block mount`; after
   changes to LEDs, runs `/etc/init.d/led start`.

Safe Mode stores a snapshot of those configurations. A procd service
(`routerdeck-safemode`), separate from rpcd, watches the console's heartbeats
and restores the snapshot, reloads services and writes a syslog line when they
stop. Changes made from LuCI or the shell while Safe Mode is active are undone
with it, as in RouterOS. A takeover moves Safe Mode to the new session and is
logged too.

Ping and Traceroute run as jobs: rpcd handles one call at a time, so a probe
waiting for its timeout inside the plugin would stall every window. The
plugin's `diag` method starts `/usr/libexec/routerdeck/diag` in the
background, reads its results and stops it; at most eight jobs run at once.
Bandwidth tests (iperf3) and IP scans use the same runner. Package
operations and scripts too, started by the plugin's `task` method: their
output streams line by line, a package operation always runs to its end and
only one runs at a time, and Stop ends a script with every command it
started. Netwatch is a procd service, `routerdeck-netwatch`, so it keeps
watching while no console is open.

Actions that are not configuration changes — starting a service, setting the
clock, changing the password, Wake on LAN, installing packages, files,
restoring a backup, flashing firmware — go straight to rpcd and are not in
the Undo history. Uploads go to `/tmp` through cgi-io first; the plugin checks
a backup (`tar -tzf`) or an image (`validate_firmware_image`) and the console
asks before restoring or flashing. Restoring, flashing and resetting refuse
while Safe Mode is on.

## Access and security

`/usr/share/rpcd/acl.d/routerdeck-console.json` grants the
`routerdeck-console` group read access to the status objects and UCI configs the
windows show (including iwinfo, the diagnostics jobs and directory listings),
and write access to the plugin's `apply`, `undo`, `redo`, `safemode`, `wol`,
`task`, `file_remove`, `file_mkdir`, `restore`, `firmware`, `reset`, `users`,
`certificate`, `unmount` and `mount`, `rc
init`, `system reboot`, LuCI's `setLocaltime` and `setPassword`, and reading
and writing any file through cgi-io. Only writers get file transfers: a
read-only account cannot download `/etc/shadow`. The plugin runs as root
inside rpcd; diagnostics accept only plain host names and addresses, and
package names are checked before they reach the package manager. Users with `read '*'` / `write '*'` in
`/etc/config/rpcd` (root by default) receive the group automatically. Serve
the router over HTTPS where untrusted users share the network; ttyd then also
needs SSL, or the browser blocks the embedded terminal.

## Known limitations

- Desktop browsers only; on narrow screens every window fills the work area.
- Traffic graphs are drawn from rates this console samples while a window
  needs them; the last five minutes live in the browser, not on the router.
- DHCP Networks and Options are dnsmasq options; where odhcpd is the main
  DHCPv4 server (`maindhcp`), the windows say so, because it ignores them.
- Package operations, file changes, a restored backup, flashed firmware and
  the password change cannot be undone, and Safe Mode does not cover them.
- Packages shows installed packages; finding packages to install by
  description stays in LuCI or `apk search`/`opkg find`.
- Torch measures connections tracked by the firewall, not packets on the wire:
  bridged traffic and anything without connection tracking is not shown, and
  the device a connection belongs to comes from the routing table.
- Quick Set edits OpenWrt's default layout (networks named `wan` and `lan`);
  other layouts are edited in the individual windows.
- The command line covers the objects the windows show. It has no scripting
  (`:put`, `:foreach`, variables), and `export` is not a full backup: options
  the windows do not model are not exported (use `sysupgrade -b` for that).
- PPP is the client side only; there is no PPP server or secrets list.
- fw4 resets rule counters whenever the firewall reloads; rules sharing a name
  show no counters, because nftables reports them under that one name.
- Safe Mode rolls back after 120 seconds without heartbeats, not after the TCP
  timeout RouterOS uses.
- ttyd binds to the LAN device; after that network is reconfigured it can stop
  accepting connections until `/etc/init.d/ttyd restart`. The Shell window
  says so and links to ttyd directly.
- Third-party UCI sections the windows do not model are left untouched and
  not shown.
