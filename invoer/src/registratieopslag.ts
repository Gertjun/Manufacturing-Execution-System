import { opslag } from "./opslag";
import { sessie } from "./sessie";
import type { Registratie } from "./types";

export function registratieIdentiteit(): string {
  const i = sessie.inhoud();
  if (!sessie.geldig() || !i?.sub || !i.operatorId) throw new Error("Persoonlijke sessie vereist");
  return i.sub + ":" + i.operatorId;
}
const sleutel = (id: string, identiteit: string) => "registratie:v2:" + identiteit + ":" + id;
// Oude gedeelde kopieën blijven ongemoeid; nieuwe kopieën krijgen een eigen sleutel.
export async function bewaarEigenRegistratie(reg: Registratie, identiteit: string) {
  await opslag.zet("cache", reg, sleutel(reg.id, identiteit));
}
export async function leesEigenRegistratie(id: string, identiteit: string) {
  return opslag.haal<Registratie>("cache", sleutel(id, identiteit));
}
