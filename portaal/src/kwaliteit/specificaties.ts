// Portaal Kwaliteit → Specificaties (#80, D73): per product en keuringsstap (tussenkeuring TK, eindkeuring EK)
// D101: bestaande versies alleen raadplegen; schrijfworkflow volgt in fase 2.
import { h, laden, toon, vastHouden } from "../../../gedeeld/ui";
import { toonGetal } from "../../../gedeeld/markering";
import { gekozenProduct, haal, producten } from "../basis";
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

/** "≤ 4", "150 – 350", "≥ 5" of "–". */
function grens(r: Regel | undefined, eenheid: string | null): string {
  if (!r) return "–";
  const e = eenheid ? ` ${eenheid}` : "";
  if (r.grens_min !== null && r.grens_max !== null) return `${toonGetal(r.grens_min)} – ${toonGetal(r.grens_max)}${e}`;
  if (r.grens_max !== null) return `≤ ${toonGetal(r.grens_max)}${e}`;
  return `≥ ${toonGetal(r.grens_min)}${e}`;
}

export async function specificaties(productArg?: string) {
  const actueel = vastHouden();
  toon(kop("Specificaties"), laden());
  let lijst: { code: string; naam: string }[];
  try { lijst = await producten(); } catch (e) { return fout(e); }
  const product = productArg && lijst.some((p) => p.code === productArg) ? productArg : gekozenProduct.code ?? lijst[0]?.code;
  if (!product) return toon(kop("Specificaties"), h("p", { class: "leeg" }, "Geen beschikbare producten."));
  let sp: Specificaties;
  try { sp = await haal<Specificaties>(`/specificaties?product=${encodeURIComponent(product)}`); } catch (e) { return fout(e); }
  if (!actueel()) return;

  const kiezer = h("select", { id: "spec-product", onchange: (e: Event) => { location.hash = `#/kwaliteit/specificaties/${encodeURIComponent((e.target as HTMLSelectElement).value)}`; } },
    lijst.map((p) => h("option", { value: p.code, selected: p.code === product }, `${p.code} – ${p.naam}`)));

  const blok = (s: SpecStap) => {
    const g = s.geldig, c = s.concept;
    const status = g
      ? `Geldig: versie ${g.versie}, vastgesteld ${kort(g.vastgesteld_op)}${g.vastgesteld_door ? ` door ${g.vastgesteld_door}` : ""}`
      : "Nog geen geldige versie: metingen worden getoetst aan de grenzen van het veld.";
    const koppen = ["Eigenschap", g ? `Geldig (versie ${g.versie})` : "Geldig", ...(c ? [`Concept (versie ${c.versie})`] : [])];
    return h("section", { class: "blok spec-stap kwaliteit-definitie" },
      h("div", { class: "kop" },
        h("div", {}, h("h2", { style: "margin:0" }, `${s.stap} ${s.stapnaam}`), h("p", { class: "sub" }, `Per ${s.niveau === "batch" ? "batch" : "lot"}. ${status}`)),
        null),
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
      "Alleen-lezen: bestaande specificaties en versies blijven raadpleegbaar. Wijzigingen en vaststelling wachten op de gecontroleerde MES-workflow in fase 2.",
      h("label", { for: "spec-product", class: "kiezer" }, "Product ", kiezer)),
    ...(sp.stappen.length
      ? sp.stappen.map(blok)
      : [h("p", { class: "blok leeg" }, `${sp.product} heeft geen keuringsstappen in zijn route.`)]),
  );
}
