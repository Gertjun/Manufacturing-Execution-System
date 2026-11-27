# Praktijktests – wat de automatische tests niet bewijzen

> **Dit bestand:** welke tests met echte apparaten, echte pc's en het netwerk van de fabriek nodig zijn, hoe je ze doet en wanneer ze goed zijn (roadmap #33, poort B).
> **Niet hier:** de uitkomsten. Die staan in het invulblad **Praktijktests – uitkomsten** op claude.ai: <https://claude.ai/artifact/WQn3YnEVcuy5W5ieXenwRg> (per test wie, wanneer, uitkomst, wat er misging). Wat misgaat wordt een nieuw punt in [`ROADMAP.md`](../ROADMAP.md).

De automatische tests draaien bij elke versie op GitHub (zie README, "Testen"). Ze bewijzen niet dat een handscanner, een printer, een tv, een tablet, een echte Windows-pc of het netwerk in de fabriek werkt. Daarvoor zijn deze tests.

**Zo werk je:**
- Gebruik de nieuwste versie van het laptoppakket (GitHub → Releases → Assets) en **alleen fictieve gegevens**: de testdata van het pakket, of zelf verzonnen batches. Geen echte batchnummers, namen of meetwaarden.
- Doe een test, vul in het invulblad in wie, wanneer en met welke versie, en kies **Goed**, **Fout** of **Niet gedaan**. Bij Fout: wat je deed, wat je zag (een foto van het scherm helpt) en wat je had verwacht.
- Een test die niet kan (bijvoorbeeld omdat er nog geen server is) blijft op Niet gedaan, met de reden.
- **Poort B is gehaald** als elke test een uitkomst heeft en wat fout ging is opgelost of bewust geaccepteerd.

## L – Op de laptop

Fase-1 Windows-acceptatie W1–W8: zie [ACCEPTANCE-CRITERIA.md](mes/ACCEPTANCE-CRITERIA.md). Onderstaande bredere praktijkchecks blijven relevant voor de toekomstige pilot.

| Nr | Test | Hoe | Goed als |
| --- | --- | --- | --- |
| L1 | Eerste start | Zip uitpakken naar een vaste map buiten OneDrive (bijv. `C:\batch-gui`), `START.bat` dubbelklikken. | De browser opent op de startpagina; inloggen met `mes.operator` / `demo` lukt; binnen een minuut klaar. |
| L2 | Stoppen en weer starten | Een stap starten in het invoerscherm. Stoppen met Ctrl+C en **J**. Opnieuw `START.bat`. Daarna nog eens, nu door het zwarte venster te sluiten. | Beide keren start alles weer; de gestarte stap staat er nog. |
| L3 | Nieuwe versie | Nieuwe zip naar een nieuwe map, `data` en `instellingen.json` meekopiëren, starten (tools/pakket/README.md, "Nieuwe versie"). | Beheer → Server toont de nieuwe versie; de batches van daarvoor staan er nog. |
| L4 | Back-up terugzetten | Een batch starten, stoppen, `BACKUP TERUGZETTEN.bat`, de back-up van vóór die batch kiezen, starten. | De batch is weg; de rest staat er; de oude database staat nog in de map `data`. |
| L5 | Lege fabriek | Uitsluitend aparte fictieve testmap: LEGE FABRIEK.bat, drie persoonlijke bootstrapidentiteiten en afzonderlijke wachtwoorden. | Geen batches of testaccounts; System Administrator kan technisch accountbeheer uitvoeren, maar geen inhoudelijk beheer zonder afzonderlijke grant. |
| L6 | Hersteldiagnose | BEHEERDER HERSTELLEN.bat op bestaande fictieve administratie. | Oude noodsleutel geblokkeerd; diagnose wijzigt geen accounts; regulier herstel alleen via onafhankelijke bevestigingen. |
| L7 | Offline op de laptop | Invoerscherm open als `mes.operator`. Applicatie stoppen (Ctrl+C). Een stap afronden met waarden. Applicatie weer starten. | Tijdens het stoppen gaat de invoer door en toont de balk het aantal wachtende acties; na het starten zijn ze verstuurd, met de tijd van invoer (niet van versturen). |
| L8 | Accounts voor de pilot | Bij Beheer → Accounts een fictief persoonlijk account toevoegen met tijdelijk wachtwoord. Met dat account inloggen op het invoerscherm. | Geen Excel-import van accounts; bij de eerste inlog eerst een eigen wachtwoord; geen toegang zonder afzonderlijk toegekende MES-grants. |

## A – Apparaten

| Nr | Test | Hoe | Goed als |
| --- | --- | --- | --- |
| A1 | Handscanner | Een scanner die als toetsenbord werkt (USB). Etiketten printen (A2). In het invoerscherm, in een stap, buiten een invoerveld scannen: een batch die bezig is, een batch die klaarstaat, een lot in een lotstap, en een batch in stap 16. | Bezig: de stap opent. Klaar: de stap start ("gestart"). Stap 16: de batch wordt aangevinkt. Niet in deze stap: een duidelijke melding. Scannen in een invoerveld typt gewoon de tekst. Geen dubbele of halve scans. |
| A2 | Etiketprinter 100 × 50 mm | Planning → Etiketten, formaat etiketprinter, afdrukken via de browser (marges op Geen, schaal 100%). | Eén etiket per batch, niets afgesneden; de streepjescode scant (A1). |
| A3 | A4-vel 3 × 7 | Hetzelfde met een A4-vel etiketten. | De etiketten vallen binnen de vakjes, ook op de laatste rij. |
| A4 | Tv als wandscherm | Een pc of stick aan de tv, inloggen als `mes.display`, volledig scherm (F11). Laten staan van begin tot einde van een dienst. Ook eens met "Stappen kiezen". | Leesbaar vanaf 5 meter; ververst vanzelf; na een dag nog ingelogd; geen scrollbalken. |
| A5 | Tablet via het netwerk | Laptop open zetten voor het netwerk (tools/pakket/README.md, "Laten meekijken"). Op een tablet het adres van de laptop openen, inloggen, een stap invoeren. | Alles is met de vinger te bedienen; het toetsenbord dekt het actieve veld niet af. (Offline werkt hier niet: dat kan alleen via https, test S2.) |
| A6 | Telefoon staand en liggend (D64) | Op een telefoon (iPhone en Android) via het netwerk het invoerscherm openen, inloggen, een stap starten, invullen en afronden; daarna een portaal (Lotpaspoort, Afwijkingen, Planning → Batches plannen). Telefoon draaien. | Navigatie onderaan bereikbaar met de duim, niet achter de thuisbalk; Opslaan en Stap afronden blijven in beeld; het toetsenbord dekt het actieve veld niet af; tabellen zijn kaartjes; nergens opzij schuiven behalve bij Batchroute, Dagoverzicht, grafieken en het certificaat. Liggend: de balk scrolt weg, invoer blijft mogelijk. |
| A7 | Tablet staand en liggend (D64) | Op een tablet beide standen: invoerscherm en de vier portalen, ook het menu openen en sluiten. | Staand klapt het menu dicht achter de knop "Menu"; liggend staat het menu links. Niets valt buiten het scherm; alles met de vinger te bedienen. |

## V – Op de vloer met meerdere pc's

Vraagt minstens twee apparaten aan dezelfde laptop of server (A5, of later S2).

| Nr | Test | Hoe | Goed als |
| --- | --- | --- | --- |
| V1 | Twee pc's op dezelfde batch | Op twee pc's tegelijk dezelfde batch in dezelfde stap starten. Daarna op allebei dezelfde waarde invullen. | De tweede krijgt een duidelijke melding; er staat maar één start en één waarde. |
| V2 | Twee pc's op hetzelfde lot | Op twee pc's tegelijk een lot samenstellen met (deels) dezelfde batches. | Eén lot; de tweede pc krijgt een melding en geen batch zit in twee lots. |
| V3 | Offline bij het begin van een dienst | Verbinding van een pc los vóórdat de nieuwe ploeg inlogt. Inloggen proberen. Daarna: iemand die nog was ingelogd werkt door. | Nieuw inloggen lukt niet, met een duidelijke melding (D53). Wie al was ingelogd kan doorwerken. Afspreken wat de ploeg dan doet (papier, andere pc); dat wordt een punt voor de training (#74). |
| V4 | Lang offline | Een pc een hele dienst zonder verbinding, met meerdere stappen en een stilstand. Dan weer verbinden. | Alles komt aan, in de goede volgorde, met de tijd van invoer en de naam van wie het invoerde. |
| V5 | Persoonswissel met wachtrij | Offline invoeren als `mes.operator`, afmelden (de vraag over wachtende acties bevestigen), inloggen als `mes.supervisor` met verbinding. | Acties van de andere identiteit blijven bewaard voor gecontroleerde beoordeling; worden niet namens de vorige gebruiker verstuurd (D94/D101). |
| V6 | Lab-pc offline | Kwaliteit meet op de lab-pc zonder verbinding en geeft vrij. Daarna verbinden. | Meting en vrijgave komen aan; de batch gaat daarna pas door (D58). |
| V7 | Scherm vergeten | Een pc een nacht laten staan met het invoerscherm open en ingelogd. | De volgende ochtend vraagt hij om opnieuw in te loggen; er gaat geen invoer verloren. |
| V8 | Ploegwissel: stap overnemen | Operator A start een stap op PC-01 en meldt af. Operator B logt in op PC-02, kiest de stap bij Bezig ("Afmaken") en rondt af. Daarna hetzelfde, maar PC-01 is offline als A start; B start dezelfde batch op PC-02. | Eerste keer: "gestart door A, afgerond door B op PC-02". Tweede keer: bij het versturen van PC-01 een melding wie de stap al startte; de ploegleider ziet dat in de wachtrij. |
| V9 | Terugval op papier | Lege formulieren afdrukken (Nainvoeren (papier), Lege formulieren). Een paar stappen en een lot op papier bijhouden alsof de invoer stilligt, daarna als ploegleider nainvoeren. | Formulieren leesbaar en goed in te vullen op A4; alles staat daarna in het systeem met de tijden van het papier en "van papier". Hoe lang het nainvoeren duurde, noteren. |

## T – Tijd

| Nr | Test | Hoe | Goed als |
| --- | --- | --- | --- |
| T1 | Nachtploeg rond de klokwissel | Valt in de pilot: de zomertijd begint op **zondag 28 maart 2027** (02:00 wordt 03:00). Die nacht een stap starten vóór 02:00 en afronden na 03:00; de dag erop de ploegoverdracht en de doorlooptijden bekijken. | De bewerkingstijd is één uur korter dan de klok aan de muur lijkt te zeggen, en klopt; de batch hoort bij de goede ploeg en dag. |
| T2 | Pc met verkeerde klok | Op een pc de klok 10 minuten verzetten, offline een stap invoeren, verbinden. | De tijd van de stap is gecorrigeerd naar de servertijd (D43); niets staat in de toekomst. Klok daarna terugzetten. |

## S – Fabrieksserver (met IT, na #10)

Volgt [`docs/SERVER.md`](SERVER.md); eerst op een testmachine, dan op de echte server.

| Nr | Test | Hoe | Goed als |
| --- | --- | --- | --- |
| S1 | Installatie | Eerste installatie volgens SERVER.md, stap 1 tot en met 11, op een echte Windows Server. | `https://<servernaam>/gezondheid` geeft `ok`; Beheer → Server zonder waarschuwingen. |
| S2 | Offline op een fabrieks-pc via https | Op een fabrieks-pc het invoerscherm via https openen en inloggen. Netwerkkabel eruit, een stap invoeren, kabel erin. | Werkt zoals L7, maar nu op een pc in de hal. Ook na herstarten van de pc zonder netwerk opent het invoerscherm (de inlog zelf niet: V3). |
| S3 | Herstart van de server | De server herstarten (Windows-update nabootsen). | De service start vanzelf; de invoerschermen sturen hun wachtrij daarna door. |
| S4 | Back-up en hersteltest | Een dag wachten; Beheer → Server bekijken. Hersteltest met de hand draaien. | Elk uur een back-up, ook opgehaald door de NAS; de hersteltest staat erbij. |
| S5 | Update en terugdraaien | Update naar een nieuwere versie en daarna terugdraaien volgens SERVER.md. | Beide lukken binnen het afgesproken onderhoudsmoment; geen invoer verloren. |
| S6 | Herstel na een storing | Een back-up terugzetten volgens "Herstel na een storing". | De database staat op het moment van de back-up; invoer van de pc's daarna komt alsnog binnen. |
| S7 | Netwerk in de hal | Op elke pc in hal 1 de server openen; ook op de plek met het slechtste wifi. | Elke pc bereikt de server; bij wegvallen werkt de pc offline door (S2). |


## F1 – Operationele securityacceptatie

Uitsluitend geïsoleerde fictieve testomgeving; leg head/pakketversie, uitvoerders, datum en resultaat vast zonder credentials.

| Test | Goed als |
|---|---|
| F1.1 persoonlijke PostgreSQL-login en TLS | Vertrouwd certificaat werkt; verkeerde hostnaam/onvertrouwde CA en onbeveiligde verbinding geweigerd; geen eigenaarsecret beschikbaar aan securitypersoon. |
| F1.2 binding en privileges | Ongebonden login geweigerd; gebonden login alleen kanaalfuncties; geen directe tabelwrites of andere rollen. |
| F1.3 onafhankelijke aanvraag en besluit | Twee verschillende personen; zelftoekenning en fout wachtwoord geweigerd; exacte scope en audit zichtbaar. |
| F1.4 intrekking en vervanging | Oude binding en sessie niet bruikbaar; nieuwe login alleen na expliciete registratie. |
| F1.5 herstel | Securitykanaal na restore afgeschermd tot IT-reconciliatie; intrekkingen van na backup niet stilzwijgend ongedaan maken. |
| F1.6 kwalificatie en personeelskoppeling | Onafhankelijke bevestiging, bewijsreferentie, geldigheid, intrekking; onbevoegde acties geweigerd. |

D102/0094: goedgekeurde eenmalige initialisatie van bestaande persoonlijke identiteiten zonder MES-rechtenhistorie, via eigenaar en drie persoonlijke bevestigingen. Geen automatische legacy-grants; drie exact afgebakende grants, sessiegeneratie verhoogd, onveranderlijk bootstraprecord. Schone bootstrap blijft voorkeur voor fictieve pre-pilot. Gerichte DB- en toolregressies toegevoegd; uitvoeringsbewijs open.

F1.7: op een afzonderlijke gemigreerde fictieve database de eenmalige overgang uitvoeren, exact drie grants en ingetrokken oude sessies aantonen; herhaling weigeren.

## Fase 2 + 3 – Schermresolutie en Windows-schaling (D64/D111)

Uitsluitend fictieve gegevens en kandidaatpakket. Leg fysieke resolutie, Windows-schaling, browserzoom, werkelijke CSS-viewport (breedte/hoogte), pakketversie en resultaat vast. Test Full HD (1920 × 1080) en 4K UHD (3840 × 2160) bij 100%, 125%, 150% en 200% Windows-schaling voor zover de hardware beschikbaar is. Browserzoom eerst 100%; test afzonderlijk 200% browserzoom. Controleer navigatie, formulieren, tabellen, grafieken, focus, dialogen, werkstationbediening en wandscherm (F11, leesbaarheid op afgesproken kijkafstand). Geen onbedoelde horizontale overflow of afgesneden bediening; tekst en status herkenbaar; grafieken niet vervormd. Bewuste scrollvakken toegestaan. Ontbrekende hardware/schaalcombinatie expliciet als niet uitgevoerd registreren en aan opdrachtgever voorleggen; viewport-emulatie is geen fysiek Windows-bewijs. Geen uitgebreide displayfunctionaliteit vooruitbouwen: huidige D99-displaybeperking blijft gelden.


## D115 – Vast Windows-basisprotocol per fase
Gebruik het kandidaatpakket op exact de technisch geteste bron/tree, in een geïsoleerde fictieve administratie. Noteer pakketversie/commit, datum, apparaat, Windows-versie, browser, uitvoerder, resultaat en afwijkingen. Geen echte gegevens. Iedere fase: B01 start en persoonlijke aanmelding; B02 verwachte starttegels en menu, representatieve toegestane route; B03 representatieve toepasselijke registratie of veilige fictieve wijziging, opslaan en teruglezen; B04 afmelden, geen vorige identiteit; B05 stoppen/herstarten, eerder opgeslagen gegevens behouden. Hergebruik bewijs alleen voor aantoonbaar identieke kandidaatinhoud; afwijkingen afzonderlijk vastleggen.

Fasespecifiek: toets nieuwe/gewijzigde functies en relevante afhankelijkheden; niet automatisch alle historische handmatige tests opnieuw. Bij UI-wijzigingen: visuele leesbaarheid, focus, toetsenbord, dialogen, grafieken, relevante beschikbare schermformaten en schaling; fase 2+3 behoudt bovenstaande acht-formaten-/schalingsafspraken en MBR/MOC-praktijkacceptatie. Bij meldingswijzigingen: tijdens normaal gebruik een fictieve melding aanmaken en controleren dat de normale achtergrondverversing zichtbaar werkt, zonder kunstmatige klok. Bij relevante print/export: leesbaarheid van werkelijk afdrukbeeld en openen in beschikbaar Excel, naast automatische PDF-/bestandsinhoudscontrole. Bij ontbrekende apparatuur: niet uitgevoerd + reden; geen geslaagd oordeel op basis van emulatie. L/A/V/T/S/F1 blijven toepasselijk bij hun bestaande scope en pilotpoort. Geen handmatige vervanging van database-, API-, security- of integriteitsbewijzen. Geen publicatie vóór expliciete acceptatie.

## 140.3 – gecombineerd uitvoeringsblad fase 2 en 3

Aanvulling op B01–B05, D111, D115 en [acceptatiecriteria](mes/ACCEPTANCE-CRITERIA.md); geen vervanging van bestaande eisen. Windows-kandidaat: [build 45847472975](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45847472975) groen, buildcommit `ce71ca6534160798c9cb1948d08db097ccf80fdf`; bron exact `33b7a91fd6dcfd323148bd1505fb34c7bdc11f37` met bovenstaande tree. Artifact [MES-fase2-3-Windows-33b7a91](https://github.com/Gertjun/Manufacturing-Execution-System/actions/runs/45847472975/artifacts/15130988657), ID 15130988657, vervalt 10 december 2026. ZIP-test, verplichte bestanden, SHA256-bestand en herkomstbestand geslaagd in build; fysieke uitvoering en lokale checksumcontrole nog open. Interne versie 0.63.0, schema 0129, uitsluitend fictief, geen release.

Noteer per controle ID, uitvoerder, datum, Windows-versie, browser, pakketcommit, resultaat (geslaagd / gefaald / niet uitgevoerd), afwijking en bewijsreferentie. Geen wachtwoorden, instellingen.json of echte gegevens delen. A: bestaande integrale CI bewijst DB-regels, migratiegelijkheid, API/security, berekeningen, back-up/herstel en Node 22/26; niet handmatig vervangen. B: fysiek Windows-bewijs. C: bestaande CI plus onderstaande praktijkcontrole.

| ID | Type | Uitvoering en verwacht resultaat |
| --- | --- | --- |
| W01 / B01 | B/C | Download artifact; pak buiten OneDrive in nieuwe map uit. Controleer ZIP-SHA256 tegen SHA256SUMS.txt en HERKOMST.txt; start START.bat, ingebouwde PostgreSQL en fictieve data, localhost bereikbaar. Log persoonlijk in, wijzig tijdelijk wachtwoord indien gevraagd; oud wachtwoord werkt niet meer. |
| W02 / B02 | C | Doorloop alle 14 testaccounts uit pakket-README. Vergelijk voor elk starttegels en menu; toegestane route werkt, onbevoegde directe route geweigerd. mes.quality heeft Kwaliteit en Production Execution; display beperkt; geen extra rechten toekennen. |
| W03 / B03–B04 | C | Operator PC-01: fictieve stap starten, waarde opslaan, afwijkende waarde signaleren, afronden; overstap tussen portalen en werkstation controleren. Afmelden vanuit invoer, andere gebruiker aanmelden; vorige identiteit niet zichtbaar, werkstationbehoud volgens bestaand gedrag. |
| W04 | C | Stop server tijdens open invoerscherm; registreer offline, controleer wachtrij, herstart en controleer éénmalige verwerking. Herhaal persoonswissel volgens V5: acties vorige identiteit blijven ter beoordeling, nooit verzonden namens andere gebruiker. |
| W05 / B05 | C | Stop en start pakket; opgeslagen registraties teruglezen, beheer/server en back-upstatus bekijken. Houd afzonderlijke fictieve map voor eventuele herstelproef. |
| W06 | C | Process Engineering: materiaalstamdata, Master Recipe/MBR-concept, procedurehiërarchie, stappen, parameters/formules, vereisten en lotregels bekijken en veilige fictieve revisie aanmaken; opslaan en teruglezen, historische versie ongewijzigd. |
| W07 | C | MOC op exacte revisie/ronde; drie onafhankelijke bevoegde domeinbeoordelingen volgens geldende matrix; zelfbeoordeling/onbevoegde actie geweigerd. Vrijgave en intrekking uitvoeren, status, audit en historische rondes controleren; vrijgegeven inhoud alleen-lezen. Geen rechten omzeilen. |
| W08 | C | Kwaliteit: fictieve meting, status, specificaties, regelkaart/trend (grenzen, legenda, historische zones), lotpaspoort en certificaat; bestaande bevoegdheden en blokkades blijven gelden. |
| W09 | C | Planning: fictieve dagplanning, lotvoorstellen en capaciteit; Manufacturing Operations: werkvoorraad, doorlooptijden en analyse; Beheer en display met eigen toegestane accounts. |
| W10 | B/C | Alle relevante portalen: B+ hoofdbalk, tegels, kaarten, formulieren, tabellen, dialogen, fout/lege toestanden, grafieken, contrast, toetsenbord en zichtbare focus; status niet alleen kleur. Volg volledige D64/D111-schaling hierboven inclusief 200% browserzoom en werkelijk beschikbare fysieke resoluties. |
| W11 | B/C | Afdrukvoorbeeld en werkelijke PDF/afdruk van certificaat, lotpaspoort en relevante formulieren; leesbaarheid, paginering, geen afsnijding. Exports in beschikbaar Excel openen en inhoud controleren; ontbrekende software of printer noteren. |
| W12 | C | Maak tijdens normaal gebruik met mes.operator in een afzonderlijke browsersessie een fictieve afwijkende meting buiten de grens aan; ontvang als mes.quality.approver met Meldingen-menu. Controleer normale 60s achtergrondverversing zonder handmatig herladen of kunstmatige klok; teller, toast, Gelezen en behoud onder Alle. mes.quality (technician) is geen geschikte ontvanger voor deze test. |

L/A/V/T/S/F1 blijven gelden waar toepasselijk volgens bestaande scope; ontbrekende fysieke apparatuur of organisatievoorwaarden expliciet niet uitgevoerd, met reden en beoordeling door opdrachtgever. Geen vrijgave bij onbeoordeelde afwijkingen. Werkpakket 140.4 uitsluitend na expliciete praktijkacceptatie en afzonderlijke releasetoestemming.


Uitkomsten W01–W12 op 27 november 2026: [acceptatiebewijs 140.3](mes/ACCEPTANCE-CRITERIA.md). Beperkingen en oorspronkelijke mislukte W12-test behouden; geen formeel akkoord.
