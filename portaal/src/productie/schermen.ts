// Portaal Productie: werkvoorraad per stap, doorlooptijden, productie per week
// en correcties. Een batch in beoordeling zetten gaat via de batchpagina.
import { h, laden, toon, vastHouden } from "../../../gedeeld/ui";
import { toonGetal } from "../../../gedeeld/markering";
import { haal, periode, PERIODES, qs } from "../basis";
import { liggendeStaven, staven } from "../grafiek";
import { aanvullen, perCel, perKop, perTekst, perWoord, resolutie } from "../resolutie";
import { datum, fout, kop, kort, label, periodeKeuze, tabel } from "../kwaliteit/schermen";
import type { Markering } from "../../../gedeeld/types";

/** Minuten leesbaar: "35 min", "2 u 10". */
export function minuten(n: number | null): string {
  if (n === null) return "–";
  if (n < 60) return `${Math.round(n)} min`;
  const u = Math.floor(n / 60), m = Math.round(n % 60);
  return m ? `${u} u ${m}` : `${u} u`;
}
/** Uren leesbaar: onder 48 uur in uren, daarboven in dagen. */
function uren(n: number | null): string {
  if (n === null) return "–";
  return n < 48 ? `${toonGetal(Math.round(n * 10) / 10)} u` : `${toonGetal(Math.round((n / 24) * 10) / 10)} dagen`;
}
/** Hoe lang geleden: "45 min", "3 u", "2 dagen". */
function leeftijd(iso: string | null): string {
  if (!iso) return "";
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} u`;
  return `${Math.round(min / 1440)} dagen`;
}

// ---------- Werkvoorraad ----------
interface StapWerk { stapcode: string; stapnaam: string; niveau: string; open: number; wachtend: number; oudste_open: string | null; oudste_wachtend: string | null }

export async function werkvoorraad() {
  const actueel = vastHouden();
  toon(kop("Productie"), laden());
  let stappen: StapWerk[], beoordeling: unknown[];
  try {
    [stappen, beoordeling] = await Promise.all([haal<StapWerk[]>("/werkvoorraad"), haal<unknown[]>("/analyse/te-beoordelen")]);
  } catch (e) { return fout(e); }
  if (!actueel()) return;
  const open = stappen.reduce((a, s) => a + s.open, 0);
  const wachtend = stappen.reduce((a, s) => a + s.wachtend, 0);
  // Knelpunt: de stap waar het meeste werk ligt te wachten.
  const meest = stappen.reduce((a, s) => (s.wachtend > a.wachtend ? s : a), stappen[0]);
  const tegel = (s: StapWerk) =>
    h("a", { class: `staptegel${s === meest && s.wachtend > 1 ? " knelpunt" : ""}${s.open + s.wachtend === 0 ? " leeg-stap" : ""}`, href: `#/productie/stap/${s.stapcode}` },
      h("span", { class: "nr" }, s.stapcode.replace("PS", "")),
      h("span", { class: "naam" }, s.stapnaam),
      h("span", { class: "werk" }, s.open || s.wachtend ? `${s.open} bezig, ${s.wachtend} klaar` : "Niets bezig of klaar"),
      s.oudste_wachtend ? h("span", { class: "werk" }, `Wacht al ${leeftijd(s.oudste_wachtend)}`) : null);
  const kpi = (n: number, tekst: string, link?: string) =>
    h(link ? "a" : "div", { class: "tegel", href: link }, h("span", { class: "tegel-getal" }, n), h("span", { class: "tegel-tekst" }, tekst));
  toon(
    kop("Productie", "Wat er nu in de fabriek bezig is en wat klaarstaat voor de volgende stap."),
    h("div", { class: "tegels" },
      kpi(open, open === 1 ? "stap bezig" : "stappen bezig"),
      kpi(wachtend, "klaar voor de volgende stap"),
      kpi(beoordeling.length, beoordeling.length === 1 ? "batch in beoordeling" : "batches in beoordeling", "#/kwaliteit/beoordelen")),
    meest && meest.wachtend > 1
      ? h("p", { class: "sub", style: "margin-top:16px" }, `Meeste werk ligt klaar voor ${meest.stapnaam} (${meest.wachtend}). Die stap is gemarkeerd.`)
      : null,
    h("h2", { class: "tussenkop" }, "Per batch"),
    h("div", { class: "stappen-raster" }, stappen.filter((s) => s.niveau === "batch").map(tegel)),
    h("h2", { class: "tussenkop" }, "Per lot"),
    h("div", { class: "stappen-raster lot" }, stappen.filter((s) => s.niveau === "lot").map(tegel)),
  );
}

interface Reg { id: string; batchnummer: string | null; lotnummer: string | null; poging: number; operator: string; pc: string; gestart_op: string; herbewerking_start: boolean; reden: string | null }

export async function stap(code: string) {
  const actueel = vastHouden();
  toon(kop(code), laden());
  let w: { open: Reg[]; wachtend: { soort: string; nummer: string; sinds: string | null }[] }, alle: StapWerk[];
  try { [w, alle] = await Promise.all([haal<typeof w>(`/werkvoorraad/${code}`), haal<StapWerk[]>("/werkvoorraad")]); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const s = alle.find((x) => x.stapcode === code);
  const link = (nummer: string) => h("a", { class: "sterk", href: nummer.startsWith("L-") ? `#/productie/lot/${nummer}` : `#/productie/batch/${nummer}` }, nummer);
  toon(
    h("p", { class: "terug" }, h("a", { href: "#/productie/overzicht" }, "Alle stappen")),
    kop(s?.stapnaam ?? code, s?.niveau === "lot" ? "Per lot" : "Per batch"),
    h("section", { class: "blok" }, h("h2", {}, `Bezig (${w.open.length})`),
      w.open.length
        ? tabel(["Batch of lot", "Gestart", "Loopt al", "Operator", "Pc", "Opmerking"], w.open.map((r) => [
            link(r.batchnummer ?? r.lotnummer ?? ""), kort(r.gestart_op), leeftijd(r.gestart_op), r.operator, r.pc,
            r.herbewerking_start ? `Herbewerking: ${r.reden}` : r.poging > 1 ? `Poging ${r.poging}` : ""]))
        : h("p", { class: "leeg" }, "Er staat niets open in deze stap.")),
    h("section", { class: "blok" }, h("h2", {}, `Klaar om te starten (${w.wachtend.length})`),
      w.wachtend.length
        ? tabel(["Batch of lot", "Klaar sinds", "Wacht al"], w.wachtend.map((x) => [link(x.nummer), kort(x.sinds), leeftijd(x.sinds)]))
        : h("p", { class: "leeg" }, "Niets klaar voor deze stap.")),
  );
}

// ---------- Doorlooptijden ----------
interface Doorloop {
  stappen: { stap: string; stapnaam: string; niveau: string; aantal: number; bewerking_mediaan: number; bewerking_p90: number; wachten_mediaan: number | null; wachten_p90: number | null }[];
  per_week: { week: string; batches: number; batch_uren_mediaan: number | null; lots: number; lot_uren_mediaan: number | null }[];
}

export async function doorlooptijden() {
  const actueel = vastHouden();
  toon(kop("Doorlooptijden"), laden());
  let d: Doorloop;
  const per = resolutie.per;
  try { d = await haal<Doorloop>(`/analyse/doorlooptijden${qs({ ...periode.bereik(), per })}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const langste = [...d.stappen].sort((a, b) => (b.wachten_mediaan ?? 0) + b.bewerking_mediaan - ((a.wachten_mediaan ?? 0) + a.bewerking_mediaan))[0];
  const meestWachten = [...d.stappen].sort((a, b) => (b.wachten_mediaan ?? 0) - (a.wachten_mediaan ?? 0))[0];
  const laatste = [...d.per_week].reverse().find((w) => w.batch_uren_mediaan !== null);
  toon(
    kop("Doorlooptijden", `Medianen over ${PERIODES.find((p) => p.id === periode.id)!.naam.toLowerCase()}: de helft van de stappen was sneller, de helft trager.`, periodeKeuze(doorlooptijden, true, true)),
    d.stappen.length === 0
      ? h("p", { class: "leeg" }, "Geen afgeronde stappen in deze periode.")
      : h("div", {}, ...[
          h("div", { class: "tegels" },
            laatste ? h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, uren(laatste.batch_uren_mediaan)), h("span", { class: "tegel-tekst" }, `doorlooptijd batch, eerste tot laatste batchstap (laatste ${per})`)) : null,
            langste ? h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, langste.stap), h("span", { class: "tegel-tekst" }, `langste stap: ${minuten((langste.wachten_mediaan ?? 0) + langste.bewerking_mediaan)} inclusief wachten`)) : null,
            meestWachten?.wachten_mediaan ? h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, meestWachten.stap), h("span", { class: "tegel-tekst" }, `langste wachttijd ervoor: ${minuten(meestWachten.wachten_mediaan)}`)) : null),
          h("section", { class: "blok" }, h("h2", {}, "Tijd per stap"),
            h("p", { class: "sub" }, "Grijs is de wachttijd sinds de vorige stap, blauw de bewerking zelf."),
            liggendeStaven(
              d.stappen.map((s) => ({
                label: `${s.stap} ${s.stapnaam.replace("Process Step ", "").length < 4 ? "" : s.stapnaam}`.trim(),
                delen: [
                  { naam: "Wachten", waarde: s.wachten_mediaan ?? 0, klasse: "deel-wachten" },
                  { naam: "Bewerking", waarde: s.bewerking_mediaan, klasse: "deel-bewerking" },
                ],
                tip: [`Wachten: ${minuten(s.wachten_mediaan)} (90% binnen ${minuten(s.wachten_p90)})`, `Bewerking: ${minuten(s.bewerking_mediaan)} (90% binnen ${minuten(s.bewerking_p90)})`, `${s.aantal} keer uitgevoerd`],
              })),
              (n) => minuten(n),
              [{ naam: "Wachten", klasse: "deel-wachten" }, { naam: "Bewerking", klasse: "deel-bewerking" }],
              [15, 30, 60, 120, 240, 480, 960])),
          h("section", { class: "blok" }, h("h2", {}, "Per stap in cijfers"),
            tabel(["Stap", "Uitgevoerd", "Wachten (mediaan)", "Wachten (90%)", "Bewerking (mediaan)", "Bewerking (90%)"], d.stappen.map((s) => [
              h("a", { href: `#/productie/stap/${s.stap}`, class: "sterk" }, `${s.stap} ${s.stapnaam}`), h("span", { class: "getal" }, s.aantal),
              h("span", { class: "getal" }, minuten(s.wachten_mediaan)), h("span", { class: "getal" }, minuten(s.wachten_p90)),
              h("span", { class: "getal" }, minuten(s.bewerking_mediaan)), h("span", { class: "getal" }, minuten(s.bewerking_p90))]), "compact")),
          h("section", { class: "blok" }, h("h2", {}, `Doorlooptijd ${perWoord(per)}`),
            tabel([perKop(per), "Batches klaar", "Batch: eerste tot laatste batchstap (mediaan)", "Lots gereed", "Lot: samenstellen tot gereed (mediaan)"],
              [...d.per_week].reverse().map((w) => [perCel(w.week, per),
                h("span", { class: "getal" }, w.batches), h("span", { class: "getal" }, uren(w.batch_uren_mediaan)),
                h("span", { class: "getal" }, w.lots), h("span", { class: "getal" }, uren(w.lot_uren_mediaan))]), "compact")),
        ]),
  );
}

// ---------- Productie per week ----------
interface Week { week: string; batches_gestart: number; batches_klaar: number; lots_gereed: number; afgekeurd: number }

export async function perWeek() {
  const actueel = vastHouden();
  toon(kop("Productie per week"), laden());
  let w: Week[];
  const per = resolutie.per;
  try { w = await haal<Week[]>(`/analyse/productie${qs({ ...periode.bereik(), per })}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  w = aanvullen(w, per, periode.bereik().van, (week) => ({ week, batches_gestart: 0, batches_klaar: 0, lots_gereed: 0, afgekeurd: 0 }));
  const som = (k: keyof Week) => w.reduce((a, x) => a + (x[k] as number), 0);
  const weekTekst = (iso: string) => perTekst(iso, per);
  toon(
    kop(`Productie ${perWoord(per)}`, undefined, periodeKeuze(perWeek, true, true)),
    h("div", { class: "tegels" },
      ...([["batches_gestart", "batches gestart"], ["batches_klaar", "batches klaar voor een lot"], ["lots_gereed", "lots gereed"], ["afgekeurd", "batches afgekeurd"]] as [keyof Week, string][])
        .map(([k, t]) => h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, som(k)), h("span", { class: "tegel-tekst" }, t)))),
    h("section", { class: "blok" }, h("h2", {}, `Lots gereed ${perWoord(per)}`),
      w.length ? staven(w.map((x) => ({ week: x.week, waarde: x.lots_gereed, tip: [weekTekst(x.week), `${x.lots_gereed} lots gereed`, `${x.batches_gestart} batches gestart`] })), `Lots gereed ${perWoord(per)}`, per)
        : h("p", { class: "leeg" }, "Geen productie in deze periode.")),
    h("section", { class: "blok" }, h("h2", {}, `Batches gestart ${perWoord(per)}`),
      w.length ? staven(w.map((x) => ({ week: x.week, waarde: x.batches_gestart, tip: [weekTekst(x.week), `${x.batches_gestart} batches gestart`, `${x.batches_klaar} batches klaar voor een lot`] })), `Batches gestart ${perWoord(per)}`, per)
        : h("p", { class: "leeg" }, "Geen productie in deze periode.")),
    h("section", { class: "blok" }, h("h2", {}, `${perWoord(per).replace("p", "P")} in cijfers`),
      tabel([perKop(per), "Batches gestart", "Batches klaar", "Lots gereed", "Afgekeurd"], [...w].reverse().map((x) => [
        perCel(x.week, per),
        h("span", { class: "getal" }, x.batches_gestart), h("span", { class: "getal" }, x.batches_klaar),
        h("span", { class: "getal" }, x.lots_gereed), h("span", { class: x.afgekeurd ? "getal let-op" : "getal" }, x.afgekeurd)]), "compact")),
  );
}

// ---------- Correcties ----------
interface Correctie {
  gecorrigeerd_op: string; batch_of_lot: string; stap: string; poging: number; veld: string; veldnaam: string; eenheid: string | null;
  oud_setting: number | null; oud_gemeten: number; oud_markering: Markering; nieuw_setting: number | null; nieuw_gemeten: number; nieuw_markering: Markering;
  reden: string; door: string; ingevoerd_door: string | null;
}

export async function correcties() {
  const actueel = vastHouden();
  toon(kop("Correcties"), laden());
  let c: Correctie[];
  try { c = await haal<Correctie[]>(`/analyse/correcties${qs(periode.bereik())}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const waarde = (s: number | null, g: number, e: string | null) => `${s !== null ? `${toonGetal(s)} / ` : ""}${toonGetal(g)}${e ? ` ${e}` : ""}`;
  toon(
    kop("Correcties", "Waarden die een ploegleider achteraf heeft gecorrigeerd. Het origineel blijft altijd bewaard.", periodeKeuze(correcties)),
    c.length
      ? tabel(["Gecorrigeerd", "Batch of lot", "Stap", "Veld", "Was", "Wordt", "Reden", "Door", "Ingevoerd door"], c.map((r) => [
          datum(r.gecorrigeerd_op),
          h("a", { href: r.batch_of_lot.startsWith("L-") ? `#/productie/lot/${r.batch_of_lot}` : `#/productie/batch/${r.batch_of_lot}`, class: "sterk" }, r.batch_of_lot),
          `${r.stap}${r.poging > 1 ? ` (${r.poging})` : ""}`, `${r.veld} ${r.veldnaam}`,
          h("span", {}, h("span", { class: "getal-inline" }, waarde(r.oud_setting, r.oud_gemeten, r.eenheid)), " ", label(r.oud_markering)),
          h("span", {}, h("span", { class: "getal-inline" }, waarde(r.nieuw_setting, r.nieuw_gemeten, r.eenheid)), " ", label(r.nieuw_markering)),
          r.reden, r.door, r.ingevoerd_door ?? ""]), "compact")
      : h("p", { class: "leeg" }, "Geen correcties in deze periode."),
  );
}

// ---------- Ploegoverdracht ----------
interface Notitie { id: string; hal: string | null; bijzonderheden: string | null; aandachtspunten: string | null; door: string; pc: string | null; geschreven_op: string }
interface PloegSamenvatting {
  ploeg: string; ploegnaam: string; dag: string; begin_op: string; eind_op: string; loopt_nog: boolean;
  cijfers: { stappen_afgerond: number; batches_gestart: number; lots_gemaakt: number; afwijkingen: number; correcties: number; in_beoordeling_gezet: number };
  per_stap: { stap: string; stapnaam: string; afgerond: number }[];
  nog_open: { stap: string; nummer: string; sinds: string; operator: string }[];
  notities: Notitie[];
}
const isoDag = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plusDag = (dag: string, n: number) => { const d = new Date(`${dag}T12:00:00`); d.setDate(d.getDate() + n); return isoDag(d); };
const uur = (iso: string) => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

export async function overdracht(dag?: string) {
  const actueel = vastHouden();
  const d = dag && /^\d{4}-\d{2}-\d{2}$/.test(dag) ? dag : isoDag();
  toon(kop("Ploegoverdracht"), laden());
  let p: PloegSamenvatting[];
  let plan: { gepland: number; afgerond: number; bezig: number };
  try {
    [p, plan] = await Promise.all([
      haal<PloegSamenvatting[]>(`/overdracht/dag?dag=${d}`),
      haal<{ gepland: number; afgerond: number; bezig: number }>(`/overdracht/plan?dag=${d}`),
    ]);
  } catch (e) { return fout(e); }
  if (!actueel()) return;
  const cijfer = (n: number, t: string, klasse = "") => h("div", { class: `ploeg-cijfer ${klasse}` }, h("span", { class: "tegel-getal" }, n), h("span", { class: "tegel-tekst" }, t));
  toon(
    kop(`Ploegoverdracht ${new Date(`${d}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}`,
      "Per ploeg wat er gedaan is, wat open bleef en wat de ploeg heeft overgedragen. Operators schrijven de overdracht in het invoerscherm.",
      h("div", { class: "knoppen-klein" },
        h("a", { class: "knop knop-stil", href: `#/productie/overdracht/${plusDag(d, -1)}` }, "Vorige dag"),
        h("a", { class: "knop knop-stil", href: "#/productie/overdracht" }, "Vandaag"),
        d < isoDag() ? h("a", { class: "knop knop-stil", href: `#/productie/overdracht/${plusDag(d, 1)}` }, "Volgende dag") : null)),
    // #62: hoeveel van de planning van deze dag klaar is (de planning is per dag, niet per ploeg).
    h("section", { class: "blok plan-stand" },
      plan.gepland
        ? [
            h("p", { class: "plan-getal" }, h("strong", {}, `${plan.afgerond} / ${plan.gepland}`), " geplande stappen afgerond",
              plan.bezig ? `, ${plan.bezig} bezig` : ""),
            h("div", { class: "bezetbalk", "aria-hidden": "true" },
              h("span", { style: `width:${Math.round((100 * plan.afgerond) / plan.gepland)}%` })),
            h("p", { class: "sub" }, "Alle ploegen samen. Een geplande stap die op een andere dag is afgerond, telt ook mee."),
          ]
        : h("p", { class: "leeg" }, "Voor deze dag is niets gepland.")),
    p.length
      ? h("div", { class: "ploegen" }, p.map((x) =>
          h("section", { class: `blok ploeg${x.loopt_nog ? " ploeg-nu" : ""}` },
            h("div", { class: "kop" }, h("div", {}, h("h2", { style: "margin:0" }, x.ploegnaam), h("p", { class: "sub" }, `${uur(x.begin_op)}–${uur(x.eind_op)}${x.loopt_nog ? ", loopt nog" : ""}`))),
            h("div", { class: "ploeg-cijfers" },
              cijfer(x.cijfers.stappen_afgerond, "stappen afgerond"), cijfer(x.cijfers.batches_gestart, "batches gestart"),
              cijfer(x.cijfers.lots_gemaakt, "lots samengesteld"), cijfer(x.cijfers.afwijkingen, "afwijkingen", x.cijfers.afwijkingen ? "let-op" : "")),
            x.notities.length
              ? h("ul", { class: "notities" }, x.notities.map((n) => h("li", {},
                  n.aandachtspunten ? h("p", {}, h("strong", {}, "Aandachtspunten: "), n.aandachtspunten) : null,
                  n.bijzonderheden ? h("p", {}, n.bijzonderheden) : null,
                  h("p", { class: "sub" }, `${n.door}${n.pc ? ` op ${n.pc}` : ""}${n.hal ? `, ${n.hal}` : ""}, ${kort(n.geschreven_op)}`))))
              : h("p", { class: "leeg" }, x.loopt_nog ? "Nog geen overdracht geschreven." : "Deze ploeg heeft geen overdracht geschreven."),
            x.nog_open.length
              ? h("details", { class: "meer" }, h("summary", {}, `${x.nog_open.length} ${x.nog_open.length === 1 ? "stap" : "stappen"} open aan het eind`),
                  tabel(["Stap", "Batch of lot", "Sinds", "Operator"], x.nog_open.map((o) => [o.stap, o.nummer, kort(o.sinds), o.operator]), "compact"))
              : null)))
      : h("p", { class: "leeg" }, "Op deze dag is nog geen ploeg begonnen."),
  );
}

// ---------- Stilstand ----------
interface StilstandRegel { id: string; stap: string; stapnaam: string; oorzaak: string; oorzaaknaam: string; categorie: string; toelichting: string | null; begin_op: string; eind_op: string | null; minuten: number; pc: string | null; operator: string | null; hal: string | null }
interface StilstandAnalyse {
  van: string; tot: string; ploeguren_per_dag: number; kwaliteit: number | null;
  per_stap: { stap: string; stapnaam: string; aantal: number; storing: number; wachten: number; gepland: number; overig: number; beschikbaarheid: number | null }[];
  per_oorzaak: { oorzaak: string; oorzaaknaam: string; categorie: string; aantal: number; minuten: number }[];
  lijst: StilstandRegel[];
}
const CATEGORIE: Record<string, string> = { storing: "Storing", wachten: "Wachten", gepland: "Gepland", overig: "Overig" };
const procent = (n: number | null) => (n === null ? "–" : `${toonGetal(Math.round(n * 1000) / 10)} %`);

export async function stilstand() {
  const actueel = vastHouden();
  toon(kop("Stilstand"), laden());
  let a: StilstandAnalyse;
  try { a = await haal<StilstandAnalyse>(`/analyse/stilstand${qs(periode.bereik())}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const ongepland = a.per_stap.reduce((t, x) => t + x.storing + x.wachten + x.overig, 0);
  const metB = a.per_stap.filter((x) => x.beschikbaarheid !== null);
  const gemB = metB.length ? metB.reduce((t, x) => t + x.beschikbaarheid!, 0) / metB.length : null;
  const slechtst = [...metB].sort((x, y) => x.beschikbaarheid! - y.beschikbaarheid!)[0];
  const lopend = a.lijst.filter((x) => !x.eind_op);
  toon(
    kop("Stilstand", `Wanneer en waarom er niet gewerkt kon worden, ${PERIODES.find((p) => p.id === periode.id)!.naam.toLowerCase()}. Operators melden stilstand in het invoerscherm.`, periodeKeuze(stilstand, false)),
    lopend.length
      ? h("section", { class: "blok stil-blok" }, h("h2", {}, `Nu stil (${lopend.length})`),
          tabel(["Stap", "Oorzaak", "Sinds", "Duur", "Toelichting", "Gemeld door"], lopend.map((x) => [`${x.stap} ${x.stapnaam}`, x.oorzaaknaam, kort(x.begin_op), minuten(x.minuten), x.toelichting ?? "", x.operator ?? ""]), "compact"))
      : null,
    h("div", { class: "tegels" },
      h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, minuten(ongepland)), h("span", { class: "tegel-tekst" }, "ongeplande stilstand (storing, wachten, overig)")),
      h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, procent(gemB)), h("span", { class: "tegel-tekst" }, "beschikbaarheid, gemiddeld over de stappen")),
      slechtst && slechtst.beschikbaarheid! < 1
        ? h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, slechtst.stap), h("span", { class: "tegel-tekst" }, `laagste beschikbaarheid: ${procent(slechtst.beschikbaarheid)}`))
        : null,
      h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, procent(a.kwaliteit)), h("span", { class: "tegel-tekst" }, "kwaliteit: gestarte batches niet afgekeurd"))),
    h("section", { class: "blok" }, h("h2", {}, "Stilstand per stap"),
      h("p", { class: "sub" }, `Beschikbaarheid = de geplande productietijd (${toonGetal(a.ploeguren_per_dag)} ploeguren per dag, min geplande stilstand) waarin de stap niet stil lag. Samen met kwaliteit het begin van OEE; voor de prestatie zijn nog normtijden per stap nodig.`),
      ongepland + a.per_stap.reduce((t, x) => t + x.gepland, 0) > 0
        ? liggendeStaven(
            a.per_stap.map((x) => ({
              label: x.stap,
              delen: [
                { naam: "Storing", waarde: x.storing, klasse: "deel-storing" },
                { naam: "Wachten", waarde: x.wachten, klasse: "deel-wacht" },
                { naam: "Overig", waarde: x.overig, klasse: "deel-overig" },
                { naam: "Gepland", waarde: x.gepland, klasse: "deel-gepland" },
              ],
              tip: [`${x.stap} ${x.stapnaam}`, `Storing: ${minuten(x.storing)}`, `Wachten: ${minuten(x.wachten)}`, `Overig: ${minuten(x.overig)}`, `Gepland: ${minuten(x.gepland)}`, `Beschikbaarheid: ${procent(x.beschikbaarheid)}`],
            })),
            (n) => minuten(n),
            [{ naam: "Storing (gearceerd)", klasse: "deel-storing" }, { naam: "Wachten", klasse: "deel-wacht" }, { naam: "Overig", klasse: "deel-overig" }, { naam: "Gepland (open)", klasse: "deel-gepland" }],
            [30, 60, 120, 240, 480, 960, 1920, 3840],
            "Stilstand per stap")
        : h("p", { class: "leeg" }, "Geen stilstand in deze periode."),
      tabel(["Stap", "Keer", "Storing", "Wachten", "Overig", "Gepland", "Beschikbaarheid"], a.per_stap.map((x) => [
        `${x.stap} ${x.stapnaam}`, h("span", { class: "getal" }, x.aantal), minuten(x.storing), minuten(x.wachten), minuten(x.overig), minuten(x.gepland),
        h("span", { class: x.beschikbaarheid !== null && x.beschikbaarheid < 0.95 ? "getal let-op" : "getal" }, procent(x.beschikbaarheid))]), "compact")),
    a.per_oorzaak.length
      ? h("section", { class: "blok" }, h("h2", {}, "Per oorzaak"),
          tabel(["Oorzaak", "Soort", "Keer", "Totaal"], a.per_oorzaak.map((x) => [x.oorzaaknaam, CATEGORIE[x.categorie] ?? x.categorie, h("span", { class: "getal" }, x.aantal), minuten(x.minuten)]), "compact"))
      : null,
    a.lijst.length
      ? h("section", { class: "blok" }, h("h2", {}, "Laatste 50 keer stilstand"),
          tabel(["Begin", "Stap", "Oorzaak", "Duur", "Toelichting", "Gemeld door", "Pc"], a.lijst.slice(0, 50).map((x) => [
            kort(x.begin_op), x.stap, x.oorzaaknaam, x.eind_op ? minuten(x.minuten) : h("strong", {}, `loopt (${minuten(x.minuten)})`), x.toelichting ?? "", x.operator ?? "", x.pc ?? ""]), "compact"))
      : null,
  );
}
