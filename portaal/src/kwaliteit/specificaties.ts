// Portaal Kwaliteit → Specificaties (#80, D73): per product en keuringsstap (tussenkeuring TK, eindkeuring EK)
// waar het product aan moet voldoen, met versies. Een nieuwe versie begint als concept en geldt pas na vaststellen.
import { bevestig, h, laden, melding, toon, vastHouden, vraag, type VraagVeld } from "../../../gedeeld/ui";
import { toonGetal } from "../../../gedeeld/markering";
import { gekozenProduct, haal, producten, sessie, stuur } from "../basis";
import { fout, kop, kort, tabel } from "./schermen";

interface Regel { veld: string; grens_min: number | null; grens_max: number | null }
interface Versie {
  id: string; versie: number; status: "concept" | "vastgesteld" | "vervallen"; opmerking: string | null;
  aangemaakt_door: string | null; vastgesteld_door: string | null; vastgesteld_op: string | null; regels: Regel[];
}
interface SpecStap {
  stap: string; stapnaam: string; niveau: string;
  velden: { code: string; naam: string; eenheid: string | null }[];
  geldig: Versie | null; concept: Versie | null; eerder: Versie[];
}
interface Specificaties { product: string; productnaam: string; stappen: SpecStap[] }

const magBeheren = () => sessie.rol === "kwaliteit" || sessie.rol === "beheerder";

/** "≤ 4", "150 – 350", "≥ 5" of "–". */
function grens(r: Regel | undefined, eenheid: string | null): string {
  if (!r) return "–";
  const e = eenheid ? ` ${eenheid}` : "";
  if (r.grens_min !== null && r.grens_max !== null) return `${toonGetal(r.grens_min)} – ${toonGetal(r.grens_max)}${e}`;
  if (r.grens_max !== null) return `≤ ${toonGetal(r.grens_max)}${e}`;
  return `≥ ${toonGetal(r.grens_min)}${e}`;
}

const getal = (t: string): number | null => (t.trim() === "" ? null : Number(t.trim().replace(",", ".")));

export async function specificaties(productArg?: string) {
  const actueel = vastHouden();
  toon(kop("Specificaties"), laden());
  let lijst: { code: string; naam: string }[];
  try { lijst = await producten(); } catch (e) { return fout(e); }
  const product = productArg && lijst.some((p) => p.code === productArg) ? productArg : gekozenProduct.code ?? lijst[0]?.code;
  if (!product) return toon(kop("Specificaties"), h("p", { class: "leeg" }, "Nog geen producten. Maak ze aan bij Planning → Producten."));
  let sp: Specificaties;
  try { sp = await haal<Specificaties>(`/specificaties?product=${encodeURIComponent(product)}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const opnieuw = () => void specificaties(product);

  const kiezer = h("select", { id: "spec-product", onchange: (e: Event) => { location.hash = `#/kwaliteit/specificaties/${encodeURIComponent((e.target as HTMLSelectElement).value)}`; } },
    lijst.map((p) => h("option", { value: p.code, selected: p.code === product }, `${p.code} – ${p.naam}`)));

  const bewerk = async (s: SpecStap, c: Versie) => {
    const velden: VraagVeld[] = s.velden.flatMap((v) => {
      const r = c.regels.find((x) => x.veld === v.code);
      const e = v.eenheid ? ` (${v.eenheid})` : "";
      return [
        { naam: `${v.code}-min`, label: `${v.code} ${v.naam}: minimum${e}`, type: "getal", optioneel: true, waarde: r?.grens_min === null || !r ? "" : String(r.grens_min) },
        { naam: `${v.code}-max`, label: `${v.code} ${v.naam}: maximum${e}`, type: "getal", optioneel: true, waarde: r?.grens_max === null || !r ? "" : String(r.grens_max) },
      ];
    });
    velden.push({ naam: "opmerking", label: "Opmerking", type: "tekstvak", optioneel: true, maxLengte: 500, waarde: c.opmerking ?? "",
      hint: "Bijvoorbeeld waarom deze versie anders is" });
    const r = await vraag(`${s.stap} ${s.stapnaam}, versie ${c.versie} (concept)`, velden, "Opslaan",
      "Laat minimum en maximum leeg voor een eigenschap die niet in de specificatie hoort.");
    if (!r) return;
    const regels = s.velden.map((v) => ({ veld: v.code, grens_min: getal(r[`${v.code}-min`]), grens_max: getal(r[`${v.code}-max`]) }));
    const fouten = regels.filter((x) => x.grens_min !== null && x.grens_max !== null && x.grens_min > x.grens_max).map((x) => x.veld);
    if (fouten.length) return melding(`Het minimum is groter dan het maximum: ${fouten.join(", ")}`, "fout");
    try {
      await stuur("PUT", `/specificaties/${c.id}`, { regels, opmerking: r.opmerking || null });
      melding("Concept opgeslagen", "ok");
      opnieuw();
    } catch (e) { melding((e as Error).message, "fout"); }
  };
  const nieuw = async (s: SpecStap) => {
    try {
      const c = await stuur<Versie>("POST", "/specificaties", { product, stap: s.stap });
      await bewerk(s, c);
      opnieuw();
    } catch (e) { melding((e as Error).message, "fout"); }
  };
  const vaststellen = async (s: SpecStap, c: Versie) => {
    if (!c.regels.length) return melding("Vul eerst minstens één minimum of maximum in", "fout");
    if (!(await bevestig(`Versie ${c.versie} vaststellen?`,
      `Vanaf nu worden metingen in ${s.stap} van ${product} hieraan getoetst.${s.geldig ? ` Versie ${s.geldig.versie} vervalt; eerdere metingen houden hun versie.` : ""}`,
      "Vaststellen"))) return;
    try {
      await stuur("POST", `/specificaties/${c.id}/vaststellen`);
      melding(`Versie ${c.versie} geldt nu`, "ok");
      opnieuw();
    } catch (e) { melding((e as Error).message, "fout"); }
  };
  const weggooien = async (c: Versie) => {
    if (!(await bevestig(`Concept versie ${c.versie} weggooien?`, "De geldige versie blijft gelden.", "Weggooien", true))) return;
    try {
      await stuur("POST", `/specificaties/${c.id}/weggooien`);
      melding("Concept weggegooid", "ok");
      opnieuw();
    } catch (e) { melding((e as Error).message, "fout"); }
  };

  const blok = (s: SpecStap) => {
    const g = s.geldig, c = s.concept;
    const status = g
      ? `Geldig: versie ${g.versie}, vastgesteld ${kort(g.vastgesteld_op)}${g.vastgesteld_door ? ` door ${g.vastgesteld_door}` : ""}`
      : "Nog geen geldige versie: metingen worden getoetst aan de grenzen van het veld.";
    const knoppen = !magBeheren() ? null : c
      ? h("div", { class: "knoppen-klein" },
          h("button", { class: "knop", "aria-label": `Concept ${s.stap} bewerken`, onclick: () => bewerk(s, c) }, "Concept bewerken"),
          h("button", { class: "knop knop-hoofd", "aria-label": `Versie ${c.versie} van ${s.stap} vaststellen`, onclick: () => vaststellen(s, c) }, "Vaststellen"),
          h("button", { class: "knop knop-stil", "aria-label": `Concept ${s.stap} weggooien`, onclick: () => weggooien(c) }, "Weggooien"))
      : h("button", { class: "knop", "aria-label": `Nieuwe versie ${s.stap}`, onclick: () => nieuw(s) }, "Nieuwe versie");
    const koppen = ["Eigenschap", g ? `Geldig (versie ${g.versie})` : "Geldig", ...(c ? [`Concept (versie ${c.versie})`] : [])];
    return h("section", { class: "blok spec-stap" },
      h("div", { class: "kop" },
        h("div", {}, h("h2", { style: "margin:0" }, `${s.stap} ${s.stapnaam}`), h("p", { class: "sub" }, `Per ${s.niveau === "batch" ? "batch" : "lot"}. ${status}`)),
        knoppen),
      tabel(koppen, s.velden.map((v) => [
        h("span", {}, h("strong", {}, v.code), ` ${v.naam}`),
        grens(g?.regels.find((r) => r.veld === v.code), v.eenheid),
        ...(c ? [h("span", { class: "spec-concept" }, grens(c.regels.find((r) => r.veld === v.code), v.eenheid))] : []),
      ]), "compact"),
      g?.opmerking ? h("p", { class: "sub" }, `Opmerking bij versie ${g.versie}: ${g.opmerking}`) : null,
      c?.opmerking ? h("p", { class: "sub" }, `Opmerking bij het concept: ${c.opmerking}`) : null,
      s.eerder.length
        ? h("p", { class: "sub" }, "Eerdere versies: ", s.eerder.map((e) => `versie ${e.versie} (vastgesteld ${kort(e.vastgesteld_op)})`).join(", "))
        : null);
  };

  toon(
    kop("Specificaties",
      "Waar het product in de tussenkeuringen en de eindkeuring aan moet voldoen. Een nieuwe versie begint als concept en geldt pas na vaststellen; een meting houdt de versie van het moment van meten, ook op het certificaat.",
      h("label", { for: "spec-product", class: "kiezer" }, "Product ", kiezer)),
    ...(sp.stappen.length
      ? sp.stappen.map(blok)
      : [h("p", { class: "blok leeg" }, `${sp.product} heeft geen keuringsstappen in zijn route. Voeg ze toe bij Planning → Producten.`)]),
  );
}
