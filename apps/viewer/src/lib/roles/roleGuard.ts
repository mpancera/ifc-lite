/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a discipline role is allowed to change.
 *
 * A trade planner adds to the reference model: devices, systems, the data that
 * hangs off them. They do not redraw the architect's walls. Encoding that as a
 * rule rather than a convention means an accidental edit is refused at the
 * moment it happens, instead of surfacing later as an unexplained difference in
 * a model somebody else owns.
 *
 * The Standard role deliberately keeps full access. Correcting the reference
 * model IS sometimes the job — unmaintained room numbers, a wrong classification
 * — and that work needs a mode you choose on purpose rather than one you fall
 * into while placing detectors.
 */

import { STANDARD_ROLE_ID } from './disciplineRoles';

export type EditPermission =
  | { allowed: true }
  | { allowed: false; reason: string };

const ALLOWED: EditPermission = { allowed: true };

export interface EditRequest {
  /** Active discipline system id, or `STANDARD_ROLE_ID`. */
  activeSystemId: string;
  /** Was this entity created in this session? */
  isAuthored: boolean;
  /** Role label for the message, e.g. "Fire · Branddetektion". */
  roleLabel?: string;
}

/**
 * Whether the active role may change this entity.
 *
 * Anything authored here is ours to change under any role — the restriction is
 * about the reference model, not about being in a role at all.
 */
export function mayEditEntity(request: EditRequest): EditPermission {
  if (request.activeSystemId === STANDARD_ROLE_ID) return ALLOWED;
  if (request.isAuthored) return ALLOWED;

  const role = request.roleLabel ? `Fachrolle „${request.roleLabel}"` : 'einer Fachrolle';
  return {
    allowed: false,
    reason: `In ${role} sind nur Ergänzungen möglich. Dieses Bauteil stammt aus dem Referenzmodell — zum Korrigieren auf die Rolle „Standard" wechseln.`,
  };
}
