// Inloggen, API-verzoeken en de lijst met portalen.
import type { Rol } from "../../gedeeld/types";

const TOKEN = "portaal.token";

export const sessie = {
  get token(): string | null {
    try { return localStorage.getItem(TOKEN); } catch { return null; }
  },
  set token(t: string | null) {
    try { t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN); } catch { /* alleen deze sessie */ }
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
    try { localStorage.removeItem("invoer.token"); localStorage.removeItem("invoer.operatornaam"); } catch { /* geen opslag */ }
  },
};

export class ApiFout extends Error {
  constructor(public status: number, bericht: string) { super(bericht); }
}

export async function stuur<T>(methode: string, pad: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (sessie.token) headers.authorization = `Bearer ${sessie.token}`;
  let r: Response;
  try {
    r = await fetch(pad, { method: methode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiFout(0, "Geen verbinding met de server. Controleer het netwerk en probeer het opnieuw.");
  }
  const tekst = await r.text();
  const data = tekst ? JSON.parse(tekst) : null;
  if (r.status === 401) {
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

// ---------- Portalen ----------
export interface Onderdeel { pad: string; naam: string; teller?: () => Promise<number> }
export interface Portaal { id: string; naam: string; rollen: Rol[]; klaar: boolean; onderdelen: Onderdeel[] }

export const PORTALEN: Portaal[] = [
  {
    id: "kwaliteit",
    naam: "Kwaliteit",
    rollen: ["kwaliteit", "beheerder", "analist", "ploegleider"],
    klaar: true,
    onderdelen: [
      { pad: "overzicht", naam: "Overzicht" },
      { pad: "beoordelen", naam: "Te beoordelen", teller: async () => (await haal<unknown[]>("/analyse/te-beoordelen")).length },
      { pad: "lotpaspoort", naam: "Lotpaspoort" },
      { pad: "grondstoffen", naam: "Grondstoffen terugzoeken" },
      { pad: "regelkaarten", naam: "Regelkaarten" },
      { pad: "afwijkingen", naam: "Afwijkingen" },
      { pad: "trend", naam: "Trend per veld" },
      { pad: "herbewerkingen", naam: "Herbewerkingen en afkeur" },
    ],
  },
  {
    id: "productie",
    naam: "Productieanalyse",
    rollen: ["ploegleider", "beheerder", "analist"],
    klaar: true,
    onderdelen: [
      { pad: "overzicht", naam: "Werkvoorraad" },
      { pad: "doorlooptijden", naam: "Doorlooptijden" },
      { pad: "week", naam: "Productie per week" },
      { pad: "correcties", naam: "Correcties" },
      { pad: "overdracht", naam: "Ploegoverdracht" },
      { pad: "stilstand", naam: "Stilstand" },
    ],
  },
  {
    id: "planning",
    naam: "Planning",
    rollen: ["planner", "beheerder", "ploegleider"],
    klaar: true,
    onderdelen: [
      { pad: "week", naam: "Per week" },
      { pad: "dag", naam: "Per stap" },
      { pad: "overzicht", naam: "Dagoverzicht (proef)" },
      { pad: "route", naam: "Batchroute (proef)" },
      { pad: "lots", naam: "Lotvoorstellen", teller: async () => (await haal<unknown[]>("/planning/lotvoorstellen")).length },
      { pad: "producten", naam: "Producten" },
      { pad: "capaciteit", naam: "Capaciteit" },
    ],
  },
  {
    id: "beheer",
    naam: "Beheer",
    rollen: ["beheerder"],
    klaar: true,
    onderdelen: [
      { pad: "stappen", naam: "Stappen en velden" },
      { pad: "accounts", naam: "Accounts" },
      { pad: "operators", naam: "Operators" },
      { pad: "grondstoffen", naam: "Grondstoffen" },
      { pad: "ploegen", naam: "Ploegen" },
      { pad: "oorzaken", naam: "Oorzaken van stilstand" },
      { pad: "bedrijf", naam: "Bedrijfsgegevens" },
      { pad: "pcs", naam: "Pc's" },
      { pad: "logboek", naam: "Logboek" },
      { pad: "server", naam: "Server" },
    ],
  },
];

export const portalenVoor = (rol: Rol | null) => PORTALEN.filter((p) => rol && p.rollen.includes(rol));

/** Tegels op de startpagina (D54): het invoerscherm, de portalen en het wandscherm, voor zover je rol ze mag. */
export interface Tegel { id: string; naam: string; uitleg: string; href: string }
export function tegelsVoor(rol: Rol | null): Tegel[] {
  if (!rol) return [];
  const UITLEG: Record<string, string> = {
    kwaliteit: "Beoordelen, lotpaspoort, regelkaarten, afwijkingen en trends.",
    productie: "Voor de productieleiding: werkvoorraad, doorlooptijden, ploegoverdracht en stilstand.",
    planning: "Batches plannen, planning per stap, lotvoorstellen en capaciteit.",
    beheer: "Stappen en velden, accounts, namen, pc's, keuzelijsten, logboek en server.",
  };
  return [
    ...(rol === "operator" || rol === "ploegleider"
      ? [{ id: "invoer", naam: "Invoerscherm", uitleg: "Voor de vloer: stappen invoeren, lot samenstellen, stilstand en ploegoverdracht. Werkt ook offline.", href: "../invoer/index.html" }]
      : []),
    ...portalenVoor(rol).map((p) => ({ id: p.id, naam: p.naam, uitleg: UITLEG[p.id] ?? "", href: `#/${p.id}` })),
    ...(rol === "operator" ? [] : [{ id: "wandscherm", naam: "Wandscherm", uitleg: "Voor de tv in de hal: wat er per stap te doen staat. Alleen kijken.", href: "#/wandscherm" }]),
  ];
}

// ---------- Periode (één filterrij boven de analyses) ----------
export const PERIODES = [
  { id: "7", naam: "Laatste 7 dagen", dagen: 7 },
  { id: "30", naam: "Laatste 30 dagen", dagen: 30 },
  { id: "90", naam: "Laatste 90 dagen", dagen: 90 },
  { id: "alles", naam: "Alles", dagen: null },
] as const;

let periodeId: string = "30";
export const periode = {
  get id() { return periodeId; },
  set id(v: string) { periodeId = v; },
  /** { van } als datum, tot = morgen (dus vandaag inbegrepen). */
  bereik(): { van: string | null } {
    const p = PERIODES.find((x) => x.id === periodeId)!;
    if (p.dagen === null) return { van: null };
    const d = new Date();
    d.setDate(d.getDate() - p.dagen + 1);
    // Lokale datum (toISOString zou tussen middernacht en 01:00/02:00 de dag ervoor geven).
    return { van: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` };
  },
};
