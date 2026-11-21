import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiFout } from "./fouten.js";
import { inTransactie, lees, type Db, type Tx } from "./db.js";

export type Rol = "operator" | "ploegleider" | "kwaliteit" | "beheerder" | "analist" | "planner" | "scherm" | "productiemanager";

/** Inhoud van het token. Een token werkt in de browser én in een latere desktop-app. */
export interface Sessie {
  sub: string;          // gebruiker.id
  naam: string;         // gebruikersnaam
  rol: Rol;
  pcId?: string;        // pc waarop is ingelogd
  operatorId?: string;  // eigen naam van het account (D53), of bij een gedeeld account de gekozen naam
  gedeeld?: boolean;    // het oude gedeelde operatoraccount: kiest een naam (D6, vervalt met D53)
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: Sessie;
    user: Sessie;
  }
}

export const INVOER: Rol[] = ["operator", "ploegleider"];
export const LEIDING: Rol[] = ["ploegleider", "beheerder"];
export const BEHEER: Rol[] = ["beheerder"];
export const IEDEREEN: Rol[] = ["operator", "ploegleider", "kwaliteit", "beheerder", "analist", "planner", "productiemanager"];

/** preHandler: geldig token en een van de rollen. */
export function vereist(...rollen: Rol[]) {
  return async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new ApiFout(401, "Niet ingelogd of sessie verlopen");
    }
    if (!rollen.includes(req.user.rol)) {
      throw new ApiFout(403, `Rol ${req.user.rol} mag dit niet`);
    }
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kop(req: FastifyRequest, naam: string): string | undefined {
  const w = req.headers[naam];
  return typeof w === "string" && w.length <= 64 ? w : undefined;
}

/**
 * Operator die de invoer deed. De offline wachtrij stuurt de operator mee die
 * op het moment van invoer was gekozen (kop x-batchgui-operator); anders geldt
 * de operator uit het token (D43). Alleen voor invoerrollen.
 */
export function operatorVan(req: FastifyRequest): string | undefined {
  const k = kop(req, "x-batchgui-operator");
  if (k && UUID.test(k) && INVOER.includes(req.user.rol)) return k.toLowerCase();
  return req.user.operatorId;
}

/**
 * Moment van invoer op het apparaat, gecorrigeerd voor een afwijkende klok:
 * de wachtrij stuurt het moment van invoer (x-batchgui-moment) en het moment
 * van versturen (x-batchgui-verzonden), beide met de klok van het apparaat.
 * Het verschil tussen versturen en de servertijd is de klokafwijking.
 * Zonder kop: null (de database gebruikt dan de servertijd).
 */
export function apparaatMoment(req: FastifyRequest): string | null {
  const m = Date.parse(kop(req, "x-batchgui-moment") ?? "");
  if (Number.isNaN(m)) return null;
  const v = Date.parse(kop(req, "x-batchgui-verzonden") ?? "");
  const afwijking = Number.isNaN(v) ? 0 : Date.now() - v;
  return new Date(m + afwijking).toISOString();
}

/** Transactie voor invoer, met het moment van het apparaat (D43). */
export function invoerTransactie<T>(db: Db, req: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransactie(db, req.user.naam, fn, apparaatMoment(req));
}

/**
 * Voor invoer: het token moet een pc bevatten, en er moet een operator bekend zijn.
 * Staat de invoer op een andere naam dan die van het account (de wachtrij na een persoonswissel),
 * dan beslist de database of dat mag (mag_invoeren_namens, D53).
 */
export async function invoerContext(db: Db, req: FastifyRequest): Promise<{ pcId: string; operatorId: string }> {
  const { pcId } = req.user;
  const operatorId = operatorVan(req);
  if (!pcId) throw new ApiFout(400, "Geen pc bekend; log in vanaf een geregistreerde pc");
  if (!operatorId) throw new ApiFout(400, req.user.gedeeld ? "Kies eerst je naam" : "Je account heeft geen naam; log opnieuw in");
  if (operatorId !== req.user.operatorId) {
    const [r] = await lees<{ mag: boolean; naam: string | null }>(db,
      "SELECT mag_invoeren_namens($1, $2, $3) AS mag, (SELECT naam FROM operator WHERE id = $2) AS naam", [req.user.sub, operatorId, pcId]);
    if (!r?.mag) {
      throw new ApiFout(403, `Deze invoer staat op naam van ${r?.naam ?? "een onbekende naam"}, die de laatste 7 dagen niet op deze pc heeft ingelogd. Een ploegleider kan hem bekijken.`);
    }
  }
  return { pcId, operatorId };
}

export function registreerAuth(app: FastifyInstance, geheim: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return app.register(import("@fastify/jwt"), { secret: geheim, sign: { expiresIn: "12h" } });
}
