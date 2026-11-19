import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, vereist, type Rol, type Sessie } from "../auth.js";
import { ApiFout } from "../fouten.js";
import { lees } from "../db.js";

const TokenAntwoord = Type.Object({
  token: Type.String(),
  rol: Type.String(),
  naamKiezen: Type.Boolean({ description: "true: kies eerst een naam via /auth/operator" }),
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
      const [gebruiker] = await lees<{ id: string; rol: Rol }>(app.db, "SELECT * FROM controleer_login($1, $2)", [
        gebruikersnaam,
        wachtwoord,
      ]);
      if (!gebruiker) throw new ApiFout(401, "Onjuiste gebruikersnaam of wachtwoord");

      let pcId: string | undefined;
      if (pc) {
        const [rij] = await lees<{ id: string }>(app.db, "SELECT id FROM pc WHERE naam = $1 AND actief", [pc]);
        if (!rij) throw new ApiFout(400, `Onbekende pc ${pc}`);
        pcId = rij.id;
      }
      if (gebruiker.rol === "operator" && !pcId) {
        throw new ApiFout(400, "Operators loggen in vanaf een geregistreerde pc");
      }
      const sessie: Sessie = { sub: gebruiker.id, naam: gebruikersnaam, rol: gebruiker.rol, pcId };
      // Een wandscherm blijft dagen aan staan: langer geldig token (het mag alleen het wandscherm lezen).
      const token = gebruiker.rol === "scherm" ? app.jwt.sign(sessie, { expiresIn: "30d" }) : app.jwt.sign(sessie);
      return { token, rol: gebruiker.rol, naamKiezen: gebruiker.rol === "operator" };
    },
  );

  // Namenlijst om uit te kiezen na het inloggen.
  app.get(
    "/operators",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["inloggen"],
        response: { 200: Type.Array(Type.Object({ id: Type.String(), naam: Type.String() })) },
      },
    },
    async () => (await lees(app.db, "SELECT id, naam FROM operator WHERE actief ORDER BY naam")) as never,
  );

  // Naam kiezen: geeft een nieuw token met de gekozen operator.
  app.post(
    "/operator",
    {
      preHandler: vereist("operator", "ploegleider"),
      schema: {
        tags: ["inloggen"],
        body: Type.Object({ operatorId: Type.String({ format: "uuid" }) }),
        response: { 200: TokenAntwoord },
      },
    },
    async (req) => {
      const [rij] = await lees(app.db, "SELECT 1 FROM operator WHERE id = $1 AND actief", [req.body.operatorId]);
      if (!rij) throw new ApiFout(400, "Onbekende naam");
      const { sub, naam, rol, pcId } = req.user;
      const sessie: Sessie = { sub, naam, rol, pcId, operatorId: req.body.operatorId };
      return { token: app.jwt.sign(sessie), rol, naamKiezen: false };
    },
  );
};

export default routes;
