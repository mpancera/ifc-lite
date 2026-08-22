/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Connection points, and the wiring between them.
 *
 * # What a port is for, and why the circuit does not replace it
 * `IfcRelAssignsToGroup` says a device belongs to a circuit. It cannot say
 * WHERE in the run it sits, because `RelatedObjects` is a SET — IFC gives it no
 * order, and none can be smuggled in. The order lives here instead: each device
 * carries two ports, and `IfcRelConnectsPorts` joins one device's outgoing port
 * to the next device's incoming one. Follow those and you have the run, in
 * order, exactly as somebody pulled the cable.
 *
 * The two are complementary and both are worth writing. The connections give
 * the sequence but only locally — asking "which loop is this detector on"
 * means traversing from the controller, and the traversal breaks the moment
 * one hop is missing. The circuit answers that by assertion, in one lookup,
 * even in a half-wired model.
 *
 * # Ports carry no geometry, on purpose
 * IFC allows a port an `ObjectPlacement` and a `Representation` and requires
 * neither. Giving each detector two invisible boxes would double the element
 * count of a plant model for nothing: a drawing of the run is drawn between the
 * DEVICES, whose positions are already known. A port here is a logical thing.
 *
 * # Nesting, not `IfcRelConnectsPortToElement`
 * IFC4 deprecated `IfcRelConnectsPortToElement` and puts a port UNDER its
 * element with `IfcRelNests`. That is what {@link emitRelNests} writes, and it
 * is the relationship `plantTopology` in `@ifc-lite/graph` follows — a model
 * wired the old way draws as devices with no connections at all.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { generateIfcGuid, type RandomSource } from '@ifc-lite/encoding';
import { ownerHistoryRef } from './_emit-helpers.js';

/** `IfcFlowDirectionEnum`, without the dots. */
export type PortFlowDirection = 'SOURCE' | 'SINK' | 'SOURCEANDSINK' | 'NOTDEFINED';

export interface DistributionPortInStoreParams {
  /**
   * Which way the medium runs, from the DEVICE's point of view. `SINK` takes
   * in, `SOURCE` puts out.
   *
   * On a detection loop every detector is a `SOURCEANDSINK`: the line passes
   * through it. Only the controller has a plain `SOURCE` — it feeds the loop.
   * Without this the connection graph is a bare adjacency and there is no
   * answer to which end feeds which.
   */
  FlowDirection?: PortFlowDirection;
  /** `IfcDistributionPortTypeEnum` — `CABLE` for a wired line. IFC4 and up. */
  PredefinedType?: 'CABLE' | 'CABLECARRIER' | 'DUCT' | 'PIPE' | 'USERDEFINED' | 'NOTDEFINED';
  /** `IfcDistributionSystemEnum` — the trade the port belongs to. IFC4 and up. */
  SystemType?: string;
  Name?: string;
  Description?: string;
  ObjectType?: string;
}

/**
 * Create an `IfcDistributionPort`.
 *
 * Attribute order: IfcRoot (GlobalId, OwnerHistory, Name, Description) +
 * IfcObject (ObjectType) + IfcProduct (ObjectPlacement, Representation) +
 * IfcPort — then `FlowDirection`, and on IFC4 and up `PredefinedType` and
 * `SystemType`.
 *
 * IFC2X3 has neither of the last two; emitting them there produces an entity
 * with the wrong attribute count, which is the same trap `sensor.ts` documents
 * for `IfcSensor.PredefinedType`.
 */
export function addDistributionPortToStore(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  params: DistributionPortInStoreParams = {},
  schema: string = 'IFC4',
  random?: RandomSource,
): { portId: number } {
  const attrs: Array<string | null> = [
    generateIfcGuid(random),
    ownerHistoryRef(ownerHistoryId),
    params.Name ?? null,
    params.Description ?? null,
    params.ObjectType ?? null,
    null, // ObjectPlacement — a port is logical; see the note above.
    null, // Representation
    `.${params.FlowDirection ?? 'NOTDEFINED'}.`,
  ];
  if (schema !== 'IFC2X3') {
    attrs.push(`.${params.PredefinedType ?? 'NOTDEFINED'}.`);
    attrs.push(params.SystemType ? `.${params.SystemType}.` : null);
  }
  const portId = editor.addEntity(
    'IfcDistributionPort',
    attrs as Parameters<StoreEditor['addEntity']>[1],
  ).expressId;
  return { portId };
}

/**
 * Nest objects under a parent — here, a device's ports under the device.
 *
 * Attribute order: IfcRoot (GlobalId, OwnerHistory, Name, Description) +
 * IfcRelDecomposes (RelatingObject) + IfcRelNests (RelatedObjects). The same
 * layout as `IfcRelAggregates`, which is why the two are easy to confuse and
 * why they are separate functions rather than one with a flag.
 */
export function emitRelNests(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  relatingObjectId: number,
  relatedObjectIds: readonly number[],
  random?: RandomSource,
): number {
  if (relatedObjectIds.length === 0) {
    throw new Error('emitRelNests: relatedObjectIds is empty');
  }
  return editor.addEntity('IfcRelNests', [
    generateIfcGuid(random),
    ownerHistoryRef(ownerHistoryId),
    null,
    null,
    `#${relatingObjectId}`,
    relatedObjectIds.map((id) => `#${id}`),
  ]).expressId;
}

/**
 * Join two ports — one length of cable between two devices.
 *
 * Attribute order: IfcRoot (GlobalId, OwnerHistory, Name, Description) +
 * IfcRelConnects — then RelatingPort, RelatedPort, RealizingElement.
 *
 * `RealizingElement` is the cable or carrier that MAKES the connection, and it
 * is optional because it is usually not modelled: a detection line drawn as a
 * click sequence has real connections and no cable objects. Naming the
 * relationship is the cheap alternative — a reader then still learns which run
 * this hop belongs to without a cable being there.
 */
export function emitRelConnectsPorts(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  relatingPortId: number,
  relatedPortId: number,
  options: { name?: string; realizingElementId?: number } = {},
  random?: RandomSource,
): number {
  if (relatingPortId === relatedPortId) {
    // A file can record this, and it means nothing: a port joined to itself is
    // an authoring slip, and drawing it puts a line from a box to the same box.
    throw new Error('emitRelConnectsPorts: a port cannot be connected to itself');
  }
  return editor.addEntity('IfcRelConnectsPorts', [
    generateIfcGuid(random),
    ownerHistoryRef(ownerHistoryId),
    options.name ?? null,
    null,
    `#${relatingPortId}`,
    `#${relatedPortId}`,
    options.realizingElementId != null ? `#${options.realizingElementId}` : null,
  ]).expressId;
}

/**
 * Give one device the pair of ports a pass-through run needs, nested under it.
 *
 * Two, not one: a device in the middle of a line has a cable arriving and a
 * cable leaving, and modelling that as a single port makes the run
 * unorderable — every hop would end at the same place it started.
 *
 * The names are `IN` and `OUT` so a person reading the file can tell them
 * apart, and the two get DIFFERENT directions:
 *
 *  - a device the line passes through is `SOURCEANDSINK` on both ends — it is
 *    neither the origin nor the end of what flows;
 *  - the head of the line is not. Its OUT feeds the run (`SOURCE`) and, on a
 *    ring, its IN takes the return (`SINK`). Marking both ends of a controller
 *    `SOURCE` says the return leg feeds it backwards, which is the one thing
 *    the flow direction exists to get right.
 */
export function addRunPortsToStore(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  deviceId: number,
  options: {
    systemType?: string;
    /** `head` feeds the run; `passThrough` sits on it. Defaults to pass-through. */
    role?: 'head' | 'passThrough';
    schema?: string;
  } = {},
  random?: RandomSource,
): { inPortId: number; outPortId: number; relNestsId: number } {
  const head = options.role === 'head';
  const shared = {
    PredefinedType: 'CABLE' as const,
    SystemType: options.systemType,
  };
  const inPortId = addDistributionPortToStore(
    editor, ownerHistoryId,
    { ...shared, Name: 'IN', FlowDirection: head ? 'SINK' : 'SOURCEANDSINK' },
    options.schema ?? 'IFC4', random,
  ).portId;
  const outPortId = addDistributionPortToStore(
    editor, ownerHistoryId,
    { ...shared, Name: 'OUT', FlowDirection: head ? 'SOURCE' : 'SOURCEANDSINK' },
    options.schema ?? 'IFC4', random,
  ).portId;
  const relNestsId = emitRelNests(editor, ownerHistoryId, deviceId, [inPortId, outPortId], random);
  return { inPortId, outPortId, relNestsId };
}
