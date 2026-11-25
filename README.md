# MES

> **MES-transitie (ontwerp):** de huidige software blijft versie 0.62.1. Goedgekeurde architectuur in [docs/mes/BLUEPRINT.md](docs/mes/BLUEPRINT.md), besluiten D89 en geïntegreerde [ROADMAP.md](ROADMAP.md). PR #1 wordt niet gemerged; de nieuwe implementatie vertrekt vanaf main. Op de ontwikkelbranch is het fase-1-fundament in uitvoering; geen uitgebrachte MES-versie.

Platform om per batch en per lot de productiegegevens van de fabriek vast te leggen en te analyseren. Batches doorlopen 18 processtappen; in stap 16 worden 4 batches samengevoegd tot 1 lot. Alles werkt lokaal en offline. **Alle namen, nummers en waarden in deze repository zijn fictief.**

## Waar vind je wat

Elk onderwerp staat op één plek; de andere bestanden verwijzen ernaar (D48).

| | Vraag | Bestand |
| --- | --- | --- |
| Heden | Waar staan we nu, hoe zit het in elkaar, hoe start en test je het? | dit bestand, `README.md` |
| Toekomst | Wat moet er nog gebeuren, in welke volgorde en wanneer? | [`ROADMAP.md`](ROADMAP.md) |
| Verleden | Wat is er per versie veranderd? | [`CHANGELOG.md`](CHANGELOG.md) |
| Verleden | Waarom is iets zo gekozen? | [`DECISIONS.md`](DECISIONS.md) |

De opbouw van de database als plaatje: [`docs/DATABASE.md`](docs/DATABASE.md) (automatisch gemaakt uit `db/schema.sql`, D84). Handleidingen voor een bepaalde lezer: [`docs/SERVER.md`](docs/SERVER.md) (IT installeert de fabrieksserver), [`docs/PRAKTIJKTESTS.md`](docs/PRAKTIJKTESTS.md) (de tests met echte apparaten en het fabrieksnetwerk, #33), [`tools/pakket/README.md`](tools/pakket/README.md) (het laptoppakket, gaat mee in de zip) en [`CLAUDE.md`](CLAUDE.md) (werkafspraken voor Claude).

## Stand

Bijgewerkt: 25 november 2026 · versie **0.62.1** (ongewijzigd).

- **Ontwikkeling:** MES-fase 1, concept-PR #6 op `feature/mes-phase-1`. Tussentijdse inhoudelijke audit D100 afgesloten; faseacceptatie open; databaseschema 0094. Scope en open punten in ROADMAP.md.
- **Laatste geslaagde technische baseline:** Run [45575488676 (#499)](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45575488676), job 139072267943, head de213112f706f7bbcbd07b4928c93e36e6d7ba02, base 31c86973bf13848cba44fc38785084953fe65e39: gerichte PostgreSQL-baseline geslaagd; schone installatie, schema-equivalentie 0001–0094, beperkte rechten, historische upgrade 0035–0094 met behoud van tien historische tabellen en zonder automatische legacy-grants, D102 eenmalige initialisatie, 14/14 security, 10/10 autorisatie, 117/117 API, back-up/herstel/rollback en Linux-laptoppakket. Documentatiecontrole 45575458558 geslaagd. Geen volledige Node 26-acceptatie of Windows-praktijkbewijs.
- **Afzonderlijk offline-testbewijs:** D101 offline-permissioncontrole en gezamenlijke IndexedDB-opslag geïmplementeerd. D101: [Node 22-compatibiliteitsrun 45558147763](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45558147763), job 139015099770, head 6aaa391c1afa9e516d8d512573249feedb1a6d60, base 31c86973bf13848cba44fc38785084953fe65e39: 22/22 gerichte Chrome/IndexedDB-controles geslaagd, API-typecheck en beide applicatiebuilds groen; documentatiecontrole eveneens groen. Fictieve sessies en gesimuleerde serverweigering; geen integrale scherm-/netwerkacceptatie. Volledige Node 26-suite overgeslagen.
- **Omgevingen:** Windows-laptoppakket verplicht voor PoC/acceptatie; actuele lokale installatie niet opnieuw vastgesteld. Fabrieksserver nog niet ingericht voor zover vastgesteld. Browserdemo volgens D99 buiten verplichte scope; verplichte demo-tests en versieafhankelijkheid uitgefaseerd, historische bron blijft behouden.
- **Schermvalidatie:** Run [45616999067](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45616999067), job 139214856901, head 2e25ac588a081335ee16e75979e1212bb06a23df, base 31c86973bf13848cba44fc38785084953fe65e39: alle 16 verplichte Chrome/PostgreSQL-schermtestsuites geslaagd (768 getelde OK-controles, nul fouten), Node 26 API-typecheck, beide builds en offline-rechtenregressie geslaagd; documentatiecontrole 45616998994 groen. Uitsluitend fictieve gegevens; applicatie gebruikt beperkte mes_app-verbinding, eigenaar uitsluitend voor testvoorbereiding en DB-asserties. Geen volledige acceptatie of Windows-praktijkbewijs.
- **Open:** operationele security-inrichting, Windows-praktijkvalidatie en volledige Node 26-acceptatie; integrale testreview afgerond; volledige acceptatie nog vereist. Zie docs/mes/ACCEPTANCE-CRITERIA.md.
- **Databaseplaatje:** schema 0094, 62 tabellen en 132 verbanden; generator en test geslaagd (run 45577237440).
- **Releases:** uitsluitend op aanvraag na acceptatie. Geen merge of release uitgevoerd. Uitsluitend fictieve gegevens.

**Links**
- Code: https://github.com/Gertjun/Manufacturing-Execution-System (privé)
- Browserdemo (historische momentopname, niet ondersteund): https://claude.ai/artifact/AvBGewCSnACg6h6CeUKZQN
- Invulblad praktijktests (blijft actueel, de uitkomsten van #33): https://claude.ai/artifact/WQn3YnEVcuy5W5ieXenwRg
- Projectdocument in het Claude-project: `claude/architectuur-en-besluiten.md` (korte instap met links)
- Momentopnamen, worden niet bijgewerkt: Whiteboard eerste projectplan https://claude.ai/artifact/Nm9L5rFHZY6Dtgk2JMncnF · advies fabrieksserver https://claude.ai/artifact/XbFZ7nQRDn18zSS5tnQhUf · datamodel v1 https://claude.ai/artifact/54cg2QSsWQ3j6hbkzYBVTA · doorlichting 19-11-2026 https://claude.ai/artifact/6FL8onRKNHTbnqJWSF6U7i · UI/UX-review 20-11-2026 https://claude.ai/artifact/EK83QWUsor3w4ofFDzBra4

## Het platform in het kort

Eén platform met één login. Na het inloggen toont de startpagina (`/`, D54) een tegel voor elk onderdeel waar je account bij mag; een operator gaat meteen naar het invoerscherm. Elke afdeling heeft een eigen portaal; het invoerscherm voor de vloer is technisch een aparte, eenvoudige app die offline werkt. Alles gebruikt dezelfde server, accounts en database; de rol bepaalt wat iemand ziet (D10).

| Onderdeel | Adres | Voor wie |
| --- | --- | --- |
| Invoerscherm | `/invoer/` | Operators en ploegleiders op de vloer, en Kwaliteit op de lab-pc (eigen startscherm Keuringen met openstaande metingen en besluiten en beschikbare keuringsstappen, D78/D96; metingen en keuring, D58; keuringsstappen TK en EK, D73); werkt offline |
| Portaal Kwaliteit | `/portaal/` | Kwaliteit |
| Startpagina | `/` (stuurt door naar `/portaal/`) | Iedereen, na het inloggen |
| Portaal Manufacturing Operations | `/portaal/` | Ploegleiders, productieleiding |
| Portaal Planning | `/portaal/` | Planners (ploegleiders kijken mee) |
| Portaal Beheer | `/portaal/` | Beheerder |
| Wandscherm | `/portaal/#/wandscherm` | Tv in de hal |
| API-documentatie | `/docs` | Ontwikkelaars, latere koppelingen |

**Rollen:** iedereen heeft een eigen account (D53); operator, ploegleider (ook corrigeren en in beoordeling zetten), kwaliteit (keurresultaat, certificaat, herbewerking; meet en keurt in het invoerscherm op de lab-pc, D58), productiemanager (portalen Manufacturing Operations, Kwaliteit en Planning; in beoordeling zetten en herbewerking, D57), planner, beheerder, analist (alleen lezen), scherm (alleen het wandscherm).

**Inloggen:** hoofdletters in de gebruikersnaam tellen niet mee. Na 5 verkeerde wachtwoorden binnen 15 minuten moet je 1 minuut wachten; elke poging wordt vastgelegd (zonder wachtwoord) en Beheer → Server waarschuwt bij veel mislukte pogingen (D45).

**Testaccounts** (alleen in de fictieve testdata, nooit in een echte installatie, wachtwoord `demo`): `operator.a` en `operator.b` (eigen account, D53), `operator` (het oude gedeelde account, kiest een naam), `ploegleider1`, `ploegleider2`, `kwaliteit1`, `productiemanager1`, `beheerder1`, `analist1`, `planner1`, `scherm1`.

### Invoerscherm
- Per stap zie je wat bezig is, wat klaarstaat en wat gepland is voor vandaag. Het formulier komt uit de velden die per stap zijn ingesteld; tijdens het typen zie je of een waarde buiten tolerantie of grens valt.
- Stap 1: een geplande batch starten (een ongeplande batch is een uitzondering). Stap 16: 4 batches samenvoegen tot een lot, volgens het lotvoorstel of met een reden.
- Grondstofpartijen invoeren, stilstand melden en beëindigen, ploegoverdracht schrijven, etiketten printen, scannen met een handscanner.
- Ploegleiders corrigeren waarden en zetten een batch in beoordeling; ze zien ook de meldingen.
- **Twee keer ingevuld:** vullen twee mensen hetzelfde veld of dezelfde grondstof in, dan blijft de eerste staan en staat de tweede als conflict bij het veld; een ploegleider (bij een veld van Kwaliteit: Kwaliteit) kiest welke blijft (D75).
- **Iets melden:** in de balk van het invoerscherm (ook zonder verbinding, via de wachtrij) en onderaan het menu van de portalen; de beheerder ziet ze bij Beheer → Opmerkingen en handelt ze af (D62).
- **Nainvoeren van papier:** lag de invoer stil, dan voert de ploegleider of beheerder de stap later in via de tegel "Nainvoeren (papier)", met de tijden van het papier (tot 7 dagen terug); daar ook de lege formulieren per stap (D60).
- **Overnemen:** een open stap kan iedereen met een invoerrol afmaken, ook die een ander op een andere pc startte ("Afmaken" bij Bezig). Vastgelegd wordt wie startte en waar, en wie afrondde en waar (D60).
- **Zonder verbinding** gaat de invoer door: alles wordt op de pc bewaard en daarna op volgorde verstuurd, met het moment van invoer en de naam van wie het invoerde (D43). De statusbalk toont hoeveel acties wachten; afmelden met wachtende acties vraagt eerst om bevestiging. Correcties, besluiten, zoeken en inloggen vragen wel verbinding.

### Portaal Kwaliteit
Bij de analyses en in het lotpaspoort staat in de filterbalk een gele productkeuze: alle producten of één product, onthouden op deze computer (D55, D82). Hetzelfde geldt voor doorlooptijden, productie per week en correcties in Manufacturing Operations.

| Onderdeel | Wat je ziet |
| --- | --- |
| Overzicht | Kerncijfers, afwijkingen per week, velden met de meeste afwijkingen |
| Te beoordelen | Batches in beoordeling; Kwaliteit voert hier OK, NOK of Herbewerken in. Daaronder wat op een meting van Kwaliteit wacht (D58) |
| Lotpaspoort | Eén lot met zijn 4 batches, afwijkingen bovenaan (klik op het resultaat voor de meting, correcties en keurresultaat), grondstofpartijen, afdrukbaar; met etiket en certificaat |
| Certificaat | Analysecertificaat per lot: concept, uitgeven met volgnummer, afdrukken of pdf (D37) |
| Grondstoffen terugzoeken | Op partijnummer: in welke batches en lots zit die partij |
| Regelkaarten | Per veld een regelkaart met signalen en Cpk (D38); onder 20 metingen voorlopig en zonder Cpk |
| Afwijkingen | Alle metingen buiten tolerantie of grens, met filters |
| Trend per veld | Eén veld door de tijd, met tolerantielijnen (oranje, gestreept) en grenzen (rood) |
| Specificaties | Per product en keuringsstap (TK, EK) waar het product aan moet voldoen, met versies: concept, vaststellen, eerdere versies. Metingen in een keuring houden hun versie; die staat ook op het certificaat (D73) |
| Herbewerkingen en afkeur | Lopende herbewerkingen met hun stand (nog te plannen, gepland, bezig), afgeronde en ingetrokken, en afgekeurde batches; een herbewerking aanmaken kan bij de batch, in het lotpaspoort of bij Te beoordelen (D57) |

### Portaal Manufacturing Operations
| Onderdeel | Wat je ziet |
| --- | --- |
| Werkvoorraad | Per stap wat bezig is en klaarstaat, met de langste wachttijd |
| Doorlooptijden | Per stap wachttijd en bewerkingstijd (mediaan en 90%); per week de batch, het wachten op het lot, het lot en het totaal per lot (#99) |
| Productie per week | Batches gestart en klaar, lots gereed, afkeur; grafieken lots gereed en batches gestart per dag, week of maand |
| Correcties | Oude en nieuwe waarde, reden, wie corrigeerde |
| Ploegoverdracht | Per dag hoeveel van de planning klaar is, en de diensten met hun ploegen, cijfers, afwijkingen (welke, #98) en overdrachten (D32) |
| Stilstand | Wat nu stilligt, per stap en oorzaak, beschikbaarheid en kwaliteit (D34) |

### Portaal Planning
| Onderdeel | Wat je kunt doen |
| --- | --- |
| Batches plannen | Batches per dag plannen, de dagen onder elkaar, per product de starts tegen de capaciteit; het systeem geeft de nummers. Verschuiven of laten vervallen met reden (D29) |
| Stappen plannen | Per dag en stap welke batches of lots gedaan moeten worden. Bij Toevoegen staat apart wat klaar is, wat op tijd klaar komt en waarvan de vorige stap niet op tijd is; dat laatste mag, met ⚠ (D52) |
| Dagoverzicht | Alle stappen van één dag onder elkaar, met ⚠ waar de vorige stap niet op tijd is (D52); naar een dag springen met de kalender (#97) |
| Batchroute | Per batch die nog niet in een lot zit: per stap klaar, bezig of de geplande dag, met ⚠ en een filter (D52, #48) |
| Lotvoorstellen | Voorstellen welke 4 batches samen een lot worden |
| Producten | Producten toevoegen, hernoemen of uitzetten, en per product de route: welke stappen het doorloopt en in welke volgorde (D55) |
| Capaciteit | Per product elke stap van zijn route met wat die stap aankan in kg per uur, dag en maand (één invullen, D80), met het gewicht per batch en hoeveel batches of lots per dag dat zijn, elke dag gelijk; een stap zonder capaciteit staat op "nog invullen" en telt in het menu (D71). De eerste stap van de route bepaalt hoeveel batches van een product per dag starten (D55, D69). Afwijkende dagen voor een product en/of stap als percentage (0 % = geen productie). Waarschuwing bij te vol in Batches plannen, Stappen plannen en het Dagoverzicht; plannen mag wel (D36) |
| Etiketten | Etiketten per dag printen: etiketprinter 100 × 50 mm of A4-vel 3 × 7 (D35) |

### Portaal Beheer
| Onderdeel | Wat je kunt doen |
| --- | --- |
| Stappen en velden | Namen, velden, setting, tolerantie en grenzen, op het certificaat; codes worden nooit hergebruikt. Per veld ook het aantal decimalen bij het tonen, wie meet (Productie of Kwaliteit, D58) en eigen grenzen per product (D55): bovenaan kies je een product, dan zie je de stappen van dat product en hun grenzen, met Ondergrens en Bovengrens als aparte kolommen (D82). Ook via een Excel-sjabloon: downloaden, aanpassen, inlezen met een controle vooraf (D46); het tweede blad bevat de grenzen per product |
| Medewerkers, pc's | Medewerkers in drie blokken (operators en ploegleiders, Kwaliteit, overige accounts) met naam, ploeg en account (D77); aanmaken, wijzigen, uitzetten, een wachtwoord van de beheerder is tijdelijk (D61); per pc de stappen |
| Grondstoffen, diensten en ploegen, oorzaken van stilstand | De keuzelijsten en tijden voor de invoer; het rooster van ploegen A–E per divisie, met per dag en dienst wie werkt (D76) |
| Bedrijfsgegevens | Naam, adres en verklaring op het certificaat |
| Opmerkingen | Wat gebruikers via "Iets melden" doorgaven; afhandelen met een notitie (D62) |
| Pilotoverzicht | Hoe de invoer in de pilot loopt: per dag, per pc, per veld, geweigerde invoer; startdatum en grens voor "te laat" (D66). De productiemanager ziet het bij Manufacturing Operations |
| Logboek | Elke wijziging: wie, wanneer, oud en nieuw (wachtwoorden nooit) |
| Server | Versie, schemaversie, laatste back-up en hersteltest, waarschuwingen |

Er blijft altijd minstens één actieve beheerder. Niets wordt verwijderd, alleen uitgezet.

### Overal
- **Hulp** per rol staat in het invoerscherm (in de balk, ook zonder verbinding) en in de portalen (menu en startpagina), en is per rol af te drukken als één A4 (D59). De tekst staat in `gedeeld/hulp.ts`.
- **Meldingen** maakt de database zelf: waarde buiten grens, beoordeling, keurresultaat, afwijkend lot, storing (D33).
- **Naar Excel** staat boven elke tabel in de portalen (D39), bij langere tabellen met **Filteren** ernaast; op elke kolomkop kun je klikken om te sorteren (D83).
- **Wandscherm:** per stap bezig, klaar en gepland, met de kerncijfers van vandaag; per hal via `#/wandscherm/Hal 1`; voor één of enkele stappen via `#/wandscherm/stappen/PS3,PS4` of de knop "Stappen kiezen" onderin (grotere kaarten, cijfers over die stappen). **Wandscherm Kwaliteit** voor het lab via `#/wandscherm/kwaliteit` of de link "Kwaliteit" onderin: wat op Kwaliteit wacht (keuringen en batches in beoordeling, oudste eerst, gele rand als het langer duurt dan normaal), de afwijkingen van vandaag en de kerncijfers van vandaag (D72). Een tv met een schermaccount onthoudt zijn keuze; `#/wandscherm/alle` zet hem terug. Log in met een account met rol scherm (blijft 30 dagen ingelogd) en zet de browser op volledig scherm (D30). Het wandscherm past zich aan het formaat aan zonder scrollen; een schermaccount meldt af met de kleine knop rechtsonder (D81).

## Draaien

| Waar | Hoe | Meer |
| --- | --- | --- |
| Laptop (proof of concept) | `tools/maak_laptoppakket.sh <map> windows` bouwt `batch-gui-laptop-<versie>-windows.zip` met Node.js, PostgreSQL en de Visual C++-runtime erin; uitpakken en `START.bat` (D27) | [`tools/pakket/README.md`](tools/pakket/README.md) |
| Fabrieksserver | `tools/maak_serverpakket.sh` bouwt `batch-gui-server-<versie>.zip` | [`docs/SERVER.md`](docs/SERVER.md) |
| Historische browserdemo | Bron in `demo/`; niet ondersteund en geen bouw- of acceptatieverplichting (D99) | — |
| Ontwikkelen | zie hieronder | — |

Beheertools op de server (lezen `instellingen.json`, `BATCHGUI_INSTELLINGEN` of `--instellingen <pad>`):

| Opdracht | Wat |
| --- | --- |
| `node tools/start-server.mjs` | applicatie starten (controleert eerst de schemaversie) |
| `node tools/migreer.mjs [--status]` | database aanmaken of bijwerken met `db/migraties/` en `db/rechten.sql` |
| `node tools/backup.mjs` | back-up maken en oude opruimen (48 uur, 30 dagen, 12 maanden); ruimt ook inlogpogingen en geweigerde invoer ouder dan 90 dagen op |
| `node tools/herstel.mjs --controle` / `<bestand>` | hersteltest of echt herstel |
| `node tools/beheerder.mjs` | eerste beheerder, of noodsleutel bij een vergeten wachtwoord (D28) |

## Ontwikkelen

### Mappen
| Map of bestand | Wat |
| --- | --- |
| `db/schema.sql` | Tabellen, regels (triggers) en acties in schema `fabriek`; gelijk aan alle migraties samen |
| `db/migraties/` | Genummerde database-updates (D23); nooit achteraf aanpassen |
| `db/rechten.sql` | Rechten van de applicatiegebruiker `mes_app` (D24/D91; bestaande login tijdelijk compatibel) |
| `db/seed_config.sql` | Stappen, voorbeeldvelden, operators, pc's, producten, grondstoffen, diensten, ploegen met rooster, oorzaken (geen accounts) |
| `db/seed_accounts_demo.sql` | Fictieve testaccounts |
| `db/seed_demo.sql` | Kleine fictieve productie voor de invoertest |
| `tools/genereer_testdata.py` | Maanden fictieve productie met ingebouwde afwijkingen |
| `api/` | API (Fastify, TypeScript); `api/openapi.json` is de volledige beschrijving |
| `invoer/` | Invoerscherm (PWA) |
| `portaal/` | Portalen en wandscherm |
| `gedeeld/` | Onderdelen die invoerscherm en portalen delen, waaronder `tokens.css` (alle kleuren, afstanden, tekstgroottes en rondingen) en `knoppen.css` (bezig-stand en klikzone) |
| `demo/` | Historische browserdemo; buiten verplichte scope |
| `tools/` | Pakketten bouwen, beheertools, versie zetten |
| `tests/`, `api/test/`, `invoer/e2e/`, `portaal/e2e/` | Tests |

### Database en regels
Alle regels zitten in de database (D9); de API vertaalt ze naar leesbare meldingen (422).

| Actie | Doet |
| --- | --- |
| `start_stap(stapcode, batch, lot, pc, operator)` | Opent een stap; controleert volgorde, niveau en status |
| `rond_stap_af(registratie)` | Rondt af als alle verplichte velden zijn ingevuld |
| `maak_lot(lotnummer, 4 batches, pc, operator)` | PS16: alleen met 4 batches die PS1–PS15 afrondden |
| `start_herbewerking(lot, stapcode, reden, pc, operator)` | Lot terug naar een lotstap; alle volgende stappen opnieuw |
| `plan_batches(aantal, dag, product, opmerking, door)` | Plant batches en geeft de volgende vrije nummers |

- Waarden gaan via `INSERT INTO waarde`; markering (ok, buiten tolerantie, buiten grens) en een kopie van de grenzen vult de database zelf in. Correcties zijn een nieuwe waarde met `vervangt_waarde_id`.
- Besluiten gaan via `batch_besluit`: in beoordeling zetten (ploegleider of Kwaliteit), OK of NOK (alleen Kwaliteit). Bij NOK wordt een open stap afgebroken.
- Tolerantie is absoluut of een percentage van de setting. Nummers: `B-JJJJ-nnnn` en `L-JJJJ-nnnn`.
- Apparaten sturen een eigen `id` (UUID) mee; opnieuw versturen maakt geen dubbele records.
- Alle dagen, weken en diensten worden gerekend in de tijdzone van de fabriek (`fabriekstijdzone()`, D44); tijden zijn opgeslagen met tijdzone.
- De wachtrij stuurt het moment van invoer en de operator mee; de API zet dat moment in `fabriek.moment` en de database begrenst het (`apparaat_moment()`, D43). Starten, afronden, meetwaarden en grondstoffen gebruiken dat moment; de aankomst op de server staat in `gestart_ontvangen_op`, `afgerond_ontvangen_op` en `ontvangen_op`.

### API starten
```
cd api && npm install && npm run build
set DATABASE_URL=postgres://postgres@localhost:5432/batchgui
set JWT_GEHEIM=<willekeurige tekst van minstens 32 tekens>
npm start
```
Inloggen: `POST /auth/login` met gebruikersnaam, wachtwoord en (op het invoerscherm) de pc-naam. Een eigen account van een operator of ploegleider krijgt meteen zijn naam in het token; alleen het oude gedeelde account kiest daarna een naam (`POST /auth/operator`, D53). Van de startpagina naar het invoerscherm: `POST /auth/pc` geeft hetzelfde account met de pc erbij (D54). Invoeren kan alleen met een pc in het token. Het token gaat mee als `Authorization: Bearer <token>`.

### Testdata
```
psql -f db/schema.sql && psql -f db/seed_config.sql && psql -f db/seed_accounts_demo.sql
python3 tools/genereer_testdata.py "host=localhost user=postgres dbname=batchgui" --dagen 90
```
Ongeveer 540 batches en 130 lots, via dezelfde databaseregels als echte invoer, met ingebouwde afwijkingen (S5.1 loopt op, een operator weegt te zwaar, een natte week met herbewerkingen), planning, stilstand en overdrachten.

De testdata in het laptoppakket (`tools/pakket/testdata.sql`) maak je daarna met
`pg_dump --data-only --schema=fabriek --inserts --rows-per-insert=500 --exclude-table=fabriek.schema_versie --exclude-table=fabriek.onderhoud_log --exclude-table=fabriek.inlogpoging`.

### Testen
Vóór elke push (zie ook `CLAUDE.md`):

| Wat | Hoe | Op GitHub |
| --- | --- | --- |
| Roadmap bij met de laatste versie | `tests/test_roadmap.sh` | ja |
| Databaseregels | `python3 tests/test_regels.py "<verbinding>"` (leegt de database) | ja |
| API | `cd api && npm test` met `TEST_DATABASE_URL` en `TEST_APP_DATABASE_URL` (voor `mes_app`) | ja |
| Schema en migraties gelijk | `tests/test_migraties.sh` | ja |
| Plaatje van de database bij (`docs/DATABASE.md`, D84) | `tests/test_schema_plaatje.sh` | ja |
| Beheertools | `tests/test_tools.sh` | ja |
| Opruimschema back-ups | `node --test tests/rotatie.test.mjs` | ja |
| Laptoppakket | `tests/test_laptoppakket.sh` (als gewone gebruiker) | ja |
| Schermtests in Chrome: invoerscherm en alle portalen (PostgreSQL) | `tests/test_schermen.sh` (met `DATABASE_URL`; zet zelf telkens de juiste testdata klaar). Eén test los: `cd portaal && node e2e/<naam>.mjs` (formaten: alle schermen in zes formaten van telefoon tot pc, D64; portaal, productie, wandscherm, grondstoffen, meldingen, certificaat, regelkaarten, excel op verse testdata; hulp vraagt alleen de testaccounts; nalevering op verse testdata; beheer, planning en sjabloon zetten zelf hun database klaar) | ja |

### Versies
Eén versienummer voor het hele platform (D17), in `VERSIE`; zetten met `tools/zet_versie.sh <versie>`. Een release wordt uitsluitend op aanvraag gemaakt (`release.yml`), na acceptatie van de exacte inhoud, met het Windows-laptoppakket als bijlage (D88). Tussentijdse wijzigingen staan onder Unreleased. Downloaden: repository → Releases → versie → Assets. Wat er per versie veranderde: [`CHANGELOG.md`](CHANGELOG.md).
