// "Iets melden" (#78, D62): dezelfde vraag in het invoerscherm en de portalen. Versturen doet elke app zelf
// (het invoerscherm via de wachtrij, zodat het ook zonder verbinding kan).
import { vraag } from "./ui";

export async function vraagIetsMelden(plek: string): Promise<string | null> {
  const r = await vraag("Iets melden", [{
    naam: "tekst", label: "Wat gaat er mis, of wat kan beter?", type: "tekstvak", maxLengte: 1000,
    hint: `Kort en concreet. Je naam, de tijd en waar je was (${plek}) gaan vanzelf mee.`,
    controle: (t) => (t.length < 3 ? "Schrijf iets meer" : null),
  }], "Versturen", "Voor storingen in de productie gebruik je Stilstand; dit is voor opmerkingen over het systeem en de werkwijze.");
  return r ? r.tekst : null;
}
