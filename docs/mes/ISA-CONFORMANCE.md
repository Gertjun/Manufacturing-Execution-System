# ISA-conformiteitsmatrix

D89 A12/G07. Status ontwerp, niet geverifieerd. Volledige toepasselijke normteksten en exacte edities/clausules nog te verkrijgen; geen formele claim. Per rij implementatie-PR, test-ID, resultaat en afwijking invullen bij faseacceptatie.

| Normmodel | Scope | Besluiten | Fase | Status / bewijs |
|---|---|---|---|---|
| ISA-95 Part 1/2 hiërarchie en resources | Binnen | A02,A04,A08,M07,M08 | 1–4 | Ontwerp; geen bewijs |
| ISA-95 Part 3 acht activiteiten | Binnen productie | A03,P06 | 2–11 | Ontwerp; geen bewijs |
| ISA-95 quality operations | Productiegebonden | R12,P09 | 8 | Ontwerp; geen bewijs |
| ISA-95 inventory operations | Verbruik/genealogie | M09 | 9 | Ontwerp; geen bewijs |
| ISA-95 maintenance operations | Beschikbaarheid/stilstand | P13 | 4 | Ontwerp; geen bewijs |
| ISA-95 Part 4/5/6 gegevensuitwisseling | Later | A11,G07 | 12 | Ontwerp; geen bewijs |
| ISA-88 Part 1 fysieke/procedurele/procesmodellen | Binnen MES | A04,R06,P07 | 2–6 | Ontwerp; geen bewijs |
| ISA-88 Part 1/2 Master/Control Recipe | Binnen | A05,A06,R01–R05 | 2–6 | Ontwerp; geen bewijs |
| ISA-88 Part 3 General/Site Recipes | Voorbereid, buiten eerste scope | A02 | Later | Scopekeuze |
| ISA-88 Part 4 Batch Production Records | Binnen | A10,R09,R10,M06 | 7–8 | Ontwerp; geen bewijs |
| Automatische batchbesturing | Buiten MES, niveau 2 | A02,A11 | 12 interface | Scopekeuze |

Bronnen: zie BLUEPRINT. Vierogen, MOC, offline en specifieke portalen zijn eigen ontwerpkeuzes, niet automatisch normvereisten. Bij afwijking rationale en acceptatie vastleggen.

Fase 1 / PR #6: afzonderlijke autorisatiebeslismodule voor rollen, scope en kwalificaties (P01–P05, M08); unit-tests toegevoegd, nog niet uitgevoerd of aangesloten op productie-API/DB. Geen conformiteitsbewijs.

D98: productie vanuit vrijgegeven Job Orders, batchidentiteit uit geautoriseerd werk (A09/P06/R04). Architectuurreview van legacy-besluiten in DECISIONS.md. Openbare ISA/OPC-modellen ondersteunen de scheiding van werkopdracht en werkelijke uitvoering; specifieke vrijgave- en rolregels zijn projectkeuzes. Nog geen implementatie- of acceptatiebewijs voor D98.

D99: Geert heeft de volledige legacy-besluitenreview goedgekeurd; overgang per fase en uitstel van niet-kernfunctionaliteit zijn nu bindend. Architectuurmapping blijft ontwerpbewijs, geen formele normconformiteit. Implementatie en testbewijs per fase nog vereist.


Fase 1 / PR #6, technische tussenbeoordeling (D100/D101): Run [45572488766](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45572488766), job 139062300483, head 6e332599aafc949b8cca94c401c4d0c21579d69c, base 31c86973bf13848cba44fc38785084953fe65e39: gehele gerichte PostgreSQL-baseline groen, inclusief startinventaris, mislukte herstelcontrole/cleanup, historische upgrade 0035–0093, 12/12 security, 10/10 autorisatie, 117/117 API en Linux-pakket; documentatie 45572480062 groen. Geen volledige acceptatie of Windows-bewijs.
Deels geïmplementeerde personnel/qualification-ondersteuning (M08/P01–P05), productgebonden autorisatie en functiescheiding ondersteunen het ontwerp; fysieke hiërarchie en betrouwbare area/equipmentcontext volgen fase 4. Geen bewijs voor volledige ISA-95 Part 1/2 of ISA-88-conformiteit. Normteksten, definitieve procesmodellen en integrale faseacceptatie blijven open.

Fase 1 / D102: Run [45575488676 (#499)](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45575488676), job 139072267943, head de213112f706f7bbcbd07b4928c93e36e6d7ba02, base 31c86973bf13848cba44fc38785084953fe65e39: gerichte PostgreSQL-baseline geslaagd; schone installatie, schema-equivalentie 0001–0094, beperkte rechten, historische upgrade 0035–0094 met behoud van tien historische tabellen en zonder automatische legacy-grants, D102 eenmalige initialisatie, 14/14 security, 10/10 autorisatie, 117/117 API, back-up/herstel/rollback en Linux-laptoppakket. Documentatiecontrole 45575458558 geslaagd. Geen volledige Node 26-acceptatie of Windows-praktijkbewijs. Architectuurmapping blijft ontwerpbewijs; geen formele ISA-conformiteitsclaim.

D105: fase 3 is een projectmatige portal/UI-acceptatiepoort, geen nieuwe ISA-normclaim; fasekolom hierboven is hernummerd, normscope en bewijsgrenzen ongewijzigd.


### D106 — aanvullende mapping (ontwerp, geen conformiteitsbewijs)

| Onderwerp | Aansluiting | Fase / taak | Afbakening |
|---|---|---|---|
| Receptformule, berekende parameters | ISA-88 Master/Control Recipe | 2 #141; 6 #142 | Ondersteunde normconcepten; eigen schaalregels en engine, exacte normclausules nog te toetsen |
| Materiaalhoeveelheden en eenheden | ISA-88 formule, ISA-95 materiaalmodel; SI/ISO 80000 aanvullend | 2 #141; 6 #142 | Gecontroleerde dimensies/conversies als projectkeuze |
| Feitelijk verbruik, output en transformaties | ISA-95 materiaal-/operationsmodel, ISA-88 recept en records | 9 #143 | Automatische massabalans en rendement eigen uitbreiding |
| Productieprestatie en historische analyse | ISA-95 Manufacturing Operations; ISO 22400 waar toepasselijk | 11 #144 | Eigen KPI- en analysetoepassing |

Geen formele ISA-, ISO- of SI-conformiteitsclaim. Bij acceptatie per onderwerp de concrete normeditie/clausule, ondersteund concept versus projecteis, implementatiebewijs en afwijkingen afzonderlijk beoordelen.

## Fase 2 / PR #7 — implementatiebewijs, geen normcertificering

Bewijs 26 november 2026: integrale CI [#665](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45765379770), head `2ebc36e0e0316c3edb34535fbc9aefe97c5fc12d`, schema 0128, beide Node-suites en Chrome groen. Gerichte baseline [#671](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45770644723), head `c7dce4f789acf84926a4f2e4a68f3bd669432fd9`, schema 0129, job 139742179386, base voor beide `ea3b78bc938647140b4e228e9382761504518906`: 1174/1174 DB, 16/16 security/beheertools inclusief bronmanifest, 10/10 autorisatiemodule, 129/129 API, schone installatie, migratiegelijkheid, historische upgrade 0035→0129 (tien historische tabellen, geen automatische grants), herstel en Linux-pakket groen. Geen integrale CI op 0129 of Windows-praktijkacceptatie geclaimd.

| Conceptuele normrelatie | Implementatie / testbewijs | Afbakening |
|---|---|---|
| ISA-95 materiaalmodel | #109 materiaalidentiteit en onveranderlijke revisies, DB/API-regressies | Werkelijke materiaalstatus, verbruik en genealogie later |
| ISA-88 proceduremodel | #110/#103 procedure/unit procedure/operation/phase, versiegebonden relaties en afhankelijkheden, DB/API-regressies | Fysieke resourcecontext fase 4 en uitvoering fase 6 |
| ISA-88 Master Recipe/formule | #111/#141 versiegebonden parameters, materiaalvereisten, instructies, eenheden en schaaldefinities | Control Recipe en rekenengine fase 6; onbewezen complexe regels blokkeren vrijgave |
| Gecontroleerd receptbeheer | #112 D108/D109 MOC, onafhankelijke beoordeling, vrijgave, intrekking en historische selectie; #671 | MOC-matrix, wachtwoordherbevestiging en lotnorm zijn projectkeuzes, niet als letterlijke ISA-eis geclaimd |
| ISA-95 operations-context | #113 native Engineering-portaal en gecontroleerde bronvoorbereiding | Geen volledige acht-activiteitenimplementatie; geen echte bronmigratie |

De bovenste normmatrix blijft een ontwerp-/scopematrix; deze paragraaf legt technisch bewijs per concept vast. Concrete normeditie en clausuleverificatie ontbreken nog; geen formele ISA-, ISO- of SI-conformiteitsclaim. Definitieve integrale CI en technische acceptatie blijven open.
