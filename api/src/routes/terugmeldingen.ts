import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { personalSession } from "../modules/authorization/access.js";
import { ApiFout } from "../fouten.js";

// D99/D101: uitgestelde pilotfunctionaliteit (fase 9).
// Historische gegevens en technische registratie blijven intact.
const routes: FastifyPluginAsyncTypebox = async (app) => {
  const geblokkeerd = async () => { throw new ApiFout(403, "Pilotfunctionaliteit tijdelijk geblokkeerd tot fase 9"); };
  app.post("/", { preHandler: personalSession }, geblokkeerd);
  app.get("/", { preHandler: personalSession }, geblokkeerd);
  app.post("/:id/afhandelen", { preHandler: personalSession }, geblokkeerd);
};

export default routes;
