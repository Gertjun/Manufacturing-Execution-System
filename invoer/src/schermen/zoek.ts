// Een batch of lot opzoeken: geschiedenis, herbewerking en besluiten.
import { ApiFout, GeenVerbinding, stuur } from "../api";
import { stappen } from "../registraties";
import { sessie } from "../sessie";
import { heeftProductRecht, rechtenOnline } from "../rechten";
import type { Registratie } from "../types";
import { h, laden, melding, tijd, toon, vastHouden, vraag } from "../ui";
import { acties, verwerk, verwijder, type Actie } from "../wachtrij";

interface BatchDetail {
  product?: string | null;
  batchnummer: string;
  status: string;
  lotnummer: string | null;
  registraties: Registratie[];
  besluiten: { besluit: string; reden: string; besloten_door: string; besloten_op: string }[];
}
interface LotDetail {
  product?: string | null;
  lotnummer: string;
  status: string;
  batches: string[];
  registraties: Registratie[];
}

const statusTekst: Record<string, string> = {
  gepland: "Gepland",
  in_productie: "In productie",
  in_beoordeling: "In beoordeling",
  in_lot: "In een lot",
  afgekeurd: "Afgekeurd",
  vrijgegeven: "Vrijgegeven",
  gereed: "Gereed",
  geblokkeerd: "Geblokkeerd",
};

function zoekVorm(waarde = "") {
  const veld = h("input", { id: "zoek", type: "text", class: "breed", placeholder: "B-2026-0001 of L-2026-0001", value: waarde, autocomplete: "off" }) as HTMLInputElement;
  return h(
    "form",
    {
      class: "nieuw",
      onsubmit: (e: Event) => {
        e.preventDefault();
        const n = veld.value.trim().toUpperCase();
        if (n) location.hash = `#/zoek/${n}`;
      },
    },
    h("label", { for: "zoek" }, "Batch- of lotnummer", veld),
    h("button", { class: "knop knop-hoofd", type: "submit" }, "Zoeken"),
  );
}

function regLijst(regs: Registratie[]) {
  return h(
    "ul",
    { class: "lijst" },
    regs.map((r) =>
      h(
        "li",
        {},
        h(
          "a",
          { class: "rij", href: `#/reg/${r.id}` },
          h(
            "div",
            {},
            h("div", { class: "rij-hoofd" }, `${r.stapnaam}${r.poging && r.poging > 1 ? `, poging ${r.poging}` : ""}`),
            h("div", { class: "rij-info" }, `${r.batchnummer ?? r.lotnummer}, ${r.operator}, ${tijd(r.gestart_op)}`,
              r.afgerond_door && r.afgerond_door !== r.operator ? `, afgerond door ${r.afgerond_door}` : "",
              r.nageleverd_door ? ", van papier" : "",
              r.herbewerking_start ? `, herbewerking: ${r.reden}` : "", r.status === "afgebroken" && r.reden ? `, ${r.reden}` : ""),
          ),
          r.status === "afgebroken"
            ? h("span", { class: "label label-buiten_grens" }, "Afgebroken")
            : h("span", { class: `label label-${r.status}` }, r.status === "open" ? "Open" : "Afgerond"),
        ),
      ),
    ),
  );
}

export async function zoekScherm(nummer?: string) {
  if (!nummer) {
    toon(h("h1", {}, "Zoeken"), zoekVorm());
    return;
  }
  const actueel = vastHouden();
  toon(h("h1", {}, nummer), laden());
  const isLot = nummer.startsWith("L-");
  try {
    if (isLot) {
      const lot = await stuur<LotDetail>("GET", `/lots/${nummer}`);
      const lotStappen = (await stappen()).filter((s) => s.niveau === "lot");
      if (actueel()) toonLot(lot, lotStappen);
    } else {
      const batch = await stuur<BatchDetail>("GET", `/batches/${nummer}`);
      if (actueel()) toonBatch(batch);
    }
  } catch (e) {
    if (!actueel()) return;
    const tekst =
      e instanceof GeenVerbinding ? "Zoeken kan alleen met verbinding." :
      e instanceof ApiFout && (e.status === 404 || e.status === 400) ? `${nummer} is niet gevonden.` : (e as Error).message;
    toon(h("h1", {}, "Zoeken"), zoekVorm(nummer), h("p", { class: "leeg", style: "margin-top:16px" }, tekst));
  }
}

function toonLot(lot: LotDetail, lotStappen: Awaited<ReturnType<typeof stappen>>) {
  const gedaan = new Set(lot.registraties.map((r) => r.stapcode));
  const terugNaar = lotStappen.filter((s) => gedaan.has(s.code));
  const open = lot.registraties.some((r) => r.status === "open");
  const kanInvoeren = heeftProductRecht(lot.product,"execution.start");

  toon(
    h("div", { class: "kop" }, h("div", {}, h("p", { class: "sub" }, "Lot"), h("h1", { class: "getal" }, lot.lotnummer),
      h("p", { class: "sub" }, `Batches: ${lot.batches.join(", ")}`)), h("span", { class: "label label-open" }, statusTekst[lot.status] ?? lot.status)),
    zoekVorm(lot.lotnummer),
    // Herbewerking: Kwaliteit of de productiemanager maakt hem aan in het portaal; daarna staat het lot klaar in die stap (#61, D57).
    kanInvoeren && terugNaar.length && !open
      ? h("p", { class: "sub" }, "Moet dit lot terug naar een eerdere stap? Dat besluiten Kwaliteit of de productiemanager. Daarna staat het lot in die stap klaar om te starten.")
      : null,
    h("h2", {}, "Geschiedenis van het lot"),
    lot.registraties.length ? regLijst(lot.registraties) : h("p", { class: "leeg" }, "Nog geen registraties."),
    h("h2", {}, "Batches in dit lot"),
    h("ul", { class: "lijst" }, lot.batches.map((b) => h("li", {}, h("a", { class: "rij", href: `#/zoek/${b}` }, h("span", { class: "rij-hoofd" }, b), h("span", { class: "knop knop-klein" }, "Bekijken"))))),
  );
}

const besluitTekst: Record<string, string> = {
  in_beoordeling: "In beoordeling gezet",
  vrijgegeven: "Keurresultaat OK, vrijgegeven",
  afgekeurd: "Keurresultaat NOK, afgekeurd",
};

function toonBatch(b: BatchDetail) {
  // In beoordeling zetten: ploegleider of Kwaliteit. Keurresultaat OK/NOK: alleen Kwaliteit.
  const magBeoordeling = rechtenOnline() && heeftProductRecht(b.product,"execution.hold","inspection.hold");
  const magKeuren = rechtenOnline() && heeftProductRecht(b.product,"inspection.batch.decide");
  const besluit = async (soort: string, titel: string, knop: string) => {
    const token = sessie.token;
    const r = await vraag(titel, [{ naam: "reden", label: "Reden" }, ...(soort === "in_beoordeling" ? [] : [{ naam: "wachtwoord", label: "Bevestig met je eigen wachtwoord", type: "password" as const }])], knop);
    if (!r || token !== sessie.token) return;
    try {
      await stuur("POST", `/batches/${b.batchnummer}/besluiten`, { besluit: soort, reden: r.reden, ...(soort === "in_beoordeling" ? {} : { wachtwoord: r.wachtwoord }) });
      melding("Besluit vastgelegd", "ok");
      void zoekScherm(b.batchnummer);
    } catch (e) {
      melding(e instanceof GeenVerbinding ? "Een besluit vastleggen kan alleen met verbinding" : (e as Error).message, "fout");
    }
  };
  toon(
    h("div", { class: "kop" }, h("div", {}, h("p", { class: "sub" }, "Batch"), h("h1", { class: "getal" }, b.batchnummer),
      b.lotnummer ? h("p", { class: "sub" }, "In lot ", h("a", { href: `#/zoek/${b.lotnummer}` }, b.lotnummer)) : null),
      h("span", { class: `label ${b.status === "afgekeurd" ? "label-buiten_grens" : b.status === "in_beoordeling" ? "label-wacht" : "label-open"}` }, statusTekst[b.status] ?? b.status)),
    zoekVorm(b.batchnummer),
    magBeoordeling && b.status === "in_productie"
      ? h("div", { class: "knoppen" }, h("button", { class: "knop", onclick: () => besluit("in_beoordeling", `${b.batchnummer} in beoordeling zetten`, "In beoordeling zetten") }, "In beoordeling zetten"))
      : null,
    magKeuren && b.status === "in_beoordeling"
      ? h("div", { class: "knoppen" },
          h("button", { class: "knop", onclick: () => besluit("vrijgegeven", `Keurresultaat OK voor ${b.batchnummer}`, "OK: vrijgeven") }, "Keurresultaat OK"),
          h("button", { class: "knop knop-gevaar", onclick: () => besluit("afgekeurd", `Keurresultaat NOK voor ${b.batchnummer}`, "NOK: afkeuren") }, "Keurresultaat NOK"))
      : null,
    !magKeuren && b.status === "in_beoordeling"
      ? h("p", { class: "waarschuwing", style: "margin-top:16px" }, "Deze batch wacht op het keurresultaat van Kwaliteit. OK geeft de batch vrij, NOK keurt hem af.")
      : null,
    b.besluiten.length ? h("h2", {}, "Besluiten") : null,
    b.besluiten.length
      ? h("ul", { class: "lijst" }, b.besluiten.map((d) => h("li", { class: "rij" },
          h("div", {}, h("div", { class: "rij-hoofd" }, besluitTekst[d.besluit] ?? d.besluit), h("div", { class: "rij-info" }, `${d.reden}, ${d.besloten_door}, ${tijd(d.besloten_op)}`)))))
      : null,
    h("h2", {}, "Geschiedenis van de batch"),
    b.registraties.length ? regLijst(b.registraties) : h("p", { class: "leeg" }, "Nog geen registraties."),
  );
}

export async function wachtrijScherm() {
  const actueel = vastHouden();
  const lijst = await acties();
  if (!actueel()) return;
  const rij = (a: Actie) =>
    h(
      "li",
      { class: "rij" },
      h("div", {}, h("div", { class: "rij-hoofd" }, a.omschrijving), h("div", { class: "rij-info" }, tijd(a.aangemaakt), a.operatornaam ? ` · ${a.operatornaam}` : ""),
        a.fout ? h("div", { class: "label-buiten_grens", style: "font-weight:700" }, a.fout) : null),
      a.status === "beoordeling" || !a.userId || a.fout?.startsWith("Persoonlijke herkomst")
        ? h("span", { class: "label label-wacht" }, "Beoordeling nodig")
        : a.status === "fout"
        ? h("button", {
            class: "knop knop-klein",
            onclick: async () => {
              await verwijder(a.volgnr!);
              void wachtrijScherm();
            },
          }, "Verwijderen")
        : h("span", { class: "label label-wacht" }, "Wacht"),
    );
  const beoordeling = lijst.filter((a) => a.status === "beoordeling" || (a.status === "fout" && (!a.userId || a.fout?.startsWith("Persoonlijke herkomst"))));
  const fouten = lijst.filter((a) => a.status === "fout" && !beoordeling.includes(a));
  const wacht = lijst.filter((a) => a.status === "wacht");
  toon(
    h("div", { class: "kop" }, h("h1", {}, "Verzenden"),
      h("button", { class: "knop", onclick: async () => { await verwerk(); void wachtrijScherm(); } }, "Nu versturen")),
    h("p", { class: "sub" }, "Invoer wordt eerst op deze pc bewaard en daarna automatisch naar de server gestuurd."),
    beoordeling.length ? h("h2", {}, "Gecontroleerde beoordeling nodig") : null,
    beoordeling.length ? h("p", {}, "Niet opnieuw invoeren of verwijderen. Laat de oorspronkelijke gegevens door een bevoegde medewerker beoordelen.") : null,
    beoordeling.length ? h("ul", { class: "lijst" }, beoordeling.map(rij)) : null,
    fouten.length ? h("h2", {}, "Geweigerd door de server") : null,
    fouten.length ? h("p", {}, "Deze invoer is niet opgeslagen. Lees de melding, voer het zo nodig opnieuw in en verwijder de regel daarna.") : null,
    fouten.length ? h("ul", { class: "lijst" }, fouten.map(rij)) : null,
    h("h2", {}, "Wacht op verzending"),
    wacht.length ? h("ul", { class: "lijst" }, wacht.map(rij)) : h("p", { class: "leeg" }, beoordeling.length || fouten.length ? "Geen acties klaar voor verzending." : "Alles is verstuurd."),
  );
}
