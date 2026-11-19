// Ploegoverdracht: wat de vorige ploeg heeft achtergelaten, en zelf een overdracht schrijven.
// Schrijven werkt ook zonder verbinding (wachtrij); de server bepaalt de ploeg aan de hand van het tijdstip.
import { haal, nieuwId } from "../api";
import { sessie } from "../sessie";
import { bevestig, h, laden, melding, tijd, toon, vastHouden } from "../ui";
import { acties, voegToe } from "../wachtrij";

export interface Notitie { id: string; hal: string | null; bijzonderheden: string | null; aandachtspunten: string | null; door: string; pc: string | null; geschreven_op: string; wacht?: boolean }
export interface Samenvatting {
  ploeg: string; ploegnaam: string; dag: string; begin_op: string; eind_op: string; loopt_nog: boolean;
  cijfers: { stappen_afgerond: number; batches_gestart: number; lots_gemaakt: number; afwijkingen: number; correcties: number; in_beoordeling_gezet: number };
  per_stap: { stap: string; stapnaam: string; afgerond: number }[];
  nog_open: { stap: string; nummer: string; sinds: string; operator: string }[];
  notities: Notitie[];
}

const uur = (iso: string) => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
const gelezenSleutel = (s: Samenvatting) => `overdracht-gelezen:${s.ploeg}|${s.dag}`;

function cijferRegel(s: Samenvatting): string {
  const c = s.cijfers;
  const delen = [
    `${c.stappen_afgerond} ${c.stappen_afgerond === 1 ? "stap" : "stappen"} afgerond`,
    `${c.batches_gestart} ${c.batches_gestart === 1 ? "batch" : "batches"} gestart`,
    c.lots_gemaakt ? `${c.lots_gemaakt} ${c.lots_gemaakt === 1 ? "lot" : "lots"} samengesteld` : null,
    `${c.afwijkingen} ${c.afwijkingen === 1 ? "afwijking" : "afwijkingen"}`,
    c.in_beoordeling_gezet ? `${c.in_beoordeling_gezet} in beoordeling gezet` : null,
  ];
  return delen.filter(Boolean).join(", ");
}

function notitieBlok(n: Notitie) {
  return h("li", { class: "notitie" },
    n.aandachtspunten ? h("p", { class: "notitie-aandacht" }, h("strong", {}, "Let op: "), n.aandachtspunten) : null,
    n.bijzonderheden ? h("p", {}, n.bijzonderheden) : null,
    h("p", { class: "rij-info" }, `${n.door}${n.pc ? ` op ${n.pc}` : ""}, ${tijd(n.geschreven_op)}`,
      n.wacht ? h("span", { class: "label label-wacht" }, "Nog niet verstuurd") : null));
}

/** Blok bovenaan het stappenoverzicht: de overdracht van de vorige ploeg. Leeg als die er niet is. */
export async function vorigeOverdrachtBlok(): Promise<Node | null> {
  let s: Samenvatting | null;
  try { s = (await haal<Samenvatting | null>("/overdracht?vorige=true")).data; } catch { return null; }
  if (!s) return null;
  const blok = h("section", { class: "overdracht-blok" });
  const teken = () => {
    let gelezen = false;
    try { gelezen = localStorage.getItem(gelezenSleutel(s!)) === "1"; } catch { /* geen opslag */ }
    const kop = `Overdracht van de ${s!.ploegnaam.toLowerCase()} (${uur(s!.begin_op)}–${uur(s!.eind_op)})`;
    if (gelezen) {
      blok.className = "overdracht-blok gelezen";
      blok.replaceChildren(h("span", {}, `${kop}: gelezen.`),
        h("button", { class: "knop-tekst", onclick: () => { try { localStorage.removeItem(gelezenSleutel(s!)); } catch { /* */ } teken(); } }, "Opnieuw tonen"));
      return;
    }
    blok.className = "overdracht-blok";
    blok.replaceChildren(
      h("h2", {}, kop),
      s!.notities.length
        ? h("ul", { class: "notities" }, s!.notities.map(notitieBlok))
        : h("p", { class: "sub" }, "De vorige ploeg heeft geen overdracht geschreven."),
      h("p", { class: "sub" }, cijferRegel(s!),
        s!.nog_open.length ? `. Nog open: ${s!.nog_open.map((o) => `${o.stap} ${o.nummer}`).join(", ")}` : ""),
      h("button", { class: "knop", onclick: () => { try { localStorage.setItem(gelezenSleutel(s!), "1"); } catch { /* */ } teken(); } }, "Gelezen"));
  };
  teken();
  return blok;
}

export async function overdrachtScherm() {
  const actueel = vastHouden();
  toon(h("h1", {}, "Overdracht"), laden());
  let s: Samenvatting | null = null;
  let vers = true;
  try {
    const r = await haal<Samenvatting | null>("/overdracht");
    s = r.data;
    vers = r.vers;
  } catch { vers = false; }
  // Wat deze pc al schreef maar nog niet is verstuurd.
  const wachtend: Notitie[] = (await acties())
    .filter((a) => a.pad === "/overdracht" && a.methode === "POST")
    .map((a) => {
      const b = a.body as { id: string; bijzonderheden: string | null; aandachtspunten: string | null; moment: string };
      return { id: b.id, hal: null, bijzonderheden: b.bijzonderheden, aandachtspunten: b.aandachtspunten, door: sessie.operatornaam ?? "", pc: sessie.pc, geschreven_op: b.moment, wacht: true };
    });
  if (!actueel()) return;
  const notities = [...(s?.notities ?? []).filter((n) => !wachtend.some((w) => w.id === n.id)), ...wachtend];

  const bijz = h("textarea", { id: "bijzonderheden", rows: 4, maxlength: 2000 }) as HTMLTextAreaElement;
  const aand = h("textarea", { id: "aandachtspunten", rows: 3, maxlength: 2000 }) as HTMLTextAreaElement;
  const magSchrijven = sessie.rol === "operator" || sessie.rol === "ploegleider";

  toon(
    h("div", { class: "kop" },
      h("div", {}, h("h1", {}, s ? `Overdracht ${s.ploegnaam.toLowerCase()}` : "Overdracht"),
        s ? h("p", { class: "sub" }, `${new Date(`${s.dag}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}, ${uur(s.begin_op)}–${uur(s.eind_op)}`) : null),
      vers ? null : h("span", { class: "label label-wacht" }, "Laatst bekende stand")),
    s
      ? h("section", { class: "overdracht-cijfers" },
          h("h2", {}, "Deze ploeg tot nu toe"),
          h("p", {}, cijferRegel(s)),
          s.per_stap.length ? h("p", { class: "sub" }, s.per_stap.map((p) => `${p.stap}: ${p.afgerond}`).join(" · ")) : null,
          s.nog_open.length
            ? h("div", {}, h("h3", {}, `Nog open (${s.nog_open.length})`),
                h("ul", { class: "lijst-klein" }, s.nog_open.map((o) => h("li", {}, `${o.stap} ${o.nummer}, ${o.operator}, sinds ${tijd(o.sinds)}`))))
            : h("p", { class: "sub" }, "Er staat niets open."))
      : h("p", { class: "leeg" }, "Zonder verbinding zijn de cijfers van deze ploeg niet bekend. Je kunt wel een overdracht schrijven."),
    notities.length ? h("section", {}, h("h2", {}, "Al geschreven"), h("ul", { class: "notities" }, notities.map(notitieBlok))) : null,
    magSchrijven
      ? h("form", {
          class: "overdracht-vorm",
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const b = bijz.value.trim(), a = aand.value.trim();
            if (!b && !a) return melding("Vul bijzonderheden of aandachtspunten in", "fout");
            if (!(await bevestig("Overdracht opslaan?", "De volgende ploeg ziet dit bovenaan het stappenoverzicht. Wijzigen kan daarna niet; je kunt wel een aanvulling schrijven.", "Opslaan"))) return;
            await voegToe({
              omschrijving: `Overdracht ${s?.ploegnaam.toLowerCase() ?? ""}`.trim(),
              methode: "POST",
              pad: "/overdracht",
              body: { id: nieuwId(), bijzonderheden: b || null, aandachtspunten: a || null, moment: new Date().toISOString() },
            });
            melding("Overdracht opgeslagen", "ok");
            void overdrachtScherm();
          },
        },
          h("h2", {}, notities.length ? "Aanvulling schrijven" : "Overdracht schrijven"),
          h("label", { for: "bijzonderheden" }, "Bijzonderheden van deze ploeg", h("small", { class: "hint" }, "Bijvoorbeeld: wat liep er goed of mis, wat is er gerepareerd"), bijz),
          h("label", { for: "aandachtspunten" }, "Aandachtspunten voor de volgende ploeg", h("small", { class: "hint" }, "Dit staat er bij de volgende ploeg vet bovenaan"), aand),
          h("button", { class: "knop knop-hoofd", type: "submit" }, "Overdracht opslaan"))
      : null,
  );
}
