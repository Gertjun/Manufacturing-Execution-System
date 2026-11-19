// Barcode (Code 128, tekenset B) als SVG, en het herkennen van een handscanner.
// Code 128 B kan alle gewone tekens (letters, cijfers, streepje) en wordt door elke handscanner gelezen.
// Een handscanner werkt als toetsenbord: hij "typt" de code heel snel en drukt daarna op Enter.

// Breedtes van streep en ruimte per symbool (0..106), elk 6 elementen (stop: 7).
const PATRONEN = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

/** De symbolen (met start, controlecijfer en stop) voor een tekst in Code 128 B. */
export function code128(tekst: string): number[] {
  const codes = [...tekst].map((c) => {
    const n = c.charCodeAt(0);
    if (n < 32 || n > 126) throw new Error(`Teken "${c}" kan niet in een barcode`);
    return n - 32;
  });
  const controle = codes.reduce((som, c, i) => som + c * (i + 1), START_B) % 103;
  return [START_B, ...codes, controle, STOP];
}

/** SVG-barcode. Hoogte en modulebreedte in gebruikerseenheden; de SVG schaalt mee met zijn breedte. */
export function barcodeSvg(tekst: string, opties: { hoogte?: number; metTekst?: boolean } = {}): SVGSVGElement {
  const hoogte = opties.hoogte ?? 50;
  const stil = 10; // rustzone links en rechts (10 modules)
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  let x = stil;
  const balken: string[] = [];
  for (const sym of code128(tekst)) {
    const p = PATRONEN[sym];
    for (let i = 0; i < p.length; i++) {
      const b = Number(p[i]);
      if (i % 2 === 0) balken.push(`M${x},0h${b}v${hoogte}h-${b}z`);
      x += b;
    }
  }
  const breedte = x + stil;
  const tekstHoogte = opties.metTekst ? 14 : 0;
  svg.setAttribute("viewBox", `0 0 ${breedte} ${hoogte + tekstHoogte}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Barcode ${tekst}`);
  svg.setAttribute("class", "barcode");
  const pad = document.createElementNS(ns, "path");
  pad.setAttribute("d", balken.join(""));
  pad.setAttribute("fill", "#000");
  pad.setAttribute("shape-rendering", "crispEdges");
  svg.append(pad);
  if (opties.metTekst) {
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", String(breedte / 2));
    t.setAttribute("y", String(hoogte + tekstHoogte - 2));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "12");
    t.setAttribute("font-family", "monospace");
    t.textContent = tekst;
    svg.append(t);
  }
  return svg;
}

/**
 * Luistert naar een handscanner: tekens die snel achter elkaar komen (minder dan 50 ms ertussen)
 * en eindigen met Enter, buiten een invoerveld. Typen met de hand wordt zo niet als scan gezien.
 * Geeft een functie terug om te stoppen.
 */
export function luisterNaarScanner(opScan: (code: string) => void): () => void {
  let buffer = "";
  let laatste = 0;
  const toets = (e: KeyboardEvent) => {
    const doel = e.target as HTMLElement | null;
    if (doel && (doel.closest("input, textarea, select, [contenteditable]") || doel.closest("dialog"))) return;
    const nu = performance.now();
    if (nu - laatste > 50) buffer = "";
    laatste = nu;
    if (e.key === "Enter") {
      const code = buffer.trim();
      buffer = "";
      if (code.length >= 4) {
        e.preventDefault();
        opScan(code.toUpperCase());
      }
      return;
    }
    if (e.key.length === 1) buffer += e.key;
  };
  window.addEventListener("keydown", toets, true);
  return () => window.removeEventListener("keydown", toets, true);
}
