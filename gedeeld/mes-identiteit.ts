import { h } from "./ui";
import { VERSIE } from "./versie";

/** Eén herkenbare MES-identiteit; geen sessiegegevens in attributen. */
export function mesMerk() {
  return h("span", { class: "mes-merk" }, "MES");
}
export function mesVersie() {
  return h("span", { class: "mes-versie" }, `Versie ${VERSIE}`);
}
export function mesGebruiker(naam: string, klasse = "") {
  return h("span", { class: `mes-gebruiker ${klasse}`.trim(), title: "Aangemeld als " + naam }, naam);
}
