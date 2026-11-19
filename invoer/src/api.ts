import { opslag } from "./opslag";
import { sessie } from "./sessie";

export class ApiFout extends Error {
  constructor(public status: number, bericht: string) {
    super(bericht);
  }
}

/** Geen antwoord van de server (netwerk weg of server uit). */
export class GeenVerbinding extends Error {
  constructor() {
    super("Geen verbinding met de server");
  }
}

export async function stuur<T>(methode: string, pad: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (sessie.token) headers.authorization = `Bearer ${sessie.token}`;
  let r: Response;
  try {
    r = await fetch(pad, { method: methode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new GeenVerbinding();
  }
  const tekst = await r.text();
  const data = tekst ? JSON.parse(tekst) : null;
  if (!r.ok) throw new ApiFout(r.status, data?.fout ?? `Fout ${r.status}`);
  return data as T;
}

/**
 * GET met terugval op de laatst bekende versie. `vers` geeft aan of het
 * antwoord nu van de server kwam.
 */
export async function haal<T>(pad: string): Promise<{ data: T; vers: boolean }> {
  try {
    const data = await stuur<T>("GET", pad);
    opslag.zet("cache", data, pad).catch(() => {});
    return { data, vers: true };
  } catch (e) {
    if (!(e instanceof GeenVerbinding)) throw e;
    const bewaard = await opslag.haal<T>("cache", pad);
    if (bewaard === undefined) throw e;
    return { data: bewaard, vers: false };
  }
}

export const nieuwId = (): string =>
  crypto.randomUUID?.() ??
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
  );
