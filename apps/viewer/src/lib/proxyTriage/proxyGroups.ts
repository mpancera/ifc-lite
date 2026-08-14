/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Sorting a model's `IfcBuildingElementProxy` elements into decidable groups.
 *
 * # The problem
 * A proxy says "this is a thing, and I am not telling you what kind". Some
 * authors emit thousands of them. A real electrical model examined while
 * building this had 3643, every one of them named `BuildingElementProxy <n>`.
 * Going through those one at a time is not work anybody will do.
 *
 * # Therefore: groups, not elements
 * GROUPING IS THE POINT (Marc, 2026-08-14). A group is decided ONCE and the
 * decision holds for every member. On that model, grouping by system and
 * description turned 3643 elements into 45 groups whose ten largest cover 96%
 * of them — an afternoon's work instead of an impossible one.
 *
 * # Which axes
 * Six, in the order of how much authority they carry:
 *
 *  - `type` — the author's own `IfcTypeObject`. The strongest by far: two
 *    elements of one type ARE the same kind of thing, by the author's own
 *    statement. Absent from the model above, present in most Revit exports.
 *  - `system` — `IfcSystem` membership. "Leuchten", "Brandmeldeanlagen".
 *  - `description` / `name` — what the author wrote, where they wrote anything.
 *  - `layer` — the CAD layer, which in practice often repeats the system.
 *  - `geometry` — elements sharing one `IfcRepresentationMap` are the same
 *    block placed repeatedly. Precise, but usually far too fine to lead with.
 *
 * The axes are combined, not chosen between: `suggestAxes` walks that order
 * and keeps an axis only if it actually splits something and the result stays
 * within a list a person can work through.
 *
 * # Size is deliberately not an axis
 * An earlier sketch triaged by bounding-box volume — small things are
 * fittings, large things are ducts. Marc rejected it: the answer to "what is
 * this" comes from the catalogue and from what the author already said, not
 * from a guess about how big a socket is.
 */

/** What a group can be cut by. */
export type ProxyGroupAxis =
  | 'type' | 'system' | 'description' | 'name' | 'layer' | 'geometry';

/** Strongest first — the order `suggestAxes` walks. */
export const AXIS_ORDER: readonly ProxyGroupAxis[] = [
  'type', 'system', 'description', 'name', 'layer', 'geometry',
];

/** What to call an axis in the interface. */
export const AXIS_LABELS: Readonly<Record<ProxyGroupAxis, string>> = {
  type: 'Typ',
  system: 'System',
  description: 'Beschreibung',
  name: 'Name',
  layer: 'Layer',
  geometry: 'Geometrie',
};

/** One proxy, reduced to the facts grouping can use. */
export interface ProxyElement {
  readonly expressId: number;
  readonly name: string;
  readonly description: string;
  /** Name of the `IfcTypeObject` this is defined by, where there is one. */
  readonly typeName: string | null;
  /** Name of the `IfcSystem` it is assigned to. */
  readonly system: string | null;
  /** Presentation layer. */
  readonly layer: string | null;
  /** Identity of the shared representation, where the geometry is a block. */
  readonly geometryKey: string | null;
}

export interface ProxyGroup {
  /** Stable across regrouping of the same model — a decision is stored by it. */
  readonly key: string;
  /** What the user reads, e.g. `Licht · Deckenleuchte`. */
  readonly label: string;
  /** The axis values behind the label, for a table that wants them apart. */
  readonly values: readonly string[];
  readonly members: readonly number[];
}

/** Longer than this and the list stops being something a person works through. */
export const MAX_GROUPS = 60;

/**
 * How much finer an axis has to make the list before it is worth a column.
 *
 * Measured against a real electrical model: adding the CAD layer beside the
 * system split one group of 1365 into 1364 and 1. That is a split, so a rule
 * of "keeps it if it splits anything" took it — and every row in the list grew
 * a third term that repeated the second. Requiring a quarter more groups keeps
 * an axis that genuinely cuts (description, +105% there) and drops one that
 * merely restates (layer, +2%).
 */
const MIN_SPLIT_GAIN = 1.25;

/** Shown where an axis has nothing to say about an element. */
const ABSENT = '—';

/**
 * Joins the axis values into a group key.
 *
 * A character no IFC label can contain, so two different cuts cannot collide
 * into one key: with a space, `['Licht Ost', 'Leuchte']` and `['Licht',
 * 'Ost Leuchte']` would key the same, and a decision made on one would silently
 * apply to the other. Written as an escape because a raw control character in
 * the source makes the file binary to git.
 */
const KEY_SEPARATOR = '\u0000';

/**
 * Values that are present but say nothing.
 *
 * An author whose export writes `IfcBuildingElementProxy` into the description
 * of all 3420 elements has not described them. Treating that as a value would
 * produce one enormous group labelled with the answer we are trying to find.
 */
function informative(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (/^(ifc)?buildingelementproxy$/i.test(text)) return null;
  if (/^(proxy|unknown|undefined|null|n\/?a)$/i.test(text)) return null;
  return text;
}

/**
 * Drop a trailing instance number, but only where it is one.
 *
 * `BuildingElementProxy 1` … `BuildingElementProxy 3643` are one family
 * counted off; `KIR 16` and `KIR 20` are two different conduits. The
 * difference is not in the string, so it is read from the data: a name that
 * occurs ONCE is a serial number and collapses, a name shared by several
 * elements is a real name and stays.
 *
 * Applied to names only. Descriptions carry their numbers in the middle
 * (`… mit 3 Leuchten`), where this rule does not reach and should not.
 */
export function collapseSerialNames(
  elements: readonly ProxyElement[],
): Map<number, string | null> {
  const rawCounts = new Map<string, number>();
  for (const element of elements) {
    const name = informative(element.name);
    if (name) rawCounts.set(name, (rawCounts.get(name) ?? 0) + 1);
  }

  const result = new Map<number, string | null>();
  for (const element of elements) {
    const name = informative(element.name);
    if (!name) { result.set(element.expressId, null); continue; }
    if ((rawCounts.get(name) ?? 0) > 1) { result.set(element.expressId, name); continue; }
    const stem = name.replace(/[\s_.:#-]*\d+$/, '').trim();
    // A name that was nothing BUT a number keeps it — better a weak name than
    // none. A stem that turns out to be the class name is the `…Proxy 3643`
    // case, and that really does say nothing.
    result.set(element.expressId, stem ? informative(stem) : name);
  }
  return result;
}

function rawAxisValue(element: ProxyElement, axis: ProxyGroupAxis): string | null {
  switch (axis) {
    case 'type': return informative(element.typeName);
    case 'system': return informative(element.system);
    case 'description': return informative(element.description);
    case 'name': return informative(element.name);
    case 'layer': return informative(element.layer);
    case 'geometry': return element.geometryKey?.trim() || null;
  }
}

/**
 * Cut the elements by the given axes.
 *
 * Groups come back largest first, because the largest group is where deciding
 * once buys the most.
 */
export function groupProxies(
  elements: readonly ProxyElement[],
  axes: readonly ProxyGroupAxis[],
): ProxyGroup[] {
  if (elements.length === 0) return [];
  const names = collapseSerialNames(elements);
  const used = axes.length > 0 ? axes : ([] as readonly ProxyGroupAxis[]);

  const buckets = new Map<string, { values: string[]; members: number[] }>();
  for (const element of elements) {
    const values = used.map((axis) => (
      axis === 'name'
        ? names.get(element.expressId) ?? ABSENT
        : rawAxisValue(element, axis) ?? ABSENT
    ));
    const key = values.join(KEY_SEPARATOR);
    const bucket = buckets.get(key);
    if (bucket) bucket.members.push(element.expressId);
    else buckets.set(key, { values, members: [element.expressId] });
  }

  const groups: ProxyGroup[] = [];
  for (const [key, bucket] of buckets) {
    const spoken = bucket.values.filter((v) => v !== ABSENT);
    groups.push({
      key,
      label: spoken.length > 0 ? spoken.join(' · ') : 'Ohne Merkmal',
      values: bucket.values,
      members: bucket.members,
    });
  }
  // Largest first, then by label so the order does not wobble between runs.
  groups.sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));
  return groups;
}

/** How many groups a set of axes would produce. */
function groupCount(
  elements: readonly ProxyElement[],
  axes: readonly ProxyGroupAxis[],
): number {
  return groupProxies(elements, axes).length;
}

/**
 * The axes worth cutting by, for these elements.
 *
 * Walks `AXIS_ORDER` and keeps an axis when it earns its place: it has to cut
 * the list MATERIALLY finer (see {@link MIN_SPLIT_GAIN} — a layer that merely
 * repeats the system adds a column and no information), and the result has to
 * stay inside {@link MAX_GROUPS} (grouping by shared geometry is exact and
 * produces 677 groups, which is not a list anybody works through).
 *
 * Returns an empty array when nothing distinguishes the elements — an honest
 * answer, and the caller can say so rather than showing a false structure.
 */
export function suggestAxes(elements: readonly ProxyElement[]): ProxyGroupAxis[] {
  const chosen: ProxyGroupAxis[] = [];
  let count = 1;
  for (const axis of AXIS_ORDER) {
    const next = [...chosen, axis];
    const nextCount = groupCount(elements, next);
    if (nextCount < count * MIN_SPLIT_GAIN) continue;  // adds a column, not information
    if (nextCount > MAX_GROUPS) continue;              // too fine to work through
    chosen.push(axis);
    count = nextCount;
  }
  return chosen;
}

/**
 * What to type into the class search when this group is opened.
 *
 * The LAST informative value, because the axes run coarse to fine: a group
 * labelled `Licht · Deckenleuchte` is looking for a Deckenleuchte, and its
 * system says only which trade drew it. Where the author wrote nothing, this
 * is empty and the user types — better than a prefill that searches for the
 * word "Licht".
 */
export function groupSearchTerm(group: ProxyGroup): string {
  for (let i = group.values.length - 1; i >= 0; i -= 1) {
    const value = group.values[i];
    if (value !== ABSENT) return value;
  }
  return '';
}

/** `4 Gruppen, 3643 Elemente` — the line above the list. */
export function summariseGroups(groups: readonly ProxyGroup[]): string {
  const elements = groups.reduce((sum, group) => sum + group.members.length, 0);
  const groupWord = groups.length === 1 ? 'Gruppe' : 'Gruppen';
  const elementWord = elements === 1 ? 'Element' : 'Elemente';
  return `${groups.length} ${groupWord}, ${elements} ${elementWord}`;
}
