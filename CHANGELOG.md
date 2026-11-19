# Changelog

Eén versienummer voor het hele platform (`MAJOR.MINOR.PATCH`, zie D17 in `DECISIONS.md`). Alle gegevens zijn fictief.

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
