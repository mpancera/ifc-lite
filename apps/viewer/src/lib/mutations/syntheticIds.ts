/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Express ids that stand for nothing in the model.
 *
 * Several overlays put meshes in the scene that are not building elements: the
 * space-sketch ghosts while a room is being drawn, the SpatialGraph diagram.
 * They need ids, because the renderer keys everything by express id, and those
 * ids must be recognisable as not-model — otherwise every pass that walks the
 * SCENE and writes what it finds into the FILE writes them too.
 *
 * That is not hypothetical. A diagram left switched on while the compartment
 * boxes were assigned put seventy-six ids into an
 * `IfcRelReferencedInSpatialStructure` in an exported file, where they resolve
 * to nothing at all. Before the diagram had synthetic ids it was worse and
 * invisible: it carried the express ids of real rooms and doors, so the same
 * pass quietly added real elements to a relationship nobody asked to touch.
 *
 * One base for all of them, high above any real express id. Anything at or
 * above it is scene decoration.
 */

/** The first synthetic express id. Everything from here up is not model content. */
export const SYNTHETIC_ID_BASE = 0x70000000;

/** Whether an express id belongs to an overlay's decoration rather than the model. */
export function isSyntheticId(expressId: number): boolean {
  return expressId >= SYNTHETIC_ID_BASE;
}
