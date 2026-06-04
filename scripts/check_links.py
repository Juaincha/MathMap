"""Check that all [[wiki-links]] in content/ resolve to existing files."""
import re
from pathlib import Path

CONTENT = Path("content")

# Build case-insensitive lookup of existing filenames (stem only)
existing = {}
for md in CONTENT.glob("*.md"):
    existing[md.stem.lower()] = md.name

broken = []
total_links = 0

for md in sorted(CONTENT.glob("*.md")):
    text = md.read_text(encoding="utf-8")
    links = re.findall(r"\[\[([^\]|#]+?)(?:\|[^\]]*)?\]\]", text)
    for link in links:
        link = link.strip()
        total_links += 1
        if link.lower() not in existing:
            broken.append((md.name, link))

print(f"Total [[links]] checked: {total_links}")
print(f"Broken links: {len(broken)}")
if broken:
    print("\nBROKEN:")
    for f, link in broken[:60]:
        print(f"  {f!r} -> [[{link}]]")
    if len(broken) > 60:
        print(f"  ... and {len(broken)-60} more")
