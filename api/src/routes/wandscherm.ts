import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ingelogd } from "../auth.js";
import { ApiFout } from "../fouten.js";

// D99/D101: uitgebreide productie- en kwaliteitswandschermen horen in fase 9.
// Beperkte display-identiteit behoudt uitsluitend de bestaande afzonderlijke
// display.downtime.read-interface via GET /stilstand.
const routes: FastifyPluginAsyncTypebox = async (app) => {
  const geblokkeerd = async () => { throw new ApiFout(403, "Uitgebreid wandscherm tijdelijk geblokkeerd tot fase 9"); };
  app.get("/", { preHandler: ingelogd }, geblokkeerd);
  app.get("/kwaliteit", { preHandler: ingelogd }, geblokkeerd);
};

export default routes;
