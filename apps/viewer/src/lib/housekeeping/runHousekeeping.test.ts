/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runHousekeeping, georefFindings, type HousekeepingInput } from './runHousekeeping.js';
import {
  summariseChecks, formatProgress, sortFindings, CHECK_ORDER,
  type HousekeepingFinding,
} from './findings.js';
import type { HousekeepingElement } from './modelChecks.js';

function element(
  expressId: number,
  over: Partial<HousekeepingElement> = {},
): HousekeepingElement {
  return {
    expressId,
    ifcType: 'IfcWall',
    kind: 'element',
    name: `Wand ${expressId}`,
    longName: null,
    inSpatialStructure: true,
    hasType: true,
    ...over,
  };
}

function input(over: Partial<HousekeepingInput> = {}): HousekeepingInput {
  return {
    elements: [element(1), element(2, { ifcType: 'IfcSpace', kind: 'space', longName: 'Büro' })],
    openProxies: [],
    statedProxies: 0,
    georef: { kind: 'map-conversion', findings: [] },
    acceptedIds: new Set(),
    ...over,
  };
}

describe('runHousekeeping', () => {
  it('reports every check, including the ones that pass', () => {
    // A plan that only listed problems could never say "geprüft, in Ordnung".
    const results = runHousekeeping(input());
    assert.deepEqual(results.map((r) => r.checkId), [...CHECK_ORDER]);
    assert.ok(results.every((r) => r.state === 'clean'));
  });

  it('marks a check it could not judge as unavailable, not clean', () => {
    const results = runHousekeeping(input({ elements: [element(1)] }));
    const spaces = results.find((r) => r.checkId === 'space-in-storey')!;
    assert.equal(spaces.state, 'unavailable');
    assert.match(spaces.unavailableReason!, /keine Räume/);
  });

  it('has nothing to judge at all without a model', () => {
    const results = runHousekeeping(input({ elements: [] }));
    assert.ok(results.every((r) => r.state === 'unavailable'));
  });

  it('opens a check that found something', () => {
    const results = runHousekeeping(input({
      elements: [element(1, { inSpatialStructure: false })],
    }));
    const containment = results.find((r) => r.checkId === 'spatial-containment')!;
    assert.equal(containment.state, 'open');
    assert.equal(containment.findings.length, 1);
  });

  it('counts an accepted finding as done, and keeps it visible', () => {
    const accepted = new Set(['spatial-containment/orphans']);
    const results = runHousekeeping(input({
      elements: [element(1, { inSpatialStructure: false })],
      acceptedIds: accepted,
    }));
    const containment = results.find((r) => r.checkId === 'spatial-containment')!;
    assert.equal(containment.state, 'accepted');
    assert.equal(containment.findings.length, 0);
    // Still there to be found and reversed — not silently dropped.
    assert.equal(containment.accepted.length, 1);
  });
});

describe('georefFindings', () => {
  it('reports a model with no coordinate operation', () => {
    const [finding] = georefFindings({ kind: 'none', findings: [] });
    assert.equal(finding.id, 'georeference/absent');
    // Incomplete, not self-contradictory — `error` is kept for the latter,
    // which is what georef-validation already uses it for.
    assert.equal(finding.severity, 'warning');
    assert.equal(finding.remedy?.target, 'georeference');
  });

  it('does not accept a bare IfcSite location as georeferencing', () => {
    // Met on a real IFC2X3 electrical model: RefLatitude/RefLongitude and
    // nothing else. Degrees with no rotation, no scale and no projected CRS
    // cannot place a model on a cadastral plan, and calling that "in Ordnung"
    // would hand out a green tick for work still to do.
    const findings = georefFindings({ kind: 'site-location', findings: [] });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'georeference/site-location-only');
    assert.equal(findings[0].severity, 'warning');
  });

  it('still reports what the validator found about a site location', () => {
    const findings = georefFindings({
      kind: 'site-location',
      findings: [{
        code: 'site-location-is-vendor-default',
        severity: 'warning',
        title: 'Werksvorgabe',
        detail: 'Unverändert.',
      }],
    });
    assert.deepEqual(findings.map((f) => f.id), [
      'georeference/site-location-only',
      'georeference/site-location-is-vendor-default',
    ]);
  });

  it('adopts what the geo validator found rather than judging again', () => {
    const findings = georefFindings({
      kind: 'map-conversion',
      findings: [{
        code: 'site-location-conflict',
        severity: 'error',
        title: 'IfcSite widerspricht der Map Conversion',
        detail: '4 km auseinander.',
      }],
    });
    assert.equal(findings[0].id, 'georeference/site-location-conflict');
    assert.equal(findings[0].severity, 'error');
    assert.equal(findings[0].detail, '4 km auseinander.');
  });
});

describe('sortFindings', () => {
  it('puts the worst first', () => {
    const make = (id: string, severity: HousekeepingFinding['severity']) => ({
      id, checkId: 'identification' as const, severity, title: id, detail: '', elements: [],
    });
    const sorted = sortFindings([make('c', 'info'), make('a', 'warning'), make('b', 'error')]);
    assert.deepEqual(sorted.map((f) => f.id), ['b', 'a', 'c']);
  });
});

describe('summariseChecks', () => {
  it('counts each check once and each element once', () => {
    // The same element can fail two checks; the plan should not double it.
    const results = runHousekeeping(input({
      elements: [element(1, { inSpatialStructure: false, hasType: false, name: '' })],
    }));
    const summary = summariseChecks(results);
    assert.equal(summary.total, CHECK_ORDER.length);
    assert.equal(summary.open, 3);
    assert.equal(summary.affectedElements, 1);
  });

  it('reports progress rather than a defect count', () => {
    const summary = summariseChecks(runHousekeeping(input()));
    assert.equal(formatProgress(summary), '6 von 6 erledigt');
  });

  it('counts an unavailable check as neither done nor open', () => {
    const summary = summariseChecks(runHousekeeping(input({ elements: [element(1)] })));
    assert.equal(summary.unavailable, 1);
    assert.equal(formatProgress(summary), '5 von 6 erledigt');
  });
});
