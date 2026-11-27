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
