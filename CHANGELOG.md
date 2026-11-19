# Changelog

Eén versienummer voor het hele platform (`MAJOR.MINOR.PATCH`, zie D17 in `DECISIONS.md`). Alle gegevens zijn fictief.

## 0.10.0 — 19 november 2026
- Nieuw: wandscherm voor een tv in de hal (`/portaal/#/wandscherm`). Per stap zie je wat bezig is (▶ blauw), wat klaarstaat (● wit) en wat gepland is maar nog niet klaar (○ grijs), in de volgorde van de planner. Een gele rand met ⚠ betekent: wacht of loopt langer dan normaal (langer dan 90% van de keren in de laatste 30 dagen). Bovenaan: batches gestart tegenover gepland, lots gereed en batches in beoordeling.
- Het wandscherm ververst elke 30 seconden. Valt de verbinding weg, dan blijft de laatste stand staan met de melding "Geen verbinding sinds …".
- Per hal: `#/wandscherm/Hal 1` toont alleen de stappen van de pc's in die hal.
- Nieuw: rol "Wandscherm" voor een account dat alleen het wandscherm mag zien (testaccount `scherm1`). De tv hoeft zo niet op naam van een persoon ingelogd te zijn. Het blijft 30 dagen ingelogd; zet je het account uit in Portaal Beheer, dan stopt het scherm meteen.
- Iedereen met een persoonlijk account opent het wandscherm via de link onder in het menu.
- Technisch: database-update 4 (`0004_wandscherm`): de nieuwe rol.

## 0.9.0 — 19 november 2026
- Nieuw: Portaal Planning voor de planner (account `planner1` in de testdata).
  - Per week: batches plannen per dag, met product en opmerking. Het systeem geeft de batchnummers uit (doornummeren per jaar). Volgorde op de dag aanpassen, verschuiven naar een andere dag, of laten vervallen met een reden. Geplande batches die niet op tijd gestart zijn, staan bovenaan.
  - Per stap: per dag en per stap welke batches of lots er gedaan moeten worden, in volgorde, met een opmerking voor de operator. Je ziet meteen wat gedaan, bezig of nog te doen is.
  - Lotvoorstellen: de planner stelt voor welke 4 batches samen een lot worden.
  - Producten: lijst van producten of recepten om bij een batch te kiezen.
- Nieuw in het invoerscherm:
  - Bovenaan elke stap "Gepland voor vandaag", in volgorde. Geplande batches staan ook bovenaan bij "Klaar om te starten".
  - In de eerste stap start de operator een geplande batch met één druk op Start. Een ongeplande batch aanmaken kan nog steeds, als uitzondering; de planner ziet die als "niet gepland".
  - Bij het samenstellen van een lot staan de lotvoorstellen bovenaan; "Dit voorstel kiezen" vinkt de 4 batches aan. Kies je een andere samenstelling, dan vraagt het scherm om een reden.
- Verbeterd: de ploegleider kan de planning bekijken (niet wijzigen).
- Verbeterd: "batches gestart" in de analyses telt vanaf de eerste stap, niet vanaf het plannen.
- Let op: een ouder invoerscherm dat een lot samenstelt dat afwijkt van een lotvoorstel, krijgt de melding dat er een reden nodig is. Werk die pc bij en stel het lot opnieuw samen.
- Technisch: database-update 3 (`0003_planning`): producten, planning per batch, lotvoorstellen en dagplanning per stap. Wordt bij de start automatisch uitgevoerd; bestaande gegevens blijven staan.
- Technisch: de fictieve testdata bevat nu planning (ca. 95% gepland, 5% ongepland, lotvoorstellen met af en toe een afwijking, planning voor de komende werkdagen). De testdata eindigt nu precies op het laatste moment van invoer, zodat het verschuiven naar vandaag klopt.

## 0.8.0 — 19 november 2026
- Nieuw: eerste beheerder. Begin je zonder testaccounts (lege fabriek, of een nieuwe server), dan vraagt het zwarte venster om een gebruikersnaam en wachtwoord voor de eerste beheerder.
- Nieuw: noodsleutel voor een vergeten wachtwoord. `BEHEERDER HERSTELLEN.bat` op de laptop (op de server: `node tools/beheerder.mjs`) geeft een beheerder een nieuw wachtwoord of maakt een nieuwe aan. Dat kan alleen op de computer zelf en komt in het logboek.
- Verbeterd: `LEGE FABRIEK.bat` begint echt leeg, zonder de bekende testaccounts met wachtwoord `demo`. De fictieve testdata houdt die accounts.
- Technisch: de testaccounts staan in een eigen bestand (`db/seed_accounts_demo.sql`), los van de configuratie (`db/seed_config.sql`).

## 0.7.1 — 19 november 2026
- Opgelost: op Windows bleef de eerste start hangen op "Eerste keer: database aanmaken …". De database was wel gestart, maar het startscript bleef wachten op een uitvoerverbinding die de database openhield.

## 0.7.0 — 19 november 2026
- Nieuw: het laptoppakket is een complete proof of concept. Node.js en PostgreSQL zitten erin: uitpakken, `START.bat` dubbelklikken, klaar. Niets installeren, geen beheerdersrechten, geen wachtwoord.
- Nieuw: bij elke start eerst een back-up (laatste 5 blijven bewaard). Terugzetten met `BACKUP TERUGZETTEN.bat`.
- Nieuw: `LEGE FABRIEK.bat` om met alleen de configuratie te beginnen en je eigen stappen en velden in te richten.
- Verbeterd: bij stoppen (Ctrl+C of venster sluiten) wordt de database netjes afgesloten. Na een harde stop pakt de volgende start de draaiende database gewoon op.
- Verbeterd: Beheer → Server geeft op de laptop geen onterechte waarschuwingen meer over uurlijkse back-ups en hersteltests.
- Verbeterd: waarschuwing als het pakket in OneDrive staat.
- Technisch: het pakket heet nu `batch-gui-laptop-<versie>-windows.zip`. De vingerafdrukken van Node.js en de Visual C++-runtime worden bij het bouwen gecontroleerd. GitHub test het pakket (Linux-variant) bij elke push.

## 0.6.0 — 18 november 2026
- Nieuw: advies voor de fabrieksserver (apart document) en een draaiboek voor IT in `docs/SERVER.md`: installeren op Windows Server of Ubuntu, als service, back-ups, updates en herstel.
- Nieuw: serverpakket `batch-gui-server-<versie>.zip` met de applicatie, de beheertools en voorbeeldbestanden voor de Windows-service en de instellingen.
- Nieuw: back-ups met `tools/backup.mjs`. Bewaart 48 uur elk uur, 30 dagen één per dag en 12 maanden één per maand, en ruimt de rest op.
- Nieuw: hersteltest met `tools/herstel.mjs --controle` en echt herstel met `tools/herstel.mjs <bestand>`. De huidige database blijft daarbij bewaard en komt terug als het herstel mislukt.
- Nieuw: database-updates met versienummer (`tools/migreer.mjs`, `db/migraties/`). Een nieuwe versie van de applicatie start niet op een database die nog niet is bijgewerkt.
- Nieuw: Portaal Beheer → Server met de versie, de laatste back-up en hersteltest, en een waarschuwing als een back-up ouder is dan 2 uur of mislukt.
- Nieuw: https met een certificaat van IT.
- Verbeterd: de applicatie werkt in de database met een eigen gebruiker die gegevens kan invoeren maar niets kan verwijderen of de opbouw kan wijzigen.
- Verbeterd: `/gezondheid` meldt ook of de database bereikbaar is (503 als dat niet zo is).
- Verbeterd: het laptoppakket werkt een bestaande database bij een nieuwe versie zelf bij; je gegevens blijven staan. Aanbevolen: Node.js 26 LTS en PostgreSQL 18.
- Verbeterd: `herstel.mjs` controleert vooraf of `pg_restore` bij de versie van de server past, en legt uit wat te doen als dat niet zo is.
- Technisch: de tests op GitHub draaien op PostgreSQL 18 en Node.js 22 en 26, met de beperkte databasegebruiker, en controleren de database-updates en de beheertools.

## 0.5.1 — 18 november 2026
- Technisch: werkafspraken overgenomen uit de andere projecten: `CLAUDE.md`, `NOTES.md`, `DECISIONS.md` (D1–D20) en `WISHLIST.md`.
- Technisch: bij elke push draaien op GitHub automatisch de databaseregels, de API-tests en de controle en bouw van de schermen.
- Technisch: voor elke nieuwe versie maakt GitHub automatisch een tag en een release met de tekst uit deze changelog.
- Verbeterd: de handleiding in het laptoppakket heet nu `README.md`.

## 0.5.0 — 18 november 2026
- Nieuw: laptoppakket. Met `START.bat` maak je de database aan, laad je 90 dagen fictieve productie (tot vandaag) en start je alles op http://localhost:3000/.
- Nieuw: browserdemo. Het hele platform draait in de browser, zonder server, als privépagina. Invoerscherm en portalen ook naast elkaar.
- Nieuw: startpagina met links naar invoerscherm, portalen en API-documentatie.
- Nieuw: versienummer zichtbaar op de startpagina en in de portalen.
- Opgelost: de server vond de schermen niet op Windows.

## 0.4.0 — 18 november 2026
- Nieuw: Portaal Beheer: stappen en velden, accounts, operators, pc's met hun stappen, logboek van elke wijziging.
- Nieuw: Portaal Productie: werkvoorraad, doorlooptijden, productie per week, correcties.
- Nieuw: Portaal Kwaliteit: overzicht, te beoordelen (OK/NOK), lotpaspoort, afwijkingen, trend per veld, herbewerkingen en afkeur.
- Nieuw: een ploegleider of Kwaliteit zet een batch in beoordeling; alleen Kwaliteit keurt. Bij NOK worden open stappen afgebroken.
- Nieuw: generator voor fictieve testdata met ingebouwde patronen.

## 0.3.0 — november 2026
- Nieuw: lot samenstellen in PS16 (4 batches, geen open stappen), lotstappen PS17–18 en herbewerking van een lot.

## 0.2.0 — november 2026
- Nieuw: invoerscherm dat offline blijft werken, met pc- en naamkeuze, waarschuwing bij afwijkende waarden en correcties door de ploegleider.

## 0.1.0 — november 2026
- Nieuw: datamodel en databaseregels, API met beschrijving van alle functies.
