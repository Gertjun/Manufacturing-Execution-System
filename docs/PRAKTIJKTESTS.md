# Praktijktests – wat de automatische tests niet bewijzen

> **Dit bestand:** welke tests met echte apparaten, echte pc's en het netwerk van de fabriek nodig zijn, hoe je ze doet en wanneer ze goed zijn (roadmap #33, poort B).
> **Niet hier:** de uitkomsten. Die staan in het invulblad **Praktijktests – uitkomsten** op claude.ai: <https://claude.ai/artifact/WQn3YnEVcuy5W5ieXenwRg> (per test wie, wanneer, uitkomst, wat er misging). Wat misgaat wordt een nieuw punt in [`ROADMAP.md`](../ROADMAP.md).

De automatische tests draaien bij elke versie op GitHub (zie README, "Testen"). Ze bewijzen niet dat een handscanner, een printer, een tv, een tablet, een echte Windows-pc of het netwerk in de fabriek werkt. Daarvoor zijn deze tests.

**Zo werk je:**
- Gebruik de nieuwste versie van het laptoppakket (GitHub → Releases → Assets) en **alleen fictieve gegevens**: de testdata van het pakket, of zelf verzonnen batches. Geen echte batchnummers, namen of meetwaarden.
- Doe een test, vul in het invulblad in wie, wanneer en met welke versie, en kies **Goed**, **Fout** of **Niet gedaan**. Bij Fout: wat je deed, wat je zag (een foto van het scherm helpt) en wat je had verwacht.
- Een test die niet kan (bijvoorbeeld omdat er nog geen server is) blijft op Niet gedaan, met de reden.
- **Poort B is gehaald** als elke test een uitkomst heeft en wat fout ging is opgelost of bewust geaccepteerd.

## L – Op de laptop (Geert, kan nu)

| Nr | Test | Hoe | Goed als |
| --- | --- | --- | --- |
| L1 | Eerste start | Zip uitpakken naar een vaste map buiten OneDrive (bijv. `C:\batch-gui`), `START.bat` dubbelklikken. | De browser opent op de startpagina; inloggen met `operator.a` / `demo` lukt; binnen een minuut klaar. |
| L2 | Stoppen en weer starten | Een stap starten in het invoerscherm. Stoppen met Ctrl+C en **J**. Opnieuw `START.bat`. Daarna nog eens, nu door het zwarte venster te sluiten. | Beide keren start alles weer; de gestarte stap staat er nog. |
| L3 | Nieuwe versie | Nieuwe zip naar een nieuwe map, `data` en `instellingen.json` meekopiëren, starten (tools/pakket/README.md, "Nieuwe versie"). | Beheer → Server toont de nieuwe versie; de batches van daarvoor staan er nog. |
| L4 | Back-up terugzetten | Een batch starten, stoppen, `BACKUP TERUGZETTEN.bat`, de back-up van vóór die batch kiezen, starten. | De batch is weg; de rest staat er; de oude database staat nog in de map `data`. |
| L5 | Lege fabriek | `LEGE FABRIEK.bat`, een eerste beheerder aanmaken, inloggen. | Geen batches en geen testaccounts; de beheerder kan accounts en velden aanmaken. |
| L6 | Beheerder vergeten | `BEHEERDER HERSTELLEN.bat`, nieuw wachtwoord geven, inloggen. | Inloggen lukt; Beheer → Logboek toont het herstel. |
| L7 | Offline op de laptop | Invoerscherm open als `operator.a`. Applicatie stoppen (Ctrl+C). Een stap afronden met waarden. Applicatie weer starten. | Tijdens het stoppen gaat de invoer door en toont de balk het aantal wachtende acties; na het starten zijn ze verstuurd, met de tijd van invoer (niet van versturen). |

## A – Apparaten

| Nr | Test | Hoe | Goed als |
| --- | --- | --- | --- |
| A1 | Handscanner | Een scanner die als toetsenbord werkt (USB). Etiketten printen (A2). In het invoerscherm, in een stap, buiten een invoerveld scannen: een batch die bezig is, een batch die klaarstaat, een lot in een lotstap, en een batch in stap 16. | Bezig: de stap opent. Klaar: de stap start ("gestart"). Stap 16: de batch wordt aangevinkt. Niet in deze stap: een duidelijke melding. Scannen in een invoerveld typt gewoon de tekst. Geen dubbele of halve scans. |
| A2 | Etiketprinter 100 × 50 mm | Planning → Etiketten, formaat etiketprinter, afdrukken via de browser (marges op Geen, schaal 100%). | Eén etiket per batch, niets afgesneden; de streepjescode scant (A1). |
| A3 | A4-vel 3 × 7 | Hetzelfde met een A4-vel etiketten. | De etiketten vallen binnen de vakjes, ook op de laatste rij. |
| A4 | Tv als wandscherm | Een pc of stick aan de tv, inloggen als `scherm1`, volledig scherm (F11). Laten staan van begin tot einde van een dienst. Ook eens met "Stappen kiezen". | Leesbaar vanaf 5 meter; ververst vanzelf; na een dag nog ingelogd; geen scrollbalken. |
| A5 | Tablet via het netwerk | Laptop open zetten voor het netwerk (tools/pakket/README.md, "Laten meekijken"). Op een tablet het adres van de laptop openen, inloggen, een stap invoeren. | Alles is met de vinger te bedienen; het toetsenbord dekt het actieve veld niet af. (Offline werkt hier niet: dat kan alleen via https, test S2.) |

## V – Op de vloer met meerdere pc's

Vraagt minstens twee apparaten aan dezelfde laptop of server (A5, of later S2).

| Nr | Test | Hoe | Goed als |
| --- | --- | --- | --- |
| V1 | Twee pc's op dezelfde batch | Op twee pc's tegelijk dezelfde batch in dezelfde stap starten. Daarna op allebei dezelfde waarde invullen. | De tweede krijgt een duidelijke melding; er staat maar één start en één waarde. |
| V2 | Twee pc's op hetzelfde lot | Op twee pc's tegelijk een lot samenstellen met (deels) dezelfde batches. | Eén lot; de tweede pc krijgt een melding en geen batch zit in twee lots. |
| V3 | Offline bij het begin van een dienst | Verbinding van een pc los vóórdat de nieuwe ploeg inlogt. Inloggen proberen. Daarna: iemand die nog was ingelogd werkt door. | Nieuw inloggen lukt niet, met een duidelijke melding (D53). Wie al was ingelogd kan doorwerken. Afspreken wat de ploeg dan doet (papier, andere pc); dat wordt een punt voor de training (#74). |
| V4 | Lang offline | Een pc een hele dienst zonder verbinding, met meerdere stappen en een stilstand. Dan weer verbinden. | Alles komt aan, in de goede volgorde, met de tijd van invoer en de naam van wie het invoerde. |
| V5 | Persoonswissel met wachtrij | Offline invoeren als `operator.a`, afmelden (de vraag over wachtende acties bevestigen), inloggen als `operator.b` met verbinding. | De invoer van operator.a komt aan op naam van operator.a (D53). |
| V6 | Lab-pc offline | Kwaliteit meet op de lab-pc zonder verbinding en geeft vrij. Daarna verbinden. | Meting en vrijgave komen aan; de batch gaat daarna pas door (D58). |
| V7 | Scherm vergeten | Een pc een nacht laten staan met het invoerscherm open en ingelogd. | De volgende ochtend vraagt hij om opnieuw in te loggen; er gaat geen invoer verloren. |

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
