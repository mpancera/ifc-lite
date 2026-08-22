/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The shape a drawn cable takes on screen.
 *
 * # Why it is curved at all
 * A straight polyline between devices reads as a dimension line or a section
 * cut — the viewer already draws both of those, straight. A cable does not run
 * straight, and more practically: two devices on the same wall put a straight
 * segment exactly on top of the wall, where it disappears. A slight bow lifts
 * every segment clear of whatever it runs along and makes the run legible as
 * one thing rather than as a series of unrelated ticks.
 *
 * # Why the bow alternates
 * All bows on the same side makes a long run drift into an arc, and a run that
 * doubles back on itself overlays its own outbound leg. Alternating the side
 * per segment keeps the drift at zero and separates the legs.
 *
 * Pure screen geometry — no React, no renderer. The projection is the caller's.
 */

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * How far a segment bows out, as a fraction of its own length.
 *
 * Proportional rather than a fixed pixel offset so the bow stays proportionate
 * at any zoom: a fixed offset turns a short segment into a loop and leaves a
 * long one looking straight.
 */
const BOW = 0.08;
/** Past this the bow stops growing — a long run should not become a balloon. */
const MAX_BOW_PX = 28;

/**
 * An SVG path through `points`, each segment bowed slightly, sides alternating.
 *
 * Returns `''` for fewer than two points: a run with one device has no cable
 * in it yet, and an empty path draws nothing, which is the truthful picture.
 */
export function wiringPath(points: readonly ScreenPoint[]): string {
  if (points.length < 2) return '';
  const parts = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 1e-3) {
      parts.push(`L ${to.x.toFixed(1)} ${to.y.toFixed(1)}`);
      continue;
    }
    const offset = Math.min(length * BOW, MAX_BOW_PX) * (i % 2 === 1 ? 1 : -1);
    // The control point sits at the midpoint, pushed along the segment's
    // normal. A quadratic is enough — the eye reads one bow per segment, and a
    // cubic would only add a second parameter nobody tunes.
    const midX = (from.x + to.x) / 2 - (dy / length) * offset;
    const midY = (from.y + to.y) / 2 + (dx / length) * offset;
    parts.push(
      `Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
    );
  }
  return parts.join(' ');
}

/**
 * Where a segment's midpoint label goes — the same bowed midpoint the path
 * passes through, so a number never sits off its own cable.
 */
export function wiringMidpoint(
  from: ScreenPoint,
  to: ScreenPoint,
  index: number,
): ScreenPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1e-3) return { x: to.x, y: to.y };
  const offset = Math.min(length * BOW, MAX_BOW_PX) * (index % 2 === 1 ? 1 : -1);
  // Half the control-point offset: a quadratic passes through half of it.
  return {
    x: (from.x + to.x) / 2 - (dy / length) * offset * 0.5,
    y: (from.y + to.y) / 2 + (dx / length) * offset * 0.5,
  };
}
