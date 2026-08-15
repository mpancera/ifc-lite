/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What can be decided about a group of proxies, and what writing it means.
 *
 * Kept apart from the grouping so that the rule "one decision covers every
 * member" is stated once, in one function, instead of being re-implemented by
 * whichever surface happens to be applying it.
 *
 * # Three answers, not two
 * A proxy is not always a mistake. "Es kann und darf Proxy Elemente geben —
 * das bestimmt der Autor und muss dies auf eine geeignete Art angeben können,
 * ohne dabei UI oder 2D/3D View unnötig zu belasten" (Marc, 2026-08-13). So
 * `keep` is a real decision and not a refusal to decide, and it is written
 * into the model the way IFC provides for exactly this: `PredefinedType`
 * becomes `USERDEFINED` and `ObjectType` carries the author's own word for the
 * thing. That is a value in the file — it burdens no view and no panel, and
 * the next reader of the model sees a deliberate proxy rather than a lazy one.
 *
 * `ObjectType` is the load-bearing half. IFC2X3 gives
 * `IfcBuildingElementProxy` a `CompositionType` where IFC4 gives it a
 * `PredefinedType`, so the enum has nowhere to go in an IFC2X3 file — the
 * exporter maps attributes BY NAME against the target class's layout for the
 * file's own schema, finds no `PredefinedType`, and writes none. Nothing lands
 * in the wrong slot, and the declaration survives either way because
 * `IfcObject.ObjectType` exists in both.
 *
 * # Property sets are left alone
 * Retyping an element to `IfcLightFixture` does not give it the properties a
 * light fixture should have, and inventing them would be worse than not having
 * them. "Die Psets würde ich vorerst nicht verändern — höchstens eine Meldung"
 * (Marc, 2026-08-13). {@link psetNotice} is that message.
 */

import type { ProxyGroup } from './proxyGroups.js';

/** A group is either reclassified, deliberately left a proxy, or not yet decided. */
export type ProxyDecision =
  | {
    readonly kind: 'reclassify';
    /** Target IFC class, e.g. `IfcLightFixture`. */
    readonly entity: string;
    readonly predefinedType: string | null;
    /** Only meaningful where `predefinedType` is `USERDEFINED`. */
    readonly objectType: string | null;
  }
  | {
    /**
     * The class stays as it is, deliberately, and `ObjectType` says what the
     * thing actually is.
     *
     * Carries its own `entity` because both triages use it and they keep
     * different things: the proxy triage keeps `IfcBuildingElementProxy`, the
     * class triage keeps whatever junction the group is already on
     * (`IfcFlowTerminal`, …). Carrying it also means the decision states the
     * full outcome rather than leaving the reader to infer it.
     */
    readonly kind: 'keep';
    readonly entity: string;
    /**
     * `USERDEFINED` where the class HAS a `PredefinedType` — that is the
     * IFC-sanctioned way to say "the author's own kind". `null` where the
     * class has none at all, which is true of every Zwischenklasse: claiming
     * an attribute the class does not have would be a statement about nothing.
     */
    readonly predefinedType: string | null;
    /** The author's own word for what this is, e.g. `Kabelkanal`. */
    readonly objectType: string;
  }
  | { readonly kind: 'undecided' };

/** The class a deliberate proxy keeps. */
export const PROXY_ENTITY = 'IfcBuildingElementProxy';

/** One write, as {@link ProxyDecision} means it for one element. */
export interface ProxyWrite {
  readonly expressId: number;
  readonly entity: string;
  readonly predefinedType: string | null;
  /** `null` leaves `ObjectType` as it is; a string sets it. */
  readonly objectType: string | null;
}

/**
 * Reject a target that cannot be an occurrence.
 *
 * The catalogue lists classes an element may BE. A `…Type` class is not one of
 * those — it is what an element is defined BY — and retyping an occurrence
 * into it would produce a file no reader can make sense of.
 */
export function isOccurrenceClass(entity: string): boolean {
  const name = entity.trim();
  if (!/^Ifc[A-Za-z0-9]+$/.test(name)) return false;
  return !/Type$/.test(name);
}

/**
 * The writes a decision implies for a group.
 *
 * Every member, always: that is what deciding once is FOR. An undecided group
 * writes nothing.
 */
export function proxyWrites(
  group: ProxyGroup,
  decision: ProxyDecision,
): ProxyWrite[] {
  if (decision.kind === 'undecided') return [];

  if (decision.kind === 'keep') {
    const objectType = decision.objectType.trim();
    if (!objectType) return [];
    if (!isOccurrenceClass(decision.entity)) return [];
    return group.members.map((expressId) => ({
      expressId,
      entity: decision.entity,
      predefinedType: decision.predefinedType,
      objectType,
    }));
  }

  if (!isOccurrenceClass(decision.entity)) return [];
  // ObjectType is only carried where the predefined type asks for it; setting
  // it beside a real enum value would leave two answers in the file.
  const objectType = decision.predefinedType === 'USERDEFINED'
    ? decision.objectType?.trim() || null
    : null;
  return group.members.map((expressId) => ({
    expressId,
    entity: decision.entity,
    predefinedType: decision.predefinedType,
    objectType,
  }));
}

/** `32 Elemente werden zu IfcLightFixture.POINTSOURCE.` */
export function describeDecision(
  group: ProxyGroup,
  decision: ProxyDecision,
): string {
  const count = group.members.length;
  const elements = `${count} ${count === 1 ? 'Element' : 'Elemente'}`;
  switch (decision.kind) {
    case 'undecided':
      return `${elements} — noch nicht entschieden`;
    case 'keep':
      return decision.entity === PROXY_ENTITY
        ? `${elements} bleiben bewusst Proxy: ${decision.objectType.trim()}`
        : `${elements} bleiben bewusst ${decision.entity}: ${decision.objectType.trim()}`;
    case 'reclassify': {
      const target = decision.predefinedType
        ? `${decision.entity}.${decision.predefinedType}`
        : decision.entity;
      return `${elements} werden zu ${target}`;
    }
  }
}

/**
 * The one message that goes with a reclassification.
 *
 * Deliberately does not name a property set. The occurrence set is
 * `Pset_<Class>Common` for some classes and not for others, and guessing wrong
 * would send somebody looking for a set that does not exist.
 */
export function psetNotice(decision: ProxyDecision): string | null {
  if (decision.kind !== 'reclassify') return null;
  return `Die Merkmale bleiben unverändert. ${decision.entity} bringt eigene `
    + 'Merkmalsgruppen mit, die hier nicht angelegt werden.';
}

/** Groups still open, for a panel that wants to say how far along this is. */
export function countUndecided(
  groups: readonly ProxyGroup[],
  decisions: ReadonlyMap<string, ProxyDecision>,
): number {
  return groups.filter(
    (group) => (decisions.get(group.key)?.kind ?? 'undecided') === 'undecided',
  ).length;
}
