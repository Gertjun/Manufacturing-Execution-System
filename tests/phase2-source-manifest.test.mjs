// 113.7b: test uitsluitend het voorbereidingsmanifest, niet een migratie-engine.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
const manifest=JSON.parse(readFileSync(new URL("../docs/mes/fixtures/phase2-source-cases.json",import.meta.url),"utf8"));
const cases=manifest.cases;
test("bronvoorbereiding: volledig, uniek en uitsluitend fictief manifest",()=>{
  assert.match(manifest.purpose,/Fictieve/);
  assert.ok(Array.isArray(cases));
  assert.deepEqual(cases.map(c=>c.id),Array.from({length:16},(_,i)=>"S"+String(i+1).padStart(2,"0")));
  assert.equal(new Set(cases.map(c=>c.source+":"+c.key)).size,cases.length);
  for(const c of cases){
    assert.match(c.key,/^FICT-/);
    assert.ok(typeof c.source==="string"&&c.source.trim());
    assert.ok(typeof c.reason==="string"&&c.reason.trim());
    assert.ok(c.input&&typeof c.input==="object"&&!Array.isArray(c.input));
    assert.ok(["mapped","needs_review","blocked","historical_unknown"].includes(c.expected_status));
    assert.equal(c.automatic_release,false);
  }
});
test("bronvoorbereiding: representatieve verliesvrije en negatieve gevallen aanwezig",()=>{
  const byId=Object.fromEntries(cases.map(c=>[c.id,c]));
  assert.equal(byId.S03.input.unit,null);
  assert.equal(byId.S04.input.density,null);
  assert.equal(byId.S05.input.grens_min,"1.230000000000000001");
  assert.equal(byId.S05.input.grens_max,null);
  assert.equal(byId.S05.input.tolerantie_soort,"procent");
  assert.equal(byId.S06.input.parent,null);
  assert.equal(byId.S07.input.status,"vastgesteld");
  assert.equal(byId.S08.input.quantity,null);
  assert.equal(byId.S09.input.lot_norm,null);
  assert.equal(byId.S10.input.gemeten,"12.000000000000000001");
  assert.equal(byId.S10.input.recipe_version_evidence,null);
  assert.equal(byId.S10.input.vervangt_waarde_id,"FICT-V0");
  assert.equal(new Set(byId.S11.input.conflicting_target_ids).size,2);
  assert.notEqual(byId.S12.input.product_a,byId.S12.input.product_b);
  assert.notEqual(byId.S13.input.from_kind,byId.S13.input.to_kind);
  assert.equal(byId.S14.input.runtime_evidence,null);
  assert.notEqual(byId.S16.input.prior_hash,byId.S16.input.current_hash);
});
