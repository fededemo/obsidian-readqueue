#!/usr/bin/env bash
# Gate local. No hay GitHub Actions: no pagamos runners
# (pigmistudio ADR-008).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck
npm run test
npm run build
