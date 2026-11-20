// Kleine hulpjes om schermen op te bouwen zonder framework.
// Tekst gaat altijd via textContent, nooit als HTML.

type Kind = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kinderen: (Kind | Kind[])[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), metBezig(el, k.slice(2), v as (e: Event) => unknown));
    else if (k === "class") el.className = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const kind of kinderen.flat()) {
    if (kind === null || kind === undefined || kind === false) continue;
    el.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
  }
  return el;
}

/** Geeft een klik- of verzendfunctie een promise terug, dan is de knop "bezig" tot die klaar is. */
function metBezig(el: HTMLElement, soort: string, fn: (e: Event) => unknown): EventListener {
  if (soort !== "click" && soort !== "submit") return fn as EventListener;
  return (e: Event) => {
    const r = fn(e);
    if (!(r instanceof Promise)) return;
    const knop = soort === "click" ? el : ((e as SubmitEvent).submitter ?? el.querySelector("button[type=submit], button:not([type])"));
    if (knop instanceof HTMLButtonElement) bezigTijdens(knop, r);
  };
}

/** Zet een knop op "bezig" zolang het werk loopt: niet nogmaals te klikken of te verzenden (geen dubbele invoer),
 *  na 0,4 s een draaiend rondje (gedeeld/knoppen.css), en voor schermlezers aria-busy en aria-disabled.
 *  De knop wordt niet "disabled" gemaakt, zodat een scherm dat zelf bepaalt of een knop uit staat, niet in de war raakt. */
export function bezigTijdens<T>(knop: HTMLButtonElement, werk: Promise<T>): Promise<T> {
  if (knop.classList.contains("bezig")) return werk;
  blokkeerBezig();
  knop.classList.add("bezig");
  knop.setAttribute("aria-busy", "true");
  knop.setAttribute("aria-disabled", "true");
  const klaar = () => {
    knop.classList.remove("bezig");
    knop.removeAttribute("aria-busy");
    knop.removeAttribute("aria-disabled");
  };
  werk.then(klaar, klaar);
  return werk;
}

/** Voor knoppen met addEventListener: knop.addEventListener("click", bezigBij(async () => { … })). */
export function bezigBij(fn: (e: Event) => unknown): EventListener {
  return (e: Event) => {
    const r = fn(e);
    if (r instanceof Promise && e.currentTarget instanceof HTMLButtonElement) bezigTijdens(e.currentTarget, r);
  };
}

// Eén keer: klikken op een bezige knop en verzenden met een bezige knop worden tegengehouden,
// nog vóór de eigen klikfunctie van het scherm (capture op document).
let geblokkeerd = false;
function blokkeerBezig() {
  if (geblokkeerd) return;
  geblokkeerd = true;
  document.addEventListener("click", (e) => {
    if ((e.target as Element | null)?.closest?.(".bezig")) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener("submit", (e) => {
    const f = e.target as HTMLFormElement;
    if (f.querySelector?.(".bezig")) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}

// Elke navigatie krijgt een volgnummer. Een scherm dat nog aan het laden was
// toen er verder werd geklikt, mag het nieuwe scherm niet overschrijven.
let routeTeller = 0;
export function nieuweRoute() {
  routeTeller++;
}
/** Aan het begin van een scherm aanroepen; geeft een controle "ben ik nog actueel?". */
export function vastHouden(): () => boolean {
  const mijn = routeTeller;
  return () => mijn === routeTeller;
}

export function toon(...inhoud: (Node | null | undefined | false)[]) {
  const scherm = document.getElementById("scherm")!;
  scherm.replaceChildren(...(inhoud.filter(Boolean) as Node[]));
  scherm.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

let toastTimer: number | undefined;
/** Korte melding onderin. Met `ongedaan` krijgt de melding een knop "Ongedaan maken" en blijft hij 6 s staan
 *  (langer zolang de muis erop staat of de knop focus heeft). Alleen voor acties die je makkelijk terugdraait (D50). */
export function melding(tekst: string, soort: "ok" | "fout" | "info" = "info", ongedaan?: () => unknown) {
  let el = document.getElementById("melding");
  if (!el) {
    el = h("div", { id: "melding", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  const m = el;
  m.className = `melding melding-${soort} zichtbaar${ongedaan ? " met-actie" : ""}`;
  m.replaceChildren(h("span", {}, tekst));
  const verberg = () => m.classList.remove("zichtbaar", "met-actie");
  const duur = ongedaan ? 6000 : soort === "fout" ? 7000 : 3500;
  const start = () => { clearTimeout(toastTimer); toastTimer = window.setTimeout(verberg, duur); };
  if (ongedaan) {
    const knop = h("button", { class: "melding-knop", type: "button", onclick: () => { verberg(); return ongedaan(); } }, "Ongedaan maken");
    knop.onfocus = m.onmouseenter = () => clearTimeout(toastTimer);
    knop.onblur = m.onmouseleave = start;
    m.append(knop);
  } else {
    m.onmouseenter = m.onmouseleave = null;
  }
  start();
}

/** Modaal venster; geeft true bij bevestigen. */
export function bevestig(titel: string, inhoud: Node | string, knop: string, gevaar = false): Promise<boolean> {
  return new Promise((ok) => {
    const d = h(
      "dialog",
      { class: "venster" },
      h("h2", {}, titel),
      typeof inhoud === "string" ? h("p", {}, inhoud) : inhoud,
      h(
        "div",
        { class: "knoppen" },
        h("button", { class: "knop knop-stil", onclick: () => d.close("nee") }, "Terug"),
        h("button", { class: gevaar ? "knop knop-gevaar" : "knop knop-hoofd", onclick: () => d.close("ja") }, knop),
      ),
    );
    d.addEventListener("close", () => {
      ok(d.returnValue === "ja");
      d.remove();
    });
    document.body.append(d);
    d.showModal();
  });
}

/** Venster met invoervelden; geeft de ingevulde waarden terug, of null. */
export interface VraagVeld {
  naam: string;
  label: string;
  type?: string;
  /** Keuzelijst; waarde en tekst gelijk, of [waarde, tekst]. */
  opties?: (string | [string, string])[];
  /** Ingevulde beginwaarde. */
  waarde?: string;
  /** Mag leeg blijven. */
  optioneel?: boolean;
  /** Korte uitleg onder het veld. */
  hint?: string;
  /** Extra controle; geeft een foutmelding terug of null. */
  controle?: (waarde: string) => string | null;
}

export function vraag(titel: string, velden: VraagVeld[], knop: string, uitleg?: string) {
  return new Promise<Record<string, string> | null>((ok) => {
    const invoer: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    const vorm = h(
      "form",
      { method: "dialog", class: "vraag" },
      velden.map((v) => {
        const el = v.opties
          ? h("select", { id: `v-${v.naam}`, required: !v.optioneel },
              v.opties.map((o) => { const [w, t] = Array.isArray(o) ? o : [o, o]; return h("option", { value: w, selected: w === v.waarde }, t); }))
          : h("input", { id: `v-${v.naam}`, type: v.type ?? "text", required: !v.optioneel, autocomplete: "off", inputmode: v.type === "getal" ? "decimal" : undefined });
        if (v.type === "getal") el.setAttribute("type", "text");
        if (v.waarde !== undefined && !v.opties) (el as HTMLInputElement).value = v.waarde;
        invoer[v.naam] = el;
        return h("label", { for: `v-${v.naam}` }, h("span", {}, v.label, v.optioneel ? h("span", { class: "noot" }, " (mag leeg)") : null), el,
          v.hint ? h("small", { class: "noot" }, v.hint) : null);
      }),
    );
    if (uitleg) vorm.prepend(h("p", { class: "sub" }, uitleg));
    const d = h(
      "dialog",
      { class: "venster" },
      h("h2", {}, titel),
      vorm,
      h(
        "div",
        { class: "knoppen" },
        h("button", { class: "knop knop-stil", onclick: () => d.close("nee") }, "Terug"),
        h(
          "button",
          {
            class: "knop knop-hoofd",
            onclick: () => {
              for (const v of velden) {
                const el = invoer[v.naam] as HTMLInputElement;
                el.setCustomValidity("");
                if (v.type === "getal" && el.value.trim() !== "" && !/^-?\d+([.,]\d+)?$/.test(el.value.trim())) el.setCustomValidity("Vul een getal in, bijvoorbeeld 82,5");
                else if (v.controle && el.value.trim() !== "") el.setCustomValidity(v.controle(el.value.trim()) ?? "");
              }
              if ((vorm as HTMLFormElement).reportValidity()) d.close("ja");
            },
          },
          knop,
        ),
      ),
    );
    d.addEventListener("close", () => {
      ok(d.returnValue === "ja" ? Object.fromEntries(Object.entries(invoer).map(([k, el]) => [k, el.value.trim()])) : null);
      d.remove();
    });
    document.body.append(d);
    d.showModal();
  });
}

export function tijd(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const vandaag = new Date().toDateString() === d.toDateString();
  return vandaag
    ? d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function laden(tekst = "Laden…") {
  return h("p", { class: "laden" }, tekst);
}
