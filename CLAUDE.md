# CLAUDE.md – werkafspraken voor Claude

Dit zijn de afspraken uit Geerts andere projecten (Vaste Lasten, Cryptotracker, PWA-Core en de andere apps), aangepast aan dit fabrieksplatform. Bij twijfel gaan de besluiten in `DECISIONS.md` voor.

## Aan het begin van een sessie
1. Lees het blok **Stand** in **`README.md`** (heden), **`ROADMAP.md`** (wat er nog moet), **`DECISIONS.md`** (eerdere besluiten), de **valkuilen** onderaan dit bestand en alleen de bovenste paar versies van **`CHANGELOG.md`**. Lees niet de volledige chatgeschiedenis.
2. Lees daarna alleen de code die je nodig hebt (de rest van `README.md` beschrijft de opbouw).
3. Koppel de GitHub-repository `Gertjun/Manufacturing-Execution-System` met schrijfrechten en haal de laatste versie op (`git fetch origin main`). Kijk of de laatste testrun op GitHub groen is.

## Tijdens het werk
- **Taal en uitleg:** Nederlands, kort en zonder vakjargon. Alle teksten in de schermen zijn ook Nederlands.
- **"Hoe zou je…" of "nog niet bouwen":** eerst uitleggen en wachten op akkoord.
- **Alleen fictieve gegevens.** Nooit echte fabrieksgegevens, wachtwoorden of tokens in code, tests, logs of commits. Testdata komt uit `tools/genereer_testdata.py`.
- **Versies alleen op releaseverzoek** (`MAJOR.MINOR.PATCH`), zie D88:
  - MAJOR als iemand iets moet doen buiten de schermen om: alle pc's tegelijk bijwerken, een database-omzetting met stilstand, opnieuw instellen. Versie 1.0.0 is de start van de pilot met echte data.
  - MINOR voor een nieuwe functie, ook als de database erbij verandert zonder dat iemand iets hoeft te doen.
  - PATCH voor een kleine verbetering of foutoplossing.
  - **Pas bij releasevoorbereiding versie op alle plekken gelijk ophogen** met `tools/zet_versie.sh <versie>` (`VERSIE`, alle `package.json`'s, `api/src/versie.ts`, `gedeeld/versie.ts`).
  - **`CHANGELOG.md`** bijwerken onder `## Unreleased` (roadmappunten in de kop na `·`). Bij releasevoorbereiding deze wijzigingen verplaatsen naar de nieuwe versiekop.
  - **`ROADMAP.md`** in dezelfde commit bijwerken, niet pas aan het eind van de sessie: kopregel (datum en versie), gebouwde punten eruit, de inleiding van de fase en de tijdlijn. Zie "Hoe we deze roadmap bijhouden" onderaan de roadmap. `tests/test_roadmap.sh` moet slagen.
  - Een download of pakket draagt het versienummer in de bestandsnaam (`batch-gui-laptop-0.5.1.zip`).
- **Oudere invoerschermen blijven werken.** Een pc kan offline zijn en een wachtrij hebben uit een oudere versie. Een wijziging aan de API moet die oudere invoer nog accepteren, of het is een MAJOR-versie met de melding "werk alle pc's bij" (D18).
- **Schermen volgen de UI/UX-richtlijnen** (`ui-ux-richtlijnen.md` in het Claude-project) met de afwijkingen en woorden uit D50 en D51. Kleuren, afstanden en maten alleen via `gedeeld/tokens.css`; loop de checklist (§13) na bij elk nieuw of gewijzigd scherm.
- **Regels horen in de database**, niet in de schermen (D9).
- **Databasewijziging = migratie** (D23): nieuw bestand `db/migraties/NNNN_naam.sql`, dezelfde wijziging in `db/schema.sql` plus de regel in `schema_versie`, en `tests/test_migraties.sh` moet slagen. Daarna het plaatje opnieuw maken (`python3 tools/schema_plaatje.py "host=localhost user=postgres"`, D84); `tests/test_schema_plaatje.sh` controleert het. Migraties nooit achteraf aanpassen.
- **Beperkte databasegebruiker** (D24): de applicatie draait als `mes_app`. Heeft een nieuwe functie extra rechten nodig, pas dan `db/rechten.sql` aan; de API-tests draaien met die gebruiker.
- **Uitsluitend documentatie (D87):** met toestemming van Geert mogen zuiver tekstuele wijzigingen direct naar main, zonder software-PR, versieverhoging, release of softwaretests. Alleen de expliciete lijst in `.github/workflows/tests.yml` valt onder deze uitzondering. ROADMAP/CHANGELOG: controleer `tests/test_roadmap.sh` en de versie-koppen vooraf; voeg geen nieuwe versiekop toe zonder software-PR. Voor `docs/DATABASE.md` is `tests/test_schema_plaatje.sh` verplicht. GitHub draait voor deze gekoppelde documenten alleen de relevante documentatiecontrole; gewone tekstcorrecties starten geen workflow. Bij gemengde wijzigingen of twijfel geldt de normale PR-procedure.
- **Testen en acceptatie via PR:** werk op een branch. Draai tijdens ontwikkeling lokaal de relevante tests en laat Node 22 automatisch controleren bij normale PR-wijzigingen; bij concept-PRs alleen op verzoek via `compatibiliteit-test` of `acceptatie-test` (D90). Bundel wijzigingen; start de volledige Node 26-suite pas wanneer de PR inhoudelijk gereed is, door het label `acceptatie-test` toe te voegen (bij herhaling eerst verwijderen). Controleer in Actions dat de acceptatierun geslaagd is voor de actuele PR-head én actuele base; een overgeslagen job is geen acceptatie. Na iedere nieuwe commit of basewijziging opnieuw accepteren. Geert voert de merge uit. PR-head moet de actuele base bevatten. Op main worden beide suites alleen opnieuw gedraaid wanneer bewijs voor exact dezelfde git-tree ontbreekt. Releases uitsluitend op expliciet verzoek (D88). GitHub Free op deze privérepo dwingt de mergevoorwaarde niet technisch af. Relevante lokale database-, API- en schermtests blijven verplicht waar de wijziging die onderdelen raakt. Geen tests uitschakelen of verwachtingen versoepelen om CI groen te maken.
- **Foutanalyse en zuinig testen:** onderzoek eerst de grondoorzaak, lees bij herhaling de workflowhistorie en onderscheid applicatie-, testontwerp- en omgevingsfouten. Test gericht, bundel oplossingen en start pas daarna opnieuw de volledige acceptatietest. Controleer ook workflow-syntaxis en uitvoerbaarheidsmarkeringen van gewijzigde scripts. GitHub Actions-minuten zijn beperkt.
- **Groen op GitHub is niet alles.** De automatische tests bewijzen niet dat offline werken, een echte Windows-pc of het netwerk in de fabriek werkt. Noem praktijktests die niet zijn uitgevoerd altijd expliciet.
- **Release-tags worden nooit achteraf gewijzigd.** Alleen na expliciet releaseverzoek: versie voorbereiden via PR, beide suites op die inhoud laten slagen, mergen en Release handmatig starten met de exacte versie. Release controleert main en testbewijs en bouwt alleen het bijbehorende Windows-pakket. Geen automatische backfill. Bij een fout geen tag verplaatsen; herstel uitsluitend volgens de releaseafspraken.
- Ga je in tegen een besluit uit `DECISIONS.md`? Zeg dat en vraag het eerst.
- **Elk onderwerp op één plek (D41).** Schrijf iets in het document dat die vraag beantwoordt (zie "Waar vind je wat" in `README.md`) en verwijs er elders naar; neem het niet over. Nieuwe taken, adviezen, open vragen en praktijktests gaan met het volgende vrije nummer in `ROADMAP.md`, in de fase waar ze horen.
- Het `README.md` heet altijd `README.md` (niet `LEESMIJ.md`).
- Pin externe GitHub Actions op een vaste commit-SHA.

## Skills (D40)
Geert heeft in zijn account drie skillpakketten geïnstalleerd. Gebruik ze in dit project als het onderwerp erbij past; laad de skill vóór je aan dat onderdeel begint. Ook hier geldt: **alleen fictieve gegevens**, en de afspraken in dit bestand en `DECISIONS.md` gaan voor.

**Bouwen en controleren (`coding-skills`)** – bij twijfel welke past: `coding-skills:start-here`.
| Situatie in dit project | Skill |
| --- | --- |
| Nieuwe migratie die een bestaande kolom, tabel of API-antwoord verandert (oudere invoerschermen, D18/D23) | `expand-contract`, `hyrums-law` |
| Ploegtijden, zomer-/wintertijd, tijdstempels van offline pc's, verschuiven van testdata | `clocks-and-time` |
| Twee pc's of mensen tegelijk op dezelfde batch, lot of lotvoorstel | `isolation-anomalies` |
| Offline wachtrij, dubbele invoer, taken in PostgreSQL | `database-queues` |
| Meetwaarden, toleranties, gemiddelden, Cpk | `floating-point` |
| Trage analyse of lange lijst (lotpaspoort, afwijkingen, logboek) | `query-plans`, `index-design`, `keyset-pagination` |
| Databasegroei, back-ups, onderhoud op de fabrieksserver | `mvcc-and-bloat`, `connection-pooling` |
| Invoer of bestanden van buiten (scanner, uploads, zoekvelden) | `algorithmic-complexity-attacks`, `unicode-pitfalls` |
| Nieuwe npm-pakketten of GitHub Actions | `dependency-confusion` |
| Tests beoordelen of uitbreiden (regelkaarten, rekenregels) | `mutation-testing`, `metamorphic-testing` |
| Opbouw van de code, wat eerst opruimen | `module-depth`, `connascence`, `code-hotspots`, `cyclomatic-complexity` |

**Analyses en grafieken (`data`)** – bij nieuwe analyses in de portalen en bij het controleren ervan: `data:statistical-analysis` (regelkaarten, trends, uitschieters), `data:sql-queries` en `data:write-query` (PostgreSQL), `data:explore-data` (testdata of later pilotdata bekijken), `data:validate-data` (een analyse controleren vóór Geert hem laat zien). Grafieken in de schermen volgen daarnaast de skill `dataviz`.

**Fabrieksprocessen (`claude-for-manufacturing`)** – als **vakkennis en controlelijst** bij het ontwerpen van functies, niet als koppeling met echte systemen:
| Onderwerp | Skill |
| --- | --- |
| OEE, stilstand, dagrapport (Portaal Productie, ROADMAP #22) | `daily-production-report`, `morning-plant-pulse`, `breakdown-diagnosis` |
| Afwijking, afkeur, oorzaak en corrigerende maatregel (Portaal Kwaliteit) | `ncr-writeup`, `root-cause-capa`, `inspection-to-capa` |
| Grondstofpartij die een probleem veroorzaakt | `supplier-escape-to-alternate-source` |
| Koppeling met Exact of andere systemen (ROADMAP #6) | `custom-connector`, `data-consolidate` |
Let op: deze skills willen vaak connectors (ERP, CMMS, Microsoft 365) of bedrijfsdocumenten. Draai `onboarding` en koppelingen met echte systemen **niet** zonder akkoord van Geert, en gebruik er nooit echte fabrieksgegevens mee in de repository. Offerte- en ontwerpskills (`rfq-to-quote`, `quote-build`, `customer-inquiry-intake`, `supplier-quote-request`, `design-space-explore`, `trade-study-report`) horen niet bij dit project.

## Aan het eind van een sessie (altijd)
1. Het blok **Stand** in **`README.md`** overschrijven met de stand van nu (versie, wat draait waar, laatste testronde). Geen sessielog: de geschiedenis staat in `CHANGELOG.md` (nog niet uitgegeven wijzigingen onder `Unreleased`). Nieuwe valkuilen onderaan dit bestand, opgeloste weghalen.
2. **`ROADMAP.md`**: controleren dat hij bij is (dat hoort al bij elke wijziging, zie hierboven), en nieuwe punten uit het gesprek erbij met het volgende vrije nummer.
3. **`DECISIONS.md`**: een nieuw `D<n>`-besluit voor elke keuze die een volgende sessie moet kennen.
4. De rest van **`README.md`** bijwerken als de opbouw, een scherm of een test verandert.
5. **Projectdocument** in het Claude-project (`claude/architectuur-en-besluiten.md`): alleen de samenvatting en de links bijwerken. Het Whiteboard en de rapporten op claude.ai zijn momentopnamen: niet bijwerken.
6. Bij software/CI: push naar de PR-branch, controleer Node 22 en vraag pas bij gereedheid acceptatie aan; Geert merget na geslaagde Node 26. Bij uitsluitend toegestane documentatie: volg D87 en push alleen na toestemming rechtstreeks naar main.

## Valkuilen voor de volgende sessie
- `tools/pakket/testdata.sql` opnieuw maken: `schema_versie`, `onderhoud_log` en `inlogpoging` niet meenemen in de dump (zie README, "Testdata").
- De schermtests in Chrome draaien op GitHub (`tests/test_schermen.sh`, ongeveer 4 minuten). Een losse portaaltest vraagt verse testdata; beheer, planning en sjabloon zetten zelf hun database klaar.
- Na een wijziging aan schema of testdata maakt `demo/bouw.sh` de demodatabase vanzelf opnieuw.
- Browserdemo op claude.ai: bestanden groter dan ongeveer 10 MB en ingepakte pakketten kwamen daar niet goed door ("File is corrupted"), lokaal wel. De demo laadt de database daarom in delen van 4 MB met controlesom; houd de eigen databestanden onder 4 MB en test na publiceren de echte link.
- Het gedeelde account `operator` pas laten uitzetten als de wachtrijen op de pc's leeg zijn: invoer op een naam zonder recente inlog op die pc weigert de server (D53).
- Links tussen startpagina/portalen en invoerscherm zijn relatief (`../invoer/index.html`), anders werken ze niet in de browserdemo.
- De klasse `bezig` hoort bij tegels op het invoerscherm (stap met werk dat loopt). Een knop die bezig is heet `knop-bezig`; klikken daarop worden tegengehouden. Niet door elkaar halen.
- Een lot en een lotvoorstel bestaan uit batches van één product (D55). Testdata en tests die lots maken, moeten batches van hetzelfde product nemen.
- Een account dat de beheerder (of een test via de API) aanmaakt of een nieuw wachtwoord geeft, heeft een tijdelijk wachtwoord (D61): inloggen geeft dan een token dat alleen `/auth/wachtwoord` mag. In tests eerst het wachtwoord wijzigen, of het account direct in de database zetten. Wandschermaccounts zijn uitgezonderd.
- Nieuwe schermtests: geef de browsercontext `timezoneId: "Europe/Amsterdam"` mee (zoals de bestaande). Anders faalt een test rond middernacht op GitHub, waar Chrome in UTC draait. Uitzondering: `portaal/e2e/demo.mjs`, want de demodatabase krijgt "vandaag" uit de tijdzone van de machine waarop hij is gebouwd.
- "Naar Excel" komt uit `tabel()` en wordt door `portaal/src/excelplaats.ts` naar de kopregel van het blok of de pagina verplaatst (D63). Een schermtest zoekt de knop daarom binnen het blok, niet direct boven de tabel.
- Regels voor schermformaten (D64) altijd als `@media screen and (...)`. Een A4 is bij afdrukken ongeveer 800 px breed, dus zonder `screen` gelden de telefoon- en tabletregels ook op papier (de hulp paste toen niet meer op één A4).
- Nieuw scherm in de portalen of het invoerscherm: zet de route erbij in `portaal/e2e/formaten.mjs`, zodat hij in zes formaten wordt getest.
- Tijdlijn in `ROADMAP.md` (Mermaid): **geen dubbele punt in een taaknaam**. De eerste `:` scheidt naam en planning; een extra `:` breekt de hele grafiek en GitHub toont dan alleen code. `tests/test_roadmap.sh` vangt dit.
- Een scherm toont zijn kop al tijdens het laden (`toon(kop(...), laden())`). Wacht in een schermtest daarom op de inhoud (een tegel, een rij, een lijst), niet alleen op de kop; anders telt de test een leeg scherm.
- Keuringsstappen (TK, EK, D73) staan niet in de standaardroute en zijn voor operators verborgen. Een test die door een route van PRD-C loopt, moet ze als Kwaliteit doen of de route zonder keuringen zetten; lijsten met alle stappen tellen er 21.
- Elke tabel uit `tabel()` heeft sorteerknoppen in de koppen en vanaf 6 regels een knop Filteren (D83). De filtervelden ontstaan pas als je Filteren opent; een schermtest die ze gebruikt, klikt eerst op Filteren. Een `getByLabel(...)` op een paginafilter kan na het openen ook een filterveld van de tabel raken: zoek dan binnen `.filters:not(.tabel-filters)`.
- De productkeuze (`#product-keuze`, D82) laat het scherm opnieuw tekenen. Wacht in een test tot het oude vak weg is (`waitForFunction(el => !el.isConnected, oud)`), niet op tekst die er vóór het wisselen ook al stond.

## MES-architectuur (D89)
Lees vóór wijzigingen docs/mes/BLUEPRINT.md en de gekoppelde ontwerpen; toets aan de 69 besluiten en ISA-matrix. Main is uitgangspunt, PR #1 uitsluitend referentie. Nieuwe domeinen Engels, bestaande Nederlandse namen behouden. Werk per beheersbare PR; testverwachtingen vooraf vastleggen, kritische databaseconstraints, historische gegevens niet gokken. Actualiseer normmapping en bewijs per fase. Geen release of merge zonder afgesproken toestemming. ROADMAP is enige takenlijst.

De acht expliciete MES-ontwerpbestanden in docs/mes vallen eveneens onder D87; geen wildcard voor uitvoerbare bestanden. Bij wijziging ROADMAP/CHANGELOG blijft de gerichte documentatiecontrole vereist.

## D90 – Faseacceptatie
Werk in één concept-PR per fase met logische commits. Draai relevante lokale tests; vraag Node 22 selectief via `compatibiliteit-test` aan. Bij gereedheid `acceptatie-test` (beide suites op exacte head/base), labels bij herhaling eerst verwijderen. Conceptstatus is geen acceptatiebewijs. Oude instructie automatische Node 22 bij elke PR-update geldt alleen voor niet-concept-PRs. Geen merge zonder actuele volledige acceptatie. Behoud tests op bedrijfsregels; vervang alleen onterecht vaste fixtureverwachtingen.

## MES-migratie: bestaande functionaliteit kritisch beoordelen

Werkafspraak met Geert (24 november 2026): D89 en de MES-ontwerpdocumenten zijn leidend. Bestaande functies zijn geen automatisch te behouden scope. Beoordeel per functie of behoud, vereenvoudiging, vervanging of verwijdering beter past. Meld twijfel en gemotiveerde verwijderingsvoorstellen (inclusief impact op gebruikers, gegevens en tests) vóór omvangrijke compatibiliteitsinvesteringen; verwijder bestaande functies alleen na akkoord van Geert. Gewone implementatiewerkzaamheden binnen het verleende mandaat gaan zelfstandig door. Historische productiegegevens en identiteiten blijven beschermd. D92 (accountimport) is het eerste voorbeeld.
