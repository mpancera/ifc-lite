# @ifc-lite/harmonizer

From a 2D plan to a draft IFC in which every element says where it came from and how sure the tool is.

A project often starts with plans, not with a model: a DXF from the architect, a PDF plotted from CAD, a scan of a drawing from the 1980s. The harmonizer is the front end that turns those into a first IFC a person can review and correct in a viewer. It is deliberately not an automatic modeller. A model that is 85 % right is more dangerous than none, because it looks finished, so the output carries provenance and a confidence per element, and the ids are stable so that corrections survive a re-run.

This version ships **stage A, detection**, plus the two pieces every later stage depends on: unit resolution and deterministic ids.

## Stages

| | Stage | Status |
|---|---|---|
| A | Detection: what the file is, whether a PDF page is a drawing or a picture of one, what a DXF is made of layer by layer | shipped |
| B | Units, scale, placement, storey | scale hints and `$INSUNITS` shipped; placement comes from the DXF underlay alignment |
| C | Interpretation: layers to walls, closed loops to spaces, texts to room names, arcs to doors, block references to symbols | next |
| D | Topology: enclosed areas from strokes (`detectEnclosedAreas`, with a spatial index) | next |
| E | Draft IFC with a provenance property set and stable GlobalIds | next |
| F | Re-run with a diff that never overwrites a confirmed or corrected element | next |
| G | Raster route for scans (image recognition) | not planned in this package |

## Installation

```bash
npm install @ifc-lite/harmonizer
```

## Route a file

```ts
import { routeByKind } from '@ifc-lite/harmonizer';

routeByKind('ground-floor.dwg');
// { kind: 'dwg', route: 'unavailable', messages: [{ code: 'dwg-not-readable', text: 'DWG cannot be read here ... Export the same drawing as DXF ...' }] }
```

Every message has a stable `code` and an English default `text`. A host translates on the code; the text is there so that nothing is ever silent.

## Classify a PDF page

The classifier decides on counts, and the counts come from pdf.js. pdf.js is not a dependency of this package: load the document with whichever build suits you and hand in the page together with the `OPS` table.

```ts
import * as pdfjs from 'pdfjs-dist';
import { collectPdfPageStats, classifyPdfPage, routeForPages } from '@ifc-lite/harmonizer';

const doc = await pdfjs.getDocument({ data }).promise;
const pages = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const stats = await collectPdfPageStats(page, pdfjs.OPS, i - 1);
  pages.push(classifyPdfPage(stats));
}
routeForPages(pages); // 'vector' | 'raster' | 'unavailable'
```

Each page comes back as `vector`, `raster`, `hybrid` (a scan with vector lines traced over it) or `empty`, with the factors the decision rested on and messages for the cases a naive count gets wrong: a logo does not make a drawing a scan, a page without any text is reported (labels were outlined into paths), and hatching exported as thousands of micro-segments is named so it can be filtered.

## Analyse a DXF

```ts
import { parseDxf } from '@ifc-lite/drawing-2d';
import { analyzeDxf, suggestLayerRoles } from '@ifc-lite/harmonizer';

const quality = analyzeDxf(parseDxf(dxfText));
quality.units;            // { source: 'insunits', metresPerUnit: 0.001 }
quality.layers;           // per layer: segments, texts, arcs, closed polylines, block references, micro-segments
quality.unresolvedBlocks; // block references without a definition: the drawing depends on xrefs that were not delivered
quality.confidence;       // 'high' | 'review' | 'poor'

suggestLayerRoles(quality.layers);
// [{ layer: 'A-WALL', role: 'wall', reason: 'name suggests walls and 5282 segments' }, ...]
```

The suggestions are suggestions. Offices name their layers in every way imaginable, so the person picks, and an empty selection means an empty result, not "everything".

## Paper scale

A PDF has no unit. The scale is often only in the file name, sometimes in the title block, sometimes nowhere.

```ts
import { resolvePdfUnits } from '@ifc-lite/harmonizer';

resolvePdfUnits({ fileName: 'Ground floor 1_100.pdf', texts: sheetTexts });
// { source: 'filename', metresPerUnit: 0.0353, scaleDenominator: 100 }
```

A calibration measured by the user always wins; with nothing to go on the unit is `0` and the caller asks for one.

## Stable ids

```ts
import { candidateId } from '@ifc-lite/harmonizer';

candidateId('ground-floor.dxf', storeyGlobalId, ['2F1', '2F2', '2F7']);
// the same 22-character IFC GlobalId on every run, on every machine
```

The id is a hash of the source file, the storey and the drawing handles that produced the element. Handles are sorted first, so an incremental run that finds the same strokes in a different order yields the same id.

## A picture per stage

Every stage returns, next to its numbers, a picture of what it saw and what it decided: a self-contained SVG with a title, a caption saying what to check, and the key facts. The protocol collects them in order, so a person can walk the run from the file to the result and doubt it in the right place. A pipeline that can be looked at is not a black box.

```ts
import { Protocol, routeByKind, renderRouteVisual, renderPdfDocumentVisual, renderStoryboard } from '@ifc-lite/harmonizer';

const protocol = new Protocol();
const routing = routeByKind(fileName);
protocol.show(renderRouteVisual(fileName, routing));

// ... classify the pages with { densityCols: 48 } so the picture has something to draw ...
protocol.show(renderPdfDocumentVisual(pages, fileName, routeForPages(pages.map((p) => p.classification))));

const storyboard = renderStoryboard(protocol.visuals, { title: fileName }); // all steps on one sheet
```

| Stage | Picture | What it makes visible |
|---|---|---|
| route | the file and the three routes, the one taken filled in | why a DWG or a photo does not go further, and what to ask for |
| pdf-pages / pdf-page | each page as a sheet in proportion: images as shaded boxes, vector density as cells, hatching in amber | scan, hybrid, drawing, title block, at a glance |
| dxf-layers | the drawing in miniature, one `<g data-layer>` per layer, coloured by suggested role, with the counts | what would go into the room finder and what would be left out |
| units | a ruler: a length on paper and what it stands for in the building, and where the scale came from | the one mistake that scales every later number |
| ids | the chain from file, storey and handles to the GlobalId | why a corrected element survives a re-import |

The contract for the stages to come is the same: a stage that draws candidates colours them by confidence, a stage that filters shows what it discarded, a stage that compares shows both sides.

## Principles

- **Nothing leaves the machine.** The package performs no network access and has no runtime dependency beyond the workspace.
- **Framework-free.** Pure functions over plain data; a viewer or a document manager wraps them.
- **Never a dead end.** Every refusal names what the person can do next: ask for a DXF, calibrate, trace over the scan.
- **Explain, then decide.** Every run writes a protocol (`Protocol`) of decisions, messages and timings.

## License

MPL-2.0
