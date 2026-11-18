// Maakt public/batchgui.tar.gz: PGlite-database met schema, regels en fictieve testdata.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const sql = (p) => readFileSync(new URL(p, import.meta.url), "utf8").split(/\r?\n/).filter((r) => !r.startsWith("\\")).join("\n");
const t0 = Date.now();
const db = await PGlite.create({ extensions: { pgcrypto } });
await db.exec(sql("../db/schema.sql"));
console.log("schema", Date.now() - t0, "ms");
await db.exec("BEGIN; SET LOCAL session_replication_role = replica;\n" + sql("../tools/pakket/testdata.sql") + "\nCOMMIT;");
console.log("data", Date.now() - t0, "ms");
// Fictief onderhoud, zodat Beheer → Server eruitziet als op een echte server (tijden vlak voor de laatste invoer).
await db.exec(`
  WITH t AS (SELECT max(gestart_op) AS m FROM fabriek.stapregistratie)
  INSERT INTO fabriek.onderhoud_log (soort, gestart_op, klaar_op, gelukt, bestand, grootte_bytes, versie, melding)
  SELECT 'migratie', m - interval '20 days', m - interval '20 days', true, NULL, NULL, '0.6.0', 'Nieuwe database aangemaakt op schemaversie 2' FROM t
  UNION ALL SELECT 'hersteltest', m - interval '17 days', m - interval '17 days' + interval '40 seconds', true, 'batchgui_demo.dump', 1250000, '0.6.0', 'Back-up volledig teruggezet in een tijdelijke database (demo)' FROM t
  UNION ALL SELECT 'backup', m - (g || ' hours')::interval, m - (g || ' hours')::interval + interval '3 seconds', true,
                   'batchgui_demo_' || g || '.dump', 1250000 + (10 - g) * 900, '0.6.0', NULL
            FROM t, generate_series(1, 4) g;
`);
await db.exec("VACUUM ANALYZE");
const r = await db.query("select count(*)::int n from fabriek.waarde");
console.log(r.rows);
const tar = await db.dumpDataDir("gzip");
mkdirSync(new URL("./public/", import.meta.url), { recursive: true });
writeFileSync(new URL("./public/batchgui.tar.gz", import.meta.url), Buffer.from(await tar.arrayBuffer()));
console.log("klaar", (tar.size / 1e6).toFixed(1), "MB");
