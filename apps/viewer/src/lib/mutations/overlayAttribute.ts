/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What the authoring overlay says about one attribute of one entity.
 *
 * # Why this is its own function
 * A renamed room is renamed everywhere or the two readings disagree in front of
 * the user: the panel that did the rename showed the new name while the plan
 * beside it still printed the old one, because the plan read the parsed spatial
 * hierarchy and nothing writes an attribute mutation back into it. Every
 * surface that shows an authored name has to ask the overlay first, and asking
 * is subtle enough to be worth having in one place.
 *
 * # `null` and `''` mean different things
 * `null` is "the overlay has nothing to say about this attribute" — fall back
 * to whatever the file states. `''` is "the author cleared it", which is a
 * statement and must win over the parsed value; treating the two alike would
 * make a deliberate deletion look like it never happened.
 */

/** The slice of `MutablePropertyView` this needs. */
export interface AttributeOverlay {
  getAttributeMutationsForEntity(expressId: number): Array<{ name: string; value: string }>;
}

/** STEP's placeholders are not values — `$` and `*` read as empty. */
function normalise(value: string): string {
  const trimmed = value.trim();
  return trimmed === '$' || trimmed === '*' ? '' : trimmed;
}

/**
 * The overlay's value for `attributeName`, or `null` when it holds no mutation
 * for it. The LAST mutation wins: an attribute edited twice in one session has
 * two entries, and the later one is the current state.
 */
export function overlayAttribute(
  overlay: AttributeOverlay | undefined | null,
  expressId: number,
  attributeName: string,
): string | null {
  const mutations = overlay?.getAttributeMutationsForEntity?.(expressId);
  if (!mutations) return null;
  for (let i = mutations.length - 1; i >= 0; i -= 1) {
    if (mutations[i].name === attributeName) return normalise(mutations[i].value);
  }
  return null;
}
