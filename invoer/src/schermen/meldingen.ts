// Meldingen voor de ploegleider op de vloer (zelfde meldingen als in het portaal).
import { stuur } from "../api";
import { sessie } from "../sessie";
import { h, laden, melding as toast, tijd, toon, vastHouden } from "../ui";

interface Melding { id: string; ernst: "info" | "let_op" | "kritiek"; tekst: string; batchnummer: string | null; lotnummer: string | null; aangemaakt_op: string; gelezen: boolean }
interface Antwoord { ongelezen: number; meldingen: Melding[] }

export const heeftMeldingen = () => sessie.rol === "ploegleider";
let aantal = 0;
let gezien: Set<string> | null = null;
let timer: number | undefined;
let bijwerken: (() => void) | null = null;

export const ongelezen = () => aantal;

/** Elke minuut het aantal ongelezen meldingen ophalen (alleen voor de ploegleider, alleen met verbinding). */
export function startMeldingen(opNieuw: () => void) {
  bijwerken = opNieuw;
  clearTimeout(timer);
  const ververs = async () => {
    if (heeftMeldingen() && sessie.geldig()) {
      try {
        const r = await stuur<Antwoord>("GET", "/meldingen?ongelezen=true&limiet=20");
        const nieuw = gezien ? r.meldingen.filter((m) => !gezien!.has(m.id)) : [];
        if (nieuw.length) toast(nieuw.length === 1 ? `Melding: ${nieuw[0].tekst}` : `${nieuw.length} nieuwe meldingen`, nieuw.some((m) => m.ernst === "kritiek") ? "fout" : "info");
        gezien = new Set(r.meldingen.map((m) => m.id));
        if (r.ongelezen !== aantal) { aantal = r.ongelezen; bijwerken?.(); }
      } catch { /* geen verbinding: volgende keer */ }
    }
    timer = window.setTimeout(ververs, 60_000);
  };
  void ververs();
}

export async function meldingenScherm() {
  const actueel = vastHouden();
  toon(h("h1", {}, "Meldingen"), laden());
  let r: Antwoord;
  try { r = await stuur<Antwoord>("GET", "/meldingen?limiet=50"); } catch {
    toon(h("h1", {}, "Meldingen"), h("p", { class: "leeg" }, "Meldingen zijn alleen te zien met verbinding."));
    return;
  }
  if (!actueel()) return;
  aantal = r.ongelezen;
  bijwerken?.();
  const gelezen = async (id: string) => { try { await stuur("POST", `/meldingen/${id}/gelezen`); void meldingenScherm(); } catch (e) { toast((e as Error).message, "fout"); } };
  toon(
    h("div", { class: "kop" }, h("h1", {}, "Meldingen"),
      r.ongelezen ? h("button", { class: "knop", onclick: async () => { await stuur("POST", "/meldingen/alles-gelezen").catch(() => {}); void meldingenScherm(); } }, "Alles gelezen") : null),
    r.meldingen.length
      ? h("ul", { class: "lijst" }, r.meldingen.map((m) =>
          h("li", { class: `rij melding-${m.ernst}${m.gelezen ? " gelezen" : ""}` },
            h("div", {}, h("div", { class: "rij-hoofd" }, m.tekst), h("div", { class: "rij-info" }, tijd(m.aangemaakt_op))),
            h("div", { class: "knoppen-rij" },
              m.batchnummer || m.lotnummer ? h("a", { class: "knop knop-klein", href: `#/zoek/${m.lotnummer ?? m.batchnummer}`, onclick: () => { if (!m.gelezen) void stuur("POST", `/meldingen/${m.id}/gelezen`).catch(() => {}); } }, "Bekijken") : null,
              m.gelezen ? null : h("button", { class: "knop knop-klein", onclick: () => gelezen(m.id) }, "Gelezen")))))
      : h("p", { class: "leeg" }, "Geen meldingen in de laatste 30 dagen."),
  );
}
