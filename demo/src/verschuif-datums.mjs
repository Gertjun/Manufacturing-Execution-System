// Verschuif alle datumkolommen per tabel in één UPDATE, zodat periodecontroles intact blijven.
export async function verschuifDatumkolommen(db, dagen) {
  const { rows: datums } = await db.query(`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'fabriek' AND t.table_type = 'BASE TABLE' AND c.data_type = 'date'
    ORDER BY c.table_name, c.ordinal_position`);
  const perTabel = new Map();
  for (const k of datums) perTabel.set(k.table_name, [...(perTabel.get(k.table_name) ?? []), k.column_name]);
  for (const [tabel, kols] of perTabel) {
    await db.query(`UPDATE "${tabel}" SET ${kols.map((c) => `"${c}" = "${c}" + $1::int`).join(", ")}`, [dagen]);
  }
}
