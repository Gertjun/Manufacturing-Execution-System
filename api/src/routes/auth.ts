import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { INVOER, ingelogd, vereist, type Rol, type Sessie } from "../auth.js";
import { ApiFout } from "../fouten.js";
import { inTransactie, lees } from "../db.js";

const TokenAntwoord = Type.Object({
  token: Type.String(),
  rol: Type.String(),
  naamKiezen: Type.Boolean({ description: "Compatibiliteitsveld; altijd false" }),
  operator: Type.Optional(Type.Union([Type.Null(), Type.Object({ id: Type.String(), naam: Type.String() })], {
    description: "De naam waaronder dit account invoert (eigen account, D53); null bij een gedeeld account of een rol zonder invoer",
  })),
  wachtwoordWijzigen: Type.Optional(Type.Boolean({
    description: "true: het wachtwoord is tijdelijk; kies eerst een eigen wachtwoord via /auth/wachtwoord. Het token mag tot dan niets anders (#76).",
  })),
});

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // Inloggen. Een pc onthoudt zijn eigen naam (bv. PC-07) en stuurt die mee.
  app.post(
    "/login",
    {
      schema: {
        tags: ["inloggen"],
        security: [],
        body: Type.Object({
          gebruikersnaam: Type.String({ minLength: 1 }),
          wachtwoord: Type.String({ minLength: 1 }),
          pc: Type.Optional(Type.String({ description: "Naam van de pc, bv. PC-07" })),
        }),
        response: { 200: TokenAntwoord },
      },
    },
    async (req) => {
      const { gebruikersnaam, wachtwoord, pc } = req.body;
      // inloggen() legt elke poging vast en laat na 5 mislukte pogingen binnen 15 minuten 1 minuut wachten (D45).
      const [uitkomst] = await inTransactie(app.db, "inloggen", async (tx) =>
        (await tx.query<{ id: string | null; rol: Rol | null; gebruikersnaam: string | null; wacht_seconden: number | null; session_version: number; ww: boolean }>(
          "SELECT * FROM login_with_session($1, $2, $3)", [gebruikersnaam, wachtwoord, pc ?? null])).rows);
      if (uitkomst?.wacht_seconden) {
        throw new ApiFout(429, `Te vaak een verkeerd wachtwoord. Wacht ${uitkomst.wacht_seconden} seconden en probeer het opnieuw.`);
      }
      if (!uitkomst?.id) throw new ApiFout(401, "Onjuiste gebruikersnaam of wachtwoord");
      const gebruiker = { id: uitkomst.id, rol: uitkomst.rol as Rol, naam: uitkomst.gebruikersnaam as string };

      let pcId: string | undefined;
      if (pc) {
        const [rij] = await lees<{ id: string }>(app.db, "SELECT id FROM pc WHERE naam = $1 AND actief", [pc]);
        if (!rij) throw new ApiFout(400, `Onbekende pc ${pc}`);
        pcId = rij.id;
      }
      // Zonder pc mag ook (startpagina, D54); invoeren vraagt een pc (invoerContext), die komt via /auth/pc.
      // Eigen account: de naam waaronder je invoert ligt vast (D53). Gedeeld account: naam kiezen (D6).
      // Twee stappen: operator_van_account kan een naam aanmaken, die een query pas in de volgende stap ziet.
      const [ac] = await inTransactie(app.db, gebruiker.naam, async (tx) => {
        const { rows: [o] } = await tx.query<{ id: string | null }>("SELECT operator_van_account($1) AS id", [gebruiker.id]);
        return (await tx.query<{ gedeeld: boolean; operator_id: string | null; operatornaam: string | null; ww: boolean }>(
          `SELECT g.gedeeld, o.id AS operator_id, o.naam AS operatornaam, g.wachtwoord_wijzigen AS ww
             FROM gebruiker g LEFT JOIN operator o ON o.id = $2
            WHERE g.id = $1`, [gebruiker.id, o?.id ?? null])).rows;
      });
      if (!ac || ac.gedeeld) throw new ApiFout(403, "Log in met een persoonlijk account");
      const gedeeld = false;
      const sessie: Sessie = { sub: gebruiker.id, naam: gebruiker.naam, rol: gebruiker.rol, sessionVersion: uitkomst.session_version, pcId,
        ...(ac?.operator_id ? { operatorId: ac.operator_id } : {}), ...(gedeeld ? { gedeeld } : {}), ...(uitkomst.ww ? { ww: true } : {}) };
      // Een wandscherm blijft dagen aan staan: langer geldig token (het mag alleen het wandscherm lezen).
      const token = gebruiker.rol === "scherm" ? app.jwt.sign(sessie, { expiresIn: "30d" }) : app.jwt.sign(sessie);
      return {
        token, rol: gebruiker.rol,
        naamKiezen: gedeeld && INVOER.includes(gebruiker.rol),
        operator: ac?.operator_id ? { id: ac.operator_id, naam: ac.operatornaam as string } : null,
        ...(uitkomst.ww ? { wachtwoordWijzigen: true } : {}),
      };
    },
  );

  // Eigen wachtwoord wijzigen (#76, D61): verplicht na een tijdelijk wachtwoord, en altijd mogelijk.
  // Geeft een nieuw token zonder de beperking van het tijdelijke wachtwoord.
  app.post(
    "/wachtwoord",
    {
      preHandler: ingelogd,
      schema: {
        tags: ["inloggen"],
        body: Type.Object({ huidig: Type.String({ minLength: 1 }), nieuw: Type.String({ minLength: 8, maxLength: 200 }) }),
        response: { 200: TokenAntwoord },
      },
    },
    async (req) => {
      const result = await inTransactie(app.db, req.user.naam, async (tx) =>
        (await tx.query<{status:string;session_version:number}>("SELECT * FROM change_password_session($1,$2,$3,$4)",[req.user.sub,req.user.sessionVersion,req.body.huidig,req.body.nieuw])).rows[0]);
      const status = result?.status;
      if (status === "stale") throw new ApiFout(401,"Account gewijzigd; log opnieuw in");
      if (status === "locked") throw new ApiFout(429,"Te veel wachtwoordpogingen; probeer het later opnieuw");
      if (status !== "changed") throw new ApiFout(422,"Het huidige wachtwoord klopt niet");
      const { sub, naam, rol, pcId, operatorId, gedeeld } = req.user;
      const sessie: Sessie = { sub, naam, rol, sessionVersion: result.session_version, ...(pcId ? { pcId } : {}), ...(operatorId ? { operatorId } : {}), ...(gedeeld ? { gedeeld } : {}) };
      const [o] = operatorId ? await lees<{ naam: string }>(app.db, "SELECT naam FROM operator WHERE id = $1", [operatorId]) : [];
      return {
        token: rol === "scherm" ? app.jwt.sign(sessie, { expiresIn: "30d" }) : app.jwt.sign(sessie), rol,
        naamKiezen: !!gedeeld && !operatorId && INVOER.includes(rol),
        operator: operatorId && o ? { id: operatorId, naam: o.naam } : null,
      };
    },
  );

  // Van de startpagina naar het invoerscherm (D54): hetzelfde account, nu met de pc erbij.
  // Werkstationbinding is geen wachtwoordauthenticatie (D94); geen geslaagde inlogpoging registreren.
  app.post(
    "/pc",
    {
      preHandler: vereist(...INVOER, "kwaliteit"),   // Kwaliteit: de lab-pc (sinds 0.37.0, #64)
      schema: {
        tags: ["inloggen"],
        description: "Geeft een token met de pc erbij, voor het invoerscherm. Voor wie al op de startpagina is ingelogd.",
        body: Type.Object({ pc: Type.String({ minLength: 1, maxLength: 100 }) }),
        response: { 200: TokenAntwoord },
      },
    },
    async (req) => {
      const [rij] = await lees<{ id: string }>(app.db, "SELECT id FROM pc WHERE naam = $1 AND actief", [req.body.pc]);
      if (!rij) throw new ApiFout(400, `Onbekende pc ${req.body.pc}`);
      const [ac] = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows: [o] } = await tx.query<{ id: string | null }>("SELECT operator_van_account($1) AS id", [req.user.sub]);
        return (await tx.query<{ actief: boolean; gedeeld: boolean; operator_id: string | null; operatornaam: string | null }>(
          `SELECT g.actief, g.gedeeld, o.id AS operator_id, o.naam AS operatornaam
             FROM gebruiker g LEFT JOIN operator o ON o.id = $2 WHERE g.id = $1`, [req.user.sub, o?.id ?? null])).rows;
      });
      if (!ac?.actief || ac.gedeeld) throw new ApiFout(401, "Dit account staat uit");
      const { sub, naam, rol } = req.user;
      const sessie: Sessie = { sub, naam, rol, sessionVersion: req.user.sessionVersion, pcId: rij.id,
        ...(ac.operator_id ? { operatorId: ac.operator_id } : {}), ...(ac.gedeeld ? { gedeeld: true } : {}) };
      return {
        token: app.jwt.sign(sessie), rol,
        naamKiezen: ac.gedeeld,
        operator: ac.operator_id ? { id: ac.operator_id, naam: ac.operatornaam as string } : null,
      };
    },
  );

};

export default routes;
