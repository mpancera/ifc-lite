/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The model, written as the requests that would build it in Building X.
 *
 * Building X needs a building structure before any measured value in it means
 * anything: a point belongs to a device, a device to a room, a room to a floor.
 * That structure already exists — it is the spatial hierarchy of the IFC — and
 * is nonetheless retyped by hand in the Data Setup app on most projects. This
 * module is the other half of that: it reads the hierarchy and produces the
 * calls that would create it.
 *
 * # Why a request PLAN and not a finished import
 * A `Floor` names its `Building` by the id Building X assigned when the
 * building was created, and that id does not exist until the POST comes back.
 * A file cannot contain it. So each entry carries a complete, API-shaped body
 * plus an explicit, machine-readable statement of which earlier entry it hangs
 * from (`parentKey` + `parentRelationship`), and whoever runs the plan fills
 * the one field in. The alternative — inventing our own UUIDs and setting `id`
 * on create — is allowed by the API and rejected here: `externalId` is the
 * documented place for a foreign system's key, and `id` belongs to the
 * platform. Two systems both believing they mint the primary key is a class of
 * bug worth not having.
 *
 * # Why `IfcGuid:` in front of the GlobalId
 * The API documentation's own example value for `externalId` is `IfcGuid:1234` — the prefixed
 * form, not the bare identifier. Following it costs nothing and buys the thing
 * prefixes always buy: a second source of foreign keys (a serial number, a CDE
 * id) can land in the same field later without anybody having to guess which
 * kind of key they are looking at.
 *
 * # What this module deliberately does not do
 * It does not talk to the network, and it does not guess. Where the model
 * cannot answer something the API requires — a time zone, a country — the
 * answer comes from the product's settings. Where the model half-answers
 * something optional — a storey called `U1`, which is a basement to a human
 * and nothing at all to a parser — the field is left out and a warning is
 * raised. A wrong floor number that looks right is worse than an absent one.
 */

import {
  IfcTypeEnum,
  isBuildingLikeSpatialType,
  isSpaceLikeSpatialType,
  type SpatialNode,
} from '@ifc-lite/data';
import { externalIdFor } from './types.js';
import type {
  BuildingXAddress, BuildingXLocationType, StructureExportInput,
  StructureExportResult, StructureRequest,
} from './types.js';

// Re-exported so callers keep one import site for the whole feature.
export * from './types.js';

/**
 * A storey's floor number, when the name is unambiguously one.
 *
 * Deliberately strict: only a name that is entirely an optional sign and
 * digits counts. `00`, `01`, `-2` are numbers; `U1`, `EG`, `1.OG`, `Level 3`
 * are not — and the tempting reading of `U1` as `1` is exactly wrong, since it
 * is a basement and means `-1`. There is no rule that gets those right without
 * knowing the office's convention, so the field is omitted and the operator is
 * told which storeys it was omitted for.
 */
export function floorNumberFromName(name: string): number | null {
  const trimmed = name.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The label a location is created with.
 *
 * `Name` first, `LongName` as the fallback, because spatial containers
 * routinely carry the code in `Name` ("01") and the human label in `LongName`
 * ("Sitzungszimmer") — and the code is what a facility manager looks a room up
 * by. Empty when neither says anything, which is a refusal rather than a
 * default: `label` is required and minimum length 1, so an unnamed room cannot
 * be created at all.
 */
export function labelFor(node: SpatialNode): string {
  const name = node.name?.trim() ?? '';
  if (name) return name;
  return node.longName?.trim() ?? '';
}

function addressAttributes(address: BuildingXAddress): Record<string, string> {
  const attributes: Record<string, string> = { countryCode: address.countryCode };
  // Only what was actually filled in: the API accepts a nullable street, but
  // an empty string is a value, and a value that says "" is worse than a field
  // that is not there — it overwrites on a later MODIFY.
  if (address.locality?.trim()) attributes.locality = address.locality.trim();
  if (address.region?.trim()) attributes.region = address.region.trim();
  if (address.postalCode?.trim()) attributes.postalCode = address.postalCode.trim();
  if (address.street?.trim()) attributes.street = address.street.trim();
  return attributes;
}

/** How many building-like children a site has, at any depth below it. */
function countBuildings(node: SpatialNode): number {
  let total = isBuildingLikeSpatialType(node.type) ? 1 : 0;
  for (const child of node.children ?? []) total += countBuildings(child);
  return total;
}

/**
 * Turn a loaded model into the plan that would rebuild it in Building X.
 *
 * Pure — no store, no network, no clock beyond the injected id source.
 */
export function buildStructureRequests(input: StructureExportInput): StructureExportResult {
  const { project, globalIdOf, equipment, settings } = input;
  const newId = input.newId ?? (() => crypto.randomUUID());

  const requests: StructureRequest[] = [];
  const warnings: string[] = [];
  const counts = { Campus: 0, Building: 0, Floor: 0, Room: 0, Equipment: 0 };

  /**
   * Container express id to the location it became.
   *
   * The TYPE is carried alongside the key, not assumed. `has-location` takes a
   * `oneOf` discriminated by `type`, so placing a device on a storey with
   * `type: "Room"` is a rejected request — and a model without rooms, where
   * every device sits on a storey, is the common case rather than the edge one.
   */
  const locationByExpressId = new Map<number, { key: string; type: BuildingXLocationType }>();

  /**
   * Walk one spatial node, having been told what it hangs from.
   *
   * `parentKey` is the plan key of the nearest ANCESTOR that became a Building
   * X location — not necessarily the direct IFC parent. That distinction is
   * what lets a site collapse away (see below) without orphaning its buildings.
   */
  const walk = (node: SpatialNode, parentKey: string | null): void => {
    const globalId = globalIdOf(node.expressId);
    const label = labelFor(node);

    if (node.type === IfcTypeEnum.IfcSite) {
      // A Campus in Building X is a GROUPING of buildings. A site holding one
      // building is not a grouping, it is an artefact of how IFC insists on a
      // site; carrying it over would put a permanent extra level in the tree
      // that every operator then clicks through. So a single-building site
      // contributes nothing and its building takes the site's place.
      if (countBuildings(node) < 2) {
        for (const child of node.children ?? []) walk(child, parentKey);
        return;
      }
      if (!label || !globalId) {
        warnings.push('Das Grundstück hat keinen Namen — Campus übersprungen, die Gebäude stehen einzeln.');
        for (const child of node.children ?? []) walk(child, parentKey);
        return;
      }
      const key = externalIdFor(globalId);
      requests.push({
        method: 'POST',
        path: '/locations',
        key,
        parentKey: null,
        parentRelationship: null,
        body: {
          data: {
            type: 'Campus',
            attributes: { label, externalId: key, timeZone: settings.timeZone },
          },
        },
        source: { ifcClass: 'IfcSite', globalId, name: label, expressId: node.expressId },
      });
      counts.Campus += 1;
      locationByExpressId.set(node.expressId, { key, type: 'Campus' });
      for (const child of node.children ?? []) walk(child, key);
      return;
    }

    if (isBuildingLikeSpatialType(node.type)) {
      if (!label || !globalId) {
        warnings.push('Ein Gebäude ohne Namen wurde übersprungen — mit ihm alle Geschosse darunter.');
        return;
      }
      const key = externalIdFor(globalId);
      const addressId = newId();
      requests.push({
        method: 'POST',
        path: '/locations',
        key,
        parentKey,
        // Only when there is a campus to hang from; a lone building is a root.
        parentRelationship: parentKey ? 'isBuildingOf' : null,
        body: {
          data: {
            type: 'Building',
            attributes: {
              label,
              externalId: key,
              // Required by the API, and not in any IFC — hence a setting.
              timeZone: settings.timeZone,
            },
            relationships: {
              // Required, so it is always written, even when the operator gave
              // nothing but a country.
              hasPostalAddress: { data: { id: addressId, type: 'Address' } },
              ...(parentKey ? { isBuildingOf: { data: { id: '', type: 'Campus' } } } : {}),
            },
          },
          included: [
            { id: addressId, type: 'Address', attributes: addressAttributes(settings.address) },
          ],
        },
        source: { ifcClass: 'IfcBuilding', globalId, name: label, expressId: node.expressId },
      });
      counts.Building += 1;
      locationByExpressId.set(node.expressId, { key, type: 'Building' });
      for (const child of node.children ?? []) walk(child, key);
      return;
    }

    if (node.type === IfcTypeEnum.IfcBuildingStorey) {
      if (!label || !globalId) {
        warnings.push('Ein Geschoss ohne Namen wurde übersprungen — mit ihm alle Räume darauf.');
        return;
      }
      if (!parentKey) {
        warnings.push(`Geschoss «${label}» hängt an keinem Gebäude und wurde übersprungen.`);
        return;
      }
      const key = externalIdFor(globalId);
      const floorNumber = floorNumberFromName(label);
      if (floorNumber === null) {
        warnings.push(`Geschoss «${label}» ergibt keine eindeutige Geschossnummer — das Feld bleibt leer.`);
      }
      requests.push({
        method: 'POST',
        path: '/locations',
        key,
        parentKey,
        parentRelationship: 'isFloorOf',
        body: {
          data: {
            type: 'Floor',
            attributes: {
              label,
              externalId: key,
              ...(floorNumber === null ? {} : { floorNumber }),
            },
            relationships: { isFloorOf: { data: { id: '', type: 'Building' } } },
          },
        },
        source: { ifcClass: 'IfcBuildingStorey', globalId, name: label, expressId: node.expressId },
      });
      counts.Floor += 1;
      locationByExpressId.set(node.expressId, { key, type: 'Floor' });
      for (const child of node.children ?? []) walk(child, key);
      return;
    }

    if (isSpaceLikeSpatialType(node.type)) {
      if (!label || !globalId) {
        warnings.push('Ein Raum ohne Namen wurde übersprungen — Building X verlangt eine Bezeichnung.');
        return;
      }
      if (!parentKey) {
        warnings.push(`Raum «${label}» hängt an keinem Geschoss und wurde übersprungen.`);
        return;
      }
      const key = externalIdFor(globalId);
      requests.push({
        method: 'POST',
        path: '/locations',
        key,
        parentKey,
        parentRelationship: 'isRoomOf',
        body: {
          data: {
            type: 'Room',
            attributes: { label, externalId: key },
            relationships: { isRoomOf: { data: { id: '', type: 'Floor' } } },
          },
        },
        source: { ifcClass: 'IfcSpace', globalId, name: label, expressId: node.expressId },
      });
      counts.Room += 1;
      locationByExpressId.set(node.expressId, { key, type: 'Room' });
      // A room may itself hold spaces in some exports; keep walking.
      for (const child of node.children ?? []) walk(child, key);
      return;
    }

    // Anything else — IfcProject at the top, an IfcSpatialZone, an
    // infrastructure part — is passed through rather than mapped. Building X
    // has no equivalent for most of them, and inventing one would put a level
    // in the tree that nothing on the platform side knows what to do with.
    for (const child of node.children ?? []) walk(child, parentKey);
  };

  walk(project, null);

  // ---- Equipment, after every location exists.
  //
  // Two calls each, because that is what the API offers: `Equipment` has no
  // location relationship on create, only `hasEquipmentType`, `isPartOf`,
  // `feeds` and `isControlledBy`. The place it sits is set afterwards through
  // `/assets/{id}/relationships/has-location`.
  const wanted = new Set(settings.equipmentClasses.map((entry) => entry.toLowerCase()));
  let unplaced = 0;

  for (const candidate of equipment) {
    if (!wanted.has(candidate.ifcClass.toLowerCase())) continue;
    if (!candidate.globalId) continue;

    const key = externalIdFor(candidate.globalId);
    const name = candidate.name.trim() || candidate.ifcClass;

    requests.push({
      method: 'POST',
      path: '/equipment',
      key,
      parentKey: null,
      parentRelationship: null,
      body: {
        data: {
          type: 'Equipment',
          attributes: { name, externalId: key },
        },
      },
      source: {
        ifcClass: candidate.ifcClass,
        globalId: candidate.globalId,
        name,
        expressId: candidate.expressId,
      },
    });
    counts.Equipment += 1;

    const container = candidate.containerId === null
      ? undefined
      : locationByExpressId.get(candidate.containerId);
    if (!container) {
      // Counted rather than one warning per device: a model with four hundred
      // loose sensors would otherwise produce four hundred lines nobody reads.
      unplaced += 1;
      continue;
    }

    requests.push({
      method: 'PATCH',
      // The asset's own id, not known until the POST above comes back — the
      // runner substitutes it the same way it substitutes a parent id.
      path: '/assets/{key}/relationships/has-location',
      key,
      parentKey: container.key,
      parentRelationship: 'hasLocation',
      // The container's OWN type — a device on a storey is placed on a Floor.
      body: { data: { id: '', type: container.type } },
      source: {
        ifcClass: candidate.ifcClass,
        globalId: candidate.globalId,
        name,
        expressId: candidate.expressId,
      },
    });
  }

  if (unplaced > 0) {
    warnings.push(
      `${unplaced} Geräte liegen in keinem exportierten Raum und werden ohne Ort angelegt.`,
    );
  }

  return { requests, warnings, counts };
}
