// Het invulformulier van één stapregistratie. Het formulier wordt opgebouwd
// uit de velden die bij de stap zijn ingesteld.
import { GeenVerbinding, stuur } from "../api";
import { berekenMarkering, leesGetal, markeringTekst, toonGetal } from "../markering";
import { drukEtikettenAf, FORMATEN, type EtiketInfo, type Formaat } from "../../../gedeeld/etiket";
import { beslisKeuring, corrigeer, corrigeerGrondstof, registratie, rondAf, slaGrondstoffenOp, slaWaardenOp, stappen, type GrondstofInvoer, type Invoer } from "../registraties";
import { sessie } from "../sessie";
import type { Markering, Registratie, VeldMetWaarde } from "../types";
import { bevestig, bezigBij, h, laden, melding, tijd, toon, vastHouden, vraag } from "../ui";

function grensTekst(v: VeldMetWaarde): string {
  const e = v.eenheid ? ` ${v.eenheid}` : "";
  const delen: string[] = [];
  if (v.grens_min !== null && v.grens_max !== null) delen.push(`Grens ${toonGetal(v.grens_min, v.decimalen)} tot ${toonGetal(v.grens_max, v.decimalen)}${e}`);
  else if (v.grens_max !== null) delen.push(`Maximaal ${toonGetal(v.grens_max, v.decimalen)}${e}`);
  else if (v.grens_min !== null) delen.push(`Minimaal ${toonGetal(v.grens_min, v.decimalen)}${e}`);
  if (v.tolerantie !== null) delen.push(`tolerantie ±${toonGetal(v.tolerantie)}${v.tolerantie_soort === "procent" ? " %" : e}`);
  return delen.join(", ");
}

const markeringLabel = (m: Markering) => h("span", { class: `label label-${m}` }, markeringTekst[m]);

export async function registratieScherm(id: string) {
  const actueel = vastHouden();
  toon(laden());
  let reg: Registratie | undefined;
  try {
    reg = await registratie(id);
    if (!actueel()) return;
  } catch (e) {
    toon(h("h1", {}, "Registratie niet gevonden"), h("p", {}, (e as Error).message), h("a", { href: "#/stappen" }, "Terug naar de stappen"));
    return;
  }
  // Voor "Iets melden" (#78): bij welke stap de melding hoort.
  if (reg) document.body.dataset.stap = reg.stapcode;
  if (!reg) {
    toon(h("h1", {}, "Registratie niet beschikbaar"), h("p", {}, "Deze registratie is niet op deze pc bewaard en de server is niet bereikbaar."));
    return;
  }
  teken(reg);
}

function teken(reg: Registratie) {
  const opVloer = sessie.rol === "operator" || sessie.rol === "ploegleider";
  const isKwaliteit = sessie.rol === "kwaliteit";
  // Keuring (#64): velden die Kwaliteit meet, vult Kwaliteit in; ook nog als de stap afgerond is en op Kwaliteit wacht.
  const keuringOpen = reg.keuring?.status === "open";
  const vanKwaliteit = (v: VeldMetWaarde) => v.gemeten_door === "kwaliteit";
  const magVeld = (v: VeldMetWaarde) => (vanKwaliteit(v) ? isKwaliteit && (reg.status === "open" || keuringOpen) : opVloer && reg.status === "open");
  const metKwaliteit = reg.velden!.some(vanKwaliteit);
  const magInvoeren = reg.status === "open" && opVloer;
  const magCorrigeren = (sessie.rol === "ploegleider" || sessie.rol === "beheerder") && !reg.lokaal;
  const invoer = new Map<string, { setting?: HTMLInputElement; gemeten: HTMLInputElement; label: HTMLElement; rij: HTMLElement; fout: HTMLElement }>();
  // Rijen die de operator al heeft verlaten: daar tonen we een foutmelding onder het veld (niet tijdens het typen, D50).
  const verlaten = new Set<string>();
  const toonFout = (code: string, tekst: string | null, velden: (HTMLInputElement | undefined)[], ongeldig: (HTMLInputElement | undefined)[]) => {
    const el = rijFout.get(code);
    const zichtbaar = verlaten.has(code) ? tekst : null;
    if (el) el.textContent = zichtbaar ?? "";
    for (const v of velden) v?.setAttribute("aria-invalid", String(!!zichtbaar && ongeldig.includes(v)));
  };
  const rijFout = new Map<string, HTMLElement>();

  const opslaan = h("button", { class: "knop knop-hoofd", disabled: true }, "Opslaan") as HTMLButtonElement;
  const afronden = h("button", { class: "knop" }, "Stap afronden") as HTMLButtonElement;
  const vrijgeven = h("button", { class: "knop knop-hoofd" }, "Vrijgeven") as HTMLButtonElement;
  const hint = h("span", { class: "hint" });

  /** Lees één veld; geeft null als het (nog) niet compleet of ongeldig is. */
  const lees = (v: VeldMetWaarde): { invoer: Invoer | null; leeg: boolean; fout: boolean } => {
    const i = invoer.get(v.code)!;
    const gemeten = leesGetal(i.gemeten.value);
    const setting = i.setting ? leesGetal(i.setting.value) : null;
    const leeg = i.gemeten.value.trim() === "" && (!i.setting || i.setting.value.trim() === "");
    const fout =
      (i.gemeten.value.trim() !== "" && gemeten === null) || (!!i.setting && i.setting.value.trim() !== "" && setting === null);
    const gOngeldig = i.gemeten.value.trim() !== "" && gemeten === null;
    const sOngeldig = !!i.setting && i.setting.value.trim() !== "" && setting === null;
    const sLeeg = !!i.setting && i.setting.value.trim() === "";
    const gLeeg = i.gemeten.value.trim() === "";
    const tekst =
      gOngeldig || sOngeldig ? "Vul een getal in, bijvoorbeeld 86,5" :
      !leeg && gLeeg ? "Vul ook de gemeten waarde in" :
      !leeg && sLeeg ? "Vul ook de instelling in" : null;
    const leegVeld = !leeg && gLeeg ? i.gemeten : !leeg && sLeeg ? i.setting : undefined;
    toonFout(v.code, tekst, [i.gemeten, i.setting], [gOngeldig ? i.gemeten : undefined, sOngeldig ? i.setting : undefined, leegVeld]);
    if (gemeten === null || (i.setting && setting === null)) return { invoer: null, leeg, fout };
    return { invoer: { code: v.code, setting: i.setting ? setting : null, gemeten }, leeg, fout };
  };

  // Grondstoffen: partijnummer (verplicht om op te slaan) en eventueel hoeveelheid.
  const gsInvoer = new Map<string, { partij: HTMLInputElement; hoeveelheid: HTMLInputElement }>();
  const leesGs = (): { klaar: GrondstofInvoer[]; fout: boolean } => {
    const klaar: GrondstofInvoer[] = [];
    let fout = false;
    for (const [code, i] of gsInvoer) {
      const partij = i.partij.value.trim();
      const hv = i.hoeveelheid.value.trim();
      const hoeveelheid = hv === "" ? null : leesGetal(hv);
      const ongeldig = (hv !== "" && (hoeveelheid === null || hoeveelheid <= 0)) || (partij === "" && hv !== "");
      const hOngeldig = hv !== "" && (hoeveelheid === null || hoeveelheid <= 0);
      const pLeeg = partij === "" && hv !== "";
      toonFout(code, hOngeldig ? "Vul een hoeveelheid groter dan 0 in, bijvoorbeeld 118,5" : pLeeg ? "Vul het partijnummer van de leverancier in" : null,
        [i.partij, i.hoeveelheid], [hOngeldig ? i.hoeveelheid : undefined, pLeeg ? i.partij : undefined]);
      if (ongeldig) fout = true;
      else if (partij) klaar.push({ code, partij, hoeveelheid });
    }
    return { klaar, fout };
  };

  const werkBij = () => {
    let klaar = 0;
    let half = 0;
    for (const v of reg.velden!) {
      if (!invoer.has(v.code)) continue;
      const r = lees(v);
      const i = invoer.get(v.code)!;
      if (r.invoer) {
        klaar++;
        const m = berekenMarkering(r.invoer.setting, r.invoer.gemeten, v.grens_min, v.grens_max, v.tolerantie, v.tolerantie_soort);
        i.label.replaceChildren(markeringLabel(m));
        i.rij.dataset.markering = m;
      } else {
        if (!r.leeg) half++;
        i.label.replaceChildren();
        delete i.rij.dataset.markering;
      }
    }
    const gs = leesGs();
    klaar += gs.klaar.length;
    if (gs.fout) half++;
    const ontbreekt = isKwaliteit
      ? reg.velden!.filter((v) => vanKwaliteit(v) && v.verplicht && !v.waarde).length
      : reg.velden!.filter((v) => !vanKwaliteit(v) && v.verplicht && !v.waarde).length + (reg.grondstoffen ?? []).filter((g) => g.verplicht && !g.gebruik).length;
    opslaan.disabled = klaar === 0 || half > 0;
    afronden.disabled = ontbreekt > 0 || reg.status !== "open";
    vrijgeven.disabled = ontbreekt > 0 || !keuringOpen;
    hint.textContent = isKwaliteit
      ? (half > 0 ? "Vul een geldig getal in" :
         klaar > 0 ? `${klaar} ${klaar === 1 ? "meting" : "metingen"} klaar om op te slaan` :
         ontbreekt > 0 ? `Nog ${ontbreekt} ${ontbreekt === 1 ? "meting" : "metingen"} van Kwaliteit; daarna kun je vrijgeven` :
         keuringOpen ? "Alle metingen zijn ingevuld: vrijgeven, herbewerken of afkeuren" : "De operator rondt de stap nog af; daarna kun je beslissen")
      : half > 0 ? (gs.fout ? "Vul bij een grondstof het partijnummer in, en een geldige hoeveelheid" : "Vul bij een procesparameter zowel instelling als gemeten waarde in") :
      klaar > 0 ? `${klaar} ${klaar === 1 ? "invoer" : "invoeren"} klaar om op te slaan${ontbreekt > 0 ? "; de stap afronden kan als alle verplichte velden zijn opgeslagen" : ""}` :
      ontbreekt > 0 ? `Nog ${ontbreekt} ${ontbreekt === 1 ? "veld" : "velden"} in te vullen; daarna kun je de stap afronden` :
      reg.status === "open" ? "Alle velden zijn ingevuld" : "";
  };

  const velden = reg.velden!.map((v) => {
    const rij = h("div", { class: "veld" });
    const links = h("div", {}, h("div", { class: "veld-code" }, `${v.code} ${v.naam}`), h("div", { class: "veld-grens" }, grensTekst(v) || " "));
    let midden: HTMLElement;
    const rechts = h("div", { class: "veld-rechts" });

    if (v.waarde) {
      rij.dataset.markering = v.waarde.markering;
      midden = h(
        "div",
        { class: "veld-waarde getal" },
        v.waarde.setting !== null ? h("span", { class: "eenheid" }, `instelling ${toonGetal(v.waarde.setting, v.decimalen)}, gemeten `) : null,
        toonGetal(v.waarde.gemeten, v.decimalen),
        v.eenheid ? h("span", { class: "eenheid" }, ` ${v.eenheid}`) : null,
      );
      rechts.append(markeringLabel(v.waarde.markering));
      if (v.waarde.wacht) rechts.append(h("span", { class: "label label-wacht" }, "Nog niet verstuurd"));
      if (v.waarde.gecorrigeerd) rechts.append(h("span", { class: "label label-afgerond" }, "Gecorrigeerd"));
      if (magCorrigeren && !v.waarde.wacht) {
        rechts.append(
          h("button", {
            class: "knop knop-klein",
            onclick: async () => {
              const velden = [
                ...(v.soort === "procesparameter" ? [{ naam: "setting", label: `Instelling${v.eenheid ? ` (${v.eenheid})` : ""}`, type: "getal" }] : []),
                { naam: "gemeten", label: `Gemeten${v.eenheid ? ` (${v.eenheid})` : ""}`, type: "getal" },
                { naam: "reden", label: "Reden van de correctie" },
              ];
              const r = await vraag(`${v.code} corrigeren`, velden, "Correctie opslaan");
              if (!r) return;
              const gemeten = leesGetal(r.gemeten);
              const setting = r.setting !== undefined ? leesGetal(r.setting) : undefined;
              if (gemeten === null || setting === null) return melding("Vul geldige getallen in", "fout");
              try {
                teken(await corrigeer(reg, v.code, gemeten, setting, r.reden));
                melding(`${v.code} gecorrigeerd`, "ok");
              } catch (e) {
                melding(e instanceof GeenVerbinding ? "Corrigeren kan alleen met verbinding" : (e as Error).message, "fout");
              }
            },
          }, "Corrigeer"),
        );
      }
    } else if (magVeld(v)) {
      const gemeten = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", id: `g-${v.code}`, "aria-describedby": `f-${v.code}`, oninput: werkBij }) as HTMLInputElement;
      const setting =
        v.soort === "procesparameter"
          ? (h("input", { type: "text", inputmode: "decimal", autocomplete: "off", id: `s-${v.code}`, "aria-describedby": `f-${v.code}`, oninput: werkBij }) as HTMLInputElement)
          : undefined;
      const label = h("div");
      const fout = h("p", { class: "veld-fout", id: `f-${v.code}`, "aria-live": "polite" });
      rijFout.set(v.code, fout);
      rij.addEventListener("focusout", (e) => { if (!rij.contains((e as FocusEvent).relatedTarget as Node | null)) { verlaten.add(v.code); werkBij(); } });
      invoer.set(v.code, { setting, gemeten, label, rij, fout });
      midden = h(
        "div",
        { class: "veld-invoer" },
        setting ? h("label", { for: `s-${v.code}` }, `Instelling${v.eenheid ? ` (${v.eenheid})` : ""}`, setting) : null,
        h("label", { for: `g-${v.code}` }, `${v.soort === "gewicht" ? "Gewicht" : "Gemeten"}${v.eenheid ? ` (${v.eenheid})` : ""}`, gemeten),
        fout,
      );
      rechts.append(label);
      if (!v.verplicht) rechts.append(h("span", { class: "veld-grens" }, "Niet verplicht"));
      if (vanKwaliteit(v)) rechts.append(h("span", { class: "label label-kwaliteit" }, "Kwaliteit"));
    } else if (vanKwaliteit(v)) {
      midden = h("div", { class: "sub" }, reg.status === "open" || keuringOpen ? "Meet Kwaliteit" : "Niet gemeten");
      rechts.append(h("span", { class: "label label-kwaliteit" }, "Kwaliteit"));
    } else {
      midden = h("div", { class: "sub" }, "Niet ingevuld");
    }
    rij.append(links, midden, rechts);
    return rij;
  });

  const grondstoffen = (reg.grondstoffen ?? []).map((g) => {
    const rij = h("div", { class: "veld veld-grondstof" });
    const eenheid = g.eenheid ? ` (${g.eenheid})` : "";
    const links = h("div", {}, h("div", { class: "veld-code" }, `${g.code} ${g.naam}`), h("div", { class: "veld-grens" }, g.verplicht ? "Partijnummer van de leverancier" : "Partijnummer, niet verplicht"));
    const rechts = h("div", { class: "veld-rechts" });
    let midden: HTMLElement;
    if (g.gebruik) {
      midden = h("div", { class: "veld-waarde" }, g.gebruik.partij,
        g.gebruik.hoeveelheid !== null ? h("span", { class: "eenheid" }, `, ${toonGetal(g.gebruik.hoeveelheid)}${g.eenheid ? ` ${g.eenheid}` : ""}`) : null);
      if (g.gebruik.wacht) rechts.append(h("span", { class: "label label-wacht" }, "Nog niet verstuurd"));
      if (g.gebruik.gecorrigeerd) rechts.append(h("span", { class: "label label-afgerond" }, "Gecorrigeerd"));
      if (magCorrigeren && !g.gebruik.wacht) {
        rechts.append(h("button", {
          class: "knop knop-klein",
          onclick: async () => {
            const r = await vraag(`${g.code} corrigeren`, [
              { naam: "partij", label: "Partijnummer", waarde: g.gebruik!.partij },
              { naam: "hoeveelheid", label: `Hoeveelheid${eenheid}`, type: "getal", optioneel: true, waarde: g.gebruik!.hoeveelheid !== null ? toonGetal(g.gebruik!.hoeveelheid) : "" },
              { naam: "reden", label: "Reden van de correctie" },
            ], "Correctie opslaan");
            if (!r) return;
            const hv = r.hoeveelheid === "" ? null : leesGetal(r.hoeveelheid);
            if (r.hoeveelheid !== "" && hv === null) return melding("Vul een geldige hoeveelheid in", "fout");
            try {
              teken(await corrigeerGrondstof(reg, g.code, r.partij, hv, r.reden));
              melding(`${g.code} gecorrigeerd`, "ok");
            } catch (e) {
              melding(e instanceof GeenVerbinding ? "Corrigeren kan alleen met verbinding" : (e as Error).message, "fout");
            }
          },
        }, "Corrigeer"));
      }
    } else if (magInvoeren) {
      const partij = h("input", { type: "text", autocomplete: "off", id: `p-${g.code}`, "aria-describedby": `f-${g.code}`, oninput: werkBij, maxlength: 60 }) as HTMLInputElement;
      const hoeveelheid = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", id: `h-${g.code}`, "aria-describedby": `f-${g.code}`, oninput: werkBij }) as HTMLInputElement;
      gsInvoer.set(g.code, { partij, hoeveelheid });
      const fout = h("p", { class: "veld-fout", id: `f-${g.code}`, "aria-live": "polite" });
      rijFout.set(g.code, fout);
      rij.addEventListener("focusout", (e) => { if (!rij.contains((e as FocusEvent).relatedTarget as Node | null)) { verlaten.add(g.code); werkBij(); } });
      midden = h("div", { class: "veld-invoer" },
        h("label", { for: `p-${g.code}` }, "Partijnummer", partij),
        h("label", { for: `h-${g.code}` }, `Hoeveelheid${eenheid}`, hoeveelheid),
        fout);
      if (!g.verplicht) rechts.append(h("span", { class: "veld-grens" }, "Niet verplicht"));
    } else {
      midden = h("div", { class: "sub" }, "Niet ingevuld");
    }
    rij.append(links, midden, rechts);
    return rij;
  });

  opslaan.addEventListener("click", bezigBij(async () => {
    const klaar = reg.velden!.map((v) => (invoer.has(v.code) ? lees(v).invoer : null)).filter((x): x is Invoer => !!x);
    const gsKlaar = leesGs().klaar;
    const regels = klaar.map((i) => {
      const v = reg.velden!.find((x) => x.code === i.code)!;
      const m = berekenMarkering(i.setting, i.gemeten, v.grens_min, v.grens_max, v.tolerantie, v.tolerantie_soort);
      return { i, v, m };
    });
    const afwijkend = regels.filter((r) => r.m !== "ok").length;
    const ok = await bevestig(
      "Klopt dit?",
      h(
        "div",
        {},
        h(
          "ul",
          { class: "samenvatting" },
          regels.map(({ i, v, m }) =>
            h("li", {}, h("span", {}, `${v.code} ${v.naam}`),
              h("span", { class: "getal" }, i.setting !== null ? `${toonGetal(i.setting, v.decimalen)} / ` : "", `${toonGetal(i.gemeten, v.decimalen)}${v.eenheid ? ` ${v.eenheid}` : ""} `, markeringLabel(m))),
          ),
          gsKlaar.map((g) => {
            const gg = reg.grondstoffen!.find((x) => x.code === g.code)!;
            return h("li", {}, h("span", {}, `${g.code} ${gg.naam}`),
              h("span", {}, `partij ${g.partij}${g.hoeveelheid !== null ? `, ${toonGetal(g.hoeveelheid)}${gg.eenheid ? ` ${gg.eenheid}` : ""}` : ""}`));
          }),
        ),
        afwijkend ? h("p", { class: "waarschuwing" }, `${afwijkend} ${afwijkend === 1 ? "waarde wijkt" : "waarden wijken"} af. Controleer of je goed hebt afgelezen.`) : null,
        h("p", { class: "sub" }, "Na opslaan kan alleen een ploegleider een waarde nog corrigeren."),
      ),
      "Opslaan",
    );
    if (!ok) return;
    if (klaar.length) reg = await slaWaardenOp(reg, klaar);
    if (gsKlaar.length) reg = await slaGrondstoffenOp(reg, gsKlaar);
    teken(reg);
    melding("Opgeslagen", "ok");
  }));

  afronden.addEventListener("click", bezigBij(async () => {
    const ok = await bevestig(`${reg.stapnaam} afronden?`,
      metKwaliteit ? "Daarna wacht de batch of het lot op de metingen en de vrijgave van Kwaliteit." : "Daarna kan de batch of het lot door naar de volgende stap.", "Afronden");
    if (!ok) return;
    await rondAf(reg);
    melding(`${reg.stapnaam} afgerond voor ${reg.batchnummer ?? reg.lotnummer}`, "ok");
    location.hash = `#/stap/${reg.stapcode}`;
  }));

  // Kwaliteit beslist (#64): vrijgeven, herbewerken of afkeuren. Ook offline: het besluit gaat in de wachtrij.
  const nummer = reg.batchnummer ?? reg.lotnummer;
  const besluit = async (b: "vrijgegeven" | "herbewerken" | "afgekeurd", reden: string | null, stap?: string) => {
    reg = await beslisKeuring(reg, b, reden, stap);
    melding(b === "vrijgegeven" ? `${nummer} vrijgegeven` : b === "herbewerken" ? `${nummer}: herbewerking aangemaakt` : `${nummer} afgekeurd`, b === "afgekeurd" ? "info" : "ok");
    teken(reg);
  };
  vrijgeven.addEventListener("click", bezigBij(async () => {
    const afw = reg.velden!.filter((v) => v.waarde && v.waarde.markering !== "ok").length;
    const ok = await bevestig(`${nummer} vrijgeven?`,
      `${afw ? `Let op: ${afw} ${afw === 1 ? "meting wijkt" : "metingen wijken"} af. ` : ""}Daarna kan de batch of het lot door naar de volgende stap.`, "Vrijgeven");
    if (ok) await besluit("vrijgegeven", null);
  }));
  const herbewerken = h("button", { class: "knop", onclick: bezigBij(async () => {
    const alle = (await stappen()).filter((s) => s.niveau === reg.niveau && !s.is_lot_stap);
    const tot = alle.findIndex((s) => s.code === reg.stapcode);
    const keuze = (tot >= 0 ? alle.slice(0, tot + 1) : alle).reverse();
    const r = await vraag(`${nummer} herbewerken`, [
      { naam: "stap", label: "Terug naar stap", opties: keuze.map((s): [string, string] => [s.code, `${s.code} ${s.naam}`]), waarde: reg.stapcode },
      { naam: "reden", label: "Reden" },
    ], "Herbewerken", "De batch of het lot gaat terug naar de gekozen stap en doet daarna alle volgende stappen opnieuw.");
    if (r) await besluit("herbewerken", r.reden, r.stap);
  }) }, "Herbewerken");
  const afkeuren = h("button", { class: "knop knop-gevaar", onclick: bezigBij(async () => {
    const r = await vraag(`${nummer} afkeuren`, [{ naam: "reden", label: "Reden van afkeur" }], "Afkeuren",
      reg.niveau === "batch" ? "Dit is het keurresultaat NOK: de batch wordt afgevoerd." : "Het lot wordt geblokkeerd.");
    if (r) await besluit("afgekeurd", r.reden);
  }) }, "Afkeuren");
  const KEURING: Record<string, string> = { open: "Wacht op Kwaliteit", vrijgegeven: "Vrijgegeven", herbewerken: "Herbewerken", afgekeurd: "Afgekeurd" };
  const keuringLabel = reg.keuring
    ? h("span", { class: `label label-keuring-${reg.keuring.status}` }, KEURING[reg.keuring.status],
        reg.keuring.wacht ? " (nog niet verstuurd)" : reg.keuring.besloten_door ? ` door ${reg.keuring.besloten_door}` : "")
    : null;

  const statusLabel = reg.lokaal
    ? h("span", { class: "label label-wacht" }, "Nog niet verstuurd")
    : reg.status === "afgebroken"
      ? h("span", { class: "label label-buiten_grens" }, `Afgebroken ${tijd(reg.afgerond_op)}`)
      : h("span", { class: `label label-${reg.status}` }, reg.status === "open" ? "Open" : `Afgerond ${tijd(reg.afgerond_op)}`);

  toon(
    h(
      "div",
      { class: "kop" },
      h(
        "div",
        {},
        h("p", { class: "sub" }, h("a", { href: `#/stap/${reg.stapcode}` }, reg.stapnaam)),
        h("h1", { class: "getal" }, reg.batchnummer ?? reg.lotnummer),
        h(
          "p",
          { class: "sub" },
          `${reg.niveau === "batch" ? "Batch" : "Lot"}${reg.product ? ` ${reg.product}` : ""}, gestart ${tijd(reg.gestart_op)} door ${reg.operator} op ${reg.pc}`,
          reg.poging && reg.poging > 1 ? `, poging ${reg.poging}` : "",
          // Afgerond door een ander of op een andere pc (ploegwissel, #55).
          reg.afgerond_door && (reg.afgerond_door !== reg.operator || reg.afgerond_pc !== reg.pc)
            ? `, afgerond door ${reg.afgerond_door}${reg.afgerond_pc ? ` op ${reg.afgerond_pc}` : ""}` : "",
        ),
        reg.status === "open" && opVloer && !reg.lokaal && sessie.operatornaam && reg.operator !== sessie.operatornaam
          ? h("p", { class: "overname" }, `Je maakt de stap af die ${reg.operator} startte. Wat jij invult en het afronden staan op jouw naam.`)
          : null,
        reg.herbewerking_start ? h("p", { class: "waarschuwing" }, `Herbewerking: ${reg.reden}`) : null,
        reg.nageleverd_door ? h("p", { class: "sub" }, `Nageleverd van papier door ${reg.nageleverd_door}: ${reg.nageleverd_reden ?? ""}`) : null,
        reg.status === "afgebroken" ? h("p", { class: "waarschuwing" }, reg.reden ?? "Afgebroken") : null,
        reg.keuring && reg.keuring.status !== "open" && reg.keuring.reden ? h("p", { class: "sub" }, `Kwaliteit: ${reg.keuring.reden}`) : null,
      ),
      h("div", { class: "kop-rechts" }, statusLabel, keuringLabel,
        h("button", { class: "knop knop-klein", onclick: () => etiketPrinten(reg.batchnummer ?? reg.lotnummer!, reg.niveau === "batch" ? "batch" : "lot") }, "Etiket printen")),
    ),
    h("div", { class: "formulier" }, velden),
    grondstoffen.length ? h("h2", { class: "tussenkop-invoer" }, "Grondstoffen") : null,
    grondstoffen.length ? h("div", { class: "formulier" }, grondstoffen) : null,
    reg.status === "open" && magInvoeren ? h("div", { class: "balk-onder" }, h("div", {}, hint, opslaan, afronden)) : null,
    isKwaliteit && (reg.status === "open" || keuringOpen) && metKwaliteit
      ? h("div", { class: "balk-onder" }, h("div", {}, hint, opslaan, keuringOpen ? [vrijgeven, herbewerken, afkeuren] : null))
      : null,
  );
  werkBij();
}

/** Etiket voor deze batch of dit lot. Met verbinding met product en dag; zonder alleen nummer en barcode. */
async function etiketPrinten(nummer: string, soort: "batch" | "lot") {
  let info: EtiketInfo = { nummer, soort, regels: [`Geprint ${new Date().toLocaleDateString("nl-NL")}`] };
  try {
    const [g] = await stuur<{ nummer: string; soort: "batch" | "lot"; product: string | null; dag: string | null; batches: string[] }[]>(
      "GET", `/planning/etiketten?nummers=${encodeURIComponent(nummer)}`);
    if (g) info = { nummer, soort: g.soort, regels: [g.soort === "lot" ? g.batches.join(" ") : g.product ?? "", g.dag ? new Date(`${g.dag}T12:00:00`).toLocaleDateString("nl-NL") : ""].filter(Boolean) };
  } catch { /* zonder verbinding: eenvoudig etiket */ }
  let vorige: Formaat = "printer";
  try { if (localStorage.getItem("etiketformaat") === "a4") vorige = "a4"; } catch { /* */ }
  const r = await vraag(`Etiket ${nummer}`, [{ naam: "formaat", label: "Waarop print je?", opties: FORMATEN.map((f): [string, string] => [f.id, f.naam]), waarde: vorige }],
    "Printen", "Deze pc onthoudt je keuze. Kies in het afdrukvenster de juiste printer, marges 'geen' en schaal 100%.");
  if (!r) return;
  const formaat = r.formaat as Formaat;
  try { localStorage.setItem("etiketformaat", formaat); } catch { /* */ }
  drukEtikettenAf([info], formaat);
}
