/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AAS_CONNECTOR_PSET,
  AAS_CONNECTOR_PROPERTY,
  AAS_KIND,
  aasConnectorProperties,
  isOpenableAasAddress,
  readAasLink,
  type ReadablePropertySet,
} from './connectorPset.js';

/** A parser-shaped set (properties in a Map), as read off a loaded file. */
function mapSet(name: string, entries: Record<string, unknown>): ReadablePropertySet {
  return {
    name,
    properties: new Map(Object.entries(entries).map(([k, v]) => [k, { value: v }])),
  };
}

test('a full link round-trips through write and read', () => {
  const link = {
    address: 'https://example.com/aas/smoke-detector',
    kind: AAS_KIND.type,
    fetchDate: '2026-08-22T09:00:00.000Z',
    versionNumber: '1.4',
  } as const;

  const written = aasConnectorProperties(link);
  const set = mapSet(
    AAS_CONNECTOR_PSET,
    Object.fromEntries(written.map((p) => [p.name, p.value])),
  );

  assert.deepEqual(readAasLink([set]), link);
});

test('optional fields are omitted, not written empty', () => {
  const written = aasConnectorProperties({
    address: 'urn:example:asset:1',
    kind: AAS_KIND.instance,
  });

  const names = written.map((p) => p.name);
  assert.deepEqual(names, [AAS_CONNECTOR_PROPERTY.address, AAS_CONNECTOR_PROPERTY.kind]);
});

test('an instance link reads back as an instance link', () => {
  const set = mapSet(AAS_CONNECTOR_PSET, {
    [AAS_CONNECTOR_PROPERTY.address]: 'https://example.com/aas/device/SN-4711',
    [AAS_CONNECTOR_PROPERTY.kind]: AAS_KIND.instance,
  });
  assert.equal(readAasLink([set])?.kind, AAS_KIND.instance);
});

test('a set without an address is not a link', () => {
  // The address is the whole point: the other three properties describe a
  // link, they are not one.
  const set = mapSet(AAS_CONNECTOR_PSET, {
    [AAS_CONNECTOR_PROPERTY.kind]: AAS_KIND.type,
    [AAS_CONNECTOR_PROPERTY.versionNumber]: '2.0',
  });
  assert.equal(readAasLink([set]), null);
});

test('an unknown AASType falls back to Type rather than dropping the address', () => {
  const set = mapSet(AAS_CONNECTOR_PSET, {
    [AAS_CONNECTOR_PROPERTY.address]: 'https://example.com/aas/x',
    [AAS_CONNECTOR_PROPERTY.kind]: 'Produkttyp',
  });
  assert.deepEqual(readAasLink([set]), {
    address: 'https://example.com/aas/x',
    kind: AAS_KIND.type,
  });
});

test('other property sets are ignored', () => {
  const sets = [
    mapSet('Pset_ProductTrade', { TradeCode: 'FST' }),
    mapSet('CustomTechnicalData', { [AAS_CONNECTOR_PROPERTY.address]: 'https://wrong.example' }),
  ];
  assert.equal(readAasLink(sets), null);
});

test('an array-shaped property set reads the same as a Map', () => {
  // `@ifc-lite/data`'s PropertySet — the shape `MutablePropertyView.getForEntity`
  // actually returns, i.e. the one the viewer reads in practice.
  const set: ReadablePropertySet = {
    name: AAS_CONNECTOR_PSET,
    properties: [
      { name: AAS_CONNECTOR_PROPERTY.address, value: 'https://example.com/aas/z' },
      { name: AAS_CONNECTOR_PROPERTY.kind, value: AAS_KIND.instance },
      { name: AAS_CONNECTOR_PROPERTY.versionNumber, value: '3.1' },
    ],
  };
  assert.deepEqual(readAasLink([set]), {
    address: 'https://example.com/aas/z',
    kind: AAS_KIND.instance,
    versionNumber: '3.1',
  });
});

test('a plain-object property bag reads the same as a Map', () => {
  const set: ReadablePropertySet = {
    name: AAS_CONNECTOR_PSET,
    properties: {
      [AAS_CONNECTOR_PROPERTY.address]: 'https://example.com/aas/y',
      [AAS_CONNECTOR_PROPERTY.kind]: AAS_KIND.type,
    },
  };
  assert.equal(readAasLink([set])?.address, 'https://example.com/aas/y');
});

test('blank values count as absent', () => {
  const set = mapSet(AAS_CONNECTOR_PSET, {
    [AAS_CONNECTOR_PROPERTY.address]: '   ',
    [AAS_CONNECTOR_PROPERTY.kind]: AAS_KIND.type,
  });
  assert.equal(readAasLink([set]), null);
});

test('only http(s) addresses are offered as openable', () => {
  assert.equal(isOpenableAasAddress('https://example.com/aas/1'), true);
  assert.equal(isOpenableAasAddress('http://localhost:5001/shells/1'), true);
  // An IRI-shaped identifier that is not an endpoint, and a bare id.
  assert.equal(isOpenableAasAddress('urn:example:asset:1'), false);
  assert.equal(isOpenableAasAddress('SN-4711'), false);
  assert.equal(isOpenableAasAddress(''), false);
  // Not a scheme we would hand to `window.open`.
  assert.equal(isOpenableAasAddress('javascript:alert(1)'), false);
});
