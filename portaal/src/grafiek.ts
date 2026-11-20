// Twee grafieken, met de hand in SVG: afwijkingen per week (gestapelde staven)
// en de trend van één veld door de tijd. Kleur betekent status: oranje = buiten
// tolerantie, rood = buiten grens. Elke status heeft ook een eigen vorm en een
// legenda, zodat kleur nooit de enige drager is.
import { h } from "../../gedeeld/ui";

const NS = "http://www.w3.org/2000/svg";
type A = Record<string, string | number>;
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: A = {}, ...kinderen: (SVGElement | string)[]) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kinderen) el.append(typeof k === "string" ? document.createTextNode(k) : k);
  return el;
}

export const KLEUR = { ok: "var(--reeks-1)", tol: "var(--status-waarschuwing)", grens: "var(--status-kritiek)" };

function tooltip() {
  const tip = h("div", { class: "tip", role: "tooltip" });
  tip.hidden = true;
  return {
    el: tip,
    toon(x: number, y: number, regels: (string | Node)[], kader: DOMRect) {
      tip.replaceChildren(...regels.map((r) => (typeof r === "string" ? h("div", {}, r) : r)));
      tip.hidden = false;
      const links = Math.min(x + 14, kader.width - tip.offsetWidth - 4);
      tip.style.left = `${Math.max(4, links)}px`;
      tip.style.top = `${Math.max(4, y - tip.offsetHeight - 10)}px`;
    },
    verberg() { tip.hidden = true; },
  };
}

/** Mooie asindeling: ongeveer n stappen, ronde getallen. */
function schaalStappen(min: number, max: number, n = 5): number[] {
  if (min === max) { min -= 1; max += 1; }
  const ruw = (max - min) / n;
  const macht = 10 ** Math.floor(Math.log10(ruw));
  const stap = [1, 2, 2.5, 5, 10].map((f) => f * macht).find((x) => x >= ruw)!;
  const uit: number[] = [];
  let v = Math.floor(min / stap) * stap;
  uit.push(Number(v.toFixed(10)));
  while (v < max - stap * 0.001) { v += stap; uit.push(Number(v.toFixed(10))); } // de bovenste streep ligt altijd boven het maximum
  return uit;
}

const getal = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 2 });
const datumKort = (d: Date) => d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

// ---------------------------------------------------------------------------
export interface Week { week: string; waarden: number; buiten_tolerantie: number; buiten_grens: number }

export function afwijkingenPerWeek(weken: Week[]): HTMLElement {
  const B = 760, H = 260, m = { l: 44, r: 12, t: 12, b: 34 };
  const bw = B - m.l - m.r, bh = H - m.t - m.b;
  const max = Math.max(1, ...weken.map((w) => w.buiten_tolerantie + w.buiten_grens));
  const ticks = schaalStappen(0, max, 4).filter((t) => Number.isInteger(t));
  const top = ticks[ticks.length - 1];
  const y = (v: number) => m.t + bh - (v / top) * bh;
  const kolom = bw / Math.max(1, weken.length);
  const breedte = Math.min(28, kolom * 0.6);

  const svg = s("svg", { viewBox: `0 0 ${B} ${H}`, role: "img", "aria-label": "Afwijkingen per week, gestapeld naar soort" });
  svg.append(arcering());
  for (const t of ticks) {
    svg.append(s("line", { x1: m.l, x2: B - m.r, y1: y(t), y2: y(t), class: t === 0 ? "as" : "raster" }));
    svg.append(s("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end", class: "as-tekst" }, String(t)));
  }
  const tip = tooltip();
  const doel = s("g");
  weken.forEach((w, i) => {
    const x = m.l + i * kolom + (kolom - breedte) / 2;
    const tol = w.buiten_tolerantie, gr = w.buiten_grens;
    // Grens onderaan (het ernstigste), tolerantie erboven; 2px ruimte tussen de delen.
    if (gr > 0) svg.append(s("path", { d: staafPad(x, y(gr), breedte, y(0) - y(gr), tol === 0), fill: "url(#arcering-kritiek)" }));
    if (tol > 0) {
      const onder = y(gr) - (gr > 0 ? 2 : 0);
      svg.append(s("path", { d: staafPad(x, y(gr + tol), breedte, onder - y(gr + tol), true), fill: KLEUR.tol }));
    }
    if (tol + gr > 0) svg.append(s("text", { x: x + breedte / 2, y: y(gr + tol) - 5, "text-anchor": "middle", class: "as-tekst" }, String(tol + gr)));
    const d = new Date(w.week);
    if (weken.length <= 14 || i % 2 === 0) svg.append(s("text", { x: x + breedte / 2, y: H - m.b + 18, "text-anchor": "middle", class: "as-tekst" }, datumKort(d)));
    const vlak = s("rect", { x: m.l + i * kolom, y: m.t, width: kolom, height: bh, fill: "transparent", tabindex: 0, "aria-label": `Week van ${datumKort(d)}: ${tol} buiten tolerantie, ${gr} buiten grens` });
    const toon = (ev: MouseEvent | FocusEvent) => {
      const kader = kaderEl.getBoundingClientRect();
      const px = ev instanceof MouseEvent ? ev.clientX - kader.left : ((x + breedte) / B) * kader.width;
      const py = ev instanceof MouseEvent ? ev.clientY - kader.top : (y(gr + tol) / H) * kader.height;
      tip.toon(px, py, [h("strong", {}, `Week van ${datumKort(d)}`), `${tol} buiten tolerantie`, `${gr} buiten grens`, `${w.waarden} metingen`], kader);
    };
    vlak.addEventListener("mousemove", toon);
    vlak.addEventListener("focus", toon);
    vlak.addEventListener("mouseleave", () => tip.verberg());
    vlak.addEventListener("blur", () => tip.verberg());
    doel.append(vlak);
  });
  svg.append(doel);
  const kaderEl = h("div", { class: "grafiek" },
    h("div", { class: "legenda" },
      h("span", {}, h("i", { class: "blokje reeks-tol", "aria-hidden": "true" }), "Buiten tolerantie"),
      h("span", {}, h("i", { class: "blokje arcering-kritiek", "aria-hidden": "true" }), "Buiten grens (gearceerd)")),
    svg as unknown as Node, tip.el);
  return kaderEl;
}

/** Arcering voor het ernstigste deel van een staaf (buiten grens, storing): rood met witte schuine strepen,
 *  zodat het ook zonder kleurenzien te onderscheiden is van oranje. Zelfde id in elke grafiek; inhoud is gelijk. */
function arcering() {
  const defs = s("defs");
  const p = s("pattern", { id: "arcering-kritiek", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  p.append(s("rect", { width: 6, height: 6, style: "fill: var(--status-kritiek)" }));
  p.append(s("rect", { width: 2, height: 6, fill: "#fff" }));
  defs.append(p);
  return defs;
}

/** Staaf met afgeronde bovenkant (4px), vlak op de basislijn. */
function staafPad(x: number, y: number, b: number, hoogte: number, rondBoven: boolean) {
  const r = rondBoven ? Math.min(4, hoogte, b / 2) : 0;
  return `M${x},${y + hoogte}V${y + r}Q${x},${y} ${x + r},${y}H${x + b - r}Q${x + b},${y} ${x + b},${y + r}V${y + hoogte}Z`;
}

function legenda(items: [keyof typeof KLEUR, string][]) {
  return h(
    "div",
    { class: "legenda" },
    items.map(([k, tekst]) => h("span", {}, vormIcoon(k), tekst)),
  );
}

function vormIcoon(k: keyof typeof KLEUR) {
  const svg = s("svg", { viewBox: "0 0 12 12", width: 12, height: 12, "aria-hidden": "true" });
  svg.append(vorm(k, 6, 6, 5));
  return svg as unknown as Node;
}

/** Ok = rondje, buiten tolerantie = driehoek, buiten grens = ruit. */
function vorm(k: keyof typeof KLEUR, x: number, y: number, r: number) {
  if (k === "tol") return s("path", { d: `M${x},${y - r}L${x + r},${y + r * 0.8}L${x - r},${y + r * 0.8}Z`, fill: KLEUR.tol });
  if (k === "grens") return s("path", { d: `M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`, fill: KLEUR.grens });
  return s("circle", { cx: x, cy: y, r: r * 0.75, fill: KLEUR.ok });
}

// ---------------------------------------------------------------------------
export interface TrendVeld {
  code: string; naam: string; eenheid: string | null; soort: string;
  grens_min: number | null; grens_max: number | null; tolerantie: number | null; tolerantie_soort: string;
}
export interface TrendPunt { tijd: string; setting: number | null; gemeten: number; markering: "ok" | "buiten_tolerantie" | "buiten_grens"; batch_of_lot: string; operator: string }

export function trend(veld: TrendVeld, punten: TrendPunt[]): HTMLElement {
  const B = 760, H = 320, m = { l: 52, r: 16, t: 16, b: 34 };
  const bw = B - m.l - m.r, bh = H - m.t - m.b;
  const tijden = punten.map((p) => Date.parse(p.tijd));
  const t0 = Math.min(...tijden), t1 = Math.max(...tijden, t0 + 1);
  const settings = punten.map((p) => p.setting).filter((x): x is number => x !== null);
  const setting = settings.length ? settings[settings.length - 1] : null;
  const tol = veld.tolerantie !== null && setting !== null
    ? veld.tolerantie_soort === "procent" ? (Math.abs(setting) * veld.tolerantie) / 100 : veld.tolerantie
    : null;
  const waarden = punten.map((p) => p.gemeten);
  let lo = Math.min(...waarden), hi = Math.max(...waarden);
  if (tol !== null && setting !== null) { lo = Math.min(lo, setting - tol); hi = Math.max(hi, setting + tol); }
  // Grenzen alleen meenemen als ze dichtbij liggen; anders drukken ze de data plat.
  const bereik = hi - lo || 1;
  if (veld.grens_min !== null && veld.grens_min > lo - bereik) lo = Math.min(lo, veld.grens_min);
  if (veld.grens_max !== null && veld.grens_max < hi + bereik) hi = Math.max(hi, veld.grens_max);
  const ticks = schaalStappen(lo - bereik * 0.05, hi + bereik * 0.05, 5);
  const ylo = ticks[0], yhi = ticks[ticks.length - 1];
  const X = (t: number) => m.l + ((t - t0) / (t1 - t0)) * bw;
  const Y = (v: number) => m.t + bh - ((v - ylo) / (yhi - ylo)) * bh;

  const svg = s("svg", { viewBox: `0 0 ${B} ${H}`, role: "img", "aria-label": `${veld.code} ${veld.naam} door de tijd` });
  for (const t of ticks) {
    svg.append(s("line", { x1: m.l, x2: B - m.r, y1: Y(t), y2: Y(t), class: "raster" }));
    svg.append(s("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end", class: "as-tekst" }, getal(t)));
  }
  // Tolerantieband rond de setting.
  if (tol !== null && setting !== null) {
    svg.append(s("rect", { x: m.l, y: Y(setting + tol), width: bw, height: Y(setting - tol) - Y(setting + tol), class: "band" }));
    svg.append(s("line", { x1: m.l, x2: B - m.r, y1: Y(setting), y2: Y(setting), class: "setting" }));
    svg.append(s("text", { x: B - m.r - 4, y: Y(setting + tol) - 6, "text-anchor": "end", class: "as-tekst" }, `tolerantie ±${getal(tol)}`));
  }
  for (const [g, naam] of [[veld.grens_min, "min"], [veld.grens_max, "max"]] as const) {
    if (g !== null && g >= ylo && g <= yhi) {
      svg.append(s("line", { x1: m.l, x2: B - m.r, y1: Y(g), y2: Y(g), class: "grenslijn" }));
      svg.append(s("text", { x: m.l + 6, y: Y(g) + (naam === "max" ? -6 : 14), class: "as-tekst" }, `grens ${naam} ${getal(g)}`));
    }
  }
  // Tijdas: ongeveer 6 labels.
  const dagen = (t1 - t0) / 864e5;
  const stapDagen = dagen > 60 ? 14 : dagen > 20 ? 7 : dagen > 6 ? 2 : 1;
  for (let t = t0; t <= t1; t += stapDagen * 864e5) {
    svg.append(s("text", { x: X(t), y: H - m.b + 20, "text-anchor": "middle", class: "as-tekst" }, datumKort(new Date(t))));
  }
  svg.append(s("line", { x1: m.l, x2: B - m.r, y1: H - m.b, y2: H - m.b, class: "as" }));

  // Punten: ok eerst (achter), afwijkingen erboven met een rand van het oppervlak.
  const volgorde = [...punten.keys()].sort((a, b) => (punten[a].markering === "ok" ? 0 : 1) - (punten[b].markering === "ok" ? 0 : 1));
  for (const i of volgorde) {
    const p = punten[i];
    const k = p.markering === "ok" ? "ok" : p.markering === "buiten_tolerantie" ? "tol" : "grens";
    const el = vorm(k, X(tijden[i]), Y(p.gemeten), k === "ok" ? 4 : 6);
    if (k !== "ok") { el.setAttribute("stroke", "var(--vlak)"); el.setAttribute("stroke-width", "2"); el.setAttribute("paint-order", "stroke"); }
    svg.append(el);
  }

  // Dradenkruis + tooltip: het dichtstbijzijnde punt op de tijdas.
  const tip = tooltip();
  const lijn = s("line", { y1: m.t, y2: H - m.b, class: "kruis" });
  lijn.style.display = "none";
  svg.append(lijn);
  const vlak = s("rect", { x: m.l, y: m.t, width: bw, height: bh, fill: "transparent" });
  svg.append(vlak);
  const kaderEl = h("div", { class: "grafiek" },
    legenda([["ok", "Binnen grenzen"], ["tol", "Buiten tolerantie"], ["grens", "Buiten grens"]]),
    svg as unknown as Node, tip.el);
  vlak.addEventListener("mousemove", (ev) => {
    const kader = kaderEl.querySelector("svg")!.getBoundingClientRect();
    const tx = t0 + ((((ev.clientX - kader.left) / kader.width) * B - m.l) / bw) * (t1 - t0);
    let beste = 0;
    for (let i = 1; i < tijden.length; i++) if (Math.abs(tijden[i] - tx) < Math.abs(tijden[beste] - tx)) beste = i;
    const p = punten[beste];
    lijn.setAttribute("x1", String(X(tijden[beste])));
    lijn.setAttribute("x2", String(X(tijden[beste])));
    lijn.style.display = "";
    const buiten = kaderEl.getBoundingClientRect();
    tip.toon(ev.clientX - buiten.left, ev.clientY - buiten.top, [
      h("strong", {}, p.batch_of_lot),
      new Date(p.tijd).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      `${p.setting !== null ? `setting ${getal(p.setting)}, ` : ""}gemeten ${getal(p.gemeten)}${veld.eenheid ? ` ${veld.eenheid}` : ""}`,
      p.markering === "ok" ? "Binnen grenzen" : p.markering === "buiten_tolerantie" ? "Buiten tolerantie" : "Buiten grens",
      p.operator,
    ], buiten);
  });
  vlak.addEventListener("mouseleave", () => { lijn.style.display = "none"; tip.verberg(); });
  return kaderEl;
}

// ---------------------------------------------------------------------------
// Productie: liggende gestapelde staven (wachten + bewerken per stap) en
// staande staven met één reeks (aantal per week).

export interface Deel { naam: string; waarde: number; klasse: string }

/** Eén liggende staaf per rij, opgebouwd uit delen (samen één geheel). */
export function liggendeStaven(rijen: { label: string; delen: Deel[]; tip: string[] }[], eenheid: (n: number) => string, legendaItems: { naam: string; klasse: string }[], vasteStappen?: number[], titel = "Doorlooptijd per stap"): HTMLElement {
  const rij = 26, B = 760, m = { l: 150, r: 70, t: 4, b: 26 };
  const H = m.t + rijen.length * rij + m.b;
  const max = Math.max(1, ...rijen.map((r) => r.delen.reduce((a, d) => a + d.waarde, 0)));
  // Met vaste stappen (bv. 30 of 60 minuten) een as die voor tijd logisch leest.
  let ticks: number[];
  if (vasteStappen) {
    const stap = vasteStappen.find((x) => max / x <= 6) ?? vasteStappen[vasteStappen.length - 1];
    ticks = [];
    for (let v = 0; v < max + stap; v += stap) ticks.push(v);
  } else ticks = schaalStappen(0, max, 5);
  const top = ticks[ticks.length - 1];
  const X = (v: number) => m.l + (v / top) * (B - m.l - m.r);
  const svg = s("svg", { viewBox: `0 0 ${B} ${H}`, role: "img", "aria-label": titel });
  svg.append(arcering());
  for (const t of ticks) {
    svg.append(s("line", { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, class: t === 0 ? "as" : "raster" }));
    svg.append(s("text", { x: X(t), y: H - 8, "text-anchor": "middle", class: "as-tekst" }, eenheid(t)));
  }
  const tip = tooltip();
  rijen.forEach((r, i) => {
    const y = m.t + i * rij + 5, hoogte = rij - 10;
    svg.append(s("text", { x: m.l - 10, y: y + hoogte / 2 + 4, "text-anchor": "end", class: "as-tekst rij-label" }, r.label));
    let x = 0;
    r.delen.forEach((d, j) => {
      if (d.waarde <= 0) return;
      const laatste = j === r.delen.length - 1 || r.delen.slice(j + 1).every((z) => z.waarde <= 0);
      const x0 = X(x) + (x > 0 ? 2 : 0), x1 = X(x + d.waarde);
      const rr = laatste ? Math.min(4, (x1 - x0) / 2) : 0;
      svg.append(s("path", { class: d.klasse, d: `M${x0},${y}H${x1 - rr}Q${x1},${y} ${x1},${y + rr}V${y + hoogte - rr}Q${x1},${y + hoogte} ${x1 - rr},${y + hoogte}H${x0}Z` }));
      x += d.waarde;
    });
    svg.append(s("text", { x: X(x) + 6, y: y + hoogte / 2 + 4, class: "as-tekst" }, eenheid(x)));
    const vlak = s("rect", { x: 0, y: m.t + i * rij, width: B, height: rij, fill: "transparent", tabindex: 0, "aria-label": `${r.label}: ${r.tip.join(", ")}` });
    const toon = (ev: MouseEvent | FocusEvent) => {
      const kader = kaderEl.getBoundingClientRect();
      const px = ev instanceof MouseEvent ? ev.clientX - kader.left : (X(x) / B) * kader.width;
      const py = ev instanceof MouseEvent ? ev.clientY - kader.top : ((y + 20) / H) * kader.height;
      tip.toon(px, py, [h("strong", {}, r.label), ...r.tip], kader);
    };
    vlak.addEventListener("mousemove", toon);
    vlak.addEventListener("focus", toon);
    vlak.addEventListener("mouseleave", () => tip.verberg());
    vlak.addEventListener("blur", () => tip.verberg());
    svg.append(vlak);
  });
  const kaderEl = h("div", { class: "grafiek" },
    h("div", { class: "legenda" }, legendaItems.map((l) => h("span", {}, h("i", { class: `blokje ${l.klasse}`, "aria-hidden": "true" }), l.naam))),
    svg as unknown as Node, tip.el);
  return kaderEl;
}

/** Staande staven, één reeks (geen legenda nodig: de titel noemt de reeks). */
export function staven(punten: { week: string; waarde: number; tip: string[] }[], naam: string): HTMLElement {
  const B = 760, H = 220, m = { l: 40, r: 12, t: 12, b: 30 };
  const bw = B - m.l - m.r, bh = H - m.t - m.b;
  const max = Math.max(1, ...punten.map((p) => p.waarde));
  const ticks = schaalStappen(0, max, 4).filter((t) => Number.isInteger(t));
  const top = ticks[ticks.length - 1];
  const Y = (v: number) => m.t + bh - (v / top) * bh;
  const kolom = bw / Math.max(1, punten.length), breedte = Math.min(28, kolom * 0.6);
  const svg = s("svg", { viewBox: `0 0 ${B} ${H}`, role: "img", "aria-label": naam });
  for (const t of ticks) {
    svg.append(s("line", { x1: m.l, x2: B - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? "as" : "raster" }));
    svg.append(s("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end", class: "as-tekst" }, String(t)));
  }
  const tip = tooltip();
  punten.forEach((p, i) => {
    const x = m.l + i * kolom + (kolom - breedte) / 2;
    if (p.waarde > 0) svg.append(s("path", { class: "reeks-1", d: staafPad(x, Y(p.waarde), breedte, Y(0) - Y(p.waarde), true) }));
    if (punten.length <= 14 || i % 2 === 0) svg.append(s("text", { x: x + breedte / 2, y: H - 10, "text-anchor": "middle", class: "as-tekst" }, datumKort(new Date(p.week))));
    const vlak = s("rect", { x: m.l + i * kolom, y: m.t, width: kolom, height: bh, fill: "transparent", tabindex: 0, "aria-label": p.tip.join(", ") });
    const toon = (ev: MouseEvent | FocusEvent) => {
      const kader = kaderEl.getBoundingClientRect();
      const px = ev instanceof MouseEvent ? ev.clientX - kader.left : ((x + breedte) / B) * kader.width;
      const py = ev instanceof MouseEvent ? ev.clientY - kader.top : (Y(p.waarde) / H) * kader.height;
      tip.toon(px, py, p.tip.map((t, j) => (j === 0 ? h("strong", {}, t) : t)), kader);
    };
    vlak.addEventListener("mousemove", toon);
    vlak.addEventListener("focus", toon);
    vlak.addEventListener("mouseleave", () => tip.verberg());
    vlak.addEventListener("blur", () => tip.verberg());
    svg.append(vlak);
  });
  const kaderEl = h("div", { class: "grafiek" }, svg as unknown as Node, tip.el);
  return kaderEl;
}

// ---------------------------------------------------------------------------
// Regelkaart: punten in volgorde, middenlijn, regelgrenzen (3 sigma) en zones van 1 en 2 sigma.
// Een signaal is een rood ruitje met het nummer van de regel; normaal is een blauw rondje.
export interface RkPunt { tijd: string; nummer: string; waarde: number; signaal: number | null }
export function regelkaartGrafiek(
  punten: RkPunt[], k: { gemiddelde: number | null; sigma: number | null; bovengrens: number | null; ondergrens: number | null },
  eenheid: string, spec?: { min: number | null; max: number | null }, titel = "Regelkaart",
): HTMLElement {
  const B = 900, H = 340, m = { l: 64, r: 120, t: 12, b: 34 };
  const waarden = punten.map((p) => p.waarde);
  const extra = [k.bovengrens, k.ondergrens, spec?.min ?? null, spec?.max ?? null].filter((x): x is number => x !== null && Number.isFinite(x));
  // Specificatiegrenzen alleen meenemen als ze in de buurt liggen; anders wordt de kaart plat.
  const sp = k.sigma ? extra.filter((x) => Math.abs(x - (k.gemiddelde ?? 0)) < 8 * k.sigma!) : extra;
  const lo = Math.min(...waarden, ...sp), hi = Math.max(...waarden, ...sp);
  const ticks = schaalStappen(lo, hi, 6);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (i: number) => m.l + (punten.length < 2 ? 0.5 : i / (punten.length - 1)) * (B - m.l - m.r);
  const Y = (v: number) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const svg = s("svg", { viewBox: `0 0 ${B} ${H}`, role: "img", "aria-label": titel, class: "regelkaart" });
  if (k.gemiddelde !== null && k.sigma) {
    for (const [a, b, kl] of [[2, 3, "rk-zone-3"], [1, 2, "rk-zone-2"]] as [number, number, string][]) {
      for (const kant of [1, -1]) {
        const ya = Y(k.gemiddelde + kant * a * k.sigma), yb = Y(k.gemiddelde + kant * b * k.sigma);
        svg.append(s("rect", { x: m.l, width: B - m.l - m.r, y: Math.min(ya, yb), height: Math.abs(ya - yb), class: kl }));
      }
    }
  }
  for (const t of ticks) {
    svg.append(s("line", { x1: m.l, x2: B - m.r, y1: Y(t), y2: Y(t), class: "raster" }));
    svg.append(s("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end", class: "as-tekst" }, getal(t)));
  }
  const lijn = (v: number | null | undefined, kl: string, label: string) => {
    if (v === null || v === undefined || v < y0 || v > y1) return;
    svg.append(s("line", { x1: m.l, x2: B - m.r, y1: Y(v), y2: Y(v), class: kl }));
    svg.append(s("text", { x: B - m.r + 6, y: Y(v) + 4, class: "as-tekst rk-label" }, `${label} ${getal(v)}`));
  };
  lijn(k.bovengrens, "rk-grens", "BRG");
  lijn(k.ondergrens, "rk-grens", "ORG");
  lijn(k.gemiddelde, "rk-midden", "gem.");
  if (spec) { lijn(spec.max, "rk-spec", "spec. max"); lijn(spec.min, "rk-spec", "spec. min"); }
  // datums onder de as: ongeveer 6
  const stapD = Math.max(1, Math.ceil(punten.length / 6));
  for (let i = 0; i < punten.length; i += stapD) svg.append(s("text", { x: X(i), y: H - 10, "text-anchor": "middle", class: "as-tekst" }, datumKort(new Date(punten[i].tijd))));
  if (punten.length > 1) svg.append(s("path", { d: punten.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.waarde).toFixed(1)}`).join(""), class: "rk-lijn" }));
  const tip = tooltip();
  punten.forEach((p, i) => {
    const x = X(i), y = Y(p.waarde);
    const vorm = p.signaal ? s("path", { d: `M${x},${y - 6}L${x + 6},${y}L${x},${y + 6}L${x - 6},${y}Z`, class: "rk-signaal" }) : s("circle", { cx: x, cy: y, r: 3, class: "rk-punt" });
    svg.append(vorm);
    const raak = s("circle", { cx: x, cy: y, r: 9, class: "raakvlak" });
    raak.addEventListener("mouseenter", (e) => {
      const kader = houder.getBoundingClientRect();
      tip.toon((e as MouseEvent).clientX - kader.left, (e as MouseEvent).clientY - kader.top,
        [h("strong", {}, p.nummer), `${new Date(p.tijd).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
          `${getal(p.waarde)}${eenheid}`, ...(p.signaal ? [h("strong", { class: "tip-signaal" }, `Signaal regel ${p.signaal}`)] : [])], kader);
    });
    raak.addEventListener("mouseleave", () => tip.verberg());
    svg.append(raak);
  });
  const houder = h("div", { class: "grafiek" }, svg, tip.el,
    h("div", { class: "legenda" },
      h("span", {}, h("span", { class: "rk-leg-punt", "aria-hidden": "true" }), "Meting"),
      h("span", {}, h("span", { class: "rk-leg-signaal", "aria-hidden": "true" }), "Signaal"),
      h("span", {}, h("span", { class: "rk-leg-grens", "aria-hidden": "true" }), "Regelgrens (3 sigma)"),
      spec ? h("span", {}, h("span", { class: "rk-leg-spec", "aria-hidden": "true" }), "Specificatie") : null));
  return houder;
}
