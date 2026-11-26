# MES Blueprint

Vastgestelde architectuurbaseline D89 (A01–A12). Doel: modulair MES voor chemische batchproductie, ISA-95 niveau 3. Niveau 4 ERP, niveau 2 DCS/SCADA/PLC, niveau 1 instrumentatie, niveau 0 fysiek proces. Geen veiligheidsbesturing vanuit MES. Production Operations volledig binnen gekozen scope; Quality productiegebonden; Inventory verbruik en traceerbaarheid; Maintenance beschikbaarheid en stilstand, geen volledig WMS/CMMS/LIMS/ERP.

Acht activiteiten: Definition Management (MBR), Resource Management (middelen, materialen, personeel), Detailed Scheduling, Dispatching, Execution Management, Data Collection, Tracking en Performance Analysis. ISA-88 procesmodel (process/stage/operation/action), procedureel (procedure/unit procedure/operation/phase), fysiek (process cell/unit/equipment module/control module); geen gedwongen 1-op-1 mapping. General/Site Recipe voorbereid, Master Recipe en Control Recipe binnen scope. Enterprise/site/area/cell/unit; lagere niveaus indien nodig. Modulaire PostgreSQL/API, lokale offline invoer.

Legenda: blauw = definitie, oranje = uitvoering of besluit. Oranje pijlen geven conceptuele procesafhankelijkheden aan, geen fysieke FK of automatische vrijgave.
![MES-architectuur van Master Recipe en Production Order tot uitvoering en vrijgave](../diagrams/rendered/architecture.svg)

[Open de SVG op volledig formaat](../diagrams/rendered/architecture.svg).

<details>
<summary>Mermaid-bron</summary>

```mermaid
%%{init: {"theme":"base","themeVariables":{"lineColor":"#B45309","primaryTextColor":"#1B2430","fontFamily":"Arial, sans-serif"}}}%%
flowchart TD
    M[Master Recipe / MBR] --> J[Job Order]
    O[Production Order] --> J
    J --> C[Control Recipe]
    C --> E[Execution]
    E --> B[EBR]
    B --> Q[Quality Release]
    E --> G[Material Genealogy]
    classDef structuur fill:#E7EEF6,stroke:#0B2E59,color:#0B2E59
    classDef uitvoering fill:#FDEBD9,stroke:#B45309,color:#1B2430
    classDef ondersteuning fill:#F4F7F9,stroke:#6B7785,color:#1B2430
    class M structuur
    class O,J,C,E,B,Q,G uitvoering
    linkStyle default stroke:#B45309,stroke-width:2px
```

</details>

Referenties: [ISA-88](https://www.isa.org/standards-and-publications/isa-standards/isa-88-standards), [ISA-95](https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard), [OPC UA ISA-95](https://reference.opcfoundation.org/specs/OPC-10030/full), [Job Control](https://reference.opcfoundation.org/specs/OPC-10031-4/full). Openbare modellen, geen formele conformiteitsverklaring.

Ontwerpen: [Terminologie](TERMINOLOGY.md), [MBR/EBR](MBR-EBR-DESIGN.md), [Datamodel](DATA-MODEL.md), [Migratie](MIGRATION-STRATEGY.md), [Rollen en processen](ROLES-AND-PROCESSES.md), [Normmatrix](ISA-CONFORMANCE.md), [Acceptatie](ACCEPTANCE-CRITERIA.md). Enige planning: [ROADMAP](../../ROADMAP.md). Enige besluitenregister: [DECISIONS](../../DECISIONS.md).

D105: na Master Data & Recipe Management en vóór Resource Management wordt de portalarchitectuur geharmoniseerd: centrale registratie en één zichtbaarheidbeslissing op actuele permissions, onafhankelijke route-/API-/DB-handhaving, gedeelde UI-componenten en industriële bruikbaarheid. Fase 3 is een afzonderlijke acceptatiepoort; fysieke resources en volgende domeinen schuiven één fase op. Geen wijziging in ISA-procesmodel, domeinafhankelijkheden of fase-2-scope. Zie ROADMAP en ACCEPTANCE-CRITERIA.

D111: fase 2 sluit technisch af na integrale regressies, audit, correcties en afzonderlijke technische acceptatie. De handmatige Windows-praktijkacceptatie van fase 2 wordt gecombineerd met die van fase 3 na UI-harmonisatie; geen uitstel van automatische functionele, beveiligings-, migratie- of pakketregressies. Fase 3 mag starten na expliciete technische acceptatie van de vastgelegde fase-2-baseline. Voorstel voor één officiële release na gecombineerde praktijkacceptatie; merge-/release-strategie en toestemming blijven bij opdrachtgever. Geen fase 4 vóór gecombineerde acceptatie en officiële release. Fase 1 en pilotpoort ongewijzigd.

Fase 3 vertrekt vanaf technisch geaccepteerde fase-2-head 8987ea7. Centrale registratie moet ook externe applicatieroutes en afzonderlijke capability-tegels ondersteunen; route/API/DB-handhaving blijft zelfstandig. Zie [VISUAL-STYLE.md](VISUAL-STYLE.md) en ROADMAP. Geen domeinuitbreiding.

D112: fase 2 technisch gemerged naar main met behoud van exacte geaccepteerde tree. Fase 3 vergelijkt met main; praktijkacceptatie en publicatie blijven aparte poorten.
