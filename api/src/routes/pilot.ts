import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { personalSession } from "../modules/authorization/access.js";
import { ApiFout } from "../fouten.js";

// D99/D101: uitgestelde pilotfunctionaliteit (fase 9).
// Historische gegevens en technische registratie blijven intact.
const routes: FastifyPluginAsyncTypebox = async (app) => {
  const geblokkeerd = async () => { throw new ApiFout(403, "Pilotfunctionaliteit tijdelijk geblokkeerd tot fase 9"); };
  app.get("/", { preHandler: personalSession }, geblokkeerd);
  app.put("/instellingen", { preHandler: personalSession }, geblokkeerd);
};

export default routes;
