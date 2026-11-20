// Browserdemo: de echte API-routes draaien hier in de browser, tegen PostgreSQL in de
// browser (PGlite). Er is geen server; invoerscherm en portalen roepen deze functie aan
// in plaats van het netwerk. Alleen voor een demo met fictieve gegevens.

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { foutAfhandeling } from "../../api/src/fouten";
import authRoutes from "../../api/src/routes/auth";
import configRoutes from "../../api/src/routes/config";
import batchRoutes from "../../api/src/routes/batches";
import registratieRoutes from "../../api/src/routes/registraties";
import lotRoutes from "../../api/src/routes/lots";
import beheerRoutes from "../../api/src/routes/beheer";
import analyseRoutes from "../../api/src/routes/analyse";
import werkvoorraadRoutes from "../../api/src/routes/werkvoorraad";
import planningRoutes from "../../api/src/routes/planning";
import wandschermRoutes from "../../api/src/routes/wandscherm";
import overdrachtRoutes from "../../api/src/routes/overdracht";
import meldingRoutes from "../../api/src/routes/meldingen";
import stilstandRoutes from "../../api/src/routes/stilstand";
import certificaatRoutes from "../../api/src/routes/certificaat";
import { VERSIE } from "../../api/src/versie";

export const DB_NAAM = `batchgui-demo-${VERSIE}`;

// ---------- Database ----------

type Resultaat = { rows: any[]; rowCount: number };

/** Eén verbinding: transacties mogen niet door elkaar lopen, dus om de beurt. */
class DemoPool {
  private wachtrij: Promise<void> = Promise.resolve();
  constructor(private pg: PGlite) {}

  private async slot(): Promise<() => void> {
    let vrij!: () => void;
    const vorige = this.wachtrij;
    this.wachtrij = new Promise((r) => (vrij = r));
    await vorige;
    return vrij;
  }

  async voer(text: string, params: unknown[] = []): Promise<Resultaat> {
    const r = await this.pg.query(text, params as any[]);
    return { rows: r.rows as any[], rowCount: r.fields.length > 0 ? r.rows.length : (r.affectedRows ?? 0) };
  }

  async connect() {
    const release = await this.slot();
    return { query: (t: string, p?: unknown[]) => this.voer(t, p), release };
  }

  async query(t: string, p?: unknown[]) {
    const release = await this.slot();
    try {
      return await this.voer(t, p);
    } finally {
      release();
    }
  }
}

/** Start PGlite. De eerste keer vanuit het meegeleverde databasebestand, daarna uit de browseropslag. */
export async function startDatabase(melding: (t: string) => void): Promise<{ pg: PGlite; bewaard: boolean }> {
  const opties = {
    extensions: { pgcrypto: gecontroleerd(pgcrypto) },
    relaxedDurability: true,
    parsers: { 1700: (v: string) => Number(v), 20: (v: string) => Number(v), 1082: (v: string) => v },
  };
  const bestaat = await bestaatOpslag();
  let pg: PGlite;
  let bewaard = true;
  if (bestaat) {
    melding("Database openen …");
    pg = await fase("database openen", () => PGlite.create(`idb://${DB_NAAM}`, opties));
  } else {
    melding("Fictieve fabrieksdata downloaden (ca. 10 MB) …");
    const blob = await fase("database downloaden", haalDatabase);
    melding("Database opstarten …");
    try {
      pg = await PGlite.create(`idb://${DB_NAAM}`, { ...opties, loadDataDir: blob });
    } catch (e) {
      console.warn("Browseropslag niet bruikbaar, demo draait in het geheugen:", e);
      // Geen browseropslag beschikbaar: alles in het geheugen (weg na herladen).
      pg = await fase("database starten", () => PGlite.create({ ...opties, loadDataDir: blob }));
      bewaard = false;
    }
    melding("Tijdstippen naar vandaag verschuiven …");
    await verschuifNaarNu(pg);
  }
  await pg.exec("SET TIME ZONE 'Europe/Amsterdam'");
  return { pg, bewaard };
}

/** Zet de naam van de fase voor een foutmelding, zodat zichtbaar is wat er misging. */
async function fase<T>(naam: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(`${naam}: ${(e as Error).message ?? e}`);
  }
}

const isGzip = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b;
const isTar = (b: Uint8Array) => new TextDecoder().decode(b.subarray(257, 262)) === "ustar";
const stroomNaar = async (b: Uint8Array, t: TransformStream<Uint8Array, Uint8Array>) =>
  new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(t)).arrayBuffer());

/** Haalt het pakket van een uitbreiding zelf op en controleert het, voordat PGlite het uitpakt. */
function gecontroleerd<T extends { setup: (...a: any[]) => Promise<any> }>(ext: T): T {
  return {
    ...ext,
    setup: async (...a: any[]) => {
      const r = await ext.setup(...a);
      if (!r?.bundlePath) return r;
      return fase("uitbreiding pgcrypto", async () => {
        const antwoord = await fetch(String(r.bundlePath));
        if (!antwoord.ok) throw new Error(`downloaden mislukt (status ${antwoord.status})`);
        let b = new Uint8Array(await antwoord.arrayBuffer());
        const info = `${b.length} bytes, ${antwoord.headers.get("content-type") ?? "?"}`;
        if (!isGzip(b)) {
          if (!isTar(b)) throw new Error(`onbekende inhoud (${info})`);
          b = await stroomNaar(b, new CompressionStream("gzip"));
        } else if (!isTar(await stroomNaar(b, new DecompressionStream("gzip")))) {
          throw new Error(`pakket is beschadigd (${info})`);
        }
        return { ...r, bundlePath: new URL(URL.createObjectURL(new Blob([b]))) };
      });
    },
  } as T;
}

/** Haalt de database in delen op, controleert lengte en controlesom en pakt hem uit tot een tar-bestand. */
async function haalDatabase(): Promise<Blob> {
  const url = (n: string) => new URL(n, location.href);
  const haal = async (n: string) => {
    const r = await fetch(url(n), { cache: "no-cache" });
    if (!r.ok) throw new Error(`downloaden van ${n} mislukt (status ${r.status})`);
    return r;
  };
  const lijst = (await (await haal("batchgui-db.json")).json()) as { grootte: number; sha256: string; delen: string[] };
  const delen = await Promise.all(lijst.delen.map(async (n) => new Uint8Array(await (await haal(n)).arrayBuffer())));
  const lengte = delen.reduce((t, d) => t + d.length, 0);
  if (lengte !== lijst.grootte) throw new Error(`de database kwam onvolledig binnen (${lengte} van ${lijst.grootte} bytes)`);
  let data = new Uint8Array(lengte);
  let pos = 0;
  for (const d of delen) { data.set(d, pos); pos += d.length; }
  const som = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (som !== lijst.sha256) throw new Error("de database kwam beschadigd binnen (controlesom klopt niet)");
  if (isGzip(data)) data = await stroomNaar(data, new DecompressionStream("gzip"));
  if (!isTar(data)) throw new Error("de database is na het uitpakken geen geldig archief");
  return new Blob([data], { type: "application/x-tar" });
}

async function bestaatOpslag(): Promise<boolean> {
  try {
    const lijst = await indexedDB.databases?.();
    return !!lijst?.some((d) => d.name === `/pglite/${DB_NAAM}`);
  } catch {
    return false;
  }
}

export async function wisOpslag() {
  await new Promise<void>((klaar) => {
    try {
      const r = indexedDB.deleteDatabase(`/pglite/${DB_NAAM}`);
      r.onsuccess = r.onerror = r.onblocked = () => klaar();
    } catch {
      klaar();
    }
  });
  try {
    localStorage.clear();
  } catch {}
}

/** Zelfde verschuiving als het laptoppakket: de testdata loopt tot nu. */
async function verschuifNaarNu(pg: PGlite) {
  await pg.exec("BEGIN; SET LOCAL session_replication_role = replica; SET LOCAL search_path = fabriek, public;");
  const { rows: kol } = await pg.query<{ table_name: string; column_name: string }>(`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'fabriek' AND t.table_type = 'BASE TABLE' AND c.data_type = 'timestamp with time zone'`);
  // Het laatste tijdstip van de productie zelf (niet het moment dat de demo is gebouwd).
  const delen = kol.filter((k) => !["schema_versie", "onderhoud_log"].includes(k.table_name))
    .map((k) => `SELECT max("${k.column_name}") AS t FROM "${k.table_name}"`);
  const { rows } = await pg.query<{ v: string; dagen: number }>(
    `SELECT v::text, ((m + v)::date - m::date) AS dagen FROM (SELECT max(t) AS m, now() - max(t) - interval '10 minutes' AS v FROM (${delen.join(" UNION ALL ")}) x) y`,
  );
  // Per tabel alle tijdkolommen in één keer, zodat regels als "einde na begin" blijven kloppen.
  const perTabel = new Map<string, string[]>();
  for (const k of kol) perTabel.set(k.table_name, [...(perTabel.get(k.table_name) ?? []), k.column_name]);
  for (const [tabel, kols] of perTabel) {
    await pg.query(`UPDATE "${tabel}" SET ${kols.map((c) => `"${c}" = "${c}" + $1::interval`).join(", ")}`, [rows[0].v]);
  }
  // Planningsdagen (datums) schuiven evenveel kalenderdagen mee.
  const { rows: datums } = await pg.query<{ table_name: string; column_name: string }>(`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'fabriek' AND t.table_type = 'BASE TABLE' AND c.data_type = 'date'`);
  for (const k of datums) {
    await pg.query(`UPDATE "${k.table_name}" SET "${k.column_name}" = "${k.column_name}" + $1::int WHERE "${k.column_name}" IS NOT NULL`, [rows[0].dagen]);
  }
  await pg.exec("COMMIT");
}

// ---------- Nagebootste server ----------

interface Route {
  methode: string;
  patroon: RegExp;
  sleutels: string[];
  opties: any;
  handler: (req: any, reply: any) => unknown;
}

const routes: Route[] = [];

function voegToe(methode: string, pad: string, opties: any, handler: Route["handler"]) {
  const sleutels: string[] = [];
  const bron = pad
    .replace(/\/$/, "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([A-Za-z_]+)/g, (_m, k) => (sleutels.push(k), "([^/]+)"));
  routes.push({ methode, patroon: new RegExp(`^${bron}/?$`), sleutels, opties: opties ?? {}, handler });
}

function maakApp(prefix: string, gedeeld: any): any {
  const app: any = { ...gedeeld, log: console, addHook() {}, decorate() {} };
  for (const m of ["get", "post", "put", "patch", "delete"]) {
    app[m] = (pad: string, opties: any, handler?: Route["handler"]) => {
      if (typeof opties === "function") [opties, handler] = [{}, opties];
      voegToe(m.toUpperCase(), prefix + (pad === "/" ? "" : pad), opties, handler!);
    };
  }
  app.register = async (plugin: any, o?: { prefix?: string }) => plugin(maakApp(prefix + (o?.prefix ?? ""), gedeeld), o ?? {});
  return app;
}

// Token: zelfde vorm als een JWT (kop.inhoud.handtekening) met iat/exp, maar zonder geheim;
// in de demo blijft alles in deze browser.
const b64 = (t: string) => btoa(unescape(encodeURIComponent(t))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (t: string) => decodeURIComponent(escape(atob(t.replace(/-/g, "+").replace(/_/g, "/"))));
function teken(s: object) {
  const nu = Math.floor(Date.now() / 1000);
  return `${b64('{"alg":"none","typ":"JWT"}')}.${b64(JSON.stringify({ ...s, iat: nu, exp: nu + 12 * 3600 }))}.demo`;
}
function leesToken(auth?: string) {
  const m = /^Bearer [^.]+\.([^.]+)\.demo$/.exec(auth ?? "");
  if (!m) throw new Error("geen token");
  const inhoud = JSON.parse(unb64(m[1]));
  if (inhoud.exp * 1000 < Date.now()) throw new Error("verlopen");
  return inhoud;
}

export async function startServer(pg: PGlite) {
  const db = new DemoPool(pg);
  const app = maakApp("", { db, jwt: { sign: teken } });
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(configRoutes, { prefix: "/config" });
  await app.register(batchRoutes, { prefix: "/batches" });
  await app.register(registratieRoutes, { prefix: "/registraties" });
  await app.register(lotRoutes, { prefix: "/lots" });
  await app.register(beheerRoutes, { prefix: "/beheer" });
  await app.register(analyseRoutes, { prefix: "/analyse" });
  await app.register(werkvoorraadRoutes, { prefix: "/werkvoorraad" });
  await app.register(planningRoutes, { prefix: "/planning" });
  await app.register(wandschermRoutes, { prefix: "/wandscherm" });
  await app.register(overdrachtRoutes, { prefix: "/overdracht" });
  await app.register(meldingRoutes, { prefix: "/meldingen" });
  await app.register(stilstandRoutes, { prefix: "/stilstand" });
  await app.register(certificaatRoutes, { prefix: "/certificaten" });
  app.get("/gezondheid", {}, async () => ({ status: "ok", versie: VERSIE, demo: true }));
  return verwerk;
}

export interface Verzoek {
  methode: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

async function verwerk(v: Verzoek): Promise<{ status: number; body: string }> {
  const u = new URL(v.url, "http://demo");
  const pad = u.pathname;
  let route: Route | undefined;
  let m: RegExpExecArray | null = null;
  let padBestaat = false;
  for (const r of routes) {
    const g = r.patroon.exec(pad);
    if (!g) continue;
    padBestaat = true;
    if (r.methode === v.methode.toUpperCase()) {
      route = r;
      m = g;
      break;
    }
  }
  if (!route || !m) return { status: padBestaat ? 405 : 404, body: JSON.stringify({ fout: `Niet gevonden: ${v.methode} ${pad}` }) };

  const reply: any = {
    statusCode: 200,
    verzonden: false,
    inhoud: undefined as unknown,
    status(n: number) { this.statusCode = n; return this; },
    code(n: number) { this.statusCode = n; return this; },
    type() { return this; },
    header() { return this; },
    send(x: unknown) { this.inhoud = x; this.verzonden = true; return this; },
  };
  const headers = Object.fromEntries(Object.entries(v.headers ?? {}).map(([k, w]) => [k.toLowerCase(), w]));
  const req: any = {
    params: Object.fromEntries(route.sleutels.map((k, i) => [k, decodeURIComponent(m![i + 1])])),
    query: queryObject(u.searchParams),
    body: v.body ? JSON.parse(v.body) : undefined,
    headers,
    log: console,
    user: undefined,
    async jwtVerify() {
      req.user = leesToken(headers.authorization);
    },
  };

  try {
    const s = route.opties.schema ?? {};
    req.params = valideer(s.params, req.params, "params");
    req.query = valideer(s.querystring, req.query, "querystring");
    if (s.body) req.body = valideer(s.body, req.body, "body");
    const pre = route.opties.preHandler;
    for (const f of Array.isArray(pre) ? pre : pre ? [pre] : []) await f(req, reply);
    const terug = await route.handler(req, reply);
    const inhoud = reply.verzonden ? reply.inhoud : terug;
    const schema = s.response?.[reply.statusCode] ?? s.response?.["2xx"];
    return { status: reply.statusCode, body: inhoud === undefined ? "" : JSON.stringify(serialiseer(schema, inhoud)) };
  } catch (e) {
    const fout = foutAfhandeling(e as any, req, reply as any) as any;
    void fout;
    return { status: reply.statusCode, body: JSON.stringify(reply.inhoud) };
  }
}

function queryObject(sp: URLSearchParams) {
  const o: Record<string, unknown> = {};
  for (const [k, w] of sp) o[k] = k in o ? ([] as unknown[]).concat(o[k], w) : w;
  return o;
}

// ---------- Controle van invoer, zoals Fastify dat doet (coerceTypes, useDefaults) ----------

class ValidatieFout extends Error {
  validation = true;
  statusCode = 400;
}

function valideer(schema: any, waarde: unknown, waar: string): any {
  if (!schema) return waarde;
  const r = controleer(schema, waarde, waar);
  if (r.fout) throw new ValidatieFout(r.fout);
  return r.waarde;
}

function soort(s: any): string | undefined {
  // Bij twee types (zoals ["number", "null"], zie NulGetal in de API) telt het eerste dat niet null is.
  return Array.isArray(s.type) ? (s.type.find((t: string) => t !== "null") ?? "null") : s.type;
}

function controleer(s: any, w: any, pad: string): { waarde?: any; fout?: string } {
  if (!s || Object.keys(s).length === 0) return { waarde: w };
  if (s.anyOf) {
    for (const a of s.anyOf) {
      const r = controleer(a, w, pad);
      if (!r.fout) return r;
    }
    return { fout: `${pad} heeft geen geldige waarde` };
  }
  if (Array.isArray(s.type) && s.type.includes("null") && w === null) return { waarde: null };
  if ("const" in s) return w === s.const ? { waarde: w } : { fout: `${pad} moet ${JSON.stringify(s.const)} zijn` };
  if (s.enum && !s.enum.includes(w)) return { fout: `${pad} moet een van ${s.enum.join(", ")} zijn` };
  switch (soort(s)) {
    case "object": {
      if (w === undefined) w = {};
      if (typeof w !== "object" || w === null || Array.isArray(w)) return { fout: `${pad} moet een object zijn` };
      const uit: Record<string, unknown> = { ...w };
      for (const [k, sub] of Object.entries<any>(s.properties ?? {})) {
        if (uit[k] === undefined && "default" in sub) uit[k] = sub.default;
        if (uit[k] === undefined) {
          if (s.required?.includes(k)) return { fout: `${pad} mist verplicht veld '${k}'` };
          continue;
        }
        const r = controleer(sub, uit[k], `${pad}/${k}`);
        if (r.fout) return r;
        uit[k] = r.waarde;
      }
      if (s.additionalProperties === false) {
        for (const k of Object.keys(uit)) if (!(k in (s.properties ?? {}))) return { fout: `${pad} kent '${k}' niet` };
      }
      return { waarde: uit };
    }
    case "array": {
      if (!Array.isArray(w)) w = [w];
      const uit = [];
      for (let i = 0; i < w.length; i++) {
        const r = controleer(s.items, w[i], `${pad}/${i}`);
        if (r.fout) return r;
        uit.push(r.waarde);
      }
      if (s.minItems !== undefined && uit.length < s.minItems) return { fout: `${pad} moet minstens ${s.minItems} items hebben` };
      if (s.maxItems !== undefined && uit.length > s.maxItems) return { fout: `${pad} mag hoogstens ${s.maxItems} items hebben` };
      return { waarde: uit };
    }
    case "number":
    case "integer": {
      if (typeof w === "string" && w.trim() !== "" && !isNaN(Number(w))) w = Number(w);
      if (typeof w === "boolean") w = w ? 1 : 0;
      if (typeof w !== "number" || !isFinite(w)) return { fout: `${pad} moet een getal zijn` };
      if (soort(s) === "integer" && !Number.isInteger(w)) return { fout: `${pad} moet een geheel getal zijn` };
      if (s.minimum !== undefined && w < s.minimum) return { fout: `${pad} moet >= ${s.minimum} zijn` };
      if (s.maximum !== undefined && w > s.maximum) return { fout: `${pad} moet <= ${s.maximum} zijn` };
      if (s.exclusiveMinimum !== undefined && w <= s.exclusiveMinimum) return { fout: `${pad} moet > ${s.exclusiveMinimum} zijn` };
      return { waarde: w };
    }
    case "boolean": {
      if (w === "true") w = true;
      if (w === "false") w = false;
      return typeof w === "boolean" ? { waarde: w } : { fout: `${pad} moet true of false zijn` };
    }
    case "null":
      return w === null || w === "" ? { waarde: null } : { fout: `${pad} moet leeg zijn` };
    case "string": {
      if (typeof w === "number" || typeof w === "boolean") w = String(w);
      if (typeof w !== "string") return { fout: `${pad} moet tekst zijn` };
      if (s.minLength !== undefined && w.length < s.minLength) return { fout: `${pad} moet minstens ${s.minLength} tekens hebben` };
      if (s.maxLength !== undefined && w.length > s.maxLength) return { fout: `${pad} mag hoogstens ${s.maxLength} tekens hebben` };
      if (s.pattern && !new RegExp(s.pattern, "u").test(w)) return { fout: `${pad} heeft een ongeldige vorm` };
      if (s.format && FORMATEN[s.format] && !FORMATEN[s.format].test(w)) return { fout: `${pad} moet een geldige ${s.format} zijn` };
      return { waarde: w };
    }
  }
  return { waarde: w };
}

const FORMATEN: Record<string, RegExp> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
  "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i,
};

// ---------- Antwoord vormgeven zoals Fastify dat doet (volgens het antwoordschema) ----------

function lokaleDatum(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function serialiseer(s: any, w: any): any {
  if (w instanceof Date) return s?.format === "date" ? lokaleDatum(w) : w.toISOString();
  if (!s || w === null || w === undefined) return w;
  if (s.anyOf) {
    const passend = s.anyOf.find((a: any) => (w === null ? soort(a) === "null" : soort(a) !== "null"));
    return serialiseer(passend, w);
  }
  if (Array.isArray(w)) return w.map((x) => serialiseer(s.items, x));
  if (typeof w === "object" && s.properties) {
    const uit: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(w)) uit[k] = serialiseer(s.properties[k], x);
    return uit;
  }
  if (soort(s) === "string" && typeof w === "number") return String(w);
  return w;
}
