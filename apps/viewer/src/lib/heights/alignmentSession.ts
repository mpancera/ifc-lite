/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What the next click means, and what to tell the person before they make it.
 *
 * Four clicks in a fixed alternation: a feature on the plan, then where that
 * feature actually is, twice. Kept out of the component because "which pick
 * is next" is a rule with edge cases — an undo at the wrong moment, a session
 * for an underlay that was meanwhile deleted — and rules belong somewhere they
 * can be tested rather than clicked at.
 */

import type { DxfAlignmentSession } from '@/store/slices/drawing2DSlice';

/** Whether the next click lands on the plan or on the model. */
export type AlignmentStep =
  /** A feature on the imported plan. */
  | 'pick-from'
  /** Where that feature actually belongs. */
  | 'pick-to'
  /** Both pairs are in; nothing left to click. */
  | 'ready';

export function alignmentStep(session: DxfAlignmentSession): AlignmentStep {
  if (session.to.length >= 2) return 'ready';
  return session.from.length === session.to.length ? 'pick-from' : 'pick-to';
}

/** How many of the four clicks are done. For a progress read-out. */
export function alignmentPickCount(session: DxfAlignmentSession): number {
  return session.from.length + session.to.length;
}

/**
 * The sentence shown while picking.
 *
 * Says which of the two drawings to click, not just "pick a point": with a
 * plan lying on a model section, "pick a point" is exactly the instruction
 * that cannot be followed.
 */
export function alignmentPrompt(session: DxfAlignmentSession): string {
  const pair = session.to.length + 1;
  switch (alignmentStep(session)) {
    case 'pick-from':
      return `Punkt ${pair} von 2: eine Stelle auf dem importierten Plan anklicken.`;
    case 'pick-to':
      return `Punkt ${pair} von 2: dieselbe Stelle im Modell anklicken.`;
    case 'ready':
      return 'Beide Punktpaare gesetzt — übernehmen oder einen Punkt zurücknehmen.';
  }
}

/** The two complete pairs, or `null` while the session is unfinished. */
export function alignmentPairs(
  session: DxfAlignmentSession,
): [{ from: { x: number; y: number }; to: { x: number; y: number } },
    { from: { x: number; y: number }; to: { x: number; y: number } }] | null {
  if (session.from.length < 2 || session.to.length < 2) return null;
  return [
    { from: session.from[0], to: session.to[0] },
    { from: session.from[1], to: session.to[1] },
  ];
}
