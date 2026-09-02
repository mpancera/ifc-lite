---
"@ifc-lite/harmonizer": minor
---

New package `@ifc-lite/harmonizer`: the front end of a plan-to-IFC pipeline.

A 2D plan arrives as DXF, PDF or a scanned image, and the first question is not "where are the walls" but "can this file be read as geometry at all". The package answers that per file and per page: a PDF page is classified as vector, raster, hybrid (a scan with vector lines traced over it) or empty from its operator list — paths and their lengths, images and the share of the page they cover, text — and a DXF gets a quality report per layer (segments, texts, arcs, block references, unresolved blocks, micro-segments) from the existing `@ifc-lite/drawing-2d` parser.

Two further pieces belong to the same stage. Scale hints are read from a file name or a title block (`1:100`, `1_50`), because a PDF has no unit and a DXF often has `$INSUNITS = 0`. And element ids are derived deterministically from the source file, storey and drawing handles, so a second run over the same plan yields the same GlobalIds — the precondition for corrections in a viewer surviving a re-run.

Nothing here draws or writes IFC yet. The package is framework-free, has no runtime dependency on pdf.js (the caller hands in a page and the `OPS` table), and performs no network access.
