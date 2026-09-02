/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Deterministic identifiers.
 *
 * A drafted element must keep its GlobalId across runs: a reviewer confirms
 * or corrects it in a viewer, and the next run over a revised plan has to find
 * it again. Random GUIDs would orphan every correction. So the id is a hash of
 * what produced the element (source file, storey, and the drawing handles),
 * rendered as a well-formed UUID and then compressed with the canonical IFC
 * encoder. Same input, same id, on any machine.
 *
 * The hash is FNV-1a over 64 bits, run twice with different offsets to fill
 * 128 bits. It is not cryptographic and does not need to be: the goal is
 * stability and a negligible collision rate within one project, not secrecy.
 */

import { uuidToIfcGuid } from '@ifc-lite/encoding';

const FNV_PRIME = 0x100000001b3n;
const OFFSET_A = 0xcbf29ce484222325n;
const OFFSET_B = 0x84222325cbf29ce4n;
const MASK64 = 0xffffffffffffffffn;
const SEPARATOR = '\u0000';

function fnv1a64(bytes: Uint8Array, offset: bigint): bigint {
  let hash = offset;
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash;
}

function hex64(v: bigint): string {
  return v.toString(16).padStart(16, '0');
}

function variantNibble(h: string): string {
  const n = parseInt(h, 16);
  return ((n & 0x3) | 0x8).toString(16);
}

/**
 * A UUID string (8-4-4-4-12, lower case) derived from the parts. Version
 * nibble 8 and RFC variant bits are set, so the value is a valid UUID that no
 * random generator will ever produce.
 */
export function stableUuid(...parts: string[]): string {
  const bytes = new TextEncoder().encode(parts.join(SEPARATOR));
  const hex = hex64(fnv1a64(bytes, OFFSET_A)) + hex64(fnv1a64(bytes, OFFSET_B));
  const versioned = hex.slice(0, 12) + '8' + hex.slice(13, 16) + variantNibble(hex[16]) + hex.slice(17);
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20)}`;
}

/** A 22-character IFC GlobalId derived deterministically from the parts. */
export function stableGlobalId(...parts: string[]): string {
  return uuidToIfcGuid(stableUuid(...parts));
}

/**
 * The id of a candidate: file, storey and the sorted handles that produced
 * it. Sorting makes the id independent of the order in which strokes were
 * found, which differs between a full run and an incremental one.
 */
export function candidateId(sourceFile: string, storeyGlobalId: string | undefined, handles: readonly string[]): string {
  return stableGlobalId(sourceFile, storeyGlobalId ?? '', ...[...handles].sort());
}
