/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The time stamp saved files carry: `YYYY-MM-DD_HHMM`.
 *
 * The clock time is not decoration. Exporting twice in one sitting is the
 * normal case — restore a saved state, export, correct a few rooms, export
 * again — and a date-only stamp gives both files the same name, so the second
 * lands as "… (1)" in the download folder and afterwards nobody can tell which
 * is the later one. The stamp is what makes a folder full of exports readable.
 *
 * Local time, deliberately: it is compared against the reader's own clock and
 * their own file listing, not against a server's.
 *
 * Sortable order (year first, zero-padded) so a plain alphabetical listing is
 * also a chronological one.
 */
export function filenameStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${date}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * A stamp this module wrote, at the end of a name: with the clock time, or
 * from the older date-only scheme.
 */
const TRAILING_STAMP = /_\d{4}-\d{2}-\d{2}(?:_\d{4})?$/;

/**
 * The base name with its stamp REPLACED rather than appended.
 *
 * Export, open the export, export again — the second name was built from the
 * first, so the stamps piled up: `…_2026-08-19_1259_2026-08-19_1324`. Only the
 * last save's time says anything, and a name that grows by 16 characters per
 * round stops fitting in a file dialog after three.
 *
 * Only a stamp in this module's own shape is replaced. A name that merely ends
 * in something date-like for its own reasons — a survey `…_2024-05-03` from the
 * client, a revision `…_1200` — keeps whatever it means to its author, because
 * the pattern requires the full shape this function writes.
 */
export function restamp(base: string, now: Date = new Date()): string {
  return `${stripStamp(base)}_${filenameStamp(now)}`;
}

/**
 * The name without a stamp this module wrote — what stays the same across
 * every export of one model, and therefore what other features key on when
 * they mean "this file, whichever version of it is open".
 */
export function stripStamp(base: string): string {
  return base.replace(TRAILING_STAMP, '');
}
