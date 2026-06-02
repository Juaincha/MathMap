from pathlib import Path
import json
import yaml

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
# EXPORTAR
# -------------------------

graph = {
    "nodes": nodes,
    "edges": edges
}

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(graph, f, indent=2, ensure_ascii=False)

print()
print(f"Nodes: {len(nodes)}")
print(f"Edges: {len(edges)}")
print(f"Saved: {OUTPUT_FILE}")
