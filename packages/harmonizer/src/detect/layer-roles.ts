/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Suggesting what a layer is for.
 *
 * Offices name their layers `A-WALL`, `WAND`, `01_Waende_tragend`, `MUR_EXT`;
 * no list covers them all. So this suggests and never decides: the name gives
 * a hint, the counts give the evidence (a wall layer has many segments and
 * few texts, a label layer the reverse), and the person picks. An empty
 * selection means an empty result, not "everything".
 *
 * Every suggestion carries a `reasonCode` next to its English `reason`, so a
 * host can say in its own language why the layer was taken for what it was.
 */

import type { DxfLayerStats } from './dxf-quality.js';

export type LayerRole = 'wall' | 'text' | 'outline' | 'exclude' | 'unknown';

/** Why a role was suggested; stable, for translation and for the protocol. */
export type LayerReasonCode =
  | 'name-exclude'
  | 'hatch-count'
  | 'name-outline'
  | 'text-count'
  | 'name-text'
  | 'name-wall'
  | 'segment-count'
  | 'inconclusive';

export interface LayerRoleSuggestion {
  layer: string;
  role: LayerRole;
  /** Why, in words a reviewer can check against the counts. */
  reason: string;
  reasonCode: LayerReasonCode;
  /** The counts the reason cites, for a host that renders the reason itself. */
  reasonData: { segments: number; texts: number; hatches: number; closedPolylines: number };
}

const WALL_NAMES = /wall|wand|waende|wände|\bmur|muro|parete|grundriss|arch|struct|tragend/i;
const OUTLINE_NAMES = /polygon|room|raum|raeume|räume|space|zone|flaech|fläch|area/i;
const TEXT_NAMES = /text|label|beschrift|annot|name|nummer|number/i;
const EXCLUDE_NAMES =
  /hatch|schraff|\bdim|bemass|bemaß|\bmass\b|furn|moeb|möb|equip|nordpfeil|north|legend|frame|rahmen|title|titel|unwanted|defpoints|grid|raster|achse|axis/i;

export function suggestLayerRoles(layers: readonly DxfLayerStats[]): LayerRoleSuggestion[] {
  return layers.map((l) => suggest(l));
}

function suggest(l: DxfLayerStats): LayerRoleSuggestion {
  const name = l.name;
  const reasonData = { segments: l.segments, texts: l.texts, hatches: l.hatches, closedPolylines: l.closedPolylines };
  const make = (role: LayerRole, reasonCode: LayerReasonCode, reason: string): LayerRoleSuggestion => ({ layer: name, role, reason, reasonCode, reasonData });

  if (EXCLUDE_NAMES.test(name)) {
    return make('exclude', 'name-exclude', 'name marks it as hatching, dimensions, furniture or sheet furniture');
  }
  if (l.hatches > 0 && l.hatches >= l.segments) {
    return make('exclude', 'hatch-count', `${l.hatches} hatches and only ${l.segments} segments`);
  }
  if (OUTLINE_NAMES.test(name) && l.closedPolylines > 0) {
    return make('outline', 'name-outline', `name suggests room outlines and ${l.closedPolylines} closed polylines`);
  }
  if (l.texts > 0 && l.texts >= l.segments) {
    return make('text', 'text-count', `${l.texts} texts against ${l.segments} segments`);
  }
  if (TEXT_NAMES.test(name) && l.texts > 0) {
    return make('text', 'name-text', `name suggests labels and ${l.texts} texts`);
  }
  if (WALL_NAMES.test(name) && l.segments > 0) {
    return make('wall', 'name-wall', `name suggests walls and ${l.segments} segments`);
  }
  if (l.segments >= 100 && l.texts * 10 < l.segments) {
    return make('wall', 'segment-count', `${l.segments} segments and few texts; name gives no hint`);
  }
  return make('unknown', 'inconclusive', 'neither name nor counts are conclusive');
}
