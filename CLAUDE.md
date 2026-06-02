# MathMap — Contexto del proyecto

## Qué es
MathMap es una herramienta de **exploración visual del conocimiento matemático**.
El producto es el grafo. El usuario explora Matemáticas observando relaciones,
dependencias y estructuras conceptuales.

Inspiración: Obsidian Graph View + Gephi + Google Maps + Wikipedia.

**No es** una wiki, ni notas, ni un reemplazo de Wikipedia, ni un gestor de
documentación.

## Modelo conceptual
- Cada concepto matemático = un nodo.
- Cada dependencia conceptual = una arista dirigida.
- Una arista `A → B` significa: para comprender B hay que comprender A primero.

Ejemplo de cadena válida:
```
Peano Axioms → Principle of Mathematical Induction → Binomial Theorem
→ Fundamental Theorem of Arithmetic
```

Al hacer clic en un nodo se abre su artículo de **Wikipedia**. No hay navegación
interna basada en contenido. El grafo es el centro absoluto de la experiencia.

---

## Directorio de trabajo
```
C:\Users\Sebastian\Documents\quartz
```
Asume este directorio en scripts, comandos y rutas salvo indicación contraria.

---

## Modelo de datos (fuente de verdad)

Cada concepto es un archivo Markdown en `content/`. Formato **exacto**:

---
id: fundamental-theorem-of-arithmetic

type: theorem

tags:
  - number-theory

wikipedia: https://en.wikipedia.org/wiki/Fundamental_theorem_of_arithmetic

depends_on:
  - principle-of-mathematical-induction
---

# Fundamental Theorem of Arithmetic

## Dependencies

[[Principle of Mathematical Induction]]
```

### Campos
| Campo | Significado |
|---|---|
| `id` | Identificador único en kebab-case |
| `type` | `definition`, `theorem`, `lemma`, `axiom`, `conjecture`, `corollary`, `structure`, `concept` |
| `tags` | Clasificación temática (rama matemática) |
| `wikipedia` | URL válida del artículo en inglés |
| `depends_on` | Lista de `id` de prerrequisitos reales |

### Regla de consistencia (crítica)
- El **frontmatter** es la fuente de verdad estructurada.
- El **cuerpo** (`[[enlaces]]`) es la representación visual auxiliar para
  Obsidian/Quartz e inspección humana.
- Ambos deben coincidir: cada `id` en `depends_on` tiene su `[[enlace]]`
  correspondiente en el cuerpo, y viceversa.

---

## Estado de la infraestructura
Existen actualmente: carpeta `content/`, archivos Markdown, script generador de
`graph.json`, aplicación Vite y Cytoscape.

- El proyecto **ya no se orienta hacia Quartz**. Quartz solo se usa de forma
  temporal como entorno de edición.
- El objetivo final es una **aplicación Vite independiente** que renderiza el
  grafo con Cytoscape, consumiendo `graph.json`.
- Separación estricta: **datos** (`content/`) → **scripts** (generador de
  `graph.json`) → **frontend** (app Vite). No mezclar estas capas.

---

## Principios transversales
- **Escalabilidad:** diseñar siempre pensando en 10 000+ nodos.
- **Mantenibilidad:** código modular, arquitectura limpia.
- **Consistencia de datos:** cada nodo con `id` único, URL de Wikipedia válida,
  tags coherentes y dependencias reales.

## Prohibido
- Volver a Quartz como destino del proyecto.
- Convertir MathMap en una wiki.
- Almacenar artículos matemáticos completos (eso lo provee Wikipedia).
- Crear dependencias arbitrarias o superficiales entre conceptos.

---

## Roles
El trabajo se reparte en tres subagentes (definidos en `.claude/agents/`):
- `knowledge-builder` — genera nodos `.md` en `content/`.
- `visual-architect` — construye el frontend Vite + Cytoscape.
- `git-runner` — commit y push a GitHub.

Cada subagente carga este contexto automáticamente; sus reglas específicas
viven en su propio archivo.
