// Wandscherm: een tv in de hal die de hele dag laat zien wat er te doen staat.
// Alleen kijken, ververst zichzelf. Kleur betekent altijd ook iets in tekst of teken.
import { h } from "../../gedeeld/ui";
import { haal, sessie } from "./basis";

interface Item { nummer: string; sinds: string | null; lang: boolean; gepland: number | null; opmerking: string | null }
interface Stap {
  code: string; naam: string; niveau: string;
  gepland: { nummer: string; volgorde: number; status: string; opmerking: string | null }[];
  bezig: Item[]; klaar: Item[];
}
interface Wand {
  tijd: string; hal: string | null; hallen: string[];
  kerncijfers: { gepland_vandaag: number; gestart_vandaag: number; lots_gereed_vandaag: number; in_beoordeling: number };
  stappen: Stap[];
}

const VERVERS = 30_000;
const MAX_REGELS = 5;
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

export function stopWandscherm() {
  clearTimeout(timer);
  timer = undefined;
  document.body.classList.remove("wand");
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

export async function wandscherm(hal?: string) {
  clearTimeout(timer);
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
    const k = w.kerncijfers;
    const cijfer = (n: number | string, tekst: string, klasse = "") => h("div", { class: `wand-cijfer ${klasse}` }, h("span", { class: "wand-getal" }, n), h("span", {}, tekst));
    scherm.replaceChildren(
      h("header", { class: "wand-kop" },
        h("div", {},
          h("h1", {}, w.hal ? `Vandaag in ${w.hal}` : "Vandaag in de fabriek"),
          h("p", { class: "wand-datum" }, new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" }))),
        h("div", { class: "wand-cijfers" },
          cijfer(`${k.gestart_vandaag} / ${k.gepland_vandaag}`, "batches gestart / gepland"),
          cijfer(k.lots_gereed_vandaag, k.lots_gereed_vandaag === 1 ? "lot gereed" : "lots gereed"),
          cijfer(k.in_beoordeling, "in beoordeling", k.in_beoordeling ? "let-op" : "")),
        h("div", { class: "wand-klok" }, h("span", { class: "wand-getal" }, klok()),
          fout
            ? h("span", { class: "wand-storing", role: "status" }, `⚠ Geen verbinding sinds ${laatsteGelukt ? klok(laatsteGelukt) : "–"}`)
            : h("span", {}, `Bijgewerkt ${klok(new Date(w.tijd))}`))),
      h("div", { class: "wand-raster" }, w.stappen.map(stapKaart)),
      h("footer", { class: "wand-voet" },
        h("span", { class: "wand-uitleg" },
          h("span", { class: "wl wl-bezig" }, "▶ Bezig"), h("span", { class: "wl wl-klaar" }, "● Klaar om te starten"),
          h("span", { class: "wl wl-gepland" }, "○ Gepland, nog niet klaar"), h("span", { class: "wl wl-lang" }, "Gele rand: wacht of loopt langer dan normaal")),
        sessie.rol === "scherm" ? null : h("nav", { class: "wand-hallen", "aria-label": "Hal" },
          h("a", { href: "#/wandscherm", "aria-current": w.hal ? undefined : "page" }, "Alle hallen"),
          w.hallen.map((x) => h("a", { href: `#/wandscherm/${encodeURIComponent(x)}`, "aria-current": x === w.hal ? "page" : undefined }, x)),
          h("a", { href: "#/" }, "Terug naar de portalen"))),
    );
  };

  const ververs = async () => {
    try {
      laatste = await haal<Wand>(`/wandscherm${hal ? `?hal=${encodeURIComponent(hal)}` : ""}`);
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

function stapKaart(s: Stap) {
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
  return h("section", { class: `wand-stap${leeg ? " wand-stap-leeg" : ""}${s.bezig.length ? " wand-stap-actief" : ""}` },
    h("div", { class: "wand-stap-kop" },
      h("span", { class: "wand-code" }, s.code.replace("PS", "")),
      h("span", { class: "wand-naam" }, s.naam),
      s.gepland.length ? h("span", { class: "wand-voortgang" }, `${gedaan}/${s.gepland.length} ✓`) : null),
    leeg
      ? h("p", { class: "wand-niets" }, "Niets te doen")
      : h("ul", { class: "wand-lijst" }, regels.slice(0, meer > 0 ? MAX_REGELS - 1 : MAX_REGELS),
          meer > 0 ? h("li", { class: "wr wr-meer" }, `+ ${meer + 1} meer`) : null));
}
