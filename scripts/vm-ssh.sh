#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec ssh -F /dev/null -i .cache/vm/id_ed25519 -p "${ROUTERDECK_SSH_PORT:-2222}" \
 -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new \
 -o UserKnownHostsFile=.cache/vm/known_hosts root@127.0.0.1 "$@"
