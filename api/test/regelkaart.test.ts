import assert from "node:assert/strict";
import { test } from "node:test";
import { cpk, regelkaart } from "../src/regelkaart.js";

const stabiel = [10, 10.2, 9.9, 10.1, 9.8, 10, 10.1, 9.9, 10.2, 9.8];

test("stabiel proces: geen signalen, gemiddelde en grenzen", () => {
  const k = regelkaart(stabiel);
  assert.equal(k.signalen.length, 0);
  assert.ok(Math.abs(k.gemiddelde! - 10) < 0.01);
  assert.ok(k.bovengrens! > 10 && k.ondergrens! < 10);
});

test("regel 1: punt buiten 3 sigma", () => {
  assert.deepEqual(regelkaart([...stabiel, 12]).signalen.at(-1), { index: 10, regel: 1 });
});

test("regel 4: 8 punten op rij boven het gemiddelde", () => {
  const v = [...stabiel, ...stabiel, 10.15, 10.12, 10.18, 10.11, 10.16, 10.13, 10.14, 10.17];
  assert.ok(regelkaart(v).signalen.some((s) => s.regel === 4 && s.index === v.length - 1));
});

test("te weinig punten of geen spreiding", () => {
  assert.equal(regelkaart([5]).sigma, null);
  assert.equal(regelkaart([5, 5, 5]).signalen.length, 0);
});

test("Cpk", () => {
  assert.equal(cpk(10, 0.1, 9, 11), 3.33);
  assert.equal(cpk(10, 0.1, null, 10.3), 1);
  assert.equal(cpk(10, 0.1, null, null), null);
});
