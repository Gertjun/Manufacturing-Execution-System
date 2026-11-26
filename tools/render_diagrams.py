"""Render the supported Mermaid subset with Graphviz; documentation only."""
from pathlib import Path
import re
import subprocess
import sys
import json
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
    "architecture": {"M": (-200, 0), "O": (200, 0), "J": (0, 1), "C": (0, 2), "E": (0, 3), "B": (0, 4), "G": (400, 4), "Q": (0, 5)},
    "migration": {"A": (0, 0), "B": (0, 1), "C": (0, 2), "D": (0, 3), "E": (420, 4), "F": (0, 4), "G": (0, 5)},
    "recipe-lifecycle": {"A": (0, 0), "B": (0, 1), "C": (0, 2), "D": (0, 3), "E": (0, 4), "F": (420, 4), "G": (0, 5), "H": (0, 6), "I": (0, 7), "J": (0, 8), "K": (0, 9)},
    "process-chain": {"A": (0, 0), "B": (0, 1), "C": (0, 2), "D": (0, 3), "E": (0, 4), "F": (420, 4), "G": (420, 3), "H": (420, 2), "I": (420, 1), "J": (420, 0)},
}

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

def dot_source(kind, nodes, edges, classes, name):
    layout = FLOW_LAYOUTS.get(name)
    if layout is not None and set(layout) != set(nodes):
        raise ValueError(f'{name}: layout must cover exactly all source nodes')
    er = kind == "erDiagram"
    lines = [
        "digraph MES {",
        'graph [bgcolor="#FFFFFF", pad=0.25, nodesep=0.45, ranksep=0.65, rankdir=TB, fontname="Arial"];',
        'node [shape=box, style="rounded,filled", fontname="Arial", fontsize=14, margin="0.18,0.13", penwidth=1.5];',
        'edge [fontname="Arial", fontsize=11, fontcolor="#1B2430", penwidth=1.4, color=' + quote("#6B7785" if er else "#B45309") + "];",
    ]
    if layout is not None:
        lines.append('graph [splines=true, overlap=true];')
        lines.append('node [fixedsize=true, width=4.6, height=0.65];')
    for node, label in nodes.items():
        fill, stroke, ink = PALETTE[classes[node]]
        position = ""
        if layout is not None:
            x, row = layout[node]
            position = f', pos="{x},{-row * 105}!"'
        lines.append(f'{quote(node)} [label={quote(label)}, fillcolor="{fill}", color="{stroke}", fontcolor="{ink}"{position}];')
    for a, b, label, left, right in edges:
        attrs = [f"label={quote(label)}"]
        if er:
            attrs.extend(["dir=both", f"arrowtail={CARDINALITY[left]}", f"arrowhead={CARDINALITY[right]}"])
        if name == "recipe-lifecycle" and (a, b) == ("B", "A"):
            attrs.extend(["tailport=e", "headport=e"])
        if name == "migration" and (a, b) == ("E", "C"):
            attrs.extend(["tailport=n", "headport=e"])
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
        dot = dot_source(kind, nodes, edges, classes, name)
        command = ["neato", "-n2", "-Tsvg"] if name in FLOW_LAYOUTS else ["dot", "-Tsvg"]
        svg = subprocess.run(command, input=dot, text=True, capture_output=True, check=True).stdout
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
