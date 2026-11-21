import { Type } from "@fastify/type-provider-typebox";

const Tijd = Type.String({ format: "date-time" });
const OptTijd = Type.Union([Tijd, Type.Null()]);
/**
 * Getal of null. Bewust een JSON-schema met twee types in plaats van anyOf: Fastify zet invoer om
 * (coerceTypes) en zou bij anyOf [null, getal] de waarde 0 omzetten naar null (0.23.0).
 */
export const NulGetal = (o: Record<string, unknown> = {}) => Type.Unsafe<number | null>({ type: ["number", "null"], ...o });
/** Geheel getal of null; zie NulGetal. */
export const NulGeheel = (o: Record<string, unknown> = {}) => Type.Unsafe<number | null>({ type: ["integer", "null"], ...o });
const OptGetal = NulGetal();
const OptTekst = Type.Union([Type.Null(), Type.String()]);

export const Markering = Type.Union([Type.Literal("ok"), Type.Literal("buiten_tolerantie"), Type.Literal("buiten_grens")]);

export const Fout = Type.Object({ fout: Type.String() });

export const BatchNummer = Type.String({ pattern: "^B-[0-9]{4}-[0-9]{4}$", examples: ["B-2026-0161"] });
export const LotNummer = Type.String({ pattern: "^L-[0-9]{4}-[0-9]{4}$", examples: ["L-2026-0042"] });
export const StapCode = Type.String({ pattern: "^PS[0-9]+$", examples: ["PS3"] });

export const RegistratieKort = Type.Object({
  id: Type.String({ format: "uuid" }),
  stapcode: Type.String(),
  stapnaam: Type.String(),
  niveau: Type.String(),
  batchnummer: OptTekst,
  lotnummer: OptTekst,
  poging: Type.Integer(),
  herbewerking_start: Type.Boolean(),
  reden: OptTekst,
  status: Type.Union([Type.Literal("open"), Type.Literal("afgerond"), Type.Literal("afgebroken")]),
  operator: Type.String(),
  pc: Type.String(),
  gestart_op: Tijd,
  afgerond_op: OptTijd,
  product: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Productcode van de batch of het lot (D55)" })),
  afgerond_door: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Wie de stap afrondde; kan een ander zijn dan wie startte (#55). Leeg vóór 0.39.0." })),
  afgerond_pc: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Pc waarop de stap werd afgerond (#55)" })),
});

export const VeldMetWaarde = Type.Object({
  code: Type.String(),
  naam: Type.String(),
  soort: Type.String(),
  eenheid: OptTekst,
  grens_min: OptGetal,
  grens_max: OptGetal,
  tolerantie: OptGetal,
  tolerantie_soort: Type.String(),
  verplicht: Type.Boolean(),
  decimalen: Type.Optional(NulGeheel({ description: "Aantal decimalen bij het tonen; leeg = automatisch" })),
  gemeten_door: Type.Optional(Type.Union([Type.Literal("productie"), Type.Literal("kwaliteit")], { description: "Wie meet (sinds 0.37.0, #64)" })),
  waarde: Type.Union([
    Type.Object({
      id: Type.String({ format: "uuid" }),
      setting: OptGetal,
      gemeten: Type.Number(),
      markering: Markering,
      gecorrigeerd: Type.Boolean(),
      ingevoerd_op: Tijd,
    }),
    Type.Null(),
  ]),
});

export const GrondstofMetGebruik = Type.Object({
  code: Type.String(),
  naam: Type.String(),
  eenheid: OptTekst,
  verplicht: Type.Boolean(),
  gebruik: Type.Union([
    Type.Object({
      id: Type.String({ format: "uuid" }),
      partij: Type.String(),
      hoeveelheid: OptGetal,
      gecorrigeerd: Type.Boolean(),
      ingevoerd_op: Tijd,
    }),
    Type.Null(),
  ]),
});

/** Keuring door Kwaliteit bij deze registratie (sinds 0.37.0, #64); leeg als de stap niets van Kwaliteit heeft. */
export const Keuring = Type.Object({
  id: Type.String({ format: "uuid" }),
  status: Type.Union([Type.Literal("open"), Type.Literal("vrijgegeven"), Type.Literal("herbewerken"), Type.Literal("afgekeurd")]),
  reden: OptTekst,
  besloten_door: OptTekst,
  besloten_op: OptTijd,
});

export const RegistratieDetail = Type.Intersect([
  RegistratieKort,
  Type.Object({
    velden: Type.Array(VeldMetWaarde),
    grondstoffen: Type.Array(GrondstofMetGebruik),
    keuring: Type.Optional(Type.Union([Type.Null(), Keuring])),
  }),
]);

export const Batch = Type.Object({
  batchnummer: Type.String(),
  status: Type.String(),
  bron: Type.String(),
  lotnummer: OptTekst,
  aangemaakt_op: Tijd,
  laatst_afgeronde_stap: OptTekst,
  open_stap: OptTekst,
  product: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Productcode (D55)" })),
});

export const Besluit = Type.Object({
  besluit: Type.String(),
  reden: Type.String(),
  besloten_door: Type.String(),
  besloten_op: Tijd,
});

export const PaspoortRegel = Type.Object({
  batch_of_lot: Type.String(),
  stap: Type.String(),
  poging: Type.Integer(),
  herbewerking_reden: OptTekst,
  veld: Type.String(),
  veldnaam: Type.String(),
  eenheid: OptTekst,
  setting: OptGetal,
  gemeten: Type.Number(),
  grens_min: OptGetal,
  grens_max: OptGetal,
  tolerantie: OptGetal,
  tolerantie_soort: OptTekst,
  markering: Markering,
  gecorrigeerd: Type.Boolean(),
  operator: Type.String(),
  pc: Type.String(),
  afgerond_op: OptTijd,
  decimalen: Type.Optional(NulGeheel({ description: "Aantal decimalen bij het tonen; leeg = automatisch" })),
});

export const REGISTRATIE_SQL = `
  SELECT r.id, s.code AS stapcode, s.naam AS stapnaam, s.niveau, b.batchnummer, l.lotnummer,
         r.poging, r.herbewerking_start, r.reden, r.status, o.naam AS operator, p.naam AS pc,
         r.gestart_op, r.afgerond_op, pr.code AS product, ao.naam AS afgerond_door, ap.naam AS afgerond_pc
    FROM stapregistratie r
    LEFT JOIN operator ao ON ao.id = r.afgerond_door
    LEFT JOIN pc ap ON ap.id = r.afgerond_pc_id
    LEFT JOIN product pr ON pr.id = r.product_id
    JOIN processtap s ON s.id = r.processtap_id
    LEFT JOIN batch b ON b.id = r.batch_id
    LEFT JOIN lot l ON l.id = r.lot_id
    JOIN operator o ON o.id = r.operator_id
    JOIN pc p ON p.id = r.pc_id`;
