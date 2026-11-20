import "./stijl.css";
import { sessie } from "./sessie";
import { bevestig, h, nieuweRoute } from "./ui";
import { acties, inloggenGelukt, opStatus, startWachtrij, type Status } from "./wachtrij";
import { stuur } from "./api";
import { vergeetConfig } from "./registraties";
import { loginScherm, naamScherm, pcScherm } from "./schermen/start";
import { stapScherm, stappenScherm } from "./schermen/werk";
import { registratieScherm } from "./schermen/registratie";
import { wachtrijScherm, zoekScherm } from "./schermen/zoek";
import { overdrachtScherm } from "./schermen/overdracht";
import { heeftMeldingen, meldingenScherm, ongelezen, startMeldingen } from "./schermen/meldingen";
import { startScanner, wisScanActie } from "./scan";

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

  const delen: (Node | null)[] = [
    h("div", { class: "balk-naam" }, "Batch-invoer", sessie.pc ? h("span", { class: "balk-pc" }, sessie.pc) : null),
    ingelogd
      ? h("nav", { class: "balk-nav", "aria-label": "Hoofdmenu" },
          h("a", { href: "#/stappen", "aria-current": route === "stappen" || route === "stap" ? "page" : undefined }, "Stappen"),
          h("a", { href: "#/zoek", "aria-current": route === "zoek" ? "page" : undefined }, "Zoeken"),
          h("a", { href: "#/overdracht", "aria-current": route === "overdracht" ? "page" : undefined }, "Overdracht"),
          heeftMeldingen()
            ? h("a", { href: "#/meldingen", "aria-current": route === "meldingen" ? "page" : undefined },
                "Meldingen", ongelezen() ? h("span", { class: "balk-teller" }, ongelezen()) : null)
            : null)
      : null,
    // Gedeeld account (D6): naam is te wisselen. Eigen account (D53): de naam ligt vast; wisselen = afmelden.
    ingelogd && sessie.operatornaam
      ? sessie.inhoud()?.gedeeld
        ? h("button", { class: "balk-wie", onclick: () => (location.hash = "#/naam"), title: "Andere naam kiezen" }, sessie.operatornaam)
        : h("span", { class: "balk-wie balk-eigen-naam" }, sessie.operatornaam)
      : null,
    // Ploegleiders gebruiken ook de portalen: terug naar de startpagina (D54).
    ingelogd && sessie.rol === "ploegleider"
      ? h("a", { class: "balk-wie", href: "../portaal/index.html#/" }, "Portalen")
      : null,
    ingelogd
      ? h("button", { class: "balk-wie", onclick: () => void afmelden() }, "Afmelden")
      : null,
    verbinding,
  ];
  balk.replaceChildren(...(delen.filter(Boolean) as Node[]));
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
  location.hash = "#/login";
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
startWachtrij();
startMeldingen(tekenBalk);
startScanner();
void route();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/invoer/sw.js", { scope: "/invoer/" }).catch(() => {});
}
