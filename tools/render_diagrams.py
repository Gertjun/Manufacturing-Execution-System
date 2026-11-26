"""Render the supported Mermaid subset as SVG; Graphviz for ERDs only."""
from pathlib import Path
import re
import subprocess
import sys
import json
import math
from xml.sax.saxutils import escape
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "physical-erd": "docs/DATABASE.md",
    "conceptual-erd": "docs/mes/DATA-MODEL.md",
    "architecture": "docs/mes/BLUEPRINT.md",
    "recipe-lifecycle": "docs/mes/MBR-EBR-DESIGN.md",
    "migration": "docs/mes/MIGRATION-STRATEGY.md",
    "process-chain": "docs/mes/ROLES-AND-PROCESSES.md",
}
PALETTE = {
    "structuur": ("#E7EEF6", "#0B2E59", "#0B2E59"),
    "uitvoering": ("#FDEBD9", "#B45309", "#1B2430"),
    "ondersteuning": ("#F4F7F9", "#6B7785", "#1B2430"),
}
CARDINALITY = {"||": "teetee", "|o": "teeodot", "o|": "odottee", "o{": "crowodot"}


# Layout metadata only: the Mermaid source remains authoritative for nodes/edges.
FLOW_LAYOUTS = {
    "architecture": {"M": (-200, 0), "O": (200, 0), "J": (0, 1), "C": (0, 2), "E": (0, 3), "B": (0, 4), "G": (420, 4), "Q": (0, 5)},
    "migration": {"A": (0, 0), "B": (0, 1), "C": (0, 2), "D": (0, 3), "E": (420, 4), "F": (0, 4), "G": (0, 5)},
    "recipe-lifecycle": {"A": (0, 0), "B": (0, 1), "C": (0, 2), "D": (0, 3), "E": (0, 4), "F": (420, 4), "G": (0, 5), "H": (0, 6), "I": (0, 7), "J": (0, 8), "K": (0, 9)},
    "process-chain": {"A": (0, 0), "B": (0, 1), "C": (0, 2), "D": (0, 3), "E": (0, 4), "F": (420, 4), "G": (420, 3), "H": (420, 2), "I": (420, 1), "J": (420, 0)},
}

BLOCK_W, BLOCK_H, STEP_Y = 332, 47, 105


def flow_svg(name, nodes, edges, classes, palette):
    """Fixed positions and explicit routes; labels and edges are source-derived."""
    layout = FLOW_LAYOUTS[name]
    if set(layout) != set(nodes):
        raise ValueError(f"{name}: layout must cover exactly all source nodes")
    coords = {n: (x, row * STEP_Y) for n, (x, row) in layout.items()}
    hw, hh = BLOCK_W / 2, BLOCK_H / 2
    left = min(x for x, y in coords.values()) - hw - (145 if name == "recipe-lifecycle" else 24)
    right = max(x for x, y in coords.values()) + hw + (100 if name == "migration" else 24)
    top = min(y for x, y in coords.values()) - hh - 24
    bottom = max(y for x, y in coords.values()) + hh + 24
    width, height = right - left, bottom - top
    def fmt(n):
        return f"{n:g}"
    def points(seq):
        return " ".join(f"{fmt(x)},{fmt(y)}" for x, y in seq)
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(width)}pt" height="{fmt(height)}pt" viewBox="0 0 {fmt(width)} {fmt(height)}" role="img">',
        f'<g class="graph" transform="translate({fmt(-left)} {fmt(-top)})">',
        f'<polygon fill="#FFFFFF" points="{points([(left,top),(right,top),(right,bottom),(left,bottom)])}"/>',
    ]
    for a, b, label, _, _ in edges:
        ax, ay = coords[a]
        bx, by = coords[b]
        label_pos = None
        if name == "recipe-lifecycle" and (a, b) == ("B", "A"):
            route = [(ax-hw,ay),(-220,ay),(-220,by),(bx-hw,by)]
            label_pos = (-230,(ay+by)/2+4,"end")
        elif name == "migration" and (a, b) == ("E", "C"):
            route = [(ax+hw,ay),(640,ay),(640,by),(bx+hw,by)]
        elif name == "architecture" and a in ("M", "O") and b == "J":
            route = [(ax,ay+hh),(bx+(-75 if a=="M" else 75),by-hh)]
        elif ax == bx and ay != by:
            sign = 1 if by > ay else -1
            route = [(ax,ay+sign*hh),(bx,by-sign*hh)]
            label_pos = (ax+12,(ay+by)/2+4,"start")
        elif ay == by and ax != bx:
            sign = 1 if bx > ax else -1
            route = [(ax+sign*hw,ay),(bx-sign*hw,by)]
            label_pos = ((ax+bx)/2,ay-10,"middle")
        elif bx > ax and by > ay:
            route = [(ax+hw,ay),(bx,ay),(bx,by-hh)]
            label_pos = ((ax+hw+bx)/2,ay-10,"middle")
        else:
            raise ValueError(f"{name}: no explicit route for {a} -> {b}")
        if label and label_pos is None:
            raise ValueError(f"{name}: no label position for {a} -> {b}")
        # Draw the arrowhead from the direction of the last segment.
        x0,y0 = route[-2]
        x1,y1 = route[-1]
        length = math.hypot(x1-x0,y1-y0)
        ux,uy = (x1-x0)/length,(y1-y0)/length
        tip = [(x1,y1),(x1-9*ux+4*uy,y1-9*uy-4*ux),(x1-9*ux-4*uy,y1-9*uy+4*ux)]
        shaft = route[:-1]+[(x1-7*ux,y1-7*uy)]
        lines.extend([
            '<g class="edge">', f'<title>{escape(a)}-&gt;{escape(b)}</title>',
            f'<polyline points="{points(shaft)}" fill="none" stroke="#B45309" stroke-width="1.6" stroke-linejoin="round"/>',
            f'<polygon points="{points(tip)}" fill="#B45309"/>',
        ])
        if label:
            x,y,anchor = label_pos
            lines.append(f'<text x="{fmt(x)}" y="{fmt(y)}" font-family="Arial, sans-serif" font-size="12" text-anchor="{anchor}" fill="#1B2430">{escape(label)}</text>')
        lines.append('</g>')
    for node, label in nodes.items():
        x,y = coords[node]
        fill,stroke,ink = palette[classes[node]]
        lines.extend([
            '<g class="node">', f'<title>{escape(node)}</title>',
            f'<rect x="{fmt(x-hw)}" y="{fmt(y-hh)}" width="{BLOCK_W}" height="{BLOCK_H}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>',
            f'<text x="{fmt(x)}" y="{fmt(y+5)}" font-family="Arial, sans-serif" font-size="14" text-anchor="middle" fill="{ink}">{escape(label)}</text>',
            '</g>',
        ])
    return "\n".join(lines + ['</g>', '</svg>']) + "\n"


def quote(s):
    return json.dumps(s, ensure_ascii=False)

def parse(source):
    nodes, edges, classes = {}, [], {}
    kind = None
    for raw in source.splitlines():
        line = raw.strip()
        if not line or line.startswith("%%"):
            continue
        if line in ("flowchart TD", "erDiagram"):
            if kind is not None:
                raise ValueError("Multiple diagram declarations")
            kind = line
            continue
        if line.startswith("classDef ") or line.startswith("linkStyle "):
            continue
        match = re.fullmatch(r"class ([\w,]+) (\w+)", line)
        if match:
            names, cls = match.groups()
            for name in names.split(","):
                if name in classes:
                    raise ValueError("Duplicate class: " + name)
                classes[name] = cls
            continue
        if kind == "erDiagram":
            match = re.fullmatch(r'(\w+) (\|\||\|o)--(o\{|o\|) (\w+) : "?([^"]+)"?', line)
            if match:
                a, left, right, b, label = match.groups()
                nodes.setdefault(a, a)
                nodes.setdefault(b, b)
                edges.append((a, b, label, left, right))
                continue
            if re.fullmatch(r"\w+", line):
                nodes.setdefault(line, line)
                continue
        elif kind == "flowchart TD":
            match = re.fullmatch(r"(\w+)(?:\[([^\]]+)\])? -->\s*(?:\|([^|]+)\|\s*)?(\w+)(?:\[([^\]]+)\])?", line)
            if match:
                a, al, label, b, bl = match.groups()
                for name, text in ((a, al), (b, bl)):
                    if text:
                        if name in nodes and nodes[name] not in (name, text):
                            raise ValueError("Conflicting label: " + name)
                        nodes[name] = text
                    else:
                        nodes.setdefault(name, name)
                edges.append((a, b, label or "", "", ""))
                continue
        raise ValueError("Unsupported diagram line: " + line)
    if not kind or not nodes or not edges or set(nodes) != set(classes):
        raise ValueError("Incomplete diagram or classification")
    if not set(classes.values()) <= set(PALETTE):
        raise ValueError("Unknown semantic class")
    return kind, nodes, edges, classes

def dot_source(kind, nodes, edges, classes):
    if kind != "erDiagram":
        raise ValueError("Graphviz renderer is reserved for ERDs")
    lines = [
        "digraph MES {",
        'graph [bgcolor="#FFFFFF", pad=0.25, nodesep=0.45, ranksep=0.65, rankdir=TB, fontname="Arial"];',
        'node [shape=box, style="rounded,filled", fontname="Arial", fontsize=14, margin="0.18,0.13", penwidth=1.5];',
        'edge [fontname="Arial", fontsize=11, fontcolor="#1B2430", penwidth=1.4, color="#6B7785"];',
    ]
    for node, label in nodes.items():
        fill, stroke, ink = PALETTE[classes[node]]
        lines.append(f'{quote(node)} [label={quote(label)}, fillcolor="{fill}", color="{stroke}", fontcolor="{ink}"];')
    for a, b, label, left, right in edges:
        attrs = [f"label={quote(label)}", "dir=both", f"arrowtail={CARDINALITY[left]}", f"arrowhead={CARDINALITY[right]}"]
        lines.append(f"{quote(a)} -> {quote(b)} [{', '.join(attrs)}];")
    return "\n".join(lines + ["}"]) + "\n"


def render_all(output):
    output.mkdir(parents=True, exist_ok=True)
    for name, path in SOURCES.items():
        md = (ROOT / path).read_text(encoding="utf-8")
        fence = chr(96) * 3
        sources = re.findall(re.escape(fence) + r"mermaid\n(.*?)" + re.escape(fence), md, re.S)
        if len(sources) != 1:
            raise ValueError(f"{path}: expected one Mermaid source")
        kind, nodes, edges, classes = parse(sources[0])
        if name in FLOW_LAYOUTS:
            if kind != "flowchart TD":
                raise ValueError(f"{name}: expected flowchart")
            svg = flow_svg(name, nodes, edges, classes, PALETTE)
        else:
            dot = dot_source(kind, nodes, edges, classes)
            result = subprocess.run(["dot", "-Tsvg"], input=dot, text=True, capture_output=True)
            if result.stderr:
                print(f"{name}: {result.stderr}", file=sys.stderr)
            result.check_returncode()
            svg = result.stdout
        root = ET.fromstring(svg)
        ns = {"s": "http://www.w3.org/2000/svg"}
        groups = root.findall(".//s:g", ns)
        assert sum(g.get("class") == "node" for g in groups) == len(nodes), name
        assert sum(g.get("class") == "edge" for g in groups) == len(edges), name
        graph = next(g for g in groups if g.get("class") == "graph")
        assert graph.find("s:polygon", ns).get("fill") in ("white", "#ffffff", "#FFFFFF"), name
        (output / (name + ".svg")).write_text(svg, encoding="utf-8")
        print(f"{name}: {len(nodes)} nodes, {len(edges)} edges")

if __name__ == "__main__":
    render_all(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs/diagrams/rendered")
