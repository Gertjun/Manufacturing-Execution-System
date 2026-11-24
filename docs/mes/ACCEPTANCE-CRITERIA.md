# Acceptatiecriteria

D89 G01–G08 en D87/D88. Voor elke PR scenario's vooraf definiëren, gericht testen, Node 22 selectief op concept-PR via compatibiliteit-test, beide suites op actuele head/base bij acceptatie-test (D90). Geen testverzwakking; eigenaar merget. Documentatie-only volgens actuele allowlist; de acht expliciete docs/mes-bestanden vallen onder de documentatie-uitzondering. Geen versie/release voor ontwerpdocumentatie.

| Poort | Minimaal bewijs |
|---|---|
| 0 | 69 besluiten, documentatie en roadmap compleet; normmatrix ontwerpstatus |
| 1 | Meerdere rollen, scope/kwalificaties, negatieve API/DB autorisatietests, geen zelftoekenning, regressie bestaande functies |
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
