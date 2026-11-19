// Etiketten printen voor batches of lots: voorbeeld op het scherm, formaat kiezen, afdrukken via de browser.
import { drukEtikettenAf, etikettenVoorbeeld, FORMATEN, type EtiketInfo, type Formaat } from "../../gedeeld/etiket";
import { h, laden, toon, vastHouden } from "../../gedeeld/ui";
import { haal } from "./basis";
import { fout, kop } from "./kwaliteit/schermen";

interface Gegevens { nummer: string; soort: "batch" | "lot"; product: string | null; dag: string | null; batches: string[] }

const datum = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : "");

export function naarEtiketInfo(g: Gegevens): EtiketInfo {
  return {
    nummer: g.nummer,
    soort: g.soort,
    regels: g.soort === "lot"
      ? [g.batches.join(" "), [g.product, datum(g.dag)].filter(Boolean).join(" · ")]
      : [g.product ?? "", g.dag ? `Gepland ${datum(g.dag)}` : ""].filter(Boolean),
  };
}

/** Link naar het etikettenscherm. */
export const etikettenLink = (nummers: string[], formaat: Formaat = "printer") => `#/etiketten/${formaat}/${nummers.map(encodeURIComponent).join(",")}`;

export async function etikettenScherm(formaatArg: string, lijst: string) {
  const actueel = vastHouden();
  const formaat: Formaat = formaatArg === "a4" ? "a4" : "printer";
  const nummers = decodeURIComponent(lijst ?? "").split(",").filter(Boolean);
  toon(kop("Etiketten"), laden());
  let g: Gegevens[];
  try { g = nummers.length ? await haal<Gegevens[]>(`/planning/etiketten?nummers=${encodeURIComponent(nummers.join(","))}`) : []; } catch (e) { return fout(e); }
  if (!actueel()) return;
  const infos = g.map(naarEtiketInfo);
  const keuze = h("select", { id: "formaat", onchange: (e: Event) => { location.hash = etikettenLink(nummers, (e.target as HTMLSelectElement).value as Formaat); } },
    FORMATEN.map((f) => h("option", { value: f.id, selected: f.id === formaat }, f.naam)));
  toon(
    kop(infos.length === 1 ? `Etiket ${infos[0].nummer}` : `${infos.length} etiketten`,
      "Met een gewone handscanner lees je de barcode in het invoerscherm, zonder typen. Stel in het afdrukvenster de marges op 'geen' en de schaal op 100%.",
      h("div", { class: "knoppen-klein" },
        h("label", { for: "formaat", class: "filter" }, "Formaat", keuze),
        infos.length ? h("button", { class: "knop knop-hoofd", onclick: () => drukEtikettenAf(infos, formaat) }, "Afdrukken") : null)),
    infos.length ? etikettenVoorbeeld(infos, formaat) : h("p", { class: "leeg" }, "Geen bekende batch- of lotnummers om af te drukken."),
    nummers.length > infos.length ? h("p", { class: "sub" }, `Niet gevonden: ${nummers.filter((n) => !g.some((x) => x.nummer === n.toUpperCase())).join(", ")}`) : null,
  );
}
