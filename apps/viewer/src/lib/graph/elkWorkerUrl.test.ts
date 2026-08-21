/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A guard on how the ELK worker's address is obtained.
 *
 * This is a source-shape test rather than a behaviour test, and deliberately
 * so: the bug it guards against CANNOT be reproduced by running the app the way
 * these tests run it, or by opening the dev server. It only exists in a
 * production build.
 *
 * What happened: the worker was addressed with `new URL(…, import.meta.url)`,
 * which asks Vite to bundle the file as a worker. This app sets
 * `worker.format: 'es'` because the geometry and wasm workers need it, so the
 * built asset came out as an ES module — and `new Worker(url)` starts a CLASSIC
 * worker, which died on the first `export` it saw. Dev served the original file
 * and was fine; every deployed build had no graph at all.
 *
 * `?url` copies the file verbatim and never asks the format question.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./layout.ts', import.meta.url)), 'utf8');

describe('the ELK worker asset', () => {
  it('is addressed with ?url, so the bundler leaves it alone', () => {
    assert.match(source, /from 'elkjs\/lib\/elk-worker\.min\.js\?url'/);
  });

  it('is not handed to Vite as a worker to bundle', () => {
    // `new URL(…, import.meta.url)` around the worker is the exact shape that
    // produced an ES-module worker in the build. Any other `new URL` is fine.
    assert.doesNotMatch(source, /new URL\(\s*['"][^'"]*elk-worker[^'"]*['"]/);
  });

  it('starts a classic worker, matching the file it now gets', () => {
    // The file is a compiled GWT bundle; `{ type: 'module' }` here fails at
    // runtime rather than at build time, which is its own kind of expensive.
    assert.match(source, /new Worker\(elkWorkerUrl\)/);
  });
});
