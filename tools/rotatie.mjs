// Welke back-ups bewaren we? Gebruikt door tools/backup.mjs; los te testen.
//
// Bewaren: alles van de laatste 48 uur, de nieuwste per dag van de laatste 30 dagen,
// de nieuwste per maand van de laatste 12 maanden, en altijd de allernieuwste.

export const SCHEMA = { uren: 48, dagen: 30, maanden: 12 };

const dag = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const maand = (d) => `${d.getFullYear()}-${d.getMonth()}`;

/**
 * @param {{naam: string, tijd: Date}[]} bestanden
 * @param {Date} nu
 * @returns {Set<string>} namen die blijven
 */
export function teBewaren(bestanden, nu = new Date(), schema = SCHEMA) {
  const lijst = [...bestanden].sort((a, b) => b.tijd - a.tijd); // nieuwste eerst
  const blijft = new Set();
  if (lijst[0]) blijft.add(lijst[0].naam);

  const grensUren = nu.getTime() - schema.uren * 3600e3;
  for (const b of lijst) if (b.tijd.getTime() >= grensUren) blijft.add(b.naam);

  const grensDagen = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() - (schema.dagen - 1));
  const dagen = new Set();
  for (const b of lijst) {
    if (b.tijd < grensDagen || dagen.has(dag(b.tijd))) continue;
    dagen.add(dag(b.tijd));
    blijft.add(b.naam);
  }

  const grensMaanden = new Date(nu.getFullYear(), nu.getMonth() - (schema.maanden - 1), 1);
  const maanden = new Set();
  for (const b of lijst) {
    if (b.tijd < grensMaanden || maanden.has(maand(b.tijd))) continue;
    maanden.add(maand(b.tijd));
    blijft.add(b.naam);
  }
  return blijft;
}
