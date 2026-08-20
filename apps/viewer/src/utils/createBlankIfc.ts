/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Generate a minimal blank IFC4 model as a synthetic `File`, so the
 * welcome card's "Start blank" action can feed it through the regular
 * `loadFile()` pipeline (format detection → WASM → store federation)
 * without diverging code paths.
 *
 * The result has the smallest spatial hierarchy that satisfies the
 * Add Element panel's gating (`AddElementPanel.tsx`): one IfcProject,
 * IfcSite, IfcBuilding and a single IfcBuildingStorey at elevation 0.
 */

import { IfcCreator } from '@ifc-lite/create';

export interface BlankIfcOptions {
  projectName?: string;
  /** The building's name — the first segment of an asset identifier. */
  buildingName?: string;
  /** By convention the storey NUMBER: `01`, `EG`. */
  storeyName?: string;
  /** The readable designation: `1. Obergeschoss`. */
  storeyLongName?: string;
  storeyElevation?: number;
}

export function createBlankIfcFile(options: BlankIfcOptions = {}): File {
  const {
    projectName = 'Untitled Project',
    buildingName,
    storeyName = 'Level 1',
    storeyLongName,
    storeyElevation = 0,
  } = options;

  const creator = new IfcCreator({ Name: projectName, BuildingName: buildingName });
  creator.addIfcBuildingStorey({
    Name: storeyName,
    LongName: storeyLongName,
    Elevation: storeyElevation,
  });
  const { content } = creator.toIfc();

  const safeName = projectName.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'untitled';
  return new File([content], `${safeName}.ifc`, { type: 'application/ifc' });
}
