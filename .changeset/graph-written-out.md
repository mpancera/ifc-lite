---
'@ifc-lite/graph': minor
---

A drawn chain can be written out

`graphToCsv` and `graphToJson` turn a chain graph into a file, and
`graphTreeOf` exposes the tree both are built from.

They take the chain spec alongside the graph, because a chain graph is not a
general network: `chainRanks` names its layers in order and every edge joins
one layer to the next. That is what makes a detection tree a tree — zone, room,
device — and serialising `{nodes, edges}` alone would hand the reader an
adjacency dump to re-derive the hierarchy from, which is the work the chain
already did.

CSV is one row per leaf with its ancestors as columns, for the person who sorts
by group in a spreadsheet; JSON is the tree as a tree, for a program. Neither
is a rendering: the drawing on screen belongs to whatever draws it.

A node the chain could not place — a detector in no room — is written with
empty ancestor cells rather than dropped. That gap is the finding a detection
tree exists to surface, and a list that silently omits what it could not place
reads as complete.
