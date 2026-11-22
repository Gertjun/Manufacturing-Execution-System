import { h, laden, melding, toon, vraag } from "../../gedeeld/ui";
import { haal, qs, sessie, stuur } from "./basis";
import { fout, kop, kort, tabel } from "./kwaliteit/schermen";

/**
 * Pilotoverzicht (#77, D66): hoe de invoer in de pilot loopt. Beheerder (Beheer) en productiemanager
 * (Productieanalyse); alleen de beheerder past de startdatum en de grens voor "te laat" aan.
 */
interface Regel { dag: string | null; pc: string; gestart: number; afgerond: number; waarden: number; gemiddeld_minuten: number | null;
  langst_minuten: number | null; te_laat: number; nageleverd: number; geweigerd: number; opmerkingen: number }
interface Overzicht {
  van: string; tot: string; pilot_start: string | null; te_laat_minuten: number;
  kerncijfers: { afgerond: number; binnen_tijd: number | null; nageleverd: number; geweigerd: number; opmerkingen: number };
  per_dag_pc: Regel[]; per_pc: Regel[]; per_dag: Regel[];
  per_veld: { veld: string; naam: string; stap: string; verplicht: boolean; keer: number; leeg: number; gecorrigeerd: number }[];
  geweigerd: { op: string; pc: string | null; naam: string | null; stapcode: string | null; batchnummer: string | null; fout: string | null }[];
}

/** Gekozen periode, zolang het portaal open is: leeg = de standaard van de server (sinds de pilotstart of de laatste 7 dagen). */
const keuze: { van?: string; tot?: string } = {};

const getal = (n: number) => h("span", { class: "getal" }, n.toLocaleString("nl-NL"));
const minuten = (m: number | null) => (m === null ? "" : m < 60 ? `${m.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} min` : `${Math.floor(m / 60)} u ${Math.round(m % 60)} min`);
const procent = (x: number) => `${(x * 100).toLocaleString("nl-NL", { maximumFractionDigits: 0 })}%`;
const dagNaam = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });

export async function pilotoverzicht() {
  laden();
  let o: Overzicht;
  try {
    o = await haal<Overzicht>(`/pilot${qs({ van: keuze.van, tot: keuze.tot })}`);
  } catch (e) {
    return fout(e);
  }
  const k = o.kerncijfers;
  const van = h("input", { id: "pilot-van", type: "date", value: o.van, max: o.tot }) as HTMLInputElement;
  const tot = h("input", { id: "pilot-tot", type: "date", value: o.tot }) as HTMLInputElement;
  const kies = () => {
    if (!van.value || !tot.value) return melding("Kies een begin- en einddatum", "fout");
    if (van.value > tot.value) return melding("De begindatum ligt na de einddatum", "fout");
    keuze.van = van.value; keuze.tot = tot.value;
    void pilotoverzicht();
  };
  van.onchange = kies; tot.onchange = kies;
  const standaard = h("button", { class: "knop knop-stil", type: "button", onclick: () => { delete keuze.van; delete keuze.tot; void pilotoverzicht(); } },
    o.pilot_start ? "Sinds de pilotstart" : "Laatste 7 dagen");

  const tegel = (waarde: string | Node, tekst: string, nadruk = false) =>
    h("div", { class: nadruk ? "tegel nadruk" : "tegel" }, h("span", { class: "tegel-getal" }, waarde), h("span", { class: "tegel-tekst" }, tekst));

  toon(
    kop("Pilotoverzicht",
      `Hoe de invoer loopt, van ${dagNaam(o.van)} tot en met ${dagNaam(o.tot)}${o.pilot_start ? ` (pilot gestart ${dagNaam(o.pilot_start)})` : ""}. Voor de wekelijkse controle en de evaluatie na 8 weken.`,
      h("label", { class: "filter", for: "pilot-van" }, "Van", van),
      h("label", { class: "filter", for: "pilot-tot" }, "Tot en met", tot),
      standaard),
    h("div", { class: "tegels" },
      tegel(getal(k.afgerond), k.afgerond === 1 ? "stap afgerond" : "stappen afgerond"),
      tegel(k.binnen_tijd === null ? "–" : procent(k.binnen_tijd), `van de invoer binnen ${o.te_laat_minuten} minuten op de server`, k.binnen_tijd !== null && k.binnen_tijd < 0.9),
      tegel(getal(k.nageleverd), k.nageleverd === 1 ? "stap van papier ingevoerd" : "stappen van papier ingevoerd"),
      tegel(getal(k.geweigerd), k.geweigerd === 1 ? "invoer geweigerd" : "invoeren geweigerd", k.geweigerd > 0),
      tegel(getal(k.opmerkingen), k.opmerkingen === 1 ? "opmerking via Iets melden" : "opmerkingen via Iets melden")),

    blokInvoer("Per dag", "Alle pc's samen.", o.per_dag, o.te_laat_minuten, "dag"),
    blokInvoer("Per pc", "Over de hele periode. Een pc die vaak lang onderweg is, staat op een plek met slechte verbinding of was uit.", o.per_pc, o.te_laat_minuten, "pc"),
    blokInvoer("Bijzonderheden per dag en pc", "Alleen de dagen waarop een pc te laat was, iets werd geweigerd, van papier werd ingevoerd of iets werd gemeld.",
      o.per_dag_pc.filter((r) => r.te_laat || r.geweigerd || r.nageleverd || r.opmerkingen), o.te_laat_minuten, "beide"),
    h("p", { class: "noot" },
      "Onderweg: de tijd tussen het moment van invoer op de pc en het moment dat de server het ontving. Lang onderweg betekent meestal dat de pc offline was; ",
      "het systeem ziet alleen invoer die later binnenkomt, niet hoe lang een pc zonder verbinding was als er niets werd ingevoerd. Wat van papier is ingevoerd telt hier niet mee."),

    h("section", { class: "blok" }, h("h2", {}, "Per veld"),
      o.per_veld.length
        ? tabel(["Veld", "Stap", "Afgeronde stappen", "Leeg gebleven", "Gecorrigeerd"],
            o.per_veld.map((v) => [`${v.veld} ${v.naam}${v.verplicht ? "" : " (mag leeg)"}`, v.stap, getal(v.keer),
              v.keer ? `${v.leeg.toLocaleString("nl-NL")} (${procent(v.leeg / v.keer)})` : getal(v.leeg), getal(v.gecorrigeerd)]), "compact")
        : h("p", { class: "leeg" }, "Geen velden die leeg bleven of gecorrigeerd zijn."),
      h("p", { class: "noot" }, "Velden die de operator invult, het vaakst leeg eerst. Een veld dat vaak leeg blijft of vaak wordt gecorrigeerd, is misschien onduidelijk of overbodig.")),

    h("section", { class: "blok" }, h("h2", {}, "Geweigerde invoer"),
      o.geweigerd.length
        ? tabel(["Wanneer", "Pc", "Wie", "Stap", "Batch of lot", "Reden"],
            o.geweigerd.map((g) => [kort(g.op), g.pc ?? "", g.naam ?? "", g.stapcode ?? "", g.batchnummer ?? "", g.fout ?? ""]), "compact")
        : h("p", { class: "leeg" }, "Niets geweigerd in deze periode."),
      h("p", { class: "noot" }, "Invoer van een pc die de server niet aannam, de laatste 100. Op de pc staat die invoer in de wachtrij met dezelfde reden. Wordt na 90 dagen opgeruimd.")),

    h("section", { class: "blok" }, h("h2", {}, "Opmerkingen"),
      h("p", {}, `${k.opmerkingen} ${k.opmerkingen === 1 ? "opmerking" : "opmerkingen"} via "Iets melden" in deze periode. `,
        sessie.rol === "beheerder" ? h("a", { href: "#/beheer/opmerkingen" }, "Naar de opmerkingen") : "De beheerder handelt ze af bij Beheer → Opmerkingen.")),

    sessie.rol === "beheerder"
      ? h("section", { class: "blok" }, h("h2", {}, "Instellingen"),
          h("p", {}, o.pilot_start ? `Pilot gestart op ${dagNaam(o.pilot_start)}. ` : "Nog geen startdatum van de pilot. ",
            `Invoer telt als te laat na ${o.te_laat_minuten} minuten.`),
          h("button", { class: "knop", type: "button", onclick: () => void instellen(o) }, "Instellingen wijzigen"))
      : null,
  );
}

function blokInvoer(titel: string, uitleg: string, regels: Regel[], laat: number, soort: "dag" | "pc" | "beide") {
  const voor = soort === "dag" ? ["Dag"] : soort === "pc" ? ["Pc"] : ["Dag", "Pc"];
  return h("section", { class: "blok" }, h("h2", {}, titel), h("p", { class: "sub" }, uitleg),
    regels.length
      ? tabel([...voor, "Gestart", "Afgerond", "Meetwaarden", "Gemiddeld onderweg", "Langst onderweg", `Later dan ${laat} min`, "Van papier", "Geweigerd", "Opmerkingen"],
          regels.map((r) => [...(soort === "pc" ? [r.pc] : soort === "dag" ? [dagNaam(r.dag!)] : [dagNaam(r.dag!), r.pc]),
            getal(r.gestart), getal(r.afgerond), getal(r.waarden), minuten(r.gemiddeld_minuten), minuten(r.langst_minuten),
            r.te_laat ? h("strong", {}, getal(r.te_laat)) : getal(0), getal(r.nageleverd), r.geweigerd ? h("strong", {}, getal(r.geweigerd)) : getal(0), getal(r.opmerkingen)]), "compact")
      : h("p", { class: "leeg" }, soort === "beide" ? "Niets bijzonders in deze periode." : "Geen invoer in deze periode."));
}

async function instellen(o: Overzicht) {
  const r = await vraag("Instellingen van het pilotoverzicht", [
    { naam: "start", label: "Startdatum van de pilot", type: "date", optioneel: true, waarde: o.pilot_start ?? undefined,
      hint: "Het overzicht begint dan standaard op deze dag." },
    { naam: "laat", label: "Te laat na (minuten)", type: "getal", waarde: String(o.te_laat_minuten), hint: "Tussen 1 en 720." },
  ], "Opslaan");
  if (!r) return;
  const laat = Number(r.laat);
  if (!Number.isInteger(laat) || laat < 1 || laat > 720) return melding("Te laat na: een heel getal tussen 1 en 720", "fout");
  try {
    await stuur("PUT", "/pilot/instellingen", { pilot_start: r.start || null, te_laat_minuten: laat });
  } catch (e) {
    return melding((e as Error).message, "fout");
  }
  delete keuze.van; delete keuze.tot;
  melding("Instellingen opgeslagen", "ok");
  void pilotoverzicht();
}
