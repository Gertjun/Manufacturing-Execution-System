// Portaal Kwaliteit: overzicht, te beoordelen, lot- en batchpaspoort,
// afwijkingen, trend per veld, herbewerkingen en afkeur.
import { h, laden, melding, tijd, toon, vastHouden, vraag } from "../../../gedeeld/ui";
import { markeringTekst, toonGetal } from "../../../gedeeld/markering";
import type { Markering, Stap } from "../../../gedeeld/types";
import { ApiFout, haal, periode, PERIODES, qs, sessie, stuur } from "../basis";
import { afwijkingenPerWeek, trend, type TrendPunt, type TrendVeld, type Week } from "../grafiek";

// ---------- kleine bouwstenen ----------
export const label = (m: Markering) => h("span", { class: `label label-${m}` }, markeringTekst[m]);
export const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
/** Korte datum voor in tabellen: "4 okt 07:58". */
export const kort = (iso: string | null) => (iso ? new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "");

export function kop(titel: string, sub?: string | Node | null, ...rechts: (Node | null)[]) {
  return h("div", { class: "kop" }, h("div", {}, h("h1", {}, titel), sub ? h("p", { class: "sub" }, sub) : null), h("div", { class: "kop-rechts" }, ...rechts));
}

export function periodeKeuze(opnieuw: () => void) {
  const sel = h("select", { id: "periode", onchange: (e: Event) => { periode.id = (e.target as HTMLSelectElement).value; opnieuw(); } },
    PERIODES.map((p) => h("option", { value: p.id, selected: p.id === periode.id }, p.naam))) as HTMLSelectElement;
  return h("label", { for: "periode", class: "filter" }, "Periode", sel);
}

export function tabel(koppen: string[], rijen: (Node | string | number | null)[][], klasse = "") {
  return h("div", { class: "tabel-kader" },
    h("table", { class: `tabel ${klasse}` },
      h("thead", {}, h("tr", {}, koppen.map((k) => h("th", { scope: "col" }, k)))),
      h("tbody", {}, rijen.map((r) => h("tr", {}, r.map((c) => h("td", {}, c ?? "")))))));
}

export function grenzen(r: { grens_min: number | null; grens_max: number | null; tolerantie: number | null; tolerantie_soort: string | null; eenheid?: string | null }) {
  const d: string[] = [];
  if (r.grens_min !== null && r.grens_max !== null) d.push(`${toonGetal(r.grens_min)} tot ${toonGetal(r.grens_max)}`);
  else if (r.grens_max !== null) d.push(`max ${toonGetal(r.grens_max)}`);
  else if (r.grens_min !== null) d.push(`min ${toonGetal(r.grens_min)}`);
  if (r.tolerantie !== null) d.push(`±${toonGetal(r.tolerantie)}${r.tolerantie_soort === "procent" ? " %" : ""}`);
  return d.join(", ");
}

export function fout(e: unknown, titel = "Kon de gegevens niet laden") {
  toon(kop(titel), h("p", { class: "leeg" }, (e as Error).message));
}

const magKeuren = () => sessie.rol === "kwaliteit";

async function keur(batchnummer: string, besluit: "vrijgegeven" | "afgekeurd", daarna: () => void) {
  const ok = besluit === "vrijgegeven";
  const r = await vraag(`Keurresultaat ${ok ? "OK" : "NOK"} voor ${batchnummer}`, [{ naam: "reden", label: ok ? "Toelichting" : "Reden van afkeur" }], ok ? "OK: vrijgeven" : "NOK: afkeuren");
  if (!r) return;
  try {
    await stuur("POST", `/batches/${batchnummer}/besluiten`, { besluit, reden: r.reden });
    melding(ok ? `${batchnummer} vrijgegeven` : `${batchnummer} afgekeurd`, ok ? "ok" : "info");
    daarna();
  } catch (e) {
    melding((e as Error).message, "fout");
  }
}

function keurKnoppen(batchnummer: string, daarna: () => void) {
  return h("div", { class: "knoppen-klein" },
    h("button", { class: "knop knop-klein", onclick: () => keur(batchnummer, "vrijgegeven", daarna) }, "OK"),
    h("button", { class: "knop knop-klein knop-gevaar", onclick: () => keur(batchnummer, "afgekeurd", daarna) }, "NOK"));
}

// ---------- Overzicht ----------
interface Samenvatting {
  batches: number; lots: number; waarden: number; buiten_tolerantie: number; buiten_grens: number;
  herbewerkingen: number; afgekeurd: number; te_beoordelen: number; per_week: Week[];
  top_velden: { veld: string; veldnaam: string; stap: string; afwijkend: number; waarden: number }[];
}

export async function overzicht() {
  const actueel = vastHouden();
  toon(kop("Kwaliteit"), laden());
  let d: Samenvatting;
  try { d = await haal<Samenvatting>(`/analyse/samenvatting${qs(periode.bereik())}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const afwijkend = d.buiten_tolerantie + d.buiten_grens;
  const pct = d.waarden ? (afwijkend / d.waarden) * 100 : 0;
  const tegel = (getal: number | string, tekst: string, link?: string, nadruk = false) =>
    h(link ? "a" : "div", { class: nadruk ? "tegel nadruk" : "tegel", href: link }, h("span", { class: "tegel-getal" }, getal), h("span", { class: "tegel-tekst" }, tekst));
  toon(
    kop("Kwaliteit", `Afwijkingen, beoordelingen en herbewerkingen, ${PERIODES.find((p) => p.id === periode.id)!.naam.toLowerCase()}.`, periodeKeuze(overzicht)),
    h("div", { class: "tegels" },
      tegel(d.te_beoordelen, d.te_beoordelen === 1 ? "batch wacht op keurresultaat" : "batches wachten op keurresultaat", "#/kwaliteit/beoordelen", d.te_beoordelen > 0),
      tegel(afwijkend, `afwijkende metingen (${pct.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%)`, "#/kwaliteit/afwijkingen"),
      tegel(d.herbewerkingen, "herbewerkingen", "#/kwaliteit/herbewerkingen"),
      tegel(d.afgekeurd, "batches afgekeurd", "#/kwaliteit/herbewerkingen"),
      tegel(d.lots, "lots gemaakt", "#/kwaliteit/lotpaspoort"),
    ),
    h("section", { class: "blok" },
      h("h2", {}, "Afwijkingen per week"),
      d.per_week.some((w) => w.buiten_grens + w.buiten_tolerantie > 0) ? afwijkingenPerWeek(d.per_week) : h("p", { class: "leeg" }, "Geen afwijkingen in deze periode.")),
    h("section", { class: "blok" },
      h("h2", {}, "Velden met de meeste afwijkingen"),
      d.top_velden.length
        ? tabel(["Veld", "Stap", "Afwijkend", "Van metingen", ""], d.top_velden.map((v) => [
            h("strong", {}, `${v.veld} ${v.veldnaam}`), v.stap, h("span", { class: "getal" }, v.afwijkend), h("span", { class: "getal" }, v.waarden),
            h("a", { href: `#/kwaliteit/trend/${v.veld}` }, "Trend bekijken"),
          ]))
        : h("p", { class: "leeg" }, "Geen afwijkingen in deze periode.")),
  );
}

// ---------- Te beoordelen ----------
interface TeBeoordelen { batchnummer: string; sinds: string; reden: string; door: string; laatst_afgeronde_stap: string | null; afwijkingen: number }

export async function beoordelen() {
  const actueel = vastHouden();
  toon(kop("Te beoordelen"), laden());
  let rijen: TeBeoordelen[];
  try { rijen = await haal<TeBeoordelen[]>("/analyse/te-beoordelen"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  toon(
    kop("Te beoordelen", magKeuren()
      ? "Batches die in beoordeling staan. OK geeft de batch vrij voor de volgende stap, NOK keurt hem af."
      : "Batches die in beoordeling staan. Alleen Kwaliteit voert het keurresultaat in."),
    rijen.length
      ? tabel(["Batch", "In beoordeling sinds", "Reden", "Door", "Laatst afgerond", "Afwijkingen", magKeuren() ? "Keurresultaat" : ""],
          rijen.map((r) => [
            h("a", { href: `#/kwaliteit/batch/${r.batchnummer}`, class: "sterk" }, r.batchnummer), datum(r.sinds), r.reden, r.door,
            r.laatst_afgeronde_stap ?? "Nog geen stap", h("span", { class: "getal" }, r.afwijkingen),
            magKeuren() ? keurKnoppen(r.batchnummer, beoordelen) : "",
          ]))
      : h("p", { class: "leeg" }, "Er staan geen batches in beoordeling."),
  );
}

// ---------- Paspoorten ----------
interface Regel {
  batch_of_lot: string; stap: string; poging: number; herbewerking_reden: string | null; veld: string; veldnaam: string; eenheid: string | null;
  setting: number | null; gemeten: number; grens_min: number | null; grens_max: number | null; tolerantie: number | null; tolerantie_soort: string | null;
  markering: Markering; gecorrigeerd: boolean; operator: string; pc: string; afgerond_op: string | null;
}

function regelsTabel(regels: Regel[], metBatch: boolean) {
  return tabel(
    ["Stap", ...(metBatch ? ["Batch of lot"] : []), "Veld", "Setting", "Gemeten", "Grenzen", "Resultaat", "Operator", "Afgerond"],
    regels.map((r) => [
      `${r.stap}${r.poging > 1 ? ` (poging ${r.poging})` : ""}`,
      ...(metBatch ? [r.batch_of_lot] : []),
      `${r.veld} ${r.veldnaam}`,
      h("span", { class: "getal" }, r.setting !== null ? toonGetal(r.setting) : ""),
      h("span", { class: "getal" }, `${toonGetal(r.gemeten)}${r.eenheid ? ` ${r.eenheid}` : ""}`, r.gecorrigeerd ? h("span", { class: "noot" }, " gecorrigeerd") : ""),
      grenzen(r), label(r.markering), r.operator, kort(r.afgerond_op),
    ]),
    "compact",
  );
}

interface Lot { lotnummer: string; status: string; aangemaakt_op: string; batches: string[]; afwijkingen?: number; herbewerkingen?: number }
const lotStatus: Record<string, string> = { in_productie: "In productie", gereed: "Gereed", geblokkeerd: "Geblokkeerd" };

export async function lotpaspoort(nummer?: string) {
  if (nummer) return toonLotpaspoort(nummer);
  const actueel = vastHouden();
  const zoek = h("input", { id: "zoek-lot", type: "text", placeholder: "Lot- of batchnummer, of een deel ervan", autocomplete: "off" }) as HTMLInputElement;
  const lijst = h("div", {}, laden());
  // Alleen het antwoord op de laatste zoekopdracht tonen; een trager eerder antwoord mag dat niet overschrijven.
  let laatste = 0;
  const laad = async () => {
    const mijn = ++laatste;
    try {
      const lots = await haal<Lot[]>(`/lots${qs({ zoek: zoek.value.trim(), limiet: 30 })}`);
      if (!actueel() || mijn !== laatste) return;
      lijst.replaceChildren(lots.length
        ? tabel(["Lot", "Status", "Gemaakt", "Batches", "Afwijkingen", "Herbewerkingen"], lots.map((l) => [
            h("a", { href: `#/kwaliteit/lotpaspoort/${l.lotnummer}`, class: "sterk" }, l.lotnummer), lotStatus[l.status] ?? l.status, datum(l.aangemaakt_op),
            l.batches.join(", "), h("span", { class: l.afwijkingen ? "getal let-op" : "getal" }, l.afwijkingen ?? 0), h("span", { class: "getal" }, l.herbewerkingen ?? 0),
          ]))
        : h("p", { class: "leeg" }, "Geen lots gevonden."));
    } catch (e) { lijst.replaceChildren(h("p", { class: "leeg" }, (e as Error).message)); }
  };
  let timer: number | undefined;
  zoek.addEventListener("input", () => { clearTimeout(timer); timer = window.setTimeout(laad, 250); });
  toon(
    kop("Lotpaspoort", "Alles over één lot en zijn 4 batches. Zoek op lotnummer of op een batch die erin zit."),
    h("div", { class: "filters" }, h("label", { for: "zoek-lot", class: "filter breed" }, "Zoeken", zoek)),
    lijst,
  );
  await laad();
  zoek.focus();
}

async function toonLotpaspoort(nummer: string) {
  const actueel = vastHouden();
  toon(kop(`Lot ${nummer}`), laden());
  let lot: Lot, pas: { aantal_afwijkingen: number; regels: Regel[] };
  try {
    [lot, pas] = await Promise.all([haal<Lot & { registraties: { stapcode: string; poging: number; herbewerking_start: boolean; reden: string | null }[] }>(`/lots/${nummer}`),
      haal<{ aantal_afwijkingen: number; regels: Regel[] }>(`/lots/${nummer}/paspoort`)]);
  } catch (e) { return fout(e, `Lot ${nummer}`); }
  if (!actueel()) return;
  const afw = pas.regels.filter((r) => r.markering !== "ok");
  const herb = (lot as unknown as { registraties: { herbewerking_start: boolean; stapcode: string; reden: string | null }[] }).registraties.filter((r) => r.herbewerking_start);
  toon(
    h("p", { class: "terug" }, h("a", { href: "#/kwaliteit/lotpaspoort" }, "Alle lots")),
    kop(`Lotpaspoort ${lot.lotnummer}`,
      `${lotStatus[lot.status] ?? lot.status}, gemaakt ${datum(lot.aangemaakt_op)}`,
      h("button", { class: "knop", onclick: () => window.print() }, "Afdrukken")),
    h("dl", { class: "feiten" },
      h("div", {}, h("dt", {}, "Batches"), h("dd", {}, lot.batches.flatMap((b, i) => [i ? ", " : "", h("a", { href: `#/kwaliteit/batch/${b}` }, b)]))),
      h("div", {}, h("dt", {}, "Afwijkingen"), h("dd", {}, pas.aantal_afwijkingen === 0 ? "Geen" : String(pas.aantal_afwijkingen))),
      h("div", {}, h("dt", {}, "Herbewerkingen"), h("dd", {}, herb.length ? herb.map((r) => `${r.stapcode}: ${r.reden}`).join("; ") : "Geen")),
      h("div", {}, h("dt", {}, "Metingen"), h("dd", {}, String(pas.regels.length))),
    ),
    h("section", { class: "blok" }, h("h2", {}, "Afwijkingen"),
      afw.length ? regelsTabel(afw, true) : h("p", { class: "leeg goed" }, "Geen afwijkingen in dit lot en zijn batches.")),
    h("section", { class: "blok" }, h("h2", {}, "Metingen binnen grenzen"),
      h("details", { class: "meer" }, h("summary", {}, `Alle ${pas.regels.length - afw.length} metingen binnen grenzen tonen`),
        regelsTabel(pas.regels.filter((r) => r.markering === "ok").sort((a, b) => a.stap.localeCompare(b.stap, "nl", { numeric: true }) || a.batch_of_lot.localeCompare(b.batch_of_lot)), true))),
    h("p", { class: "afdruk-voet" }, `Afgedrukt ${new Date().toLocaleString("nl-NL")} door ${sessie.naam}. Fictieve gegevens.`),
  );
}

interface BatchPaspoort {
  batchnummer: string; status: string; lotnummer: string | null; aantal_afwijkingen: number;
  besluiten: { besluit: string; reden: string; besloten_door: string; besloten_op: string }[]; regels: Regel[];
}
const batchStatus: Record<string, string> = { gepland: "Gepland", in_productie: "In productie", in_beoordeling: "In beoordeling", in_lot: "In een lot", afgekeurd: "Afgekeurd" };
const besluitTekst: Record<string, string> = { in_beoordeling: "In beoordeling gezet", vrijgegeven: "Keurresultaat OK, vrijgegeven", afgekeurd: "Keurresultaat NOK, afgekeurd" };

export async function batch(nummer: string) {
  const actueel = vastHouden();
  toon(kop(`Batch ${nummer}`), laden());
  let b: BatchPaspoort;
  try { b = await haal<BatchPaspoort>(`/batches/${nummer}/paspoort`); } catch (e) { return fout(e, `Batch ${nummer}`); }
  if (!actueel()) return;
  const opnieuw = () => batch(nummer);
  toon(
    kop(`Batch ${b.batchnummer}`,
      h("span", {}, batchStatus[b.status] ?? b.status, b.lotnummer ? [", in lot ", h("a", { href: `#/kwaliteit/lotpaspoort/${b.lotnummer}` }, b.lotnummer)] : null),
      b.status === "in_beoordeling" && magKeuren() ? keurKnoppen(b.batchnummer, opnieuw) : null,
      b.status === "in_productie" && (sessie.rol === "kwaliteit" || sessie.rol === "ploegleider")
        ? h("button", { class: "knop", onclick: async () => {
            const r = await vraag(`${b.batchnummer} in beoordeling zetten`, [{ naam: "reden", label: "Reden" }], "In beoordeling zetten");
            if (!r) return;
            try { await stuur("POST", `/batches/${b.batchnummer}/besluiten`, { besluit: "in_beoordeling", reden: r.reden }); opnieuw(); }
            catch (e) { melding((e as Error).message, "fout"); }
          } }, "In beoordeling zetten")
        : null),
    b.besluiten.length
      ? h("section", { class: "blok" }, h("h2", {}, "Besluiten"),
          h("ol", { class: "tijdlijn" }, b.besluiten.map((d) => h("li", {}, h("strong", {}, besluitTekst[d.besluit] ?? d.besluit), h("span", {}, `${d.reden}, ${d.besloten_door}, ${datum(d.besloten_op)}`)))))
      : null,
    h("section", { class: "blok" }, h("h2", {}, b.aantal_afwijkingen ? `Metingen (${b.aantal_afwijkingen} afwijkend, bovenaan)` : "Metingen"),
      b.regels.length ? regelsTabel(b.regels, false) : h("p", { class: "leeg" }, "Nog geen metingen.")),
  );
}

// ---------- Afwijkingen ----------
interface Afwijking extends Regel { lotnummer: string | null; ingevoerd_op: string }
let filterStap = "", filterSoort = "";

export async function afwijkingen() {
  const actueel = vastHouden();
  toon(kop("Afwijkingen"), laden());
  let rijen: Afwijking[], stappen: Stap[];
  try {
    [rijen, stappen] = await Promise.all([
      haal<Afwijking[]>(`/analyse/afwijkingen${qs({ ...periode.bereik(), stapcode: filterStap, markering: filterSoort })}`),
      haal<Stap[]>("/config/stappen"),
    ]);
  } catch (e) { return fout(e); }
  if (!actueel()) return;
  const stapSel = h("select", { id: "f-stap", onchange: (e: Event) => { filterStap = (e.target as HTMLSelectElement).value; afwijkingen(); } },
    h("option", { value: "" }, "Alle stappen"), stappen.map((s) => h("option", { value: s.code, selected: s.code === filterStap }, s.naam)));
  const soortSel = h("select", { id: "f-soort", onchange: (e: Event) => { filterSoort = (e.target as HTMLSelectElement).value; afwijkingen(); } },
    h("option", { value: "" }, "Beide"), h("option", { value: "buiten_tolerantie", selected: filterSoort === "buiten_tolerantie" }, "Buiten tolerantie"),
    h("option", { value: "buiten_grens", selected: filterSoort === "buiten_grens" }, "Buiten grens"));
  toon(
    kop("Afwijkingen", "Metingen buiten tolerantie of buiten grens, nieuwste eerst."),
    h("div", { class: "filters" }, periodeKeuze(afwijkingen), h("label", { for: "f-stap", class: "filter" }, "Stap", stapSel), h("label", { for: "f-soort", class: "filter" }, "Soort", soortSel),
      h("span", { class: "sub" }, `${rijen.length} ${rijen.length === 1 ? "meting" : "metingen"}`)),
    rijen.length
      ? tabel(["Ingevoerd", "Batch of lot", "Lot", "Stap", "Veld", "Setting", "Gemeten", "Grenzen", "Resultaat", "Operator", ""],
          rijen.map((r) => [
            kort(r.ingevoerd_op),
            h("a", { href: r.batch_of_lot.startsWith("L-") ? `#/kwaliteit/lotpaspoort/${r.batch_of_lot}` : `#/kwaliteit/batch/${r.batch_of_lot}` }, r.batch_of_lot),
            r.lotnummer ? h("a", { href: `#/kwaliteit/lotpaspoort/${r.lotnummer}` }, r.lotnummer) : "",
            `${r.stap}${r.poging > 1 ? ` (${r.poging})` : ""}`, `${r.veld} ${r.veldnaam}`,
            h("span", { class: "getal" }, r.setting !== null ? toonGetal(r.setting) : ""),
            h("span", { class: "getal" }, `${toonGetal(r.gemeten)}${r.eenheid ? ` ${r.eenheid}` : ""}`),
            grenzen(r), label(r.markering), r.operator, h("a", { href: `#/kwaliteit/trend/${r.veld}` }, "Trend"),
          ]), "compact")
      : h("p", { class: "leeg goed" }, "Geen afwijkingen met deze filters."),
  );
}

// ---------- Trend per veld ----------
export async function trendScherm(veldcode?: string) {
  const actueel = vastHouden();
  toon(kop("Trend per veld"), laden());
  let stappen: Stap[];
  try { stappen = await haal<Stap[]>("/config/stappen"); } catch (e) { return fout(e); }
  const code = veldcode ?? "S5.1";
  let data: { veld: TrendVeld & { stap: string }; punten: TrendPunt[] };
  try { data = await haal(`/analyse/trend${qs({ veld: code, ...periode.bereik() })}`); } catch (e) {
    if (e instanceof ApiFout && e.status === 404) return fout(new Error(`Veld ${code} bestaat niet.`), "Trend per veld");
    return fout(e);
  }
  if (!actueel()) return;
  const veldSel = h("select", { id: "f-veld", onchange: (e: Event) => (location.hash = `#/kwaliteit/trend/${(e.target as HTMLSelectElement).value}`) },
    stappen.map((s) => h("optgroup", { label: s.naam }, s.velden.map((v) => h("option", { value: v.code, selected: v.code === code }, `${v.code} ${v.naam}`)))));
  const p = data.punten;
  const n = p.length;
  const afw = p.filter((x) => x.markering !== "ok").length;
  const gem = n ? p.reduce((a, x) => a + x.gemeten, 0) / n : 0;
  // Gemiddelde van de eerste en laatste kwart: laat zien of het proces wegloopt.
  const kwart = Math.max(1, Math.floor(n / 4));
  const gemBegin = n ? p.slice(0, kwart).reduce((a, x) => a + x.gemeten, 0) / kwart : 0;
  const gemEind = n ? p.slice(-kwart).reduce((a, x) => a + x.gemeten, 0) / kwart : 0;
  const e = data.veld.eenheid ? ` ${data.veld.eenheid}` : "";
  toon(
    kop("Trend per veld", `${data.veld.code} ${data.veld.naam}, ${data.veld.stap}. Elk punt is één meting.`),
    h("div", { class: "filters" }, h("label", { for: "f-veld", class: "filter" }, "Veld", veldSel), periodeKeuze(() => trendScherm(code))),
    n === 0
      ? h("p", { class: "leeg" }, "Geen metingen van dit veld in deze periode.")
      : h("section", { class: "blok" },
          h("dl", { class: "feiten" },
            h("div", {}, h("dt", {}, "Metingen"), h("dd", {}, String(n))),
            h("div", {}, h("dt", {}, "Afwijkend"), h("dd", {}, `${afw} (${((afw / n) * 100).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%)`)),
            h("div", {}, h("dt", {}, "Gemiddelde"), h("dd", {}, `${toonGetal(Number(gem.toFixed(2)))}${e}`)),
            h("div", {}, h("dt", {}, "Eerste kwart, laatste kwart"), h("dd", {}, `${toonGetal(Number(gemBegin.toFixed(2)))}${e} naar ${toonGetal(Number(gemEind.toFixed(2)))}${e}`)),
          ),
          trend(data.veld, p)),
  );
}

// ---------- Herbewerkingen en afkeur ----------
export async function herbewerkingen() {
  const actueel = vastHouden();
  toon(kop("Herbewerkingen en afkeur"), laden());
  type Herb = { lotnummer: string; stap: string; poging: number; reden: string; gestart_op: string };
  type Afk = { batchnummer: string; reden: string; door: string; afgekeurd_op: string; in_beoordeling_reden: string | null; laatst_afgeronde_stap: string | null };
  let herb: Herb[], afk: Afk[];
  try {
    [herb, afk] = await Promise.all([haal<Herb[]>(`/analyse/herbewerkingen${qs(periode.bereik())}`), haal<Afk[]>(`/analyse/afkeur${qs(periode.bereik())}`)]);
  } catch (e) { return fout(e); }
  if (!actueel()) return;
  const perReden = (lijst: { reden: string }[]) => {
    const m = new Map<string, number>();
    lijst.forEach((x) => m.set(x.reden, (m.get(x.reden) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} (${n})`).join(", ");
  };
  toon(
    kop("Herbewerkingen en afkeur", undefined, periodeKeuze(herbewerkingen)),
    h("section", { class: "blok" }, h("h2", {}, `Herbewerkingen (${herb.length})`),
      herb.length ? [h("p", { class: "sub" }, `Redenen: ${perReden(herb)}`),
        tabel(["Gestart", "Lot", "Terug naar stap", "Poging", "Reden"], herb.map((r) => [datum(r.gestart_op),
          h("a", { href: `#/kwaliteit/lotpaspoort/${r.lotnummer}`, class: "sterk" }, r.lotnummer), r.stap, h("span", { class: "getal" }, r.poging), r.reden]))]
        : h("p", { class: "leeg goed" }, "Geen herbewerkingen in deze periode.")),
    h("section", { class: "blok" }, h("h2", {}, `Afgekeurde batches (${afk.length})`),
      afk.length ? [h("p", { class: "sub" }, `Redenen: ${perReden(afk)}`),
        tabel(["Afgekeurd", "Batch", "Reden", "Door", "In beoordeling gezet om", "Laatst afgeronde stap"], afk.map((r) => [datum(r.afgekeurd_op),
          h("a", { href: `#/kwaliteit/batch/${r.batchnummer}`, class: "sterk" }, r.batchnummer), r.reden, r.door, r.in_beoordeling_reden ?? "", r.laatst_afgeronde_stap ?? ""]))]
        : h("p", { class: "leeg goed" }, "Geen afgekeurde batches in deze periode.")),
  );
}
