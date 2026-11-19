# Changelog

Eén versienummer voor het hele platform (`MAJOR.MINOR.PATCH`, zie D17 in `DECISIONS.md`). Alle gegevens zijn fictief.

## 0.17.0 — 19 november 2026
- Nieuw: certificaat per lot (analysecertificaat voor de klant). In het lotpaspoort staat "Certificaat". Daar zie je per kenmerk de specificatie, het resultaat (bij batchkenmerken van laag tot hoog, met het gemiddelde over de 4 batches) en of het lot voldoet. Ook staan erop: de batches, het product en de grondstofpartijen, en de verklaring van het bedrijf.
- Kwaliteit geeft het certificaat uit met "Uitgeven". Dat kan alleen als het lot gereed is, alle kenmerken gemeten zijn en binnen de specificatie vallen, en geen batch is afgekeurd. Het certificaat krijgt een volgnummer en wordt bewaard zoals het is uitgegeven, zodat een herdruk precies gelijk is. Tot het uitgeven staat er "CONCEPT" op.
- Afdrukken of als pdf bewaren gaat via de browser; er komt alleen het certificaat op papier.
- Nieuw in Portaal Beheer: bij elk veld kies je of het op het certificaat komt. Onder "Bedrijfsgegevens" stel je de bedrijfsnaam, het adres en de verklaring in. De fictieve configuratie zet druk (S3.3), toerental (S7.3), gewicht (S17.2, S18.2) en vochtgehalte (S18.3) op het certificaat.
- Technisch: database-update 10 (`0010_certificaat`).

## 0.16.0 — 19 november 2026
- Nieuw: capaciteit in de planning. In Portaal Planning → Capaciteit leg je per weekdag vast hoeveel batches de fabriek aankan. Daarnaast kun je afwijkende dagen vastleggen met een reden, zoals een feestdag of onderhoud.
- In de weekplanning staat per dag hoe vol hij is ("4 / 6" met een balk). Een dag met meer batches dan de capaciteit wordt geel met ⚠. Bovenaan zie je hoeveel ruimte er deze week nog is.
- Plannen boven de capaciteit kan nog steeds. Het scherm vraagt dan eerst of je het zeker weet, en meldt het daarna nog eens.
- Fictieve capaciteit: 6 batches per dag. In de testdata heeft een dag over drie dagen een lagere capaciteit (onderhoud) en is die dag te vol gepland.
- Technisch: database-update 9 (`0009_capaciteit`).

## 0.15.1 — 19 november 2026
- Opgelost: het laptoppakket startte sinds 0.14.0 niet bij de eerste start met testdata. Bij het verschuiven van de testdata naar vandaag lag het einde van een stilstand even vóór het begin. Nu schuiven alle tijden van een tabel tegelijk. De browserdemo had hetzelfde probleem.

## 0.15.0 — 19 november 2026
- Nieuw: etiketten met barcode (Code 128). In Portaal Planning staat bij elke dag "Etiketten" voor de geplande batches. In het lotpaspoort staat "Etiket" voor het lot. In het invoerscherm staat in elke registratie "Etiket printen".
- Twee formaten: een etiketprinter (100 × 50 mm, één etiket per pagina) of een A4-vel met 3 × 7 etiketten (63,5 × 38,1 mm). Afdrukken gaat via de browser, zonder extra software. Het invoerscherm onthoudt per pc welk formaat je gebruikt.
- Nieuw: scannen met een gewone handscanner (die werkt als toetsenbord). In een stap opent een scan de batch als die al bezig is, of start hem als hij klaarstaat. In de lot-stap vinkt een scan de batch aan. Op andere schermen zoekt een scan de batch of het lot op. Ook een partijnummer van een grondstof kun je in het invoerveld scannen.
- Verbeterd: een fout in de schermtest van het invoerscherm (0.14.0) is hersteld.

## 0.14.0 — 19 november 2026
- Nieuw: stilstand melden. In het invoerscherm staat bij elke stap "Stilstand melden": kies de oorzaak (storing, wachten, gepland of overig) en eventueel een toelichting. Een rode balk laat zien dat de stap stilligt, tot iemand op "Stilstand beëindigen" drukt. Dat werkt ook zonder verbinding.
- Bij een storing krijgt de ploegleider een melding. Op het wandscherm wordt de stap rood met ⛔.
- Nieuw: Portaal Productie → Stilstand. Je ziet wat nu stilligt, de stilstand per stap en per oorzaak, en de beschikbaarheid per stap. Daarnaast de kwaliteit: het deel van de gestarte batches dat niet is afgekeurd. Samen is dat het begin van OEE. Voor de prestatie (snelheid) zijn nog normtijden per stap nodig.
- Nieuw: Portaal Beheer → Oorzaken van stilstand. Een geplande oorzaak (omstellen, schoonmaken, onderhoud) telt niet mee als verlies.
- De testdata bevat fictieve stilstand: dagelijks schoonmaken, wekelijks onderhoud, en storingen (PS7 vaker). In PS7 loopt nu een storing.
- Technisch: database-update 8 (`0008_stilstand`).

## 0.13.0 — 19 november 2026
- Nieuw: meldingen. De database maakt zelf een melding als iemand iets moet weten:
  - een waarde buiten de grens (ook na een correctie): naar ploegleider en Kwaliteit;
  - een batch in beoordeling: naar ploegleider en Kwaliteit;
  - een keurresultaat: OK naar de ploegleider, NOK naar ploegleider en planner;
  - een lot dat afwijkt van het lotvoorstel: naar de planner.
- In de portalen staat "Meldingen" bovenaan het menu, met het aantal ongelezen. Een nieuwe melding verschijnt ook even onderin beeld. Met "Bekijken" open je de batch of het lot.
- In het invoerscherm ziet de ploegleider de meldingen onder "Meldingen" in de bovenbalk (alleen met verbinding).
- Gelezen is per persoon. Meldingen ouder dan 30 dagen verdwijnen uit de lijst (ze blijven wel bewaard).
- Meldingen gaan niet per mail of Teams: het platform werkt zonder internet (D33).
- Technisch: database-update 7 (`0007_meldingen`).

## 0.12.0 — 19 november 2026
- Nieuw: ploegoverdracht. In het invoerscherm staat onder "Overdracht" wat deze ploeg tot nu toe heeft gedaan: afgeronde stappen per stap, gestarte batches, lots, afwijkingen en wat nog open staat. Daar schrijf je de bijzonderheden van de ploeg en de aandachtspunten voor de volgende ploeg. Dat werkt ook zonder verbinding.
- Nieuw: bovenaan het stappenoverzicht staat de overdracht van de vorige ploeg, met de aandachtspunten vet. Met "Gelezen" klap je hem op deze pc in.
- Nieuw: Portaal Productie → Ploegoverdracht. Per dag de drie ploegen met hun cijfers, overdrachten en wat open bleef aan het eind.
- Nieuw: Portaal Beheer → Ploegen. Begin- en eindtijd en naam per ploeg. Een nachtploeg hoort bij de dag waarop hij begint.
- Een overdracht is na opslaan niet meer te wijzigen; schrijf een aanvulling.
- Fictieve ploegen: ochtend 06–14, middag 14–22, nacht 22–06. In de testdata schrijft ongeveer driekwart van de ploegen een overdracht.
- Technisch: database-update 6 (`0006_ploegoverdracht`).

## 0.11.0 — 19 november 2026
- Nieuw: grondstoffen per batch. In een stap voert de operator per grondstof het partijnummer van de leverancier in, en eventueel de hoeveelheid. Een verplichte grondstof moet zijn ingevuld voordat de stap kan worden afgerond. Een ploegleider kan een partijnummer achteraf corrigeren; het origineel blijft bewaard.
- Nieuw: Portaal Kwaliteit → Grondstoffen terugzoeken. Zoek op (een deel van) een partijnummer en zie in welke batches en lots die partij zit. Zonder zoekterm: de laatst gebruikte partijen.
- Nieuw: het lotpaspoort toont welke grondstofpartijen in het lot en zijn batches zitten.
- Nieuw: Portaal Beheer → Grondstoffen. Grondstoffen toevoegen, wijzigen of uitzetten, en per stap kiezen of de grondstof verplicht is of mag.
- De fictieve configuratie heeft drie grondstoffen: GS-A in PS1 en GS-B in PS3 (verplicht), HS-C in PS9 (mag). De testdata wisselt ongeveer elke 4 dagen van partij.
- Let op: een ouder invoerscherm (van vóór 0.11.0) kan geen grondstoffen invoeren. Werk alle pc's bij voordat je een grondstof verplicht maakt in een stap die al in gebruik is.
- Technisch: database-update 5 (`0005_grondstoffen`).

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
