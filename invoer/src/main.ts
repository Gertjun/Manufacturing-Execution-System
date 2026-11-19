import "./stijl.css";
import { sessie } from "./sessie";
import { h, nieuweRoute } from "./ui";
import { opStatus, startWachtrij, type Status } from "./wachtrij";
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
    ingelogd && sessie.operatornaam
      ? h("button", { class: "balk-wie", onclick: () => (location.hash = "#/naam"), title: "Andere naam kiezen" }, sessie.operatornaam)
      : null,
    ingelogd
      ? h("button", { class: "balk-wie", onclick: () => { sessie.afmelden(); location.hash = "#/login"; } }, "Afmelden")
      : null,
    verbinding,
  ];
  balk.replaceChildren(...(delen.filter(Boolean) as Node[]));
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
    if (scherm !== "login") return void (location.hash = "#/login");
    return loginScherm();
  }
  const rol = sessie.rol;
  if (scherm === "naam") return naamScherm();
  if ((rol === "operator" || rol === "ploegleider") && !sessie.heeftNaam()) return void (location.hash = "#/naam");

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
