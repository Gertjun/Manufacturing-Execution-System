import { VERSIE } from "./versie.js";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
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
import werkvoorraadRoutes from "./routes/werkvoorraad.js";
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

  // De invoerapplicatie (browser) op /invoer/.
  if (invoerMap && existsSync(invoerMap)) {
    await app.register(fastifyStatic, { root: invoerMap, prefix: "/invoer/", index: "index.html" });
  }
  app.get("/", { schema: { hide: true } }, (_req, reply) => reply.type("text/html; charset=utf-8").send(STARTPAGINA));
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

/** Eenvoudige startpagina met de twee applicaties van het platform. */
const STARTPAGINA = `<!doctype html><html lang="nl"><head><meta charset="utf-8">
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
<h1>Batch input GUI</h1><p>Testomgeving met fictieve gegevens · versie ${VERSIE}</p>
<a class="app" href="/invoer/"><strong>Invoerscherm</strong>Voor operators op de vloer: stappen invoeren, lot samenstellen.</a>
<a class="app" href="/portaal/"><strong>Portalen</strong>Kwaliteit, Productie en Beheer.</a>
<a class="app" href="/docs"><strong>API-documentatie</strong>Alle functies van de server.</a>
<small>Testaccounts, wachtwoord steeds <b>demo</b>:</small>
<table><tr><td>operator</td><td>invoerscherm</td></tr><tr><td>ploegleider1</td><td>invoerscherm en Portaal Productie</td></tr>
<tr><td>kwaliteit1</td><td>Portaal Kwaliteit</td></tr><tr><td>beheerder1</td><td>Portaal Beheer</td></tr><tr><td>analist1</td><td>portalen, alleen lezen</td></tr></table>
</main></body></html>`;
