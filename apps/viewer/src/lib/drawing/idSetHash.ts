/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A fingerprint for a set of element ids, used to decide whether a 2D drawing
 * has to be rebuilt.
 *
 * Lives in its own module rather than beside the hook that uses it: a file
 * exporting both a hook and a plain function makes React Fast Refresh give up
 * on that module, so edits to it are not picked up by a running dev session
 * without a full reload — which silently invalidated a round of live testing.
 */

/**
 * An order-independent fingerprint of a set of element ids.
 *
 * Order-independent because `Set` iteration follows insertion order, and the
 * same set can be built in a different order by a different code path — a
 * fingerprint that moved then would rebuild the drawing for nothing.
 *
 * Each id is SCRAMBLED before it is combined. Summing or XOR-ing raw ids is
 * linear, and express ids are small consecutive integers, which is the worst
 * possible input for that: `{1,6}` and `{3,4}` share both their sum and their
 * XOR. Multiplying by a large odd constant and folding the high bits back in
 * destroys that structure while staying commutative.
 *
 * `null` — "no isolation at all" — is deliberately distinct from an empty set,
 * which would mean "isolate nothing" and draw nothing.
 */
export function hashIdSet(ids: ReadonlySet<number> | null | undefined): string {
  if (!ids) return 'none';
  let sum = 0;
  let xor = 0;
  for (const id of ids) {
    // Knuth's multiplicative constant, then a shift-fold so neighbouring ids
    // land far apart. Commutative, so set order still does not matter.
    let m = Math.imul(id, 2654435761) >>> 0;
    m = (m ^ (m >>> 13)) >>> 0;
    sum = (sum + m) >>> 0;
    xor = (xor ^ m) >>> 0;
  }
  return `${ids.size}:${sum}:${xor}`;
}
