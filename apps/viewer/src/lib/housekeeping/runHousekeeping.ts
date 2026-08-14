/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Running every check and folding the answers into one plan.
 *
 * # Georeferencing is adopted, not re-implemented
 * `lib/geo/georef-validation` already decides whether a model's coordinates
 * are self-consistent, and it is careful about it — it refuses, for instance,
 * to guess whether a coordinate lies inside a CRS's area of use, because the
 * bundled EPSG index carries that only as prose. A second opinion here would
 * either duplicate that care or fall short of it. So its findings are
 * translated into the plan's shape and nothing more, and the one question it
 * does not ask — "is there any georeferencing at all" — is added.
 *
 * # `unavailable` is not `clean`
 * A model with no rooms cannot pass "Raum → Geschoss"; it has not been
 * checked. Reporting that as done would be a green tick for work nobody did,
 * which in a Prüfplan is worse than a red one.
 */

import type { GeorefFinding } from '@/lib/geo/georef-validation';
import {
  resolveCheck, CHECK_ORDER,
  type HousekeepingFinding, type HousekeepingResult, type HousekeepingCheckId,
} from './findings.js';
import {
  checkSpatialContainment, checkSpaceInStorey, checkTypeAssignment,
  checkIdentification, checkClassAssignment,
  type HousekeepingElement,
} from './modelChecks.js';

/**
 * How the model states where it is.
 *
 * `site-location` is its own answer and not a kind of `map-conversion`: an
 * `IfcSite` carrying reference latitude and longitude says roughly where the
 * plot is, in degrees, with no rotation, no scale and no projected CRS. It was
 * the only option IFC2X3 offered and it is still what several MEP tools write.
 * Treating it as georeferencing would hand a green tick to a model that cannot
 * be placed on a cadastral plan — and this was met on a real IFC2X3 electrical
 * model whose only location statement was exactly that.
 */
export type GeorefKind = 'none' | 'site-location' | 'map-conversion';

export interface GeorefState {
  readonly kind: GeorefKind;
  /** What `validateGeoreference` made of it. */
  readonly findings: readonly GeorefFinding[];
}

export interface HousekeepingInput {
  readonly elements: readonly HousekeepingElement[];
  /** Proxies still awaiting a class, from the triage. */
  readonly openProxies: readonly number[];
  /** Proxies whose author already declared them, also from the triage. */
  readonly statedProxies: number;
  readonly georef: GeorefState;
  readonly acceptedIds: ReadonlySet<string>;
}

/**
 * Missing georeferencing, and whatever the geo validator found.
 *
 * A missing coordinate operation is a `warning`, not an `error`, to keep the
 * word meaning what `georef-validation` already makes it mean there: `error`
 * is the file contradicting itself — a site location that fights the map
 * conversion, coordinates outside the projection's domain. Nothing stated is
 * incomplete, not wrong.
 */
export function georefFindings(state: GeorefState): HousekeepingFinding[] {
  const remedy = { label: 'Georeferenzierung öffnen', target: 'georeference' as const };

  if (state.kind === 'none') {
    return [{
      id: 'georeference/absent',
      checkId: 'georeference',
      severity: 'warning',
      title: 'Keine Georeferenzierung im Modell',
      detail: 'Ohne IfcMapConversion und IfcProjectedCRS steht das Modell in '
        + 'seinem eigenen Koordinatensystem. Es lässt sich nicht mit Kataster, '
        + 'Terrain oder einem anders referenzierten Fachmodell zusammenbringen, '
        + 'ohne dass jemand die Verschiebung von Hand sucht.',
      elements: [],
      remedy,
    }];
  }

  const findings: HousekeepingFinding[] = [];
  if (state.kind === 'site-location') {
    findings.push({
      id: 'georeference/site-location-only',
      checkId: 'georeference',
      severity: 'warning',
      title: 'Nur eine Standortangabe am IfcSite, keine Georeferenzierung',
      detail: 'RefLatitude und RefLongitude sagen ungefähr, wo das Grundstück '
        + 'liegt — ohne Drehung, ohne Massstab und ohne projiziertes '
        + 'Koordinatensystem. Für die Zusammenarbeit mit Kataster oder einem '
        + 'anderen Fachmodell braucht es eine IfcMapConversion mit '
        + 'IfcProjectedCRS.',
      elements: [],
      remedy,
    });
  }

  return findings.concat(state.findings.map((finding) => ({
    id: `georeference/${finding.code}`,
    checkId: 'georeference' as const,
    severity: finding.severity,
    title: finding.title,
    detail: finding.detail,
    elements: [],
    remedy,
  })));
}

/** Why a check could not be judged on this model, or `undefined` if it could. */
function unavailableReason(
  checkId: HousekeepingCheckId,
  input: HousekeepingInput,
): string | undefined {
  if (input.elements.length === 0) return 'Kein Modell geladen.';
  if (checkId === 'space-in-storey' && !input.elements.some((e) => e.kind === 'space')) {
    return 'Das Modell enthält keine Räume.';
  }
  return undefined;
}

function findingsFor(
  checkId: HousekeepingCheckId,
  input: HousekeepingInput,
): HousekeepingFinding[] {
  switch (checkId) {
    case 'georeference': return georefFindings(input.georef);
    case 'class-assignment': return checkClassAssignment(input.openProxies, input.statedProxies);
    case 'spatial-containment': return checkSpatialContainment(input.elements);
    case 'space-in-storey': return checkSpaceInStorey(input.elements);
    case 'type-assignment': return checkTypeAssignment(input.elements);
    case 'identification': return checkIdentification(input.elements);
  }
}

/** The whole plan, in {@link CHECK_ORDER}. */
export function runHousekeeping(input: HousekeepingInput): HousekeepingResult[] {
  return CHECK_ORDER.map((checkId) => resolveCheck(
    checkId,
    findingsFor(checkId, input),
    input.acceptedIds,
    unavailableReason(checkId, input),
  ));
}
