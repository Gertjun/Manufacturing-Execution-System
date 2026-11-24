// Offline wachtrij. Elke invoer wordt eerst lokaal bewaard en daarna, op
// volgorde, naar de server gestuurd. Alles krijgt een id van dit apparaat,
// dus opnieuw versturen na een haperende verbinding maakt nooit dubbele records.
import { ApiFout, GeenVerbinding, stuur } from "./api";
import { opslag } from "./opslag";
import { sessie } from "./sessie";
import type { Registratie } from "./types";

export interface Actie {
  volgnr?: number;
  omschrijving: string;
  methode: "POST";
  pad: string;
  body?: unknown;
  /** Registratie waar deze actie bij hoort (voor de lokale kopie). */
  registratieId?: string;
  status: "wacht" | "fout" | "beoordeling";
  fout?: string;
  /** Moment van invoer op dit apparaat; gaat mee naar de server (D43). */
  aangemaakt: string;
  /** Operator die de actie invoerde. Acties van vóór 0.20.0 hebben dit niet. */
  userId?: string;
  operatorId?: string;
  operatornaam?: string;
}

export interface Status {
  verbonden: boolean;
  wacht: number;
  fout: number;
  inloggenNodig: boolean;
}

let status: Status = { verbonden: navigator.onLine, wacht: 0, fout: 0, inloggenNodig: false };
const luisteraars = new Set<(s: Status) => void>();
let bezig = false;
let opnieuw: number | undefined;

export function opStatus(fn: (s: Status) => void) {
  luisteraars.add(fn);
  fn(status);
  return () => luisteraars.delete(fn);
}

function meld(wijziging: Partial<Status>) {
  status = { ...status, ...wijziging };
  luisteraars.forEach((fn) => fn(status));
}

async function tel() {
  const acties = await opslag.alle<Actie>("wachtrij");
  meld({ wacht: acties.filter((a) => a.status === "wacht").length, fout: acties.filter((a) => a.status !== "wacht").length });
}

export async function acties(): Promise<Actie[]> {
  return opslag.alle<Actie>("wachtrij");
}

export async function voegToe(actie: Omit<Actie, "status" | "aangemaakt" | "operatorId" | "operatornaam" | "userId">) {
  await opslag.zet("wachtrij", {
    ...actie,
    status: "wacht",
    aangemaakt: new Date().toISOString(),
    userId: sessie.inhoud()?.sub,
    operatorId: sessie.inhoud()?.operatorId,
    operatornaam: sessie.operatornaam ?? undefined,
  });
  await tel();
  void verwerk();
}

export async function verwijder(volgnr: number) {
  const actie = await opslag.haal<Actie>("wachtrij", volgnr);
  if (!actie || actie.status !== "fout" || !actie.userId || actie.userId !== sessie.inhoud()?.sub || actie.operatorId !== sessie.inhoud()?.operatorId || actie.fout?.startsWith("Persoonlijke herkomst")) return;
  await opslag.weg("wachtrij", volgnr);
  await tel();
}

/** Heeft deze registratie nog acties in de wachtrij (behalve `behalve`)? */
export async function heeftWachtende(registratieId: string, behalve?: number): Promise<boolean> {
  const alle = await opslag.alle<Actie>("wachtrij");
  return alle.some((a) => a.registratieId === registratieId && a.volgnr !== behalve);
}

/** Bewaar wat de server teruggaf, tenzij er nog lokale wijzigingen onderweg zijn. */
async function bewaarAntwoord(antwoord: unknown, volgnr: number) {
  const a = antwoord as { id?: string; stapcode?: string; registratie?: Registratie } | null;
  const reg = a?.registratie ?? (a?.id && a?.stapcode ? (a as Registratie) : null);
  if (reg && !(await heeftWachtende(reg.id, volgnr))) {
    await opslag.zet("registraties", { ...reg, lokaal: false });
  }
}

/** Wie en wanneer: het moment van invoer en van versturen (zelfde klok), en de operator. */
function koppen(a: Actie): Record<string, string> {
  const k: Record<string, string> = { "x-batchgui-moment": a.aangemaakt, "x-batchgui-verzonden": new Date().toISOString() };
  if (a.operatorId) k["x-batchgui-operator"] = a.operatorId;
  return k;
}

/** Vraag de browser de wachtrij niet op te ruimen bij weinig schijfruimte. */
export async function vasteOpslag(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false);
  } catch {
    return false;
  }
}

export async function verwerk(): Promise<void> {
  if (bezig || status.inloggenNodig) return;
  bezig = true;
  try {
    for (;;) {
      const alle = await opslag.alle<Actie>("wachtrij");
      const identiteit = sessie.inhoud();
      if (!sessie.geldig() || !identiteit || identiteit.gedeeld) { meld({ inloggenNodig: true }); break; }
      const volgende = alle.find((a) => a.status === "wacht");
      if (!volgende) break;
      // Onzekere herkomst of andere persoon: niets versturen of heretiketteren.
      if (!volgende.userId || volgende.userId !== identiteit.sub || volgende.operatorId !== identiteit.operatorId) {
        await opslag.zet("wachtrij", { ...volgende, status: "beoordeling", fout: "Persoonlijke herkomst niet bevestigd; bewaard voor gecontroleerde beoordeling" });
        await tel();
        continue;
      }
      try {
        const token = sessie.token;
        if (!token || sessie.inhoud()?.sub !== identiteit.sub) break;
        const antwoord = await stuur("POST", volgende.pad, volgende.body, { ...koppen(volgende), authorization: `Bearer ${token}` });
        meld({ verbonden: true });
        await bewaarAntwoord(antwoord, volgende.volgnr!);
        await opslag.weg("wachtrij", volgende.volgnr!);
      } catch (e) {
        if (e instanceof GeenVerbinding) {
          meld({ verbonden: false });
          break; // later opnieuw, volgorde blijft bewaard
        }
        if (e instanceof ApiFout && e.status === 401) {
          meld({ verbonden: true, inloggenNodig: true });
          break;
        }
        // De server weigert: bewaren met de melding, zodat iemand ernaar kan kijken.
        meld({ verbonden: true });
        await opslag.zet("wachtrij", { ...volgende, status: "fout", fout: (e as Error).message });
      }
      await tel();
    }
  } finally {
    bezig = false;
    await tel();
  }
}

export function inloggenGelukt() {
  meld({ inloggenNodig: false });
  void verwerk();
}

/** Controleer de verbinding (ook als er niets in de wachtrij staat). */
async function peil() {
  try {
    await stuur("GET", "/gezondheid");
    meld({ verbonden: true });
    void verwerk();
  } catch {
    meld({ verbonden: false });
  }
}

export function startWachtrij() {
  window.addEventListener("online", () => void peil());
  window.addEventListener("offline", () => meld({ verbonden: false }));
  clearInterval(opnieuw);
  opnieuw = window.setInterval(() => (status.wacht > 0 ? void verwerk() : void peil()), 10_000);
  void tel().then(peil);
  void vasteOpslag();
}
