// Meldingen voor de ploegleider op de vloer (zelfde meldingen als in het portaal).
import { stuur } from "../api";
import { sessie } from "../sessie";
import { heeftRecht } from "../rechten";
import { h, laden, melding as toast, tijd, toon, vastHouden } from "../ui";

interface Melding { id: string; ernst: "info" | "let_op" | "kritiek"; tekst: string; batchnummer: string | null; lotnummer: string | null; aangemaakt_op: string; gelezen: boolean }
interface Antwoord { ongelezen: number; meldingen: Melding[] }

export const heeftMeldingen = () => heeftRecht("analysis.execution.read","execution.correct","inspection.decide","planning.manage","operations.rework.order");
let aantal = 0;
let meldingToken: string | null = null;
let gezien: Set<string> | null = null;
let timer: number | undefined;
let bijwerken: (() => void) | null = null;

export const ongelezen = () => meldingToken === sessie.token && heeftMeldingen() ? aantal : 0;

/** Elke minuut het aantal ongelezen meldingen ophalen (alleen voor de ploegleider, alleen met verbinding). */
export function startMeldingen(opNieuw: () => void) {
  bijwerken = opNieuw;
  clearTimeout(timer);
  const ververs = async () => {
    const token = sessie.token;
    if (meldingToken !== token || !heeftMeldingen()) { aantal = 0; gezien = null; meldingToken = token; }
    if (heeftMeldingen() && sessie.geldig()) {
      try {
        const r = await stuur<Antwoord>("GET", "/meldingen?ongelezen=true&limiet=20");
        if (sessie.token !== token || !heeftMeldingen()) { timer = window.setTimeout(ververs, 60_000); return; }
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
  const token = sessie.token;
  if (!heeftMeldingen()) return toon(h("h1", {}, "Geen bevoegdheid voor meldingen"));
  toon(h("h1", {}, "Meldingen"), laden());
  let r: Antwoord;
  try { r = await stuur<Antwoord>("GET", "/meldingen?limiet=50"); } catch {
    toon(h("h1", {}, "Meldingen"), h("p", { class: "leeg" }, "Meldingen zijn alleen te zien met verbinding."));
    return;
  }
  if (!actueel() || token !== sessie.token || !heeftMeldingen()) return;
  meldingToken = token;
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
