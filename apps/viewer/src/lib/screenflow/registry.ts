/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The screenflow series: five strands through one fire-detection planning
 * workflow, in the order they appear in the deck.
 *
 * # Why five long strands and not nine short clips
 * The first cut was nine clips of about a minute. Watched back, the verdict
 * was that each one was too thin to carry an argument -- a minute is enough to
 * show a feature and not enough to show that a step of the process no longer
 * needs a second program. A strand runs two to four minutes and follows one
 * stretch of the workflow from its input to its deliverable.
 *
 * # Each strand starts where the previous one ended
 * A strand plays against the exported state of the strand before it. That is
 * what lets any single strand be re-recorded on its own; independent starting
 * files drift, and an audience notices when strand three is clearly not the
 * model strand one just built.
 *
 * Tool and organisation names stay out of this file: the repository is
 * public, and the argument each strand makes does not need them.
 */

import { CLIP_01_FEDERATION } from './clips/clip-01-federation';
import { STRAND_01_FROM_A_DRAWING } from './clips/strand-01-from-a-drawing';
import { STRAND_03_RELATIONS } from './clips/strand-03-relations';
import type { ScreenflowClip } from './types';

/**
 * Built clips. The federation clip is number 0 on purpose: it is the sample
 * that proved the machinery -- captions, pointer, proofs, measured subtitles --
 * against the real demo data, not a strand of the series. Its beats will be
 * folded into the opening of strand 3, which also starts from both models
 * loaded; until then it stays as the one thing that can be recorded today.
 */
export const SCREENFLOW_REGISTRY: readonly ScreenflowClip[] = [
  CLIP_01_FEDERATION,
  STRAND_01_FROM_A_DRAWING,
  STRAND_03_RELATIONS,
];

export function getClip(id: string): ScreenflowClip | undefined {
  return SCREENFLOW_REGISTRY.find((c) => c.id === id);
}

/** A strand of the series that is not built yet. */
export interface PlannedClip {
  /** Position in the series, 1 to 5. */
  number: number;
  titleDe: string;
  /** The stretch of workflow this strand covers. */
  stepDe: string;
  /** What has to exist in the product before it can be filmed. */
  needsDe: string;
}

/**
 * All five strands, none of them written yet. Kept next to the built sample
 * deliberately: the value of the series is that it walks one process end to
 * end, and a reader of this file should be able to see the whole walk. The
 * full shot list lives outside this repository, with the demo data.
 */
export const PLANNED_CLIPS: readonly PlannedClip[] = [
  {
    number: 2,
    titleDe: 'Wenn das Modell schon da ist',
    stepDe: 'Modell öffnen, geforderte Qualität per IDS nachweisen, Planprodukte und Mengen ausgeben',
    needsDe: 'IDS und Plan-Exporte vorhanden; DXF trägt keine Metadaten am Polygon, und Listen sind noch kein Exportprodukt',
  },
  {
    number: 4,
    titleDe: 'Lageplan aus dem Modell',
    stepDe: 'Elemente ergänzen, grafische Ergänzungen, Fluchtwege, Meldebereiche, Planausgabe',
    needsDe: 'Bibliothek, Annotationen, Fluchtwege und PDF vorhanden; Meldebereich-Umrandung und eine Legende zum 2D-Plan fehlen. Die Legende prueft bewusst nicht, sie listet nur das Gezeichnete',
  },
  {
    number: 5,
    titleDe: 'Übergabe an die Errichtung',
    stepDe: 'Eigene Qualitätssicherung, dann Lageplan, Detektionsbaum, Steuerungsmatrix und Bestellliste in einem Stapel',
    needsDe: 'Steuerungsmatrix und die detaillierte Bestellliste fehlen; die Daten dafür trägt das Demomodell bereits',
  },
];
