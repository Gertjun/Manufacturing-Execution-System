// D64 + uitbreiding opdrachtgever: CSS-viewports, niet fysieke schermpixels of Windows-DPI.
export const FORMATEN = [
  { naam: "telefoon staand", width: 390, height: 844, mobiel: true },
  { naam: "telefoon liggend", width: 844, height: 390, mobiel: true },
  { naam: "tablet staand", width: 820, height: 1180, mobiel: true },
  { naam: "tablet liggend", width: 1180, height: 820, mobiel: true },
  { naam: "laptop", width: 1280, height: 800, mobiel: false },
  { naam: "pc", width: 1440, height: 900, mobiel: false },
  { naam: "Full HD", width: 1920, height: 1080, mobiel: false },
  { naam: "4K UHD", width: 3840, height: 2160, mobiel: false },
];

// D115: standaard ontwikkelmatrix; volledige matrix en displaytests blijven beschikbaar.
export const BASISFORMATEN = FORMATEN.filter(f => ["telefoon staand", "tablet staand", "laptop"].includes(f.naam));
