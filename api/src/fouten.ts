import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

/** Fout die de API zelf opgooit, met HTTP-status. */
export class ApiFout extends Error {
  constructor(public status: number, bericht: string) {
    super(bericht);
  }
}

/** Leesbare meldingen voor dubbele waarden. */
const UNIEK: Record<string, string> = {
  batch_batchnummer_key: "Dit batchnummer bestaat al",
  lot_lotnummer_key: "Dit lotnummer bestaat al",
  veld_code_key: "Deze veldcode bestaat al",
  waarde_een_origineel: "Dit veld is al ingevuld; een ploegleider kan corrigeren",
  gebruiker_gebruikersnaam_key: "Deze gebruikersnaam bestaat al",
  gebruiker_naam_klein: "Deze gebruikersnaam bestaat al (hoofdletters tellen niet mee)",
};

interface PgFout {
  code?: string;
  message: string;
  constraint?: string;
}

/**
 * Vertaalt fouten naar een vaste vorm: { fout: "..." }.
 * Regels uit de database (RAISE EXCEPTION) komen als 422 met hun eigen tekst terug,
 * zodat de invoerapplicatie die direct aan de operator kan tonen.
 */
export function foutAfhandeling(err: FastifyError | ApiFout | PgFout, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ApiFout) {
    return reply.status(err.status).send({ fout: err.message });
  }
  const pgCode = (err as PgFout).code;
  switch (pgCode) {
    case "P0001": // RAISE EXCEPTION uit een databaseregel
      return reply.status(422).send({ fout: err.message });
    case "23514": // CHECK
      return reply.status(422).send({ fout: CONTROLE[(err as PgFout).constraint ?? ""] ?? `Ongeldige invoer (${(err as PgFout).constraint ?? "controle"})` });
    case "23505": { // UNIQUE
      const c = (err as PgFout).constraint ?? "";
      return reply.status(409).send({ fout: UNIEK[c] ?? `Bestaat al (${c || "uniek"})` });
    }
    case "23503": // FOREIGN KEY
      return reply.status(422).send({ fout: "Verwijst naar iets dat niet bestaat" });
    case "22P02":
      return reply.status(400).send({ fout: "Ongeldige waarde" });
  }
  const fe = err as FastifyError;
  if (fe.validation) {
    return reply.status(400).send({ fout: fe.message });
  }
  if (fe.statusCode && fe.statusCode < 500) {
    return reply.status(fe.statusCode).send({ fout: fe.message });
  }
  req.log.error(err);
  return reply.status(500).send({ fout: "Interne fout" });
}

export const niet = (wat: string) => new ApiFout(404, `${wat} niet gevonden`);

/** Leesbare controles die de database doet (CHECK), voor meldingen per regel. */
const CONTROLE: Record<string, string> = {
  veld_check: "De ondergrens is hoger dan de bovengrens",
  veld_check1: "Alleen een procesparameter heeft een tolerantie",
  veld_tolerantie_check: "De tolerantie kan niet negatief zijn",
  veld_decimalen_check: "Decimalen moet een getal van 0 tot en met 6 zijn",
};

/** Een fout als korte Nederlandse tekst (voor meldingen per regel, bijvoorbeeld bij een import). */
export function leesbaar(e: unknown): string {
  if (e instanceof ApiFout) return e.message;
  const f = e as PgFout;
  if (f.code === "P0001") return f.message;
  if (f.code === "23514") return CONTROLE[f.constraint ?? ""] ?? `Ongeldige invoer (${f.constraint ?? "controle"})`;
  if (f.code === "23505") return UNIEK[f.constraint ?? ""] ?? "Bestaat al";
  if (f.code === "22P02" || f.code === "22003") return "Ongeldige waarde";
  return (e as Error).message ?? "Onbekende fout";
}
