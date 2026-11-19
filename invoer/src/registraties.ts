// Acties op registraties. Elke actie past eerst de lokale kopie aan en zet
// daarna een verzoek in de wachtrij. Zo werkt invoer ook zonder verbinding.
import { ApiFout, GeenVerbinding, haal, nieuwId, stuur } from "./api";
import { berekenMarkering } from "./markering";
import { opslag } from "./opslag";
import { sessie } from "./sessie";
import type { Registratie, Stap, VeldMetWaarde } from "./types";
import { heeftWachtende, voegToe } from "./wachtrij";

let stappenCache: Stap[] | null = null;

/** Alle stappen met hun velden (laatst bekende versie als er geen verbinding is). */
export async function stappen(): Promise<Stap[]> {
  if (stappenCache) return stappenCache;
  stappenCache = (await haal<Stap[]>("/config/stappen")).data;
  return stappenCache;
}

export async function stap(code: string): Promise<Stap> {
  const s = (await stappen()).find((x) => x.code === code);
  if (!s) throw new Error(`Onbekende stap ${code}`);
  return s;
}

export function vergeetConfig() {
  stappenCache = null;
}

function veldenUit(s: Stap): VeldMetWaarde[] {
  return s.velden
    .filter((v) => v.actief)
    .map((v) => ({
      code: v.code,
      naam: v.naam,
      soort: v.soort,
      eenheid: v.eenheid,
      grens_min: v.grens_min,
      grens_max: v.grens_max,
      tolerantie: v.tolerantie,
      tolerantie_soort: v.tolerantie_soort,
      verplicht: v.verplicht,
      waarde: null,
    }));
}

function lokaal(s: Stap, id: string, nummer: { batchnummer?: string; lotnummer?: string }, extra: Partial<Registratie> = {}): Registratie {
  return {
    id,
    stapcode: s.code,
    stapnaam: s.naam,
    niveau: s.niveau,
    batchnummer: nummer.batchnummer ?? null,
    lotnummer: nummer.lotnummer ?? null,
    poging: null,
    herbewerking_start: false,
    reden: null,
    status: "open",
    operator: sessie.operatornaam ?? "",
    pc: sessie.pc ?? "",
    gestart_op: new Date().toISOString(),
    afgerond_op: null,
    velden: veldenUit(s),
    lokaal: true,
    ...extra,
  };
}

/** Start een stap voor een batch of lot. Geeft de (lokale) registratie terug. */
export async function startStap(stapcode: string, nummer: { batchnummer?: string; lotnummer?: string }) {
  const s = await stap(stapcode);
  const id = nieuwId();
  const reg = lokaal(s, id, nummer);
  await opslag.zet("registraties", reg);
  await voegToe({
    omschrijving: `${stapcode} starten voor ${nummer.batchnummer ?? nummer.lotnummer}`,
    methode: "POST",
    pad: "/registraties",
    body: { id, stapcode, ...nummer },
    registratieId: id,
  });
  return reg;
}

/** PS1: nieuwe batch aanmaken en meteen de eerste stap starten. */
export async function nieuweBatch(batchnummer: string, eersteStap: string) {
  await voegToe({
    omschrijving: `Batch ${batchnummer} aanmaken`,
    methode: "POST",
    pad: "/batches",
    body: { id: nieuwId(), batchnummer },
  });
  return startStap(eersteStap, { batchnummer });
}

/** Lot-stap: 4 batches samenvoegen. Opent de registratie van de lot-stap. */
export async function maakLot(lotnummer: string, batchnummers: string[], afwijkingReden?: string) {
  const lotStap = (await stappen()).find((s) => s.is_lot_stap)!;
  const registratieId = nieuwId();
  const reg = lokaal(lotStap, registratieId, { lotnummer }, { poging: 1 });
  await opslag.zet("registraties", reg);
  await opslag.zet("cache", batchnummers, `lot-in-wacht:${lotnummer}`);
  await voegToe({
    omschrijving: `Lot ${lotnummer} samenstellen (${batchnummers.join(", ")})`,
    methode: "POST",
    pad: "/lots",
    body: { id: nieuwId(), registratieId, lotnummer, batchnummers, ...(afwijkingReden ? { afwijkingReden } : {}) },
    registratieId,
  });
  return reg;
}

export async function startHerbewerking(lotnummer: string, stapcode: string, reden: string) {
  const s = await stap(stapcode);
  const id = nieuwId();
  const reg = lokaal(s, id, { lotnummer }, { herbewerking_start: true, reden });
  await opslag.zet("registraties", reg);
  await voegToe({
    omschrijving: `Herbewerking ${lotnummer} vanaf ${stapcode}`,
    methode: "POST",
    pad: `/lots/${lotnummer}/herbewerking`,
    body: { id, stapcode, reden },
    registratieId: id,
  });
  return reg;
}

export interface Invoer {
  code: string;
  setting: number | null;
  gemeten: number;
}

export async function slaWaardenOp(reg: Registratie, invoer: Invoer[]) {
  const waarden = invoer.map((i) => ({ id: nieuwId(), veldcode: i.code, setting: i.setting, gemeten: i.gemeten }));
  const nu = new Date().toISOString();
  reg.velden = reg.velden!.map((v) => {
    const w = waarden.find((x) => x.veldcode === v.code);
    if (!w) return v;
    return {
      ...v,
      waarde: {
        id: w.id,
        setting: w.setting,
        gemeten: w.gemeten,
        markering: berekenMarkering(w.setting, w.gemeten, v.grens_min, v.grens_max, v.tolerantie, v.tolerantie_soort),
        gecorrigeerd: false,
        ingevoerd_op: nu,
        wacht: true,
      },
    };
  });
  reg.lokaal = true;
  await opslag.zet("registraties", reg);
  await voegToe({
    omschrijving: `${reg.stapcode} ${reg.batchnummer ?? reg.lotnummer}: ${invoer.map((i) => i.code).join(", ")} opslaan`,
    methode: "POST",
    pad: `/registraties/${reg.id}/waarden`,
    body: { waarden },
    registratieId: reg.id,
  });
  return reg;
}

export async function rondAf(reg: Registratie) {
  reg.status = "afgerond";
  reg.afgerond_op = new Date().toISOString();
  reg.lokaal = true;
  await opslag.zet("registraties", reg);
  await voegToe({
    omschrijving: `${reg.stapcode} ${reg.batchnummer ?? reg.lotnummer} afronden`,
    methode: "POST",
    pad: `/registraties/${reg.id}/afronden`,
    registratieId: reg.id,
  });
}

/** Correctie door een ploegleider: alleen met verbinding, want direct gecontroleerd. */
export async function corrigeer(reg: Registratie, veldcode: string, gemeten: number, setting: number | null | undefined, reden: string) {
  const antwoord = await stuur<Registratie>("POST", `/registraties/${reg.id}/waarden/${veldcode}/correctie`, {
    gemeten,
    ...(setting === undefined ? {} : { setting }),
    reden,
  });
  await opslag.zet("registraties", { ...antwoord, lokaal: false });
  return antwoord;
}

/**
 * Haal een registratie: van de server als dat kan en er lokaal niets meer
 * onderweg is, anders de lokale kopie.
 */
export async function registratie(id: string): Promise<Registratie | undefined> {
  const hier = await opslag.haal<Registratie>("registraties", id);
  if (hier && (await heeftWachtende(id))) return hier;
  try {
    const vers = await stuur<Registratie>("GET", `/registraties/${id}`);
    await opslag.zet("registraties", { ...vers, lokaal: false });
    return vers;
  } catch (e) {
    if (e instanceof GeenVerbinding || (e instanceof ApiFout && e.status === 404 && hier)) return hier;
    throw e;
  }
}

/** Registraties die alleen lokaal bestaan of nog acties hebben lopen. */
export async function lokaleRegistraties(): Promise<Registratie[]> {
  const alle = await opslag.alle<Registratie>("registraties");
  const uit: Registratie[] = [];
  for (const r of alle) if (r.lokaal && (await heeftWachtende(r.id))) uit.push(r);
  return uit;
}
