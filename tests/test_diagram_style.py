"""Broncontract B+; geen bewijs van daadwerkelijke Mermaid-layout."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
roadmap = (root / "ROADMAP.md").read_text(encoding="utf-8")
gantt = (root / "docs/diagrams/roadmap.mmd").read_text(encoding="utf-8")
assert "docs/diagrams/roadmap.svg" in roadmap
assert re.findall(r"^\s+(\d+) [^\n]+:", gantt, re.M) == [str(i) for i in range(13)]
assert "2 Master Data technisch geaccepteerd :done" in gantt
assert "3 Portalstructuur en UI actief :active" in gantt
assert "gate, after ui" in gantt and "res, after gate" in gantt
for file in ("BLUEPRINT.md", "MBR-EBR-DESIGN.md", "MIGRATION-STRATEGY.md", "ROLES-AND-PROCESSES.md"):
    text = (root / "docs/mes" / file).read_text(encoding="utf-8")
    for token in ("classDef structuur fill:#E7EEF6,stroke:#0B2E59", "classDef uitvoering fill:#FDEBD9,stroke:#B45309", "linkStyle default stroke:#B45309"):
        assert token in text, (file, token)
for file in ("docs/DATABASE.md", "docs/mes/DATA-MODEL.md"):
    text = (root / file).read_text(encoding="utf-8")
    assert '"lineColor":"#6B7785"' in text
    assert "classDef structuur fill:#E7EEF6" in text
    assert "classDef uitvoering fill:#FDEBD9" in text
for file, count in {
    "docs/DATABASE.md": 7,
    "docs/mes/DATA-MODEL.md": 1,
    "docs/mes/BLUEPRINT.md": 1,
    "docs/mes/MBR-EBR-DESIGN.md": 1,
    "docs/mes/MIGRATION-STRATEGY.md": 1,
    "docs/mes/ROLES-AND-PROCESSES.md": 1,
}.items():
    document = root / file
    links = set(re.findall(r"\]\(([^)]+/rendered/[^)]+\.svg)\)", document.read_text(encoding="utf-8")))
    assert len(links) == count, (file, links)
    for link in links:
        assert (document.parent / link).is_file(), (file, link)
print("B+ diagrambroncontract en SVG-links geslaagd")
