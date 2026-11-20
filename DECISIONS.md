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
