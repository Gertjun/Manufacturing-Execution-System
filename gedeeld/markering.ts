// Dezelfde berekening als bereken_markering() in de database, zodat de
// operator al tijdens het typen ziet of een waarde afwijkt.
import type { Markering } from "./types";

export function berekenMarkering(
  setting: number | null,
  gemeten: number,
  grensMin: number | null,
  grensMax: number | null,
  tolerantie: number | null,
  tolerantieSoort: string,
): Markering {
  if ((grensMin !== null && gemeten < grensMin) || (grensMax !== null && gemeten > grensMax)) return "buiten_grens";
  if (tolerantie !== null && setting !== null) {
    const toegestaan = tolerantieSoort === "procent" ? (Math.abs(setting) * tolerantie) / 100 : tolerantie;
    if (Math.abs(gemeten - setting) > toegestaan) return "buiten_tolerantie";
  }
  return "ok";
}

export const markeringTekst: Record<Markering, string> = {
  ok: "Binnen grenzen",
  buiten_tolerantie: "Buiten tolerantie",
  buiten_grens: "Buiten grens",
};

/** Leest "82,5" en "82.5"; geeft null bij lege of ongeldige invoer. */
export function leesGetal(tekst: string): number | null {
  const t = tekst.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function toonGetal(n: number | null): string {
  if (n === null) return "–";
  return n.toLocaleString("nl-NL", { maximumFractionDigits: 3 });
}
