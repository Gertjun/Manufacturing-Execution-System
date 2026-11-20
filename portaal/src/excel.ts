// Excel-export van een tabel: een echt .xlsx-bestand, gemaakt in de browser (geen server, geen extra bibliotheek).
// Een .xlsx is een zip met een paar XML-bestanden; de zip maken we ongecomprimeerd ("stored"), dat mag volgens de standaard.

const enc = new TextEncoder();

// ---------- zip ----------
const CRC_TABEL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABEL[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(bestanden: { naam: string; inhoud: string }[]): Uint8Array {
  const delen: Uint8Array[] = [];
  const centraal: Uint8Array[] = [];
  let positie = 0;
  for (const b of bestanden) {
    const naam = enc.encode(b.naam);
    const data = enc.encode(b.inhoud);
    const crc = crc32(data);
    const kop = new DataView(new ArrayBuffer(30));
    kop.setUint32(0, 0x04034b50, true);
    kop.setUint16(4, 20, true);
    kop.setUint16(6, 0x0800, true); // namen in UTF-8
    kop.setUint16(8, 0, true); // stored
    kop.setUint32(14, crc, true);
    kop.setUint32(18, data.length, true);
    kop.setUint32(22, data.length, true);
    kop.setUint16(26, naam.length, true);
    delen.push(new Uint8Array(kop.buffer), naam, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, naam.length, true);
    c.setUint32(42, positie, true);
    centraal.push(new Uint8Array(c.buffer), naam);
    positie += 30 + naam.length + data.length;
  }
  const grootte = centraal.reduce((a, b) => a + b.length, 0);
  const eind = new DataView(new ArrayBuffer(22));
  eind.setUint32(0, 0x06054b50, true);
  eind.setUint16(8, bestanden.length, true);
  eind.setUint16(10, bestanden.length, true);
  eind.setUint32(12, grootte, true);
  eind.setUint32(16, positie, true);
  const alles = [...delen, ...centraal, new Uint8Array(eind.buffer)];
  const uit = new Uint8Array(alles.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const d of alles) { uit.set(d, p); p += d.length; }
  return uit;
}

// ---------- xlsx ----------
const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** Een getal zoals het scherm het toont (1.234,5 of -0,08) als getal; al het andere blijft tekst. */
export function leesNlGetal(t: string): number | null {
  const s = t.trim();
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function kolomLetter(i: number): string {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

export interface Blad { naam: string; koppen: string[]; rijen: string[][] }

/** Eén werkblad met een kopregel. */
export function xlsx(blad: string, koppen: string[], rijen: string[][]): Uint8Array {
  return xlsxBladen([{ naam: blad, koppen, rijen }]);
}

/** Een werkmap met een of meer werkbladen, elk met een vaste kopregel en een filter. */
export function xlsxBladen(bladen: Blad[]): Uint8Array {
  const namen = bladen.map((b, i) => xml(b.naam.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Blad${i + 1}`));
  const werkblad = ({ koppen, rijen }: Blad) => {
    const breedte = koppen.map((k, i) => Math.min(60, Math.max(k.length, ...rijen.map((r) => (r[i] ?? "").length)) + 2));
    const cel = (r: number, c: number, v: string, kop = false) => {
      const ref = `${kolomLetter(c)}${r + 1}`;
      const n = kop ? null : leesNlGetal(v);
      if (n !== null) return `<c r="${ref}"><v>${n}</v></c>`;
      if (v === "") return "";
      return `<c r="${ref}" t="inlineStr"${kop ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    };
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${breedte.map((b, i) => `<col min="${i + 1}" max="${i + 1}" width="${b}" customWidth="1"/>`).join("")}</cols>
<sheetData>
<row r="1">${koppen.map((k, c) => cel(0, c, k, true)).join("")}</row>
${rijen.map((r, i) => `<row r="${i + 2}">${r.map((v, c) => cel(i + 1, c, v)).join("")}</row>`).join("\n")}
</sheetData>
<autoFilter ref="A1:${kolomLetter(Math.max(0, koppen.length - 1))}${rijen.length + 1}"/>
</worksheet>`;
  };
  return zip([
    { naam: "[Content_Types].xml", inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${bladen.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { naam: "_rels/.rels", inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { naam: "xl/workbook.xml", inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${namen.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
<definedNames>${bladen.map((b, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${namen[i].replace(/'/g, "''")}'!$A$1:$${kolomLetter(Math.max(0, b.koppen.length - 1))}$${b.rijen.length + 1}</definedName>`).join("")}</definedNames>
</workbook>` },
    { naam: "xl/_rels/workbook.xml.rels", inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${bladen.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${bladen.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { naam: "xl/styles.xml", inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>` },
    ...bladen.map((b, i) => ({ naam: `xl/worksheets/sheet${i + 1}.xml`, inhoud: werkblad(b) })),
  ]);
}

/** Biedt een Excel-bestand aan als download. */
export function downloadXlsx(data: Uint8Array, bestandsnaam: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = bestandsnaam;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const vandaag = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---------- xlsx lezen ----------
export type Cel = string | number | boolean | null;

/** Pakt de bestanden uit een zip (ongecomprimeerd of "deflate", zoals Excel en LibreOffice opslaan). */
async function pakUit(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf);
  let eind = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eind = i; break; }
  }
  if (eind < 0) throw new Error("Dit is geen Excel-bestand (.xlsx).");
  const aantal = v.getUint16(eind + 10, true);
  let p = v.getUint32(eind + 16, true);
  const uit = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < aantal; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("Het Excel-bestand is beschadigd.");
    const methode = v.getUint16(p + 10, true);
    const grootte = v.getUint32(p + 20, true);
    const naamLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), notaLen = v.getUint16(p + 32, true);
    const lokaal = v.getUint32(p + 42, true);
    const naam = dec.decode(new Uint8Array(buf, p + 46, naamLen));
    p += 46 + naamLen + extraLen + notaLen;
    if (!/^(xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml))$/.test(naam)) continue;
    const start = lokaal + 30 + v.getUint16(lokaal + 26, true) + v.getUint16(lokaal + 28, true);
    const data = new Uint8Array(buf, start, grootte);
    if (methode === 0) uit.set(naam, data);
    else if (methode === 8) {
      const stroom = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      uit.set(naam, new Uint8Array(await new Response(stroom).arrayBuffer()));
    } else throw new Error("Dit Excel-bestand gebruikt een onbekende compressie.");
  }
  return uit;
}

function kolomNummer(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Leest het eerste blad van een .xlsx als rijen met cellen (tekst, getal, ja/nee of leeg). */
export async function leesXlsx(bestand: Blob): Promise<Cel[][]> {
  const bladen = await leesXlsxBladen(bestand);
  const eerste = bladen.values().next();
  if (eerste.done) throw new Error("Geen werkblad gevonden in het Excel-bestand.");
  return eerste.value;
}

/** Leest alle bladen van een .xlsx, op naam en in de volgorde van de werkmap. */
export async function leesXlsxBladen(bestand: Blob): Promise<Map<string, Cel[][]>> {
  const delen = await pakUit(await bestand.arrayBuffer());
  const dec = new TextDecoder();
  const xmlVan = (naam: string) => {
    const d = delen.get(naam);
    return d ? new DOMParser().parseFromString(dec.decode(d), "application/xml") : null;
  };
  const gedeeld = [...(xmlVan("xl/sharedStrings.xml")?.getElementsByTagName("si") ?? [])].map((si) =>
    [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""));
  // Bladen volgens workbook.xml en de relaties; zonder werkmapgegevens alleen sheet1.xml.
  const wb = xmlVan("xl/workbook.xml"), rels = xmlVan("xl/_rels/workbook.xml.rels");
  const paden: [string, string][] = [];
  for (const sh of wb?.getElementsByTagName("sheet") ?? []) {
    const rid = sh.getAttribute("r:id") ?? sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = rels ? [...rels.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid) : undefined;
    const doel = rel?.getAttribute("Target");
    if (doel) paden.push([sh.getAttribute("name") ?? `Blad${paden.length + 1}`, doel.startsWith("/") ? doel.slice(1) : `xl/${doel.replace(/^\.\//, "")}`]);
  }
  if (!paden.length) paden.push(["Blad1", "xl/worksheets/sheet1.xml"]);
  const uit = new Map<string, Cel[][]>();
  for (const [naam, pad] of paden) {
    const blad = xmlVan(pad);
    if (!blad) continue;
    const rijen: Cel[][] = [];
    for (const rij of blad.getElementsByTagName("row")) {
      const nr = Number(rij.getAttribute("r") ?? rijen.length + 1) - 1;
      const cellen: Cel[] = [];
      for (const c of rij.getElementsByTagName("c")) {
        const kol = kolomNummer(c.getAttribute("r") ?? "A");
        const t = c.getAttribute("t");
        const w = c.getElementsByTagName("v")[0]?.textContent ?? null;
        let waarde: Cel = null;
        if (t === "s") waarde = w === null ? null : gedeeld[Number(w)] ?? null;
        else if (t === "inlineStr") waarde = [...c.getElementsByTagName("t")].map((x) => x.textContent ?? "").join("");
        else if (t === "str" || t === "e") waarde = w;
        else if (t === "b") waarde = w === "1";
        else if (w !== null && w !== "") waarde = Number(w);
        while (cellen.length < kol) cellen.push(null);
        cellen[kol] = typeof waarde === "string" && waarde.trim() === "" ? null : waarde;
      }
      while (rijen.length < nr) rijen.push([]);
      rijen[nr] = cellen;
    }
    uit.set(naam, rijen);
  }
  if (!uit.size) throw new Error("Geen werkblad gevonden in het Excel-bestand.");
  return uit;
}

/** Leest een tabel van het scherm (kop en zichtbare tekst per cel) en biedt hem aan als download. */
export function tabelNaarExcel(tabel: HTMLTableElement, titel: string) {
  const koppen = [...tabel.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
  // Opengeklapte details (zoals een meting in het lotpaspoort) horen niet in de export.
  const rijen = [...tabel.querySelectorAll("tbody tr:not(.meting-detail)")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => {
      // Knoppen horen niet in de export.
      const kopie = td.cloneNode(true) as HTMLElement;
      kopie.querySelectorAll("button, .knoppen-klein").forEach((x) => x.remove());
      return (kopie.textContent ?? "").replace(/\s+/g, " ").trim();
    }));
  // Lege kolommen (alleen knoppen) laten we weg.
  const houden = koppen.map((k, i) => k !== "" || rijen.some((r) => (r[i] ?? "") !== ""));
  const k2 = koppen.filter((_, i) => houden[i]).map((k, i) => k || `Kolom ${i + 1}`);
  const r2 = rijen.map((r) => r.filter((_, i) => houden[i]));
  const data = xlsx(titel, k2, r2);
  downloadXlsx(data, `${titel.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()} ${vandaag()}.xlsx`);
}
