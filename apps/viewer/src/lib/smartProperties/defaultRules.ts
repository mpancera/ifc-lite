/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Rules shipped as a starting point. Generic on purpose — an asset identifier
 * assembled from the spatial structure is common practice, not anyone's
 * proprietary scheme.
 */

import { TRADE_PROPERTY, TRADE_PSET } from '@/lib/catalog/tradeCode';
import type { SmartPropertyRule } from './types';

/**
 * `Building.Storey.Room_Trade.Type.Instance`, e.g. `A.01.03_FST.RM.001`.
 *
 * Notes on the source choices, which are not arbitrary:
 *
 * - The room contributes `Name`, not `LongName`: by convention `IfcSpace.Name`
 *   carries the room NUMBER and `LongName` the (often long) room description.
 *   An identifier wants the number.
 * - The trade segment reads a PROPERTY of the type rather than an attribute:
 *   no attribute on `IfcTypeProduct` means "which trade", and borrowing one
 *   that means something else would make the file lie to every other reader.
 * - The product segment prefers the type's `Tag` — the short designation, `RM`
 *   — and falls back to the element's own `Name`, so an element placed without
 *   a shared type still yields something recognisable instead of a hole.
 * - Building and storey warn rather than omit: an element with no storey is a
 *   modelling problem worth surfacing, not a shorter identifier.
 * - The room omits: a device in a corridor legitimately has no room, and the
 *   separator in front of it disappears with it.
 */
export const ASSET_IDENTIFIER_RULE: SmartPropertyRule = {
  id: 'asset-identifier',
  name: 'Asset-Identifier',
  applicability: ['IfcSensor', 'IfcAlarm', 'IfcAudioVisualAppliance'],
  target: {
    // buildingSMART publishes this pset with a single "r" — spelling it
    // correctly misses the standard set entirely.
    pset: 'Pset_ConstructionOccurence',
    property: 'AssetIdentifier',
  },
  segments: [
    {
      source: { scope: 'IfcBuilding', field: 'Name' },
      fallback: { kind: 'warn' },
    },
    {
      separator: '.',
      source: { scope: 'IfcBuildingStorey', field: 'Name' },
      fallback: { kind: 'warn' },
    },
    {
      separator: '.',
      source: { scope: 'IfcSpace', field: 'Name' },
      fallback: { kind: 'omit' },
    },
    {
      // The trade, from the product's own discipline. Omitted where no code is
      // established for it — a shorter identifier beats an invented segment in
      // something that gets quoted in submissions and read over the phone.
      separator: '_',
      // The `_` outlives the trade: it marks where the location stops, and
      // that boundary is there whether or not the trade has a code.
      handOnSeparator: true,
      source: { scope: 'IfcEntityType', field: TRADE_PROPERTY, pset: TRADE_PSET },
      fallback: { kind: 'omit' },
    },
    {
      separator: '.',
      source: { scope: 'IfcEntityType', field: 'Tag' },
      fallback: { kind: 'alternative', separator: '.', source: { scope: 'IfcEntity', field: 'Name' } },
    },
    {
      separator: '.',
      source: { scope: 'IfcEntity', field: 'Tag' },
      fallback: { kind: 'omit' },
    },
    {
      // Distinguishes the second detector of the same product in the same room.
      // Allocated once and then frozen — see counter.ts for why renumbering is
      // the one thing this must never do.
      separator: '.',
      source: { kind: 'counter', width: 3, scopedBy: ['IfcSpace', 'IfcEntityType'] },
      fallback: { kind: 'omit' },
    },
  ],
};

export const DEFAULT_SMART_PROPERTY_RULES: readonly SmartPropertyRule[] = [
  ASSET_IDENTIFIER_RULE,
];
