#!/usr/bin/env bash
cd "$(dirname "$0")"
node scripts/preflight-bootstrap.js
node scripts/cli.js "$@"
