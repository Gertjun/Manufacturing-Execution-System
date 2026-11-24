# ISA-conformiteitsmatrix

D89 A12/G07. Status ontwerp, niet geverifieerd. Volledige toepasselijke normteksten en exacte edities/clausules nog te verkrijgen; geen formele claim. Per rij implementatie-PR, test-ID, resultaat en afwijking invullen bij faseacceptatie.

| Normmodel | Scope | Besluiten | Fase | Status / bewijs |
|---|---|---|---|---|
| ISA-95 Part 1/2 hiërarchie en resources | Binnen | A02,A04,A08,M07,M08 | 1–3 | Ontwerp; geen bewijs |
| ISA-95 Part 3 acht activiteiten | Binnen productie | A03,P06 | 2–10 | Ontwerp; geen bewijs |
| ISA-95 quality operations | Productiegebonden | R12,P09 | 7 | Ontwerp; geen bewijs |
| ISA-95 inventory operations | Verbruik/genealogie | M09 | 8 | Ontwerp; geen bewijs |
| ISA-95 maintenance operations | Beschikbaarheid/stilstand | P13 | 3 | Ontwerp; geen bewijs |
| ISA-95 Part 4/5/6 gegevensuitwisseling | Later | A11,G07 | 11 | Ontwerp; geen bewijs |
| ISA-88 Part 1 fysieke/procedurele/procesmodellen | Binnen MES | A04,R06,P07 | 2–5 | Ontwerp; geen bewijs |
| ISA-88 Part 1/2 Master/Control Recipe | Binnen | A05,A06,R01–R05 | 2–5 | Ontwerp; geen bewijs |
| ISA-88 Part 3 General/Site Recipes | Voorbereid, buiten eerste scope | A02 | Later | Scopekeuze |
| ISA-88 Part 4 Batch Production Records | Binnen | A10,R09,R10,M06 | 6–7 | Ontwerp; geen bewijs |
| Automatische batchbesturing | Buiten MES, niveau 2 | A02,A11 | 11 interface | Scopekeuze |

Bronnen: zie BLUEPRINT. Vierogen, MOC, offline en specifieke portalen zijn eigen ontwerpkeuzes, niet automatisch normvereisten. Bij afwijking rationale en acceptatie vastleggen.

Fase 1 / PR #6: afzonderlijke autorisatiebeslismodule voor rollen, scope en kwalificaties (P01–P05, M08); unit-tests toegevoegd, nog niet uitgevoerd of aangesloten op productie-API/DB. Geen conformiteitsbewijs.

D98: productie vanuit vrijgegeven Job Orders, batchidentiteit uit geautoriseerd werk (A09/P06/R04). Architectuurreview van legacy-besluiten in DECISIONS.md. Openbare ISA/OPC-modellen ondersteunen de scheiding van werkopdracht en werkelijke uitvoering; specifieke vrijgave- en rolregels zijn projectkeuzes. Nog geen implementatie- of acceptatiebewijs voor D98.

D99: Geert heeft de volledige legacy-besluitenreview goedgekeurd; overgang per fase en uitstel van niet-kernfunctionaliteit zijn nu bindend. Architectuurmapping blijft ontwerpbewijs, geen formele normconformiteit. Implementatie en testbewijs per fase nog vereist.
