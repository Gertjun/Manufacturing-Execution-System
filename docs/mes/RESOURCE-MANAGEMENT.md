# Fase 4 — Resource Management: ontwerpcontract 114.1

Status: ontwerp, niet geïmplementeerd of getest. Basis main 9ceba898c8d04115253cb060a75d9206a6e0a65f, schema 0129, release v0.64.0. Leidende besluiten D89 A04/M07/M08/P13, D99, D115 en D116; ROADMAP en DATA-MODEL blijven leidend. Geen formele ISA-conformiteitsclaim.

## Gap-analyse

Bestaande pc/pc_stap, processtap, capaciteit_stap en stilstand/oorzaak (0008, 0009–0035) zijn tijdelijke operationele bronnen. 0027 bevat storingsnotities. 0036 en opvolgers bieden persoonlijke rollen, scopes, kwalificaties, audit en functiescheiding; area_code/equipment_code voorlopig. API access.ts controleert vertrouwde context, transactierechten en globale/productrechten. 0104 biedt eenheden, 0105 voorlopige equipment property, 0106 voorlopige equipment_class_code en exacte capaciteitseenheid, 0109 persoonlijk receptbeheer, 0121 conservatieve vrijgaveblokkade, 0129 persoonlijke transactielock. Hergebruik, geen dubbele bron en geen automatische fysieke mapping.

## 114: structuur

- 114.1: ontwerp en gap-analyse; dit document, nog geen runtimebewijs.
- 114.2: equipment_hierarchy, UUID, stabiele unieke code, naam, type enterprise/site/area/cell/unit, expliciete parent FK. Enterprise zonder ouder; ieder ander type exact één ouder van onmiddellijk voorafgaand type. Meerdere enterprises toegestaan. Geen impliciete reparenting, type- of codewijziging. Geen delete van gebruikte identiteiten. Eerste migratie 0130 uitsluitend intern fundament; geen app-grants of demo-mapping. Definieer lifecycle en persoonlijke mutatie vóór opening beheer.
- 114.3: equipment_class, equipment, equipment_class_assignment. Functionele identiteit gescheiden van hiërarchie en asset; ieder equipment één expliciete hiërarchielocatie; N:M classificatie, unieke koppelingen. Stabiele codes, geen stilzwijgende wijziging van gebruikte classificatie. Exacte relatie tussen unit en functioneel equipment en klasseversiebehoefte toetsen vóór DDL.
- 114.4: physical_asset, equipment_asset_assignment. Onafhankelijke stabiele fysieke identiteit; historie met [valid_from, valid_until), geen overlappende toewijzing van dezelfde asset aan verschillende middelen, concurrency in DB afdwingen; open einde mogelijk. Exacte toegestane multipliciteit per functioneel middel vóór DDL vaststellen. Geen retroactieve verzonnen koppelingen; historie onveranderlijk, gecontroleerde afsluiting.
- 114.5: persoonlijke catalogus-/middelenbeheerrechten, audit actor en tijd, actuele scope afgeleid uit vertrouwde records, wijzigingsteller/locks; geen nieuwe grants aan gebruikers automatisch. Nieuwe context mag bestaande codegrants niet verbreden: expliciete mapping en negatieve tests vereist. Controleer oude en nieuwe scope bij verplaatsing; geen permissie via clientcontext. Directe tabelmutatie verboden voor approllen.
- 114.6: beperkte lees-/mutatie-API en B+ beheerinterface, duidelijke status/filters, stabiele focus, persoonsnaam met audit-ID; centrale portaalregistratie. API en DB bewaken rechten onafhankelijk. Geen dubbele beheerroute.
- 114.7: gerichte PostgreSQL, API, security en Chrome-regressies; schone installatie, upgrade 0129, historische gegevens, schema-equivalentie en ACL; bewijs per exacte head/base.

## 115: eigenschappen en inzetbaarheid

- 115.1: equipment_capability en getypeerde eigenschappen met bestaande quantity_kind/measurement_unit; exacte numeric, geen impliciete conversie of vrije eenheid.
- 115.2: equipment_capacity, geschiktheid en expliciete klasse-/eigenschapseisen; geen planning of feitelijke toewijzing.
- 115.3: equipment_status_history, persoonlijke technische blokkade/vrijgave met reden/tijd en concurrency; operationele stop is niet automatisch technische vrijgave.
- 115.4: equipment_workstation koppelt bestaande pc gecontroleerd aan middelen; geen afgeleide fysieke identiteit uit pc_stap. Behoud offline en werkstationbinding.
- 115.5: bestaande stilstand uitbreiden of gecontroleerd opvolgen met expliciete middelcontext; bestaande records en oorzaak behouden; huidige één open per processtap-regel niet blind overnemen. Cardinaliteit, dubbele registratie, offline replay en afsluiting vooraf toetsen. Geen fictieve historie.
- 115.6: integratie bestaande portalen, beperkte statusprojecties en rechten; geen dispatching.
- 115.7: gerichte automatische integriteits-, status-, capaciteits-, scope-, concurrentie- en offline regressies; praktische bediening op Windows later.

## 116: Maintenance

- 116.1: bestaande maintenance-rol en domein inspecteren; gescheiden lees-/mutatiebevoegdheden, geen automatisch adminrecht.
- 116.2: native Maintenance-portaal voor technische beschikbaarheid, blokkades en middelenstatus; centrale registratie, B+ componenten, directe URL/API-weigering.
- 116.3: recipe_equipment_requirement en voorlopige schaalbron gecontroleerd verbinden met catalogus. Geen historische MBR-mutatie buiten lifecycle; geen codegok, geen automatische vrijgave. 0121 blokkade uitsluitend voor aantoonbaar gevalideerde eisen aanpassen; onderscheid definitiegeldigheid en actuele beschikbaarheid. Complexe berekening blijft fase 6.
- 116.4: D99 storingsnotities herbeoordelen, bestaande data/actor behouden; geen compleet CMMS.
- 116.5: integratie/audit, negatieve API- en SQL-tests, gerichte portaalregressie.
- 116.6: integrale Node22/26, PostgreSQL, security, Chrome, pakket, diagrammen en audit; Windows-kandidaat en praktische acceptatie; expliciete technische merge en afzonderlijke releasebeslissing volgens D88. Geen pilotclaim.

## Acceptatie 114 (voorgestelde test-ID's)

F4-114-A01 geldige hiërarchie; A02 ongeldige ouder/type/cyclus; A03 stabiele unieke identiteit; A04 classificatie; A05 historische assettoewijzing; A06 overlap en tijdgrenzen; A07 persoonlijke rechten en scope; A08 audit; A09 concurrency; A10 legacybehoud; A11 schone installatie/upgrade 0129. A01–A11 automatisch, inclusief negatieve gevallen. Per migratie gerichte controles, geen volledige suite tot integrale acceptatie. Fysieke ergonomie B; portaalbediening C; D115 bewijsbeleid ongewijzigd.

## Praktijkbevindingen en documentatie

Alle 14 ROADMAP-bevindingen behouden hun bestaande bestemming. W07-UX03/04/05/09 en W12-UX01 zijn ontwerpinput (lifecycle, filters, focus, persoonsnamen, gedeelde meldingen), geen vervroegde afsluiting of nieuwe centrale meldingsduur. Overige punten niet naar voren halen. DOC6: Maintenance Technician en Process Engineer handleidingbehoeften registreren, uitgebreide handleidingen na fase 6. Diagrammen op relevante mijlpalen volgens D115; geen PDF per commit.

## Open grenzen

Migratie 0130 nog niet geschreven; schema blijft 0129. Voor elke volgende DDL exacte constraints, ACL, installatieschema, upgradepad en tests vaststellen. Geen nieuwe werkpakketnummers (volgende vrij #147 volgens ROADMAP). Geen fase 5/6 vooruitbouwen. README-status #146 bij gebundelde actualisatie corrigeren. Geen CI-resultaten, merge of release geclaimd.

## 114.2 — eerste implementatie

0130: `equipment_hierarchy` met globale code-uniciteit, level en parent_id, plus gegenereerde parent_level voor samengestelde FK (id, level). Alleen enterprise heeft geen ouder; overige niveaus verwijzen verplicht naar het onmiddellijk voorafgaande niveau. Cycli zijn structureel onmogelijk. Identiteit, code, niveau en ouder niet wijzigbaar; verwijderen geweigerd. Naamcorrectie voor de eigenaar toegestaan; persoonlijke audit en lifecycle volgen vóór opening van beheer. Geen app-grants of demo-/legacy-mapping. Regressies F4-114-A01/A02/A03/A07/A10 toegevoegd; uitvoering en schema-equivalentie open. DATABASE.md blijft bewust momentopname 0129 (D115). Generatorclassificatie en domeinindeling voorbereid; SVG's pas bij faseacceptatie.

## 114.3 — interne equipmentcatalogus

0131: equipment_class, equipment en equipment_class_assignment (N:M). Elke functionele identiteit heeft één verplichte expliciete hiërarchielocatie; meerdere middelen per knooppunt toegestaan. Unit is een hiërarchieknooppunt, geen impliciete tweede fysieke of functionele identiteit. Geen beperking tot unit-niveau: middelen kunnen ook op andere niveaus gedeeld worden; toekomstige inzetbaarheid moet expliciet worden getoetst. Codes zijn globaal uniek per catalogus en onveranderlijk, naamcorrectie door eigenaar mogelijk. Classificaties hebben nog geen versie- of inhoudscontract buiten identiteit en naam; geen claim van bruikbaarheid voor receptvrijgave. Koppelingen voorlopig append-only, geen gecontroleerde intrekking of verplaatsing totdat lifecycle, autorisatie en audit zijn geïmplementeerd; geen app-grants. F4-114-A04/A07/A10 regressies toegevoegd. 0130 baseline run 787 op 147b9db groen; 0131 nog niet runtimegeverifieerd. Geen wijzigingen aan 0106/0121 of bestaande recepten. Afgeleide documenten blijven momentopname 0129.

## 114.4 — fysieke assets en historische toewijzingen

0132: zelfstandige fysieke identiteit, globale unieke code en beschermde identiteit. Een asset is maximaal aan één functioneel middel tegelijk gekoppeld; meerdere assets per middel zijn toegestaan (samengestelde installatie). Halfopen intervallen [valid_from, valid_until), eindig begin/einde, NULL voor open einde. PostgreSQL GiST-exclusie met btree_gist borgt overlap ook bij concurrerende schrijvers. Identiteit, middel, asset en begin onveranderlijk; uitsluitend eenmaal een open periode afsluiten, geen verwijdering. Eigenaarinterface is intern; persoonlijke actor, audit en gecontroleerde sluiting volgen 114.5. Geen automatische historische mapping, geen recept- of uitvoeringswijziging. 0131 baseline run 789 op aac6447 groen. 0132 regressies toegevoegd; afzonderlijke concurrentietest en ingebouwde PostgreSQL-extensiebeschikbaarheid nog open. DATABASE.md blijft 0129. Windows-pakket met extensie expliciet praktisch verifiëren vóór acceptatie.

0132: baseline run 791 op 893fcb2 geslaagd, inclusief schone installatie, schema-equivalentie, historische upgrade en Linux-laptoppakket. F4-114-A09 toegevoegd: twee onafhankelijke transacties, waargenomen PostgreSQL-lock, commit en rollback van eerste schrijver, exacte SQLSTATE en winnaar. Uitvoering volgt gebundeld met 114.5; Windows-pakket blijft praktijkacceptatie.

## 114.5a — persoonlijke catalogusautorisatie

0133: aparte rol resource_catalog_manager (maintenance-domein), permission resource.catalog.manage, geen automatische grants of uitbreiding van bestaande rollen. Voorlopig uitsluitend globale grants; begrensde area/product/equipment-grants matchen niet op NULL-context. Expliciete scopemapping volgt. Eerste slice: persoonlijk equipmentklasse aanmaken en naamcorrectie met verwachte change_no en rijlock, via bestaande actor en authorization_permits; audit via log_config. Alleen twee appfuncties via ACL, interne helper afgesloten. Geen API/portaal of andere catalogusmutaties geopend. Regressies voor ontbrekend bewijs, bestaande rollen, begrensde grant, intrekking, wijzigingsteller en audit. F4-114-A09 uit ad719b4 gebundeld. Runtime en rolregisterintegratie nog open.

Verificatie: baseline run 795 op ee7cc9a groen, 1308/1308 databaseregels, inclusief F4-114-A09 commit/rollback en persoonlijk klassebeheer. Run 793 faalde door enkel dollarteken in rechten.sql; gecorrigeerd in ee7cc9a. Geen Windows-acceptatie uitgevoerd.

## 114.5b — persoonlijke objectmutaties

0134: aanmaken en naamcorrectie van hiërarchieknooppunten, functionele middelen en fysieke assets via zes expliciete functies, dezelfde globale catalogusautorisatie, change_no en rijlock per object, log_config met persoonlijke actor. Geen impliciete scope, geen verplaatsing, geen wijziging identiteit, geen directe tabelrechten of nieuwe gebruikerstoekenning. Regressies voor ongeldige ouder/locatie, unieke identiteit, verouderde teller, audit en weigering van bestaande/begrensde rollen. Runtimeverificatie open; koppelingen volgen 114.5c.

## 114.5c — persoonlijke koppelingen

0135: klassekoppeling uitsluitend toevoegen; permanente UUID voor bestaand log_config naast samengestelde primaire sleutel. Bestaande koppelingen krijgen een UUID zonder verzonnen historische actor. Assettoewijzing opent een halfopen interval en kan eenmaal worden afgesloten via atomische UPDATE op de open rij. Bestaande exclusieconstraint, identiteits- en historieguards blijven intact. Geen verwijdering, heropening, automatische receptmapping of nieuwe grants. Alleen globale persoonlijke autorisatie; expliciete tijdstippen, geen automatische overdracht. Audit van nieuwe koppelingen en afsluitingen via log_config. Runtimeverificatie 0134/0135 gebundeld open.

## 114.5d — expliciete scopemapping

Run 797 op 5b078c8 groen (1364/1364); 0134/0135 technisch geverifieerd. 0136 voegt lege, uitsluitend door vertrouwde database-eigenaar beheerde, onveranderlijke scopekoppelingen toe. Geen automatische codeherkenning, geen productcontext, geen app-tabelrechten. Hiërarchie en middelencontext uit database afgeleid; klasse- en assetidentiteit globaal. Nieuwe area zelf vereist globale autorisatie (nog geen mapping); kinderen kunnen via gebiedsscope. Openen van assettoewijzingen blijft globaal tot een expliciet overdrachtscontract voor bron- en doelscope beschikbaar is; afsluiten via toegewezen middel. Geen verplaatsing, geen wijziging of verwijdering van mapping. App-beheer van mapping en rolregisterintegratie nog open. Runtimeverificatie open.

0137: aparte security-rol resource_scope_administrator met resource.scope.manage, geen automatische grants of uitbreiding bestaande rollen; uitsluitend globale persoonlijke toevoeging van mappings via twee functies. Bestaande functiescheiding verhindert combinatie met inhoudelijk beheer. Geen wijziging/verwijdering; API/UI-integratie en runtimeverificatie open.

Rolregisterbroncontrole: security.mjs accepteert rolcode, authorization/policy.ts gebruikt domein en permission, access.ts projecteert databasepermissions en invoer/src/rechten.ts gebruikt permissioncodes. Geen vaste rollenallowlist in deze onderdelen. Extra SQL- en TypeScript-regressies voor rolregister en gemengde domeinen toegevoegd. Specifieke API/UI-bediening volgt 114.6. Runtimebewijs open.

## 114.5 — technisch bewijs

Run 803 op e818619: 1388/1388 databaseregels, 894 beheertoolwaarden, API-autorisatie, schema-equivalentie, upgrade en Linux-pakket geslaagd. Run 801: 1387/1388, uitsluitend verouderde roltelling, gecorrigeerd in e818619. Geen Windows-praktijkacceptatie of integrale faseacceptatie. 114.5 technisch afgerond; 5/7 binnen #114, 5/20 fase 4.

## 114.6a — beveiligde leesprojecties

0138: persoonlijke catalogusprojectie op vertrouwde scope, alleen zichtbare hiërarchieknooppunten, middelen, koppelingen en hun assethistorie; globale klassen als keuzereferentie bij concrete toegestane context. Geen buiten-scope assethistorie of directe tabellezing. Begrensde projectie kan ontbrekende ouder-/locatie-ID's bevatten; UI mag die niet automatisch buiten scope ophalen. Securityprojectie uitsluitend voor mappingdoelen en bestaande mappings, geen assets of classificatie. Geen automatische grants. Eerste SQL-regressies toegevoegd; runtime en API/UI open. Geen paginering in deze eerste projectie; schaalbaarheid evalueren in 114.6b.

## 114.6b — API-interface

/resources: twee leesroutes, vier creatieroutes, vier naamcorrecties met expected_change_no, klassekoppeling, assetopening/-afsluiting en twee scopecreaties. Persoonlijke sessie en transactie, uitsluitend vaste SQL-functies met parameters; geen clientactor of client-scope. 23P01 wordt 409 en 22004 wordt 422. Eerste projectie zonder paginering blijft expliciet beperkt tot pilotomvang; geen gemeten schaalbaarheid. UI en API-regressies volgen. Typecheck, OpenAPI en runtimebewijs open.

## 114.6c-e — portalen en regressies

8edfd66: afzonderlijk resourceCatalog-menusignaal, geen uitbreiding globale/productrechten. 1a6cd6c: native Maintenance-middelencatalogus met B+ kaarten, tabellen, formulieren, change_no en route-/sessiebewaking. Globale identiteitmutaties en assetopening alleen bij globale projectie. 4f5378c: afzonderlijk globaal security-scopemappingscherm in Beheer, alleen toevoegingen, expliciete bevestiging. 0d9ff3a: integratieregressies tegen echte database met beperkte applicatierechten; b19e34e: browserregressies in bestaande portal-navigation.mjs met fictieve API. Broninspectie op b19e34e, geen runtimebewijs. Volledige lokale broncheckout en PostgreSQL niet beschikbaar; typecheck, OpenAPI, SQL/API en browserbewijs nog open. Geen aparte nieuwe workflow; bestaande gerichte baseline en schermtest gebruiken. Geen paginering of gemeten schaalbaarheid; Windows-praktijkacceptatie en integrale faseacceptatie blijven open.

## 114.6 — technisch bewijs

Op broncommit 7cf15a1: run 812, job 140682312458, 1396/1396 databaseregels en 131/131 API-tests geslaagd, schema-equivalentie, API-typecheck, OpenAPI, upgrade/herstel en Linux-pakket groen. Run 813, job 140690959588: Node.js 22, frontendbuilds, B+ componenten, bestaande portaalregressies en expliciete F4-114 browserregressie (begrensd/globaal, directe routeweigering, onafhankelijke mapping en bevestiging) groen. Browserbewijs met fictieve API; geen volledige end-to-end Windows-praktijkacceptatie of schaalbaarheidsbewijs. Diagramruns 39/40 overgeslagen. 114.6 technisch afgerond; 6/7 binnen #114, 6/20 fase 4. 114.7 integratie/acceptatie volgt. Geen merge of release.

## 114.7 — technische integratieafsluiting

Run 816 op a12129041a00005b79e0f6698514ed05b3a69f6c, base 9ceba898c8d04115253cb060a75d9206a6e0a65f, job 140702129446: 1396/1396 databaseregels, 131/131 API-tests, schone installatie, schema-equivalentie, beperkte ACL, beheer/backup/herstel en Linux-pakket geslaagd. Expliciete F4-114-A11 upgrade vanaf gepubliceerde 0129 naar 0138 geslaagd, bestaande gebruikers en grants behouden, geen automatische mapping, beperkte ACL en pre-upgradebackup. Historische upgrade 0035 naar 0138 eveneens groen. A01–A10 aantoonbaar in SQL-regressies; A11 in upgradejob. Browserbewijs 813 op 7cf15a1 blijft relevant omdat uitsluitend documentatie en het historische upgradetestscript daarna zijn gewijzigd. Geen nieuwe browseruitvoering op a121290 geclaimd. Diagramrun 41 overgeslagen. #114 7/7 technisch afgerond, fase 4 7/20 (35%). Geen gemeten schaalbaarheid, Windows-praktijkacceptatie, volledige faseacceptatie, merge, release of pilotclaim. Volgende stap 115.1.


## 115.1 — ontwerpcontract getypeerde eigenschappen

Voortbouwen op 0138 en het geverifieerde #114. Voorgestelde eerste slice: equipment_property_definition (stabiele UUID/code, naam, expliciete quantity_kind en vaste measurement_unit per definitie), equipment_capability (unieke combinatie equipment en definitie), equipment_capability_revision (append-only positieve revisienummers, exacte eindige numeric, persoonlijke actor, vastleggingstijd en bron/reden). Samengestelde FK naar measurement_unit(quantity_kind_id,id) borgt eenheid/grootheid; waarden gebruiken uitsluitend de vaste eenheid van de definitie. Geen impliciete conversie, geen vrije eenheid, geen dubbele actuele waarden; actuele revisie is hoogste revisienummer, geen terugdatering of fysieke inzetbaarheid afleiden. Negatieve en nulwaarden zijn generiek mogelijk (bijvoorbeeld temperatuur); eigenschapsspecifieke grenzen pas na expliciet contract. Geen tekst/boolean-capabilities in deze numerieke slice. Definitiecode, grootheid en eenheid onveranderlijk; geen verwijdering van historie of identiteit. Correcties uitsluitend nieuwe revisie met verwachte vorige revisie en rijlock op capability; eerste creatie atomair. Definities globaal catalogusbeheer, middelwaarden via bestaande resource_scoped_actor op vertrouwde equipment-context. Geen directe app-tabelrechten, geen automatische grants, geen koppeling aan voorlopige receptcodes of bestaande legacygegevens. Persoonlijke mutatiefuncties, beperkte leesprojectie en UI volgen binnen #115; geen automatische geschiktheid, capaciteit of receptvrijgave in 115.1. Testcriteria F4-115-A01 juiste grootheid/eenheid, A02 vreemde eenheid en niet-eindige waarden geweigerd, A03 unieke identiteit/revisies en historie, A04 persoonlijke scope/audit/ACL en stale/concurrency, A05 geen automatische mapping of gewijzigde recepten. Eerst intern schema en regressies, daarna beveiligde mutaties; bundel CI met samenhangende wijziging. Ontwerp, nog geen DDL of runtimebewijs.

## 115.1b — intern fundament 0139

Drie nieuwe tabellen voor numerieke eigenschappen, vaste grootheid/eenheid via samengestelde FK, unieke middel/eigenschap-combinatie, eindige exacte numeric en onveranderlijke oplopende revisies. Revisieguard serialiseert inserts per capability met rijlock. Geen automatische conversie of mapping, geen app-ACL. Alleen intern fundament: een eigenaar kan nog een lege capability aanmaken en actor/tijd invoeren; persoonlijke atomaire creatie en gevalideerde actor, stale-controle en audit volgen 115.1c. Definitie voorlopig volledig onveranderlijk. Generatorclassificatie bijgewerkt; afgeleide diagrammen uitgesteld. SQL-regressies en runtimebewijs open.

## 115.1c — persoonlijk beheer 0140

Globale eigenschapsdefinitiecreatie, begrensde atomaire capabilitycreatie met eerste revisie en begrensde revisietoevoeging via drie expliciete SECURITY DEFINER-functies. Actor uit persoonlijke transactie, scope uit het middel, tijd serverzijdig, reden verplicht, rijlock en verwachte revisie; bij ongeldige eerste revisie geen lege identiteit. Audit via log_config bij alle drie tabellen; revisie bevat tevens persoonlijke actor en tijd. Geen mutatie van historie, geen herdefinitie of verwijdering, geen directe app-tabelrechten, geen nieuwe grants aan gebruikers. Uitsluitend uitvoerrechten voor mes_app. Leesprojectie en UI volgen later; regressies en runtimebewijs open.

## 115.1d-e — technisch bewijs

Broncommit b259a7dcbbfd2a00386b7dc0ccd1079db135bed5, base 9ceba898c8d04115253cb060a75d9206a6e0a65f: run 823 (46059065859), job 140708666192 groen. 1442/1442 databaseregels (46 extra t.o.v. 1396), F4-115-A01–A05: exacte numerieke waarden, vaste eenheid, afwijkende grootheidsemantiek, niet-eindige waarden, atomaire eerste creatie, historie, scope, functiescheiding, ACL, intrekking en audit. Twee onafhankelijke eigenaartransacties bewezen waargenomen lock, commit/rollback, verwachte uitkomst en juiste historie; persoonlijke stale-controle afzonderlijk getest. 131/131 bestaande API-regressies, 966 beheertoolwaarden, schema-equivalentie, upgrade 0129 naar 0140, Linux-pakket geslaagd. Diagramrun 42 overgeslagen. 115.1 technisch afgerond (1/7 #115, 8/20 fase 4). Geen nieuwe HTTP/UI-capabilityfunctionaliteit of browserbewijs geclaimd; leesprojectie/UI volgen binnen #115. Geen schaalbaarheids-, Windows-, fase- of pilotacceptatie. Volgende stap 115.2.


## 115.2a — ontwerpcontract capaciteit en geschiktheid

Bronbasis 0140, 115.1 bewezen in run 823. Bestaande capaciteit_stap is product-/processtapgebonden doorzet (kg/dag of items/dag); niet gelijk aan technische middelcapaciteit per batch of andere fysische capaciteit. Bestaande recipe_equipment_requirement (0106) bevat voorlopige klassecode, aantal, optionele positieve minimumcapaciteit en eenheids-ID, maar nog geen definitieve middel-/eigenschapsmapping. Receptkoppeling en wijziging van vrijgavepoort blijven 116.3; planning en feitelijke toewijzing blijven latere fasen.

Besluit voor deze slice: geen tweede numerieke bron. equipment_capacity wordt een expliciete relatie tussen functioneel middel en een bestaande capability die als technische capaciteit is aangewezen; één aangewezen capaciteit per middel en eigenschapsdefinitie, geen automatisch gekozen capaciteit uit naam/code, geen automatische optelling over meerdere middelen. Gebruik de vaste eenheid en actuele revisie van de capability. Voor aangewezen capaciteit is de waarde strikt positief; aanwijzing en latere revisies moeten deze regel onder dezelfde capability-rijlock afdwingen, ook bij concurrentie. Historische revisies vóór aanwijzing blijven behouden. Eenheid/grootheid en identiteit blijven onveranderlijk. Aanwijzing is persoonlijke scoped mutatie met audit; aanvankelijk append-only, geen intrekking/herclassificatie zonder afzonderlijk lifecyclecontract.

Geschiktheid is een interne deterministische vergelijking van een expliciet middel met een expliciete klasse-ID en optionele eigenschapsdefinitie, vaste eenheids-ID en numerieke grens. Voorstel operatoren minimum (>=), maximum (<=) en gelijk (=) met exacte numeric; capaciteitseisen uitsluitend minimum en positief. Geen impliciete conversie, ook niet tussen eenheden van dezelfde grootheid; eenheidsmismatch en ontbrekende capability/capaciteitsaanwijzing leveren onbekend/niet aantoonbaar op, nooit geschikt. Klasse ontbreekt: niet geschikt. Retourneer afzonderlijke criteria, status geschikt/ongeschikt/onbekend, gebruikte revisie-ID en geen automatische vrijgave. Vergelijk uitsluitend technische definitiegeschiktheid; actuele status, beschikbaarheid, onderhoud, hoeveelheid middelen, combinaties, receptversie, tijdvenster en allocatie zijn niet bewezen. Geen veiligheids- of procesgrensclaim. Geen app-ACL op interne helper; persoonlijke leesprojectie volgt 115.6. Geen wijzigingen aan legacy of recepten.

Voor 0141 eerst relatie, guards en regressies; daarna persoonlijke aanwijzing en interne vergelijking in afzonderlijke migratie. Testcriteria F4-115-B01 expliciete capaciteit en actuele revisie; B02 positieve eindige waarde, geen dubbele/onjuiste koppeling, serialisatie bij revisie/aanwijzing; B03 persoonlijke scope, audit, ACL; B04 klasse, exacte grenzen, ontbrekende waarden en afwijkende eenheid, geen automatische geschiktheid; B05 bestaande legacy/receptgegevens en vrijgaveblokkade ongewijzigd. Geen volledige suite per commit; gebundelde baseline na samenhangende implementatie. Ontwerpcontract, nog geen SQL of runtimebewijs.

## 115.2b — intern fundament 0141

Equipment_capacity verwijst uniek naar een bestaande capability, zonder tweede waarde of eenheid. Aanwijzing vereist actuele positieve eindige waarde; latere revisies van aangewezen capaciteit eveneens. Beide schrijfpaden vergrendelen dezelfde capabilityrij vóór het lezen van de actuele toestand. Expliciete beperking tot read committed voor beide schrijfpaden om verouderde snapshots bij hogere isolatieniveaus uit te sluiten; geen wijziging aan andere transacties. Aanwijzing is append-only, geen directe app-ACL, geen automatische mapping. Persoonlijke aanwijzing en audit volgen 115.2c; vergelijking en regressies open, inclusief beide volgordes van concurrentie. Generatorclassificatie bijgewerkt; geen diagramgeneratie. Nog geen runtimebewijs.

## 115.2c — persoonlijke capaciteitsaanwijzing 0142

resource_capacity_designate(uuid,integer) autoriseert via de persoonlijke transactie en de vertrouwde, onveranderlijke middelcontext van de capability. Onbekend doel wordt geweigerd. Read committed, gedeelde capability-rijlock en verwachte actuele revisie voorkomen aanwijzing van een inmiddels gewijzigde waarde. Positiviteit en uniciteit blijven door 0141 afgedwongen. Persoonlijke audit via log_config bij INSERT. Geen directe tabelrechten, alleen functie-uitvoering mes_app; geen nieuwe rollen of automatische grants, geen wijziging of verwijdering van aanwijzing. Geen nieuwe numerieke bron. Vergelijking, regressies en runtimebewijs volgen.

## 115.2d — interne geschiktheidsvergelijking 0143

Equipment_suitability vergelijkt één expliciet middel met een klasse-ID en optioneel één numeriek criterium (minimum, maximum, equal). Capaciteit vereist positieve minimumgrens en expliciete aanwijzing. Onbekende middel-/klasse-ID levert onbekend; bekende klasse zonder koppeling ongeschikt. Ontbrekende definitie, capability/revisie, aanwijzing of afwijkende eenheid levert onbekend; ongeldige criteriumcombinaties SQLSTATE 22023. Bewezen negatief criterium heeft voorrang op onbekend. Exacte numeric-vergelijking, grens en waarde als decimale tekst in JSON, gebruikte revisie-ID, afzonderlijke criteriumresultaten. STABLE, consistente statement-snapshot, geen SECURITY DEFINER of app-uitvoerrecht, geen mutatie, geen conversie, geen recept- of vrijgavewijziging. Meerdere criteria/hoeveelheden en operationele beschikbaarheid zijn niet beoordeeld. Regressies en runtimebewijs open.

## 115.2e — verificatie uitgesteld

Run 830 op 66a9666 faalde bij schone installatie door een extra aanhalingsteken na numeric in 0143. Beide SQL-bronnen gecorrigeerd op 372859c; statische vergelijking van de functie geslaagd. Runtimebewijs voor F4-115-B01–B05 ontbreekt. Actions-quotum uitgeput; geen nieuwe expliciete testtriggers tot capaciteit terug is. Repository blijft privé. Implementatie 9/20, technisch geverifieerd 8/20. Geen merge of release.

## 115.3a — ontwerpcontract technische middelenstatus

Technische status is onafhankelijk van technische geschiktheid (115.2), operationele stilstand (115.5) en receptvrijgave (116.3). Zonder persoonlijke statusregistratie is de status onbekend, nooit impliciet beschikbaar. Eerste slice: append-only equipment_status_history met UUID, equipment_id, positieve oplopende revisie, status blocked of available, verplichte niet-lege reden, persoonlijke actor en serverzijdige vastleggingstijd. Geen terugdatering, geen automatische initiële status, geen wijziging of verwijdering van historie. Eerste registratie mag expliciet blocked of available zijn; volgende registratie moet van status wisselen. Available betekent uitsluitend technische vrijgave in MES, geen bewijs van fysieke veiligheid, actuele inzetbaarheid, reiniging of productgeschiktheid; geen vervanging van LOTO/procedures. Geen automatische vrijgave bij einde operationele stop of onderhoud.

Serialiseer per equipment met rijlock, read committed, verwachte actuele revisie (0 bij eerste registratie); stale en dubbele overgang weigeren. Actuele status uit hoogste revisie, niet uit tijdstempel. Statusmutatie krijgt afzonderlijke maintenance-permission; geen impliciete uitbreiding van catalogusbeheer, security of bestaande gebruikersgrants. Exacte roltoekenning en vertrouwde scopemapping uit 0136 hergebruiken na broninspectie; bestaande maintenance.downtime.read is geen mutatierecht. Geen directe app-tabelrechten. Persoonlijke actor uit execution_transaction_actor, audit via log_config; geen vrije actor/tijd vanuit client. API/leesprojecties volgen 115.6 en 116.2.

F4-115-C01 onbekend/expliciete eerste status en opeenvolgende overgangen; C02 verplichte reden, geldige status, onveranderlijke historie en serverdatum; C03 persoonlijke bevoegdheid, scope, intrekking, ACL en audit; C04 stale, concurrerende eerste registratie/overgang, commit/rollback; C05 geen automatische wijziging van operationele stilstand, geschiktheid of receptvrijgave. Eerst 0144 intern fundament, daarna persoonlijke mutatiefuncties en regressies. Runtimebewijs gebundeld zodra testcapaciteit beschikbaar is. Geen SQL geïmplementeerd in deze ontwerpstap.

## 115.3b — intern fundament 0144

Append-only equipment_status_history met unieke middel/revisie, expliciete blocked/available, verplichte reden en actor-FK. INSERT-guard serialiseert op middelrij bij read committed, eist opeenvolgende revisie en wisselende status, overschrijft vastleggingstijd serverzijdig. Geen initiële status of automatische vrijgave; geen app-grants. Eigenaar kan nog actor-ID kiezen; persoonlijke actorbinding, afzonderlijke permission, audit en regressies volgen 115.3c. Generatorclassificatie bijgewerkt; geen diagramgeneratie. Statische broncontrole, geen PostgreSQL-runtimebewijs. Voortgang 9/20 geïmplementeerd, 8/20 technisch bewezen.

## 115.3c — persoonlijke statusmutatie 0145

Afzonderlijke rol resource_status_manager met resource.status.manage in maintenance-domein, geen automatische gebruikersgrants of uitbreiding bestaande rollen. resource_status_set(uuid,integer,text,text) leidt actor uit persoonlijk transactiebewijs en scope uit bestaande expliciete mappings af. Onbekend middel geweigerd, geen productcontext; read committed, middelrijlock, hercontrole bewijs/bevoegdheid na lock, verwachte revisie (0 bij eerste registratie), actor en tijd serverzijdig. Audit via log_config. Alleen functie-uitvoering mes_app; bestaande D100 tabel-ACL-beperking blijft gelden. Geen API/portaal of automatische vrijgave. Centrale roltelling aangepast van 15 naar 16. Specifieke regressies volgen 115.3d; runtimebewijs open.
