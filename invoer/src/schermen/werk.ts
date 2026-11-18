// Stappenoverzicht en het werk binnen één stap.
import { ApiFout, GeenVerbinding, haal, stuur } from "../api";
import { sessie } from "../sessie";
import { lokaleRegistraties, maakLot, nieuweBatch, startStap, stappen } from "../registraties";
import type { Overzicht, Registratie, Stap, Werkvoorraad } from "../types";
import { bevestig, h, laden, melding, tijd, toon, vastHouden } from "../ui";
import { acties } from "../wachtrij";

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
  const [{ data: alle }, overzicht, l] = await Promise.all([
    haal<Stap[]>("/config/stappen?voorDezePc=true"),
    haal<Overzicht[]>("/werkvoorraad").catch(() => ({ data: [] as Overzicht[], vers: false })),
    lokaleAanpassingen(),
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
    batch.length ? h("h2", {}, "Per batch") : null,
    batch.length ? h("div", { class: "route" }, batch.map(tegel)) : null,
    lot.length ? h("h2", {}, "Per lot") : null,
    lot.length ? h("div", { class: "route lot" }, lot.map(tegel)) : null,
  );
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
  const eersteBatchStap = (await stappen()).filter((x) => x.niveau === "batch")[0]?.code;
  if (!actueel()) return;

  const kop = h(
    "div",
    { class: "kop" },
    h("div", {}, h("h1", {}, s.naam), h("p", { class: "sub" }, s.is_lot_stap ? "Hier worden 4 batches één lot." : s.niveau === "batch" ? "Per batch" : "Per lot")),
    vers ? null : h("span", { class: "label label-wacht" }, "Laatst bekende stand"),
  );

  const bezig = [
    h("h2", {}, "Bezig"),
    w.open.length ? h("ul", { class: "lijst" }, w.open.map(regRij)) : h("p", { class: "leeg" }, "Er staat niets open in deze stap."),
  ];

  // Alleen operators en ploegleiders voeren in; andere rollen kijken mee.
  const kanInvoeren = sessie.rol === "operator" || sessie.rol === "ploegleider";
  let klaar: Node[];
  if (s.is_lot_stap && kanInvoeren) klaar = lotSamenstellen(s, w);
  else {
    const eerste = eersteBatchStap === s.code;
    klaar = [
      h("h2", {}, s.is_lot_stap ? "Batches klaar voor een lot" : "Klaar om te starten"),
      eerste && kanInvoeren ? nieuweBatchVorm(s) : null,
      w.wachtend.length
        ? h(
            "ul",
            { class: "lijst" },
            w.wachtend.map((x) =>
              h(
                "li",
                { class: "rij" },
                h("div", {}, h("div", { class: "rij-hoofd" }, x.nummer), h("div", { class: "rij-info" }, x.sinds ? `Klaar sinds ${tijd(x.sinds)}` : "")),
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
        : eerste && kanInvoeren
          ? null
          : h("p", { class: "leeg" }, "Nog niets klaar voor deze stap."),
    ].filter(Boolean) as Node[];
  }
  toon(kop, ...bezig, ...klaar);
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

function lotSamenstellen(s: Stap, w: Werkvoorraad): Node[] {
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
    const ok = await bevestig(
      `Lot ${lotnr.value} samenstellen?`,
      h("div", {}, h("p", {}, "Deze batches worden samengevoegd:"), h("ul", { class: "samenvatting" }, batches.map((b) => h("li", {}, b))),
        h("p", { class: "waarschuwing" }, "Dit kan niet ongedaan worden gemaakt.")),
      "Samenstellen",
    );
    if (!ok) return;
    try {
      const reg = await maakLot(lotnr.value, batches);
      location.hash = `#/reg/${reg.id}`;
    } catch (e) {
      melding(e instanceof ApiFout ? e.message : "Opslaan mislukt", "fout");
    }
  });

  return [
    h("h2", {}, "Batches klaar voor een lot"),
    w.wachtend.length
      ? h(
          "ul",
          { class: "lijst" },
          w.wachtend.map((x) => {
            const vink = h("input", { type: "checkbox", value: x.nummer }) as HTMLInputElement;
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
