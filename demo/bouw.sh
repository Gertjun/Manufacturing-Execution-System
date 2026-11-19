#!/bin/sh
# Bouwt de browserdemo in demo/dist: shell + database, en invoerscherm en portalen met relatieve paden.
set -e
cd "$(dirname "$0")"
# Database opnieuw maken als hij ontbreekt of ouder is dan het schema, de seeds, de generator of de data-opbouw.
nieuw=0
[ -f public/batchgui.tar.gz ] || nieuw=1
for f in ../db/schema.sql ../db/seed_*.sql ../tools/genereer_testdata.py maak_data.mjs; do
  [ "$f" -nt public/batchgui.tar.gz ] && nieuw=1
done
[ "$nieuw" = 1 ] && node maak_data.mjs
rm -rf dist
npx vite build
(cd ../invoer && npx vite build --base ./ --outDir ../demo/dist/invoer --emptyOutDir)
(cd ../portaal && npx vite build --base ./ --outDir ../demo/dist/portaal --emptyOutDir)
rm -f dist/invoer/sw.js
for f in dist/invoer/index.html dist/portaal/index.html; do
  sed -i 's#<head>#<head>\n    <script src="../demo-shim.js"></script>#' "$f"
done

# Het publicatieplatform serveert geen .gz of .data: zelfde inhoud, extensie .wasm.
mv dist/batchgui.tar.gz dist/batchgui-db.wasm
for f in dist/assets/*.tar-*.gz dist/assets/*.data; do
  oud=$(basename "$f"); nieuw="${oud%.*}-bin.wasm"; mv "$f" "dist/assets/$nieuw"
  sed -i "s#$oud#$nieuw#g" dist/assets/*.js
done
echo "Demo klaar in demo/dist"
