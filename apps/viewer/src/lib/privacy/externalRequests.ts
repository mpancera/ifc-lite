/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which third parties this app may talk to, one answer per source.
 *
 * Some features reach outside the browser as a side effect of being shown:
 * the location map fetches basemap tiles, which means the building's real
 * coordinates go to a tile CDN, and the place search posts the query to a
 * geocoder. Neither is obvious from the UI, and in a deployment that has
 * promised its data stays on the device, "shown by default" is the wrong
 * default.
 *
 * # Why per source, and why that is still safe
 * This was one switch for everything, on the argument that a per-feature
 * opt-out silently fails to cover whatever gets added next. The argument was
 * right about the danger and wrong about the remedy: the sources are not
 * equally sensitive. `epsg.io` is asked for the definition of a coordinate
 * system — it learns a region at best — while the elevation endpoint is sent
 * the building's exact position. Forcing one answer over both means somebody
 * who wants a coordinate system resolved has to disclose a site, so in
 * practice they leave everything off and the app quietly loses features it
 * could have had.
 *
 * The guarantee is kept by construction instead of by coarseness: the source
 * is a REQUIRED argument of a closed union, so a new caller cannot ask
 * vaguely. Adding an endpoint means adding a member here, and a member with
 * nothing stored against it is off — a new source is never on because an old
 * consent happened to cover it.
 *
 * Requests to the app's own origin are unaffected — this is about third
 * parties, not about the app working.
 */

/** A third party this app can be permitted to contact. */
export type ExternalSource =
  | 'basemap'
  | 'geocode'
  | 'elevation'
  | 'epsg'
  | 'bsdd'
  | 'parcel'
  | 'catalog';

export interface ExternalSourceInfo {
  id: ExternalSource;
  /** What the switch is called. */
  label: string;
  /** What is SENT, not only what is fetched — that is the part that matters. */
  purpose: string;
  hosts: readonly string[];
  /**
   * The request carries the building's position.
   *
   * Marked so the panel can say so without the reader having to infer it from
   * the prose, and so the three that do are visibly the same kind of thing.
   */
  discloses?: 'position';
}

/**
 * Every source, in the order the panel lists them: the ones that disclose a
 * position first, because those are the decisions worth making deliberately.
 */
export const EXTERNAL_SOURCES: readonly ExternalSourceInfo[] = [
  {
    id: 'basemap',
    label: 'Kartenkacheln',
    purpose: 'Ortsplan hinter dem Gebäude. Gesendet werden die Kachelkoordinaten der Gebäudeposition.',
    hosts: ['basemaps.cartocdn.com'],
    discloses: 'position',
  },
  {
    id: 'elevation',
    label: 'Geländehöhe',
    purpose: 'Höhe über Meer an der Gebäudeposition. Gesendet wird genau diese Position.',
    hosts: ['api.open-meteo.com'],
    discloses: 'position',
  },
  {
    id: 'parcel',
    label: 'Amtliche Parzelle',
    purpose: 'Parzellengrenze zur E-GRID (Schweiz). Gesendet wird die Parzellennummer.',
    hosts: ['api3.geo.admin.ch'],
    discloses: 'position',
  },
  {
    id: 'geocode',
    label: 'Ortssuche',
    purpose: 'Adresse zu Koordinate. Gesendet wird der eingetippte Suchbegriff.',
    hosts: ['nominatim.openstreetmap.org'],
  },
  {
    id: 'epsg',
    label: 'EPSG-Definitionen',
    purpose: 'Definition exotischer Koordinatensysteme, wenn der mitgelieferte Index (7000+ Codes) keinen Treffer hat. Gesendet wird nur der EPSG-Code.',
    hosts: ['epsg.io'],
  },
  {
    id: 'bsdd',
    label: 'bSDD',
    purpose: 'Klassifikationssuche bei buildingSMART. Gesendet wird der Suchbegriff.',
    hosts: ['api.bsdd.buildingsmart.org'],
  },
  {
    id: 'catalog',
    label: 'Objekt- und Symbolkatalog',
    purpose: 'Fachklassen und Plansymbole samt Zeichnungen, nur auf Anforderung. Gesendet wird kein Modellinhalt.',
    hosts: ['data-dictionary.ch'],
  },
];

/** One entry per source, so a stored answer can never be about two of them. */
function keyFor(source: ExternalSource): string {
  return `ifclite.privacy.allow.${source}`;
}

/**
 * The single switch this replaced.
 *
 * Read as a fallback so somebody who had allowed everything keeps everything
 * rather than finding the app silently offline after an update. Never the
 * answer once a source has its own entry.
 */
const LEGACY_KEY = 'ifclite.privacy.allow-external-requests';

/**
 * Off unless the user turned this source on. The safe direction: a wrong
 * "off" costs a map nobody asked for, a wrong "on" leaks a building's
 * location.
 */
export function externalRequestsAllowed(source: ExternalSource): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const own = window.localStorage.getItem(keyFor(source));
    if (own !== null) return own === 'true';
    return window.localStorage.getItem(LEGACY_KEY) === 'true';
  } catch {
    // Storage blocked (private mode, hardened settings) — deny rather than
    // assume consent that cannot be recorded.
    return false;
  }
}

/** Turn one source on or off. */
export function setExternalRequestAllowed(source: ExternalSource, allowed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(keyFor(source), allowed ? 'true' : 'false');
  } catch {
    // Nothing to do — the getter fails closed.
  }
}

/**
 * Every source at once, for the panel's master switch.
 *
 * Writes the legacy key too: left alone, a stored `true` there would keep
 * answering for any source whose own entry is missing, and "block everything"
 * has to mean everything.
 */
export function setExternalRequestsAllowed(allowed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    for (const source of EXTERNAL_SOURCES) {
      window.localStorage.setItem(keyFor(source.id), allowed ? 'true' : 'false');
    }
    window.localStorage.setItem(LEGACY_KEY, allowed ? 'true' : 'false');
  } catch {
    // Nothing to do — the getter fails closed.
  }
}

/** How many sources are currently permitted, for a one-line summary. */
export function allowedExternalSourceCount(): number {
  return EXTERNAL_SOURCES.filter((source) => externalRequestsAllowed(source.id)).length;
}
