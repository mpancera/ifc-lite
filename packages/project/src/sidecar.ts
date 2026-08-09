/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Naming the files that are written next to a project's models.
 *
 * A project folder is not a tidy place. It holds the drawings, the models, the
 * exports and whatever else a team put there — often several hundred files.
 * Anything this toolchain writes into it has to be findable a month later by
 * somebody who did not write it.
 *
 * Hence one shared prefix. Sorted by name, every file the toolchain produced
 * lands in one block instead of scattered between `Grundriss_EG_Rev-C.pdf` and
 * `Statik.xlsx`, and it is obvious at a glance which files are derived and
 * therefore safe to delete and regenerate.
 *
 * The prefix is a parameter, not a constant baked into every call site. A team
 * that already uses one, or that wants none, changes it in one place.
 */

/**
 * The prefix used when the caller does not choose one.
 *
 * Short on purpose: it repeats on every file, and its job is grouping, not
 * explaining. What the files ARE is carried by the rest of the name.
 */
export const DEFAULT_SIDECAR_PREFIX = 'dc.';

/** What a sidecar file is about. Extend as new kinds are written. */
export type SidecarKind =
  /** The project's reference height system. One per project. */
  | 'heights'
  /** One model's storeys, for comparison against the height system. One per
   *  model, hence the extra name segment. */
  | 'storeys';

export interface SidecarNameOptions {
  /** Defaults to {@link DEFAULT_SIDECAR_PREFIX}. Pass `''` for none. */
  prefix?: string;
  /**
   * Distinguishes several files of the same kind — the model name for
   * `storeys`. Omitted for kinds that exist once per project.
   */
  subject?: string;
  /**
   * Applied to `subject` before it goes in the name. The caller passes the
   * sanitiser it already uses, because the rules belong to the target
   * filesystem and not to this module.
   */
  sanitize?: (name: string) => string;
}

/**
 * The file name for a sidecar.
 *
 *     sidecarFileName('heights')                            -> dc.heights.json
 *     sidecarFileName('storeys', { subject: 'ARC-01' })       -> dc.storeys.ARC-01.json
 *
 * A `subject` that sanitises away to nothing is dropped rather than left as an
 * empty segment: `dc.storeys..json` would be a name nobody can act on.
 */
export function sidecarFileName(kind: SidecarKind, options: SidecarNameOptions = {}): string {
  const { prefix = DEFAULT_SIDECAR_PREFIX, subject, sanitize = (n) => n } = options;

  const safeSubject = subject === undefined ? '' : sanitize(stripIfcExtension(subject)).trim();
  const middle = safeSubject ? `${kind}.${safeSubject}` : kind;

  return `${prefix}${middle}.json`;
}

/**
 * Whether a file name is a sidecar of this kind, whatever prefix it carries.
 *
 * Reading is deliberately more forgiving than writing. A folder can hold files
 * written before the prefix existed, or by somebody using a different one, and
 * refusing to read those would lose data that is perfectly well-formed.
 */
export function isSidecarOf(fileName: string, kind: SidecarKind): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.json')) return false;

  // The kind is its own dot-separated segment: `dc.heights.json` and
  // `heights.json` both match, `myheights.json` does not.
  return lower === `${kind}.json`
    || lower.includes(`.${kind}.`)
    || lower.startsWith(`${kind}.`);
}

/** `ARC-01.ifc` -> `ARC-01`. A model name usually
 *  arrives as a file name, and stacking extensions reads as a mistake. */
function stripIfcExtension(name: string): string {
  return name.replace(/\.ifc(x|zip)?$/i, '').trim();
}
