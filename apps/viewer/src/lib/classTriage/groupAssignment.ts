/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Giving a triage group the system and the type it is missing.
 *
 * The triage already groups elements by what the author DID say — the system,
 * the type, the description. Marc's question (2026-08-15) turns that around:
 * where a good grouping came out of the OTHER attributes, and the system or
 * the type is simply absent, could the triage supply it? It can, and the group
 * is already the right unit for it: decided once, written to every member.
 *
 * # Order matters, so it is stated here rather than left to a caller
 * The type of a wall is an `IfcWallType`. Creating one before the class is
 * settled would make an `IfcDistributionElementType` for elements that are
 * about to become pipe segments — a type nobody wants, permanently in the
 * file. So a reclassification is written FIRST and the type is derived from
 * the class the elements now have. {@link assignmentOrder} is that rule.
 *
 * # A system is not a type and they are not interchangeable
 * `IfcRelAssignsToGroup` says which installation an element belongs to;
 * `IfcRelDefinesByType` says what product it is. An element can want either,
 * both or neither, so they are two separate decisions and not one control with
 * a mode.
 */

import { isKnownType, normalizeIfcTypeName } from '@ifc-lite/parser';

/** Either an entity that already exists, or one to be created by name. */
export type AssignmentChoice =
  | { readonly kind: 'existing'; readonly expressId: number; readonly name: string }
  | { readonly kind: 'new'; readonly name: string };

export interface GroupAssignment {
  /** `null` leaves the members' system membership untouched. */
  readonly system: AssignmentChoice | null;
  /** `null` leaves the members' type untouched. */
  readonly type: AssignmentChoice | null;
}

export const NO_ASSIGNMENT: GroupAssignment = { system: null, type: null };

/**
 * The `IfcXxxType` class that defines an occurrence of `entity`.
 *
 * `null` where the schema has no such class — `IfcAnnotation` has none, and
 * neither does every branch of the tree. Checked against the parser's registry
 * rather than by string surgery alone, because that registry is what
 * `StoreEditor.addEntity` validates against: proposing a class it would reject
 * gives the user a button that silently does nothing.
 */
export function typeClassFor(entity: string): string | null {
  const trimmed = entity.trim();
  if (!/^Ifc[A-Za-z0-9]+$/.test(trimmed) || trimmed.endsWith('Type')) return null;
  const candidate = `${trimmed}Type`;
  return isKnownType(candidate) ? normalizeIfcTypeName(candidate) : null;
}

/**
 * What a group's writes must happen in, given what was decided.
 *
 * Returned as a list rather than enforced by call order, so the panel can show
 * it and a test can pin it. `retype` is absent when the class is being left
 * alone, which is the normal case for a group that only lacks a system.
 */
export type AssignmentStep = 'retype' | 'system' | 'type';

export function assignmentOrder(
  reclassifies: boolean,
  assignment: GroupAssignment,
): AssignmentStep[] {
  const steps: AssignmentStep[] = [];
  if (reclassifies) steps.push('retype');
  if (assignment.system) steps.push('system');
  // After `retype` on purpose: the type class is derived from the class the
  // elements have once the retype has landed.
  if (assignment.type) steps.push('type');
  return steps;
}

/** `System „Starkstrom" (neu), Typ „Motor M1"` — what the row will do. */
export function describeAssignment(assignment: GroupAssignment): string {
  const parts: string[] = [];
  if (assignment.system) {
    parts.push(`System „${assignment.system.name}"`
      + (assignment.system.kind === 'new' ? ' (neu)' : ''));
  }
  if (assignment.type) {
    parts.push(`Typ „${assignment.type.name}"`
      + (assignment.type.kind === 'new' ? ' (neu)' : ''));
  }
  return parts.join(', ');
}

/**
 * Why an assignment cannot be written yet, or `null` when it can.
 *
 * The one real obstacle is a type for a class that has none. Saying so beats
 * writing nothing and reporting success — which is what a silent
 * `addEntity` rejection would look like from the outside.
 */
export function assignmentBlocker(
  entity: string,
  assignment: GroupAssignment,
): string | null {
  if (assignment.type && typeClassFor(entity) === null) {
    return `${entity} hat keine Typ-Klasse im Schema — hier lässt sich kein Typ zuweisen.`;
  }
  if (assignment.system?.kind === 'new' && assignment.system.name.trim().length === 0) {
    return 'Ein neues System braucht einen Namen.';
  }
  if (assignment.type?.kind === 'new' && assignment.type.name.trim().length === 0) {
    return 'Ein neuer Typ braucht einen Namen.';
  }
  return null;
}
