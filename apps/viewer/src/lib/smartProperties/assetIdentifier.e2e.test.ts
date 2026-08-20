/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The identifier a device ends up with, over the whole chain.
 *
 * Every other test here covers one link: the rule's segments, the counter's
 * scoping, the resolver's overlay lookups. None of them answers the question
 * that is actually asked of this feature — "what does the number on the third
 * detector read" — and the answer went wrong twice in ways each single-link
 * test was blind to. It read `..._fire.smoke-detector.001` while the catalogue
 * id sat in the Type's `Tag`, and the trade segment was silently absent while
 * the property it reads had no resolver.
 *
 * The building it evaluates is the one strand 1 traces: building `A`, storey
 * `01`, rooms `01`/`02`/`03`, the five products from the demo placement list.
 * When this file and that clip disagree, one of them has drifted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IfcTypeEnum, PropertyValueType } from '@ifc-lite/data';
import {
  MutablePropertyView,
  StoreEditor,
  type MutationEntityRef,
  type MutationStoreShape,
} from '@ifc-lite/mutations';
import { addLibraryElementToStore, addLibraryTypeToStore, emitRelDefinesByType } from '@ifc-lite/create';
import { applySmartPropertyRules } from './applyRules.js';
import { ASSET_IDENTIFIER_RULE } from './defaultRules.js';
import { TRADE_PROPERTY, TRADE_PSET, tradeCodeFor } from '@/lib/catalog/tradeCode.js';
import { LocalSeedCatalogProvider } from '@/lib/catalog/localSeedCatalog.js';

const PROJECT = 10;
const SITE = 20;
const BUILDING = 30;
const STOREY = 43;
const ROOMS = { '01': 61, '02': 62, '03': 63 } as const;

const NAMES: Record<number, string> = {
  [PROJECT]: 'Musterbau',
  [SITE]: 'Gelaende',
  [BUILDING]: 'A',
  [STOREY]: '01',
  [ROOMS['01']]: '01',
  [ROOMS['02']]: '02',
  [ROOMS['03']]: '03',
};

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

const anchor = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 0, storeyId: STOREY, storeyPlacementId: 54 };

function node(expressId: number, type: IfcTypeEnum, children: unknown[] = [], longName?: string) {
  return { expressId, type, name: NAMES[expressId] ?? '', longName, children, elements: [] as number[] };
}

/** The spatial tree strand 1 authors: A / 01 / three rooms. */
function fakeStore() {
  const rooms = Object.values(ROOMS).map((id) => node(id, IfcTypeEnum.IfcSpace));
  const storey = node(STOREY, IfcTypeEnum.IfcBuildingStorey, rooms, '1. Obergeschoss');
  const project = node(PROJECT, IfcTypeEnum.IfcProject, [
    node(SITE, IfcTypeEnum.IfcSite, [node(BUILDING, IfcTypeEnum.IfcBuilding, [storey])]),
  ]);

  return {
    spatialHierarchy: {
      project,
      elementToStorey: new Map<number, number>(),
      elementToContainer: new Map<number, number>(),
      bySpace: new Map<number, number[]>(Object.values(ROOMS).map((id) => [id, []])),
    },
    entities: {
      getName: (id: number) => NAMES[id] ?? '',
      getTypeName: () => '',
      getGlobalId: () => '',
      getDescription: () => '',
      getObjectType: () => '',
      getTag: () => '',
    },
  } as unknown as Parameters<typeof applySmartPropertyRules>[0]['store'];
}

/**
 * The five products strand 1 places, with the room each one lands in.
 *
 * `tag` is the SHORT designation the catalogue carries and the placement puts
 * on the Type — the thing the identifier's product segment is made of.
 */
const PLACEMENTS = [
  { room: '03', ifc: 'IfcSensor', typeIfc: 'IfcSensorType', label: 'Rauchmelder', tag: 'RM', id: 'fire.smoke-detector', predefined: 'SMOKESENSOR' },
  { room: '03', ifc: 'IfcSensor', typeIfc: 'IfcSensorType', label: 'Rauchmelder', tag: 'RM', id: 'fire.smoke-detector', predefined: 'SMOKESENSOR' },
  { room: '02', ifc: 'IfcAlarm', typeIfc: 'IfcAlarmType', label: 'Handfeuermelder', tag: 'HFM', id: 'fire.manual-call-point', predefined: 'MANUALPULL' },
  { room: '01', ifc: 'IfcAlarm', typeIfc: 'IfcAlarmType', label: 'Sirene', tag: 'Si', id: 'fire.siren', predefined: 'SIREN' },
  { room: '02', ifc: 'IfcSensor', typeIfc: 'IfcSensorType', label: 'Waermemelder', tag: 'WM', id: 'fire.heat-detector', predefined: 'HEATSENSOR' },
] as const;

/**
 * Place the five, exactly the way `addLibraryElement` does.
 *
 * The two lines that matter and that a resolver test would never exercise: the
 * short designation goes on the Type's `Tag` (the catalogue id goes on
 * `ElementType`), and the discipline's trade code is attached to the Type as a
 * property, because `IfcTypeProduct` has no attribute that means "which trade".
 */
function placeAll() {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(400), view);
  const store = fakeStore();
  const hierarchy = (store as unknown as {
    spatialHierarchy: { elementToContainer: Map<number, number>; elementToStorey: Map<number, number>; bySpace: Map<number, number[]> };
  }).spatialHierarchy;

  const typeIds = new Map<string, number>();
  const devices: { expressId: number; ifcClass: string }[] = [];

  for (const placement of PLACEMENTS) {
    let typeId = typeIds.get(placement.id);
    if (typeId === undefined) {
      typeId = addLibraryTypeToStore(editor, anchor, {
        IfcEntity: placement.typeIfc,
        Name: placement.label,
        Tag: placement.tag,
        ElementType: placement.id,
        PredefinedType: placement.predefined,
      }).typeId;
      const code = tradeCodeFor('fire');
      assert.ok(code, 'the fire discipline must have a trade code');
      editor.addPropertySet(typeId, TRADE_PSET, [{ name: TRADE_PROPERTY, value: code, type: 'LABEL' }]);
      typeIds.set(placement.id, typeId);
    }

    const elementId = addLibraryElementToStore(editor, anchor, {
      IfcEntity: placement.ifc,
      Position: [0, 0, 0],
      PredefinedType: placement.predefined,
      Name: placement.label,
    }).elementId;
    emitRelDefinesByType(editor, anchor.ownerHistoryId, [elementId], typeId);

    const roomId = ROOMS[placement.room];
    hierarchy.elementToContainer.set(elementId, roomId);
    hierarchy.elementToStorey.set(elementId, STOREY);
    hierarchy.bySpace.get(roomId)!.push(elementId);
    devices.push({ expressId: elementId, ifcClass: placement.ifc });
  }

  return { view, store, devices };
}

/** Evaluate every device in order, writing results the way the app does. */
function identifiers() {
  const { view, store, devices } = placeAll();
  return devices.map(({ expressId, ifcClass }) => {
    const applied = applySmartPropertyRules({
      store,
      view,
      expressId,
      ifcClass,
      rules: [ASSET_IDENTIFIER_RULE],
      // The real writer: a counter has to be readable by the next device in
      // the same room, or every one of them allocates 001.
      write: (pset, property, value, target) => {
        view.setProperty(target ?? expressId, pset, property, value, PropertyValueType.String);
      },
    });
    return applied[0]?.value ?? '';
  });
}

test('AssetIdentifier: the five devices of strand 1 number as Building.Storey.Room_Trade.Type.Instance', () => {
  assert.deepEqual(identifiers(), [
    'A.01.03_FST.RM.001',
    'A.01.03_FST.RM.002',
    'A.01.02_FST.HFM.001',
    'A.01.01_FST.Si.001',
    'A.01.02_FST.WM.001',
  ]);
});

test('AssetIdentifier: the counter restarts per room, not per model', () => {
  // The second detector in room 03 reads 002 and the heat detector in room 02
  // reads 001 even though it is the fifth device placed. That is the whole
  // point of `scopedBy` and the one thing a reader checks by eye.
  const [first, second, , , heat] = identifiers();
  assert.equal(first.endsWith('.001'), true);
  assert.equal(second.endsWith('.002'), true);
  assert.equal(heat, 'A.01.02_FST.WM.001');
});

test('AssetIdentifier: a product with no trade code loses the segment, not the grouping', () => {
  // `intrusion` has no code on purpose. The `_` that introduces the equipment
  // group must survive the segment falling away, or the identifier collapses
  // to one flat dotted chain and the boundary it is built around is gone.
  assert.equal(tradeCodeFor('intrusion'), null);

  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(400), view);
  const store = fakeStore();
  const hierarchy = (store as unknown as {
    spatialHierarchy: { elementToContainer: Map<number, number>; elementToStorey: Map<number, number>; bySpace: Map<number, number[]> };
  }).spatialHierarchy;

  const { typeId } = addLibraryTypeToStore(editor, anchor, {
    IfcEntity: 'IfcSensorType', Name: 'Kontakt', Tag: 'MK', ElementType: 'intrusion.contact', PredefinedType: 'NOTDEFINED',
  });
  const elementId = addLibraryElementToStore(editor, anchor, {
    IfcEntity: 'IfcSensor', Position: [0, 0, 0], PredefinedType: 'NOTDEFINED', Name: 'Kontakt',
  }).elementId;
  emitRelDefinesByType(editor, anchor.ownerHistoryId, [elementId], typeId);
  hierarchy.elementToContainer.set(elementId, ROOMS['01']);
  hierarchy.elementToStorey.set(elementId, STOREY);
  hierarchy.bySpace.get(ROOMS['01'])!.push(elementId);

  const applied = applySmartPropertyRules({
    store, view, expressId: elementId, ifcClass: 'IfcSensor', rules: [ASSET_IDENTIFIER_RULE],
    write: (pset, property, value, target) => {
      view.setProperty(target ?? elementId, pset, property, value, PropertyValueType.String);
    },
  });
  assert.equal(applied[0]?.value, 'A.01.01_MK.001');
});

test('AssetIdentifier: the storey contributes its Name, not its LongName', () => {
  // Both exist on the storey here — `01` and `1. Obergeschoss`. The identifier
  // wants the number; the words belong in a title block. A rule reading
  // LongName would produce `A.1. Obergeschoss.03_…`, which is not a mistake
  // anyone would make twice but is exactly what the split is for.
  for (const value of identifiers()) assert.equal(value.startsWith('A.01.'), true);
});

test('AssetIdentifier: the tags this file numbers with are the ones the catalogue ships', () => {
  // The placement table above is a copy of the catalogue, and a copy drifts.
  // Without this the file would keep proving that `RM` produces `.RM.` long
  // after the catalogue had stopped saying `RM` — which is precisely how the
  // identifier came to read `..._fire.smoke-detector.001` unnoticed.
  const entries = new LocalSeedCatalogProvider().listEntries();
  for (const placement of PLACEMENTS) {
    const entry = entries.find((candidate) => candidate.id === placement.id);
    assert.ok(entry, `the catalogue must still ship ${placement.id}`);
    assert.equal(entry.tag, placement.tag);
    assert.equal(tradeCodeFor(entry.discipline), 'FST');
  }
});
