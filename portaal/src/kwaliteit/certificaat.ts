// D101: concept raadplegen en historische certificaten herdrukken; geen nieuwe uitgifte.
import { h, laden, toon, vastHouden } from "../../../gedeeld/ui";
import { toonGetal } from "../../../gedeeld/markering";
import { haal } from "../basis";
import { fout } from "./schermen";

interface Kenmerk {
  veld: string; naam: string; stap: string; niveau: string; eenheid: string | null; decimalen: number | null; spec_min: number | null; spec_max: number | null;
  resultaten: { nummer: string; waarde: number }[]; min: number | null; max: number | null; gemiddelde: number | null; voldoet: boolean | null;
}
interface Inhoud {
  lotnummer: string; status: string; gereed_op: string | null; producten: string[]; batches: string[];
  bedrijf: { naam: string; adres: string; verklaring: string };
  kenmerken: Kenmerk[]; grondstoffen: { grondstof: string; naam: string; partijen: string[] }[]; voldoet: boolean;
  specificaties?: { stap: string; stapnaam: string; versie: number; vastgesteld_op: string | null }[];
}
interface Uitgegeven { nummer: number; door: string; uitgegeven_op: string }

const dt = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
const e = (k: Kenmerk) => (k.eenheid ? ` ${k.eenheid}` : "");
function spec(k: Kenmerk) {
  if (k.spec_min !== null && k.spec_max !== null) return `${toonGetal(k.spec_min, k.decimalen)} – ${toonGetal(k.spec_max, k.decimalen)}${e(k)}`;
  if (k.spec_max !== null) return `≤ ${toonGetal(k.spec_max, k.decimalen)}${e(k)}`;
  if (k.spec_min !== null) return `≥ ${toonGetal(k.spec_min, k.decimalen)}${e(k)}`;
  return "–";
}
function resultaat(k: Kenmerk) {
  if (!k.resultaten.length) return "niet gemeten";
  if (k.resultaten.length === 1) return `${toonGetal(k.resultaten[0].waarde, k.decimalen)}${e(k)}`;
  return `${toonGetal(k.min!, k.decimalen)} – ${toonGetal(k.max!, k.decimalen)}${e(k)} (gem. ${toonGetal(k.gemiddelde!, k.decimalen)}, ${k.resultaten.length} batches)`;
}

function document_(c: Inhoud, uit: Uitgegeven | null) {
  return h("article", { class: `certificaat${uit ? "" : " concept"}` },
    h("header", { class: "cert-kop" },
      h("div", {}, h("div", { class: "cert-bedrijf" }, c.bedrijf.naam), h("div", { class: "sub" }, c.bedrijf.adres)),
      h("div", { class: "cert-titel" }, h("div", { class: "cert-soort" }, "Analysecertificaat"),
        h("div", { class: "cert-nummer" }, uit ? `Nr. ${uit.nummer}` : "CONCEPT"))),
    h("dl", { class: "cert-feiten" },
      h("div", {}, h("dt", {}, "Lot"), h("dd", {}, c.lotnummer)),
      h("div", {}, h("dt", {}, "Product"), h("dd", {}, c.producten.join(", ") || "–")),
      h("div", {}, h("dt", {}, "Batches"), h("dd", {}, c.batches.join(", "))),
      h("div", {}, h("dt", {}, "Gereed op"), h("dd", {}, c.gereed_op ? dt(c.gereed_op) : "nog niet gereed"))),
    h("table", { class: "cert-tabel" },
      h("thead", {}, h("tr", {}, ["Kenmerk", "Specificatie", "Resultaat", "Voldoet"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, c.kenmerken.map((k) => h("tr", {},
        h("td", {}, h("strong", {}, k.naam), h("span", { class: "cert-klein" }, ` ${k.veld}, ${k.stap}`)),
        h("td", {}, spec(k)),
        h("td", {}, resultaat(k)),
        h("td", { class: k.voldoet === false ? "cert-nee" : "" }, k.voldoet === null ? "–" : k.voldoet ? "✓ Ja" : "✗ Nee"))))),
    c.specificaties?.length
      ? h("p", { class: "cert-klein" }, "Getoetst aan: ", c.specificaties.map((x) =>
          `specificatie ${x.stapnaam} versie ${x.versie}${x.vastgesteld_op ? ` (vastgesteld ${new Date(x.vastgesteld_op).toLocaleDateString("nl-NL")})` : ""}`).join("; "))
      : null,
    c.grondstoffen.length
      ? h("p", { class: "cert-klein" }, "Grondstofpartijen: ", c.grondstoffen.map((g) => `${g.naam} ${g.partijen.join(", ")}`).join("; "))
      : null,
    h("p", { class: "cert-verklaring" }, c.bedrijf.verklaring),
    h("footer", { class: "cert-voet" },
      uit
        ? h("div", {}, `Uitgegeven door ${uit.door} (Kwaliteit) op ${dt(uit.uitgegeven_op)}.`)
        : h("div", {}, "Concept — niet uitgegeven, niet geldig als vrijgavecertificaat. Nieuwe uitgifte is tijdelijk geblokkeerd."),
      uit ? h("div", { class: "cert-handtekening" }, "Handtekening") : null));
}

export async function certificaat(lotnummer: string, nummer?: string) {
  const actueel = vastHouden();
  toon(h("h1", {}, "Certificaat"), laden());
  let c: Inhoud, uit: Uitgegeven | null = null, lijst: Uitgegeven[] = [];
  try {
    if (nummer) {
      const r = await haal<Uitgegeven & { inhoud: Inhoud }>(`/certificaten/${encodeURIComponent(nummer)}`);
      c = r.inhoud; uit = r;
      lijst = (await haal<{ uitgegeven: Uitgegeven[] }>(`/certificaten/lots/${encodeURIComponent(lotnummer)}`)).uitgegeven;
    } else {
      const r = await haal<{ concept: Inhoud; uitgegeven: Uitgegeven[] }>(`/certificaten/lots/${encodeURIComponent(lotnummer)}`);
      c = r.concept; lijst = r.uitgegeven;
    }
  } catch (err) { return fout(err); }
  if (!actueel()) return;
  toon(
    h("div", { class: "kop geen-print" },
      h("div", {}, h("p", { class: "terug" }, h("a", { href: `#/kwaliteit/lotpaspoort/${lotnummer}` }, `Lotpaspoort ${lotnummer}`)),
        h("h1", {}, uit ? `Certificaat nr. ${uit.nummer}` : `Certificaat ${lotnummer} (concept)`),
        lijst.length ? h("p", { class: "sub" }, "Uitgegeven: ", lijst.flatMap((x, i) => [i ? ", " : "",
          h("a", { href: `#/kwaliteit/certificaat/${lotnummer}/${x.nummer}` }, `nr. ${x.nummer} (${dt(x.uitgegeven_op)})`)])) : null),
      h("div", { class: "knoppen-klein" },
        uit ? h("a", { class: "knop knop-stil", href: `#/kwaliteit/certificaat/${lotnummer}` }, "Concept") : null,
        h("button", { class: "knop", onclick: () => window.print() }, "Afdrukken of pdf"))),
    !uit ? h("p", { class: "melding-inline geen-print" }, "Alleen-lezen. Nieuwe certificaatuitgifte wacht op de MES-kwaliteitsvrijgave in fase 7.") : null,
    document_(c, uit),
  );
}
