/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { attachOnDemandTag } from './columnar-parser.js';
import type { EntityRef } from './types.js';

/** One STEP record per line, indexed by byte range the way the parser does. */
function sourceOf(lines: readonly string[]): {
  source: Uint8Array;
  byId: Map<number, EntityRef>;
} {
  const byId = new Map<number, EntityRef>();
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  lines.forEach((line, lineNumber) => {
    const encoded = encoder.encode(`${line}\n`);
    const expressId = Number(/^#(\d+)/.exec(line)![1]);
    const type = /=\s*(\w+)/.exec(line)![1];
    byId.set(expressId, {
      expressId,
      type,
      byteOffset: bytes.length,
      byteLength: encoded.length - 1,
      lineNumber,
    } as EntityRef);
    bytes.push(...encoded);
  });
  return { source: new Uint8Array(bytes), byId };
}

const SENSOR = "#100=IFCSENSOR('0aBcDeFgHiJkLmNoPqRsTu',#5,'Rauchmelder',$,$,#7,#8,'RM-001',.SMOKESENSOR.);";
const UNTAGGED = "#101=IFCSENSOR('1aBcDeFgHiJkLmNoPqRsTu',#5,'Rauchmelder',$,$,#7,#8,$,.SMOKESENSOR.);";

describe('attachOnDemandTag', () => {
  it('reads a Tag that only exists in the file', () => {
    // The regression this exists for: a detector numbered in a session drew
    // its mark on the plan, and the same model reopened from disk drew none,
    // because the only tag reader was the mutation overlay.
    const { source, byId } = sourceOf([SENSOR]);
    const entities: { getTag?(id: number): string } = {};
    attachOnDemandTag(entities, byId, source);
    expect(entities.getTag?.(100)).toBe('RM-001');
  });

  it('answers an empty string for an entity carrying no Tag', () => {
    const { source, byId } = sourceOf([SENSOR, UNTAGGED]);
    const entities: { getTag?(id: number): string } = {};
    attachOnDemandTag(entities, byId, source);
    expect(entities.getTag?.(101)).toBe('');
  });

  it('answers an empty string for an id the index does not hold', () => {
    const { source, byId } = sourceOf([SENSOR]);
    const entities: { getTag?(id: number): string } = {};
    attachOnDemandTag(entities, byId, source);
    expect(entities.getTag?.(999)).toBe('');
  });

  it('decodes each record once', () => {
    // The whole reason this is a cache and not a plain read: the plan asks per
    // device inside a render loop. A second ask must not touch the buffer.
    const { source, byId } = sourceOf([SENSOR]);
    let reads = 0;
    const counted = new Map(byId);
    const watched = {
      get(id: number) {
        const ref = counted.get(id);
        if (ref) reads++;
        return ref;
      },
    } as unknown as Map<number, EntityRef>;

    const entities: { getTag?(id: number): string } = {};
    attachOnDemandTag(entities, watched, source);
    entities.getTag?.(100);
    entities.getTag?.(100);
    entities.getTag?.(100);
    expect(reads).toBe(1);
  });

  it('leaves a table that already has a real getTag alone', () => {
    // The server payload carries Tag as a column. Overwriting it with a
    // source-backed reader would be slower and, on a store with no source
    // buffer, wrong.
    const { source, byId } = sourceOf([SENSOR]);
    const entities = { getTag: () => 'from-the-column' };
    attachOnDemandTag(entities, byId, source);
    expect(entities.getTag(100)).toBe('from-the-column');
  });
});
