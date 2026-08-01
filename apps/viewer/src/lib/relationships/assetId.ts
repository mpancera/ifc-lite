/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Asset ID generator for the `SITE.BUILDING.FLOOR.SPACE.ASSETTYPE.COUNTER`
 * scheme (F5 Relationship Manager, Phase 1). Pure string logic — callers
 * resolve the actual Site/Building/Storey/Space names themselves (e.g. via
 * `@ifc-lite/create`'s `existingSpacesByStorey` + the viewer's own
 * `buildSpatialAncestryIndex`) and pass in whatever `Tag` values already
 * exist in the model so the counter continues rather than restarting.
 *
 * Not yet wired into the Add Element flow — see DataContainer/PROJECT.md
 * §F5 for the open modelling questions this needs signed off before it's
 * plugged into `addLibraryElement`.
 */

export interface AssetIdParts {
  site: string;
  building: string;
  floor: string;
  space: string;
  /** Short code for the placed element's kind, e.g. a catalog entry's `category`. */
  assetType: string;
}

const FALLBACK_SEGMENT = 'UNK';

/**
 * Normalises one ID segment: uppercase, spaces/punctuation collapsed to a
 * single hyphen, leading/trailing hyphens trimmed. Falls back to `UNK`
 * (not empty) so a blank Site/Building/Space name never collapses the
 * dot-separated schema down to fewer than 6 segments.
 */
export function sanitizeIdSegment(raw: string): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || FALLBACK_SEGMENT;
}

/** The `SITE.BUILDING.FLOOR.SPACE.ASSETTYPE` prefix, before the counter. */
export function buildAssetIdPrefix(parts: AssetIdParts): string {
  return [parts.site, parts.building, parts.floor, parts.space, parts.assetType]
    .map(sanitizeIdSegment)
    .join('.');
}

/**
 * Next free `PREFIX.NNN` id for `parts`, scanning `existingTags` for ids
 * sharing the same prefix and continuing from the highest counter found
 * (starts at 1 when none exist). Non-matching tags are ignored, so mixing
 * asset-id-tagged and freeform-tagged elements in the same model is safe.
 */
export function nextAssetId(
  parts: AssetIdParts,
  existingTags: Iterable<string>,
  counterWidth = 3,
): string {
  const prefix = buildAssetIdPrefix(parts);
  const pattern = new RegExp(`^${escapeRegExp(prefix)}\\.(\\d+)$`);
  let maxCounter = 0;
  for (const tag of existingTags) {
    const match = pattern.exec(tag);
    if (!match) continue;
    const n = Number(match[1]);
    if (n > maxCounter) maxCounter = n;
  }
  const next = maxCounter + 1;
  return `${prefix}.${String(next).padStart(counterWidth, '0')}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
