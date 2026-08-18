/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The doors and windows on the storey being drawn, as plan symbols.
 *
 * # Where each number comes from, and why not from somewhere else
 * - **Orientation** from `MeshData.localToWorld`, the resolved placement
 *   chain. Its ROTATION only: its translation lives in the model's original
 *   world while the drawing lives in the RTC-shifted render frame, and mixing
 *   them puts a correctly-turned door kilometres from its wall.
 * - **Position** from the meshes, which are already in the drawing's frame.
 * - **Width** from `localBounds`, the element's own object-space box, because
 *   `OverallWidth` is "for informational purpose only" (IfcDoor §6.1.3.16) and
 *   nothing obliges an exporter to keep it in step with the shape it ships.
 * - **How it opens** from `IfcDoorType.OperationType`, reached through
 *   `IfcRelDefinesByType`. The occurrence usually leaves it unset — every door
 *   in the FZK-Haus does — so reading only the occurrence finds nothing and
 *   draws no swing at all.
 *
 * # Single model only
 * `elementToStorey` is keyed by LOCAL express ids, the same restriction the
 * storey picker and the room labels already carry.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import { extractAllEntityAttributes } from '@ifc-lite/parser';
import type { GeometryResult, MeshData } from '@ifc-lite/geometry';
import { RelationshipType } from '@ifc-lite/data';
import {
  doorOperationFromIfc, planAxes, openingWidth, doorSymbol, windowSymbol,
  classifyOpeningParts, swingFromGeometry, doorSymbolLines, wallThicknessAtOpening,
  operationTypeForSwing, attributeAgreesWithGeometry,
  type SymbolLine, type LocalExtent, type PlanAxes, type LocalBox, type OpeningParts,
} from '@/lib/plan/openingSymbols';
import { doorReference, doorSize, doorLabelLines, formatDoorSize } from '@/lib/plan/doorLabels';
import { doorQuantities } from '@/lib/plan/doorQuantities';
import type { PlanLabel } from '@/lib/plan/roomLabels';
import type { Drawing2D, Point2D } from '@ifc-lite/drawing-2d';
import { useViewerStore } from '@/store';

export interface PlanOpeningSymbol {
  /**
   * Identifies this OCCURRENCE, not this entity.
   *
   * Instanced doors share an express id, so the express id alone would give
   * several symbols the same React key and collapse them to one.
   */
  readonly key: string;
  /** Express id of the door or window, local to its model. */
  readonly expressId: number;
  readonly kind: 'door' | 'window';
  /** The lines to draw, in drawing units. */
  readonly lines: readonly SymbolLine[];
  /** What the model said, for the tooltip — `null` when it said nothing. */
  readonly operationType: string | null;
  /**
   * Where the swing came from. `'geometry'` means a drawn leaf decided it and
   * the symbol therefore agrees with the 3D view; `'operation-type'` means the
   * attribute did, which is the weaker source.
   */
  readonly swingSource: 'geometry' | 'operation-type';
  /**
   * Whether the model's `OperationType` says what its own drawn leaf says.
   *
   * `null` when there is nothing to compare — no leaf, or an attribute that
   * states no swing. That is a third answer and not a quiet yes: a door nobody
   * described is not a door described correctly.
   */
  readonly attributeAgrees: boolean | null;
  /**
   * The enum the attribute SHOULD carry, where the geometry settles it and the
   * attribute disagrees. `null` when there is nothing to correct.
   */
  readonly correctedOperationType: string | null;
  /** What the door is called, for a list somebody has to work through. */
  readonly name: string;
  /**
   * Whether this occurrence's placement is MIRRORED in plan.
   *
   * Reported, not acted on. A mirrored family instance (Revit mirrors doors
   * routinely) turns left-hung into right-hung as drawn, so if a swing ever
   * comes out on the wrong jamb this is the first thing to correlate it
   * against — it shows in the tooltip for exactly that.
   */
  readonly mirrored: boolean;
}

/**
 * Whether the placement flips handedness as seen in the plan.
 *
 * A proper (right-handed) door frame gives one sign for `along × across`; a
 * mirrored instance gives the other. Measured rather than assumed, because a
 * mirrored placement is what an authoring tool produces when somebody flips a
 * door, and nothing else in the file records that it happened.
 */
function isMirrored(axes: { along: { x: number; y: number }; across: { x: number; y: number } }): boolean {
  // Identity and every plain rotation of it give a negative cross product;
  // see the `planAxes` tests, which pin both.
  return axes.along.x * axes.across.y - axes.along.y * axes.across.x > 0;
}

export interface UsePlanOpeningSymbolsOptions {
  enabled: boolean;
  geometryResult: GeometryResult | null | undefined;
  dataStore: IfcDataStore | null | undefined;
  storeyId: number | null;
  /** Which model it is, for reading corrections back out of its overlay. */
  modelId: string | null;
  /**
   * The generated plan, for the one number that has to come off the drawing:
   * how thick the host wall is where the door goes through it. See
   * `wallThicknessAtOpening` for why no other source survives contact with a
   * real model.
   */
  drawing: Drawing2D | null;
}

/**
 * The host wall of a door: through its opening, the way IFC records it.
 *
 * `IfcRelFillsElement` from the door to the `IfcOpeningElement` it fills, then
 * `IfcRelVoidsElement` from that opening to the wall it voids. Both inverse,
 * because both relationships point the other way.
 */
function hostWallOf(store: IfcDataStore, doorId: number): number | undefined {
  const openings = store.relationships?.getRelated(doorId, RelationshipType.FillsElement, 'inverse');
  const opening = openings?.[0];
  if (opening === undefined) return undefined;
  const walls = store.relationships?.getRelated(opening, RelationshipType.VoidsElement, 'inverse');
  return walls?.[0];
}

/** Every cut ring the drawing holds for one entity. */
function cutRingsFor(drawing: Drawing2D | null, entityId: number): Point2D[][] {
  if (!drawing) return [];
  const rings: Point2D[][] = [];
  for (const polygon of drawing.cutPolygons) {
    if (!polygon.isCut || polygon.entityId !== entityId) continue;
    rings.push(polygon.polygon.outer);
    for (const hole of polygon.polygon.holes) rings.push(hole);
  }
  return rings;
}

/** An element's meshes reduced to the three things a symbol needs. */
interface OpeningGeometry {
  readonly centre: { x: number; y: number };
  readonly extent: LocalExtent;
  /** The opening's extent along the wall, for measuring the wall right there. */
  readonly alongSpan: readonly [number, number];
  /** The lining and, when the model drew one, the leaf. */
  readonly parts: OpeningParts | null;
}

/** The placement matrix an element's meshes agree on, or `undefined`. */
function placementOf(meshes: readonly MeshData[]): number[] | undefined {
  for (const mesh of meshes) {
    if (mesh.localToWorld) return mesh.localToWorld;
  }
  return undefined;
}

/**
 * Where the opening is, and how big it is in its own frame.
 *
 * The centre is the middle of the element measured ALONG ITS OWN AXES, not the
 * middle of an axis-aligned box round it. For a door parallel to X or Z the two
 * agree; for one at any other angle the axis-aligned box is the box round a
 * tilted rectangle, which is bigger than the door and whose middle drifts as
 * soon as anything about the door is asymmetric — a handle, a threshold, a
 * frame rebated on one side. That drift is small, which is what makes it worth
 * removing: a symbol a few centimetres off its doorway looks like a bug in the
 * symbol rather than in the measurement.
 *
 * The extents come from the local box, so the width is measured across the
 * door rather than across the drawing.
 */
function openingGeometry(meshes: readonly MeshData[], axes: PlanAxes): OpeningGeometry | null {
  const { along, across } = axes;

  // Measure ONLY the pieces that are in the wall. Everything else about an
  // opening may be somewhere else entirely: a leaf drawn standing open reaches
  // a full door-width out into the room, and averaging it in drags the symbol
  // off its own doorway.
  const boxed = meshes.filter((m): m is MeshData & { localBounds: LocalBox } => !!m.localBounds);
  const parts = classifyOpeningParts(boxed.map((m) => m.localBounds));
  const revealMeshes = parts
    ? boxed.filter((m) => m.localBounds === parts.reveal)
    : meshes;

  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;

  for (const mesh of revealMeshes) {
    const ox = mesh.origin?.[0] ?? 0;
    const oz = mesh.origin?.[2] ?? 0;
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i] + ox;
      const y = p[i + 2] + oz;
      const a = x * along.x + y * along.y;
      const b = x * across.x + y * across.y;
      if (a < minA) minA = a; if (a > maxA) maxA = a;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
    }
  }

  if (!Number.isFinite(minA) || !Number.isFinite(minB)) return null;

  // Back from the (along, across) frame into drawing coordinates. The two axes
  // are unit and perpendicular, so this is just their weighted sum.
  const midA = (minA + maxA) / 2;
  const midB = (minB + maxB) / 2;

  return {
    centre: {
      x: along.x * midA + across.x * midB,
      y: along.y * midA + across.y * midB,
    },
    // Measured in the drawing, off the lining: the same body the centre came
    // from, so the symbol cannot be the right size in the wrong place.
    extent: { width: maxA - minA, depth: maxB - minB },
    alongSpan: [minA, maxA],
    parts,
  };
}

/**
 * A named attribute of an entity, as a string, or `undefined`.
 *
 * The authoring overlay is asked FIRST. Without that, a correction made here
 * would be written and then not read back: the door would stay on the list of
 * disagreements it had just been taken off, which reads as the correction not
 * having worked.
 *
 * The overlay stores enums in the STEP form (`.SINGLE_SWING_LEFT.`) because
 * that is what the exporter writes; the source-buffer reader strips those
 * markers. Stripping here too keeps one shape for callers.
 */
function attribute(
  store: IfcDataStore, expressId: number, name: string,
  overlay?: { getAttributeMutationsForEntity(id: number): Array<{ name: string; value: string }> },
): string | undefined {
  const mutated = overlay?.getAttributeMutationsForEntity(expressId)
    ?.find((a) => a.name === name)?.value;
  const raw = mutated ?? extractAllEntityAttributes(store, expressId)
    .find((a) => a.name === name)?.value;
  if (raw === undefined) return undefined;
  const value = String(raw).trim().replace(/^\.|\.$/g, '');
  return value.length > 0 ? value : undefined;
}

/** What a door's frame and leaf measure, as far as the model states them. */
interface DoorDetailProperties {
  readonly liningThickness?: number;
  readonly liningDepth?: number;
  readonly casingThickness?: number;
  readonly thresholdThickness?: number;
  /** Blattdicke. */
  readonly panelDepth?: number;
}

/** The fields taken off `IfcDoorLiningProperties`, by their schema names. */
const LINING_FIELDS = [
  'LiningThickness', 'LiningDepth', 'CasingThickness', 'ThresholdThickness',
] as const;
/** …and off `IfcDoorPanelProperties`. */
const PANEL_FIELDS = ['PanelDepth'] as const;

/**
 * `IfcDoorLiningProperties` for a door, through its type.
 *
 * Reached the awkward way, because there is no other: the lining properties
 * hang off `IfcTypeObject.HasPropertySets`, which is a LIST attribute, and the
 * name-mapped attribute reader only returns scalars. So the raw attribute
 * array is scanned for a list of ids and each is checked by class — order
 * independent, which matters because IFC2X3 puts these on an `IfcDoorStyle`
 * and IFC4 on an `IfcDoorType` and the two do not agree on much else.
 *
 * The lining entity's OWN values are then read BY NAME, which is the part that
 * would otherwise be a real trap: `LiningDepth` and `LiningThickness` are
 * adjacent, both are lengths, and swapping them produces a frame that looks
 * plausible and is wrong in both directions at once.
 */
function detailsFromType(store: IfcDataStore, typeId: number): DoorDetailProperties {
  const type = store.getEntity?.(typeId);
  if (!type?.attributes) return {};

  const out: Record<string, number> = {};
  const take = (entityId: number, fields: readonly string[]) => {
    const named = extractAllEntityAttributes(store, entityId);
    for (const field of fields) {
      const entry = named.find((a) => a.name === field);
      if (!entry) continue;
      const value = Number.parseFloat(String(entry.value));
      if (Number.isFinite(value) && value > 0) out[field] = value;
    }
  };

  for (const attribute of type.attributes) {
    if (!Array.isArray(attribute)) continue;
    for (const candidate of attribute) {
      if (typeof candidate !== 'number') continue;
      // `entities.getTypeName` answers "Unknown" here: the columnar table
      // carries products, and a property-set definition is not one. The
      // buffer-backed reader is the one that knows these exist.
      const kind = store.getEntity?.(candidate)?.type;
      if (kind === 'IFCDOORLININGPROPERTIES') take(candidate, LINING_FIELDS);
      else if (kind === 'IFCDOORPANELPROPERTIES') take(candidate, PANEL_FIELDS);
    }
  }

  return {
    liningThickness: out.LiningThickness,
    liningDepth: out.LiningDepth,
    casingThickness: out.CasingThickness,
    thresholdThickness: out.ThresholdThickness,
    panelDepth: out.PanelDepth,
  };
}

/**
 * The same values where a newer schema keeps them: as property SETS on the
 * door, `Pset_DoorLiningProperties` and `Pset_DoorPanelProperties`. A model
 * written either way answers the same questions, so both are read and whatever
 * the type did not supply is filled in from here.
 */
function detailsFromPropertySets(
  store: IfcDataStore, expressId: number, scale: number,
): DoorDetailProperties {
  const read = (setName: string, field: string): number | undefined => {
    const raw = propertyValue(store, expressId, setName, field);
    if (raw === undefined) return undefined;
    const value = Number.parseFloat(raw) * scale;
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  return {
    liningThickness: read('Pset_DoorLiningProperties', 'LiningThickness'),
    liningDepth: read('Pset_DoorLiningProperties', 'LiningDepth'),
    casingThickness: read('Pset_DoorLiningProperties', 'CasingThickness'),
    thresholdThickness: read('Pset_DoorLiningProperties', 'ThresholdThickness'),
    panelDepth: read('Pset_DoorPanelProperties', 'PanelDepth'),
  };
}

/** A named quantity out of a named quantity set, in metres, or `undefined`. */
function quantityValue(
  store: IfcDataStore, expressId: number, setName: string, name: string, scale: number,
): number | undefined {
  for (const set of store.getQuantities?.(expressId) ?? []) {
    if (set.name !== setName) continue;
    for (const q of set.quantities ?? []) {
      if (q.name !== name) continue;
      const value = q.value * scale;
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return undefined;
}

/** A named property out of a named property set, or `undefined`. */
function propertyValue(
  store: IfcDataStore, expressId: number, setName: string, propertyName: string,
): string | undefined {
  for (const set of store.getProperties?.(expressId) ?? []) {
    if (set.name !== setName) continue;
    for (const property of set.properties ?? []) {
      if (property.name !== propertyName) continue;
      const value = String(property.value ?? '').trim();
      if (value.length > 0) return value;
    }
  }
  return undefined;
}

export interface PlanOpenings {
  readonly symbols: PlanOpeningSymbol[];
  /**
   * Door marks and sizes.
   *
   * Produced HERE rather than by a hook of their own: both outputs need the
   * same placement, the same lining and the same one pass over the meshes, and
   * doing that twice would be the expensive half of the work repeated. The two
   * are switched on independently in the view, which is where that belongs.
   */
  readonly doorLabels: PlanLabel[];
  /**
   * How many doors got the assumed frame width because the model states none.
   *
   * Surfaced so the toolbar can DECLARE it. On the models met so far this is
   * the normal case, not the exception, and a plan that quietly invents a
   * frame width is a plan whose door openings are wrong by a centimetre or
   * two everywhere without saying so.
   */
  readonly assumedLinings: number;
  /**
   * How many door frames took their depth from the WALL as drawn, out of
   * {@link doorsWithSymbol}.
   *
   * The measurement is the only source that is really the wall, and whether
   * it fired is invisible in the drawing — a frame looks equally plausible
   * either way. Counted so the toolbar can say, on any model, whether the
   * plan is showing the wall or the door talking about itself.
   */
  readonly wallMeasuredDepths: number;
  readonly doorsWithSymbol: number;
}

const NO_OPENINGS: PlanOpenings = {
  symbols: [], doorLabels: [], assumedLinings: 0,
  wallMeasuredDepths: 0, doorsWithSymbol: 0,
};

/**
 * How far off the wall a door's label sits, in metres, measured from the face.
 *
 * On the side AWAY from the swing, because the swing side is where the arc is.
 */
const DOOR_LABEL_CLEARANCE = 0.35;

export function usePlanOpeningSymbols({
  enabled, geometryResult, dataStore, storeyId, modelId, drawing,
}: UsePlanOpeningSymbolsOptions): PlanOpenings {
  // A correction written this session lives in the overlay, not in the parsed
  // buffer; `mutationVersion` bumps on every edit and is what makes a corrected
  // door leave the list of disagreements it was just taken off.
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  return useMemo((): PlanOpenings => {
    if (!enabled || !dataStore || storeyId === null) return NO_OPENINGS;
    const elementToStorey = dataStore.spatialHierarchy?.elementToStorey;
    if (!elementToStorey) return NO_OPENINGS;

    // Group this storey's doors and windows in ONE pass over the meshes. A
    // door arrives as up to thirty submeshes (frame, leaf, glazing, handle),
    // all sharing one express id and one placement.
    //
    // Keyed on `occurrenceKey`, NOT on `expressId`. A repeated door type is
    // GPU-instanced, and instanced occurrences are materialised as one
    // `MeshData` each, ALL STAMPED WITH THE SAME EXPRESS ID — which is the
    // collision that field exists to prevent. Keying on the express id merges
    // several real doors into one blob: the bounding box centre lands between
    // them, so every symbol sits slightly off its own doorway, and the first
    // occurrence's placement then decides the hinge for all of them, so some
    // come out right and some mirrored. One cause, both symptoms.
    const byOpening = new Map<string, { expressId: number; kind: 'door' | 'window'; meshes: MeshData[] }>();
    for (const mesh of geometryResult?.meshes ?? []) {
      if ((mesh.geometryClass ?? 0) === 2) continue;
      const type = mesh.ifcType;
      const kind = type === 'IfcDoor' ? 'door' : type === 'IfcWindow' ? 'window' : null;
      if (!kind) continue;
      if (elementToStorey.get(mesh.expressId) !== storeyId) continue;

      // Absent on a flat mesh, where one express id IS one occurrence.
      const key = mesh.occurrenceKey ?? String(mesh.expressId);
      const entry = byOpening.get(key);
      if (entry) entry.meshes.push(mesh);
      else byOpening.set(key, { expressId: mesh.expressId, kind, meshes: [mesh] });
    }
    if (byOpening.size === 0) return NO_OPENINGS;

    const scale = dataStore.lengthUnitScale ?? 1;
    // Corrections made in this session live here, not in the parsed buffer.
    const overlay = mutationViews.get(modelId ?? '');
    // Doors of one type share an OperationType, and re-reading the type per
    // door would re-parse the same entity for every door in the building.
    const operationByType = new Map<number, string | undefined>();

    const symbols: PlanOpeningSymbol[] = [];
    const doorLabels: PlanLabel[] = [];
    /** How many doors had to be given a frame width rather than told one. */
    let assumedLinings = 0;

    let wallMeasuredDepths = 0;

    let doorsWithSymbol = 0;
    for (const [key, { expressId, kind, meshes }] of byOpening) {
      // The axes come first: the centre is measured along them.
      //
      // Without a placement there is no way to know which way the door faces,
      // and a symbol laid on the drawing's axes would be confidently wrong for
      // every wall that is not square to them.
      const axes = planAxes(placementOf(meshes));
      if (!axes) continue;

      const geometry = openingGeometry(meshes, axes);
      if (!geometry) continue;

      const stated = attribute(dataStore, expressId, 'OverallWidth');
      const width = openingWidth(
        geometry.extent,
        stated === undefined ? null : Number.parseFloat(stated) * scale,
      );
      if (width === null) continue;

      if (kind === 'window') {
        symbols.push({
          key, expressId, kind,
          lines: windowSymbol({ centre: geometry.centre, width, depth: geometry.extent.depth, axes }),
          operationType: null,
          swingSource: 'geometry',
          attributeAgrees: null,
          correctedOperationType: null,
          name: '',
          mirrored: isMirrored(axes),
        });
        continue;
      }

      // `OperationType` may sit on the occurrence (IFC4) or on the type; the
      // occurrence is the more specific statement when it carries one.
      let operationType = attribute(dataStore, expressId, 'OperationType', overlay);
      if (operationType === undefined) {
        const typeIds = dataStore.relationships?.getRelated(
          expressId, RelationshipType.DefinesByType, 'inverse',
        );
        const typeId = typeIds?.[0];
        if (typeId !== undefined) {
          if (!operationByType.has(typeId)) {
            operationByType.set(typeId, attribute(dataStore, typeId, 'OperationType', overlay));
          }
          operationType = operationByType.get(typeId);
        }
      }

      // The model's own leaf outranks the enum. Where a leaf was drawn, the
      // symbol is made to agree with the 3D view by construction; only where
      // none was found does the attribute get a say.
      // ── The frame ─────────────────────────────────────────────────────
      // `IfcDoorLiningProperties` off the type where there is one, then a
      // property set some exporters write under the same name instead, then
      // the assumption — which the toolbar declares, because on the models met
      // so far the assumption is the normal case rather than the exception.
      const typeIds = dataStore.relationships?.getRelated(
        expressId, RelationshipType.DefinesByType, 'inverse',
      );
      const typeId = typeIds?.[0];
      const fromType = typeId === undefined ? {} : detailsFromType(dataStore, typeId);
      const fromSets = detailsFromPropertySets(dataStore, expressId, scale);
      const details: DoorDetailProperties = {
        liningThickness: fromType.liningThickness ?? fromSets.liningThickness,
        liningDepth: fromType.liningDepth ?? fromSets.liningDepth,
        casingThickness: fromType.casingThickness ?? fromSets.casingThickness,
        thresholdThickness: fromType.thresholdThickness ?? fromSets.thresholdThickness,
        panelDepth: fromType.panelDepth ?? fromSets.panelDepth,
      };

      // The wall as DRAWN, measured across the doorway. Falls back to the
      // lining's own depth only when the wall is not in the drawing — a wall
      // on another storey, or one the cut missed.
      const wallId = hostWallOf(dataStore, expressId);
      const wallThickness = wallId === undefined ? null : wallThicknessAtOpening(
        cutRingsFor(drawing, wallId), axes, geometry.alongSpan,
      );

      const statedHeightRaw = attribute(dataStore, expressId, 'OverallHeight');
      const quantities = doorQuantities({
        nominalWidth: stated === undefined ? null : Number.parseFloat(stated) * scale,
        nominalHeight: statedHeightRaw === undefined ? null : Number.parseFloat(statedHeightRaw) * scale,
        frameWidth: quantityValue(dataStore, expressId, 'Qto_DoorBaseQuantities', 'Width', scale),
        frameHeight: quantityValue(dataStore, expressId, 'Qto_DoorBaseQuantities', 'Height', scale),
        ...details,
        leaves: doorOperationFromIfc(operationType).motion === 'double-swing' ? 2 : 1,
        measuredWidth: width,
        // The WALL as drawn, not the frame and not the mesh. `LiningDepth`
        // runs past the plaster, and a wall mesh carries its returns; the cut
        // polygon is the wall at the height being drawn (Marc, 2026-08-13).
        measuredDepth: wallThickness,
      });
      if (!quantities) continue;
      if (quantities.liningSource === 'assumed') assumedLinings += 1;
      if (quantities.depthSource === 'wall') wallMeasuredDepths += 1;
      doorsWithSymbol += 1;

      const widths = {
        rough: quantities.nominalWidth,
        lining: quantities.liningThickness,
        // The LEAF spans the lichte Breite, so that is what the arc sweeps.
        // `passageWidth` takes the leaf's own thickness off as well and is the
        // number for getting furniture through, not for drawing an arc.
        clear: quantities.clearWidth,
        liningSource: quantities.liningSource,
      };

      const fromAttribute = doorOperationFromIfc(operationType);
      const drawn = geometry.parts?.leaf
        ? swingFromGeometry(geometry.parts.reveal, geometry.parts.leaf)
        : null;
      const operation = drawn
        ? { motion: 'swing' as const, hinge: drawn.hinge, openTowards: drawn.openTowards }
        : fromAttribute;

      // ── The door's own label ──────────────────────────────────────────
      // Number and size, read the same way a room's name and area are.
      const reference = doorReference({
        name: attribute(dataStore, expressId, 'Name'),
        psetReference: propertyValue(dataStore, expressId, 'Pset_DoorCommon', 'Reference'),
        tag: attribute(dataStore, expressId, 'Tag'),
      });
      // Nennbreite and Nennhöhe — the rough opening. Marc's choice for the
      // stamp for now; every other measurement is on `quantities` and can be
      // put here instead without touching anything that draws.
      const size = doorSize({
        statedWidth: quantities.nominalWidth,
        statedHeight: quantities.nominalHeight,
        geometricWidth: width,
        // The LEAF's height is the door's; the lining's includes the frame and
        // is a number no schedule contains.
        geometricHeight: geometry.parts?.leaf
          ? geometry.parts.leaf.max[1] - geometry.parts.leaf.min[1]
          : geometry.parts
            ? geometry.parts.reveal.max[1] - geometry.parts.reveal.min[1]
            : null,
      });
      const labelLines = doorLabelLines(reference, size);
      if (labelLines.length > 0) {
        // Clear of the wall and on the side AWAY from the swing, where the arc
        // is not. `openTowards` already points at the swing side.
        const off = -operation.openTowards * (geometry.extent.depth / 2 + DOOR_LABEL_CLEARANCE);
        doorLabels.push({
          key, expressId, kind: 'door',
          anchor: {
            x: geometry.centre.x + axes.across.x * off,
            y: geometry.centre.y + axes.across.y * off,
          },
          lines: labelLines,
          // A door label appears once the doorway itself is as wide on screen
          // as the text — the same "does it fit" rule the rooms follow, against
          // the only extent a door has.
          width, height: width,
          // The stamp sits BESIDE the door, so the doorway's own size decides
          // whether it is worth drawing — not whether the mark fits in it.
          fit: 'beside',
          title: size
            ? `Tür ${reference || `#${expressId}`} — ${formatDoorSize(size)} cm`
            : undefined,
        });
      }

      const lines = doorSymbolLines(doorSymbol({
        centre: geometry.centre, widths, axes, operation,
        // `doorQuantities` has already decided this: the wall as measured,
        // with the stated `LiningDepth` only as the fallback.
        depth: quantities.liningDepth ?? geometry.extent.depth,
      }));
      if (lines.length === 0) continue;

      const agrees = drawn ? attributeAgreesWithGeometry(fromAttribute, drawn) : null;
      const shouldSay = drawn ? operationTypeForSwing(operation) : null;
      symbols.push({
        key, expressId, kind, lines,
        operationType: operationType ?? null,
        swingSource: drawn ? 'geometry' : 'operation-type',
        attributeAgrees: agrees,
        correctedOperationType: agrees === false ? shouldSay : null,
        name: reference,
        mirrored: isMirrored(axes),
      });
    }

    return { symbols, doorLabels, assumedLinings, wallMeasuredDepths, doorsWithSymbol };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geometryResult, dataStore, storeyId, modelId, drawing, mutationViews, mutationVersion]);
}

export default usePlanOpeningSymbols;
