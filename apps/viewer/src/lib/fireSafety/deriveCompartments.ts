/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turn assigned rooms into compartment BODIES.
 *
 * "Was bisher auf einem PDF mit Leuchtstift erfolgte kann im Kern von der
 * Zuweisung zum Brandabschnitt hergeleitet werden und dann als eigenständiger
 * Geometriekörper entstehen" (Marc, 2026-09-14). This is that step: the author
 * assigns rooms to a zone, and the body follows from the assignment rather
 * than being drawn a second time by hand.
 *
 * Deriving rather than drawing is what keeps the two from disagreeing. A body
 * drawn by hand beside a set of assigned rooms is two statements about the
 * same compartment, and nothing keeps them in step — the first room moved into
 * a neighbouring compartment makes one of them wrong, silently.
 *
 * # Re-running replaces
 *
 * Each derived zone carries the id of the zone it came from in its
 * `Description`, so a second run finds its own and takes them out first.
 * Without that, pressing the button twice leaves two bodies per compartment in
 * the same place and the second run's numbers are indistinguishable from the
 * first's in the exported file — the same reason `removeSpatialZones` exists.
 *
 * Overlay-only, by construction: only entities this session created are
 * removed, so re-importing a previous export and deriving again leaves the
 * imported bodies alone. They would then be duplicated, which is the honest
 * limit of an overlay with no persistent identity.
 */

import { addCompartmentZoneToStore, resolveSpatialAnchor, type CompartmentPart } from '@ifc-lite/create';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { StoreEditor } from '@ifc-lite/mutations';
import {
  renderToWorldViewer, viewerToIfcAxes, type RenderFrameOffsets,
} from '@/components/viewer/tools/measure-modes/coordinates';
import { themeById } from '@/lib/ifcZones/themes';
import { COMPARTMENT_PSET, COMPARTMENT_REQUIREMENTS } from './compartmentRequirements';
import { roomPrism, type PrismMesh } from './roomPrism';

/** What one compartment's derivation did. */
export interface CompartmentOutcome {
  /** The authored zone this came from. */
  sourceZoneId: number;
  name: string;
  /** Members that are rooms with a mesh, and so became a prism. */
  bodies: number;
  /** Members that could not: no mesh, or a mesh with no height. */
  skipped: number;
  /** The emitted `IfcSpatialZone`, or `null` when nothing was written. */
  zoneId: number | null;
  reason: 'no-rooms' | 'no-geometry' | null;
}

export type DeriveRefusal =
  | 'schema-too-old'
  | 'no-anchor'
  /** Federation alignment re-based this model; see `emit-spatial-zones`. */
  | 'rescaled-by-alignment';

export interface DeriveResult {
  outcomes: CompartmentOutcome[];
  /** Bodies from an earlier run that this one took out. */
  replaced: number;
  refusal: DeriveRefusal | null;
}

/** Why nothing was derived, as a sentence. */
export function deriveRefusalText(refusal: DeriveRefusal, modelName: string): string {
  switch (refusal) {
    case 'schema-too-old':
      return `${modelName} ist IFC2X3 und kennt kein IfcSpatialZone`;
    case 'no-anchor':
      return `${modelName} hat kein Geschoss und keinen Darstellungskontext, an dem ein Körper hängen könnte`;
    case 'rescaled-by-alignment':
      return `${modelName} wurde für die Überlagerung verschoben — die eigenen Koordinaten sind daraus nicht zurückzurechnen`;
  }
}

/** What a derived body says about where it came from. */
export function compartmentMarker(sourceZoneId: number): string {
  return `IfcLite compartment from zone #${sourceZoneId}`;
}

const MARKER_PREFIX = 'IfcLite compartment from zone #';

/** `IfcRoot.Description`. */
const DESCRIPTION = 3;
/** `IfcRelReferencedInSpatialStructure.RelatingStructure`. */
const RELATING_STRUCTURE = 5;
/** `IfcRelDefinesByProperties.RelatedObjects`. */
const RELATED_OBJECTS = 4;

/** Every `#N` an attribute list points at, one level deep. */
function refsOf(attributes: readonly unknown[]): number[] {
  const out: number[] = [];
  for (const attribute of attributes) {
    for (const value of Array.isArray(attribute) ? attribute : [attribute]) {
      if (typeof value !== 'string' || !value.startsWith('#')) continue;
      const id = Number(value.slice(1));
      if (Number.isInteger(id)) out.push(id);
    }
  }
  return out;
}

/**
 * Take out the bodies an earlier run derived, and everything only they pointed
 * at. Returns how many zones went.
 *
 * `sourceIds` limits it to the compartments being re-derived now: a zone whose
 * source was deleted keeps its body until the source list says otherwise,
 * which is the caller's decision and not this function's.
 */
export function removeDerivedCompartments(
  editor: StoreEditor,
  sourceIds: ReadonlySet<number> | null,
): number {
  const overlay = new Map(editor.getNewEntities().map((e) => [e.expressId, e]));
  const zoneIds = new Set<number>();
  for (const entity of overlay.values()) {
    if (entity.type !== 'IfcSpatialZone') continue;
    const description = entity.attributes[DESCRIPTION];
    if (typeof description !== 'string' || !description.startsWith(MARKER_PREFIX)) continue;
    const source = Number(description.slice(MARKER_PREFIX.length));
    if (sourceIds && !sourceIds.has(source)) continue;
    zoneIds.add(entity.expressId);
  }
  if (zoneIds.size === 0) return 0;

  const doomed = new Set<number>(zoneIds);
  const queue = [...zoneIds];
  while (queue.length > 0) {
    const entity = overlay.get(queue.pop() as number);
    if (!entity) continue;
    for (const ref of refsOf(entity.attributes)) {
      // Only overlay entities: a `#N` into the file is an anchor reference,
      // and deleting it would tombstone part of the model.
      if (!overlay.has(ref) || doomed.has(ref)) continue;
      doomed.add(ref);
      queue.push(ref);
    }
  }

  // The relationships point AT the zone, so the walk above never reaches them.
  for (const entity of overlay.values()) {
    if (entity.type === 'IfcRelReferencedInSpatialStructure') {
      const structure = entity.attributes[RELATING_STRUCTURE];
      if (typeof structure === 'string' && zoneIds.has(Number(structure.slice(1)))) {
        doomed.add(entity.expressId);
      }
      continue;
    }
    if (entity.type !== 'IfcRelDefinesByProperties') continue;
    const related = entity.attributes[RELATED_OBJECTS];
    if (!Array.isArray(related)) continue;
    if (related.some((v) => typeof v === 'string' && zoneIds.has(Number(v.slice(1))))) {
      doomed.add(entity.expressId);
      // The property set and its values hang off the relationship, not off the
      // zone, so the walk from the zone never reaches them either.
      for (const ref of refsOf(entity.attributes)) {
        if (!overlay.has(ref) || doomed.has(ref)) continue;
        doomed.add(ref);
        queue.push(ref);
        for (const deep of refsOf(overlay.get(ref)?.attributes ?? [])) {
          if (overlay.has(deep)) doomed.add(deep);
        }
      }
    }
  }

  for (const id of doomed) {
    // The zone's own related elements are the user's rooms and must survive.
    if (!zoneIds.has(id) && !overlay.has(id)) continue;
    editor.removeEntity(id);
  }
  return zoneIds.size;
}

/** One compartment to derive: an authored zone and the rooms assigned to it. */
export interface CompartmentSource {
  zoneId: number;
  name: string;
  /** Member express ids — rooms, in the order the relationship lists them. */
  memberIds: readonly number[];
  /** `CHIBB_FireCompartmentRequirements`, as far as it has been decided. */
  requirements: ReadonlyMap<string, string>;
}

export interface DeriveOptions {
  /** Meshes by room express id. */
  meshesOf: (expressId: number) => readonly PrismMesh[] | undefined;
  /** This model's render-frame offsets — NOT the scene's. */
  frame: RenderFrameOffsets;
  /** Federation alignment re-based this model. */
  rebased?: boolean;
  /** Storey to anchor against; the first one when absent. */
  storeyId?: number;
  /** Theme the bodies are emitted as. Defaults to the Brandabschnitt. */
  themeId?: string;
}

/**
 * Derive one `IfcSpatialZone` per compartment into `editor`'s overlay.
 *
 * A compartment with no room that has geometry is REPORTED rather than
 * emitted: a zone with an empty body is not valid IFC, and a compartment made
 * of rooms nobody modelled is a fact the author needs told, not hidden behind
 * a silent skip.
 */
export function deriveCompartmentBodies(
  editor: StoreEditor,
  store: IfcDataStore,
  sources: readonly CompartmentSource[],
  options: DeriveOptions,
): DeriveResult {
  if (options.rebased) return { outcomes: [], replaced: 0, refusal: 'rescaled-by-alignment' };

  const storeyId = options.storeyId ?? store.entityIndex.byType?.get('IFCBUILDINGSTOREY')?.[0];
  if (storeyId === undefined) return { outcomes: [], replaced: 0, refusal: 'no-anchor' };
  let anchor;
  try {
    anchor = resolveSpatialAnchor(store, storeyId);
  } catch {
    return { outcomes: [], replaced: 0, refusal: 'no-anchor' };
  }
  if ((anchor.schema ?? 'IFC4') === 'IFC2X3') {
    return { outcomes: [], replaced: 0, refusal: 'schema-too-old' };
  }

  const theme = themeById(options.themeId ?? 'fire-compartment');
  const replaced = removeDerivedCompartments(editor, new Set(sources.map((s) => s.zoneId)));

  const outcomes: CompartmentOutcome[] = [];
  for (const source of sources) {
    if (source.memberIds.length === 0) {
      outcomes.push({
        sourceZoneId: source.zoneId, name: source.name, bodies: 0, skipped: 0,
        zoneId: null, reason: 'no-rooms',
      });
      continue;
    }

    const parts: CompartmentPart[] = [];
    let skipped = 0;
    for (const memberId of new Set(source.memberIds)) {
      const meshes = options.meshesOf(memberId);
      const prism = meshes ? roomPrism(meshes) : null;
      // A room modelled flat extrudes to nothing, which the builder rejects —
      // counted as skipped rather than allowed to fail the whole compartment.
      if (!prism || !(prism.height > 0)) {
        skipped += 1;
        continue;
      }
      // Out of the render frame and into the file's own, point by point. The
      // same chain `zoneToIfcWorld` uses, for the same reason: undoing the two
      // offsets in the wrong axes folds a model's north offset into its height.
      const ring = prism.ring.map(([x, z]): [number, number] => {
        const p = viewerToIfcAxes(renderToWorldViewer({ x, y: prism.baseY, z }, options.frame));
        return [p.x, p.y];
      });
      const base = viewerToIfcAxes(renderToWorldViewer(
        { x: prism.ring[0][0], y: prism.baseY, z: prism.ring[0][1] }, options.frame,
      ));
      parts.push({ Footprint: ring, BaseZ: base.z, Height: prism.height });
    }

    if (parts.length === 0) {
      outcomes.push({
        sourceZoneId: source.zoneId, name: source.name, bodies: 0, skipped,
        zoneId: null, reason: 'no-geometry',
      });
      continue;
    }

    const properties = COMPARTMENT_REQUIREMENTS
      .map((requirement) => ({ name: requirement.name, value: source.requirements.get(requirement.name) ?? '' }))
      .filter((property) => property.value !== '');

    const result = addCompartmentZoneToStore(editor, anchor, {
      Name: source.name,
      Description: compartmentMarker(source.zoneId),
      PredefinedType: theme.spatialPredefinedType === 'INTERFERENCE'
        || theme.spatialPredefinedType === 'RESERVATION'
        ? 'USERDEFINED'
        : theme.spatialPredefinedType,
      ...(theme.spatialObjectType ? { ObjectType: theme.spatialObjectType } : {}),
      parts,
      RelatedElements: [...new Set(source.memberIds)],
      ...(properties.length > 0
        ? { PropertySet: { name: COMPARTMENT_PSET, properties } }
        : {}),
    });

    outcomes.push({
      sourceZoneId: source.zoneId, name: source.name,
      bodies: result.solids, skipped, zoneId: result.zoneId, reason: null,
    });
  }

  return { outcomes, replaced, refusal: null };
}
