/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * How each relationship is drawn, and what it is called on the drawing.
 *
 * # The vocabulary is the Data Dictionary's
 * The names and the set of kinds come from the Objektkatalog project's curated
 * relation list (`relationKinds.js` there — Verortung, Gruppenzugehörigkeit,
 * Abschnittszugehörigkeit, Typzuweisung, Klassifizierung, Akteurzuweisung).
 * Deliberately the same six, so a relation means the same thing in the
 * schematic as it does in a Data Template, and nobody has to learn two names
 * for one edge.
 *
 * Three of them are drawn by a chain today. The other three are listed anyway:
 * the style is then already right the day a chain produces them, and a table
 * that only covers what exists today is a table someone forgets to extend.
 *
 * `IfcRelAggregates` is the one entry NOT in that list — decomposition is not
 * an information requirement, so a Data Template has no need of it, while a
 * drawing that puts a room under its storey very much does.
 *
 * # Style, not colour
 * The kind is carried by the LINE, not by a hue: an engineering schematic is
 * read in print and by people who cannot separate colours, and the node ranks
 * already spend the colour budget. Dash patterns are SVG `stroke-dasharray`.
 */

import type { GraphRelation } from '@ifc-lite/graph';

export interface RelationStyle {
  /** The Data Dictionary's German name — what the edge is labelled with. */
  label: string;
  /** `stroke-dasharray`, or `undefined` for a solid line. */
  dash?: string;
  width: number;
}

export interface RelationCatalogueEntry extends RelationStyle {
  ifcEntity: string;
  /** The Objektkatalog's one-line explanation, verbatim where it has one. */
  hinweis: string;
  /** Whether a chain can produce this edge today. */
  drawable: boolean;
}

/**
 * Every kind the catalogue knows, drawn or not — the ONE table.
 *
 * `RELATION_STYLE` below is the typed subset the graph can actually produce,
 * and the legend derives "catalogue kinds not in this drawing" by subtracting
 * from here. Keeping two hand-written lists is how
 * `IfcRelReferencedInSpatialStructure` fell through both of them: it is a
 * `GraphRelation`, so it was not "planned", and no chain emits it, so it was
 * never drawn either — and it appeared nowhere at all.
 */
export const RELATION_CATALOGUE: readonly RelationCatalogueEntry[] = [
  {
    ifcEntity: 'IfcRelContainedInSpatialStructure',
    label: 'Verortung',
    width: 2.2,
    hinweis:
      'Hierarchische Einordnung in die räumliche Struktur, genau eine je Objekt, z.B. Raum im Geschoss',
    drawable: true,
  },
  {
    ifcEntity: 'IfcRelAssignsToGroup',
    label: 'Gruppenzugehörigkeit',
    dash: '6 4',
    width: 1.5,
    hinweis:
      'Mitgliedschaft in einer Gruppe ohne eigene Geometrie, z.B. Raum in einer Wohnung (IfcZone) oder Gerät in einer Anlage (IfcSystem)',
    drawable: true,
  },
  {
    ifcEntity: 'IfcRelReferencedInSpatialStructure',
    label: 'Abschnittszugehörigkeit',
    dash: '10 3 2 3',
    width: 1.5,
    hinweis:
      'Nicht-hierarchische Referenz in einen räumlichen Bereich mit eigener Geometrie, z.B. Raum in einer vermietbaren Fläche (IfcSpatialZone)',
    drawable: true,
  },
  {
    ifcEntity: 'IfcRelDefinesByType',
    label: 'Typzuweisung',
    dash: '2 3',
    width: 1.5,
    hinweis: 'Zuweisung an ein Typobjekt, z.B. Raum an IfcSpaceType',
    drawable: false,
  },
  {
    ifcEntity: 'IfcRelAssociatesClassification',
    label: 'Klassifizierung',
    dash: '14 4',
    width: 1.5,
    hinweis: 'Zuordnung zu einem Klassifikationssystem, z.B. SIA 416:2003 Flächenart',
    drawable: false,
  },
  {
    ifcEntity: 'IfcRelAssignsToActor',
    label: 'Akteurzuweisung',
    dash: '10 3 2 3 2 3',
    width: 1.5,
    hinweis: 'Zuordnung zu einer Rolle oder Person, z.B. vermietbare Fläche an einen Nutzer (IfcOccupant)',
    drawable: false,
  },
  {
    ifcEntity: 'IfcRelAggregates',
    label: 'Zerlegung',
    width: 1.1,
    hinweis:
      'Zerlegung eines Ganzen in seine Teile, z.B. Raum aus dem Geschoss. Nicht im Objektkatalog: eine Zerlegung ist keine Informationsanforderung, eine Zeichnung braucht sie trotzdem.',
    drawable: true,
  },
];

export const RELATION_STYLE: Record<GraphRelation, RelationStyle> = {
  // Verortung — the hierarchical backbone, exactly one per object. Solid and
  // the heaviest line, because everything else is a statement layered on top
  // of where a thing actually sits.
  IfcRelContainedInSpatialStructure: { label: 'Verortung', width: 2.2 },

  // Gruppenzugehörigkeit — membership in something without geometry of its
  // own. Dashed: a grouping is real but not physical.
  IfcRelAssignsToGroup: { label: 'Gruppenzugehörigkeit', dash: '6 4', width: 1.5 },

  // Abschnittszugehörigkeit — a non-hierarchical reference into an area that
  // DOES have its own geometry. Dash-dot, the drafting convention for a
  // boundary that is not a wall.
  IfcRelReferencedInSpatialStructure: {
    label: 'Abschnittszugehörigkeit',
    dash: '10 3 2 3',
    width: 1.5,
  },

  // Zerlegung — outside the Data Dictionary list, see the note above. Solid
  // like Verortung because it is structural too, but visibly lighter: the two
  // are near neighbours in meaning and must not be near neighbours on paper.
  IfcRelAggregates: { label: 'Zerlegung', width: 1.1 },
};

