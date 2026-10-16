#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
npm run check
npm run build
