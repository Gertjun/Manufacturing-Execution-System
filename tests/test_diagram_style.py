"""Broncontract B+; geen bewijs van daadwerkelijke Mermaid-layout."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
roadmap = (root / "ROADMAP.md").read_text(encoding="utf-8")
gantt = re.search(r"```mermaid\n(.*?)```", roadmap, re.S).group(1)
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
print("B+ diagrambroncontract geslaagd")
