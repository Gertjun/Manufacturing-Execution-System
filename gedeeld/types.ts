// Vormen zoals de API ze teruggeeft (zie openapi.json).

export type Markering = "ok" | "buiten_tolerantie" | "buiten_grens";
export type Rol = "operator" | "ploegleider" | "kwaliteit" | "beheerder" | "analist" | "planner" | "scherm";

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
}

export interface Stap {
  code: string;
  naam: string;
  volgorde: number;
  niveau: "batch" | "lot";
  is_lot_stap: boolean;
  velden: Veld[];
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
  waarde: Waarde | null;
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
  /** Alleen lokaal: er wachten nog acties voor deze registratie. */
  lokaal?: boolean;
}

export interface Werkvoorraad {
  open: Registratie[];
  wachtend: { soort: "batch" | "lot"; nummer: string; sinds: string | null }[];
}

export interface Overzicht {
  stapcode: string;
  open: number;
  wachtend: number;
}
