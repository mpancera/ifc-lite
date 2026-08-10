/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which project the application is currently working in.
 *
 * The point of the key is not to describe a project. It is to make the
 * BOUNDARY between two projects detectable, so that state derived inside one
 * cannot silently leak into the next. That failure mode produces wrong numbers
 * that look like filled-in fields: a height above sea level carried from one
 * building into another is still a plausible number, just not this building's.
 *
 * The key is therefore **opaque**. Not a path, not a file name, not a project
 * name — all three change while the project stays the same, and two projects
 * can share any of them. Callers compare keys and otherwise leave them alone.
 */

/** Opaque. Compare with `sameProject`; never parse. */
export type ProjectKey = string & { readonly __brand: 'ProjectKey' };

/** A prefix on generated keys, so a stray string cannot pass as one. */
const PREFIX = 'proj_';

/** Derived keys carry a second marker — see `projectKeyFromModels`. */
const DERIVED_INFIX = 'd_';

/**
 * A fresh key, for a project a person has just bound to a folder.
 *
 * Random rather than derived: this is the identity of the working context, and
 * it must survive the folder being renamed, the models being swapped out, and
 * the project being reopened tomorrow. Only a stored key does that.
 */
export function createProjectKey(): ProjectKey {
  return `${PREFIX}${randomId()}` as ProjectKey;
}

/**
 * A key derived from the loaded models, for when nobody bound a folder.
 *
 * The weaker half of the design, and deliberately kept: the viewer has to work
 * for somebody who opens it, drops a file in, and never hears the word
 * project. Without this they would have no boundary at all, and the leak this
 * whole module exists to prevent would be back.
 *
 * What it can do: notice that the set of loaded models changed, and treat that
 * as a project change. What it cannot do: recognise the same project tomorrow,
 * or survive adding a model to a federation. Those need a stored key.
 *
 * Order-independent, because federating A then B is the same project as
 * federating B then A. Returns `null` for an empty set — no models is not a
 * project, and inventing a key for it would make the empty viewer look like a
 * project that everything else could then be attributed to.
 */
export function projectKeyFromModels(fileNames: readonly string[]): ProjectKey | null {
  const cleaned = [...new Set(fileNames.map((n) => n.trim()).filter(Boolean))].sort();
  if (cleaned.length === 0) return null;

  // NUL separator, written as an escape so this file stays plain text. A file
  // name cannot contain one, so ['a b'] and ['a', 'b'] cannot join to the same
  // string and collide.
  return `${PREFIX}${DERIVED_INFIX}${hash(cleaned.join('\u0000'))}` as ProjectKey;
}

/** True when both sides mean the same project. `null` never matches `null`:
 *  two unknown projects are not thereby the same one. */
export function sameProject(a: ProjectKey | null, b: ProjectKey | null): boolean {
  return a !== null && b !== null && a === b;
}

/** Whether a key was derived from a model set rather than stored. Callers use
 *  it to explain the weaker guarantee, not to change behaviour. */
export function isDerivedKey(key: ProjectKey): boolean {
  return key.startsWith(`${PREFIX}${DERIVED_INFIX}`);
}

function randomId(): string {
  // `crypto.randomUUID` needs a secure context; the fallback keeps the viewer
  // working over plain http on a LAN, where it is only an identifier and not a
  // security boundary.
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');

  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  throw new Error('No crypto source available to generate a project key.');
}

/** FNV-1a, 32 bit, hex. Not a security primitive — this only has to separate
 *  one model set from another. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Whether a value can be trusted as a project key from outside.
 *
 * A key that arrives in a file is not a key this application made. Adopting
 * whatever a file says would let a damaged or hand-edited descriptor put two
 * different projects under one key — the exact confusion the key exists to
 * prevent, arriving through the door instead of the window.
 *
 * The derived prefix is rejected on purpose: it is how the viewer tells a
 * person that its project boundary is the weaker, model-derived kind. A stored
 * key wearing that prefix would explain a guarantee it does not have.
 */
export function isValidProjectKey(value: unknown): value is ProjectKey {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  // Long enough not to collide by accident, short enough not to be a payload.
  if (trimmed.length < 8 || trimmed.length > 128) return false;
  if (trimmed !== value) return false;
  if (trimmed.startsWith(`${PREFIX}${DERIVED_INFIX}`)) return false;

  // No whitespace or control characters: this ends up in a file name check,
  // a dialog and a comparison, and none of those want a newline in it.
  return /^[\w.:-]+$/.test(trimmed);
}
