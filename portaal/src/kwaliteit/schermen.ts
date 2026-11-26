// Portaal Kwaliteit: overzicht, te beoordelen, lot- en batchpaspoort,
// afwijkingen, trend per veld, herbewerkingen en afkeur.
import { regelkaartGrafiek, type RkPunt } from "../grafiek";
import { tabelNaarExcel } from "../excel";
import { h, laden, melding, tijd, toon, vastHouden, vraag } from "../../../gedeeld/ui";
import { markeringTekst, toonGetal } from "../../../gedeeld/markering";
import type { Markering, Stap } from "../../../gedeeld/types";
import { ApiFout, gekozenProduct, haal, periode, PERIODES, producten, qs, sessie, stuur, heeftRecht, rechten } from "../basis";
import { afwijkingenPerWeek, gemengdeGrenzen, trend, type TrendPunt, type TrendVeld, type Week } from "../grafiek";
import { filterKnop, maakSorteerbaar } from "../tabelsorteer";
import { aanvullen, perTekst, perWoord, resolutie, RESOLUTIES, volgende, type Per } from "../resolutie";

// ---------- kleine bouwstenen ----------
export const label = (m: Markering) => h("span", { class: `label label-${m}` }, markeringTekst[m]);
export const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
/** Korte datum voor in tabellen: "4 okt 07:58". */
export const kort = (iso: string | null) => (iso ? new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "");

export function kop(titel: string, sub?: string | Node | null, ...rechts: (Node | null)[]) {
  return h("div", { class: "kop" }, h("div", {}, h("h1", {}, titel), sub ? h("p", { class: "sub" }, sub) : null), h("div", { class: "kop-rechts" }, ...rechts));
}

/** Periodekeuze; met een gekozen product (D55) staat dat erachter, zodat je ziet waarover de cijfers gaan. */
/** Filterrij boven een analyse: periode, bij grafieken met tijd ook per dag, week of maand (#58), en het gekozen product. */
export function periodeKeuze(opnieuw: () => void, metProduct = true, metPer = false) {
  const sel = h("select", { id: "periode", onchange: (e: Event) => { periode.id = (e.target as HTMLSelectElement).value; opnieuw(); } },
    PERIODES.map((p) => h("option", { value: p.id, selected: p.id === periode.id }, p.naam))) as HTMLSelectElement;
  const label = h("label", { for: "periode", class: "filter" }, "Periode", sel);
  const perSel = metPer
    ? h("label", { for: "per", class: "filter" }, "Groeperen",
        h("select", { id: "per", onchange: (e: Event) => { resolutie.per = (e.target as HTMLSelectElement).value as Per; opnieuw(); } },
          RESOLUTIES.map((r) => h("option", { value: r.id, selected: r.id === resolutie.per }, r.naam))))
    : null;
  const product = metProduct ? productKeuze(opnieuw) : null;
  if (!perSel && !product) return label;
  return h("div", { class: "filter-groep" }, label, perSel, product);
}

/** Productkeuze in de filterbalk (#93, D55), geel zodat je ziet over welk product de cijfers gaan.
 *  Onthouden op deze computer; met minder dan twee producten staat hij er niet. */
export function productKeuze(opnieuw: () => void): HTMLElement {
  let label: HTMLElement;
  const code = gekozenProduct.code;
  const sel = h("select", {
    id: "product-keuze",
    onchange: (e: Event) => {
      const nieuw = (e.target as HTMLSelectElement).value || null;
      gekozenProduct.code = nieuw;
      label.classList.toggle("gekozen", !!nieuw);
      label.dataset.product = nieuw ?? "";
      opnieuw();
    },
  }, h("option", { value: "" }, "Alle producten"), code ? h("option", { value: code, selected: true }, code) : null) as HTMLSelectElement;
  label = h("label", { for: "product-keuze", class: `filter filter-product${code ? " gekozen" : ""}`, "data-product": code ?? "" }, "Product", sel);
  producten().then((lijst) => {
    if (lijst.length < 2 && !gekozenProduct.code) { label.remove(); return; }
    sel.replaceChildren(h("option", { value: "" }, "Alle producten"),
      ...lijst.map((p) => h("option", { value: p.code, selected: p.code === gekozenProduct.code }, `${p.code} – ${p.naam}`)));
  }).catch(() => {});
  return label;
}

export function tabel(koppen: string[], rijen: (Node | string | number | null)[][], klasse = "") {
  // Kolommen met alleen getallen (ook met eenheid of duur, zoals "3 u 15") staan rechts, kop en cellen (richtlijnen §2).
  const rechts = koppen.map((_, k) => {
    const gevuld = rijen.map((r) => r[k]).filter((c) => c !== null && c !== "" && !(c instanceof Node && !c.textContent?.trim()));
    return gevuld.length > 0 && gevuld.every(isGetal);
  });
  // Korte waarden (datum, batchnummer, veld, grenzen) breken niet over twee regels; lange tekst zoals een reden wel (0.42.1).
  const kort = koppen.map((_, k) => rijen.every((r) => {
    const c = r[k];
    if (c instanceof Element && c.querySelector("button, select, input")) return false;
    return ((c instanceof Node ? c.textContent : c === null ? "" : String(c)) ?? "").trim().length <= 13;
  }));
  const klas = (i: number) => [rechts[i] ? "rechts" : "", kort[i] ? "kort" : ""].filter(Boolean).join(" ") || undefined;
  // Op een telefoon wordt elke regel een kaartje met "kop: waarde" (D64). De rollen houden het voor een
  // schermlezer een tabel, ook als de CSS de regels als blokken toont.
  const t = h("table", { class: `tabel kaartjes ${klasse}`, role: "table" },
    h("thead", { role: "rowgroup" }, h("tr", { role: "row" }, koppen.map((k, i) => h("th", { scope: "col", role: "columnheader", class: rechts[i] ? "rechts" : undefined }, k)))),
    h("tbody", { role: "rowgroup" }, rijen.map((r) => h("tr", { role: "row" }, r.map((c, i) => h("td", { role: "cell", class: klas(i), "data-kop": koppen[i] || undefined }, c ?? "")))))) as HTMLTableElement;
  // Elke tabel kan naar Excel; de naam komt van de dichtstbijzijnde kop (blok of pagina).
  const knop = h("button", {
    class: "knop knop-klein knop-stil excel-knop", type: "button",
    onclick: () => {
      const blok = knop.closest("section, .blok");
      const kopTekst = (blok?.querySelector("h2")?.textContent ?? document.querySelector("#scherm h1")?.textContent ?? "Tabel").trim();
      tabelNaarExcel(t, kopTekst);
    },
  }, "Naar Excel") as HTMLButtonElement;
  // Sorteren op elke kolom (klik op de kop) en filteren per kolom bij langere tabellen (#94, D83).
  maakSorteerbaar(t);
  const filterVak = h("div", { class: "tabel-filtervak" });
  const filter = filterKnop(t, filterVak);
  return h("div", { class: "tabel-met-acties" }, rijen.length ? h("div", { class: "tabel-acties" }, filter, knop) : null,
    filter ? filterVak : null, h("div", { class: "tabel-kader" }, t));
}

/** Een getal, of tekst die alleen uit cijfers en eenheden bestaat ("120,5 kg", "3 u 15", "99,8 %", "−2"). */
function isGetal(c: Node | string | number | null): boolean {
  if (typeof c === "number") return true;
  if (c instanceof Element && (c.classList.contains("getal") || c.querySelector(".getal"))) return true;
  const t = (c instanceof Node ? c.textContent : String(c))?.trim() ?? "";
  return /\d/.test(t) && /^[−+-]?[\d.,\s]*((u|min|kg|g|%|°C|bar|×)[\s\d.,]*)*$/.test(t);
}

/** Melding als een lijst op de maximale lengte zit: er is meer dan er getoond wordt (ook in de Excel-export). */
export function afgekapt(aantal: number, max: number, wat = "regels", hoe = "Kies een kortere periode of een filter om alles te zien.") {
  return aantal >= max
    ? h("p", { class: "afgekapt" }, `Er zijn meer dan ${max.toLocaleString("nl-NL")} ${wat}; hier staan alleen de ${max.toLocaleString("nl-NL")} nieuwste, ook in de Excel-export. ${hoe}`)
    : null;
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

const magKeuren = () => heeftRecht("inspection.batch.decide");
const magKeurHerbewerking = () => heeftRecht("inspection.rework.order");
const bevestigWachtwoord = { naam: "wachtwoord", label: "Bevestig met je eigen wachtwoord", type: "password" as const };

async function keur(batchnummer: string, besluit: "vrijgegeven" | "afgekeurd", daarna: () => void) {
  const ok = besluit === "vrijgegeven";
  const r = await vraag(`Keurresultaat ${ok ? "OK" : "NOK"} voor ${batchnummer}`, [{ naam: "reden", label: ok ? "Toelichting" : "Reden van afkeur" }, bevestigWachtwoord], ok ? "OK: vrijgeven" : "NOK: afkeuren");
  if (!r) return;
  try {
    await stuur("POST", `/batches/${batchnummer}/besluiten`, { besluit, reden: r.reden, wachtwoord: r.wachtwoord });
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

// ---------- Herbewerking (#61, D57) ----------
/** Kwaliteit en de productiemanager besluiten over een herbewerking. */
const magHerbewerken = () => heeftRecht("inspection.rework.order", "operations.rework.order");
const magHerbewerkingProduct = (product: string | null) => magHerbewerken() || !!product && !!rechten()?.products.some(p => p.product === product && ["inspection.rework.order","operations.rework.order"].includes(p.permission));
interface Herbewerking {
  id: string; soort: "batch" | "lot"; nummer: string; product: string | null; stap: string; stapnaam: string; reden: string;
  door: string | null; aangemaakt_op: string; gepland_op: string | null; gestart_op: string | null;
  stand: "te_plannen" | "gepland" | "bezig" | "klaar" | "gestopt" | "ingetrokken"; ingetrokken_reden: string | null; ingetrokken_door: string | null;
}
const STAND: Record<Herbewerking["stand"], string> = {
  te_plannen: "Nog te plannen", gepland: "Gepland", bezig: "Bezig", klaar: "Klaar", gestopt: "Gestopt (batch afgekeurd)", ingetrokken: "Ingetrokken",
};
function standLabel(h_: Herbewerking) {
  const tekst = h_.stand === "gepland" && h_.gepland_op ? `Gepland ${new Date(`${h_.gepland_op}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}` : STAND[h_.stand];
  return h("span", { class: `label label-stand-${h_.stand}` }, tekst);
}

/** Knop "Herbewerking": terug naar een stap die al doorlopen is, met reden. Een batch in beoordeling: het keurresultaat herbewerken. */
function herbewerkingKnop(nummer: string, daarna: () => void, inBeoordeling = false) {
  return h("button", { class: "knop", type: "button", onclick: async () => {
    let stappen: { code: string; naam: string }[];
    try { stappen = await haal(`/herbewerkingen/stappen${qs({ nummer })}`); } catch (e) { return melding((e as Error).message, "fout"); }
    if (!stappen.length) return melding(`${nummer} heeft nog geen afgeronde stap om naar terug te gaan.`, "info");
    const r = await vraag(`Herbewerking ${nummer}`, [
      { naam: "stap", label: "Terug naar stap", opties: stappen.map((s) => [s.code, `${s.code} ${s.naam}`] as [string, string]), waarde: stappen[stappen.length - 1].code },
      { naam: "reden", label: "Reden" }, bevestigWachtwoord,
    ], "Herbewerking aanmaken",
      `${nummer} doet de gekozen stap opnieuw en daarna alle volgende stappen. De operator start hem in die stap; de planner kan hem inplannen.${inBeoordeling ? " Dit is het keurresultaat: herbewerken." : ""}`);
    if (!r) return;
    try {
      await stuur("POST", "/herbewerkingen", { nummer, stapcode: r.stap, reden: r.reden, wachtwoord: r.wachtwoord });
      melding(`Herbewerking ${nummer} naar ${r.stap} aangemaakt`, "ok");
      daarna();
    } catch (e) { melding((e as Error).message, "fout"); }
  } }, inBeoordeling ? "Herbewerken" : "Herbewerking");
}

/** Tabel met herbewerkingen en hun stand; open opdrachten kunnen worden ingetrokken. */
function herbewerkingTabel(lijst: Herbewerking[], daarna: () => void, metNummer = true) {
  const intrekken = async (x: Herbewerking) => {
    const r = await vraag(`Herbewerking ${x.nummer} intrekken`, [{ naam: "reden", label: "Reden" }, bevestigWachtwoord], "Intrekken");
    if (!r) return;
    try { await stuur("POST", `/herbewerkingen/${x.id}/intrekken`, { reden: r.reden, wachtwoord: r.wachtwoord }); melding("Herbewerking ingetrokken", "ok"); daarna(); }
    catch (e) { melding((e as Error).message, "fout"); }
  };
  const nummerLink = (x: Herbewerking) => h("a", { href: x.soort === "lot" ? `#/kwaliteit/lotpaspoort/${x.nummer}` : `#/kwaliteit/batch/${x.nummer}`, class: "sterk" }, x.nummer);
  return tabel([...(metNummer ? ["Batch of lot"] : []), ...(metNummer && !gekozenProduct.code ? ["Product"] : []), "Terug naar stap", "Reden", "Aangemaakt", "Stand", ""],
    lijst.map((x) => [
      ...(metNummer ? [nummerLink(x)] : []), ...(metNummer && !gekozenProduct.code ? [x.product ?? ""] : []),
      `${x.stap} ${x.stapnaam}`,
      x.stand === "ingetrokken" && x.ingetrokken_reden ? h("span", {}, x.reden, h("br"), h("small", { class: "noot" }, `Ingetrokken door ${x.ingetrokken_door ?? "?"}: ${x.ingetrokken_reden}`)) : x.reden,
      h("span", {}, datum(x.aangemaakt_op), h("br"), h("small", { class: "noot" }, x.door ?? "zonder opdracht gestart")),
      standLabel(x),
      magHerbewerkingProduct(x.product) && (x.stand === "te_plannen" || x.stand === "gepland")
        ? h("button", { class: "knop knop-klein knop-gevaar", type: "button", onclick: () => intrekken(x) }, "Intrekken") : "",
    ]), "compact");
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
  const per = resolutie.per;
  try { d = await haal<Samenvatting>(`/analyse/samenvatting${qs({ ...periode.bereik(), per })}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const groepen = aanvullen(d.per_week, per, periode.bereik().van, (week) => ({ week, waarden: 0, buiten_tolerantie: 0, buiten_grens: 0 }));
  const afwijkend = d.buiten_tolerantie + d.buiten_grens;
  const pct = d.waarden ? (afwijkend / d.waarden) * 100 : 0;
  // #59: klik op een week (of dag of maand) in de grafiek, dan staan de afwijkingen daarvan eronder.
  const weekLijst = h("div", { class: "week-lijst", "aria-live": "polite" });
  const toonWeek = async (week: string) => {
    const bereik = periode.bereik();
    const totIso = volgende(week, per);
    const van = bereik.van && bereik.van > week ? bereik.van : week;
    weekLijst.replaceChildren(laden());
    let rijen: Afwijking[];
    try { rijen = await haal<Afwijking[]>(`/analyse/afwijkingen${qs({ van, tot: totIso, product: bereik.product })}`); } catch (e) {
      weekLijst.replaceChildren(h("p", { class: "leeg" }, `De lijst kon niet worden geladen: ${e instanceof Error ? e.message : String(e)}`)); return;
    }
    if (!actueel()) return;
    const titel = `Afwijkingen: ${perTekst(week, per, false)}`;
    weekLijst.replaceChildren(...([
      h("h3", {}, titel),
      afgekapt(rijen.length, 500, "afwijkende metingen"),
      rijen.length ? afwijkingTabel(rijen) : h("p", { class: "leeg" }, "Geen afwijkingen in deze periode."),
    ] as (Node | null)[]).filter((x): x is Node => x !== null));
  };
  const tegel = (getal: number | string, tekst: string, link?: string, nadruk = false) =>
    h(link ? "a" : "div", { class: nadruk ? "tegel kwaliteit-cijfer nadruk" : "tegel kwaliteit-cijfer", href: link }, h("span", { class: "tegel-getal" }, getal), h("span", { class: "tegel-tekst" }, tekst));
  toon(
    kop("Kwaliteit", `Afwijkingen, beoordelingen en herbewerkingen, ${PERIODES.find((p) => p.id === periode.id)!.naam.toLowerCase()}.`, periodeKeuze(overzicht, true, true)),
    h("div", { class: "tegels" },
      tegel(d.te_beoordelen, d.te_beoordelen === 1 ? "batch wacht op keurresultaat" : "batches wachten op keurresultaat", "#/kwaliteit/beoordelen", d.te_beoordelen > 0),
      tegel(afwijkend, `afwijkende metingen (${pct.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%)`, "#/kwaliteit/afwijkingen"),
      tegel(d.herbewerkingen, "herbewerkingen", "#/kwaliteit/herbewerkingen"),
      tegel(d.afgekeurd, "batches afgekeurd", "#/kwaliteit/herbewerkingen"),
      tegel(d.lots, "lots gemaakt", "#/kwaliteit/lotpaspoort"),
    ),
    h("section", { class: "blok kwaliteit-kaart" },
      h("h2", {}, `Afwijkingen ${perWoord(per)}`),
      groepen.some((w) => w.buiten_grens + w.buiten_tolerantie > 0)
        ? [h("p", { class: "sub" }, `Klik op een staaf voor de afwijkingen van die ${per}.`), afwijkingenPerWeek(groepen, (week) => void toonWeek(week), per), weekLijst]
        : h("p", { class: "leeg" }, "Geen afwijkingen in deze periode.")),
    h("section", { class: "blok kwaliteit-kaart" },
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

interface KeuringRij { id: string; registratie_id: string; soort: "batch" | "lot"; nummer: string; product: string | null; stap: string; stapnaam: string; sinds: string; te_meten: number; afwijkingen: number }

export async function beoordelen() {
  const actueel = vastHouden();
  toon(kop("Te beoordelen"), laden());
  let rijen: TeBeoordelen[], keuringen: KeuringRij[];
  try { [rijen, keuringen] = await Promise.all([haal<TeBeoordelen[]>("/analyse/te-beoordelen"), haal<KeuringRij[]>("/keuringen")]); } catch (e) { return fout(e); }
  if (!actueel()) return;
  // #64: stappen die op de metingen en de vrijgave van Kwaliteit wachten. Meten en beslissen gebeurt in het invoerscherm (lab-pc).
  const wachtOpKwaliteit = h("section", { class: `blok kwaliteit-kaart${keuringen.length ? " kwaliteit-open" : ""}` }, h("h2", {}, `Wacht op meting van Kwaliteit (${keuringen.length})`),
    keuringen.length
      ? [h("p", { class: "sub" }, "Deze batches en lots zijn afgerond maar gaan pas verder na de vrijgave. Meten en vrijgeven doe je in het invoerscherm, op de lab-pc."),
         tabel(["Batch of lot", "Product", "Stap", "Afgerond", "Nog te meten", "Afwijkend"], keuringen.map((k) => [
           h("a", { href: k.soort === "lot" ? `#/kwaliteit/lotpaspoort/${k.nummer}` : `#/kwaliteit/batch/${k.nummer}`, class: "sterk" }, k.nummer),
           k.product ?? "", `${k.stap} ${k.stapnaam}`, datum(k.sinds), h("span", { class: "getal" }, k.te_meten), h("span", { class: "getal" }, k.afwijkingen)]), "compact")]
      : h("p", { class: "leeg goed" }, "Er wacht niets op een meting van Kwaliteit."));
  toon(
    kop("Te beoordelen", magKeuren()
      ? "Batches die in beoordeling staan. OK geeft de batch vrij voor de volgende stap, NOK keurt hem af, Herbewerken stuurt hem terug naar een eerdere stap."
      : "Batches die in beoordeling staan. Alleen Kwaliteit voert het keurresultaat in."),
    rijen.length
      ? tabel(["Batch", "In beoordeling sinds", "Reden", "Door", "Laatst afgerond", "Afwijkingen", magKeuren() || magKeurHerbewerking() ? "Keurresultaat" : ""],
          rijen.map((r) => [
            h("a", { href: `#/kwaliteit/batch/${r.batchnummer}`, class: "sterk" }, r.batchnummer), datum(r.sinds), r.reden, r.door,
            r.laatst_afgeronde_stap ?? "Nog geen stap", h("span", { class: "getal" }, r.afwijkingen),
            magKeuren() || magKeurHerbewerking() ? h("div", { class: "knoppen-klein" }, magKeuren() ? keurKnoppen(r.batchnummer, beoordelen) : null, magKeurHerbewerking() ? herbewerkingKnop(r.batchnummer, beoordelen, true) : null) : "",
          ]))
      : h("p", { class: "leeg" }, "Er staan geen batches in beoordeling."),
    wachtOpKwaliteit,
  );
}

// ---------- Paspoorten ----------
interface Regel {
  batch_of_lot: string; stap: string; poging: number; herbewerking_reden: string | null; veld: string; veldnaam: string; eenheid: string | null;
  setting: number | null; gemeten: number; grens_min: number | null; grens_max: number | null; tolerantie: number | null; tolerantie_soort: string | null;
  markering: Markering; gecorrigeerd: boolean; operator: string; pc: string; afgerond_op: string | null; decimalen?: number | null;
  nageleverd?: boolean;
}

/** Tabel met metingen. Met een lotnummer is het resultaat van een afwijking een knop die de meting openklapt (#56). */
function regelsTabel(regels: Regel[], metBatch: boolean, lotnummer?: string) {
  const koppen = ["Stap", ...(metBatch ? ["Batch of lot"] : []), "Veld", "Instelling", "Gemeten", "Grenzen", "Resultaat", "Operator", "Afgerond"];
  return tabel(
    koppen,
    regels.map((r) => [
      `${r.stap}${r.poging > 1 ? ` (poging ${r.poging})` : ""}`,
      ...(metBatch ? [r.batch_of_lot] : []),
      `${r.veld} ${r.veldnaam}`,
      h("span", { class: "getal" }, r.setting !== null ? toonGetal(r.setting, r.decimalen) : ""),
      h("span", { class: "getal" }, `${toonGetal(r.gemeten, r.decimalen)}${r.eenheid ? ` ${r.eenheid}` : ""}`, r.gecorrigeerd ? h("span", { class: "noot" }, " gecorrigeerd") : ""),
      grenzen(r), lotnummer && r.markering !== "ok" ? metingKnop(lotnummer, r, koppen.length) : label(r.markering), r.nageleverd ? `${r.operator} (papier)` : r.operator, kort(r.afgerond_op),
    ]),
    "compact",
  );
}

interface MetingDetail {
  batch_of_lot: string; stap: string; stapnaam: string; poging: number; herbewerking_reden: string | null; veld: string; veldnaam: string; soort: string;
  eenheid: string | null; decimalen: number | null; operator: string; pc: string; gestart_op: string; afgerond_op: string | null; product: string | null;
  versies: { setting: number | null; gemeten: number; grens_min: number | null; grens_max: number | null; tolerantie: number | null; tolerantie_soort: string | null;
    markering: Markering; ingevoerd_op: string; door: string; correctie_reden: string | null }[];
  besluiten: { besluit: string; reden: string; besloten_door: string; besloten_op: string }[];
  herbewerkingen: { stap: string; poging: number; reden: string | null; gestart_op: string }[];
}

/** Knop op het resultaat: klapt onder de regel de meting open, met correcties en het keurresultaat. */
function metingKnop(lotnummer: string, r: Regel, kolommen: number): Node {
  const knop = h("button", { type: "button", class: "label-knop", "aria-expanded": "false", "aria-label": `${markeringTekst[r.markering]}: ${r.veld} van ${r.batch_of_lot} bekijken` },
    label(r.markering), h("span", { class: "label-pijl", "aria-hidden": "true" }, "▸")) as HTMLButtonElement;
  knop.addEventListener("click", async () => {
    const rij = knop.closest("tr")!;
    const open = rij.nextElementSibling?.classList.contains("meting-detail") ? rij.nextElementSibling : null;
    if (open) { open.remove(); knop.setAttribute("aria-expanded", "false"); return; }
    const vak = h("td", { colspan: String(kolommen) }, laden());
    rij.after(h("tr", { class: "meting-detail" }, vak));
    knop.setAttribute("aria-expanded", "true");
    try {
      const m = await haal<MetingDetail>(`/lots/${encodeURIComponent(lotnummer)}/meting${qs({ nummer: r.batch_of_lot, stap: r.stap, poging: r.poging, veld: r.veld })}`);
      vak.replaceChildren(metingDetail(m));
    } catch (e) { vak.replaceChildren(h("p", { class: "leeg" }, (e as Error).message)); }
  });
  return knop;
}

function metingDetail(m: MetingDetail): Node {
  const nu = m.versies[m.versies.length - 1];
  const g = (n: number | null) => (n === null ? "" : toonGetal(n, m.decimalen));
  const eenheid = m.eenheid ? ` ${m.eenheid}` : "";
  const verschil = nu.setting !== null ? nu.gemeten - nu.setting : null;
  const isBatch = m.batch_of_lot.startsWith("B-");
  return h("div", { class: "meting-vak" },
    h("dl", { class: "feiten" },
      h("div", {}, h("dt", {}, "Meting"), h("dd", {}, `${m.veld} ${m.veldnaam}, ${m.stap} ${m.stapnaam}${m.poging > 1 ? ` (poging ${m.poging})` : ""}`)),
      h("div", {}, h("dt", {}, "Gemeten"), h("dd", {}, `${g(nu.gemeten)}${eenheid}`,
        nu.setting !== null ? ` bij instelling ${g(nu.setting)}${eenheid} (verschil ${verschil! > 0 ? "+" : ""}${toonGetal(verschil!, m.decimalen)}${eenheid})` : "")),
      h("div", {}, h("dt", {}, "Grenzen toen"), h("dd", {}, grenzen({ ...nu, eenheid: m.eenheid }) || "Geen")),
      h("div", {}, h("dt", {}, "Ingevoerd"), h("dd", {}, `${kort(m.versies[0].ingevoerd_op)} door ${m.operator} op ${m.pc}${m.product ? `, product ${m.product}` : ""}`))),
    m.versies.length > 1
      ? h("div", {}, h("h3", {}, "Correcties"),
          h("ol", { class: "meting-versies" }, m.versies.map((v, i) =>
            h("li", {}, `${kort(v.ingevoerd_op)}: ${g(v.gemeten)}${eenheid} `, label(v.markering), ` door ${v.door}`,
              i > 0 && v.correctie_reden ? h("div", { class: "sub" }, `Reden: ${v.correctie_reden}`) : null))))
      : null,
    isBatch
      ? h("div", {}, h("h3", {}, "Beoordeling van de batch"),
          m.besluiten.length
            ? h("ul", { class: "meting-versies" }, m.besluiten.map((b) =>
                h("li", {}, h("strong", {}, besluitTekst[b.besluit] ?? b.besluit), ` op ${kort(b.besloten_op)} door ${b.besloten_door}`, h("div", { class: "sub" }, `Reden: ${b.reden}`))))
            : h("p", { class: "sub" }, "Deze batch is niet in beoordeling geweest; er is geen keurresultaat."),
          h("p", {}, h("a", { href: `#/kwaliteit/batch/${m.batch_of_lot}` }, `Batch ${m.batch_of_lot} bekijken`)))
      : h("div", {}, h("h3", {}, "Herbewerking van het lot"),
          m.herbewerkingen.length
            ? h("ul", { class: "meting-versies" }, m.herbewerkingen.map((x) =>
                h("li", {}, h("strong", {}, `${x.stap} opnieuw (poging ${x.poging})`), ` vanaf ${kort(x.gestart_op)}`, x.reden ? h("div", { class: "sub" }, `Reden: ${x.reden}`) : null)))
            : h("p", { class: "sub" }, "Het lot is niet herbewerkt.")));
}

interface Lot { lotnummer: string; status: string; aangemaakt_op: string; batches: string[]; product?: string | null; afwijkingen?: number; herbewerkingen?: number }
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
      const lots = await haal<Lot[]>(`/lots${qs({ zoek: zoek.value.trim(), product: gekozenProduct.code ?? "", limiet: 30 })}`);
      if (!actueel() || mijn !== laatste) return;
      lijst.replaceChildren(lots.length
        ? tabel(["Lot", "Product", "Status", "Gemaakt", "Batches", "Afwijkingen", "Herbewerkingen"], lots.map((l) => [
            h("a", { href: `#/kwaliteit/lotpaspoort/${l.lotnummer}`, class: "sterk" }, l.lotnummer), l.product ?? "", lotStatus[l.status] ?? l.status, datum(l.aangemaakt_op),
            l.batches.join(", "), h("span", { class: l.afwijkingen ? "getal let-op" : "getal" }, l.afwijkingen ?? 0), h("span", { class: "getal" }, l.herbewerkingen ?? 0),
          ]))
        : h("p", { class: "leeg" }, "Geen lots gevonden."));
    } catch (e) { lijst.replaceChildren(h("p", { class: "leeg" }, (e as Error).message)); }
  };
  let timer: number | undefined;
  zoek.addEventListener("input", () => { clearTimeout(timer); timer = window.setTimeout(laad, 250); });
  toon(
    kop("Lotpaspoort", "Alles over één lot en zijn 4 batches. Zoek op lotnummer of op een batch die erin zit."),
    h("div", { class: "filters" }, h("label", { for: "zoek-lot", class: "filter breed" }, "Zoeken", zoek), productKeuze(() => void laad())),
    lijst,
  );
  await laad();
  zoek.focus();
}

async function toonLotpaspoort(nummer: string) {
  const actueel = vastHouden();
  toon(kop(`Lot ${nummer}`), laden());
  let lot: Lot, pas: { aantal_afwijkingen: number; regels: Regel[]; grondstoffen?: GsPaspoort[] }, herb: Herbewerking[];
  try {
    [lot, pas, herb] = await Promise.all([haal<Lot>(`/lots/${nummer}`),
      haal<{ aantal_afwijkingen: number; regels: Regel[]; grondstoffen?: GsPaspoort[] }>(`/lots/${nummer}/paspoort`),
      haal<Herbewerking[]>(`/herbewerkingen${qs({ nummer })}`)]);
  } catch (e) { return fout(e, `Lot ${nummer}`); }
  if (!actueel()) return;
  const afw = pas.regels.filter((r) => r.markering !== "ok");
  const opnieuw = () => toonLotpaspoort(nummer);
  const openHerb = herb.some((x) => x.stand === "te_plannen" || x.stand === "gepland");
  toon(
    h("p", { class: "terug" }, h("a", { href: "#/kwaliteit/lotpaspoort" }, "Alle lots")),
    kop(`Lotpaspoort ${lot.lotnummer}`,
      `${lotStatus[lot.status] ?? lot.status}, gemaakt ${datum(lot.aangemaakt_op)}`,
      h("div", { class: "knoppen-klein" },
        h("a", { class: "knop knop-stil", href: `#/etiketten/printer/${encodeURIComponent(lot.lotnummer)}` }, "Etiket"),
        h("a", { class: "knop knop-stil", href: `#/kwaliteit/certificaat/${encodeURIComponent(lot.lotnummer)}` }, "Certificaat"),
        magHerbewerkingProduct(lot.product ?? null) && ["in_productie", "gereed"].includes(lot.status) && !openHerb ? herbewerkingKnop(lot.lotnummer, opnieuw) : null,
        h("button", { class: "knop", onclick: () => window.print() }, "Afdrukken"))),
    h("dl", { class: "feiten" },
      h("div", {}, h("dt", {}, "Batches"), h("dd", {}, lot.batches.flatMap((b, i) => [i ? ", " : "", h("a", { href: `#/kwaliteit/batch/${b}` }, b)]))),
      h("div", {}, h("dt", {}, "Afwijkingen"), h("dd", {}, pas.aantal_afwijkingen === 0 ? "Geen" : String(pas.aantal_afwijkingen))),
      h("div", {}, h("dt", {}, "Herbewerkingen"), h("dd", {}, herb.length ? herb.map((r) => `${r.stap}: ${r.reden} (${STAND[r.stand].toLowerCase()})`).join("; ") : "Geen")),
      h("div", {}, h("dt", {}, "Metingen"), h("dd", {}, String(pas.regels.length))),
    ),
    h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, "Afwijkingen"),
      afw.length ? [h("p", { class: "sub" }, "Klik op een resultaat voor de meting, correcties en het keurresultaat."), regelsTabel(afw, true, lot.lotnummer)]
        : h("p", { class: "leeg goed" }, "Geen afwijkingen in dit lot en zijn batches.")),
    herb.length ? h("section", { class: "blok kwaliteit-kaart geen-print" }, h("h2", {}, "Herbewerkingen"), herbewerkingTabel(herb, opnieuw, false)) : null,
    pas.grondstoffen?.length
      ? h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, "Grondstoffen"),
          tabel(["Stap", "Batch of lot", "Grondstof", "Partij", "Hoeveelheid"], pas.grondstoffen.map((g) => [
            g.stap, g.batch_of_lot, `${g.grondstof} ${g.grondstofnaam}`,
            h("span", {}, h("a", { href: `#/kwaliteit/grondstoffen/${encodeURIComponent(g.partij)}`, class: "sterk" }, g.partij), g.gecorrigeerd ? " (gecorrigeerd)" : ""),
            g.hoeveelheid !== null ? `${toonGetal(g.hoeveelheid)}${g.eenheid ? ` ${g.eenheid}` : ""}` : ""]), "compact"))
      : null,
    h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, "Metingen binnen grenzen"),
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
const besluitTekst: Record<string, string> = { in_beoordeling: "In beoordeling gezet", vrijgegeven: "Keurresultaat OK, vrijgegeven", afgekeurd: "Keurresultaat NOK, afgekeurd", herbewerken: "Keurresultaat herbewerken" };

export async function batch(nummer: string) {
  const actueel = vastHouden();
  toon(kop(`Batch ${nummer}`), laden());
  let b: BatchPaspoort, herb: Herbewerking[];
  try {
    [b, herb] = await Promise.all([haal<BatchPaspoort>(`/batches/${nummer}/paspoort`), haal<Herbewerking[]>(`/herbewerkingen${qs({ nummer })}`)]);
  } catch (e) { return fout(e, `Batch ${nummer}`); }
  if (!actueel()) return;
  const opnieuw = () => batch(nummer);
  const openHerb = herb.some((x) => x.stand === "te_plannen" || x.stand === "gepland");
  toon(
    kop(`Batch ${b.batchnummer}`,
      h("span", {}, batchStatus[b.status] ?? b.status, b.lotnummer ? [", in lot ", h("a", { href: `#/kwaliteit/lotpaspoort/${b.lotnummer}` }, b.lotnummer)] : null),
      h("div", { class: "knoppen-klein" },
      b.status === "in_beoordeling" && magKeuren() ? keurKnoppen(b.batchnummer, opnieuw) : null,
      b.status === "in_beoordeling" && magKeurHerbewerking() ? herbewerkingKnop(b.batchnummer, opnieuw, true) : null,
      b.status === "in_productie" && magHerbewerken() && !openHerb ? herbewerkingKnop(b.batchnummer, opnieuw) : null,
      b.status === "in_productie" && heeftRecht("execution.hold", "inspection.hold")
        ? h("button", { class: "knop", onclick: async () => {
            const r = await vraag(`${b.batchnummer} in beoordeling zetten`, [{ naam: "reden", label: "Reden" }], "In beoordeling zetten");
            if (!r) return;
            try { await stuur("POST", `/batches/${b.batchnummer}/besluiten`, { besluit: "in_beoordeling", reden: r.reden }); opnieuw(); }
            catch (e) { melding((e as Error).message, "fout"); }
          } }, "In beoordeling zetten")
        : null)),
    herb.length ? h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, "Herbewerkingen"), herbewerkingTabel(herb, opnieuw, false)) : null,
    b.besluiten.length
      ? h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, "Besluiten"),
          h("ol", { class: "tijdlijn" }, b.besluiten.map((d) => h("li", {}, h("strong", {}, besluitTekst[d.besluit] ?? d.besluit), h("span", {}, `${d.reden}, ${d.besloten_door}, ${datum(d.besloten_op)}`)))))
      : null,
    h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, b.aantal_afwijkingen ? `Metingen (${b.aantal_afwijkingen} afwijkend, bovenaan)` : "Metingen"),
      b.regels.length ? regelsTabel(b.regels, false) : h("p", { class: "leeg" }, "Nog geen metingen.")),
  );
}

// ---------- Afwijkingen ----------
interface Afwijking extends Regel { lotnummer: string | null; ingevoerd_op: string; product?: string | null }
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
    afgekapt(rijen.length, 500, "afwijkende metingen"),
    rijen.length
      ? afwijkingTabel(rijen)
      : h("p", { class: "leeg goed" }, "Geen afwijkingen met deze filters."),
  );
}

/** Tabel met afwijkende metingen (scherm Afwijkingen en de weeklijst in het overzicht). */
function afwijkingTabel(rijen: Afwijking[]) {
  return tabel(["Ingevoerd", "Batch of lot", "Lot", ...(gekozenProduct.code ? [] : ["Product"]), "Stap", "Veld", "Instelling", "Gemeten", "Grenzen", "Resultaat", "Operator", ""],
          rijen.map((r) => [
            kort(r.ingevoerd_op),
            h("a", { href: r.batch_of_lot.startsWith("L-") ? `#/kwaliteit/lotpaspoort/${r.batch_of_lot}` : `#/kwaliteit/batch/${r.batch_of_lot}` }, r.batch_of_lot),
            r.lotnummer ? h("a", { href: `#/kwaliteit/lotpaspoort/${r.lotnummer}` }, r.lotnummer) : "",
            ...(gekozenProduct.code ? [] : [r.product ?? ""]),
            `${r.stap}${r.poging > 1 ? ` (${r.poging})` : ""}`, `${r.veld} ${r.veldnaam}`,
            h("span", { class: "getal" }, r.setting !== null ? toonGetal(r.setting, r.decimalen) : ""),
            h("span", { class: "getal" }, `${toonGetal(r.gemeten, r.decimalen)}${r.eenheid ? ` ${r.eenheid}` : ""}`),
            grenzen(r), label(r.markering), r.operator, h("a", { href: `#/kwaliteit/trend/${r.veld}` }, "Trend"),
          ]), "compact");
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
    afgekapt(n, 5000, "metingen", "Kies een kortere periode om alles te zien."),
    n === 0
      ? h("p", { class: "leeg" }, "Geen metingen van dit veld in deze periode.")
      : h("section", { class: "blok kwaliteit-kaart" },
          h("dl", { class: "feiten" },
            h("div", {}, h("dt", {}, "Metingen"), h("dd", {}, String(n))),
            h("div", {}, h("dt", {}, "Afwijkend"), h("dd", {}, `${afw} (${((afw / n) * 100).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%)`)),
            h("div", {}, h("dt", {}, "Gemiddelde"), h("dd", {}, `${toonGetal(Number(gem.toFixed(2)))}${e}`)),
            h("div", {}, h("dt", {}, "Eerste kwart, laatste kwart"), h("dd", {}, `${toonGetal(Number(gemBegin.toFixed(2)))}${e} naar ${toonGetal(Number(gemEind.toFixed(2)))}${e}`)),
          ),
          trend(data.veld, p),
          // #89: bij producten met verschillende grenzen tekent de grafiek geen lijnen.
          gemengdeGrenzen(p)
            ? h("p", { class: "sub" }, "Deze metingen horen bij producten met verschillende grenzen. Daarom staan er geen grens- en tolerantielijnen: elk punt is gekleurd naar de grenzen van zijn eigen product (die staan bij het punt als je erop wijst). Kies bovenin een product om de lijnen van dat product te zien.")
            : null),
  );
}

// ---------- Herbewerkingen en afkeur ----------
export async function herbewerkingen() {
  const actueel = vastHouden();
  toon(kop("Herbewerkingen en afkeur"), laden());
  type Afk = { batchnummer: string; reden: string; door: string; afgekeurd_op: string; in_beoordeling_reden: string | null; laatst_afgeronde_stap: string | null };
  let herb: Herbewerking[], afk: Afk[];
  try {
    [herb, afk] = await Promise.all([haal<Herbewerking[]>(`/herbewerkingen${qs(periode.bereik())}`), haal<Afk[]>(`/analyse/afkeur${qs(periode.bereik())}`)]);
  } catch (e) { return fout(e); }
  if (!actueel()) return;
  const perReden = (lijst: { reden: string }[]) => {
    const m = new Map<string, number>();
    lijst.forEach((x) => m.set(x.reden, (m.get(x.reden) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} (${n})`).join(", ");
  };
  // #61: wat nog niet klaar is staat er altijd (ook van voor de periode); de rest als hij in de periode is aangemaakt.
  const lopend = herb.filter((x) => ["te_plannen", "gepland", "bezig"].includes(x.stand));
  const afgerond = herb.filter((x) => !lopend.includes(x));
  const telStand = (st: Herbewerking["stand"]) => herb.filter((x) => x.stand === st).length;
  toon(
    kop("Herbewerkingen en afkeur",
      magHerbewerken() ? "Een herbewerking maak je aan bij de batch of in het lotpaspoort, of als keurresultaat bij Te beoordelen." : "Kwaliteit en de productiemanager maken herbewerkingen aan.",
      periodeKeuze(herbewerkingen)),
    h("div", { class: "tegels" },
      ...([["te_plannen", "nog te plannen"], ["gepland", "gepland"], ["bezig", "bezig"]] as [Herbewerking["stand"], string][])
        .map(([st, t]) => h("div", { class: `tegel kwaliteit-cijfer${st === "te_plannen" && telStand(st) ? " let-op" : ""}` }, h("span", { class: "tegel-getal" }, telStand(st)), h("span", { class: "tegel-tekst" }, `herbewerkingen ${t}`)))),
    h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, `Lopende herbewerkingen (${lopend.length})`),
      lopend.length ? herbewerkingTabel(lopend, herbewerkingen) : h("p", { class: "leeg goed" }, "Er loopt geen herbewerking.")),
    h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, `Afgeronde en ingetrokken herbewerkingen (${afgerond.length})`),
      afgerond.length ? [h("p", { class: "sub" }, `Redenen: ${perReden(afgerond)}`), herbewerkingTabel(afgerond, herbewerkingen)]
        : h("p", { class: "leeg goed" }, "Geen afgeronde herbewerkingen in deze periode.")),
    h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, `Afgekeurde batches (${afk.length})`),
      afk.length ? [h("p", { class: "sub" }, `Redenen: ${perReden(afk)}`),
        tabel(["Afgekeurd", "Batch", "Reden", "Door", "In beoordeling gezet om", "Laatst afgeronde stap"], afk.map((r) => [datum(r.afgekeurd_op),
          h("a", { href: `#/kwaliteit/batch/${r.batchnummer}`, class: "sterk" }, r.batchnummer), r.reden, r.door, r.in_beoordeling_reden ?? "", r.laatst_afgeronde_stap ?? ""]))]
        : h("p", { class: "leeg goed" }, "Geen afgekeurde batches in deze periode.")),
  );
}

// ---------- Grondstoffen terugzoeken ----------
interface GsPaspoort { batch_of_lot: string; stap: string; grondstof: string; grondstofnaam: string; partij: string; hoeveelheid: number | null; eenheid: string | null; gecorrigeerd: boolean }
interface GsRegel {
  grondstof: string; grondstofnaam: string; partij: string; hoeveelheid: number | null; eenheid: string | null;
  batchnummer: string | null; batchstatus: string | null; lotnummer: string | null; lotstatus: string | null; stap: string; ingevoerd_op: string; gecorrigeerd: boolean;
}
interface Partij { grondstof: string; grondstofnaam: string; partij: string; batches: number; eerste: string; laatste: string }

export async function grondstoffen(partij?: string) {
  const actueel = vastHouden();
  const zoek = h("input", { id: "zoek-partij", type: "text", placeholder: "Partijnummer of een deel ervan", autocomplete: "off", value: partij ?? "" }) as HTMLInputElement;
  const uitkomst = h("div", {}, laden());
  let laatste = 0;
  const laad = async () => {
    const mijn = ++laatste;
    const t = zoek.value.trim();
    try {
      if (t.length < 2) {
        const p = await haal<Partij[]>("/analyse/partijen");
        if (!actueel() || mijn !== laatste) return;
        uitkomst.replaceChildren(h("h2", { class: "tussenkop" }, "Laatst gebruikte partijen"), p.length
          ? tabel(["Partij", "Grondstof", "Batches", "Gebruikt van", "tot"], p.slice(0, 60).map((x) => [
              h("a", { href: `#/kwaliteit/grondstoffen/${encodeURIComponent(x.partij)}`, class: "sterk" }, x.partij), `${x.grondstof} ${x.grondstofnaam}`,
              h("span", { class: "getal" }, x.batches), datum(x.eerste), datum(x.laatste)]), "compact")
          : h("p", { class: "leeg" }, "Er zijn nog geen grondstoffen ingevoerd."));
        return;
      }
      const r = await haal<GsRegel[]>(`/analyse/grondstoffen${qs({ partij: t })}`);
      if (!actueel() || mijn !== laatste) return;
      const teVeel = afgekapt(r.length, 1000, "gevonden regels", "Zoek op een langer stuk van het partijnummer.");
      const lots = [...new Set(r.map((x) => x.lotnummer).filter(Boolean))] as string[];
      const batches = [...new Set(r.map((x) => x.batchnummer).filter(Boolean))] as string[];
      uitkomst.replaceChildren(
        r.length
          ? h("div", {},
              teVeel,
              h("div", { class: "tegels" },
                h("div", { class: "tegel kwaliteit-cijfer" }, h("span", { class: "tegel-getal" }, batches.length), h("span", { class: "tegel-tekst" }, batches.length === 1 ? "batch" : "batches")),
                h("div", { class: "tegel kwaliteit-cijfer" }, h("span", { class: "tegel-getal" }, lots.length), h("span", { class: "tegel-tekst" }, lots.length === 1 ? "lot" : "lots")),
                h("div", { class: "tegel kwaliteit-cijfer" }, h("span", { class: "tegel-getal" }, new Set(r.map((x) => x.partij)).size), h("span", { class: "tegel-tekst" }, "partijen gevonden"))),
              lots.length ? h("p", { class: "sub", style: "margin-top:12px" }, "Lots: ", lots.flatMap((l, i) => [i ? ", " : "", h("a", { href: `#/kwaliteit/lotpaspoort/${l}` }, l)])) : null,
              tabel(["Partij", "Grondstof", "Batch", "Stap", "Lot", "Ingevoerd", "Hoeveelheid"], r.map((x) => [
                h("span", { class: "sterk" }, x.partij, x.gecorrigeerd ? h("span", { class: "noot" }, " (gecorrigeerd)") : null), `${x.grondstof} ${x.grondstofnaam}`,
                x.batchnummer ? h("a", { href: `#/kwaliteit/batch/${x.batchnummer}` }, x.batchnummer) : "", x.stap,
                x.lotnummer ? h("a", { href: `#/kwaliteit/lotpaspoort/${x.lotnummer}` }, x.lotnummer) : h("span", { class: "sub" }, "nog geen lot"),
                datum(x.ingevoerd_op), x.hoeveelheid !== null ? `${toonGetal(x.hoeveelheid)}${x.eenheid ? ` ${x.eenheid}` : ""}` : ""]), "compact"))
          : h("p", { class: "leeg" }, `Geen batches met een partijnummer dat "${t}" bevat.`));
    } catch (e) { uitkomst.replaceChildren(h("p", { class: "leeg" }, (e as Error).message)); }
  };
  let timer: number | undefined;
  zoek.addEventListener("input", () => { clearTimeout(timer); timer = window.setTimeout(laad, 250); });
  toon(
    kop("Grondstoffen terugzoeken", "Zoek op het partijnummer van een leverancier: in welke batches en lots zit die partij? Andersom staan de grondstoffen in elk lotpaspoort."),
    h("div", { class: "filters" }, h("label", { for: "zoek-partij", class: "filter breed" }, "Partijnummer", zoek)),
    uitkomst,
  );
  await laad();
  zoek.focus();
}

// ---------- Regelkaarten ----------
interface RkOverzicht { veld: string; naam: string; stap: string; soort: string; eenheid: string | null; n: number; voorlopig: boolean; signalen: number; laatste_signaal: string | null; cpk: number | null; grenzen_per_product?: boolean }
interface RkDetail {
  veld: { code: string; naam: string; stap: string; soort: string; eenheid: string | null; grens_min: number | null; grens_max: number | null; decimalen: number | null; grenzen_per_product?: boolean };
  getekend: "gemeten" | "afwijking_van_setting";
  punten: RkPunt[]; gemiddelde: number | null; sigma: number | null; bovengrens: number | null; ondergrens: number | null;
  mr_gemiddeld: number | null; mr_bovengrens: number | null; cpk: number | null; voorlopig: boolean; min_metingen: number; regels: Record<string, string>;
}
function cpkLabel(c: number | null) {
  if (c === null) return h("span", { class: "sub" }, "–");
  const klasse = c >= 1.33 ? "label-ok" : c >= 1 ? "label-tol" : "label-grens";
  const tekst = c >= 1.33 ? "ruim" : c >= 1 ? "krap" : "te krap";
  return h("span", { class: `label ${klasse}` }, `${toonGetal(c)} ${tekst}`);
}

/** Uitleg bij de regelkaarten, op het scherm zelf (#57). De regels zelf staan in de API (REGELS); dit is de uitleg erbij. */
function regelkaartUitleg(): Node {
  return h("details", { class: "meer uitleg" },
    h("summary", {}, "Wat is een meting, een regelgrens en een signaal?"),
    h("dl", { class: "uitleg-lijst" },
      h("dt", {}, "Meting"),
      h("dd", {}, "Eén ingevulde waarde van een veld bij één batch of lot. Elk punt op de kaart is één meting, in de volgorde waarin ze zijn ingevoerd. Bij een procesparameter is het punt het verschil tussen gemeten en instelling, omdat de instelling per batch anders kan zijn."),
      h("dt", {}, "Specificatiegrens"),
      h("dd", {}, "Wat het product mag: de onder- en bovengrens van het veld (of van het product). Een meting daarbuiten is een afwijking: \"Buiten grens\". Op de kaart een rode stippellijn."),
      h("dt", {}, "Regelgrens"),
      h("dd", {}, "Wat het proces normaal doet: het gemiddelde plus en min 3 keer de spreiding (sigma), berekend uit de metingen zelf. Dit zegt niets over goed of fout, alleen over gewoon of ongewoon."),
      h("dt", {}, "Signaal"),
      h("dd", {}, "Een patroon dat bij een stabiel proces bijna nooit toevallig voorkomt. Het wijst op een verandering: een andere grondstof, slijtage, een andere instelling. Een signaal is geen afwijking; het kan ruim binnen de specificatie vallen. Het is een reden om te kijken, vóórdat er afwijkingen komen.")),
    h("p", {}, h("strong", {}, "De vier regels")),
    h("ol", { class: "uitleg-regels" },
      h("li", {}, h("strong", {}, "Eén punt buiten de regelgrens. "), "Er was iets ongewoons bij die ene batch of dat lot."),
      h("li", {}, h("strong", {}, "2 van 3 punten ver aan dezelfde kant "), "(buiten 2 sigma). Een plotselinge verschuiving."),
      h("li", {}, h("strong", {}, "4 van 5 punten aan dezelfde kant buiten 1 sigma. "), "Een kleinere, maar blijvende verschuiving."),
      h("li", {}, h("strong", {}, "8 punten op rij aan dezelfde kant van het gemiddelde. "), "Het proces is langzaam weggelopen, ook al is elke meting op zich normaal.")),
    h("p", { class: "sub" }, "Onder 20 metingen zijn de regelgrenzen nog onzeker: dan is de kaart voorlopig."));
}

export async function regelkaarten(veld?: string) {
  if (veld) return regelkaartDetail(veld);
  const actueel = vastHouden();
  toon(kop("Regelkaarten"), laden());
  let o: RkOverzicht[];
  try { o = await haal<RkOverzicht[]>(`/analyse/regelkaarten${qs(periode.bereik())}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const met = o.filter((x) => x.signalen > 0);
  toon(
    kop("Regelkaarten", "Een regelkaart laat zien of een proces verandert, ook als de waarden nog binnen de grenzen vallen. Een signaal is een reden om te kijken, nog vóórdat er een afwijking is.", periodeKeuze(() => regelkaarten())),
    h("div", { class: "tegels" },
      h("div", { class: `tegel kwaliteit-cijfer${met.length ? " let-op" : ""}` }, h("span", { class: "tegel-getal" }, met.length), h("span", { class: "tegel-tekst" }, met.length === 1 ? "veld met signalen" : "velden met signalen")),
      h("div", { class: "tegel kwaliteit-cijfer" }, h("span", { class: "tegel-getal" }, o.filter((x) => x.cpk !== null && x.cpk < 1).length), h("span", { class: "tegel-tekst" }, "velden met Cpk onder 1 (te krap)"))),
    tabel(["Veld", "Stap", "Metingen", "Signalen", "Laatste signaal", "Procesvermogen (Cpk)"], o.map((x) => [
      h("a", { class: "sterk", href: `#/kwaliteit/regelkaarten/${x.veld}` }, `${x.veld} ${x.naam}`), x.stap,
      h("span", { class: "getal" }, x.n), h("span", { class: x.signalen ? "getal let-op" : "getal" }, x.signalen),
      x.laatste_signaal ? kort(x.laatste_signaal) : "",
      x.voorlopig && x.n >= 2 && x.soort !== "procesparameter" ? h("span", { class: "sub" }, "nog te weinig metingen")
        : x.grenzen_per_product && !gekozenProduct.code && x.soort !== "procesparameter" ? h("span", { class: "sub" }, "grenzen per product: kies een product")
        : cpkLabel(x.cpk)]), "compact"),
    h("p", { class: "sub" }, "Cpk: hoe ver het gemiddelde van de dichtstbijzijnde specificatiegrens ligt, gedeeld door 3 keer de spreiding. Vanaf 1,33 is er ruim marge. Bij een procesparameter staat geen Cpk: daar tekent de kaart het verschil met de setting. Onder 20 metingen is een regelkaart voorlopig en staat er geen Cpk."),
    regelkaartUitleg(),
  );
}

async function regelkaartDetail(code: string) {
  const actueel = vastHouden();
  toon(kop("Regelkaart"), laden());
  let r: RkDetail;
  try { r = await haal<RkDetail>(`/analyse/regelkaart${qs({ ...periode.bereik(), veld: code })}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const v = r.veld;
  const e = v.eenheid ? ` ${v.eenheid}` : "";
  const signalen = r.punten.filter((p) => p.signaal);
  // Gemiddelde en spreiding met één decimaal meer dan het veld (gangbaar bij regelkaarten).
  const statD = v.decimalen === null || v.decimalen === undefined ? null : v.decimalen + 1;
  toon(
    h("p", { class: "terug" }, h("a", { href: "#/kwaliteit/regelkaarten" }, "Alle regelkaarten")),
    kop(`Regelkaart ${v.code} ${v.naam}`,
      r.getekend === "afwijking_van_setting" ? `${v.stap}. Getekend: gemeten min instelling (de instelling kan per batch anders zijn).` : `${v.stap}. Getekend: de gemeten waarde, met de specificatie erbij.`,
      periodeKeuze(() => regelkaartDetail(code))),
    r.punten.length < 2
      ? h("p", { class: "leeg" }, "Te weinig metingen in deze periode voor een regelkaart.")
      : h("div", {},
          h("div", { class: "tegels" },
            h("div", { class: "tegel kwaliteit-cijfer" }, h("span", { class: "tegel-getal" }, r.punten.length), h("span", { class: "tegel-tekst" }, "metingen")),
            h("div", { class: "tegel kwaliteit-cijfer" }, h("span", { class: "tegel-getal" }, toonGetal(r.gemiddelde!, statD)), h("span", { class: "tegel-tekst" }, `gemiddelde${e}`)),
            h("div", { class: "tegel kwaliteit-cijfer" }, h("span", { class: "tegel-getal" }, toonGetal(r.sigma ?? 0, statD)), h("span", { class: "tegel-tekst" }, `spreiding (sigma)${e}`)),
            h("div", { class: `tegel kwaliteit-cijfer${signalen.length ? " let-op" : ""}` }, h("span", { class: "tegel-getal" }, signalen.length), h("span", { class: "tegel-tekst" }, "signalen")),
            r.cpk !== null ? h("div", { class: "tegel kwaliteit-cijfer" }, h("span", { class: "tegel-getal" }, toonGetal(r.cpk)), h("span", { class: "tegel-tekst" }, "Cpk")) : null),
          r.voorlopig
            ? h("p", { class: "blok let-op-blok voorlopig" }, `Voorlopig: nog maar ${r.punten.length} metingen in deze periode. Vanaf ${r.min_metingen} zijn de grenzen betrouwbaar; tot die tijd zijn signalen een eerste indruk en staat er geen Cpk. Kies eventueel een langere periode.`)
            : null,
          h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, "Metingen"),
            regelkaartGrafiek(r.punten, r, e, r.getekend === "gemeten" && !(v.grenzen_per_product && !gekozenProduct.code) ? { min: v.grens_min, max: v.grens_max } : undefined, `Regelkaart ${v.code}`),
            v.grenzen_per_product && !gekozenProduct.code && r.getekend === "gemeten"
              ? h("p", { class: "sub" }, "Dit veld heeft eigen grenzen per product: kies bovenin een product voor de specificatie en de Cpk.")
              : null),
          signalen.length
            ? h("section", { class: "blok kwaliteit-kaart" }, h("h2", {}, "Signalen"),
                tabel(["Wanneer", "Batch of lot", "Waarde", "Regel"], signalen.slice(-50).reverse().map((p) => [
                  kort(p.tijd), p.nummer, `${toonGetal(p.waarde, v.decimalen)}${e}`, `${p.signaal}: ${r.regels[String(p.signaal)]}`]), "compact"))
            : h("p", { class: r.voorlopig ? "leeg" : "leeg goed" }, r.voorlopig ? "Geen signalen in deze metingen; met zo weinig metingen zegt dat nog niet veel." : "Geen signalen: het proces is stabiel in deze periode."),
          regelkaartUitleg()),
  );
}
