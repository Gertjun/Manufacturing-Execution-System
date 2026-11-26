// Twee grafieken, met de hand in SVG: afwijkingen per week (gestapelde staven)
// en de trend van één veld door de tijd. Kleur betekent status: oranje = buiten
// tolerantie, rood = buiten grens. Elke status heeft ook een eigen vorm en een
// legenda, zodat kleur nooit de enige drager is.
import { h } from "../../gedeeld/ui";
import { perAs, perTekst, type Per } from "./resolutie";

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

/** Gestapelde staven per week. Met `kies` is elke week te kiezen (klik, Enter of spatie), bijvoorbeeld voor de lijst eronder (#59). */
export function afwijkingenPerWeek(weken: Week[], kies?: (week: string) => void, per: Per = "week"): HTMLElement {
  const B = 760, H = 260, m = { l: 44, r: 12, t: 12, b: 34 };
  const bw = B - m.l - m.r, bh = H - m.t - m.b;
  const max = Math.max(1, ...weken.map((w) => w.buiten_tolerantie + w.buiten_grens));
  const ticks = schaalStappen(0, max, 4).filter((t) => Number.isInteger(t));
  const top = ticks[ticks.length - 1];
  const y = (v: number) => m.t + bh - (v / top) * bh;
  const kolom = bw / Math.max(1, weken.length);
  const breedte = Math.min(28, kolom * 0.6);

  // Met kies zijn de weken knoppen; een "img" zou die verbergen voor schermlezers.
  const svg = s("svg", { viewBox: `0 0 ${B} ${H}`, role: kies ? "group" : "img", "aria-label": `Afwijkingen per ${per}, gestapeld naar soort` });
  const elke = Math.ceil(weken.length / 14); // hooguit ongeveer 14 teksten onder de as
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
    if (gr > 0) svg.append(s("path", { d: staafPad(x, y(gr), breedte, y(0) - y(gr), tol === 0), fill: "url(#arcering-kritiek)", stroke: "var(--grens)", "stroke-width": 1 }));
    if (tol > 0) {
      const onder = y(gr) - (gr > 0 ? 2 : 0);
      svg.append(s("path", { d: staafPad(x, y(gr + tol), breedte, onder - y(gr + tol), true), fill: "var(--mes-grafiek-tol)", stroke: "var(--tol)", "stroke-width": 1 }));
    }
    if (tol + gr > 0 && weken.length <= 40) svg.append(s("text", { x: x + breedte / 2, y: y(gr + tol) - 5, "text-anchor": "middle", class: "as-tekst" }, String(tol + gr)));
    if (i % elke === 0) svg.append(s("text", { x: x + breedte / 2, y: H - m.b + 18, "text-anchor": "middle", class: "as-tekst" }, perAs(w.week, per)));
    const kiesbaar = !!kies && tol + gr > 0;
    const vlak = s("rect", {
      x: m.l + i * kolom, y: m.t, width: kolom, height: bh, fill: "transparent", tabindex: 0,
      ...(kiesbaar ? { class: "kiesbaar", role: "button" } : {}),
      "aria-label": `${perTekst(w.week, per)}: ${tol} buiten tolerantie, ${gr} buiten grens${kiesbaar ? ". Kies voor de lijst" : ""}`,
    });
    if (kiesbaar) {
      const kiesDeze = () => {
        svg.querySelectorAll(".gekozen").forEach((x) => { x.classList.remove("gekozen"); x.removeAttribute("aria-pressed"); });
        vlak.classList.add("gekozen");
        vlak.setAttribute("aria-pressed", "true");
        kies!(w.week);
      };
      vlak.addEventListener("click", kiesDeze);
      vlak.addEventListener("keydown", (ev) => { if ((ev as KeyboardEvent).key === "Enter" || (ev as KeyboardEvent).key === " ") { ev.preventDefault(); kiesDeze(); } });
    }
    const toon = (ev: MouseEvent | FocusEvent) => {
      const kader = kaderEl.getBoundingClientRect();
      const px = ev instanceof MouseEvent ? ev.clientX - kader.left : ((x + breedte) / B) * kader.width;
      const py = ev instanceof MouseEvent ? ev.clientY - kader.top : (y(gr + tol) / H) * kader.height;
      tip.toon(px, py, [h("strong", {}, perTekst(w.week, per)), `${tol} buiten tolerantie`, `${gr} buiten grens`, `${w.waarden} metingen`], kader);
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
  p.append(s("rect", { width: 6, height: 6, style: "fill: var(--mes-grafiek-grens)" }));
  p.append(s("rect", { width: 2, height: 6, style: "fill: var(--vlak)" }));
  defs.append(p);
  return defs;
}

/** Staaf met afgeronde bovenkant (4px), vlak op de basislijn. */
function staafPad(x: number, y: number, b: number, hoogte: number, rondBoven: boolean) {
  const r = rondBoven ? Math.min(4, hoogte, b / 2) : 0;
  return `M${x},${y + hoogte}V${y + r}Q${x},${y} ${x + r},${y}H${x + b - r}Q${x + b},${y} ${x + b},${y + r}V${y + hoogte}Z`;
}

/** Legenda: eerst de vormen van de punten, daarna eventueel de lijnen (klasse = lijnstijl). */
function legenda(items: [keyof typeof KLEUR, string][], lijnen: [string, string][] = []) {
  return h(
    "div",
    { class: "legenda" },
    items.map(([k, tekst]) => h("span", {}, vormIcoon(k), tekst)),
    lijnen.map(([kl, tekst]) => h("span", {}, h("i", { class: `leg-lijn ${kl}`, "aria-hidden": "true" }), tekst)),
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
  grenzen_per_product?: boolean;
}
export interface TrendPunt {
  tijd: string; setting: number | null; gemeten: number; markering: "ok" | "buiten_tolerantie" | "buiten_grens"; batch_of_lot: string; operator: string;
  /** De grenzen waaraan deze meting is getoetst (sinds 0.56.0, #89); ontbreekt bij een oudere server. */
  grens_min?: number | null; grens_max?: number | null; tolerantie?: number | null; tolerantie_soort?: string | null; product?: string | null;
}

/**
 * Horen de metingen bij producten met verschillende grenzen of tolerantie (#89)? Dan passen lijnen niet op elk punt:
 * een punt "binnen grenzen" kan boven een lijn van een ander product staan. Grenzen die alleen in de tijd
 * veranderen (één product) zijn geen menging: die volgen de lijnen als traplijn.
 */
export function gemengdeGrenzen(punten: TrendPunt[]): boolean {
  const perProduct = new Map<string, string>();
  for (const p of punten) {
    if (p.grens_min === undefined) return false; // oudere server: geen grenzen per meting
    const sleutel = [p.grens_min, p.grens_max, p.tolerantie, p.tolerantie_soort].join("|");
    const prod = p.product ?? "";
    const eerder = perProduct.get(prod);
    if (eerder === undefined) perProduct.set(prod, sleutel);
  }
  return new Set(perProduct.values()).size > 1;
}

export function trend(veld: TrendVeld, punten: TrendPunt[]): HTMLElement {
  const B = 760, H = 320, m = { l: 52, r: 16, t: 16, b: 34 };
  const bw = B - m.l - m.r, bh = H - m.t - m.b;
  const tijden = punten.map((p) => Date.parse(p.tijd));
  const t0 = Math.min(...tijden), t1 = Math.max(...tijden, t0 + 1);
  // Producten met verschillende grenzen door elkaar (#89): geen lijnen; elk punt houdt de kleur van zijn eigen grenzen.
  const gemengd = gemengdeGrenzen(punten);
  // Grenzen en tolerantie van elke meting zelf (sinds 0.56.0), anders die van het veld.
  const gMin = (p: TrendPunt) => (p.grens_min !== undefined ? p.grens_min : veld.grens_min);
  const gMax = (p: TrendPunt) => (p.grens_max !== undefined ? p.grens_max : veld.grens_max);
  // Tolerantie hoort bij de instelling van elke meting: verandert de instelling, dan verspringen de lijnen mee.
  const tolVan = (p: TrendPunt) => {
    const tol = p.tolerantie !== undefined ? p.tolerantie : veld.tolerantie;
    const soort = p.tolerantie_soort ?? veld.tolerantie_soort;
    return gemengd || tol === null || p.setting === null ? null : soort === "procent" ? (Math.abs(p.setting) * tol) / 100 : tol;
  };
  const metTol = punten.some((p) => tolVan(p) !== null);
  const metGrens = !gemengd && punten.some((p) => gMin(p) !== null || gMax(p) !== null);
  const waarden = punten.map((p) => p.gemeten);
  let lo = Math.min(...waarden), hi = Math.max(...waarden);
  for (const p of punten) {
    const t = tolVan(p);
    if (t !== null) { lo = Math.min(lo, p.setting! - t); hi = Math.max(hi, p.setting! + t); }
  }
  // Grenzen alleen meenemen als ze dichtbij liggen; anders drukken ze de data plat.
  const bereik = hi - lo || 1;
  if (metGrens) {
    for (const p of punten) {
      const a = gMin(p), b = gMax(p);
      if (a !== null && a > lo - bereik) lo = Math.min(lo, a);
      if (b !== null && b < hi + bereik) hi = Math.max(hi, b);
    }
  }
  const ticks = schaalStappen(lo - bereik * 0.05, hi + bereik * 0.05, 5);
  const ylo = ticks[0], yhi = ticks[ticks.length - 1];
  const X = (t: number) => m.l + ((t - t0) / (t1 - t0)) * bw;
  const Y = (v: number) => m.t + bh - ((v - ylo) / (yhi - ylo)) * bh;

  const svg = s("svg", { viewBox: `0 0 ${B} ${H}`, role: "img", "aria-label": `${veld.code} ${veld.naam} door de tijd` });
  // Alleen zones waar historische specificatie en tolerantie daadwerkelijk genest zijn.
  // Geen kleurvlak bij gemengde producten, ontbrekende grenzen of strijdige intervallen.
  if (!gemengd && metTol && metGrens && punten.every(p => p.grens_min !== undefined && p.grens_max !== undefined && p.tolerantie !== undefined)) {
    const volgorde = [...punten.keys()].sort((a, b) => tijden[a] - tijden[b]);
    volgorde.forEach((i, j) => {
      const p = punten[i], t = tolVan(p), a = gMin(p), b = gMax(p);
      if (t === null || p.setting === null || a === null || b === null || t < 0) return;
      const onder = p.setting - t, boven = p.setting + t;
      if (!(a <= onder && onder <= boven && boven <= b)) return;
      const x = X(tijden[i]), eind = j + 1 < volgorde.length ? X(tijden[volgorde[j + 1]]) : B - m.r;
      if (eind <= x) return;
      for (const [laag, hoog, klasse] of [[ylo, a, "trend-zone-3"], [a, onder, "trend-zone-2"], [onder, boven, "trend-zone-1"], [boven, b, "trend-zone-2"], [b, yhi, "trend-zone-3"]] as [number, number, string][]) {
        const l = Math.max(ylo, laag), h = Math.min(yhi, hoog);
        if (h > l) svg.append(s("rect", { x, y: Y(h), width: eind - x, height: Y(l) - Y(h), class: klasse, "aria-hidden": "true" }));
      }
    });
  }
  for (const t of ticks) {
    svg.append(s("line", { x1: m.l, x2: B - m.r, y1: Y(t), y2: Y(t), class: "raster" }));
    svg.append(s("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end", class: "as-tekst" }, getal(t)));
  }
  // Instelling (grijs gestippeld) en tolerantie (oranje gestreept) als traplijn door de tijd (D70).
  const volgordeTijd = [...punten.keys()].sort((a, b) => tijden[a] - tijden[b]);
  const trap = (waarde: (p: TrendPunt) => number | null) => {
    let d = "", bezig = false;
    volgordeTijd.forEach((i, k) => {
      const v = waarde(punten[i]);
      if (v === null) { bezig = false; return; }
      const x0 = X(tijden[i]), x1 = k < volgordeTijd.length - 1 ? X(tijden[volgordeTijd[k + 1]]) : B - m.r;
      d += bezig ? `V${Y(v).toFixed(1)}` : `M${x0.toFixed(1)},${Y(v).toFixed(1)}`;
      d += `H${x1.toFixed(1)}`;
      bezig = true;
    });
    return d;
  };
  if (metTol) {
    const boven = (p: TrendPunt) => { const t = tolVan(p); return t === null ? null : p.setting! + t; };
    const onder = (p: TrendPunt) => { const t = tolVan(p); return t === null ? null : p.setting! - t; };
    svg.append(s("path", { d: trap((p) => (tolVan(p) === null ? null : p.setting)), class: "setting" }));
    svg.append(s("path", { d: trap(boven), class: "tolerantielijn" }));
    svg.append(s("path", { d: trap(onder), class: "tolerantielijn" }));
    const laatste = [...volgordeTijd].reverse().map((i) => punten[i]).find((p) => tolVan(p) !== null)!;
    const tol = laatste.tolerantie !== undefined ? laatste.tolerantie! : veld.tolerantie!;
    const tekst = (laatste.tolerantie_soort ?? veld.tolerantie_soort) === "procent" ? `tolerantie ±${getal(tol)} %` : `tolerantie ±${getal(tol)}`;
    svg.append(s("text", { x: B - m.r - 4, y: Y(boven(laatste)!) - 6, "text-anchor": "end", class: "as-tekst label-tol" }, tekst));
  }
  // Grenzen als traplijn door de tijd, net als de tolerantie: een gewijzigde grens geldt pas vanaf dat moment (#89).
  if (metGrens) {
    const laatste = punten[volgordeTijd[volgordeTijd.length - 1]];
    for (const [g, naam] of [[gMin, "min"], [gMax, "max"]] as const) {
      const binnen = (p: TrendPunt) => { const v = g(p); return v !== null && v >= ylo && v <= yhi ? v : null; };
      if (!punten.some((p) => binnen(p) !== null)) continue;
      svg.append(s("path", { d: trap(binnen), class: "grenslijn" }));
      const v = binnen(laatste) ?? punten.map(binnen).filter((x): x is number => x !== null).at(-1)!;
      svg.append(s("text", { x: m.l + 6, y: Y(v) + (naam === "max" ? -6 : 14), class: "as-tekst label-grens" }, `grens ${naam} ${getal(v)}`));
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
    legenda([["ok", "Binnen grenzen"], ["tol", "Buiten tolerantie"], ["grens", "Buiten grens"]], [
      ...(metGrens ? [["leg-grens", "Grens"] as [string, string]] : []),
      ...(metTol ? [["leg-tol", "Tolerantie"] as [string, string], ["leg-setting", "Instelling"] as [string, string]] : []),
    ]),
    svg as unknown as Node, tip.el);
  vlak.addEventListener("mousemove", (ev) => {
    // De grafiek zelf, niet het eerste svg-icoontje in de legenda (dat gaf altijd de laatste dag, roadmap-bevinding 20-11).
    const kader = (svg as unknown as SVGSVGElement).getBoundingClientRect();
    const tx = t0 + ((((ev.clientX - kader.left) / kader.width) * B - m.l) / bw) * (t1 - t0);
    let beste = 0;
    for (let i = 1; i < tijden.length; i++) if (Math.abs(tijden[i] - tx) < Math.abs(tijden[beste] - tx)) beste = i;
    const p = punten[beste];
    lijn.setAttribute("x1", String(X(tijden[beste])));
    lijn.setAttribute("x2", String(X(tijden[beste])));
    lijn.style.display = "";
    const buiten = kaderEl.getBoundingClientRect();
    const regels: (string | Node | null)[] = [
      h("strong", {}, p.batch_of_lot, p.product ? ` · ${p.product}` : ""),
      new Date(p.tijd).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      `${p.setting !== null ? `instelling ${getal(p.setting)}, ` : ""}gemeten ${getal(p.gemeten)}${veld.eenheid ? ` ${veld.eenheid}` : ""}`,
      p.markering === "ok" ? "Binnen grenzen" : p.markering === "buiten_tolerantie" ? "Buiten tolerantie" : "Buiten grens",
      // Bij gemengde grenzen staan er geen lijnen: dan de grenzen van dit punt in de tooltip.
      gemengd && (gMin(p) !== null || gMax(p) !== null) ? `grenzen ${gMin(p) !== null ? getal(gMin(p)!) : "…"} tot ${gMax(p) !== null ? getal(gMax(p)!) : "…"}` : null,
      p.operator,
    ];
    tip.toon(ev.clientX - buiten.left, ev.clientY - buiten.top, regels.filter((x): x is string | Node => x !== null), buiten);
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
export function staven(punten: { week: string; waarde: number; tip: string[] }[], naam: string, per: Per = "week"): HTMLElement {
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
    if (i % Math.ceil(punten.length / 14) === 0) svg.append(s("text", { x: x + breedte / 2, y: H - 10, "text-anchor": "middle", class: "as-tekst" }, perAs(p.week, per)));
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
    for (const [a, b, kl] of [[2, 3, "rk-zone-3"], [1, 2, "rk-zone-2"], [0, 1, "rk-zone-1"]] as [number, number, string][]) {
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
