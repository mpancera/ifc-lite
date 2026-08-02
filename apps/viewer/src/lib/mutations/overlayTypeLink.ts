/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Resolves the `IfcXxxType` an occurrence was typed by THIS session.
 *
 * The parser builds its relationship graph once, while loading. An
 * `IfcRelDefinesByType` authored afterwards therefore never enters it, so
 * `extractTypePropertiesOnDemand` (and everything built on it) reports the
 * occurrence as untyped and its type's defaults — a catalogue product's
 * technical data — never reach it. Every read site that wants type-inherited
 * data has to check the overlay itself; this is that check, in one place.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';

/**
 * The express id of the type `expressId` is linked to by an overlay-authored
 * `IfcRelDefinesByType`, or `null` when no such relationship exists.
 */
export function resolveOverlayDefiningTypeId(
  view: MutablePropertyView | null | undefined,
  expressId: number,
): number | null {
  if (!view) return null;
  for (const entity of view.getNewEntities()) {
    if (entity.type !== 'IfcRelDefinesByType') continue;
    // IfcRelDefinesByType(GlobalId, OwnerHistory, Name, Description,
    //                     RelatedObjects, RelatingType)
    const related = entity.attributes[4];
    const typeRef = entity.attributes[5];
    if (!Array.isArray(related) || typeof typeRef !== 'string') continue;
    if (!related.includes(`#${expressId}`)) continue;
    const typeId = Number(typeRef.replace('#', ''));
    return Number.isNaN(typeId) ? null : typeId;
  }
  return null;
}
