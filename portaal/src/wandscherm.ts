// Wandscherm: een tv in de hal die de hele dag laat zien wat er te doen staat.
// Alleen kijken, ververst zichzelf. Kleur betekent altijd ook iets in tekst of teken.
import { h } from "../../gedeeld/ui";
import { haal, sessie } from "./basis";

interface Item { nummer: string; sinds: string | null; lang: boolean; gepland: number | null; opmerking: string | null }
interface Stap {
  code: string; naam: string; niveau: string;
  gepland: { nummer: string; volgorde: number; status: string; opmerking: string | null }[];
  bezig: Item[]; klaar: Item[];
  stilstand: { oorzaak: string; categorie: string; sinds: string; toelichting: string | null } | null;
}
interface Wand {
  tijd: string; hal: string | null; keuze?: string[] | null; hallen: string[];
  kerncijfers: { gepland_vandaag: number; gestart_vandaag: number; lots_gereed_vandaag: number; in_beoordeling: number };
  stappen: Stap[];
}

const VERVERS = 30_000;
/** Regels per stapkaart: hoe minder stappen op het scherm, hoe groter de kaarten (#54). */
const maxRegels = (n: number) => (n <= 2 ? 10 : n <= 4 ? 8 : n <= 6 ? 6 : 5);
/** Een schermaccount onthoudt op dit apparaat welk wandscherm het toont (hal of stappen), zodat de tv na opnieuw inloggen hetzelfde laat zien. */
const ONTHOUD = "wandscherm.keuze";
let timer: number | undefined;
let wakeLock: { release: () => Promise<void> } | null = null;

const klok = (d = new Date()) => d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
function duur(iso: string | null): string {
  if (!iso) return "";
  const min = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} u ${String(Math.round(min % 60)).padStart(2, "0")}`;
  return `${Math.round(min / 1440)} d`;
}

/**
 * Alles op één scherm, zonder scrollen (#91, D81). Eerst kleiner schrijven (tot 70 % van de gewone grootte), daarna
 * minder regels per kaart ("+ n meer"); de laatste stand is altijd zonder scrollbalk (de rest valt onder de rand weg).
 */
let pasInOpnieuw: (() => void) | null = null;
function pasIn(scherm: HTMLElement, teken: (regels: number) => void, regels: number) {
  // Past = geen scrollbalk en in geen enkele kaart valt een regel weg onder de rand.
  const past = () => scherm.scrollHeight <= scherm.clientHeight + 1
    && [...scherm.querySelectorAll<HTMLElement>(".wand-stap")].every((k) => k.scrollHeight <= k.clientHeight + 1);
  for (let r = regels; r >= 1; r--) {
    teken(r);
    scherm.style.fontSize = "";
    let f = parseFloat(getComputedStyle(scherm).fontSize);
    const min = Math.max(11, f * 0.7);
    while (!past() && f > min) { f = Math.max(min, f - 0.5); scherm.style.fontSize = `${f}px`; }
    if (past()) return;
  }
}
window.addEventListener("resize", () => pasInOpnieuw?.());

/** Aantal kolommen voor n kaarten: ongeveer zo veel als de verhouding van het scherm toelaat (6 bij 21 op een breed scherm). */
const kolommen = (n: number) => Math.max(1, Math.min(n, Math.round(Math.sqrt((n * window.innerWidth) / window.innerHeight * 0.9))));

/** Afmelden op het wandscherm (#91): anders komt een tv of pc die als schermaccount is ingelogd er niet meer uit. */
const afmeldKnop = () => h("button", { class: "wand-afmelden", type: "button", onclick: () => { sessie.afmelden(); location.hash = "#/login"; } }, "Afmelden");

export function stopWandscherm() {
  clearTimeout(timer);
  timer = undefined;
  pasInOpnieuw = null;
  const scherm = document.getElementById("scherm");
  if (scherm) scherm.style.fontSize = "";
  document.body.classList.remove("wand");
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/** #/wandscherm, #/wandscherm/<hal>, #/wandscherm/stappen/PS3,PS4 (#54), #/wandscherm/kwaliteit (#83)
 *  of #/wandscherm/alle (vergeet de keuze van de tv). */
export async function wandscherm(deel?: string, arg?: string) {
  clearTimeout(timer);
  if (sessie.rol === "scherm") {
    try {
      if (deel === "alle") localStorage.removeItem(ONTHOUD);
      else if (deel) localStorage.setItem(ONTHOUD, location.hash);
      else if (localStorage.getItem(ONTHOUD)) return void (location.hash = localStorage.getItem(ONTHOUD)!);
    } catch { /* geen opslag: alleen deze keer */ }
  }
  if (deel === "kwaliteit") return kwaliteitScherm();
  const stappenKeuze = deel === "stappen" && arg ? arg : undefined;
  const hal = deel && deel !== "stappen" && deel !== "alle" ? deel : undefined;
  document.body.classList.add("wand");
  const scherm = document.getElementById("scherm")!;
  // Scherm niet laten uitgaan (waar de browser dat ondersteunt).
  try { wakeLock ??= await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* niet ondersteund */ }

  let laatste: Wand | null = null;
  let laatsteGelukt: Date | null = null;
  const route = location.hash;

  const teken = (fout?: string) => {
    if (location.hash !== route) return;
    if (!laatste) {
      scherm.replaceChildren(h("div", { class: "wand-leeg" }, fout ?? "Laden…"));
      return;
    }
    const w = laatste;
    const n0 = w.stappen.length;
    pasInOpnieuw = () => pasIn(scherm, (r) => tekenMet(w, r, fout), maxRegels(w.keuze ? n0 : 18));
    pasInOpnieuw();
  };
  const tekenMet = (w: Wand, regelsPerKaart: number, fout?: string) => {
    const k = w.kerncijfers;
    const cijfer = (n: number | string, tekst: string, klasse = "") => h("div", { class: `wand-cijfer ${klasse}` }, h("span", { class: "wand-getal" }, n), h("span", {}, tekst));
    // Met gekozen stappen gaan de cijfers over die stappen; anders over de fabriek.
    const som = (f: (s: Stap) => number) => w.stappen.reduce((a, s) => a + f(s), 0);
    const cijfers = w.keuze
      ? [cijfer(`${som((s) => s.gepland.filter((g) => g.status === "gedaan").length)} / ${som((s) => s.gepland.length)}`, "geplande stappen afgerond"),
         cijfer(som((s) => s.bezig.length), "bezig"),
         cijfer(som((s) => s.klaar.length), "klaar om te starten")]
      : [cijfer(`${k.gestart_vandaag} / ${k.gepland_vandaag}`, "batches gestart / gepland"),
         cijfer(k.lots_gereed_vandaag, k.lots_gereed_vandaag === 1 ? "lot gereed" : "lots gereed"),
         cijfer(k.in_beoordeling, "in beoordeling", k.in_beoordeling ? "let-op" : "")];
    const titel = w.keuze
      ? w.stappen.length === 1 ? `Vandaag in ${w.stappen[0].code} ${w.stappen[0].naam}` : `Vandaag in ${w.stappen.map((s) => s.code).join(", ")}`
      : w.hal ? `Vandaag in ${w.hal}` : "Vandaag in de fabriek";
    const n = w.stappen.length;
    scherm.replaceChildren(
      h("header", { class: "wand-kop" },
        h("div", {},
          h("h1", {}, titel),
          h("p", { class: "wand-datum" }, new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" }))),
        h("div", { class: "wand-cijfers" }, cijfers),
        h("div", { class: "wand-klok" }, h("span", { class: "wand-getal" }, klok()),
          fout
            ? h("span", { class: "wand-storing", role: "status" }, `⚠ Geen verbinding sinds ${laatsteGelukt ? klok(laatsteGelukt) : "–"}`)
            : h("span", {}, `Bijgewerkt ${klok(new Date(w.tijd))}`))),
      h("div", {
        class: `wand-raster${w.keuze && n <= 6 ? ` wand-n${n}` : ""}`,
        // Kolommen naar de verhouding van het scherm, zodat alle kaarten erop passen (#91).
        style: w.keuze && n <= 6 ? "" : `grid-template-columns: repeat(${kolommen(n)}, minmax(0, 1fr))`,
      }, w.stappen.map((s) => stapKaart(s, regelsPerKaart))),
      h("footer", { class: "wand-voet" },
        h("span", { class: "wand-uitleg" },
          h("span", { class: "wl wl-bezig" }, "▶ Bezig"), h("span", { class: "wl wl-klaar" }, "● Klaar om te starten"),
          h("span", { class: "wl wl-gepland" }, "○ Gepland, nog niet klaar"), h("span", { class: "wl wl-lang" }, "Gele rand: wacht of loopt langer dan normaal"), h("span", { class: "wl wl-stil" }, "⛔ Stilstand")),
        sessie.rol === "scherm" ? afmeldKnop() : h("nav", { class: "wand-hallen", "aria-label": "Hal" },
          h("a", { href: "#/wandscherm", "aria-current": w.hal || w.keuze ? undefined : "page" }, "Alle hallen"),
          w.hallen.map((x) => h("a", { href: `#/wandscherm/${encodeURIComponent(x)}`, "aria-current": x === w.hal ? "page" : undefined }, x)),
          h("button", { class: "wand-kies", type: "button", "aria-current": w.keuze ? "page" : undefined, onclick: () => void kiesStappen(w.keuze ?? []) },
            w.keuze ? `Stappen: ${w.keuze.join(", ")}` : "Stappen kiezen"),
          h("a", { href: "#/wandscherm/kwaliteit" }, "Kwaliteit"),
          h("a", { href: "#/" }, "Terug naar de portalen"))),
    );
  };

  const ververs = async () => {
    try {
      laatste = await haal<Wand>(`/wandscherm${hal ? `?hal=${encodeURIComponent(hal)}` : stappenKeuze ? `?stappen=${encodeURIComponent(stappenKeuze)}` : ""}`);
      laatsteGelukt = new Date();
      teken();
    } catch (e) {
      teken((e as Error).message);
    }
    if (location.hash === route) timer = window.setTimeout(ververs, VERVERS);
  };
  await ververs();
}

function regel(i: Item, soort: "bezig" | "klaar") {
  return h("li", { class: `wr wr-${soort}${i.lang ? " wr-lang" : ""}` },
    h("span", { class: "wr-teken", "aria-hidden": "true" }, soort === "bezig" ? "▶" : "●"),
    h("span", { class: "wr-nr" }, i.nummer),
    i.gepland ? h("span", { class: "wr-plan" }, `#${i.gepland}`) : null,
    h("span", { class: "wr-tijd" }, `${soort === "bezig" ? "loopt" : "wacht"} ${duur(i.sinds)}${i.lang ? " ⚠" : ""}`),
    i.opmerking ? h("span", { class: "wr-opm" }, i.opmerking) : null);
}

/** Kies de stappen voor dit wandscherm (#54). Het adres kun je als bladwijzer op de tv zetten. */
async function kiesStappen(nu: string[]) {
  let alle: { code: string; naam: string }[];
  try { alle = await haal("/config/stappen"); } catch { return; }
  const vinken = alle.map((s) => h("input", { type: "checkbox", value: s.code, checked: nu.includes(s.code) }) as HTMLInputElement);
  const d = h("dialog", { class: "venster" },
    h("h2", {}, "Stappen op dit wandscherm"),
    h("p", { class: "sub" }, "Kies één of enkele stappen; dan staan alleen hun planning en werk op het scherm, groter. Niets aangevinkt: alle stappen. Op de tv: open dit adres met het schermaccount, dan onthoudt de tv de keuze."),
    h("div", { class: "vinklijst" }, alle.map((s, i) => h("label", {}, vinken[i], ` ${s.code} ${s.naam}`))),
    h("div", { class: "knoppen" },
      h("button", { class: "knop knop-stil", onclick: () => d.close("nee") }, "Terug"),
      h("button", { class: "knop knop-hoofd", onclick: () => d.close("ja") }, "Tonen")));
  d.addEventListener("close", () => {
    if (d.returnValue === "ja") {
      const gekozen = vinken.filter((v) => v.checked).map((v) => v.value);
      location.hash = gekozen.length ? `#/wandscherm/stappen/${gekozen.join(",")}` : "#/wandscherm";
    }
    d.remove();
  });
  document.body.append(d);
  (d as HTMLDialogElement).showModal();
}

function stapKaart(s: Stap, MAX_REGELS: number) {
  const aanwezig = new Set([...s.bezig, ...s.klaar].map((x) => x.nummer));
  const nogNiet = s.gepland.filter((g) => g.status === "gepland" && !aanwezig.has(g.nummer));
  const gedaan = s.gepland.filter((g) => g.status === "gedaan").length;
  const regels = [
    ...s.bezig.map((i) => regel(i, "bezig")),
    ...s.klaar.map((i) => regel(i, "klaar")),
    ...nogNiet.map((g) => h("li", { class: "wr wr-gepland" },
      h("span", { class: "wr-teken", "aria-hidden": "true" }, "○"), h("span", { class: "wr-nr" }, g.nummer),
      h("span", { class: "wr-plan" }, `#${g.volgorde}`), h("span", { class: "wr-tijd" }, "gepland"))),
  ];
  const meer = regels.length - MAX_REGELS;
  const leeg = regels.length === 0;
  return h("section", { class: `wand-stap${leeg && !s.stilstand ? " wand-stap-leeg" : ""}${s.bezig.length ? " wand-stap-actief" : ""}${s.stilstand ? " wand-stap-stil" : ""}` },
    h("div", { class: "wand-stap-kop" },
      h("span", { class: "wand-code" }, s.code.replace("PS", "")),
      h("span", { class: "wand-naam" }, s.naam),
      s.gepland.length ? h("span", { class: "wand-voortgang" }, `${gedaan}/${s.gepland.length} ✓`) : null),
    s.stilstand
      ? h("p", { class: "wand-stil" }, h("strong", {}, `⛔ ${s.stilstand.oorzaak}`), ` sinds ${duur(s.stilstand.sinds)}`)
      : null,
    leeg
      ? (s.stilstand ? null : h("p", { class: "wand-niets" }, "Niets te doen"))
      : h("ul", { class: "wand-lijst" }, regels.slice(0, meer > 0 ? MAX_REGELS - 1 : MAX_REGELS),
          meer > 0 ? h("li", { class: "wr wr-meer" }, `+ ${meer + 1} meer`) : null));
}

// ---------------------------------------------------------------------------
// Wandscherm Kwaliteit (#83): voor het lab. Wat op Kwaliteit wacht, de afwijkingen van vandaag en de kerncijfers.
interface KwWacht { soort: "keuring" | "beoordeling"; nummer: string; product: string | null; stap: string | null; stapnaam: string | null; sinds: string; lang: boolean; te_meten: number; afwijkingen: number; reden: string | null }
interface KwAfwijking { tijd: string; nummer: string; stap: string; veld: string; veldnaam: string; gemeten: number; eenheid: string | null; markering: "buiten_tolerantie" | "buiten_grens" }
interface KwWand {
  tijd: string;
  kerncijfers: { wacht: number; vrijgegeven_vandaag: number; herbewerken_vandaag: number; afgekeurd_vandaag: number; metingen_vandaag: number; afwijkingen_vandaag: number; binnen_grenzen_procent: number | null };
  wacht: KwWacht[];
  afwijkingen: KwAfwijking[];
}

async function kwaliteitScherm() {
  document.body.classList.add("wand");
  const scherm = document.getElementById("scherm")!;
  try { wakeLock ??= await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* niet ondersteund */ }
  let laatste: KwWand | null = null;
  let laatsteGelukt: Date | null = null;
  const route = location.hash;

  const teken = (fout?: string) => {
    if (location.hash !== route) return;
    if (!laatste) return void scherm.replaceChildren(h("div", { class: "wand-leeg" }, fout ?? "Laden…"));
    const w = laatste;
    pasInOpnieuw = () => pasIn(scherm, (r) => tekenMet(w, r, fout), 10);
    pasInOpnieuw();
  };
  const tekenMet = (w: KwWand, MAX: number, fout?: string) => {
    const k = w.kerncijfers;
    const cijfer = (n: number | string, tekst: string, klasse = "") => h("div", { class: `wand-cijfer ${klasse}` }, h("span", { class: "wand-getal" }, n), h("span", {}, tekst));
    const getal = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 3 });
    const wachtRegels = w.wacht.map((x) => h("li", { class: `wr wr-klaar${x.lang ? " wr-lang" : ""}` },
      h("span", { class: "wr-teken", "aria-hidden": "true" }, x.soort === "keuring" ? "●" : "?"),
      h("span", { class: "wr-nr" }, x.nummer),
      h("span", { class: "wr-plan" }, x.soort === "keuring" ? x.stap! : "in beoordeling"),
      h("span", { class: "wr-tijd" }, `wacht ${duur(x.sinds)}${x.lang ? " ⚠" : ""}`),
      x.soort === "keuring"
        ? h("span", { class: "wr-opm" }, [x.te_meten ? `${x.te_meten} te meten` : "klaar voor besluit", x.afwijkingen ? `${x.afwijkingen} ${x.afwijkingen === 1 ? "afwijking" : "afwijkingen"}` : null].filter(Boolean).join(" · "))
        : x.reden ? h("span", { class: "wr-opm" }, x.reden) : null));
    const afwRegels = w.afwijkingen.map((a) => h("li", { class: `wr wr-afw wr-${a.markering}` },
      h("span", { class: "wr-teken", "aria-hidden": "true" }, a.markering === "buiten_grens" ? "◆" : "▲"),
      h("span", { class: "wr-nr" }, a.nummer),
      h("span", { class: "wr-plan" }, a.veld),
      h("span", { class: "wr-tijd" }, `${getal(a.gemeten)}${a.eenheid ? ` ${a.eenheid}` : ""} · ${a.markering === "buiten_grens" ? "buiten grens" : "buiten tolerantie"}`),
      h("span", { class: "wr-opm" }, `${a.veldnaam}, ${klok(new Date(a.tijd))}`)));
    /** Kaart met hoogstens MAX regels; staan er meer (of telt de server er meer), dan "+ n meer" op de laatste regel. */
    const kaart = (titel: string, teller: string, regels: HTMLElement[], leeg: string, totaal = regels.length) => {
      const getoond = regels.slice(0, totaal > MAX ? MAX - 1 : MAX);
      const rest = totaal - getoond.length;
      return h("section", { class: `wand-stap${regels.length ? " wand-stap-actief" : " wand-stap-leeg"}` },
        h("div", { class: "wand-stap-kop" }, h("span", { class: "wand-naam" }, titel), h("span", { class: "wand-voortgang" }, teller)),
        regels.length
          ? h("ul", { class: "wand-lijst" }, getoond, rest > 0 ? h("li", { class: "wr wr-meer" }, `+ ${rest} meer`) : null)
          : h("p", { class: "wand-niets" }, leeg));
    };
    scherm.replaceChildren(
      h("header", { class: "wand-kop" },
        h("div", {},
          h("h1", {}, "Kwaliteit vandaag"),
          h("p", { class: "wand-datum" }, new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" }))),
        h("div", { class: "wand-cijfers" },
          cijfer(k.wacht, "wacht op Kwaliteit", k.wacht ? "let-op" : ""),
          cijfer(`${k.vrijgegeven_vandaag} / ${k.herbewerken_vandaag} / ${k.afgekeurd_vandaag}`, "vrijgegeven / herbewerken / afgekeurd"),
          cijfer(k.binnen_grenzen_procent === null ? "–" : `${k.binnen_grenzen_procent} %`, `van ${k.metingen_vandaag} metingen binnen grenzen`)),
        h("div", { class: "wand-klok" }, h("span", { class: "wand-getal" }, klok()),
          fout
            ? h("span", { class: "wand-storing", role: "status" }, `⚠ Geen verbinding sinds ${laatsteGelukt ? klok(laatsteGelukt) : "–"}`)
            : h("span", {}, `Bijgewerkt ${klok(new Date(w.tijd))}`))),
      h("div", { class: "wand-raster wand-kw" },
        kaart("Wacht op Kwaliteit", String(w.wacht.length), wachtRegels, "Niets te keuren"),
        kaart("Afwijkingen vandaag", String(k.afwijkingen_vandaag), afwRegels, "Geen afwijkingen", k.afwijkingen_vandaag)),
      h("footer", { class: "wand-voet" },
        h("span", { class: "wand-uitleg" },
          h("span", { class: "wl wl-klaar" }, "● Wacht op meting of besluit"), h("span", { class: "wl" }, "? In beoordeling"),
          h("span", { class: "wl wl-lang" }, "Gele rand: wacht langer dan normaal"),
          h("span", { class: "wl wl-tol" }, "▲ Buiten tolerantie"), h("span", { class: "wl wl-grens" }, "◆ Buiten grens")),
        sessie.rol === "scherm" ? afmeldKnop() : h("nav", { class: "wand-hallen", "aria-label": "Wandscherm" },
          h("a", { href: "#/wandscherm" }, "Fabriek"),
          h("a", { href: "#/wandscherm/kwaliteit", "aria-current": "page" }, "Kwaliteit"),
          h("a", { href: "#/" }, "Terug naar de portalen"))),
    );
  };

  const ververs = async () => {
    try {
      laatste = await haal<KwWand>("/wandscherm/kwaliteit");
      laatsteGelukt = new Date();
      teken();
    } catch (e) {
      teken((e as Error).message);
    }
    if (location.hash === route) timer = window.setTimeout(ververs, VERVERS);
  };
  await ververs();
}
