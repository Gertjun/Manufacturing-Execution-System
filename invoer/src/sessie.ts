// Wat deze pc onthoudt: zijn eigen naam en het token van de ingelogde gebruiker.
import type { Rol } from "./types";

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
    return !!i && i.exp * 1000 > Date.now() + 15 * 60 * 1000;
  },

  get rol(): Rol | null {
    return this.inhoud()?.rol ?? null;
  },

  heeftNaam(): boolean {
    return !!this.inhoud()?.operatorId;
  },

  /** Afmelden geldt voor de hele app (D54): ook de startpagina en de portalen op deze pc melden af. */
  afmelden() {
    this.token = null;
    this.operatornaam = null;
    schrijf(PORTAAL_TOKEN, null);
  },

  /** Token van de startpagina (zelfde server, D54), als dat nog geldig is en bij een invoerrol hoort (Kwaliteit sinds 0.37.0: de lab-pc). */
  portaalToken(): string | null {
    const t = lees(PORTAAL_TOKEN);
    if (!t) return null;
    try {
      const i = JSON.parse(decodeURIComponent(escape(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))));
      // Kwaliteit alleen als ze net op de startpagina voor het invoerscherm koos (de lab-pc, D58). Anders zou een
      // pc waarop iemand van Kwaliteit in een portaal werkt, het invoerscherm ongevraagd als Kwaliteit openen.
      // De keuze geldt één keer, voor elke rol, zodat hij niet blijft liggen voor een volgende inlog.
      const gekozen = Number(lees("invoer.vanStart") ?? 0);
      schrijf("invoer.vanStart", null);
      if (i.exp * 1000 <= Date.now() + 15 * 60 * 1000) return null;
      if (i.rol === "operator" || i.rol === "ploegleider") return t;
      return i.rol === "kwaliteit" && Date.now() - gekozen < 2 * 60 * 1000 ? t : null;
    } catch {
      return null;
    }
  },
};
