import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bouwApp } from "./app.js";
import { maakPool, controleerRuntimeRechten } from "./db.js";

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_GEHEIM = process.env.JWT_GEHEIM;
const POORT = Number(process.env.POORT ?? 3000);
const ADRES = process.env.ADRES ?? "0.0.0.0"; // bereikbaar op het fabrieksnetwerk

if (!DATABASE_URL) {
  console.error("Zet DATABASE_URL op de beperkte MES-databaseverbinding (D24).");
  process.exit(1);
}

if (!JWT_GEHEIM || JWT_GEHEIM.length < 32) {
  console.error("Zet JWT_GEHEIM op een willekeurige tekst van minstens 32 tekens.");
  process.exit(1);
}

const INVOER_MAP = process.env.INVOER_MAP ?? fileURLToPath(new URL("../../invoer/dist", import.meta.url));
const PORTAAL_MAP = process.env.PORTAAL_MAP ?? fileURLToPath(new URL("../../portaal/dist", import.meta.url));
// https: HTTPS_CERT + HTTPS_KEY (PEM-bestanden) of HTTPS_PFX (+ HTTPS_PFX_WACHTWOORD).
function leesHttps() {
  const { HTTPS_CERT, HTTPS_KEY, HTTPS_PFX, HTTPS_PFX_WACHTWOORD } = process.env;
  try {
    if (HTTPS_PFX) return { pfx: readFileSync(HTTPS_PFX), passphrase: HTTPS_PFX_WACHTWOORD };
    if (HTTPS_CERT || HTTPS_KEY) {
      if (!HTTPS_CERT || !HTTPS_KEY) throw new Error("zet zowel HTTPS_CERT als HTTPS_KEY");
      return { cert: readFileSync(HTTPS_CERT), key: readFileSync(HTTPS_KEY) };
    }
  } catch (e) {
    console.error(`Certificaat voor https kan niet worden gelezen: ${(e as Error).message}`);
    process.exit(1);
  }
  return undefined;
}
const https = leesHttps();

const db = maakPool(DATABASE_URL);
try {
  await controleerRuntimeRechten(db);
} catch {
  console.error("API-start geweigerd: controleer de databaseverbinding en beperkte runtime-rechten (D24).");
  await db.end();
  process.exit(1);
}

const app = await bouwApp({
  db,
  jwtGeheim: JWT_GEHEIM,
  logger: process.env.LOGNIVEAU ? { level: process.env.LOGNIVEAU } : true,
  invoerMap: INVOER_MAP,
  portaalMap: PORTAAL_MAP,
  https,
});
await app.listen({ port: POORT, host: ADRES });
app.log.info(`API-documentatie: ${https ? "https" : "http"}://localhost:${POORT}/docs`);
