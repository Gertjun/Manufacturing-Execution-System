// Hulp in het invoerscherm (D59): de tekst voor de eigen rol, afdrukbaar als A4. Werkt offline.
import { hulpBlad } from "../../../gedeeld/hulp";
import "../../../gedeeld/hulp.css";
import { VERSIE } from "../../../gedeeld/versie";
import { sessie } from "../sessie";
import { h, toon } from "../ui";

export function hulpScherm() {
  // Zonder inlog: de hulp voor operators (daar staat ook het inloggen in).
  const rol = sessie.geldig() ? sessie.rol : null;
  toon(
    h("div", { class: "hulp-keuze" },
      h("button", { class: "knop", type: "button", onclick: () => window.print() }, "Afdrukken"),
      h("button", { class: "knop knop-stil", type: "button", onclick: () => { location.hash = sessie.geldig() ? "#/stappen" : "#/login"; } }, "Terug")),
    hulpBlad(rol === "ploegleider" || rol === "kwaliteit" ? rol : "operator", VERSIE),
  );
}
