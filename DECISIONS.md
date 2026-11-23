# Besluiten – waarom is iets zo gekozen

> **Dit bestand:** de besluiten en waarom. Alleen aanvullen: oude besluiten pas je niet aan, een nieuw besluit vervangt een oud ("vervangt D3").
> **Niet hier:** wat er gebouwd is → [`CHANGELOG.md`](CHANGELOG.md); wat er nog moet → [`ROADMAP.md`](ROADMAP.md).

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
- **Besluit:** een lot kan terug naar een eerdere lotstap (bijv. opnieuw drogen) en doorloopt daarna alle volgende stappen opnieuw. Sinds 0.35.0 ook een batch, en alleen met een opdracht van Kwaliteit of de productiemanager: zie D57.

### D5 – Lot alleen zonder open stappen; afkeur na overleg (nov 2026)
- **Besluit:** PS16 kan geen lot maken als een batch nog open stappen heeft. Een afgekeurde batch wordt na overleg fysiek afgevoerd; de gegevens blijven bewaard.

### D6 – Eén operatoraccount, correcties door ploegleider (nov 2026) — *gedeeld account vervalt met #49, zie D53*
- **Besluit:** operators loggen in met één gedeeld account en kiezen daarna hun naam. Waarden corrigeren mag alleen een ploegleider of hoger; het origineel blijft zichtbaar.

### D7 – Beoordeling en keurresultaat (18 nov 2026)
- **Besluit:** een ploegleider of Kwaliteit zet een batch in beoordeling. Alleen Kwaliteit voert het keurresultaat in: OK = vrijgave voor de volgende stap, NOK = afkeur. Bij NOK wordt een openstaande stap automatisch afgebroken, met de reden erbij. Sinds 0.35.0 is er een derde keurresultaat, herbewerken (D57); de productiemanager mag ook in beoordeling zetten.

### D8 – Lokaal, offline, in de browser (nov 2026)
- **Besluit:** alles draait op een lokale server in het fabrieksnetwerk, zonder internet. Schermen in de browser op Windows-pc's; het invoerscherm werkt offline met een wachtrij. Later installeerbare apps moet mogelijk blijven.

### D9 – Node.js + TypeScript, PostgreSQL, regels in de database (nov 2026)
- **Besluit:** API in Node.js/TypeScript (Fastify, OpenAPI), PostgreSQL. Alle bedrijfsregels zitten in de database; de schermen bevatten geen bedrijfslogica.
- **Waarom:** dezelfde regels gelden voor elk scherm en elke toekomstige app.

### D10 – Eén platform met een portaal per afdeling (nov 2026) — *invoerscherm wordt een portaal met #50, zie D54*
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

### D28 – Eerste beheerder en noodsleutel (19 nov 2026, 0.8.0)
- **Besluit:** zonder actieve beheerder vraagt de applicatie bij de start (laptop) of `tools/beheerder.mjs` (server) om de eerste beheerder. Dezelfde tool is de noodsleutel bij een vergeten wachtwoord: alleen te gebruiken op de computer met de database zelf, en vastgelegd in het logboek (wie: "noodsleutel (op de computer zelf)"). Testaccounts met wachtwoord `demo` staan los in `db/seed_accounts_demo.sql` en komen niet in een lege fabriek of op een echte installatie.
- **Waarom:** Geert merkte op dat je zonder beheerder niet in Portaal Beheer kunt om een beheerder te maken; en bekende wachtwoorden horen niet in een echte installatie.

### D29 – Planning: wie nummert, wat ligt vast, en afwijken mag (19 nov 2026, 0.9.0)
- **Besluit:**
  - De planner plant batches per dag; het systeem geeft het batchnummer uit (volgende vrije nummer van het jaar, `plan_batches`). Een geplande batch heeft status `gepland` en wordt `in_productie` zodra de eerste batchstap start. Daarna liggen dag, volgorde en product vast; de opmerking niet. Een geplande batch die nog niet gestart is, kan vervallen (met reden); het nummer wordt niet hergebruikt.
  - Een ongeplande batch (door de operator aangemaakt, met een zelf ingevoerd nummer) blijft mogelijk als uitzondering en is voor de planner zichtbaar als "niet gepland".
  - De planner legt per dag en per stap vast wat er gedaan moet worden (`stapplanning`). Dat is een richtlijn: het invoerscherm toont het en zet het bovenaan, maar weigert niets dat niet gepland is.
  - Lotsamenstelling: de planner stelt 4 batches voor (`lot_voorstel`). De operator mag afwijken, maar dan is een reden verplicht (databaseregel in `maak_lot`). Een voorstel wordt "gevolgd" of "afgeweken" en blijft bewaard.
  - Plannen mogen de rollen planner en beheerder; iedereen mag de planning lezen.
- **Waarom:** antwoorden van Geert: "Systeem nummert door", "Planner stelt voor" en ongeplande batches "Ja, als uitzondering". De fabriek moet kunnen blijven draaien als de planning niet klopt.

### D30 – Wandscherm en schermaccount (19 nov 2026, 0.10.0)
- **Besluit:** het wandscherm is een pagina van de portalen (`#/wandscherm`), alleen om te kijken, zonder menu, verversend elke 30 seconden. Een nieuwe rol `scherm` mag alleen het wandscherm lezen; het token van zo'n account is 30 dagen geldig (anders 12 uur), en bij elke vraag controleert de server of het account nog actief is. "Langer dan normaal" = langer dan 90% van de wacht- of bewerkingstijden van die stap in de laatste 30 dagen (minimaal 15 minuten). Per hal: de stappen van de actieve pc's met die locatie (een pc zonder stappenkeuze telt voor alle stappen).
- **Waarom:** Geerts vraag om een planningsdashboard waarop operators snel zien wat er te doen staat. Een tv mag niet op naam van een persoon ingelogd zijn, en moet dagen kunnen blijven staan.

### D31 – Grondstoffen: partijnummer per stap, net als waarden (19 nov 2026, 0.11.0)
- **Besluit:** de beheerder legt vast welke grondstoffen in welke stap worden ingevoerd (verplicht of niet). De operator voert per grondstof het partijnummer van de leverancier in, met een optionele hoeveelheid. Dezelfde regels als bij waarden: één invoer per registratie, alleen in een open stap, nooit wijzigen of verwijderen, correctie door een ploegleider of beheerder met reden. Een verplichte grondstof hoort bij "afronden" (`rond_stap_af`). Voorraad en ontvangst van grondstoffen houden we niet bij; dat hoort in Exact.
- **Waarom:** terugzoeken van lot naar grondstof en andersom is nodig voor klachten en audits; het partijnummer is wat op de zak of het vat staat.

### D32 – Ploegen en overdracht (19 nov 2026, 0.12.0)
- **Besluit:** ploegen zijn configuratie (code, naam, begin- en eindtijd); `ploeg_van(tijdstip)` bepaalt de ploeg en de dag (een nachtploeg hoort bij de dag waarop hij begint). Een overdracht is een notitie met bijzonderheden en aandachtspunten, vastgelegd met operator, pc en hal; niet te wijzigen, wel aan te vullen. De cijfers van een ploeg worden niet opgeslagen maar uitgerekend uit de registraties. De ploeg van een offline geschreven overdracht volgt het tijdstip op het apparaat (een tijdstip in de toekomst telt als nu).
- **Waarom:** de volgende ploeg moet in één oogopslag zien wat er speelt, ook als de pc even geen verbinding had.

### D33 – Meldingen: door de database, alleen in de schermen (19 nov 2026, 0.13.0)
- **Besluit:** meldingen worden gemaakt door triggers in de database (waarde buiten de grens, besluit over een batch, lot afgeweken van het voorstel), met per melding de rollen voor wie hij is. Gelezen wordt per gebruiker vastgelegd; meldingen worden niet gewijzigd of verwijderd en zijn 30 dagen zichtbaar. Beheerder en analist zien alle meldingen; operators en het wandscherm geen. Er gaat niets per mail, Teams of sms: het platform moet zonder internet werken (WISHLIST #21 als dat later wel mag).
- **Waarom:** regels horen in de database (D9), dus ook "wanneer moet iemand iets weten"; zo krijgt elke invoer (ook offline ingevoerd en later verstuurd) dezelfde melding.

### D34 – Stilstand en beschikbaarheid (19 nov 2026, 0.14.0)
- **Besluit:** stilstand wordt per stap gemeld (één tegelijk per stap), met een oorzaak uit een lijst in vier soorten: storing, wachten, gepland, overig. Een stilstand ligt vast; alleen het einde wordt één keer ingevuld. Tijden komen van het apparaat (offline), een tijdstip in de toekomst telt als nu. Beschikbaarheid per stap = (ploeguren in de periode − geplande stilstand − ongeplande stilstand) / (ploeguren − geplande stilstand). Kwaliteit = gestarte batches die niet zijn afgekeurd. De prestatie (OEE) volgt pas als er normtijden zijn (WISHLIST #22).
- **Waarom:** zonder oorzaak is stilstand niet te verbeteren; door geplande stilstand apart te houden telt schoonmaken niet als verlies.

### D35 – Etiketten en scannen zonder extra software (19 nov 2026, 0.15.0)
- **Besluit:** barcodes in Code 128 (tekenset B), getekend in de browser (SVG) en afgedrukt via het afdrukvenster van de browser: etiketprinter 100 × 50 mm of A4-vel 3 × 7 (63,5 × 38,1 mm). Geen printerstuurprogramma of labelsoftware van het platform. Scannen met een handscanner die als toetsenbord werkt: snelle toetsen (< 50 ms ertussen) gevolgd door Enter buiten een invoerveld gelden als scan. Geen camera-scannen (nog).
- **Waarom:** werkt op elke pc en offline, zonder installatie; handscanners zijn goedkoop en betrouwbaar.

### D36 – Capaciteit: aantal batches per dag, waarschuwen en niet blokkeren (19 nov 2026, 0.16.0)
- **Vervangen (deels) door D69:** de capaciteit per weekdag voor de hele fabriek bestaat niet meer; waarschuwen en niet blokkeren blijft.
- **Besluit:** capaciteit = het aantal batches dat op een dag kan worden gestart, per weekdag, met afwijkende dagen (met reden). Bezet = alle batches op die dag (gepland, of gestart als ze niet gepland waren), zonder vervallen. Boven de capaciteit plannen mag; de planner krijgt vooraf een vraag en daarna een waarschuwing. Capaciteit per stap of machine doen we (nog) niet.
- **Waarom:** de planner moet kunnen kiezen (spoedorder, extra ploeg); het systeem moet het alleen zichtbaar maken. Batches per dag is wat de planner nu ook telt.

### D37 – Certificaat per lot (19 nov 2026, 0.17.0)
- **Besluit:** het certificaat toont de velden die de beheerder "op het certificaat" zet, met de grenzen als specificatie. Per batchkenmerk tonen we laag–hoog en het gemiddelde over de batches; per lotkenmerk de waarde. We gebruiken de laatste afgeronde meting per batch of lot, met correcties. Alleen Kwaliteit (of de beheerder) geeft uit, alleen voor een lot dat gereed is en volledig binnen de specificatie valt, zonder afgekeurde batch (databaseregel plus API). Een uitgegeven certificaat krijgt een volgnummer en de inhoud wordt bewaard (jsonb), zodat een herdruk gelijk blijft als de configuratie later verandert. Pdf maken gaat via het afdrukvenster van de browser.
- **Waarom:** een klant moet een vast document met een nummer krijgen. Een certificaat met een afwijking hoort niet automatisch te ontstaan; dat is een besluit van Kwaliteit buiten het systeem.

### D38 – Regelkaarten (19 nov 2026, 0.18.0)
- **Besluit:** een regelkaart voor individuele waarden (I-kaart): middenlijn = gemiddelde in de gekozen periode, sigma = gemiddeld bewegend bereik / 1,128, regelgrenzen ± 3 sigma. Signalen volgens de vier Western Electric-regels, één signaal per punt. Bij een procesparameter tekenen we gemeten − setting (de setting kan per batch verschillen); bij andere velden de gemeten waarde, en alleen daar Cpk. Grenzen worden per periode uitgerekend, niet vastgelegd; signalen geven (nog) geen melding.
- **Waarom:** een batch is één meting per stap, dus een I-kaart past; zonder extra configuratie direct bruikbaar. Vaste regelgrenzen en meldingen bij signalen kunnen later, als Kwaliteit weet welke velden dat waard zijn.

### D39 – Export naar Excel in de browser (19 nov 2026, 0.19.0)
- **Besluit:** elke tabel in de portalen krijgt een knop "Naar Excel". De browser maakt zelf een echt .xlsx-bestand van de rijen die op het scherm staan (met de gekozen filters en periode), zonder extra bibliotheek en zonder API-aanroep. Getallen in Nederlandse notatie worden getallen in Excel; tekst blijft tekst. Geen CSV.
- **Waarom:** wat je ziet is wat je krijgt, en het werkt offline en op elke pc. CSV opent in een Nederlandse Excel vaak verkeerd (komma's, puntkomma's, datums). Een eigen kleine schrijver voorkomt een afhankelijkheid van een grote bibliotheek.

### D40 – Skills als vast onderdeel van het werk (19 nov 2026)
- **Besluit:** de skillpakketten `coding-skills`, `data` en `claude-for-manufacturing` uit Geerts account horen bij dit project. `CLAUDE.md` zegt per situatie welke skill Claude laadt. De fabrieksskills gebruiken we als vakkennis en controlelijst bij het ontwerpen (OEE, afwijkingen, oorzaakanalyse), niet om echte systemen te koppelen; koppelingen en `onboarding` alleen na akkoord van Geert, nooit met echte gegevens in de repository. Offerte- en CAD-skills vallen buiten dit project. De skills zelf staan niet in de repository; ze komen uit het account.
- **Waarom:** vaste werkwijzen voor de lastige onderwerpen (migraties zonder stilstand, tijd en ploegen, gelijktijdige invoer, statistiek) verkleinen de kans op fouten, en de fabrieksskills geven een tweede blik op functies voor Productie en Kwaliteit.

### D41 – Elk onderwerp op één plek (19 nov 2026)
- **Besluit:** elk document beantwoordt één vraag. README: hoe het in elkaar zit en hoe je het start en test, met bovenaan "Waar vind je wat". NOTES: alleen de stand van nu, in één scherm. WISHLIST: alles wat nog moet gebeuren, ook praktijktests, acties van Geert en open vragen. CHANGELOG: de enige geschiedenis (geen sessielog meer in NOTES). DECISIONS: waarom. Het projectdocument in het Claude-project is een korte instap met een vaste samenvatting van een halve pagina en links; geen kopie van besluiten of functies. Rapporten op claude.ai (advies fabrieksserver, datamodel v1, doorlichting) zijn momentopnamen en worden niet bijgewerkt; wat eruit volgt staat met een nummer in de wishlist. Het Whiteboard toont alleen de fasen.
- **Waarom:** informatie op meerdere plekken raakt uit de pas (NOTES noemde nog 0.9.0 en oude testaantallen). Geert moet op GitHub direct zien waar hij wat vindt; een gesprek in het Claude-project, dat de repository niet kan lezen, moet toch de hoofdlijn kennen.

### D42 – Roadmap in de repository (19 nov 2026)
- **Besluit:** de volgorde, fasen, poorten en globale planning staan in `ROADMAP.md`, met een tijdlijn die GitHub zelf tekent. De roadmap noemt alleen wishlistnummers; wat een punt inhoudt staat in `WISHLIST.md`. Tot de pilot geen nieuwe functies, behalve wat de pilot dichterbij brengt (#35 velden importeren, #36 training). Pilot in één hal, eerste twee weken met papier ernaast, evaluatie na 8 weken. Het Whiteboard wordt een momentopname (vervangt het deel van D41 over het Whiteboard).
- **Waarom:** de volgorde stond verspreid (wishlist, doorlichting, Whiteboard). Eén plek in de repository is zichtbaar voor Geert op GitHub en voor elke sessie. De data zijn schattingen; het tempo hangt vooral af van Geert, IT en de fabriek.

### D43 – Tijdstip en operator van het apparaat (19 nov 2026, 0.20.0)
- **Besluit:** de offline wachtrij stuurt bij elke actie mee wanneer en door wie die is ingevoerd (koppen `x-batchgui-moment`, `x-batchgui-verzonden`, `x-batchgui-operator`). De API corrigeert het moment voor de klokafwijking van de pc (verschil tussen versturen volgens de pc en de servertijd). De database begrenst het: niet in de toekomst, niet ouder dan 7 dagen (dan servertijd), een stap niet vóór de vorige afgeronde stap, afronden en meetwaarden niet vóór het starten. Het moment van aankomst op de server wordt apart bewaard. De operatorkop telt alleen voor invoerrollen; de pc blijft die uit het token. Zonder koppen (oudere invoerschermen) geldt de servertijd en de operator uit het token.
- **Waarom:** offline ingevoerd werk kreeg de tijd van versturen en de naam van wie toevallig was ingelogd, waardoor doorlooptijden, ploegcijfers en de herleidbaarheid niet klopten (doorlichting 19-11-2026). De operatorkop geeft geen extra rechten: op een gedeeld operatoraccount kiest iedereen al zelf een naam uit de lijst.

### D44 – Vaste tijdzone van de fabriek (19 nov 2026, 0.20.1)
- **Besluit:** de tijdzone van de fabriek staat op één plek in de database (`fabriekstijdzone()`, nu Europe/Amsterdam). Een database-update zet hem op de database (als de gebruiker daar eigenaar van is) en de API zet hem in elke transactie. Ploegtijden zijn kloktijden in die tijdzone: het einde van een ploeg is de eindtijd op de (volgende) dag, niet begin plus duur. Tijden blijven opgeslagen met tijdzone; omzetten naar lokale tijd gebeurt bij het rekenen met dagen en ploegen en in de schermen.
- **Waarom:** "vandaag", ploegen en weken hingen af van de instelling van de computer, en een nachtploeg rond de klokwissel werd 8 uur gerekend terwijl hij 7 of 9 uur duurt (doorlichting 19-11-2026). Eén functie maakt het later instelbaar als er een fabriek in een andere tijdzone bijkomt.

### D45 – Inloggen beveiligen (19 nov 2026, 0.21.0)
- **Besluit:** inloggen gaat via de databasefunctie `inloggen()`. Die legt elke poging vast in `inlogpoging` (nooit het wachtwoord) en weigert 1 minuut lang als er voor die gebruikersnaam 5 mislukte pogingen zijn binnen 15 minuten sinds de laatste geslaagde (antwoord 429 met de wachttijd). Gebruikersnamen zijn hoofdletterongevoelig (unieke index op `lower(gebruikersnaam)`); het token krijgt de naam zoals opgeslagen. Nieuwe wachtwoorden: bcrypt sterkte 11 via `wachtwoord_hash()`. De server stuurt bij pagina's een Content-Security-Policy mee (alleen eigen scripts en gegevens; stijlattributen mogen), behalve voor de API-documentatie.
- **Waarom:** zonder grens kon iemand onbeperkt wachtwoorden proberen, en de laagste bcrypt-sterkte maakt een gestolen back-up makkelijker te kraken (doorlichting 19-11-2026). Een wachttijd per gebruikersnaam is eenvoudig en werkt ook offline op de laptop; het nadeel (iemand kan een account een minuut blokkeren) weegt in een fabrieksnetwerk licht.

### D46 – Velden via een Excel-sjabloon (19 nov 2026, 0.22.0)
- **Besluit:** Beheer kan alle velden als Excel-sjabloon downloaden en een aangepast sjabloon inlezen. Inlezen gaat altijd in twee stappen: eerst een controle die alle regels in één transactie echt uitvoert (dus ook de databaseregels) en daarna terugdraait, dan pas opslaan, alleen als geen regel een fout heeft (alles of niets). Via het sjabloon verandert een veld niet van stap of soort (dat blijft een nieuw veld met een nieuwe code, D3), en velden die niet in het bestand staan blijven ongewijzigd: niets wordt uitgezet doordat een regel ontbreekt. Het bestand wordt in de browser gelezen; de server krijgt alleen de regels.
- **Waarom:** de echte velden (#2) zijn het knelpunt voor de pilot. Geert en de procesmensen werken in Excel; een sjabloon dat precies past en vooraf laat zien wat er verandert, voorkomt overtypen en fouten in 18 stappen.

### D47 – Decimalen per veld en een 0 blijft een 0 (20 nov 2026, 0.23.0)
- **Besluit:** elk veld heeft een optioneel aantal decimalen (0–6) dat alleen het tonen bepaalt; de meetwaarde wordt niet afgerond opgeslagen. Leeg = automatisch (tot 3 decimalen). Statistiek op de regelkaart toont één decimaal meer. Velden in de API die een getal of leeg mogen zijn, gebruiken een schema met twee types (`NulGetal`, `NulGeheel`) in plaats van `anyOf`, omdat de invoercontrole van Fastify bij `anyOf [null, getal]` een 0 omzette naar leeg.
- **Waarom:** het certificaat en de regelkaart moeten de afgesproken nauwkeurigheid tonen, ongeacht wat het scherm toevallig afrondt. De omzetting van 0 naar leeg was een stille fout die echte metingen (een setting van 0) zou aantasten.

### D48 – Documenten naar verleden, heden en toekomst (20 nov 2026)
- **Besluit:** vier bestanden houden het project bij. Heden: `README.md`, met bovenaan het blok "Stand" (vervangt `NOTES.md`). Toekomst: `ROADMAP.md`, de enige takenlijst met fasen, poorten en planning (neemt `WISHLIST.md` op). Verleden: `CHANGELOG.md` (wat, met achter elke versie de nummers van de gebouwde roadmappunten; de lijst "Gerealiseerd" vervalt) en `DECISIONS.md` (waarom). Punten houden hun nummer. De valkuilen voor een volgende sessie staan in `CLAUDE.md`. Handleidingen voor een bepaalde lezer blijven apart: `docs/SERVER.md`, `tools/pakket/README.md`, `CLAUDE.md`. Vervangt de indeling van NOTES en WISHLIST in D17, D20, D41 en D42; oudere besluiten die naar "WISHLIST #n" verwijzen, bedoelen nu roadmappunt #n. Geert wil deze indeling ook in zijn andere projecten.
- **Waarom:** zeven bestanden waren te veel en liepen uit de pas (de roadmap noemde nog 0.22.0, de wishlist nog laptoppakket 0.19.0, en "Gerealiseerd" herhaalde de changelog). De indeling sluit aan bij wat in softwareprojecten gebruikelijk is: README voor het heden, changelog en besluitenlog voor het verleden, één takenlijst of roadmap voor de toekomst.

### D49 – Laptoppakket als bijlage bij elke release (20 nov 2026)
- **Besluit:** de workflow `laptoppakket.yml` bouwt na elke release het laptoppakket voor Windows met de code en het bouwscript van die tag, en hangt het als bijlage aan de release. Met de hand gestart maakt hij ontbrekende pakketten van eerdere versies (vanaf 0.7.0; niet 0.14.0 en 0.15.0, die niet gebruikt mogen worden). Een bijlage toevoegen is de enige wijziging aan een bestaande release die mag; tag en tekst blijven zoals ze zijn (aanvulling op D19).
- **Waarom:** Geert wil elke versie zelf van GitHub kunnen downloaden in plaats van een zip in de chat. Het pakket bevat alleen fictieve testdata en testaccounts en de repository is privé.

### D50 – Schermen volgen de UI/UX-richtlijnen, met vijf bewuste afwijkingen (20 nov 2026)
- **Besluit:** nieuwe en gewijzigde schermen volgen `ui-ux-richtlijnen.md` in het Claude-project (Apple HIG, Material Design 3, WCAG 2.2 AA). De review van 0.23.1 leverde #41–#44 op. Bewust anders dan de richtlijnen: (A) het lettertype Atkinson Hyperlegible in plaats van het systeemlettertype; (B) nog geen donkere modus (#46); (C) de markering binnen of buiten tolerantie verschijnt al tijdens het typen; (D) "Klopt dit?" vóór opslaan, afronden, lot samenstellen en keurresultaat in plaats van "Ongedaan maken"; (E) ontworpen voor pc en tablet, niet mobile-first en zonder safe-area — *vervallen sinds 0.43.0, zie D64*.
- **Kanttekening (Geert):** later kunnen er portalen komen waarmee op een telefoon of tablet wordt ingevoerd (#47). Dan vervalt afwijking E voor die schermen.
- **Waarom:** (A) beter onderscheid tussen 0 en O, 1 en l, en het werkt offline; (B) hal en kantoor zijn fel verlicht; (C) de operator moet een afwijking zien vóór hij opslaat; (D) opgeslagen waarden liggen vast en alleen een ploegleider corrigeert (D6, D9); (E) er zijn nu alleen pc's en tablets.

### D51 – Vaste woorden in de schermen (20 nov 2026)
- **Besluit:** "Instelling" (niet "Setting") naast "Gemeten". Een stap heet in lopende tekst "Stap 5" en in tabellen en op tegels "PS5"; een veld heet "S5.1". In de database en de API blijft het `setting`. Alle schermteksten blijven Nederlands; een talenkeuze komt later (#45) en gebruikt deze woorden als basis.
- **Waarom:** één woord per begrip (richtlijnen §12), en Geert wil later meer talen.

### D52 – Planning waarschuwt als de vorige stap niet op tijd is (20 nov 2026, 0.26.0)
- **Besluit:** de database-functie `planning_vorige_stap` zegt per gepland item hoe de vorige stap ervoor staat: klaar, bezig, dezelfde dag gepland, op een eerdere dag gepland die nog komt (in orde), *achter* (stond op een dag die voorbij is en is niet klaar), pas *later* gepland, of *niet gepland*. Bij een lotvoorstel: alle 4 batches klaar of niet. De laatste drie (en "niet alle batches klaar") geven een ⚠ in Per stap, het keuzevenster bij Toevoegen, het Dagoverzicht en de Batchroute. Plannen blijft mogen. De startdag uit Per week telt als planning van de eerste stap.
- **Waarom:** Geert kon een batch in stap 2 plannen terwijl stap 1 nog niet klaar of zelfs niet gepland was, zonder dat hij het zag. Weigeren past niet bij D29: de planning is een richtlijn en de fabriek moet kunnen doordraaien. Geert koos voor waarschuwen.
- **Proef:** om de planning overzichtelijker te maken staan twee overzichten naast elkaar, Dagoverzicht (alle stappen van één dag) en Batchroute (per batch alle stappen). Geert kiest er één (#48).

### D53 – Eigen inlog per persoon, vóór de pilot (20 nov 2026)
- **Besluit:** iedereen logt in met een eigen account (naam en wachtwoord); de beheerder maakt de accounts en kent de rollen toe. Het gedeelde operatoraccount met "naam kiezen" (D6) vervalt; correcties blijven alleen voor ploegleider of hoger. Komt vóór de pilot (#49).
- **Waarom:** met een gedeeld account kan iedereen onder elke naam invoeren; dat is fraudegevoelig en met echte data niet te verdedigen.
- **Let op:** inloggen gaat via de server. Wie al is ingelogd kan offline doorwerken (zoals nu); een pc die offline is bij het begin van een dienst kan niemand nieuw laten inloggen. Dat hoort bij de praktijktests (#33).
- **Uitwerking (0.27.0):** een account van een operator of ploegleider hoort bij één naam in de namenlijst; de registraties blijven op die naam staan, er verandert niets aan het gegevensmodel. Bij de eerste inlog zonder naam maakt de database er een aan. Het oude gedeelde account blijft werken (met naam kiezen) tot de beheerder het uitzet; Beheer → Accounts waarschuwt zolang het aan staat. Zo hoeft niemand iets te doen buiten de schermen om (MINOR, D17).
- **Wachtrij na een persoonswissel:** een pc kan invoer van de vorige persoon nog versturen als die de laatste 7 dagen op die pc heeft ingelogd (database-functie `mag_invoeren_namens`); anders weigert de server en ziet een ploegleider het in de wachtrij. Wie met een gedeeld account invoert, mag zoals vroeger elke naam zonder account gebruiken.

### D54 – Eén app met startpagina; invoerscherm en wandscherm als portaal (20 nov 2026)
- **Besluit:** na het openen eerst inloggen, daarna de portalen waar je account toegang toe heeft. Het invoerscherm (tot nu een aparte app, D10) en het wandscherm (een link onderin, D30) worden portalen. Het portaal Productie krijgt een naam die laat zien dat het voor de productieleiding is (voorstel: Productieanalyse). Het invoerscherm blijft offline werken.
- **Waarom:** Geerts voorstel; één ingang is duidelijker en past bij eigen inlog (D53).
- **Uitwerking (0.27.0):** de server stuurt `/` door naar `/portaal/`, de startpagina met een tegel per onderdeel. Heeft een account maar één tegel (operator: alleen het invoerscherm), dan gaat het daar meteen heen. Het invoerscherm blijft technisch een eigen app op `/invoer/` (offline wachtrij, D10) en neemt de inlog van de startpagina over via `POST /auth/pc`, dat ook telt als inlog op die pc. Inloggen zonder pc mag daarom nu voor iedereen; invoeren vraagt nog steeds een pc. Afmelden geldt voor beide. Het wandscherm is een tegel voor iedereen behalve operators.

### D55 – Producten hebben een eigen route, vóór de pilot (20 nov 2026)
- **Besluit:** per product ligt vast welke stappen het doorloopt en in welke volgorde; stappen kunnen door producten gedeeld worden. Grenzen en toleranties per veld per product; capaciteit per stap en product. In de portalen staat bovenin een productkiezer die onthouden wordt, met ook "Alle producten"; operators kiezen niets, het product volgt uit de batch. Komt vóór de pilot (#51–#53), en vóór de echte velden worden aangeleverd (#2).
- **Waarom:** de pilothal maakt meerdere producten met verschillende stappen; één vaste route van 18 stappen voor alles klopt dan niet, en analyses van producten door elkaar zeggen weinig.
- **Gekozen boven:** een apart keuzescherm voor het product na het inloggen (Geerts eerste idee). Een kiezer bovenin is één klik minder en laat ook "Alle producten" toe, bijvoorbeeld voor de weekplanning.
- **Uitwerking route (0.28.0, #51):** de tabel `product_stap` legt per product de stappen en hun plek vast. Een product zonder regels daar (en een batch zonder product) volgt de standaardroute: alle actieve stappen. Zo hoefde er niets aan bestaande gegevens te veranderen. Een eigen route heeft minstens één batchstap en altijd de lotstap; eerst de batchstappen, dan de lotstap, dan de lotstappen. Binnen die groepen mag de volgorde afwijken van de stapnummers. Alle regels die "de vorige stap" of "alle batchstappen" gebruiken, gaan via de databasefuncties `route`, `route_vorige`, `in_route` en `batch_klaar_voor_lot` (D9). Een lot en een lotvoorstel bestaan uit batches van één product; het lot volgt de route van dat product. Een stap buiten de route weigert de database; de planning weigert niets en waarschuwt "hoort niet bij de route" (D52). De planner beheert de route bij Planning → Producten, net als de producten zelf. Een gewijzigde route geldt meteen, ook voor lopende batches; wat al gedaan is, blijft staan.
- **Uitwerking grenzen en productkiezer (0.29.0, #52):** de tabel `veld_product` geeft een veld voor één product eigen grenzen en tolerantie; een regel vervangt alle vier de waarden, zonder regel gelden die van het veld. Elke stapregistratie onthoudt bij de start het product van zijn batch of lot (`stapregistratie.product_id`), zodat een meting de grenzen van dat product krijgt en analyses snel per product kunnen filteren. De beheerder stelt de grenzen per product in bij Beheer → Stappen en velden (bij de velden, niet bij de producten). De productkiezer staat in het menu alleen bij schermen die per product kunnen: Kwaliteit (overzicht, regelkaarten, afwijkingen, trend, herbewerkingen) en Productieanalyse (doorlooptijden, productie per week, correcties); niet bij werkvoorraad, stilstand, ploegoverdracht, lotpaspoort en planning, die over de hele fabriek gaan. Met "Alle producten" en een veld met grenzen per product staat er geen Cpk en geen specificatielijn: er is dan geen eenduidige specificatie.
- **Uitwerking capaciteit (0.30.0, #53):** de tabel `capaciteit_stap` legt per stap vast hoeveel items hij per dag aankan: batches bij een batchstap, lotvoorstellen bij de lotstap, lots bij een lotstap. Een regel zonder product geldt voor elk product zonder eigen regel. Bij gemengde producten telt elk item voor zijn deel (6 van A met max 8 en 1 van B met max 3 = 108 %); een product zonder capaciteit telt niet mee. Wat telt: de Planning per stap van die dag, plus in de eerste stap van de route de batches die die dag starten volgens de weekplanning (één keer, ook als ze ook per stap gepland zijn). De capaciteit per dag uit 0.16.0 (batches per dag in de weekplanning) blijft bestaan. Net als bij D52 waarschuwt de planning alleen (Planning per stap, Dagoverzicht en weekplanning), hij weigert niets. De planner beheert dit bij Planning → Capaciteit.
- **Grenzen per product in het sjabloon (0.31.0, #73):** het Excel-sjabloon (D46) heeft een tweede blad "Grenzen per product". Anders dan het blad Velden is dat blad de volledige lijst: eigen grenzen die er niet in staan, worden weggehaald (de controle vooraf toont "Weghalen"). Zo kun je een regel weghalen door hem uit het blad te halen. Een bestand zonder dat blad (een ouder sjabloon) laat de grenzen per product ongemoeid. Een nieuw veld krijgt pas bij opslaan een code; grenzen per product voor zo'n veld kunnen pas in een volgende ronde.

### D56 – Kleine verbeteringen na de eerste demo: keuzes die blijven (21 nov 2026)
- **Besluit:** de keuzes hieronder kwamen bij het bouwen van #58, #62 en een foutoplossing in het certificaat; een volgende sessie moet ze kennen.
- **Planning in de ploegoverdracht per dag (0.33.0, #62):** de planning ligt per dag vast, niet per ploeg. "28 / 32 geplande stappen afgerond" staat daarom één keer boven de ploegen en telt alle ploegen samen. Een geplande stap telt als afgerond als de batch of het lot die stap heeft afgerond, ook als dat op een andere dag was; een lotvoorstel als het lot is samengesteld. Dezelfde telling als de stand in Planning per stap.
- **Per dag, week of maand (0.34.0, #58):** de keuze "Groeperen" staat naast Periode bij de schermen met een grafiek of tabel door de tijd (Kwaliteit-overzicht, Doorlooptijden, Productie per week). Standaard per week; de keuze geldt tot de pagina opnieuw wordt geladen, net als de periode. Een week begint op maandag. Dagen, weken of maanden zonder gegevens staan erbij met nul, zodat de as klopt. De API houdt het veld `week` in de antwoorden (het begin van de dag, week of maand), zodat bestaande aanroepen gelijk blijven; nieuw is de parameter `per`. "Afgelopen jaar" is 365 dagen tot en met vandaag.
- **Wandscherm per stap (0.36.0, #54):** de keuze staat in het adres (`#/wandscherm/stappen/PS3,PS4`), zodat een tv een bladwijzer kan hebben; een schermaccount onthoudt het laatste adres op dat apparaat (`#/wandscherm/alle` vergeet het). Geen instelling in Beheer: elke tv kiest zelf. Met gekozen stappen gaan de cijfers bovenin over die stappen, niet over de fabriek.
- **Certificaat volgt de route (0.33.0):** alleen kenmerken uit stappen in de route van het product, met de grenzen van dat product (D55).

### D57 – Herbewerking met opdracht, voor batch en lot; rol productiemanager (21 nov 2026, 0.35.0)
- **Besluit (Geert):** Kwaliteit en de productieleiding beslissen over een herbewerking, voor batches en lots. De productieleiding is een nieuwe rol, **productiemanager**. Een operator start geen herbewerking zonder opdracht. Een batch kan terug zolang hij nog niet in een lot zit; daarna gaat het lot zelf terug (D4).
- **Uitwerking:** tabel `herbewerking` met de opdracht (batch of lot, terug naar stap, reden, wie, wanneer). Per batch of lot hoogstens één opdracht die nog niet gestart is. Zolang die er is, kan de batch of het lot alleen die stap starten, en die start ís de herbewerking: ook een gewone start vanaf een ouder invoerscherm wordt zo de herbewerking (D18). De oude manier (`start_herbewerking`, het lot-scherm van oudere invoerschermen) blijft werken; die wordt vastgelegd als "zonder opdracht". Herbewerkingen van vóór 0.35.0 staan er ook zo in.
- **Stand:** nog te plannen, gepland (er staat een stapplanning voor die stap vanaf de dag van de opdracht), bezig (gestart), klaar (batch weer klaar voor een lot of in een lot; lot weer gereed), gestopt (batch afgekeurd tijdens de herbewerking) of ingetrokken. Een open opdracht vervalt als de batch wordt afgekeurd.
- **Volgorde van batchstappen:** een batchstap telt als gedaan als hij is afgerond en er daarna geen herbewerking begon bij die stap of eerder in de route (`batch_stap_gedaan`). De volgorde gaat op de aankomst op de server, niet op de klok van de pc. Werkvoorraad, "klaar voor een lot", lot samenstellen en de stand in de planning gebruiken dit.
- **Batch in beoordeling:** dan beslist alleen Kwaliteit (D7); het aanmaken van de herbewerking is dan het keurresultaat "herbewerken" en zet de batch terug in productie.
- **Productiemanager:** portalen Productieanalyse (startportaal), Kwaliteit en Planning (kijken); in beoordeling zetten en herbewerkingen aanmaken en intrekken; geen invoerscherm, geen keurresultaat, geen correcties. Krijgt meldingen over beoordelingen, keurresultaten en herbewerkingen.

### D58 – Metingen van Kwaliteit vóór de pilot; de batch wacht op de vrijgave (21 nov 2026, 0.37.0)
- **Besluit (Geert):** de metingen van Kwaliteit komen vóór de pilot in het systeem (#71). Een batch of lot met metingen van Kwaliteit wacht na de stap op Kwaliteit: pas na de vrijgave gaat hij verder. Kwaliteit voert in via het invoerscherm (lab-pc, werkt offline).
- **Uitwerking:** per veld `gemeten_door` (productie of kwaliteit). "Wat het is" (procesparameter of producteigenschap) volgt uit de bestaande soort: procesparameter, of gewicht/overig = producteigenschap; daar is geen nieuwe kolom voor. Afronden door de operator vraagt alleen de verplichte velden van Productie. Bij het afronden van een stap met velden van Kwaliteit maakt de database een keuring (tabel `keuring`, status open). Zolang die open is, telt de stap niet als gedaan (`batch_stap_gedaan`, en voor lots de laatste poging) en kan er voor die batch of dat lot niets starten. Kwaliteit vult haar velden in (ook na het afronden, alleen zolang de keuring open is; daarna alleen als correctie) en beslist met `beslis_keuring`: vrijgegeven (alle verplichte velden van Kwaliteit ingevuld; laatste lotstap → lot gereed), herbewerken (maakt een herbewerking, D57) of afgekeurd (batch: in beoordeling + NOK, D7; lot: status geblokkeerd).
- **Wie:** alleen Kwaliteit beslist over een keuring en vult velden van Kwaliteit in (de naam bij de invoer moet bij een account met rol kwaliteit horen). Kwaliteit krijgt daarvoor een eigen naam bij de invoer, zoals operators en ploegleiders (aanvulling op D53), en mag via de startpagina naar het invoerscherm. Het invoerscherm neemt de inlog van Kwaliteit alleen over als Kwaliteit daar zelf de tegel "Invoerscherm" kiest (0.37.1); anders zou elke pc waarop Kwaliteit een portaal open heeft het invoerscherm als Kwaliteit openen.
- **Oudere invoerschermen (D18):** afronden blijft werken; een waarde van de operator in een veld van Kwaliteit weigert de server. Zet een veld daarom pas op Kwaliteit als de pc's bijgewerkt zijn.

### D59 – Hulp per rol in de schermen, afdrukbaar als A4; praktijktests in een lijst met invulblad (21 nov 2026, 0.38.0)
- **Besluit (Geert):** de handleiding (#36) staat als "Hulp" in de schermen én is per rol af te drukken als één A4. Eén bron: `gedeeld/hulp.ts`, gebruikt door invoerscherm en portalen. Het invoerscherm toont de hulp voor de eigen rol (operator, ploegleider, Kwaliteit), ook vóór het inloggen en zonder verbinding; de portalen hebben een keuze uit alle rollen. Afgedrukt past elke rol op één A4 met 11 pt tekst; de schermtest `portaal/e2e/hulp.mjs` controleert dat. Wordt een tekst te lang, dan worden woorden geschrapt, niet de letter kleiner.
- **Praktijktests (#33):** wat en hoe staat in `docs/PRAKTIJKTESTS.md` (nummers L, A, V, T, S); de uitkomsten staan in het invulblad "Praktijktests – uitkomsten" op claude.ai, zodat Geert ze op de vloer kan invullen. Geen uitkomsten in de repository.
- **Waarom:** de hulp gaat zo mee in elk laptoppakket en elke versie, werkt offline op de vloer, en een A4 bij de pc helpt bij de training en de eerste pilotweken. Een aparte handleiding naast de schermen zou achterlopen.
- **Let op:** verandert een scherm (knopnaam, volgorde), pas dan ook `gedeeld/hulp.ts` aan.

### D60 – Stap overnemen en nainvoeren na papier (21 nov 2026, 0.39.0)
- **Stap overnemen (#55, gebouwd):** iedereen met een invoerrol mag een open stap afmaken, ook die een ander op een andere pc startte. De stapregistratie houdt wie startte en waar (`operator_id`, `pc_id`) en daarnaast wie afrondde en waar (`afgerond_door`, `afgerond_pc_id`, migratie 0023). Waarden staan al op naam van wie ze invoerde. `rond_stap_af` zonder naam (oudere aanroepen, testdata) gebruikt wie startte. Een stap die op een offline pc werd gestart, ziet een andere pc niet; start die hem ook, dan weigert de server de latere start met wie, waar en wanneer. Dat is niet te voorkomen zolang de pc offline is.
- **Nainvoeren na papier (#75, gebouwd in 0.40.0, keuzes van Geert):** de ploegleider en de beheerder mogen nainvoeren; tot 7 dagen terug; ook het samenstellen van een lot (stap 16) met de tijd van toen. Met reden, zichtbaar als nageleverd (`nageleverd_door`, `nageleverd_reden`, `nageleverd_op`), in het logboek (`config_log`, tabel `nalevering`), en met een afdrukbaar leeg formulier per stap. Het scherm staat in de portalen (tegel op de startpagina), niet in het invoerscherm: de beheerder werkt niet in het invoerscherm, en nainvoeren vraagt toch verbinding. De regels staan in `lever_stap_na`: alles of niets, met dezelfde volgorde- en veldregels als gewone invoer, en het begin niet vóór het einde van de vorige stap. De tijden gaan via hetzelfde mechanisme als offline invoer (`fabriek.moment`, D43).

### D61 – Tijdelijk wachtwoord en accounts via het sjabloon (21 nov 2026, 0.41.0)
- **Besluit:** elk wachtwoord dat de beheerder kiest, is tijdelijk (`gebruiker.wachtwoord_wijzigen`), behalve bij een wandschermaccount. Bij de volgende inlog krijgt de gebruiker een token met `ww: true`; de API weigert met dat token alles behalve `POST /auth/wachtwoord` (huidig en nieuw wachtwoord). De schermen bewaren dat token niet, zodat de offline wachtrij er nooit mee verstuurt. De regels voor een nieuw wachtwoord (huidig klopt, minstens 8 tekens, niet gelijk aan het tijdelijke) staan in `wijzig_eigen_wachtwoord`. Zelf wijzigen kan altijd.
- **Accounts via het sjabloon (#76):** zoals de velden (D46): eerst een proefronde, alles of niets, accounts die niet in het bestand staan blijven zoals ze zijn. Het gedownloade sjabloon bevat nooit wachtwoorden. Een bestaande naam zonder account wordt gekoppeld (de geschiedenis loopt door); een andere naam dan het account al heeft, wijzig je bij Namen, niet via het sjabloon.
- **Waarom:** voor de pilot zijn tientallen persoonlijke accounts nodig; de beheerder hoort hun wachtwoord niet te kennen.
- **Let op (D18):** een invoerscherm van vóór 0.41.0 vraagt niet om een eigen wachtwoord. Pc's bijwerken vóór tijdelijke wachtwoorden worden uitgedeeld.

### D62 – "Iets melden" en Opmerkingen (21 nov 2026, 0.42.0)
- **Besluit:** iedere ingelogde gebruiker (behalve een wandscherm) kan kort iets melden over het systeem of de werkwijze. Het heet in de schermen "Iets melden" en bij de beheerder "Opmerkingen", om het niet te verwarren met de meldingen die het systeem zelf maakt (buiten grens, storing, keuring). Tabel `terugmelding`; het id komt van het apparaat, zodat de wachtrij van het invoerscherm het ook offline kan versturen zonder dubbele (`meld_iets` met `ON CONFLICT DO NOTHING`). Alleen de beheerder ziet de lijst en handelt af, met een notitie.
- **Naam:** de melding komt op naam van het account dat hem verstuurt (de naam uit het token). Een melding uit de wachtrij na een persoonswissel staat dus op naam van wie dan is ingelogd; voor opmerkingen is dat goed genoeg.
- **Waarom:** in de pilot wil Geert de opmerkingen van de vloer niet kwijtraken en ze direct als roadmappunten kunnen oppakken; het pilotoverzicht (#77) telt ze mee.

### D63 – Vaste plek voor koppen, knoppen en tabellen in de portalen (21 nov 2026, 0.42.1)
- **Besluit:** na een rondgang langs alle schermen (op Geerts verzoek) geldt in de portalen: de paginatitel staat altijd linksboven (`.kop`, `align-items: flex-start`); knoppen en filters staan rechts ernaast in `.kop-rechts` en krimpen niet. "Naar Excel" staat rechts in de kopregel van het blok met de tabel, of in de paginakop als de tabel los op de pagina staat; dat doet `portaal/src/excelplaats.ts` vanzelf voor elke `tabel()`. Staan er twee tabellen in één blok, dan blijft de knop boven zijn eigen tabel. Korte celwaarden (tot 13 tekens) breken niet af (`td.kort`); brede tabellen schuiven in hun eigen vak (`.tabel-kader`, `.route-scroll`, beide `position: relative`), de pagina wordt nooit breder dan het scherm. Knoppen breken niet af (`white-space: nowrap`); in een tabelcel gaan ze onder elkaar.
- **Waarom:** blokken zagen er per scherm anders uit (losse regel met alleen "Naar Excel", titels op wisselende hoogte, afgebroken knoppen en batchnummers). Eén regel in de code is betrouwbaarder dan elk scherm apart aanpassen.
- **Bij een nieuw scherm:** gebruik `kop()` en `tabel()`; zet een tabel in een `.blok` met een `h2` als eerste element.

### D64 – Alle schermen geschikt voor telefoon en tablet, staand en liggend (21 nov 2026, 0.43.0–0.45.0)
- **Besluit (Geert, akkoord op het voorstel):** afwijking E van D50 vervalt. Elk scherm werkt op een telefoon en een tablet, staand en liggend, zonder dat de pagina breder wordt dan het scherm. Breekpunten volgens de richtlijnen: smal onder 600 px (telefoon staand), middel 600–839 px (tablet staand), breed vanaf 840 px; daarnaast "laag" (hoogte tot 500 px, liggend) voor een liggende telefoon. Zijmarges en de hoogte van de onderbalk staan in `tokens.css`; safe-area via `viewport-fit=cover` en `env(safe-area-inset-*)`.
- **Invoerscherm:** op een staande telefoon staat de navigatie onderaan (Stappen, Zoeken, Overdracht, Meldingen, Meer), bovenaan alleen pc, naam en verbinding; Opslaan en afronden staan erboven vast in beeld. Liggend blijft de navigatie bovenaan en scrolt de balk mee weg. Op tablet en pc verandert er niets. Klassen: `alleen-breed` (verborgen op een staande telefoon), `#onderbalk`, `.meer-paneel`.
- **Portalen:** tabellen worden op een telefoon kaartjes (elke regel een kaart met "kop: waarde"); alleen Batchroute en Dagoverzicht schuiven bewust opzij. Het wandscherm blijft voor de tv en breekt alleen niet op een tablet.
- **Waarom:** ploegleiders, Kwaliteit en planners willen ook op een telefoon of tablet kunnen kijken en invoeren (#47).
- **Testen:** een schermtest in zes formaten controleert dat geen pagina breder is dan het scherm. Een echte telefoon en tablet via het fabrieksnetwerk staan bij de praktijktests (#33).

### D65 – Notitie bij het einde van een stilstand (22 nov 2026, 0.46.0)
- **Besluit:** bij "Stilstand beëindigen" kan de operator in één tekstvak opschrijven wat het was en wat er is gedaan (`stilstand.eind_notitie`, hoogstens 500 tekens). De notitie is niet verplicht: een stap moet snel weer kunnen draaien, en een lege notitie is beter dan "x". Ze wordt alleen samen met het einde vastgelegd en is daarna niet meer te wijzigen, net als de rest van de stilstand (trigger `bewaak_stilstand`). Wie beëindigde werd al vastgelegd (`beeindigd_door`) en is nu ook zichtbaar.
- **Waarom:** de oorzaakcode zegt wat voor stilstand het was, maar niet wat er aan gedaan is; dat is nodig voor storingsanalyse en voor de volgende ploeg (#31).
- **Later:** blijkt in de pilot dat de notitie vaak leeg blijft bij storingen, dan kan ze voor storingen verplicht worden (regel in de database, D9).

### D66 – Pilotoverzicht en het vastleggen van geweigerde invoer (22 nov 2026, 0.47.0)
- **Besluit (Geert, akkoord op het voorstel):** een pilotoverzicht voor de beheerder (Beheer) en de productiemanager (Productieanalyse, onderdeel alleen voor die rol). Alleen de beheerder wijzigt de instellingen: `pilot_start` (leeg = geen) en `te_laat_minuten` (standaard 15, 1–720), als regels in `instelling` met een controle in de database.
- **"Onderweg"** is de tijd tussen het moment op de pc en de aankomst op de server (`gestart_ontvangen_op`, `afgerond_ontvangen_op`, `waarde.ontvangen_op`). Nageleverde stappen tellen niet mee, metingen van Kwaliteit ook niet (die horen bij de lab-pc, niet bij de pc van de stap). Het is een benadering van offline zijn: een pc zonder verbinding en zonder invoer is niet te zien.
- **Geweigerde invoer:** de API legt elke niet-GET met een pc in het token en een antwoord vanaf 400 (behalve 401 en `/auth`) vast in `geweigerde_invoer`, via `leg_weigering_vast`, buiten de transactie van het verzoek. Dat vastleggen mag nooit mislukken (onbekende verwijzingen worden leeg, teksten ingekort). 90 dagen bewaren, net als de inlogpogingen (`ruim_weigeringen_op`, aangeroepen door de back-up en het opstarten van de laptop).
- **Per veld** telt alleen velden die de operator invult (`gemeten_door = 'productie'`).
- **Waarom:** voor de evaluatie na 8 weken (#77) moet zichtbaar zijn waar de invoer haperde, zonder logbestanden van de pc's te verzamelen.

### D67 – Roadmap bij elke wijziging bijwerken, met een controle op GitHub (23 nov 2026, zonder nieuwe versie)
- **Besluit (Geert):** `ROADMAP.md` wordt bijgewerkt in dezelfde commit als elke wijziging (elke versie, en een wijziging zonder versie die de planning raakt): kopregel met datum en versie, gebouwde punten eruit, inleiding van de fase en de tijdlijn. Dit vervangt de afspraak dat de tijdlijn alleen verandert als een fase klaar is.
- **Controle:** `tests/test_roadmap.sh` draait bij elke push op GitHub en faalt als de kopregel een andere versie noemt dan `VERSIE`, een gebouwd nummer (uit de versiekoppen van de changelog) nog als open punt of in een open balk van de tijdlijn staat, het volgende vrije nummer niet klopt, of een taaknaam in de tijdlijn een dubbele punt heeft.
- **Waarom:** de roadmap stond op 0.38.0 terwijl 0.47.0 klaar was, en een dubbele punt in een taaknaam maakte de tijdlijn op GitHub onleesbaar. Geert leest de roadmap zelf op GitHub; die moet kloppen.

### D68 – Planning: Batches plannen en Stappen plannen (23 nov 2026, 0.47.2)
- **Besluit (Geert):** het scherm "Per week" blijft, ook na de keuze tussen Dagoverzicht en Batchroute (#48): het is de enige plek waar een batch ontstaat (nummer, product, startdag). Dagoverzicht en Batchroute zijn alleen overzichten. In het menu heet het nu **Batches plannen**, en "Per stap" heet **Stappen plannen**. De dagen in Batches plannen staan onder elkaar (0.47.1).
- **Waarom:** de oude namen zeiden over welke periode het ging, niet wat je er doet. Zo heeft elk scherm in Planning één duidelijke taak.

### D69 – Capaciteit alleen per stap en product, met afwijkende dagen als percentage (23 nov 2026, 0.48.0)
- **Besluit (Geert):** de capaciteit per weekdag voor de hele fabriek (D36, 0.16.0) vervalt: de fabriek maakt elke dag verschillende producten op verschillende lijnen, dus één getal per dag zegt weinig. Er is geen maximum voor de hele fabriek. Elke dag van de week geldt dezelfde capaciteit per stap en product (D55). Hoeveel batches van een product per dag kunnen starten, is de capaciteit van de eerste stap van zijn route.
- **Afwijkende dagen** (`capaciteit_afwijking`): een periode (van, tot en met) met een percentage van de gewone capaciteit, voor alle of één product en alle of één stap. 0 % = geen productie, ook in een stap zonder ingestelde capaciteit. Gelden er meer regels tegelijk, dan telt het laagste percentage. Een verlaagde capaciteit wordt naar beneden afgerond, maar minstens 1. Weghalen = uitzetten (`actief`), zoals bij alle configuratie. Regels in de database: `capaciteit_afwijking_voor`, `capaciteit_stap_op`; `stap_belasting` gebruikt ze en geeft ook de reden.
- **Gevolgen:** Batches plannen toont per product de starts tegen de capaciteit van de eerste stap, en de ruimte per product; de waarschuwing bij plannen gaat per product. Plannen blijft altijd mogen (D36). De oude afwijkende dagen zijn omgezet naar een percentage voor alle producten en stappen; de tabellen `capaciteit` en `capaciteit_dag` en de functie `capaciteit_op` zijn weg (migratie 0029). Alleen portaal en API gebruikten ze, die altijd samen worden bijgewerkt; oudere invoerschermen raakt dit niet (D18).
- **Gekozen boven:** een percentage per weekdag, of werkdagen per product (niet nodig: alle dagen gelijk), en een vast aantal per afwijkende dag (een percentage werkt voor alle stappen en producten tegelijk).

### D70 – Grenzen en tolerantie als lijnen in de grafieken (23 nov 2026, 0.48.1)
- **Besluit (Geert):** in de grafieken zijn grenzen een rode doorgetrokken lijn (`--status-kritiek`, 2 px) en de tolerantie oranje gestreepte lijnen (`--status-waarschuwing`, 2 px, streep 6–4), met het label in dezelfde kleur (`--grens`, `--tol`). De instelling blijft grijs gestippeld. De lichtblauwe tolerantieband vervalt (en daarmee het token `--band`). Specificatiegrenzen in de regelkaart volgen dezelfde stijl als de grenzen; regelgrenzen blijven grijs gestreept.
- **Waarom:** de band haalde op wit geen 3 : 1 contrast en was nauwelijks te zien. Oranje en rood betekenen in het hele platform al "buiten tolerantie" en "buiten grens". Kleur én lijnstijl verschillen, zodat kleur nooit de enige drager is (kleurenblindheid, fel licht, afdrukken in grijs).
- **Tolerantie per meting:** de lijnen volgen de instelling van elke meting als traplijn (net als `bereken_markering`), niet de laatste instelling voor de hele periode.

### D71 – Capaciteit alleen per product, uit de route; niets schatten (23 nov 2026, 0.49.0)
- **Besluit (Geert):** Planning → Capaciteit toont per actief product elke stap van zijn route (view `capaciteit_route`); een stap zonder capaciteit staat op "nog invullen", met een melding en een teller in het menu. De regel "voor alle producten" (`capaciteit_stap.product_id` leeg, D55) vervalt: die gaf producten waarvoor niemand iets had ingevuld toch een capaciteit. `product_id` is nu verplicht (migratie 0030); bestaande regels voor alle producten zijn omgezet naar een regel per product met die stap in de route.
- **Plannen blijft altijd mogen (D36):** zonder capaciteit telt een product niet mee in het percentage; de planning toont "capaciteit nog invullen".
- **Gekozen boven:** plannen blokkeren tot alles is ingevuld (gaat in tegen D36).

### D72 – Wandscherm Kwaliteit (23 nov 2026, 0.50.0)
- **Besluit (Geert):** een wandscherm voor het lab met drie dingen: wat op Kwaliteit wacht, de afwijkingen van vandaag en de kerncijfers van vandaag. Geen herbewerkingen (die staan in het portaal Kwaliteit).
- **Uitwerking:** `GET /wandscherm/kwaliteit`, voor dezelfde rollen als het gewone wandscherm. "Wacht" = open keuringen (D58) plus batches in beoordeling (D7). "Lang" = langer dan 90 % van de keuringen in de laatste 30 dagen, minstens een kwartier (zoals D30). "Binnen grenzen" = metingen van vandaag zonder markering (dus ook binnen tolerantie). Afwijkingen tonen hetzelfde teken als in de grafieken (D70): ▲ tolerantie, ◆ grens.


### D73 – Keuringsstappen en specificaties per product (23 nov 2026, 0.51.0)
- **Besluit (Geert):** tussenkeuringen (TK) en de eindkeuring (EK) zijn eigen stappen (`processtap.soort = 'keuring'`) in de route van een product. Alleen Kwaliteit start, meet en beslist; operators zien ze niet. Kwaliteitsvelden in een processtap (D58) blijven bestaan, bijvoorbeeld een gemeten temperatuur. Tussenkeuringen en eindkeuring krijgen allebei een specificatie. Specificatie per klant: later (#84).
- **Uitwerking:** bij het starten is een keuringsstap meteen afgerond, dan staat de keuring open (D58): één manier van keuren. Database: keuringsstap niet als lotstap, velden alleen van Kwaliteit, starten alleen door een operator met een Kwaliteit-account, niet nainvoeren. De standaardroute (product zonder eigen route) heeft geen keuringsstappen.
- **Specificatie:** `specificatie` (per product en keuringsstap, versie, concept → vastgesteld → vervallen; hoogstens één concept en één geldige) met `specificatie_regel` (minimum en/of maximum per veld). Vaststellen via `stel_specificatie_vast`, nieuwe versie via `nieuwe_specificatie` (kopie van de geldige). `grenzen_van` neemt de geldige specificatie voor de veld- en productgrenzen (zonder tolerantie). Elke meting bewaart `specificatie_id`; het certificaat toont versie en grenzen van het moment van meten.
- **Oudere invoerschermen (D18):** MINOR. Alleen de lab-pc moet bijgewerkt zijn voordat een echte route keuringsstappen krijgt; andere pc's merken niets.

### D74 – Verbeterlijst van 23 november: ploegen, capaciteit in kg, Medewerkers, wandscherm (23 nov 2026, zonder versie)
- **Besluit (Geert):** fase A4 in de roadmap met zijn 23 punten, in twee prioriteiten vóór de pilot en een deel in fase F.
- **Ploegen:** 5 ploegen (A–E) in 2 divisies (1 en 2), samen 10. Beide divisies werken tegelijk, dus er zijn altijd twee ploegen aan het werk. Elke ploeg: 2 ochtend, 2 middag, 2 nacht, 4 vrij (cyclus van 10 dagen). Elke medewerker hoort bij één ploeg en één divisie (#86, #87).
- **Capaciteit in kilogram:** voor de pilot een vast gewicht per batch per product; het moet later per batch kunnen verschillen, dus het gewicht niet zo vastleggen dat dat later een grote omzetting wordt (#90).
- **Medewerkers:** Beheer → Operators wordt Medewerkers, met blokken voor operators en Kwaliteit; persoon en account zijn één regel en het accountbeheer gaat erin op (#87).
- **Dagoverzicht en Batchroute blijven allebei** (sluit #48; gaat niet tegen D52 in, die liet de keuze open).
- **Wandscherm instellen in Beheer (Geert vroeg advies):** per wandschermaccount kiest de beheerder in Beheer wat het toont (hal, stappen of Kwaliteit). Dit vervangt "geen instelling in Beheer: elke tv kiest zelf via het adres" uit D54 (0.36.0) voor schermaccounts; anderen kunnen nog via het adres kijken. Waarom: één plek om alle tv's te beheren, en wie de tv aanzet hoeft niets te kiezen of te onthouden (#92).
- **Gekozen boven:** de keuze per tv in het adres houden (dan moet iemand naar elke tv om iets te wijzigen, en raakt een tv na een herstart zijn keuze kwijt als de browser wordt gewist).

### D75 – Twee keer ingevuld: de eerste blijft, de tweede wordt een conflict (23 nov 2026, 0.52.0)
- **Besluit:** vullen twee mensen hetzelfde veld of dezelfde grondstof van een stap in, dan blijft de eerste invoer staan en wordt de tweede bewaard in `invoerconflict` in plaats van geweigerd (#85). Een ploegleider kiest welke blijft; bij een veld dat Kwaliteit meet kiest Kwaliteit; de beheerder kan altijd. Kiezen voor de tweede is een gewone correctie (`los_invoerconflict_op`), het origineel blijft bewaard. Dezelfde waarde nog eens (bij een grondstof: zelfde partij, hoofdletters en spaties tellen niet) is geen conflict.
- **Waarom:** een weigering kwam bij offline invoer pas later in de wachtrij terecht, waar niemand hem zag, en de tweede meting ging verloren. De database hield al tegen dat twee waarden tegelijk gelden (unieke index per stap en veld); wat ontbrak was zien en kiezen.
- **Corrigeren:** een correctie stuurt het id mee van de waarde die de ploegleider zag (`vervangt`). Is die intussen vervangen, dan weigert de server (409). Twee correcties op exact hetzelfde moment houdt de unieke index op `vervangt_waarde_id` tegen. Zonder `vervangt` (oudere schermen) werkt het als vroeger.
- **Kwaliteit corrigeert alleen via een conflict:** Kwaliteit mag een waarde alleen vervangen binnen `los_invoerconflict_op` (instelling `fabriek.conflict`), niet zelf corrigeren; corrigeren blijft aan de ploegleider.
- **Keuring:** het eerste besluit telt (zoals al); de tweede krijgt te zien door wie en wat er besloten is. Een besluit terugdraaien gaat via herbewerking, niet via een conflict.
- **Afronden met een open conflict mag:** de productie stopt niet; het conflict is achteraf op te lossen, zoals een correctie.
- **Gekozen boven:** de laatste invoer laten winnen (dan verdwijnt stil een meting), of de stap blokkeren tot er gekozen is (stilstand op de vloer).
