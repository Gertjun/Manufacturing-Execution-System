"""Controleer centrale B+ contrastparen, geen claim over gerenderde schermen."""
import re
from pathlib import Path

css = (Path(__file__).resolve().parents[1] / "gedeeld/tokens.css").read_text(encoding="utf-8")
tokens = dict(re.findall(r"(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;", css))

def luminance(value):
    rgb = [int(value[i:i+2], 16) / 255 for i in (1, 3, 5)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    return sum(v * w for v, w in zip(rgb, (.2126, .7152, .0722)))

def contrast(a, b):
    x, y = sorted((luminance(tokens[a]), luminance(tokens[b])))
    return (y + .05) / (x + .05)

pairs = [
    ("--mes-actie-tekst", "--vlak", 4.5),
    ("--mes-actie-hover-tekst", "--mes-uitvoering-vlak", 4.5),
    ("--mes-structuur", "--vlak", 4.5),
    ("--mes-structuur", "--mes-achtergrond", 4.5),
    ("--mes-structuur", "--mes-structuur-vlak", 4.5),
    ("--op-kleur", "--mes-menu-actief", 4.5),
    ("--mes-uitvoering", "--mes-menu-actief", 3),
    ("--mes-focus-donker", "--mes-structuur", 3),
    ("--focus", "--vlak", 3),
    ("--grens", "--vlak", 4.5),
    ("--grens-donker", "--grens-vlak", 4.5),
    ("--ok", "--vlak", 4.5),
    ("--tol", "--vlak", 4.5),
]
for a, b, minimum in pairs:
    actual = contrast(a, b)
    assert actual >= minimum, f"{a} / {b}: {actual:.2f} < {minimum}"
    print(f"OK {a} / {b}: {actual:.2f}")
