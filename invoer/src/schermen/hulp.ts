// Hulp in het invoerscherm (D59): de tekst voor de eigen rol, afdrukbaar als A4. Werkt offline.
import { hulpBlad } from "../../../gedeeld/hulp";
import "../../../gedeeld/hulp.css";
import { VERSIE } from "../../../gedeeld/versie";
import { sessie } from "../sessie";
import { h, melding, toon } from "../ui";
import { stuur, GeenVerbinding } from "../api";
import { wachtwoordFormulier } from "../../../gedeeld/wachtwoord";

export function hulpScherm() {
  // Zonder inlog: de hulp voor operators (daar staat ook het inloggen in).
  const rol = sessie.geldig() ? sessie.rol : null;
  toon(
    h("div", { class: "hulp-keuze" },
      h("button", { class: "knop", type: "button", onclick: () => window.print() }, "Afdrukken"),
      h("button", { class: "knop knop-stil", type: "button", onclick: () => { location.hash = sessie.geldig() ? "#/stappen" : "#/login"; } }, "Terug"),
      sessie.geldig() ? h("a", { class: "hulp-link", href: "#/wachtwoord" }, "Wachtwoord wijzigen") : null),
    hulpBlad(rol === "ploegleider" || rol === "kwaliteit" ? rol : "operator", VERSIE),
  );
}

/** Eigen wachtwoord wijzigen (#76, D61). Alleen met verbinding; de wachtrij merkt er niets van. */
export function wachtwoordWijzigen() {
  toon(
    h("h1", {}, "Wachtwoord wijzigen"),
    h("p", { class: "sub" }, "Je nieuwe wachtwoord geldt voor het invoerscherm en de portalen. Wijzigen kan alleen met verbinding."),
    wachtwoordFormulier({
      metHuidig: true, foutKlasse: "label-buiten_grens",
      opslaan: async (huidig, nieuw) => {
        try {
          const r = await stuur<{ token: string }>("POST", "/auth/wachtwoord", { huidig, nieuw });
          sessie.token = r.token;
        } catch (e) {
          throw e instanceof GeenVerbinding ? new Error("Geen verbinding met de server. Probeer het later opnieuw.") : e;
        }
        melding("Je wachtwoord is opgeslagen", "ok");
        location.hash = "#/stappen";
      },
    }),
  );
}
