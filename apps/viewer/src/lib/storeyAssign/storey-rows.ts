/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The storey list "Geschoss zuweisen" offers, and where the selection sits now.
 *
 * Separate from the dialog because the ordering and the counting are the part
 * that can be wrong in a way nobody notices: a list in file order reads as
 * arbitrary in a building, and a storey that already holds every selected
 * element must not offer a move that would write nothing and report success.
 */

/** A storey as the store knows it, from the parse or from this session. */
export interface StoreySource {
  expressId: number;
  name: string;
  /** Missing rather than zero when the file gives none — they sort last. */
  elevation: number | null;
}

export interface StoreyRow extends StoreySource {
  /** How many of the selected elements are filed here already. */
  here: number;
}

/**
 * `storeys` in section order (highest first), each carrying how much of the
 * selection it already holds.
 *
 * `filedIn` is the current storey of each selected element, `null` for one that
 * has none — the same length as the selection, so the counts add up to at most
 * its size. An id appearing twice keeps its FIRST entry: a storey authored this
 * session cannot displace the parsed one it shares an id with, because that
 * would be a different storey wearing the same number.
 */
export function storeyRows(
  storeys: readonly StoreySource[],
  filedIn: readonly (number | null | undefined)[],
): StoreyRow[] {
  const count = new Map<number, number>();
  for (const storey of filedIn) {
    if (storey === null || storey === undefined) continue;
    count.set(storey, (count.get(storey) ?? 0) + 1);
  }

  const rows: StoreyRow[] = [];
  const seen = new Set<number>();
  for (const storey of storeys) {
    if (seen.has(storey.expressId)) continue;
    seen.add(storey.expressId);
    rows.push({ ...storey, here: count.get(storey.expressId) ?? 0 });
  }

  rows.sort((a, b) => {
    if (a.elevation === null || b.elevation === null) {
      if (a.elevation === b.elevation) return a.name.localeCompare(b.name);
      return a.elevation === null ? 1 : -1;
    }
    return b.elevation - a.elevation;
  });
  return rows;
}
