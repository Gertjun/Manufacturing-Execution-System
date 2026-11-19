# DECISIONS – Batch input GUI

Besluiten die een volgende sessie moet kennen. Oude besluiten pas je niet aan; een nieuw besluit vervangt een oud ("vervangt D3"). D1–D16 zijn achteraf vastgelegd uit de gesprekken van november 2026.

### D1 – Alleen fictieve gegevens (nov 2026)
- **Besluit:** we bouwen en testen met fictieve gegevens. Echte fabrieksgegevens komen pas in de pilot (versie 1.0.0).
- **Waarom:** veiligheid en vertrouwelijkheid.

### D2 – 18 processtappen, lot van 4 in PS16 (nov 2026)
- **Besluit:** 18 stappen ("Process Step 1…18"). Stap 1–15 per batch, PS16 voegt 4 batches samen tot 1 lot, PS17–18 per lot. De traceerbaarheid naar de batches blijft altijd bestaan.
- **Waarom:** als een klant vraagt wat er met een lot is, moet snel te zien zijn of er afwijkingen waren bij een van de batches.

### D3 – Veldcodes S{stap}.{veld} (nov 2026)
- **Besluit:** velden per stap zijn configuratie met codes als S3.2. Elk veld heeft daarnaast een interne ID; codes worden nooit hergebruikt.

### D4 – Herbewerking (nov 2026)
- **Besluit:** een lot kan terug naar een eerdere lotstap (bijv. opnieuw drogen) en doorloopt daarna alle volgende stappen opnieuw.

### D5 – Lot alleen zonder open stappen; afkeur na overleg (nov 2026)
- **Besluit:** PS16 kan geen lot maken als een batch nog open stappen heeft. Een afgekeurde batch wordt na overleg fysiek afgevoerd; de gegevens blijven bewaard.

### D6 – Eén operatoraccount, correcties door ploegleider (nov 2026)
- **Besluit:** operators loggen in met één gedeeld account en kiezen daarna hun naam. Waarden corrigeren mag alleen een ploegleider of hoger; het origineel blijft zichtbaar.

### D7 – Beoordeling en keurresultaat (18 nov 2026)
- **Besluit:** een ploegleider of Kwaliteit zet een batch in beoordeling. Alleen Kwaliteit voert het keurresultaat in: OK = vrijgave voor de volgende stap, NOK = afkeur. Bij NOK wordt een openstaande stap automatisch afgebroken, met de reden erbij.

### D8 – Lokaal, offline, in de browser (nov 2026)
- **Besluit:** alles draait op een lokale server in het fabrieksnetwerk, zonder internet. Schermen in de browser op Windows-pc's; het invoerscherm werkt offline met een wachtrij. Later installeerbare apps moet mogelijk blijven.

### D9 – Node.js + TypeScript, PostgreSQL, regels in de database (nov 2026)
- **Besluit:** API in Node.js/TypeScript (Fastify, OpenAPI), PostgreSQL. Alle bedrijfsregels zitten in de database; de schermen bevatten geen bedrijfslogica.
- **Waarom:** dezelfde regels gelden voor elk scherm en elke toekomstige app.

### D10 – Eén platform met een portaal per afdeling (nov 2026)
- **Besluit:** één applicatie met één login en per afdeling een portaal (Kwaliteit, Productie, Beheer; Planning later). Het invoerscherm blijft een aparte, eenvoudige app op hetzelfde platform. Nieuwe afdelingen meldt Geert.

### D11 – Beheer: logboek en altijd een beheerder (18 nov 2026)
- **Besluit:** elke wijziging aan stappen, velden, accounts, operators en pc's komt in een logboek; wachtwoorden nooit, alleen dat ze opnieuw zijn ingesteld. Er blijft altijd minstens één actieve beheerder. Niets wordt verwijderd, alleen uitgezet; gebruikersnamen liggen vast.

### D12 – Geen analyses per operator zonder besluit (nov 2026)
- **Besluit:** analyses per persoon zijn bewust niet gebouwd. Geert beslist of dat gewenst is (zie `WISHLIST.md`).
- **Waarom:** gevoelig voor medewerkers en mogelijk de ondernemingsraad.

### D13 – Laptoppakket voor lokaal testen (18 nov 2026)
- **Besluit:** `tools/maak_laptoppakket.sh` maakt een pakket met `START.bat`; alleen Node.js en PostgreSQL nodig. Standaard alleen bereikbaar op de laptop zelf.

### D14 – Browserdemo alleen als demo (18 nov 2026)
- **Besluit:** `demo/` draait het platform in de browser (PGlite), als privépagina op claude.ai. Bedoeld om te laten zien waar we staan, niet als opzet voor de fabriek.

### D15 – Privé GitHub-repository (18 nov 2026)
- **Besluit:** de code staat in `Gertjun/batch-input-gui` (privé), branch `main`.

### D16 – Claude pusht zelf naar main (18 nov 2026)
- **Besluit:** Claude haalt de code aan het begin uit `Gertjun/batch-input-gui`, test, en pusht nieuwe versies zelf naar `main`, net als bij Geerts apps.

### D17 – Versienummering MAJOR.MINOR.PATCH, elke wijziging een versie (18 nov 2026)
- **Besluit:** één versienummer voor het hele platform. MAJOR als iemand iets moet doen buiten de schermen om (alle pc's tegelijk bijwerken, database-omzetting met stilstand, opnieuw instellen); MINOR voor een nieuwe functie; PATCH voor een kleine verbetering of foutoplossing. Elke wijziging krijgt een eigen versie met changelog en wishlist. Tot de pilot blijven we onder 1.0; 1.0.0 is de start van de pilot.
- **Waarom:** dezelfde afspraak als in Geerts andere projecten.

### D18 – Oudere invoerschermen blijven werken (18 nov 2026)
- **Besluit:** een nieuwere server accepteert ook invoer uit een oudere versie van het invoerscherm (offline wachtrij). Kan dat niet, dan is het een MAJOR-versie met de duidelijke melding "werk alle pc's bij".
- **Waarom:** zelfde gedachte als bij Vaste Lasten (een ouder apparaat mag niet stukgaan); in de fabriek kan een pc offline zijn tijdens een update.

### D19 – Tags en releases automatisch, nooit achteraf wijzigen (18 nov 2026)
- **Besluit:** de workflow `release.yml` maakt voor elke nieuwe versie op `main` een tag `v<versie>` en een GitHub Release met de tekst uit `CHANGELOG.md`. Bestaande tags en releases worden nooit gewijzigd of verwijderd.
- **Waarom:** zoals bij PWA-Core; bovendien kan Claude zelf geen tags pushen.

### D20 – Werkafspraken overgenomen uit de andere projecten (18 nov 2026)
- **Besluit:** `CLAUDE.md`, `NOTES.md`, `DECISIONS.md`, `WISHLIST.md` en `CHANGELOG.md` volgen dezelfde opzet als bij Geerts apps. Automatische tests op GitHub bij elke push, met externe Actions op een vaste commit-SHA.
- **Niet overgenomen:** het werken via branches en pull requests uit PWA-Core (daar is het een gedeelde basis voor vijf apps; hier is één project, zoals bij de apps: direct naar `main`). PWA-Core-pinning en SHA-256-controles van core-bestanden zijn hier niet van toepassing.

### D21 – Inrichting fabrieksserver (18 nov 2026, 0.6.0)
- **Besluit (advies, nog te bevestigen door IT):** één virtuele machine (4 vCPU, 8 GB, 100 GB) of een kleine fysieke server met RAID 1 en UPS; Windows Server 2025 (of 2022) als IT alleen Windows beheert, anders Ubuntu Server LTS; PostgreSQL 18, Node.js 26 LTS; https met een certificaat van IT; alleen poort 443 open. Zie het document "Advies fabrieksserver" en `docs/SERVER.md`.
- **Waarom:** de belasting is klein (ca. 5 MB back-up per jaar, analyses onder 0,1 s); het gaat om beschikbaarheid en herstel.

### D22 – Back-ups en hersteltest (18 nov 2026, 0.6.0)
- **Besluit:** elk uur een volledige back-up met `pg_dump` naar een back-upmap op de server; bewaren 48 uur / 30 dagen / 12 maanden; de NAS of de back-upsoftware van IT haalt ze op (de server kan op de NAS niets wissen); nachtelijke kopie buiten het gebouw; elke maand een automatische hersteltest. Resultaten in `fabriek.onderhoud_log`, zichtbaar in Beheer → Server.
- **Waarom:** maximaal een uur werk verlies, herstel binnen een uur; WAL-archivering is bij 6 batches per dag niet nodig.

### D23 – Database-updates via genummerde migraties (18 nov 2026, 0.6.0)
- **Besluit:** wijzigingen aan de database gaan via `db/migraties/NNNN_naam.sql`, uitgevoerd door `tools/migreer.mjs` en vastgelegd in `fabriek.schema_versie`. `db/schema.sql` blijft het volledige nieuwste schema; de test controleert dat beide hetzelfde opleveren. Een applicatieversie start niet op een database met een andere schemaversie.
- **Waarom:** een bestaande fabrieksdatabase mag nooit opnieuw worden opgebouwd; updates moeten herhaalbaar en controleerbaar zijn.

### D24 – Eigen databasegebruiker met beperkte rechten (18 nov 2026, 0.6.0)
- **Besluit:** de applicatie werkt als `batchgui_app`: lezen, invoeren en wijzigen, verwijderen alleen in `pc_stap`, geen wijzigingen aan de opbouw en geen schrijfrechten op het onderhoudslogboek. Migraties, back-ups en herstel draaien als beheerder. Rechten staan in `db/rechten.sql`.
- **Waarom:** een fout of misbruik via de applicatie kan zo geen gegevens of tabellen wissen.

### D25 – Versiemappen en terugdraaien (18 nov 2026, 0.6.0)
- **Besluit:** elke versie wordt op de server in een eigen map uitgepakt; een koppeling `huidig` wijst naar de versie die draait. Terugdraaien = koppeling terugzetten (en zo nodig de back-up van vóór de update terugzetten).

### D26 – Eerst een proof of concept op de laptop, servers later (19 nov 2026, 0.7.0)
- **Besluit:** Geert is geen IT'er en wil eerst een proof of concept laten zien. Alles wordt zo ingericht dat de applicatie zonder IT op zijn Windows-laptop draait. Het inrichten van de fabrieksserver (D21, WISHLIST #10) wacht tot na de proof of concept; het advies en het serverpakket blijven bestaan.
- **Waarom:** snel laten zien wat het platform kan, zonder afhankelijk te zijn van IT.

### D27 – Laptoppakket brengt alles zelf mee (19 nov 2026, 0.7.0)
- **Besluit:** het Windows-laptoppakket bevat Node.js 26 LTS (`runtime\node.exe`, officiële versie, vingerafdruk gecontroleerd tegen nodejs.org), PostgreSQL 18 (`postgres\`, uit het npm-pakket `@embedded-postgres/windows-x64`) en de Microsoft Visual C++-runtime (door Microsoft ondertekend, app-lokaal). Geen installatie, geen beheerdersrechten, geen wachtwoord: de database draait alleen op `localhost` (poort 54329) en wordt via `pg_ctl` netjes gestart en gestopt. Bij elke start een back-up (kopie van de databasemap, laatste 5), terug te zetten met `BACKUP TERUGZETTEN.bat`. Versies en vingerafdrukken staan vast in `tools/maak_laptoppakket.sh`.
- **Waarom:** het lastigste deel van het laptoppakket (PostgreSQL installeren, wachtwoord, service) valt weg; een bedrijfslaptop zonder beheerdersrechten kan het ook draaien.
