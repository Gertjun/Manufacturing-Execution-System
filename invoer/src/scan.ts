// Handscanner: wat er gebeurt met een gescande code hangt af van het scherm.
// Standaard: de batch of het lot opzoeken. Een scherm kan dat voor zich overnemen.
import { luisterNaarScanner } from "../../gedeeld/barcode";

let actie: ((code: string) => void) | null = null;

/** Het huidige scherm handelt scans af; bij een nieuw scherm vervalt dit vanzelf (zie wisScanActie). */
export function zetScanActie(fn: (code: string) => void) { actie = fn; }
export function wisScanActie() { actie = null; }

export function startScanner() {
  luisterNaarScanner((code) => {
    if (actie) actie(code);
    else location.hash = `#/zoek/${encodeURIComponent(code)}`;
  });
}
