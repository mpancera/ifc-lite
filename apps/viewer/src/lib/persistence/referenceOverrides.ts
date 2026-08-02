/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "What did we change on the reference model?"
 *
 * With discipline roles the work is additive — elements are placed, grouped and
 * typed — and the architecture model is only referenced. Anything that does
 * touch it is therefore an exception worth naming: an override.
 *
 * Today those edits sit in the same overlay as everything else, so a correction
 * to an architect's wall is indistinguishable from placing a detector. Reading
 * them out separately makes the coordination question answerable — hand a list
 * to the architect, or check what a data-harmonisation pass actually altered —
 * without changing how the edits are stored.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';

export type OverrideKind =
  | 'attribute'
  | 'property'
  | 'property-set'
  | 'quantity'
  | 'geometry'
  | 'retype'
  | 'deletion';

export interface ReferenceOverride {
  /** Express id in the currently open model. */
  expressId: number;
  /** Stable identifier, so the entry survives a re-export of the reference. */
  globalId: string;
  ifcType: string;
  /** The entity's name in the reference model, for a readable list. */
  name: string;
  kind: OverrideKind;
  /** What was changed — an attribute name, or `Pset.Property`. */
  field: string;
  /** Value in the reference model, when it could be read. */
  before: string | null;
  /** Value we set. `null` for a deletion. */
  after: string | null;
}

/** The reads this needs from the open model, narrowed for testability. */
export interface OverrideSource {
  globalIdOf: (expressId: number) => string;
  typeNameOf: (expressId: number) => string;
  nameOf: (expressId: number) => string;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * Every change made to an entity that came from the reference model, newest
 * first. Authored entities are excluded by construction: they are ours, so
 * editing one is not an override of anything.
 */
export function collectReferenceOverrides(
  view: MutablePropertyView | null | undefined,
  source: OverrideSource,
): ReferenceOverride[] {
  if (!view) return [];

  const authored = new Set(view.getNewEntities().map((e) => e.expressId));
  const overrides: ReferenceOverride[] = [];

  const describe = (expressId: number) => ({
    expressId,
    globalId: source.globalIdOf(expressId),
    ifcType: source.typeNameOf(expressId),
    name: source.nameOf(expressId),
  });

  for (const mutation of view.getMutations()) {
    if (authored.has(mutation.entityId)) continue;

    switch (mutation.type) {
      case 'UPDATE_ATTRIBUTE':
        overrides.push({
          ...describe(mutation.entityId),
          kind: 'attribute',
          field: mutation.attributeName ?? '',
          before: asText(mutation.oldValue),
          after: asText(mutation.newValue),
        });
        break;

      case 'CREATE_PROPERTY':
      case 'UPDATE_PROPERTY':
      case 'DELETE_PROPERTY':
        overrides.push({
          ...describe(mutation.entityId),
          kind: 'property',
          field: `${mutation.psetName ?? ''}.${mutation.propName ?? ''}`,
          before: asText(mutation.oldValue),
          after: mutation.type === 'DELETE_PROPERTY' ? null : asText(mutation.newValue),
        });
        break;

      case 'CREATE_PROPERTY_SET':
      case 'DELETE_PROPERTY_SET':
        overrides.push({
          ...describe(mutation.entityId),
          kind: 'property-set',
          field: mutation.psetName ?? '',
          before: null,
          after: mutation.type === 'CREATE_PROPERTY_SET' ? 'hinzugefügt' : null,
        });
        break;

      case 'CREATE_QUANTITY':
      case 'UPDATE_QUANTITY':
      case 'DELETE_QUANTITY':
        overrides.push({
          ...describe(mutation.entityId),
          kind: 'quantity',
          field: `${mutation.psetName ?? ''}.${mutation.propName ?? ''}`,
          before: asText(mutation.oldValue),
          after: mutation.type === 'DELETE_QUANTITY' ? null : asText(mutation.newValue),
        });
        break;

      case 'UPDATE_POSITIONAL_ATTRIBUTE':
        // A raw STEP argument — profile dimensions, placement offsets. Shape,
        // not data, so it is called out separately: an architect reading this
        // list needs to know we moved or resized their element.
        overrides.push({
          ...describe(mutation.entityId),
          kind: 'geometry',
          field: mutation.attributeName ?? 'STEP-Argument',
          before: asText(mutation.oldValue),
          after: asText(mutation.newValue),
        });
        break;

      case 'UPDATE_ENTITY_TYPE':
        overrides.push({
          ...describe(mutation.entityId),
          kind: 'retype',
          field: 'IFC-Klasse',
          before: asText(mutation.oldValue),
          after: asText(mutation.newValue),
        });
        break;

      case 'DELETE_ENTITY':
        overrides.push({
          ...describe(mutation.entityId),
          kind: 'deletion',
          field: '',
          before: null,
          after: null,
        });
        break;

      case 'CREATE_ENTITY':
        // Authoring, not an override — and it cannot reach here anyway, since
        // the entity it creates is in `authored`.
        break;
    }
  }

  return overrides.reverse();
}

/** Overrides grouped per reference entity, for a list that reads by element. */
export interface OverriddenEntity {
  expressId: number;
  globalId: string;
  ifcType: string;
  name: string;
  overrides: ReferenceOverride[];
}

export function groupOverridesByEntity(overrides: ReferenceOverride[]): OverriddenEntity[] {
  const byEntity = new Map<number, OverriddenEntity>();
  for (const override of overrides) {
    let entry = byEntity.get(override.expressId);
    if (!entry) {
      entry = {
        expressId: override.expressId,
        globalId: override.globalId,
        ifcType: override.ifcType,
        name: override.name,
        overrides: [],
      };
      byEntity.set(override.expressId, entry);
    }
    entry.overrides.push(override);
  }
  return [...byEntity.values()];
}
