// Test van het opruimschema voor back-ups: node --test tests/rotatie.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { teBewaren } from "../tools/rotatie.mjs";

const nu = new Date(2026, 10, 18, 21, 30); // 18 nov 2026 21:30 lokale tijd
const uurGeleden = (u) => new Date(nu.getTime() - u * 3600e3);

// Een jaar lang elk uur een back-up.
const bestanden = Array.from({ length: 24 * 400 }, (_, u) => ({ naam: `b${u}`, tijd: uurGeleden(u) }));
const blijft = teBewaren(bestanden, nu);

test("alle back-ups van de laatste 48 uur blijven", () => {
  for (let u = 0; u <= 48; u++) assert.ok(blijft.has(`b${u}`), `uur ${u}`);
});

test("daarna één per dag, tot 30 dagen terug", () => {
  const dagen = new Map();
  for (const b of bestanden) {
    if (!blijft.has(b.naam) || nu - b.tijd <= 48 * 3600e3) continue;
    const d = b.tijd.toDateString();
    dagen.set(d, (dagen.get(d) ?? 0) + 1);
  }
  for (const [d, n] of dagen) assert.equal(n, 1, `${d} heeft ${n} back-ups`);
  // nieuwste per dag = de laatste van die dag (23:xx)
  const dag10 = new Date(2026, 10, 8, 23, 30);
  assert.ok(bestanden.some((b) => blijft.has(b.naam) && b.tijd.getTime() === dag10.getTime()));
});

test("ouder dan 30 dagen: één per maand, 12 maanden", () => {
  const oud = bestanden.filter((b) => blijft.has(b.naam) && b.tijd < new Date(2026, 9, 20));
  const maanden = new Set(oud.map((b) => `${b.tijd.getFullYear()}-${b.tijd.getMonth()}`));
  assert.equal(maanden.size, oud.length, "hoogstens één per maand");
  assert.ok(!oud.some((b) => b.tijd < new Date(2025, 11, 1)), "niets ouder dan 12 maanden");
});

test("totaal blijft klein", () => {
  assert.ok(blijft.size <= 48 + 1 + 30 + 12, `${blijft.size} bestanden`);
});

test("de allernieuwste blijft altijd, ook als hij oud is", () => {
  const oud = [{ naam: "x", tijd: new Date(2020, 0, 1) }];
  assert.ok(teBewaren(oud, nu).has("x"));
});
