/**
 * "Naar Excel" staat op één vaste plek (0.42.1): rechts in de kopregel van het blok met de tabel,
 * of rechts in de paginakop als de tabel los op de pagina staat. Zo krijgt geen tabel een losse
 * regel met alleen deze knop. Staan er meer tabellen in één blok, dan blijft de knop boven zijn tabel.
 * Werkt op elk scherm dat tabel() gebruikt, ook als het later inhoud bijlaadt.
 */
export function volgExcelKnoppen(scherm: HTMLElement) {
  const plaats = () => {
    for (const acties of Array.from(scherm.querySelectorAll<HTMLElement>(".tabel-met-acties > .tabel-acties"))) {
      const knop = acties.querySelector("button");
      if (!knop) continue;
      const kop = kopVoor(acties, scherm);
      if (!kop) continue;
      const rechts = rechterdeel(kop);
      rechts.append(knop);
      acties.remove();
    }
  };
  plaats();
  new MutationObserver(plaats).observe(scherm, { childList: true, subtree: true });
}

/** De kopregel waar de knop in hoort, of null als hij beter boven zijn tabel blijft. */
function kopVoor(acties: HTMLElement, scherm: HTMLElement): HTMLElement | null {
  const blok = acties.closest<HTMLElement>(".blok");
  const bereik = blok ?? scherm;
  // Eén tabel per blok (of per pagina buiten blokken); anders weet je niet bij welke tabel de knop hoort.
  const tabellen = Array.from(bereik.querySelectorAll(".tabel-met-acties")).filter((t) => (t.closest(".blok") ?? scherm) === bereik);
  if (tabellen.length !== 1) return null;
  if (blok) {
    const eerste = blok.firstElementChild as HTMLElement | null;
    if (!eerste) return null;
    if (eerste.classList.contains("kop")) return eerste;
    if (eerste.tagName === "H2") {
      const regel = document.createElement("div");
      regel.className = "kop blok-kop";
      blok.insertBefore(regel, eerste);
      regel.append(eerste);
      return regel;
    }
    return null;
  }
  // Los op de pagina: de paginakop (titel met eventueel filters of knoppen).
  const kop = scherm.querySelector<HTMLElement>(":scope > .kop, :scope > * > .kop");
  return kop && !kop.closest(".blok") ? kop : null;
}

/** Het rechterdeel van een kopregel; bestaat er nog geen, dan komt het erbij. */
function rechterdeel(kop: HTMLElement): HTMLElement {
  const bestaand = kop.querySelector<HTMLElement>(":scope > .kop-rechts");
  if (bestaand) return bestaand;
  const kinderen = Array.from(kop.children) as HTMLElement[];
  const rechts = document.createElement("div");
  rechts.className = "kop-rechts";
  // Alles na het eerste kind (titel of titel met uitleg) gaat mee naar rechts, zodat knoppen bij elkaar staan.
  for (const k of kinderen.slice(1)) rechts.append(k);
  kop.append(rechts);
  return rechts;
}
