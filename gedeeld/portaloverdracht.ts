// Expliciete, eenmalige portalkeuze binnen hetzelfde browsertabblad (D54/D58/D113).
// De JWT-handtekening identificeert het token zonder een tweede volledig token op te slaan.
// Geen autorisatiebewijs: /auth/pc blijft beslissend. Geen data in URL of DOM.
const SLEUTEL = "mes.portaloverdracht.v1";
const GELDIG_MS = 120_000;
function handtekening(token: string | null): string | null {
  const delen = token?.split(".");
  return delen?.length === 3 && delen[2] ? delen[2] : null;
}
export function wisPortaloverdracht() {
  try { sessionStorage.removeItem(SLEUTEL); } catch { /* fail closed bij lezen */ }
  try { localStorage.removeItem("invoer.vanStart"); } catch { /* oude tijdstempel niet meer gebruikt */ }
}
export function kiesPortaloverdracht(token: string | null): boolean {
  wisPortaloverdracht();
  const binding = handtekening(token);
  if (!binding) return false;
  try {
    sessionStorage.setItem(SLEUTEL, JSON.stringify({ binding, tijd: Date.now() }));
    return true;
  } catch { return false; }
}
export function neemPortaloverdracht(token: string | null): boolean {
  let keuze: { binding: string; tijd: number } | null = null;
  try { keuze = JSON.parse(sessionStorage.getItem(SLEUTEL) ?? "null"); } catch { /* geen geldige keuze */ }
  wisPortaloverdracht();
  const binding = handtekening(token);
  return !!binding && !!keuze && keuze.binding === binding && Number.isFinite(keuze.tijd) &&
    Date.now() - keuze.tijd >= 0 && Date.now() - keuze.tijd < GELDIG_MS;
}
