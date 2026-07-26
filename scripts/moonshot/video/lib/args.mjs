/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Argument parsing for the video pipelines.
 *
 * Both `--key=value` and `--key value` are accepted. The pipelines' usage
 * strings documented the space-separated form while an earlier parser only
 * split on `=`, so `--out DIR` silently bound `out` to `true` and the run
 * crashed inside `path.resolve` (or produced NaN counts). Supporting both
 * removes the trap rather than documenting around it.
 *
 * Boolean flags (`--headed`, `--no-video`) take no value: a following token is
 * only consumed as a value when the flag is not declared boolean.
 */

/**
 * @param {string[]} argv raw args, usually process.argv.slice(2)
 * @param {{booleans?: string[], known?: string[]}} [opts]
 *   booleans: flags that never take a value.
 *   known: when given, an unrecognized `--flag` is a fatal usage error.
 * @returns {Record<string, string|boolean>}
 */
export function parseArgs(argv, opts = {}) {
  const booleans = new Set(opts.booleans ?? []);
  const known = opts.known ? new Set([...opts.known, ...booleans]) : null;
  const out = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new UsageError(`unexpected argument "${token}" (flags take the form --key=value or --key value)`);
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);

    if (known && !known.has(key)) {
      throw new UsageError(`unknown flag "--${key}" (known: ${[...known].sort().map((k) => `--${k}`).join(', ')})`);
    }

    if (eq !== -1) {
      out[key] = body.slice(eq + 1);
      continue;
    }
    if (booleans.has(key)) {
      out[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

/** Parse a positive integer flag, failing loudly instead of yielding NaN. */
export function intArg(args, key, fallback) {
  const raw = args[key];
  if (raw === undefined) return fallback;
  if (raw === true) throw new UsageError(`--${key} needs a value (e.g. --${key}=${fallback})`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new UsageError(`--${key} must be a positive integer, got "${raw}"`);
  }
  return n;
}

/** Parse a path-ish flag, rejecting the valueless form. */
export function stringArg(args, key, fallback) {
  const raw = args[key];
  if (raw === undefined) return fallback;
  if (raw === true) throw new UsageError(`--${key} needs a value`);
  return raw;
}

export class UsageError extends Error {}

/** Print the message plus usage to stderr and exit 2. */
export function failUsage(err, usage) {
  process.stderr.write(`error: ${err.message}\n\n${usage}\n`);
  process.exit(2);
}
