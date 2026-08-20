/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The guard, run against throwaway trees.
 *
 * Pointing it at the real repository proves nothing: it prints a tick both
 * when it works and when it quietly matched nothing, and those are the same
 * output. Each case here builds a tree with exactly one defect in it and
 * checks the guard both fails AND names it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKER = join(dirname(fileURLToPath(import.meta.url)), 'check-test-wiring.mjs');

/** Build a tree of `packages/<name>` from `{name: {scripts, testFiles}}`. */
function fixture(packages) {
  const root = mkdtempSync(join(tmpdir(), 'test-wiring-'));
  for (const [name, spec] of Object.entries(packages)) {
    const dir = join(root, 'packages', name);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, scripts: spec.scripts ?? {} }));
    for (const file of spec.testFiles ?? []) writeFileSync(join(dir, 'src', file), '');
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [CHECKER, '--root', root], { encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('check-test-wiring', () => {
  it('passes a package that is wired correctly', () => {
    const root = fixture({ good: { scripts: { test: 'vitest run' }, testFiles: ['a.test.ts'] } });
    try {
      const { status, output } = run(root);
      assert.equal(status, 0, output);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('fails a package whose tests no runner would ever start', () => {
    const root = fixture({ dark: { scripts: { build: 'tsc' }, testFiles: ['a.test.ts'] } });
    try {
      const { status, output } = run(root);
      assert.equal(status, 1, 'test files with no test script were accepted');
      assert.match(output, /dark/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('fails a script that only a POSIX shell can run', () => {
    // The apps/viewer defect, reduced: valid on the CI platform, unrunnable
    // for every Windows contributor, and invisible to every other gate.
    const root = fixture({
      posixonly: {
        scripts: { test: "tsx --test $(find src -name '*.test.ts')" },
        testFiles: ['a.test.ts'],
      },
    });
    try {
      const { status, output } = run(root);
      assert.equal(status, 1, 'command substitution was accepted');
      assert.match(output, /posixonly/);
      assert.match(output, /Windows/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('fails backtick substitution too, not just the $() spelling', () => {
    const root = fixture({ backticks: { scripts: { test: 'tsx --test `ls src`' } } });
    try {
      const { status } = run(root);
      assert.equal(status, 1, 'backtick substitution was accepted');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('leaves alone the shell operators that cmd.exe does understand', () => {
    // A guard that also rejected these would be noise, and noise gets disabled.
    const root = fixture({
      fine: {
        scripts: {
          test: 'vitest run && node scripts/after.mjs',
          build: 'tsc --noEmit || echo failed',
          clean: 'rimraf dist > log.txt',
        },
        testFiles: ['a.test.ts'],
      },
    });
    try {
      const { status, output } = run(root);
      assert.equal(status, 0, output);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('reads the real repository without finding a defect', () => {
    // The regression test for the fix itself: apps/viewer's test script used
    // `$(find …)` and could not be started on Windows at all.
    const { status, output } = run(join(dirname(fileURLToPath(import.meta.url)), '..'));
    assert.equal(status, 0, output);
  });
});
