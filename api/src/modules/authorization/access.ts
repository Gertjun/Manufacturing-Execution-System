import type { FastifyRequest } from "fastify";
import { ApiFout } from "../../fouten.js";
import { ingelogd, persoonlijkeTransactie } from "../../auth.js";
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


/** UI-projectie, geen machtiging: globale en productgebonden rechten blijven
 * afzonderlijk. Iedere operatie controleert opnieuw de concrete doelcontext.
 * Geen area/equipment-context verzinnen voor tijdelijke PoC-schermen. */
export async function permissionProjection(req: FastifyRequest) {
  const rows = await lees<{ code: string; domain: string; product: string | null }>(req.server.db,
    `SELECT p.code,p.domain,t.product
       FROM authorization_permission p
       CROSS JOIN (SELECT NULL::uuid AS id,NULL::text AS product
                   UNION ALL SELECT id,code FROM product WHERE actief) t
      WHERE authorization_permits($1,p.code,NULL,t.id,NULL)
      ORDER BY p.code,t.product NULLS FIRST`, [req.user.sub]);
  const global = rows.filter(r => r.product === null &&
    (req.user.rol === "scherm" ? r.domain === "display" : r.domain !== "display")).map(r => r.code);
  const globalSet = new Set(global);
  const products = req.user.rol === "scherm" ? [] : rows.filter(r =>
    r.product !== null && r.domain !== "display" && !globalSet.has(r.code))
    .map(r => ({ permission: r.code, product: r.product! }));
  const [person] = req.user.rol === "scherm" ? [] : await lees<{ id: string | null }>(req.server.db,
    "SELECT operator_van_account($1) AS id", [req.user.sub]);
  // Afzonderlijk menusignaal, geen uitbreiding van globale rechten.
  let resourceCatalog = false;
  if (req.user.rol !== "scherm") {
    if (globalSet.has("resource.catalog.manage")) resourceCatalog = true;
    else {
      try {
        resourceCatalog = await persoonlijkeTransactie(req.server.db, req, async tx => {
          await tx.query("SELECT resource_catalog_list()");
          return true;
        });
      } catch (e) {
        if ((e as { code?: string }).code !== "42501") throw e;
      }
    }
  }
  let resourceStatus = false;
  if (req.user.rol !== "scherm") {
    resourceStatus = await persoonlijkeTransactie(req.server.db, req, async tx => {
      const {rows:[r]}=await tx.query<{allowed:boolean}>("SELECT resource_status_access() AS allowed");
      return r?.allowed === true;
    });
  }
  return { global, products, personal: req.user.rol !== "scherm", linkedPerson: !!person?.id, resourceCatalog, resourceStatus };
}
