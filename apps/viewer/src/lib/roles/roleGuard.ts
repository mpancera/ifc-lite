/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What the active role is allowed to change.
 *
 * Three levels, widening:
 *
 *   - **Viewer** — nothing. The default, because most people who open a model
 *     only look at it. Opening a file cannot damage it, and there is no state
 *     you can be in by accident where it could.
 *   - **A discipline role** — additions only. A trade planner adds to the
 *     reference model: devices, systems, the data that hangs off them. They do
 *     not redraw the architect's walls.
 *   - **Editor** — everything, including the reference model. Correcting it IS
 *     sometimes the job.
 *
 * Encoding this as a rule rather than a convention means an accidental edit is
 * refused at the moment it happens, instead of surfacing later as an
 * unexplained difference in a model somebody else owns.
 */

import { EDITOR_ROLE_ID, VIEWER_ROLE_ID } from './disciplineRoles';

export type EditPermission =
  | { allowed: true }
  | { allowed: false; reason: string };

const ALLOWED: EditPermission = { allowed: true };

/** Shared by both guards, so read-only is refused with one wording. */
const VIEWER_DENIAL: EditPermission = {
  allowed: false,
  reason: 'Die Rolle „Viewer" ist schreibgeschützt. Zum Ergänzen eine Fachrolle wählen, '
    + 'zum Korrigieren des Referenzmodells die Rolle „Editor".',
};

export interface EditRequest {
  /** Active role id: `VIEWER_ROLE_ID`, `EDITOR_ROLE_ID`, or a system id. */
  activeSystemId: string;
  /** Was this entity created in this session? */
  isAuthored: boolean;
  /** Role label for the message, e.g. "Fire · Branddetektion". */
  roleLabel?: string;
}

/**
 * Whether the active role may change an entity that already exists.
 *
 * Under a discipline role, anything authored here is ours to change — the
 * restriction is about the reference model, not about being in a role at all.
 * Under Viewer even that is refused: a Viewer has nothing of their own, and
 * making an exception would mean read-only silently stopped being read-only the
 * moment a snapshot restored someone else's session.
 */
export function mayEditEntity(request: EditRequest): EditPermission {
  if (request.activeSystemId === VIEWER_ROLE_ID) return VIEWER_DENIAL;
  if (request.activeSystemId === EDITOR_ROLE_ID) return ALLOWED;
  if (request.isAuthored) return ALLOWED;

  const role = request.roleLabel ? `Fachrolle „${request.roleLabel}"` : 'einer Fachrolle';
  return {
    allowed: false,
    reason: `In ${role} sind nur Ergänzungen möglich. Dieses Bauteil stammt aus dem Referenzmodell — zum Korrigieren auf die Rolle „Editor" wechseln.`,
  };
}

/**
 * Whether the active role may create entities at all.
 *
 * Separate from `mayEditEntity` because creation has no entity to ask about
 * yet: a new element is authored by definition, so routing it through the
 * entity guard would answer "allowed" for every role. Only Viewer is refused —
 * adding is precisely what a discipline role is for.
 */
export function mayCreateEntities(activeSystemId: string): EditPermission {
  return activeSystemId === VIEWER_ROLE_ID ? VIEWER_DENIAL : ALLOWED;
}
