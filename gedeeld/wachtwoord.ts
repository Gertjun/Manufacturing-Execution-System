// Eigen wachtwoord kiezen (#76, D61): na een tijdelijk wachtwoord van de beheerder, in het invoerscherm en in de
// portalen. Het formulier controleert alleen wat de gebruiker meteen kan verbeteren; de regels staan in de database.
import { h } from "./ui";

export interface WachtwoordOpties {
  /** Met een veld voor het huidige wachtwoord (zelf wijzigen); zonder: het tijdelijke wachtwoord van de inlog. */
  metHuidig: boolean;
  opslaan: (huidig: string | null, nieuw: string) => Promise<void>;
  knop?: string;
  /** Klasse voor de foutregel (die verschilt per app). */
  foutKlasse?: string;
}

export function wachtwoordFormulier(o: WachtwoordOpties): HTMLFormElement {
  const veld = (id: string, ac: string) => h("input", { id, type: "password", autocomplete: ac, required: true }) as HTMLInputElement;
  const huidig = o.metHuidig ? veld("ww-huidig", "current-password") : null;
  const nieuw = veld("ww-nieuw", "new-password");
  const nogmaals = veld("ww-nogmaals", "new-password");
  const fout = h("p", { class: o.foutKlasse ?? "foutmelding", role: "alert" });
  const knop = h("button", { class: "knop knop-hoofd", type: "submit" }, o.knop ?? "Wachtwoord opslaan") as HTMLButtonElement;
  return h("form", {
    class: "wachtwoord-kiezen",
    onsubmit: async (e: Event) => {
      e.preventDefault();
      fout.textContent = "";
      if (nieuw.value.length < 8) { fout.textContent = "Kies een wachtwoord van minstens 8 tekens."; nieuw.focus(); return; }
      if (nieuw.value !== nogmaals.value) { fout.textContent = "De twee nieuwe wachtwoorden zijn niet gelijk."; nogmaals.focus(); return; }
      knop.disabled = true;
      try {
        await o.opslaan(huidig ? huidig.value : null, nieuw.value);
      } catch (err) {
        fout.textContent = (err as Error).message;
      } finally {
        knop.disabled = false;
      }
    },
  },
    huidig ? h("label", { for: huidig.id }, "Huidig wachtwoord", huidig) : null,
    h("label", { for: nieuw.id }, "Nieuw wachtwoord", nieuw, h("span", { class: "hint" }, "Minstens 8 tekens. Kies iets wat alleen jij weet.")),
    h("label", { for: nogmaals.id }, "Nieuw wachtwoord nog een keer", nogmaals),
    fout,
    knop) as HTMLFormElement;
}
