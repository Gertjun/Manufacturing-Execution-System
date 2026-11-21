// Nainvoeren na papier (#75, D60): lag de invoer stil, dan registreerde de ploeg op papier. De ploegleider of
// beheerder voert de stap hier later in met de tijden van het papier. Ook: lege formulieren per stap om af te drukken.
import { VERSIE } from "../../gedeeld/versie";
import { bezigTijdens, h, melding, toon, vastHouden } from "../../gedeeld/ui";
import { haal, stuur } from "./basis";
import { fout, kop } from "./kwaliteit/schermen";

interface Veld {
  code: string; naam: string; soort: string; eenheid: string | null; verplicht: boolean; actief: boolean;
  grens_min: number | null; grens_max: number | null; gemeten_door?: string;
  per_product?: { product: string; grens_min: number | null; grens_max: number | null }[];
}
interface Grondstof { code: string; naam: string; eenheid: string | null; verplicht: boolean }
interface Stap { code: string; naam: string; niveau: "batch" | "lot"; is_lot_stap: boolean; velden: Veld[]; grondstoffen: Grondstof[] }
interface Keuzes { pcs: { id: string; naam: string }[]; operators: { id: string; naam: string }[] }

/** Velden die de operator invult; wat Kwaliteit meet komt niet op het papier van de vloer (D58). */
const vloerVelden = (s: Stap) => s.velden.filter((v) => v.actief && v.gemeten_door !== "kwaliteit");

const getal = (tekst: string) => {
  const t = tekst.trim().replace(",", ".");
  return t === "" ? null : Number(t);
};
const lokaal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const NUMMER = /^[BL]-[0-9]{4}-[0-9]{4}$/;

export async function nalevering() {
  const actueel = vastHouden();
  let stappen: Stap[], keuzes: Keuzes;
  try {
    [stappen, keuzes] = await Promise.all([haal<Stap[]>("/config/stappen"), haal<Keuzes>("/nalevering/keuzes")]);
  } catch (e) { return fout(e); }
  if (!actueel()) return;

  const stapSel = h("select", { id: "na-stap" }, h("option", { value: "" }, "Kies een stap"),
    stappen.map((s) => h("option", { value: s.code }, `${s.code} ${s.naam}`))) as HTMLSelectElement;
  const wie = h("select", { id: "na-wie" }, h("option", { value: "" }, "Kies een naam"),
    keuzes.operators.map((o) => h("option", { value: o.id }, o.naam))) as HTMLSelectElement;
  const pc = h("select", { id: "na-pc" }, h("option", { value: "" }, "Kies een pc"),
    keuzes.pcs.map((p) => h("option", { value: p.id }, p.naam))) as HTMLSelectElement;
  const nu = new Date();
  const grens = { min: lokaal(new Date(nu.getTime() - 7 * 86400000)), max: lokaal(nu) };
  const begin = h("input", { id: "na-begin", type: "datetime-local", ...grens }) as HTMLInputElement;
  const eind = h("input", { id: "na-eind", type: "datetime-local", ...grens }) as HTMLInputElement;
  const reden = h("textarea", { id: "na-reden", rows: 2, maxlength: 500, placeholder: "Bijvoorbeeld: server en pc uit door stroomstoring" }) as HTMLTextAreaElement;
  const stapDeel = h("div", { class: "nalevering-stap" });

  // Per stap: nummer(s), velden en grondstoffen.
  let invoer: {
    nummer: HTMLInputElement; batches: HTMLInputElement[];
    velden: { veld: Veld; setting?: HTMLInputElement; gemeten: HTMLInputElement }[];
    grondstoffen: { gs: Grondstof; partij: HTMLInputElement; hoeveelheid: HTMLInputElement }[];
  } | null = null;

  const tekenStap = () => {
    const s = stappen.find((x) => x.code === stapSel.value);
    stapDeel.replaceChildren();
    invoer = null;
    if (!s) return;
    const nummer = h("input", { id: "na-nummer", type: "text", autocomplete: "off",
      placeholder: s.niveau === "batch" ? "B-2026-0001" : "L-2026-0001" }) as HTMLInputElement;
    const batches = s.is_lot_stap
      ? [1, 2, 3, 4].map((i) => h("input", { id: `na-batch-${i}`, type: "text", autocomplete: "off", placeholder: "B-2026-0001" }) as HTMLInputElement)
      : [];
    const velden = vloerVelden(s).map((v) => ({
      veld: v,
      setting: v.soort === "procesparameter" ? h("input", { id: `na-s-${v.code}`, type: "text", inputmode: "decimal", autocomplete: "off" }) as HTMLInputElement : undefined,
      gemeten: h("input", { id: `na-g-${v.code}`, type: "text", inputmode: "decimal", autocomplete: "off" }) as HTMLInputElement,
    }));
    const grondstoffen = s.grondstoffen.map((gs) => ({
      gs,
      partij: h("input", { id: `na-p-${gs.code}`, type: "text", autocomplete: "off" }) as HTMLInputElement,
      hoeveelheid: h("input", { id: `na-h-${gs.code}`, type: "text", inputmode: "decimal", autocomplete: "off" }) as HTMLInputElement,
    }));
    invoer = { nummer, batches, velden, grondstoffen };
    const eenheid = (v: Veld) => (v.eenheid ? ` (${v.eenheid})` : "");
    stapDeel.append(...([
      h("div", { class: "nalevering-rij" },
        h("label", { for: "na-nummer" }, s.niveau === "batch" ? "Batchnummer" : s.is_lot_stap ? "Nieuw lotnummer" : "Lotnummer", nummer),
        ...batches.map((b, i) => h("label", { for: b.id }, `Batch ${i + 1}`, b))),
      velden.length ? h("h2", {}, "Waarden") : null,
      ...velden.map((x) => h("div", { class: "nalevering-rij" },
        h("div", { class: "nalevering-veld" }, h("strong", {}, `${x.veld.code} ${x.veld.naam}`), x.veld.verplicht ? null : h("span", { class: "sub" }, " (niet verplicht)")),
        x.setting ? h("label", { for: x.setting.id }, `Instelling${eenheid(x.veld)}`, x.setting) : null,
        h("label", { for: x.gemeten.id }, `${x.veld.soort === "procesparameter" ? "Gemeten" : x.veld.naam}${eenheid(x.veld)}`, x.gemeten))),
      grondstoffen.length ? h("h2", {}, "Grondstoffen") : null,
      ...grondstoffen.map((x) => h("div", { class: "nalevering-rij" },
        h("div", { class: "nalevering-veld" }, h("strong", {}, `${x.gs.code} ${x.gs.naam}`)),
        h("label", { for: x.partij.id }, "Partijnummer", x.partij),
        h("label", { for: x.hoeveelheid.id }, `Hoeveelheid${x.gs.eenheid ? ` (${x.gs.eenheid})` : ""}`, x.hoeveelheid))),
    ] as (HTMLElement | null)[]).filter((x): x is HTMLElement => x !== null));
  };
  stapSel.addEventListener("change", tekenStap);

  const knop = h("button", { class: "knop knop-hoofd", type: "button" }, "Nainvoeren") as HTMLButtonElement;
  knop.addEventListener("click", async () => {
    const s = stappen.find((x) => x.code === stapSel.value);
    if (!s || !invoer) return melding("Kies een stap", "fout");
    const nummer = invoer.nummer.value.trim().toUpperCase();
    if (!NUMMER.test(nummer)) return melding(`Vul een geldig ${s.niveau === "batch" ? "batchnummer" : "lotnummer"} in`, "fout");
    const batches = invoer.batches.map((b) => b.value.trim().toUpperCase());
    if (s.is_lot_stap && batches.some((b) => !/^B-[0-9]{4}-[0-9]{4}$/.test(b))) return melding("Vul de 4 batchnummers van het lot in", "fout");
    if (!wie.value) return melding("Kies wie het deed", "fout");
    if (!pc.value) return melding("Kies de pc", "fout");
    if (!begin.value || !eind.value) return melding("Vul het begin en het einde in", "fout");
    if (!reden.value.trim()) return melding("Geef een reden", "fout");
    const waarden: { veldcode: string; setting: number | null; gemeten: number }[] = [];
    for (const x of invoer.velden) {
      const g = getal(x.gemeten.value);
      const st = x.setting ? getal(x.setting.value) : null;
      if (g === null) continue;
      if (Number.isNaN(g) || (st !== null && Number.isNaN(st))) return melding(`${x.veld.code}: vul een getal in`, "fout");
      waarden.push({ veldcode: x.veld.code, setting: st, gemeten: g });
    }
    const grondstoffen = [];
    for (const x of invoer.grondstoffen) {
      if (!x.partij.value.trim()) continue;
      const hv = getal(x.hoeveelheid.value);
      if (hv !== null && Number.isNaN(hv)) return melding(`${x.gs.code}: vul een getal in`, "fout");
      grondstoffen.push({ code: x.gs.code, partij: x.partij.value.trim(), hoeveelheid: hv });
    }
    try {
      await bezigTijdens(knop, stuur("POST", "/nalevering", {
        stapcode: s.code, nummer, batches: s.is_lot_stap ? batches : undefined, pc: pc.value, operator: wie.value,
        begin: new Date(begin.value).toISOString(), eind: new Date(eind.value).toISOString(), reden: reden.value.trim(), waarden, grondstoffen,
      }));
      melding(`${s.code} van ${nummer} is nageleverd`, "ok");
      // Volgende stap van dezelfde batch: nummer, naam, pc en reden blijven staan.
      const volgende = stappen[stappen.findIndex((x) => x.code === s.code) + 1];
      const bewaar = { nummer, wie: wie.value, pc: pc.value, eind: eind.value };
      if (volgende && !s.is_lot_stap) {
        stapSel.value = volgende.code;
        tekenStap();
        if (invoer) (invoer as { nummer: HTMLInputElement }).nummer.value = volgende.niveau === s.niveau ? bewaar.nummer : "";
      } else {
        stapSel.value = "";
        tekenStap();
      }
      begin.value = bewaar.eind;
      eind.value = "";
    } catch (e) {
      melding((e as Error).message, "fout");
    }
  });

  toon(
    kop("Nainvoeren van papier", "Voor stappen die op papier zijn bijgehouden toen de invoer niet werkte. Tot 7 dagen terug, alleen met verbinding.",
      h("a", { class: "knop knop-stil", href: "#/nainvoeren/formulier" }, "Lege formulieren afdrukken")),
    h("section", { class: "blok nalevering" },
      h("div", { class: "nalevering-rij" }, h("label", { for: "na-stap" }, "Stap", stapSel)),
      stapDeel,
      h("h2", {}, "Van het papier"),
      h("div", { class: "nalevering-rij" },
        h("label", { for: "na-wie" }, "Wie deed het", wie),
        h("label", { for: "na-pc" }, "Pc", pc)),
      h("div", { class: "nalevering-rij" },
        h("label", { for: "na-begin" }, "Begin", begin),
        h("label", { for: "na-eind" }, "Einde", eind)),
      h("label", { for: "na-reden", class: "nalevering-reden" }, "Reden", reden),
      h("p", { class: "sub" }, "De stap komt op naam van wie het deed, met de tijden van het papier. Er staat bij dat hij is nageleverd en door wie; ook in het logboek."),
      h("div", { class: "knoppen knoppen-links" }, knop)),
  );
}

// ---------- Lege formulieren ----------
const grensTekst = (v: Veld) => {
  const een = (min: number | null, max: number | null) =>
    min === null && max === null ? "" : `${min ?? ""}–${max ?? ""}`;
  const basis = een(v.grens_min, v.grens_max);
  const anders = (v.per_product ?? []).map((p) => `${p.product}: ${een(p.grens_min, p.grens_max)}`).join("; ");
  return [basis, anders ? `(${anders})` : ""].filter(Boolean).join(" ");
};

function formulierVoor(s: Stap, datum: string): HTMLElement {
  const lijn = () => h("span", { class: "invul" });
  const velden = vloerVelden(s);
  return h("article", { class: "papier" },
    h("h2", {}, `Papieren registratie: ${s.code} ${s.naam}`),
    h("p", { class: "sub" }, "Alleen als de invoer niet werkt. Later invoeren via de startpagina, Nainvoeren (papier). Eén formulier per ",
      s.niveau === "batch" ? "batch." : "lot."),
    h("table", { class: "papier-kop" }, h("tbody", {},
      s.is_lot_stap
        ? [h("tr", {}, h("th", {}, "Nieuw lotnummer"), h("td", { colspan: 3 }, lijn())),
           h("tr", {}, h("th", {}, "Batches"), h("td", { colspan: 3 }, h("div", { class: "papier-vier" }, [1, 2, 3, 4].map((i) => h("span", {}, `${i}. `, lijn())))))]
        : h("tr", {}, h("th", {}, s.niveau === "batch" ? "Batchnummer" : "Lotnummer"), h("td", { colspan: 3 }, lijn())),
      h("tr", {}, h("th", {}, "Datum"), h("td", {}, lijn()), h("th", {}, "Pc"), h("td", {}, lijn())),
      h("tr", {}, h("th", {}, "Begin (uu:mm)"), h("td", {}, lijn()), h("th", {}, "Einde (uu:mm)"), h("td", {}, lijn())),
      h("tr", {}, h("th", {}, "Naam"), h("td", { colspan: 3 }, lijn())))),
    velden.length
      ? h("table", { class: "papier-tabel" },
          h("thead", {}, h("tr", {}, h("th", {}, "Veld"), h("th", {}, "Eenheid"), h("th", {}, "Grens"), h("th", {}, "Instelling"), h("th", {}, "Gemeten"))),
          h("tbody", {}, velden.map((v) => h("tr", {},
            h("td", {}, `${v.code} ${v.naam}${v.verplicht ? "" : " (niet verplicht)"}`), h("td", {}, v.eenheid ?? ""), h("td", {}, grensTekst(v)),
            h("td", { class: v.soort === "procesparameter" ? "vak" : "vak leeg" }), h("td", { class: "vak" })))))
      : null,
    s.grondstoffen.length
      ? h("table", { class: "papier-tabel" },
          h("thead", {}, h("tr", {}, h("th", {}, "Grondstof"), h("th", {}, "Partijnummer"), h("th", {}, "Hoeveelheid"))),
          h("tbody", {}, s.grondstoffen.map((g) => h("tr", {}, h("td", {}, `${g.code} ${g.naam}`), h("td", { class: "vak" }), h("td", { class: "vak" }, g.eenheid ? h("span", { class: "eenheid" }, g.eenheid) : null)))))
      : null,
    h("div", { class: "papier-opmerking" }, h("strong", {}, "Opmerking"), h("div", { class: "vak-groot" })),
    h("p", { class: "papier-voet" }, `Velden en grenzen van ${datum}, versie ${VERSIE}. Wat Kwaliteit meet, staat niet op dit formulier.`));
}

export async function formulieren(gekozen?: string) {
  const actueel = vastHouden();
  let stappen: Stap[];
  try { stappen = await haal<Stap[]>("/config/stappen"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const keuze = gekozen && stappen.some((s) => s.code === gekozen) ? gekozen : "alle";
  const sel = h("select", { id: "form-stap", onchange: (e: Event) => { location.hash = `#/nainvoeren/formulier/${(e.target as HTMLSelectElement).value}`; } },
    h("option", { value: "alle", selected: keuze === "alle" }, "Alle stappen"),
    stappen.map((s) => h("option", { value: s.code, selected: s.code === keuze }, `${s.code} ${s.naam}`)));
  const datum = new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  toon(
    h("div", { class: "geen-print" },
      kop("Lege formulieren", "Voor de terugvalmap bij elke pc: één A4 per stap, met dezelfde velden als het scherm. Druk opnieuw af als velden of grenzen veranderen.",
        h("a", { class: "knop knop-stil", href: "#/nainvoeren" }, "Terug naar nainvoeren")),
      h("div", { class: "filters" },
        h("label", { for: "form-stap", class: "filter" }, "Stap", sel),
        h("button", { class: "knop knop-hoofd", type: "button", onclick: () => window.print() }, "Afdrukken"))),
    h("div", { class: "papieren" }, (keuze === "alle" ? stappen : stappen.filter((s) => s.code === keuze)).map((s) => formulierVoor(s, datum))),
  );
}
