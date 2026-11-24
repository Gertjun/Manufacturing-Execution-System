import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { verschuifDatumkolommen } from "./src/verschuif-datums.mjs";

test("PGlite: datumverschuiving behoudt geldige perioden en lege datums", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE SCHEMA fabriek;
      SET search_path = fabriek, public;
      CREATE TABLE capaciteit_afwijking (
        id int PRIMARY KEY, van date NOT NULL, tot date NOT NULL,
        CONSTRAINT capaciteit_afwijking_periode CHECK (tot >= van AND tot - van <= 366)
      );
      INSERT INTO capaciteit_afwijking VALUES
        (1, '2024-01-01', '2024-01-01'), (2, '2024-01-01', '2025-01-01');
      CREATE TABLE planning (dag date NOT NULL, optioneel date);
      INSERT INTO planning VALUES ('2024-01-01', NULL);
    `);
    // De oude aanpak moet daadwerkelijk falen, anders reproduceert de fixture de fout niet.
    await assert.rejects(db.query("UPDATE capaciteit_afwijking SET van = van + 7"), (e) => e.code === "23514");
    const controleer = async (verwachteVan, verwachtTot, verwachtDag) => {
      const { rows } = await db.query("SELECT van::text, tot::text, tot - van AS duur FROM capaciteit_afwijking ORDER BY id");
      assert.deepEqual(rows, [
        { van: verwachteVan, tot: verwachteVan, duur: 0 },
        { van: verwachteVan, tot: verwachtTot, duur: 366 },
      ]);
      const planning = await db.query("SELECT dag::text, optioneel::text FROM planning");
      assert.deepEqual(planning.rows, [{ dag: verwachtDag, optioneel: null }]);
    };
    await verschuifDatumkolommen(db, 7);
    await controleer("2024-01-08", "2025-01-08", "2024-01-08");
    await verschuifDatumkolommen(db, -14);
    await controleer("2023-12-25", "2024-12-25", "2023-12-25");
  } finally {
    await db.close();
  }
});
