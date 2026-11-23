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
    if (gelukt) melding(gelukt, "ok");
    opnieuw();
  } catch (e) {
    melding((e as Error).message, "fout");
  }
}

interface Product { id: string; code: string; naam: string; actief: boolean; route?: string[] | null }
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
interface ProductStart { product: string | null; naam: string | null; aantal: number; max: number | null; reden: string | null }
interface Afwijking { id: string; van: string; tot: string; stap: string | null; product: string | null; procent: number; reden: string }
interface Dag { dag: string; batches: BatchPlan[]; bezet: number; producten: ProductStart[]; afwijkingen: Afwijking[]; stappen_vol?: { stap: string; procent: number; dicht?: boolean }[] }
interface Week { dagen: Dag[]; achterstand: BatchPlan[]; ruimte: { product: string; aantal: number }[] }
const teVolStart = (p: ProductStart) => p.max !== null && p.aantal > p.max;
/** "PRD-B, alle stappen: geen productie (onderhoud lijn 2)" (D69). */
const afwijkingTekst = (a: Afwijking) =>
  `${a.product ?? "Alle producten"}, ${a.stap ?? "alle stappen"}: ${a.procent === 0 ? "geen productie" : `${a.procent} %`} (${a.reden})`;

export async function week(van?: string) {
  const actueel = vastHouden();
  const maandag = maandagVan(geldigeDag(van) ?? isoDag());
  toon(kop("Batches plannen"), laden());
  let w: Week, producten: [string, string][];
  try { [w, producten] = await Promise.all([haal<Week>(`/planning/week?van=${maandag}&dagen=7`), productOpties()]); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const opnieuw = () => week(maandag);
  const vandaag = isoDag();

  const plannen = async (dag: string) => {
    // De capaciteit per product hangt van de dag af; die van een dag buiten deze week kent het scherm niet (de API waarschuwt achteraf).
    const r = await vraag("Batches plannen", [
      { naam: "dag", label: "Dag", type: "date", waarde: dag },
      { naam: "aantal", label: "Aantal batches", type: "number", waarde: "4", controle: (v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 50 ? null : "Kies 1 tot 50") },
      { naam: "product", label: "Product", opties: producten, optioneel: true },
      { naam: "opmerking", label: "Opmerking", optioneel: true },
    ], "Plannen", "Het systeem geeft de volgende vrije batchnummers. De batches komen achteraan op die dag.");
    if (!r) return;
    // Waarschuwen als het product die dag daarmee te vol wordt (plannen mag wel, D36/D69).
    const code = r.product ? producten.find(([id]) => id === r.product)?.[1].split(" – ")[0] ?? null : null;
    const p = w.dagen.find((x) => x.dag === r.dag)?.producten.find((x) => x.product === code);
    const erbij = Number(r.aantal);
    if (p && p.max !== null && p.aantal + erbij > p.max) {
      const naam = code ?? "Batches zonder product";
      const tekst = p.max === 0
        ? `${naam} wordt op ${dagNaam(r.dag)} niet gemaakt${p.reden ? ` (${p.reden})` : ""}. Toch plannen?`
        : `${naam} heeft op ${dagNaam(r.dag)} al ${p.aantal} van de ${p.max} batches${p.reden ? ` (${p.reden})` : ""}. Met ${erbij} erbij wordt het ${p.aantal + erbij}. Toch plannen?`;
      if (!(await bevestig("Meer dan de capaciteit?", tekst, "Toch plannen", true))) return;
    }
    await wijzig(async () => {
      const a = await stuur<{ batchnummers: string[]; waarschuwing: string | null }>("POST", "/planning/batches", {
        dag: r.dag, aantal: Number(r.aantal), productId: r.product || null, opmerking: r.opmerking || null,
      });
      melding((a.batchnummers.length === 1 ? `${a.batchnummers[0]} gepland` : `${a.batchnummers[0]} tot ${a.batchnummers.at(-1)} gepland`) +
        (a.waarschuwing ? `. ${a.waarschuwing}.` : ""), a.waarschuwing ? "fout" : "ok");
    }, "", () => week(r.dag));
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

  /** Per product: starts en de capaciteit van de eerste stap van zijn route (D69). Alleen producten met batches. */
  const productRij = (p: ProductStart) => {
    const te = teVolStart(p);
    const naam = p.product ?? "Zonder product";
    const getal = p.max === null ? `${p.aantal}` : p.max === 0 ? `${p.aantal} / dicht` : `${p.aantal} / ${p.max}`;
    const vol = p.max ? Math.min(1, p.aantal / p.max) : te ? 1 : 0;
    return h("li", { class: `startrij${te ? " te-vol" : ""}` },
      h("span", { class: "startrij-naam" }, naam),
      p.max !== null
        ? h("span", { class: "bezetbalk", role: "img", "aria-label": p.max === 0 ? `${naam}: ${p.aantal} batches, deze dag geen productie` : `${naam}: ${p.aantal} van ${p.max} batches` },
            h("span", { style: `width:${Math.round(vol * 100)}%` }))
        : h("span", { class: "label-nog-invullen" }, "capaciteit nog invullen"),
      h("span", { class: te ? "bezetting te-vol-tekst" : "bezetting" }, te ? "⚠ " : "", getal));
  };

  const dagKaart = (d: Dag) => {
    const geplandeLijst = d.batches.filter((b) => b.gepland);
    const ongepland = d.batches.filter((b) => !b.gepland);
    const metBatches = d.producten.filter((p) => p.aantal > 0);
    const teVol = metBatches.some(teVolStart);
    return h("section", { class: `dagkaart${d.dag === vandaag ? " vandaag" : ""}${d.dag < vandaag ? " voorbij" : ""}${teVol ? " te-vol" : ""}` },
      h("div", { class: "dagkaart-kop" },
        h("h2", {}, dagNaam(d.dag), d.dag === vandaag ? h("span", { class: "sub" }, " (vandaag)") : null),
        h("span", { class: teVol ? "bezetting te-vol-tekst" : "bezetting" }, `${teVol ? "⚠ " : ""}${d.bezet} ${d.bezet === 1 ? "batch" : "batches"}`)),
      metBatches.length ? h("ul", { class: "startlijst" }, metBatches.map(productRij)) : null,
      // Capaciteit per stap en product (D55): stappen die deze dag te vol of dicht zijn, met een link naar die stap.
      d.stappen_vol?.length
        ? h("p", { class: "te-vol-tekst stap-vol" }, h("span", { "aria-hidden": "true" }, "⚠ "), "Te vol: ",
            d.stappen_vol.flatMap((v, i) => [i ? ", " : "", h("a", { href: `#/planning/dag/${d.dag}/${v.stap}` }, v.dicht ? `${v.stap} dicht` : `${v.stap} ${v.procent} %`)]))
        : null,
      d.afwijkingen.length
        ? h("p", { class: "sub afwijking-tekst" }, "Afwijkend: ", d.afwijkingen.map(afwijkingTekst).join("; "))
        : null,
      d.batches.length
        ? h("ol", { class: "planlijst" }, geplandeLijst.map(rij), ongepland.map(rij))
        : h("p", { class: "sub" }, "Niets gepland."),
      h("div", { class: "knoppen-klein" },
        magPlannen() && d.dag >= vandaag ? h("button", { class: "knop knop-klein", onclick: () => plannen(d.dag) }, "Batches plannen") : null,
        h("a", { class: "knop knop-klein knop-stil", href: `#/planning/dag/${d.dag}` }, "Stappen plannen"),
        geplandeLijst.some((b) => b.status !== "vervallen")
          ? h("a", { class: "knop knop-klein knop-stil", href: etikettenLink(geplandeLijst.filter((b) => b.status !== "vervallen").map((b) => b.batchnummer)) }, "Etiketten")
          : null));
  };

  toon(
    kop(`Week van ${new Date(`${maandag}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}`,
      `Welke batches op welke dag. Een operator start een geplande batch in de eerste stap van de route; daarna liggen dag en product vast.${
        w.ruimte.length ? ` Deze week nog ruimte voor ${w.ruimte.map((r) => `${r.aantal} van ${r.product}`).join(", ")}.` : ""}`,
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
interface PlanItem { id: string; soort: "batch" | "lot" | "voorstel"; nummer: string; volgorde: number; opmerking: string | null; status: "gepland" | "bezig" | "gedaan"; batches: string[]; vorige?: Vorige | null }
interface StapCapaciteit { procent: number; dicht?: boolean; regels: { product: string | null; aantal: number; van_week: number; max: number | null; reden?: string | null }[] }
interface StapPlan { code: string; naam: string; niveau: string; is_lot_stap: boolean; items: PlanItem[]; capaciteit?: StapCapaciteit | null }

/** "75 % van de capaciteit: 2 van PRD-A (max 4), 1 van PRD-B (max 1)". Met ⚠ boven de 100 % (D55). */
function capaciteitRegel(c: StapCapaciteit | null | undefined, eenheid: string): Node | null {
  if (!c) return null;
  const teVol = c.procent > 100 || !!c.dicht;
  const delen = c.regels.map((r) => `${r.aantal} ${r.product ? `van ${r.product}` : "zonder product"}${
    r.max === 0 ? " (deze dag dicht" : r.max ? ` (max ${r.max}` : " (capaciteit nog invullen"}${r.reden ? `: ${r.reden}` : ""})`);
  const week = c.regels.reduce((n, r) => n + r.van_week, 0);
  return h("p", { class: teVol ? "capaciteit-stap te-vol-tekst" : "capaciteit-stap sub" },
    teVol ? h("span", { "aria-hidden": "true" }, "⚠ ") : null,
    c.regels.length ? `${c.procent} % van de capaciteit${teVol ? (c.dicht ? ": gepland op een dag dat de stap dicht is" : ": te vol") : ""}. ${delen.join(", ")}.` : `Nog niets gepland; de capaciteit is ingesteld per ${eenheid}.`,
    week ? ` Waarvan ${week} ${week === 1 ? "batch start" : "batches starten"} deze dag volgens Batches plannen.` : "");
}
interface Kandidaat { soort: string; nummer: string; klaar: boolean; toelichting: string | null; vorige?: Vorige | null }

// ---------- Stand van de vorige stap (D52) ----------
// De database zegt hoe de vorige stap ervoor staat; het scherm waarschuwt, maar weigert niets (D29).
interface Vorige { stand: "eerste" | "klaar" | "bezig" | "vandaag" | "eerder" | "achter" | "later" | "niet_gepland" | "niet_klaar" | "niet_in_route"; stap: string | null; dag: string | null; nr: number | null }
const NIET_OP_TIJD = new Set<Vorige["stand"]>(["achter", "later", "niet_gepland", "niet_klaar", "niet_in_route"]);
const korteDag = (dag: string) => new Date(`${dag}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "numeric" });
function vorigeTekst(v: Vorige | null | undefined): string {
  if (!v || !v.stap) return "";
  switch (v.stand) {
    case "klaar": return `${v.stap} is klaar`;
    case "bezig": return `${v.stap} is bezig`;
    case "vandaag": return `${v.stap} staat dezelfde dag gepland${v.nr ? ` (nr. ${v.nr})` : ""}`;
    case "eerder": return `${v.stap} staat gepland op ${korteDag(v.dag!)}`;
    case "achter": return `${v.stap} stond op ${korteDag(v.dag!)} en is nog niet klaar`;
    case "later": return `${v.stap} is pas gepland op ${korteDag(v.dag!)}`;
    case "niet_gepland": return `${v.stap} is nog niet gepland`;
    case "niet_klaar": return `Nog niet alle batches hebben ${v.stap} afgerond`;
    case "niet_in_route": return `Deze stap hoort niet bij de route van ${v.stap}`;
    default: return "";
  }
}
const nietOpTijd = (v: Vorige | null | undefined) => !!v && NIET_OP_TIJD.has(v.stand);
/** ⚠ met uitleg, voor een gepland item waarvan de vorige stap niet op tijd is. */
const waarschuwing = (tekst: string) => h("span", { class: "plan-waarschuwing" }, h("span", { "aria-hidden": "true" }, "⚠ "), tekst);

const STAND: Record<PlanItem["status"], string> = { gepland: "Gepland", bezig: "Bezig", gedaan: "Gedaan" };
const itemNaam = (i: { soort: string; nummer: string }) => (i.soort === "voorstel" ? `Lotvoorstel ${i.nummer}` : i.nummer);

export async function dag(datum?: string, stapcode?: string) {
  const actueel = vastHouden();
  const d = geldigeDag(datum) ?? isoDag();
  toon(kop("Stappen plannen"), laden());
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
    try { k = await haal<Kandidaat[]>(`/planning/kandidaten?stap=${s.code}&dag=${d}`); } catch (e) { return melding((e as Error).message, "fout"); }
    const al = new Set(s.items.map((i) => i.nummer));
    k = k.filter((x) => !al.has(x.nummer));
    if (!k.length) return melding(s.is_lot_stap ? "Er zijn geen open lotvoorstellen om te plannen. Maak eerst een lotvoorstel." : "Er is niets meer om in deze stap te plannen.", "info");
    // Drie groepen: klaar, komt op tijd klaar, en vorige stap niet op tijd (D52).
    const groep = (x: Kandidaat) =>
      nietOpTijd(x.vorige) ? 2 : x.klaar || !x.vorige || x.vorige.stand === "klaar" || x.vorige.stand === "eerste" ? 0 : 1;
    const GROEPEN = ["Staat klaar", `Komt op tijd klaar voor ${dagNaam(d)}`, "Vorige stap niet op tijd"];
    k = [...k].sort((a, b) => groep(a) - groep(b));
    const gekozen = await kiesUit(`Toevoegen aan ${s.code} ${s.naam}`,
      "Je kunt alles plannen, ook als de vorige stap nog niet klaar is. Dan zie je een waarschuwing.",
      k.map((x) => ({ waarde: x.nummer, tekst: itemNaam(x), groep: GROEPEN[groep(x)], waarschuwing: groep(x) === 2,
        let_op: groep(x) === 2 ? vorigeTekst(x.vorige) : undefined,
        uitleg: [groep(x) === 2 ? null : x.klaar ? "Staat nu in de werkvoorraad" : vorigeTekst(x.vorige), x.toelichting].filter(Boolean).join(". ") })));
    if (!gekozen?.length) return;
    const metWaarschuwing = k.filter((x) => gekozen.includes(x.nummer) && groep(x) === 2).length;
    await bewaar([...huidig(), ...gekozen.map((nummer) => ({ nummer, opmerking: null }))],
      (gekozen.length === 1 ? `${itemNaam({ soort: k[0].soort, nummer: gekozen[0] })} toegevoegd` : `${gekozen.length} toegevoegd`) +
      (metWaarschuwing ? `; let op: bij ${metWaarschuwing === 1 ? "één" : metWaarschuwing} is de vorige stap niet op tijd` : ""));
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

  const metWaarschuwingIn = (x: StapPlan) => x.items.filter((i) => i.status === "gepland" && nietOpTijd(i.vorige)).length;
  const lijstLink = (x: StapPlan) =>
    h("a", { href: `#/planning/dag/${d}/${x.code}`, "aria-current": x.code === s.code ? "page" : undefined },
      h("span", { class: "code" }, x.code), h("span", { class: "groei" }, x.naam),
      metWaarschuwingIn(x) ? h("span", { class: "plan-waarschuwing", title: "Vorige stap niet op tijd", "aria-label": `${metWaarschuwingIn(x)} met waarschuwing` }, "⚠") : null,
      (x.capaciteit?.procent ?? 0) > 100 ? h("span", { class: "plan-waarschuwing", title: "Boven de capaciteit", "aria-label": `${x.capaciteit!.procent} % van de capaciteit` }, `${x.capaciteit!.procent} %`) : null,
      x.items.length ? h("span", { class: "teller-licht" }, x.items.length) : null);

  toon(
    kop(dagNaam(d).replace(/^./, (c) => c.toUpperCase()),
      "Per stap wat er die dag moet gebeuren, in volgorde. Operators zien dit bovenaan in het invoerscherm.",
      h("div", { class: "knoppen-klein" },
        h("a", { class: "knop knop-stil", href: `#/planning/dag/${plusDagen(d, -1)}/${s.code}` }, "Vorige dag"),
        h("a", { class: "knop knop-stil", href: `#/planning/dag/${isoDag()}/${s.code}` }, "Vandaag"),
        h("a", { class: "knop knop-stil", href: `#/planning/dag/${plusDagen(d, 1)}/${s.code}` }, "Volgende dag"),
        h("a", { class: "knop knop-stil", href: `#/planning/week/${d}` }, "Naar Batches plannen"))),
    h("div", { class: "beheer-indeling" },
      h("nav", { class: "stappenlijst", "aria-label": "Stappen" },
        h("div", { class: "lijstkop" }, "Per batch"), stappen.filter((x) => x.niveau === "batch").map(lijstLink),
        h("div", { class: "lijstkop" }, "Per lot"), stappen.filter((x) => x.niveau === "lot").map(lijstLink)),
      h("section", { class: "blok", style: "margin-top:0" },
        h("div", { class: "kop" },
          h("div", {}, h("h2", { style: "margin:0" }, `${s.code} ${s.naam}`),
            h("p", { class: "sub" }, s.is_lot_stap ? "Hier worden 4 batches één lot. Je plant een lotvoorstel." : s.niveau === "lot" ? "Per lot" : "Per batch"),
            capaciteitRegel(s.capaciteit, s.niveau === "lot" ? "lot" : "batch")),
          kanWijzigen ? h("button", { class: "knop knop-hoofd", onclick: toevoegen }, s.is_lot_stap ? "Lotvoorstel toevoegen" : "Toevoegen") : null),
        s.items.length
          ? tabel(["", s.is_lot_stap ? "Lotvoorstel" : s.niveau === "lot" ? "Lot" : "Batch", "Stand", "Opmerking", ""], s.items.map((i, n) => [
              h("span", { class: "getal sub" }, n + 1),
              h("span", {}, h("strong", {}, itemNaam(i)), i.batches.length ? h("div", { class: "sub" }, i.batches.join(", ")) : null),
              h("span", {}, h("span", { class: `stand stand-${i.status}` }, STAND[i.status]),
                i.status === "gepland" && nietOpTijd(i.vorige) ? h("div", {}, waarschuwing(vorigeTekst(i.vorige))) : null),
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

// ---------- Proef: Dagoverzicht en Batchroute (D52) ----------
// Twee overzichten om naast elkaar te proberen. Geert kiest er één; de andere gaat er weer uit.
const proefMelding = () =>
  h("p", { class: "proef-melding" }, h("strong", {}, "Proef. "),
    "Dit overzicht en de Batchroute (of het Dagoverzicht) staan er allebei om te vergelijken. Na de keuze blijft er één over.");

export async function overzicht(datum?: string) {
  const actueel = vastHouden();
  const d = geldigeDag(datum) ?? isoDag();
  toon(kop("Dagoverzicht"), laden());
  let stappen: StapPlan[];
  try { stappen = await haal<StapPlan[]>(`/planning/stappen?dag=${d}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const letOp = (i: PlanItem) => i.status === "gepland" && nietOpTijd(i.vorige);
  const aantal = stappen.reduce((n, s) => n + s.items.length, 0);
  const metWaarschuwing = stappen.reduce((n, s) => n + s.items.filter(letOp).length, 0);
  toon(
    kop(dagNaam(d).replace(/^./, (c) => c.toUpperCase()),
      "Alle stappen van één dag onder elkaar, met wat er gepland is, in volgorde.",
      h("div", { class: "knoppen-klein" },
        h("a", { class: "knop knop-stil", href: `#/planning/overzicht/${plusDagen(d, -1)}` }, "Vorige dag"),
        h("a", { class: "knop knop-stil", href: `#/planning/overzicht/${isoDag()}` }, "Vandaag"),
        h("a", { class: "knop knop-stil", href: `#/planning/overzicht/${plusDagen(d, 1)}` }, "Volgende dag"))),
    proefMelding(),
    h("p", {}, `${aantal} gepland in ${stappen.filter((s) => s.items.length).length} van ${stappen.length} stappen`,
      metWaarschuwing ? [". ", waarschuwing(`${metWaarschuwing} met een vorige stap die niet op tijd is`)] : "."),
    h("section", { class: "blok" },
      h("table", { class: "tabel dagoverzicht" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Stap (klik om te wijzigen)"), h("th", { scope: "col" }, "Gepland, in volgorde"))),
        h("tbody", {}, stappen.map((s) =>
          h("tr", { class: s.items.length ? undefined : "leeg-rij" },
            h("th", { scope: "row" }, h("a", { href: `#/planning/dag/${d}/${s.code}` }, h("span", { class: "code" }, s.code), " ", s.naam),
              s.capaciteit && s.capaciteit.regels.length
                ? h("div", { class: s.capaciteit.procent > 100 || s.capaciteit.dicht ? "te-vol-tekst" : "sub" },
                    s.capaciteit.dicht ? "⚠ Dicht voor wat er gepland is" : `${s.capaciteit.procent > 100 ? "⚠ " : ""}${s.capaciteit.procent} % van de capaciteit`)
                : null),
            h("td", {}, s.items.length
              ? h("ol", { class: "dag-items" }, s.items.map((i) =>
                  h("li", {}, h("strong", {}, itemNaam(i)), " ", h("span", { class: `stand stand-${i.status}` }, STAND[i.status]),
                    letOp(i) ? h("div", {}, waarschuwing(vorigeTekst(i.vorige))) : null)))
              : h("span", { class: "sub" }, "Niets gepland")))))),
    ),
  );
}

interface RouteCel { stap: string; stand: "klaar" | "bezig" | "gepland" | "niet_in_route" | null; dag: string | null; waarschuwing: string | null }
interface Route {
  stappen: { code: string; naam: string; is_lot_stap: boolean }[];
  batches: { batchnummer: string; status: string; product: string | null; startdag: string | null; voorstel: number | null; cellen: RouteCel[] }[];
}

export async function route(filter?: string) {
  const actueel = vastHouden();
  toon(kop("Batchroute"), laden());
  let r: Route;
  try { r = await haal<Route>("/planning/route"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const alleenLetOp = filter === "let-op";
  const letOp = r.batches.filter((b) => b.cellen.some((c) => c.waarschuwing));
  const batches = alleenLetOp ? letOp : r.batches;
  const cel = (c: RouteCel) => {
    if (!c.stand) return h("td", { class: "route-leeg" }, h("span", { "aria-hidden": "true" }, "–"), h("span", { class: "verborgen" }, "niet gepland"));
    if (c.stand === "niet_in_route") return h("td", { class: "route-buiten" }, h("span", { class: "verborgen" }, "hoort niet bij de route"));
    if (c.stand === "klaar") return h("td", { class: "route-klaar" }, h("span", { "aria-hidden": "true" }, "✓ "), c.dag ? korteDag(c.dag) : "klaar", h("span", { class: "verborgen" }, " klaar"));
    if (c.stand === "bezig") return h("td", { class: "route-bezig" }, h("span", { "aria-hidden": "true" }, "▶ "), "bezig");
    return h("td", { class: c.waarschuwing ? "route-let-op" : "route-gepland", title: c.waarschuwing ?? undefined },
      h("a", { href: `#/planning/dag/${c.dag}/${c.stap}` },
        c.waarschuwing ? h("span", { "aria-hidden": "true" }, "⚠ ") : null, korteDag(c.dag!),
        h("span", { class: "verborgen" }, c.waarschuwing ? ` gepland, let op: ${c.waarschuwing}` : " gepland")));
  };
  const batchStappen = r.stappen.filter((s) => !s.is_lot_stap);
  const lotStap = r.stappen.find((s) => s.is_lot_stap);
  toon(
    kop("Batchroute", "Per batch die nog niet in een lot zit: welke stap klaar is, welke bezig is en wanneer de rest gepland staat. Klik op een geplande dag om die stap te wijzigen."),
    proefMelding(),
    h("div", { class: "filters" },
      h("a", { class: `knop knop-klein ${alleenLetOp ? "knop-stil" : "knop-hoofd"}`, href: "#/planning/route", "aria-current": alleenLetOp ? undefined : "page" }, `Alle batches (${r.batches.length})`),
      h("a", { class: `knop knop-klein ${alleenLetOp ? "knop-hoofd" : "knop-stil"}`, href: "#/planning/route/let-op", "aria-current": alleenLetOp ? "page" : undefined }, `Met waarschuwing (${letOp.length})`)),
    h("p", { class: "legenda route-legenda" },
      h("span", {}, "✓ klaar"), h("span", {}, "▶ bezig"), h("span", {}, "ma 23-11 gepland"),
      h("span", { class: "plan-waarschuwing" }, "⚠ vorige stap niet op tijd"), h("span", {}, "– niet gepland"),
      h("span", {}, h("span", { class: "route-buiten route-buiten-staal", "aria-hidden": "true" }), " niet in de route van het product")),
    batches.length
      ? h("div", { class: "route-scroll", tabindex: "0", role: "region", "aria-label": "Batchroute, schuift opzij" },
          h("table", { class: "tabel route-tabel" },
            h("thead", {}, h("tr", {},
              h("th", { scope: "col" }, "Batch"),
              batchStappen.map((s) => h("th", { scope: "col", title: s.naam }, s.code)),
              lotStap ? h("th", { scope: "col", title: lotStap.naam }, `${lotStap.code} lot`) : null)),
            h("tbody", {}, batches.map((b) =>
              h("tr", {},
                h("th", { scope: "row" }, h("strong", {}, b.batchnummer), h("div", { class: "sub" }, [b.product, b.status === "gepland" && b.startdag ? `start ${korteDag(b.startdag)}` : null].filter(Boolean).join(" · "))),
                batchStappen.map((s) => cel(b.cellen.find((c) => c.stap === s.code) ?? { stap: s.code, stand: null, dag: null, waarschuwing: null })),
                lotStap ? h("td", { class: b.voorstel ? "route-gepland" : "route-leeg" }, b.voorstel ? `Voorstel ${b.voorstel}` : "–") : null)))))
      : h("p", { class: "leeg" }, alleenLetOp ? "Geen batches met een waarschuwing." : "Er zijn geen batches die nog niet in een lot zitten."),
  );
}

/** Venster met vinkjes; geeft de gekozen waarden terug, of null. */
function kiesUit(titel: string, uitleg: string, opties: { waarde: string; tekst: string; uitleg?: string; groep?: string; waarschuwing?: boolean; let_op?: string }[], precies?: number, gekozen: string[] = []) {
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
      h("div", { class: "keuzelijst" }, opties.flatMap((o, i) => [
        o.groep && o.groep !== opties[i - 1]?.groep
          ? h("div", { class: `keuzegroep${o.waarschuwing ? " keuzegroep-let-op" : ""}` }, o.waarschuwing ? h("span", { "aria-hidden": "true" }, "⚠ ") : null, o.groep)
          : null,
        h("label", {}, vinken[i], h("span", {}, h("strong", {}, o.tekst),
          o.let_op ? h("span", { class: "plan-waarschuwing" }, ` ${o.let_op}.`) : null,
          o.uitleg ? h("span", { class: "sub" }, ` ${o.uitleg}`) : null)),
      ])),
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

// ---------- Producten en hun route (D55) ----------
interface StapKort { code: string; naam: string; volgorde: number; niveau: "batch" | "lot"; is_lot_stap: boolean; soort?: "proces" | "keuring" }

/** Korte beschrijving van een route ten opzichte van alle processtappen: "Alle stappen" of
 *  "15 stappen, zonder PS6 en PS14, met keuringen TK1 en EK". Keuringsstappen (#80) staan apart. */
function routeSamenvatting(route: string[] | null | undefined, alle: StapKort[]): string {
  if (!route) return "Alle stappen";
  const keuring = new Set(alle.filter((s) => s.soort === "keuring").map((s) => s.code));
  const proces = route.filter((c) => !keuring.has(c));
  const keuringen = route.filter((c) => keuring.has(c));
  const alleProces = alle.filter((s) => !keuring.has(s.code));
  const zonder = alleProces.filter((s) => !proces.includes(s.code)).map((s) => s.code);
  const natuurlijk = alleProces.filter((s) => proces.includes(s.code)).map((s) => s.code);
  const anders = natuurlijk.some((c, i) => c !== proces[i]);
  const lijst = (x: string[]) => (x.length > 1 ? `${x.slice(0, -1).join(", ")} en ${x[x.length - 1]}` : x[0]);
  return [`${proces.length} stappen`, zonder.length ? `zonder ${lijst(zonder)}` : null, anders ? "eigen volgorde" : null,
    keuringen.length ? `met ${keuringen.length === 1 ? "keuring" : "keuringen"} ${lijst(keuringen)}` : null].filter(Boolean).join(", ");
}

export async function producten(code?: string) {
  if (code) return routeBewerken(code);
  const actueel = vastHouden();
  toon(kop("Producten"), laden());
  let p: Product[], alle: StapKort[];
  try { [p, alle] = await Promise.all([haal<Product[]>("/planning/producten?ookInactief=true"), haal<StapKort[]>("/config/stappen")]); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const toevoegen = async () => {
    const r = await vraag("Product toevoegen", [
      { naam: "code", label: "Code", hint: "Kort, zonder spaties. Bijvoorbeeld PRD-D", controle: (v) => (/^[A-Za-z0-9._-]{1,20}$/.test(v) ? null : "Alleen letters, cijfers, punt, streepje of liggend streepje; hoogstens 20 tekens") },
      { naam: "naam", label: "Naam" },
    ], "Toevoegen", "De code ligt daarna vast; de naam kun je later wijzigen. Een nieuw product doorloopt alle stappen tot je een eigen route kiest.");
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
    kop("Producten", "Het product of recept dat je bij een batch plant, en de route: welke stappen het doorloopt en in welke volgorde. Een uitgezet product kun je niet meer kiezen; eerdere batches houden het.",
      magPlannen() ? h("button", { class: "knop knop-hoofd", onclick: toevoegen }, "Product toevoegen") : null),
    p.length
      ? tabel(["Code", "Naam", "Route", ""], p.map((x) => [
          h("strong", { class: x.actief ? "" : "inactief" }, x.code),
          h("span", { class: x.actief ? "" : "inactief" }, x.naam, x.actief ? "" : " (uit)"),
          h("span", { class: "product-route", title: x.route ? x.route.join(" → ") : undefined }, routeSamenvatting(x.route, alle)),
          h("div", { class: "knoppen-klein" },
            x.actief ? h("a", { class: "knop knop-klein", href: `#/planning/producten/${encodeURIComponent(x.code)}` }, magPlannen() ? "Route wijzigen" : "Route bekijken") : null,
            magPlannen() && x.actief ? h("button", { class: "knop knop-klein", onclick: () => hernoem(x) }, "Naam wijzigen") : null,
            magPlannen() ? h("button", { class: "knop knop-klein knop-stil", onclick: () => zetActief(x, !x.actief) }, x.actief ? "Uitzetten" : "Weer aanzetten") : null)]), "compact")
      : h("p", { class: "leeg" }, "Nog geen producten. Voeg er een toe."),
  );
}

/** Route van één product: stappen erin of eruit, en de volgorde. Eerst batchstappen, dan de lotstap, dan lotstappen. */
async function routeBewerken(code: string) {
  const actueel = vastHouden();
  toon(kop(`Route van ${code}`), laden());
  let p: Product[], alle: StapKort[];
  try { [p, alle] = await Promise.all([haal<Product[]>("/planning/producten"), haal<StapKort[]>("/config/stappen")]); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const product = p.find((x) => x.code === code);
  if (!product) return fout(new Error(`Product ${code} bestaat niet of staat uit`));
  const bewerken = magPlannen();
  const lotstap = alle.find((s) => s.is_lot_stap);
  const stap = new Map(alle.map((s) => [s.code, s]));
  // De standaardroute: alle processtappen, zonder keuringsstappen (#80); die voeg je per product toe.
  let route = (product.route ?? alle.filter((s) => s.soort !== "keuring").map((s) => s.code)).filter((c) => stap.has(c));
  let gewijzigd = false;
  const groep = (c: string) => (stap.get(c)!.niveau === "batch" ? 0 : stap.get(c)!.is_lot_stap ? 1 : 2);
  const verplaats = (c: string, richting: -1 | 1) => {
    const i = route.indexOf(c), j = i + richting;
    if (j < 0 || j >= route.length || groep(route[j]) !== groep(c)) return;
    [route[i], route[j]] = [route[j], route[i]];
    gewijzigd = true;
    teken(`${c} ${richting < 0 ? "eerder" : "later"}`, [`${c} ${richting < 0 ? "eerder" : "later"}`, `${c} ${richting < 0 ? "later" : "eerder"}`]);
  };
  const weg = (c: string) => { route = route.filter((x) => x !== c); gewijzigd = true; teken(`${c} weggehaald`, [`${c} toevoegen aan de route`]); };
  const erbij = (c: string) => {
    // Op de natuurlijke plek: na de laatste gekozen stap van hetzelfde niveau met een lager stapnummer.
    const s = stap.get(c)!;
    let plek = route.findIndex((x) => groep(x) > groep(c) || (groep(x) === groep(c) && stap.get(x)!.volgorde > s.volgorde));
    if (plek < 0) plek = route.length;
    route.splice(plek, 0, c);
    gewijzigd = true;
    teken(`${c} toegevoegd`, [`${c} weghalen uit de route`]);
  };
  const standaard = () => alle.filter((s) => s.soort !== "keuring").map((s) => s.code);
  const isStandaard = () => route.length === standaard().length && route.every((c, i) => c === standaard()[i]);
  const status = h("p", { class: "verborgen", "aria-live": "polite" });

  const rij = (c: string, nr: number) => {
    const s = stap.get(c)!;
    const i = route.indexOf(c);
    const eerderKan = i > 0 && groep(route[i - 1]) === groep(c);
    const laterKan = i < route.length - 1 && groep(route[i + 1]) === groep(c);
    return h("li", { class: "route-rij" },
      h("span", { class: "route-nr", "aria-hidden": "true" }, String(nr)),
      h("span", { class: "route-stap" }, h("strong", {}, s.code), ` ${s.naam}`),
      bewerken && !s.is_lot_stap
        ? h("span", { class: "knoppen-klein" },
            h("button", { class: "knop knop-klein knop-stil", disabled: !eerderKan, "aria-label": `${s.code} eerder`, onclick: () => verplaats(c, -1) }, h("span", { "aria-hidden": "true" }, "↑ "), "Eerder"),
            h("button", { class: "knop knop-klein knop-stil", disabled: !laterKan, "aria-label": `${s.code} later`, onclick: () => verplaats(c, 1) }, h("span", { "aria-hidden": "true" }, "↓ "), "Later"),
            h("button", { class: "knop knop-klein knop-stil", "aria-label": `${s.code} weghalen uit de route`, onclick: () => weg(c) }, "Weghalen"))
        : s.is_lot_stap ? h("span", { class: "sub" }, "Altijd in de route: hier worden 4 batches één lot") : null);
  };

  const opslaan = async () => {
    const stappen = isStandaard() ? null : route;
    try {
      await stuur("PUT", `/planning/producten/${product.id}/route`, { stappen });
      melding(`Route van ${code} opgeslagen`, "ok");
      location.hash = "#/planning/producten";
    } catch (e) {
      melding((e as Error).message, "fout");
    }
  };

  /** Tekent het scherm opnieuw; zet de focus op de eerste knop uit `focus` die werkt, zodat toetsenbordgebruikers hun plek houden. */
  function teken(gemeld?: string, focus: string[] = []) {
    const batch = route.filter((c) => groep(c) === 0);
    const lot = route.filter((c) => groep(c) === 2);
    const buiten = alle.filter((s) => !route.includes(s.code));
    toon(
      kop(`Route van ${code}`,
        `${product!.naam}. Welke stappen dit product doorloopt en in welke volgorde. Eerst de batchstappen, dan ${lotstap?.code ?? "de lotstap"} (4 batches worden één lot), dan de lotstappen. ` +
        "Lopende batches van dit product volgen een gewijzigde route meteen; wat al gedaan is, blijft staan.",
        h("a", { class: "knop knop-stil", href: "#/planning/producten" }, "Terug naar producten")),
      h("p", { class: "sub" }, isStandaard() ? "Nu: alle processtappen (de standaardroute), zonder keuringen." : `Nu: ${routeSamenvatting(route, alle)}.`),
      h("section", { class: "blok" }, h("h2", {}, `Batchstappen (${batch.length})`),
        batch.length ? h("ol", { class: "routelijst" }, batch.map((c, i) => rij(c, i + 1))) : h("p", { class: "leeg" }, "Kies minstens één batchstap.")),
      h("section", { class: "blok" }, h("h2", {}, "Lot samenstellen"),
        h("ol", { class: "routelijst", start: batch.length + 1 }, route.filter((c) => groep(c) === 1).map((c) => rij(c, batch.length + 1)))),
      h("section", { class: "blok" }, h("h2", {}, `Lotstappen (${lot.length})`),
        lot.length ? h("ol", { class: "routelijst", start: batch.length + 2 }, lot.map((c, i) => rij(c, batch.length + 2 + i))) : h("p", { class: "leeg" }, "Geen lotstappen na het samenstellen.")),
      buiten.length
        ? h("section", { class: "blok" }, h("h2", {}, `Niet in de route (${buiten.length})`),
            h("ul", { class: "routelijst routelijst-buiten" }, buiten.map((s) => h("li", { class: "route-rij" },
              h("span", { class: "route-stap" }, h("strong", {}, s.code), ` ${s.naam}`,
                s.soort === "keuring" ? h("span", { class: "sub" }, " · keuring door Kwaliteit; komt achteraan, zet hem met Eerder op zijn plek") : null),
              bewerken ? h("button", { class: "knop knop-klein", "aria-label": `${s.code} toevoegen aan de route`, onclick: () => erbij(s.code) }, "Toevoegen") : null))))
        : null,
      bewerken
        ? h("div", { class: "knoppen knoppen-links" },
            h("button", { class: "knop knop-hoofd", disabled: !gewijzigd, onclick: opslaan }, "Route opslaan"),
            !isStandaard() ? h("button", { class: "knop knop-stil", onclick: () => { route = standaard(); gewijzigd = true; teken("Alle processtappen gekozen"); } }, "Alle stappen kiezen") : null,
            h("a", { class: "knop knop-stil", href: "#/planning/producten" }, "Annuleren"))
        : null,
      status,
    );
    if (gemeld) status.textContent = gemeld;
    for (const label of focus) {
      const knop = [...document.querySelectorAll<HTMLButtonElement>("main button[aria-label]")].find((b) => b.getAttribute("aria-label") === label && !b.disabled);
      if (knop) { knop.focus(); break; }
    }
  }
  teken();
}

// ---------- Capaciteit ----------
interface CapRegel { product: string; productnaam: string; stap: string; stapnaam: string; niveau: string; max_per_dag: number | null }
interface Capaciteit {
  per_stap: CapRegel[];
  nog_invullen: number;
  afwijkingen: Afwijking[];
}

export async function capaciteit() {
  const actueel = vastHouden();
  toon(kop("Capaciteit"), laden());
  let c: Capaciteit;
  try { c = await haal<Capaciteit>("/planning/capaciteit"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  toon(
    kop("Capaciteit", "Wat elke stap per dag aankan, per product, elke dag van de week, in de volgorde van de route. Elke stap uit de route staat hier vanzelf; zonder capaciteit staat hij op \"nog invullen\". De eerste stap bepaalt hoeveel batches van een product per dag kunnen starten. Plannen boven de capaciteit kan, maar je krijgt een waarschuwing."),
    ...capaciteitPerStap(c.per_stap, c.nog_invullen),
    afwijkendeDagen(c.afwijkingen),
  );
}

/** Afwijkende dagen (D69): in een periode kan een product en/of stap minder aan, als percentage; 0 % = geen productie. */
function afwijkendeDagen(lijst: Afwijking[]) {
  const toevoegen = async () => {
    let stappen: StapKort[], prod: Product[];
    try { [stappen, prod] = await Promise.all([haal<StapKort[]>("/config/stappen"), haal<Product[]>("/planning/producten")]); } catch (e) { return melding((e as Error).message, "fout"); }
    const r = await vraag("Afwijkende capaciteit", [
      { naam: "van", label: "Van", type: "date", waarde: isoDag() },
      { naam: "tot", label: "Tot en met", type: "date", optioneel: true, hint: "Leeg = alleen de dag hierboven" },
      { naam: "product", label: "Product", opties: [["*", "Alle producten"] as [string, string], ...prod.map((x): [string, string] => [x.code, `${x.code} – ${x.naam}`])] },
      { naam: "stap", label: "Stap", opties: [["*", "Alle stappen"] as [string, string], ...stappen.map((x): [string, string] => [x.code, `${x.code} ${x.naam}`])] },
      { naam: "procent", label: "Capaciteit (%)", type: "number", waarde: "0", hint: "Deel van de gewone capaciteit. 0 = geen productie, 50 = de helft",
        controle: (v: string) => (/^\d+$/.test(v) && +v <= 100 ? null : "Een heel getal van 0 tot 100") },
      { naam: "reden", label: "Reden", hint: "Bijvoorbeeld feestdag, onderhoud lijn 2 of korte dag",
        controle: (v: string) => (v.trim().length < 2 ? "Geef een reden" : v.length > 200 ? "Hoogstens 200 tekens" : null) },
    ], "Opslaan", "Gelden er op een dag meer afwijkingen voor dezelfde stap en hetzelfde product, dan telt het laagste percentage.");
    if (!r) return;
    if (r.tot && r.tot < r.van) return melding("Tot en met ligt vóór Van", "fout");
    await wijzig(() => stuur("POST", "/planning/capaciteit/afwijkingen", {
      van: r.van, tot: r.tot || undefined, product: r.product === "*" ? null : r.product, stap: r.stap === "*" ? null : r.stap, procent: Number(r.procent), reden: r.reden.trim(),
    }), "Afwijking opgeslagen", capaciteit);
  };
  const periode = (a: Afwijking) => (a.van === a.tot ? dagNaam(a.van, false) : `${dagNaam(a.van, false)} t/m ${dagNaam(a.tot, false)}`);
  return h("section", { class: "blok" },
    h("div", { class: "kop" },
      h("div", {}, h("h2", { style: "margin:0" }, "Afwijkende dagen"),
        h("p", { class: "sub" }, "Feestdagen, onderhoud of een korte dag: voor alle producten of één product, voor alle stappen of één stap.")),
      magPlannen() ? h("button", { class: "knop", onclick: toevoegen }, "Afwijking toevoegen") : null),
    lijst.length
      ? tabel(["Periode", "Product", "Stap", "Capaciteit", "Reden", ""], lijst.map((a) => [
          periode(a), a.product ?? "Alle producten", a.stap ?? "Alle stappen",
          h("span", { class: "getal" }, a.procent === 0 ? "Geen productie" : `${a.procent} %`), a.reden,
          magPlannen() ? h("button", { class: "knop knop-klein knop-stil", "aria-label": `Afwijking ${periode(a)} ${a.reden} weghalen`, onclick: () =>
            wijzig(() => stuur("POST", `/planning/capaciteit/afwijkingen/${a.id}/weghalen`), "Weggehaald", capaciteit) }, "Weghalen") : null]), "compact")
      : h("p", { class: "leeg" }, "Geen afwijkende dagen."));
}

/** Capaciteit per product (D55, D71): elke stap van de route vanzelf in de lijst; ontbreekt de capaciteit, dan "nog invullen" (#81). */
function capaciteitPerStap(regels: CapRegel[], nogInvullen: number): (Node | null)[] {
  const eenheid = (x: CapRegel) => (x.niveau === "lot" ? "Lots per dag" : "Batches per dag");
  const perDag = (v: string) => (/^\d+$/.test(v) && +v >= 1 && +v <= 500 ? null : "Een heel getal van 1 tot 500");
  const opslaan = (x: CapRegel, max: number | null) =>
    stuur("PUT", `/planning/capaciteit/stappen/${x.stap}`, { product: x.product, max_per_dag: max });
  const zet = async (x: CapRegel) => {
    const r = await vraag(`Capaciteit ${x.stap} voor ${x.product}`, [
      { naam: "max", label: eenheid(x), type: "number", waarde: x.max_per_dag === null ? "" : String(x.max_per_dag), controle: perDag },
    ], "Opslaan", "Draaien er producten door elkaar, dan telt elk item voor zijn deel: 6 van A (max 8) en 1 van B (max 3) is 108 %.");
    if (!r) return;
    await wijzig(() => opslaan(x, Number(r.max)), "Capaciteit opgeslagen", capaciteit);
  };
  /** Alle open stappen van één product in één venster; wat leeg blijft, blijft op "nog invullen". */
  const vulIn = async (product: string, open: CapRegel[]) => {
    const r = await vraag(`Capaciteit invullen voor ${product}`, open.map((x) => ({
      naam: x.stap, label: `${x.stap} ${x.stapnaam}`, type: "number", optioneel: true, hint: eenheid(x), controle: perDag,
    })), "Opslaan", "Vul in wat je weet; wat leeg blijft, staat daarna nog op \"nog invullen\".");
    if (!r) return;
    const ingevuld = open.filter((x) => r[x.stap]);
    if (!ingevuld.length) return;
    await wijzig(async () => { for (const x of ingevuld) await opslaan(x, Number(r[x.stap])); },
      `${ingevuld.length === 1 ? "1 stap" : `${ingevuld.length} stappen`} opgeslagen`, capaciteit);
  };
  const weg = (x: CapRegel) => wijzig(() => opslaan(x, null), "Weggehaald", capaciteit);
  const producten = [...new Set(regels.map((x) => x.product))];
  // Eén blok per product, zodat "Naar Excel" en "Invullen" in de kopregel van dat product staan (D63).
  return [
    nogInvullen
      ? h("p", { class: "blok let-op-blok", role: "status" }, h("span", { "aria-hidden": "true" }, "⚠ "),
          `${nogInvullen === 1 ? "1 stap heeft" : `${nogInvullen} stappen hebben`} nog geen capaciteit. Zonder capaciteit kan de planning niet waarschuwen als een stap te vol zit.`)
      : null,
    ...(producten.length
      ? producten.map((p) => {
          const rijen = regels.filter((x) => x.product === p);
          const open = rijen.filter((x) => x.max_per_dag === null);
          return h("section", { class: "blok cap-product" },
            h("div", { class: "kop" },
              h("div", {}, h("h2", { style: "margin:0" }, `${p} – ${rijen[0].productnaam}`),
                h("p", { class: open.length ? "label-nog-invullen" : "sub" }, open.length ? `${open.length === 1 ? "1 stap" : `${open.length} stappen`} nog invullen` : "Alle stappen van de route ingevuld")),
              magPlannen() && open.length ? h("button", { class: "knop", onclick: () => vulIn(p, open) }, `Invullen voor ${p}`) : null),
            tabel(["Stap", "Per dag", ""], rijen.map((x) => [
              h("span", {}, h("strong", {}, x.stap), ` ${x.stapnaam}`),
              x.max_per_dag === null
                ? h("span", { class: "getal label-nog-invullen" }, "Nog invullen")
                : h("span", { class: "getal" }, `${x.max_per_dag} ${x.niveau === "lot" ? (x.max_per_dag === 1 ? "lot" : "lots") : (x.max_per_dag === 1 ? "batch" : "batches")}`),
              magPlannen()
                ? h("div", { class: "knoppen-klein" },
                    h("button", { class: "knop knop-klein", "aria-label": `Capaciteit ${x.stap} ${x.product} ${x.max_per_dag === null ? "invullen" : "wijzigen"}`, onclick: () => zet(x) },
                      x.max_per_dag === null ? "Invullen" : "Wijzigen"),
                    x.max_per_dag === null ? null
                      : h("button", { class: "knop knop-klein knop-stil", "aria-label": `Capaciteit ${x.stap} ${x.product} weghalen`, onclick: () => weg(x) }, "Weghalen"))
                : null]), "compact"));
        })
      : [h("p", { class: "blok leeg" }, "Nog geen actieve producten. Maak ze aan bij Planning → Producten.")]),
  ];
}
