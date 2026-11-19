# CLAUDE.md – werkafspraken voor Claude

Dit zijn de afspraken uit Geerts andere projecten (Vaste Lasten, Cryptotracker, PWA-Core en de andere apps), aangepast aan dit fabrieksplatform. Bij twijfel gaan de besluiten in `DECISIONS.md` voor.

## Aan het begin van een sessie
1. Lees **`NOTES.md`** (stand van nu), **`WISHLIST.md`** (wat er nog moet), **`DECISIONS.md`** (eerdere besluiten) en alleen de bovenste paar versies van **`CHANGELOG.md`**. Lees niet de volledige chatgeschiedenis.
2. Lees daarna alleen de code die je nodig hebt (`README.md` beschrijft de opbouw).
3. Koppel de GitHub-repository `Gertjun/batch-input-gui` met schrijfrechten en haal de laatste versie op (`git fetch origin main`). Kijk of de laatste testrun op GitHub groen is.

## Tijdens het werk
- **Taal en uitleg:** Nederlands, kort en zonder vakjargon. Alle teksten in de schermen zijn ook Nederlands.
- **"Hoe zou je…" of "nog niet bouwen":** eerst uitleggen en wachten op akkoord.
- **Alleen fictieve gegevens.** Nooit echte fabrieksgegevens, wachtwoorden of tokens in code, tests, logs of commits. Testdata komt uit `tools/genereer_testdata.py`.
- **Elke wijziging is een eigen versie** (`MAJOR.MINOR.PATCH`), zie D17:
  - MAJOR als iemand iets moet doen buiten de schermen om: alle pc's tegelijk bijwerken, een database-omzetting met stilstand, opnieuw instellen. Versie 1.0.0 is de start van de pilot met echte data.
  - MINOR voor een nieuwe functie, ook als de database erbij verandert zonder dat iemand iets hoeft te doen.
  - PATCH voor een kleine verbetering of foutoplossing.
  - **Versie op alle plekken gelijk ophogen** met `tools/zet_versie.sh <versie>` (`VERSIE`, alle `package.json`'s, `api/src/versie.ts`, `gedeeld/versie.ts`).
  - **`CHANGELOG.md`** bijwerken in gewone taal, en **`WISHLIST.md`**: wat gebouwd is, gaat van Gepland naar Gerealiseerd.
  - Een download of pakket draagt het versienummer in de bestandsnaam (`batch-gui-laptop-0.5.1.zip`).
- **Oudere invoerschermen blijven werken.** Een pc kan offline zijn en een wachtrij hebben uit een oudere versie. Een wijziging aan de API moet die oudere invoer nog accepteren, of het is een MAJOR-versie met de melding "werk alle pc's bij" (D18).
- **Regels horen in de database**, niet in de schermen (D9).
- **Databasewijziging = migratie** (D23): nieuw bestand `db/migraties/NNNN_naam.sql`, dezelfde wijziging in `db/schema.sql` plus de regel in `schema_versie`, en `tests/test_migraties.sh` moet slagen. Migraties nooit achteraf aanpassen.
- **Beperkte databasegebruiker** (D24): de applicatie draait als `batchgui_app`. Heeft een nieuwe functie extra rechten nodig, pas dan `db/rechten.sql` aan; de API-tests draaien met die gebruiker.
- **Testen vóór elke push:** databaseregels (`tests/test_regels.py`), API (`api: npm test`, met `TEST_APP_DATABASE_URL` voor `batchgui_app`), migraties (`tests/test_migraties.sh`), beheertools (`tests/test_tools.sh`), opruimschema (`node --test tests/rotatie.test.mjs`), laptoppakket (`tests/test_laptoppakket.sh`, als gewone gebruiker), en de schermtests in Chrome (`invoer/e2e`, `portaal/e2e`) voor wat je hebt veranderd. Daarna rechtstreeks naar `main` (geen force-push, geschiedenis niet herschrijven). Gaat er iets mis: `git revert` en pushen.
- **Groen op GitHub is niet alles.** De automatische tests bewijzen niet dat offline werken, een echte Windows-pc of het netwerk in de fabriek werkt. Noem praktijktests die niet zijn uitgevoerd altijd expliciet.
- **Release-tags worden nooit achteraf gewijzigd.** Tags en GitHub Releases maakt de workflow `release.yml` automatisch voor elke nieuwe versie op `main`.
- Ga je in tegen een besluit uit `DECISIONS.md`? Zeg dat en vraag het eerst.
- **Elk onderwerp op één plek (D41).** Schrijf iets in het document dat die vraag beantwoordt (zie "Waar vind je wat" in `README.md`) en verwijs er elders naar; neem het niet over. Nieuwe taken, adviezen, open vragen en praktijktests gaan met een nummer in `WISHLIST.md`.
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
| OEE, stilstand, dagrapport (Portaal Productie, WISHLIST #22) | `daily-production-report`, `morning-plant-pulse`, `breakdown-diagnosis` |
| Afwijking, afkeur, oorzaak en corrigerende maatregel (Portaal Kwaliteit) | `ncr-writeup`, `root-cause-capa`, `inspection-to-capa` |
| Grondstofpartij die een probleem veroorzaakt | `supplier-escape-to-alternate-source` |
| Koppeling met Exact of andere systemen (WISHLIST #6) | `custom-connector`, `data-consolidate` |
Let op: deze skills willen vaak connectors (ERP, CMMS, Microsoft 365) of bedrijfsdocumenten. Draai `onboarding` en koppelingen met echte systemen **niet** zonder akkoord van Geert, en gebruik er nooit echte fabrieksgegevens mee in de repository. Offerte- en ontwerpskills (`rfq-to-quote`, `quote-build`, `customer-inquiry-intake`, `supplier-quote-request`, `design-space-explore`, `trade-study-report`) horen niet bij dit project.

## Aan het eind van een sessie (altijd)
1. **`NOTES.md`** overschrijven met de stand van nu (versie, wat draait waar, laatste testronde, valkuilen). Geen sessielog: de geschiedenis staat in `CHANGELOG.md` (wijzigingen zonder versie onder "Zonder nieuwe versie").
2. **`WISHLIST.md`**: nieuwe punten erbij, klare punten naar Gerealiseerd (alleen nummer, naam en versie). **`ROADMAP.md`** alleen als een fase klaar is, een poort niet gehaald wordt of de volgorde verandert.
3. **`DECISIONS.md`**: een nieuw `D<n>`-besluit voor elke keuze die een volgende sessie moet kennen.
4. **`README.md`** bijwerken als de opbouw, een scherm of een test verandert.
5. **Projectdocument** in het Claude-project (`claude/architectuur-en-besluiten.md`): alleen de samenvatting en de links bijwerken. Het Whiteboard en de rapporten op claude.ai zijn momentopnamen: niet bijwerken.
6. Push naar `main` en controleer dat de testrun groen wordt.
