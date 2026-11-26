"""D114: één bron voor verticale accentbreedte; geen hardgecodeerde linkeraccenten."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
tokens = (root / "gedeeld/tokens.css").read_text()
assert re.search(r"--mes-linkeraccent:\s*6px\s*;", tokens)
for folder in ("gedeeld", "portaal/src", "invoer/src"):
    for path in (root / folder).rglob("*.css"):
        css = re.sub(r"/\*.*?\*/", "", path.read_text(), flags=re.S)
        for match in re.finditer(r"border-(?:left|inline-start)(?:-width)?\s*:\s*([^;}]+)", css):
            value = match.group(1).strip()
            assert not re.match(r"(?:[3-9]|[1-9][0-9]+)px\b", value), (path, value)
        for match in re.finditer(r"box-shadow\s*:\s*inset\s+([^;}]+)", css):
            assert not re.match(r"[1-9][0-9]*px\s+0(?:px)?\b", match.group(1)), (path, match.group(1))
        assert "--mes-open-acties-accent" not in css, path
print("OK D114: centrale verticale accentbreedte")
