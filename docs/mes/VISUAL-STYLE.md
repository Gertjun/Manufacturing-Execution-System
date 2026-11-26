# MES visuele ontwerpstandaard — v2 (goedgekeurde variant B+)
 
Bron: D114, D107, D50, D63, D64, D70 en D105/D111. ISA-88/95 en goedgekeurde architectuur blijven leidend; vormgeving wijzigt geen rechten, processen of fysieke relaties.

| Tokenconcept | Kleur | Betekenis |
|---|---|---|
| Structuur | #0B2E59 | Titels, definities, masterdata, recepten, specificaties, rollen |
| Uitvoering | #F28C28 | Functionele accenten, proces, batches, metingen, besluiten |
| Interactief oranje | #B45309 | Primaire actie: tekst, rand en icoon op wit |
| Structuurvlak | #E7EEF6 | Structurele blokken |
| Uitvoeringsvlak | #FDEBD9 | Uitvoeringsblokken |
| Achtergrond | #F4F7F9 | Algemeen |

Grijs voor ondersteuning en databaserelaties; groen/rood uitsluitend expliciete status. Waarschuwingen onderscheiden van regulier oranje met tekst, symbool en eigen token. Planning: donkerblauw afgerond, oranje actief, lichtgrijs toekomstig, altijd tekststatus.

## UI
Uitgangspunt bestaande Atkinson Hyperlegible, 4/8-puntsraster, 44 px aanraakdoelen, bestaande D64-breekpunten. Centrale tokens in gedeeld/tokens.css; gedeelde helpers in gedeeld/ui.ts, knoppen en portaalstijl. Titel links, acties/filters rechts waar ruimte; op smalle schermen logisch stapelen. Tabellen behouden koppen, betekenis, leesvolgorde en eigen scrollvak waar nodig. Eén herkenbaar patroon voor formulieren, labels, foutmelding, bevestiging, leeg/laden, focus, selectie en status. Bekijken, wijzigen, beoordelen en vrijgeven duidelijk onderscheiden; historische revisies herkenbaar en niet stilzwijgend wijzigbaar. Datum, tijdzone, ingangsdatum en besluitmoment expliciet onderscheiden. Behoud toetsenbordbediening en veilige foutafhandeling. Contrast per combinatie toetsen; WCAG 2.2 AA als technisch ontwerp- en toetskader; wettelijke toepasselijkheid en formele conformiteit worden hiermee niet vastgesteld. Geen witte tekst op oranje zonder contrastbewijs; geen status alleen via kleur.

## Diagrammen en documenten
Masterdata blauw/lichtblauw; transacties oranje/lichtoranje. Oranje procespijlen, neutraal grijze FK-relaties; pijlen aan randen, geen overlap met tekst, legenda en korte Nederlandstalige functieomschrijving. SQL blijft bron voor fysieke ERD; generator en integriteitscontroles behouden. Voorbeeld goed: blauwe receptdefinitie naast oranje vrijgavebesluit, grijze FK en afzonderlijke procespijl. Ongewenst: willekeurig wisselende kleuren of FK als procesvolgorde. Naslagwerk afzonderlijk actualiseren na vaststelling.

## Borging
Inventariseer bestaande schermen, CSS, documenten en afwijkingen. Test contrast, focus, acht formaten, visuele regressies en consistente componenten. Geen nieuwe domeinfunctionaliteit. Dit document is ontwerpbaseline; implementatie, schermmetingen en acceptatie volgen.

## Inventarisatie als ontwerpinput
Beide frontendonderdelen van hetzelfde MES importeren gedeeld/tokens.css en knoppen.css. Bestaande donkere en printvarianten expliciet beoordelen; responsive afwijkingen (600/840/900) toetsen in plaats van willekeurig gelijkmaken. Behoud invoer-offline, afdrukken en bestaande statussemantiek. Zie 145.1 in ACCEPTANCE-CRITERIA.md. Visuele nulmeting volgt per implementatiewerkpakket 139.2–4; onderstaande contrastmatrix is berekend voor effen sRGB-kleuren.

## Eén MES, meerdere portalen (D113)
Vanuit de gebruiker één MES-applicatie, met Production Execution als gelijkwaardig portaal naast Process Engineering, Manufacturing Operations, Kwaliteit, Planning en Beheer. Eén herkenbare aanmelding, portalkeuze, navigatie, identiteit en bedieningsprincipes. Geen extra login puur vanwege de frontendgrens; noodzakelijke werkstationbinding, herbevestiging, persoonlijke autorisatie en offline beveiliging blijven intact. De huidige portaal/ en invoer/ zijn technische frontendonderdelen, geen afzonderlijke MES-applicaties. Werkpakket 138.1 beoordeelt behoud of gecontroleerde integratie op basis van service worker, opslag/wachtrij, sessie, scanners, routing, beveiliging, testbaarheid en migratierisico; geen vooraf gekozen samenvoeging. Geen nieuwe grants of offline beslisrechten.

## Contrastmatrix en semantische tokens
Berekend met sRGB relatieve luminantie en (Lmax + 0,05)/(Lmin + 0,05). Normale tekst minimaal 4,5:1; grote tekst en betekenisvolle niet-tekstuele componentgrenzen minimaal 3:1. Toets daadwerkelijke aangrenzende kleuren, hover/focus/selected/disabled en samengestelde vlakken tijdens implementatie. Geen conformiteitsclaim op basis van deze tabel alleen.

| Voorgrond | Achtergrond | Ratio | Gebruik |
|---|---|---:|---|
| wit #FFFFFF | structuur #0B2E59 | 13,55 | navigatie/titel |
| structuur #0B2E59 | lichtblauw #E7EEF6 | 11,59 | structuurkaart |
| structuur #0B2E59 | achtergrond #F4F7F9 | 12,60 | titel |
| inkt #1B2430 | uitvoering #F28C28 | 6,38 | diagram / functioneel accent, geen standaard knop |
| wit #FFFFFF | actie #F28C28 | 2,45 | verboden voor normale tekst |
| inkt #1B2430 | lichtoranje #FDEBD9 | 13,46 | uitvoeringskaart |
| amber #A35F00 | wit #FFFFFF | 5,01 | waarschuwingstekst |
| amberlijn #C27803 | wit #FFFFFF | 3,51 | waarschuwingslijn, niet normale tekst |
| positief #2E7D4F | wit #FFFFFF | 5,05 | positief label |
| kritiek #B3261E | wit #FFFFFF | 6,54 | foutlabel |
| grijs #6B7785 | wit #FFFFFF | 4,56 | rand; niet generiek op alle vlakken |
| grijs #6B7785 | #F4F7F9 | 4,24 | alleen rand, geen normale tekst |
| oranje #F28C28 | wit #FFFFFF | 2,45 | niet als enige betekenisvolle grens of icoon |
| focus #174A95 | wit #FFFFFF | 8,57 | focus op lichte achtergrond |
| donkerdisplay #10161F | tekst #F3F5F7 | 16,61 | bestaande displayvariant |
| amber #FFB547 | donkerdisplay #10161F | 10,33 | waarschuwing op donker |

Tokencontract voor 139.2: aparte structuur-, uitvoerings-, actie-, actie-tekst-, focus-, selectie-, status- en printtokens. Primaire actie wit met #B45309 tekst en rand, hover lichtoranje #FDEBD9 met donkerdere tekst #93410B; secundaire actie wit met donkerblauwe tekst en rand; destructieve actie wit met rode tekst en rand en bevestiging waar bestaande bedrijfsregel dat vereist. Geen oranje focusring op wit. Focus op donkere navigatie afzonderlijk contrasterend ontwerpen. Niet één globale op-kleur gebruiken voor alle actievlakken. Status amber/groen/rood blijft onderscheiden van reguliere actie, altijd label/symbool; geel voor wacht/knelpunt blijft als bestaande aparte betekenis te toetsen. Geen statusverandering door stijlaanpassing.

## Variant B+ (D114, goedgekeurd)
- Aanvulling opdrachtgever (26 november 2026, herziene variant B): alle verticale linkeraccenten in de MES-interface (kaarten, open acties, waarschuwingen, alarmen en actieve linkernavigatie) gebruiken één token `--mes-linkeraccent: 6px`, zonder inspringing. Kleur en tekst behouden hun eigen betekenis; horizontale bovenaccenten en horizontale navigatieaccenten blijven 3 px, hoekradius van kaarten 8 px. Gewone omrandingen, tabelscheidingen en grafieklijnen vallen niet onder deze regel. Deze afspraak vervangt de eerdere 3 px voor open acties en afwijkende breedtes voor waarschuwingen.
- Donkerblauwe hoofd- en linkernavigatie; actieve route wit tekstlabel op #1C416C met 6 px oranje zijaccent en aria-current. Geen volledig oranje of wit actief menu-item.
- Werkruimte #F4F7F9; witte kaarten met dunne neutrale rand en betekenisvol blauw/oranje accent, bijvoorbeeld 3 px bovenrand. Oranje accent op wit is aanvullend, niet de enige betekenisdrager. Lichtblauw voor tabelkoppen; subtiele afwisseling witte en #F8FAFB rijen, lichte horizontale scheidingen, geen zware rasterlijnen.
- Primaire, secundaire en destructieve knoppen omlijnd zoals tokencontract. Hover licht getint, focus onafhankelijk zichtbaar, disabled herkenbaar zonder actieve schijn. Geen kleur als enige indicatie; behoud bestaande bediening en labels.
- Compacte statuslabels met betekenisvol icoon en tekst, geen groot kleurvlak in gewone tabelrijen. Kritieke veiligheidsmeldingen, blokkades en ernstige afwijkingen behouden opvallende gekleurde achtergrond, passende tekst/iconen en voldoende contrast. Een review die enkel in behandeling is, is geen waarschuwing of fout; label de werkelijke toestand.
- Hoekradius doorgaans 4–8 px, dunne randen, minimale schaduw alleen waar functioneel (bijv. dialoogvenster). Uniforme lijniconen; tekstlabels behouden. Geen eigen basiskleur per portaal. Atkinson Hyperlegible en bestaande aanraakdoelen blijven.
- Technische documentatie, procesdiagrammen, ERD en naslagwerk behouden volledig gekleurde semantische blokken D107. Zakelijke UI gebruikt kleur selectief, geen wijziging van diagramsemantiek.

Aanvullende berekende contrastwaarden (sRGB): interactief oranje #B45309 op wit 5,02:1, op lichtoranje 4,32:1; wit op actief navigatievlak #1C416C 10,39:1; oranje #F28C28 op #1C416C 4,23:1. Toets daadwerkelijke focus/randen en samengestelde vlakken tijdens implementatie.

## Componentcontract
- Schermkop: herkenbare portaalnaam, paginatitel links, context (product/revisie/batch) en acties rechts; op smal scherm stapelen. Navigatie toont actieve route ook tekstueel en met aria-current. Geen verborgen bevoegde portalen door legacy-rolnaam.
- Formulier: zichtbaar label, eenheid en verplichte velden; veldfout bij veld en samenvatting waar nuttig; behoud invoer bij herstelbare fout. Leesmodus duidelijk onderscheiden van conceptbewerking; historie read-only. Knop bezig blokkeert dubbele actie; succes pas na bevestigd resultaat.
- Tabel: betekenisvolle koppen, numerieke kolommen rechts, tekst links, consistente sortering/filter, lege toestand en eigen scrollvak. Geen verlies van koprelaties op mobiel; geen pagina-overloop. Historische gegevens en onbekend versus nul niet verwarren.
- Review/vrijgave: exacte revisie, ronde, beslissing, reden, persoonlijke herbevestiging en ingangsdatum zichtbaar volgens bestaande API; geen hergebruik van knopstatus als bewijs. Waarschuwing en blokkade expliciet onderscheiden. Lokale wachtrij, offline en serverbevestiging apart labelen.
- Typografie: Atkinson Hyperlegible, bestaande rem-schaal 0,75/0,875/1/1,25/1,5/2; gewone tekst 1 rem, secundair 0,875 rem, kleine labels alleen aanvullend. 4/8-puntsraster, bestaande 44 px aanraakdoelen, zichtbare focus, logische tabvolgorde, reduced motion. D64 als uitgangspunt, afwijkende 900/800/600-regels per inhoud toetsen; printregels niet door schermmedia laten beïnvloeden.
- Wandscherm: aparte donkere leesvariant binnen dezelfde semantiek, geen nieuwe displayfunctionaliteit. Afdruk: hoog contrast, betekenis in tekst/patroon, behoud paginering, certificaat-/etiketgegevens en bestaande afdruktests. Geen nieuwe algemene donkeremodus als extra scope.

## Verificatiepoorten
139.2: tokens en componenten, contrastmatrix en gerichte bouw/schermregressies; 138.1: gelijke portalsets en veilige route-/sessieafhandeling; 139.3: schermen per portaal, nulmeting en afwijkingen, acht schermformaten, toetsenbord/print/offline; 139.4: documenten en generator; 140.1–4: integrale regressies, positieve MBR-vrijgave, audit, Windows-praktijkacceptatie en publicatie. Bestaande functionele tests niet verwijderen om stijltests groen te krijgen. Bij contrast- of toegankelijkheidsafwijking documenteren en herstellen. Geen nieuwe productiedata of domeinfunctie.

139.2a: hovertekst #93410B op #FDEBD9 = 6,02:1. Basis- en hovercontrast afzonderlijk toetsen. Gedeelde knopkleuren; maatvoering blijft werkcontextafhankelijk. Eerste basisimplementatie, nog geen volledige schermharmonisatie.

### Grafiekpalet C (D114, goedgekeurd)
Vullingen: groen #70AC8C, tolerantie #D49A45, grens #C76565, reeks #6588B2. Contouren, punten, grenslijnen en statuslabels behouden krachtige contrastkleuren; arcering en legenda behouden. Zachte zones #F1F8F4, #FCF1DF, #FBECEC voor regelkaarten en trendgrafieken; statistische sigma-zones zijn geen productspecificatie of tolerantie. Trendzones uitsluitend bij geneste, bekende historische grenzen en tolerantie, niet bij gemengde producten. Geen wijziging van berekening of signalering. Vullingen zijn niet zelfstandig contrastdragend: contouren en tekst dragen betekenis. Centraal finetunen via tokens, zonder roadmapblokkade; daadwerkelijke scherm- en contrastverificatie in 139.3i.

### Grote schermen (D64, uitbreiding 26 november 2026)
Acht centrale CSS-viewports in `tests/screen-formats.mjs`: 390×844, 844×390, 820×1180, 1180×820, 1280×800, 1440×900, 1920×1080, 3840×2160. Component- en echte routetests delen de matrix; beperkte displaytest omvat ook Full HD en 4K. D111-praktijkacceptatie omvat fysieke resolutie en Windows-schaling 100/125/150/200%, afzonderlijk van browserzoom. Geen kunstmatige maximale schermbreedte zonder onderbouwing: tabellen benutten ruimte, formulieren en tekst houden leesbare maat, grafieken behouden geometrie; daadwerkelijke grote-schermmetingen volgen.

139.4a: fysieke ERD-generator gebruikt expliciete semantische classificatie per bestaande tabel, neutrale FK-lijnen en legenda; onbekende tabellen moeten bewust worden ingedeeld. Conceptuele ERD en procesketen gebruiken dezelfde kleurbetekenis. Mermaid-weergave en SQL-consistentie afzonderlijk toetsen; geen handmatige wijziging van fysieke relaties. GitHub-rendering kan eigen thema toepassen. Naslagwerk/presentaties afzonderlijke momentopnamen.

139.4b: Gantt toont alle fasen 0–12, technische afronding afzonderlijk van praktijkacceptatie, en de gecombineerde fase-2/3-poort vóór middelenbeheer. Architectuur, MBR/EBR- en migratieproces gebruiken B+-klassen; conceptuele pijlen zijn oranje en fysieke FK grijs. Brontekstcontract bewaakt kleursemantiek en fasevolgorde; daadwerkelijke Mermaid-layout, overlap en contrast in renderomgeving afzonderlijk beoordelen. PDF-naslagwerk en presentaties blijven afzonderlijke momentopnamen.

139.4c: GitHub dark mode toont inline Mermaid Gantt onvoldoende leesbaar. Roadmap gebruikt daarom een reproduceerbare SVG met expliciete witte achtergrond, aparte donkere labels en behouden Gantt-bron; geen kalenderplanning. Overige Mermaid-diagrammen afzonderlijk op beide thema's beoordelen. Geen renderacceptatie op basis van broncontrole alleen.

139.4c vervolg: browsercontrole roadmap-SVG in beide kleurmodi, vaste achtergrond, tekstkleur, overlap en tekstgrenzen. Dit is een lokale Chrome-render, niet de daadwerkelijke GitHub-UI. Overige Mermaid-diagrammen blijven apart open.

139.4c: Graphviz als uitsluitend documentatie-renderengine voor de zes technische diagrammen; behoud Mermaid in Markdown als bron en SQL-generator voor fysieke ERD. `python3 tools/render_diagrams.py <uitvoermap>` genereert SVG. Geen stilzwijgend negeren van onbekende relationele syntaxis. Werkelijke layout, GitHub-insluiting en browsercontrole volgen na eerste renderbewijs.

139.4c: succesvolle eerste render in CI 417. Reviewartifact `mes-technical-diagrams` bevat zes SVG's; Chrome controleert node-labels en achtergrond in beide kleurmodi. Relatielabels, grote ERD en GitHub-insluiting afzonderlijk beoordelen. Graphviz-versie kan layout tussen verschillende omgevingen beïnvloeden; dubbele generatie bewijst herhaalbaarheid binnen dezelfde omgeving.

139.4c: vier procesdiagrammen gebruiken vaste posities via directe SVG-rendering (neato -n2 vervangen na CI 420); blokken 332 × 47 pt, verticale stap 105 pt, hoofdas en zijtakken per bron-ID. Procesketen in twee kolommen met doorlopende richting. Bron blijft gezaghebbend voor inhoud en relaties; ontbrekende of extra nodes maken de layouttest rood. ERD blijft voorlopig automatisch.

139.4c: vaste flowchartgeometrie rechtstreeks in SVG, met expliciete paden voor uitzonderingslussen, pijlrichting en labelpositie; B+-palette gedeeld met Graphviz-ERD. Tekst moet met marge in het eigen blok passen, relatielabels mogen geen blokken of andere teksten raken. Graphviz-foutuitvoer wordt gelogd. Nieuwe relaties zonder ondersteunde route worden geweigerd.

139.4c publicatie: technische Markdown toont SVG’s uit `docs/diagrams/rendered/` met uitklapbare Mermaid-bronnen. Grote fysieke diagrammen openen op volledig formaat. De domeinweergaven tonen samen alle foreign keys. Na een schemawijziging eerst `tools/schema_plaatje.py` uitvoeren. Daarna werkt `python3 tools/render_diagrams.py` de SVG’s bij. De workflow Diagramcontrole vergelijkt bij technische acceptatie de gepubliceerde SVG’s byte voor byte met de hergeneratie en controleert Chrome in beide thema’s. Gebruik voor de fysieke en conceptuele ERD dezelfde Graphviz-versie en fonts als documentatie-CI. Voor de eerste publicatie is de SVG-uitvoer van run 422 gebruikt (Graphviz 14.1.2).

Reguliere documentatie-CI controleert broncontracten en SVG-links en signaleert gewijzigde diagrambronnen. Voeg `diagramcontrole` toe aan de PR voor een gerichte review. Bij faseafronding start `acceptatie-test` ook de workflow Diagramcontrole. Controleer of beide workflows groen zijn voor de exacte PR-commit.
