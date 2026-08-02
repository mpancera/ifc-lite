/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { IfcTypeEnum, IfcTypeEnumFromString, IfcTypeEnumToString } from './types.js';

/** Every named member of the enum, excluding the `Unknown` sentinel. */
function namedMembers(): Array<[string, IfcTypeEnum]> {
  return Object.entries(IfcTypeEnum)
    .filter(([name, value]) => typeof value === 'number' && name !== 'Unknown')
    .map(([name, value]) => [name, value as IfcTypeEnum]);
}

describe('IfcTypeEnum integrity', () => {
  it('assigns a distinct value to every member', () => {
    const values = namedMembers().map(([, v]) => v);
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps every value inside the Uint16 range the cache serialises to', () => {
    for (const [name, value] of namedMembers()) {
      expect(value, `${name} exceeds Uint16`).toBeLessThanOrEqual(65535);
    }
  });

  it('round-trips every member through both lookup maps', () => {
    for (const [name, value] of namedMembers()) {
      expect(IfcTypeEnumToString(value), `${name} missing from TYPE_ENUM_TO_STRING`).toBe(name);
      expect(IfcTypeEnumFromString(name), `${name} missing from TYPE_STRING_TO_ENUM`).toBe(value);
    }
  });

  it('resolves classes case-insensitively, as STEP keywords are uppercase', () => {
    expect(IfcTypeEnumFromString('IFCSENSOR')).toBe(IfcTypeEnum.IfcSensor);
    expect(IfcTypeEnumFromString('IfcSensor')).toBe(IfcTypeEnum.IfcSensor);
  });

  it('resolves the installation classes the element catalogue places', () => {
    // Regression guard for the gap that motivated the catalogue block: these
    // resolved to `Unknown`, so a class-targeted list could not select them
    // and their class name rendered as the raw uppercase keyword.
    for (const name of ['IfcSensor', 'IfcAlarm', 'IfcAudioVisualAppliance']) {
      expect(IfcTypeEnumFromString(name), name).not.toBe(IfcTypeEnum.Unknown);
      expect(IfcTypeEnumToString(IfcTypeEnumFromString(name))).toBe(name);
    }
  });

  it('reports an unmapped keyword as Unknown', () => {
    expect(IfcTypeEnumFromString('IFCNOTAREALCLASS')).toBe(IfcTypeEnum.Unknown);
  });
});
