#!/bin/sh
# Development only: copy the current RouterDeck Console files into a running
# disposable VM without rebuilding the package. Files are created by root in
# the guest; existing directories keep their owners and modes, and macOS
# metadata (._* files) is never sent. Use scripts/package.sh for real builds.
set -eu
cd "$(dirname "$0")/.."
node scripts/build-console.mjs
cd routerdeck-console
COPYFILE_DISABLE=1 tar --no-xattrs -cf - htdocs/routerdeck root | sh ../scripts/vm-ssh.sh '
set -e
rm -rf /tmp/routerdeck-push && mkdir /tmp/routerdeck-push && cd /tmp/routerdeck-push
tar -xof -
find htdocs/routerdeck -type f | while read -r file; do mkdir -p "/www/routerdeck"; cp "$file" "/www/routerdeck/${file#htdocs/routerdeck/}"; done
cd root
find . -type f | while read -r file; do mkdir -p "/${file%/*}"; cp "$file" "/${file#./}"; done
chmod 755 /etc/init.d/routerdeck-safemode /usr/libexec/routerdeck/safemode-watchdog /usr/libexec/routerdeck/diag /etc/init.d/routerdeck-netwatch /usr/libexec/routerdeck/netwatch; /etc/init.d/rpcd restart >/dev/null 2>&1; sleep 1
rm -rf /tmp/routerdeck-push
/etc/init.d/rpcd reload
echo "RouterDeck Console pushed; rpcd reloaded."
'
