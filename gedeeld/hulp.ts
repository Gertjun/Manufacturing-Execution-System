// Hulp per rol (ROADMAP #36, D59): één bron voor de hulp in het invoerscherm en de portalen, en voor de
// afdrukbare A4 per rol. Korte zinnen, de woorden van de schermen (D51). Schrijf hier alleen wat de schermen
// echt doen; verandert een scherm, pas dan ook deze tekst aan (de schermtest controleert de knoppen die hier staan niet).
import type { Rol } from "./types";
import { h } from "./ui";

export interface HulpDeel { kop: string; punten: string[] }
export interface Hulp { titel: string; voor: string; delen: HulpDeel[] }

const inloggen: HulpDeel = {
  kop: "Inloggen",
  punten: [
    "Log in met je eigen gebruikersnaam en wachtwoord. Na 5 verkeerde wachtwoorden wacht je 1 minuut. Vergeten? De beheerder geeft je een tijdelijk wachtwoord; daarna kies je zelf een nieuw.",
    "Inloggen kan alleen met verbinding. Wie al is ingelogd, kan zonder verbinding doorwerken.",
  ],
};

const zonderVerbinding: HulpDeel = {
  kop: "Zonder verbinding",
  punten: [
    "Werk gewoon door. Rechtsboven staat \"Geen verbinding\" en hoeveel acties wachten. Ze gaan later mee, met het tijdstip van invoer en jouw naam.",
    "Wis de browsergegevens niet en gebruik geen privévenster: dan gaat wat wacht verloren.",
    "Zoeken, correcties en inloggen vragen wel verbinding.",
    "Staat er \"geweigerd\"? Klik erop en laat het de ploegleider zien.",
  ],
};

const stapDoen: HulpDeel = {
  kop: "Een stap doen",
  punten: [
    "Kies bij Stappen jouw stap: bovenaan wat bezig is (van de vorige ploeg: Afmaken), daaronder wat klaar is om te starten.",
    "Druk bij de batch op Start. Vul de waarden en de partijnummers van de grondstoffen in. Tijdens het typen zie je of een waarde buiten tolerantie (oranje) of buiten grens (rood) valt.",
    "Druk op Opslaan, en als alles is ingevuld op Stap afronden. Een opgeslagen waarde wijzigt alleen de ploegleider (correctie).",
    "\"Herbewerking\": de batch doet deze stap opnieuw; start hem zoals altijd.",
    "\"Wacht op Kwaliteit\": Kwaliteit meet nog iets; de batch gaat pas verder na de vrijgave.",
  ],
};

const eersteEnLot: HulpDeel = {
  kop: "Stap 1 en het lot",
  punten: [
    "In stap 1 start je een geplande batch. Een ongeplande batch (\"Aanmaken en starten\") is een uitzondering.",
    "In stap 16 worden 4 batches van hetzelfde product één lot: kies het lotvoorstel van de planner (\"Dit voorstel kiezen\") of vink 4 batches aan, en druk op Lot samenstellen. Afwijken van het voorstel vraagt een reden. Dit kan niet ongedaan worden gemaakt.",
  ],
};

const scannenEnMeer: HulpDeel = {
  kop: "Scannen, etiket, stilstand, overdracht",
  punten: [
    "Handscanner: scan in een stap, buiten een invoerveld. Een batch die bezig is, opent; die klaarstaat, start; in stap 16 wordt hij aangevinkt.",
    "Etiket: open de batch en druk op Etiket printen.",
    "Stilstand: druk in de stap op Stilstand melden en kies de oorzaak. Loopt het weer, druk dan op Stilstand beëindigen en schrijf kort op wat er is gedaan.",
    "Begin van de dienst: lees de overdracht van de vorige ploeg bovenaan Stappen en druk op Gelezen. Eind van de dienst: Overdracht, vul bijzonderheden en aandachtspunten in, Overdracht opslaan. Daarna Afmelden.",
  ],
};

const HULP: Partial<Record<Rol, Hulp>> = {
  operator: {
    titel: "Hulp voor operators",
    voor: "Het invoerscherm op de vloer.",
    delen: [inloggen, stapDoen, eersteEnLot, scannenEnMeer, zonderVerbinding],
  },
  ploegleider: {
    titel: "Hulp voor ploegleiders",
    voor: "Het invoerscherm, zoals een operator, en de portalen Productieanalyse en Planning.",
    delen: [
      inloggen,
      {
        kop: "Wat alleen de ploegleider doet",
        punten: [
          "Corrigeren: open de stap, druk bij de waarde of het partijnummer op Corrigeer, geef de nieuwe waarde en een reden (alleen met verbinding).",
          "In beoordeling zetten: Zoeken, batchnummer, In beoordeling zetten, met reden; Kwaliteit beslist.",
          "Meldingen (buiten grens, storing) staan in de balk bovenaan.",
          "Wachtrij: klik rechtsboven op de verbinding voor wat wacht of geweigerd is; Nu versturen probeert opnieuw.",
          "Portalen: Productieanalyse, het wandscherm en Nainvoeren (papier) voor wat op papier stond.",
        ],
      },
      stapDoen, eersteEnLot, scannenEnMeer,
      // Zonder de laatste twee punten: die staan voor de ploegleider al bij Wachtrij en Corrigeren.
      { kop: zonderVerbinding.kop, punten: zonderVerbinding.punten.slice(0, 2) },
    ],
  },
  kwaliteit: {
    titel: "Hulp voor Kwaliteit",
    voor: "Portaal Kwaliteit, en het invoerscherm op de lab-pc.",
    delen: [
      inloggen,
      {
        kop: "Te beoordelen",
        punten: [
          "Batches die de ploegleider of het systeem in beoordeling zette: kies OK of NOK (met reden), of Herbewerken.",
          "Daaronder: batches en lots die op een meting van Kwaliteit wachten. Het getal in het menu telt beide.",
        ],
      },
      {
        kop: "Meten op de lab-pc",
        punten: [
          "Kies op de startpagina de tegel Invoerscherm, of log in het invoerscherm zelf in. Alleen via die tegel neemt het invoerscherm je inlog uit de portalen over.",
          "Bovenaan Stappen staat \"Wacht op Kwaliteit\". Druk op Meten, vul de metingen in en kies dan:",
          "Vrijgeven: kan pas als alle verplichte metingen er zijn; daarna gaat de batch of het lot verder.",
          "Herbewerken: kies naar welke stap hij terug moet, met een reden. Afkeuren: met een reden; een batch krijgt NOK, een lot wordt geblokkeerd.",
          "Keuringen (TK, EK): kies de tegel onder Keuringen en dan Keuring starten; meet en beslis daarna zoals hierboven.",
          "Dit werkt ook zonder verbinding: het gaat later mee.",
        ],
      },
      {
        kop: "Specificaties",
        punten: [
          "Per product en keuring waar het product aan moet voldoen. Nieuwe versie: pas de grenzen aan en kies Vaststellen; de vorige vervalt, eerdere metingen houden hun versie.",
        ],
      },
      {
        kop: "Herbewerkingen",
        punten: [
          "Een herbewerking maak je bij de batch, in het lotpaspoort of bij Te beoordelen. Een batch kan alleen terug zolang hij nog niet in een lot zit.",
          "Bij Herbewerkingen en afkeur zie je de stand (nog te plannen, gepland, bezig) en kun je een herbewerking intrekken.",
        ],
      },
      {
        kop: "Lotpaspoort en certificaat",
        punten: [
          "Lotpaspoort: vul het lotnummer in. Afwijkingen staan bovenaan; klik op een resultaat voor de meting en de correcties. Afdrukken kan.",
          "Certificaat: vanuit het lotpaspoort. Uitgeven kan als het lot gereed is en voldoet; daarna Afdrukken of pdf.",
        ],
      },
      {
        kop: "Analyses",
        punten: [
          "Kies bovenin het menu een product, of alle producten. Die keuze blijft op deze computer staan.",
          "Regelkaarten (onder 20 metingen voorlopig), Afwijkingen, Trend per veld en Grondstoffen terugzoeken. Elke tabel kan Naar Excel.",
        ],
      },
    ],
  },
  productiemanager: {
    titel: "Hulp voor de productiemanager",
    voor: "De portalen Productieanalyse, Kwaliteit en Planning.",
    delen: [
      inloggen,
      {
        kop: "Herbewerking en beoordeling",
        punten: [
          "Een herbewerking maak je bij de batch, in het lotpaspoort of bij Te beoordelen (portaal Kwaliteit). Een batch kan alleen terug zolang hij nog niet in een lot zit.",
          "Bij Herbewerkingen en afkeur zie je de stand en kun je een herbewerking intrekken.",
          "Een batch in beoordeling zetten kan op de pagina van de batch. Het keurresultaat (OK of NOK) geeft Kwaliteit.",
        ],
      },
      {
        kop: "Productieanalyse",
        punten: [
          "Werkvoorraad: per stap wat bezig is en klaarstaat. Doorlooptijden en Productie per week, per dag, week of maand te groeperen.",
          "Ploegoverdracht: per dag hoeveel van de planning klaar is. Stilstand: per stap en oorzaak, met de beschikbaarheid.",
          "Elke tabel kan Naar Excel. Planning kun je bekijken; plannen doet de planner.",
        ],
      },
    ],
  },
  planner: {
    titel: "Hulp voor de planner",
    voor: "Portaal Planning.",
    delen: [
      inloggen,
      {
        kop: "Plannen",
        punten: [
          "Batches plannen: per dag het aantal en het product. Het systeem geeft de nummers. Per dag zie je per product hoeveel er starten tegen wat de eerste stap aankan.",
          "Batches wijzigen: Eerder, Later of Andere dag, of Laten vervallen met een reden.",
          "Stappen plannen: per dag en stap Toevoegen. Een ⚠ betekent dat de vorige stap niet op tijd is, niet bij de route hoort of de stap te vol zit. Plannen mag dan toch.",
          "Lotvoorstellen: Nieuw lotvoorstel met 4 batches van hetzelfde product. De operator kiest het voorstel in stap 16.",
        ],
      },
      {
        kop: "Instellen",
        punten: [
          "Producten: per product de route, welke stappen en in welke volgorde. Route opslaan.",
          "Capaciteit: per product elke stap van de route, wat er per dag kan (leeg = nog invullen); de eerste stap bepaalt hoeveel batches van een product per dag starten. Afwijkende dagen voor een product en/of stap, als percentage (0 % = geen productie). Het systeem waarschuwt bij te vol, maar blokkeert niet.",
          "Etiketten: per dag printen, voor de etiketprinter (100 × 50 mm) of een A4-vel (3 × 7).",
        ],
      },
    ],
  },
  beheerder: {
    titel: "Hulp voor de beheerder",
    voor: "Portaal Beheer.",
    delen: [
      inloggen,
      {
        kop: "Medewerkers",
        punten: [
          "Medewerker toevoegen: naam bij de invoer, rol, ploeg (A1 … E2), gebruikersnaam en een tijdelijk wachtwoord van minstens 8 tekens; bij de eerste inlog kiest de medewerker een eigen wachtwoord. Operators en ploegleiders staan in één blok, Kwaliteit in een eigen blok.",
          "Veel medewerkers tegelijk: Sjabloon downloaden, in Excel aanvullen, Sjabloon inlezen. Je ziet eerst een controle. Gooi het bestand met wachtwoorden daarna weg.",
          "Niets wordt verwijderd, alleen uitgezet. Er blijft altijd minstens één actieve beheerder.",
          "Zet het oude gedeelde account operator pas uit als de wachtrijen op de pc's leeg zijn.",
          "Tv in de hal: een account met rol scherm, op de tv inloggen en de browser op volledig scherm zetten (F11).",
        ],
      },
      {
        kop: "Stappen en velden",
        punten: [
          "Per veld: soort, eenheid, verplicht, tolerantie, grenzen, decimalen, op het certificaat, en wie meet (Productie of Kwaliteit). Per product kunnen grenzen anders zijn.",
          "Zet een veld pas op Kwaliteit als alle pc's de nieuwe versie hebben.",
          "Veel tegelijk: Sjabloon downloaden, in Excel aanpassen, Sjabloon inlezen. Je ziet eerst een controle; pas daarna wordt er iets opgeslagen.",
        ],
      },
      {
        kop: "Overig",
        punten: [
          "Pc's: per pc welke stappen er te zien zijn. Grondstoffen, Diensten en ploegen (met het rooster van ploegen A–E per divisie), Oorzaken van stilstand en Bedrijfsgegevens (voor het certificaat).",
          "Logboek: elke wijziging, wie, wanneer, oud en nieuw. Server: versie, laatste back-up en hersteltest, waarschuwingen.",
          "Opmerkingen: wat gebruikers via \"Iets melden\" doorgeven. Handel ze af met een notitie, bijvoorbeeld het roadmapnummer.",
          "Nainvoeren (papier), op de startpagina: stappen die op papier zijn bijgehouden later invoeren, tot 7 dagen terug. Daar ook de lege formulieren per stap voor de terugvalmap.",
          "Wachtwoord van de beheerder vergeten: op de laptop BEHEERDER HERSTELLEN.bat, op de server tools\\beheerder.mjs.",
        ],
      },
    ],
  },
  analist: {
    titel: "Hulp voor de analist",
    voor: "De portalen, alleen lezen.",
    delen: [
      inloggen,
      {
        kop: "Analyses",
        punten: [
          "Je ziet de portalen Kwaliteit en Productieanalyse, maar kunt niets wijzigen.",
          "Kies bovenin het menu een product en boven de tabel de periode. Elke tabel kan Naar Excel.",
        ],
      },
    ],
  },
};

/** Rollen met hulp, in de volgorde van de keuzelijst. */
export const HULP_ROLLEN = (Object.keys(HULP) as Rol[]);

export function hulpVoor(rol: Rol | null | undefined): Hulp {
  return HULP[rol ?? "operator"] ?? HULP.operator!;
}

/** De hulp als blok; afdrukken geeft één A4 (gedeeld/hulp.css). */
/** Met keuze: knoppen of een rolkeuze rechts naast de titel, zoals de kop van andere schermen (niet afgedrukt). */
export function hulpBlad(rol: Rol | null | undefined, versie: string, keuze?: Node): HTMLElement {
  const hp = hulpVoor(rol);
  return h("article", { class: "hulp" },
    h("div", { class: "hulp-kop" }, h("h1", {}, hp.titel), keuze ?? null),
    h("p", { class: "hulp-voor" }, hp.voor),
    hp.delen.map((d) => h("section", { class: "hulp-deel" }, h("h2", {}, d.kop), h("ul", {}, d.punten.map((p) => h("li", {}, p))))),
    h("p", { class: "hulp-voet" }, `Batch input GUI, versie ${versie}. Klopt iets niet of kan het beter? Druk op "Iets melden" in het scherm.`));
}
