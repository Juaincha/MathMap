import re
from pathlib import Path
from collections import defaultdict

CONTENT = Path("content")
ILLEGAL_WIN = set('\\/:*?"<>|\x00')
OUT_FILE = Path("scripts/audit_report.txt")

rename_map = []
skip_list  = []
target_count = defaultdict(list)

for md in sorted(CONTENT.glob("*.md")):
    text = md.read_text(encoding="utf-8")
    heading = None
    for line in text.splitlines():
        if line.startswith("# "):
            heading = line[2:].strip()
            break

    if not heading:
        skip_list.append((md.name, "sin encabezado #"))
        continue

    if re.match(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$", heading):
        skip_list.append((md.name, f"heading en kebab-case: {heading!r}"))
        continue

    bad_chars = [c for c in heading if c in ILLEGAL_WIN]
    if bad_chars:
        skip_list.append((md.name, f"chars ilegales {bad_chars!r} en heading: {heading!r}"))
        continue

    expected_name = heading + ".md"
    target_count[expected_name].append(md.name)

    if md.name == expected_name:
        continue

    kind = "case-only" if md.name.lower() == expected_name.lower() else "full"
    rename_map.append((md, expected_name, heading, kind))

collisions = {t: srcs for t, srcs in target_count.items() if len(srcs) > 1}
case_only   = [(o, n, h) for o, n, h, k in rename_map if k == "case-only" and n not in collisions]
full_renames = [(o, n, h) for o, n, h, k in rename_map if k == "full"      and n not in collisions]

lines = []

lines.append(f"=== COLISIONES ({len(collisions)}) — NO renombrar hasta resolver ===")
for target, sources in sorted(collisions.items()):
    lines.append(f"  Target: {target!r}")
    for s in sources:
        lines.append(f"    <- {s!r}")

lines.append(f"\n=== RENOMBRADO FULL ({len(full_renames)}) ===")
for old, new, h in full_renames:
    lines.append(f"  {old.name!r}  ->  {new!r}")

lines.append(f"\n=== SOLO MAYUSCULAS — 2 pasos ({len(case_only)}) ===")
for old, new, h in case_only:
    lines.append(f"  {old.name!r}  ->  {new!r}")

lines.append(f"\n=== REVISION MANUAL ({len(skip_list)}) ===")
for name, reason in skip_list:
    lines.append(f"  {name!r}: {reason}")

total_rename = len(full_renames) + len(case_only)
lines.append(
    f"\nTotales: {total_rename} renombrar ({len(case_only)} solo-mayusculas), "
    f"{len(collisions)} colisiones, {len(skip_list)} revisar manual"
)

OUT_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Report written: {OUT_FILE}")
print(f"Full renames: {len(full_renames)}, Case-only: {len(case_only)}, "
      f"Collisions: {len(collisions)}, Manual: {len(skip_list)}")
