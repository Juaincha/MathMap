from pathlib import Path
import json
import yaml
import math

CONTENT_DIR = Path("content")
OUTPUT_FILE = Path("graph.json")

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

    nodes.append({
        "id": node_id,
        "label": md_file.stem,
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
# TERCERA PASADA: primaryTag
# -------------------------

# Construir mapa de vecinos para cada nodo (aristas en cualquier dirección)
neighbors_of = {node["id"]: set() for node in nodes}
for edge in edges:
    src = edge["source"]
    tgt = edge["target"]
    if src in neighbors_of:
        neighbors_of[src].add(tgt)
    if tgt in neighbors_of:
        neighbors_of[tgt].add(src)

# Construir mapa de tags de cada nodo
tags_of = {node["id"]: (node["tags"] or []) for node in nodes}

# Calcular primaryTag para cada nodo
for node in nodes:
    node_id = node["id"]
    own_tags = tags_of.get(node_id, [])

    if not own_tags:
        node["primaryTag"] = None
        continue

    # Para cada tag propio, contar cuántos vecinos también tienen ese tag
    best_tag = None
    best_count = -1

    for tag in own_tags:
        count = sum(
            1 for nb_id in neighbors_of.get(node_id, set())
            if tag in tags_of.get(nb_id, [])
        )
        # Mayor conteo gana; empate → primer tag en el array (orden original)
        if count > best_count:
            best_count = count
            best_tag = tag

    node["primaryTag"] = best_tag

# -------------------------
# CUARTA PASADA: nodos-anillo de tag
# -------------------------
# ORDEN CRÍTICO: primaryTag ya está calculado sobre aristas reales.
# Los anillos y sus aristas se agregan DESPUÉS para no contaminar grados ni primaryTag.

all_tags = sorted({tag for node in nodes for tag in (node.get("tags") or [])})

ring_nodes = []
for tag in all_tags:
    ring_nodes.append({
        "id": f"tag:{tag}",
        "label": tag,
        "type": "tag",
        "tags": [tag],
        "wikipedia": None,
        "primaryTag": tag
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
