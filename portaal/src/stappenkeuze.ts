/**
 * Op een staande telefoon (D64) is een lijst van 18 stappen links te lang: daar staat in plaats van de
 * lijst een keuzelijst met dezelfde stappen. Werkt voor elke `nav.stappenlijst` (Beheer → Stappen en velden,
 * Planning → Stappen plannen); de CSS bepaalt welke van de twee zichtbaar is.
 */
export function volgStappenlijsten(scherm: HTMLElement) {
  const maak = () => {
    for (const nav of Array.from(scherm.querySelectorAll<HTMLElement>("nav.stappenlijst"))) {
      if (nav.previousElementSibling?.classList.contains("stappenkeuze")) continue;
      const label = document.createElement("label");
      label.className = "stappenkeuze filter";
      label.append("Stap");
      const sel = document.createElement("select");
      let groep: HTMLOptGroupElement | null = null;
      for (const el of Array.from(nav.children)) {
        if (el.classList.contains("lijstkop")) {
          groep = document.createElement("optgroup");
          groep.label = el.textContent ?? "";
          sel.append(groep);
        } else if (el instanceof HTMLAnchorElement) {
          const o = new Option(Array.from(el.childNodes).slice(0, 2).map((n) => n.textContent?.trim()).filter(Boolean).join(" "), el.getAttribute("href") ?? "");
          o.selected = el.getAttribute("aria-current") === "page";
          (groep ?? sel).append(o);
        }
      }
      sel.onchange = () => { location.hash = sel.value; };
      label.append(sel);
      nav.before(label);
    }
  };
  maak();
  new MutationObserver(maak).observe(scherm, { childList: true, subtree: true });
}
