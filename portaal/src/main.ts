import { VERSIE } from "../../gedeeld/versie";
import "./stijl.css";
import { h, nieuweRoute, toon } from "../../gedeeld/ui";
import { ApiFout, portalenVoor, PORTALEN, sessie, stuur } from "./basis";
import * as kwaliteit from "./kwaliteit/schermen";
import * as productie from "./productie/schermen";
import * as beheer from "./beheer/schermen";
import * as planning from "./planning/schermen";
import { stopWandscherm, wandscherm } from "./wandscherm";
import { heeftMeldingen, meldingenScherm, meldingTeller, stopMeldingen } from "./meldingen";

// ---------- Menu ----------
async function tekenMenu(actiefPortaal: string, actiefOnderdeel: string) {
  const menu = document.getElementById("menu")!;
  if (!sessie.geldig()) {
    menu.replaceChildren(h("div", { class: "merk" }, "Portalen"));
    return;
  }
  const portalen = portalenVoor(sessie.rol);
  menu.replaceChildren(
    h("div", { class: "merk" }, "Portalen"),
    ...(heeftMeldingen()
      ? [h("a", { class: "menu-portaal menu-meldingen", href: "#/meldingen", "aria-current": actiefPortaal === "meldingen" ? "page" : undefined }, "Meldingen", meldingTeller())]
      : []),
    ...portalen.map((p) =>
      h("div", { class: "menu-groep" },
        h("a", { class: "menu-portaal", href: `#/${p.id}`, "aria-current": p.id === actiefPortaal && !actiefOnderdeel ? "page" : undefined }, p.naam,
          p.klaar ? null : h("span", { class: "binnenkort" }, "volgt")),
        p.id === actiefPortaal && p.onderdelen.length
          ? h("ul", {}, p.onderdelen.map((o) => {
              const teller = h("span", { class: "teller" });
              o.teller?.().then((n) => { if (n > 0) teller.textContent = String(n); }).catch(() => {});
              return h("li", {}, h("a", { href: `#/${p.id}/${o.pad}`, "aria-current": o.pad === actiefOnderdeel ? "page" : undefined }, o.naam, teller));
            }))
          : null)),
    h("div", { class: "menu-voet" },
      h("div", {}, sessie.naam, h("span", { class: "sub" }, ` (${sessie.rol})`)),
      h("button", { class: "knop-link", onclick: () => { sessie.token = null; location.hash = "#/login"; } }, "Afmelden"),
      h("a", { href: "/invoer/" }, "Naar het invoerscherm"),
      h("a", { href: "#/wandscherm" }, "Wandscherm"),
      h("div", { class: "sub versie" }, `Versie ${VERSIE}`)),
  );
}

// ---------- Inloggen ----------
function loginScherm() {
  const naam = h("input", { id: "gebruikersnaam", type: "text", autocomplete: "username", required: true }) as HTMLInputElement;
  const ww = h("input", { id: "wachtwoord", type: "password", autocomplete: "current-password", required: true }) as HTMLInputElement;
  const fout = h("p", { class: "foutmelding", role: "alert" });
  toon(
    h("div", { class: "inlog" },
      h("h1", {}, "Inloggen"),
      h("p", { class: "sub" }, "Met je persoonlijke account. Operators gebruiken het invoerscherm."),
      h("form", {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          fout.textContent = "";
          try {
            const r = await stuur<{ token: string; rol: string }>("POST", "/auth/login", { gebruikersnaam: naam.value.trim(), wachtwoord: ww.value });
            if (r.rol === "operator") {
              fout.textContent = "Het operator-account is voor het invoerscherm. Log hier in met je persoonlijke account.";
              return;
            }
            sessie.token = r.token;
            location.hash = "#/";
          } catch (e) {
            fout.textContent =
              e instanceof ApiFout && e.status === 401 ? "Onjuiste gebruikersnaam of wachtwoord." :
              /Operators loggen in/.test((e as Error).message) ? "Het operator-account is voor het invoerscherm. Log hier in met je persoonlijke account." :
              (e as Error).message;
          }
        },
      },
        h("label", { for: "gebruikersnaam" }, "Gebruikersnaam", naam),
        h("label", { for: "wachtwoord" }, "Wachtwoord", ww),
        fout,
        h("button", { class: "knop knop-hoofd", type: "submit" }, "Inloggen"))),
  );
  naam.focus();
}

function volgtScherm(naam: string) {
  toon(h("div", { class: "kop" }, h("div", {}, h("h1", {}, `Portaal ${naam}`), h("p", { class: "sub" }, "Dit portaal wordt in een volgende stap gebouwd."))),
    h("p", { class: "leeg" }, "Tot die tijd: het lotpaspoort en de analyses staan in het portaal Kwaliteit; invoer en correcties in het invoerscherm."));
}

// ---------- Navigatie ----------
async function route() {
  nieuweRoute();
  const [, portaal = "", onderdeel = "", arg] = location.hash.split("/");
  if (!sessie.geldig()) {
    stopWandscherm();
    stopMeldingen();
    await tekenMenu("", "");
    return loginScherm();
  }
  // Wandscherm: volledig scherm, zonder menu. Een schermaccount ziet alleen dit.
  if (portaal === "wandscherm" || sessie.rol === "scherm") {
    if (portaal !== "wandscherm") return void (location.hash = "#/wandscherm");
    return wandscherm(onderdeel ? decodeURIComponent(onderdeel) : undefined);
  }
  stopWandscherm();
  if (portaal === "meldingen" && heeftMeldingen()) {
    await tekenMenu("meldingen", "");
    return meldingenScherm(onderdeel === "alle");
  }
  const toegestaan = portalenVoor(sessie.rol);
  if (!toegestaan.length) {
    await tekenMenu("", "");
    return toon(h("h1", {}, "Geen portaal"), h("p", { class: "leeg" }, "Voor jouw rol is (nog) geen portaal beschikbaar."));
  }
  const p = toegestaan.find((x) => x.id === portaal);
  // Eerste portaal dat bij de rol hoort (ploegleider: Productie, kwaliteit: Kwaliteit).
  const standaard = sessie.rol === "ploegleider" ? "productie" : sessie.rol === "beheerder" ? "beheer" : sessie.rol === "planner" ? "planning" : toegestaan.find((x) => x.klaar)?.id ?? toegestaan[0].id;
  if (!p) return void (location.hash = `#/${standaard}`);
  if (!p.klaar) { await tekenMenu(p.id, ""); return volgtScherm(p.naam); }
  const deel = onderdeel || "overzicht";
  const a = arg ? decodeURIComponent(arg) : undefined;
  if (p.id === "productie") {
    await tekenMenu(p.id, ["stap", "batch", "lot"].includes(deel) ? "overzicht" : deel);
    switch (deel) {
      case "overzicht": return productie.werkvoorraad();
      case "stap": return a ? productie.stap(a) : productie.werkvoorraad();
      case "doorlooptijden": return productie.doorlooptijden();
      case "week": return productie.perWeek();
      case "correcties": return productie.correcties();
      case "overdracht": return productie.overdracht(a);
      case "batch": return a ? kwaliteit.batch(a) : productie.werkvoorraad();
      case "lot": return a ? kwaliteit.lotpaspoort(a) : productie.werkvoorraad();
      default: return void (location.hash = "#/productie");
    }
  }
  if (p.id === "planning") {
    const stuk = onderdeel || "week";
    await tekenMenu(p.id, stuk);
    const [, , , a1, a2] = location.hash.split("/").map(decodeURIComponent);
    switch (stuk) {
      case "week": return planning.week(a1);
      case "dag": return planning.dag(a1, a2);
      case "lots": return planning.lots();
      case "producten": return planning.producten();
      default: return void (location.hash = "#/planning");
    }
  }
  if (p.id === "beheer") {
    const stuk = onderdeel || "stappen";
    await tekenMenu(p.id, stuk);
    switch (stuk) {
      case "stappen": return beheer.stappen(a);
      case "accounts": return beheer.accounts();
      case "operators": return beheer.operators();
      case "grondstoffen": return beheer.grondstoffen();
      case "ploegen": return beheer.ploegen();
      case "pcs": return beheer.pcs();
      case "logboek": return beheer.logboek();
      case "server": return beheer.server();
      default: return void (location.hash = "#/beheer");
    }
  }
  await tekenMenu(p.id, ["batch"].includes(deel) ? "beoordelen" : deel);
  switch (deel) {
    case "overzicht": return kwaliteit.overzicht();
    case "beoordelen": return kwaliteit.beoordelen();
    case "lotpaspoort": return kwaliteit.lotpaspoort(a);
    case "grondstoffen": return kwaliteit.grondstoffen(a);
    case "batch": return a ? kwaliteit.batch(a) : kwaliteit.beoordelen();
    case "afwijkingen": return kwaliteit.afwijkingen();
    case "trend": return kwaliteit.trendScherm(a);
    case "herbewerkingen": return kwaliteit.herbewerkingen();
    default: location.hash = `#/${p.id}`;
  }
}

window.addEventListener("hashchange", () => void route());
// Bij afdrukken (lotpaspoort) alles uitklappen.
window.addEventListener("beforeprint", () => document.querySelectorAll("details").forEach((d) => (d.open = true)));
void route();
// Bij een besluit vernieuwt het scherm zelf; de teller in het menu ververst bij de volgende navigatie.
void PORTALEN;
