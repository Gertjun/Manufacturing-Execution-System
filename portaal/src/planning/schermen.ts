// Portaal Planning: batches per dag plannen, per stap vastleggen wat er die dag
// gebeurt, lotvoorstellen (4 batches) en producten.
// Operators zien de planning in het invoerscherm; daar mogen ze afwijken.
import { bevestig, h, laden, melding, toon, vastHouden, vraag } from "../../../gedeeld/ui";
import { haal, sessie, stuur } from "../basis";
import { fout, kop, tabel } from "../kwaliteit/schermen";
import { etikettenLink } from "../etiketten";

// ---------- Datums ----------
/** Datum als JJJJ-MM-DD in de tijdzone van deze computer. */
export function isoDag(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plusDagen(dag: string, n: number): string {
  const d = new Date(`${dag}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDag(d);
}
function maandagVan(dag: string): string {
  const d = new Date(`${dag}T12:00:00`);
  return plusDagen(dag, -((d.getDay() + 6) % 7));
}
const dagNaam = (dag: string, lang = true) =>
  new Date(`${dag}T12:00:00`).toLocaleDateString("nl-NL", lang ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" });
const geldigeDag = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

const magPlannen = () => sessie.rol === "planner" || sessie.rol === "beheerder";

/** Voert een wijziging uit, meldt het resultaat en tekent het scherm opnieuw. */
async function wijzig(actie: () => Promise<unknown>, gelukt: string, opnieuw: () => void) {
  try {
    await actie();
    melding(gelukt, "ok");
    opnieuw();
  } catch (e) {
    melding((e as Error).message, "fout");
  }
}

interface Product { id: string; code: string; naam: string; actief: boolean }
interface BatchPlan {
  batchnummer: string; status: string; gepland: boolean; dag: string | null; volgorde: number | null;
  product_id: string | null; product: string | null; opmerking: string | null; vervallen_reden: string | null;
  laatste_stap: string | null; lotnummer: string | null; voorstel: number | null;
}

const STATUS: Record<string, string> = {
  gepland: "Nog niet gestart",
  in_productie: "In productie",
  in_beoordeling: "In beoordeling",
  in_lot: "In lot",
  afgekeurd: "Afgekeurd",
  vervallen: "Vervallen",
};
function stand(b: BatchPlan): string {
  if (b.status === "in_lot") return `In lot ${b.lotnummer ?? ""}`.trim();
  if (b.status === "in_productie" && b.laatste_stap) return `In productie, laatst ${b.laatste_stap}`;
  if (b.status === "vervallen") return `Vervallen: ${b.vervallen_reden ?? ""}`;
  return STATUS[b.status] ?? b.status;
}

async function productOpties(): Promise<[string, string][]> {
  const p = await haal<Product[]>("/planning/producten");
  return [["", "Geen product"], ...p.map((x): [string, string] => [x.id, `${x.code} – ${x.naam}`])];
}

// ---------- Week ----------
interface Week { dagen: { dag: string; batches: BatchPlan[] }[]; achterstand: BatchPlan[] }

export async function week(van?: string) {
  const actueel = vastHouden();
  const maandag = maandagVan(geldigeDag(van) ?? isoDag());
  toon(kop("Planning per week"), laden());
  let w: Week, producten: [string, string][];
  try { [w, producten] = await Promise.all([haal<Week>(`/planning/week?van=${maandag}&dagen=7`), productOpties()]); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const opnieuw = () => week(maandag);
  const vandaag = isoDag();

  const plannen = async (dag: string) => {
    const r = await vraag("Batches plannen", [
      { naam: "dag", label: "Dag", type: "date", waarde: dag },
      { naam: "aantal", label: "Aantal batches", type: "number", waarde: "4", controle: (v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 50 ? null : "Kies 1 tot 50") },
      { naam: "product", label: "Product", opties: producten, optioneel: true },
      { naam: "opmerking", label: "Opmerking", optioneel: true },
    ], "Plannen", "Het systeem geeft de volgende vrije batchnummers. De batches komen achteraan op die dag.");
    if (!r) return;
    await wijzig(async () => {
      const a = await stuur<{ batchnummers: string[] }>("POST", "/planning/batches", {
        dag: r.dag, aantal: Number(r.aantal), productId: r.product || null, opmerking: r.opmerking || null,
      });
      melding(a.batchnummers.length === 1 ? `${a.batchnummers[0]} gepland` : `${a.batchnummers[0]} tot ${a.batchnummers.at(-1)} gepland`, "ok");
    }, "Gepland", () => week(r.dag));
  };

  const wijzigBatch = async (b: BatchPlan) => {
    const gestart = b.status !== "gepland";
    const r = await vraag(`${b.batchnummer} wijzigen`, [
      ...(gestart ? [] : [
        { naam: "dag", label: "Dag", type: "date", waarde: b.dag ?? undefined },
        { naam: "product", label: "Product", opties: producten, waarde: b.product_id ?? "", optioneel: true },
      ]),
      { naam: "opmerking", label: "Opmerking", waarde: b.opmerking ?? "", optioneel: true },
    ], "Opslaan", gestart ? "Deze batch is gestart: dag en product liggen vast. Alleen de opmerking kun je nog aanpassen." : "Kies je een andere dag, dan komt de batch daar achteraan.");
    if (!r) return;
    const body: Record<string, unknown> = { opmerking: r.opmerking || null };
    if (!gestart) { body.dag = r.dag; body.productId = r.product || null; }
    await wijzig(() => stuur("PATCH", `/planning/batches/${b.batchnummer}`, body), `${b.batchnummer} opgeslagen`, opnieuw);
  };

  const vervallen = async (b: BatchPlan) => {
    const r = await vraag(`${b.batchnummer} laten vervallen?`, [{ naam: "reden", label: "Reden", controle: (v) => (v.length < 3 ? "Geef een korte reden" : null) }],
      "Laten vervallen", "De batch wordt niet gemaakt. Het nummer blijft bewaard en wordt niet opnieuw gebruikt.");
    if (!r) return;
    await wijzig(() => stuur("POST", `/planning/batches/${b.batchnummer}/vervallen`, { reden: r.reden }), `${b.batchnummer} vervallen`, opnieuw);
  };

  const schuif = (b: BatchPlan, richting: "eerder" | "later") =>
    wijzig(() => stuur("POST", `/planning/batches/${b.batchnummer}/volgorde`, { richting }), `${b.batchnummer} ${richting}`, opnieuw);

  const rij = (b: BatchPlan, i: number, lijst: BatchPlan[]) => {
    const geplandOpen = b.gepland && b.status === "gepland";
    const vorige = lijst[i - 1], volgende = lijst[i + 1];
    return h("li", { class: `planrij${b.gepland ? "" : " ongepland"}${b.status === "vervallen" ? " vervallen" : ""}` },
      h("div", { class: "planrij-hoofd" },
        h("a", { class: "sterk", href: `#/productie/batch/${b.batchnummer}` }, b.batchnummer),
        b.gepland ? null : h("span", { class: "etiket" }, "Niet gepland"),
        b.voorstel ? h("a", { class: "etiket", href: "#/planning/lots" }, `Voorstel ${b.voorstel}`) : null),
      h("div", { class: "planrij-info" }, [b.product, stand(b)].filter(Boolean).join(". ")),
      b.opmerking ? h("div", { class: "planrij-info" }, b.opmerking) : null,
      magPlannen() && b.gepland && ["gepland", "in_productie", "in_beoordeling"].includes(b.status)
        ? h("div", { class: "knoppen-klein" },
            geplandOpen ? h("button", { class: "knop knop-mini knop-stil", title: "Eerder op de dag", "aria-label": `${b.batchnummer} eerder`, disabled: !(vorige?.gepland && vorige.status === "gepland"), onclick: () => schuif(b, "eerder") }, "↑") : null,
            geplandOpen ? h("button", { class: "knop knop-mini knop-stil", title: "Later op de dag", "aria-label": `${b.batchnummer} later`, disabled: !(volgende?.gepland && volgende.status === "gepland"), onclick: () => schuif(b, "later") }, "↓") : null,
            h("button", { class: "knop knop-mini knop-stil", onclick: () => wijzigBatch(b) }, "Wijzigen"),
            geplandOpen ? h("button", { class: "knop knop-mini knop-stil", onclick: () => vervallen(b) }, "Vervallen") : null)
        : null);
  };

  const dagKaart = (d: { dag: string; batches: BatchPlan[] }) => {
    const geplandeLijst = d.batches.filter((b) => b.gepland);
    const ongepland = d.batches.filter((b) => !b.gepland);
    const actief = d.batches.filter((b) => b.status !== "vervallen").length;
    return h("section", { class: `dagkaart${d.dag === vandaag ? " vandaag" : ""}${d.dag < vandaag ? " voorbij" : ""}` },
      h("div", { class: "dagkaart-kop" },
        h("h2", {}, dagNaam(d.dag), d.dag === vandaag ? h("span", { class: "sub" }, " (vandaag)") : null),
        h("span", { class: "sub" }, actief === 1 ? "1 batch" : `${actief} batches`)),
      d.batches.length
        ? h("ol", { class: "planlijst" }, geplandeLijst.map(rij), ongepland.map(rij))
        : h("p", { class: "sub" }, "Niets gepland."),
      h("div", { class: "knoppen-klein" },
        magPlannen() && d.dag >= vandaag ? h("button", { class: "knop knop-klein", onclick: () => plannen(d.dag) }, "Batches plannen") : null,
        h("a", { class: "knop knop-klein knop-stil", href: `#/planning/dag/${d.dag}` }, "Per stap"),
        geplandeLijst.some((b) => b.status !== "vervallen")
          ? h("a", { class: "knop knop-klein knop-stil", href: etikettenLink(geplandeLijst.filter((b) => b.status !== "vervallen").map((b) => b.batchnummer)) }, "Etiketten")
          : null));
  };

  toon(
    kop(`Week van ${new Date(`${maandag}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}`,
      "Welke batches op welke dag. Een operator start een geplande batch in de eerste stap; daarna liggen dag en product vast.",
      h("div", { class: "knoppen-klein" },
        h("a", { class: "knop knop-stil", href: `#/planning/week/${plusDagen(maandag, -7)}` }, "Vorige week"),
        h("a", { class: "knop knop-stil", href: "#/planning/week" }, "Deze week"),
        h("a", { class: "knop knop-stil", href: `#/planning/week/${plusDagen(maandag, 7)}` }, "Volgende week"),
        magPlannen() ? h("button", { class: "knop knop-hoofd", onclick: () => plannen(maandag > vandaag ? maandag : vandaag) }, "Batches plannen") : null)),
    w.achterstand.length
      ? h("section", { class: "blok let-op-blok" },
          h("h2", {}, `Nog niet gestart (${w.achterstand.length})`),
          h("p", { class: "sub" }, "Gepland op een eerdere dag, maar nog niet begonnen. Ze staan nog wel klaar in de eerste stap. Zet ze op een nieuwe dag of laat ze vervallen."),
          h("ol", { class: "planlijst" }, w.achterstand.map((b) =>
            h("li", { class: "planrij" },
              h("div", { class: "planrij-hoofd" }, h("span", { class: "sterk" }, b.batchnummer), h("span", { class: "sub" }, `gepland voor ${dagNaam(b.dag!, false)}`)),
              b.product ? h("div", { class: "planrij-info" }, b.product) : null,
              magPlannen() ? h("div", { class: "knoppen-klein" },
                h("button", { class: "knop knop-klein knop-stil", onclick: () => wijzigBatch(b) }, "Andere dag"),
                h("button", { class: "knop knop-klein knop-stil", onclick: () => vervallen(b) }, "Laten vervallen")) : null))))
      : null,
    h("div", { class: "weekraster" }, w.dagen.map(dagKaart)),
  );
}

// ---------- Dag per stap ----------
interface PlanItem { id: string; soort: "batch" | "lot" | "voorstel"; nummer: string; volgorde: number; opmerking: string | null; status: "gepland" | "bezig" | "gedaan"; batches: string[] }
interface StapPlan { code: string; naam: string; niveau: string; is_lot_stap: boolean; items: PlanItem[] }
interface Kandidaat { soort: string; nummer: string; klaar: boolean; toelichting: string | null }

const STAND: Record<PlanItem["status"], string> = { gepland: "Gepland", bezig: "Bezig", gedaan: "Gedaan" };
const itemNaam = (i: { soort: string; nummer: string }) => (i.soort === "voorstel" ? `Lotvoorstel ${i.nummer}` : i.nummer);

export async function dag(datum?: string, stapcode?: string) {
  const actueel = vastHouden();
  const d = geldigeDag(datum) ?? isoDag();
  toon(kop("Planning per stap"), laden());
  let stappen: StapPlan[];
  try { stappen = await haal<StapPlan[]>(`/planning/stappen?dag=${d}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const s = stappen.find((x) => x.code === stapcode) ?? stappen.find((x) => x.items.length) ?? stappen[0];
  const opnieuw = () => dag(d, s.code);
  const kanWijzigen = magPlannen() && d >= isoDag();

  const bewaar = (items: { nummer: string; opmerking: string | null }[], gelukt: string) =>
    wijzig(() => stuur("PUT", "/planning/stappen", { dag: d, stap: s.code, items }), gelukt, opnieuw);
  const huidig = () => s.items.map((i) => ({ nummer: i.nummer, opmerking: i.opmerking }));

  const toevoegen = async () => {
    let k: Kandidaat[];
    try { k = await haal<Kandidaat[]>(`/planning/kandidaten?stap=${s.code}`); } catch (e) { return melding((e as Error).message, "fout"); }
    const al = new Set(s.items.map((i) => i.nummer));
    k = k.filter((x) => !al.has(x.nummer));
    if (!k.length) return melding(s.is_lot_stap ? "Er zijn geen open lotvoorstellen om te plannen. Maak eerst een lotvoorstel." : "Er is niets meer om in deze stap te plannen.", "info");
    const gekozen = await kiesUit(`Toevoegen aan ${s.code} ${s.naam}`,
      "Bovenaan staat wat nu al klaar is voor deze stap. Je kunt ook plannen wat later vandaag klaar komt.",
      k.map((x) => ({ waarde: x.nummer, tekst: itemNaam(x), uitleg: [x.klaar ? "Staat klaar" : null, x.toelichting].filter(Boolean).join(". ") })));
    if (!gekozen?.length) return;
    await bewaar([...huidig(), ...gekozen.map((nummer) => ({ nummer, opmerking: null }))], gekozen.length === 1 ? `${itemNaam({ soort: k[0].soort, nummer: gekozen[0] })} toegevoegd` : `${gekozen.length} toegevoegd`);
  };
  const verplaats = (i: number, n: number) => {
    const lijst = huidig();
    const [x] = lijst.splice(i, 1);
    lijst.splice(i + n, 0, x);
    return bewaar(lijst, "Volgorde opgeslagen");
  };
  const haalWeg = (i: number) => {
    const lijst = huidig();
    lijst.splice(i, 1);
    return bewaar(lijst, `${itemNaam(s.items[i])} uit de planning gehaald`);
  };
  const opmerking = async (i: number) => {
    const r = await vraag(`Opmerking bij ${itemNaam(s.items[i])}`, [{ naam: "opmerking", label: "Opmerking voor de operator", waarde: s.items[i].opmerking ?? "", optioneel: true }], "Opslaan");
    if (!r) return;
    const lijst = huidig();
    lijst[i].opmerking = r.opmerking || null;
    return bewaar(lijst, "Opmerking opgeslagen");
  };

  const lijstLink = (x: StapPlan) =>
    h("a", { href: `#/planning/dag/${d}/${x.code}`, "aria-current": x.code === s.code ? "page" : undefined },
      h("span", { class: "code" }, x.code), h("span", { class: "groei" }, x.naam), x.items.length ? h("span", { class: "teller-licht" }, x.items.length) : null);

  toon(
    kop(dagNaam(d).replace(/^./, (c) => c.toUpperCase()),
      "Per stap wat er die dag moet gebeuren, in volgorde. Operators zien dit bovenaan in het invoerscherm.",
      h("div", { class: "knoppen-klein" },
        h("a", { class: "knop knop-stil", href: `#/planning/dag/${plusDagen(d, -1)}/${s.code}` }, "Vorige dag"),
        h("a", { class: "knop knop-stil", href: `#/planning/dag/${isoDag()}/${s.code}` }, "Vandaag"),
        h("a", { class: "knop knop-stil", href: `#/planning/dag/${plusDagen(d, 1)}/${s.code}` }, "Volgende dag"),
        h("a", { class: "knop knop-stil", href: `#/planning/week/${d}` }, "Naar de week"))),
    h("div", { class: "beheer-indeling" },
      h("nav", { class: "stappenlijst", "aria-label": "Stappen" },
        h("div", { class: "lijstkop" }, "Per batch"), stappen.filter((x) => x.niveau === "batch").map(lijstLink),
        h("div", { class: "lijstkop" }, "Per lot"), stappen.filter((x) => x.niveau === "lot").map(lijstLink)),
      h("section", { class: "blok", style: "margin-top:0" },
        h("div", { class: "kop" },
          h("div", {}, h("h2", { style: "margin:0" }, `${s.code} ${s.naam}`),
            h("p", { class: "sub" }, s.is_lot_stap ? "Hier worden 4 batches één lot. Je plant een lotvoorstel." : s.niveau === "lot" ? "Per lot" : "Per batch")),
          kanWijzigen ? h("button", { class: "knop knop-hoofd", onclick: toevoegen }, s.is_lot_stap ? "Lotvoorstel toevoegen" : "Toevoegen") : null),
        s.items.length
          ? tabel(["", s.is_lot_stap ? "Lotvoorstel" : s.niveau === "lot" ? "Lot" : "Batch", "Stand", "Opmerking", ""], s.items.map((i, n) => [
              h("span", { class: "getal sub" }, n + 1),
              h("span", {}, h("strong", {}, itemNaam(i)), i.batches.length ? h("div", { class: "sub" }, i.batches.join(", ")) : null),
              h("span", { class: `stand stand-${i.status}` }, STAND[i.status]),
              i.opmerking ?? "",
              kanWijzigen
                ? h("div", { class: "knoppen-klein" },
                    h("button", { class: "knop knop-klein knop-stil", "aria-label": `${itemNaam(i)} eerder`, disabled: n === 0, onclick: () => verplaats(n, -1) }, "↑"),
                    h("button", { class: "knop knop-klein knop-stil", "aria-label": `${itemNaam(i)} later`, disabled: n === s.items.length - 1, onclick: () => verplaats(n, 1) }, "↓"),
                    h("button", { class: "knop knop-klein knop-stil", onclick: () => opmerking(n) }, "Opmerking"),
                    h("button", { class: "knop knop-klein knop-stil", onclick: () => haalWeg(n) }, "Weghalen"))
                : null]), "compact")
          : h("p", { class: "leeg" }, kanWijzigen ? "Voor deze stap is op deze dag niets gepland. Kies Toevoegen." : "Voor deze stap is op deze dag niets gepland."))),
  );
}

/** Venster met vinkjes; geeft de gekozen waarden terug, of null. */
function kiesUit(titel: string, uitleg: string, opties: { waarde: string; tekst: string; uitleg?: string }[], precies?: number, gekozen: string[] = []) {
  return new Promise<string[] | null>((ok) => {
    const vinken = opties.map((o) => h("input", { type: "checkbox", value: o.waarde, checked: gekozen.includes(o.waarde) }) as HTMLInputElement);
    const teller = h("p", { class: "sub", "aria-live": "polite" });
    const knop = h("button", { class: "knop knop-hoofd", onclick: () => d.close("ja") }, "Kiezen") as HTMLButtonElement;
    const tel = () => {
      const n = vinken.filter((v) => v.checked).length;
      teller.textContent = precies ? `${n} van ${precies} gekozen` : `${n} gekozen`;
      knop.disabled = precies ? n !== precies : n === 0;
    };
    vinken.forEach((v) => v.addEventListener("change", tel));
    const d = h("dialog", { class: "venster venster-breed" },
      h("h2", {}, titel),
      h("p", { class: "sub" }, uitleg),
      h("div", { class: "keuzelijst" }, opties.map((o, i) =>
        h("label", {}, vinken[i], h("span", {}, h("strong", {}, o.tekst), o.uitleg ? h("span", { class: "sub" }, ` ${o.uitleg}`) : null)))),
      teller,
      h("div", { class: "knoppen" }, h("button", { class: "knop knop-stil", onclick: () => d.close("nee") }, "Terug"), knop));
    d.addEventListener("close", () => {
      ok(d.returnValue === "ja" ? vinken.filter((v) => v.checked).map((v) => v.value) : null);
      d.remove();
    });
    tel();
    document.body.append(d);
    (d as HTMLDialogElement).showModal();
  });
}

// ---------- Lotvoorstellen ----------
interface Voorstel {
  nummer: number; status: string; opmerking: string | null; aangemaakt_op: string; door: string; lotnummer: string | null; afwijking_reden: string | null;
  batches: { batchnummer: string; status: string; klaar_voor_lot: boolean; laatste_stap: string | null }[];
}
interface LotKandidaat { batchnummer: string; status: string; product: string | null; dag: string | null; laatste_stap: string | null; klaar_voor_lot: boolean; voorstel: number | null }

const VOORSTEL_STATUS: Record<string, string> = { open: "Open", gebruikt: "Gevolgd", afgeweken: "Afgeweken", vervallen: "Vervallen" };

export async function lots() {
  const actueel = vastHouden();
  toon(kop("Lotvoorstellen"), laden());
  let alle: Voorstel[];
  try { alle = await haal<Voorstel[]>("/planning/lotvoorstellen?alle=true"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const open = alle.filter((v) => v.status === "open");
  const klaar = alle.filter((v) => v.status !== "open");

  const kiesBatches = async (v?: Voorstel) => {
    let k: LotKandidaat[];
    try { k = await haal<LotKandidaat[]>("/planning/lotkandidaten"); } catch (e) { melding((e as Error).message, "fout"); return null; }
    k = k.filter((x) => !x.voorstel || x.voorstel === v?.nummer);
    if (k.length < 4) { melding("Er zijn minder dan 4 batches zonder lotvoorstel. Plan eerst meer batches.", "info"); return null; }
    return kiesUit(v ? `Lotvoorstel ${v.nummer} aanpassen` : "Nieuw lotvoorstel", "Kies precies 4 batches. Bovenaan staan de batches die alle batchstappen al hebben doorlopen.",
      k.map((x) => ({
        waarde: x.batchnummer, tekst: x.batchnummer,
        uitleg: [x.klaar_voor_lot ? "Klaar voor een lot" : x.status === "gepland" ? "Nog niet gestart" : x.status === "in_beoordeling" ? "In beoordeling" : x.laatste_stap ? `Laatst ${x.laatste_stap}` : "In productie", x.product].filter(Boolean).join(". "),
      })), 4, v?.batches.map((b) => b.batchnummer));
  };

  const nieuw = async () => {
    const batches = await kiesBatches();
    if (!batches) return;
    const r = await vraag("Opmerking bij het voorstel", [{ naam: "opmerking", label: "Opmerking", optioneel: true }], "Voorstel maken");
    if (!r) return;
    await wijzig(async () => {
      const v = await stuur<Voorstel>("POST", "/planning/lotvoorstellen", { batchnummers: batches, opmerking: r.opmerking || null });
      melding(`Lotvoorstel ${v.nummer} gemaakt`, "ok");
    }, "Voorstel gemaakt", lots);
  };
  const aanpassen = async (v: Voorstel) => {
    const batches = await kiesBatches(v);
    if (!batches) return;
    await wijzig(() => stuur("PUT", `/planning/lotvoorstellen/${v.nummer}`, { batchnummers: batches, opmerking: v.opmerking }), `Lotvoorstel ${v.nummer} aangepast`, lots);
  };
  const laatVervallen = async (v: Voorstel) => {
    if (!(await bevestig(`Lotvoorstel ${v.nummer} laten vervallen?`, "De batches komen vrij voor een ander voorstel. Het voorstel blijft zichtbaar in de geschiedenis.", "Laten vervallen", true))) return;
    await wijzig(() => stuur("POST", `/planning/lotvoorstellen/${v.nummer}/vervallen`), `Lotvoorstel ${v.nummer} vervallen`, lots);
  };

  const kaart = (v: Voorstel) => {
    const nKlaar = v.batches.filter((b) => b.klaar_voor_lot).length;
    return h("section", { class: "blok voorstel" },
      h("div", { class: "kop" },
        h("div", {}, h("h2", { style: "margin:0" }, `Lotvoorstel ${v.nummer}`),
          h("p", { class: "sub" }, nKlaar === 4 ? "Alle 4 batches zijn klaar. De operator kan het lot samenstellen." : `${nKlaar} van 4 batches klaar voor een lot.`)),
        magPlannen() ? h("div", { class: "knoppen-klein" },
          h("button", { class: "knop knop-klein", onclick: () => aanpassen(v) }, "Batches wijzigen"),
          h("button", { class: "knop knop-klein knop-stil", onclick: () => laatVervallen(v) }, "Laten vervallen")) : null),
      h("ul", { class: "voorstel-batches" }, v.batches.map((b) =>
        h("li", { class: b.klaar_voor_lot ? "klaar" : "" },
          h("span", { class: "vink", "aria-hidden": "true" }, b.klaar_voor_lot ? "✓" : ""),
          h("a", { class: "sterk", href: `#/productie/batch/${b.batchnummer}` }, b.batchnummer),
          h("span", { class: "sub" }, b.klaar_voor_lot ? "klaar" : b.status === "gepland" ? "nog niet gestart" : b.status === "in_beoordeling" ? "in beoordeling" : b.laatste_stap ? `laatst ${b.laatste_stap}` : b.status)))),
      v.opmerking ? h("p", { class: "sub" }, v.opmerking) : null);
  };

  toon(
    kop("Lotvoorstellen", "De planner stelt voor welke 4 batches samen een lot worden. De operator kiest het voorstel bij het samenstellen; afwijken mag, met een reden.",
      magPlannen() ? h("button", { class: "knop knop-hoofd", onclick: nieuw }, "Nieuw lotvoorstel") : null),
    open.length ? h("div", { class: "voorstellen" }, open.map(kaart)) : h("p", { class: "leeg" }, "Er zijn geen open lotvoorstellen."),
    klaar.length
      ? h("section", { class: "blok" }, h("h2", {}, "Afgerond"),
          tabel(["Voorstel", "Uitkomst", "Lot", "Batches", "Reden van afwijken"], klaar.map((v) => [
            String(v.nummer), VOORSTEL_STATUS[v.status] ?? v.status,
            v.lotnummer ? h("a", { class: "sterk", href: `#/kwaliteit/lotpaspoort/${v.lotnummer}` }, v.lotnummer) : "",
            v.batches.map((b) => b.batchnummer).join(", "), v.afwijking_reden ?? ""]), "compact"))
      : null,
  );
}

// ---------- Producten ----------
export async function producten() {
  const actueel = vastHouden();
  toon(kop("Producten"), laden());
  let p: Product[];
  try { p = await haal<Product[]>("/planning/producten?ookInactief=true"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const toevoegen = async () => {
    const r = await vraag("Product toevoegen", [
      { naam: "code", label: "Code", hint: "Kort, zonder spaties. Bijvoorbeeld PRD-D", controle: (v) => (/^[A-Za-z0-9._-]{1,20}$/.test(v) ? null : "Alleen letters, cijfers, punt, streepje of liggend streepje; hoogstens 20 tekens") },
      { naam: "naam", label: "Naam" },
    ], "Toevoegen", "De code ligt daarna vast; de naam kun je later wijzigen.");
    if (!r) return;
    await wijzig(() => stuur("POST", "/planning/producten", r), `${r.code} toegevoegd`, producten);
  };
  const hernoem = async (x: Product) => {
    const r = await vraag(`Naam van ${x.code}`, [{ naam: "naam", label: "Naam", waarde: x.naam }], "Opslaan");
    if (!r) return;
    await wijzig(() => stuur("PATCH", `/planning/producten/${x.id}`, { naam: r.naam }), "Naam opgeslagen", producten);
  };
  const zetActief = (x: Product, actief: boolean) =>
    wijzig(() => stuur("PATCH", `/planning/producten/${x.id}`, { actief }), actief ? `${x.code} weer actief` : `${x.code} uitgezet`, producten);
  toon(
    kop("Producten", "Het product of recept dat je bij een batch plant. Een uitgezet product kun je niet meer kiezen; eerdere batches houden het.",
      magPlannen() ? h("button", { class: "knop knop-hoofd", onclick: toevoegen }, "Product toevoegen") : null),
    p.length
      ? tabel(["Code", "Naam", ""], p.map((x) => [
          h("strong", { class: x.actief ? "" : "inactief" }, x.code),
          h("span", { class: x.actief ? "" : "inactief" }, x.naam, x.actief ? "" : " (uit)"),
          magPlannen() ? h("div", { class: "knoppen-klein" },
            x.actief ? h("button", { class: "knop knop-klein", onclick: () => hernoem(x) }, "Naam wijzigen") : null,
            h("button", { class: "knop knop-klein knop-stil", onclick: () => zetActief(x, !x.actief) }, x.actief ? "Uitzetten" : "Weer aanzetten")) : null]), "compact")
      : h("p", { class: "leeg" }, "Nog geen producten. Voeg er een toe."),
  );
}
