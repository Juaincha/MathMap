#!/usr/bin/env python3
"""
Final batch — continuation (steps 4 & 5 only; 1-3 already applied).
"""

import re, subprocess, sys
from pathlib import Path

CONTENT = Path("content")

def read(p):  return p.read_text(encoding="utf-8")
def write(p, t): p.write_text(t, encoding="utf-8")

def git_rm(p):
    r = subprocess.run(["git", "rm", str(p)], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"git rm failed: {p}\n{r.stderr}")

def replace_link(text, old, new):
    pat = re.compile(
        r'\[\[' + re.escape(old) + r'((?:#[^\]|]*)?)((?:\|[^\]]*)?)\]\]',
        re.IGNORECASE,
    )
    return pat.sub(lambda m: f"[[{new}{m.group(1)}{m.group(2)}]]", text)

def replace_dep_id(text, old_id, new_id):
    return re.sub(
        r'^(  - )' + re.escape(old_id) + r'$',
        r'\g<1>' + new_id,
        text, flags=re.MULTILINE,
    )

def get_dep_ids(text):
    """Extract IDs only from the depends_on: block (not tags)."""
    m = re.search(r'^depends_on:(.*?)(?=\n\S|\Z)', text,
                  re.MULTILINE | re.DOTALL)
    if not m:
        return set()
    return set(re.findall(r'^\s+- (.+)$', m.group(1), re.MULTILINE))

def add_dep_to_file(text, dep_id, dep_link):
    # Append to depends_on block
    text = re.sub(
        r'(depends_on:(?:\n  - [^\n]+)+)',
        lambda m: m.group(0) + f'\n  - {dep_id}',
        text, count=1,
    )
    # Append [[link]] after last [[...]] in file
    all_links = list(re.finditer(r'\[\[[^\]]+\]\]', text))
    if all_links:
        end = all_links[-1].end()
        text = text[:end] + f'\n\n[[{dep_link}]]' + text[end:]
    return text

def dep_link_name(dep_id):
    return dep_id.replace("-", " ").capitalize()

# ================================================================
# STEP 4 — Merge dual-space -> Dual space
# ================================================================

SUR4 = CONTENT / "Dual space.md"
DUP4 = CONTENT / "dual-space.md"

t_sur4 = read(SUR4)
t_dup4 = read(DUP4)

sur4_deps = get_dep_ids(t_sur4)
dup4_deps = get_dep_ids(t_dup4)
unique4   = dup4_deps - sur4_deps
print("Step 4 unique deps:", unique4)

for dep in sorted(unique4):
    t_sur4 = add_dep_to_file(t_sur4, dep, dep_link_name(dep))
write(SUR4, t_sur4)

n4 = 0
for md in sorted(CONTENT.glob("*.md")):
    if md == DUP4: continue
    orig = t = read(md)
    t = replace_dep_id(t, "dual-space", "dual-space-linear")
    t = replace_link(t, "Dual-space", "Dual space")
    t = replace_link(t, "dual-space",  "Dual space")
    if t != orig:
        write(md, t)
        n4 += 1
git_rm(DUP4)
print(f"Step 4 done: dual-space merged; {n4} files updated.")

# ================================================================
# STEP 5 — Merge Max-flow min-cut theorem graph -> Max-flow min-cut theorem
# ================================================================

SUR5 = CONTENT / "Max-flow min-cut theorem.md"
DUP5 = CONTENT / "Max-flow min-cut theorem graph.md"

t_sur5 = read(SUR5)
t_dup5 = read(DUP5)

sur5_deps = get_dep_ids(t_sur5)
dup5_deps = get_dep_ids(t_dup5)
unique5   = dup5_deps - sur5_deps
print("Step 5 unique deps:", unique5)

for dep in sorted(unique5):
    t_sur5 = add_dep_to_file(t_sur5, dep, dep_link_name(dep))
write(SUR5, t_sur5)

n5 = 0
for md in sorted(CONTENT.glob("*.md")):
    if md == DUP5: continue
    orig = t = read(md)
    t = replace_dep_id(t, "max-flow-min-cut-theorem", "max-flow-min-cut")
    t = replace_link(t, "Max-Flow Min-Cut Theorem",       "Max-flow min-cut theorem")
    t = replace_link(t, "Max-flow min-cut theorem graph", "Max-flow min-cut theorem")
    t = replace_link(t, "max-flow-min-cut-theorem",       "Max-flow min-cut theorem")
    if t != orig:
        write(md, t)
        n5 += 1
git_rm(DUP5)
print(f"Step 5 done: max-flow-min-cut-theorem merged; {n5} files updated.")

print("All steps complete.")
