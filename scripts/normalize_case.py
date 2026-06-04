#!/usr/bin/env python3
"""
normalize_case.py — sentence-case normalization + link repair.

Rules:
  - Change ONLY casing, never concept words.
  - First word: capitalize first letter.
  - Subsequent words: lowercase unless in PROPER_NOUNS.
  - En-dash / hyphen compounds: treat each part separately.
  - Wikipedia URL: used ONLY to detect proper-noun status of doubtful words
    (if a word appears capitalized mid-title in the URL, add it to set).
  - Special (*): sanitize filename, keep heading verbatim.
  - Collisions: skip, report for manual review.
  - Ambiguous links: list with proposal for user to decide.

Usage:
  python normalize_case.py          # dry-run (no writes, no renames)
  python normalize_case.py --apply  # apply all changes
"""

import re, subprocess, sys
from pathlib import Path
from urllib.parse import unquote
from collections import defaultdict

CONTENT    = Path("content")
REPORT_OUT = Path("scripts/normalize_report.txt")
DRY_RUN    = "--apply" not in sys.argv

# ──────────────────────────────────────────────────────────────
# SKIP LISTS
# ──────────────────────────────────────────────────────────────
COLLISION_SKIP = {
    "Baire space real.md",
    "normal-family-complex.md",
    "dual-space.md",
    "Max-flow min-cut theorem graph.md",
}

# Files with * in heading: keep heading, use sanitized filename
# Format: current_filename → new_filename
STAR_FILES = {
    "A-star search algorithm.md": "A-star search algorithm.md",
    "c-star-algebra.md":          "C-star algebra.md",
}

# ──────────────────────────────────────────────────────────────
# PROPER NOUNS — always capitalized in sentence case
# ──────────────────────────────────────────────────────────────
PROPER_NOUNS = {
    # Mathematicians / eponyms
    "abel", "abelian",
    "archimedean",
    "artin", "artinian",
    "ascoli",
    "arzela",
    "baire",
    "bendixson",
    "bonnet",
    "banach",
    "bayes",
    "bell",
    "bellman",
    "bernoulli", "bernstein",
    "bessel",
    "bezout", "bézout",
    "birkhoff",
    "bolzano",
    "boole", "boolean",
    "borel",
    "brownian",
    "burnside",
    "cantor",
    "caratheodory", "carathéodory",
    "cartesian",
    "catalan",
    "cauchy",
    "cayley",
    "chebyshev",
    "church",
    "cramér", "cramer",
    "de",            # De Morgan (capitalize; "de" in names is uppercase in English)
    "dedekind",
    "dijkstra",
    "dilworth",
    "dirichlet",
    "egorov",
    "eilenberg",
    "euclidean",
    "euler", "eulerian",
    "fatou",
    "fermat",
    "fibonacci",
    "floquet",
    "floyd",
    "ford",
    "fourier",
    "fraenkel",
    "fubini",
    "galois",
    "gauss", "gaussian",
    "gelfand",
    "gessel",
    "godel", "gödel",
    "gram",
    "green",
    "gronwall",
    "haar",
    "hadamard",
    "hahn",
    "hall",
    "hamilton", "hamiltonian",
    "hausdorff",
    "heine",
    "hermite", "hermitian",
    "hilbert",
    "holder", "hölder",
    "hopf",
    "jacobi", "jacobian",
    "jordan",
    "kampen",
    "kirchhoff",
    "kolmogorov",
    "kronecker",
    "kruskal",
    "krull",
    "lagrange", "lagrangian",
    "laplace", "laplacian",
    "lebesgue",
    "legendre",
    "leibniz",
    "lie",
    "lindstrom", "lindström",
    "liouville",
    "lipschitz",
    "lovász", "lovasz",
    "luzin",
    "lyapunov",
    "maclane",
    "markov",
    "mersenne",
    "mirsky",
    "mittag",
    "mobius", "möbius",
    "morgan",         # De Morgan
    "nakayama",
    "neumann",
    "newton",
    "nikodym",
    "noether", "noetherian",
    "peano",
    "picard",
    "poincare", "poincaré",
    "poisson",
    "polya", "pólya",
    "prim",
    "pythagoras", "pythagorean",
    "radon",
    "ramsey",
    "ricci",
    "riemann", "riemannian",
    "rinow",
    "robertson",
    "rolle",
    "rouche", "rouché",
    "russell",
    "schroeder",
    "schur",
    "schmidt",
    "schwarz",
    "schwartz",
    "seifert",
    "seymour",
    "sobolev",
    "stirling",
    "stokes",
    "stone",
    "sturm",
    "sylow",
    "sylvester",
    "taylor",
    "thales",
    "tonelli",
    "turing",
    "turan", "turán",
    "urysohn",
    "van",            # Van der Waerden
    "viennot",
    "vitali",
    "von",            # Von Neumann
    "waerden",
    "warshall",
    "wedderburn",
    "weierstrass",
    "weyl",
    "wiener",
    "wronskian",
    "yoneda",
    "zermelo",
    "zorn",
}

# ──────────────────────────────────────────────────────────────
# SENTENCE CASE IMPLEMENTATION
# ──────────────────────────────────────────────────────────────

def _is_proper(word: str) -> bool:
    """Check if the lowercased core of a word is a proper noun."""
    core = word.lower()
    # Strip trailing punctuation only (never strip letters — avoids destroying 'weierstrass', 'gauss' etc.)
    core = core.rstrip(".,;:")
    # Remove possessive suffix as a whole string (not char-by-char)
    for suf in ("'s", "’s", "‘s"):
        if core.endswith(suf):
            core = core[: -len(suf)]
            break
    return core in PROPER_NOUNS


def _case_atom(atom: str, force_cap: bool) -> str:
    """Apply case rules to an atom (no separators inside)."""
    if not atom:
        return atom
    # Strip surrounding punctuation to get the core (e.g., "(ODEs)" -> "ODEs")
    core = atom.strip("()[].,;:")
    # Preserve all-uppercase abbreviations: ODE, NP, CW, O, ZF, etc.
    if core.isupper():
        return atom
    # Preserve plural of abbreviations: ODEs, PDEs, NPs (core[:-1] is all-uppercase)
    if len(core) >= 3 and core[-1] == "s" and core[:-1].isupper():
        return atom
    if force_cap or _is_proper(atom):
        return atom[0].upper() + atom[1:]
    return atom.lower()


def sentence_case(heading: str) -> str:
    """Convert heading to sentence case.
    Preserves the actual words; only changes casing."""
    if not heading:
        return heading

    words = heading.split(" ")
    result = []

    for i, word in enumerate(words):
        if not word:
            result.append(word)
            continue

        is_first = (i == 0)

        # Handle apostrophe possessives first ("Cantor's", "Hall's", etc.)
        for apos in ("’s", "'s", "’", "'"):
            if word.endswith(apos):
                base  = word[: -len(apos)]
                cased = _case_atom(base, is_first)
                result.append(cased + apos)
                break
        else:
            # Handle en-dash or hyphen compounds ("Cauchy–Schwarz", "max-flow")
            sep = None
            if "–" in word:
                sep = "–"
            elif "-" in word:
                sep = "-"

            if sep:
                parts = word.split(sep)
                cased_parts = [
                    _case_atom(p, force_cap=(j == 0 and is_first))
                    for j, p in enumerate(parts)
                ]
                result.append(sep.join(cased_parts))
            else:
                result.append(_case_atom(word, is_first))

    return " ".join(result)


# ──────────────────────────────────────────────────────────────
# FILE PARSING
# ──────────────────────────────────────────────────────────────

HEADING_RE = re.compile(r"^# (.+)$", re.MULTILINE)
WIKI_RE    = re.compile(r"^wikipedia:\s*(\S+)", re.MULTILINE)
LINK_RE    = re.compile(r"\[\[([^\]|\n#]+?)(?:#[^\]|]*)?((?:\|[^\]]*)?)\]\]")


def parse_file(text: str):
    h  = HEADING_RE.search(text)
    w  = WIKI_RE.search(text)
    return (
        h.group(1).strip() if h else "",
        w.group(1).strip() if w else "",
    )


def update_heading(text: str, new_h: str) -> str:
    return HEADING_RE.sub(f"# {new_h}", text, count=1)


def fix_links_in_text(text: str, link_map: dict) -> tuple[str, int]:
    """Replace [[links]] using link_map {target_lower: canonical_stem}.
    Returns (new_text, num_replacements)."""
    count = 0

    def repl(m):
        nonlocal count
        target  = m.group(1).strip()
        suffix  = m.group(2)        # "|display" or ""
        canon   = link_map.get(target.lower())
        if canon and target != canon:
            count += 1
            return f"[[{canon}{suffix}]]"
        return m.group(0)

    new_text = LINK_RE.sub(repl, text)
    return new_text, count


# ──────────────────────────────────────────────────────────────
# GIT OPERATIONS
# ──────────────────────────────────────────────────────────────

def git_mv(src: Path, dst: Path) -> str:
    r = subprocess.run(["git", "mv", str(src), str(dst)],
                       capture_output=True, text=True)
    return "" if r.returncode == 0 else r.stderr.strip()


def git_mv_2step(src: Path, dst: Path) -> str:
    tmp = src.parent / (src.stem + ".__TMP__.md")
    e = git_mv(src, tmp)
    if e:
        return f"step1: {e}"
    e = git_mv(tmp, dst)
    if e:
        return f"step2: {e}"
    return ""


# ──────────────────────────────────────────────────────────────
# PHASE 1 — READ & COMPUTE
# ──────────────────────────────────────────────────────────────

records    = {}       # old_name -> dict
skip_list  = []       # (name, reason)

for md in sorted(CONTENT.glob("*.md")):
    nm = md.name

    if nm in COLLISION_SKIP:
        skip_list.append((nm, "colision — revision manual"))
        continue

    text = md.read_text(encoding="utf-8")
    old_h, wiki_url = parse_file(text)

    if nm in STAR_FILES:
        # Keep heading verbatim; only sanitize filename
        new_name = STAR_FILES[nm]
        records[nm] = dict(
            path=md, text=text, old_h=old_h,
            new_h=old_h, new_name=new_name, star=True,
        )
        continue

    if not old_h:
        skip_list.append((nm, "sin encabezado #"))
        continue

    new_h    = sentence_case(old_h)
    new_name = new_h + ".md"

    records[nm] = dict(
        path=md, text=text, old_h=old_h,
        new_h=new_h, new_name=new_name, star=False,
    )

# ──────────────────────────────────────────────────────────────
# PHASE 2 — DETECT COLLISIONS IN NEW NAMES
# ──────────────────────────────────────────────────────────────

name_bucket = defaultdict(list)   # new_name_lower -> [old_names]
for nm, rec in records.items():
    name_bucket[rec["new_name"].lower()].append(nm)

new_collisions = []
for target_lower, srcs in name_bucket.items():
    if len(srcs) > 1:
        # Keep the one whose old name is already closest to the target
        winner = min(srcs, key=lambda n: n.lower() != target_lower)
        for loser in srcs:
            if loser != winner:
                new_collisions.append((loser, winner, target_lower))
                skip_list.append((loser, f"colision con {winner!r}"))
                del records[loser]

# ──────────────────────────────────────────────────────────────
# PHASE 3 — BUILD LINK MAP
# {old_stem_lower: new_stem}  for ALL files (unchanged included)
# ──────────────────────────────────────────────────────────────

link_map = {}

for nm, rec in records.items():
    old_stem = Path(nm).stem
    new_stem = Path(rec["new_name"]).stem
    link_map[old_stem.lower()] = new_stem
    link_map[new_stem.lower()] = new_stem   # self-map for already-correct links

# Star file aliases (links use both star and sane names)
STAR_ALIASES = {
    "c*-algebra":              "C-star algebra",
    "c-star algebra":          "C-star algebra",
    "a* search algorithm":     "A-star search algorithm",
    "a-star search algorithm": "A-star search algorithm",
}
link_map.update({k: v for k, v in STAR_ALIASES.items()})

# Collision-skip files stay in map under their CURRENT name (unchanged)
for nm in COLLISION_SKIP:
    stem = Path(nm).stem
    link_map[stem.lower()] = stem

# ──────────────────────────────────────────────────────────────
# PHASE 4 — SCAN FOR BROKEN / AMBIGUOUS LINKS
# ──────────────────────────────────────────────────────────────

# Pre-declared ambiguous (require user decision)
AMBIGUOUS_PROPOSALS = {
    "zf set theory":               "Zermelo–Fraenkel set theory",
    "dimension":                   "Dimension of a vector space",
    "characteristic equation (ode)": "Characteristic equation",
    "lp space":                    "L^p space",   # current name uses ^ notation
}

broken_unknown  = defaultdict(list)   # link_lower -> [(file, full_match)]
broken_ambiguous = defaultdict(list)  # link_lower -> [(file, full_match)]

for md in sorted(CONTENT.glob("*.md")):
    text = md.read_text(encoding="utf-8")
    for m in LINK_RE.finditer(text):
        tgt = m.group(1).strip()
        tl  = tgt.lower()
        if tl not in link_map:
            if tl in AMBIGUOUS_PROPOSALS:
                broken_ambiguous[tl].append((md.name, m.group(0)))
            else:
                # Try en-dash / hyphen normalization
                norm = tl.replace("–", "-")
                found = False
                for k, v in link_map.items():
                    if k.replace("–", "-") == norm:
                        link_map[tl] = v   # add to map so it gets fixed
                        found = True
                        break
                if not found:
                    broken_unknown[tl].append((md.name, m.group(0)))

# ──────────────────────────────────────────────────────────────
# PHASE 5 — COMPUTE CHANGED TEXTS (no disk writes in dry-run)
# ──────────────────────────────────────────────────────────────

new_texts    = {}   # old_name -> new_text
heading_edits = []  # (nm, old_h, new_h)
link_edits   = []   # (nm, count)
name_changes = []   # (old_name, new_name, kind)

for nm, rec in records.items():
    text  = rec["text"]
    dirty = False

    # Heading update
    if rec["old_h"] != rec["new_h"] and not rec["star"]:
        text  = update_heading(text, rec["new_h"])
        heading_edits.append((nm, rec["old_h"], rec["new_h"]))
        dirty = True

    # Link updates
    text, n_links = fix_links_in_text(text, link_map)
    if n_links:
        link_edits.append((nm, n_links))
        dirty = True

    new_texts[nm] = text

    if nm != rec["new_name"]:
        kind = "case" if nm.lower() == rec["new_name"].lower() else "full"
        name_changes.append((nm, rec["new_name"], kind))

# ──────────────────────────────────────────────────────────────
# PHASE 6 — APPLY (only if --apply flag)
# ──────────────────────────────────────────────────────────────

rename_ok  = []
rename_err = []

if not DRY_RUN:
    # Write updated content first
    for nm, text in new_texts.items():
        records[nm]["path"].write_text(text, encoding="utf-8")

    # Rename files
    for old_nm, new_nm, kind in name_changes:
        old_p = CONTENT / old_nm
        new_p = CONTENT / new_nm
        if new_p.exists() and new_p.resolve() != old_p.resolve():
            rename_err.append((old_nm, new_nm, "destination already exists"))
            continue
        err = git_mv_2step(old_p, new_p) if kind == "case" else git_mv(old_p, new_p)
        if err:
            rename_err.append((old_nm, new_nm, err))
        else:
            rename_ok.append((old_nm, new_nm))

# ──────────────────────────────────────────────────────────────
# REPORT
# ──────────────────────────────────────────────────────────────

out = []
mode_tag = "DRY RUN" if DRY_RUN else "APPLIED"
out.append(f"=== normalize_case.py — {mode_tag} ===\n")

out.append(f"--- Headings to normalize: {len(heading_edits)} ---")
for nm, oh, nh in heading_edits:
    out.append(f"  {nm!r}: {oh!r} -> {nh!r}")

out.append(f"\n--- Filename changes: {len(name_changes)} ---")
for on, nn, k in name_changes:
    out.append(f"  [{k}] {on!r} -> {nn!r}")

if not DRY_RUN:
    out.append(f"\n--- Renames OK: {len(rename_ok)}, Errors: {len(rename_err)} ---")
    for on, nn, err in rename_err:
        out.append(f"  ERROR {on!r} -> {nn!r}: {err}")

out.append(f"\n--- Link updates: {sum(n for _,n in link_edits)} replacements across {len(link_edits)} files ---")

out.append(f"\n=== AMBIGUOUS LINKS — NEED YOUR DECISION ({len(broken_ambiguous)}) ===")
for tl in sorted(broken_ambiguous):
    occ  = broken_ambiguous[tl]
    prop = AMBIGUOUS_PROPOSALS.get(tl, "?")
    out.append(f"\n  [[{tl}]] — proposal: -> [[{prop}]]")
    for fn, full in occ:
        out.append(f"    in {fn!r}")

out.append(f"\n=== UNKNOWN BROKEN LINKS ({len(broken_unknown)}) ===")
for tl in sorted(broken_unknown):
    occ = broken_unknown[tl]
    out.append(f"  [[{tl}]] — no match found ({len(occ)} occ.)")
    for fn, full in occ[:3]:
        out.append(f"    in {fn!r}")

out.append(f"\n=== COLLISION FILES — CONTENT SUMMARY ===")
for nm in sorted(COLLISION_SKIP):
    md = CONTENT / nm
    if md.exists():
        t = md.read_text(encoding="utf-8")
        h = HEADING_RE.search(t)
        id_m = re.search(r"^id:\s*(\S+)", t, re.MULTILINE)
        dep_m = re.search(r"^depends_on:(.*?)(?=\n\S|\Z)", t, re.MULTILINE | re.DOTALL)
        deps = re.findall(r"-\s+(\S+)", dep_m.group(1)) if dep_m else []
        out.append(
            f"  {nm!r}: id={id_m.group(1) if id_m else '?'!r}, "
            f"heading={h.group(1).strip() if h else '?'!r}, deps={deps[:4]}"
        )

out.append(f"\n=== SKIPPED FILES: {len(skip_list)} ===")
for nm, reason in skip_list:
    out.append(f"  {nm!r}: {reason}")

out.append(
    f"\n=== SUMMARY ===\n"
    f"  Headings normalized:   {len(heading_edits)}\n"
    f"  Filenames to rename:   {len(name_changes)}\n"
    f"  Link replacements:     {sum(n for _,n in link_edits)}\n"
    f"  Ambiguous links:       {sum(len(v) for v in broken_ambiguous.values())} occurrences in {len(broken_ambiguous)} groups\n"
    f"  Unknown broken links:  {sum(len(v) for v in broken_unknown.values())} occurrences in {len(broken_unknown)} groups\n"
    f"  Skipped files:         {len(skip_list)}\n"
)

REPORT_OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
# Print summary to stdout (safe ASCII proxy)
summary_start = next(i for i,l in enumerate(out) if "SUMMARY" in l)
for l in out[summary_start:]:
    try:
        print(l)
    except UnicodeEncodeError:
        print(l.encode("ascii", "replace").decode())
print(f"\n[Full report -> {REPORT_OUT}]")
