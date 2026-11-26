"""Reproduceerbare SVG uit de bewerkbare Gantt-bron. Geen externe renderer."""
from pathlib import Path
from xml.sax.saxutils import escape
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/diagrams/roadmap.mmd"
OUTPUT = ROOT / "docs/diagrams/roadmap.svg"

def render():
    rows = []
    for line in SOURCE.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s+(.+?)\s+:\s*(.+)$", line)
        if m:
            label, data = m.groups()
            status = "done" if data.startswith("done,") else "active" if data.startswith("active,") else "gate" if data.startswith("milestone,") else "planned"
            rows.append((label, status))
    if len(rows) != 15:
        raise ValueError("Verwacht 13 fasen en 2 poorten; pas de layout bewust aan.")
    palette = {"done":"#0B2E59","active":"#F28C28","planned":"#DCE2E8"}
    names = {"done":"Afgerond","active":"Actief","planned":"Gepland","gate":"Poort"}
    out = ["<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1100\" height=\"748\" viewBox=\"0 0 1100 748\" role=\"img\" aria-labelledby=\"titel beschrijving\">","<title id=\"titel\">MES — ontwikkelvolgorde</title>","<desc id=\"beschrijving\">Fasen en acceptatiepoorten; geen kalenderplanning.</desc>","<rect width=\"1100\" height=\"748\" fill=\"#FFFFFF\"/>","<g font-family=\"Arial, sans-serif\" fill=\"#0B2E59\">","<text x=\"24\" y=\"35\" font-size=\"25\" font-weight=\"700\">MES — ontwikkelvolgorde</text>","<text x=\"24\" y=\"60\" font-size=\"16\">Afhankelijkheden, geen kalenderplanning</text>"]
    for i, (label, status) in enumerate(rows):
        y, x = 88+i*40, 580+i*29
        bg = "#FFFFFF" if i%2 else "#F4F7F9"
        out.extend([
            f'<rect x="16" y="{y}" width="1068" height="40" fill="{bg}"/>',
            f'<text x="28" y="{y+25}" font-size="17">{escape(label)}</text>',
            f'<text x="465" y="{y+25}" font-size="15">{names[status]}</text>',
        ])
        if status == "gate":
            out.append(f'<path d="M{x+14} {y+8} l12 12 -12 12 -12 -12 Z" fill="#FFFFFF" stroke="#B45309" stroke-width="2"/>')
        else:
            stroke = "#6B7785" if status == "planned" else "#B45309" if status == "active" else "#0B2E59"
            out.append(f'<rect x="{x}" y="{y+9}" width="28" height="22" rx="3" fill="{palette[status]}" stroke="{stroke}"/>')
    out.extend(["<text x=\"24\" y=\"720\" font-size=\"15\">Donkerblauw: afgerond · Oranje: actief · Grijs: gepland · Ruit: acceptatiepoort</text>","</g>","</svg>"])
    return "\n".join(out)+"\n"

if __name__ == "__main__":
    content = render()
    if "--check" in sys.argv:
        if OUTPUT.read_text(encoding="utf-8") != content:
            raise SystemExit("Roadmap-SVG niet bij; draai python3 tools/roadmap_diagram.py")
        print("Roadmap-SVG is reproduceerbaar")
    else:
        OUTPUT.write_text(content, encoding="utf-8")
