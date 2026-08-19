/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Clean Rooms — which of a model's spaces are finished, and what is missing.
 *
 * # Why rooms need their own triage
 * Spaces arrive in a model in two ways, and both leave work behind. Either the
 * CAD author drew them, in which case a handful are missing their number or
 * their name; or they were derived from the walls, in which case EVERY one of
 * them carries a generated name, and some of them are not rooms at all — the
 * detection follows wall axes, so a light shaft or the gap between two leaves
 * of a double wall comes back as an enclosed region like any other.
 *
 * Neither case is a bulk operation. A number belongs to one room and nobody
 * but the person looking at the plan knows which. What this module does is
 * make the LIST short and ordered: say per space what is missing, so the panel
 * can walk the ones that need a decision and leave the rest alone.
 *
 * # What counts as a problem
 * Only things a reader would call wrong on the finished plan:
 *
 * - no number, no description — the label has nothing to print
 * - the same number twice on one storey — the room schedule cannot key on it
 * - a name the generator invented (`R7`, `Space 12`) — it looks filled in and
 *   is not, which is worse than empty
 * - a sliver of floor area — almost certainly a detection artefact, and the
 *   one case where the right answer is to throw the space away
 *
 * Everything else is left alone on purpose. A room with a number, a name and
 * an area is finished, and a panel that keeps asking about it is a panel
 * people close.
 */

/** What is missing or wrong about one space. */
export type RoomIssue =
  | 'no-number'
  | 'no-description'
  | 'duplicate-number'
  | 'placeholder'
  | 'sliver';

/** German labels — these are read by the person doing the cleaning. */
export const ISSUE_LABELS: Record<RoomIssue, string> = {
  'no-number': 'Nummer fehlt',
  'no-description': 'Bezeichnung fehlt',
  'duplicate-number': 'Nummer doppelt',
  placeholder: 'Platzhaltername',
  sliver: 'Splitterfläche',
};

/**
 * The order the panel shows issues in: the ones that are certainly wrong
 * before the ones that are only suspicious.
 */
export const ISSUE_ORDER: readonly RoomIssue[] = [
  'duplicate-number', 'no-number', 'placeholder', 'no-description', 'sliver',
];

/** One space, as the panel needs to see it. */
export interface RoomRecord {
  /** Identifies the OCCURRENCE — instanced spaces share an express id. */
  readonly key: string;
  readonly expressId: number;
  /** The storey it hangs under, for grouping and for duplicate scope. */
  readonly storeyId: number;
  readonly storeyName: string;
  /** `IfcSpace.Name` — by convention the room number. */
  readonly number: string;
  /** `IfcSpace.LongName` — by convention what the room is called. */
  readonly description: string;
  /** Floor area in m², or `null` when neither quantity nor geometry gave one. */
  readonly area: number | null;
  /**
   * The space was derived rather than drawn — the auto-detection marks its
   * output in `ObjectType`. Not an issue by itself; it is what lets the panel
   * say "37 aus der Erkennung, davon 9 noch offen".
   */
  readonly derived: boolean;
}

export interface RoomFinding {
  readonly record: RoomRecord;
  readonly issues: readonly RoomIssue[];
}

/**
 * Below this many square metres a detected region is treated as an artefact.
 *
 * Two square metres is smaller than any room a plan names — a broom cupboard
 * is three — and larger than the shafts and wall cavities the detection picks
 * up. It is a suggestion to look, never an automatic delete.
 */
export const DEFAULT_SLIVER_AREA = 2;

/**
 * Names no human chose: what the space builders write when nobody has said
 * anything yet. `R7`, `Space 12`, `Raum 3`, and the `0.99` / `1.99` shape a
 * numbering scheme uses for "to be decided".
 */
const PLACEHOLDER_NAME = /^(?:r|raum|room|space)[\s._-]*\d+[a-z]?$/i;
/**
 * The same word with the counter in FRONT (`12.Space`) or with no counter at
 * all (`Space`).
 *
 * Both come out of the room generator: the name pattern is the user's, so
 * `{n}.Space` is as ordinary as `Space {n}`, and a room drawn by hand gets the
 * bare word. Found in a real model, where they slipped through as named rooms
 * and got as far as producing door numbers called `Space.T1`.
 */
const PLACEHOLDER_REVERSED = /^\d+[a-z]?[\s._-]*(?:r|raum|room|space)$/i;
const PLACEHOLDER_BARE = /^(?:raum|room|space)$/i;
const PLACEHOLDER_NUMBER = /^\d+\.9\d$/;
const PLACEHOLDER_WORDS = /^(?:unbenannt|unnamed|tbd|xxx|\?+)\b/i;

/** Whether this is a name that was generated rather than chosen. */
export function isPlaceholderName(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  return PLACEHOLDER_NAME.test(value)
    || PLACEHOLDER_REVERSED.test(value)
    || PLACEHOLDER_BARE.test(value)
    || PLACEHOLDER_NUMBER.test(value)
    || PLACEHOLDER_WORDS.test(value);
}

export interface RoomCheckOptions {
  /** Area below which a space is flagged as an artefact. */
  readonly sliverArea?: number;
}

/**
 * Check every space and say what is open about it.
 *
 * Duplicates are counted PER STOREY, because that is the scope a numbering
 * scheme actually promises: `1.06` on the first floor and `2.06` on the second
 * are different rooms, while `1.06` twice on one floor is a mistake — and in a
 * generated model it is the specific mistake of a space having been drawn
 * twice, once by the CAD author and once by the detection.
 */
export function checkRooms(
  records: readonly RoomRecord[],
  options: RoomCheckOptions = {},
): RoomFinding[] {
  const sliverArea = options.sliverArea ?? DEFAULT_SLIVER_AREA;

  const seen = new Map<string, number>();
  for (const record of records) {
    const number = record.number.trim();
    if (!number) continue;
    const key = `${record.storeyId} ${number.toLowerCase()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  return records.map((record) => {
    const number = record.number.trim();
    const description = record.description.trim();
    const issues: RoomIssue[] = [];

    if (!number) issues.push('no-number');
    else if (seen.get(`${record.storeyId} ${number.toLowerCase()}`)! > 1) {
      issues.push('duplicate-number');
    }
    if (!description) issues.push('no-description');
    // A placeholder is reported once, whichever of the two fields carries it:
    // "R7 / R7" is one unanswered question, not two.
    if (isPlaceholderName(number) || isPlaceholderName(description)) issues.push('placeholder');
    if (record.area !== null && record.area < sliverArea) issues.push('sliver');

    issues.sort((a, b) => ISSUE_ORDER.indexOf(a) - ISSUE_ORDER.indexOf(b));
    return { record, issues };
  });
}

/** Nothing left to decide about this one. */
export function isSettled(finding: RoomFinding): boolean {
  return finding.issues.length === 0;
}

export interface RoomSummary {
  readonly total: number;
  readonly open: number;
  readonly settled: number;
  readonly derived: number;
}

export function summariseRooms(findings: readonly RoomFinding[]): RoomSummary {
  let open = 0;
  let derived = 0;
  for (const finding of findings) {
    if (!isSettled(finding)) open += 1;
    if (finding.record.derived) derived += 1;
  }
  return { total: findings.length, open, settled: findings.length - open, derived };
}

/**
 * Sort for the list: open before settled, then by storey, then by number.
 *
 * Numbers sort naturally rather than lexically — `1.9` belongs before `1.10`,
 * and a list that puts it after is a list people stop trusting halfway down.
 */
export function sortFindings(findings: readonly RoomFinding[]): RoomFinding[] {
  const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  return [...findings].sort((a, b) => {
    const openness = Number(isSettled(a)) - Number(isSettled(b));
    if (openness !== 0) return openness;
    const storey = collator.compare(a.record.storeyName, b.record.storeyName);
    if (storey !== 0) return storey;
    // A space with no number goes to the top of its storey: it is the one the
    // panel is asking about.
    const aNum = a.record.number.trim();
    const bNum = b.record.number.trim();
    if (!aNum !== !bNum) return aNum ? 1 : -1;
    return collator.compare(aNum, bNum);
  });
}

/**
 * The next space still open after the one being worked on — what "übernehmen
 * und weiter" moves to.
 *
 * Wraps around, so finishing the last one lands on the first still-open space
 * instead of on nothing. Returns `null` only when nothing is open at all,
 * which is the panel's finish line.
 */
export function nextOpen(
  findings: readonly RoomFinding[],
  afterKey: string | null,
): RoomFinding | null {
  const open = findings.filter((finding) => !isSettled(finding));
  if (open.length === 0) return null;
  if (afterKey === null) return open[0];

  const index = findings.findIndex((finding) => finding.record.key === afterKey);
  if (index < 0) return open[0];
  for (let step = 1; step <= findings.length; step += 1) {
    const candidate = findings[(index + step) % findings.length];
    if (!isSettled(candidate)) return candidate;
  }
  return null;
}
