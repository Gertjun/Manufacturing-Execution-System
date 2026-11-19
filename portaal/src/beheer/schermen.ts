// Portaal Beheer: stappen en velden, accounts, operators, pc's en het logboek.
// Elke wijziging komt in het logboek; niets wordt verwijderd, alleen uitgezet.
import { bevestig, h, laden, melding, toon, vastHouden, vraag, type VraagVeld } from "../../../gedeeld/ui";
import { leesGetal, toonGetal } from "../../../gedeeld/markering";
import type { Stap, Veld } from "../../../gedeeld/types";
import { haal, qs, sessie, stuur } from "../basis";
import { datum, fout, kop, tabel } from "../kwaliteit/schermen";

const ROLLEN: [string, string][] = [
  ["operator", "Operator (gedeeld invoeraccount)"],
  ["ploegleider", "Ploegleider"],
  ["kwaliteit", "Kwaliteit"],
  ["beheerder", "Beheerder"],
  ["analist", "Analist (alleen lezen)"],
  ["planner", "Planner"],
  ["scherm", "Wandscherm (alleen kijken, voor een tv in de hal)"],
];
const rolNaam = (r: string) => ROLLEN.find(([k]) => k === r)?.[1].replace(/ \(.*\)/, "") ?? r;
const SOORTEN: [string, string][] = [["procesparameter", "Procesparameter (setting en gemeten)"], ["gewicht", "Gewicht"], ["overig", "Overig (alleen gemeten)"]];
const jaNee = (b: boolean) => (b ? "Ja" : "Nee");

/** Voert een wijziging uit, meldt het resultaat en tekent het scherm opnieuw. */
async function wijzig(actie: () => Promise<unknown>, gelukt: string, opnieuw: () => void) {
  try {
    await actie();
    melding(gelukt, "ok");
    opnieuw();
  } catch (e) {
    melding((e as Error).message, "fout");
  }
}

const getalOfNull = (t: string | undefined) => (t === undefined || t.trim() === "" ? null : leesGetal(t));
const tekst = (n: number | null) => (n === null ? "" : toonGetal(n).replace(/\./g, ""));

// ---------- Stappen en velden ----------
export async function stappen(code?: string) {
  const actueel = vastHouden();
  toon(kop("Stappen en velden"), laden());
  let alle: Stap[];
  try { alle = await haal<Stap[]>("/config/stappen?ookInactief=true"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const s = alle.find((x) => x.code === code) ?? alle[0];
  const opnieuw = () => stappen(s.code);

  const veldVragen = (v?: Veld, soort?: string): VraagVeld[] => {
    const isParameter = (soort ?? v?.soort) === "procesparameter";
    return [
      { naam: "naam", label: "Naam", waarde: v?.naam },
      ...(v ? [] : [{ naam: "soort", label: "Soort", opties: SOORTEN, waarde: soort }]),
      { naam: "eenheid", label: "Eenheid", waarde: v?.eenheid ?? undefined, optioneel: true, hint: "Bijvoorbeeld °C, kg, %, bar" },
      { naam: "grens_min", label: "Ondergrens", type: "getal", waarde: tekst(v?.grens_min ?? null), optioneel: true },
      { naam: "grens_max", label: "Bovengrens", type: "getal", waarde: tekst(v?.grens_max ?? null), optioneel: true },
      ...(isParameter
        ? [
            { naam: "tolerantie", label: "Tolerantie (max. verschil tussen setting en gemeten)", type: "getal", waarde: tekst(v?.tolerantie ?? null), optioneel: true },
            { naam: "tolerantie_soort", label: "Tolerantie in", opties: [["absoluut", "Eenheid van het veld"], ["procent", "Procent van de setting"]] as [string, string][], waarde: v?.tolerantie_soort ?? "absoluut" },
          ]
        : []),
      { naam: "verplicht", label: "Verplicht om de stap af te ronden", opties: [["ja", "Ja"], ["nee", "Nee"]], waarde: v ? (v.verplicht ? "ja" : "nee") : "ja" },
    ];
  };
  const naarBody = (r: Record<string, string>, metTolerantie: boolean) => {
    const min = getalOfNull(r.grens_min), max = getalOfNull(r.grens_max);
    if (min !== null && max !== null && min > max) throw new Error("De ondergrens is hoger dan de bovengrens");
    return {
      naam: r.naam,
      eenheid: r.eenheid ? r.eenheid : null,
      grens_min: min,
      grens_max: max,
      ...(metTolerantie ? { tolerantie: getalOfNull(r.tolerantie), tolerantie_soort: r.tolerantie_soort } : {}),
      verplicht: r.verplicht === "ja",
    };
  };

  const veldToevoegen = async () => {
    const keuze = await vraag(`Veld toevoegen aan ${s.naam}`, [{ naam: "soort", label: "Soort veld", opties: SOORTEN }], "Verder");
    if (!keuze) return;
    const r = await vraag(`Nieuw veld: ${SOORTEN.find(([k]) => k === keuze.soort)![1]}`, veldVragen(undefined, keuze.soort).filter((x) => x.naam !== "soort"), "Veld toevoegen",
      "Het veld krijgt automatisch de volgende code. Codes worden nooit hergebruikt.");
    if (!r) return;
    await wijzig(async () => {
      const body = { stapcode: s.code, soort: keuze.soort, ...naarBody(r, keuze.soort === "procesparameter") };
      const nieuw = await stuur<Veld>("POST", "/beheer/velden", body);
      melding(`Veld ${nieuw.code} toegevoegd`, "ok");
    }, "Veld toegevoegd", opnieuw);
  };

  const veldWijzigen = async (v: Veld) => {
    const r = await vraag(`${v.code} wijzigen`, veldVragen(v), "Opslaan",
      "Nieuwe grenzen gelden voor metingen vanaf nu. Eerdere metingen houden de grenzen van toen.");
    if (!r) return;
    await wijzig(() => stuur("PATCH", `/beheer/velden/${encodeURIComponent(v.code)}`, naarBody(r, v.soort === "procesparameter")), `${v.code} opgeslagen`, opnieuw);
  };

  const zetActief = async (v: Veld, actief: boolean) => {
    if (!actief && !(await bevestig(`${v.code} uitzetten?`, "Het veld verdwijnt uit het invoerscherm. Bestaande metingen blijven bewaard, en je kunt het later weer aanzetten. De code wordt nooit opnieuw gebruikt.", "Uitzetten", true))) return;
    await wijzig(() => stuur("PATCH", `/beheer/velden/${encodeURIComponent(v.code)}`, { actief }), actief ? `${v.code} weer actief` : `${v.code} uitgezet`, opnieuw);
  };

  const hernoem = async () => {
    const r = await vraag(`Naam van ${s.code}`, [{ naam: "naam", label: "Naam", waarde: s.naam }], "Opslaan", "De code (bijvoorbeeld PS3), de volgorde en of het om een batch of lot gaat liggen vast in het proces.");
    if (!r) return;
    await wijzig(() => stuur("PATCH", `/beheer/stappen/${s.code}`, { naam: r.naam }), "Naam opgeslagen", opnieuw);
  };

  const grenzen = (v: Veld) => {
    const e = v.eenheid ? ` ${v.eenheid}` : "";
    if (v.grens_min !== null && v.grens_max !== null) return `${toonGetal(v.grens_min)} tot ${toonGetal(v.grens_max)}${e}`;
    if (v.grens_max !== null) return `max ${toonGetal(v.grens_max)}${e}`;
    if (v.grens_min !== null) return `min ${toonGetal(v.grens_min)}${e}`;
    return "";
  };

  toon(
    kop("Stappen en velden", "Per stap de velden die operators invullen. Het invoerscherm bouwt zijn formulieren hieruit op."),
    h("div", { class: "beheer-indeling" },
      h("nav", { class: "stappenlijst", "aria-label": "Stappen" },
        h("div", { class: "lijstkop" }, "Per batch"),
        alle.filter((x) => x.niveau === "batch").map((x) => h("a", { href: `#/beheer/stappen/${x.code}`, "aria-current": x.code === s.code ? "page" : undefined }, h("span", { class: "code" }, x.code), x.naam)),
        h("div", { class: "lijstkop" }, "Per lot"),
        alle.filter((x) => x.niveau === "lot").map((x) => h("a", { href: `#/beheer/stappen/${x.code}`, "aria-current": x.code === s.code ? "page" : undefined }, h("span", { class: "code" }, x.code), x.naam))),
      h("section", { class: "blok", style: "margin-top:0" },
        h("div", { class: "kop" },
          h("div", {}, h("h2", { style: "margin:0" }, `${s.code} ${s.naam}`),
            h("p", { class: "sub" }, `${s.niveau === "batch" ? "Per batch" : "Per lot"}${s.is_lot_stap ? ", hier worden 4 batches één lot" : ""}`)),
          h("div", { class: "knoppen-klein" },
            h("button", { class: "knop", onclick: hernoem }, "Naam wijzigen"),
            h("button", { class: "knop knop-hoofd", onclick: veldToevoegen }, "Veld toevoegen"))),
        s.velden.length
          ? tabel(["Code", "Naam", "Soort", "Grenzen", "Tolerantie", "Verplicht", ""], s.velden.map((v) => [
              h("strong", { class: v.actief ? "" : "inactief" }, v.code),
              h("span", { class: v.actief ? "" : "inactief" }, v.naam, v.actief ? "" : " (uit)"),
              SOORTEN.find(([k]) => k === v.soort)?.[1].replace(/ \(.*\)/, "") ?? v.soort,
              grenzen(v),
              v.tolerantie !== null ? `±${toonGetal(v.tolerantie)}${v.tolerantie_soort === "procent" ? " %" : v.eenheid ? ` ${v.eenheid}` : ""}` : "",
              jaNee(v.verplicht),
              h("div", { class: "knoppen-klein" },
                v.actief ? h("button", { class: "knop knop-klein", onclick: () => veldWijzigen(v) }, "Wijzigen") : null,
                h("button", { class: "knop knop-klein knop-stil", onclick: () => zetActief(v, !v.actief) }, v.actief ? "Uitzetten" : "Weer aanzetten")),
            ]), "compact")
          : h("p", { class: "leeg" }, "Deze stap heeft nog geen velden.")),
    ),
  );
}

// ---------- Accounts ----------
interface Account { gebruikersnaam: string; rol: string; actief: boolean }

export async function accounts() {
  const actueel = vastHouden();
  toon(kop("Accounts"), laden());
  let lijst: Account[];
  try { lijst = await haal<Account[]>("/beheer/gebruikers"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const opnieuw = () => accounts();
  const wachtwoord: VraagVeld = { naam: "wachtwoord", label: "Wachtwoord", type: "password", hint: "Minstens 8 tekens", controle: (w) => (w.length < 8 ? "Minstens 8 tekens" : null) };
  const toevoegen = async () => {
    const r = await vraag("Account toevoegen", [
      { naam: "gebruikersnaam", label: "Gebruikersnaam", hint: "Kleine letters, cijfers, punt of streepje",
        controle: (n) => (/^[a-z0-9._-]{3,40}$/.test(n) ? null : "Alleen kleine letters, cijfers, punt of streepje; 3 tot 40 tekens") },
      { naam: "rol", label: "Rol", opties: ROLLEN, waarde: "kwaliteit" },
      wachtwoord,
    ], "Account toevoegen", "Geef het wachtwoord persoonlijk door. Het wordt alleen versleuteld bewaard.");
    if (!r) return;
    await wijzig(() => stuur("POST", "/beheer/gebruikers", r), `Account ${r.gebruikersnaam} toegevoegd`, opnieuw);
  };
  const zelf = sessie.naam;
  toon(
    kop("Accounts", "Persoonlijke accounts voor de portalen, en het gedeelde operator-account voor het invoerscherm.",
      h("button", { class: "knop knop-hoofd", onclick: toevoegen }, "Account toevoegen")),
    tabel(["Gebruikersnaam", "Rol", "Actief", ""], lijst.map((a) => [
      h("strong", { class: a.actief ? "" : "inactief" }, a.gebruikersnaam, a.gebruikersnaam === zelf ? h("span", { class: "noot" }, " (jij)") : ""),
      rolNaam(a.rol), jaNee(a.actief),
      h("div", { class: "knoppen-klein" },
        h("button", { class: "knop knop-klein", disabled: a.gebruikersnaam === zelf, onclick: async () => {
          const r = await vraag(`Rol van ${a.gebruikersnaam}`, [{ naam: "rol", label: "Rol", opties: ROLLEN, waarde: a.rol }], "Opslaan");
          if (r) await wijzig(() => stuur("PATCH", `/beheer/gebruikers/${a.gebruikersnaam}`, { rol: r.rol }), "Rol opgeslagen", opnieuw);
        } }, "Rol wijzigen"),
        h("button", { class: "knop knop-klein", onclick: async () => {
          const r = await vraag(`Nieuw wachtwoord voor ${a.gebruikersnaam}`, [wachtwoord], "Opslaan");
          if (r) await wijzig(() => stuur("PATCH", `/beheer/gebruikers/${a.gebruikersnaam}`, { wachtwoord: r.wachtwoord }), "Wachtwoord ingesteld", opnieuw);
        } }, "Wachtwoord instellen"),
        h("button", { class: "knop knop-klein knop-stil", disabled: a.gebruikersnaam === zelf, onclick: async () => {
          if (a.actief && !(await bevestig(`${a.gebruikersnaam} uitzetten?`, "Dit account kan daarna niet meer inloggen. Alles wat het heeft ingevoerd blijft bewaard.", "Uitzetten", true))) return;
          await wijzig(() => stuur("PATCH", `/beheer/gebruikers/${a.gebruikersnaam}`, { actief: !a.actief }), a.actief ? "Account uitgezet" : "Account weer actief", opnieuw);
        } }, a.actief ? "Uitzetten" : "Weer aanzetten")),
    ])),
  );
}

// ---------- Operators ----------
interface Operator { id: string; naam: string; actief: boolean }

export async function operators() {
  const actueel = vastHouden();
  toon(kop("Operators"), laden());
  let lijst: Operator[];
  try { lijst = await haal<Operator[]>("/beheer/operators"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const opnieuw = () => operators();
  toon(
    kop("Operators", "De namenlijst waaruit operators kiezen na het inloggen op het invoerscherm.",
      h("button", { class: "knop knop-hoofd", onclick: async () => {
        const r = await vraag("Operator toevoegen", [{ naam: "naam", label: "Naam" }], "Toevoegen");
        if (r) await wijzig(() => stuur("POST", "/beheer/operators", r), `${r.naam} toegevoegd`, opnieuw);
      } }, "Operator toevoegen")),
    tabel(["Naam", "Actief", ""], lijst.map((o) => [
      h("strong", { class: o.actief ? "" : "inactief" }, o.naam), jaNee(o.actief),
      h("div", { class: "knoppen-klein" },
        h("button", { class: "knop knop-klein", onclick: async () => {
          const r = await vraag("Naam wijzigen", [{ naam: "naam", label: "Naam", waarde: o.naam }], "Opslaan", "Eerdere registraties tonen daarna ook de nieuwe naam.");
          if (r) await wijzig(() => stuur("PATCH", `/beheer/operators/${o.id}`, { naam: r.naam }), "Naam opgeslagen", opnieuw);
        } }, "Naam wijzigen"),
        h("button", { class: "knop knop-klein knop-stil", onclick: () =>
          wijzig(() => stuur("PATCH", `/beheer/operators/${o.id}`, { actief: !o.actief }), o.actief ? `${o.naam} staat niet meer in de lijst` : `${o.naam} weer in de lijst`, opnieuw) },
          o.actief ? "Uit de lijst halen" : "Weer in de lijst")),
    ])),
  );
}

// ---------- Grondstoffen ----------
interface Grondstof { id: string; code: string; naam: string; eenheid: string | null; actief: boolean; stappen: { stap: string; verplicht: boolean }[] }

function kiesGrondstofStappen(g: Grondstof, alle: Stap[]): Promise<{ stap: string; verplicht: boolean }[] | null> {
  return new Promise((ok) => {
    const keuze = alle.map((s) => {
      const nu = g.stappen.find((x) => x.stap === s.code);
      return h("select", { "aria-label": `${s.code} ${s.naam}` },
        h("option", { value: "", selected: !nu }, "Niet"),
        h("option", { value: "verplicht", selected: nu?.verplicht === true }, "Verplicht"),
        h("option", { value: "mag", selected: nu?.verplicht === false }, "Mag")) as HTMLSelectElement;
    });
    const d = h("dialog", { class: "venster" },
      h("h2", {}, `${g.code} in welke stappen?`),
      h("p", { class: "sub" }, "Verplicht: de stap kan pas worden afgerond als het partijnummer is ingevuld."),
      h("div", { class: "keuze-raster" }, alle.map((s, i) => h("label", {}, h("span", {}, `${s.code} ${s.naam}`), keuze[i]))),
      h("div", { class: "knoppen" },
        h("button", { class: "knop knop-stil", onclick: () => d.close("nee") }, "Terug"),
        h("button", { class: "knop knop-hoofd", onclick: () => d.close("ja") }, "Opslaan")));
    d.addEventListener("close", () => {
      ok(d.returnValue === "ja"
        ? alle.map((s, i) => ({ stap: s.code, k: keuze[i].value })).filter((x) => x.k).map((x) => ({ stap: x.stap, verplicht: x.k === "verplicht" }))
        : null);
      d.remove();
    });
    document.body.append(d);
    (d as HTMLDialogElement).showModal();
  });
}

export async function grondstoffen() {
  const actueel = vastHouden();
  toon(kop("Grondstoffen"), laden());
  let lijst: Grondstof[], alle: Stap[];
  try { [lijst, alle] = await Promise.all([haal<Grondstof[]>("/beheer/grondstoffen"), haal<Stap[]>("/config/stappen")]); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const opnieuw = () => grondstoffen();
  const stappenTekst = (g: Grondstof) => g.stappen.length ? g.stappen.map((s) => `${s.stap}${s.verplicht ? "" : " (mag)"}`).join(", ") : "Nog geen stap";
  toon(
    kop("Grondstoffen", "Grondstoffen waarvan de operator het partijnummer invoert, en in welke stap. Zo kun je later van een lot terugzoeken naar de grondstof.",
      h("button", { class: "knop knop-hoofd", onclick: async () => {
        const r = await vraag("Grondstof toevoegen", [
          { naam: "code", label: "Code", hint: "Kort, zonder spaties, bijvoorbeeld GS-D. Ligt daarna vast.", controle: (v) => (/^[A-Za-z0-9._-]{1,20}$/.test(v) ? null : "Alleen letters, cijfers, punt en streepjes; hoogstens 20 tekens") },
          { naam: "naam", label: "Naam" },
          { naam: "eenheid", label: "Eenheid van de hoeveelheid", optioneel: true, hint: "Bijvoorbeeld kg of l" },
        ], "Toevoegen", "Kies daarna in welke stappen de grondstof wordt ingevoerd.");
        if (r) await wijzig(() => stuur("POST", "/beheer/grondstoffen", { ...r, eenheid: r.eenheid || null }), `${r.code} toegevoegd`, opnieuw);
      } }, "Grondstof toevoegen")),
    lijst.length
      ? tabel(["Code", "Naam", "Eenheid", "Stappen", ""], lijst.map((g) => [
          h("strong", { class: g.actief ? "" : "inactief" }, g.code),
          h("span", { class: g.actief ? "" : "inactief" }, g.naam, g.actief ? "" : " (uit)"),
          g.eenheid ?? "",
          stappenTekst(g),
          h("div", { class: "knoppen-klein" },
            g.actief ? h("button", { class: "knop knop-klein", onclick: async () => {
              const r = await kiesGrondstofStappen(g, alle);
              if (r) await wijzig(() => stuur("PATCH", `/beheer/grondstoffen/${encodeURIComponent(g.code)}`, { stappen: r }), "Stappen opgeslagen", opnieuw);
            } }, "Stappen kiezen") : null,
            g.actief ? h("button", { class: "knop knop-klein", onclick: async () => {
              const r = await vraag(`${g.code} wijzigen`, [{ naam: "naam", label: "Naam", waarde: g.naam }, { naam: "eenheid", label: "Eenheid", waarde: g.eenheid ?? "", optioneel: true }], "Opslaan");
              if (r) await wijzig(() => stuur("PATCH", `/beheer/grondstoffen/${encodeURIComponent(g.code)}`, { naam: r.naam, eenheid: r.eenheid || null }), "Opgeslagen", opnieuw);
            } }, "Wijzigen") : null,
            h("button", { class: "knop knop-klein knop-stil", onclick: async () => {
              if (g.actief && !(await bevestig(`${g.code} uitzetten?`, "De grondstof verdwijnt uit het invoerscherm. Wat al is ingevoerd blijft bewaard en terug te zoeken.", "Uitzetten", true))) return;
              await wijzig(() => stuur("PATCH", `/beheer/grondstoffen/${encodeURIComponent(g.code)}`, { actief: !g.actief }), g.actief ? `${g.code} uitgezet` : `${g.code} weer actief`, opnieuw);
            } }, g.actief ? "Uitzetten" : "Weer aanzetten")),
        ]), "compact")
      : h("p", { class: "leeg" }, "Nog geen grondstoffen. Voeg er een toe."),
  );
}

// ---------- Ploegen ----------
interface Ploeg { code: string; naam: string; begint: string; eindigt: string; actief: boolean }

export async function ploegen() {
  const actueel = vastHouden();
  toon(kop("Ploegen"), laden());
  let lijst: Ploeg[];
  try { lijst = await haal<Ploeg[]>("/overdracht/ploegen"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const tijdCheck = (v: string) => (/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v) ? null : "Schrijf de tijd als uu:mm, bijvoorbeeld 06:00");
  toon(
    kop("Ploegen", "Begin- en eindtijden van de ploegen. Hiermee worden de ploegoverdracht en de cijfers per ploeg ingedeeld. Een ploeg die over middernacht loopt, hoort bij de dag waarop hij begint."),
    tabel(["Code", "Naam", "Van", "Tot", ""], lijst.map((p) => [
      h("strong", { class: p.actief ? "" : "inactief" }, p.code), h("span", { class: p.actief ? "" : "inactief" }, p.naam, p.actief ? "" : " (uit)"), p.begint, p.eindigt,
      h("div", { class: "knoppen-klein" },
        h("button", { class: "knop knop-klein", onclick: async () => {
          const r = await vraag(`${p.naam} wijzigen`, [
            { naam: "naam", label: "Naam", waarde: p.naam },
            { naam: "begint", label: "Begint om", waarde: p.begint, controle: tijdCheck },
            { naam: "eindigt", label: "Eindigt om", waarde: p.eindigt, controle: tijdCheck },
          ], "Opslaan", "Let op dat de ploegen elkaar niet overlappen en samen de hele dag dekken.");
          if (r) await wijzig(() => stuur("PATCH", `/overdracht/ploegen/${p.code}`, r), "Ploeg opgeslagen", ploegen);
        } }, "Wijzigen"),
        h("button", { class: "knop knop-klein knop-stil", onclick: () =>
          wijzig(() => stuur("PATCH", `/overdracht/ploegen/${p.code}`, { actief: !p.actief }), p.actief ? `${p.naam} uitgezet` : `${p.naam} weer actief`, ploegen) },
          p.actief ? "Uitzetten" : "Weer aanzetten")),
    ]), "compact"),
  );
}

// ---------- Pc's ----------
interface Pc { naam: string; locatie: string | null; actief: boolean; stappen: string[] }

function kiesStappen(pc: Pc, alle: Stap[]): Promise<string[] | null> {
  return new Promise((ok) => {
    const vinken = alle.map((s) => h("input", { type: "checkbox", value: s.code, checked: pc.stappen.includes(s.code) }) as HTMLInputElement);
    const d = h("dialog", { class: "venster" },
      h("h2", {}, `Stappen op ${pc.naam}`),
      h("p", { class: "sub" }, "Welke stappen staan in de keuzelijst van deze pc? Niets aangevinkt betekent: alle stappen."),
      h("div", { class: "vinklijst" }, alle.map((s, i) => h("label", {}, vinken[i], ` ${s.code} ${s.naam}`))),
      h("div", { class: "knoppen" },
        h("button", { class: "knop knop-stil", onclick: () => d.close("nee") }, "Terug"),
        h("button", { class: "knop knop-hoofd", onclick: () => d.close("ja") }, "Opslaan")));
    d.addEventListener("close", () => {
      ok(d.returnValue === "ja" ? vinken.filter((v) => v.checked).map((v) => v.value) : null);
      d.remove();
    });
    document.body.append(d);
    (d as HTMLDialogElement).showModal();
  });
}

export async function pcs() {
  const actueel = vastHouden();
  toon(kop("Pc's"), laden());
  let lijst: Pc[], alle: Stap[];
  try { [lijst, alle] = await Promise.all([haal<Pc[]>("/beheer/pcs"), haal<Stap[]>("/config/stappen")]); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const opnieuw = () => pcs();
  toon(
    kop("Pc's", "Pc's waarop het invoerscherm draait, en welke stappen elke pc bedient.",
      h("button", { class: "knop knop-hoofd", onclick: async () => {
        const r = await vraag("Pc toevoegen", [
          { naam: "naam", label: "Naam", hint: "Bijvoorbeeld PC-21", controle: (n) => (/^[A-Za-z0-9-]{2,20}$/.test(n) ? null : "Letters, cijfers en streepjes; 2 tot 20 tekens") },
          { naam: "locatie", label: "Locatie", optioneel: true },
        ], "Toevoegen");
        if (r) await wijzig(() => stuur("POST", "/beheer/pcs", { naam: r.naam, ...(r.locatie ? { locatie: r.locatie } : {}) }), `${r.naam.toUpperCase()} toegevoegd`, opnieuw);
      } }, "Pc toevoegen")),
    tabel(["Pc", "Locatie", "Stappen", "Actief", ""], lijst.map((p) => [
      h("strong", { class: p.actief ? "" : "inactief" }, p.naam), p.locatie ?? "",
      p.stappen.length ? p.stappen.join(", ") : h("span", { class: "sub" }, "Alle stappen"),
      jaNee(p.actief),
      h("div", { class: "knoppen-klein" },
        h("button", { class: "knop knop-klein", onclick: async () => {
          const keuze = await kiesStappen(p, alle);
          if (keuze) await wijzig(() => stuur("PATCH", `/beheer/pcs/${p.naam}`, { stappen: keuze }), `Stappen van ${p.naam} opgeslagen`, opnieuw);
        } }, "Stappen kiezen"),
        h("button", { class: "knop knop-klein", onclick: async () => {
          const r = await vraag(`Locatie van ${p.naam}`, [{ naam: "locatie", label: "Locatie", waarde: p.locatie ?? "", optioneel: true }], "Opslaan");
          if (r) await wijzig(() => stuur("PATCH", `/beheer/pcs/${p.naam}`, { locatie: r.locatie || null }), "Locatie opgeslagen", opnieuw);
        } }, "Locatie"),
        h("button", { class: "knop knop-klein knop-stil", onclick: () =>
          wijzig(() => stuur("PATCH", `/beheer/pcs/${p.naam}`, { actief: !p.actief }), p.actief ? `${p.naam} uitgezet` : `${p.naam} weer actief`, opnieuw) },
          p.actief ? "Uitzetten" : "Weer aanzetten")),
    ])),
  );
}

// ---------- Logboek ----------
interface Regel { tabel: string; actie: string; oud: Record<string, unknown> | null; nieuw: Record<string, unknown> | null; extra: Record<string, string> | null; gewijzigd_door: string; gewijzigd_op: string }

const ONDERDEEL: Record<string, string> = { processtap: "Stap", veld: "Veld", gebruiker: "Account", operator: "Operator", pc: "Pc", pc_stap: "Pc en stap" };
const KOLOM: Record<string, string> = {
  naam: "naam", eenheid: "eenheid", grens_min: "ondergrens", grens_max: "bovengrens", tolerantie: "tolerantie", tolerantie_soort: "tolerantie in",
  verplicht: "verplicht", actief: "actief", rol: "rol", locatie: "locatie", volgnummer: "volgorde", soort: "soort",
};
const toonWaarde = (v: unknown) => (v === null || v === undefined || v === "" ? "leeg" : typeof v === "boolean" ? jaNee(v) : String(v));

function beschrijf(r: Regel): { onderwerp: string; wat: string } {
  const d = (r.nieuw ?? r.oud ?? {}) as Record<string, unknown>;
  const onderwerp =
    r.tabel === "pc_stap" ? `${r.extra?.pc ?? "?"}: ${r.extra?.stap ?? "?"}` :
    r.tabel === "veld" ? `${d.code} ${d.naam}` :
    r.tabel === "processtap" ? `${d.code}` :
    String(d.gebruikersnaam ?? d.naam ?? "");
  if (r.tabel === "pc_stap") return { onderwerp, wat: r.actie === "INSERT" ? "Stap toegevoegd aan de pc" : "Stap van de pc gehaald" };
  if (r.actie === "INSERT") {
    return { onderwerp, wat: r.tabel === "gebruiker" ? `Aangemaakt als ${rolNaam(String(d.rol))}` : "Toegevoegd" };
  }
  const veranderd: string[] = [];
  for (const k of Object.keys(KOLOM)) {
    if (r.oud && r.nieuw && JSON.stringify(r.oud[k]) !== JSON.stringify(r.nieuw[k])) {
      if (k === "actief") veranderd.push(r.nieuw[k] ? "Weer aangezet" : "Uitgezet");
      else veranderd.push(`${KOLOM[k]}: ${toonWaarde(r.oud[k])} naar ${toonWaarde(r.nieuw[k])}`);
    }
  }
  if (r.nieuw?.wachtwoord === "gewijzigd") veranderd.push("wachtwoord opnieuw ingesteld");
  return { onderwerp, wat: veranderd.length ? veranderd.join("; ") : "Gewijzigd" };
}

let logFilter = "";
export async function logboek() {
  const actueel = vastHouden();
  toon(kop("Logboek"), laden());
  let regels: Regel[];
  try { regels = await haal<Regel[]>(`/beheer/logboek${qs({ tabel: logFilter, limiet: 300 })}`); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const sel = h("select", { id: "f-onderdeel", onchange: (e: Event) => { logFilter = (e.target as HTMLSelectElement).value; logboek(); } },
    h("option", { value: "" }, "Alles"), Object.entries(ONDERDEEL).map(([k, v]) => h("option", { value: k, selected: k === logFilter }, v)));
  toon(
    kop("Logboek", "Elke wijziging in de instellingen: wie, wat en wanneer. Wachtwoorden staan er nooit in, alleen dat ze opnieuw zijn ingesteld."),
    h("div", { class: "filters" }, h("label", { for: "f-onderdeel", class: "filter" }, "Onderdeel", sel)),
    regels.length
      ? tabel(["Wanneer", "Door", "Onderdeel", "Wat", "Wijziging"], regels.map((r) => {
          const b = beschrijf(r);
          return [datum(r.gewijzigd_op), r.gewijzigd_door, ONDERDEEL[r.tabel] ?? r.tabel, h("strong", {}, b.onderwerp), b.wat];
        }), "compact")
      : h("p", { class: "leeg" }, "Nog geen wijzigingen."),
  );
}

// ---------- Server ----------
interface Onderhoud { soort: string; gestart_op: string; klaar_op: string; gelukt: boolean; bestand: string | null; grootte_bytes: number | null; versie: string | null; melding: string | null }
interface ServerStand {
  versie: string; node: string; servertijd: string;
  schema: { nummer: number; naam: string; uitgevoerd_op: string } | null;
  database: { naam: string; grootte_bytes: number; postgres: string };
  laatsteBackup: Onderhoud | null; laatsteHersteltest: Onderhoud | null; recent: Onderhoud[];
  waarschuwingen: { niveau: "let_op" | "fout"; tekst: string }[];
}
const SOORT_ONDERHOUD: Record<string, string> = { backup: "Back-up", hersteltest: "Hersteltest", herstel: "Herstel", migratie: "Database-update" };
const grootte = (b: number | null) => (b === null ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} kB` : `${(b / 1024 / 1024).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} MB`);
function geleden(iso: string, nu: number) {
  const min = Math.max(0, Math.round((nu - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} min geleden`;
  if (min < 48 * 60) return `${Math.round(min / 60)} uur geleden`;
  return `${Math.round(min / 1440)} dagen geleden`;
}
const resultaat = (o: Onderhoud) => h("span", { class: o.gelukt ? "label label-ok" : "label label-buiten_grens" }, o.gelukt ? "Gelukt" : "Mislukt");

export async function server() {
  const actueel = vastHouden();
  toon(kop("Server"), laden());
  let s: ServerStand;
  try { s = await haal<ServerStand>("/beheer/server"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const nu = new Date(s.servertijd).getTime();
  const tegel = (getal: string, tekst: string, extra?: string, nadruk = false) =>
    h("div", { class: nadruk ? "tegel nadruk" : "tegel" }, h("span", { class: "tegel-getal" }, getal), h("span", { class: "tegel-tekst" }, tekst), extra ? h("span", { class: "tegel-extra" }, extra) : null);
  const b = s.laatsteBackup, t = s.laatsteHersteltest;
  const meldingen = s.waarschuwingen.length
    ? h("ul", { class: "serverstatus" }, s.waarschuwingen.map((w) =>
        h("li", { class: `status-${w.niveau}` }, h("span", { class: "status-teken", "aria-hidden": "true" }, w.niveau === "fout" ? "!" : "i"), h("strong", {}, w.niveau === "fout" ? "Actie nodig: " : "Let op: "), w.tekst)))
    : h("p", { class: "serverstatus-ok" }, h("span", { class: "label label-ok" }, "In orde"), " Back-ups en hersteltests lopen volgens schema.");
  toon(
    kop("Server", "Versie, database, back-ups en hersteltests. De back-ups en hersteltests maakt de server zelf volgens het schema van IT."),
    meldingen,
    h("div", { class: "tegels server-tegels" },
      tegel(s.versie, "versie van de applicatie", s.schema ? `database: schemaversie ${s.schema.nummer}` : "database: schemaversie onbekend"),
      tegel(b ? geleden(b.klaar_op, nu) : "Nooit", "laatste back-up", b ? `${b.gelukt ? grootte(b.grootte_bytes) : "mislukt"} · ${datum(b.klaar_op)}` : undefined, !b || !b.gelukt),
      tegel(t ? geleden(t.klaar_op, nu) : "Nooit", "laatste hersteltest", t ? (t.gelukt ? t.melding ?? "gelukt" : "mislukt") : undefined),
      tegel(grootte(s.database.grootte_bytes), "grootte van de database", s.database.naam),
    ),
    h("h2", {}, "Laatste onderhoud"),
    s.recent.length
      ? tabel(["Wanneer", "Wat", "Resultaat", "Bestand", "Grootte", "Toelichting"], s.recent.map((o) => [
          datum(o.klaar_op), SOORT_ONDERHOUD[o.soort] ?? o.soort, resultaat(o), o.bestand ?? "", grootte(o.grootte_bytes), o.melding ?? "",
        ]), "compact")
      : h("p", { class: "leeg" }, "Nog geen back-ups, hersteltests of database-updates."),
    h("h2", {}, "Details"),
    tabel(["Onderdeel", "Waarde"], [
      ["Applicatie", s.versie],
      ["Database", `${s.database.naam}, schemaversie ${s.schema ? `${s.schema.nummer} (${s.schema.naam}, ${datum(s.schema.uitgevoerd_op)})` : "onbekend"}`],
      ["PostgreSQL", s.database.postgres],
      ["Node.js", s.node],
      ["Tijd op de server", datum(s.servertijd)],
    ], "compact"),
  );
}
