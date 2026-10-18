#!/usr/bin/env python3
"""Manage only RouterDeck's disposable QEMU guests, with loopback forwarding."""
import argparse
import os
import pathlib
import platform
import secrets
import socket
import subprocess
import time
from download import ROOT, RELEASES, prepare

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=['prepare', 'start', 'provision', 'install', 'stop'])
parser.add_argument('--version', choices=RELEASES, default='25.12.5')
args = parser.parse_args()
release = RELEASES[args.version]
folder = ROOT / '.cache' / release['cache']
shared = ROOT / '.cache/vm'
serial = folder / 'console.sock'
monitor = folder / 'monitor.sock'
env = dict(os.environ, ROUTERDECK_SSH_PORT=str(release['ssh']))

def ssh(command, **kwargs):
    return subprocess.run(['sh', str(ROOT / 'scripts/vm-ssh.sh'), command], env=env, check=True, **kwargs)

def credentials():
    shared.mkdir(parents=True, exist_ok=True)
    if not (shared / 'id_ed25519').exists():
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'routerdeck-local-vm', '-f', str(shared / 'id_ed25519')], check=True)
    if not (shared / 'password').exists():
        with os.fdopen(os.open(shared / 'password', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as target:
            target.write(secrets.token_urlsafe(24))

if args.action == 'prepare':
    prepare(args.version, 'vm')
    credentials()
elif args.action == 'start':
    prepare(args.version, 'vm')
    credentials()
    for port in [release['http'], release['ssh']]:
        with socket.socket() as check:
            try:
                check.bind(('127.0.0.1', port))
            except OSError:
                raise SystemExit(f'Port {port} is busy. No existing process was stopped.')
    accelerator = ['-accel', 'hvf', '-cpu', 'host'] if platform.system() == 'Darwin' and platform.machine() == 'arm64' else ['-accel', 'tcg', '-cpu', 'cortex-a53']
    command = ['qemu-system-aarch64', '-machine', 'virt', *accelerator, '-smp', '2', '-m', '768',
        '-kernel', str(folder / 'kernel.bin'), '-append', 'root=/dev/vda rootwait console=ttyAMA0',
        '-drive', f'file={folder}/rootfs.img,format=raw,if=virtio',
        '-netdev', f"user,id=lan,net={release['subnet']}.0/24,hostfwd=tcp:127.0.0.1:{release['http']}-{release['subnet']}.1:80,hostfwd=tcp:127.0.0.1:{release['ssh']}-{release['subnet']}.1:22,restrict=on",
        '-device', 'virtio-net-pci,netdev=lan', '-netdev', 'user,id=wan', '-device', 'virtio-net-pci,netdev=wan',
        '-display', 'none', '-serial', f'unix:{serial},server=on,wait=off', '-monitor', f'unix:{monitor},server=on,wait=off', '-pidfile', str(folder / 'qemu.pid'), '-daemonize']
    subprocess.run(command, check=True)
    print(f"Started OpenWrt {args.version}; HTTP 127.0.0.1:{release['http']}, SSH 127.0.0.1:{release['ssh']}. Run provision on first boot.")
elif args.action == 'provision':
    credentials()
    # Provision only through the task-owned Unix console; no host interfaces.
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as console:
        console.connect(str(serial))
        console.settimeout(1)
        deadline, output = time.monotonic() + 45, b''
        while time.monotonic() < deadline:
            console.sendall(b'\x03\r')
            try:
                output += console.recv(65536)
            except socket.timeout:
                pass
            if b'root@' in output and b'#' in output[-100:]:
                break
        else:
            raise SystemExit('No first-boot shell. Existing guests can use install directly.')
        public_key = (shared / 'id_ed25519.pub').read_text().strip()
        commands = [f"uci set network.lan.ipaddr='{release['subnet']}.1'", "uci set network.lan.netmask='255.255.255.0'", 'uci commit network',
            'mkdir -p /etc/dropbear', f"printf '%s\\n' '{public_key}' > /etc/dropbear/authorized_keys", 'chmod 600 /etc/dropbear/authorized_keys', '/etc/init.d/network restart']
        # Serial terminals need CR and a prompt between commands. Sending a
        # multiline paste can concatenate lines in the guest's interactive shell.
        for index, command in enumerate(commands):
            marker = '__ROUTERDECK_DONE_' + str(index) + '__'
            line = command + '; printf "\\n' + marker + '\\n"'
            # PL011's serial input FIFO is small. Pace input instead of pasting
            # a burst which can silently drop characters on fast host CPUs.
            for char in line + '\r':
                console.sendall(char.encode())
                time.sleep(0.003)
            answer, deadline = b'', time.monotonic() + 15
            while time.monotonic() < deadline:
                try:
                    answer += console.recv(65536)
                except socket.timeout:
                    continue
                if ('\r\n' + marker + '\r\n').encode() in answer:
                    break
            else:
                raise SystemExit('Guest console did not complete a provisioning command')
    for attempt in range(30):
        try:
            ssh('true', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            break
        except subprocess.CalledProcessError:
            time.sleep(1)
    else:
        raise SystemExit('Guest SSH did not become available')
    password = (shared / 'password').read_text()
    ssh('passwd root', input=(password + '\n' + password + '\n').encode(), stdout=subprocess.DEVNULL)
    # A shell prompt can precede WAN DHCP readiness. Retry package index refresh.
    manager = 'apk update && apk add luci luci-app-firewall' if release['format'] == 'apk' else 'opkg update && opkg install luci luci-app-firewall'
    for attempt in range(3):
        try:
            ssh(manager)
            break
        except subprocess.CalledProcessError:
            if attempt == 2:
                raise
            time.sleep(2)
    print('Provisioned. Password is in .cache/vm/password (not committed).')
elif args.action == 'install':
    files = sorted((ROOT / 'dist/packages' / release['series']).glob('*.' + release['format']))
    if len(files) != 4:
        raise SystemExit('Build all four packages with scripts/package.sh first')
    for package in files:
        ssh('cat > /tmp/' + package.name, input=package.read_bytes())
    paths = ' '.join('/tmp/' + package.name for package in files)
    command = 'apk add --allow-untrusted ' if release['format'] == 'apk' else 'opkg install '
    ssh(command + paths)
    ssh('uci set luci.main.mediaurlbase=/luci-static/routerdeck && uci commit luci')
    print(f"RouterDeck installed: http://127.0.0.1:{release['http']}/cgi-bin/luci/ and /routerdeck/")
elif args.action == 'stop':
    # Address only the monitor created by this script, never kill by process name.
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as control:
        control.connect(str(monitor))
        try:
            ssh('poweroff', stdout=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            control.sendall(b'system_powerdown\n')
    for attempt in range(20):
        if not (folder / 'qemu.pid').exists():
            print('RouterDeck guest stopped cleanly.')
            break
        time.sleep(.5)
    else:
        raise SystemExit('Shutdown requested but not confirmed. No process was killed. Provision SSH before retrying.')
