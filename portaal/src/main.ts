import { VERSIE } from "../../gedeeld/versie";
import "./stijl.css";
import { h, nieuweRoute, toon } from "../../gedeeld/ui";
import { ApiFout, haal, portalenVoor, PORTALEN, ONDERDELEN_MET_PRODUCT, gekozenProduct, producten, sessie, stuur, tegelsVoor } from "./basis";
import * as kwaliteit from "./kwaliteit/schermen";
import * as productie from "./productie/schermen";
import * as beheer from "./beheer/schermen";
import * as planning from "./planning/schermen";
import { stopWandscherm, wandscherm } from "./wandscherm";
import { heeftMeldingen, meldingenScherm, meldingTeller, stopMeldingen } from "./meldingen";
import { etikettenScherm } from "./etiketten";
import { certificaat } from "./kwaliteit/certificaat";
import { formulieren, nalevering } from "./nalevering";
import { HULP_ROLLEN, hulpBlad, hulpVoor } from "../../gedeeld/hulp";
import "../../gedeeld/hulp.css";
import type { Rol } from "../../gedeeld/types";

// ---------- Menu ----------
async function tekenMenu(actiefPortaal: string, actiefOnderdeel: string) {
  const menu = document.getElementById("menu")!;
  if (!sessie.geldig()) {
    menu.replaceChildren(h("div", { class: "merk" }, "Portalen"));
    return;
  }
  const portalen = portalenVoor(sessie.rol);
  // Op een smal scherm (tablet) staat het menu dicht achter een knop, zodat de inhoud meteen zichtbaar is (#44).
  const huidig = portalen.find((p) => p.id === actiefPortaal);
  const onderdeel = huidig?.onderdelen.find((o) => o.pad === actiefOnderdeel);
  const inhoud = h("div", { id: "menu-inhoud", "data-dicht": "" });
  const knop = h("button", {
    class: "menu-knop", type: "button", "aria-expanded": "false", "aria-controls": "menu-inhoud",
    onclick: () => {
      const open = inhoud.hasAttribute("data-dicht");
      inhoud.toggleAttribute("data-dicht", !open);
      knop.setAttribute("aria-expanded", String(open));
      knop.firstChild!.textContent = open ? "Menu sluiten" : "Menu";
    },
  }, "Menu", h("span", { class: "menu-knop-waar" }, [huidig?.naam, onderdeel?.naam].filter(Boolean).join(" · ") || (actiefPortaal === "meldingen" ? "Meldingen" : "")));
  // Meldingen staan buiten het inklapbare deel: de teller blijft ook op een smal scherm zichtbaar.
  menu.replaceChildren(
    h("div", { class: "menu-kop" }, h("a", { class: "merk", href: "#/", title: "Startpagina" }, "Portalen"), knop),
    ...(heeftMeldingen()
      ? [h("a", { class: "menu-portaal menu-meldingen", href: "#/meldingen", "aria-current": actiefPortaal === "meldingen" ? "page" : undefined }, "Meldingen", meldingTeller())]
      : []),
    // De productkiezer staat, net als Meldingen, buiten het inklapbare deel (D55).
    ...(ONDERDELEN_MET_PRODUCT[actiefPortaal]?.includes(actiefOnderdeel) ? [await productKiezer()].filter((x): x is Node => !!x) : []),
    inhoud);
  inhoud.replaceChildren(
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
      h("button", { class: "knop-link", onclick: () => { sessie.afmelden(); location.hash = "#/login"; } }, "Afmelden"),
      h("a", { href: "#/" }, "Startpagina"),
      h("a", { href: "#/hulp" }, "Hulp"),
      h("div", { class: "sub versie" }, `Versie ${VERSIE}`)),
  );
}

// ---------- Inloggen ----------
/** Productkiezer voor de analyses: "Alle producten" of één product. Onthouden op deze computer. */
async function productKiezer(): Promise<Node | null> {
  let lijst: { code: string; naam: string }[];
  try { lijst = await producten(); } catch { return null; }
  if (lijst.length < 2) return null;
  const sel = h("select", {
    id: "product-keuze",
    onchange: (e: Event) => { gekozenProduct.code = (e.target as HTMLSelectElement).value || null; void route(); },
  },
  h("option", { value: "" }, "Alle producten"),
  lijst.map((p) => h("option", { value: p.code, selected: p.code === gekozenProduct.code }, `${p.code} – ${p.naam}`)));
  return h("div", { class: "menu-product" }, h("label", { for: "product-keuze" }, "Product"), sel);
}

function loginScherm() {
  const naam = h("input", { id: "gebruikersnaam", type: "text", autocomplete: "username", required: true }) as HTMLInputElement;
  const ww = h("input", { id: "wachtwoord", type: "password", autocomplete: "current-password", required: true }) as HTMLInputElement;
  const fout = h("p", { class: "foutmelding", role: "alert" });
  const testaccounts = h("div", { class: "testaccounts" });
  toon(
    h("div", { class: "inlog" },
      h("h1", {}, "Inloggen"),
      h("p", { class: "sub" }, "Met je eigen account. Daarna kies je het invoerscherm of een portaal."),
      h("form", {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          fout.textContent = "";
          try {
            const r = await stuur<{ token: string; rol: string }>("POST", "/auth/login", { gebruikersnaam: naam.value.trim(), wachtwoord: ww.value });
            sessie.token = r.token;
            location.hash = "#/";
          } catch (e) {
            fout.textContent =
              e instanceof ApiFout && e.status === 401 ? "Onjuiste gebruikersnaam of wachtwoord." : (e as Error).message;
          }
        },
      },
        h("label", { for: "gebruikersnaam" }, "Gebruikersnaam", naam),
        h("label", { for: "wachtwoord" }, "Wachtwoord", ww),
        fout,
        h("button", { class: "knop knop-hoofd", type: "submit" }, "Inloggen")),
      testaccounts),
  );
  naam.focus();
  // In een testomgeving: de testaccounts onder het formulier (nooit in een echte installatie, D28).
  haal<{ test: boolean; testaccounts: { naam: string; wat: string }[] }>("/auth/omgeving").then((o) => {
    if (!o.test) return;
    testaccounts.replaceChildren(h("p", { class: "sub" }, "Testomgeving met fictieve gegevens. Testaccounts, wachtwoord steeds demo:"),
      h("table", { class: "tabel compact" }, h("tbody", {}, o.testaccounts.map((t) => h("tr", {}, h("td", {}, h("strong", {}, t.naam)), h("td", {}, t.wat))))));
  }).catch(() => {});
}

// ---------- Startpagina (D54) ----------
function startScherm() {
  const tegels = tegelsVoor(sessie.rol);
  // Maar één bestemming (bijvoorbeeld een operator: alleen het invoerscherm): meteen daarheen.
  if (tegels.length === 1) return void location.assign(tegels[0].href);
  toon(
    h("div", { class: "kop" }, h("div", {}, h("h1", {}, `Welkom, ${sessie.naam}`), h("p", { class: "sub" }, "Kies waar je wilt werken."))),
    tegels.length
      ? h("ul", { class: "startpagina" }, tegels.map((t) =>
          h("li", {}, h("a", {
            class: `starttegel starttegel-${t.id}`, href: t.href,
            // Kwaliteit neemt de inlog alleen mee als ze zelf voor het invoerscherm kiest (lab-pc, D58); zie invoer/src/sessie.ts.
            onclick: t.id === "invoer" ? () => { try { localStorage.setItem("invoer.vanStart", String(Date.now())); } catch { /* */ } } : undefined,
          }, h("strong", {}, t.naam), h("span", {}, t.uitleg)))))
      : h("p", { class: "leeg" }, "Voor jouw rol is (nog) geen portaal beschikbaar. Vraag de beheerder om een andere rol."),
    h("p", { class: "sub", style: "margin-top:24px" }, h("a", { href: "#/hulp" }, "Hulp voor jouw rol"), ", ook om af te drukken."),
  );
}

// ---------- Hulp per rol (D59) ----------
function hulpScherm(gekozen?: string) {
  const eigen = sessie.rol && HULP_ROLLEN.includes(sessie.rol) ? sessie.rol : "operator";
  const rol = (gekozen && HULP_ROLLEN.includes(gekozen as Rol) ? gekozen : eigen) as Rol;
  const keuze = h("select", { id: "hulp-rol", onchange: (e: Event) => { location.hash = `#/hulp/${(e.target as HTMLSelectElement).value}`; } },
    HULP_ROLLEN.map((r) => h("option", { value: r, selected: r === rol }, ((t) => t[0].toUpperCase() + t.slice(1))(hulpVoor(r).titel.replace(/^Hulp voor (de )?/, "")))));
  toon(
    h("div", { class: "hulp-keuze" },
      h("label", { class: "filter", for: "hulp-rol" }, "Hulp voor", keuze),
      h("button", { class: "knop", type: "button", onclick: () => window.print() }, "Afdrukken")),
    hulpBlad(rol, VERSIE),
  );
}

function volgtScherm(naam: string) {
  toon(h("div", { class: "kop" }, h("div", {}, h("h1", {}, `Portaal ${naam}`), h("p", { class: "sub" }, "Dit portaal wordt in een volgende stap gebouwd."))),
    h("p", { class: "leeg" }, "Tot die tijd: het lotpaspoort en de analyses staan in het portaal Kwaliteit; invoer en correcties in het invoerscherm."));
}

// ---------- Navigatie ----------
async function route() {
  nieuweRoute();
  const [, portaal = "", onderdeel = "", arg, arg2] = location.hash.split("/");
  if (!sessie.geldig()) {
    stopWandscherm();
    stopMeldingen();
    await tekenMenu("", "");
    return loginScherm();
  }
  // Wandscherm: volledig scherm, zonder menu. Een schermaccount ziet alleen dit.
  if (portaal === "wandscherm" || sessie.rol === "scherm") {
    if (portaal !== "wandscherm") return void (location.hash = "#/wandscherm");
    return wandscherm(onderdeel ? decodeURIComponent(onderdeel) : undefined, arg ? decodeURIComponent(arg) : undefined);
  }
  stopWandscherm();
  if (portaal === "etiketten") {
    await tekenMenu("", "");
    return etikettenScherm(onderdeel, arg);
  }
  if (portaal === "meldingen" && heeftMeldingen()) {
    await tekenMenu("meldingen", "");
    return meldingenScherm(onderdeel === "alle");
  }
  // Nainvoeren na papier en lege formulieren (#75, D60): ploegleider en beheerder.
  if (portaal === "nainvoeren" && (sessie.rol === "ploegleider" || sessie.rol === "beheerder")) {
    await tekenMenu("", "");
    return onderdeel === "formulier" ? formulieren(arg) : nalevering();
  }
  if (portaal === "hulp") {
    await tekenMenu("", "");
    return hulpScherm(onderdeel);
  }
  if (!portaal || portaal === "start") {
    await tekenMenu("", "");
    return startScherm();
  }
  const toegestaan = portalenVoor(sessie.rol);
  if (!toegestaan.length) return void (location.hash = "#/");
  const p = toegestaan.find((x) => x.id === portaal);
  // Eerste portaal dat bij de rol hoort (ploegleider: Productie, kwaliteit: Kwaliteit).
  const standaard = sessie.rol === "ploegleider" || sessie.rol === "productiemanager" ? "productie" : sessie.rol === "beheerder" ? "beheer" : sessie.rol === "planner" ? "planning" : toegestaan.find((x) => x.klaar)?.id ?? toegestaan[0].id;
  if (!p) return void (location.hash = toegestaan.some((x) => x.id === standaard) ? `#/${standaard}` : "#/");
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
      case "stilstand": return productie.stilstand();
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
      case "overzicht": return planning.overzicht(a1);
      case "route": return planning.route(a1);
      case "lots": return planning.lots();
      case "producten": return planning.producten(a1);
      case "capaciteit": return planning.capaciteit();
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
      case "oorzaken": return beheer.oorzaken();
      case "bedrijf": return beheer.bedrijf();
      case "pcs": return beheer.pcs();
      case "logboek": return beheer.logboek();
      case "server": return beheer.server();
      default: return void (location.hash = "#/beheer");
    }
  }
  await tekenMenu(p.id, ["batch"].includes(deel) ? "beoordelen" : deel === "certificaat" ? "lotpaspoort" : deel);
  switch (deel) {
    case "overzicht": return kwaliteit.overzicht();
    case "beoordelen": return kwaliteit.beoordelen();
    case "lotpaspoort": return kwaliteit.lotpaspoort(a);
    case "grondstoffen": return kwaliteit.grondstoffen(a);
    case "regelkaarten": return kwaliteit.regelkaarten(a);
    case "certificaat": return certificaat(a ?? "", arg2);
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
