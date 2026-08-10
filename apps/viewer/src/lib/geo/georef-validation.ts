/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Plausibility checks for a model's georeferencing.
 *
 * The georeferencing panel happily accepts any number typed into it, which
 * makes a whole class of broken files invisible: coordinates that are millions
 * of metres outside the declared CRS, or an authoring tool's default site
 * location that nobody ever moved. Both place the model somewhere it isn't,
 * and neither shows up until someone federates it with a correctly referenced
 * model and finds an offset.
 *
 * These checks are deliberately *conservative*: every finding must be
 * defensible from the file alone. We never guess where the model should be —
 * only whether what the file says is self-consistent and physically possible.
 *
 * Deliberately NOT a check: "is this coordinate inside the CRS area of use".
 * The bundled EPSG index carries the area only as prose ("Switzerland;
 * Liechtenstein"), not as a polygon, and inventing a numeric bound per
 * projection family produces confident-looking false positives. What we can
 * state without a bounds database is covered below.
 */

import type { MapConversion, ProjectedCRS, SiteReferenceLocation } from '@ifc-lite/parser';
import type { LatLon } from './reproject';
import { detectScaleUnitMismatch } from './geo-scale';

export type GeorefFindingSeverity = 'error' | 'warning';

export type GeorefFindingCode =
  | 'site-location-conflict'
  | 'site-location-is-vendor-default'
  | 'coordinates-outside-projection-domain'
  | 'scale-unit-mismatch';

export interface GeorefFinding {
  code: GeorefFindingCode;
  severity: GeorefFindingSeverity;
  /** One line, shown as the finding's headline. */
  title: string;
  /** The evidence: which numbers, and what they imply. */
  detail: string;
}

export interface GeorefValidationInput {
  projectedCRS?: ProjectedCRS;
  mapConversion?: MapConversion;
  /** IfcSite reference angles, when the file carries them. */
  siteReference?: SiteReferenceLocation;
  /**
   * `mapConversion` eastings/northings reprojected to WGS84 by the caller.
   * Reprojection is async and CRS-definition dependent, so it stays outside
   * this module — that keeps every check here synchronous and testable.
   */
  derivedLatLon?: LatLon | null;
  /**
   * Round-trip residual **in metres**, from `measureProjectionRoundTripM`:
   * the map coordinates projected to WGS84 and straight back, compared against
   * where they started. See {@link ROUND_TRIP_TOLERANCE_M}.
   */
  roundTripResidual?: number | null;
  /** IFC project length unit → metres (0.001 for a millimetre model). */
  lengthUnitScale?: number;
}

/**
 * Known authoring-tool default site locations, in decimal degrees.
 *
 * A model sitting on one of these was never georeferenced: the coordinates are
 * whatever the template shipped with. Worth its own finding because the fix is
 * different from a wrong-but-intentional value — nobody needs to work out what
 * went wrong, they just need to set the real location.
 */
const VENDOR_DEFAULT_SITE_LOCATIONS: ReadonlyArray<{
  latitude: number;
  longitude: number;
  label: string;
}> = [
  // Autodesk Revit's out-of-the-box project location (San Francisco, CA).
  { latitude: 37.7952, longitude: -122.3941, label: 'Revit-Werksvorgabe (San Francisco)' },
  // "Null Island" — the 0/0 that appears when a tool writes the attribute
  // without ever populating it.
  { latitude: 0, longitude: 0, label: 'unbelegt (0°/0°)' },
];

/**
 * How close a location must be to a known default to be reported as one.
 * 0.02° is roughly 2 km — wide enough to absorb the rounding of a
 * degree/minute/second compound angle, far tighter than the distance to any
 * real neighbouring project.
 */
const VENDOR_DEFAULT_TOLERANCE_DEG = 0.02;

/**
 * How far the two location statements in a file may disagree before it is a
 * contradiction rather than sloppiness.
 *
 * IfcSite reference angles are commonly rounded to whole seconds (~30 m) and
 * often describe the town rather than the plot, so the threshold has to be
 * generous. 5 km still leaves the check decisive: the failure mode it exists
 * for puts the two statements hundreds or thousands of kilometres apart.
 */
const SITE_CONFLICT_THRESHOLD_KM = 5;

/**
 * Round-trip residual above which the map coordinates are outside the
 * projection's usable domain.
 *
 * Within its domain a projection round-trips to well under a millimetre;
 * measured residuals on valid points are 0.0000–0.0012 m across somerc, UTM
 * and transverse Mercator. One metre is therefore orders of magnitude clear of
 * the noise floor while never firing on a legitimate coordinate.
 *
 * IMPORTANT — this test is sufficient, not necessary. It detects the oblique
 * Mercator family (Swiss LV95/LV03, Hungarian EOV, …), whose inverse is
 * singular far from the projection centre: the same broken values that produce
 * a 14'654 km residual under EPSG:2056 round-trip to 0.0 m under EPSG:25832
 * and 0.09 m under EPSG:27700. A clean round trip proves nothing; a dirty one
 * proves the coordinates are unusable.
 */
export const ROUND_TRIP_TOLERANCE_M = 1;

/** Great-circle distance in kilometres (spherical earth is ample here). */
function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatLatLon(position: LatLon): string {
  return `${position.lat.toFixed(4)}° / ${position.lon.toFixed(4)}°`;
}

function formatDistanceKm(km: number): string {
  return km >= 100 ? `${Math.round(km).toLocaleString('de-CH')} km` : `${km.toFixed(1)} km`;
}

/**
 * Identify a site location as an authoring tool's untouched default.
 * Exported for the test suite and for callers that want the label without
 * running the full validation.
 */
export function matchVendorDefaultSiteLocation(
  site: Pick<SiteReferenceLocation, 'latitude' | 'longitude'>,
): string | null {
  for (const candidate of VENDOR_DEFAULT_SITE_LOCATIONS) {
    if (
      Math.abs(site.latitude - candidate.latitude) <= VENDOR_DEFAULT_TOLERANCE_DEG
      && Math.abs(site.longitude - candidate.longitude) <= VENDOR_DEFAULT_TOLERANCE_DEG
    ) {
      return candidate.label;
    }
  }
  return null;
}

/**
 * Run every plausibility check. Returns findings ordered errors-first; an
 * empty array means nothing objectionable was found — which is NOT the same as
 * "the georeferencing is correct" (see the note on area of use above).
 */
export function validateGeoreference(input: GeorefValidationInput): GeorefFinding[] {
  const findings: GeorefFinding[] = [];
  const { mapConversion, projectedCRS, siteReference, derivedLatLon, roundTripResidual } = input;

  // ── The two location statements must agree ──────────────────────────────
  // This is the strongest check available without external data: the file
  // asserts the same place twice, so a disagreement is a contradiction in the
  // file itself, whatever the truth turns out to be.
  if (siteReference && derivedLatLon) {
    const sitePosition: LatLon = { lat: siteReference.latitude, lon: siteReference.longitude };
    const distanceKm = haversineKm(sitePosition, derivedLatLon);
    if (distanceKm > SITE_CONFLICT_THRESHOLD_KM) {
      findings.push({
        code: 'site-location-conflict',
        severity: 'error',
        title: 'Koordinatenoperation und IfcSite widersprechen sich',
        detail:
          `IfcMapConversion verortet das Modell bei ${formatLatLon(derivedLatLon)}, `
          + `IfcSite bei ${formatLatLon(sitePosition)} — `
          + `${formatDistanceKm(distanceKm)} auseinander. `
          + 'Beide beschreiben denselben Ort, also ist mindestens eine Angabe falsch.',
      });
    }
  }

  // ── Never-georeferenced models ──────────────────────────────────────────
  if (siteReference) {
    const vendorDefault = matchVendorDefaultSiteLocation(siteReference);
    if (vendorDefault) {
      findings.push({
        code: 'site-location-is-vendor-default',
        severity: 'warning',
        title: 'IfcSite steht auf einer Werksvorgabe',
        detail:
          `RefLatitude / RefLongitude entsprechen ${vendorDefault}. `
          + 'Der Standort wurde in der Autorensoftware nie gesetzt.',
      });
    }
  }

  // ── Coordinates the projection cannot represent ─────────────────────────
  if (
    mapConversion
    && roundTripResidual !== null
    && roundTripResidual !== undefined
    && Number.isFinite(roundTripResidual)
    && roundTripResidual > ROUND_TRIP_TOLERANCE_M
  ) {
    findings.push({
      code: 'coordinates-outside-projection-domain',
      severity: 'error',
      title: 'Koordinaten liegen ausserhalb des Projektionsbereichs',
      detail:
        `E ${mapConversion.eastings.toLocaleString('de-CH')} / `
        + `N ${mapConversion.northings.toLocaleString('de-CH')} lässt sich in `
        + `${projectedCRS?.name ?? 'dem gewählten CRS'} nicht verlustfrei zurückrechnen `
        + `(Abweichung ${formatDistanceKm(roundTripResidual / 1000)}). `
        + 'Die Werte gehören nicht in dieses Koordinatensystem.',
    });
  }

  // ── Unit bridge between project and map ─────────────────────────────────
  // Delegated so the rule lives in one place; surfaced here so the panel can
  // show a single list instead of two competing warnings.
  const scaleMismatch = mapConversion
    ? detectScaleUnitMismatch(mapConversion.scale, projectedCRS?.mapUnitScale, input.lengthUnitScale)
    : null;
  if (scaleMismatch) {
    findings.push({
      code: 'scale-unit-mismatch',
      severity: 'warning',
      title: 'Scale passt nicht zu den Einheiten',
      detail:
        `Scale ${scaleMismatch.rawScale}, erwartet ≈ ${scaleMismatch.expectedScale.toPrecision(4)}. `
        + `Die Geometrie wird mit dem ${scaleMismatch.effectiveScale.toPrecision(4)}-fachen `
        + 'ihrer wahren Grösse platziert.',
    });
  }

  return findings.sort((left, right) => {
    if (left.severity === right.severity) return 0;
    return left.severity === 'error' ? -1 : 1;
  });
}
