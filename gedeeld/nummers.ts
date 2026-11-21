/**
 * Batch- en lotnummers (B-2026-0511, L-2026-0126) breken nergens af bij het streepje (D64): elk nummer in
 * lopende tekst krijgt een `span.nummer` (white-space: nowrap). Werkt op alles wat in het scherm komt,
 * ook als een scherm later inhoud bijlaadt. Tekst in invoervelden en grafieken blijft zoals hij is.
 */
const NUMMER = /[BL]-\d{4}-\d{4}/;
const SPLITS = /([BL]-\d{4}-\d{4})/;

function verwerk(wortel: Node) {
  const loper = document.createTreeWalker(wortel, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const ouder = n.parentElement;
      if (!ouder || !NUMMER.test(n.textContent ?? "")) return NodeFilter.FILTER_REJECT;
      if (ouder.closest(".nummer, svg, textarea, option, script, style")) return NodeFilter.FILTER_REJECT;
      // Alleen splitsen als er meer staat dan het nummer zelf; een los nummer breekt niet af als het
      // element zelf nowrap is, maar in een smalle cel kan dat wel: ook dan inpakken.
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const teksten: Text[] = [];
  for (let n = loper.nextNode(); n; n = loper.nextNode()) teksten.push(n as Text);
  for (const t of teksten) {
    const frag = document.createDocumentFragment();
    (t.textContent ?? "").split(SPLITS).forEach((deel, i) => {
      if (!deel) return;
      if (i % 2) { const s = document.createElement("span"); s.className = "nummer"; s.textContent = deel; frag.append(s); }
      else frag.append(deel);
    });
    t.replaceWith(frag);
  }
}

export function volgNummers(scherm: HTMLElement) {
  verwerk(scherm);
  new MutationObserver((lijst) => {
    for (const m of lijst) for (const n of Array.from(m.addedNodes)) if (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) verwerk(n.nodeType === Node.TEXT_NODE ? n.parentNode ?? n : n);
  }).observe(scherm, { childList: true, subtree: true });
}
