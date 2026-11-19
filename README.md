# Batch input GUI — database, API, invoerscherm en portalen Kwaliteit, Productie en Beheer v1

Datamodel v1 als PostgreSQL-database, een API in Node.js/TypeScript, het invoerscherm voor de pc's (browser, werkt ook offline) en de portalen-app met de portalen Kwaliteit en Productie. Alles met fictieve data.
Alle namen, nummers en waarden zijn fictief.

## Opbouw: één platform

Besluit (18-11-2026): één platform met één login. Elke afdeling krijgt een eigen portaal; het invoerscherm voor de vloer blijft een aparte, eenvoudige app op hetzelfde platform. Alles gebruikt dezelfde server, accounts en data; de rol bepaalt wat iemand ziet.

| Onderdeel | Voor wie | Status |
| --- | --- | --- |
| Invoerscherm (`/invoer/`) | Operators, ploegleiders op de vloer | v1 gereed, werkt offline |
| Portaal Productie (`/portaal/`) | Ploegleiders, productieleiding | v1 gereed |
| Portaal Kwaliteit (`/portaal/`) | Kwaliteit (QC) | v1 gereed |
| Portaal Planning | Planners | Later |
| Portaal Beheer | Beheerder | Fase 4 (API bestaat al) |

De analyses komen niet in een losse app maar in de portalen, met één gedeelde verzameling analyses waaruit je kiest. Nieuwe afdelingen krijgen een eigen portaal en zo nodig een eigen rol.

## Inhoud

| Bestand | Wat |
| --- | --- |
| `db/schema.sql` | Tabellen, regels (triggers) en acties in schema `fabriek` |
| `db/seed_config.sql` | PS1–PS18, voorbeeldvelden S1.1 … S18.3, 8 operators, 20 pc's, accounts |
| `db/seed_demo.sql` | Kleine fictieve productie: 4 batches klaar voor een lot, 1 batch in PS7, 1 nieuwe batch |
| `tools/genereer_testdata.py` | Maanden fictieve productie met ingebouwde afwijkingen, voor de analyses |
| `gedeeld/` | Onderdelen die invoerscherm en portalen-app delen |
| `portaal/` | Portalen-app; `portaal/dist` is de gebouwde versie |
| `portaal/e2e/portaal.mjs` | Test in Chrome van het Portaal Kwaliteit |
| `portaal/e2e/productie.mjs` | Test in Chrome van het Portaal Productie |
| `tests/test_regels.py` | 44 controles op de regels; leegt en vult de database opnieuw |
| `api/` | API (Fastify, TypeScript) met inloggen, invoer, lots, beheer en analyse |
| `api/openapi.json` | Volledige API-beschrijving (OpenAPI 3), ook bruikbaar voor een latere .NET-client |
| `api/test/api.test.ts` | 21 integratietests van de API |
| `invoer/` | Invoerscherm (PWA) voor operators en ploegleiders; `invoer/dist` is de gebouwde versie |
| `invoer/e2e/flow.mjs` | Test in Chrome: hele route van batch tot lot, offline invoer, correctie en besluit |

## Acties (functies)

| Functie | Doet |
| --- | --- |
| `start_stap(stapcode, batch, lot, pc, operator)` | Opent een stap; controleert volgorde, niveau en status |
| `rond_stap_af(registratie)` | Rondt af als alle verplichte velden zijn ingevuld |
| `maak_lot(lotnummer, 4 batches, pc, operator)` | PS16: alleen met 4 batches die PS1–PS15 afrondden en in productie zijn |
| `start_herbewerking(lot, stapcode, reden, pc, operator)` | Lot terug naar een lot-stap; daarna volgen alle volgende stappen opnieuw |

Waarden gaan via `INSERT INTO waarde`; de markering (ok / buiten tolerantie / buiten grens)
en een kopie van de grenzen worden automatisch ingevuld. Correcties zijn een nieuwe waarde
met `vervangt_waarde_id`, alleen door een ploegleider of beheerder. Besluiten over een batch gaan via
`batch_besluit`: een ploegleider of Kwaliteit zet een batch in beoordeling; alleen Kwaliteit voert het
keurresultaat in (OK = `vrijgegeven`, door naar de volgende stap; NOK = `afgekeurd`). Bij NOK wordt een
openstaande stap van die batch automatisch `afgebroken`, met de reden erbij.

View `lotpaspoort` toont per lot alle actuele waarden van het lot en zijn 4 batches.

## Testen

```
createdb batchgui
pip install "psycopg[binary]"
python3 tests/test_regels.py "host=localhost user=postgres dbname=batchgui"
```

## Aannames

- Tolerantie per veld is absoluut (in de eenheid van het veld) of een percentage van de setting (`tolerantie_soort`).
- Nummerformaat: `B-JJJJ-nnnn` voor batches, `L-JJJJ-nnnn` voor lots.
- Herbewerking kan alleen naar een lot-stap (PS16–PS18).

## API starten

```
cd api
npm install
npm run build
set DATABASE_URL=postgres://postgres@localhost:5432/batchgui
set JWT_GEHEIM=<willekeurige tekst van minstens 32 tekens>
npm start
```

Daarna staat de interactieve documentatie op `http://<server>:3000/docs`.
Testaccounts (wachtwoord `demo`): `operator`, `ploegleider1`, `ploegleider2`, `kwaliteit1`, `beheerder1`, `analist1`.

### Inloggen

1. `POST /auth/login` met gebruikersnaam, wachtwoord en de naam van de pc (bv. `PC-07`). Operators moeten een pc meesturen.
2. Operators (en ploegleiders die invoeren) kiezen daarna hun naam: `GET /auth/operators`, dan `POST /auth/operator`.
3. Het token gaat mee als `Authorization: Bearer <token>`; dat werkt in de browser en in een latere desktop-app.

### Uitgangspunten

- Alle regels zitten in de database; de API vertaalt ze naar leesbare meldingen (422) die de schermen direct kunnen tonen.
- Apparaten mogen zelf een `id` (UUID) meesturen bij registraties en waarden; opnieuw versturen maakt dan geen dubbele records.
- Onbekende eigenschappen in een verzoek geven een foutmelding in plaats van stil te verdwijnen.

### API-tests

```
cd api
set TEST_DATABASE_URL=postgres://postgres@localhost/batchgui_test
npm test
```
De testdatabase wordt leeggemaakt en opnieuw gevuld.

## Invoerscherm

De API biedt het invoerscherm aan op `http://<server>:3000/invoer/`. Op elke pc:

1. Open dat adres in Chrome of Edge en kies de naam van de pc (eenmalig).
2. Log in met het gedeelde operator-account en kies je naam.
3. Optioneel: via het menu van de browser "App installeren" voor een eigen icoon en venster.

Wat het scherm doet:

- Stappen kiezen; per stap zie je wat bezig is en wat klaarstaat.
- Het formulier wordt opgebouwd uit de velden die per stap zijn ingesteld. Tijdens het typen zie je al of een waarde buiten tolerantie of buiten grens valt; vóór het opslaan volgt een controle.
- Stap 1: nieuwe batch aanmaken. Stap 16: 4 batches kiezen en samenvoegen tot een lot.
- Zoeken op batch- of lotnummer met de hele geschiedenis; herbewerking starten voor een lot.
- Ploegleiders kunnen waarden corrigeren en een batch in beoordeling zetten.
- Kwaliteit kan een batch in beoordeling zetten en voert het keurresultaat in: OK geeft de batch vrij, NOK keurt hem af.

**Zonder verbinding** gaat de invoer gewoon door. Alles wordt eerst op de pc bewaard en daarna op volgorde verstuurd. De statusbalk wordt geel-zwart en toont hoeveel acties wachten. Weigert de server iets (bijvoorbeeld een batchnummer dat al bestaat), dan wordt de balk rood en staat de melding onder "Verzenden". Correcties, besluiten, zoeken en inloggen vragen wel verbinding.

### Bouwen en testen

```
cd invoer
npm install
npm run build                 # maakt invoer/dist
npm run dev                   # ontwikkelen, met de API op poort 3000
node e2e/flow.mjs             # test in Chrome (database met seed_config + seed_demo)
```

## Portaal Kwaliteit

Op `http://<server>:3000/portaal/`, inloggen met een persoonlijk account (testaccount `kwaliteit1`, wachtwoord `demo`).
Het menu toont de portalen die bij je rol horen; Planning en Beheer staan erin als "volgt".

| Onderdeel | Wat je ziet |
| --- | --- |
| Overzicht | Kerncijfers, afwijkingen per week, velden met de meeste afwijkingen |
| Te beoordelen | Batches in beoordeling; Kwaliteit voert hier OK of NOK in |
| Lotpaspoort | Eén lot met zijn 4 batches, afwijkingen bovenaan, afdrukbaar voor een klant |
| Afwijkingen | Alle metingen buiten tolerantie of grens, met filters |
| Trend per veld | Grafiek van één veld door de tijd, met tolerantieband en grenzen |
| Herbewerkingen en afkeur | Hoe vaak, in welke stap en met welke redenen |

Een lot staat automatisch op "gereed" zodra PS18 is afgerond en gaat terug naar "in productie" bij een herbewerking.

## Portaal Productie

Ook op `/portaal/` (testaccount `ploegleider1`, wachtwoord `demo`; een ploegleider start hier).

| Onderdeel | Wat je ziet |
| --- | --- |
| Werkvoorraad | Per stap wat bezig is en wat klaarstaat, met de langste wachttijd; de stap met het meeste werk is gemarkeerd. Klik door naar een stap of batch |
| Doorlooptijden | Per stap wachttijd en bewerkingstijd (mediaan en 90%), en de doorlooptijd van batches en lots per week |
| Productie per week | Batches gestart en klaar, lots gereed en afkeur per week |
| Correcties | Alle correcties: oude en nieuwe waarde, reden, wie corrigeerde en wie oorspronkelijk invoerde |

Een batch in beoordeling zetten kan vanaf de batchpagina.

### Testdata voor de analyses

```
psql -f db/schema.sql && psql -f db/seed_config.sql
python3 tools/genereer_testdata.py "host=localhost user=postgres dbname=batchgui" --dagen 90
```
Maakt ongeveer 540 batches en 130 lots, via dezelfde databaseregels als echte invoer. Ingebouwd:
S5.1 loopt de laatste 30 dagen langzaam op, operator F weegt in PS9 twee weken te zwaar, een natte week
geeft herbewerkingen in PS17, en enkele batches worden afgekeurd. Twee batches wachten op een keurresultaat,
een paar stappen staan nog open en ploegleiders hebben zes waarden gecorrigeerd.

### Bouwen en testen

```
cd portaal
npm install
npm run build
node e2e/portaal.mjs          # test Kwaliteit in Chrome (database met verse testdata)
node e2e/productie.mjs        # test Productie in Chrome (database met verse testdata)
node e2e/beheer.mjs           # test Beheer in Chrome (database met verse configuratie)
```

## Proof of concept op een laptop

`tools/maak_laptoppakket.sh <doelmap> windows` bouwt `batch-gui-laptop-<versie>-windows.zip`: de applicatie plus Node.js 26 LTS, PostgreSQL 18 en de Visual C++-runtime, zodat er op de laptop niets geïnstalleerd hoeft te worden (D27). `START.bat` maakt bij de eerste start de database aan en laadt 90 dagen fictieve testdata (verschoven naar vandaag); bij elke volgende start eerst een back-up. Handleiding: `tools/pakket/README.md`. Met platform `linux` ontstaat dezelfde opzet voor Linux (voor `tests/test_laptoppakket.sh`), met `geen` de oude opzet met een geïnstalleerde PostgreSQL.

De testdata in het pakket (`tools/pakket/testdata.sql`) maak je opnieuw met de generator en
`pg_dump --data-only --schema=fabriek --inserts --rows-per-insert=500 --exclude-table=fabriek.schema_versie --exclude-table=fabriek.onderhoud_log`.

## Fabrieksserver

Het draaiboek voor IT staat in `docs/SERVER.md`; het advies in het document "Advies fabrieksserver". `tools/maak_serverpakket.sh` bouwt `batch-gui-server-<versie>.zip`.

| Opdracht | Wat |
| --- | --- |
| `node tools/start-server.mjs` | applicatie starten met `instellingen.json` (controleert eerst de schemaversie) |
| `node tools/migreer.mjs [--status]` | database aanmaken of bijwerken met `db/migraties/`, rechten uit `db/rechten.sql` |
| `node tools/backup.mjs` | back-up maken en oude opruimen (48 uur, 30 dagen, 12 maanden) |
| `node tools/herstel.mjs --controle` / `<bestand>` | hersteltest of echt herstel |

Alle tools lezen `instellingen.json`, `BATCHGUI_INSTELLINGEN` of `--instellingen <pad>`. Een databasewijziging = een nieuwe migratie plus dezelfde wijziging in `db/schema.sql` (zie D23); `tests/test_migraties.sh` controleert dat.

## Browserdemo

`demo/` draait het hele platform in de browser, zonder server: dezelfde API-routes (`api/src/routes`) en hetzelfde databaseschema, met PostgreSQL in de browser (PGlite) en de fictieve testdata. Invoerscherm en portalen draaien ongewijzigd in een frame; hun API-verzoeken gaan naar de nagebootste server. Alleen voor demonstratie.

```
cd demo && npm install && ./bouw.sh     # bouwt demo/dist
node ../portaal/e2e/demo.mjs            # test (demo/dist via een statische server op poort 4173)
```

## Versies

Eén versienummer voor het hele platform, in `VERSIE`; zetten met `tools/zet_versie.sh 0.6.0`. Zie `CHANGELOG.md`. Elke versie krijgt een Git-tag (`v0.5.0`).

## Portaal Beheer

Ook op `/portaal/` (testaccount `beheerder1`, wachtwoord `demo`; een beheerder start hier).

| Onderdeel | Wat je kunt doen |
| --- | --- |
| Stappen en velden | Stapnamen aanpassen, velden toevoegen, setting, tolerantie en grenzen wijzigen, velden uitzetten. Codes worden nooit hergebruikt |
| Accounts | Accounts aanmaken, rol wijzigen, wachtwoord opnieuw instellen, account uitzetten |
| Operators | Operatornamen toevoegen, hernoemen of uitzetten (ze verschijnen direct in het invoerscherm) |
| Pc's | Pc's toevoegen en per pc kiezen welke stappen hij bedient |
| Logboek | Elke wijziging: wie, wanneer, oude en nieuwe waarde |

Regels in de database:
- Elke wijziging aan stappen, velden, accounts, operators en pc's komt in het logboek. Wachtwoorden staan er nooit in, alleen dat ze opnieuw zijn ingesteld.
- Er blijft altijd minstens één actieve beheerder; je kunt jezelf niet uitzetten of je eigen rol verlagen.
- Een gebruikersnaam ligt vast na aanmaken. Niets wordt verwijderd, alleen uitgezet (behalve een stapkoppeling van een pc).
