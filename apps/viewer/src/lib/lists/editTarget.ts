/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which list columns can be typed into, and what writing them means.
 *
 * A list column names a *reading* — "the Storey this element sits in", "the
 * value of Pset_X.Y". Some of those readings have an obvious inverse and some
 * do not, and the difference is not cosmetic: `Storey` is derived from a
 * containment relationship, so accepting a typed storey name would mean either
 * silently doing nothing or guessing at a re-containment the author never
 * asked for. Columns without a well-defined inverse stay read-only and say why,
 * because a cell that refuses without explanation reads as a bug.
 *
 * Kept free of React and of the store so the rules can be tested directly.
 */

import type { ColumnDefinition } from '@ifc-lite/lists';

export type EditTarget =
  | { kind: 'attribute'; name: string }
  | { kind: 'property'; psetName: string; propertyName: string };

export type CellEditability =
  | { editable: true; target: EditTarget }
  | { editable: false; reason: string };

/**
 * IFC attributes a list may write.
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
 */
const WRITABLE_ATTRIBUTES = new Set([
  'Name',
  'Description',
  'ObjectType',
  'PredefinedType',
  'Tag',
]);

const READ_ONLY_ATTRIBUTE_REASONS: Record<string, string> = {
  GlobalId: 'Die GlobalId ist die Identität des Bauteils und lässt sich nicht ändern.',
  Class: 'Die IFC-Klasse lässt sich hier nicht ändern — das wäre eine Umtypisierung.',
  Type: 'Der Produkttyp stammt aus einer Beziehung (IfcRelDefinesByType) und wird nicht in der Tabelle geändert.',
};

const SOURCE_REASONS: Record<string, string> = {
  spatial: 'Die räumliche Zuordnung stammt aus einer Beziehung und lässt sich hier nicht überschreiben.',
  material: 'Materialzuordnungen werden nicht in der Tabelle geändert.',
  classification: 'Klassifikationen werden nicht in der Tabelle geändert.',
  model: 'Der Modellname beschreibt die Herkunftsdatei.',
  zone: 'Zonenzuordnungen werden nicht in der Tabelle geändert.',
  // Quantities are computed from geometry. A typed-over value would be
  // overwritten by the next export or reparse without warning.
  quantity: 'Mengen werden aus der Geometrie abgeleitet und lassen sich nicht überschreiben.',
};

/** What typing into a cell of this column would do, or why nothing happens. */
export function cellEditability(column: ColumnDefinition): CellEditability {
  if (column.source === 'attribute') {
    if (WRITABLE_ATTRIBUTES.has(column.propertyName)) {
      return { editable: true, target: { kind: 'attribute', name: column.propertyName } };
    }
    return {
      editable: false,
      reason: READ_ONLY_ATTRIBUTE_REASONS[column.propertyName]
        ?? 'Dieses Attribut lässt sich nicht bearbeiten.',
    };
  }

  if (column.source === 'property') {
    // A property column without a pset is the "/regex/" custom column: it
    // matches across sets, so there is no single set to write back into.
    if (!column.psetName) {
      return {
        editable: false,
        reason: 'Diese Spalte sucht über mehrere Property-Sets — ohne eindeutiges Set gibt es kein Ziel zum Schreiben.',
      };
    }
    return {
      editable: true,
      target: { kind: 'property', psetName: column.psetName, propertyName: column.propertyName },
    };
  }

  return {
    editable: false,
    reason: SOURCE_REASONS[column.source] ?? 'Diese Spalte lässt sich nicht bearbeiten.',
  };
}

/** Convenience for rendering: does this column accept input at all? */
export function isEditableColumn(column: ColumnDefinition): boolean {
  return cellEditability(column).editable;
}

/**
 * Whether this column's value is reached through an IFC relationship rather
 * than read off the element.
 *
 * Worth marking in the header: it explains at a glance why the column cannot be
 * typed into, and — more usefully — where to go to change it. A wrong storey is
 * fixed by re-containing the element, not by correcting a table.
 *
 * `quantity` is excluded on purpose. It is equally read-only, but it comes from
 * geometry, and a chain link would point at a relationship that does not exist.
 */
export function isRelationColumn(column: ColumnDefinition): boolean {
  if (column.source === 'attribute') {
    // The IfcTypeProduct behind IfcRelDefinesByType.
    return column.propertyName === 'Type';
  }
  return column.source === 'spatial'
    || column.source === 'material'
    || column.source === 'classification'
    || column.source === 'zone';
}
