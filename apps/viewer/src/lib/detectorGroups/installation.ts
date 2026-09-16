/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What an alarm installation currently consists of: its trigger zones and the
 * Meldergruppen built from them.
 *
 * One reader, because the panel and the action reading this differently is a
 * defect that has now happened twice, in the same shape both times.
 *
 * The first time, `buildDetectorCircuits` looked only at the running session
 * and reported "keine Auslösezone gefunden" on a model that visibly had
 * eighteen of them — its own comment records the fix. The panel beside it was
 * left reading the session alone, so after Marc exported his work and opened
 * the result, the zones were in the file, the groups were in the file, the
 * devices were in the file, and the panel said the model had no trigger zone
 * at all (2026-09-16).
 *
 * A session and a file are two halves of one answer. Anything that asks "what
 * is in this installation" has to ask both, and now there is one place that
 * does.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { RelationshipType } from '@ifc-lite/data';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import { authoredEntities } from '@/lib/mutations/authoredEntities';
import { parsedZonesOf, readZones, readZonesForDisplay, type ZoneInfo } from '@/lib/ifcZones/membership';
import { themeOfZone } from '@/lib/ifcZones/themes';
import {
  CIRCUIT_OBJECT_TYPE, mergeOwnCircuits, parsedCircuitsOf, readCircuits, type CircuitInfo,
} from './circuits';

export interface InstallationState {
  /** Trigger zones of the asked-for theme, from the file and the session. */
  zones: ZoneInfo[];
  /** Meldergruppen this tool owns. Not Melderkreise — see `readCircuits`. */
  circuits: CircuitInfo[];
}

/**
 * Read one installation's zones and groups.
 *
 * `theme` is `fire-trigger` or `gas-trigger`: a room is in ONE fire compartment
 * and ONE Auslösezone, and reading both themes at once would put every
 * detector in two groups.
 *
 * WRITING stays restricted to the session — a zone that came in with the file
 * is somebody else's. Only reading is widened, which is the same line
 * `readZonesForDisplay` draws.
 */
export function readInstallation(
  dataStore: IfcDataStore | null | undefined,
  view: MutablePropertyView | undefined,
  theme: string,
): InstallationState {
  const entities = view ? authoredEntities(view) : [];

  const zones = dataStore
    ? readZonesForDisplay(
      parsedZonesOf(dataStore, RelationshipType.AssignsToGroup),
      readZones(entities),
    )
    : readZones(entities);

  const circuits = dataStore
    ? mergeOwnCircuits(
      parsedCircuitsOf(
        dataStore, RelationshipType.AssignsToGroup, CIRCUIT_OBJECT_TYPE, 'IFCGROUP',
      ),
      readCircuits(entities, CIRCUIT_OBJECT_TYPE),
    )
    : readCircuits(entities, CIRCUIT_OBJECT_TYPE);

  return {
    zones: zones.filter((zone) => themeOfZone(zone.objectType)?.id === theme),
    circuits,
  };
}
