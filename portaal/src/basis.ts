// Inloggen, API-verzoeken en de lijst met portalen.
import type { Rol } from "../../gedeeld/types";
import { kiesPortaloverdracht, wisPortaloverdracht } from "../../gedeeld/portaloverdracht";

const TOKEN = "portaal.token";

export const sessie = {
  get token(): string | null {
    try { return localStorage.getItem(TOKEN); } catch { return null; }
  },
  set token(t: string | null) {
    try {
      if (localStorage.getItem(TOKEN) !== t) {
        wisPortaloverdracht();
        // Een nieuwe centrale sessie mag geen oudere invoersessie activeren; lokale registraties blijven bewaard.
        localStorage.removeItem("invoer.token");
        localStorage.removeItem("invoer.operatornaam");
      }
      t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN);
    } catch { /* alleen deze sessie */ }
  },
  inhoud(): { sub: string; naam: string; rol: Rol; exp: number } | null {
    const t = this.token;
    if (!t) return null;
    try {
      return JSON.parse(decodeURIComponent(escape(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))));
    } catch { return null; }
  },
  geldig(): boolean {
    const i = this.inhoud();
    return !!i && i.exp * 1000 > Date.now() + 60_000;
  },
  get rol(): Rol | null { return this.inhoud()?.rol ?? null; },
  get naam(): string { return this.inhoud()?.naam ?? ""; },
  /** Afmelden geldt voor de hele app (D54): ook het invoerscherm op deze pc meldt af. */
  afmelden() {
    this.token = null;
    wisPortaloverdracht();
    try { localStorage.removeItem("invoer.token"); localStorage.removeItem("invoer.operatornaam"); } catch { /* geen opslag */ }
  },
};

export class ApiFout extends Error {
  constructor(public status: number, bericht: string) { super(bericht); }
}

export async function stuur<T>(methode: string, pad: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  // Een eigen token: het tijdelijke na een inlog met een tijdelijk wachtwoord (#76), dat niet wordt bewaard.
  const t = token ?? sessie.token;
  if (t) headers.authorization = `Bearer ${t}`;
  let r: Response;
  try {
    r = await fetch(pad, { method: methode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiFout(0, "Geen verbinding met de server. Controleer het netwerk en probeer het opnieuw.");
  }
  const tekst = await r.text();
  const data = tekst ? JSON.parse(tekst) : null;
  if (r.status === 401 && t === sessie.token) {
    sessie.token = null;
    location.hash = "#/login";
  }
  if (!r.ok) throw new ApiFout(r.status, data?.fout ?? `Fout ${r.status}`);
  return data as T;
}
export const haal = <T>(pad: string) => stuur<T>("GET", pad);

/** Querystring zonder lege waarden. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const p = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")}` : "";
}

// ---------- Actuele bevoegdheden (D101) ----------
export interface Permissions { global: string[]; products: { permission: string; product: string }[]; personal: boolean; linkedPerson: boolean; resourceCatalog?: boolean; resourceStatus?: boolean }
let projection: Permissions | null = null;
let projectionToken: string | null = null;
let requestGeneration = 0;
export async function vernieuwRechten(): Promise<boolean> {
  const token = sessie.token;
  const generation = ++requestGeneration;
  projection = null;
  projectionToken = null;
  if (!token) return false;
  const result = await stuur<Permissions>("GET", "/auth/permissions", undefined, token);
  if (generation !== requestGeneration || sessie.token !== token) return false;
  projection = result;
  projectionToken = token;
  return true;
}
export function rechten(): Permissions | null {
  return projectionToken && projectionToken === sessie.token ? projection : null;
}
export const heeftRecht = (...permissions: string[]) => permissions.some(p => rechten()?.global.includes(p));
export const heeftProductRecht = (...permissions: string[]) => heeftRecht(...permissions) ||
  !!rechten()?.products.some(p => permissions.includes(p.permission));
const LEES = ["execution.read","inspection.read","engineering.execution.read","analysis.execution.read"];
const UITVOER = ["execution.start","execution.record","execution.complete","execution.correct","inspection.start","inspection.record","inspection.decide"];
export const magInvoer = () => !!rechten()?.personal && !!rechten()?.linkedPerson &&
  heeftRecht(...LEES) && heeftProductRecht(...UITVOER);
export const magMeldingen = () => !!rechten()?.personal && heeftRecht("analysis.execution.read","execution.correct","inspection.decide","planning.manage","operations.rework.order");
export const magNalevering = () => !!rechten()?.personal && heeftRecht("execution.correct");
export const magEtiketten = () => !!rechten()?.personal && heeftRecht(...LEES);
export const magDisplay = () => rechten()?.personal === false && heeftRecht("display.downtime.read");

// ---------- Portalen ----------
export interface Onderdeel { pad: string; naam: string; teller?: () => Promise<number>; toegestaan: () => boolean }
export interface Portaal { id: string; naam: string; klaar: boolean; onderdelen: Onderdeel[] }
export interface Bestemming extends Portaal { href: string; uitleg: string; toegestaan: () => boolean }
export const zichtbareOnderdelen = (p: Portaal) => p.onderdelen.filter(o => !!rechten()?.personal && o.toegestaan());
const lees = () => heeftRecht(...LEES);
const kwaliteitLees = () => heeftRecht("inspection.read","analysis.execution.read");
const planningLees = () => lees() && heeftRecht("planning.manage","engineering.product.manage","handover.read");

// #113: afzonderlijke capabilities voor het native Process Engineering-portaal.
// Globaal materiaalbeheer nooit afleiden uit een productspecifieke grant.
export const RECEPT_REVIEW_RECHTEN = ["recipe.review.engineering","recipe.review.production","recipe.review.quality","recipe.release","recipe.withdraw.engineering","recipe.withdraw.quality"];
export const magMateriaalstamdata = () => heeftRecht("material.definition.manage");
export const magReceptconcept = () => heeftProductRecht("recipe.draft.manage");
export const magReceptbeoordeling = () => heeftProductRecht("recipe.draft.manage",...RECEPT_REVIEW_RECHTEN);

export const magScopemapping = () => !!rechten()?.personal && heeftRecht("resource.scope.manage");
export const magMiddelenbeheer = () => !!rechten()?.personal && (rechten()?.resourceCatalog === true || heeftRecht("resource.catalog.manage"));
export const magMiddelenstatus = () => !!rechten()?.personal && (rechten()?.resourceStatus === true || heeftRecht("resource.status.manage","resource.status.read"));
export const magWerkstationbeheer = () => !!rechten()?.personal && heeftRecht("resource.catalog.manage");
export const magMiddelstilstand = () => !!rechten()?.personal && heeftRecht("downtime.read","maintenance.downtime.read");
export const PORTALEN: Portaal[] = [
  { id: "maintenance", naam: "Maintenance", klaar: true, onderdelen: [
    { pad: "middelen", naam: "Middelenbeheer", toegestaan: magMiddelenbeheer },
    { pad: "capaciteiten", naam: "Eigenschappen en capaciteit", toegestaan: magMiddelenbeheer },
    { pad: "status", naam: "Technische middelenstatus", toegestaan: magMiddelenstatus },
    { pad: "werkstations", naam: "Werkstationkoppelingen", toegestaan: magWerkstationbeheer },
    { pad: "middelstilstand", naam: "Actuele middelstilstand", toegestaan: magMiddelstilstand },
  ]},
  { id: "engineering", naam: "Process Engineering", klaar: true, onderdelen: [
    { pad: "overzicht", naam: "Overzicht", toegestaan: () => magMateriaalstamdata() || magReceptconcept() || magReceptbeoordeling() },
    { pad: "materialen", naam: "Materiaalstamgegevens", toegestaan: magMateriaalstamdata },
    { pad: "eenheden", naam: "Eenhedencatalogus", toegestaan: magMateriaalstamdata },
    { pad: "recepten", naam: "Master Recipes", toegestaan: magReceptconcept },
    { pad: "beoordelingen", naam: "Receptbeoordelingen", toegestaan: magReceptbeoordeling },
  ]},
  { id: "kwaliteit", naam: "Kwaliteit", klaar: true, onderdelen: [
    { pad: "overzicht", naam: "Overzicht", toegestaan: kwaliteitLees },
    { pad: "beoordelen", naam: "Te beoordelen", toegestaan: () => heeftRecht("inspection.read"), teller: async () => {
      const [a,b] = await Promise.all([haal<unknown[]>("/analyse/te-beoordelen"),haal<unknown[]>("/keuringen")]); return a.length+b.length;
    } },
    { pad: "lotpaspoort", naam: "Lotpaspoort", toegestaan: kwaliteitLees },
    { pad: "grondstoffen", naam: "Grondstoffen terugzoeken", toegestaan: kwaliteitLees },
    { pad: "regelkaarten", naam: "Regelkaarten", toegestaan: kwaliteitLees },
    { pad: "afwijkingen", naam: "Afwijkingen", toegestaan: kwaliteitLees },
    { pad: "trend", naam: "Trend per veld", toegestaan: kwaliteitLees },
    { pad: "herbewerkingen", naam: "Herbewerkingen en afkeur", toegestaan: () => lees() && heeftRecht("inspection.read","operations.rework.order") },
    { pad: "specificaties", naam: "Historische specificaties", toegestaan: kwaliteitLees },
  ]},
  { id: "productie", naam: "Manufacturing Operations", klaar: true, onderdelen: [
    { pad: "overzicht", naam: "Werkvoorraad", toegestaan: () => heeftRecht("execution.read","analysis.execution.read") },
    { pad: "doorlooptijden", naam: "Doorlooptijden", toegestaan: () => heeftRecht("execution.read","analysis.execution.read") },
    { pad: "week", naam: "Productie per week", toegestaan: () => heeftRecht("execution.read","analysis.execution.read") },
    { pad: "correcties", naam: "Correcties", toegestaan: () => heeftRecht("execution.correct","analysis.execution.read") },
    { pad: "overdracht", naam: "Ploegoverdracht", toegestaan: () => heeftRecht("handover.read") },
    { pad: "stilstand", naam: "Stilstand", toegestaan: () => lees() && heeftRecht("downtime.read","maintenance.downtime.read") },
    { pad: "middelstilstand", naam: "Actuele middelstilstand", toegestaan: () => lees() && magMiddelstilstand() },
  ]},
  { id: "planning", naam: "Planning", klaar: true, onderdelen: [
    { pad: "week", naam: "Batches plannen", toegestaan: planningLees },
    { pad: "dag", naam: "Stappen plannen", toegestaan: planningLees },
    { pad: "overzicht", naam: "Dagoverzicht", toegestaan: planningLees },
    { pad: "route", naam: "Batchroute", toegestaan: planningLees },
    { pad: "lots", naam: "Lotvoorstellen", toegestaan: planningLees, teller: async () => (await haal<unknown[]>("/planning/lotvoorstellen")).length },
    { pad: "producten", naam: "Producten", toegestaan: planningLees },
    { pad: "capaciteit", naam: "Capaciteit", toegestaan: planningLees, teller: async () => (await haal<{ nog_invullen: number }>("/planning/capaciteit")).nog_invullen },
  ]},
  { id: "beheer", naam: "Beheer", klaar: true, onderdelen: [
    { pad: "stappen", naam: "Stappen en velden", toegestaan: () => lees() && heeftRecht("process.parameter.manage") },
    { pad: "accounts", naam: "Accounts", toegestaan: () => heeftRecht("account.read") },
    { pad: "scopemapping", naam: "Scopemapping middelen", toegestaan: magScopemapping },
    { pad: "operators", naam: "Personeel", toegestaan: () => heeftRecht("personnel.read") },
    { pad: "grondstoffen", naam: "Grondstoffen", toegestaan: () => heeftRecht("material.definition.manage") },
    { pad: "ploegen", naam: "Diensten en ploegen", toegestaan: () => heeftRecht("shift.manage") },
    { pad: "oorzaken", naam: "Oorzaken van stilstand", toegestaan: () => heeftRecht("downtime.reason.manage") },
    { pad: "pcs", naam: "Pc's", toegestaan: () => heeftRecht("workstation.manage") },
    { pad: "logboek", naam: "Logboek", toegestaan: () => heeftRecht("system.read") },
    { pad: "server", naam: "Server", toegestaan: () => heeftRecht("system.read") },
  ]},
];
// Eén register voor startpagina en navigatie. Interne routes blijven afzonderlijk bewaakt.
const BESTEMMINGEN: Bestemming[] = [
  { id: "invoer", naam: "Production Execution", klaar: true, onderdelen: [],
    uitleg: "Persoonlijke productie-invoer en keuringen.", href: "../invoer/index.html#/overstap", toegestaan: magInvoer },
  ...PORTALEN.map(p => ({ ...p, href: "#/"+p.id,
    uitleg: "Beschikbare functies volgens je actuele MES-bevoegdheden.", toegestaan: () => zichtbareOnderdelen(p).length > 0 })),
  { id: "nainvoeren", naam: "Nainvoeren (papier)", klaar: true, onderdelen: [],
    uitleg: "Gecontroleerde papieren nalevering.", href: "#/nainvoeren", toegestaan: magNalevering },
  { id: "wandscherm", naam: "Stilstanddisplay", klaar: true, onderdelen: [],
    uitleg: "Beperkt uitleesscherm voor actieve stilstand.", href: "#/wandscherm", toegestaan: magDisplay },
];
export const bestemmingenVoor = () => BESTEMMINGEN.filter(p => p.toegestaan());
// Alleen interne portalen met eigen onderdeelrouter; geen externe bestemming als interne route behandelen.
export const portalenVoor = (_rol?: Rol | null) => bestemmingenVoor().filter(p => p.onderdelen.length > 0);
export interface Tegel { id: string; naam: string; uitleg: string; href: string }
export function tegelsVoor(_rol?: Rol | null): Tegel[] {
  return bestemmingenVoor().map(({ id, naam, uitleg, href }) => ({ id, naam, uitleg, href }));
}

/** Expliciete keuze voor werkstationoverdracht; bestaande servercontrole /auth/pc blijft vereist. */
export function markeerPortalkeuze(id: string) {
  if (id !== "invoer") return;
  if (!sessie.geldig() || !bestemmingenVoor().some(p => p.id === id)) { wisPortaloverdracht(); return; }
  // Bij opslagweigering opent de overgang wel, maar vraagt veilig om persoonlijke login.
  kiesPortaloverdracht(sessie.token);
}

// ---------- Periode (één filterrij boven de analyses) ----------
export const PERIODES = [
  { id: "7", naam: "Laatste 7 dagen", dagen: 7 },
  { id: "30", naam: "Laatste 30 dagen", dagen: 30 },
  { id: "90", naam: "Laatste 90 dagen", dagen: 90 },
  { id: "365", naam: "Afgelopen jaar", dagen: 365 },
  { id: "alles", naam: "Alles", dagen: null },
] as const;

let periodeId: string = "30";
export const periode = {
  get id() { return periodeId; },
  set id(v: string) { periodeId = v; },
  /** { van } als datum, tot = morgen (dus vandaag inbegrepen), plus het gekozen product (D55). */
  bereik(): { van: string | null; product: string | null } {
    const p = PERIODES.find((x) => x.id === periodeId)!;
    const product = gekozenProduct.code;
    if (p.dagen === null) return { van: null, product };
    const d = new Date();
    d.setDate(d.getDate() - p.dagen + 1);
    // Lokale datum (toISOString zou tussen middernacht en 01:00/02:00 de dag ervoor geven).
    return { van: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, product };
  },
};

// ---------- Productkiezer (D55, #93): in de filterbalk van de analyses, onthouden op deze computer ----------
const PRODUCT_SLEUTEL = "portaal.product";
export const gekozenProduct = {
  get code(): string | null {
    try { return localStorage.getItem(PRODUCT_SLEUTEL) || null; } catch { return null; }
  },
  set code(c: string | null) {
    try { c ? localStorage.setItem(PRODUCT_SLEUTEL, c) : localStorage.removeItem(PRODUCT_SLEUTEL); } catch { /* alleen deze sessie */ }
  },
};
let productenCache: { code: string; naam: string }[] | null = null;
/** Actieve producten (één keer per sessie opgehaald). Een onthouden product dat niet meer bestaat, vervalt. */
export async function producten(): Promise<{ code: string; naam: string }[]> {
  if (!productenCache) {
    productenCache = await haal<{ code: string; naam: string }[]>("/planning/producten");
    if (gekozenProduct.code && !productenCache.some((p) => p.code === gekozenProduct.code)) gekozenProduct.code = null;
  }
  return productenCache;
}
/** Korte tekst voor in een kop: "PRD-B" of "alle producten". */
export const productTekst = () => gekozenProduct.code ?? "alle producten";
