# Changelog – wat is er per versie veranderd

> **Dit bestand:** per versie wat er nieuw of anders is, in gewone taal. Het is de enige geschiedenis van het project.
> **Niet hier:** waarom iets zo is gekozen → [`DECISIONS.md`](DECISIONS.md); wat er nog komt → [`ROADMAP.md`](ROADMAP.md).

Eén versienummer voor het hele platform (`MAJOR.MINOR.PATCH`, D88). Nog niet uitgegeven wijzigingen staan onder Unreleased. Achter de datum staan de nummers van de roadmappunten die in die versie zijn gebouwd. Alle gegevens zijn fictief.

## Unreleased
- D102/0094: goedgekeurde eenmalige initialisatie van bestaande persoonlijke identiteiten zonder MES-rechtenhistorie, via eigenaar en drie persoonlijke bevestigingen. Geen automatische legacy-grants; drie exact afgebakende grants, sessiegeneratie verhoogd, onveranderlijk bootstraprecord. Schone bootstrap blijft voorkeur voor fictieve pre-pilot. Gerichte DB- en toolregressies toegevoegd; uitvoeringsbewijs open.
- Operationele securityreview: serverdraaiboek en praktijktests aangepast aan D100/D101, oude noodsleutelverwachtingen gecorrigeerd. D100/D101: upgrade van bestaande identiteitsadministratie zonder MES-grants behoudt historie maar heeft geen geautoriseerd eerste beheerpad: bootstrap vereist lege administratie, securitykanaal vereist bestaande grant. Geen automatische legacy-grants, geen herbootstrap of ad-hoc SQL-toekenning. Expliciet besluit vereist over gecontroleerde initiële toekenning voor bestaande database; fictieve lege PoC kan normale bootstrap gebruiken.
- Run [45572488766](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45572488766), job 139062300483, head 6e332599aafc949b8cca94c401c4d0c21579d69c, base 31c86973bf13848cba44fc38785084953fe65e39: gehele gerichte PostgreSQL-baseline groen, inclusief startinventaris, mislukte herstelcontrole/cleanup, historische upgrade 0035–0093, 12/12 security, 10/10 autorisatie, 117/117 API en Linux-pakket; documentatie 45572480062 groen. Geen volledige acceptatie of Windows-bewijs.
- D100: serverstart toetst volledige migratie-inventaris; herstelcontrole sluit verbindingen en ruimt uitsluitend eigen uniek benoemde tijdelijke database op vóór exit, met foutmelding bij mislukte cleanup. Gerichte regressies voor onbekend schema, ontbrekende tussenmigratie, beschadigde dump, behoud historie en onderhoudslog toegevoegd. Uitvoeringsbewijs open; geen schemawijziging.
- D99/#136: resterende documentatieverwijzingen naar historische browserdemo gecorrigeerd; geen directe demo-afhankelijkheid aangetroffen in package.json van api/invoer/portaal, pakketbouw, acceptatieverificatie of actuele test-/releaseworkflow. Integrale validatie open.
- Run [45567796663](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45567796663), job 139046752938, head 8fd03f7c8c3ff3831b1e2d0a106189d05335d564, base 31c86973bf13848cba44fc38785084953fe65e39: gehele gerichte PostgreSQL-baseline groen, historische upgrade 0035–0093 inclusief tien tabellen, legacy-snapshot, nul automatische grants, ACL en pre-upgradeback-up bevestigd in log; 117/117 API, 12/12 security, 10/10 autorisatie, beheertools en Linux-pakket geslaagd. Geen Windows- of integrale acceptatie.
- D99/#136: demo-specifieke datum- en browsertests uit verplichte CI verwijderd; reguliere PostgreSQL-schermtests, offline en pakket blijven verplicht. Historische demo blijft in repository, los van versiecontrole en releaseversies. Release bouwt al uitsluitend api/invoer/portaal. Resterende afhankelijkhedenreview en integrale validatie open.
- D100/D101: historische upgradeproef vanaf echte main-basis 0035 met historische fictieve generator en vergelijking van alle toenmalige kolommen in tien tabellen, legacy-snapshot, nul automatische grants, ACL en pre-upgradeback-up; opgenomen in gerichte en volledige suite. Uitvoeringsbewijs nog open.
- D100: [PostgreSQL-baseline 45566354900](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45566354900), job 139041993323, head e7813d396e03f3bc64fcd691ad159b416316f7d3, base 31c86973bf13848cba44fc38785084953fe65e39: alle stappen geslaagd, inclusief 117/117 API, schema-equivalentie 0001–0093, beheertools (onbekende schema’s, back-up/herstel, opzettelijke rollback) en Linux-pakket. Documentatiecontrole 45566342443 groen. Geen integrale acceptatie; historische schema-upgrade en Windows blijven open.
- D100/D101: beheertooltest gebruikt een geïsoleerde kopie van de migratietool met opzettelijk falende testmigratie; controle op back-up, foutoorzaak, rollback van DDL, migratiemarkering, historie en onderhoudslog. Vervangt de onjuiste aanname dat herhaling van 0093 faalt. Fictieve herbewerkingsstart gebruikt een expliciet bevoegde uitvoerder. Nieuwe migratie- en herstelgrensregressies bereikt en geslaagd in run 45564465468; volledige beheertooltest nog open.
- D100: herstel van een dump met onbekende schemaversie geweigerd vóór rechtenherinstallatie; verbinding wordt gesloten vóór terugval naar de oorspronkelijke database. Regressie voor terugval en behoud van ACL, schemaversie en waardeaantal toegevoegd; nog niet uitgevoerd.
- D100: migratieprogramma weigert onbekende schemaversies vóór migraties of rechtenherinstallatie; regressie controleert behoud van fictieve historische gegevens, schemaversie en ACL. Uitvoering nog open.
- D101: [Node 22-compatibiliteitsrun 45558147763](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45558147763), job 139015099770, head 6aaa391c1afa9e516d8d512573249feedb1a6d60, base 31c86973bf13848cba44fc38785084953fe65e39: 22/22 gerichte Chrome/IndexedDB-controles geslaagd, API-typecheck en beide applicatiebuilds groen; documentatiecontrole eveneens groen. Fictieve sessies en gesimuleerde serverweigering; geen integrale scherm-/netwerkacceptatie. Volledige Node 26-suite overgeslagen.
- D101: zelfstandige Chrome-regressie offline-rechten.mjs gebruikt echte IndexedDB en productiemodules via Vite, fictieve sessies en gemodelleerde serverweigering; controleert ontbrekende projectie, productscope, veldrechten, geheimen, sessiewisseling, gezamenlijke opslag, rollback en behoud bij weigering. Opgenomen in Node 22 en volledige acceptatie. Nog niet uitgevoerd.
- D101: nieuwe offline acties vereisen de persoonlijke permissionprojectie van hetzelfde token, per handeling en waar nodig product en meetveld. Lokale registratie en wachtrij worden atomair in IndexedDB opgeslagen, inclusief batch aanmaken plus starten; bij weigering geen lokale wijziging. Oude wachtrijacties blijven behouden; servercontrole bij synchronisatie blijft leidend. UI-context is geen serverbewijs. Gerichte regressies en schermvalidatie nog open.
- D100: gerichte PostgreSQL-baseline [45556530186](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45556530186), job 139009809147, head 82598c571650a30d4989bdccd4d82d1bb95b76fa, base 31c86973bf13848cba44fc38785084953fe65e39: 666/666 databaseregels, 12/12 security, 10/10 autorisatie, 117/117 API (805 getelde controles), schone installatie, schema-equivalentie 0001–0093 en Linux-laptoppakket geslaagd. Technische/persoonlijke rechten en public-regressies aantoonbaar geslaagd. Geen integrale faseacceptatie; D101 UI/offline, overige installatiegrenzen, Windows, representatieve upgrade en Node 26 blijven open.
- D100: run 45556043173 op 5c2f957: schema-equivalentie, security, autorisatie, API en Linux-pakket geslaagd; databaseregels stoppen bij intrekking doordat de nieuwe ACL-testlus de bestaande variabelen grant (UUID) en revoke (query) overschrijft. Lusvariabelen hernoemd naar acl_grant_sql en acl_revoke_sql, zonder wijziging van scenario's, verwachtingen of productiecode. Hertest open.
- D100: run 45555577075 op dd9ede8: schoon schema en migratie-equivalentie 0001–0093, security en autorisatiemodule geslaagd; databaseregels, API en Linux-pakket geblokkeerd door enkelvoudige SQL-dollardelimiters in technische rolcontrole in rechten.sql. Delimiters hersteld; schema, migratie 0093 en rechtenbestand statisch gecontroleerd op dit patroon. Geen wijziging van beveiligingslogica of testverwachtingen. Hertest open.
- D100: SQL-delimiters 0093 vóór CI hersteld; persoonlijke leden via expliciete recursieve rolrelaties bepaald (geen impliciete superuserlidmaatschappen). Rechteninstallatie weigert onvertrouwd public-eigendom, CREATE-grants buiten installatie-eigenaren, afwijkend pgcrypto-eigendom/schema en onvertrouwde routine-eigenaren in public. Regressie voor PUBLIC CREATE toegevoegd. Geen automatische intrekking of eigendomsoverdracht. Validatie open; andere schema's/databases en reeds gecompromitteerde vertrouwde eigenaren vallen buiten deze controle.
- D100/0093: persoonlijke securityrollen worden bij binding, iedere securityhandeling en rechteninstallatie getoetst op effectieve tabel-/kolom-/sequence-rechten, extra functierechten of delegatie, eigendom in fabriek en CREATE op database/fabriek/public. Regressies simuleren directe kolom-, functie- en public-CREATE-grants na binding. Afwijkingen worden geweigerd, niet automatisch ingetrokken; directe SQL-toegang bij afwijkende grants vereist IT-herstel. Andere schema's/databases en vertrouwen in public/extension-eigenaars blijven open. Validatie open.
- D100: rechteninstallatie vanaf 0092 weigert technische rollen met beheerattributen, ongewenste transitieve lidmaatschappen of delegatie; securitykanaal moet NOLOGIN zijn. Historische batchgui_app → mes_app blijft toegestaan. Regressies simuleren extra lidmaatschap en LOGIN; geen automatische verwijdering van afwijkende rechten. Nieuwe validatie open.
- D100: gerichte PostgreSQL-baseline [45512808472](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45512808472), job 138864559805, head b06ec8b274326a40a90a54eb65b22c8e6214ca35, base 31c86973bf13848cba44fc38785084953fe65e39: alle stappen geslaagd, inclusief databaseregels, security, autorisatie, API en Linux-pakket; Node 26 overgeslagen. Geen integrale faseacceptatie.
- D100: run 45512256648 op ab91c41: schema-equivalentie, schone installatie, security 12/12, autorisatie 10/10, API 117/117 en Linux-laptoppakket geslaagd. Databasetest stopt bij sequence-catalogusquery: PostgreSQL kan WHERE-predicaten herordenen en has_sequence_privilege op niet-sequence pg_statistic evalueren. CASE begrenst de functieaanroep tot relkind S, zonder wijziging van de getoetste rechten of productiecode. Hertest open.
- D100: rechteninstallatie valideert alle geïnstalleerde SECURITY DEFINER-functies op schema-eigenaarschap, expliciet vertrouwd zoekpad met pg_temp laatst en geen PUBLIC EXECUTE. Afwijkingen worden geweigerd, niet automatisch van eigenaar veranderd. Regressies voor catalogus en opzettelijk onveilig zoekpad toegevoegd. Vertrouwen in public-schema/extension-eigenaren, directe persoonlijke grants en afwijkende installatie-ACLs buiten fabriek blijven afzonderlijke aandachtspunten. Gebundelde validatie open.
- D100: vanaf 0092 ook schema- en routine-ACL reset met CASCADE voor PUBLIC en drie betrokken rollen; bestaande applicatie-allowlist en exact vijf persoonlijk gebonden securitykanaalfuncties hersteld zonder delegatie. Regressies simuleren historische PUBLIC-uitvoering, CREATE, grant-opties en kruisrechten tussen runtime/security. Buiten fabriek, persoonlijke directe grants, rolstructuur en SECURITY DEFINER-eigenaars/paden afzonderlijk beoordelen. Validatie open.
- D100: rechteninstallatie vanaf 0092 trekt vooraf alle tabel- en afzonderlijke kolom-ACLs voor PUBLIC, mes_app, batchgui_app en mes_security_channel in (CASCADE), waarna bestaande expliciete lees-/schrijfinterface opnieuw wordt opgebouwd. Regressies simuleren oude UPDATE/REFERENCES, TRIGGER, sessiehash- en wachtwoordhashleestoegang en grant-opties; normale beperkte toegang blijft getest. Geen gegevenswijziging. Directe functie-/schema-/database-ACLs en afwijkende roltoekenningen blijven aparte auditpunten; validatie open.
- D24/D100: vanaf schema 0092 geen directe sequence-ACL voor runtime, legacy-login, securitykanaal of PUBLIC; identity-inserts en eigenaartrigger blijven leidend. Oude sequence-grants inclusief delegatie worden ingetrokken; tests simuleren historische grants, herhaalde rechteninstallatie en geweigerde nextval/setval/SELECT. Validatie open; overige ACL en definer-audit volgen.
- D24/D100/D101: run 45510881306, job 138857977598, head f8054187f592cb0eee63453e39629820e15adc60, base 31c86973bf13848cba44fc38785084953fe65e39: PostgreSQL 18 schoon, schema-equivalentie 0001–0092, databaseregels 610/610, security 12/12, autorisatie 10/10, API 116/116, Linux-laptoppakket en documentatie geslaagd. Totaal 748 getelde controles. Effectieve rechtenaudit: runtime-start weigert voortaan ook CREATE op database; regressie toegevoegd, nog niet uitgevoerd. Sequence-ACL, historische grant-opties, definer-paden, UI/offline en finale acceptatie open.
- D100/D101: run 45510366427 op 0c1a15f bevestigt schema-equivalentie 0001–0092, security 12/12, autorisatie 10/10, API 116/116 en Linux-laptoppakket. Databaseregressie stopt bij papieren nalevering: eerdere fictieve test_training is verplicht voor execution.record; supervisor heeft die niet. Negatieve kwalificatietest bij nalevering toegevoegd, daarna uitsluitend fictieve supervisor voorzien van kwalificatie en alle vereiste permissions gecontroleerd. Geen productiewijziging; hertest open.
- D100/D101 (0092): run 45509817373 op b017950: schone installatie, 12 securitytests, 10 autorisatietests, 116 API-tests en Linux-laptoppakket geslaagd; schema-equivalentie faalde door search_path maak_herbewerking, databaseregels door drie resterende positieve/procesregressies met oude kwaliteitsidentiteit. Begrensde search_path hersteld via 0092, fixtures omgezet naar expliciet bevoegde MES-identiteit. Negatieve legacy-regressies behouden; hertest open.
- D101 (0091): batchblokkade, kwaliteitsbesluiten en aanmaak/intrekking herbewerkingsopdrachten op actuele MES-permissions en productscope; fixtures en regressies aangepast. Bevestigde applicatiepaden blijven verplicht; validatie open.
- D101 (0090): papieren nalevering ook in onderliggende eigenaarfunctie op actuele MES-permissions per batchproduct; oorspronkelijke papieren operator blijft onderscheiden van de transcribent. Negatieve legacy-regressies toegevoegd; validatie open.
- D101 (0089): meetwaarde- en grondstofcorrecties en conflictbesluiten vereisen actuele MES-permissions met productscope; kwaliteitscorrecties alleen via gecontroleerd conflictpad. Fictieve correctie-identiteit en regressies aangepast; validatie open.
- D101 (0088): keuringsstart en oorspronkelijke kwaliteitsmeting vereisen actuele MES-grants en productscope; geen legacy kwaliteitsrol. Fictieve meetidentiteit omgezet; regressies voorbereid. Correctie-/besluitpaden blijven afzonderlijk open.
- D101 (0087): de laatste legacy-beheerdersrol is geen verplichte accountvoorwaarde meer; gebruikersnaam blijft onveranderlijk, kritieke MES-identiteiten en sessies blijven beschermd. Oude fictieve accounts mogen worden vervangen, historische identiteiten blijven intact. API-rolhelpers verwijderd en serverdiagnose gebruikt system.read. Regressiebewijs open.
- D24/D100: API-start vereist beperkte database-identiteit; laptop scheidt onderhoud en runtime, gebruikt SCRAM en zet oude authenticatie offline om. Regressies voor effectieve rechten, bootstrap, diagnose en back-upherstel toegevoegd; validatie open.
- D100: lot-herbewerking gebruikt vergrendeling in gecontroleerde DB-functie zonder extra app-schrijfgrant; grondstofconflict blokkeert afronding tot gemotiveerd besluit (regressie).
- D100: regressies voor onafhankelijke kwaliteitsblokkade, voorafgaande herbewerkingsopdracht, persoonlijke bevestiging en gemotiveerde conflictkeuze; SQLSTATE 42501 vertaald naar 403.
- D100: API-regressies op bevoegde engineering-/managementidentiteiten, persoonlijke accountstroom en wachtwoordwrapper; schermidentiteit expliciet uitgesloten van persoonlijke routes.
- D100: herstel eerder bedoelde begrensde kolomgrants na algemene REVOKE; expliciete MES-grants voor fictieve API-regressieaccounts.
- D100: effectieve tabeleigenaar correct onderscheiden van gewone app-rol; herstel testhelper en API-teardown.
- D100: afsluitdelimiter van auditfunctie 0080 in basisschema hersteld.
- D100: PostgreSQL 18-installatiefout in niet-uitgebrachte bootstrapmigratie 0054 gecorrigeerd (gereserveerde kolomnaam).
- CI: gerichte PostgreSQL-baseline op verzoek voor concept-PR (D100), zonder volledige acceptatiesuite.
- MES: stabiele auditactor-ID en expliciete herkomststatus (0081); SQL-delimiter van niet-uitgebrachte 0080 gecorrigeerd.
- MES: configuratieaudit gebruikt gevalideerde persoonlijke sessie; onbewezen herkomst expliciet gemarkeerd (0080).
- MES: directe configuratie-auditwrites geblokkeerd; afgeschermde trigger (0079).
- MES: expliciete tijdelijke leesinterface en intrekking oude SELECT-kolomgrants (0078).
- MES: expliciete tabelschrijfrechten voor de tijdelijke applicatie-interface (0077).
- MES: expliciete databasefunctie-interface in plaats van algemene uitvoeringsrechten (0076).
- MES: behoud beveiligde functiezoekpaden bij nieuwe installatie en migratie; oude authenticatie-ingangen beperkt (0075).
- MES: gecontroleerde processtart, afronding en herbewerkingsstart (0074).
- MES: gecontroleerde tijdelijke batchcreatie en batchplanning conform D98 (0073).
- MES: bescherm batch- en lotstatusovergangen (0072, gedeeltelijk).
- MES: gecontroleerde papieren productienalevering met gescheiden identiteiten (0071).
- MES: persoonlijke conflictinvoer en gecontroleerde conflictbesluiten (0070).
- MES: persoonlijke identiteit en bevoegdheden bij meet- en grondstofinvoer (0069).
- MES: persoonlijke identiteitsbinding in invoertransacties en eerste registratieguard (0068).
- MES: persoonlijke sessiebewijzen geïntegreerd in API-authenticatie (0067).
- MES: afgeschermd register voor persoonlijke database-sessiebewijzen (0066, fundament).
- MES: actuele uitvoeringsbevoegdheid bij koppeling van herbewerkingsopdracht (0065).
- MES: bevestigde herbewerkingsopdrachten en beschermde opdrachtgeschiedenis (0064).
- Herstel SQL-functiedelimiter in nog niet uitgegeven migratie 0063 en basisschema.
- MES: bestaande herbewerkingsopdracht verplicht; kwaliteitsblokkade blijft onafhankelijk (0063).
- MES: persoonlijke bevestiging voor tijdelijke kwaliteitsbesluiten en afscherming directe besluitwrites (0062).
- MES: gecontroleerde registratie, intrekking en vervanging van securitybindingen (0061).
- MES: persoonlijke database-identiteitsbinding en afgeschermde autorisatieleesfuncties (0060).
- MES: afzonderlijk beperkt autorisatiekanaal voor persoonlijk bevestigde aanvraag, besluit en intrekking (0059).
- MES: scheid personeelsbeheer van technisch accountbeheer en stop automatische personeelscreatie bij login (0058).
- MES: eigenaar-only diagnose van onafhankelijke herstelmogelijkheden, zonder automatische noodtoegang (0057).
- MES: accountgebonden sessiegeneratie en intrekking oude tokens bij identiteitswijziging (0056).
- MES: eigenaar-only onafhankelijk accountherstel met persoonlijke herbevestiging en auditrecord (0055); sessie-intrekking en aansluiting nog open.
- MES: gecontroleerde lege-databasebootstrap met drie beheeridentiteiten; oude noodsleutel uitgeschakeld (0054), herstel nog open.
- MES: bescherming tegen gewone wachtwoordresets voor bevoegde en legacy-identiteiten; geen roltoekenning bij tijdelijk wachtwoord (0053).
- MES: nieuwe accounts zonder oude rol en afscherming directe legacy-rolwijziging (0052); accountbeheerinterface nog om te schakelen.
- MES: technisch beheer en securitybeheer gescheiden in autorisatiebeslissing en roltoekenning (0051); regressies toegevoegd, uitvoering nog open.
- MES: SQL-functiebegrenzingen in conceptmigratie 0050 en installatieschema gecorrigeerd; databaseacceptatie nog open.
- MES: begrensde wachtwoordwijziging en blokkade gedeelde accounts op databaseniveau (0050).
- MES: eerste correcties tussentijdse D99-audit; actuele persoonlijke sessiecontrole en werkstationbinding gescheiden van wachtwoordauthenticatie.
- MES: batch-, lot- en herbewerkingsbevoegdheden met productscope (0049).
- MES: planning en productengineering gescheiden (0047); operationele rechten voor stilstand en ploegoverdracht (0048).
- MES: voorspelling toekomstige keuringen uit basisfunctionaliteit verwijderd (D96); #88 terug op roadmap fase 10.
- MES: productgebonden registratie- en keuringsleesrechten en aparte bevoegdheid voor kwaliteitsbesluit (0046).
- MES: concrete beheertoegang op basis van actuele databasegrants; technische en engineeringtaken gescheiden (0044).
- MES: rollenregister en expliciete fictieve demo-bootstrap (0043, D95); geen automatische migratie van bestaande bevoegdheden.
- MES: operatoridentiteit leest geen wachtwoordhash meer; bestaande API-rolcontroles toetsen actuele accountstatus (0042).
- MES: gecontroleerde intrekking met auditspoor en onveranderlijke autorisatiebesluiten (0041); eigenaar-only, acceptatie nog open.
- MES: afscherming wachtwoordhashes (0040) en verplichte integrale testreview vóór faseacceptatie.
- MES: bescherming security-accounts tegen directe app-wijzigingen en eigenaar-only besluitgebonden wachtwoordherbevestiging (0039); gecontroleerd herstel en API-integratie nog open.
- MES: eigenaar-only aanvraag- en vierogenbesluit voor roltoekenning (0038); persoonlijke herbevestiging en aansluiting nog open.
- D94: onzekere offline herkomst heeft eigen beoordelingsstatus en geen verwijderknop; persoonlijke sessie vastgezet bij verzending. Database-regressies en stilstandtest aangepast, geweigerde invoer blijft gelogd onder geauthenticeerde identiteit.
- MES D94: eerdere pc-login geeft geen invoerrecht namens een ander; lokale acties met onzekere herkomst worden bewaard voor beoordeling. Persoonlijke testaccounts C en D toegevoegd. Offline acceptatie nog open.
- MES: gedeelde operatorlogins en naamkeuze geblokkeerd in API en invoerscherm; test- en offline-migratie nog in uitvoering (D93).
- MES #107: Excel-import en sjabloon voor gebruikersaccounts verwijderd (D92); persoonlijk accountbeheer en tijdelijke wachtwoorden behouden.
- MES #107–#108 (deel): migratie 0036 voegt rollen, rechten, scopes, kwalificaties en een legacy-rolmomentopname toe; databasebeslissing en directe schrijfbeperkingen. Oude autorisatie nog actief; integratie en tests volgen.
- MES #106: standaard beperkte databasegebruiker `mes_app` in rechten, CI en serverinstellingen; bestaande login tijdelijk compatibel (D91).
- MES #107–#108 (deel): afzonderlijke autorisatiebeslismodule met negatieve unit-tests; nog niet aangesloten op API of database.
- MES: API-titel en eenvoudige startpagina geharmoniseerd; werkafspraken voor concept-PRs verduidelijkt (D90).
- Schermtest: lopende stilstand vergelijken met de database in plaats van vaste PS7; rangorde en percentage op de dashboardtegel controleren.
- CI: gebundelde faseacceptatie, selectieve Node 22 op concept-PRs en beide suites op acceptatieverzoek (D90).
- Schermtest beschikbaarheid: vergelijk laagste stap met actuele tabel in plaats van vaste PS7; overige stilstandcontroles blijven behouden.
- MES: zichtbare applicatienaam, Production Execution en Manufacturing Operations; bestaande routes, opslag en rechten blijven gelijk. Eerste deel van #106, modulestructuur nog open. Repository heet Manufacturing-Execution-System.
- CI: acht expliciete MES-ontwerpdocumenten vallen onder de documentatie-uitzondering; gemengde wijzigingen blijven softwarewijzigingen.
- CI: hergebruik van exact geteste inhoud en releases uitsluitend op aanvraag (D88).

## 0.62.1 — 24 november 2026
- Browserdemo: datumvelden van dezelfde tabel worden tegelijk verschoven bij het opstarten. Capaciteitsperiodes blijven daardoor geldig; de bestaande databaseregels zijn ongewijzigd.
- Gerichte regressietests voor datumverschuiving in beide richtingen, inclusief perioden met een duur van nul of 366 dagen.
- CI: gefaseerde Node 22/26-controles, documentatie-uitzondering en betere schermtestdiagnostiek (D87).

## 0.62.0 — 23 november 2026 · #100
- **Plaatje van de database** in [`docs/DATABASE.md`](docs/DATABASE.md) (#100): een overzicht van alle 43 tabellen en hun verbanden (GitHub tekent het als diagram), een lijst met per tabel de uitleg en waar hij naar verwijst, en per tabel de kolommen.
  - Automatisch gemaakt uit `db/schema.sql` met `tools/schema_plaatje.py`, dus altijd gelijk aan de echte database.
  - Nieuwe test `tests/test_schema_plaatje.sh` (ook op GitHub): faalt als het plaatje niet meer bij `schema.sql` past.
- Geen wijziging in de schermen of de database.

## 0.61.0 — 23 november 2026 · #94
- **Sorteren en filteren in elke tabel** van de portalen (#94).
  - **Sorteren:** klik op een kolomkop. Eerst oplopend (▲), dan aflopend (▼), bij de derde klik weer de gewone volgorde. Getallen, datums en tijdsduren sorteren als getal; lege cellen staan altijd onderaan.
  - **Filteren:** bij tabellen met 6 of meer regels staat naast "Naar Excel" een knop **Filteren**. Die opent per kolom een keuzelijst (bij weinig verschillende waarden) of een zoekveld. De knop zegt hoeveel regels je ziet ("Filteren (12 van 40)"); **Filters wissen** zet alles terug.
  - **Naar Excel** neemt de gesorteerde en gefilterde regels mee: je krijgt wat je ziet.
  - Werkt in alle schermen met de gedeelde tabel; op een telefoon (tabel als kaartjes) kan filteren wel, sorteren niet.

## 0.60.0 — 23 november 2026 · #93 #95 #96
- **Productkeuze in de filterbalk** (#93). Het product kies je niet meer in het menu, maar naast Periode en Groeperen, in een geel vak; met één product gekozen is het geel voller. Het **lotpaspoort** heeft de keuze ook: dan staan alleen de lots van dat product in de lijst, met een kolom Product.
- **Schermbreedte** (#95). Tabellen en grafieken gebruiken de hele breedte van het scherm; tekst blijft smal zodat hij leesbaar is. Een grafiek wordt niet hoger dan het scherm.
- **Stappen en velden: eerst het product kiezen** (#96).
  - Bovenaan staat een productkeuze (geel). Kies je een product, dan zie je alleen de stappen van dat product en per veld zijn grenzen voor dat product, met "eigen" als het eigen grenzen heeft. De knop **Grenzen** past ze aan. De knop "Per product" bij elk veld is weg.
  - Zonder product zie je de grenzen van het veld zelf, en bij het veld welke producten eigen grenzen hebben.
  - Grenzen staan in twee kolommen: **Ondergrens** en **Bovengrens**.
  - Het blok van de gekozen stap heeft een vaste opbouw: de knoppen staan bij elke stap op dezelfde plek, en de tabel past zonder schuiven op een laptop. "Wie meet" staat er alleen bij als Kwaliteit meet; "niet verplicht" en "op het certificaat" staan onder de naam.
- API: `/lots` kan filteren op `product` en geeft het product van elk lot terug (oudere invoerschermen merken niets, D18).

## 0.59.0 — 23 november 2026 · #48 #97 #98 #99
- **Dagoverzicht en Batchroute blijven allebei** (#48, D74). "(proef)" staat niet meer in het menu en de proefmelding is weg.
- **Naar een dag springen:** in Stappen plannen en het Dagoverzicht staat naast Vorige dag, Vandaag en Volgende dag een datumveld met kalender (#97).
- **Ploegoverdracht: welke afwijkingen.** Per dienst staat er niet alleen hoeveel afwijkingen er waren, maar ook welke (#98).
  - In Productieanalyse: tijd, batch of lot, stap en veld, gemeten waarde, grenzen en buiten tolerantie of buiten grens. Bij vijf of minder staat het meteen open.
  - In het invoerscherm (Overdracht): dezelfde lijst, kort.
  - Hoogstens de nieuwste 50 per dienst.
- **Doorlooptijden:** de tabel per week heeft twee kolommen erbij (#99).
  - **Wachten op het lot:** hoe lang batches na hun laatste batchstap wachten tot het lot wordt samengesteld.
  - **Totaal per lot:** van de eerste batch tot het lot gereed is.
  - Onder de tabel staat waarom het totaal niet de som van de andere kolommen is: het zijn medianen, en de wachttijd zat er eerder niet in.
- API: `afwijkingen` in de samenvatting van een dienst; `wacht_op_lot_uren_mediaan` en `totaal_uren_mediaan` in `/analyse/doorlooptijden`.

## 0.58.0 — 23 november 2026 · #91
- **Wandscherm past altijd zonder scrollen** (ook het wandscherm Kwaliteit, D81).
  - Het aantal kolommen volgt de verhouding van het scherm. Bij alle 21 stappen op een tv zijn dat er 6.
  - Alle kaarten zijn even hoog en vullen samen het scherm.
  - Past het niet, dan wordt de tekst eerst iets kleiner (tot 70 %). Daarna staan er minder regels per kaart, met "+ n meer".
  - Er komt nooit een scrollbalk: op een tv kan niemand scrollen. Na het draaien van het scherm of een ander formaat past het zich weer aan.
  - De kop (titel, cijfers, klok) blijft op een tv en een liggend scherm één regel.
- **Afmelden op het wandscherm:** een schermaccount heeft rechtsonder een kleine knop Afmelden. Eerder kwam je er niet meer uit: elk adres van de server ging terug naar het wandscherm.
- Een stap met een stilstand toont niet meer ook "Niets te doen".

## 0.57.0 — 23 november 2026 · #90
- **Capaciteit in kilogram** (Planning → Capaciteit, D80). Per product en stap staat de capaciteit nu in kg, niet meer in batches.
  - Per uur, per dag en per maand staan naast elkaar. Je vult er één in en de andere twee worden berekend: met de productie-uren per dag (de diensten samen, nu 24) en gemiddeld 30,4 dagen per maand.
  - **Gewicht per batch** per product, voor de pilot een vast gewicht. Een lot weegt 4 batches. Daarmee staat erbij hoeveel batches of lots per dag passen ("≈ 5 batches"). Zonder gewicht staat het product op "nog invullen".
  - De planning (Batches plannen, Stappen plannen, de waarschuwing bij te vol) rekent zoals voorheen in batches en lots, nu berekend uit de kilogrammen.
  - Een oude regel in batches blijft gelden. Je ziet hem als "8 batches (oud, vul in in kg)" tot je hem in kg invult.
- Fictieve inrichting: 410 kg per batch (een lot 1640 kg); de capaciteit is omgerekend (PS1 3280 kg per dag voor PRD-A en PRD-C, 1230 kg voor PRD-B; PS9 2460 kg; PS16 3280 kg).
- API: `batchgewicht_kg` bij producten; `PUT /planning/capaciteit/stappen/{stap}` met `kg` en `per` (uur, dag, maand); `GET /planning/capaciteit` geeft `kg_per_dag`, `gewicht`, `uren_per_dag` en `dagen_per_maand`. `max_per_dag` werkt nog voor oudere schermen.

## 0.56.0 — 23 november 2026 · #89
- **Trend per veld bij "Alle producten"** (Portaal Kwaliteit, D79). Eerder trok de grafiek de grenzen van het veld, terwijl elk punt gekleurd was naar de grenzen van zijn eigen product. Zo kon een punt "binnen grenzen" boven de grenslijn staan.
  - Hebben de metingen in de grafiek producten met verschillende grenzen of tolerantie, dan staan er geen grens-, tolerantie- en instellingslijnen meer.
  - Elk punt houdt de kleur van zijn eigen grenzen. Als je erop wijst, staan zijn product en grenzen erbij.
  - Onder de grafiek staat waarom, en dat je bovenin een product kunt kiezen.
- **Met één product** (of als alle producten dezelfde grenzen hebben) volgen de lijnen nu de grenzen waaraan elke meting werkelijk is getoetst, als traplijn door de tijd. Een grens die is gewijzigd, verspringt dus op het moment van de wijziging, net als de tolerantie (D70).
- Een veld met een specificatie per product (keuringen, D73) telt ook als "grenzen per product".
- API: elk punt van `/analyse/trend` heeft zijn `grens_min`, `grens_max`, `tolerantie`, `tolerantie_soort` en `product`.

## 0.55.0 — 23 november 2026 · #88
- **Eigen startscherm voor Kwaliteit** in het invoerscherm (lab-pc), met de titel **Keuringen** (D78). Geen aantallen per processtap meer; wel drie blokken.
  - **Nu te doen:** wat op een meting of besluit van Kwaliteit wacht (Meten), en batches of lots die klaarstaan voor een tussen- of eindkeuring (Keuring starten).
  - **Verwacht:** per dag (vandaag, morgen) welke keuringen (TK, EK) en metingen van Kwaliteit in een processtap eraan komen. Bij elke regel staan de batch of het lot, het product, waar hij nu is ("nu in PS1, nog 2 stappen"), een geschatte tijd ("rond 21:00") en de dag als hij in Stappen plannen staat.
  - **Keuringsstappen:** de tegels TK1, TK2 en EK, met hoeveel er klaarstaan.
- **Schatting:** vanaf de stap waar de batch of het lot nu is, telt het systeem per stap de gewone wachttijd en duur op (mediaan van de laatste 90 dagen; zonder historie 30 en 60 minuten). Kijkt twee dagen vooruit.
- Batches die op Kwaliteit wachten, in beoordeling staan of een open herbewerking hebben, staan niet bij Verwacht; die staan al bij Nu te doen of liggen stil.
- API: `GET /keuringen/verwacht?uren=48`.
- Het stappenoverzicht voor operators en ploegleiders is ongewijzigd.

## 0.54.0 — 23 november 2026 · #87
- **Medewerkers** (Beheer): de schermen Accounts en Operators zijn samen één scherm, met drie blokken (D77).
  - **Operators en ploegleiders:** iedereen die op de vloer invoert, met naam, ploeg en account.
  - **Kwaliteit:** de kwaliteitsmedewerkers, ook met naam, ploeg en account.
  - **Overige accounts:** kantoor, beheer, wandschermen en het oude gedeelde account.
- **Ploeg per medewerker:** elke operator, ploegleider of kwaliteitsmedewerker kan in een ploeg (A1 … E2: letter en divisie, D76). Kies hem bij Medewerker toevoegen of bij Wijzigen. "Geen ploeg" kan ook, bijvoorbeeld voor iemand in dagdienst.
- Per persoon één regel en één set knoppen: Wijzigen (naam en ploeg), Wachtwoord, Rol, Uitzetten.
  - Uitzetten zet het account en de naam samen uit.
  - Een naam zonder account krijgt er een met "Account geven"; de geschiedenis blijft op dezelfde naam.
- Medewerker toevoegen vraagt naam, rol, ploeg, gebruikersnaam en een tijdelijk wachtwoord in één venster. Ook iemand van Kwaliteit kan meteen een eigen naam krijgen.
- **Sjabloon:** de kolom **Ploeg** is erbij (leeg = niets wijzigen). Een onbekende ploeg, of een ploeg bij een rol zonder invoer, is een fout in de controle.
- Oude adressen (`#/beheer/accounts`, `#/beheer/operators`) openen Medewerkers.
- Fictieve indeling: Operator A tot en met E in A1 tot en met E1, Operator F, G en H in A2, B2 en C2.
- API: `ploeg` bij `/beheer/gebruikers` (lezen, aanmaken, wijzigen, sjabloon) en bij `/beheer/operators`; daar ook `rol`.

## 0.53.0 — 23 november 2026 · #86
- **Ploegen A tot en met E in twee divisies, met een rooster** (D76).
  - Nieuw scherm Beheer → **Diensten en ploegen** (was Ploegen). Daarin vier blokken.
  - **Diensten:** ochtend, middag en nacht, met hun tijden (wat eerder "ploegen" heette).
  - **Rooster:** de cyclus dag voor dag. Standaard 2 ochtend, 2 middag, 2 nacht en 4 dagen vrij.
  - **Ploegen:** A1 tot en met E2, elk met de eerste dag van zijn cyclus. Die dag schuif je op om een ploeg eerder of later te laten beginnen. Een ploeg kun je uitzetten of toevoegen.
  - **Komende 14 dagen:** per dag en dienst welke ploegen werken, zodat je meteen ziet of het rooster klopt. Een dienst zonder ploeg krijgt een ⚠.
  - De fictieve indeling: per divisie draait elke dienst precies één ploeg. Divisie 1 en 2 werken tegelijk, dus er zijn altijd twee ploegen aan het werk.
- **Ploegoverdracht:** in het invoerscherm en in Productieanalyse staat bij een dienst welke ploegen hem volgens het rooster draaiden, bijvoorbeeld "ploegen A1 en A2".
- De tijdvakken heten in de schermen nu **diensten** (Ochtenddienst, Middagdienst, Nachtdienst); "ploeg" is voortaan A tot en met E.
- API: `GET /overdracht/rooster`, `PATCH /overdracht/rooster`, `POST /overdracht/rooster/ploegen`, `PATCH /overdracht/rooster/ploegen/{code}`; de samenvatting van een dienst heeft `ploegen`.
- Operators aan een ploeg en divisie toewijzen volgt in #87 (Medewerkers).
- **Oudere invoerschermen:** werken gewoon; ze tonen de ploegen niet.

## 0.52.0 — 23 november 2026 · #85
- **Twee keer ingevuld:** vullen twee mensen hetzelfde veld of dezelfde grondstof van een stap in (op twee pc's tegelijk, of later uit een offline wachtrij), dan weigerde de server de tweede invoer. Nu blijft de eerste staan en wordt de tweede bewaard als conflict (D75).
  - In het invoerscherm staat bij het veld "Twee keer ingevuld": wat er staat en wat er ook is ingevuld, door wie en wanneer. Bovenaan de stap staat welke velden het zijn.
  - Een ploegleider kiest met één knop welke blijft ("… laten staan" of "… nemen"), met een toelichting als hij wil. Kiest hij de tweede, dan is dat een gewone correctie; het origineel blijft bewaard en de reden noemt wie de gekozen waarde invulde.
  - Een veld dat Kwaliteit meet: Kwaliteit kiest (op de lab-pc). De beheerder kan altijd kiezen.
  - Er komt een melding voor wie mag kiezen, met "Bekijken" naar de batch of het lot.
  - Dezelfde waarde nog eens invoeren is geen conflict, en opnieuw versturen uit de wachtrij maakt er geen tweede.
  - Afronden kan gewoon; een conflict los je ook achteraf op.
- **Corrigeren door twee ploegleiders tegelijk:** wie corrigeert op basis van een waarde die een ander intussen al heeft gecorrigeerd, krijgt "Dit is intussen door iemand anders gewijzigd; bekijk de stap opnieuw". Eerder overschreef de tweede correctie de eerste zonder dat iemand het merkte.
- **Keuring:** beslissen twee mensen van Kwaliteit over dezelfde keuring, dan telt (zoals al) het eerste besluit; de tweede ziet nu door wie en wat er besloten is.
- API: `GET /conflicten` en `POST /conflicten/{id}/oplossen`; een stap heeft `conflicten`; een correctie kan `vervangt` meesturen. `api/openapi.json` is weer bij (stond nog op 0.23.0).
- **Oudere invoerschermen:** werken gewoon. Ze tonen het conflict niet, maar het wordt wel bewaard en gemeld.

## Zonder nieuwe versie (na 0.51.1)
- Roadmap: nieuwe fase A4 met Geerts verbeterlijst van 23 november (#85–#91 en #93–#100 vóór de pilot; #92, #101 en #102 in fase F). #48 is besloten: Dagoverzicht en Batchroute blijven allebei. Keuzes in D74. Het volgende vrije nummer is #103.

## 0.51.1 — 23 november 2026
- Invoerscherm: na "Keuring starten" ververst het scherm zodra de start bij de server is, zodat Kwaliteit meteen kan meten en beslissen. Dat gebeurt alleen bij een keuring en alleen zolang er nog niets is ingetypt. In 0.51.0 gebeurde het bij elke nieuwe stap, en verdween wat een operator net typte.
- Schermtest pilotoverzicht wacht nu tot de tabel bij de gekozen periode hoort, in plaats van een vaste wachttijd.

## 0.51.0 — 23 november 2026 · #80
- **Keuringsstappen:** tussenkeuringen (TK1, TK2, …) en de eindkeuring (EK) zijn eigen stappen in de route van een product, bijvoorbeeld PS1 – PS2 – PS3 – TK1 – PS4 – … – EK (D73).
  - Alleen Kwaliteit start een keuring, op de lab-pc. In het invoerscherm staan de keuringen voor Kwaliteit als eigen groep "Keuringen"; operators zien ze niet.
  - Met "Keuring starten" is de stap meteen klaar voor de metingen: daarna vrijgeven, herbewerken of afkeuren, zoals al bij metingen van Kwaliteit (D58). Pas na vrijgeven gaat de batch of het lot verder.
  - Kwaliteitsvelden in een gewone processtap (bijvoorbeeld een temperatuur) blijven gewoon bestaan.
  - Keuringsstappen horen bij een product: de standaardroute heeft ze niet. Bij Planning → Producten → Route wijzigen staan ze onder "Niet in de route", om toe te voegen.
  - Een keuring voer je niet na van papier en heeft geen leeg formulier.
- **Specificaties** (nieuw in het portaal Kwaliteit): per product en keuringsstap waar het product aan moet voldoen, met versies.
  - Nieuwe versie: begint als concept met de grenzen van de geldige versie. Pas de grenzen aan en kies Vaststellen; de vorige versie vervalt.
  - Elke meting in een keuring bewaart de versie waaraan hij getoetst is. Het certificaat toont "Getoetst aan: specificatie … versie …", met de grenzen van die versie.
  - Alleen Kwaliteit en de beheerder beheren specificaties; een vastgestelde versie verandert nooit meer.
- Fictieve inrichting: TK1, TK2 en EK in de route van PRD-C, met een vastgestelde specificatie (versie 1).
- Lijsten met alle stappen (wandscherm, werkvoorraad, dagoverzicht) tonen nu 21 stappen: 18 processtappen en 3 keuringen.
- **Let op:** werk de lab-pc bij voordat er keuringsstappen in een echte route komen. Een ouder invoerscherm kent ze niet. Andere pc's merken er niets van.

## 0.50.0 — 23 november 2026 · #83
- Nieuw: **wandscherm Kwaliteit**, voor een tv in het lab (`#/wandscherm/kwaliteit`, of de link "Kwaliteit" onderin het wandscherm).
  - **Wacht op Kwaliteit:** stappen die op een meting of besluit van Kwaliteit wachten, en batches in beoordeling, oudste eerst. Met hoe lang al, hoeveel er nog te meten is en de reden van de beoordeling. Een gele rand als het langer duurt dan bij 90 % van de keuringen in de laatste 30 dagen.
  - **Afwijkingen vandaag:** metingen buiten tolerantie (▲, oranje) of buiten grens (◆, rood), nieuwste eerst, met batch, veld en waarde.
  - **Kerncijfers van vandaag:** hoeveel er wacht, vrijgegeven / herbewerken / afgekeurd, en welk deel van de metingen binnen de grenzen viel.
- Een tv met een schermaccount onthoudt ook deze keuze. Ververst zich elke 30 seconden, zoals het gewone wandscherm.
- Het invoerscherm merkt er niets van.

## 0.49.0 — 23 november 2026 · #81
- Planning → Capaciteit: **elke stap uit de route van een product staat er vanzelf**, per product in de volgorde van de route (D71).
  - Een stap zonder capaciteit staat op **"Nog invullen"**, met een melding bovenaan en een teller in het menu. Er wordt niets meer geschat.
  - Met **Invullen voor PRD-A** (enzovoort) vul je alle open stappen van een product in één keer in; wat leeg blijft, blijft op "nog invullen".
  - Verandert de route van een product, dan verandert de lijst vanzelf mee.
- De regel "voor alle producten" vervalt. Bestaande regels zijn omgezet naar een regel per product, voor de producten met die stap in hun route.
- Stappen plannen, het Dagoverzicht en Batches plannen tonen "capaciteit nog invullen" bij een product zonder capaciteit, ook als er voor die stap verder niets is ingevuld.
- Niemand hoeft iets te doen; het invoerscherm merkt er niets van.

## 0.48.2 — 23 november 2026 · #82
- **Afmelden landt altijd op de startpagina**, ook in het invoerscherm. Daar logt de volgende persoon in; een operator gaat dan meteen door naar het invoerscherm, Kwaliteit en een ploegleider kiezen zelf.
- Zonder verbinding blijft het invoerscherm na het afmelden staan, met zijn eigen inlog: de startpagina laadt dan niet, en wat nog in de wachtrij staat blijft zichtbaar en gaat later mee.

## 0.48.1 — 23 november 2026
- Grafieken in het portaal Kwaliteit: **grenzen en tolerantie zijn beter te zien** (D70).
  - Trend per veld: de grenzen zijn een **rode doorgetrokken lijn** en de tolerantie twee **oranje gestreepte lijnen**, in plaats van een lichtblauwe schaduw die op wit nauwelijks opviel. De instelling blijft een dunne grijze stippellijn. De legenda toont nu ook de lijnen.
  - De tolerantielijnen volgen de instelling van elke meting: verandert de instelling, dan verspringen ze mee. Eerder gold de laatste instelling voor de hele periode, zodat oudere metingen soms buiten de schaduw vielen terwijl ze goed waren (of andersom).
  - Regelkaart: de specificatiegrenzen zijn ook een rode doorgetrokken lijn (was rood gestippeld en half doorzichtig). De regelgrenzen blijven grijs gestreept; die zeggen of het proces stabiel loopt, niet of het product goed is.
- Oudere invoerschermen merken er niets van.

## 0.48.0 — 23 november 2026
- Planning → Capaciteit gaat nu helemaal **per stap en product** (D69). Elke dag van de week geldt dezelfde capaciteit.
  - Het blok **Per weekdag** (één aantal batches per dag voor de hele fabriek) is weg. Hoeveel batches van een product per dag kunnen starten, volgt uit de capaciteit van de eerste stap van zijn route.
  - **Afwijkende dagen** gelden nu voor alle producten of één product, en voor alle stappen of één stap, als percentage van de gewone capaciteit: 0 % = geen productie, 50 % = de helft. Ook voor meer dagen achter elkaar (van … tot en met). Gelden er op een dag meer afwijkingen, dan telt het laagste percentage.
- Batches plannen: per dag per product hoeveel batches er starten tegen wat de eerste stap aankan (bijvoorbeeld "PRD-A 5 / 8", of "dicht" op een dag zonder productie), met de afwijkingen van die dag. Bovenaan de ruimte per product voor de rest van de week.
- De waarschuwing bij het plannen gaat over het product: "PRD-A heeft op … al 5 van de 8 batches" of "PRD-B wordt op … niet gemaakt (onderhoud lijn 2)". Plannen mag nog steeds.
- Stappen plannen en het Dagoverzicht rekenen de afwijkende dagen mee en melden een stap die dicht is.
- Bestaande afwijkende dagen worden overgenomen voor alle producten en stappen (een dag met 0 batches wordt "geen productie"; anders het deel van de weekdag). De instelling per weekdag vervalt. Niemand hoeft iets te doen; het invoerscherm merkt er niets van.
- Laptoppakket: verse testdata, en bij het opstarten schuiven de datums van één regel tegelijk mee.

## 0.47.2 — 23 november 2026
- Planning: andere namen in het menu, zodat je meteen ziet wat je er doet (D68).
  - "Per week" heet nu **Batches plannen**: nieuwe batches aanmaken, met hun startdag en product.
  - "Per stap" heet nu **Stappen plannen**: per dag en stap vastleggen welke batches of lots aan de beurt zijn.
  - De knoppen en verwijzingen in de andere schermen en de hulp gebruiken dezelfde namen.

## 0.47.1 — 23 november 2026
- Planning → Per week: de dagen staan nu **onder elkaar** (maandag bovenaan, zondag onderaan), niet meer naast elkaar. Op elk schermformaat hetzelfde.

## 0.47.0 — 22 november 2026 · #77
- Nieuw: **pilotoverzicht** (Beheer → Pilotoverzicht; de productiemanager ziet het bij Productieanalyse). Voor de wekelijkse controle en de evaluatie na 8 weken:
  - Kerncijfers: stappen afgerond, hoeveel invoer op tijd op de server was, stappen van papier, geweigerde invoer en opmerkingen.
  - Per dag, per pc, en de dagen waarop een pc iets bijzonders had: hoeveel er is ingevoerd, hoe lang invoer onderweg was (meestal: de pc was offline), hoe vaak later dan de grens, van papier, geweigerd en gemeld.
  - Per veld: hoe vaak een veld van de operator leeg bleef en hoe vaak het is gecorrigeerd.
  - Geweigerde invoer met de reden, de laatste 100.
  - Periode zelf te kiezen; standaard sinds de start van de pilot (of de laatste 7 dagen). Alles naar Excel.
- De beheerder stelt de startdatum van de pilot in en vanaf hoeveel minuten invoer "te laat" is (standaard 15).
- Nieuw vastgelegd: invoer van een pc die de server weigert (wanneer, welke pc, wie, welke stap, de reden). De back-up en het opstarten van de laptop ruimen dat na 90 dagen op, net als de inlogpogingen.
- Oudere invoerschermen merken er niets van.

## 0.46.0 — 22 november 2026 · #31
- Nieuw: **notitie bij het einde van een stilstand.** Bij "Stilstand beëindigen" vraagt het invoerscherm kort wat het was en wat er is gedaan (bijvoorbeeld "band gebroken, nieuwe band gelegd"). De notitie mag leeg blijven, zodat beëindigen snel gaat; ze werkt ook zonder verbinding.
- Productieanalyse → Stilstand: in "Laatste 50 keer stilstand" staan nu ook "Wat er is gedaan" en wie de stilstand beëindigde. Ook in de Excel-export.
- De notitie ligt vast zodra de stilstand is beëindigd (regel in de database), en is hoogstens 500 tekens.
- Oudere invoerschermen blijven werken: zij beëindigen een stilstand zoals voorheen, zonder notitie.
- Hulp voor de operator noemt de notitie.

## Zonder nieuwe versie (na 0.45.1)
- Roadmap bijgewerkt naar 0.47.0 (D67): kopregel, fase A3 (#31 en #77 gebouwd, open: #32 en #66) en de tijdlijn; het volgende vrije nummer is #80.
- Nieuwe test `tests/test_roadmap.sh`, ook op GitHub: de tests worden rood als de roadmap niet bij is met de laatste versie (kopregel, gebouwde punten nog open, volgende vrije nummer, dubbele punt in de tijdlijn). De roadmap wordt voortaan bij elke wijziging bijgewerkt, niet alleen aan het eind van een sessie.
- Roadmap: de tijdlijn "In één oogopslag" was op GitHub niet te zien. Een dubbele punt in de naam "Poort naar de pilot (datum: 70)" brak de grafiek; die is weggehaald.
- Tests rond middernacht: de testdata plant voor de dag in Amsterdam, ook als de tests op een server in UTC draaien (tussen 00:00 en 01:00 klopte "vandaag" anders niet). De API-test van de ploegoverdracht houdt rekening met de nachtploeg van gisteren (00:00–06:00). De regelkaarttest accepteert een Cpk met één decimaal ("1,2").

## 0.45.1 — 21 november 2026
- Opgelost: het wandscherm kon op een liggende tablet net iets breder worden dan het scherm, als een stapnaam en de teller niet naast elkaar pasten. De teller gaat dan naar de volgende regel. Op de tv verandert niets.
- Bij 0.45.0 faalde daardoor de nieuwe schermtest in zes formaten op GitHub. De release van 0.45.0 is later toch gemaakt; neem 0.45.1.

## 0.45.0 — 21 november 2026 · #47
- Afgerond: **alle schermen werken op telefoon en tablet**, staand en liggend (#47, D64; samen met 0.43.0 en 0.44.0).
  - Stappen en velden (Beheer) en Per stap (Planning): op een telefoon staat een keuzelijst met de stappen in plaats van de lange lijst links.
  - Batch- en lotnummers breken nergens meer af bij het streepje, in het invoerscherm en in de portalen.
  - Tablet staand: geen lege donkere strook meer onder het menu op korte pagina's.
- Nieuwe schermtest: alle 44 portaalpagina's en 8 schermen van het invoerscherm in zes formaten (telefoon staand en liggend, tablet staand en liggend, laptop, pc). De test controleert dat niets breder is dan het scherm, dat tabellen op een telefoon kaartjes zijn en dat de navigatie op de goede plek staat. Hij draait ook op GitHub.
- Praktijktests: A6 (telefoon) en A7 (tablet) toegevoegd.

## 0.44.0 — 21 november 2026
- Nieuw: **de portalen werken op een telefoon en een tablet**, staand en liggend (tweede deel van #47, D64).
  - Telefoon: tabellen worden kaartjes. Elke regel is een kaart met de kolomnaam voor elke waarde, zodat je niet opzij hoeft te schuiven. Batchroute en Dagoverzicht blijven een raster dat opzij schuift.
  - Het geopende menu bedekt op een telefoon het hele scherm; de knop "Menu sluiten" staat bovenaan.
  - Titel, uitleg, filters en knoppen staan onder elkaar; de kerncijfers staan twee naast elkaar.
  - Grafieken worden niet kleiner dan leesbaar; op een telefoon schuif je ze opzij.
  - Certificaat en lege formulieren blijven een A4 en schuiven opzij; afdrukken is ongewijzigd.
  - Het wandscherm toont op een telefoon twee stappen naast elkaar (het blijft bedoeld voor de tv).
  - Capaciteit per weekdag: de zeven vakjes lopen door over meerdere regels.
  - Meldingen onderaan het scherm krijgen op een telefoon de volle breedte.
  - Tablet: ruimere zijmarge; Stappen en velden en de startpagina passen nu ook staand.
  - Telefoon liggend: het menu scrolt mee weg.
- Op een pc verandert er niets.

## 0.43.0 — 21 november 2026
- Nieuw: **het invoerscherm werkt op een telefoon en een tablet**, staand en liggend (eerste deel van #47, D64).
  - Telefoon staand: bovenaan alleen de pc, je naam en de verbinding. De knoppen Stappen, Zoeken, Overdracht (en Meldingen voor de ploegleider) staan onderaan, binnen bereik van je duim. Onder "Meer" staan Hulp, Iets melden, Portalen en Afmelden.
  - Opslaan en Stap afronden blijven onderaan in beeld, boven de navigatie, ook als je naar beneden scrolt.
  - Telefoon liggend: de balk bovenaan is compacter en scrolt mee weg, zodat er hoogte overblijft voor de invoer.
  - Tablet: ruimere zijmarge; verder zoals op de pc.
  - Rekening gehouden met de notch en de thuisbalk van een telefoon.
  - Batchnummers in een lotvoorstel breken niet meer af bij het streepje.
- Pc's merken er niets van: op een breed scherm is het invoerscherm hetzelfde als in 0.42.1.

## 0.42.1 — 21 november 2026
- Verbeterd: **alle schermen nagelopen op vormgeving**, zodat ze er overal hetzelfde uitzien.
  - "Naar Excel" staat nu altijd rechts in de kopregel van het blok (of van de pagina), naast de andere knoppen. Geen losse regel meer met alleen die knop.
  - De paginatitel staat op elke pagina op dezelfde hoogte; knoppen en filters staan rechts ernaast op één regel en schuiven niet meer onder de uitleg (Accounts).
  - Knopteksten breken niet meer over twee regels ("Per product"). In een smalle tabel gaan knoppen netjes onder elkaar in plaats van half buiten beeld (Stappen en velden).
  - Korte waarden in tabellen (datum, batchnummer, grenzen) breken niet meer midden in het nummer; lange tekst zoals een reden wel. Tabellen hebben iets minder ruimte tussen de kolommen, zodat Afwijkingen weer in één keer past.
  - Brede tabellen (Batchroute, Stappen en velden) schuiven binnen hun eigen vak opzij; de pagina zelf wordt niet meer breder dan het scherm.
  - De tegels op de startpagina zijn even hoog.
  - Hulp: de titel staat bovenaan, met de rolkeuze en Afdrukken rechts ernaast (portalen en invoerscherm).
  - Wachtwoord wijzigen vanuit het menu is een gewone pagina met de titel op de vaste plek.
  - Invoerscherm, Overdracht: de tekstvakken zijn weer zo breed als het formulier (sinds 0.42.0 waren ze smal).
  - Productie per week heeft een korte uitleg onder de titel, zoals de andere analyses.
  - Logboek: ook wijzigingen aan producten, routes, grenzen per product, grondstoffen, capaciteit, ploegen, stilstandoorzaken en instellingen hebben een leesbare naam (eerst stond er bijvoorbeeld "capaciteit_dag"), en zijn te kiezen in het filter.

## 0.42.0 — 21 november 2026 · #78
- Nieuw: **"Iets melden"** (#78). In het invoerscherm staat de knop in de balk, in de portalen onderaan het menu. Je typt kort wat er misgaat of wat beter kan; je naam, de tijd, de pc en de stap of het scherm gaan vanzelf mee. In het invoerscherm werkt het ook zonder verbinding: de melding gaat via de wachtrij mee zodra er weer verbinding is.
- Nieuw: **Beheer → Opmerkingen**, met een teller in het menu. De beheerder ziet wat er gemeld is, nieuwste eerst, en handelt het af met een notitie (bijvoorbeeld het roadmapnummer). Met "Ook afgehandelde" zie je alles terug. Naar Excel kan.
- De hulp noemt "Iets melden" onderaan elke rol, en de beheerder krijgt uitleg over Opmerkingen.
- Database: migratie 0026 (tabel `terugmelding`, functies `meld_iets` en `handel_terugmelding_af`); geen stilstand nodig, oudere invoerschermen merken er niets van.

## 0.41.0 — 21 november 2026 · #76
- Nieuw: **accounts in één keer aanmaken** (#76). Bij Beheer → Accounts: Sjabloon downloaden, in Excel aanvullen (gebruikersnaam, rol, naam bij de invoer, tijdelijk wachtwoord, actief), Sjabloon inlezen. Je ziet eerst een controle per regel; opslaan kan pas als geen enkele regel een fout heeft. Een naam die al in de namenlijst staat, wordt gekoppeld, zodat de geschiedenis doorloopt. In het gedownloade bestand staan nooit wachtwoorden.
- Nieuw: **tijdelijk wachtwoord**. Een wachtwoord dat de beheerder kiest (in het sjabloon, bij Account toevoegen of bij Wachtwoord instellen) is tijdelijk: bij de eerste inlog kiest de gebruiker eerst een eigen wachtwoord, in het invoerscherm en in de portalen. Tot dan kan dat account niets anders. Niet bij een wandscherm (daar typt niemand). Bij Accounts staat "tijdelijk wachtwoord" achter de naam.
- Nieuw: **zelf je wachtwoord wijzigen**, in het menu van de portalen en via Hulp in het invoerscherm (met verbinding).
- Let op: werk de pc's bij naar deze versie vóórdat je accounts met een tijdelijk wachtwoord uitdeelt. Een ouder invoerscherm vraagt niet om een eigen wachtwoord; de server weigert dan alles van dat account (met de melding "Kies eerst een eigen wachtwoord").
- Logboek: ook het nainvoeren van papier is nu leesbaar ("Van papier, … op …: reden"), en het tijdelijk maken van een wachtwoord.
- Database: migratie 0025 (een kolom bij het account en de functie `wijzig_eigen_wachtwoord`); geen stilstand nodig. Bestaande accounts houden hun wachtwoord.

## 0.40.0 — 21 november 2026 · #75
- Nieuw: **Nainvoeren van papier** (#75), voor de ploegleider en de beheerder, als tegel op de startpagina. Lag de invoer stil (server en pc tegelijk), dan registreert de ploeg op papier. Daarna voer je de stap hier in: de stap, het batchnummer (of het lot), de waarden en grondstoffen, wie het deed, op welke pc, het begin en het einde van het papier, en een reden. Dat kan tot 7 dagen terug. Na het opslaan staat de volgende stap van dezelfde batch al klaar.
- De gewone regels gelden: de volgorde van de route, verplichte velden, grenzen en meldingen. Een stap kan niet beginnen vóór het einde van de vorige stap van die batch.
- Ook het **samenstellen van een lot** (stap 16) kan van papier: nieuw lotnummer, de 4 batches en de tijden van toen.
- Zichtbaar: bij de stap in het invoerscherm ("Nageleverd van papier door …"), bij Zoeken ("van papier"), in het lotpaspoort ("(papier)" achter de naam) en in het logboek.
- Nieuw: **lege formulieren** per stap om af te drukken, voor een terugvalmap bij elke pc: één A4 per stap met dezelfde velden, eenheden en grenzen als het scherm (de metingen van Kwaliteit staan er niet op). In de lot-stap: lotnummer en 4 batches.
- Database: migratie 0024 (drie kolommen bij de stapregistratie, een kolom in het lotpaspoort, functie `lever_stap_na`); geen stilstand nodig, oudere invoerschermen merken er niets van.

## 0.39.0 — 21 november 2026 · #55
- Nieuw: **een gestarte stap overnemen** (#55). Bij Bezig staat wie de stap startte en op welke pc; is dat een ander, dan heet de knop "Afmaken". In de stap staat dan "Je maakt de stap af die … startte". Wat jij invult en het afronden staan op jouw naam: het systeem legt nu ook vast **wie afrondde en op welke pc**. Dat staat bij de stap ("afgerond door … op …") en bij Zoeken.
- Verbeterd: start iemand een stap die al open staat (bijvoorbeeld uit de wachtrij van een pc die offline was), dan zegt de melding wie hem startte, op welke pc en wanneer, en dat je hem bij Bezig afmaakt.
- Verbeterd: in het lotpaspoort staat bij een meting wie de waarde invoerde, ook als dat niet wie de stap startte is.
- Database: migratie 0023 (twee kolommen bij de stapregistratie; geen stilstand nodig). Oudere invoerschermen blijven werken: hun afronden komt op naam van wie inlogde op die pc.

## Zonder nieuwe versie (na 0.38.0)
- Roadmap: nieuwe fase A3 "Vóór de pilot" op Geerts verzoek: #55 (stap overnemen), #75 (nainvoeren na papier), #76 (accounts via Excel), #78 ("Iets melden"), #31 (notitie bij einde storing), #77 (pilotoverzicht), #32 ("in één keer goed") en #66 (tijdig signaleren). #31, #32, #55 en #66 kwamen uit fase F. Nieuw voor Geert: #79 (ondernemingsraad en privacy).

## 0.38.0 — 21 november 2026 · #36
- Nieuw: **Hulp per rol** in het invoerscherm en de portalen. In het invoerscherm staat "Hulp" in de balk (en op het inlogscherm) en toont de hulp voor operators, ploegleiders of Kwaliteit; die werkt ook zonder verbinding. In de portalen staat "Hulp" in het menu en op de startpagina, met een keuze uit alle rollen. Met **Afdrukken** komt de hulp van één rol op één A4, om bij de pc te hangen of bij de training te gebruiken.
- Nieuw: **lijst met praktijktests** (`docs/PRAKTIJKTESTS.md`, #33): per test hoe je hem doet en wanneer hij goed is, van de laptop tot de fabrieksserver. De uitkomsten (wie, wanneer, goed of fout) vul je in op het invulblad "Praktijktests – uitkomsten" op claude.ai.
- Het overzicht van testaccounts in de handleiding van het laptoppakket is bijgewerkt (eigen accounts, productiemanager, Kwaliteit op de lab-pc).
- Fictieve testdata: een lot dat vlak voor het einde van de testperiode uit een herbewerking komt, blijft nu op Kwaliteit wachten. De generator brak daar op sommige tijdstippen af.

## 0.37.1 — 21 november 2026
- Verbeterd: het invoerscherm neemt de inlog van **Kwaliteit** uit de portalen alleen over als Kwaliteit op de startpagina zelf de tegel "Invoerscherm" kiest. Daarvoor opende een pc waarop iemand van Kwaliteit in een portaal werkte het invoerscherm ongevraagd als Kwaliteit. Operators en ploegleiders gaan zoals voorheen.
- 0.37.0 heeft geen GitHub Release gekregen: een schermtest van de browserdemo faalde daarop. Deze versie bevat alles van 0.37.0.

## 0.37.0 — 21 november 2026 · #64 #71
- Nieuw: **metingen van Kwaliteit en keuring**. Per veld staat nu wie meet: de operator (Productie) of Kwaliteit. In te stellen bij Beheer → Stappen en velden ("Wie meet") of met de kolom "Gemeten door" in het Excel-sjabloon. In de fictieve testdata meet Kwaliteit het vochtgehalte S18.3.
- Een stap met velden van Kwaliteit: de operator vult zijn eigen velden in en rondt af. Daarna **wacht de batch of het lot op Kwaliteit** en kan nog niet verder. Het invoerscherm laat dat bij de stap zien ("Wacht op Kwaliteit").
- Kwaliteit werkt in het **invoerscherm op de lab-pc** (ook offline): bovenaan staat "Wacht op Kwaliteit", met per batch of lot wat nog gemeten moet worden. Kwaliteit vult de metingen in en kiest dan **Vrijgeven**, **Herbewerken** (terug naar deze of een eerdere stap, met reden) of **Afkeuren** (batch: keurresultaat NOK; lot: geblokkeerd). Vrijgeven kan pas als alle verplichte metingen er zijn. Pas na de vrijgave gaat de batch of het lot naar de volgende stap; na de laatste lotstap is het lot dan gereed.
- Kwaliteit heeft daarvoor nu ook een naam bij de invoer (D53) en een tegel "Invoerscherm" op de startpagina. Een melding voor Kwaliteit zodra iets op een meting wacht.
- Portaal Kwaliteit → Te beoordelen toont ook wat op een meting van Kwaliteit wacht; de teller in het menu telt dat mee.
- Database: migratie 0022 (wie meet per veld, keuring). Bestaande velden blijven "Productie"; er verandert niets tot de beheerder een veld op Kwaliteit zet. Zet een veld pas op Kwaliteit als de pc's de nieuwe versie hebben (het invoerscherm werkt zichzelf bij na herladen): een ouder invoerscherm laat de operator dat veld nog invullen, en die invoer weigert de server dan.
- API: nieuw `/keuringen` (lijst en besluit); `gemeten_door` bij de velden en de registratie, `keuring` bij de registratie. Bestaande aanroepen blijven werken.

## 0.36.0 — 21 november 2026 · #54
- Nieuw: **wandscherm voor één of enkele stappen**. Onderin het wandscherm staat "Stappen kiezen"; vink een of meer stappen aan en je ziet alleen hun planning en werk, op grotere kaarten met meer regels. De cijfers bovenin gaan dan over die stappen: geplande stappen afgerond, bezig en klaar om te starten.
- Het adres kun je op de tv als bladwijzer zetten, bijvoorbeeld `…/portaal/#/wandscherm/stappen/PS3,PS4`. Een tv met een schermaccount onthoudt de keuze, ook na opnieuw inloggen; `#/wandscherm/alle` zet hem terug naar de hele fabriek.
- Het wandscherm telt geplande stappen nu op dezelfde manier als Planning per stap, dus ook met herbewerkingen (#61).
- API: `GET /wandscherm?stappen=PS3,PS4`. Zonder `stappen` blijft alles gelijk.

## 0.35.0 — 21 november 2026 · #61
- Nieuw: **herbewerking met opdracht**, voor een batch (zolang hij niet in een lot zit) en voor een lot. Kwaliteit of de productiemanager besluit: welke batch of welk lot, terug naar welke stap die al gedaan is, en waarom. Dat kan bij de batch, in het lotpaspoort, en bij Te beoordelen als derde keurresultaat **Herbewerken** (alleen Kwaliteit).
- De batch of het lot staat daarna in het invoerscherm klaar in die stap, met het label "Herbewerking" en de reden. De operator start gewoon de stap; daarna doet de batch of het lot alle volgende stappen opnieuw. Andere stappen kunnen pas weer als de herbewerking gestart is. De planner kan de herbewerking inplannen.
- Operators en ploegleiders starten zelf geen herbewerking meer (de knop in het invoerscherm is weg). Een ouder invoerscherm dat nog zo'n herbewerking in de wachtrij heeft, wordt wel geaccepteerd; die staat dan in de lijst als "zonder opdracht gestart".
- **Herbewerkingen en afkeur** toont de lopende herbewerkingen met hun stand: nog te plannen, gepland (met de dag), bezig, klaar, gestopt (batch afgekeurd) of ingetrokken. Een herbewerking die nog niet gestart is, kun je intrekken (met reden). Wordt een batch afgekeurd, dan vervalt zijn open herbewerking.
- Nieuwe melding bij een nieuwe herbewerking, voor de ploegleider, de planner, Kwaliteit en de productiemanager.
- Nieuwe rol **productiemanager** (D57): ziet Productieanalyse, Kwaliteit en Planning, zet batches in beoordeling en maakt herbewerkingen aan; geen invoerscherm en geen keurresultaat. Demo-account `productiemanager1`.
- Database: migratie 0021 (tabel herbewerking, keurresultaat herbewerken). Er hoeft niemand iets te doen.
- API: nieuw `/herbewerkingen` (lijst met stand, aanmaken, intrekken, mogelijke stappen); bij de werkvoorraad per stap het veld `herbewerking`. Bestaande aanroepen blijven werken, ook `POST /lots/{lotnummer}/herbewerking` van oudere invoerschermen.
- Testdata: de herbewerkingen in de natte week hebben nu een opdracht van Kwaliteit; er staan twee lopende herbewerkingen klaar (een nog te plannen, een gepland).

## 0.34.0 — 21 november 2026 · #58
- Nieuw: naast **Periode** staat **Groeperen**: per dag, per week of per maand. Dat geldt voor de grafiek in het Kwaliteit-overzicht (afwijkingen; klik op een dag of maand voor de lijst eronder), voor Productie per week (beide grafieken en de tabel) en voor de tabel onderaan Doorlooptijden. Standaard blijft per week.
- Nieuw: periode **Afgelopen jaar**.
- Dagen, weken of maanden zonder gegevens staan nu ook in de grafiek en de tabel, met nul. Vroeger vielen ze weg, waardoor een stille week niet opviel.
- Doorlooptijden: "stap 1 tot 15" heet nu "eerste tot laatste batchstap", omdat elk product zijn eigen route heeft (D55).
- Schermtest Ploegoverdracht wacht nu op de kop van vandaag; op GitHub keek hij soms nog naar de vorige dag (de testrun van 0.33.0 faalde daardoor; de software zelf was in orde).
- API: de analyses samenvatting, doorlooptijden en productie kennen de parameter `per` (dag, week of maand). Zonder `per` blijft alles per week, zoals het was (D56).

## 0.33.0 — 21 november 2026 · #60 #62
- Nieuw: in **Productie per week** staat onder "Lots gereed per week" nu ook de grafiek **Batches gestart per week**.
- Nieuw: de **Ploegoverdracht** laat bovenaan zien hoeveel van de planning van die dag klaar is, bijvoorbeeld "28 / 32 geplande stappen afgerond, 2 bezig", met een balk. De planning is per dag, niet per ploeg; daarom staat dit getal één keer boven de ploegen. Een geplande stap die al op een eerdere dag is afgerond, telt ook mee.
- Foutoplossing: het **certificaat** hield nog geen rekening met de route en de grenzen per product (sinds 0.28.0 en 0.29.0). Bij een product dat een stap overslaat (PRD-C slaat PS17 over) stond het kenmerk uit die stap erop zonder meting, waardoor het lot "voldoet niet" kreeg en niet uit te geven was. Nu staan alleen kenmerken uit de route van het product erop, met de grenzen van dat product. Al uitgegeven certificaten blijven zoals ze waren.
- API: nieuw `GET /overdracht/plan?dag=…`. Bestaande aanroepen blijven gelijk.

## Zonder nieuwe versie (na 0.32.0)
- Schermtests: Chrome draait nu in de tijdzone van de fabriek (Europe/Amsterdam), net als de database. Op GitHub draaide Chrome in UTC; tussen middernacht en 01:00 (Nederlandse tijd) was "vandaag" in de browser dan een andere dag dan in de database, en faalden drie controles. De test van de browserdemo blijft in de tijdzone van de machine, want daarin is de demodatabase gebouwd. Aan de schermen zelf verandert niets: in de fabriek staan pc en server in dezelfde tijdzone.

## 0.32.0 — 20 november 2026 · #56 #57 #59
- Nieuw: in het **lotpaspoort** klik je bij een afwijking op het resultaat ("Buiten tolerantie" of "Buiten grens"). Onder de regel klapt de meting open: de waarde met de instelling, de grenzen die toen golden, wie het invoerde op welke pc, alle correcties met reden, en het keurresultaat van de batch (of de herbewerking van het lot). Nog een klik klapt hem weer dicht.
- Nieuw: bij de **regelkaarten** (overzicht en één kaart) staat uitleg op het scherm: wat een meting, specificatiegrens, regelgrens en signaal zijn, en de vier regels.
- Nieuw: in het **Kwaliteit-overzicht** klik je op een staaf van "Afwijkingen per week"; eronder staan dan de afwijkingen van die week, met batch, product, stap, veld en waarde. Werkt ook met het toetsenbord (Tab en Enter).
- API: nieuw `GET /lots/{lotnummer}/meting` met één meting uit het lotpaspoort, de versies, besluiten en herbewerkingen. Bestaande aanroepen blijven gelijk.

## 0.31.0 — 20 november 2026 · #73
- Nieuw: het **Excel-sjabloon** bij Beheer → Stappen en velden heeft een tweede blad **"Grenzen per product"**: per veld en product de onder- en bovengrens en de tolerantie (D55). Bij het inlezen zie je in de controle vooraf wat er nieuw is, wat wijzigt en wat weggaat.
  - Dit blad is de volledige lijst: haal je een regel weg, dan gelden voor dat product weer de grenzen van het veld. Een sjabloon zonder dit blad (van vóór deze versie) laat de grenzen per product zoals ze zijn.
  - Een nieuw veld krijgt pas bij opslaan een code. Grenzen per product voor dat veld lees je daarna in een tweede ronde in.
- Opgelost: bij het inlezen van het sjabloon hadden de labels "Fout" geen kleur.

## 0.30.0 — 20 november 2026 · #53
- Nieuw: **capaciteit per stap en product** (D55). Bij Planning → Capaciteit leg je per stap vast hoeveel batches (of lots) hij per dag aankan, voor alle producten of voor één product. Bijvoorbeeld PS1: 8 per dag, maar 3 van PRD-B.
  - Draaien er producten door elkaar, dan telt elk item voor zijn deel: 6 van PRD-A (max 8) en 1 van PRD-B (max 3) is 108 %.
  - Planning per stap toont hoe vol de stap is, per product, en waarschuwt boven de 100 %. In de stappenlijst staat dan het percentage. De batches die die dag starten volgens de weekplanning tellen mee in de eerste stap.
  - Het Dagoverzicht toont per stap het percentage; de weekplanning toont per dag welke stappen te vol zitten, met een link naar die stap.
  - Plannen boven de capaciteit kan nog steeds; je krijgt alleen een waarschuwing.
- Fictieve capaciteit in de testdata: PS1 8 batches per dag (PRD-B 3), PS9 6 batches, PS16 2 lots.
- Opgelost: getal- en datumvelden in de vensters van de portalen (zoals bij Afwijkende dagen) hadden geen opmaak en waren heel smal.
- Database: migratie 0020 voegt de tabel `capaciteit_stap` en de functies `capaciteit_stap_voor` en `stap_belasting` toe. Er hoeft niemand iets te doen.

## 0.29.0 — 20 november 2026 · #52
- Nieuw: **grenzen en tolerantie per product** (D55). Bij Beheer → Stappen en velden zet je met **Per product** voor één product eigen grenzen en tolerantie van een veld. De tabel toont ze onder de grenzen van het veld, bijvoorbeeld "PRD-C: 400 tot 460 kg". Kies je "Zelfde als het veld", dan vervallen ze weer.
  - Een nieuwe meting krijgt de grenzen van het product van de batch of het lot; eerdere metingen houden de grenzen van toen. Het invoerscherm toont het product bij de batch en kleurt de invoer naar de grenzen van dat product, ook zonder verbinding.
- Nieuw: **productkiezer** in het menu van Kwaliteit en Productieanalyse, bij de schermen die per product kunnen: overzicht, regelkaarten, afwijkingen, trend, herbewerkingen en afkeur, doorlooptijden, productie per week en correcties. "Alle producten" of één product; de keuze wordt op deze computer onthouden. Naast de periode staat welk product je ziet.
  - Trend en regelkaart tonen bij een gekozen product de grenzen van dat product. Met "Alle producten" en een veld met grenzen per product staat er geen Cpk en een uitleg ("kies een product").
  - Afwijkingen tonen het product in een eigen kolom als je alle producten bekijkt.
- Fictieve grenzen per product in de testdata: PRD-B heeft een krappere temperatuur in PS5 (±3 °C) en mag hoogstens 3,5 % vocht bevatten; PRD-C is zwaarder na PS9 (400 tot 460 kg).
- Database: migratie 0019 voegt de tabel `veld_product` en de functie `grenzen_van` toe, en onthoudt bij elke stapregistratie het product (bestaande registraties worden ingevuld). Er hoeft niemand iets te doen; oudere invoerschermen blijven werken (D18).
- Nog niet in het Excel-sjabloon: grenzen per product (#73).

## 0.28.0 — 20 november 2026 · #51
- Nieuw: **elk product heeft zijn eigen route** (D55): welke stappen het doorloopt en in welke volgorde. Stappen kunnen door producten gedeeld worden.
  - Planning → Producten toont per product de route ("Alle stappen" of bijvoorbeeld "15 stappen, zonder PS6, PS14 en PS17, eigen volgorde"). Met **Route wijzigen** haal je stappen weg, voeg je ze toe en zet je ze eerder of later. De lotstap blijft altijd in de route; eerst komen de batchstappen, dan de lotstap, dan de lotstappen.
  - Het invoerscherm, de werkvoorraad, het wandscherm en de planning volgen de route van het product van de batch. Een stap buiten de route kan niet worden gestart. De werkvoorraad toont het product bij elke batch.
  - Een lot bestaat uit 4 batches van hetzelfde product; het invoerscherm zegt het als je batches van verschillende producten kiest. Lotvoorstellen ook.
  - Planning: in de Batchroute zijn stappen buiten de route grijs gearceerd. Plan je toch een batch in zo'n stap, dan zie je "⚠ Deze stap hoort niet bij de route van PRD-C".
  - Productieanalyse: doorlooptijden en productie per week gebruiken de eerste en laatste stap van elk product.
- Fictieve routes in de testdata: PRD-A doet alle stappen, PRD-B slaat PS12 en PS13 over, PRD-C slaat PS6, PS14 en PS17 over en doet PS11 vóór PS10. Een product zonder eigen route doet alle stappen, net als batches zonder product.
- Database: migratie 0018 voegt de tabel `product_stap` en de routefuncties toe, en past de regels voor stappen, lots, werkvoorraad en planning aan. Bestaande producten krijgen geen route en doen dus alle stappen zoals voorheen; er hoeft niemand iets te doen. De API geeft het product en de route erbij; oudere invoerschermen negeren dat (D18).
- Opgelost: op het invoerscherm kon je niet klikken op de tegel van een stap waar iets bezig was. De tegel had dezelfde kenmerknaam als een knop die bezig is, en zulke klikken worden tegengehouden (tegen dubbele invoer). De schermtest controleert dit nu.
- Nog niet in de praktijk getest: echte routes van de pilothal (#2).

## 0.27.0 — 20 november 2026 · #49 #50
- Nieuw: **iedereen logt in met een eigen account** (D53). Wat je invoert, komt vast op jouw naam; naam kiezen is er alleen nog voor het oude gedeelde account "operator". Dat blijft werken tot de beheerder het uitzet, zodat de overstap zonder stilstand kan.
  - Beheer → Accounts: bij een nieuw account voor een operator of ploegleider kies je de naam bij de invoer, of je koppelt een bestaande naam uit de namenlijst. De lijst toont welke naam bij welk account hoort, en waarschuwt zolang het gedeelde account aan staat. Beheer → Operators toont welke namen een eigen account hebben.
  - Een ploegleider die voor het eerst inlogt zonder naam, krijgt automatisch een naam gelijk aan zijn gebruikersnaam.
  - Wissel van persoon op een pc: wat er nog in de wachtrij staat, gaat mee op de naam van wie het invoerde, als die de laatste 7 dagen op die pc heeft ingelogd. Anders weigert de server het met uitleg, en kan een ploegleider het in de wachtrij bekijken.
- Nieuw: **startpagina** (D54). Na het inloggen zie je tegels voor alles waar je account bij mag: Invoerscherm, Kwaliteit, Productieanalyse, Planning, Beheer en Wandscherm. Een operator gaat meteen door naar het invoerscherm. Vanaf de startpagina hoef je op het invoerscherm niet opnieuw in te loggen; op het invoerscherm brengt "Portalen" een ploegleider terug. Afmelden geldt voor beide.
- Het portaal Productie heet nu **Productieanalyse** (naam door Geert te bevestigen, #72).
- Testaccounts in de demo: operator.a en operator.b (eigen inlog), naast het oude gedeelde account operator. Het inlogscherm van een testomgeving toont ze.
- Database: migratie 0017 voegt toe dat een account gedeeld kan zijn en dat een naam bij een account hoort, plus de functies `operator_van_account` en `mag_invoeren_namens`. Bestaande gegevens blijven gelijk; het account "operator" wordt als gedeeld gemarkeerd. Oudere invoerschermen blijven werken: hun wachtrij wordt nog geaccepteerd (D18).
- Nog niet in de praktijk getest: een pc die offline is bij het begin van een dienst (nieuwe inlog kan dan niet), en de startpagina op een echte tablet (#33).

## Zonder nieuwe versie (na 0.26.1)
- Geerts lijst met 21 ideeën na de eerste demo verwerkt in de roadmap: nieuwe fase A2 (#49–#62, #64) en punten in F, G en Te besluiten (#55, #63, #65–#71). Punt 13 (trend per veld) zat in 0.26.1. Besluiten D53 (eigen inlog), D54 (één app met startpagina) en D55 (route per product). De pilotdatum schuift naar schatting twee weken (#70).

## 0.26.1 — 20 november 2026
- Kwaliteit → Trend per veld: de waarde onder de muis klopt weer. De grafiek rekende de muispositie uit ten opzichte van een icoontje in de legenda, waardoor altijd de laatste meting verscheen. In dezelfde uitleg staat nu "instelling" in plaats van "setting" (D51). De schermtest controleert dit nu.

## 0.26.0 — 20 november 2026
- Nieuw: **Planning waarschuwt als de vorige stap niet op tijd is** (D52). Plannen mag nog steeds; je ziet alleen een ⚠ met uitleg, zoals "PS1 is nog niet gepland", "PS1 is pas gepland op ma 23-11" of "PS1 stond op do 19-11 en is nog niet klaar".
  - Bij Toevoegen in Per stap staat wat je kunt plannen in drie groepen: "Staat klaar", "Komt op tijd klaar" en "⚠ Vorige stap niet op tijd". De melding na het toevoegen zegt erbij als er iets met waarschuwing tussen zit.
  - In de lijst per stap staat de waarschuwing bij het item, en in de stappenlijst links een ⚠ bij stappen met zo'n item.
- Nieuw, als **proef** om te vergelijken (#48): **Dagoverzicht** (alle 18 stappen van één dag onder elkaar) en **Batchroute** (per batch die nog niet in een lot zit: per stap ✓ klaar, ▶ bezig of de geplande dag, met ⚠ en een filter "Met waarschuwing"). Klik op een stap of een geplande dag om die te wijzigen.
- Database: migratie 0016 voegt de functie `planning_vorige_stap` toe; er verandert niets aan bestaande gegevens. De API geeft bij geplande items en bij kandidaten een veld `vorige` mee; oudere invoerschermen negeren dat.

## Zonder nieuwe versie (na 0.25.0)
- Roadmap #11: verwijst naar het laptoppakket van de nieuwste versie in plaats van 0.23.0.
- Schermtest portaal: de controle "menu weer dicht na kiezen" wacht nu tot het menu opnieuw getekend is (faalde op GitHub doordat hij te vroeg keek).

## 0.25.0 — 20 november 2026 · #44
- Nieuw: **Ongedaan maken.** Na het uitzetten van een veld, grondstof, operator, ploeg, oorzaak van stilstand of pc staat in de melding een knop "Ongedaan maken" (6 seconden, langer zolang de muis erop staat). Velden en grondstoffen uitzetten vraagt daarom niet meer vooraf om bevestiging. Accounts uitzetten blijft wel vooraf bevestigen, net als alles wat daarna vastligt (D50).
- Nieuw: op een smal scherm of tablet staat het menu van de portalen dicht achter de knop "Menu", met de naam van het scherm waar je bent. De inhoud staat meteen bovenaan; Meldingen blijven altijd zichtbaar.
- De UI/UX-review is hiermee verwerkt (#41–#44). Nog niet in de praktijk getest: het menu en de knoppen op een echte tablet (#33).

## 0.24.1 — 20 november 2026 · #43
- Vaste woorden (D51): "Instelling" in plaats van "Setting" in het invoerscherm, de afwijkingen, het lotpaspoort en Beheer. In de database en de API blijft het `setting`.
- Foutmeldingen staan nu direct onder het veld, met ⚠ en een uitleg hoe je het oplost ("Vul een getal in, bijvoorbeeld 86,5"). Ze verschijnen pas als je de rij verlaat, niet tijdens het typen; de markering binnen of buiten tolerantie blijft wel direct zichtbaar (D50). Onderin staat ook waarom "Stap afronden" nog niet kan.
- Statuskleuren met één betekenis: "In beoordeling" is geel (wacht op Kwaliteit) in plaats van oranje, en "Nu stil" in Productie → Stilstand is rood, zoals in het invoerscherm en op het wandscherm.
- Tabellen: kolommen met alleen getallen (ook met eenheid of duur, zoals "2 u 51") staan rechts uitgelijnd, de kop erboven ook.
- Knoppen in de portalen: alle gewone knoppen hebben dezelfde rand; alleen de hoofdknop is gevuld.
- Stappen zonder werk zijn rustiger (in het invoerscherm en in Productie → Werkvoorraad), zodat stappen met werk opvallen.

## 0.24.0 — 20 november 2026 · #42
- Nieuw: één gedeeld bestand met alle kleuren, afstanden, tekstgroottes en rondingen (`gedeeld/tokens.css`) voor invoerscherm en portalen. Beide apps gebruiken alleen nog die waarden; afstanden liggen op een raster van 4 en 8 px. Kleine verschillen tussen de apps (twee grijzen voor randen) zijn weg.
- Knoppen die iets versturen zijn meteen niet nogmaals te klikken tot het antwoord er is; duurt het langer dan 0,4 s, dan verschijnt een draaiend rondje. Zo kan een dubbele klik geen dubbele invoer meer geven.
- Knoppen in de portalen zijn minstens 44 px hoog; kleine knoppen (zoals "Naar Excel" en de pijltjes in Planning) zijn 36 px om te zien, maar hun klikzone is 44 px. Menu-items in de portalen zijn ook 44 px hoog.
- De tekstgrootte volgt nu de instelling van de browser (bij de standaardinstelling blijft alles even groot). Titels in de portalen zijn iets kleiner (24 px), volgens de vaste tekstschaal.

## 0.23.2 — 20 november 2026 · #41
Eerste versie uit de UI/UX-review van 0.23.1. Alle schermen zijn nagelopen tegen de richtlijnen in het Claude-project; wat eruit volgde staat als #41–#44 in de roadmap, de bewuste afwijkingen in D50 en de vaste woorden in D51. Nieuwe roadmappunten voor later: talenkeuze (#45), donkere modus (#46) en invoer via telefoon of tablet (#47).
- Grafieken beter leesbaar: oranje, grijs en de rand van "Gepland" halen nu minstens 3 : 1 op wit. "Buiten grens" en "Storing" zijn rood met witte strepen, zodat ze ook zonder kleurenzien te onderscheiden zijn van oranje; "Gepland" is een open staaf. Afwijkingen per week toont het totaal boven elke staaf.
- Invoervelden in Planning → Capaciteit en Beheer → Bedrijfsgegevens, en het tekstvak van de ploegoverdracht, hebben dezelfde duidelijke rand als de andere velden. Stille knoppen hebben een donkerdere rand.
- Wandscherm: stappen zonder werk zijn rustig maar weer leesbaar (geen doorzichtigheid meer).
- Beheer → Stappen en velden: de knop "Sjabloon inlezen" staat recht.

## Zonder nieuwe versie (na 0.23.0)
- Handleiding van het laptoppakket noemt nu ook Portaal Planning en het wandscherm. Overbodige notitie `gedeeld/README.md` weggehaald (de README beschrijft de map al).
- Documenten opnieuw ingedeeld naar verleden, heden en toekomst (D48): de stand staat nu bovenaan de README (`NOTES.md` vervalt), de wishlist is opgegaan in de roadmap (`WISHLIST.md` vervalt), en de changelog noemt achter elke versie de nummers van de gebouwde punten. Nieuw roadmappunt #40: releases op GitHub weer laten werken.
- Releases op GitHub (#40): de workflow zet eerst de tag met git en maakt daarna de release, gaat na een mislukte versie door met de volgende en meldt aan het eind welke versies niet lukten. Hij gebruikt de eigen sleutel `RELEASE_TOKEN` als die als secret is ingesteld: de ingebouwde sleutel van GitHub mag geen tag zetten op een versie waarin de workflowbestanden anders zijn dan nu. Met die sleutel zijn de releases 0.21.1 tot en met 0.23.0 alsnog gemaakt.

## 0.23.1 — 20 november 2026
- **Opgelost:** de browserdemo startte niet meer ("File is corrupted"). De demo haalt de database nu in delen van hoogstens 4 MB op, controleert lengte en controlesom en pakt hem zelf uit; ook het pakket van de uitbreiding pgcrypto wordt eerst gecontroleerd. Lukt het toch niet, dan noemt de melding welke stap misging (downloaden, uitbreiding, openen of starten).
- Nieuw op GitHub: bij elke release hangt het laptoppakket voor Windows als bijlage (`batch-gui-laptop-<versie>-windows.zip`, onder "Assets"). De workflow Laptoppakket bouwt het na elke release, en heeft de pakketten van eerdere versies vanaf 0.7.0 alsnog gemaakt, behalve 0.14.0 en 0.15.0 (D49).

## 0.23.0 — 20 november 2026 · #39
- Nieuw: per veld het **aantal decimalen** (0 tot en met 6) in Beheer → Stappen en velden en in het Excel-sjabloon (kolom Decimalen). Het invoerscherm, het lotpaspoort, de afwijkingen, het certificaat en de regelkaart tonen de waarden dan met precies zoveel cijfers achter de komma; gemiddelde en spreiding op de regelkaart met één cijfer meer. Leeg = zoals voorheen. De opgeslagen meetwaarde verandert niet. In de fictieve configuratie hebben temperaturen 1 decimaal, druk en vochtgehalte 2 en het toerental 0.
- Een sjabloon zonder kolom Decimalen (van vóór deze versie) laat de decimalen ongemoeid.
- **Opgelost:** een 0 werd door de server soms als leeg opgeslagen, bijvoorbeeld een setting van 0, een ondergrens van 0 of decimalen 0. Elke 0 blijft nu een 0.
- Beheer → Server: actieve testaccounts met wachtwoord "demo" staan nu als opmerking onder de status en tellen niet meer als waarschuwing; met testdata blijft de status "In orde".
- Technisch: database-update 15 (`0015_decimalen`) wordt bij de start automatisch uitgevoerd.

## 0.22.2 — 20 november 2026 · #38
- Inlogpogingen worden 90 dagen bewaard. Oudere ruimt het onderhoud op: op de server de back-up (elk uur), op de laptop het opstarten. Het onderhoudslogboek in Beheer → Server noemt hoeveel er zijn opgeruimd.
- Technisch: database-update 14 (`0014_opruimen`) met de functie `ruim_inlogpogingen_op()`; alleen het onderhoud kan die aanroepen, de applicatie niet.

## 0.22.1 — 20 november 2026 · #37
- De startpagina (`/`) noemt "Testomgeving met fictieve gegevens" en de testaccounts alleen nog als die accounts er echt zijn. In een lege fabriek of een echte installatie staan alleen de applicaties en het versienummer.
- Beheer → Server waarschuwt als er testaccounts met wachtwoord "demo" actief zijn. Met testdata is dat normaal; in een echte installatie zet je ze uit.
- De startpagina noemt nu ook Planning, het wandscherm en de testaccounts planner1 en scherm1.

## 0.22.0 — 19 november 2026 · #35
- Nieuw in Beheer → Stappen en velden: **Sjabloon downloaden** geeft een Excel-bestand met alle velden van alle stappen (ook uitgezette). Daarin kun je velden aanpassen en nieuwe velden toevoegen (Code leeg laten).
- **Sjabloon inlezen** controleert het bestand eerst: per regel zie je of het een nieuw veld, een wijziging (met oud en nieuw) of ongewijzigd is, en welke regels een fout hebben. Er wordt pas iets opgeslagen als je op "wijzigingen opslaan" klikt, en alleen als geen enkele regel een fout heeft. Alles komt in het logboek.
- Een veld verandert niet van stap of soort via het sjabloon, en velden die niet in het bestand staan blijven zoals ze zijn. Nieuwe velden krijgen de volgende vrije code, zoals altijd.
- Technisch: geen database-update. De controle gebruikt de echte databaseregels in een transactie die wordt teruggedraaid (D46).

## 0.21.1 — 19 november 2026 · #27
- Voor IT: `migreer.mjs` maakt vóór een database-update eerst een back-up (`batchgui_<datum_tijd>_voor-migratie-<nummer>.dump`) als er een back-upmap is ingesteld. Mislukt die back-up, dan verandert er niets.
- Het draaiboek voor de fabrieksserver (`docs/SERVER.md`) is bijgewerkt tot deze versie, met de klok en tijdzone, de inlogbeveiliging en de beveiligingskoppen.
- De schermtests in Chrome (invoerscherm, alle portalen en de browserdemo) draaien nu ook automatisch op GitHub (`tests/test_schermen.sh`). Twee tests wachten nu tot het scherm klaar is in plaats van te snel te tellen.

## 0.21.0 — 19 november 2026 · #28
- Na 5 verkeerde wachtwoorden voor dezelfde gebruikersnaam binnen 15 minuten moet je 1 minuut wachten. Het scherm zegt hoe lang.
- Elke inlogpoging wordt vastgelegd (gebruikersnaam, pc, gelukt of niet; nooit het wachtwoord). Beheer → Server waarschuwt bij 20 of meer mislukte pogingen in 24 uur.
- Hoofdletters in de gebruikersnaam tellen niet meer mee: "Kwaliteit1" is hetzelfde account als "kwaliteit1".
- Nieuwe en opnieuw ingestelde wachtwoorden worden sterker versleuteld. Bestaande wachtwoorden blijven werken.
- De server stuurt beveiligingskoppen mee: pagina's laden alleen scripts en gegevens van de eigen server en kunnen niet in een andere site worden ingebed.
- Technisch: database-update 13 (`0013_inloggen`) wordt bij de start automatisch uitgevoerd (D45).

## 0.20.2 — 19 november 2026 · #29
- Een regelkaart met minder dan 20 metingen staat als "voorlopig": de grenzen en signalen zijn dan een eerste indruk en er staat geen Cpk. In het overzicht staat "nog te weinig metingen" in plaats van een Cpk.
- Lijsten die op hun maximale lengte zitten, zeggen dat nu: afwijkingen (500), trend per veld (5000), grondstoffen terugzoeken (1000), logboek (300) en meldingen (200). Ook in de Excel-export staan dan alleen die regels.
- De trend per veld toont bij heel veel metingen de nieuwste 5000 (eerst waren het de oudste).

## 0.20.1 — 19 november 2026 · #25, #26
- De tijdzone staat vast op die van de fabriek (Europe/Amsterdam). Ploegen, "vandaag" en de weekindeling volgden de tijdzone van de computer waarop de database draait; op een server met UTC schoven de ploegen een of twee uur.
- De nachtploeg rond de wisseling van zomer- en wintertijd klopt. In de nacht van de wintertijd duurt hij 9 uur (05:30 hoorde eerst bij geen enkele ploeg), in de nacht van de zomertijd 7 uur (eerst overlapte hij een uur met de ochtendploeg).
- De periodekeuze in de portalen (bijvoorbeeld "laatste 7 dagen") gaf tussen middernacht en 01:00 of 02:00 een dag te vroeg als begin.
- Technisch: database-update 12 (`0012_tijdzone`) wordt bij de start automatisch uitgevoerd; de opgeslagen tijden veranderen niet (D44).

## 0.20.0 — 19 november 2026 · #23, #24
- Wat offline is ingevoerd, krijgt nu het moment van invoer op de pc in plaats van het moment van versturen. Dat geldt voor het starten en afronden van een stap, meetwaarden en grondstoffen. Doorlooptijden, wachttijden en ploegcijfers kloppen daardoor ook na een periode zonder verbinding.
- Loopt de klok van een pc voor of achter, dan wordt dat gecorrigeerd. Een moment in de toekomst, of van meer dan 7 dagen geleden, wordt de servertijd. Een stap start nooit vóór het afronden van de vorige, en wordt nooit afgerond vóór hij gestart is.
- De wachtrij onthoudt wie iets invoerde. Logt operator A uit terwijl er nog acties wachten en logt B in, dan blijft het werk van A op naam van A. Het wachtrijscherm toont per actie de naam.
- Afmelden met wachtende acties vraagt eerst om bevestiging. De browser wordt gevraagd de wachtrij niet op te ruimen bij weinig schijfruimte.
- Technisch: database-update 11 (`0011_apparaattijd`) wordt bij de start automatisch uitgevoerd. Het moment van aankomst op de server wordt apart bewaard (leeg bij oudere regels). Oudere invoerschermen blijven werken: zonder de nieuwe gegevens geldt de servertijd, zoals voorheen (D18, D43).

## Zonder nieuwe versie (na 0.19.0)
- Werkafspraken: de skillpakketten coding-skills, data en claude-for-manufacturing horen bij het project (D40).
- Documenten opnieuw ingedeeld: elk onderwerp op één plek (D41). README begint met "Waar vind je wat"; open punten en praktijktests staan alleen nog in de wishlist; de notities tonen alleen de stand van nu. De adviezen uit de doorlichting van 19-11-2026 staan als #23–#33 in de wishlist.
- Roadmap toegevoegd (`ROADMAP.md`, D42): fasen A tot en met G met poorten en een globale planning tot na de pilot. Nieuwe wishlistpunten #35 (velden importeren uit Excel) en #36 (training en handleiding).
- Schermtests portaal en grondstoffen bijgewerkt; de browserdemo maakt zijn database opnieuw als schema of testdata nieuwer is.

## 0.19.0 — 19 november 2026 · #20
- Nieuw: boven elke tabel in de portalen staat de knop "Naar Excel". Die maakt direct een Excel-bestand (.xlsx) van de tabel zoals je hem ziet, met de kop van de pagina en de datum in de bestandsnaam.
- Aantallen en meetwaarden worden echte getallen in Excel (ook met een komma als decimaalteken), zodat je er meteen mee kunt rekenen of filteren. De kopregel staat vast en heeft een filter. Knoppen en lege kolommen gaan niet mee.
- Technisch: geen database-update en geen API-wijziging; het bestand wordt in de browser gemaakt en werkt dus ook offline (D39).

## 0.18.0 — 19 november 2026 · #19
- Nieuw: Portaal Kwaliteit → Regelkaarten. Het overzicht laat per veld zien hoeveel metingen en signalen er in de periode zijn, en hoeveel marge er is tot de specificatie (Cpk). Velden met signalen staan bovenaan.
- Per veld een regelkaart met de metingen, het gemiddelde, de regelgrenzen (3 sigma) en de zones van 1 en 2 sigma. Bij een procesparameter tekent de kaart het verschil tussen gemeten en setting; bij andere velden de gemeten waarde, met de specificatie erbij.
- Een signaal (rood ruitje) volgt de vier Western Electric-regels: één punt buiten 3 sigma; 2 van 3 punten buiten 2 sigma; 4 van 5 punten buiten 1 sigma; 8 punten op rij aan dezelfde kant. Een signaal betekent dat het proces verandert, vaak al vóórdat er een afwijking is. Onder de kaart staat een lijst met de signalen.
- Technisch: geen database-update; de berekening zit in de API (`api/src/regelkaart.ts`, met eigen tests).

## 0.17.0 — 19 november 2026 · #18
- Nieuw: certificaat per lot (analysecertificaat voor de klant). In het lotpaspoort staat "Certificaat". Daar zie je per kenmerk de specificatie, het resultaat (bij batchkenmerken van laag tot hoog, met het gemiddelde over de 4 batches) en of het lot voldoet. Ook staan erop: de batches, het product en de grondstofpartijen, en de verklaring van het bedrijf.
- Kwaliteit geeft het certificaat uit met "Uitgeven". Dat kan alleen als het lot gereed is, alle kenmerken gemeten zijn en binnen de specificatie vallen, en geen batch is afgekeurd. Het certificaat krijgt een volgnummer en wordt bewaard zoals het is uitgegeven, zodat een herdruk precies gelijk is. Tot het uitgeven staat er "CONCEPT" op.
- Afdrukken of als pdf bewaren gaat via de browser; er komt alleen het certificaat op papier.
- Nieuw in Portaal Beheer: bij elk veld kies je of het op het certificaat komt. Onder "Bedrijfsgegevens" stel je de bedrijfsnaam, het adres en de verklaring in. De fictieve configuratie zet druk (S3.3), toerental (S7.3), gewicht (S17.2, S18.2) en vochtgehalte (S18.3) op het certificaat.
- Technisch: database-update 10 (`0010_certificaat`).

## 0.16.0 — 19 november 2026 · #17
- Nieuw: capaciteit in de planning. In Portaal Planning → Capaciteit leg je per weekdag vast hoeveel batches de fabriek aankan. Daarnaast kun je afwijkende dagen vastleggen met een reden, zoals een feestdag of onderhoud.
- In de weekplanning staat per dag hoe vol hij is ("4 / 6" met een balk). Een dag met meer batches dan de capaciteit wordt geel met ⚠. Bovenaan zie je hoeveel ruimte er deze week nog is.
- Plannen boven de capaciteit kan nog steeds. Het scherm vraagt dan eerst of je het zeker weet, en meldt het daarna nog eens.
- Fictieve capaciteit: 6 batches per dag. In de testdata heeft een dag over drie dagen een lagere capaciteit (onderhoud) en is die dag te vol gepland.
- Technisch: database-update 9 (`0009_capaciteit`).

## 0.15.1 — 19 november 2026
- Opgelost: het laptoppakket startte sinds 0.14.0 niet bij de eerste start met testdata. Bij het verschuiven van de testdata naar vandaag lag het einde van een stilstand even vóór het begin. Nu schuiven alle tijden van een tabel tegelijk. De browserdemo had hetzelfde probleem.

## 0.15.0 — 19 november 2026 · #5
- Nieuw: etiketten met barcode (Code 128). In Portaal Planning staat bij elke dag "Etiketten" voor de geplande batches. In het lotpaspoort staat "Etiket" voor het lot. In het invoerscherm staat in elke registratie "Etiket printen".
- Twee formaten: een etiketprinter (100 × 50 mm, één etiket per pagina) of een A4-vel met 3 × 7 etiketten (63,5 × 38,1 mm). Afdrukken gaat via de browser, zonder extra software. Het invoerscherm onthoudt per pc welk formaat je gebruikt.
- Nieuw: scannen met een gewone handscanner (die werkt als toetsenbord). In een stap opent een scan de batch als die al bezig is, of start hem als hij klaarstaat. In de lot-stap vinkt een scan de batch aan. Op andere schermen zoekt een scan de batch of het lot op. Ook een partijnummer van een grondstof kun je in het invoerveld scannen.
- Verbeterd: een fout in de schermtest van het invoerscherm (0.14.0) is hersteld.

## 0.14.0 — 19 november 2026 · #16
- Nieuw: stilstand melden. In het invoerscherm staat bij elke stap "Stilstand melden": kies de oorzaak (storing, wachten, gepland of overig) en eventueel een toelichting. Een rode balk laat zien dat de stap stilligt, tot iemand op "Stilstand beëindigen" drukt. Dat werkt ook zonder verbinding.
- Bij een storing krijgt de ploegleider een melding. Op het wandscherm wordt de stap rood met ⛔.
- Nieuw: Portaal Productie → Stilstand. Je ziet wat nu stilligt, de stilstand per stap en per oorzaak, en de beschikbaarheid per stap. Daarnaast de kwaliteit: het deel van de gestarte batches dat niet is afgekeurd. Samen is dat het begin van OEE. Voor de prestatie (snelheid) zijn nog normtijden per stap nodig.
- Nieuw: Portaal Beheer → Oorzaken van stilstand. Een geplande oorzaak (omstellen, schoonmaken, onderhoud) telt niet mee als verlies.
- De testdata bevat fictieve stilstand: dagelijks schoonmaken, wekelijks onderhoud, en storingen (PS7 vaker). In PS7 loopt nu een storing.
- Technisch: database-update 8 (`0008_stilstand`).

## 0.13.0 — 19 november 2026 · #15
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

## 0.12.0 — 19 november 2026 · #14
- Nieuw: ploegoverdracht. In het invoerscherm staat onder "Overdracht" wat deze ploeg tot nu toe heeft gedaan: afgeronde stappen per stap, gestarte batches, lots, afwijkingen en wat nog open staat. Daar schrijf je de bijzonderheden van de ploeg en de aandachtspunten voor de volgende ploeg. Dat werkt ook zonder verbinding.
- Nieuw: bovenaan het stappenoverzicht staat de overdracht van de vorige ploeg, met de aandachtspunten vet. Met "Gelezen" klap je hem op deze pc in.
- Nieuw: Portaal Productie → Ploegoverdracht. Per dag de drie ploegen met hun cijfers, overdrachten en wat open bleef aan het eind.
- Nieuw: Portaal Beheer → Ploegen. Begin- en eindtijd en naam per ploeg. Een nachtploeg hoort bij de dag waarop hij begint.
- Een overdracht is na opslaan niet meer te wijzigen; schrijf een aanvulling.
- Fictieve ploegen: ochtend 06–14, middag 14–22, nacht 22–06. In de testdata schrijft ongeveer driekwart van de ploegen een overdracht.
- Technisch: database-update 6 (`0006_ploegoverdracht`).

## 0.11.0 — 19 november 2026 · #13
- Nieuw: grondstoffen per batch. In een stap voert de operator per grondstof het partijnummer van de leverancier in, en eventueel de hoeveelheid. Een verplichte grondstof moet zijn ingevuld voordat de stap kan worden afgerond. Een ploegleider kan een partijnummer achteraf corrigeren; het origineel blijft bewaard.
- Nieuw: Portaal Kwaliteit → Grondstoffen terugzoeken. Zoek op (een deel van) een partijnummer en zie in welke batches en lots die partij zit. Zonder zoekterm: de laatst gebruikte partijen.
- Nieuw: het lotpaspoort toont welke grondstofpartijen in het lot en zijn batches zitten.
- Nieuw: Portaal Beheer → Grondstoffen. Grondstoffen toevoegen, wijzigen of uitzetten, en per stap kiezen of de grondstof verplicht is of mag.
- De fictieve configuratie heeft drie grondstoffen: GS-A in PS1 en GS-B in PS3 (verplicht), HS-C in PS9 (mag). De testdata wisselt ongeveer elke 4 dagen van partij.
- Let op: een ouder invoerscherm (van vóór 0.11.0) kan geen grondstoffen invoeren. Werk alle pc's bij voordat je een grondstof verplicht maakt in een stap die al in gebruik is.
- Technisch: database-update 5 (`0005_grondstoffen`).

## 0.10.0 — 19 november 2026 · #12
- Nieuw: wandscherm voor een tv in de hal (`/portaal/#/wandscherm`). Per stap zie je wat bezig is (▶ blauw), wat klaarstaat (● wit) en wat gepland is maar nog niet klaar (○ grijs), in de volgorde van de planner. Een gele rand met ⚠ betekent: wacht of loopt langer dan normaal (langer dan 90% van de keren in de laatste 30 dagen). Bovenaan: batches gestart tegenover gepland, lots gereed en batches in beoordeling.
- Het wandscherm ververst elke 30 seconden. Valt de verbinding weg, dan blijft de laatste stand staan met de melding "Geen verbinding sinds …".
- Per hal: `#/wandscherm/Hal 1` toont alleen de stappen van de pc's in die hal.
- Nieuw: rol "Wandscherm" voor een account dat alleen het wandscherm mag zien (testaccount `scherm1`). De tv hoeft zo niet op naam van een persoon ingelogd te zijn. Het blijft 30 dagen ingelogd; zet je het account uit in Portaal Beheer, dan stopt het scherm meteen.
- Iedereen met een persoonlijk account opent het wandscherm via de link onder in het menu.
- Technisch: database-update 4 (`0004_wandscherm`): de nieuwe rol.

## 0.9.0 — 19 november 2026 · #4
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

## 0.6.0 — 18 november 2026 · #1
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
