/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What an example already put in the model, so the next placement can point at
 * it instead of copying it again.
 *
 * # The defect this exists to fix
 * Every placement used to copy the whole example — its profiles, its solids,
 * its representations — and build a fresh `IfcXxxType` over them. Two hundred
 * detectors meant two hundred types and two hundred copies of one body. Marc's
 * framing (2026-09-17) names what that got wrong: a library entry is an
 * accessory, like a block in a CAD tool. One definition, many instances.
 *
 * # Why a session note and not a read of the model
 * The device's geometry COULD be found again in the model: its `IfcXxxType`
 * carries the representation maps, and that is how the company catalogue finds
 * its type. The companions cannot. An example's companions are a clearance and
 * a plan symbol — `IfcVirtualElement` and `IfcAnnotation` — and the schema
 * gives neither of them a type entity, so IFC offers nowhere to record that
 * their geometry is shared. (`typeEntityFor` in `placeExample.ts` already says
 * this, from the other direction.)
 *
 * Rather than answer one question two ways — the overlay for the device, a
 * note for the companions — the note covers all of it, and is CHECKED against
 * the overlay before it is believed.
 *
 * # Why checking matters
 * Undo removes the entities a note points at. A note believed blindly would
 * then make the next placement reference express ids that no longer exist,
 * which an exporter would turn into dangling references rather than an error.
 * So every id is looked up before the record is handed out, and a record that
 * has lost anything is discarded and rebuilt.
 *
 * # The note is not the only way back
 * The overlay outlives a page reload; this note does not. So a session that
 * reopens a model it had already placed into would otherwise write a second
 * definition of a product already defined a few lines above it.
 *
 * `findPlacedType` closes that: the device's `IfcXxxType` carries both the key
 * and its representation maps, so it can be found again in the overlay exactly
 * as the company catalogue finds its own types. That recovers the device half
 * — the companions, having no type to hang on, are copied once more and then
 * remembered. Less than perfect, more than nothing, and the asymmetry is the
 * schema's, not ours.
 *
 * # What neither way survives
 * An export and reload of the FILE. The types are parsed content then, not
 * overlay entities, and nothing here can see them. The company catalogue has
 * the same limit; lifting it means reading types out of the parsed model,
 * which is its own piece of work.
 */

import type { StoreEditor } from '@ifc-lite/mutations';

/** The entities one example left behind, all of them shareable. */
export interface ExampleGeometryRecord {
  /** The `IfcXxxType` over the device's maps, or `null` where the schema has none. */
  typeId: number | null;
  /** `IfcRepresentationMap` per representation of the device. */
  deviceMapIds: readonly number[];
  /** The same, per companion, in the order the example lists them. */
  companionMapIds: readonly (readonly number[])[];
}

/**
 * Per model, because the entities are. The editor is cached per model by
 * `getOrCreateStoreEditor` and dropped when the model closes, so a weak key
 * ties these notes to exactly the lifetime of the thing they describe.
 */
const byEditor = new WeakMap<StoreEditor, Map<string, ExampleGeometryRecord>>();

/** Every express id the record points at, device and companions alike. */
function idsOf(record: ExampleGeometryRecord): number[] {
  const ids = [...record.deviceMapIds];
  for (const maps of record.companionMapIds) ids.push(...maps);
  if (record.typeId !== null) ids.push(record.typeId);
  return ids;
}

/**
 * What this example already left in this model, or `null` when there is
 * nothing to reuse — including when there was and it has since been undone.
 */
export function reuseExampleGeometry(
  editor: StoreEditor,
  typeKey: string,
): ExampleGeometryRecord | null {
  const records = byEditor.get(editor);
  const record = records?.get(typeKey);
  if (!record) return null;

  // Believed only if every piece is still there. A partial survival is still a
  // miss: half a reused example would be worse than copying it again.
  const intact = idsOf(record).every((id) => editor.getNewEntity(id) !== null);
  if (!intact) {
    records?.delete(typeKey);
    return null;
  }
  return record;
}

/** Note what a placement built, for the next one. */
export function rememberExampleGeometry(
  editor: StoreEditor,
  typeKey: string,
  record: ExampleGeometryRecord,
): void {
  let records = byEditor.get(editor);
  if (!records) {
    records = new Map();
    byEditor.set(editor, records);
  }
  records.set(typeKey, record);
}

/** Test seam: forget what this editor left behind. */
export function forgetExampleGeometry(editor: StoreEditor): void {
  byEditor.delete(editor);
}

/**
 * Index 6 of every `IfcElementType`: GlobalId, OwnerHistory, Name, Description,
 * ApplicableOccurrence, HasPropertySets, **RepresentationMaps**, Tag,
 * ElementType.
 */
const REPRESENTATION_MAPS = 6;
/** Index 8 of the same header — where this codebase keeps the identity. */
const ELEMENT_TYPE = 8;

/** `"#42"` as written by the overlay, back to 42. Anything else is not a ref. */
function referencedId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^#(\d+)$/.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * A type for this product already in the overlay, with the maps it carries.
 *
 * Case-insensitive on the entity name: the schema table spells it
 * `IFCSENSORTYPE` and the editor stores what it was given, so comparing the
 * two literally finds nothing and silently writes a duplicate.
 */
export function findPlacedType(
  editor: StoreEditor,
  typeEntity: string,
  typeKey: string,
): { typeId: number; deviceMapIds: number[] } | null {
  const wanted = typeEntity.toUpperCase();
  for (const entity of editor.getNewEntities()) {
    if (entity.type.toUpperCase() !== wanted) continue;
    if (entity.attributes[ELEMENT_TYPE] !== typeKey) continue;

    const raw = entity.attributes[REPRESENTATION_MAPS];
    if (!Array.isArray(raw)) continue;
    const deviceMapIds: number[] = [];
    for (const item of raw) {
      const id = referencedId(item);
      // A type whose map list does not read as references is not one we can
      // place through. Skipped rather than half-used: a partial list would put
      // the occurrence on the wrong body.
      if (id === null) return null;
      deviceMapIds.push(id);
    }
    if (deviceMapIds.length === 0) continue;
    return { typeId: entity.expressId, deviceMapIds };
  }
  return null;
}
