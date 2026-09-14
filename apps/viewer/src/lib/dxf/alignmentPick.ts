/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turning a click into an alignment pick.
 *
 * Shared by the two surfaces that can host a DXF underlay — the 2D Section
 * panel and the plan view — because the rules below are not obvious and there
 * is nothing to gain from having two of them:
 *
 * - The REFERENCE line snaps to the model, the FITTING line to the underlay.
 *   Snapping both to whatever is nearest would quietly pull a plan point onto
 *   the very geometry it is being aligned against, which looks like a perfect
 *   fit and is a tautology.
 * - A fitting-line point is recorded in the underlay's OWN coordinates, so
 *   re-aligning a plan that was already moved replaces its placement instead
 *   of compounding the two.
 * - Shift constrains the second point to an axis through the first — and the
 *   first has to be brought into drawing space before it can be compared with
 *   a cursor that is already there.
 *
 * The plan view had none of this. Its DXF panel offered the buttons and the
 * canvas ignored the clicks, so the snap markers never appeared and a click
 * selected a room instead (Marc, 2026-09-15).
 */

import { applyDxfPlacement, inverseDxfPlacement, type DxfPlacement } from '@ifc-lite/drawing-2d';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { alignmentStep, type DxfAlignmentSession } from '@/lib/heights/alignmentSession';

export type AlignmentPick =
  /** Record this point; it is already in the space the session expects. */
  | { kind: 'pick'; point: Point2D }
  /** The underlay's placement cannot be inverted — a zero or non-finite scale. */
  | { kind: 'not-invertible' }
  /** Both lines are drawn; the click means nothing here. */
  | { kind: 'done' };

export interface AlignmentPickInput {
  session: DxfAlignmentSession;
  /** Cursor in DRAWING space. */
  raw: Point2D;
  shiftKey: boolean;
  /** The underlay being aligned, or `undefined` when it has gone. */
  placement: DxfPlacement | undefined;
  /** Snap against the model — for the reference line. */
  snapModel: (p: Point2D) => Point2D | null;
  /** Snap against the underlay — for the fitting line. */
  snapUnderlay: (p: Point2D) => Point2D | null;
  /** Lay a point on an axis through the anchor. */
  constrainToAxis: (anchor: Point2D, p: Point2D) => Point2D;
}

export function resolveAlignmentPick(input: AlignmentPickInput): AlignmentPick {
  const { session, raw, shiftKey, placement, snapModel, snapUnderlay, constrainToAxis } = input;
  const step = alignmentStep(session);
  if (step.kind === 'ready') return { kind: 'done' };

  const line = step.target === 'reference' ? session.reference : session.fit;
  // The fitting line's stored start is in the underlay's coordinates; the
  // cursor is in drawing space. Comparing them directly would constrain
  // against a point in the wrong coordinate system.
  const anchor = step.target === 'fit' && line?.start && placement
    ? applyDxfPlacement(line.start, placement)
    : line?.start ?? null;

  const snapped = step.target === 'reference' ? snapModel(raw) : snapUnderlay(raw);
  const point = shiftKey && step.kind === 'end' && anchor
    ? constrainToAxis(anchor, raw)
    : snapped ?? raw;

  if (step.target !== 'fit') return { kind: 'pick', point };

  const local = placement ? inverseDxfPlacement(point, placement) : point;
  return local ? { kind: 'pick', point: local } : { kind: 'not-invertible' };
}
