/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * System and type memberships created in THIS session.
 *
 * The store's relationship index is built from the columnar parse and never
 * sees overlay-authored entities. So a system the triage assigned a minute ago
 * is in the file-to-be and invisible to the triage itself: the group would
 * still read "no system", and a second pass would offer to assign it again.
 *
 * Measured, not assumed — on a real model an element that had just been given
 * `IfcDistributionSystem "Starkstrom (Triage)"` still reported its ORIGINAL
 * system from the index and no type at all.
 *
 * So the hooks read the overlay too, and what they find here WINS: it is the
 * newer statement, and it is the one the user just made.
 */

/** An overlay entity as `MutablePropertyView.getNewEntities()` returns it. */
export interface OverlayEntity {
  readonly expressId: number;
  readonly type: string;
  readonly attributes: readonly unknown[];
}

/**
 * Attribute positions in the two relationships, as this app emits them
 * (`emitRelAssignsToGroup` / `emitRelDefinesByType`).
 *
 * `RelatedObjects` is at 4 in both. The relating side differs because
 * `IfcRelAssignsToGroup` carries `RelatedObjectsType` between them — the one
 * place these two layouts diverge, and the reason for two constants rather
 * than one.
 */
const RELATED_OBJECTS = 4;
const RELATING_GROUP = 6;
const RELATING_TYPE = 5;

function idsFrom(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const match = /^#(\d+)$/.exec(String(item));
    if (match) out.push(Number(match[1]));
    else if (typeof item === 'number') out.push(item);
  }
  return out;
}

function idFrom(value: unknown): number | null {
  const match = /^#(\d+)$/.exec(String(value ?? ''));
  if (match) return Number(match[1]);
  return typeof value === 'number' ? value : null;
}

export interface OverlayRelations {
  /** Element id → the name of the system it was just put in. */
  readonly systemOf: ReadonlyMap<number, string>;
  /** Element id → the name of the type it was just defined by. */
  readonly typeOf: ReadonlyMap<number, string>;
}

/**
 * @param nameOf Resolves an express id to a name, from wherever it lives. The
 *   relating entity may itself be overlay-created (a system made seconds ago)
 *   or may come from the file (an existing one that was picked), and this
 *   module should not have to know which.
 */
export function readOverlayRelations(
  entities: Iterable<OverlayEntity>,
  nameOf: (expressId: number) => string,
): OverlayRelations {
  const systemOf = new Map<number, string>();
  const typeOf = new Map<number, string>();

  for (const entity of entities) {
    const isGroup = entity.type === 'IfcRelAssignsToGroup';
    const isType = entity.type === 'IfcRelDefinesByType';
    if (!isGroup && !isType) continue;

    const relating = idFrom(entity.attributes[isGroup ? RELATING_GROUP : RELATING_TYPE]);
    if (relating === null) continue;
    const name = nameOf(relating).trim();
    if (!name) continue;

    const target = isGroup ? systemOf : typeOf;
    for (const member of idsFrom(entity.attributes[RELATED_OBJECTS])) {
      // Last one wins: re-deciding a group writes a second relationship, and
      // the later statement is the one the user meant.
      target.set(member, name);
    }
  }

  return { systemOf, typeOf };
}
