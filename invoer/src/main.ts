import "./stijl.css";
import { sessie } from "./sessie";
import { bevestig, h, melding, nieuweRoute } from "./ui";
import { acties, inloggenGelukt, opStatus, startWachtrij, voegToe, type Status } from "./wachtrij";
import { stuur } from "./api";
import { vergeetConfig } from "./registraties";
import { loginScherm, naamScherm, pcScherm } from "./schermen/start";
import { stapScherm, stappenScherm } from "./schermen/werk";
import { registratieScherm } from "./schermen/registratie";
import { wachtrijScherm, zoekScherm } from "./schermen/zoek";
import { overdrachtScherm } from "./schermen/overdracht";
import { heeftMeldingen, meldingenScherm, ongelezen, startMeldingen } from "./schermen/meldingen";
import { startScanner, wisScanActie } from "./scan";
import { hulpScherm, wachtwoordWijzigen } from "./schermen/hulp";
import { vraagIetsMelden } from "../../gedeeld/melden";
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
  const gedeeld = !!sessie.inhoud()?.gedeeld;
  // Gedeeld account (D6): naam is te wisselen. Eigen account (D53): de naam ligt vast; wisselen = afmelden.
  const naam = () => ingelogd && sessie.operatornaam
    ? gedeeld
      ? h("button", { class: "balk-wie", onclick: () => (location.hash = "#/naam"), title: "Andere naam kiezen" }, sessie.operatornaam)
      : h("span", { class: "balk-wie balk-eigen-naam" }, sessie.operatornaam)
    : null;
  const meldingenLink = (klasse?: string) => heeftMeldingen()
    ? h("a", { href: "#/meldingen", class: klasse, "aria-current": actief("meldingen") },
        "Meldingen", ongelezen() ? h("span", { class: "balk-teller" }, ongelezen()) : null)
    : null;

  // Breed scherm (pc, tablet, liggende telefoon): alles in de balk bovenaan. Telefoon staand (D64): bovenaan
  // alleen pc, naam en verbinding; de navigatie staat onderaan binnen duimbereik, de rest onder "Meer".
  const delen: (Node | null)[] = [
    h("div", { class: "balk-naam" }, h("span", { class: sessie.pc ? "alleen-breed" : undefined }, "Batch-invoer"), sessie.pc ? h("span", { class: "balk-pc" }, sessie.pc) : null),
    ingelogd
      ? h("nav", { class: "balk-nav alleen-breed", "aria-label": "Hoofdmenu" },
          h("a", { href: "#/stappen", "aria-current": actief("stappen") }, "Stappen"),
          h("a", { href: "#/zoek", "aria-current": actief("zoek") }, "Zoeken"),
          h("a", { href: "#/overdracht", "aria-current": actief("overdracht") }, "Overdracht"),
          h("a", { href: "#/hulp", "aria-current": actief("hulp") }, "Hulp"),
          h("button", { class: "balk-knop", type: "button", onclick: () => void ietsMelden() }, "Iets melden"),
          meldingenLink())
      : null,
    naam(),
    // Ploegleiders gebruiken ook de portalen: terug naar de startpagina (D54).
    ingelogd && sessie.rol === "ploegleider"
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
    h("a", { href: "#/overdracht", "aria-current": actief("overdracht") }, "Overdracht"),
    meldingenLink(),
  ] : null, [
    h("a", { href: "#/hulp" }, "Hulp"),
    h("button", { type: "button", onclick: () => void ietsMelden() }, "Iets melden"),
    gedeeld ? h("a", { href: "#/naam" }, "Andere naam kiezen") : null,
    sessie.rol === "ploegleider" ? h("a", { href: "../portaal/index.html#/" }, "Portalen") : null,
    h("button", { type: "button", onclick: () => void afmelden() }, "Afmelden"),
  ]);
}

volgNummers(document.getElementById("scherm")!);

// Het paneel "Meer" sluit bij een tik ernaast.
document.addEventListener("click", (e) => {
  const paneel = document.getElementById("meer-paneel");
  if (paneel && !paneel.hidden && !(e.target as Element).closest("#onderbalk")) {
    paneel.hidden = true;
    document.querySelector(".meer-knop")?.setAttribute("aria-expanded", "false");
  }
});

/** Navigatie onderaan op een staande telefoon (D64). Op bredere schermen verbergt de CSS hem. */
function tekenOnderbalk(links: (Node | null)[] | null, meer: (Node | null)[]) {
  let onder = document.getElementById("onderbalk");
  if (!links) { onder?.remove(); document.body.classList.remove("met-onderbalk"); return; }
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
  onder.replaceChildren(paneel, ...(links.filter(Boolean) as Node[]), knop);
}

/** Afmelden; waarschuw als er nog acties wachten (die gaan later mee met de naam van wie ze invoerde). */
async function afmelden() {
  const n = (await acties()).filter((a) => a.status === "wacht").length;
  if (n > 0 && !(await bevestig(
    "Toch afmelden?",
    `Er ${n === 1 ? "staat nog 1 actie" : `staan nog ${n} acties`} klaar om te versturen. Ze blijven op deze pc bewaard en worden verstuurd zodra iemand weer inlogt, met de naam van wie ze invoerde. Verwijder de gegevens van de browser niet.`,
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
async function vanStartpagina(): Promise<boolean> {
  const t = sessie.portaalToken();
  if (!t || !sessie.pc) return false;
  try {
    const r = await stuur<{ token: string; naamKiezen: boolean; operator?: { id: string; naam: string } | null }>(
      "POST", "/auth/pc", { pc: sessie.pc }, { authorization: `Bearer ${t}` });
    sessie.token = r.token;
    sessie.operatornaam = r.operator?.naam ?? null;
    vergeetConfig();
    inloggenGelukt();
    location.hash = r.naamKiezen ? "#/naam" : "#/stappen";
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
  tekenBalk();

  // Hulp kan altijd, ook vóór het inloggen en zonder verbinding (zit in het pakket, D59).
  if (scherm === "hulp") return hulpScherm();
  if (!sessie.pc && scherm !== "pc") return void (location.hash = "#/pc");
  if (scherm === "pc") return pcScherm();
  if (scherm === "login" || !sessie.geldig()) {
    // Al ingelogd op de startpagina (D54)? Dan hetzelfde account op deze pc, zonder opnieuw in te loggen.
    if (await vanStartpagina()) return;
    if (scherm !== "login") return void (location.hash = "#/login");
    return loginScherm();
  }
  const rol = sessie.rol;
  if (scherm === "naam") return sessie.inhoud()?.gedeeld ? naamScherm() : void (location.hash = "#/stappen");
  if ((rol === "operator" || rol === "ploegleider") && !sessie.heeftNaam()) {
    // Eigen account zonder naam in het token (bijvoorbeeld een token van vóór 0.27): opnieuw inloggen.
    if (!sessie.inhoud()?.gedeeld) { sessie.afmelden(); return void (location.hash = "#/login"); }
    return void (location.hash = "#/naam");
  }

  switch (scherm) {
    case "stap": return stapScherm(decodeURIComponent(arg));
    case "reg": return registratieScherm(arg);
    case "zoek": return zoekScherm(arg ? decodeURIComponent(arg) : undefined);
    case "wachtrij": return wachtrijScherm();
    case "overdracht": return overdrachtScherm();
    case "meldingen": return meldingenScherm();
    case "wachtwoord": return wachtwoordWijzigen();
    default:
      if (scherm !== "stappen") return void (location.hash = "#/stappen");
      return stappenScherm();
  }
}

/** "Iets melden" (#78, D62): via de wachtrij, dus ook zonder verbinding. */
async function ietsMelden() {
  const [, scherm, arg] = location.hash.split("/");
  const stapcode = scherm === "stap" ? decodeURIComponent(arg ?? "") : scherm === "reg" ? document.body.dataset.stap ?? null : null;
  const tekst = await vraagIetsMelden(stapcode ? `stap ${stapcode}` : scherm ? `scherm ${scherm}` : "het invoerscherm");
  if (!tekst) return;
  await voegToe({
    omschrijving: "Iets gemeld", methode: "POST", pad: "/terugmeldingen",
    body: { id: crypto.randomUUID(), tekst, stapcode: stapcode || null, scherm: `invoer: ${scherm || "start"}` },
  });
  melding(laatsteStatus?.verbonden ? "Bedankt, je melding is verstuurd" : "Bedankt, je melding gaat mee zodra er verbinding is", "ok");
}

window.addEventListener("hashchange", () => void route());
opStatus((s) => {
  const wasUit = laatsteStatus && !laatsteStatus.verbonden;
  laatsteStatus = s;
  tekenBalk();
  // Terug online op het stappenoverzicht: verversen.
  if (wasUit && s.verbonden && (location.hash === "#/stappen" || location.hash.startsWith("#/stap/"))) void route();
});
startWachtrij();
startMeldingen(tekenBalk);
startScanner();
void route();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/invoer/sw.js", { scope: "/invoer/" }).catch(() => {});
}
