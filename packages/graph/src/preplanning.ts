/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A graph written out as a pre-planning list, for a schematic tool to import.
 *
 * # Why this is not `graphToCsv` with different headers
 * `graphToCsv` writes one row per LEAF with its ancestors as columns — a
 * spreadsheet a person sorts by group. A pre-planning import wants the
 * opposite shape: one row per OBJECT, each naming its parent, so the receiving
 * tool can rebuild the tree as structure segments with planning objects
 * hanging off them. Flattening to leaves throws away exactly the rows that
 * become the segments, and there is no way to recover them on the other side —
 * a detection circuit nobody has put a detector in yet would simply not exist.
 *
 * # The identifying column is the GlobalId, not the designation
 * A pre-planning import matches incoming records against what is already in
 * the project through columns marked *identifying*, and updates rather than
 * duplicates when they match. Any designation is the wrong choice for that:
 * room numbers get corrected, groups get renamed, and a corrected name would
 * arrive as a second object rather than as a change to the first. The IFC
 * `GlobalId` is the one value in the model that survives both a rename and a
 * re-export, so that is the column to mark identifying on the far side —
 * `Kennzeichen` is for a person to read.
 *
 * # The tree comes from the KINDS, not from the walk
 * A chain does not agree with itself about which end is the outside.
 * `elementInSpaceInZone` starts at the device and hops outward;
 * `systemMembers` starts at the installation and hops inward. Reading the
 * structure off the chain's rank order therefore gets one of the two exactly
 * backwards — measured on a real model, it published eighteen detection
 * circuits as planning objects hanging under detectors. So the containment
 * order below is stated over the kinds themselves, where it is a fact about
 * IFC rather than about how somebody happened to phrase the query.
 *
 * # Every node, including the ones with nothing under them
 * An empty room and a circuit with no devices are written out like any other.
 * A list that quietly omits what it could not fill reads as complete, and the
 * gap it hides — a detection zone nobody has put a detector in — is precisely
 * the finding worth carrying across.
 *
 * # What this does NOT claim
 * The column headers here are plain German words, not a schema. The receiving
 * tool maps external columns onto its own properties once, in its own field
 * assignment, and saves that as a scheme — so the names need to be
 * recognisable to the person doing the mapping, not correct in some registry.
 * That is also why nothing here encodes a version: there is no format to be a
 * version of.
 */

import type { Graph, GraphNode, GraphNodeKind } from './types.js';

/**
 * What the receiving tool should make of a row.
 *
 * Two values, because a pre-planning tree has two kinds of thing in it: the
 * structure that holds, and the object that hangs.
 */
export type PreplanningKind = 'Strukturabschnitt' | 'Planungsobjekt';

/** One record of the list. Field order is the column order. */
export interface PreplanningRow {
  /** `Strukturabschnitt` or `Planungsobjekt`. */
  Typ: PreplanningKind;
  /** The designation a person reads: `MZ01`, `1.04`, `A.01.03_FST.RM.001`. */
  Kennzeichen: string;
  /** The parent's `Kennzeichen`, or `''` at the root. */
  Uebergeordnet: string;
  Bezeichnung: string;
  Beschreibung: string;
  /** The installation the object belongs to — the `=` of IEC 81346. */
  Anlage: string;
  /** Where it stands — the `+`. */
  Aufstellungsort: string;
  /** The device designation — the `-`. Empty on structure rows. */
  Betriebsmittel: string;
  /** Exact EXPRESS class, so a reader can tell a detector from a sounder. */
  IfcKlasse: string;
  /** `PredefinedType` — `FIRESENSOR` vs `TEMPERATURESENSOR`. */
  IfcTyp: string;
  /**
   * `Tag` — the mark the element carries on the drawing.
   *
   * On a wired device this is its position on the cable, and it is the column
   * a schematic tool needs to lay the run out in order: the membership rows
   * say WHICH devices are on the run and nothing about the sequence.
   */
  Kabelposition: string;
  /** The identifying column. See the note at the top of this file. */
  IfcGlobalId: string;
}

/** Column order, stated once. The header row and every body row read it. */
export const PREPLANNING_COLUMNS: ReadonlyArray<keyof PreplanningRow> = [
  'Typ',
  'Kennzeichen',
  'Uebergeordnet',
  'Bezeichnung',
  'Beschreibung',
  'Anlage',
  'Aufstellungsort',
  'Betriebsmittel',
  'IfcKlasse',
  'IfcTyp',
  'Kabelposition',
  'IfcGlobalId',
];

/**
 * How far out each kind sits. Higher contains lower.
 *
 * A fact about IFC, not about a query: a device stands in a room, a room is
 * part of a storey, a port sits on a device. `zone` and `system` share a level
 * because neither contains the other — they are two different groupings over
 * the same things, and no chain produces both.
 */
const CONTAINMENT: Record<GraphNodeKind, number> = {
  port: 0,
  element: 1,
  space: 2,
  zone: 3,
  system: 3,
  storey: 4,
};

/**
 * Which of the three IEC 81346 aspects each kind feeds.
 *
 * A guess would be worse than nothing, so only the kinds whose meaning is
 * unambiguous are mapped. A `system` IS an installation; a `storey` and a
 * `space` ARE locations; an `element` IS a device. A `zone` is the one that
 * genuinely depends: a fire detection zone is part of the installation, a
 * letting area is not. It is treated as an installation because that is what
 * every zone a chain of this shape has produced so far has been — and it is
 * called out here rather than left silent, because that is the assumption a
 * reader of an odd-looking export needs to find.
 *
 * `port` is deliberately absent: a connection point is not an installation, a
 * location or a device, and forcing it into one would put a wrong designation
 * on every row of a plant export.
 */
const ASPECT: Partial<Record<GraphNodeKind, 'Anlage' | 'Aufstellungsort' | 'Betriebsmittel'>> = {
  system: 'Anlage',
  zone: 'Anlage',
  storey: 'Aufstellungsort',
  space: 'Aufstellungsort',
  element: 'Betriebsmittel',
};

/**
 * What the receiving tool makes of each kind.
 *
 * By kind and not by position in the chain: a device is a planning object
 * wherever it turns up, and a room is structure even in a query that started
 * from one.
 */
function typeOfKind(kind: GraphNodeKind): PreplanningKind {
  return kind === 'element' || kind === 'port' ? 'Planungsobjekt' : 'Strukturabschnitt';
}

/**
 * The designation a person reads.
 *
 * The asset identifier when the occurrence carries one — that is the number on
 * the plan, in the schedule and on the sticker, and it is what a schematic is
 * matched against by hand. Otherwise the name, which for a room, a storey or a
 * detection circuit IS the designation (`1.04`, `MZ01`). Otherwise the class
 * and the express id, so the row is still addressable rather than blank.
 */
function designationOf(node: GraphNode): string {
  if (node.assetIdentifier) return node.assetIdentifier;
  if (node.name) return node.name;
  return `${node.ifcType}-${node.expressId}`;
}

/** The class, refined by its PredefinedType where there is one. */
function describe(node: GraphNode): string {
  return node.predefinedType ? `${node.ifcType}.${node.predefinedType}` : node.ifcType;
}

/**
 * Everything that directly contains each node, nearest first.
 *
 * Nearest matters because a node legitimately has more than one container in
 * the same graph — a detector is in a room AND in an installation — and a list
 * can hang a row under exactly one. The room wins as the parent because it is
 * the closer of the two; the installation is not lost, it goes into the
 * `Anlage` column, which is where a schematic tool expects to read it.
 *
 * Ties are broken by express id so two runs over the same model produce the
 * same file. A list that reshuffles itself between exports cannot be diffed,
 * and the diff is how anybody sees what a re-import will do.
 */
function containersOf(graph: Graph): Map<string, GraphNode[]> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphNode[]>();
  const consider = (childId: string, parent: GraphNode | undefined, child: GraphNode | undefined) => {
    if (!parent || !child) return;
    if (CONTAINMENT[parent.kind] <= CONTAINMENT[child.kind]) return;
    const list = out.get(childId);
    if (list) list.push(parent);
    else out.set(childId, [parent]);
  };
  for (const edge of graph.edges) {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    consider(edge.source, b, a);
    consider(edge.target, a, b);
  }
  // Nearest first, so the tree can take the head and the aspects can take all.
  for (const list of out.values()) {
    list.sort((x, y) => CONTAINMENT[x.kind] - CONTAINMENT[y.kind] || x.expressId - y.expressId);
  }
  return out;
}

/**
 * The graph as pre-planning records, structure first.
 *
 * Ordered so a parent is always written before its children. Nothing in the
 * format demands it — the parent reference is by designation, not by position
 * — but a list a person scrolls through should read as the tree it describes.
 */
export function graphToPreplanning(graph: Graph): PreplanningRow[] {
  const containers = containersOf(graph);

  /**
   * Everything that contains a node, transitively, and the node itself.
   *
   * ALL of them, not the tree path. The tree picks one parent per row, and the
   * aspects must not be limited to that pick: a detector in a room and in an
   * installation hangs under the room, and its `Anlage` column still has to
   * name the installation. Reading the aspects off the tree path left it
   * empty — measured, and invisible in the file because an empty column looks
   * exactly like a model that never said.
   */
  const enclosureOf = (node: GraphNode): GraphNode[] => {
    const found = [node];
    const seen = new Set([node.id]);
    const queue = [node];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      for (const parent of containers.get(current.id) ?? []) {
        if (seen.has(parent.id)) continue;
        seen.add(parent.id);
        found.push(parent);
        queue.push(parent);
      }
    }
    return found;
  };

  const rowFor = (node: GraphNode): PreplanningRow => {
    const parent = containers.get(node.id)?.[0];
    const aspects: Record<'Anlage' | 'Aufstellungsort' | 'Betriebsmittel', string[]> = {
      Anlage: [],
      Aufstellungsort: [],
      Betriebsmittel: [],
    };
    // Coarse container first within each aspect, so a location key comes out
    // in the order one is written: `01.1.04`, storey then room.
    const enclosure = [...enclosureOf(node)].sort(
      (a, b) => CONTAINMENT[b.kind] - CONTAINMENT[a.kind] || a.expressId - b.expressId,
    );
    for (const container of enclosure) {
      const aspect = ASPECT[container.kind];
      if (aspect) aspects[aspect].push(designationOf(container));
    }
    return {
      Typ: typeOfKind(node.kind),
      Kennzeichen: designationOf(node),
      Uebergeordnet: parent ? designationOf(parent) : '',
      Bezeichnung: node.name,
      Beschreibung: describe(node),
      Anlage: aspects.Anlage.join('.'),
      Aufstellungsort: aspects.Aufstellungsort.join('.'),
      Betriebsmittel: aspects.Betriebsmittel.join('.'),
      IfcKlasse: node.ifcType,
      IfcTyp: node.predefinedType,
      Kabelposition: node.tag,
      IfcGlobalId: node.globalId,
    };
  };

  // Outermost kind first, then by express id — the same stable order the
  // parent tie-break uses.
  const ordered = [...graph.nodes].sort(
    (a, b) => CONTAINMENT[b.kind] - CONTAINMENT[a.kind] || a.expressId - b.expressId,
  );
  return ordered.map(rowFor);
}

/** `a;b` with quoting, and the formula guard every export here applies. */
function csvCell(value: string): string {
  // A cell starting with = + - @ is executed on open by spreadsheet software.
  // It matters more here than elsewhere: `Anlage` and `Betriebsmittel` hold
  // IEC 81346 keys, and those legitimately BEGIN with `=` and `-`.
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * The list as a semicolon-separated text file with a header row.
 *
 * Semicolons because the receiving tool is driven from a machine whose list
 * separator is a semicolon, and a comma-separated file lands there as one
 * column. CRLF for the same reason.
 */
export function preplanningToCsv(graph: Graph): string {
  const rows = graphToPreplanning(graph);
  const header = PREPLANNING_COLUMNS.join(';');
  const body = rows.map((row) =>
    PREPLANNING_COLUMNS.map((column) => csvCell(row[column])).join(';'),
  );
  return [header, ...body].join('\r\n');
}
