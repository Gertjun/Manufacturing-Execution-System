# Batch input GUI

Platform om per batch en per lot de productiegegevens van de fabriek vast te leggen en te analyseren. Batches doorlopen 18 processtappen; in stap 16 worden 4 batches samengevoegd tot 1 lot. Alles werkt lokaal en offline. **Alle namen, nummers en waarden in deze repository zijn fictief.**

## Waar vind je wat

Elk onderwerp staat op één plek; de andere bestanden verwijzen ernaar (D48).

| | Vraag | Bestand |
| --- | --- | --- |
| Heden | Waar staan we nu, hoe zit het in elkaar, hoe start en test je het? | dit bestand, `README.md` |
| Toekomst | Wat moet er nog gebeuren, in welke volgorde en wanneer? | [`ROADMAP.md`](ROADMAP.md) |
| Verleden | Wat is er per versie veranderd? | [`CHANGELOG.md`](CHANGELOG.md) |
| Verleden | Waarom is iets zo gekozen? | [`DECISIONS.md`](DECISIONS.md) |

Handleidingen voor een bepaalde lezer: [`docs/SERVER.md`](docs/SERVER.md) (IT installeert de fabrieksserver), [`tools/pakket/README.md`](tools/pakket/README.md) (het laptoppakket, gaat mee in de zip) en [`CLAUDE.md`](CLAUDE.md) (werkafspraken voor Claude).

## Stand

Bijgewerkt: 21 november 2026 · versie **0.37.1**. Dit blok wordt aan het eind van elke sessie overschreven.

- **Fase:** proof of concept op Geerts Windows-laptop (D26). Fase A is gebouwd, daarna de UI/UX-review (D50, D51) en de planningwaarschuwing (D52). Fase A2 loopt: eigen inlog en startpagina (0.27.0, #49, #50, D53, D54), route per product (0.28.0, #51) grenzen per product met productkiezer (0.29.0, #52) en capaciteit per stap en product (0.30.0, #53, D55) zijn gebouwd; daarmee zijn #49–#53 klaar; grenzen per product staan ook in het sjabloon (0.31.0, #73). Kleine verbeteringen: #56, #57 en #59 (0.32.0), #60 en #62 (0.33.0) en #58 (0.34.0) zijn gebouwd, en herbewerkingen met opdracht en stand voor batches en lots, met de rol productiemanager (0.35.0, #61, D57). Het wandscherm per stap (0.36.0, #54) en de metingen van Kwaliteit met keuring (0.37.0, #64, D58) zijn gebouwd; daarmee is fase A2 gebouwd, op #55 (later) na. Geert kiest nog tussen Dagoverzicht en Batchroute (#48), bevestigt de pilotdatum (#70) en de naam Productieanalyse (#72).
- **Schermen:** volgen de UI/UX-richtlijnen uit het Claude-project, met vijf bewuste afwijkingen (D50) en vaste woorden (D51). Alle kleuren, afstanden en maten staan in `gedeeld/tokens.css`.
- **Laptop:** Geert draait 0.7.1. Het pakket van elke versie staat op GitHub bij de release, onder "Assets" (`batch-gui-laptop-<versie>-windows.zip`).
- **Fabrieksserver:** nog niet ingericht; advies en draaiboek liggen klaar (#10).
- **Browserdemo:** versie 0.37.1 gepubliceerd en lokaal getest; de echte link op claude.ai is na deze publicatie nog niet in een browser geopend.
- **Releases op GitHub:** elke versie krijgt een tag en release, met het laptoppakket als bijlage (D49). Niet gebruiken: de releases van 0.14.0 en 0.15.0 (de laptoppakkettest faalde).
- **Laatste testronde (0.37.1, 21 november 2026):** geslaagd: databaseregels (211), API, migraties (tot en met 22), beheertools, opruimschema, laptoppakket, en alle schermtests in Chrome (invoer, 12 portaaltests, sjabloon, browserdemo), met nieuwe controles voor de keuring door Kwaliteit (operator rondt af zonder de meting van Kwaliteit, de stap wacht, Kwaliteit meet en geeft vrij op de lab-pc via de wachtrij, herbewerken en afkeuren in de databaseregels) en "Wie meet" in Beheer en het sjabloon. Ook getest: het invoerscherm neemt de inlog van Kwaliteit alleen over via de tegel op de startpagina. Praktijktests zijn nog niet gedaan (#33): niet op een echte tablet, niet met een pc die offline is bij het begin van een dienst, en nog niet met echte routes en grenzen (#2).
- **Gegevens:** alles fictief (D1).

**Links**
- Code: https://github.com/Gertjun/batch-input-gui (privé)
- Browserdemo (blijft actueel): https://claude.ai/artifact/AvBGewCSnACg6h6CeUKZQN
- Projectdocument in het Claude-project: `claude/architectuur-en-besluiten.md` (korte instap met links)
- Momentopnamen, worden niet bijgewerkt: Whiteboard eerste projectplan https://claude.ai/artifact/Nm9L5rFHZY6Dtgk2JMncnF · advies fabrieksserver https://claude.ai/artifact/XbFZ7nQRDn18zSS5tnQhUf · datamodel v1 https://claude.ai/artifact/54cg2QSsWQ3j6hbkzYBVTA · doorlichting 19-11-2026 https://claude.ai/artifact/6FL8onRKNHTbnqJWSF6U7i · UI/UX-review 20-11-2026 https://claude.ai/artifact/EK83QWUsor3w4ofFDzBra4

## Het platform in het kort

Eén platform met één login. Na het inloggen toont de startpagina (`/`, D54) een tegel voor elk onderdeel waar je account bij mag; een operator gaat meteen naar het invoerscherm. Elke afdeling heeft een eigen portaal; het invoerscherm voor de vloer is technisch een aparte, eenvoudige app die offline werkt. Alles gebruikt dezelfde server, accounts en database; de rol bepaalt wat iemand ziet (D10).

| Onderdeel | Adres | Voor wie |
| --- | --- | --- |
| Invoerscherm | `/invoer/` | Operators en ploegleiders op de vloer, en Kwaliteit op de lab-pc (metingen en keuring, D58); werkt offline |
| Portaal Kwaliteit | `/portaal/` | Kwaliteit |
| Startpagina | `/` (stuurt door naar `/portaal/`) | Iedereen, na het inloggen |
| Portaal Productieanalyse | `/portaal/` | Ploegleiders, productieleiding |
| Portaal Planning | `/portaal/` | Planners (ploegleiders kijken mee) |
| Portaal Beheer | `/portaal/` | Beheerder |
| Wandscherm | `/portaal/#/wandscherm` | Tv in de hal |
| API-documentatie | `/docs` | Ontwikkelaars, latere koppelingen |

**Rollen:** iedereen heeft een eigen account (D53); operator, ploegleider (ook corrigeren en in beoordeling zetten), kwaliteit (keurresultaat, certificaat, herbewerking; meet en keurt in het invoerscherm op de lab-pc, D58), productiemanager (portalen Productieanalyse, Kwaliteit en Planning; in beoordeling zetten en herbewerking, D57), planner, beheerder, analist (alleen lezen), scherm (alleen het wandscherm).

**Inloggen:** hoofdletters in de gebruikersnaam tellen niet mee. Na 5 verkeerde wachtwoorden binnen 15 minuten moet je 1 minuut wachten; elke poging wordt vastgelegd (zonder wachtwoord) en Beheer → Server waarschuwt bij veel mislukte pogingen (D45).

**Testaccounts** (alleen in de fictieve testdata, nooit in een echte installatie, wachtwoord `demo`): `operator.a` en `operator.b` (eigen account, D53), `operator` (het oude gedeelde account, kiest een naam), `ploegleider1`, `ploegleider2`, `kwaliteit1`, `productiemanager1`, `beheerder1`, `analist1`, `planner1`, `scherm1`.

### Invoerscherm
- Per stap zie je wat bezig is, wat klaarstaat en wat gepland is voor vandaag. Het formulier komt uit de velden die per stap zijn ingesteld; tijdens het typen zie je of een waarde buiten tolerantie of grens valt.
- Stap 1: een geplande batch starten (een ongeplande batch is een uitzondering). Stap 16: 4 batches samenvoegen tot een lot, volgens het lotvoorstel of met een reden.
- Grondstofpartijen invoeren, stilstand melden en beëindigen, ploegoverdracht schrijven, etiketten printen, scannen met een handscanner.
- Ploegleiders corrigeren waarden en zetten een batch in beoordeling; ze zien ook de meldingen.
- **Zonder verbinding** gaat de invoer door: alles wordt op de pc bewaard en daarna op volgorde verstuurd, met het moment van invoer en de naam van wie het invoerde (D43). De statusbalk toont hoeveel acties wachten; afmelden met wachtende acties vraagt eerst om bevestiging. Correcties, besluiten, zoeken en inloggen vragen wel verbinding.

### Portaal Kwaliteit
Bij de analyses staat bovenin het menu een productkiezer: alle producten of één product, onthouden op deze computer (D55). Hetzelfde geldt voor doorlooptijden, productie per week en correcties in Productieanalyse.

| Onderdeel | Wat je ziet |
| --- | --- |
| Overzicht | Kerncijfers, afwijkingen per week, velden met de meeste afwijkingen |
| Te beoordelen | Batches in beoordeling; Kwaliteit voert hier OK, NOK of Herbewerken in. Daaronder wat op een meting van Kwaliteit wacht (D58) |
| Lotpaspoort | Eén lot met zijn 4 batches, afwijkingen bovenaan (klik op het resultaat voor de meting, correcties en keurresultaat), grondstofpartijen, afdrukbaar; met etiket en certificaat |
| Certificaat | Analysecertificaat per lot: concept, uitgeven met volgnummer, afdrukken of pdf (D37) |
| Grondstoffen terugzoeken | Op partijnummer: in welke batches en lots zit die partij |
| Regelkaarten | Per veld een regelkaart met signalen en Cpk (D38); onder 20 metingen voorlopig en zonder Cpk |
| Afwijkingen | Alle metingen buiten tolerantie of grens, met filters |
| Trend per veld | Eén veld door de tijd, met tolerantieband en grenzen |
| Herbewerkingen en afkeur | Lopende herbewerkingen met hun stand (nog te plannen, gepland, bezig), afgeronde en ingetrokken, en afgekeurde batches; een herbewerking aanmaken kan bij de batch, in het lotpaspoort of bij Te beoordelen (D57) |

### Portaal Productieanalyse
| Onderdeel | Wat je ziet |
| --- | --- |
| Werkvoorraad | Per stap wat bezig is en klaarstaat, met de langste wachttijd |
| Doorlooptijden | Per stap wachttijd en bewerkingstijd (mediaan en 90%), per week |
| Productie per week | Batches gestart en klaar, lots gereed, afkeur; grafieken lots gereed en batches gestart per dag, week of maand |
| Correcties | Oude en nieuwe waarde, reden, wie corrigeerde |
| Ploegoverdracht | Per dag hoeveel van de planning klaar is, en de ploegen met hun cijfers en overdrachten (D32) |
| Stilstand | Wat nu stilligt, per stap en oorzaak, beschikbaarheid en kwaliteit (D34) |

### Portaal Planning
| Onderdeel | Wat je kunt doen |
| --- | --- |
| Per week | Batches per dag plannen; het systeem geeft de nummers. Verschuiven of laten vervallen met reden (D29) |
| Per stap | Per dag en stap welke batches of lots gedaan moeten worden. Bij Toevoegen staat apart wat klaar is, wat op tijd klaar komt en waarvan de vorige stap niet op tijd is; dat laatste mag, met ⚠ (D52) |
| Dagoverzicht (proef) | Alle stappen van één dag onder elkaar, met ⚠ waar de vorige stap niet op tijd is (D52, #48) |
| Batchroute (proef) | Per batch die nog niet in een lot zit: per stap klaar, bezig of de geplande dag, met ⚠ en een filter (D52, #48) |
| Lotvoorstellen | Voorstellen welke 4 batches samen een lot worden |
| Producten | Producten toevoegen, hernoemen of uitzetten, en per product de route: welke stappen het doorloopt en in welke volgorde (D55) |
| Capaciteit | Batches per weekdag en afwijkende dagen; waarschuwing bij te vol (D36). Ook per stap en product: wat een stap per dag aankan, met waarschuwing in Planning per stap, Dagoverzicht en weekplanning (D55) |
| Etiketten | Etiketten per dag printen: etiketprinter 100 × 50 mm of A4-vel 3 × 7 (D35) |

### Portaal Beheer
| Onderdeel | Wat je kunt doen |
| --- | --- |
| Stappen en velden | Namen, velden, setting, tolerantie en grenzen, op het certificaat; codes worden nooit hergebruikt. Per veld ook het aantal decimalen bij het tonen, wie meet (Productie of Kwaliteit, D58) en eigen grenzen per product (D55). Ook via een Excel-sjabloon: downloaden, aanpassen, inlezen met een controle vooraf (D46); het tweede blad bevat de grenzen per product |
| Accounts, operators, pc's | Aanmaken, wijzigen, uitzetten; per pc de stappen |
| Grondstoffen, ploegen, oorzaken van stilstand | De keuzelijsten en tijden voor de invoer |
| Bedrijfsgegevens | Naam, adres en verklaring op het certificaat |
| Logboek | Elke wijziging: wie, wanneer, oud en nieuw (wachtwoorden nooit) |
| Server | Versie, schemaversie, laatste back-up en hersteltest, waarschuwingen |

Er blijft altijd minstens één actieve beheerder. Niets wordt verwijderd, alleen uitgezet.

### Overal
- **Meldingen** maakt de database zelf: waarde buiten grens, beoordeling, keurresultaat, afwijkend lot, storing (D33).
- **Naar Excel** staat boven elke tabel in de portalen (D39).
- **Wandscherm:** per stap bezig, klaar en gepland, met de kerncijfers van vandaag; per hal via `#/wandscherm/Hal 1`; voor één of enkele stappen via `#/wandscherm/stappen/PS3,PS4` of de knop "Stappen kiezen" onderin (grotere kaarten, cijfers over die stappen). Een tv met een schermaccount onthoudt zijn keuze; `#/wandscherm/alle` zet hem terug. Log in met een account met rol scherm (blijft 30 dagen ingelogd) en zet de browser op volledig scherm (D30).

## Draaien

| Waar | Hoe | Meer |
| --- | --- | --- |
| Laptop (proof of concept) | `tools/maak_laptoppakket.sh <map> windows` bouwt `batch-gui-laptop-<versie>-windows.zip` met Node.js, PostgreSQL en de Visual C++-runtime erin; uitpakken en `START.bat` (D27) | [`tools/pakket/README.md`](tools/pakket/README.md) |
| Fabrieksserver | `tools/maak_serverpakket.sh` bouwt `batch-gui-server-<versie>.zip` | [`docs/SERVER.md`](docs/SERVER.md) |
| Browserdemo | `cd demo && npm install && ./bouw.sh` bouwt `demo/dist`: het hele platform in de browser met PGlite, alleen voor demonstratie | — |
| Ontwikkelen | zie hieronder | — |

Beheertools op de server (lezen `instellingen.json`, `BATCHGUI_INSTELLINGEN` of `--instellingen <pad>`):

| Opdracht | Wat |
| --- | --- |
| `node tools/start-server.mjs` | applicatie starten (controleert eerst de schemaversie) |
| `node tools/migreer.mjs [--status]` | database aanmaken of bijwerken met `db/migraties/` en `db/rechten.sql` |
| `node tools/backup.mjs` | back-up maken en oude opruimen (48 uur, 30 dagen, 12 maanden); ruimt ook inlogpogingen ouder dan 90 dagen op |
| `node tools/herstel.mjs --controle` / `<bestand>` | hersteltest of echt herstel |
| `node tools/beheerder.mjs` | eerste beheerder, of noodsleutel bij een vergeten wachtwoord (D28) |

## Ontwikkelen

### Mappen
| Map of bestand | Wat |
| --- | --- |
| `db/schema.sql` | Tabellen, regels (triggers) en acties in schema `fabriek`; gelijk aan alle migraties samen |
| `db/migraties/` | Genummerde database-updates (D23); nooit achteraf aanpassen |
| `db/rechten.sql` | Rechten van de applicatiegebruiker `batchgui_app` (D24) |
| `db/seed_config.sql` | Stappen, voorbeeldvelden, operators, pc's, producten, grondstoffen, ploegen, oorzaken (geen accounts) |
| `db/seed_accounts_demo.sql` | Fictieve testaccounts |
| `db/seed_demo.sql` | Kleine fictieve productie voor de invoertest |
| `tools/genereer_testdata.py` | Maanden fictieve productie met ingebouwde afwijkingen |
| `api/` | API (Fastify, TypeScript); `api/openapi.json` is de volledige beschrijving |
| `invoer/` | Invoerscherm (PWA) |
| `portaal/` | Portalen en wandscherm |
| `gedeeld/` | Onderdelen die invoerscherm en portalen delen, waaronder `tokens.css` (alle kleuren, afstanden, tekstgroottes en rondingen) en `knoppen.css` (bezig-stand en klikzone) |
| `demo/` | Browserdemo |
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
- Alle dagen, weken en ploegen worden gerekend in de tijdzone van de fabriek (`fabriekstijdzone()`, D44); tijden zijn opgeslagen met tijdzone.
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
| Databaseregels | `python3 tests/test_regels.py "<verbinding>"` (leegt de database) | ja |
| API | `cd api && npm test` met `TEST_DATABASE_URL` en `TEST_APP_DATABASE_URL` (voor `batchgui_app`) | ja |
| Schema en migraties gelijk | `tests/test_migraties.sh` | ja |
| Beheertools | `tests/test_tools.sh` | ja |
| Opruimschema back-ups | `node --test tests/rotatie.test.mjs` | ja |
| Laptoppakket | `tests/test_laptoppakket.sh` (als gewone gebruiker) | ja |
| Schermtests in Chrome: invoerscherm, alle portalen, browserdemo | `tests/test_schermen.sh` (met `DATABASE_URL`; zet zelf telkens de juiste testdata klaar). Eén test los: `cd portaal && node e2e/<naam>.mjs` (portaal, productie, wandscherm, grondstoffen, meldingen, certificaat, regelkaarten, excel op verse testdata; beheer, planning en sjabloon zetten zelf hun database klaar) | ja |

### Versies
Eén versienummer voor het hele platform (D17), in `VERSIE`; zetten met `tools/zet_versie.sh <versie>`. Elke versie krijgt automatisch een tag en release op GitHub (`release.yml`), met het laptoppakket voor Windows als bijlage (`laptoppakket.yml`, D49). Downloaden: repository → Releases → versie → Assets. Wat er per versie veranderde: [`CHANGELOG.md`](CHANGELOG.md).
