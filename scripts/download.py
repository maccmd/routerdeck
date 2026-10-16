#!/usr/bin/env python3
"""Download a pinned OpenWrt SDK or VM image and verify its SHA-256."""
import gzip
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RELEASES = json.loads((ROOT / 'scripts/releases.json').read_text())

def download(url, destination, digest):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        temporary = destination.with_suffix(destination.suffix + '.part')
        subprocess.run(['curl', '-fL', '--retry', '3', url, '-o', str(temporary)], check=True)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
            temporary.unlink()
            raise RuntimeError(f'Checksum mismatch: {destination.name}')
        temporary.replace(destination)
    if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
        raise RuntimeError(f'Checksum mismatch: {destination}; remove this cached download and retry')
    print(f'Verified {destination.name}')

def prepare(version, kind):
    release = RELEASES[version]
    base = f'https://downloads.openwrt.org/releases/{version}/targets/armsr/armv8/'
    if kind == 'sdk':
        download(base + release['sdk'], ROOT / f'.cache/openwrt-sdk-{version}.tar.zst', release['sdk_sha256'])
    elif kind == 'vm':
        folder = ROOT / '.cache' / release['cache']
        prefix = f'openwrt-{version}-armsr-armv8-generic-'
        download(base + prefix + 'kernel.bin', folder / 'kernel.bin', release['kernel'])
        download(base + prefix + 'ext4-rootfs.img.gz', folder / 'rootfs.img.gz', release['rootfs'])
        if not (folder / 'rootfs.img').exists():
            with gzip.open(folder / 'rootfs.img.gz', 'rb') as source, (folder / 'rootfs.img').open('wb') as target:
                shutil.copyfileobj(source, target)
    else:
        raise ValueError('Expected sdk or vm')

if __name__ == '__main__':
    prepare(sys.argv[1], sys.argv[2])
