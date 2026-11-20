// Pc koppelen, inloggen en naam kiezen.
import { ApiFout, GeenVerbinding, haal, stuur } from "../api";
import { vergeetConfig } from "../registraties";
import { sessie } from "../sessie";
import { h, laden, melding, toon, vastHouden } from "../ui";
import { inloggenGelukt } from "../wachtrij";

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
  const fout = h("p", { class: "label-buiten_grens", role: "alert" });
  const vorm = h(
    "form",
    {
      class: "inlog",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        fout.textContent = "";
        try {
          const r = await stuur<{ token: string; naamKiezen: boolean; operator?: { id: string; naam: string } | null }>("POST", "/auth/login", {
            gebruikersnaam: naam.value.trim(),
            wachtwoord: ww.value,
            pc: sessie.pc ?? undefined,
          });
          sessie.token = r.token;
          // Eigen account: de naam ligt vast (D53). Gedeeld account: daarna een naam kiezen.
          sessie.operatornaam = r.operator?.naam ?? null;
          vergeetConfig();
          inloggenGelukt();
          location.hash = r.naamKiezen ? "#/naam" : "#/stappen";
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
  toon(
    h("h1", {}, "Inloggen"),
    h("p", { class: "sub" }, "Log in met je eigen gebruikersnaam en wachtwoord. Alles wat je invoert, komt op jouw naam."),
    h("p", { class: "sub" }, `Deze pc: ${sessie.pc}. `, h("a", { href: "#/pc" }, "Andere pc kiezen")),
    vorm,
  );
  naam.focus();
}

export async function naamScherm() {
  const actueel = vastHouden();
  toon(h("h1", {}, "Wie ben je?"), laden());
  let namen: { id: string; naam: string }[];
  try {
    namen = (await haal<{ id: string; naam: string }[]>("/auth/operators")).data;
    if (!actueel()) return;
  } catch {
    toon(h("h1", {}, "Wie ben je?"), h("p", {}, "De namenlijst kon niet worden geladen. Probeer het opnieuw."));
    return;
  }
  toon(
    h("h1", {}, "Wie ben je?"),
    h("p", { class: "sub" }, "Je naam komt bij alles wat je invoert."),
    h("p", { class: "label-wacht" }, "Je bent ingelogd met het gedeelde account. Vraag de beheerder om een eigen account; dan hoef je hier niet meer te kiezen."),
    h(
      "div",
      { class: "raster" },
      namen.map((n) =>
        h(
          "button",
          {
            class: "keuze",
            onclick: async () => {
              try {
                const r = await stuur<{ token: string }>("POST", "/auth/operator", { operatorId: n.id });
                sessie.token = r.token;
                sessie.operatornaam = n.naam;
                location.hash = "#/stappen";
              } catch (e) {
                if (e instanceof ApiFout && e.status === 401) location.hash = "#/login";
                else melding(e instanceof GeenVerbinding ? "Naam wisselen kan alleen met verbinding" : (e as Error).message, "fout");
              }
            },
          },
          n.naam,
        ),
      ),
    ),
  );
}
