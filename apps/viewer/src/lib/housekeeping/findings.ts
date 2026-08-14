/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The shape of a housekeeping finding, and the list of checks that produce one.
 *
 * # Why a shared type
 * The findings already existed before this module — scattered. A contradictory
 * `OperationType` was announced in the plan toolbar, visible only in 2D and
 * only for the active storey; an assumed 5 cm door frame likewise; a room with
 * no area fell back to its geometry and said so in a tooltip; proxies were
 * nowhere until the triage was built. Each was correct and each was findable
 * only by someone already looking at it. Marc asked for "eine Art Checkliste
 * zum Abarbeiten … sowas wie ein Prüfplan" (2026-08-13); without one common
 * type the panel would be a drawer of special cases.
 *
 * # A plan lists its clean checks too
 * {@link HousekeepingResult} is per CHECK, not per finding, and a check with
 * nothing to report comes back `clean` rather than being left out. That is the
 * difference between a checklist and a list of complaints: "Georeferenzierung
 * geprüft, in Ordnung" is a thing the user needs to see, and a panel that only
 * shows problems can never say it.
 *
 * # Accepted is an answer
 * A plan without "bewusst so gelassen" grows back to full length on every
 * pass, and the user learns to ignore it. Same need as the deliberate proxies
 * in `lib/proxyTriage` — and the same treatment.
 */

export type FindingSeverity = 'error' | 'warning' | 'info';

/** Worst first — the order a plan is worked through. */
const SEVERITY_RANK: Readonly<Record<FindingSeverity, number>> = {
  error: 0, warning: 1, info: 2,
};

export type HousekeepingCheckId =
  | 'georeference'
  | 'class-assignment'
  | 'spatial-containment'
  | 'space-in-storey'
  | 'type-assignment'
  | 'identification';

/**
 * The tool that answers a finding, named rather than wired.
 *
 * A plain string union so the checks stay pure: the panel maps these to
 * whatever opening a dialog or a sidebar panel happens to require, and this
 * module never imports a component to say "the triage fixes this".
 */
export type RemedyTarget = 'proxy-triage' | 'georeference' | 'ids' | 'properties';

export interface Remedy {
  readonly label: string;
  readonly target: RemedyTarget;
}

export interface HousekeepingFinding {
  /**
   * Stable across runs of the same check on the same model — an acceptance is
   * stored under it, so a finding that changes id would come back as new.
   */
  readonly id: string;
  readonly checkId: HousekeepingCheckId;
  readonly severity: FindingSeverity;
  /** One line: what is wrong. */
  readonly title: string;
  /** Why it matters, and what it costs downstream. */
  readonly detail: string;
  /** Affected elements, so the panel can select them. Empty for model-level. */
  readonly elements: readonly number[];
  readonly remedy?: Remedy;
}

export type CheckState = 'clean' | 'open' | 'accepted' | 'unavailable';

export interface HousekeepingResult {
  readonly checkId: HousekeepingCheckId;
  readonly title: string;
  readonly state: CheckState;
  /** Findings still open. Accepted ones move to {@link accepted}. */
  readonly findings: readonly HousekeepingFinding[];
  readonly accepted: readonly HousekeepingFinding[];
  /** Why the check could not run, when `state` is `unavailable`. */
  readonly unavailableReason?: string;
}

/** What each check is called, and the order the plan runs them in. */
export const CHECK_TITLES: Readonly<Record<HousekeepingCheckId, string>> = {
  georeference: 'Georeferenzierung',
  'class-assignment': 'Fachklassenzuweisung',
  'spatial-containment': 'Element → Bauwerksstruktur',
  'space-in-storey': 'Raum → Geschoss',
  'type-assignment': 'Element → Typ',
  identification: 'Identifikation',
};

/**
 * The order the plan is worked through.
 *
 * Georeferencing first because it is one decision for the whole model and
 * everything spatial rests on it; the relationship checks before
 * identification because the automatic numbering builds its identifier out of
 * building, storey and room, so a broken chain makes the names it would check
 * unbuildable in the first place.
 */
export const CHECK_ORDER: readonly HousekeepingCheckId[] = [
  'georeference',
  'class-assignment',
  'spatial-containment',
  'space-in-storey',
  'type-assignment',
  'identification',
];

/** Worst finding first, then by title so a run does not reshuffle itself. */
export function sortFindings(
  findings: readonly HousekeepingFinding[],
): HousekeepingFinding[] {
  return [...findings].sort((a, b) => (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.title.localeCompare(b.title)
  ));
}

/**
 * Split a check's findings by what the user has already accepted.
 *
 * An accepted finding is not deleted: it stays visible under its check, so
 * "wir lassen das bewusst so" remains a statement somebody can find and
 * reverse, rather than a thing that silently vanished.
 */
export function resolveCheck(
  checkId: HousekeepingCheckId,
  findings: readonly HousekeepingFinding[],
  acceptedIds: ReadonlySet<string>,
  unavailableReason?: string,
): HousekeepingResult {
  const title = CHECK_TITLES[checkId];
  if (unavailableReason) {
    return { checkId, title, state: 'unavailable', findings: [], accepted: [], unavailableReason };
  }

  const open = sortFindings(findings.filter((f) => !acceptedIds.has(f.id)));
  const accepted = sortFindings(findings.filter((f) => acceptedIds.has(f.id)));

  let state: CheckState = 'clean';
  if (open.length > 0) state = 'open';
  else if (accepted.length > 0) state = 'accepted';

  return { checkId, title, state, findings: open, accepted };
}

export interface HousekeepingSummary {
  readonly total: number;
  readonly clean: number;
  readonly open: number;
  readonly accepted: number;
  readonly unavailable: number;
  /** Elements named by at least one open finding, counted once. */
  readonly affectedElements: number;
}

/** The headline: how much of the plan is done. */
export function summariseChecks(
  results: readonly HousekeepingResult[],
): HousekeepingSummary {
  const affected = new Set<number>();
  let clean = 0; let open = 0; let accepted = 0; let unavailable = 0;

  for (const result of results) {
    if (result.state === 'clean') clean += 1;
    else if (result.state === 'open') open += 1;
    else if (result.state === 'accepted') accepted += 1;
    else unavailable += 1;
    for (const finding of result.findings) {
      for (const element of finding.elements) affected.add(element);
    }
  }

  return {
    total: results.length,
    clean, open, accepted, unavailable,
    affectedElements: affected.size,
  };
}

/** `4 von 6 erledigt` — a plan reports progress, not a defect count. */
export function formatProgress(summary: HousekeepingSummary): string {
  const done = summary.clean + summary.accepted;
  return `${done} von ${summary.total} erledigt`;
}
