import pg from "pg";

// numeric -> number (waarden blijven ruim binnen het bereik van een JS-number)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// bigint (count) -> number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function maakPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 20 });
}

/**
 * Voert fn uit in één transactie, met schema `fabriek`, de tijdzone van de fabriek (D44) en de naam van de
 * gebruiker in de sessie (voor het wijzigingslogboek). `moment` is het tijdstip
 * van invoer op het apparaat (offline wachtrij); de database begrenst het (D43).
 */
export async function inTransactie<T>(db: Db, gebruiker: string, fn: (tx: Tx) => Promise<T>, moment?: string | null): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query("BEGIN");
    await tx.query(
      `SELECT set_config('search_path', 'fabriek,public', true), set_config('timezone', fabriek.fabriekstijdzone(), true),
              set_config('fabriek.gebruiker', $1, true), set_config('fabriek.moment', $2, true)`,
      [gebruiker, moment ?? ""],
    );
    const resultaat = await fn(tx);
    await tx.query("COMMIT");
    return resultaat;
  } catch (e) {
    await tx.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}

/** Alleen-lezen query met het juiste schema. */
export async function lees<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return inTransactie(db, "lezen", async (tx) => (await tx.query<T>(sql, params)).rows);
}

/** D24: controleer de werkelijke login, ook indirecte rolrechten en eigendom.
 * Dit is een startcontrole, geen vervanging voor de afzonderlijke ACL-audit. */
export async function controleerRuntimeRechten(db: Db): Promise<void> {
  const { rows } = await db.query(`
    SELECT current_user = session_user
      AND session_user IN ('mes_app', 'batchgui_app')
      AND NOT EXISTS (
        SELECT 1 FROM pg_roles r
        WHERE pg_has_role(session_user, r.oid, 'MEMBER')
          AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
               OR r.rolbypassrls OR r.rolname NOT IN ('mes_app','batchgui_app'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_database d WHERE d.datname = current_database()
          AND pg_has_role(session_user, d.datdba, 'MEMBER')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('fabriek','public')
          AND (pg_has_role(session_user, n.nspowner, 'MEMBER')
               OR has_schema_privilege(session_user, n.oid, 'CREATE'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='fabriek' AND pg_has_role(session_user,c.relowner,'MEMBER')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='fabriek' AND pg_has_role(session_user,p.proowner,'MEMBER')
      ) AS veilig
  `);
  if (rows[0]?.veilig !== true) {
    throw new Error("API vereist een beperkte MES-databasegebruiker zonder beheerrechten, extra rollidmaatschappen of eigendom.");
  }
}
