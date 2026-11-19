import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiFout } from "./fouten.js";

export type Rol = "operator" | "ploegleider" | "kwaliteit" | "beheerder" | "analist" | "planner" | "scherm";

/** Inhoud van het token. Een token werkt in de browser én in een latere desktop-app. */
export interface Sessie {
  sub: string;          // gebruiker.id
  naam: string;         // gebruikersnaam
  rol: Rol;
  pcId?: string;        // pc waarop is ingelogd
  operatorId?: string;  // gekozen naam uit de operatorlijst
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
export const IEDEREEN: Rol[] = ["operator", "ploegleider", "kwaliteit", "beheerder", "analist", "planner"];

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

/** Voor invoer: het token moet een pc én een gekozen operatornaam bevatten. */
export function invoerContext(req: FastifyRequest): { pcId: string; operatorId: string } {
  const { pcId, operatorId } = req.user;
  if (!pcId) throw new ApiFout(400, "Geen pc bekend; log in vanaf een geregistreerde pc");
  if (!operatorId) throw new ApiFout(400, "Kies eerst je naam");
  return { pcId, operatorId };
}

export function registreerAuth(app: FastifyInstance, geheim: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return app.register(import("@fastify/jwt"), { secret: geheim, sign: { expiresIn: "12h" } });
}
