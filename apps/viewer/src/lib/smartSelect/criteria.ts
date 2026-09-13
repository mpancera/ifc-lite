/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The magic wand: click one element, get every element that is the SAME.
 *
 * Same in what respect is the question the user answers, once, before
 * clicking — "Select all IfcColumn" answers it for them and always answers
 * "class", which is why it reaches across every storey in the building and
 * hands back 22 columns when 14 were meant (Marc, 2026-09-13).
 *
 * # Two passes, and why
 *
 * Class, type, storey and room are columnar or map lookups: a scan over the
 * whole model costs nothing. `PredefinedType` and material are not — both
 * re-parse the entity out of the source buffer, which is fine for a hundred
 * elements and not fine for a hundred thousand. So the cheap criteria narrow
 * first and the expensive ones only ever see what survived. With no expensive
 * criterion enabled they are never read at all, which is the common case.
 *
 * # Missing is a value
 *
 * An element with no storey matches another element with no storey. The
 * alternative — treating absent as "matches nothing" — would quietly drop the
 * unfiled elements from a wand that says "same storey", and unfiled elements
 * are exactly the ones somebody is hunting when they reach for this.
 */

export type SmartCriterion =
  | 'class'
  | 'predefinedType'
  | 'type'
  | 'storey'
  | 'room'
  | 'material';

/** One comparable value. `null` means the element has none. */
export type Fact = string | number | null;

/**
 * Criteria whose value costs a re-parse of the entity. Kept as data rather
 * than a flag on each call so the scan can order itself without the caller
 * having to know which is which.
 */
export const DEEP_CRITERIA: ReadonlySet<SmartCriterion> = new Set(['predefinedType', 'material']);

export interface SmartCriterionDef {
  id: SmartCriterion;
  label: string;
  /** What it means in the file, for the person choosing it. */
  hint: string;
}

/**
 * The catalogue, in the order the panel shows it: what an element IS first,
 * then where it sits, then what it is made of.
 */
export const SMART_CRITERIA: readonly SmartCriterionDef[] = [
  { id: 'class', label: 'Klasse', hint: 'IfcWall, IfcColumn, IfcDoor …' },
  { id: 'predefinedType', label: 'PredefinedType', hint: 'PARTITIONING, FLOOR, USERDEFINED …' },
  { id: 'type', label: 'Typ', hint: 'derselbe IfcXxxType — dieselbe Bauteildefinition' },
  { id: 'storey', label: 'Geschoss', hint: 'dasselbe IfcBuildingStorey' },
  { id: 'room', label: 'Raum', hint: 'derselbe IfcSpace' },
  { id: 'material', label: 'Material', hint: 'dieselben Materialnamen, Schichten eingeschlossen' },
];

export const DEFAULT_CRITERIA: readonly SmartCriterion[] = ['class', 'storey'];

export interface SmartSelectSources {
  /** Everything the wand may return — the model's pickable elements. */
  candidates: Iterable<number>;
  /** One element's value for one criterion. Called only for enabled ones. */
  fact: (expressId: number, criterion: SmartCriterion) => Fact;
}

export interface SmartSelectResult {
  /** Matching elements, the seed among them. */
  ids: number[];
  /** Candidates the cheap pass looked at. */
  scanned: number;
  /** How many entities had to be re-parsed — the expensive half. */
  deepReads: number;
}

/**
 * Every candidate whose enabled criteria all equal the seed's.
 *
 * With no criteria at all the answer is the seed alone: "same in no respect"
 * is not "everything", and returning the whole model there would be a very
 * expensive way to say nothing.
 */
export function collectSmartSelection(
  seedId: number,
  criteria: readonly SmartCriterion[],
  sources: SmartSelectSources,
): SmartSelectResult {
  const wanted = [...new Set(criteria)];
  if (wanted.length === 0) return { ids: [seedId], scanned: 0, deepReads: 0 };

  const cheap = wanted.filter((c) => !DEEP_CRITERIA.has(c));
  const deep = wanted.filter((c) => DEEP_CRITERIA.has(c));

  const seedCheap = cheap.map((c) => sources.fact(seedId, c));
  let scanned = 0;
  const survivors: number[] = [];
  for (const id of sources.candidates) {
    scanned++;
    if (id === seedId) continue;
    let ok = true;
    for (let i = 0; i < cheap.length; i++) {
      if (sources.fact(id, cheap[i]) !== seedCheap[i]) { ok = false; break; }
    }
    if (ok) survivors.push(id);
  }

  if (deep.length === 0) return { ids: [seedId, ...survivors], scanned, deepReads: 0 };

  const seedDeep = deep.map((c) => sources.fact(seedId, c));
  let deepReads = 1;
  const ids = [seedId];
  for (const id of survivors) {
    deepReads++;
    let ok = true;
    for (let i = 0; i < deep.length; i++) {
      if (sources.fact(id, deep[i]) !== seedDeep[i]) { ok = false; break; }
    }
    if (ok) ids.push(id);
  }
  return { ids, scanned, deepReads };
}
