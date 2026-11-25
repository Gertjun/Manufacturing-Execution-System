/** Zuivere autorisatiebeslissing (D89 P01–P05). Geen JWT of clientinput als bron van grants.
 * De aanroeper moet actuele, vertrouwde databasegegevens en volledige doelcontext leveren.
 * Nog niet aangesloten op bestaande routes. */
export type Domain = "technical" | "security" | "operations" | "quality" | "engineering" | "maintenance" | "analysis" | "display";
export interface Scope { area?: string; product?: string; equipment?: string }
export interface Validity { from: number; until: number | null }
export interface Grant extends Validity {
  role: string;
  domain: Domain;
  permissions: readonly string[];
  scope: Scope;
  revoked: boolean;
}
export interface Qualification extends Validity { code: string; revoked: boolean }
export interface Subject {
  active: boolean;
  personal: boolean;
  temporaryPassword: boolean;
  grants: readonly Grant[];
  qualifications: readonly Qualification[];
}
export interface Activity {
  permission: string;
  domain: Domain;
  target: Scope;
  requiredQualifications: readonly string[];
  personal: boolean;
}
const dimensions = ["area", "product", "equipment"] as const;
function valid(v: Validity, now: number): boolean {
  return Number.isFinite(now) && Number.isFinite(v.from) && v.from <= now &&
    (v.until === null || (Number.isFinite(v.until) && now < v.until));
}
function within(grant: Scope, target: Scope): boolean {
  return dimensions.every(d => grant[d] === undefined ||
    (grant[d] !== "" && target[d] !== undefined && grant[d] === target[d]));
}
/** Alle benodigde rechten en scope moeten in één geldige grant passen.
 * Kwalificaties zijn onafhankelijk van rollen. Onbekend of onvolledig: weigeren. */
export function permits(subject: Subject, activity: Activity, now: number): boolean {
  if (!subject.active || subject.temporaryPassword || !activity.permission ||
      (activity.personal && !subject.personal)) return false;
  if (!dimensions.every(d => activity.target[d] === undefined || activity.target[d] !== "")) return false;
  const grants = subject.grants.filter(g => !g.revoked && valid(g, now));
  // Technisch/security beheer niet combineren met inhoudelijke of display-rollen.
  const administrative = grants.some(g => g.domain === "technical" || g.domain === "security");
  if (administrative && grants.some(g => g.domain !== "technical" && g.domain !== "security")) return false;
  if (grants.some(g => g.domain === "technical") && grants.some(g => g.domain === "security")) return false;
  if (grants.some(g => g.domain === "display") && grants.some(g => g.domain !== "display")) return false;
  if (!grants.some(g => g.domain === activity.domain && g.permissions.includes(activity.permission) &&
      within(g.scope, activity.target))) return false;
  return activity.requiredQualifications.every(code => subject.qualifications.some(q =>
    q.code === code && !q.revoked && valid(q, now)));
}
