/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Aligning a plan by drawing two lines: one on the model, one on the plan.
 *
 * The earlier version asked for four points in an alternating order — a plan
 * point, its counterpart, twice. Mathematically the same thing, and confusing
 * to do: the two picks of a pair are far apart on screen, so the eye has to
 * jump between drawings on every click, and nothing on screen said which of
 * the four was which.
 *
 * Two lines match what the task actually is. **The reference line** is drawn
 * on the model — a wall, an axis, a facade edge, something whose position is
 * known. **The fitting line** is drawn on the plan, on the same feature. The
 * transform that carries the second onto the first is the alignment.
 *
 * It also makes correcting one thing possible without redoing the other: the
 * reference line is usually right on the first go and the fitting line is the
 * one that needs nudging, and re-picking all four points to fix one end was
 * the worst part of the previous version.
 */

/** A line drawn in two clicks. Either end may still be missing. */
export interface AlignmentLine {
  start: { x: number; y: number } | null;
  end: { x: number; y: number } | null;
}

/**
 * Aligning a plan by drawing two lines on the same feature.
 *
 * The REFERENCE line is drawn on the model, on something whose position is
 * known — a wall, an axis, a facade edge. The FITTING line is drawn on the
 * plan, on that same feature. The transform carrying the second onto the first
 * is the alignment.
 *
 * Two named lines rather than four anonymous points: the two picks of a pair
 * sit far apart on screen, so an alternating order makes the eye jump between
 * drawings on every click, and nothing tells you which of the four you are on.
 * It also makes correcting one line possible without redoing the other.
 */
export interface DxfAlignmentSession {
  underlayId: string;
  /** On the model, in drawing space. */
  reference: AlignmentLine | null;
  /**
   * On the plan, in the underlay's OWN coordinates.
   *
   * The caller inverts the current placement before recording, so re-aligning
   * a plan that was already moved replaces its placement rather than
   * compounding the two.
   */
  fit: AlignmentLine | null;
  /**
   * The line being corrected, or `null` while drawing in the normal order.
   *
   * Set by the edit buttons. It wins over the normal order, which is what
   * makes "fix just this line" possible once both are drawn.
   */
  editing: 'reference' | 'fit' | null;
  /** Keep the drawing's size and use the lines for position and rotation. */
  lockScale: boolean;
}

/** Which line is being drawn or corrected. */
export type AlignmentTarget = 'reference' | 'fit';

/** What the next click does. */
export type AlignmentStep =
  /** Set the start of the line named by `target`. */
  | { kind: 'start'; target: AlignmentTarget }
  /** Set its end. The preview runs from the start to the cursor. */
  | { kind: 'end'; target: AlignmentTarget }
  /** Both lines are complete; nothing left to click. */
  | { kind: 'ready' };

const complete = (line: AlignmentLine | null): boolean =>
  line !== null && line.start !== null && line.end !== null;

/**
 * What the next click does.
 *
 * An explicit `editing` target wins: pressing "edit the fitting line" means
 * the next clicks belong to that line even though both are already drawn.
 */
export function alignmentStep(session: DxfAlignmentSession): AlignmentStep {
  const target: AlignmentTarget | null = session.editing
    ?? (!complete(session.reference) ? 'reference' : !complete(session.fit) ? 'fit' : null);

  if (target === null) return { kind: 'ready' };

  const line = target === 'reference' ? session.reference : session.fit;
  return line?.start != null && line.end == null
    ? { kind: 'end', target }
    : { kind: 'start', target };
}

/** The line the next click belongs to, or `null` when both are done. */
export function alignmentTarget(session: DxfAlignmentSession): AlignmentTarget | null {
  const step = alignmentStep(session);
  return step.kind === 'ready' ? null : step.target;
}

/**
 * The sentence shown while drawing.
 *
 * Names the DRAWING as well as the action. With a plan lying over a model
 * section, "click a point" is exactly the instruction that cannot be followed.
 */
export function alignmentPrompt(session: DxfAlignmentSession): string {
  const step = alignmentStep(session);
  if (step.kind === 'ready') {
    return 'Beide Linien gesetzt — übernehmen, oder eine Linie zum Korrigieren wählen.';
  }

  const isReference = step.target === 'reference';
  const what = isReference ? 'Referenzlinie am Modell' : 'Passlinie auf dem Plan';
  return step.kind === 'start'
    ? `${what}: Startpunkt anklicken.`
    : `${what}: Endpunkt anklicken.`;
}

/** Whether a line can be handed to the solver. */
export function isLineComplete(line: AlignmentLine | null): boolean {
  return complete(line);
}

/**
 * The two pairs for the solver, or `null` while either line is unfinished.
 *
 * Start goes to start and end goes to end. Drawing the two lines in opposite
 * directions therefore produces a 180° rotation rather than a silent
 * correction — which is the honest reading of what was drawn, and visible at
 * once because the two arrows point opposite ways.
 */
export function alignmentPairs(
  session: DxfAlignmentSession,
): [{ from: { x: number; y: number }; to: { x: number; y: number } },
    { from: { x: number; y: number }; to: { x: number; y: number } }] | null {
  const { reference, fit } = session;
  if (!complete(reference) || !complete(fit)) return null;

  return [
    { from: fit!.start!, to: reference!.start! },
    { from: fit!.end!, to: reference!.end! },
  ];
}

/**
 * Constrain a line to the horizontal or vertical while Shift is held.
 *
 * The everyday case this exists for: two drawings that are both orthogonal and
 * merely shifted against each other. Freehand, the two lines end up a fraction
 * of a degree apart, and the solver dutifully reports that fraction as a
 * rotation — so a plan that was square to the model arrives very slightly
 * askew, which is worse than either leaving it alone or turning it properly.
 *
 * Snaps to whichever axis the line is already closer to, so the constraint
 * follows the gesture rather than overriding it.
 *
 * Note this constrains the line in DRAWING space, which is what a person sees.
 * Two lines each snapped to an axis then differ by exactly 0° or 90°, and the
 * solve comes out as a pure translation and scale.
 */
export function constrainToAxis(
  start: { x: number; y: number },
  cursor: { x: number; y: number },
): { x: number; y: number } {
  const dx = cursor.x - start.x;
  const dy = cursor.y - start.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: cursor.x, y: start.y }
    : { x: start.x, y: cursor.y };
}
