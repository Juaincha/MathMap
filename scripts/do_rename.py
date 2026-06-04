"""Execute all git mv renames for content/ files.

Strategy:
- Full renames: single git mv
- Case-only renames: two-step via temp name to avoid Windows case-insensitive collision
- Collision resolution:
    baire-category-theorem.md -> Baire Category Theorem.md  (full)
    normal-family.md -> Normal Family.md                    (full, different ignoring case)
- Skip: Baire space real.md, normal-family-complex.md (collision losers — manual review)
- Skip: A-star search algorithm.md, c-star-algebra.md  (illegal * in heading)
"""

import re, subprocess, sys
from pathlib import Path
from collections import defaultdict

CONTENT = Path("content")
ILLEGAL_WIN = set('\\/:*?"<>|\x00')

COLLISION_SKIP = {"Baire space real.md", "normal-family-complex.md"}
ILLEGAL_SKIP   = {"A-star search algorithm.md", "c-star-algebra.md"}
SKIP_ALL = COLLISION_SKIP | ILLEGAL_SKIP

# Collision winners — include even though they're in the collision set
COLLISION_WINNERS = {
    "baire-category-theorem.md": "Baire Category Theorem.md",
    "normal-family.md":          "Normal Family.md",
}

rename_map = []   # (old_path, new_name, kind)
skip_list  = []
target_count = defaultdict(list)

for md in sorted(CONTENT.glob("*.md")):
    if md.name in SKIP_ALL:
        skip_list.append((md.name, "manual review"))
        continue

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
        skip_list.append((md.name, f"heading en kebab-case"))
        continue

    bad_chars = [c for c in heading if c in ILLEGAL_WIN]
    if bad_chars:
        skip_list.append((md.name, f"chars ilegales {bad_chars!r}"))
        continue

    # Override for collision winners
    if md.name in COLLISION_WINNERS:
        expected_name = COLLISION_WINNERS[md.name]
    else:
        expected_name = heading + ".md"

    target_count[expected_name].append(md.name)
    if md.name == expected_name:
        continue

    kind = "case-only" if md.name.lower() == expected_name.lower() else "full"
    rename_map.append((md, expected_name, kind))

# Safety check: collisions (after winners override)
real_collisions = {t: srcs for t, srcs in target_count.items() if len(srcs) > 1}
if real_collisions:
    print("ERROR: unexpected collisions after exclusions:")
    for t, srcs in real_collisions.items():
        print(f"  {t!r} <- {srcs}")
    sys.exit(1)

print(f"Planning {len(rename_map)} renames "
      f"({sum(1 for _,_,k in rename_map if k=='case-only')} case-only)...")

errors = []
done   = []

for md, new_name, kind in rename_map:
    old_path = md
    new_path = CONTENT / new_name

    if kind == "case-only":
        temp_name = new_name + ".__tmp__"
        temp_path = CONTENT / temp_name
        r1 = subprocess.run(
            ["git", "mv", str(old_path), str(temp_path)],
            capture_output=True, text=True
        )
        if r1.returncode != 0:
            errors.append((old_path.name, new_name, "step1: " + r1.stderr.strip()))
            continue
        r2 = subprocess.run(
            ["git", "mv", str(temp_path), str(new_path)],
            capture_output=True, text=True
        )
        if r2.returncode != 0:
            errors.append((old_path.name, new_name, "step2: " + r2.stderr.strip()))
            continue
    else:
        r = subprocess.run(
            ["git", "mv", str(old_path), str(new_path)],
            capture_output=True, text=True
        )
        if r.returncode != 0:
            errors.append((old_path.name, new_name, r.stderr.strip()))
            continue

    done.append((old_path.name, new_name))

print(f"\nDone: {len(done)} renames completed.")
if errors:
    print(f"ERRORS ({len(errors)}):")
    for old, new, err in errors:
        print(f"  {old!r} -> {new!r}: {err}")
else:
    print("No errors.")

print(f"\nManual review ({len(skip_list)} files — NOT renamed):")
for name, reason in skip_list:
    print(f"  {name!r}: {reason}")
