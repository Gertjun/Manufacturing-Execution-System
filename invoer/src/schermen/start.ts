// Pc koppelen en persoonlijk inloggen.
import { GeenVerbinding, haal, stuur } from "../api";
import { vergeetConfig } from "../registraties";
import { sessie } from "../sessie";
import { h, laden, toon, vastHouden } from "../ui";
import { inloggenGelukt } from "../wachtrij";
import { wachtwoordFormulier } from "../../../gedeeld/wachtwoord";

export async function pcScherm() {
  const actueel = vastHouden();
  toon(h("h1", {}, "Welke pc is dit?"), laden());
  try {
    const pcs = (await haal<{ naam: string; locatie: string | null }[]>("/config/pcs")).data;
    if (!actueel()) return;
    toon(
      h("h1", {}, "Welke pc is dit?"),
      h("p", { class: "sub" }, "Dit kies je één keer per pc. De keuze blijft bewaard."),
      h(
        "div",
        { class: "raster" },
        pcs.map((pc) =>
          h(
            "button",
            {
              class: "keuze",
              onclick: () => {
                sessie.pc = pc.naam;
                // Alleen het token van deze pc vervalt; wie op de startpagina is ingelogd, blijft dat (D54).
                sessie.token = null;
                sessie.operatornaam = null;
                location.hash = "#/login";
              },
            },
            pc.naam,
            pc.locatie ? h("small", {}, pc.locatie) : null,
          ),
        ),
      ),
    );
  } catch {
    toon(h("h1", {}, "Welke pc is dit?"), h("p", {}, "De server is niet bereikbaar. Controleer de netwerkkabel en probeer het opnieuw."),
      h("button", { class: "knop", onclick: () => pcScherm() }, "Opnieuw proberen"));
  }
}

export function loginScherm() {
  const naam = h("input", { id: "gebruikersnaam", type: "text", autocomplete: "username", required: true, class: "breed" }) as HTMLInputElement;
  const ww = h("input", { id: "wachtwoord", type: "password", autocomplete: "current-password", required: true, class: "breed" }) as HTMLInputElement;
  const fout = h("p", { class: "foutmelding", role: "alert" });
  const vorm = h(
    "form",
    {
      class: "inlog",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        fout.textContent = "";
        try {
          type Antwoord = { token: string; naamKiezen: boolean; operator?: { id: string; naam: string } | null; wachtwoordWijzigen?: boolean };
          let r = await stuur<Antwoord>("POST", "/auth/login", {
            gebruikersnaam: naam.value.trim(),
            wachtwoord: ww.value,
            pc: sessie.pc ?? undefined,
          });
          // Tijdelijk wachtwoord (#76): eerst een eigen wachtwoord. Het tijdelijke token wordt niet bewaard, zodat de
          // wachtrij er niets mee verstuurt (de server weigert dat token voor al het andere).
          if (r.wachtwoordWijzigen) r = await eigenWachtwoord(r.token, ww.value);
          sessie.token = r.token;
          // Eigen account: de naam ligt vast (D53). Gedeeld account: daarna een naam kiezen.
          sessie.operatornaam = r.operator?.naam ?? null;
          vergeetConfig();
          inloggenGelukt();
          location.hash = "#/stappen";
        } catch (e) {
          fout.textContent =
            e instanceof GeenVerbinding ? "Geen verbinding met de server. Inloggen kan alleen met verbinding." : (e as Error).message;
        }
      },
    },
    h("label", { for: "gebruikersnaam" }, "Gebruikersnaam", naam),
    h("label", { for: "wachtwoord" }, "Wachtwoord", ww),
    fout,
    h("button", { class: "knop knop-hoofd", type: "submit" }, "Inloggen"),
  );
  toon(h("div", { class: "mes-aanmeldkaart" },
    h("p", { class: "mes-aanmeldmerk" }, "MES · Manufacturing Execution System"),
    h("h1", {}, "Inloggen"),
    h("p", { class: "sub" }, "Log in met je eigen gebruikersnaam en wachtwoord. Alles wat je invoert, komt op jouw naam."),
    h("p", { class: "mes-aanmeldcontext" }, `Deze pc: ${sessie.pc}. `, h("a", { href: "#/pc" }, "Andere pc kiezen")),
    vorm,
    h("p", { class: "sub mes-aanmeldvoet" }, h("a", { href: "#/hulp" }, "Hulp")),
  ));
  naam.focus();
}

/** Na een tijdelijk wachtwoord: een eigen wachtwoord kiezen; geeft het nieuwe inlogantwoord. */
function eigenWachtwoord<T>(tijdelijkToken: string, tijdelijk: string): Promise<T> {
  return new Promise((klaar) => {
    toon(h("div", { class: "mes-aanmeldkaart" },
      h("p", { class: "mes-aanmeldmerk" }, "MES · Manufacturing Execution System"),
      h("h1", {}, "Kies een eigen wachtwoord"),
      h("p", { class: "sub" }, "Je hebt een tijdelijk wachtwoord van de beheerder gekregen. Kies nu een wachtwoord dat alleen jij weet; daarna ga je verder."),
      wachtwoordFormulier({
        metHuidig: false, foutKlasse: "label-buiten_grens", knop: "Opslaan en verder",
        opslaan: async (_h, nieuw) => {
          try {
            klaar(await stuur<T>("POST", "/auth/wachtwoord", { huidig: tijdelijk, nieuw }, { authorization: `Bearer ${tijdelijkToken}` }));
          } catch (e) {
            throw e instanceof GeenVerbinding ? new Error("Geen verbinding met de server. Probeer het opnieuw.") : e;
          }
        },
      }),
    ));
    (document.getElementById("ww-nieuw") as HTMLInputElement | null)?.focus();
  });
}

