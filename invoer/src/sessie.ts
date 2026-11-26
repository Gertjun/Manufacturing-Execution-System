// Wat deze pc onthoudt: zijn eigen naam en het token van de ingelogde gebruiker.
import type { Rol } from "./types";
import { neemPortaloverdracht, wisPortaloverdracht } from "../../gedeeld/portaloverdracht";

const PC = "invoer.pc";
const TOKEN = "invoer.token";
const NAAM = "invoer.operatornaam";
const PORTAAL_TOKEN = "portaal.token";

interface TokenInhoud {
  sub: string;
  naam: string;
  rol: Rol;
  pcId?: string;
  operatorId?: string;
  gedeeld?: boolean;    // het oude gedeelde operatoraccount: kiest een naam (D53)
  exp: number;
}

function lees(sleutel: string): string | null {
  try {
    return localStorage.getItem(sleutel);
  } catch {
    return null;
  }
}
function schrijf(sleutel: string, waarde: string | null) {
  try {
    if (waarde === null) localStorage.removeItem(sleutel);
    else localStorage.setItem(sleutel, waarde);
  } catch {
    /* opslag niet beschikbaar: alleen deze sessie */
  }
}

export const sessie = {
  get pc() {
    return lees(PC);
  },
  set pc(naam: string | null) {
    schrijf(PC, naam);
  },
  get token() {
    return lees(TOKEN);
  },
  set token(t: string | null) {
    schrijf(TOKEN, t);
  },
  get operatornaam() {
    return lees(NAAM);
  },
  set operatornaam(n: string | null) {
    schrijf(NAAM, n);
  },

  inhoud(): TokenInhoud | null {
    const t = this.token;
    if (!t) return null;
    try {
      const deel = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(decodeURIComponent(escape(atob(deel))));
    } catch {
      return null;
    }
  },

  /** Geldig token, met een kwartier marge. */
  geldig(): boolean {
    const i = this.inhoud();
    return !!i && !i.gedeeld && i.exp * 1000 > Date.now() + 15 * 60 * 1000;
  },

  get rol(): Rol | null {
    return this.inhoud()?.rol ?? null;
  },

  heeftNaam(): boolean {
    return !!this.inhoud()?.operatorId;
  },

  /** Wis uitsluitend de invoersessie, nooit de registraties of wachtrij. */
  wisInvoersessie() {
    this.token = null;
    this.operatornaam = null;
  },
  actueelPortaalToken(): string | null { return lees(PORTAAL_TOKEN); },
  /** Afmelden geldt voor de hele app (D54). */
  afmelden() {
    this.wisInvoersessie();
    wisPortaloverdracht();
    schrijf(PORTAAL_TOKEN, null);
  },

  /** Eenmalige expliciete keuze, aan het actuele portaal-JWT gebonden. */
  portaalToken(): string | null {
    const t = this.actueelPortaalToken();
    const gekozen = neemPortaloverdracht(t);
    if (!t || !gekozen) return null;
    try {
      const i = JSON.parse(decodeURIComponent(escape(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))));
      if (i.gedeeld || !Number.isFinite(i.exp) || i.exp * 1000 <= Date.now() + 15 * 60 * 1000) return null;
      return t;
    } catch { return null; }
  },
};
