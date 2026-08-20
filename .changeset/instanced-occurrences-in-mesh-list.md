---
"@ifc-lite/geometry": minor
"@ifc-lite/viewer": patch
---

Expand GPU-instanced occurrences into the mesh list as well as uploading them.

Instancing sends one template plus a transform per occurrence, which suits the
renderer and nothing else: the mesh list is what the 2D section cut, the room
labels, the device marks, the class tree and the element statistics all read,
and an occurrence living only as a transform inside a shard is invisible to
every one of them. Eighty identical fire detectors rendered in 3D and appeared
in no plan, no class tree and no element count.

`expandInstancedShard` produces one ordinary occurrence mesh per instance,
flagged `instancedOccurrence` so the upload path skips it — the GPU already has
that geometry — and converted from IFC Z-up to the renderer frame the rest of
the list is in.
