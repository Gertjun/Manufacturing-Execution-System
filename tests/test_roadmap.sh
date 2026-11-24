#!/bin/sh
# Controleert dat ROADMAP.md bij is met de laatste versie (zie "Hoe we deze roadmap bijhouden" in ROADMAP.md).
# Gebruik: tests/test_roadmap.sh   (geen database nodig)
cd "$(dirname "$0")/.."
python3 - <<'PY'
import re, sys

roadmap = open("ROADMAP.md", encoding="utf-8").read()
changelog = open("CHANGELOG.md", encoding="utf-8").read()
versie = open("VERSIE", encoding="utf-8").read().strip()
fouten = []

# 1. Kopregel noemt de huidige versie.
m = re.search(r"^Bijgewerkt: .* · huidige versie (\S+)", roadmap, re.M)
if not m:
    fouten.append('kopregel "Bijgewerkt: … · huidige versie …" ontbreekt')
elif m.group(1) != versie:
    fouten.append(f"kopregel noemt versie {m.group(1)}, maar VERSIE is {versie}")

# Gebouwde punten: de nummers achter de versiekoppen in de changelog.
gebouwd = set()
for kop in re.findall(r"^## (?:\d+\.\d+\.\d+|Unreleased)(?: .*)?$", changelog, re.M):
    if "·" in kop:
        gebouwd |= {int(n) for n in re.findall(r"#(\d+)", kop.split("·", 1)[1])}

# 2. Geen gebouwd punt meer als open punt in een fase of bij "Te besluiten".
for n in sorted(int(x) for x in re.findall(r"^- #(\d+) \*\*", roadmap, re.M)):
    # D96: #88 is expliciet heropend na verwijdering van de voorspelling.
    # Alleen deze vastgelegde uitzondering; andere gebouwde punten blijven fouten.
    if n in gebouwd and not (n == 88 and re.search(r"^- #88 \*\*Voorspelling toekomstige keuringen\*\*.*D96", roadmap, re.M)):
        fouten.append(f"#{n} is gebouwd (changelog) maar staat nog als open punt")

# 3. Tijdlijn: één dubbele punt per taak, geen gebouwd nummer in een open balk.
blok = re.search(r"```mermaid\n(.*?)```", roadmap, re.S)
if not blok:
    fouten.append("tijdlijn (```mermaid) ontbreekt")
else:
    sleutels = ("gantt", "title", "dateFormat", "axisFormat", "todayMarker",
                "section", "excludes", "includes", "tickInterval", "weekday", "%%")
    for regel in blok.group(1).splitlines():
        r = regel.strip()
        if not r or r.startswith(sleutels):
            continue
        if r.count(":") != 1:
            fouten.append(f"tijdlijn: taaknaam met dubbele punt breekt de grafiek: {r}")
            continue
        naam, data = r.split(":")
        if "done" in data or "milestone" in data:
            continue
        for groep in re.findall(r"\(([\d ]+)\)", naam):
            for n in map(int, groep.split()):
                if n in gebouwd:
                    fouten.append(f"tijdlijn: #{n} is gebouwd maar staat in een open balk: {naam.strip()}")

# 4. Volgende vrije nummer klopt.
alle = {int(n) for n in re.findall(r"#(\d+)", roadmap + changelog)}
m = re.search(r"volgende vrije nummer \(nu #(\d+)\)", roadmap)
if not m:
    fouten.append('zin "volgende vrije nummer (nu #…)" ontbreekt')
elif int(m.group(1)) != max(alle - {int(m.group(1))}) + 1:
    fouten.append(f"volgende vrije nummer is #{max(alle - {int(m.group(1))}) + 1}, niet #{m.group(1)}")

if fouten:
    print("ROADMAP.md is niet bijgewerkt:")
    for f in fouten:
        print("  -", f)
    sys.exit(1)
print("ROADMAP.md is bij met versie", versie)
PY
