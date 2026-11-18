// Wat deze pc onthoudt: zijn eigen naam en het token van de ingelogde gebruiker.
import type { Rol } from "./types";

const PC = "invoer.pc";
const TOKEN = "invoer.token";
const NAAM = "invoer.operatornaam";

interface TokenInhoud {
  sub: string;
  naam: string;
  rol: Rol;
  pcId?: string;
  operatorId?: string;
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
    return !!i && i.exp * 1000 > Date.now() + 15 * 60 * 1000;
  },

  get rol(): Rol | null {
    return this.inhoud()?.rol ?? null;
  },

  heeftNaam(): boolean {
    return !!this.inhoud()?.operatorId;
  },

  afmelden() {
    this.token = null;
    this.operatornaam = null;
  },
};
