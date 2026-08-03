/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * One switch for "may this app talk to third parties at all".
 *
 * Some features reach outside the browser as a side effect of being shown:
 * the location map fetches basemap tiles, which means the building's real
 * coordinates go to a tile CDN, and the place search posts the query to a
 * geocoder. Neither is obvious from the UI, and in a deployment that has
 * promised its data stays on the device, "shown by default" is the wrong
 * default.
 *
 * Deliberately a single gate rather than a flag per feature: a per-feature
 * opt-out silently fails to cover whatever gets added next, and this is
 * exactly the kind of guarantee that has to hold for things nobody thought of
 * yet. A feature that needs the network asks this first, and offers an
 * explicit, per-use action when the answer is no.
 *
 * Requests to the app's own origin are unaffected — this is about third
 * parties, not about the app working.
 */

const STORAGE_KEY = 'ifclite.privacy.allow-external-requests';

/**
 * Off unless the user turned it on. The safe direction: a wrong "off" costs a
 * map nobody asked for, a wrong "on" leaks a building's location.
 */
export function externalRequestsAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Storage blocked (private mode, hardened settings) — deny rather than
    // assume consent that cannot be recorded.
    return false;
  }
}

export function setExternalRequestsAllowed(allowed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, allowed ? 'true' : 'false');
  } catch {
    // Nothing to do — the getter fails closed.
  }
}

/** Third parties contacted when this is enabled, for an honest disclosure. */
export const EXTERNAL_ENDPOINTS: ReadonlyArray<{ host: string; purpose: string }> = [
  { host: 'basemaps.cartocdn.com', purpose: 'Kartenkacheln für den Ortsplan' },
  { host: 'nominatim.openstreetmap.org', purpose: 'Ortssuche (Adresse → Koordinate)' },
  { host: 'api.open-meteo.com', purpose: 'Geländehöhe an der Gebäudeposition' },
  { host: 'epsg.io', purpose: 'CRS-Definition für exotische EPSG-Codes (Fallback)' },
  { host: 'api.bsdd.buildingsmart.org', purpose: 'bSDD-Klassifikationssuche' },
];
