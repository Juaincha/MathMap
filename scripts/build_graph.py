from pathlib import Path
import json
import yaml
import math

CONTENT_DIR = Path("content")
OUTPUT_FILE = Path("viewer/public/graph.json")

# ── Tag priority (1 = most foundational) ──────────────────────────────────────
TAG_PRIORITY = {
    'logic':                  1,
    'set-theory':             2,
    'foundations':            3,
    'order-theory':           4,
    'abstract-algebra':       5,
    'algebra':                6,
    'linear-algebra':         7,
    'number-theory':          8,
    'combinatorics':          9,
    'real-analysis':         10,
    'calculus':              11,
    'topology':              12,
    'geometry':              13,
    'analysis':              14,
    'measure-theory':        15,
    'graph-theory':          16,
    'complex-analysis':      17,
    'differential-equations': 18,
    'differential-geometry': 19,
    'functional-analysis':   20,
    'probability':           21,
    'algorithms':            22,
}

nodes = []
edges = []

# Para validar dependencias
known_ids = set()

# -------------------------
# PRIMERA PASADA: NODOS
# -------------------------

for md_file in CONTENT_DIR.rglob("*.md"):
    text = md_file.read_text(encoding="utf-8")

    if not text.startswith("---"):
        continue

    parts = text.split("---", 2)

    if len(parts) < 3:
        continue

    frontmatter = yaml.safe_load(parts[1]) or {}

    node_id = frontmatter.get("id")

    if not node_id:
        print(f"[WARNING] {md_file} no tiene id")
        continue

    known_ids.add(node_id)

    # Extract label from H1 heading in body; fall back to file stem
    body = parts[2] if len(parts) >= 3 else ""
    label = None
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            label = stripped[2:].strip()
            break
    if not label:
        label = md_file.stem

    nodes.append({
        "id": node_id,
        "label": label,
        "type": frontmatter.get("type"),
        "tags": frontmatter.get("tags", []),
        "wikipedia": frontmatter.get("wikipedia")
    })

# -------------------------
# SEGUNDA PASADA: ARISTAS
# -------------------------

for md_file in CONTENT_DIR.rglob("*.md"):
    text = md_file.read_text(encoding="utf-8")

    if not text.startswith("---"):
        continue

    parts = text.split("---", 2)

    if len(parts) < 3:
        continue

    frontmatter = yaml.safe_load(parts[1]) or {}

    target = frontmatter.get("id")

    if not target:
        continue

    depends_on = frontmatter.get("depends_on", [])

    if depends_on is None:
        depends_on = []

    for source in depends_on:

        if source not in known_ids:
            print(
                f"[WARNING] Dependencia inexistente: "
                f"{source} -> {target}"
            )

        edges.append({
            "source": source,
            "target": target
        })

# -------------------------
# TERCERA PASADA: clusterTag
# -------------------------
# clusterTag = the node's own tag with the lowest TAG_PRIORITY value.
# This replaces the old primaryTag logic (neighbor-count based).

for node in nodes:
    own_tags = node.get("tags") or []

    if not own_tags:
        node["clusterTag"] = None
        continue

    node["clusterTag"] = min(own_tags, key=lambda t: TAG_PRIORITY.get(t, 999))

# -------------------------
# CUARTA PASADA: nodos-anillo de tag
# -------------------------
# ORDEN CRÍTICO: clusterTag ya está calculado sobre aristas reales.
# Los anillos y sus aristas se agregan DESPUÉS para no contaminar grados ni clusterTag.

all_tags = sorted({tag for node in nodes for tag in (node.get("tags") or [])})

ring_nodes = []
for tag in all_tags:
    ring_nodes.append({
        "id": f"tag:{tag}",
        "label": tag,
        "type": "tag",
        "tags": [tag],
        "wikipedia": None,
        "primaryTag": tag   # kept for ring-node internal compatibility
    })

tag_edges = []
for node in nodes:
    for tag in (node.get("tags") or []):
        tag_edges.append({
            "source": f"tag:{tag}",
            "target": node["id"],
            "kind": "tag-link"
        })

nodes_export = nodes + ring_nodes
edges_export = edges + tag_edges

# -------------------------
# EXPORTAR
# -------------------------

graph = {
    "nodes": nodes_export,
    "edges": edges_export
}

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(graph, f, indent=2, ensure_ascii=False)

print()
print(f"Concept nodes:  {len(nodes)}")
print(f"Ring nodes:     {len(ring_nodes)}")
print(f"Dep edges:      {len(edges)}")
print(f"Tag-link edges: {len(tag_edges)}")
print(f"Saved: {OUTPUT_FILE}")
