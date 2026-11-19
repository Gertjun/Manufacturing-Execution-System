// Regelkaart (Shewhart, individuele waarden met bewegend bereik).
// Middenlijn = gemiddelde; sigma = gemiddeld bewegend bereik / 1,128; regelgrenzen = gemiddelde ± 3 sigma.
// Signalen volgens de Western Electric-regels:
//   1: één punt buiten 3 sigma
//   2: 2 van 3 opeenvolgende punten buiten 2 sigma aan dezelfde kant
//   3: 4 van 5 opeenvolgende punten buiten 1 sigma aan dezelfde kant
//   4: 8 opeenvolgende punten aan dezelfde kant van het gemiddelde
// Een signaal betekent: het proces verandert, ook als de waarden nog binnen de specificatie vallen.

export interface Punt { waarde: number }
export interface Signaal { index: number; regel: 1 | 2 | 3 | 4 }
export interface Kaart {
  n: number;
  gemiddelde: number | null;
  sigma: number | null;
  bovengrens: number | null;
  ondergrens: number | null;
  mr_gemiddeld: number | null;
  mr_bovengrens: number | null;
  signalen: Signaal[];
}

export const REGELS: Record<Signaal["regel"], string> = {
  1: "Eén punt buiten de regelgrens (3 sigma)",
  2: "2 van 3 punten ver aan dezelfde kant (buiten 2 sigma)",
  3: "4 van 5 punten aan dezelfde kant buiten 1 sigma",
  4: "8 punten op rij aan dezelfde kant van het gemiddelde",
};

export function regelkaart(waarden: number[]): Kaart {
  const n = waarden.length;
  if (n < 2) return { n, gemiddelde: n ? waarden[0] : null, sigma: null, bovengrens: null, ondergrens: null, mr_gemiddeld: null, mr_bovengrens: null, signalen: [] };
  const gem = waarden.reduce((a, b) => a + b, 0) / n;
  const mr = waarden.slice(1).map((w, i) => Math.abs(w - waarden[i]));
  const mrGem = mr.reduce((a, b) => a + b, 0) / mr.length;
  const sigma = mrGem / 1.128;
  const kaart: Kaart = {
    n, gemiddelde: gem, sigma, bovengrens: gem + 3 * sigma, ondergrens: gem - 3 * sigma,
    mr_gemiddeld: mrGem, mr_bovengrens: 3.267 * mrGem, signalen: [],
  };
  if (sigma === 0) return kaart;
  const z = waarden.map((w) => (w - gem) / sigma);
  const gezien = new Set<number>();
  const meld = (index: number, regel: Signaal["regel"]) => {
    if (gezien.has(index)) return; // één signaal per punt: het eerste (zwaarste) telt
    gezien.add(index);
    kaart.signalen.push({ index, regel });
  };
  for (let i = 0; i < n; i++) {
    if (Math.abs(z[i]) > 3) meld(i, 1);
    for (const kant of [1, -1]) {
      const binnen = (van: number, grens: number) => z.slice(Math.max(0, i - van + 1), i + 1).filter((x) => x * kant > grens).length;
      if (i >= 2 && z[i] * kant > 2 && binnen(3, 2) >= 2) meld(i, 2);
      if (i >= 4 && z[i] * kant > 1 && binnen(5, 1) >= 4) meld(i, 3);
      if (i >= 7 && z.slice(i - 7, i + 1).every((x) => x * kant > 0)) meld(i, 4);
    }
  }
  kaart.signalen.sort((a, b) => a.index - b.index);
  return kaart;
}

/** Procesvermogen Cpk: hoe ver het gemiddelde van de dichtstbijzijnde specificatiegrens ligt, in eenheden van 3 sigma. */
export function cpk(gem: number | null, sigma: number | null, min: number | null, max: number | null): number | null {
  if (gem === null || !sigma || (min === null && max === null)) return null;
  const kanten = [max !== null ? (max - gem) / (3 * sigma) : Infinity, min !== null ? (gem - min) / (3 * sigma) : Infinity];
  return Math.round(Math.min(...kanten) * 100) / 100;
}
