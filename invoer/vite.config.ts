import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";

// Maakt sw.js met de lijst van alle gebouwde bestanden, zodat de app
// na de eerste keer laden ook zonder verbinding opent.
function serviceWorker(): Plugin {
  return {
    name: "service-worker",
    apply: "build",
    generateBundle(_opties, bundel) {
      const bestanden = [...Object.keys(bundel).filter((f) => f !== "index.html"), "manifest.webmanifest", "icon.svg"].map((f) => `/invoer/${f}`);
      const versie = createHash("sha256").update(bestanden.join("|")).digest("hex").slice(0, 10);
      const code = readFileSync(new URL("./sw-sjabloon.js", import.meta.url), "utf8")
        .replace("__BESTANDEN__", JSON.stringify(bestanden))
        .replace("__VERSIE__", JSON.stringify(versie));
      this.emitFile({ type: "asset", fileName: "sw.js", source: code });
    },
  };
}

// De app draait op /invoer/ van de API-server. Tijdens ontwikkelen gaan
// API-verzoeken via een proxy naar de lokale API.
const API = process.env.API_URL ?? "http://localhost:3000";
const apiPaden = ["/auth", "/config", "/batches", "/registraties", "/lots", "/werkvoorraad", "/planning", "/overdracht", "/meldingen", "/stilstand", "/certificaten", "/beheer", "/analyse", "/gezondheid"];

export default defineConfig({
  base: "/invoer/",
  server: { proxy: Object.fromEntries(apiPaden.map((p) => [p, API])), fs: { allow: [".."] } },
  build: { target: "es2022" },
  plugins: [serviceWorker()],
});
