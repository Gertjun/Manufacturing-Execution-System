// Meldingen: wat iemand in deze rol moet weten (waarde buiten de grens, beoordeling, keurresultaat, afwijkend lot).
// De teller in het menu ververst elke minuut; een nieuwe melding verschijnt ook even onderin beeld.
import { h, laden, melding as toast, toon, vastHouden } from "../../gedeeld/ui";
import { haal, sessie, stuur } from "./basis";
import { afgekapt, fout, kop } from "./kwaliteit/schermen";

export interface Melding {
  id: string; soort: string; ernst: "info" | "let_op" | "kritiek"; tekst: string;
  batchnummer: string | null; lotnummer: string | null; hal: string | null; aangemaakt_op: string; gelezen: boolean;
}
interface Antwoord { ongelezen: number; meldingen: Melding[] }

export const heeftMeldingen = () => ["ploegleider", "kwaliteit", "planner", "beheerder", "analist", "productiemanager"].includes(sessie.rol ?? "");

const ERNST: Record<Melding["ernst"], { teken: string; tekst: string }> = {
  kritiek: { teken: "!", tekst: "Belangrijk" },
  let_op: { teken: "!", tekst: "Let op" },
  info: { teken: "i", tekst: "Ter info" },
};

let teller: HTMLElement | null = null;
let gezien = new Set<string>();
let timer: number | undefined;
let eersteKeer = true;

/** Teller voor in het menu; ververst zichzelf. */
export function meldingTeller(): HTMLElement {
  teller = h("span", { class: "teller", "aria-label": "ongelezen meldingen" });
  void ververs();
  return teller;
}

async function ververs() {
  clearTimeout(timer);
  if (!heeftMeldingen() || !sessie.geldig()) return;
  try {
    const r = await haal<Antwoord>("/meldingen?ongelezen=true&limiet=20");
    if (teller) teller.textContent = r.ongelezen ? String(r.ongelezen) : "";
    const nieuw = r.meldingen.filter((m) => !gezien.has(m.id));
    if (!eersteKeer && nieuw.length) toast(nieuw.length === 1 ? `Nieuwe melding: ${nieuw[0].tekst}` : `${nieuw.length} nieuwe meldingen`, nieuw.some((m) => m.ernst === "kritiek") ? "fout" : "info");
    r.meldingen.forEach((m) => gezien.add(m.id));
    eersteKeer = false;
  } catch { /* volgende keer opnieuw */ }
  timer = window.setTimeout(ververs, 60_000);
}

export function stopMeldingen() {
  clearTimeout(timer);
  gezien = new Set();
  eersteKeer = true;
}

function link(m: Melding): string | null {
  if (m.lotnummer) return `#/kwaliteit/lotpaspoort/${m.lotnummer}`;
  if (m.batchnummer) return `#/kwaliteit/batch/${m.batchnummer}`;
  return null;
}

export async function meldingenScherm(alle = false) {
  const actueel = vastHouden();
  toon(kop("Meldingen"), laden());
  let r: Antwoord;
  try { r = await haal<Antwoord>(`/meldingen?limiet=200${alle ? "" : "&ongelezen=true"}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  if (teller) teller.textContent = r.ongelezen ? String(r.ongelezen) : "";
  const opnieuw = () => meldingenScherm(alle);
  const gelezen = async (m: Melding) => {
    try { await stuur("POST", `/meldingen/${m.id}/gelezen`); opnieuw(); } catch (e) { toast((e as Error).message, "fout"); }
  };
  const tijd = (iso: string) => new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  toon(
    kop("Meldingen",
      "Wat voor jouw rol belangrijk is. De database maakt ze zelf aan, bijvoorbeeld bij een waarde buiten de grens of een keurresultaat. Na 30 dagen verdwijnen ze uit deze lijst.",
      h("div", { class: "knoppen-klein" },
        h("a", { class: `knop ${alle ? "knop-stil" : ""}`, href: "#/meldingen", "aria-current": alle ? undefined : "page" }, `Ongelezen (${r.ongelezen})`),
        h("a", { class: `knop ${alle ? "" : "knop-stil"}`, href: "#/meldingen/alle", "aria-current": alle ? "page" : undefined }, "Alle"),
        r.ongelezen ? h("button", { class: "knop knop-hoofd", onclick: async () => {
          try { const x = await stuur<{ gelezen: number }>("POST", "/meldingen/alles-gelezen"); toast(`${x.gelezen} gelezen`, "ok"); opnieuw(); } catch (e) { toast((e as Error).message, "fout"); }
        } }, "Alles gelezen") : null)),
    afgekapt(r.meldingen.length, 200, "meldingen", alle ? "Bekijk de ongelezen meldingen apart." : "Zet meldingen die je gezien hebt op gelezen."),
    r.meldingen.length
      ? h("ul", { class: "meldingen" }, r.meldingen.map((m) => {
          const l = link(m);
          return h("li", { class: `melding-rij ernst-${m.ernst}${m.gelezen ? " gelezen" : ""}` },
            h("span", { class: "melding-teken", "aria-hidden": "true" }, ERNST[m.ernst].teken),
            h("div", {},
              h("p", { class: "melding-tekst" }, h("span", { class: "melding-ernst" }, `${ERNST[m.ernst].tekst}: `), m.tekst),
              h("p", { class: "sub" }, tijd(m.aangemaakt_op), m.hal ? `, ${m.hal}` : "")),
            h("div", { class: "knoppen-klein" },
              l ? h("a", { class: "knop knop-klein", href: l, onclick: () => { if (!m.gelezen) void stuur("POST", `/meldingen/${m.id}/gelezen`).catch(() => {}); } }, "Bekijken") : null,
              m.gelezen ? null : h("button", { class: "knop knop-klein knop-stil", onclick: () => gelezen(m) }, "Gelezen")));
        }))
      : h("p", { class: "leeg" }, alle ? "Geen meldingen in de laatste 30 dagen." : "Geen ongelezen meldingen."),
  );
}
