import assert from "node:assert/strict";
import { test } from "node:test";
import { verschuifDatumkolommen } from "./src/verschuif-datums.mjs";

for (const dagen of [7, -7, 0]) {
  test(`datumkolommen per tabel atomair verschuiven (${dagen} dagen)`, async () => {
    const updates = [];
    const db = { query: async (sql, parameters) => {
      if (sql.includes("information_schema.columns")) return { rows: [
        { table_name: "capaciteit_afwijking", column_name: "van" },
        { table_name: "capaciteit_afwijking", column_name: "tot" },
        { table_name: "planning", column_name: "dag" },
      ] };
      updates.push([sql, parameters]);
    } };
    await verschuifDatumkolommen(db, dagen);
    assert.deepEqual(updates, [
      ['UPDATE "capaciteit_afwijking" SET "van" = "van" + $1::int, "tot" = "tot" + $1::int', [dagen]],
      ['UPDATE "planning" SET "dag" = "dag" + $1::int', [dagen]],
    ]);
  });
}
