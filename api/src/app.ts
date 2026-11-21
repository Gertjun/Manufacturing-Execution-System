import { TESTACCOUNTS } from "./testaccounts.js";
import { VERSIE } from "./versie.js";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { registreerAuth } from "./auth.js";
import type { Db } from "./db.js";
import { foutAfhandeling } from "./fouten.js";
import authRoutes from "./routes/auth.js";
import configRoutes from "./routes/config.js";
import batchRoutes from "./routes/batches.js";
import registratieRoutes from "./routes/registraties.js";
import lotRoutes from "./routes/lots.js";
import beheerRoutes from "./routes/beheer.js";
import analyseRoutes from "./routes/analyse.js";
import planningRoutes from "./routes/planning.js";
import wandschermRoutes from "./routes/wandscherm.js";
import overdrachtRoutes from "./routes/overdracht.js";
import meldingRoutes from "./routes/meldingen.js";
import stilstandRoutes from "./routes/stilstand.js";
import certificaatRoutes from "./routes/certificaat.js";
import werkvoorraadRoutes from "./routes/werkvoorraad.js";
import herbewerkingRoutes from "./routes/herbewerkingen.js";
import keuringRoutes from "./routes/keuringen.js";
import naleveringRoutes from "./routes/nalevering.js";
import terugmeldingRoutes from "./routes/terugmeldingen.js";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";

export interface AppOpties {
  db: Db;
  jwtGeheim: string;
  logger?: boolean | { level: string };
  /** Map met het gebouwde invoerscherm; wordt op /invoer/ aangeboden. */
  invoerMap?: string;
  /** Map met de gebouwde portalen-app; wordt op /portaal/ aangeboden. */
  portaalMap?: string;
  /** https: certificaat en sleutel (PEM) of een .pfx met wachtwoord. Zonder: gewoon http. */
  https?: { key?: Buffer; cert?: Buffer; pfx?: Buffer; passphrase?: string };
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

export async function bouwApp({ db, jwtGeheim, logger = false, invoerMap, portaalMap, https }: AppOpties) {
  // Strikt: onbekende eigenschappen geven een fout in plaats van stil te verdwijnen.
  // Met https is het type van de onderliggende server anders; voor de routes maakt dat niet uit.
  const app = (
    Fastify({ logger, ajv: { customOptions: { removeAdditional: false } }, ...(https ? { https } : {}) }) as unknown as FastifyInstance
  ).withTypeProvider<TypeBoxTypeProvider>();
  app.decorate("db", db);
  app.setErrorHandler(foutAfhandeling);

  // Beveiligingskoppen (D45). Pagina's laden alleen scripts, stijlen en gegevens van deze server;
  // de API-documentatie (/docs) gebruikt eigen scripts en krijgt daarom geen CSP.
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    const type = String(reply.getHeader("content-type") ?? "");
    if (type.startsWith("text/html") && !req.url.startsWith("/docs")) {
      reply.header("content-security-policy", CSP);
      reply.header("x-frame-options", "DENY");
    }
    return payload;
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Batch input GUI API",
        version: VERSIE,
        description:
          "API voor invoer, beheer en analyse van batch- en lotgegevens. Alle regels worden ook door de database bewaakt. Fictieve data.",
      },
      components: {
        securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      },
      security: [{ bearer: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  await registreerAuth(app, jwtGeheim);

  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(configRoutes, { prefix: "/config" });
  await app.register(batchRoutes, { prefix: "/batches" });
  await app.register(registratieRoutes, { prefix: "/registraties" });
  await app.register(lotRoutes, { prefix: "/lots" });
  await app.register(beheerRoutes, { prefix: "/beheer" });
  await app.register(analyseRoutes, { prefix: "/analyse" });
  await app.register(werkvoorraadRoutes, { prefix: "/werkvoorraad" });
  await app.register(herbewerkingRoutes, { prefix: "/herbewerkingen" });
  await app.register(keuringRoutes, { prefix: "/keuringen" });
  await app.register(naleveringRoutes, { prefix: "/nalevering" });
  await app.register(terugmeldingRoutes, { prefix: "/terugmeldingen" });
  await app.register(planningRoutes, { prefix: "/planning" });
  await app.register(wandschermRoutes, { prefix: "/wandscherm" });
  await app.register(overdrachtRoutes, { prefix: "/overdracht" });
  await app.register(meldingRoutes, { prefix: "/meldingen" });
  await app.register(stilstandRoutes, { prefix: "/stilstand" });
  await app.register(certificaatRoutes, { prefix: "/certificaten" });

  // De invoerapplicatie (browser) op /invoer/.
  if (invoerMap && existsSync(invoerMap)) {
    await app.register(fastifyStatic, { root: invoerMap, prefix: "/invoer/", index: "index.html" });
  }
  // De startpagina noemt de testaccounts alleen als ze er echt zijn (testomgeving, laptop met testdata).
  let testCache: { op: number; ja: boolean } | null = null;
  const isTestomgeving = async () => {
    if (testCache && Date.now() - testCache.op < 60_000) return testCache.ja;
    let ja = false;
    try {
      const { rows } = await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM fabriek.gebruiker WHERE actief AND lower(gebruikersnaam) = ANY($1)", [TESTACCOUNTS.map(([n]) => n)]);
      ja = (rows[0]?.n ?? 0) >= 3;
    } catch { ja = false; }
    testCache = { op: Date.now(), ja };
    return ja;
  };
  // Eén ingang (D54): de startpagina van de portalen, met inloggen en daarna je portalen.
  // Zonder gebouwde portalen (alleen de API, zoals in de tests) de eenvoudige pagina met links.
  const metPortalen = !!portaalMap && existsSync(portaalMap);
  app.get("/", { schema: { hide: true } }, async (_req, reply) =>
    metPortalen ? reply.redirect("/portaal/") : reply.type("text/html; charset=utf-8").send(startpagina(await isTestomgeving())));
  // Testaccounts tonen op het inlogscherm, alleen in een testomgeving (D28).
  app.get("/auth/omgeving", {
    schema: {
      tags: ["inloggen"], security: [],
      description: "Of dit een testomgeving is (testaccounts met wachtwoord demo), voor het inlogscherm.",
      response: { 200: Type.Object({ test: Type.Boolean(), testaccounts: Type.Array(Type.Object({ naam: Type.String(), wat: Type.String() })) }) },
    },
  }, async () => {
    const test = await isTestomgeving();
    return { test, testaccounts: test ? TESTACCOUNTS.map(([naam, wat]) => ({ naam, wat })) : [] };
  });
  if (portaalMap && existsSync(portaalMap)) {
    await app.register(fastifyStatic, { root: portaalMap, prefix: "/portaal/", index: "index.html", decorateReply: false });
  }

  // Voor de monitoring van IT: 200 als applicatie en database werken, anders 503.
  app.get("/gezondheid", { schema: { tags: ["systeem"], security: [] } }, async (_req, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ok", versie: VERSIE, database: "ok" };
    } catch {
      return reply.code(503).send({ status: "fout", versie: VERSIE, database: "niet bereikbaar" });
    }
  });

  return app;
}

export type App = Awaited<ReturnType<typeof bouwApp>>;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // schermen zetten soms een style-attribuut
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Eenvoudige startpagina met de applicaties van het platform. */
export function startpagina(test: boolean): string {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Batch input GUI</title>
<style>
body{font:16px/1.5 system-ui,"Segoe UI",sans-serif;margin:0;background:#f3f5f7;color:#1d2733}
main{max-width:640px;margin:8vh auto;padding:0 20px}
h1{font-size:24px;margin:0 0 4px}p{margin:0 0 24px;color:#52606d}
a.app{display:block;background:#fff;border:1px solid #d5dbe1;border-radius:8px;padding:16px 20px;margin-bottom:12px;color:inherit;text-decoration:none}
a.app:hover,a.app:focus-visible{border-color:#2a78d6;outline:none}
a.app strong{display:block;font-size:18px;color:#1f5fae}
table{border-collapse:collapse;margin-top:8px;font-size:14px}td{padding:2px 16px 2px 0}
small{color:#52606d}
</style></head><body><main>
<h1>Batch input GUI</h1><p>${test ? "Testomgeving met fictieve gegevens · " : ""}versie ${VERSIE}</p>
<a class="app" href="/invoer/"><strong>Invoerscherm</strong>Voor operators op de vloer: stappen invoeren, lot samenstellen.</a>
<a class="app" href="/portaal/"><strong>Portalen</strong>Kwaliteit, Productie, Planning en Beheer, en het wandscherm.</a>
<a class="app" href="/docs"><strong>API-documentatie</strong>Alle functies van de server.</a>
${test ? `<small>Testaccounts, wachtwoord steeds <b>demo</b>:</small>
<table>${TESTACCOUNTS.map(([n, w]) => `<tr><td>${n}</td><td>${w}</td></tr>`).join("")}</table>` : ""}
</main></body></html>`;
}
