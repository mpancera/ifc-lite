/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Moving one item of a list to another position.
 *
 * The distinction that matters: a **move** shifts everything between the two
 * positions, a **swap** exchanges only the two. They agree for neighbours,
 * which is why the up/down arrows can swap — and disagree completely for a
 * drag across five rows, where swapping would fling the row at the destination
 * to the far end.
 */

/**
 * `list` with the item at `from` moved to index `to`.
 *
 * Returns the SAME array when nothing would change, so a caller in a React
 * setter can rely on identity to skip the re-render. Out-of-range targets are
 * clamped rather than refused: a drop past the last row means "put it last",
 * which is what the gesture looked like.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): readonly T[] {
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return list;

  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * `list` with the items at `idx` and `idx + direction` exchanged.
 *
 * What the up/down arrows do. Returns the same array at either end, so the
 * buttons can be disabled from the same rule that governs the behaviour.
 */
export function swapItem<T>(list: readonly T[], idx: number, direction: -1 | 1): readonly T[] {
  const target = idx + direction;
  if (idx < 0 || idx >= list.length || target < 0 || target >= list.length) return list;

  const next = [...list];
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}
