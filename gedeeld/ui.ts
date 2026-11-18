// Kleine hulpjes om schermen op te bouwen zonder framework.
// Tekst gaat altijd via textContent, nooit als HTML.

type Kind = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kinderen: (Kind | Kind[])[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
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
export function melding(tekst: string, soort: "ok" | "fout" | "info" = "info") {
  let el = document.getElementById("melding");
  if (!el) {
    el = h("div", { id: "melding", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  el.className = `melding melding-${soort} zichtbaar`;
  el.textContent = tekst;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("zichtbaar"), soort === "fout" ? 7000 : 3500);
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
