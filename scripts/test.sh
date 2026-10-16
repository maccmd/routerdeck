#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
npm run check
npm test
npm run test:e2e
