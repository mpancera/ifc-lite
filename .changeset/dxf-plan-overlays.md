---
"@ifc-lite/drawing-2d": minor
---

DXF export can carry the plan overlays: room outlines, labels, opening
symbols and device marks.

`DXFExportOptions.plan` takes them as `DXFPlanOverlays` — derived content the
drawing itself knows nothing about, so it is passed in rather than read off
`Drawing2D`. Each lands on its own layer (`IFCLITE-RAUM`, `IFCLITE-SYMBOL`,
`IFCLITE-TEXT`), because turning parts of a received drawing off is the first
thing anyone does with one.

Room outlines carry the room number and designation as XDATA under the
`IFCLITE` application id — a closed outline otherwise says where a room is and
nothing about which room it is, and XDATA is what real DXF readers round-trip.
`DxfWriter` gains `appId()` and an `xdata` argument on `addPolyline()`, and
writes an APPID table when (and only when) some entity references one: XDATA
pointing at an undeclared APPID is the one thing strict R12 readers reject.

A drawing exported without `plan` is byte-identical to before.
