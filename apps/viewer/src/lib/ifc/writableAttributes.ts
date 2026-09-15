/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The IFC attributes this application lets a person type into.
 *
 * One list, because two surfaces ask the same question for different reasons
 * and must not answer it differently: the list decides whether a cell accepts
 * an edit, and the properties palette decides whether to OFFER a row for an
 * attribute the file left empty. A palette that offers what the table refuses
 * — or the other way round — is worse than either rule alone.
 *
 * The omissions are deliberate, not an oversight:
 *   - `GlobalId` is the element's identity. Everything that survives a reparse
 *     — the autosave snapshot, the reference-model index — is keyed by it.
 *   - `Class` is the entity type. Changing it is a retype (a different
 *     operation with its own consequences for geometry and psets), not a
 *     string edit.
 *   - `Type` is the name of the `IfcTypeProduct` this element is bound to via
 *     `IfcRelDefinesByType`. Typing over it would have to either rename a type
 *     shared by every other instance, or rebind this one to a different type;
 *     neither is what "edit this cell" looks like it does.
 *
 * `LongName` was missing here for a long time while being a list column, a
 * room-preset column, and writable through the store — an omission nothing
 * argued for. On a room it holds the readable name ("Möbeldepot") while `Name`
 * holds the number ("U.06"), so a room list whose one editable text was the
 * number was a list you could not correct a room in (Marc, 2026-09-16).
 */
export const WRITABLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'Name',
  'LongName',
  'Description',
  'ObjectType',
  'PredefinedType',
  'Tag',
]);
