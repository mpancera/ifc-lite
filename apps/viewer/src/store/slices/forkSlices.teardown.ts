/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Teardowns for the fork slices that hold model-derived ids (expressIds, a
 * target model, a plan point). A new file, a removed model or a cleared
 * federation must not leave a wiring run, a graph highlight or an add-element
 * target pointing into geometry that is gone. Panel flags and project-scoped
 * state are exempt instead (see `teardown-exemptions.ts`).
 */

import { defineSliceTeardown } from '../teardown.js';

export const addElementTeardown = defineSliceTeardown('addElementSlice', ['addElementModelId', 'addElementStoreyId'], {
  'session-reset': () => ({ addElementModelId: null, addElementStoreyId: null }),
  'model-removed': (scope, state) => (state.addElementModelId === scope.modelId
    ? { addElementModelId: null, addElementStoreyId: null }
    : {}),
  'all-models-cleared': () => ({ addElementModelId: null, addElementStoreyId: null }),
});

const clearEscapeRoute = () => ({ escapeRouteStart: null, escapeRouteFailure: null });
export const escapeRoutesTeardown = defineSliceTeardown('escapeRoutesSlice', ['escapeRouteStart', 'escapeRouteFailure'], {
  'session-reset': clearEscapeRoute,
  'model-removed': clearEscapeRoute,
  'all-models-cleared': clearEscapeRoute,
});

const clearGraph = () => ({ graphHighlight: null, graphStartSystems: [] as number[] });
export const graphTeardown = defineSliceTeardown('graphSlice', ['graphHighlight', 'graphStartSystems'], {
  'session-reset': clearGraph,
  'model-removed': clearGraph,
  'all-models-cleared': clearGraph,
});

const clearDoorNumbers = () => ({ doorNumberRoom: new Map<number, number>() as ReadonlyMap<number, number> });
export const triageTeardown = defineSliceTeardown('triageSlice', ['doorNumberRoom'], {
  'session-reset': clearDoorNumbers,
  'model-removed': clearDoorNumbers,
  'all-models-cleared': clearDoorNumbers,
});

const clearWiring = () => ({ wiringSequence: [] as number[], wiringHover: null });
export const wiringTeardown = defineSliceTeardown('wiringSlice', ['wiringSequence', 'wiringHover'], {
  'session-reset': clearWiring,
  'model-removed': clearWiring,
  'all-models-cleared': clearWiring,
});

const clearZoneBrush = () => ({ activeIfcZoneKey: null, ifcZoneBrushActive: false });
export const ifcZonesTeardown = defineSliceTeardown('ifcZonesSlice', ['activeIfcZoneKey', 'ifcZoneBrushActive'], {
  'session-reset': clearZoneBrush,
  'model-removed': clearZoneBrush,
  'all-models-cleared': clearZoneBrush,
});
