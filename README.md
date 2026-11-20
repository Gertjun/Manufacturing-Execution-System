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

Bijgewerkt: 20 november 2026 · versie **0.25.0**. Dit blok wordt aan het eind van elke sessie overschreven.

- **Fase:** proof of concept op Geerts Windows-laptop (D26). Fase A van de roadmap is gebouwd (0.20.0 tot en met 0.23.0), en daarna de UI/UX-review van 20 november (0.23.2 tot en met 0.25.0, #41–#44, D50, D51). In de software staat niets meer open vóór de pilot. De volgende stappen liggen bij Geert: fase B (praktijktests, #33) en C (echte velden via het sjabloon, #2).
- **Schermen:** volgen de UI/UX-richtlijnen uit het Claude-project, met vijf bewuste afwijkingen (D50) en vaste woorden (D51). Alle kleuren, afstanden en maten staan in `gedeeld/tokens.css`.
- **Laptop:** Geert draait 0.7.1. Het pakket van elke versie staat op GitHub bij de release, onder "Assets" (`batch-gui-laptop-<versie>-windows.zip`).
- **Fabrieksserver:** nog niet ingericht; advies en draaiboek liggen klaar (#10).
- **Browserdemo:** versie 0.25.0 gepubliceerd en lokaal getest; de echte link op claude.ai is na deze publicatie nog niet in een browser geopend.
- **Releases op GitHub:** elke versie krijgt een tag en release, met het laptoppakket als bijlage (D49). Niet gebruiken: de releases van 0.14.0 en 0.15.0 (de laptoppakkettest faalde).
- **Laatste testronde (0.25.0, 20 november 2026):** geslaagd: databaseregels (94), API, migraties (tot en met 15), beheertools, opruimschema, laptoppakket, en alle schermtests in Chrome (invoer, 12 portaaltests, sjabloon, browserdemo), met nieuwe controles voor foutmeldingen bij het veld, getalkolommen, ongedaan maken en het menu op een smal scherm. Praktijktests zijn nog niet gedaan (#33), ook niet op een echte tablet.
- **Gegevens:** alles fictief (D1).

**Links**
- Code: https://github.com/Gertjun/batch-input-gui (privé)
- Browserdemo (blijft actueel): https://claude.ai/artifact/AvBGewCSnACg6h6CeUKZQN
- Projectdocument in het Claude-project: `claude/architectuur-en-besluiten.md` (korte instap met links)
- Momentopnamen, worden niet bijgewerkt: Whiteboard eerste projectplan https://claude.ai/artifact/Nm9L5rFHZY6Dtgk2JMncnF · advies fabrieksserver https://claude.ai/artifact/XbFZ7nQRDn18zSS5tnQhUf · datamodel v1 https://claude.ai/artifact/54cg2QSsWQ3j6hbkzYBVTA · doorlichting 19-11-2026 https://claude.ai/artifact/6FL8onRKNHTbnqJWSF6U7i · UI/UX-review 20-11-2026 https://claude.ai/artifact/EK83QWUsor3w4ofFDzBra4

## Het platform in het kort

Eén platform met één login. Elke afdeling krijgt een eigen portaal; het invoerscherm voor de vloer is een aparte, eenvoudige app. Alles gebruikt dezelfde server, accounts en database; de rol bepaalt wat iemand ziet (D10).

| Onderdeel | Adres | Voor wie |
| --- | --- | --- |
| Invoerscherm | `/invoer/` | Operators en ploegleiders op de vloer; werkt offline |
| Portaal Kwaliteit | `/portaal/` | Kwaliteit |
| Portaal Productie | `/portaal/` | Ploegleiders, productieleiding |
| Portaal Planning | `/portaal/` | Planners (ploegleiders kijken mee) |
| Portaal Beheer | `/portaal/` | Beheerder |
| Wandscherm | `/portaal/#/wandscherm` | Tv in de hal |
| API-documentatie | `/docs` | Ontwikkelaars, latere koppelingen |

**Rollen:** operator (gedeeld account, daarna naam kiezen), ploegleider (ook corrigeren en in beoordeling zetten), kwaliteit (keurresultaat, certificaat), planner, beheerder, analist (alleen lezen), scherm (alleen het wandscherm).

**Inloggen:** hoofdletters in de gebruikersnaam tellen niet mee. Na 5 verkeerde wachtwoorden binnen 15 minuten moet je 1 minuut wachten; elke poging wordt vastgelegd (zonder wachtwoord) en Beheer → Server waarschuwt bij veel mislukte pogingen (D45).

**Testaccounts** (alleen in de fictieve testdata, nooit in een echte installatie, wachtwoord `demo`): `operator`, `ploegleider1`, `ploegleider2`, `kwaliteit1`, `beheerder1`, `analist1`, `planner1`, `scherm1`.

### Invoerscherm
- Per stap zie je wat bezig is, wat klaarstaat en wat gepland is voor vandaag. Het formulier komt uit de velden die per stap zijn ingesteld; tijdens het typen zie je of een waarde buiten tolerantie of grens valt.
- Stap 1: een geplande batch starten (een ongeplande batch is een uitzondering). Stap 16: 4 batches samenvoegen tot een lot, volgens het lotvoorstel of met een reden.
- Grondstofpartijen invoeren, stilstand melden en beëindigen, ploegoverdracht schrijven, etiketten printen, scannen met een handscanner.
- Ploegleiders corrigeren waarden en zetten een batch in beoordeling; ze zien ook de meldingen.
- **Zonder verbinding** gaat de invoer door: alles wordt op de pc bewaard en daarna op volgorde verstuurd, met het moment van invoer en de naam van wie het invoerde (D43). De statusbalk toont hoeveel acties wachten; afmelden met wachtende acties vraagt eerst om bevestiging. Correcties, besluiten, zoeken en inloggen vragen wel verbinding.

### Portaal Kwaliteit
| Onderdeel | Wat je ziet |
| --- | --- |
| Overzicht | Kerncijfers, afwijkingen per week, velden met de meeste afwijkingen |
| Te beoordelen | Batches in beoordeling; Kwaliteit voert hier OK of NOK in |
| Lotpaspoort | Eén lot met zijn 4 batches, afwijkingen bovenaan, grondstofpartijen, afdrukbaar; met etiket en certificaat |
| Certificaat | Analysecertificaat per lot: concept, uitgeven met volgnummer, afdrukken of pdf (D37) |
| Grondstoffen terugzoeken | Op partijnummer: in welke batches en lots zit die partij |
| Regelkaarten | Per veld een regelkaart met signalen en Cpk (D38); onder 20 metingen voorlopig en zonder Cpk |
| Afwijkingen | Alle metingen buiten tolerantie of grens, met filters |
| Trend per veld | Eén veld door de tijd, met tolerantieband en grenzen |
| Herbewerkingen en afkeur | Hoe vaak, in welke stap en met welke redenen |

### Portaal Productie
| Onderdeel | Wat je ziet |
| --- | --- |
| Werkvoorraad | Per stap wat bezig is en klaarstaat, met de langste wachttijd |
| Doorlooptijden | Per stap wachttijd en bewerkingstijd (mediaan en 90%), per week |
| Productie per week | Batches gestart en klaar, lots gereed, afkeur |
| Correcties | Oude en nieuwe waarde, reden, wie corrigeerde |
| Ploegoverdracht | Per dag de ploegen met hun cijfers en overdrachten (D32) |
| Stilstand | Wat nu stilligt, per stap en oorzaak, beschikbaarheid en kwaliteit (D34) |

### Portaal Planning
| Onderdeel | Wat je kunt doen |
| --- | --- |
| Per week | Batches per dag plannen; het systeem geeft de nummers. Verschuiven of laten vervallen met reden (D29) |
| Per stap | Per dag en stap welke batches of lots gedaan moeten worden |
| Lotvoorstellen | Voorstellen welke 4 batches samen een lot worden |
| Producten | Producten toevoegen, hernoemen of uitzetten |
| Capaciteit | Batches per weekdag en afwijkende dagen; waarschuwing bij te vol (D36) |
| Etiketten | Etiketten per dag printen: etiketprinter 100 × 50 mm of A4-vel 3 × 7 (D35) |

### Portaal Beheer
| Onderdeel | Wat je kunt doen |
| --- | --- |
| Stappen en velden | Namen, velden, setting, tolerantie en grenzen, op het certificaat; codes worden nooit hergebruikt. Per veld ook het aantal decimalen bij het tonen. Ook via een Excel-sjabloon: downloaden, aanpassen, inlezen met een controle vooraf (D46) |
| Accounts, operators, pc's | Aanmaken, wijzigen, uitzetten; per pc de stappen |
| Grondstoffen, ploegen, oorzaken van stilstand | De keuzelijsten en tijden voor de invoer |
| Bedrijfsgegevens | Naam, adres en verklaring op het certificaat |
| Logboek | Elke wijziging: wie, wanneer, oud en nieuw (wachtwoorden nooit) |
| Server | Versie, schemaversie, laatste back-up en hersteltest, waarschuwingen |

Er blijft altijd minstens één actieve beheerder. Niets wordt verwijderd, alleen uitgezet.

### Overal
- **Meldingen** maakt de database zelf: waarde buiten grens, beoordeling, keurresultaat, afwijkend lot, storing (D33).
- **Naar Excel** staat boven elke tabel in de portalen (D39).
- **Wandscherm:** per stap bezig, klaar en gepland, met de kerncijfers van vandaag; per hal via `#/wandscherm/Hal 1`. Log in met een account met rol scherm (blijft 30 dagen ingelogd) en zet de browser op volledig scherm (D30).

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
Inloggen: `POST /auth/login` met gebruikersnaam, wachtwoord en pc-naam; operators kiezen daarna hun naam (`POST /auth/operator`). Het token gaat mee als `Authorization: Bearer <token>`.

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
