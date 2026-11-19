// Stappenoverzicht en het werk binnen één stap.
import { ApiFout, GeenVerbinding, haal, nieuwId, stuur } from "../api";
import { sessie } from "../sessie";
import { lokaleRegistraties, maakLot, nieuweBatch, startStap, stappen } from "../registraties";
import type { Overzicht, Registratie, Stap, Werkvoorraad } from "../types";
import { bevestig, h, laden, melding, tijd, toon, vastHouden, vraag } from "../ui";
import { acties, voegToe } from "../wachtrij";
import { vorigeOverdrachtBlok } from "./overdracht";
import { zetScanActie } from "../scan";

/** Wat er lokaal al gebeurd is maar nog niet in de werkvoorraad van de server staat. */
async function lokaleAanpassingen() {
  const lijst = await acties();
  const gestart = new Set<string>(); // "PS3|B-2026-0001"
  const inLot = new Set<string>(); // batchnummers in een lot dat nog onderweg is
  for (const a of lijst) {
    const b = a.body as Record<string, unknown> | undefined;
    if (a.pad === "/registraties" && b) gestart.add(`${b.stapcode}|${b.batchnummer ?? b.lotnummer}`);
    if (a.pad === "/lots" && b) (b.batchnummers as string[]).forEach((n) => inLot.add(n));
  }
  return { gestart, inLot, lokaal: await lokaleRegistraties() };
}

function pasAan(stap: Stap, w: Werkvoorraad, l: Awaited<ReturnType<typeof lokaleAanpassingen>>): Werkvoorraad {
  const afgerondLokaal = new Set(l.lokaal.filter((r) => r.status === "afgerond").map((r) => r.id));
  const open = w.open.filter((r) => !afgerondLokaal.has(r.id));
  for (const r of l.lokaal) {
    if (r.stapcode === stap.code && r.status === "open" && !open.some((o) => o.id === r.id)) open.push(r);
  }
  const wachtend = w.wachtend.filter(
    (x) => !l.gestart.has(`${stap.code}|${x.nummer}`) && !(stap.is_lot_stap && l.inLot.has(x.nummer)),
  );
  return { open, wachtend };
}

export async function stappenScherm() {
  const actueel = vastHouden();
  toon(h("h1", {}, "Kies een stap"), laden());
  const [{ data: alle }, overzicht, l, overdracht] = await Promise.all([
    haal<Stap[]>("/config/stappen?voorDezePc=true"),
    haal<Overzicht[]>("/werkvoorraad").catch(() => ({ data: [] as Overzicht[], vers: false })),
    lokaleAanpassingen(),
    vorigeOverdrachtBlok(),
  ]);
  if (!actueel()) return;

  const tegel = (s: Stap) => {
    const o = overzicht.data.find((x) => x.stapcode === s.code);
    const lokaalOpen = l.lokaal.filter((r) => r.stapcode === s.code && r.status === "open").length;
    const open = (o?.open ?? 0) + lokaalOpen;
    const wachtend = o?.wachtend ?? 0;
    return h(
      "a",
      { class: open > 0 ? "tegel bezig" : "tegel", href: `#/stap/${s.code}` },
      h("span", { class: "tegel-nr" }, s.volgorde),
      h("span", { class: "tegel-naam" }, s.naam),
      h(
        "span",
        { class: "tegel-werk" },
        open > 0 ? h("b", {}, `${open} bezig`) : null,
        open > 0 && wachtend > 0 ? ", " : null,
        wachtend > 0 ? `${wachtend} klaar` : null,
        open === 0 && wachtend === 0 ? "Niets klaar" : null,
      ),
    );
  };

  const batch = alle.filter((s) => s.niveau === "batch");
  const lot = alle.filter((s) => s.niveau === "lot");
  toon(
    h("div", { class: "kop" }, h("h1", {}, "Kies een stap"), overzicht.vers ? null : h("span", { class: "label label-wacht" }, "Laatst bekende stand")),
    overdracht,
    batch.length ? h("h2", {}, "Per batch") : null,
    batch.length ? h("div", { class: "route" }, batch.map(tegel)) : null,
    lot.length ? h("h2", {}, "Per lot") : null,
    lot.length ? h("div", { class: "route lot" }, lot.map(tegel)) : null,
  );
}

// ---------- Stilstand ----------
interface Stilstand { id: string; stap: string; oorzaaknaam: string; categorie: string; toelichting: string | null; begin_op: string; wacht?: boolean }
interface Oorzaak { code: string; naam: string; categorie: string }

/** Lopende stilstand van deze stap: van de server, aangevuld met wat deze pc nog moet versturen. */
async function lopendeStilstand(code: string): Promise<Stilstand | null> {
  let lijst: Stilstand[] = [];
  try { lijst = (await haal<Stilstand[]>("/stilstand")).data; } catch { /* zonder verbinding en zonder bewaarde lijst */ }
  const wacht = await acties();
  const beeindigd = new Set(wacht.filter((a) => /^\/stilstand\/[^/]+\/einde$/.test(a.pad)).map((a) => a.pad.split("/")[2]));
  for (const a of wacht) {
    const b = a.body as { id: string; stapcode: string; oorzaak: string; oorzaaknaam?: string; toelichting: string | null; begin_op: string } | undefined;
    if (a.pad === "/stilstand" && b && !lijst.some((x) => x.id === b.id)) {
      lijst.push({ id: b.id, stap: b.stapcode, oorzaaknaam: b.oorzaaknaam ?? b.oorzaak, categorie: "", toelichting: b.toelichting, begin_op: b.begin_op, wacht: true });
    }
  }
  return lijst.find((x) => x.stap === code && !beeindigd.has(x.id)) ?? null;
}

async function stilstandMelden(s: Stap, opnieuw: () => void) {
  let oorzaken: Oorzaak[];
  try { oorzaken = (await haal<Oorzaak[]>("/stilstand/oorzaken")).data; } catch { return melding("De lijst met oorzaken is niet beschikbaar zonder verbinding", "fout"); }
  const groep: Record<string, string> = { storing: "Storing", wachten: "Wachten", gepland: "Gepland", overig: "Overig" };
  const r = await vraag(`Stilstand in ${s.naam}`, [
    { naam: "oorzaak", label: "Oorzaak", opties: oorzaken.map((o): [string, string] => [o.code, `${groep[o.categorie] ?? o.categorie}: ${o.naam}`]) },
    { naam: "toelichting", label: "Toelichting", optioneel: true, hint: "Bijvoorbeeld welke machine of wat er gebeurt" },
  ], "Stilstand melden", "De stilstand loopt vanaf nu tot je hem beëindigt. Bij een storing krijgt de ploegleider een melding.");
  if (!r) return;
  const o = oorzaken.find((x) => x.code === r.oorzaak)!;
  await voegToe({
    omschrijving: `Stilstand ${s.code}: ${o.naam}`,
    methode: "POST",
    pad: "/stilstand",
    body: { id: nieuwId(), stapcode: s.code, oorzaak: o.code, oorzaaknaam: o.naam, toelichting: r.toelichting || null, begin_op: new Date().toISOString() },
  });
  melding("Stilstand gemeld", "ok");
  opnieuw();
}

function stilstandBlok(st: Stilstand, s: Stap, magMelden: boolean, opnieuw: () => void) {
  const minuten = Math.max(0, Math.round((Date.now() - Date.parse(st.begin_op)) / 60000));
  return h("section", { class: "stilstand-blok", role: "status" },
    h("div", {},
      h("h2", {}, `⛔ Stilstand: ${st.oorzaaknaam}`),
      h("p", {}, `Sinds ${tijd(st.begin_op)} (${minuten < 60 ? `${minuten} min` : `${Math.floor(minuten / 60)} u ${minuten % 60} min`})`, st.toelichting ? `. ${st.toelichting}` : ""),
      st.wacht ? h("span", { class: "label label-wacht" }, "Nog niet verstuurd") : null),
    magMelden
      ? h("button", { class: "knop knop-hoofd", onclick: async () => {
          if (!(await bevestig("Stilstand beëindigen?", `${s.naam} kan weer verder.`, "Beëindigen"))) return;
          await voegToe({ omschrijving: `Stilstand ${s.code} beëindigd`, methode: "POST", pad: `/stilstand/${st.id}/einde`, body: { eind_op: new Date().toISOString() } });
          melding("Stilstand beëindigd", "ok");
          opnieuw();
        } }, "Stilstand beëindigen")
      : null);
}

// ---------- Planning ----------
interface PlanItem { soort: "batch" | "lot" | "voorstel"; nummer: string; volgorde: number; opmerking: string | null; status: "gepland" | "bezig" | "gedaan"; batches: string[] }
interface Voorstel { nummer: number; opmerking: string | null; batches: { batchnummer: string }[] }

/** Planning van vandaag voor deze stap; zonder verbinding de laatst bekende, en anders niets. */
async function planVandaag(code: string): Promise<PlanItem[]> {
  try { return (await haal<PlanItem[]>(`/planning/vandaag?stap=${code}`)).data; } catch { return []; }
}
async function openVoorstellen(): Promise<Voorstel[]> {
  try { return (await haal<Voorstel[]>("/planning/lotvoorstellen")).data; } catch { return []; }
}
const STAND: Record<PlanItem["status"], string> = { gepland: "Nog doen", bezig: "Bezig", gedaan: "Gedaan" };

function planBlok(plan: PlanItem[]): Node | null {
  if (!plan.length) return null;
  return h("section", { class: "plan" },
    h("h2", {}, "Gepland voor vandaag"),
    h("ol", { class: "planlijst" }, plan.map((p) =>
      h("li", { class: `plan-${p.status}` },
        h("span", { class: "plan-nr" }, p.volgorde),
        h("span", { class: "plan-naam" }, p.soort === "voorstel" ? `Lotvoorstel ${p.nummer}` : p.nummer,
          p.batches.length ? h("span", { class: "rij-info" }, ` ${p.batches.join(", ")}`) : null,
          p.opmerking ? h("span", { class: "rij-info plan-opmerking" }, p.opmerking) : null),
        h("span", { class: "plan-stand" }, STAND[p.status])))));
}

function regRij(r: Registratie) {
  return h(
    "li",
    {},
    h(
      "a",
      { class: "rij", href: `#/reg/${r.id}` },
      h(
        "div",
        {},
        h("div", { class: "rij-hoofd" }, r.batchnummer ?? r.lotnummer),
        h(
          "div",
          { class: "rij-info" },
          `${r.operator}, gestart ${tijd(r.gestart_op)}`,
          r.poging && r.poging > 1 ? `, poging ${r.poging}` : "",
          r.herbewerking_start ? `, herbewerking: ${r.reden}` : "",
        ),
      ),
      r.lokaal ? h("span", { class: "label label-wacht" }, "Nog niet verstuurd") : h("span", { class: "knop knop-klein" }, "Verder invullen"),
    ),
  );
}

export async function stapScherm(code: string) {
  const actueel = vastHouden();
  toon(h("h1", {}, code), laden());
  const s = (await stappen()).find((x) => x.code === code);
  if (!s) {
    toon(h("h1", {}, "Onbekende stap"), h("a", { href: "#/stappen" }, "Terug naar de stappen"));
    return;
  }
  let w: Werkvoorraad;
  let vers = true;
  try {
    const r = await haal<Werkvoorraad>(`/werkvoorraad/${code}`);
    w = r.data;
    vers = r.vers;
  } catch {
    w = { open: [], wachtend: [] };
    vers = false;
  }
  w = pasAan(s, w, await lokaleAanpassingen());
  const [plan, voorstellen, stil] = await Promise.all([planVandaag(code), s.is_lot_stap ? openVoorstellen() : Promise.resolve([]), lopendeStilstand(code)]);
  // Wat vandaag gepland is eerst, in de volgorde van de planning.
  const plek = new Map(plan.map((p) => [p.nummer, p.volgorde]));
  w.wachtend.sort((a, b) => (plek.get(a.nummer) ?? 1e6) - (plek.get(b.nummer) ?? 1e6));
  const eersteBatchStap = (await stappen()).filter((x) => x.niveau === "batch")[0]?.code;
  if (!actueel()) return;

  const opVloer = sessie.rol === "operator" || sessie.rol === "ploegleider";
  const opnieuw = () => void stapScherm(code);
  const kop = h(
    "div",
    { class: "kop" },
    h("div", {}, h("h1", {}, s.naam), h("p", { class: "sub" }, s.is_lot_stap ? "Hier worden 4 batches één lot." : s.niveau === "batch" ? "Per batch" : "Per lot")),
    h("div", { class: "kop-rechts" },
      vers ? null : h("span", { class: "label label-wacht" }, "Laatst bekende stand"),
      opVloer && !stil ? h("button", { class: "knop", onclick: () => stilstandMelden(s, opnieuw) }, "Stilstand melden") : null),
  );

  const bezig = [
    h("h2", {}, "Bezig"),
    w.open.length ? h("ul", { class: "lijst" }, w.open.map(regRij)) : h("p", { class: "leeg" }, "Er staat niets open in deze stap."),
  ];

  // Alleen operators en ploegleiders voeren in; andere rollen kijken mee.
  const kanInvoeren = sessie.rol === "operator" || sessie.rol === "ploegleider";
  let klaar: Node[];
  if (s.is_lot_stap && kanInvoeren) klaar = lotSamenstellen(s, w, voorstellen);
  else {
    const eerste = eersteBatchStap === s.code;
    klaar = [
      h("h2", {}, s.is_lot_stap ? "Batches klaar voor een lot" : "Klaar om te starten"),
      w.wachtend.length
        ? h(
            "ul",
            { class: "lijst" },
            w.wachtend.map((x) =>
              h(
                "li",
                { class: "rij" },
                h("div", {}, h("div", { class: "rij-hoofd" }, x.nummer, plek.has(x.nummer) ? h("span", { class: "label label-plan" }, `Gepland, nr ${plek.get(x.nummer)}`) : null),
                  h("div", { class: "rij-info" }, eerste ? "Nog niet gestart" : x.sinds ? `Klaar sinds ${tijd(x.sinds)}` : "")),
                !kanInvoeren ? null : h(
                  "button",
                  {
                    class: "knop knop-hoofd",
                    onclick: async () => {
                      const reg = await startStap(s.code, x.soort === "batch" ? { batchnummer: x.nummer } : { lotnummer: x.nummer });
                      location.hash = `#/reg/${reg.id}`;
                    },
                  },
                  "Start",
                ),
              ),
            ),
          )
        : h("p", { class: "leeg" }, eerste ? "Er staan geen geplande batches klaar. Vraag de planner, of maak als uitzondering een ongeplande batch." : "Nog niets klaar voor deze stap."),
      eerste && kanInvoeren
        ? h("details", { class: "uitzondering" },
            h("summary", {}, "Ongeplande batch aanmaken (uitzondering)"),
            h("p", { class: "sub" }, "Alleen als een batch niet in de planning staat. De planner ziet hem als niet gepland."),
            nieuweBatchVorm(s))
        : null,
    ].filter(Boolean) as Node[];
  }
  toon(kop, stil ? stilstandBlok(stil, s, opVloer, opnieuw) : null, planBlok(plan), ...bezig, ...klaar);

  // Handscanner: een batch die bezig is openen, een batch die klaarstaat starten (of in de lot-stap aanvinken).
  zetScanActie(async (code) => {
    const open = w.open.find((r) => (r.batchnummer ?? r.lotnummer) === code);
    if (open) { location.hash = `#/reg/${open.id}`; return; }
    const x = w.wachtend.find((y) => y.nummer === code);
    if (!x) { melding(`${code} staat niet klaar in ${s.naam}`, "fout"); return; }
    if (!kanInvoeren) { melding(`${code} staat klaar in ${s.naam}`, "info"); return; }
    if (s.is_lot_stap) {
      const vink = document.querySelector<HTMLInputElement>(`input[type=checkbox][value="${CSS.escape(code)}"]`);
      if (vink) { vink.checked = !vink.checked; vink.dispatchEvent(new Event("change")); melding(`${code} ${vink.checked ? "gekozen" : "niet meer gekozen"}`, "info"); }
      return;
    }
    const reg = await startStap(s.code, x.soort === "batch" ? { batchnummer: x.nummer } : { lotnummer: x.nummer });
    melding(`${code} gestart`, "ok");
    location.hash = `#/reg/${reg.id}`;
  });
}

/** Met verbinding meteen controleren of een nummer al bestaat; zonder verbinding controleert de server later. */
async function bestaatAl(pad: string): Promise<boolean> {
  try {
    await stuur("GET", pad);
    return true;
  } catch (e) {
    if (e instanceof GeenVerbinding || (e instanceof ApiFout && e.status === 404)) return false;
    return false;
  }
}

function nieuweBatchVorm(s: Stap) {
  const nr = h("input", {
    id: "nieuw-batch", type: "text", class: "breed", placeholder: "B-2026-0001", autocomplete: "off",
    pattern: "B-[0-9]{4}-[0-9]{4}", required: true, title: "Formaat: B-jaar-volgnummer, bv. B-2026-0001",
  }) as HTMLInputElement;
  return h(
    "form",
    {
      class: "nieuw",
      novalidate: true,
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const nummer = nr.value.trim().toUpperCase();
        nr.value = nummer;
        if (!nr.reportValidity()) return;
        if (await bestaatAl(`/batches/${nummer}`)) return melding(`Batch ${nummer} bestaat al`, "fout");
        const reg = await nieuweBatch(nummer, s.code);
        location.hash = `#/reg/${reg.id}`;
      },
    },
    h("label", { for: "nieuw-batch" }, "Nieuwe batch", nr),
    h("button", { class: "knop knop-hoofd", type: "submit" }, "Aanmaken en starten"),
  );
}

function lotSamenstellen(s: Stap, w: Werkvoorraad, voorstellen: Voorstel[]): Node[] {
  const gekozen = new Set<string>();
  const lotnr = h("input", {
    id: "nieuw-lot", type: "text", class: "breed", placeholder: "L-2026-0001", autocomplete: "off",
    pattern: "L-[0-9]{4}-[0-9]{4}", required: true, title: "Formaat: L-jaar-volgnummer, bv. L-2026-0001",
  }) as HTMLInputElement;
  const teller = h("span", { class: "hint" }, "Kies 4 batches");
  const knop = h("button", { class: "knop knop-hoofd", disabled: true, type: "button" }, "Lot samenstellen") as HTMLButtonElement;

  const werkBij = () => {
    teller.textContent = gekozen.size === 4 ? "4 batches gekozen" : `${gekozen.size} van 4 batches gekozen`;
    knop.disabled = gekozen.size !== 4;
  };

  knop.addEventListener("click", async () => {
    lotnr.value = lotnr.value.trim().toUpperCase();
    if (!lotnr.reportValidity()) return;
    if (await bestaatAl(`/lots/${lotnr.value}`)) return melding(`Lot ${lotnr.value} bestaat al`, "fout");
    const batches = [...gekozen].sort();
    // Wijkt de keuze af van een lotvoorstel? Dan een reden vragen (de planner ziet die).
    const afwijkend = voorstellen.find((v) => v.batches.some((b) => gekozen.has(b.batchnummer)) &&
      v.batches.map((b) => b.batchnummer).sort().join() !== batches.join());
    let reden: string | undefined;
    if (afwijkend) {
      const r = await vraag(`Afwijken van lotvoorstel ${afwijkend.nummer}?`, [{ naam: "reden", label: "Reden", controle: (v) => (v.length < 3 ? "Geef een korte reden" : null) }],
        "Verder", `De planner stelde voor: ${afwijkend.batches.map((b) => b.batchnummer).join(", ")}. Je kiest een andere samenstelling; geef aan waarom.`);
      if (!r) return;
      reden = r.reden;
    }
    const ok = await bevestig(
      `Lot ${lotnr.value} samenstellen?`,
      h("div", {}, h("p", {}, "Deze batches worden samengevoegd:"), h("ul", { class: "samenvatting" }, batches.map((b) => h("li", {}, b))),
        h("p", { class: "waarschuwing" }, "Dit kan niet ongedaan worden gemaakt.")),
      "Samenstellen",
    );
    if (!ok) return;
    try {
      const reg = await maakLot(lotnr.value, batches, reden);
      location.hash = `#/reg/${reg.id}`;
    } catch (e) {
      melding(e instanceof ApiFout ? e.message : "Opslaan mislukt", "fout");
    }
  });

  const vinken = new Map<string, HTMLInputElement>();
  const klaarSet = new Set(w.wachtend.map((x) => x.nummer));
  const kiesVoorstel = (v: Voorstel) => {
    gekozen.clear();
    for (const [nr, vink] of vinken) {
      vink.checked = v.batches.some((b) => b.batchnummer === nr);
      if (vink.checked) gekozen.add(nr);
      vink.closest(".rij")?.classList.toggle("gekozen", vink.checked);
    }
    werkBij();
    lotnr.focus();
  };
  const voorstelBlok = voorstellen.length
    ? h("section", { class: "plan" },
        h("h2", {}, "Lotvoorstellen van de planner"),
        h("ul", { class: "lijst" }, voorstellen.map((v) => {
          const klaar = v.batches.every((b) => klaarSet.has(b.batchnummer));
          return h("li", { class: "rij" },
            h("div", {}, h("div", { class: "rij-hoofd" }, `Lotvoorstel ${v.nummer}`),
              h("div", { class: "rij-info" }, v.batches.map((b) => `${b.batchnummer}${klaarSet.has(b.batchnummer) ? "" : " (nog niet klaar)"}`).join(", ")),
              v.opmerking ? h("div", { class: "rij-info" }, v.opmerking) : null),
            klaar ? h("button", { class: "knop knop-hoofd", type: "button", onclick: () => kiesVoorstel(v) }, "Dit voorstel kiezen") : h("span", { class: "label label-wacht" }, "Nog niet klaar"));
        })))
    : null;

  return [
    voorstelBlok,
    h("h2", {}, "Batches klaar voor een lot"),
    w.wachtend.length
      ? h(
          "ul",
          { class: "lijst" },
          w.wachtend.map((x) => {
            const vink = h("input", { type: "checkbox", value: x.nummer }) as HTMLInputElement;
            vinken.set(x.nummer, vink);
            const rij = h("label", { class: "rij" }, h("div", {}, h("div", { class: "rij-hoofd" }, x.nummer),
              h("div", { class: "rij-info" }, x.sinds ? `Klaar sinds ${tijd(x.sinds)}` : "")), vink);
            vink.addEventListener("change", () => {
              if (vink.checked && gekozen.size >= 4) {
                vink.checked = false;
                melding("Een lot bestaat uit precies 4 batches");
                return;
              }
              vink.checked ? gekozen.add(x.nummer) : gekozen.delete(x.nummer);
              rij.classList.toggle("gekozen", vink.checked);
              werkBij();
            });
            return h("li", {}, rij);
          }),
        )
      : h("p", { class: "leeg" }, "Er zijn nog geen batches die alle stappen hebben doorlopen."),
    w.wachtend.length >= 4 ? h("div", { class: "nieuw", style: "margin-top:16px" }, h("label", { for: "nieuw-lot" }, "Lotnummer", lotnr), teller, knop) : null,
  ].filter(Boolean) as Node[];
}
