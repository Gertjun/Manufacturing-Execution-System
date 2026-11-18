// Portaal Productie: werkvoorraad per stap, doorlooptijden, productie per week
// en correcties. Een batch in beoordeling zetten gaat via de batchpagina.
import { h, laden, toon, vastHouden } from "../../../gedeeld/ui";
import { toonGetal } from "../../../gedeeld/markering";
import { haal, periode, PERIODES, qs } from "../basis";
import { liggendeStaven, staven } from "../grafiek";
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
  try { d = await haal<Doorloop>(`/analyse/doorlooptijden${qs(periode.bereik())}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const langste = [...d.stappen].sort((a, b) => (b.wachten_mediaan ?? 0) + b.bewerking_mediaan - ((a.wachten_mediaan ?? 0) + a.bewerking_mediaan))[0];
  const meestWachten = [...d.stappen].sort((a, b) => (b.wachten_mediaan ?? 0) - (a.wachten_mediaan ?? 0))[0];
  const laatste = [...d.per_week].reverse().find((w) => w.batch_uren_mediaan !== null);
  toon(
    kop("Doorlooptijden", `Medianen over ${PERIODES.find((p) => p.id === periode.id)!.naam.toLowerCase()}: de helft van de stappen was sneller, de helft trager.`, periodeKeuze(doorlooptijden)),
    d.stappen.length === 0
      ? h("p", { class: "leeg" }, "Geen afgeronde stappen in deze periode.")
      : h("div", {}, ...[
          h("div", { class: "tegels" },
            laatste ? h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, uren(laatste.batch_uren_mediaan)), h("span", { class: "tegel-tekst" }, "doorlooptijd batch, stap 1 tot 15 (laatste week)")) : null,
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
          h("section", { class: "blok" }, h("h2", {}, "Doorlooptijd per week"),
            tabel(["Week van", "Batches klaar", "Batch: stap 1 tot 15 (mediaan)", "Lots gereed", "Lot: samenstellen tot gereed (mediaan)"],
              [...d.per_week].reverse().map((w) => [new Date(w.week).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }),
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
  try { w = await haal<Week[]>(`/analyse/productie${qs(periode.bereik())}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const som = (k: keyof Week) => w.reduce((a, x) => a + (x[k] as number), 0);
  const weekTekst = (iso: string) => `Week van ${new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}`;
  toon(
    kop("Productie per week", undefined, periodeKeuze(perWeek)),
    h("div", { class: "tegels" },
      ...([["batches_gestart", "batches gestart"], ["batches_klaar", "batches klaar voor een lot"], ["lots_gereed", "lots gereed"], ["afgekeurd", "batches afgekeurd"]] as [keyof Week, string][])
        .map(([k, t]) => h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, som(k)), h("span", { class: "tegel-tekst" }, t)))),
    h("section", { class: "blok" }, h("h2", {}, "Lots gereed per week"),
      w.length ? staven(w.map((x) => ({ week: x.week, waarde: x.lots_gereed, tip: [weekTekst(x.week), `${x.lots_gereed} lots gereed`, `${x.batches_gestart} batches gestart`] })), "Lots gereed per week")
        : h("p", { class: "leeg" }, "Geen productie in deze periode.")),
    h("section", { class: "blok" }, h("h2", {}, "Per week in cijfers"),
      tabel(["Week van", "Batches gestart", "Batches klaar", "Lots gereed", "Afgekeurd"], [...w].reverse().map((x) => [
        new Date(x.week).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }),
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
