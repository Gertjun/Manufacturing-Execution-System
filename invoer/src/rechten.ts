import { GeenVerbinding, stuur } from "./api";
import { sessie } from "./sessie";

interface Projectie { global: string[]; products: { permission: string; product: string }[]; personal: boolean; linkedPerson: boolean }
let projectie: Projectie | null = null;
let tokenVanProjectie: string | null = null;
let generatie = 0;
let online = false;

// Alleen in geheugen, uitsluitend voor hetzelfde token. Offline is dit een
// UI-hulpmiddel, nooit bewijs voor de server of een bevestigde beslissing.
export function rechten(): Projectie | null {
  return sessie.geldig() && tokenVanProjectie === sessie.token ? projectie : null;
}
export const heeftRecht = (...codes: string[]) => codes.some(c => rechten()?.global.includes(c));
export const heeftProductRecht = (product: string | null | undefined, ...codes: string[]) =>
  heeftRecht(...codes) || !!product && !!rechten()?.products.some(p => p.product === product && codes.includes(p.permission));
export const magInvoer = () => !!rechten()?.personal && !!rechten()?.linkedPerson &&
  heeftRecht("execution.read","inspection.read","engineering.execution.read","analysis.execution.read") &&
  ["execution.start","execution.record","execution.complete","execution.correct","inspection.start","inspection.record","inspection.decide"].some(c =>
    heeftRecht(c) || rechten()?.products.some(p => p.permission === c));
export const rechtenOnline = () => online && !!rechten();
export async function vernieuwRechten(): Promise<boolean> {
  const token = sessie.token;
  const g = ++generatie;
  online = false;
  if (!token || token !== tokenVanProjectie) { projectie = null; tokenVanProjectie = null; }
  if (!token) return false;
  try {
    const r = await stuur<Projectie>("GET","/auth/permissions",undefined,{authorization:"Bearer "+token});
    if (g !== generatie || token !== sessie.token) return false;
    projectie = r; tokenVanProjectie = token; online = true;
    return true;
  } catch(e) {
    if (g !== generatie || token !== sessie.token) return false;
    if (e instanceof GeenVerbinding) return !!rechten();
    projectie = null; tokenVanProjectie = null;
    throw e;
  }
}
