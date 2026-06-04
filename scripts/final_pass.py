#!/usr/bin/env python3
"""
Final batch pass — executes everything without stops:
  1. Fix 4 ambiguous link groups in all files.
  2. Retitle Baire space real.md → Baire space.md (keep id).
  3. Merge normal-family-complex  → Normal family.md
  4. Merge dual-space             → Dual space.md
  5. Merge Max-flow min-cut theorem graph.md → Max-flow min-cut theorem.md
"""

import re, subprocess, sys
from pathlib import Path
from collections import defaultdict

CONTENT = Path("content")

# ── helpers ──────────────────────────────────────────────────

def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")

def write(p: Path, t: str) -> None:
    p.write_text(t, encoding="utf-8")

def git_mv(src: Path, dst: Path) -> None:
    r = subprocess.run(["git", "mv", str(src), str(dst)],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"git mv failed: {src} -> {dst}\n{r.stderr}")

def git_rm(p: Path) -> None:
    r = subprocess.run(["git", "rm", str(p)],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"git rm failed: {p}\n{r.stderr}")

def replace_link(text: str, old: str, new: str) -> str:
    """Replace [[old(#anchor)?(|display)?]] with [[new(#anchor)?(|display)?]].
    Case-insensitive on the target."""
    pat = re.compile(
        r'\[\[' + re.escape(old) + r'((?:#[^\]|]*)?)((?:\|[^\]]*)?)\]\]',
        re.IGNORECASE,
    )
    return pat.sub(lambda m: f"[[{new}{m.group(1)}{m.group(2)}]]", text)

def replace_dep_id(text: str, old_id: str, new_id: str) -> str:
    """Replace '  - old_id' lines inside depends_on with '  - new_id'."""
    return re.sub(
        r'^(  - )' + re.escape(old_id) + r'$',
        r'\g<1>' + new_id,
        text,
        flags=re.MULTILINE,
    )

def add_dep_to_file(text: str, dep_id: str, dep_link: str) -> str:
    """Append dep_id to depends_on list and dep_link to body [[links]]."""
    # --- frontmatter: append after last '  - <something>' in the depends_on block
    text = re.sub(
        r'(depends_on:(?:\n  - [^\n]+)+)',
        lambda m: m.group(0) + f'\n  - {dep_id}',
        text,
        count=1,
    )
    # --- body: append after the last [[…]] in the file
    all_links = list(re.finditer(r'\[\[[^\]]+\]\]', text))
    if all_links:
        end = all_links[-1].end()
        text = text[:end] + f'\n\n[[{dep_link}]]' + text[end:]
    return text

def dep_link_name(dep_id: str) -> str:
    """Convert 'foo-bar-baz' → 'Foo bar baz' (sentence case, no proper nouns).
    Good enough for the three specific IDs we need."""
    return dep_id.replace("-", " ").capitalize()

# ═════════════════════════════════════════════════════════════
# STEP 1 — Fix 4 ambiguous link groups in ALL files
# ═════════════════════════════════════════════════════════════

AMBIG = [
    ("ZF Set Theory",                 "Zermelo–Fraenkel set theory"),
    ("Lp Space",                      "L^p space"),
    ("Dimension",                     "Dimension of a vector space"),
    ("Characteristic Equation (ODE)", "Characteristic equation"),
]

n1 = 0
for md in sorted(CONTENT.glob("*.md")):
    orig = t = read(md)
    for old, new in AMBIG:
        t = replace_link(t, old, new)
    if t != orig:
        write(md, t)
        n1 += 1
print(f"[1] Ambiguous links fixed in {n1} files.")

# ═════════════════════════════════════════════════════════════
# STEP 2 — Retitle Baire space real.md → Baire space.md
# ═════════════════════════════════════════════════════════════

baire_old = CONTENT / "Baire space real.md"
baire_new = CONTENT / "Baire space.md"

t = read(baire_old)
t = re.sub(r'^# Baire Category Theorem$', '# Baire space', t, flags=re.MULTILINE)
t = t.replace("[[Complete Metric Space]]", "[[Complete metric space]]")
t = t.replace("[[Open Set]]",              "[[Open set]]")
write(baire_old, t)
git_mv(baire_old, baire_new)

n2 = 0
for md in sorted(CONTENT.glob("*.md")):
    orig = t = read(md)
    t = replace_link(t, "Baire space real", "Baire space")
    if t != orig:
        write(md, t)
        n2 += 1
print(f"[2] Baire space real renamed; [[Baire space real]] fixed in {n2} files.")

# ═════════════════════════════════════════════════════════════
# STEP 3 — Merge normal-family-complex → Normal family
# ═════════════════════════════════════════════════════════════

SUR3 = CONTENT / "Normal family.md"
DUP3 = CONTENT / "normal-family-complex.md"

t_sur3 = read(SUR3)
t_dup3 = read(DUP3)

sur3_deps = set(re.findall(r'^  - (.+)$', t_sur3, re.MULTILINE))
dup3_deps = set(re.findall(r'^  - (.+)$', t_dup3, re.MULTILINE))
unique3   = dup3_deps - sur3_deps
print(f"[3] unique deps to add to Normal family: {unique3}")

for dep in sorted(unique3):
    t_sur3 = add_dep_to_file(t_sur3, dep, dep_link_name(dep))
write(SUR3, t_sur3)

n3 = 0
for md in sorted(CONTENT.glob("*.md")):
    if md == DUP3:
        continue
    orig = t = read(md)
    t = replace_dep_id(t, "normal-family-complex", "normal-family")
    t = replace_link(t,  "Normal Family",           "Normal family")
    t = replace_link(t,  "normal-family-complex",   "Normal family")
    if t != orig:
        write(md, t)
        n3 += 1
git_rm(DUP3)
print(f"[3] Merged normal-family-complex → Normal family; {n3} files updated.")

# ═════════════════════════════════════════════════════════════
# STEP 4 — Merge dual-space → Dual space
# ═════════════════════════════════════════════════════════════

SUR4 = CONTENT / "Dual space.md"
DUP4 = CONTENT / "dual-space.md"

t_sur4 = read(SUR4)
t_dup4 = read(DUP4)

sur4_deps = set(re.findall(r'^  - (.+)$', t_sur4, re.MULTILINE))
dup4_deps = set(re.findall(r'^  - (.+)$', t_dup4, re.MULTILINE))
unique4   = dup4_deps - sur4_deps
print(f"[4] unique deps to add to Dual space: {unique4}")

for dep in sorted(unique4):
    t_sur4 = add_dep_to_file(t_sur4, dep, dep_link_name(dep))
write(SUR4, t_sur4)

n4 = 0
for md in sorted(CONTENT.glob("*.md")):
    if md == DUP4:
        continue
    orig = t = read(md)
    t = replace_dep_id(t, "dual-space", "dual-space-linear")
    # Hyphenated link variants → space variant (survivor)
    t = replace_link(t, "Dual-space", "Dual space")
    t = replace_link(t, "dual-space", "Dual space")
    if t != orig:
        write(md, t)
        n4 += 1
git_rm(DUP4)
print(f"[4] Merged dual-space → Dual space; {n4} files updated.")

# ═════════════════════════════════════════════════════════════
# STEP 5 — Merge Max-flow min-cut theorem graph → Max-flow min-cut theorem
# ═════════════════════════════════════════════════════════════

SUR5 = CONTENT / "Max-flow min-cut theorem.md"
DUP5 = CONTENT / "Max-flow min-cut theorem graph.md"

t_sur5 = read(SUR5)
t_dup5 = read(DUP5)

sur5_deps = set(re.findall(r'^  - (.+)$', t_sur5, re.MULTILINE))
dup5_deps = set(re.findall(r'^  - (.+)$', t_dup5, re.MULTILINE))
unique5   = dup5_deps - sur5_deps
print(f"[5] unique deps to add to Max-flow min-cut theorem: {unique5}")

for dep in sorted(unique5):
    t_sur5 = add_dep_to_file(t_sur5, dep, dep_link_name(dep))
write(SUR5, t_sur5)

n5 = 0
for md in sorted(CONTENT.glob("*.md")):
    if md == DUP5:
        continue
    orig = t = read(md)
    t = replace_dep_id(t, "max-flow-min-cut-theorem", "max-flow-min-cut")
    t = replace_link(t, "Max-Flow Min-Cut Theorem",        "Max-flow min-cut theorem")
    t = replace_link(t, "Max-flow min-cut theorem graph",  "Max-flow min-cut theorem")
    t = replace_link(t, "max-flow-min-cut-theorem",        "Max-flow min-cut theorem")
    if t != orig:
        write(md, t)
        n5 += 1
git_rm(DUP5)
print(f"[5] Merged max-flow-min-cut-theorem → max-flow-min-cut; {n5} files updated.")

print("\nAll steps done. Rebuild graph.json next.")
