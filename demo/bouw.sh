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
# De database in delen van hoogstens 4 MiB, met een lijst van lengte en controlesom, zodat de demo
# een onvolledige of veranderde download herkent (te grote bestanden kwamen niet heel aan).
node -e '
const fs=require("fs"),c=require("crypto");
const b=fs.readFileSync("dist/batchgui.tar.gz"),D=4*1024*1024,delen=[];
for(let i=0;i*D<b.length;i++){const n="batchgui-db-"+i+".wasm";fs.writeFileSync("dist/"+n,b.subarray(i*D,(i+1)*D));delen.push(n);}
fs.writeFileSync("dist/batchgui-db.json",JSON.stringify({grootte:b.length,sha256:c.createHash("sha256").update(b).digest("hex"),delen}));
fs.unlinkSync("dist/batchgui.tar.gz");'
for f in dist/assets/*.tar-*.gz dist/assets/*.data; do
  oud=$(basename "$f"); nieuw="${oud%.*}-bin.wasm"; mv "$f" "dist/assets/$nieuw"
  sed -i "s#$oud#$nieuw#g" dist/assets/*.js
done
echo "Demo klaar in demo/dist"
