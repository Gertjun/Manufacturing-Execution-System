// Etiketten met barcode, voor een etiketprinter (100 × 50 mm) of een A4-vel met 3 × 7 etiketten (63,5 × 38,1 mm).
// Afdrukken gaat via de browser; zo is er geen stuurprogramma of extra software nodig.
import { barcodeSvg } from "./barcode";
import { h } from "./ui";

export type Formaat = "printer" | "a4";
export interface EtiketInfo {
  nummer: string;
  soort: "batch" | "lot";
  /** Extra regels onder het nummer, bijvoorbeeld product en dag. */
  regels: string[];
}

export const FORMATEN: { id: Formaat; naam: string }[] = [
  { id: "printer", naam: "Etiketprinter (100 × 50 mm)" },
  { id: "a4", naam: "A4-vel met 3 × 7 etiketten (63,5 × 38,1 mm)" },
];

const STIJL = `
.etiket { box-sizing: border-box; background: #fff; color: #000; font-family: system-ui, sans-serif; display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; }
.etiket-kop { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
.etiket-nummer { font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
.etiket-soort { text-transform: uppercase; font-size: 7pt; letter-spacing: .08em; }
.etiket .barcode { width: 100%; height: 100%; display: block; }
.etiket-regels { font-size: 8pt; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.etiket-printer { width: 100mm; height: 50mm; padding: 3mm 4mm; }
.etiket-printer .etiket-nummer { font-size: 18pt; }
.etiket-printer .barcode { max-height: 20mm; }
.etiket-a4 { width: 63.5mm; height: 38.1mm; padding: 2mm 3mm; }
.etiket-a4 .etiket-nummer { font-size: 12pt; }
.etiket-a4 .barcode { max-height: 15mm; }
.etiket-a4 .etiket-regels { font-size: 7pt; }
.etiketten-vel-a4 { display: grid; grid-template-columns: repeat(3, 63.5mm); grid-auto-rows: 38.1mm; column-gap: 2.5mm; }
.etiketten-voorbeeld { display: flex; flex-wrap: wrap; gap: 8px; }
.etiketten-voorbeeld .etiket { border: 1px dashed #9aa4af; }
#print-etiketten { display: none; }
@media print {
  body.print-etiketten > *:not(#print-etiketten) { display: none !important; }
  body.print-etiketten #print-etiketten { display: block; }
  body.print-etiketten { margin: 0; background: #fff; }
  #print-etiketten.printer .etiket { break-after: page; }
}
`;

function stijlErin() {
  if (document.getElementById("etiket-stijl")) return;
  document.head.append(h("style", { id: "etiket-stijl" }, STIJL));
}

export function etiketElement(info: EtiketInfo, formaat: Formaat): HTMLElement {
  stijlErin();
  return h("div", { class: `etiket etiket-${formaat}` },
    h("div", { class: "etiket-kop" }, h("span", { class: "etiket-nummer" }, info.nummer), h("span", { class: "etiket-soort" }, info.soort)),
    barcodeSvg(info.nummer),
    h("div", { class: "etiket-regels" }, info.regels.map((r) => h("div", {}, r))));
}

/** Voorbeeld van de etiketten op het scherm. */
export function etikettenVoorbeeld(infos: EtiketInfo[], formaat: Formaat): HTMLElement {
  return h("div", { class: "etiketten-voorbeeld" }, infos.map((i) => etiketElement(i, formaat)));
}

/** Drukt de etiketten af: alleen de etiketten komen op papier, de rest van de pagina niet. */
export function drukEtikettenAf(infos: EtiketInfo[], formaat: Formaat) {
  stijlErin();
  document.getElementById("print-etiketten")?.remove();
  document.getElementById("print-pagina")?.remove();
  const inhoud = infos.map((i) => etiketElement(i, formaat));
  const houder = h("div", { id: "print-etiketten", class: formaat }, formaat === "a4" ? h("div", { class: "etiketten-vel-a4" }, inhoud) : inhoud);
  // Paginaformaat: per etiket één pagina op de etiketprinter, of A4 met de marges van een standaard etikettenvel.
  const pagina = h("style", { id: "print-pagina" },
    formaat === "printer" ? "@page { size: 100mm 50mm; margin: 0; }" : "@page { size: A4; margin: 15.15mm 7.2mm; }");
  document.head.append(pagina);
  document.body.append(houder);
  document.body.classList.add("print-etiketten");
  const opruimen = () => {
    document.body.classList.remove("print-etiketten");
    houder.remove();
    pagina.remove();
    window.removeEventListener("afterprint", opruimen);
  };
  window.addEventListener("afterprint", opruimen);
  window.print();
}
