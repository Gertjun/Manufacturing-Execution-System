// Sorteren en filteren per kolom in de gedeelde tabel() (#94, D83).
// Werkt op wat er in de tabel staat; de schermen zelf hoeven niets te doen.
import { h } from "../../gedeeld/ui";

const MAANDEN = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
/** Datum zoals de portalen hem tonen: "4 okt 07:58", "4 okt 2026 07:58", "4 okt 2026". */
const DATUM = /^(\d{1,2}) (jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)\.?(?: (\d{4}))?,?(?: (\d{1,2}):(\d{2}))?$/;
/** Duur zoals "3 u 15" of "45 min". */
const DUUR = /^(?:(\d+) u)?\s*(?:(\d+)(?: min)?)?$/;

export type Sleutel = { soort: "leeg" } | { soort: "getal"; n: number } | { soort: "tekst"; t: string };

/** Waarde om op te sorteren: een getal (ook datum en duur), anders de tekst. Leeg komt altijd onderaan. */
export function sleutel(tekst: string, eigen?: string | null, nu = new Date()): Sleutel {
  if (eigen !== undefined && eigen !== null && eigen !== "") {
    const n = Number(eigen);
    return Number.isFinite(n) ? { soort: "getal", n } : { soort: "tekst", t: eigen };
  }
  const t = tekst.replace(/\s+/g, " ").trim();
  if (!t) return { soort: "leeg" };
  const d = DATUM.exec(t);
  if (d) {
    const maand = MAANDEN.indexOf(d[2]);
    let jaar = d[3] ? Number(d[3]) : nu.getFullYear();
    let tijd = new Date(jaar, maand, Number(d[1]), Number(d[4] ?? 0), Number(d[5] ?? 0)).getTime();
    // Zonder jaar: een datum "in de toekomst" hoort bij vorig jaar (lijsten gaan over het verleden).
    if (!d[3] && tijd > nu.getTime() + 864e5) {
      jaar -= 1;
      tijd = new Date(jaar, maand, Number(d[1]), Number(d[4] ?? 0), Number(d[5] ?? 0)).getTime();
    }
    return { soort: "getal", n: tijd };
  }
  if (/\d/.test(t) && /^(\d+ u)( \d+)?$|^\d+ min$/.test(t)) {
    const m = DUUR.exec(t)!;
    return { soort: "getal", n: Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) };
  }
  // Getal met eventueel een eenheid erachter: "1.234,5 kg", "−2", "99,8 %", "±2,5 °C".
  const g = /^[±]?([−+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(?:\s*[^\d\s].*)?$/.exec(t);
  if (g) {
    const n = Number(`${g[2].replace(/\./g, "")}.${g[3] ?? "0"}`);
    return { soort: "getal", n: g[1] === "−" || g[1] === "-" ? -n : n };
  }
  return { soort: "tekst", t: t.toLocaleLowerCase("nl") };
}

/** Vergelijken; leeg altijd onderaan, getallen vóór tekst. */
export function vergelijk(a: Sleutel, b: Sleutel, richting: 1 | -1): number {
  if (a.soort === "leeg" || b.soort === "leeg") return a.soort === b.soort ? 0 : a.soort === "leeg" ? 1 : -1;
  if (a.soort === "getal" && b.soort === "getal") return (a.n - b.n) * richting;
  if (a.soort === "getal") return -1;
  if (b.soort === "getal") return 1;
  return a.t.localeCompare(b.t, "nl", { numeric: true }) * richting;
}

const celTekst = (td: Element) => {
  const kopie = td.cloneNode(true) as HTMLElement;
  kopie.querySelectorAll("button, .knoppen-klein").forEach((x) => x.remove());
  return (kopie.textContent ?? "").replace(/\s+/g, " ").trim();
};
const eigenSleutel = (td: Element) => (td as HTMLElement).dataset.sort ?? td.querySelector<HTMLElement>("[data-sort]")?.dataset.sort ?? null;

/** Regels van de tabel als groepjes: een regel met de detailregels (opengeklapte meting) die erbij horen. */
function groepen(tbody: HTMLTableSectionElement): HTMLTableRowElement[][] {
  const uit: HTMLTableRowElement[][] = [];
  for (const tr of Array.from(tbody.rows)) {
    if (tr.classList.contains("meting-detail") && uit.length) uit[uit.length - 1].push(tr);
    else uit.push([tr]);
  }
  return uit;
}

/** Kolommen waarop sorteren zin heeft: met een kop en niet alleen knoppen. */
function sorteerbaar(t: HTMLTableElement, i: number): boolean {
  const kop = t.tHead?.rows[0]?.cells[i];
  if (!kop || !(kop.textContent ?? "").trim()) return false;
  return Array.from(t.tBodies[0]?.rows ?? []).some((tr) => tr.cells[i] && celTekst(tr.cells[i]) !== "");
}

/** Maakt de koppen klikbaar om op te sorteren: eerst oplopend, dan aflopend, dan weer de oorspronkelijke volgorde. */
export function maakSorteerbaar(t: HTMLTableElement) {
  const tbody = t.tBodies[0];
  const kopRij = t.tHead?.rows[0];
  if (!tbody || !kopRij || tbody.rows.length < 2) return;
  // De oorspronkelijke volgorde, om na twee klikken terug te kunnen; regels die later bijkomen, gaan achteraan.
  Array.from(tbody.rows).forEach((tr, n) => { tr.dataset.volgorde = String(n); });
  const plek = (g: HTMLTableRowElement[]) => Number(g[0].dataset.volgorde ?? Number.MAX_SAFE_INTEGER);
  let kolom = -1;
  let richting: 1 | -1 = 1;
  Array.from(kopRij.cells).forEach((th, i) => {
    if (!sorteerbaar(t, i)) return;
    const naam = (th.textContent ?? "").trim();
    const knop = h("button", { class: "sorteer", type: "button", title: `Sorteren op ${naam}` }, naam) as HTMLButtonElement;
    th.replaceChildren(knop);
    knop.addEventListener("click", () => {
      if (kolom !== i) { kolom = i; richting = 1; }
      else if (richting === 1) richting = -1;
      else kolom = -1;
      for (const [j, andere] of Array.from(kopRij.cells).entries()) {
        if (j === kolom) andere.setAttribute("aria-sort", richting === 1 ? "ascending" : "descending");
        else andere.removeAttribute("aria-sort");
      }
      const lijst = kolom < 0 ? groepen(tbody).sort((a, b) => plek(a) - plek(b)) : groepen(tbody)
        .map((g) => ({ g, s: sleutel(g[0].cells[i] ? celTekst(g[0].cells[i]) : "", g[0].cells[i] ? eigenSleutel(g[0].cells[i]) : null) }))
        // Gelijke waarden houden hun volgorde (stabiel sorteren), zodat een tweede klik voorspelbaar is.
        .map((x, n) => ({ ...x, n }))
        .sort((a, b) => vergelijk(a.s, b.s, richting) || a.n - b.n)
        .map((x) => x.g);
      tbody.append(...lijst.flat());
    });
  });
}

/** Filters per kolom: een keuzelijst als er weinig verschillende waarden zijn, anders een zoekveld.
 *  Geeft de knop "Filteren" terug (of null bij korte tabellen); de velden staan boven de tabel. */
export function filterKnop(t: HTMLTableElement, vak: HTMLElement): HTMLButtonElement | null {
  const tbody = t.tBodies[0];
  const kopRij = t.tHead?.rows[0];
  if (!tbody || !kopRij || tbody.rows.length < 6) return null;
  const koppen = Array.from(kopRij.cells).map((th) => (th.textContent ?? "").trim());
  if (!koppen.some(Boolean)) return null;
  const knop = h("button", { class: "knop knop-klein knop-stil filter-knop", type: "button", "aria-expanded": "false" }, "Filteren") as HTMLButtonElement;
  const filters: (() => (tekst: string) => boolean)[] = [];
  const teller = h("span", { class: "sub filter-teller", "aria-live": "polite" });
  const toepassen = () => {
    const actief = filters.map((f) => f());
    let zichtbaar = 0, totaal = 0;
    for (const g of groepen(tbody)) {
      totaal++;
      const tonen = actief.every((past, i) => past(g[0].cells[i] ? celTekst(g[0].cells[i]) : ""));
      if (tonen) zichtbaar++;
      g.forEach((tr) => { tr.hidden = !tonen; });
    }
    teller.textContent = zichtbaar === totaal ? "" : `${zichtbaar} van ${totaal} regels`;
    knop.firstChild!.textContent = zichtbaar === totaal ? "Filteren" : `Filteren (${zichtbaar} van ${totaal})`;
  };
  // De velden worden pas gemaakt als je Filteren opent: zo staan er geen verborgen velden op elk scherm.
  const bouw = () => {
    const waarden = koppen.map((_, i) => groepen(tbody).map((g) => (g[0].cells[i] ? celTekst(g[0].cells[i]) : "")));
    const velden: HTMLElement[] = [];
    koppen.forEach((kop, i) => {
      const verschillend = [...new Set(waarden[i].filter(Boolean))];
      if (!kop || !verschillend.length) { filters.push(() => () => true); return; }
      const id = `f-${Math.random().toString(36).slice(2, 8)}-${i}`;
      if (verschillend.length <= 12) {
        const sel = h("select", { id, onchange: toepassen }, h("option", { value: "" }, "Alle"),
          verschillend.sort((a, b) => vergelijk(sleutel(a), sleutel(b), 1)).map((w) => h("option", { value: w }, w))) as HTMLSelectElement;
        filters.push(() => (tekst) => !sel.value || tekst === sel.value);
        velden.push(h("label", { for: id, class: "filter" }, kop, sel));
      } else {
        const inp = h("input", { id, type: "search", autocomplete: "off", placeholder: "Bevat…", oninput: toepassen }) as HTMLInputElement;
        filters.push(() => { const z = inp.value.trim().toLocaleLowerCase("nl"); return (tekst) => !z || tekst.toLocaleLowerCase("nl").includes(z); });
        velden.push(h("label", { for: id, class: "filter" }, kop, inp));
      }
    });
    const wissen = h("button", { class: "knop knop-klein knop-stil", type: "button", onclick: () => {
      vak.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((x) => { x.value = ""; });
      toepassen();
    } }, "Filters wissen");
    vak.replaceChildren(h("div", { class: "filters tabel-filters" }, ...velden, wissen, teller));
  };
  vak.hidden = true;
  knop.addEventListener("click", () => {
    if (!vak.firstChild) bouw();
    vak.hidden = !vak.hidden;
    knop.setAttribute("aria-expanded", String(!vak.hidden));
    if (!vak.hidden) vak.querySelector<HTMLElement>("input, select")?.focus();
  });
  return knop;
}
