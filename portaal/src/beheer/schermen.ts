// Portaal Beheer: stappen en velden, accounts, operators, pc's en het logboek.
// Elke wijziging komt in het logboek; niets wordt verwijderd, alleen uitgezet.
import { bevestig, h, laden, melding, toon, vastHouden, vraag, type VraagVeld } from "../../../gedeeld/ui";
import { leesGetal, toonGetal } from "../../../gedeeld/markering";
import type { Stap, Veld } from "../../../gedeeld/types";
import { haal, qs, sessie, stuur } from "../basis";
import { datum, fout, kop, tabel, afgekapt } from "../kwaliteit/schermen";
import { downloadXlsx, leesNlGetal, leesXlsxBladen, vandaag, xlsxBladen, type Cel } from "../excel";

const ROLLEN: [string, string][] = [
  ["operator", "Operator"],
  ["ploegleider", "Ploegleider"],
  ["kwaliteit", "Kwaliteit"],
  ["productiemanager", "Productiemanager"],
  ["beheerder", "Beheerder"],
  ["analist", "Analist (alleen lezen)"],
  ["planner", "Planner"],
  ["scherm", "Wandscherm (alleen kijken, voor een tv in de hal)"],
];
const rolNaam = (r: string) => ROLLEN.find(([k]) => k === r)?.[1].replace(/ \(.*\)/, "") ?? r;
const SOORTEN: [string, string][] = [["procesparameter", "Procesparameter (instelling en gemeten)"], ["gewicht", "Gewicht"], ["overig", "Overig (alleen gemeten)"]];
const jaNee = (b: boolean) => (b ? "Ja" : "Nee");

/** Voert een wijziging uit, meldt het resultaat en tekent het scherm opnieuw. */
async function wijzig(actie: () => Promise<unknown>, gelukt: string, opnieuw: () => void, terug?: () => Promise<unknown>) {
  try {
    await actie();
    melding(gelukt, "ok", terug ? () => wijzig(terug, "Ongedaan gemaakt", opnieuw) : undefined);
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
      { naam: "decimalen", label: "Decimalen", type: "getal", waarde: v?.decimalen === null || v?.decimalen === undefined ? "" : String(v.decimalen), optioneel: true,
        hint: "Hoeveel cijfers achter de komma bij het tonen (0 tot en met 6). Leeg = automatisch." },
      ...(isParameter
        ? [
            { naam: "tolerantie", label: "Tolerantie (max. verschil tussen instelling en gemeten)", type: "getal", waarde: tekst(v?.tolerantie ?? null), optioneel: true },
            { naam: "tolerantie_soort", label: "Tolerantie in", opties: [["absoluut", "Eenheid van het veld"], ["procent", "Procent van de setting"]] as [string, string][], waarde: v?.tolerantie_soort ?? "absoluut" },
          ]
        : []),
      { naam: "gemeten_door", label: "Wie meet", opties: [["productie", "Productie: de operator, bij de stap"], ["kwaliteit", "Kwaliteit: na het afronden, daarna vrijgave"]] as [string, string][],
        waarde: v?.gemeten_door ?? "productie",
        hint: "Meet Kwaliteit, dan wacht de batch of het lot na de stap op de metingen en de vrijgave van Kwaliteit." },
      { naam: "verplicht", label: "Verplicht (om af te ronden, of bij Kwaliteit: om vrij te geven)", opties: [["ja", "Ja"], ["nee", "Nee"]], waarde: v ? (v.verplicht ? "ja" : "nee") : "ja" },
      { naam: "op_certificaat", label: "Op het certificaat per lot", opties: [["nee", "Nee"], ["ja", "Ja"]], waarde: v?.op_certificaat ? "ja" : "nee" },
    ];
  };
  const naarBody = (r: Record<string, string>, metTolerantie: boolean) => {
    const min = getalOfNull(r.grens_min), max = getalOfNull(r.grens_max);
    if (min !== null && max !== null && min > max) throw new Error("De ondergrens is hoger dan de bovengrens");
    const decimalen = getalOfNull(r.decimalen ?? "");
    if (decimalen !== null && (!Number.isInteger(decimalen) || decimalen < 0 || decimalen > 6)) throw new Error("Decimalen moet een heel getal van 0 tot en met 6 zijn");
    return {
      naam: r.naam,
      eenheid: r.eenheid ? r.eenheid : null,
      grens_min: min,
      grens_max: max,
      ...(metTolerantie ? { tolerantie: getalOfNull(r.tolerantie), tolerantie_soort: r.tolerantie_soort } : {}),
      verplicht: r.verplicht === "ja",
      op_certificaat: r.op_certificaat === "ja",
      decimalen,
      gemeten_door: r.gemeten_door === "kwaliteit" ? "kwaliteit" : "productie",
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
    const zet = (a: boolean) => () => stuur("PATCH", `/beheer/velden/${encodeURIComponent(v.code)}`, { actief: a });
    await wijzig(zet(actief), actief ? `${v.code} weer actief` : `${v.code} uitgezet; bestaande metingen blijven bewaard`, opnieuw, zet(!actief));
  };

  const hernoem = async () => {
    const r = await vraag(`Naam van ${s.code}`, [{ naam: "naam", label: "Naam", waarde: s.naam }], "Opslaan", "De code (bijvoorbeeld PS3), de volgorde en of het om een batch of lot gaat liggen vast in het proces.");
    if (!r) return;
    await wijzig(() => stuur("PATCH", `/beheer/stappen/${s.code}`, { naam: r.naam }), "Naam opgeslagen", opnieuw);
  };

  const grenzen = (v: { grens_min: number | null; grens_max: number | null }, eenheid: string | null) => {
    const e = eenheid ? ` ${eenheid}` : "";
    if (v.grens_min !== null && v.grens_max !== null) return `${toonGetal(v.grens_min)} tot ${toonGetal(v.grens_max)}${e}`;
    if (v.grens_max !== null) return `max ${toonGetal(v.grens_max)}${e}`;
    if (v.grens_min !== null) return `min ${toonGetal(v.grens_min)}${e}`;
    return "";
  };
  const tolerantieTekst = (t: { tolerantie: number | null; tolerantie_soort: string }, eenheid: string | null) =>
    t.tolerantie !== null ? `±${toonGetal(t.tolerantie)}${t.tolerantie_soort === "procent" ? " %" : eenheid ? ` ${eenheid}` : ""}` : "";

  // Grenzen per product (D55): eerst het product kiezen, dan de grenzen; "Zelfde als het veld" haalt ze weg.
  const perProduct = async (v: Veld) => {
    let lijst: { code: string; naam: string }[];
    try { lijst = await haal<{ code: string; naam: string }[]>("/planning/producten"); } catch (e) { return melding((e as Error).message, "fout"); }
    if (!lijst.length) return melding("Er zijn nog geen producten. Voeg ze toe in Planning → Producten.", "fout");
    const keuze = await vraag(`${v.code} ${v.naam}: grenzen per product`, [{
      naam: "product", label: "Product",
      opties: lijst.map((p): [string, string] => [p.code, `${p.code} – ${p.naam}${v.per_product?.some((x) => x.product === p.code) ? " (eigen grenzen)" : ""}`]),
    }], "Verder", "Een product zonder eigen grenzen volgt de grenzen van het veld.");
    if (!keuze) return;
    const eigen = v.per_product?.find((x) => x.product === keuze.product);
    const bron = eigen ?? v;
    const isParameter = v.soort === "procesparameter";
    const r = await vraag(`${v.code} voor ${keuze.product}`, [
      { naam: "gebruik", label: "Grenzen voor dit product", opties: [["eigen", "Eigen grenzen (hieronder)"], ["veld", "Zelfde als het veld"]], waarde: "eigen" },
      { naam: "grens_min", label: "Ondergrens", type: "getal", waarde: tekst(bron.grens_min), optioneel: true },
      { naam: "grens_max", label: "Bovengrens", type: "getal", waarde: tekst(bron.grens_max), optioneel: true },
      ...(isParameter
        ? [
            { naam: "tolerantie", label: "Tolerantie (max. verschil tussen instelling en gemeten)", type: "getal", waarde: tekst(bron.tolerantie), optioneel: true },
            { naam: "tolerantie_soort", label: "Tolerantie in", opties: [["absoluut", "Eenheid van het veld"], ["procent", "Procent van de setting"]] as [string, string][], waarde: bron.tolerantie_soort ?? "absoluut" },
          ]
        : []),
    ], "Opslaan", `Het veld zelf: ${grenzen(v, v.eenheid) || "geen grenzen"}${isParameter && v.tolerantie !== null ? `, ${tolerantieTekst(v, v.eenheid)}` : ""}. Nieuwe grenzen gelden voor metingen vanaf nu; eerdere metingen houden de grenzen van toen.`);
    if (!r) return;
    const pad = `/beheer/velden/${encodeURIComponent(v.code)}/producten/${encodeURIComponent(keuze.product)}`;
    if (r.gebruik === "veld") {
      if (!eigen) return melding(`${keuze.product} volgt al de grenzen van het veld`, "ok");
      return wijzig(() => stuur("DELETE", pad), `${keuze.product} volgt weer de grenzen van ${v.code}`, opnieuw);
    }
    const min = getalOfNull(r.grens_min), max = getalOfNull(r.grens_max);
    if (min !== null && max !== null && min > max) return melding("De ondergrens is hoger dan de bovengrens", "fout");
    await wijzig(() => stuur("PUT", pad, {
      grens_min: min, grens_max: max,
      tolerantie: isParameter ? getalOfNull(r.tolerantie) : null,
      ...(isParameter ? { tolerantie_soort: r.tolerantie_soort } : {}),
    }), `Grenzen van ${v.code} voor ${keuze.product} opgeslagen`, opnieuw);
  };

  toon(
    kop("Stappen en velden", "Per stap de velden die operators invullen. Het invoerscherm bouwt zijn formulieren hieruit op.",
      h("div", { class: "knoppen-klein" },
        h("button", { class: "knop", type: "button", onclick: () => sjabloonDownloaden(alle) }, "Sjabloon downloaden"),
        h("label", { class: "knop", for: "sjabloon-bestand" }, "Sjabloon inlezen"),
        h("input", { id: "sjabloon-bestand", type: "file", accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", class: "verborgen",
          onchange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void sjabloonInlezen(f, s.code); } }))),
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
          ? tabel(["Code", "Naam", "Soort", "Wie meet", "Grenzen", "Tolerantie", "Verplicht", "Certificaat", ""], s.velden.map((v) => [
              h("strong", { class: v.actief ? "" : "inactief" }, v.code),
              h("span", { class: v.actief ? "" : "inactief" }, v.naam, v.actief ? "" : " (uit)"),
              SOORTEN.find(([k]) => k === v.soort)?.[1].replace(/ \(.*\)/, "") ?? v.soort,
              v.gemeten_door === "kwaliteit" ? h("strong", {}, "Kwaliteit") : "Productie",
              h("div", {}, grenzen(v, v.eenheid),
                (v.per_product ?? []).map((p) => h("div", { class: "sub per-product" }, `${p.product}: ${grenzen(p, v.eenheid) || "geen grenzen"}`))),
              h("div", {}, tolerantieTekst(v, v.eenheid),
                v.soort === "procesparameter" ? (v.per_product ?? []).map((p) => h("div", { class: "sub per-product" }, `${p.product}: ${tolerantieTekst(p, v.eenheid) || "geen"}`)) : null),
              jaNee(v.verplicht),
              v.op_certificaat ? "Ja" : "",
              h("div", { class: "knoppen-klein" },
                v.actief ? h("button", { class: "knop knop-klein", onclick: () => veldWijzigen(v) }, "Wijzigen") : null,
                v.actief ? h("button", { class: "knop knop-klein", "aria-label": `${v.code} grenzen per product`, onclick: () => perProduct(v) }, "Per product") : null,
                h("button", { class: "knop knop-klein knop-stil", onclick: () => zetActief(v, !v.actief) }, v.actief ? "Uitzetten" : "Weer aanzetten")),
            ]), "compact")
          : h("p", { class: "leeg" }, "Deze stap heeft nog geen velden.")),
    ),
  );
}

// ---------- Velden via een Excel-sjabloon (0.22.0, D46) ----------
const SJABLOON = ["Stap", "Code", "Naam", "Soort", "Eenheid", "Verplicht", "Tolerantie", "Tolerantie in", "Ondergrens", "Bovengrens", "Decimalen", "Op certificaat", "Actief", "Gemeten door"];

function sjabloonDownloaden(alle: Stap[]) {
  const nl = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));
  const rijen = alle.flatMap((s) => s.velden.map((v) => [
    s.code, v.code, v.naam, v.soort, v.eenheid ?? "", v.verplicht ? "ja" : "nee",
    nl(v.tolerantie), v.soort === "procesparameter" ? v.tolerantie_soort : "", nl(v.grens_min), nl(v.grens_max),
    v.decimalen === null || v.decimalen === undefined ? "" : String(v.decimalen),
    v.op_certificaat ? "ja" : "nee", v.actief ? "ja" : "nee",
    v.gemeten_door === "kwaliteit" ? "Kwaliteit" : "Productie",
  ]));
  // Tweede blad (0.31.0, D55): eigen grenzen per product. Dit blad is de volledige lijst; een regel weghalen haalt de eigen grenzen weg.
  const grenzen = alle.flatMap((s) => s.velden.flatMap((v) => (v.per_product ?? []).map((p) => [
    v.code, p.product, nl(p.grens_min), nl(p.grens_max), nl(p.tolerantie), v.soort === "procesparameter" ? p.tolerantie_soort : "",
  ])));
  downloadXlsx(xlsxBladen([
    { naam: "Velden", koppen: SJABLOON, rijen },
    { naam: GRENZEN_BLAD, koppen: SJABLOON_GRENZEN, rijen: grenzen },
  ]), `Velden per stap ${vandaag()}.xlsx`);
}

const GRENZEN_BLAD = "Grenzen per product";
const SJABLOON_GRENZEN = ["Veld", "Product", "Ondergrens", "Bovengrens", "Tolerantie", "Tolerantie in"];
interface GrensRegel { regel: number; veld: string; product: string; grens_min: number | null; grens_max: number | null; tolerantie: number | null; tolerantie_soort: string | null }
interface GrensUitkomst { regel: number; veld: string; product: string; actie: "nieuw" | "wijzigen" | "gelijk" | "weghalen" | "fout"; wijzigingen: string[]; fout: string | null }

interface ImportRegel {
  regel: number; stapcode: string; code: string | null; naam: string; soort: string; eenheid: string | null; verplicht: boolean;
  tolerantie: number | null; tolerantie_soort: string | null; grens_min: number | null; grens_max: number | null; op_certificaat: boolean; actief: boolean;
  decimalen?: number | null;
  gemeten_door?: string | null;
}
interface ImportUitkomst { regel: number; stapcode: string; code: string | null; naam: string; actie: "nieuw" | "wijzigen" | "gelijk" | "fout"; wijzigingen: string[]; fout: string | null }
interface ImportAntwoord {
  uitgevoerd: boolean; nieuw: number; gewijzigd: number; gelijk: number; fouten: number; regels: ImportUitkomst[];
  grenzen?: { nieuw: number; gewijzigd: number; gelijk: number; weghalen: number; fouten: number; regels: GrensUitkomst[] };
}

/** Getal uit een cel: getal, of tekst met komma of punt. */
function celGetal(c: Cel, naam: string, problemen: string[]): number | null {
  if (c === null || c === "") return null;
  if (typeof c === "number") return c;
  const n = leesNlGetal(String(c)) ?? leesGetal(String(c));
  if (n === null) problemen.push(`${naam} "${c}" is geen getal`);
  return n;
}

/** Het tweede blad: per veld en product de eigen grenzen. Lege regels tellen niet. */
function leesGrenzenBlad(rijen: Cel[][]): { regels: GrensRegel[]; fouten: GrensUitkomst[] } {
  const kop = (rijen[0] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
  const kolom = (naam: string) => kop.indexOf(naam.toLowerCase());
  const ontbreekt = ["Veld", "Product"].filter((k) => kolom(k) < 0);
  if (ontbreekt.length) throw new Error(`Blad "${GRENZEN_BLAD}": kolom ${ontbreekt.join(", ")} ontbreekt. Gebruik het sjabloon dat je hier downloadt.`);
  const regels: GrensRegel[] = [], fouten: GrensUitkomst[] = [];
  for (let i = 1; i < rijen.length; i++) {
    const r = rijen[i] ?? [];
    if (r.every((c) => c === null || c === "")) continue;
    const cel = (naam: string): Cel => (kolom(naam) >= 0 ? r[kolom(naam)] ?? null : null);
    const tekst = (naam: string) => { const c = cel(naam); return c === null ? null : String(c).trim() || null; };
    const problemen: string[] = [];
    const regel: GrensRegel = {
      regel: i + 1, veld: tekst("Veld") ?? "", product: tekst("Product") ?? "",
      grens_min: celGetal(cel("Ondergrens"), "Ondergrens", problemen), grens_max: celGetal(cel("Bovengrens"), "Bovengrens", problemen),
      tolerantie: celGetal(cel("Tolerantie"), "Tolerantie", problemen),
      tolerantie_soort: (tekst("Tolerantie in") ?? "absoluut").toLowerCase().replace("%", "procent"),
    };
    if (!regel.veld) problemen.push("Veld ontbreekt");
    if (!regel.product) problemen.push("Product ontbreekt");
    if (problemen.length) fouten.push({ regel: regel.regel, veld: regel.veld, product: regel.product, actie: "fout", wijzigingen: [], fout: problemen.join("; ") });
    else regels.push(regel);
  }
  return { regels, fouten };
}

/** Zet de rijen van het blad om naar regels voor de server; fouten in het bestand zelf komen meteen terug. */
function leesSjabloon(rijen: Cel[][]): { regels: ImportRegel[]; fouten: ImportUitkomst[] } {
  const kop = (rijen[0] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
  const kolom = (naam: string) => kop.indexOf(naam.toLowerCase());
  const ontbreekt = ["Stap", "Naam", "Soort"].filter((k) => kolom(k) < 0);
  if (ontbreekt.length) throw new Error(`Kolom ${ontbreekt.join(", ")} ontbreekt. Gebruik het sjabloon dat je hier downloadt.`);
  const regels: ImportRegel[] = [];
  const fouten: ImportUitkomst[] = [];
  for (let i = 1; i < rijen.length; i++) {
    const r = rijen[i] ?? [];
    const cel = (naam: string): Cel => (kolom(naam) >= 0 ? r[kolom(naam)] ?? null : null);
    if (r.every((c) => c === null || c === "")) continue;
    const tekst = (naam: string) => { const c = cel(naam); return c === null ? null : String(c).trim() || null; };
    const problemen: string[] = [];
    const getal = (naam: string): number | null => celGetal(cel(naam), naam, problemen);
    const jaNeeCel = (naam: string, standaard: boolean): boolean => {
      const c = cel(naam);
      if (c === null || c === "") return standaard;
      if (typeof c === "boolean") return c;
      const t = String(c).trim().toLowerCase();
      if (["ja", "j", "yes", "y", "1", "waar", "true", "x"].includes(t)) return true;
      if (["nee", "n", "no", "0", "onwaar", "false"].includes(t)) return false;
      problemen.push(`${naam} "${c}" is geen ja of nee`);
      return standaard;
    };
    const regel: ImportRegel = {
      regel: i + 1, stapcode: tekst("Stap") ?? "", code: tekst("Code"), naam: tekst("Naam") ?? "", soort: (tekst("Soort") ?? "").toLowerCase(),
      eenheid: tekst("Eenheid"), verplicht: jaNeeCel("Verplicht", true), tolerantie: getal("Tolerantie"),
      tolerantie_soort: (tekst("Tolerantie in") ?? "absoluut").toLowerCase().replace("%", "procent"),
      grens_min: getal("Ondergrens"), grens_max: getal("Bovengrens"), op_certificaat: jaNeeCel("Op certificaat", false), actief: jaNeeCel("Actief", true),
      ...(kolom("Decimalen") >= 0 ? { decimalen: getal("Decimalen") } : {}),
      // Zonder kolom "Gemeten door" (sjabloon van vóór 0.37.0) blijft het zoals het is.
      ...(kolom("Gemeten door") >= 0 ? { gemeten_door: tekst("Gemeten door") } : {}),
    };
    if (regel.decimalen !== undefined && regel.decimalen !== null && (!Number.isInteger(regel.decimalen) || regel.decimalen < 0 || regel.decimalen > 6))
      problemen.push(`Decimalen "${regel.decimalen}" moet een heel getal van 0 tot en met 6 zijn`);
    if (!regel.stapcode) problemen.push("Stap ontbreekt");
    if (!regel.naam) problemen.push("Naam ontbreekt");
    if (problemen.length) fouten.push({ regel: regel.regel, stapcode: regel.stapcode, code: regel.code, naam: regel.naam, actie: "fout", wijzigingen: [], fout: problemen.join("; ") });
    else regels.push(regel);
  }
  return { regels, fouten };
}

async function sjabloonInlezen(bestand: File, terugNaar: string) {
  const actueel = vastHouden();
  toon(kop("Sjabloon inlezen"), laden());
  let regels: ImportRegel[], fouten: ImportUitkomst[], antwoord: ImportAntwoord | null = null;
  // Tweede blad (0.31.0): zonder dat blad (ouder sjabloon) blijven de grenzen per product zoals ze zijn.
  let grensRegels: GrensRegel[] | undefined, grensFouten: GrensUitkomst[] = [];
  try {
    const bladen = await leesXlsxBladen(bestand);
    const [eerste] = bladen.values();
    ({ regels, fouten } = leesSjabloon(bladen.get("Velden") ?? eerste));
    const gb = [...bladen.entries()].find(([n]) => n.trim().toLowerCase() === GRENZEN_BLAD.toLowerCase())?.[1];
    if (gb) ({ regels: grensRegels, fouten: grensFouten } = leesGrenzenBlad(gb));
    if (!fouten.length && !grensFouten.length && (regels.length || grensRegels))
      antwoord = await stuur<ImportAntwoord>("POST", "/beheer/velden/import", { uitvoeren: false, regels, ...(grensRegels ? { grenzen_per_product: grensRegels } : {}) });
  } catch (e) { return fout(e, "Sjabloon inlezen"); }
  if (!actueel()) return;
  const uitkomsten = antwoord?.regels ?? fouten;
  const grensUitkomsten = antwoord?.grenzen?.regels ?? grensFouten;
  const g = antwoord?.grenzen;
  const teOpslaan = antwoord ? antwoord.nieuw + antwoord.gewijzigd + (g ? g.nieuw + g.gewijzigd + g.weghalen : 0) : 0;
  const metFout = uitkomsten.some((x) => x.actie === "fout") || grensUitkomsten.some((x) => x.actie === "fout");
  const kanOpslaan = !!antwoord && !metFout && teOpslaan > 0;
  const WAT: Record<ImportUitkomst["actie"], string> = { nieuw: "Nieuw veld", wijzigen: "Wijzigen", gelijk: "Ongewijzigd", fout: "Fout" };
  const opslaan = async () => {
    try {
      const r = await stuur<ImportAntwoord>("POST", "/beheer/velden/import", { uitvoeren: true, regels, ...(grensRegels ? { grenzen_per_product: grensRegels } : {}) });
      const nFout = r.fouten + (r.grenzen?.fouten ?? 0);
      if (!r.uitgevoerd) { melding(`Niet opgeslagen: ${nFout} ${nFout === 1 ? "regel" : "regels"} met een fout. Lees het bestand opnieuw in.`, "fout"); return; }
      melding(`${r.nieuw} nieuw, ${r.gewijzigd} gewijzigd` + (r.grenzen ? `; grenzen per product: ${r.grenzen.nieuw} nieuw, ${r.grenzen.gewijzigd} gewijzigd, ${r.grenzen.weghalen} weggehaald` : ""), "ok");
      location.hash = `#/beheer/stappen/${terugNaar}`;
      void stappen(terugNaar);
    } catch (e) { melding((e as Error).message, "fout"); }
  };
  const volgorde = { fout: 0, nieuw: 1, wijzigen: 2, gelijk: 3 };
  toon(
    h("p", { class: "terug" }, h("a", { href: `#/beheer/stappen/${terugNaar}` }, "Terug naar stappen en velden")),
    kop("Sjabloon inlezen", `${bestand.name}. Dit is een controle: er is nog niets opgeslagen. Velden die niet in het bestand staan, blijven zoals ze zijn.` +
      (grensRegels ? ` Het blad "${GRENZEN_BLAD}" is wel de volledige lijst: zie onderaan.` : "")),
    h("div", { class: "tegels" },
      h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, antwoord?.nieuw ?? 0), h("span", { class: "tegel-tekst" }, "nieuwe velden")),
      h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, antwoord?.gewijzigd ?? 0), h("span", { class: "tegel-tekst" }, "velden gewijzigd")),
      h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, antwoord?.gelijk ?? 0), h("span", { class: "tegel-tekst" }, "ongewijzigd")),
      g ? h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, g.nieuw + g.gewijzigd + g.weghalen), h("span", { class: "tegel-tekst" }, "grenzen per product gewijzigd")) : null,
      h("div", { class: `tegel${metFout ? " let-op" : ""}` },
        h("span", { class: "tegel-getal" }, uitkomsten.filter((x) => x.actie === "fout").length + grensUitkomsten.filter((x) => x.actie === "fout").length),
        h("span", { class: "tegel-tekst" }, "regels met een fout"))),
    metFout
      ? h("p", { class: "afgekapt" }, "Er wordt niets opgeslagen zolang er een regel met een fout is. Pas het bestand aan en lees het opnieuw in.")
      : !teOpslaan ? h("p", { class: "leeg" }, regels.length || grensRegels ? "Alles in het bestand is al zo ingesteld." : "Het bestand bevat geen velden.") : null,
    h("div", { class: "knoppen", style: "justify-content:flex-start;margin-bottom:8px" },
      kanOpslaan ? h("button", { class: "knop knop-hoofd", type: "button", onclick: opslaan }, `${teOpslaan} ${teOpslaan === 1 ? "wijziging" : "wijzigingen"} opslaan`) : null,
      h("a", { class: "knop", href: `#/beheer/stappen/${terugNaar}` }, "Annuleren")),
    uitkomsten.length
      ? tabel(["Regel", "Stap", "Code", "Naam", "Wat", "Toelichting"], [...uitkomsten].sort((a, b) => volgorde[a.actie] - volgorde[b.actie] || a.regel - b.regel).map((x) => [
          h("span", { class: "getal" }, x.regel), x.stapcode, x.code ?? "", x.naam,
          h("span", { class: `label ${x.actie === "fout" ? "label-buiten_grens" : x.actie === "gelijk" ? "" : "label-ok"}` }, WAT[x.actie]),
          x.fout ?? (x.actie === "nieuw" ? "Krijgt deze code bij opslaan" : x.wijzigingen.join("; ")),
        ]), "compact")
      : null,
    grensRegels || grensFouten.length
      ? h("section", { class: "blok" },
          h("h2", {}, GRENZEN_BLAD),
          h("p", { class: "sub" }, "Dit blad is de volledige lijst met eigen grenzen per product. Wat er niet (meer) in staat, wordt weggehaald; voor dat product gelden dan de grenzen van het veld."),
          grensUitkomsten.length
            ? tabel(["Regel", "Veld", "Product", "Wat", "Toelichting"], [...grensUitkomsten]
                .sort((a, b) => GRENS_VOLGORDE[a.actie] - GRENS_VOLGORDE[b.actie] || a.regel - b.regel).map((x) => [
                  h("span", { class: "getal" }, x.regel || "–"), x.veld, x.product,
                  h("span", { class: `label ${x.actie === "fout" ? "label-buiten_grens" : x.actie === "weghalen" ? "label-buiten_tolerantie" : x.actie === "gelijk" ? "" : "label-ok"}` }, GRENS_WAT[x.actie]),
                  x.fout ?? (x.actie === "nieuw" ? "Eigen grenzen voor dit product" : x.wijzigingen.join("; ")),
                ]), "compact")
            : h("p", { class: "leeg" }, "Geen eigen grenzen per product."))
      : null,
  );
}
const GRENS_WAT: Record<GrensUitkomst["actie"], string> = { nieuw: "Nieuw", wijzigen: "Wijzigen", gelijk: "Ongewijzigd", weghalen: "Weghalen", fout: "Fout" };
const GRENS_VOLGORDE: Record<GrensUitkomst["actie"], number> = { fout: 0, weghalen: 1, nieuw: 2, wijzigen: 3, gelijk: 4 };

// ---------- Accounts ----------
interface Account { gebruikersnaam: string; rol: string; actief: boolean; naam?: string | null; gedeeld?: boolean; tijdelijk?: boolean }

export async function accounts() {
  const actueel = vastHouden();
  toon(kop("Accounts"), laden());
  let lijst: Account[];
  let namen: Operator[];
  try { [lijst, namen] = await Promise.all([haal<Account[]>("/beheer/gebruikers"), haal<Operator[]>("/beheer/operators")]); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const opnieuw = () => accounts();
  const vrijeNamen = namen.filter((o) => !o.account);
  const wachtwoord: VraagVeld = { naam: "wachtwoord", label: "Wachtwoord", type: "password", hint: "Minstens 8 tekens", controle: (w) => (w.length < 8 ? "Minstens 8 tekens" : null) };
  const toevoegen = async () => {
    const r = await vraag("Account toevoegen", [
      { naam: "gebruikersnaam", label: "Gebruikersnaam", hint: "Kleine letters, cijfers, punt of streepje",
        controle: (n) => (/^[a-z0-9._-]{3,40}$/.test(n) ? null : "Alleen kleine letters, cijfers, punt of streepje; 3 tot 40 tekens") },
      { naam: "rol", label: "Rol", opties: ROLLEN, waarde: "operator" },
      wachtwoord,
      { naam: "naam", label: "Naam bij de invoer (operator en ploegleider)", optioneel: true,
        hint: "Bijvoorbeeld Jan de Vries. Deze naam staat bij alles wat dit account invoert. Leeg = zelfde als de inlognaam." },
      { naam: "bestaandeNaam", label: "Of: bestaande naam uit de namenlijst", optioneel: true, waarde: "",
        opties: [["", "Geen, nieuwe naam"], ...vrijeNamen.map((o): [string, string] => [o.id, o.naam])],
        hint: "Kies dit als iemand al een naam heeft in de namenlijst; dan loopt zijn geschiedenis door." },
    ], "Account toevoegen", "Iedereen logt in met een eigen account (D53). Het wachtwoord is tijdelijk: bij de eerste inlog kiest de gebruiker een eigen wachtwoord (niet bij een wandscherm). Geef het persoonlijk door; het wordt alleen versleuteld bewaard.");
    if (!r) return;
    const invoer = r.rol === "operator" || r.rol === "ploegleider";
    const body = { gebruikersnaam: r.gebruikersnaam, rol: r.rol, wachtwoord: r.wachtwoord,
      ...(invoer && r.bestaandeNaam ? { bestaandeNaam: r.bestaandeNaam } : invoer && r.naam ? { naam: r.naam } : {}) };
    await wijzig(() => stuur("POST", "/beheer/gebruikers", body), `Account ${r.gebruikersnaam} toegevoegd`, opnieuw);
  };
  const zelf = sessie.naam;
  toon(
    kop("Accounts", "Iedereen logt in met een eigen account. Bij operators en ploegleiders staat de naam die bij hun invoer verschijnt. Veel accounts tegelijk: via het sjabloon.",
      h("div", { class: "knoppen-klein" },
        h("button", { class: "knop", type: "button", onclick: () => accountsSjabloon(lijst) }, "Sjabloon downloaden"),
        h("label", { class: "knop", for: "accounts-bestand" }, "Sjabloon inlezen"),
        h("input", { id: "accounts-bestand", type: "file", accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", class: "verborgen",
          onchange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void accountsInlezen(f); } }),
        h("button", { class: "knop knop-hoofd", onclick: toevoegen }, "Account toevoegen"))),
    lijst.some((a) => a.gedeeld && a.actief)
      ? h("p", { class: "proef-melding" }, h("strong", {}, "Gedeeld account nog actief. "),
          "Wie hiermee inlogt kiest zelf een naam; dat is fraudegevoelig (D53). Geef iedereen een eigen account en zet het gedeelde account uit zodra de invoerschermen niets meer te versturen hebben.")
      : null,
    tabel(["Gebruikersnaam", "Rol", "Naam bij de invoer", "Actief", ""], lijst.map((a) => [
      h("strong", { class: a.actief ? "" : "inactief" }, a.gebruikersnaam, a.gebruikersnaam === zelf ? h("span", { class: "noot" }, " (jij)") : "",
        a.tijdelijk ? h("span", { class: "noot" }, " · tijdelijk wachtwoord") : ""),
      rolNaam(a.rol),
      a.gedeeld ? h("span", { class: "plan-waarschuwing" }, h("span", { "aria-hidden": "true" }, "⚠ "), "Gedeeld: kiest een naam") : a.naam ?? (a.rol === "operator" || a.rol === "ploegleider" ? h("span", { class: "sub" }, "Bij eerste inlog: de gebruikersnaam") : ""),
      jaNee(a.actief),
      h("div", { class: "knoppen-klein" },
        h("button", { class: "knop knop-klein", disabled: a.gebruikersnaam === zelf, onclick: async () => {
          const r = await vraag(`Rol van ${a.gebruikersnaam}`, [{ naam: "rol", label: "Rol", opties: ROLLEN, waarde: a.rol }], "Opslaan");
          if (r) await wijzig(() => stuur("PATCH", `/beheer/gebruikers/${a.gebruikersnaam}`, { rol: r.rol }), "Rol opgeslagen", opnieuw);
        } }, "Rol wijzigen"),
        h("button", { class: "knop knop-klein", onclick: async () => {
          const r = await vraag(`Nieuw wachtwoord voor ${a.gebruikersnaam}`, [wachtwoord], "Opslaan");
          if (r) await wijzig(() => stuur("PATCH", `/beheer/gebruikers/${a.gebruikersnaam}`, { wachtwoord: r.wachtwoord }), a.rol === "scherm" ? "Wachtwoord ingesteld" : "Tijdelijk wachtwoord ingesteld", opnieuw);
        } }, "Wachtwoord instellen"),
        h("button", { class: "knop knop-klein knop-stil", disabled: a.gebruikersnaam === zelf, onclick: async () => {
          if (a.actief && !(await bevestig(`${a.gebruikersnaam} uitzetten?`, "Dit account kan daarna niet meer inloggen. Alles wat het heeft ingevoerd blijft bewaard.", "Uitzetten", true))) return;
          await wijzig(() => stuur("PATCH", `/beheer/gebruikers/${a.gebruikersnaam}`, { actief: !a.actief }), a.actief ? "Account uitgezet" : "Account weer actief", opnieuw);
        } }, a.actief ? "Uitzetten" : "Weer aanzetten")),
    ])),
  );
}

// ---------- Accounts via een Excel-sjabloon (#76, D61) ----------
const ACCOUNT_KOPPEN = ["Gebruikersnaam", "Rol", "Naam bij de invoer", "Tijdelijk wachtwoord", "Actief"];
interface AccountRegel { regel: number; gebruikersnaam: string; rol: string; naam: string | null; wachtwoord: string | null; actief: boolean }
interface AccountUitkomst { regel: number; gebruikersnaam: string; actie: "nieuw" | "wijzigen" | "gelijk" | "fout"; wijzigingen: string[]; fout: string | null }
interface AccountAntwoord { uitgevoerd: boolean; nieuw: number; gewijzigd: number; gelijk: number; fouten: number; regels: AccountUitkomst[] }

function accountsSjabloon(lijst: Account[]) {
  // Nooit wachtwoorden in het bestand: die kolom is leeg; vul hem alleen voor nieuwe accounts of een nieuw tijdelijk wachtwoord.
  const rijen = lijst.filter((a) => !a.gedeeld).map((a) => [a.gebruikersnaam, rolNaam(a.rol), a.naam ?? "", "", a.actief ? "ja" : "nee"]);
  downloadXlsx(xlsxBladen([{ naam: "Accounts", koppen: ACCOUNT_KOPPEN, rijen }]), `Accounts ${vandaag()}.xlsx`);
}

/** Rol uit een cel: de code (operator) of de naam zoals in het scherm (Ploegleider, Analist (alleen lezen)). */
function rolUitCel(t: string): string | null {
  const k = t.trim().toLowerCase();
  const r = ROLLEN.find(([code, naam]) => code === k || naam.toLowerCase() === k || naam.replace(/ \(.*\)/, "").toLowerCase() === k);
  return r ? r[0] : null;
}

function leesAccountSjabloon(rijen: Cel[][]): { regels: AccountRegel[]; fouten: AccountUitkomst[] } {
  const kop = (rijen[0] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
  const kolom = (naam: string) => kop.indexOf(naam.toLowerCase());
  const ontbreekt = ["Gebruikersnaam", "Rol"].filter((k) => kolom(k) < 0);
  if (ontbreekt.length) throw new Error(`Kolom ${ontbreekt.join(", ")} ontbreekt. Gebruik het sjabloon dat je hier downloadt.`);
  const regels: AccountRegel[] = [], fouten: AccountUitkomst[] = [];
  for (let i = 1; i < rijen.length; i++) {
    const r = rijen[i] ?? [];
    if (r.every((c) => c === null || c === "")) continue;
    const tekst = (naam: string) => { const c = kolom(naam) >= 0 ? r[kolom(naam)] ?? null : null; return c === null ? null : String(c).trim() || null; };
    const problemen: string[] = [];
    const gebruikersnaam = (tekst("Gebruikersnaam") ?? "").toLowerCase();
    const rolTekst = tekst("Rol") ?? "";
    const rol = rolUitCel(rolTekst);
    if (!gebruikersnaam) problemen.push("Gebruikersnaam ontbreekt");
    if (!rol) problemen.push(rolTekst ? `Onbekende rol "${rolTekst}"` : "Rol ontbreekt");
    const wwCel = kolom("Tijdelijk wachtwoord") >= 0 ? r[kolom("Tijdelijk wachtwoord")] : null;
    if (wwCel !== null && wwCel !== "" && String(wwCel).length < 8) problemen.push("Het wachtwoord moet minstens 8 tekens hebben");
    const act = (tekst("Actief") ?? "ja").toLowerCase();
    if (!["ja", "nee", "j", "n", "x", "1", "0", "waar", "onwaar", "true", "false"].includes(act)) problemen.push(`Actief "${act}" is geen ja of nee`);
    // Een wachtwoord dat Excel als getal opslaat (alleen cijfers), wordt gewoon tekst.
    const ww = kolom("Tijdelijk wachtwoord") >= 0 ? r[kolom("Tijdelijk wachtwoord")] : null;
    const regel: AccountRegel = {
      regel: i + 1, gebruikersnaam, rol: rol ?? rolTekst, naam: tekst("Naam bij de invoer"),
      wachtwoord: ww === null || ww === "" ? null : String(ww), actief: !["nee", "n", "0", "onwaar", "false"].includes(act),
    };
    if (problemen.length) fouten.push({ regel: regel.regel, gebruikersnaam, actie: "fout", wijzigingen: [], fout: problemen.join("; ") });
    else regels.push(regel);
  }
  return { regels, fouten };
}

async function accountsInlezen(bestand: File) {
  const actueel = vastHouden();
  toon(kop("Accounts inlezen"), laden());
  let regels: AccountRegel[], fouten: AccountUitkomst[], antwoord: AccountAntwoord | null = null;
  try {
    const bladen = await leesXlsxBladen(bestand);
    const [eerste] = bladen.values();
    ({ regels, fouten } = leesAccountSjabloon(bladen.get("Accounts") ?? eerste));
    if (!fouten.length && regels.length) antwoord = await stuur<AccountAntwoord>("POST", "/beheer/gebruikers/import", { uitvoeren: false, regels });
  } catch (e) { return fout(e, "Accounts inlezen"); }
  if (!actueel()) return;
  const uitkomsten = antwoord?.regels ?? fouten;
  const metFout = uitkomsten.some((x) => x.actie === "fout");
  const teOpslaan = antwoord ? antwoord.nieuw + antwoord.gewijzigd : 0;
  const kanOpslaan = !!antwoord && !metFout && teOpslaan > 0;
  const WAT: Record<AccountUitkomst["actie"], string> = { nieuw: "Nieuw account", wijzigen: "Wijzigen", gelijk: "Ongewijzigd", fout: "Fout" };
  const volgorde = { fout: 0, nieuw: 1, wijzigen: 2, gelijk: 3 };
  const opslaan = async () => {
    try {
      const r = await stuur<AccountAntwoord>("POST", "/beheer/gebruikers/import", { uitvoeren: true, regels });
      if (!r.uitgevoerd) { melding(`Niet opgeslagen: ${r.fouten} ${r.fouten === 1 ? "regel" : "regels"} met een fout. Lees het bestand opnieuw in.`, "fout"); return; }
      melding(`${r.nieuw} ${r.nieuw === 1 ? "account" : "accounts"} aangemaakt, ${r.gewijzigd} gewijzigd`, "ok");
      void accounts();
    } catch (e) { melding((e as Error).message, "fout"); }
  };
  toon(
    // Het scherm staat al op #/beheer/accounts: terug gaat daarom met een knop, niet met een link naar hetzelfde adres.
    h("p", { class: "terug" }, h("button", { class: "link-knop", type: "button", onclick: () => void accounts() }, "Terug naar accounts")),
    kop("Accounts inlezen", `${bestand.name}. Dit is een controle: er is nog niets opgeslagen. Accounts die niet in het bestand staan, blijven zoals ze zijn.`),
    h("div", { class: "tegels" },
      h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, antwoord?.nieuw ?? 0), h("span", { class: "tegel-tekst" }, "nieuwe accounts")),
      h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, antwoord?.gewijzigd ?? 0), h("span", { class: "tegel-tekst" }, "accounts gewijzigd")),
      h("div", { class: "tegel" }, h("span", { class: "tegel-getal" }, antwoord?.gelijk ?? 0), h("span", { class: "tegel-tekst" }, "ongewijzigd")),
      h("div", { class: `tegel${metFout ? " let-op" : ""}` }, h("span", { class: "tegel-getal" }, uitkomsten.filter((x) => x.actie === "fout").length), h("span", { class: "tegel-tekst" }, "regels met een fout"))),
    metFout
      ? h("p", { class: "afgekapt" }, "Er wordt niets opgeslagen zolang er een regel met een fout is. Pas het bestand aan en lees het opnieuw in.")
      : !teOpslaan ? h("p", { class: "leeg" }, regels.length ? "Alles in het bestand is al zo ingesteld." : "Het bestand bevat geen accounts.") : null,
    h("p", { class: "proef-melding" }, h("strong", {}, "Wachtwoorden in het bestand. "),
      "Een wachtwoord uit het bestand is tijdelijk: bij de eerste inlog kiest iedereen een eigen wachtwoord. Geef ze persoonlijk door en gooi het bestand daarna weg."),
    h("div", { class: "knoppen", style: "justify-content:flex-start;margin-bottom:8px" },
      kanOpslaan ? h("button", { class: "knop knop-hoofd", type: "button", onclick: opslaan }, `${teOpslaan} ${teOpslaan === 1 ? "wijziging" : "wijzigingen"} opslaan`) : null,
      h("button", { class: "knop", type: "button", onclick: () => void accounts() }, "Annuleren")),
    uitkomsten.length
      ? tabel(["Regel", "Gebruikersnaam", "Wat", "Toelichting"], [...uitkomsten].sort((a, b) => volgorde[a.actie] - volgorde[b.actie] || a.regel - b.regel).map((x) => [
          h("span", { class: "getal" }, x.regel), x.gebruikersnaam,
          h("span", { class: `label ${x.actie === "fout" ? "label-buiten_grens" : x.actie === "gelijk" ? "" : "label-ok"}` }, WAT[x.actie]),
          x.fout ?? x.wijzigingen.join("; "),
        ]), "compact")
      : null,
  );
}

// ---------- Operators ----------
interface Operator { id: string; naam: string; actief: boolean; account?: string | null }

export async function operators() {
  const actueel = vastHouden();
  toon(kop("Operators"), laden());
  let lijst: Operator[];
  try { lijst = await haal<Operator[]>("/beheer/operators"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const opnieuw = () => operators();
  toon(
    kop("Operators", "Alle namen die bij invoer kunnen staan. Een naam met een eigen account hoort bij die persoon (D53); namen zonder account zijn nog te kiezen met het oude gedeelde account. Een nieuwe persoon voeg je toe bij Accounts.",
      h("button", { class: "knop knop-hoofd", onclick: async () => {
        const r = await vraag("Operator toevoegen", [{ naam: "naam", label: "Naam" }], "Toevoegen");
        if (r) await wijzig(() => stuur("POST", "/beheer/operators", r), `${r.naam} toegevoegd`, opnieuw);
      } }, "Operator toevoegen")),
    tabel(["Naam", "Eigen account", "Actief", ""], lijst.map((o) => [
      h("strong", { class: o.actief ? "" : "inactief" }, o.naam), o.account ?? h("span", { class: "sub" }, "Geen"), jaNee(o.actief),
      h("div", { class: "knoppen-klein" },
        h("button", { class: "knop knop-klein", onclick: async () => {
          const r = await vraag("Naam wijzigen", [{ naam: "naam", label: "Naam", waarde: o.naam }], "Opslaan", "Eerdere registraties tonen daarna ook de nieuwe naam.");
          if (r) await wijzig(() => stuur("PATCH", `/beheer/operators/${o.id}`, { naam: r.naam }), "Naam opgeslagen", opnieuw);
        } }, "Naam wijzigen"),
        h("button", { class: "knop knop-klein knop-stil", onclick: () =>
          wijzig(() => stuur("PATCH", `/beheer/operators/${o.id}`, { actief: !o.actief }), o.actief ? `${o.naam} staat niet meer in de lijst` : `${o.naam} weer in de lijst`, opnieuw, () => stuur("PATCH", `/beheer/operators/${o.id}`, { actief: o.actief })) },
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
              await wijzig(() => stuur("PATCH", `/beheer/grondstoffen/${encodeURIComponent(g.code)}`, { actief: !g.actief }), g.actief ? `${g.code} uitgezet` : `${g.code} weer actief`, opnieuw, () => stuur("PATCH", `/beheer/grondstoffen/${encodeURIComponent(g.code)}`, { actief: g.actief }));
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
          wijzig(() => stuur("PATCH", `/overdracht/ploegen/${p.code}`, { actief: !p.actief }), p.actief ? `${p.naam} uitgezet` : `${p.naam} weer actief`, ploegen, () => stuur("PATCH", `/overdracht/ploegen/${p.code}`, { actief: p.actief })) },
          p.actief ? "Uitzetten" : "Weer aanzetten")),
    ]), "compact"),
  );
}

// ---------- Oorzaken van stilstand ----------
interface Oorzaak { code: string; naam: string; categorie: string; actief: boolean }
const CATEGORIEEN: [string, string][] = [["storing", "Storing (ploegleider krijgt een melding)"], ["wachten", "Wachten"], ["gepland", "Gepland (telt niet mee voor de beschikbaarheid)"], ["overig", "Overig"]];

export async function oorzaken() {
  const actueel = vastHouden();
  toon(kop("Oorzaken van stilstand"), laden());
  let lijst: Oorzaak[];
  try { lijst = await haal<Oorzaak[]>("/stilstand/oorzaken?ookInactief=true"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const soort = (c: string) => CATEGORIEEN.find(([k]) => k === c)?.[1].replace(/ \(.*\)/, "") ?? c;
  toon(
    kop("Oorzaken van stilstand", "De keuzelijst als een operator stilstand meldt. Geplande stilstand (omstellen, schoonmaken, onderhoud) telt niet mee als verlies.",
      h("button", { class: "knop knop-hoofd", onclick: async () => {
        const r = await vraag("Oorzaak toevoegen", [
          { naam: "code", label: "Code", hint: "Kort, zonder spaties. Ligt daarna vast.", controle: (v) => (/^[A-Za-z0-9._-]{1,20}$/.test(v) ? null : "Alleen letters, cijfers, punt en streepjes; hoogstens 20 tekens") },
          { naam: "naam", label: "Naam" },
          { naam: "categorie", label: "Soort", opties: CATEGORIEEN },
        ], "Toevoegen");
        if (r) await wijzig(() => stuur("POST", "/stilstand/oorzaken", r), `${r.naam} toegevoegd`, oorzaken);
      } }, "Oorzaak toevoegen")),
    tabel(["Code", "Naam", "Soort", ""], lijst.map((o) => [
      h("strong", { class: o.actief ? "" : "inactief" }, o.code), h("span", { class: o.actief ? "" : "inactief" }, o.naam, o.actief ? "" : " (uit)"), soort(o.categorie),
      h("div", { class: "knoppen-klein" },
        o.actief ? h("button", { class: "knop knop-klein", onclick: async () => {
          const r = await vraag(`${o.code} wijzigen`, [{ naam: "naam", label: "Naam", waarde: o.naam }, { naam: "categorie", label: "Soort", opties: CATEGORIEEN, waarde: o.categorie }], "Opslaan");
          if (r) await wijzig(() => stuur("PATCH", `/stilstand/oorzaken/${encodeURIComponent(o.code)}`, r), "Opgeslagen", oorzaken);
        } }, "Wijzigen") : null,
        h("button", { class: "knop knop-klein knop-stil", onclick: () =>
          wijzig(() => stuur("PATCH", `/stilstand/oorzaken/${encodeURIComponent(o.code)}`, { actief: !o.actief }), o.actief ? `${o.naam} uitgezet` : `${o.naam} weer actief`, oorzaken, () => stuur("PATCH", `/stilstand/oorzaken/${encodeURIComponent(o.code)}`, { actief: o.actief })) },
          o.actief ? "Uitzetten" : "Weer aanzetten")),
    ]), "compact"),
  );
}

// ---------- Bedrijfsgegevens (certificaat) ----------
export async function bedrijf() {
  const actueel = vastHouden();
  toon(kop("Bedrijfsgegevens"), laden());
  let b: { bedrijfsnaam: string; bedrijfsadres: string; certificaat_verklaring: string };
  try { b = await haal("/certificaten/instellingen"); } catch (e) { return fout(e); }
  if (!actueel()) return;
  const naam = h("input", { id: "b-naam", value: b.bedrijfsnaam, maxlength: 120 }) as HTMLInputElement;
  const adres = h("input", { id: "b-adres", value: b.bedrijfsadres, maxlength: 300 }) as HTMLInputElement;
  const tekst = h("textarea", { id: "b-tekst", rows: 4, maxlength: 1500 }, b.certificaat_verklaring) as HTMLTextAreaElement;
  toon(
    kop("Bedrijfsgegevens", "Staan bovenaan het certificaat per lot. Welke kenmerken erop komen, kies je per veld bij Stappen en velden."),
    h("section", { class: "blok formulier-blok" },
      h("label", { for: "b-naam" }, "Bedrijfsnaam", naam),
      h("label", { for: "b-adres" }, "Adres", adres),
      h("label", { for: "b-tekst" }, "Verklaring op het certificaat", tekst),
      h("button", { class: "knop knop-hoofd", onclick: () => {
        if (!naam.value.trim()) return melding("Vul een bedrijfsnaam in", "fout");
        return wijzig(() => stuur("PUT", "/certificaten/instellingen", { bedrijfsnaam: naam.value, bedrijfsadres: adres.value, certificaat_verklaring: tekst.value }), "Opgeslagen", bedrijf);
      } }, "Opslaan")),
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
          wijzig(() => stuur("PATCH", `/beheer/pcs/${p.naam}`, { actief: !p.actief }), p.actief ? `${p.naam} uitgezet` : `${p.naam} weer actief`, opnieuw, () => stuur("PATCH", `/beheer/pcs/${p.naam}`, { actief: p.actief })) },
          p.actief ? "Uitzetten" : "Weer aanzetten")),
    ])),
  );
}

// ---------- Logboek ----------
interface Regel { tabel: string; actie: string; oud: Record<string, unknown> | null; nieuw: Record<string, unknown> | null; extra: Record<string, string> | null; gewijzigd_door: string; gewijzigd_op: string }

const ONDERDEEL: Record<string, string> = { processtap: "Stap", veld: "Veld", gebruiker: "Account", operator: "Operator", pc: "Pc", pc_stap: "Pc en stap", nalevering: "Nageleverd van papier" };
const KOLOM: Record<string, string> = {
  gemeten_door: "wie meet", naam: "naam", eenheid: "eenheid", grens_min: "ondergrens", grens_max: "bovengrens", tolerantie: "tolerantie", tolerantie_soort: "tolerantie in", decimalen: "decimalen",
  verplicht: "verplicht", actief: "actief", rol: "rol", locatie: "locatie", volgnummer: "volgorde", soort: "soort",
  wachtwoord_wijzigen: "tijdelijk wachtwoord",
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
  // Nageleverd van papier (#75): stap, nummer, wie, pc en reden.
  if (r.tabel === "nalevering") return { onderwerp: `${d.stap} ${d.nummer}`, wat: `Van papier, ${d.operator} op ${d.pc}: ${d.reden}` };
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
    afgekapt(regels.length, 300, "wijzigingen", "Kies een onderdeel om alles daarvan te zien."),
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
  testaccounts?: string[];
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
  const test = s.testaccounts?.length
    ? h("p", { class: "sub testaccounts" }, `Testomgeving: ${s.testaccounts.length} testaccount${s.testaccounts.length === 1 ? "" : "s"} met wachtwoord "demo" (${s.testaccounts.join(", ")}). Prima met fictieve testdata; zet ze uit voordat er echte gegevens in komen.`)
    : null;
  toon(
    kop("Server", "Versie, database, back-ups en hersteltests. De back-ups en hersteltests maakt de server zelf volgens het schema van IT."),
    meldingen,
    test,
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

// ---------- Opmerkingen uit "Iets melden" (#78, D62) ----------
interface Terugmelding {
  id: string; gemeld_op: string; gebruikersnaam: string; naam: string | null; pc: string | null; stapcode: string | null;
  scherm: string | null; tekst: string; status: "open" | "afgehandeld"; afgehandeld_door: string | null; afgehandeld_op: string | null; notitie: string | null;
}
let opmerkingenAlle = false;

export async function opmerkingen() {
  const actueel = vastHouden();
  toon(kop("Opmerkingen"), laden());
  let lijst: Terugmelding[];
  try { lijst = await haal<Terugmelding[]>(`/terugmeldingen?status=${opmerkingenAlle ? "alle" : "open"}`); } catch (e) { return fout(e, "Opmerkingen"); }
  if (!actueel()) return;
  const afhandelen = async (t: Terugmelding) => {
    const r = await vraag("Afhandelen", [{ naam: "notitie", label: "Notitie", optioneel: true, maxLengte: 500,
      hint: "Bijvoorbeeld het roadmapnummer, of wat er gedaan is" }], "Afhandelen", `"${t.tekst}"`);
    if (r) await wijzig(() => stuur("POST", `/terugmeldingen/${t.id}/afhandelen`, { notitie: r.notitie || null }), "Afgehandeld", opmerkingen);
  };
  const keuze = h("label", { class: "filter-vink", for: "opm-alle" },
    h("input", { id: "opm-alle", type: "checkbox", checked: opmerkingenAlle, onchange: (e: Event) => { opmerkingenAlle = (e.target as HTMLInputElement).checked; void opmerkingen(); } }),
    " Ook afgehandelde");
  toon(
    kop("Opmerkingen", "Wat gebruikers via \"Iets melden\" doorgaven, nieuwste eerst. Handel af met een notitie, bijvoorbeeld het roadmapnummer."),
    h("div", { class: "filters" }, keuze),
    lijst.length
      ? tabel(["Wanneer", "Wie", "Waar", "Melding", "Stand"], lijst.map((t) => [
          datum(t.gemeld_op),
          t.naam ? `${t.naam} (${t.gebruikersnaam})` : t.gebruikersnaam,
          [t.pc, t.stapcode, t.stapcode ? null : t.scherm].filter(Boolean).join(", "),
          t.tekst,
          t.status === "open"
            ? h("button", { class: "knop knop-klein", type: "button", onclick: () => void afhandelen(t) }, "Afhandelen")
            : h("span", { class: "sub" }, `Afgehandeld door ${t.afgehandeld_door}${t.notitie ? `: ${t.notitie}` : ""}`),
        ]))
      : h("p", { class: "leeg" }, opmerkingenAlle ? "Er is nog niets gemeld." : "Er staat niets open."),
  );
}
