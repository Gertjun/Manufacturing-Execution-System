import { fileURLToPath } from "node:url";
import { bouwApp } from "./app.js";
import { maakPool } from "./db.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/batchgui";
const JWT_GEHEIM = process.env.JWT_GEHEIM;
const POORT = Number(process.env.POORT ?? 3000);
const ADRES = process.env.ADRES ?? "0.0.0.0"; // bereikbaar op het fabrieksnetwerk

if (!JWT_GEHEIM || JWT_GEHEIM.length < 32) {
  console.error("Zet JWT_GEHEIM op een willekeurige tekst van minstens 32 tekens.");
  process.exit(1);
}

const INVOER_MAP = process.env.INVOER_MAP ?? fileURLToPath(new URL("../../invoer/dist", import.meta.url));
const PORTAAL_MAP = process.env.PORTAAL_MAP ?? fileURLToPath(new URL("../../portaal/dist", import.meta.url));
const app = await bouwApp({ db: maakPool(DATABASE_URL), jwtGeheim: JWT_GEHEIM, logger: process.env.LOGNIVEAU ? { level: process.env.LOGNIVEAU } : true, invoerMap: INVOER_MAP, portaalMap: PORTAAL_MAP });
await app.listen({ port: POORT, host: ADRES });
app.log.info(`API-documentatie: http://localhost:${POORT}/docs`);
