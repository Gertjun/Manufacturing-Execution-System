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
await db.exec("VACUUM ANALYZE");
const r = await db.query("select count(*)::int n from fabriek.waarde");
console.log(r.rows);
const tar = await db.dumpDataDir("gzip");
mkdirSync(new URL("./public/", import.meta.url), { recursive: true });
writeFileSync(new URL("./public/batchgui.tar.gz", import.meta.url), Buffer.from(await tar.arrayBuffer()));
console.log("klaar", (tar.size / 1e6).toFixed(1), "MB");
