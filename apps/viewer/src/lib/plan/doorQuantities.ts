/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The measurements of a door, and what each of them is called.
 *
 * Marc's definitions (2026-08-13), which settle a vocabulary that IFC leaves
 * scattered across three property sets and one attribute pair. The German
 * terms are the ones a door schedule uses here, so they are kept alongside the
 * field names rather than translated away.
 *
 * | German            | Field             | Source                              |
 * |-------------------|-------------------|-------------------------------------|
 * | Nennbreite        | `nominalWidth`    | `OverallWidth` = the rough opening  |
 * | Nennhöhe          | `nominalHeight`   | `OverallHeight` = the rough opening |
 * | Rahmenbreite      | `frameWidth`      | `Qto_DoorBaseQuantities.Width`      |
 * | Rahmenhöhe        | `frameHeight`     | `Qto_DoorBaseQuantities.Height`     |
 * | Rahmenbreite      | `liningThickness` | `LiningThickness`, along local X    |
 * | Rahmentiefe       | `liningDepth`     | `LiningDepth`, along local Y        |
 * | Deckrahmenbreite  | `casingThickness` | `CasingThickness`                   |
 * | Blattdicke        | `panelDepth`      | `PanelDepth`                        |
 * | Lichte Breite     | `clearWidth`      | derived                             |
 * | Lichte Höhe       | `clearHeight`     | derived                             |
 * | Durchgangsbreite  | `passageWidth`    | derived                             |
 * | Durchgangshöhe    | `passageHeight`   | derived                             |
 *
 * Note that "Rahmenbreite" names two different things in the trade — the
 * frame's overall width (`Qto…Width`, the nominal plus whatever the frame
 * oversails by) and the frame MEMBER's width (`LiningThickness`). They are
 * kept apart here under distinct field names precisely because the word does
 * not.
 *
 * # Where these now live in IFC
 * `IfcDoorLiningProperties` and `IfcDoorPanelProperties` are the classic
 * homes, attached to the door's type. Newer schema versions carry the same
 * values as `Pset_DoorLiningProperties` and `Pset_DoorPanelProperties`, so
 * both are read; a model written either way answers the same questions.
 */

/** What a model states, in metres, as far as it states anything. */
export interface DoorQuantitySources {
  /** `OverallWidth` — Nennbreite, the rough opening in the wall. */
  readonly nominalWidth?: number | null;
  /** `OverallHeight` — Nennhöhe. */
  readonly nominalHeight?: number | null;
  /** `Qto_DoorBaseQuantities.Width` — Rahmenbreite, nominal plus oversail. */
  readonly frameWidth?: number | null;
  /** `Qto_DoorBaseQuantities.Height` — Rahmenhöhe. */
  readonly frameHeight?: number | null;
  /** `LiningThickness` — the frame member's width, along local X. */
  readonly liningThickness?: number | null;
  /** `LiningDepth` — the frame's depth, along local Y. */
  readonly liningDepth?: number | null;
  /** `CasingThickness` — Deckrahmenbreite. */
  readonly casingThickness?: number | null;
  /** `PanelDepth` — Blattdicke, how thick the leaf is. */
  readonly panelDepth?: number | null;
  /** `ThresholdThickness`, subtracted from the passage height when present. */
  readonly thresholdThickness?: number | null;
  /** One leaf or two. Decides how much leaf stands in the passage. */
  readonly leaves?: 1 | 2;
  /** Measured off the geometry, for the width when nothing is stated. */
  readonly measuredWidth?: number | null;
  /** Measured lining depth — for a plan, the wall is what matters. */
  readonly measuredDepth?: number | null;
}

/**
 * The frame member width to assume when the model states none.
 *
 * 5 cm, Marc's figure — and the same number the one model that DOES state it
 * carries (`LiningThickness` = 0.05 in the FZK-Haus).
 */
export const ASSUMED_LINING_THICKNESS = 0.05;

export interface DoorQuantities {
  /** Nennbreite — the rough opening. */
  readonly nominalWidth: number;
  /** Nennhöhe, or `null` where nothing states it. */
  readonly nominalHeight: number | null;
  /** Rahmenbreite/-höhe: the frame's overall size, where stated. */
  readonly frameWidth: number | null;
  readonly frameHeight: number | null;
  /** Rahmenbreite in the member sense — along local X. */
  readonly liningThickness: number;
  /** Rahmentiefe, as a PLAN should draw it: see {@link doorQuantities}. */
  readonly liningDepth: number | null;
  /** Deckrahmenbreite. */
  readonly casingThickness: number | null;
  /** Blattdicke. */
  readonly panelDepth: number | null;
  /** Lichte Breite = Nennbreite − 2 × Rahmenbreite. */
  readonly clearWidth: number;
  /** Lichte Höhe = Nennhöhe − Rahmenbreite. */
  readonly clearHeight: number | null;
  /** Durchgangsbreite = Lichte Breite − Blattdicke × Flügelzahl. */
  readonly passageWidth: number;
  /** Durchgangshöhe = Lichte Höhe − Schwelle. */
  readonly passageHeight: number | null;
  readonly leaves: 1 | 2;
  /** Whether {@link liningThickness} was read or assumed. */
  readonly liningSource: 'model' | 'assumed';
  /**
   * Where the frame DEPTH came from — the one number a plan reads as the wall.
   *
   * `'wall'` is the drawing measured across the doorway and the only source
   * that is actually the wall. `'stated'` is the model's own `LiningDepth`,
   * which routinely runs past the plaster. `null` means neither was
   * available and the caller is left to fall back to the reveal body.
   *
   * Reported because it is invisible in the drawing: a frame drawn 20 cm deep
   * looks equally plausible whether that is the wall or the door telling us
   * about itself, and only one of those is right.
   */
  readonly depthSource: 'wall' | 'stated' | null;
}

const usable = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Work out every measurement from whatever the model happens to state.
 *
 * # The two rules that are not just arithmetic
 *
 * **The lining depth a PLAN wants is the wall, not the frame.** `LiningDepth`
 * is frequently deeper than the wall it sits in — the frame runs on past the
 * plaster, and in 3D that is the truthful value. Drawn in plan it puts frame
 * outside the wall, which reads as a modelling error that is not there. So the
 * measured depth wins and `LiningDepth` is the fallback (Marc, 2026-08-13).
 *
 * **A frame that would eat the doorway is capped**, at a fifth of the opening.
 * Two frames wider than the opening is a number that cannot describe a door,
 * and a narrow frame is a better drawing than a negative one.
 *
 * `null` when there is no width at all to work from: without the opening,
 * nothing below it can be derived.
 */
export function doorQuantities(sources: DoorQuantitySources): DoorQuantities | null {
  const nominalWidth = usable(sources.nominalWidth) ? sources.nominalWidth
    : usable(sources.measuredWidth) ? sources.measuredWidth
      : null;
  if (nominalWidth === null) return null;

  const stated = usable(sources.liningThickness);
  const liningThickness = Math.min(
    stated ? (sources.liningThickness as number) : ASSUMED_LINING_THICKNESS,
    nominalWidth * 0.2,
  );

  const leaves: 1 | 2 = sources.leaves === 2 ? 2 : 1;
  const panelDepth = usable(sources.panelDepth) ? sources.panelDepth : null;
  const nominalHeight = usable(sources.nominalHeight) ? sources.nominalHeight : null;

  const clearWidth = nominalWidth - 2 * liningThickness;
  const clearHeight = nominalHeight === null ? null : nominalHeight - liningThickness;
  const threshold = usable(sources.thresholdThickness) ? sources.thresholdThickness : 0;

  return {
    nominalWidth,
    nominalHeight,
    frameWidth: usable(sources.frameWidth) ? sources.frameWidth : null,
    frameHeight: usable(sources.frameHeight) ? sources.frameHeight : null,
    liningThickness,
    // The wall first, the stated frame depth second. See the rule above.
    liningDepth: usable(sources.measuredDepth) ? sources.measuredDepth
      : usable(sources.liningDepth) ? sources.liningDepth
        : null,
    casingThickness: usable(sources.casingThickness) ? sources.casingThickness : null,
    panelDepth,
    clearWidth,
    clearHeight,
    // The leaf still stands in the opening when it is open, so it comes off
    // the passage — once for a single door, twice for a pair.
    passageWidth: Math.max(clearWidth - (panelDepth ?? 0) * leaves, 0),
    passageHeight: clearHeight === null ? null : clearHeight - threshold,
    leaves,
    liningSource: stated ? 'model' : 'assumed',
    depthSource: usable(sources.measuredDepth) ? 'wall'
      : usable(sources.liningDepth) ? 'stated'
        : null,
  };
}
