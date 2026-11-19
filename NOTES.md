# Notities – stand van nu

> **Dit bestand:** de stand op dit moment, in één scherm: welke versie, wat draait waar, de laatste testronde en valkuilen voor de volgende sessie. Wordt aan het eind van elke sessie overschreven.
> **Niet hier:** wat er nog moet gebeuren → [`WISHLIST.md`](WISHLIST.md); wat er per versie veranderd is → [`CHANGELOG.md`](CHANGELOG.md); waarom → [`DECISIONS.md`](DECISIONS.md); hoe het werkt en hoe je test → [`README.md`](README.md).

Bijgewerkt: 19 november 2026 · versie **0.19.0**

## Stand
- **Fase:** proof of concept op Geerts Windows-laptop (D26). Alle functies tot en met 0.19.0 zijn gebouwd; de pilot (1.0.0) wacht op de punten onder "Vóór de pilot" in de wishlist.
- **Laptop:** Geert draait 0.7.1; 0.19.0 is als zip geleverd (`batch-gui-laptop-0.19.0-windows.zip`).
- **Fabrieksserver:** nog niet ingericht; advies en draaiboek liggen klaar (WISHLIST #10).
- **Browserdemo:** versie 0.19.0 gepubliceerd.
- **Gegevens:** alles fictief (D1).

## Laatste volledige testronde – 0.19.0, 19 november 2026
Alles geslaagd: databaseregels (79), API (61), migraties, beheertools, laptoppakket, alle schermtests in Chrome en de browserdemo. Op GitHub groen vanaf 0.15.1. Bij 0.14.0 en 0.15.0 faalde de laptoppakkettest op GitHub, maar ze kregen wel een release: niet gebruiken.

## Valkuilen voor de volgende sessie
- `tools/pakket/testdata.sql` opnieuw maken: `schema_versie` en `onderhoud_log` niet meenemen in de dump (zie README, "Testdata").
- De schermtests in Chrome draaien nog niet op GitHub (WISHLIST #27). Draai ze zelf na een wijziging, op verse testdata.
- Na een wijziging aan schema of testdata maakt `demo/bouw.sh` de demodatabase vanzelf opnieuw.

## Links
- Code: https://github.com/Gertjun/batch-input-gui (privé)
- Browserdemo: https://claude.ai/artifact/AvBGewCSnACg6h6CeUKZQN
- Projectdocument in het Claude-project: `claude/architectuur-en-besluiten.md`
- Momentopnamen (worden niet bijgewerkt): advies fabrieksserver https://claude.ai/artifact/XbFZ7nQRDn18zSS5tnQhUf · datamodel v1 https://claude.ai/artifact/54cg2QSsWQ3j6hbkzYBVTA · doorlichting 19-11-2026 https://claude.ai/artifact/6FL8onRKNHTbnqJWSF6U7i
- Whiteboard projectplan: https://claude.ai/artifact/Nm9L5rFHZY6Dtgk2JMncnF
