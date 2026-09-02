/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { ifcGuidToUuid, isValidIfcGuid } from '@ifc-lite/encoding';
import { candidateId, stableGlobalId, stableUuid } from './stable-id.js';

describe('stableUuid', () => {
  it('is a well-formed UUID with version 8 and the RFC variant', () => {
    const u = stableUuid('plan.dxf', 'storey', 'A1');
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is the same on every call and different for different input', () => {
    expect(stableUuid('a', 'b')).toBe(stableUuid('a', 'b'));
    expect(stableUuid('a', 'b')).not.toBe(stableUuid('a', 'c'));
    expect(stableUuid('a', 'b')).not.toBe(stableUuid('ab'));
  });

  it('is pinned: a change here would orphan every existing draft', () => {
    expect(stableUuid('plan.dxf', 'storey', 'A1')).toBe('b4d6ed6a-46b8-8d8c-b8f7-bc0a4565f53d');
  });
});

describe('stableGlobalId', () => {
  it('is a valid 22-character IFC GlobalId that round-trips to the UUID', () => {
    const g = stableGlobalId('plan.dxf', 'storey', 'A1');
    expect(g).toHaveLength(22);
    expect(isValidIfcGuid(g)).toBe(true);
    expect(ifcGuidToUuid(g).toLowerCase()).toBe(stableUuid('plan.dxf', 'storey', 'A1'));
  });
});

describe('candidateId', () => {
  it('does not depend on the order the handles were found in', () => {
    expect(candidateId('plan.dxf', 'S1', ['1F', '2A', '3B'])).toBe(candidateId('plan.dxf', 'S1', ['3B', '1F', '2A']));
  });

  it('changes with the storey and with the file', () => {
    expect(candidateId('plan.dxf', 'S1', ['1F'])).not.toBe(candidateId('plan.dxf', 'S2', ['1F']));
    expect(candidateId('plan.dxf', 'S1', ['1F'])).not.toBe(candidateId('other.dxf', 'S1', ['1F']));
  });

  it('treats a missing storey as the empty storey, consistently', () => {
    expect(candidateId('plan.dxf', undefined, ['1F'])).toBe(candidateId('plan.dxf', '', ['1F']));
  });
});
