// #113.1: native toegangspoort, bestaande componenten en autorisatieprojectie.
// Nog geen materiaal-/receptmutaties of nieuwe Excel-functionaliteit.
import { h, toon } from "../../../gedeeld/ui";
import { PORTALEN, zichtbareOnderdelen, rechten } from "../basis";

const uitleg: Record<string,string> = {
  materialen: "Versiebeheer van materiaaldefinities en materiaalklassen.",
  eenheden: "Fysische grootheden, eenheden en gecontroleerde conversieversies.",
  recepten: "Master Recipe-identiteiten, conceptrevisies en receptinhoud.",
  beoordelingen: "Vastgezette MOC-dossiers, onafhankelijke beoordelingen en formele vrijgave.",
};
export function scherm(deel: string) {
  const p = PORTALEN.find(x => x.id === "engineering")!;
  const onderdelen = zichtbareOnderdelen(p);
  if (!rechten()?.personal || !onderdelen.some(x => x.pad === deel)) {
    return toon(h("p", { class: "leeg", role: "alert" }, "Geen actuele bevoegdheid voor dit onderdeel."));
  }
  if (deel === "overzicht") {
    return toon(
      h("div", { class: "kop" }, h("div", {}, h("h1", {}, "Process Engineering"),
        h("p", { class: "sub" }, "Gecontroleerd beheer van stamgegevens en Master Recipes."))),
      h("ul", { class: "startpagina" }, onderdelen.filter(x => x.pad !== "overzicht").map(x =>
        h("li", {}, h("a", { class: "starttegel", href: "#/engineering/"+x.pad },
          h("strong", {}, x.naam), h("span", {}, uitleg[x.pad] ?? ""))))),
    );
  }
  // Tijdelijke, expliciete plaatsaanduiding. De verdere #113-pakketten
  // vervangen deze door echte persoonlijke API-schermen.
  const item = onderdelen.find(x => x.pad === deel)!;
  toon(h("div", { class: "kop" }, h("div", {}, h("h1", {}, item.naam),
    h("p", { class: "sub" }, uitleg[deel] ?? ""))),
    h("p", { class: "leeg" }, "Dit onderdeel is in ontwikkeling; beheerhandelingen zijn hier nog niet beschikbaar."));
}
