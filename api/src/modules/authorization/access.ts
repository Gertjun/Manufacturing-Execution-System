import type { FastifyRequest } from "fastify";
import { ApiFout } from "../../fouten.js";
import { ingelogd } from "../../auth.js";
import { lees, type Db, type Tx } from "../../db.js";

/** Alleen server-afgeleide context, nooit door de client opgegeven scope. */
export interface Target {
  area?: string;
  product?: string;
  equipment?: string;
}

/** De database is de gezaghebbende bron; geen rechten uit het JWT. */
export async function requirePermission(db: Db, userId: string, permission: string, target: Target = {}) {
  const [r] = await lees<{ allowed: boolean }>(db,
    "SELECT authorization_permits($1,$2,$3,$4,$5) AS allowed",
    [userId, permission, target.area ?? null, target.product ?? null, target.equipment ?? null]);
  if (!r?.allowed) throw new ApiFout(403, "Geen geldige MES-bevoegdheid voor deze activiteit");
}

/** Uitsluitend voor acties zonder productscope. Een begrensde grant voldoet
 * niet aan een globale actie; contextgebonden activiteiten gebruiken de
 * functie hierboven na het ophalen van het vertrouwde doelrecord. */
export function requiresPermission(permission: string) {
  return async (req: FastifyRequest) => {
    await ingelogd(req);
    if (req.user.ww) throw new ApiFout(403, "Kies eerst een eigen wachtwoord");
    await requirePermission(req.server.db, req.user.sub, permission);
  };
}

/** Controle in dezelfde transactie als de wijziging, met vertrouwde doelcontext. */
export async function requireTransactionPermission(tx: Tx, userId: string, permission: string, target: Target = {}) {
  const { rows: [r] } = await tx.query<{ allowed: boolean }>(
    "SELECT fabriek.authorization_permits($1,$2,$3,$4,$5) AS allowed",
    [userId, permission, target.area ?? null, target.product ?? null, target.equipment ?? null]);
  if (!r?.allowed) throw new ApiFout(403, "Geen geldige MES-bevoegdheid voor deze activiteit");
}
export async function personalSession(req: FastifyRequest) {
  await ingelogd(req);
  if (req.user.ww) throw new ApiFout(403, "Kies eerst een eigen wachtwoord");
  if (req.user.rol === "scherm") throw new ApiFout(403, "Persoonlijke sessie vereist");
}

/** Tijdelijke fabriekbrede PoC-overzichten: uitsluitend onbegrensd leesrecht.
 * Geen productscope afleiden uit een zoekfilter of oude accountrol.
 * authorization_read_execution combineert de bestaande domeinleesrechten.
 */
export async function requiresGlobalExecutionRead(req: FastifyRequest) {
  await personalSession(req);
  const [r] = await lees<{ allowed: boolean }>(req.server.db,
    "SELECT authorization_read_execution($1,NULL::uuid) AS allowed", [req.user.sub]);
  if (!r?.allowed) throw new ApiFout(403, "Globale MES-uitvoeringsleesbevoegdheid vereist");
}
