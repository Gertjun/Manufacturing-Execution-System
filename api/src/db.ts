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
 * Voert fn uit in één transactie, met schema `fabriek` en de naam van de
 * gebruiker in de sessie (voor het wijzigingslogboek). `moment` is het tijdstip
 * van invoer op het apparaat (offline wachtrij); de database begrenst het (D43).
 */
export async function inTransactie<T>(db: Db, gebruiker: string, fn: (tx: Tx) => Promise<T>, moment?: string | null): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query("BEGIN");
    await tx.query(
      "SELECT set_config('search_path', 'fabriek,public', true), set_config('fabriek.gebruiker', $1, true), set_config('fabriek.moment', $2, true)",
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
