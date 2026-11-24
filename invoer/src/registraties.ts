// Acties op registraties. Elke actie past eerst de lokale kopie aan en zet
// daarna een verzoek in de wachtrij. Zo werkt invoer ook zonder verbinding.
import { ApiFout, GeenVerbinding, haal, nieuwId, stuur } from "./api";
import { berekenMarkering } from "./markering";
import { sessie } from "./sessie";
import type { Registratie, Stap, VeldMetWaarde } from "./types";
import { acties, heeftWachtende, voegToe } from "./wachtrij";

import { heeftProductRecht } from "./rechten";
import { bewaarEigenRegistratie, leesEigenRegistratie, registratieIdentiteit } from "./registratieopslag";
let stappenCache: Stap[] | null = null;
let stappenToken: string | null = null;

/** Alle stappen met hun velden (laatst bekende versie als er geen verbinding is). */
export async function stappen(): Promise<Stap[]> {
  const token = sessie.token;
  if (stappenCache && stappenToken === token) return stappenCache;
  const data = (await haal<Stap[]>("/config/stappen")).data;
  if (token !== sessie.token) throw new Error("Sessie gewijzigd");
  stappenToken = token;
  return stappenCache = data;
}

export async function stap(code: string): Promise<Stap> {
  const s = (await stappen()).find((x) => x.code === code);
  if (!s) throw new Error(`Onbekende stap ${code}`);
  return s;
}

export function vergeetConfig() {
  stappenCache = null;
  stappenToken = null;
}

/** Velden voor een nieuwe registratie, met de grenzen van het product als dat eigen grenzen heeft (D55). */
function veldenUit(s: Stap, product?: string | null): VeldMetWaarde[] {
  return s.velden
    .filter((v) => v.actief)
    .map((v) => {
      const g = (product && v.per_product?.find((x) => x.product === product)) || v;
      return {
        code: v.code,
        naam: v.naam,
        soort: v.soort,
        eenheid: v.eenheid,
        grens_min: g.grens_min,
        grens_max: g.grens_max,
        tolerantie: g.tolerantie,
        tolerantie_soort: g.tolerantie_soort,
        verplicht: v.verplicht,
        decimalen: v.decimalen,
        gemeten_door: v.gemeten_door ?? "productie",
        waarde: null,
      };
    });
}

function lokaal(s: Stap, id: string, nummer: { batchnummer?: string; lotnummer?: string }, extra: Partial<Registratie> = {}, product?: string | null): Registratie {
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
    velden: veldenUit(s, product),
    product: product ?? null,
    grondstoffen: (s.grondstoffen ?? []).map((g) => ({ ...g, gebruik: null })),
    lokaal: true,
    ...extra,
  };
}

/** Start een stap voor een batch of lot. Geeft de (lokale) registratie terug. Met herbewerking (de reden): de server
 *  maakt van deze start de herbewerking die Kwaliteit of de productiemanager heeft aangemaakt (#61). */
export async function startStap(stapcode: string, nummer: { batchnummer?: string; lotnummer?: string }, product?: string | null, herbewerking?: string | null) {
  const s = await stap(stapcode);
  const id = nieuwId();
  const reg = lokaal(s, id, nummer, herbewerking ? { herbewerking_start: true, reden: herbewerking } : {}, product);
  await bewaarEigenRegistratie(reg, registratieIdentiteit());
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
export async function maakLot(lotnummer: string, batchnummers: string[], afwijkingReden?: string, product?: string | null) {
  const lotStap = (await stappen()).find((s) => s.is_lot_stap)!;
  const registratieId = nieuwId();
  const reg = lokaal(lotStap, registratieId, { lotnummer }, { poging: 1 }, product);
  await bewaarEigenRegistratie(reg, registratieIdentiteit());
  await voegToe({
    omschrijving: `Lot ${lotnummer} samenstellen (${batchnummers.join(", ")})`,
    methode: "POST",
    pad: "/lots",
    body: { id: nieuwId(), registratieId, lotnummer, batchnummers, ...(afwijkingReden ? { afwijkingReden } : {}) },
    registratieId,
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
  await bewaarEigenRegistratie(reg, registratieIdentiteit());
  await voegToe({
    omschrijving: `${reg.stapcode} ${reg.batchnummer ?? reg.lotnummer}: ${invoer.map((i) => i.code).join(", ")} opslaan`,
    methode: "POST",
    pad: `/registraties/${reg.id}/waarden`,
    body: { waarden },
    registratieId: reg.id,
  });
  return reg;
}

export interface GrondstofInvoer {
  code: string;
  partij: string;
  hoeveelheid: number | null;
}

export async function slaGrondstoffenOp(reg: Registratie, invoer: GrondstofInvoer[]) {
  const regels = invoer.map((g) => ({ id: nieuwId(), code: g.code, partij: g.partij, hoeveelheid: g.hoeveelheid }));
  const nu = new Date().toISOString();
  reg.grondstoffen = (reg.grondstoffen ?? []).map((g) => {
    const r = regels.find((x) => x.code === g.code);
    return r ? { ...g, gebruik: { id: r.id, partij: r.partij, hoeveelheid: r.hoeveelheid, gecorrigeerd: false, ingevoerd_op: nu, wacht: true } } : g;
  });
  reg.lokaal = true;
  await bewaarEigenRegistratie(reg, registratieIdentiteit());
  await voegToe({
    omschrijving: `${reg.stapcode} ${reg.batchnummer ?? reg.lotnummer}: grondstof ${invoer.map((g) => `${g.code} ${g.partij}`).join(", ")}`,
    methode: "POST",
    pad: `/registraties/${reg.id}/grondstoffen`,
    body: { grondstoffen: regels },
    registratieId: reg.id,
  });
  return reg;
}

/** Correctie van een grondstofregel door een ploegleider: alleen met verbinding. */
export async function corrigeerGrondstof(reg: Registratie, code: string, partij: string, hoeveelheid: number | null | undefined, reden: string) {
  // Met het id dat je zag: heeft een ander het intussen gecorrigeerd, dan weigert de server (#85).
  const vervangt = reg.grondstoffen?.find((g) => g.code === code)?.gebruik?.id;
  const identiteit = registratieIdentiteit();
  const antwoord = await stuur<Registratie>("POST", `/registraties/${reg.id}/grondstoffen/${encodeURIComponent(code)}/correctie`, {
    partij,
    ...(hoeveelheid === undefined ? {} : { hoeveelheid }),
    reden,
    ...(vervangt ? { vervangt } : {}),
  });
  await bewaarEigenRegistratie({ ...antwoord, lokaal: false }, identiteit);
  return antwoord;
}

/** Kritisch besluit: uitsluitend rechtstreeks, persoonlijk bevestigd, geen optimistische status. */
export async function beslisKeuring(reg: Registratie, besluit: "vrijgegeven" | "herbewerken" | "afgekeurd", reden: string | null, wachtwoord: string, stapcode?: string) {
  if (!reg.keuring || reg.lokaal || await heeftWachtende(reg.id)) throw new Error("Verstuur eerst alle invoer en laad de registratie opnieuw");
  if (!wachtwoord) throw new Error("Persoonlijke bevestiging vereist");
  const identiteit = registratieIdentiteit();
  const antwoord = await stuur<Registratie>("POST", `/keuringen/${reg.keuring.id}/besluit`, { besluit, reden, wachtwoord, ...(stapcode ? { stapcode } : {}) });
  await bewaarEigenRegistratie({ ...antwoord, lokaal: false }, identiteit);
  return antwoord;
}

export async function rondAf(reg: Registratie) {
  reg.status = "afgerond";
  reg.afgerond_op = new Date().toISOString();
  reg.lokaal = true;
  await bewaarEigenRegistratie(reg, registratieIdentiteit());
  await voegToe({
    omschrijving: `${reg.stapcode} ${reg.batchnummer ?? reg.lotnummer} afronden`,
    methode: "POST",
    pad: `/registraties/${reg.id}/afronden`,
    registratieId: reg.id,
  });
}

/** Correctie door een ploegleider: alleen met verbinding, want direct gecontroleerd. */
export async function corrigeer(reg: Registratie, veldcode: string, gemeten: number, setting: number | null | undefined, reden: string) {
  const vervangt = reg.velden?.find((v) => v.code === veldcode)?.waarde?.id;
  const identiteit = registratieIdentiteit();
  const antwoord = await stuur<Registratie>("POST", `/registraties/${reg.id}/waarden/${veldcode}/correctie`, {
    gemeten,
    ...(setting === undefined ? {} : { setting }),
    reden,
    ...(vervangt ? { vervangt } : {}),
  });
  await bewaarEigenRegistratie({ ...antwoord, lokaal: false }, identiteit);
  return antwoord;
}

/** Een conflict oplossen (#85): welke invoer blijft. Alleen met verbinding, zoals een correctie. */
export async function losConflictOp(reg: Registratie, id: string, keuze: "bestaand" | "nieuw", reden: string | null) {
  const identiteit = registratieIdentiteit();
  const antwoord = await stuur<Registratie>("POST", `/conflicten/${id}/oplossen`, { keuze, reden });
  await bewaarEigenRegistratie({ ...antwoord, lokaal: false }, identiteit);
  return antwoord;
}

/**
 * Haal een registratie: van de server als dat kan en er lokaal niets meer
 * onderweg is, anders de lokale kopie.
 */
export async function registratie(id: string): Promise<Registratie | undefined> {
  const identiteit = registratieIdentiteit();
  const token = sessie.token;
  const hier = await leesEigenRegistratie(id, identiteit);
  const eigen = (await acties()).filter(a => a.registratieId === id);
  const leesbaar = (reg: Registratie) => heeftProductRecht(reg.product, "execution.read","inspection.read","engineering.execution.read","analysis.execution.read");
  // Oude optimistische besluiten zijn geen serverbevestiging.
  const veilig = hier && leesbaar(hier) && !hier.keuring?.wacht && !eigen.some(a => a.status === "beoordeling" || /\/keuringen\//.test(a.pad));
  if (token !== sessie.token) throw new Error("Sessie gewijzigd");
  try {
    const vers = await stuur<Registratie>("GET", `/registraties/${id}`);
    if (token !== sessie.token) throw new Error("Sessie gewijzigd");
    if (veilig && eigen.some(a => a.status === "wacht" || a.status === "fout")) return hier;
    await bewaarEigenRegistratie({ ...vers, lokaal: false }, identiteit);
    return vers;
  } catch (e) {
    if (token !== sessie.token) throw new Error("Sessie gewijzigd");
    if (e instanceof GeenVerbinding && veilig) return hier;
    // Een eigen nieuw lokaal record kan nog niet bij de server bestaan.
    if (e instanceof ApiFout && e.status === 404 && veilig && hier.lokaal && eigen.some(a => a.status === "wacht" && (a.pad === "/registraties" || a.pad === "/lots"))) return hier;
    throw e;
  }
}

/** Alleen nieuwe persoonlijke lokale kopieën, nooit oude gedeelde records. */
export async function lokaleRegistraties(): Promise<Registratie[]> {
  const identiteit = registratieIdentiteit();
  const token = sessie.token;
  const eigen = await acties();
  const ids = [...new Set(eigen.filter(a => a.status === "wacht" && a.registratieId).map(a => a.registratieId!))];
  const uit: Registratie[] = [];
  for (const id of ids) {
    const r = await leesEigenRegistratie(id, identiteit);
    if (r?.lokaal && !r.keuring?.wacht && !eigen.some(a => a.registratieId === id && (a.status === "beoordeling" || /\/keuringen\//.test(a.pad))) &&
      heeftProductRecht(r.product,"execution.read","inspection.read","engineering.execution.read","analysis.execution.read")) uit.push(r);
  }
  return token === sessie.token ? uit : [];
}
