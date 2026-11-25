#!/bin/sh
# Zet één versienummer voor het hele platform: tools/zet_versie.sh 0.6.0
set -e
V="$1"; [ -n "$V" ] || { echo "Gebruik: $0 <versie>"; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "$V" > "$ROOT/VERSIE"
for p in api invoer portaal; do (cd "$ROOT/$p" && npm version "$V" --no-git-tag-version --allow-same-version >/dev/null); done
sed -i -E "s/export const VERSIE = \"[^\"]+\"/export const VERSIE = \"$V\"/" "$ROOT/api/src/versie.ts" "$ROOT/gedeeld/versie.ts"
echo "Versie $V gezet. Vergeet CHANGELOG.md niet."
