import "./stijl.css";
import { sessie } from "./sessie";
import { heeftRecht, magInvoer, vernieuwRechten } from "./rechten";
import { bevestig, h, nieuweRoute, toon, vastHouden } from "./ui";
import { acties, inloggenGelukt, opStatus, startWachtrij, type Status } from "./wachtrij";
import { stuur } from "./api";
import { vergeetConfig } from "./registraties";
import { loginScherm, pcScherm } from "./schermen/start";
import { stapScherm, stappenScherm } from "./schermen/werk";
import { registratieScherm } from "./schermen/registratie";
import { wachtrijScherm, zoekScherm } from "./schermen/zoek";
import { overdrachtScherm } from "./schermen/overdracht";
import { heeftMeldingen, meldingenScherm, ongelezen, startMeldingen } from "./schermen/meldingen";
import { startScanner, wisScanActie } from "./scan";
import { hulpScherm, wachtwoordWijzigen } from "./schermen/hulp";
import { volgNummers } from "../../gedeeld/nummers";

// ---------- Statusbalk ----------
let laatsteStatus: Status | null = null;

function tekenBalk() {
  const balk = document.getElementById("balk")!;
  const s = laatsteStatus;
  const route = location.hash.split("/")[1] ?? "";
  const ingelogd = sessie.geldig() && sessie.pc;

  let verbinding: HTMLElement | null = null;
  if (s && ingelogd) {
    const klasse = s.fout > 0 || s.inloggenNodig ? "verbinding probleem" : !s.verbonden ? "verbinding uit" : "verbinding";
    const tekst = s.inloggenNodig
      ? "Opnieuw inloggen nodig"
      : s.fout > 0
        ? `${s.fout} geweigerd`
        : !s.verbonden
          ? s.wacht > 0 ? `Geen verbinding, ${s.wacht} wachten` : "Geen verbinding"
          : s.wacht > 0 ? `Versturen (${s.wacht})` : "Verbonden";
    verbinding = h("a", { class: klasse, href: s.inloggenNodig ? "#/login" : "#/wachtrij", title: "Status van de verbinding en de wachtrij" }, h("span", {}, tekst));
  }

  const actief = (r: string) => (route === r || (r === "stappen" && route === "stap") ? "page" : undefined);
  const naam = () => ingelogd && sessie.operatornaam
    ? h("span", { class: "balk-wie balk-eigen-naam" }, sessie.operatornaam)
    : null;
  const meldingenLink = (klasse?: string) => heeftMeldingen()
    ? h("a", { href: "#/meldingen", class: klasse, "aria-current": actief("meldingen") },
        "Meldingen", ongelezen() ? h("span", { class: "balk-teller" }, ongelezen()) : null)
    : null;

  // Breed scherm (pc, tablet, liggende telefoon): alles in de balk bovenaan. Telefoon staand (D64): bovenaan
  // alleen pc, naam en verbinding; de navigatie staat onderaan binnen duimbereik, de rest onder "Meer".
  const delen: (Node | null)[] = [
    h("div", { class: "balk-naam" }, h("span", { class: sessie.pc ? "alleen-breed" : undefined }, "Production Execution"), sessie.pc ? h("span", { class: "balk-pc" }, sessie.pc) : null),
    ingelogd
      ? h("nav", { class: "balk-nav alleen-breed", "aria-label": "Hoofdmenu" },
          h("a", { href: "#/stappen", "aria-current": actief("stappen") }, "Stappen"),
          h("a", { href: "#/zoek", "aria-current": actief("zoek") }, "Zoeken"),
          heeftRecht("handover.read") ? h("a", { href: "#/overdracht", "aria-current": actief("overdracht") }, "Overdracht") : null,
          h("a", { href: "#/hulp", "aria-current": actief("hulp") }, "Hulp"),
          meldingenLink())
      : null,
    naam(),
    // Ploegleiders gebruiken ook de portalen: terug naar de startpagina (D54).
    ingelogd
      ? h("a", { class: "balk-wie alleen-breed", href: "../portaal/index.html#/" }, "Portalen")
      : null,
    ingelogd
      ? h("button", { class: "balk-wie alleen-breed", onclick: () => void afmelden() }, "Afmelden")
      : null,
    verbinding,
  ];
  balk.replaceChildren(...(delen.filter(Boolean) as Node[]));
  tekenOnderbalk(ingelogd ? [
    h("a", { href: "#/stappen", "aria-current": actief("stappen") }, "Stappen"),
    h("a", { href: "#/zoek", "aria-current": actief("zoek") }, "Zoeken"),
    heeftRecht("handover.read") ? h("a", { href: "#/overdracht", "aria-current": actief("overdracht") }, "Overdracht") : null,
    meldingenLink(),
  ] : null, [
    h("a", { href: "#/hulp" }, "Hulp"),
    h("a", { href: "../portaal/index.html#/" }, "Portalen"),
    h("button", { type: "button", onclick: () => void afmelden() }, "Afmelden"),
  ]);
}

volgNummers(document.getElementById("scherm")!);

// Het paneel "Meer" sluit bij een tik ernaast of op een directe navigatielink.
document.addEventListener("click", (e) => {
  const paneel = document.getElementById("meer-paneel");
  // Een directe navigatielink sluit het paneel meteen, ook wanneer de
  // hashchange en de nieuwe schermrender nog niet zijn afgehandeld.
  const doel = e.target instanceof Element ? e.target : null;
  if (paneel && !paneel.hidden && (!doel?.closest("#onderbalk") || doel.closest("#onderbalk > a"))) {
    paneel.hidden = true;
    document.querySelector(".meer-knop")?.setAttribute("aria-expanded", "false");
  }
});

// Een status- of meldingenupdate mag de actieve bediening niet vervangen.
// Houd de context uitsluitend in geheugen; zet het sessietoken nooit in de DOM.
let onderContext: { token: string | null; pc: string | null; hash: string } | null = null;

/** Navigatie onderaan op een staande telefoon (D64). Op bredere schermen verbergt de CSS hem. */
function tekenOnderbalk(links: (Node | null)[] | null, meer: (Node | null)[]) {
  let onder = document.getElementById("onderbalk");
  if (!links) {
    onder?.remove();
    onderContext = null;
    document.body.classList.remove("met-onderbalk");
    return;
  }
  const context = { token: sessie.token, pc: sessie.pc, hash: location.hash };
  const nieuw = links.filter((link): link is Node => link !== null);
  const paneelBestaand = onder?.querySelector<HTMLElement>(".meer-paneel");
  const knopBestaand = onder?.querySelector<HTMLButtonElement>(".meer-knop");
  if (onder && paneelBestaand && knopBestaand && onderContext &&
      onderContext.token === context.token && onderContext.pc === context.pc && onderContext.hash === context.hash) {
    // Alleen de dynamische links bijwerken (bijvoorbeeld de meldingenteller).
    // Paneel en knop blijven dezelfde DOM-nodes, inclusief openstaat en focus.
    const oud = Array.from(onder.children).filter(el => el !== paneelBestaand && el !== knopBestaand);
    if (oud.length !== nieuw.length || oud.some((el, i) => !el.isEqualNode(nieuw[i]))) {
      for (const el of oud) el.remove();
      for (const link of nieuw) onder.insertBefore(link, knopBestaand);
    }
    return;
  }
  onderContext = context;
  if (!onder) {
    onder = h("nav", { id: "onderbalk", "aria-label": "Hoofdmenu onderaan" });
    document.body.append(onder);
  }
  document.body.classList.add("met-onderbalk");
  const paneel = h("div", { class: "meer-paneel", id: "meer-paneel", hidden: true }, ...(meer.filter(Boolean) as Node[]));
  const knop = h("button", { type: "button", class: "meer-knop", "aria-expanded": "false", "aria-controls": "meer-paneel" }, "Meer") as HTMLButtonElement;
  const sluit = () => { paneel.hidden = true; knop.setAttribute("aria-expanded", "false"); };
  knop.onclick = () => {
    const open = paneel.hidden;
    paneel.hidden = !open;
    knop.setAttribute("aria-expanded", String(open));
    if (open) (paneel.querySelector("a, button") as HTMLElement | null)?.focus();
  };
  paneel.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("a, button")) sluit(); });
  paneel.addEventListener("keydown", (e) => { if (e.key === "Escape") { sluit(); knop.focus(); } });
  onder.replaceChildren(paneel, ...nieuw, knop);
}

/** Afmelden; waarschuw als er nog acties wachten (die gaan later mee met de naam van wie ze invoerde). */
async function afmelden() {
  const n = (await acties()).filter((a) => a.status === "wacht").length;
  if (n > 0 && !(await bevestig(
    "Toch afmelden?",
    `Er ${n === 1 ? "staat nog 1 actie" : `staan nog ${n} acties`} klaar om te versturen. Ze blijven op deze pc bewaard. Alleen je eigen sessie mag ze versturen; andere of oude registraties vragen gecontroleerde beoordeling. Verwijder de gegevens van de browser niet.`,
    "Afmelden",
  ))) return;
  sessie.afmelden();
  naarStartpagina();
}

/** Na afmelden naar de startpagina (inloggen voor iedereen, #82). Zonder verbinding blijft het invoerscherm staan:
 *  de startpagina laadt dan niet, het invoerscherm wel (offline), en de wachtrij blijft zichtbaar. */
function naarStartpagina() {
  if (laatsteStatus ? laatsteStatus.verbonden : navigator.onLine) location.assign("../portaal/index.html#/login");
  else location.hash = "#/login";
}

/** Overstap van de startpagina: vraag een token met deze pc erbij (/auth/pc). Lukt dat niet, dan gewoon inloggen. */
async function vanStartpagina(actueel: () => boolean): Promise<boolean> {
  const t = sessie.portaalToken();
  const pc = sessie.pc;
  const invoerToken = sessie.token;
  const hash = location.hash;
  if (!t || !pc) return false;
  try {
    const r = await stuur<{ token: string; naamKiezen: boolean; operator?: { id: string; naam: string } | null }>(
      "POST", "/auth/pc", { pc }, { authorization: `Bearer ${t}` });
    if (!actueel() || location.hash !== hash || sessie.actueelPortaalToken() !== t ||
        sessie.pc !== pc || sessie.token !== invoerToken) return false;
    sessie.token = r.token;
    sessie.operatornaam = r.operator?.naam ?? null;
    vergeetConfig();
    inloggenGelukt();
    location.hash = "#/stappen";
    return true;
  } catch {
    return false;
  }
}

// ---------- Navigatie ----------
async function route() {
  nieuweRoute();
  wisScanActie();
  const [, scherm, arg] = location.hash.split("/");
  // Expliciete overstap: nooit op een oude invoersessie terugvallen, ook zonder geldige marker.
  if (scherm === "overstap") {
    sessie.wisInvoersessie();
    vergeetConfig();
    tekenBalk();
    return void (location.hash = sessie.pc ? "#/login" : "#/pc");
  }
  tekenBalk();

  // Hulp kan altijd, ook vóór het inloggen en zonder verbinding (zit in het pakket, D59).
  if (scherm === "hulp") return hulpScherm();
  if (!sessie.pc && scherm !== "pc") return void (location.hash = "#/pc");
  if (scherm === "pc") return pcScherm();
  if (scherm === "login" || !sessie.geldig()) {
    // Al ingelogd op de startpagina (D54)? Dan hetzelfde account op deze pc, zonder opnieuw in te loggen.
    const nogActueel = vastHouden();
    const hash = location.hash;
    if (await vanStartpagina(nogActueel)) return;
    if (!nogActueel() || location.hash !== hash) return;
    if (scherm !== "login") return void (location.hash = "#/login");
    return loginScherm();
  }
  if (sessie.inhoud()?.gedeeld || !sessie.heeftNaam()) {
    sessie.afmelden(); return void (location.hash = "#/login");
  }
  const actueel = vastHouden();
  const token = sessie.token;
  try {
    await vernieuwRechten();
  } catch (e) {
    if (!actueel() || sessie.token !== token) return;
    tekenBalk();
    return toon(h("h1", {}, "Bevoegdheden niet beschikbaar"), h("p", { class: "label-buiten_grens" }, (e as Error).message),
      h("button", { class: "knop", onclick: () => void route() }, "Opnieuw proberen"),
      h("a", { href: "#/login" }, "Opnieuw inloggen"));
  }
  if (!actueel() || sessie.token !== token) return;
  tekenBalk();
  // Wachtrij en eigen wachtwoord blijven bereikbaar voor dezelfde sessie.
  if (scherm !== "wachtrij" && scherm !== "wachtwoord" && !magInvoer()) {
    return toon(h("h1", {}, "Geen actuele invoerbevoegdheid"),
      h("p", {}, "Maak verbinding om je MES-bevoegdheden op te halen. Zonder geldige bevoegdheid kun je geen nieuwe invoer starten."),
      h("button", { class: "knop", onclick: () => void route() }, "Opnieuw proberen"),
      h("a", { href: "#/wachtrij" }, "Wachtrij bekijken"),
      h("a", { href: "#/login" }, "Opnieuw inloggen"));
  }

  switch (scherm) {
    case "stap": return stapScherm(decodeURIComponent(arg));
    case "reg": return registratieScherm(arg);
    case "zoek": return zoekScherm(arg ? decodeURIComponent(arg) : undefined);
    case "wachtrij": return wachtrijScherm();
    case "overdracht": return heeftRecht("handover.read") ? overdrachtScherm() : void (location.hash = "#/stappen");
    case "meldingen": return heeftMeldingen() ? meldingenScherm() : void (location.hash = "#/stappen");
    case "wachtwoord": return wachtwoordWijzigen();
    default:
      if (scherm !== "stappen") return void (location.hash = "#/stappen");
      return stappenScherm();
  }
}

window.addEventListener("hashchange", () => void route());
opStatus((s) => {
  const wasUit = laatsteStatus && !laatsteStatus.verbonden;
  laatsteStatus = s;
  tekenBalk();
  // Terug online op het stappenoverzicht: verversen.
  if (wasUit && s.verbonden && (location.hash === "#/stappen" || location.hash.startsWith("#/stap/"))) void route();
});
// Bij een expliciete overstap wist route() de oude sessie synchroon vóór achtergrondverwerking.
void route();
startWachtrij();
startMeldingen(tekenBalk);
startScanner();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/invoer/sw.js", { scope: "/invoer/" }).catch(() => {});
}
