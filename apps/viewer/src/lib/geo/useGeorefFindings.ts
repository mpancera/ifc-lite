/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Runs {@link validateGeoreference} for the georeferencing panel.
 *
 * The two positional inputs — where the coordinate operation actually lands,
 * and what a projection round trip costs there — need proj4 and a resolved CRS
 * definition, which is async. This hook does that work off the render path and
 * hands the synchronous validator its finished inputs, so the checks
 * themselves stay pure and directly testable.
 */

import { useEffect, useState } from 'react';
import type { MapConversion, ProjectedCRS, SiteReferenceLocation } from '@ifc-lite/parser';

import {
  measureProjectionRoundTripM,
  reprojectPointToLatLon,
  reprojectionInputKey,
  type LatLon,
} from './reproject';
import { validateGeoreference, type GeorefFinding } from './georef-validation';

export function useGeorefFindings(
  projectedCRS: ProjectedCRS | undefined,
  mapConversion: MapConversion | undefined,
  siteReference: SiteReferenceLocation | undefined,
  lengthUnitScale: number | undefined,
): GeorefFinding[] {
  const [position, setPosition] = useState<{
    latLon: LatLon | null;
    roundTrip: number | null;
  }>({ latLon: null, roundTrip: null });

  // Key on everything the reprojection reads, so a georef edit that changes
  // the projection without changing the CRS name still re-runs.
  const inputKey = projectedCRS && mapConversion
    ? reprojectionInputKey(
      mapConversion.eastings,
      mapConversion.northings,
      projectedCRS,
      lengthUnitScale ?? 1,
    )
    : null;

  useEffect(() => {
    if (!projectedCRS || !mapConversion) {
      setPosition({ latLon: null, roundTrip: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      const [latLon, roundTrip] = await Promise.all([
        reprojectPointToLatLon(
          mapConversion.eastings,
          mapConversion.northings,
          projectedCRS,
          lengthUnitScale ?? 1,
        ),
        measureProjectionRoundTripM(
          mapConversion.eastings,
          mapConversion.northings,
          projectedCRS,
          lengthUnitScale ?? 1,
        ),
      ]);
      if (!cancelled) setPosition({ latLon, roundTrip });
    })();
    return () => { cancelled = true; };
    // Keyed on `inputKey` alone: it folds every field the two calls read,
    // while `projectedCRS` / `mapConversion` are fresh object identities on
    // each render (they come out of a merge) and would thrash the effect.
  }, [inputKey]);

  // Deliberately not memoised: the checks are pure arithmetic over a handful
  // of numbers, and `inputKey` does not fold every field they read (Scale, for
  // one), so a memo keyed on it would leave a finding stale after an edit.
  return validateGeoreference({
    projectedCRS,
    mapConversion,
    siteReference,
    derivedLatLon: position.latLon,
    roundTripResidual: position.roundTrip,
    lengthUnitScale,
  });
}
