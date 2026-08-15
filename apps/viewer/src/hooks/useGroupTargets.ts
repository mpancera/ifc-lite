/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The systems and types a triage group could be assigned to.
 *
 * Offering what the model already has, before offering to make something new,
 * is the whole point: a model with an `IfcSystem` called "Starkstrom" should
 * not end up with a second one called "Starkstrom" because the triage only
 * knew how to create.
 *
 * Reads BOTH the file and the session's overlay, for the same reason the
 * annotation replace does: a system created a minute ago lives only in the
 * overlay, and a picker that could not see it would offer to create it again.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import { typeClassFor } from '@/lib/classTriage/groupAssignment';
import { useViewerStore } from '@/store';

export interface GroupTarget {
  readonly expressId: number;
  readonly name: string;
  /** The IFC class it is, so a picker can show what it is offering. */
  readonly ifcClass: string;
}

/** `Name` is index 2 for every `IfcRoot`. */
const NAME_INDEX = 2;

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  return s === '$' || s === '*' ? '' : s;
}

function collect(
  store: IfcDataStore | null | undefined,
  overlay: { getNewEntities(): Array<{ expressId: number; type: string; attributes: unknown[] }> } | undefined,
  matches: (ifcClass: string) => boolean,
): GroupTarget[] {
  const out: GroupTarget[] = [];
  const seen = new Set<number>();

  for (const [storageType, ids] of store?.entityIndex?.byType ?? []) {
    const canonical = store?.entities?.getTypeName(ids[0]);
    const ifcClass = canonical && canonical !== 'Unknown' ? canonical : storageType;
    if (!matches(ifcClass)) continue;
    for (const expressId of ids) {
      const name = text(store?.getEntity?.(expressId)?.attributes?.[NAME_INDEX]);
      if (!name) continue;
      seen.add(expressId);
      out.push({ expressId, name, ifcClass });
    }
  }

  for (const entity of overlay?.getNewEntities?.() ?? []) {
    if (seen.has(entity.expressId) || !matches(entity.type)) continue;
    const name = text(entity.attributes?.[NAME_INDEX]);
    if (!name) continue;
    out.push({ expressId: entity.expressId, name, ifcClass: entity.type });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface GroupTargets {
  readonly systems: readonly GroupTarget[];
  /** Types of the class that fits `entity`, or empty where it has none. */
  readonly types: readonly GroupTarget[];
  /** The type class those would be, for the "create new" label. `null` = none. */
  readonly typeClass: string | null;
}

/**
 * @param entity The class the group's members will have when the writes land —
 *   which is the class a type must match, so the caller passes the DECIDED
 *   class rather than the current one.
 */
export function useGroupTargets(enabled: boolean, entity: string | null): GroupTargets {
  const models = useViewerStore((state) => state.models);
  const activeModelId = useViewerStore((state) => state.activeModelId);
  const mutationViews = useViewerStore((state) => state.mutationViews);
  const mutationVersion = useViewerStore((state) => state.mutationVersion);

  return useMemo(() => {
    const typeClass = entity ? typeClassFor(entity) : null;
    if (!enabled) return { systems: [], types: [], typeClass };

    const model = (activeModelId ? models.get(activeModelId) : null) ?? [...models.values()][0];
    const store = model?.ifcDataStore;
    const overlay = model ? mutationViews.get(model.id) : undefined;

    // Every flavour of system, because a file may carry any of them and the
    // question "which installation is this" is the same in all three.
    const systems = collect(store, overlay, (c) => (
      c === 'IfcSystem' || c === 'IfcDistributionSystem' || c === 'IfcBuildingSystem'
    ));
    const types = typeClass ? collect(store, overlay, (c) => c === typeClass) : [];
    return { systems, types, typeClass };
  }, [enabled, entity, models, activeModelId, mutationViews, mutationVersion]);
}
