/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a location-zone set is about, as a theme.
 *
 * Location zones are boxes and prisms drawn against the scene; painted zones
 * are groups of rooms. Two ways of saying where a zone is, one vocabulary for
 * saying what it IS — `lib/ifcZones/themes.ts`. A Brandabschnitt drawn as a
 * body and a Brandabschnitt painted onto rooms have to arrive in the file as
 * the same kind of thing, or a receiving tool sees two unrelated zone kinds.
 *
 * # Absent and unknown are different answers
 *
 * A set saved before themes existed has none, and every one of those is a
 * construction section or a takt area: that is what the feature was built for,
 * and CONSTRUCTION is what the emitter has always written for them. So absent
 * resolves to Bauabschnitt — the historical default, stated rather than
 * inherited from a `?? 'construction'` somewhere downstream.
 *
 * An id we do NOT recognise is the opposite case: a newer catalogue wrote a
 * theme this build has never heard of. Calling that a construction section
 * would label someone's fire compartment as scaffolding, so it resolves to
 * "Nicht definiert", which is the honest answer and the one the file can carry
 * without asserting something false.
 */

import { ZONE_THEMES, themeById, type ZoneTheme } from '@/lib/ifcZones/themes';

/** What a set with no theme is, and has always been in the file. */
export const DEFAULT_ZONE_SET_THEME_ID = 'construction';

/** The theme of a zone set — see the two fallbacks above. */
export function zoneSetTheme(zoneSet: { themeId?: string }): ZoneTheme {
  const id = zoneSet.themeId;
  if (typeof id !== 'string' || id === '') return themeById(DEFAULT_ZONE_SET_THEME_ID);
  // `themeById` would answer the catalogue's own fallback for an unknown id,
  // which is exactly what is wanted here — spelled out because the two
  // fallbacks above resolve to DIFFERENT themes and a reader will ask.
  return ZONE_THEMES.find((t) => t.id === id) ?? themeById(null);
}
