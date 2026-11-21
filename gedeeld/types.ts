// Vormen zoals de API ze teruggeeft (zie openapi.json).

export type Markering = "ok" | "buiten_tolerantie" | "buiten_grens";
export type Rol = "operator" | "ploegleider" | "kwaliteit" | "beheerder" | "analist" | "planner" | "scherm" | "productiemanager";

export interface Veld {
  code: string;
  naam: string;
  soort: "procesparameter" | "gewicht" | "overig";
  eenheid: string | null;
  grens_min: number | null;
  grens_max: number | null;
  tolerantie: number | null;
  tolerantie_soort: string;
  volgnummer: number;
  verplicht: boolean;
  actief: boolean;
  op_certificaat?: boolean;
  /** Aantal decimalen bij het tonen; leeg = automatisch (sinds 0.23.0). */
  decimalen?: number | null;
  /** Eigen grenzen per product; vervangen dan alle vier de grenswaarden (sinds 0.29.0, D55). */
  per_product?: GrensPerProduct[];
  /** Wie meet: de operator of Kwaliteit (sinds 0.37.0, #64). Ontbreekt in een oudere configuratie: productie. */
  gemeten_door?: "productie" | "kwaliteit";
}

export interface GrensPerProduct {
  product: string;
  grens_min: number | null;
  grens_max: number | null;
  tolerantie: number | null;
  tolerantie_soort: string;
}

export interface Stap {
  code: string;
  naam: string;
  volgorde: number;
  niveau: "batch" | "lot";
  is_lot_stap: boolean;
  velden: Veld[];
  /** Sinds 0.11.0; ontbreekt in een oudere opgeslagen configuratie. */
  grondstoffen?: { code: string; naam: string; eenheid: string | null; verplicht: boolean }[];
}

export interface GrondstofMetGebruik {
  code: string;
  naam: string;
  eenheid: string | null;
  verplicht: boolean;
  gebruik: { id: string; partij: string; hoeveelheid: number | null; gecorrigeerd: boolean; ingevoerd_op: string; wacht?: boolean } | null;
}

export interface Waarde {
  id: string;
  setting: number | null;
  gemeten: number;
  markering: Markering;
  gecorrigeerd: boolean;
  ingevoerd_op: string;
  /** Alleen lokaal: nog niet bij de server aangekomen. */
  wacht?: boolean;
}

export interface VeldMetWaarde {
  code: string;
  naam: string;
  soort: Veld["soort"];
  eenheid: string | null;
  grens_min: number | null;
  grens_max: number | null;
  tolerantie: number | null;
  tolerantie_soort: string;
  verplicht: boolean;
  decimalen?: number | null;
  /** Sinds 0.37.0 (#64); ontbreekt = productie. */
  gemeten_door?: "productie" | "kwaliteit";
  waarde: Waarde | null;
}

/** Keuring door Kwaliteit van een stap (sinds 0.37.0, #64). */
export interface Keuring {
  id: string;
  status: "open" | "vrijgegeven" | "herbewerken" | "afgekeurd";
  reden: string | null;
  besloten_door: string | null;
  besloten_op: string | null;
  /** Alleen lokaal: het besluit is nog niet bij de server. */
  wacht?: boolean;
}

export interface Registratie {
  id: string;
  stapcode: string;
  stapnaam: string;
  niveau: "batch" | "lot";
  batchnummer: string | null;
  lotnummer: string | null;
  poging: number | null;
  herbewerking_start: boolean;
  reden: string | null;
  status: "open" | "afgerond" | "afgebroken";
  operator: string;
  pc: string;
  gestart_op: string;
  afgerond_op: string | null;
  velden?: VeldMetWaarde[];
  grondstoffen?: GrondstofMetGebruik[];
  /** Productcode van de batch of het lot (sinds 0.29.0, D55). */
  product?: string | null;
  /** Keuring door Kwaliteit (sinds 0.37.0, #64). */
  keuring?: Keuring | null;
  /** Alleen lokaal: er wachten nog acties voor deze registratie. */
  lokaal?: boolean;
}

export interface Werkvoorraad {
  open: Registratie[];
  wachtend: { soort: "batch" | "lot"; nummer: string; sinds: string | null; product?: string | null; herbewerking?: string | null }[];
}

export interface Overzicht {
  stapcode: string;
  open: number;
  wachtend: number;
}
