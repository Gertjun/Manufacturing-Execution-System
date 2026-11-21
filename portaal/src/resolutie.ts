// Resolutie van de grafieken met tijd (#58): per dag, per week of per maand.
// De API geeft per groep het begin (veld "week", ook bij dag en maand); hier
// vullen we lege dagen, weken of maanden aan met nul en maken we de teksten.
// Een week begint op maandag, net als date_trunc('week') in PostgreSQL.

export type Per = "dag" | "week" | "maand";
export const RESOLUTIES: { id: Per; naam: string }[] = [
  { id: "dag", naam: "Per dag" },
  { id: "week", naam: "Per week" },
  { id: "maand", naam: "Per maand" },
];

let gekozen: Per = "week";
export const resolutie = {
  get per(): Per { return gekozen; },
  set per(v: Per) { gekozen = v; },
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const datum = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`);

/** Begin van de dag, week of maand waarin een datum valt. */
export function beginVan(d: Date, per: Per): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  if (per === "week") x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  if (per === "maand") x.setDate(1);
  return iso(x);
}

/** Begin van de volgende dag, week of maand. */
export function volgende(begin: string, per: Per): string {
  const x = datum(begin);
  if (per === "dag") x.setDate(x.getDate() + 1);
  else if (per === "week") x.setDate(x.getDate() + 7);
  else x.setMonth(x.getMonth() + 1, 1);
  return iso(x);
}

/** Alle groepen van `van` (of de eerste rij) tot en met vandaag; ontbrekende groepen krijgen `leeg`. */
export function aanvullen<T extends { week: string }>(rijen: T[], per: Per, van: string | null, leeg: (week: string) => T): T[] {
  if (!rijen.length && !van) return [];
  const opBegin = new Map(rijen.map((r) => [r.week.slice(0, 10), r]));
  const eerste = van ? beginVan(datum(van), per) : rijen[0].week.slice(0, 10);
  const laatste = beginVan(new Date(), per);
  const uit: T[] = [];
  for (let b = eerste; b <= laatste && uit.length < 2000; b = volgende(b, per)) uit.push(opBegin.get(b) ?? leeg(b));
  return uit;
}

/** "Week van 16 nov", "za 21 nov" of "november 2026" (tooltip, tabel, titel). */
export function perTekst(begin: string, per: Per, hoofdletter = true): string {
  const d = datum(begin);
  const t = per === "dag" ? d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })
    : per === "week" ? `week van ${d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}`
    : d.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  return hoofdletter ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Korte tekst onder de as: "16 nov" of "nov" (januari met jaartal). */
export function perAs(begin: string, per: Per): string {
  const d = datum(begin);
  if (per === "maand") return d.getMonth() === 0 ? `jan ${d.getFullYear()}` : d.toLocaleDateString("nl-NL", { month: "short" }).replace(".", "");
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

/** Kolomkop voor de groep in een tabel. */
export const perKop = (per: Per) => (per === "dag" ? "Dag" : per === "week" ? "Week van" : "Maand");
/** "per week", "per dag", "per maand" in titels. */
export const perWoord = (per: Per) => `per ${per}`;
/** Tekst in een tabelcel onder perKop: "za 21 nov 2026", "16 nov 2026" of "november 2026". */
export function perCel(begin: string, per: Per): string {
  const d = datum(begin);
  if (per === "maand") return d.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  return d.toLocaleDateString("nl-NL", { ...(per === "dag" ? { weekday: "short" as const } : {}), day: "numeric", month: "short", year: "numeric" });
}
