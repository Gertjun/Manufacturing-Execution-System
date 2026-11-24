# Acceptatiecriteria

D89 G01–G08 en D87/D88. Voor elke PR scenario's vooraf definiëren, gericht testen, Node 22 selectief op concept-PR via compatibiliteit-test, beide suites op actuele head/base bij acceptatie-test (D90). Geen testverzwakking; eigenaar merget. Documentatie-only volgens actuele allowlist; de acht expliciete docs/mes-bestanden vallen onder de documentatie-uitzondering. Geen versie/release voor ontwerpdocumentatie.

| Poort | Minimaal bewijs |
|---|---|
| 0 | 69 besluiten, documentatie en roadmap compleet; normmatrix ontwerpstatus |
| 1 | Meerdere rollen, scope/kwalificaties, negatieve API/DB autorisatietests, geen zelftoekenning, regressie behouden kernfuncties en beveiliging tijdelijke legacy-interfaces (D99) |
| 2 | Concept wijzigbaar, vrijgegeven MBR onveranderlijk, goedkeuring vervalt bij wijziging, versieverschil en geldigheid, historische koppeling onbekend indien geen bewijs |
| 3 | Middelen en fysieke assets onderscheiden; geschiktheid/status/kwalificatie, historische toewijzing |
| 4 | Order, job, planning en dispatch-voorwaarden; geen uitvoering zonder vrijgave |
| 5 | CR bij dispatch en vastleggen bij start; nieuwe MBR verandert lopende batch niet; gemengde versies zelfde product toegestaan tenzij incompatibel, andere producten geweigerd; afwijkende lotnorm zonder reden geweigerd; verplichte registratie; offline idempotentie, intrekking/conflicten en twee gelijktijdige starts |
| 6 | EBR batch/lot volledig en reproduceerbaar, correctie behoudt origineel; werkelijke middelen/materialen/personen |
| 7 | Geen vrijgave bij ontbrekende gegevens, open blokkerende afwijking, actieve hold of onbevestigde offline volledigheid; bevoegde menselijke vrijgave, relevante correctie herbeoordeling, CoA exacte stand |
| 8 | Voorwaarts/achterwaarts traceerbaar, geen dubbele verbruikstelling; geblokkeerde partij impactanalyse |
| 9 | Werkelijke MBR's, rollen, kwalificaties, netwerk, backup/herstel, scanner/printer/tv/tablet, offline en twee pc's, klokwissel, training/privacy, terugvalplan, schaduwpilot naast papier en positieve evaluatie vóór overgang |
| 10–11 | KPI-definities en bewijs, integratiecontracten, veilige uitrol |

Migratietests: schone installatie en upgrade vanaf main, schema/diagram consistent, historische data en ID's behouden, DB-rechten beperkte app-account, transacties en herstel. Kritische negatieve tests: operator MBR wijzigen, auteur alleen goedkeuren, systeembeheer product vrijgeven, ongeschikt middel, ontbrekende kwalificatie, verlopen offline bevoegdheid, opheffen technische hold laat quality hold intact. Werkelijke testbewijslinks pas invullen na uitvoering.

Fase 1, PR #6 (deelimplementatie): `api/test/authorization.test.ts` bevat scenario's voor gescheiden grants, ontbrekende scope, geldigheid, intrekking, kwalificaties, conflicterende beheerdomeinen en persoonlijke identiteit. Uitvoering en API/DB-integratie nog open.

D92: oude accountimport moet 404 opleveren; geen accountsjabloon in Medewerkers. Handmatig account aanmaken, tijdelijk wachtwoord en eigen wachtwoord wijzigen blijven regressietests.

Migratie 0038: negatieve DB-scenario's voor eigen aanvraag, onbevoegde aanvrager, eigen besluit, doelaccount als beoordelaar, dubbele beslissing en beperkte app-rechten; positieve onafhankelijke beslissing en afwijzing. Nog niet uitgevoerd. Identiteitsherbevestiging, intrekking, gecontroleerd bootstrapkanaal en API/UI-integratie blijven open.

0039: regressies voor bescherming van security-account tegen reset/rolwijziging/hernoemen, geweigerde app-aanroep, verkeerde herbevestiging zonder besluit, juiste herbevestiging met gekoppeld besluit. Nog niet uitgevoerd.

Verplichte reviewpoort voor iedere MES-fase (afspraak 24 november 2026): na functionele implementatie en vóór volledige acceptatie-CI alle bestaande workflowtests, fixtures, schemaqueries, verwachtingen en triggers inventariseren en toetsen aan de goedgekeurde ontwerpbesluiten. Verwijder uitsluitend achterhaalde verwachtingen, behoud relevante dekking en voeg positieve/negatieve tests toe. Leg reviewresultaat en resterende risico's vast vóór het starten van de acceptatierun.

0041: regressies voor onbevoegde intrekking, verkeerde herbevestiging, succesvolle intrekking, dubbele intrekking, behoud grant/audit en onveranderlijke aanvragen/besluiten/intrekkingen. Nog niet uitgevoerd.

0042: controleer persoonlijke login met beperkte kolomrechten, en dat een bestaande sessie na wijziging of deactivering van de oude accountrol geen toegang meer krijgt. De nieuwe MES-grants zijn nog niet de gezaghebbende bron voor bestaande routes.

0044: test expliciet dat een oude beheerder zonder grant geen account- of parameterbeheer mag uitvoeren; system administrator mag accounts maar geen procesparameters wijzigen; process engineer mag parameters maar geen accounts beheren; security administrator mag geen technisch of engineeringbeheer uitvoeren; ingetrokken, verlopen en scoped grants geven geen globale beheertoegang. Oude API/UI-testfixtures bij de integrale review aanpassen.

0045: test registratie-start, waarden, grondstoffen, afronden en correcties met actuele productscope; keuringsvelden vereisen afzonderlijke inspection-permission; hergebruik UUID voor andere batch/lot geweigerd. Legacy DB-rolchecks, area/equipmentcontext en overige routes nog te integreren. Integrale tests nog niet uitgevoerd.

0046: negatieve regressies vereist voor registratie/keuring buiten productscope, technische/security-leestoegang, technician die besluit probeert te nemen en ingetrokken grant; positieve approver binnen scope. Nog niet uitgevoerd. Herbevestiging en databasehandhaving open.

D96: negatieve regressie voor verwijderde /keuringen/verwacht; behoud de positieve regressies voor openstaande keuringen en het starten van een beschikbare keuringsstap. UI- en workflowreview blijft vereist vóór faseacceptatie.

0047: regressies voor scheiding planning en engineering, geweigerde legacy-only/technische/security-accounts, verlopen/ingetrokken grants, en geen globale wijzigingen met beperkte scope. D97 staat vervanging van fictieve fixtures toe zonder bedrijfsregeltests te verliezen. Nog geen uitvoeringsbewijs.

0048: regressies voor operationele functiescheiding, geweigerde scoped globale acties, idempotentie uitsluitend voor oorspronkelijke identiteit, ongeldige operatorheader en gelijktijdig beëindigen stilstand zonder overschrijven. Nog niet uitgevoerd.

0049: regressies voor batch/lotleesrecht, scope van elk lotlid, idempotentie van oorspronkelijke operator, gescheiden blokkade/kwaliteitsbesluit/herbewerkingsopdracht. Test ook gemengde of onbekende productcontext, oude DB-rolchecks, en kritische herbevestiging vóór acceptatie. Nog niet uitgevoerd.

D99: scopepoort vóór verdere legacy-integratie en vóór faseacceptatie. Toets de goedgekeurde matrix in DECISIONS.md; uitgestelde functies zijn geen fase-1-acceptatie-eis, maar geen onbeschermde tijdelijke interfaces of regressies in behouden bedrijfsregels. PGlite-demo niet verplicht; gecontroleerde uitfasering na afhankelijkhedenreview (#136). PostgreSQL en Windows-laptoppakket blijven leidend. Fictieve fixtures mogen conform D97 worden vervangen. Geen testresultaat geclaimd.

## Tussentijdse audit D99 — startbaseline 400880ccc8cc213f3052753463aa22ff9873ff6e

Vergelijking main 31c86973bf13848cba44fc38785084953fe65e39: 26 commits; inventarisatie van gewijzigde bestanden uitgevoerd, inhoudelijke audit nog in uitvoering. A = direct corrigeren, B = uitfaseren, C = tijdelijk afschermen, D = behouden. Geen volledige acceptatie-CI tot eindaudit en testreview gereed zijn.

| Bevinding | Klasse | Status |
|---|---|---|
| Werkstationbinding registreert fictieve succesvolle login en kan rate-limit beïnvloeden | A | API-insert verwijderd; directe app/PUBLIC-schrijfprivileges ingetrokken; nog testen |
| ingelogd controleert accountstatus niet opnieuw | A | Actieve persoonlijke account-, rol- en tijdelijke-wachtwoordstatus gecontroleerd; nog testen |
| Legacy-rolveld en directe accountwijzigingen kunnen functiescheiding omzeilen | A | Open |
| Kritische kwaliteitsbesluiten zonder persoonlijke herbevestiging | A | Open |
| Ongeplande batchcreatie / opdrachtloze herbewerking | C/A | D98/D99: geen definitieve MES-rechten; afscherming nog beoordelen |
| Direct wijzigbare procesdefinitie en vaste lotgrootte | C | Vervanging fase 2/5; geen verdere investering |
| Stilstand per processtap | C | Vervanging fase 3 |
| PGlite-demo en uitgebreide wandschermen | B | Afhankelijkhedenreview open |
| Rollen, scope, kwalificaties en persoonlijke identiteit | D | Fundament behouden; handhaving en tests open |

Gerichte regressies vereist: /auth/pc voegt geen inlogsucces toe; beide app-rollen mogen geen inlogpoging invoegen; ingetrokken/inactieve en gewijzigde accounts krijgen geen toegang via ingelogd; tijdelijk wachtwoord wijzigen blijft mogelijk. Nog niet uitgevoerd.

0050 tussentijdse audit: gedeelde accounts geweigerd in de database; bekende accountpogingen geserialiseerd; wachtwoordwijziging gebruikt dezelfde begrensde login, negatieve poging wordt gecommit vóór HTTP-fout. Oude controle/wijzigfunctie eigenaar-only. Gerichte DB-regressies toegevoegd, API PC-test aangepast; nog niet uitgevoerd. Security-accounttrigger en gecontroleerd accountherstel afzonderlijk beoordelen.

Tussentijdse audit (klasse A): ongeldige enkele dollarbegrenzingen in db/schema.sql en niet-uitgebrachte migratie 0050 hersteld. Correctie vóór eerste acceptatie, geen wijziging aan uitgebrachte migraties. Schone installatie, upgrade en vergelijking van schema blijven verplicht; nog niet uitgevoerd.

0051 (klasse A): technische en security-grants mogen niet tegelijk actief zijn op één identiteit; bestaande conflicterende grants geven geen rechten en nieuwe overlappende toekenningen worden geweigerd door de besluitprocedure. TypeScript en SQL-regressies voor afzonderlijke en gemengde identiteiten toegevoegd. Tests nog niet uitgevoerd; directe eigenaarwrites, accountbeheer, herstel en beveiligd besliskanaal blijven afzonderlijke auditpunten.

0052 (klasse A): oude roltoekenning bij aanmaken/wijzigen via beide gewone applicatielogins geblokkeerd; nieuwe accounts krijgen pending en een tijdelijk wachtwoord. Technische API weigert rol- en personeelsindeling en controleert account.manage in de schrijftransactie. Gerichte DB-regressies toegevoegd, niet uitgevoerd. Bestaande legacy-rollen blijven onveranderd; oude routes, herstel, personeelroutes, UI en gecontroleerde overgang van pending naar uitvoeringsidentiteit blijven open. Geen acceptatie van accountbeheer vóór integratie.

0053 (klasse A): gewone app-login mag credentials van bestaande legacy-accounts of accounts met niet-ingetrokken grants niet resetten; ook toekomstige/verlopen grants beschermd. Reactivering van beschermde accounts en uitschakelen van technische/security-identiteiten via gewone accountupdate geweigerd. Eigen wachtwoordwijziging via bevestigde eigenaarfunctie behouden. Nieuwe toekenning weigert tijdelijk wachtwoord. DB-regressies toegevoegd, niet uitgevoerd. Gecontroleerde recovery, veilige initiële identiteitsoverdracht, eigenaarschap/privilege-audit en oude noodsleutel blijven open; geen volledige bescherming tegen een vertrouwde database-eigenaar geclaimd.

0054 (klasse A): eigenaar-only bootstrap met drie afzonderlijke identiteiten, afzonderlijke wachtwoorden, reden en onveranderlijk auditrecord; uitsluitend lege identiteitsadministratie, geen automatische conversie. Oude noodsleutel op bestaande database uitgeschakeld. Negatieve DB-regressies toegevoegd; positieve lege-installatie-, gelijktijdigheids- en pakkettest nog te actualiseren/uitvoeren. Identiteit van aanwezige personen en externe goedkeuring zijn organisatorische randvoorwaarden, niet bewezen door de tool. Gecontroleerd accountherstel en noodherstel nog open; geen productieacceptatie.

0055 (klasse A): eigenaar-only herstel van actief persoonlijk account met twee onafhankelijke security-identiteiten, persoonlijke herbevestiging binnen dezelfde concrete handeling, tijdelijk wachtwoord en onveranderlijk herstelrecord. Geen automatische reactivering of grants. Negatieve en positieve DB-regressies toegevoegd, niet uitgevoerd. Beveiligde persoonlijke overdracht, sessie-intrekking (oude JWT mag na wachtwoordwijziging niet herleven), CLI/API-aansluiting, noodherstel bij onvoldoende security-identiteiten en bescherming tegen eigenaarmisbruik blijven open. Herstel nog niet operationeel accepteren.

0056 (klasse A): sessiegeneratie bij credential-, status- en legacy-identiteitswijzigingen; login legt generatie vast onder accountlock, wachtwoordwijziging controleert oude generatie in transactie en pc-token behoudt oude generatie. Tokens zonder generatie geweigerd. DB/API-regressies toegevoegd, niet uitgevoerd. Overige directe JWT-consumenten, reeds lopende schrijftransacties en rollback/herstel van database nog afzonderlijk auditen; geen volledige sessie-intrekkingsclaim vóór validatie.
