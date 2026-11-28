import assert from "node:assert/strict";
import { test } from "node:test";
import { permits, type Activity, type Grant, type Subject } from "../src/modules/authorization/policy.js";
const now = 1000;
const grant: Grant = { role: "operator", domain: "operations", permissions: ["execution.record"], scope: { area: "A", product: "P" }, from: 0, until: 2000, revoked: false };
const subject: Subject = { active: true, personal: true, temporaryPassword: false, grants: [grant], qualifications: [{ code: "training", from: 0, until: 2000, revoked: false }] };
const activity: Activity = { permission: "execution.record", domain: "operations", target: { area: "A", product: "P" }, requiredQualifications: ["training"], personal: true };
test("geldige rol, scope en kwalificatie", () => assert.equal(permits(subject, activity, now), true));
test("onbekend recht of domein geweigerd", () => {
  assert.equal(permits(subject, { ...activity, permission: "execution.release" }, now), false);
  assert.equal(permits(subject, { ...activity, domain: "quality" }, now), false);
});
test("geen rechten en scopes van verschillende grants combineren", () => {
  const other: Grant = { ...grant, permissions: ["execution.read"], scope: { area: "B", product: "P" } };
  assert.equal(permits({ ...subject, grants: [grant, other] }, { ...activity, target: { area: "B", product: "P" } }, now), false);
  assert.equal(permits({ ...subject, grants: [grant, other] }, { ...activity, permission: "execution.read", target: { area: "B", product: "P" } }, now), true);
});
test("ontbrekende of afwijkende scope geweigerd", () => {
  for (const target of [{}, { area: "A" }, { area: "A", product: "Q" }, { area: "", product: "P" }])
    assert.equal(permits(subject, { ...activity, target }, now), false);
});
test("verlopen, toekomstige en ingetrokken grant geweigerd", () => {
  for (const g of [{ ...grant, until: now }, { ...grant, from: now + 1 }, { ...grant, revoked: true }])
    assert.equal(permits({ ...subject, grants: [g] }, activity, now), false);
});
test("kwalificaties afzonderlijk verplicht en geldig", () => {
  for (const qualifications of [[], [{ ...subject.qualifications[0], until: now }], [{ ...subject.qualifications[0], revoked: true }]])
    assert.equal(permits({ ...subject, qualifications }, activity, now), false);
});
test("technisch beheer en schermaccounts niet mengen met inhoudelijke rechten", () => {
  for (const domain of ["technical", "security", "display"] as const)
    assert.equal(permits({ ...subject, grants: [grant, { ...grant, domain }] }, activity, now), false);
});
test("inactief, tijdelijk wachtwoord of gedeeld account geweigerd", () => {
  for (const s of [{ ...subject, active: false }, { ...subject, temporaryPassword: true }, { ...subject, personal: false }])
    assert.equal(permits(s, activity, now), false);
});
test("meerdere verenigbare rollen behouden afzonderlijke rechten", () => {
  const other: Grant = { ...grant, domain: "quality", role: "quality_technician", permissions: ["quality.inspect"] };
  const multi = { ...subject, grants: [grant, other] };
  assert.equal(permits(multi, activity, now), true);
  assert.equal(permits(multi, { ...activity, domain: "quality", permission: "quality.inspect" }, now), true);
});

test("technische en security-identiteiten zijn gescheiden", () => {
  const technical: Grant = { ...grant, role: "system_administrator", domain: "technical", permissions: ["account.manage"], scope: {} };
  const security: Grant = { ...grant, role: "security_administrator", domain: "security", permissions: ["authorization.approve"], scope: {} };
  const account: Activity = { ...activity, domain: "technical", permission: "account.manage", target: {}, requiredQualifications: [] };
  const approval: Activity = { ...account, domain: "security", permission: "authorization.approve" };
  assert.equal(permits({ ...subject, grants: [technical] }, account, now), true);
  assert.equal(permits({ ...subject, grants: [security] }, approval, now), true);
  assert.equal(permits({ ...subject, grants: [technical, security] }, account, now), false);
  assert.equal(permits({ ...subject, grants: [technical, security] }, approval, now), false);
  assert.equal(permits({ ...subject, grants: [technical, { ...security, revoked: true }] }, account, now), true);
});

test("middelenbeheer en scopemapping blijven gescheiden", () => {
  const catalog: Grant = { ...grant, role: "resource_catalog_manager", domain: "maintenance", permissions: ["resource.catalog.manage"], scope: { area: "A" } };
  const mapping: Grant = { ...grant, role: "resource_scope_administrator", domain: "security", permissions: ["resource.scope.manage"], scope: {} };
  const manage: Activity = { permission: "resource.catalog.manage", domain: "maintenance", target: { area: "A" }, requiredQualifications: [], personal: true };
  const map: Activity = { permission: "resource.scope.manage", domain: "security", target: {}, requiredQualifications: [], personal: true };
  assert.equal(permits({ ...subject, grants: [catalog] }, manage, now), true);
  assert.equal(permits({ ...subject, grants: [catalog] }, { ...manage, target: {} }, now), false);
  assert.equal(permits({ ...subject, grants: [catalog] }, { ...manage, target: { area: "B" } }, now), false);
  assert.equal(permits({ ...subject, grants: [catalog] }, map, now), false);
  assert.equal(permits({ ...subject, grants: [mapping] }, map, now), true);
  assert.equal(permits({ ...subject, grants: [mapping] }, manage, now), false);
  for (const activity of [manage, map])
    assert.equal(permits({ ...subject, grants: [catalog, mapping] }, activity, now), false);
  assert.equal(permits({ ...subject, grants: [{ ...mapping, scope: { equipment: "E" } }] }, map, now), false);
});
