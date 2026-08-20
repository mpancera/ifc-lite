#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/**
 * Two guards on how packages declare their scripts.
 *
 * 1. Every workspace package that contains test files must have a `test`
 *    script, otherwise `turbo test` silently skips it and the suite never runs
 *    in CI (this happened to @ifc-lite/ifcx and @ifc-lite/renderer — 13 test
 *    files dark for months).
 *
 * 2. No package script may use shell command substitution. CI runs on Linux,
 *    where `$(find …)` works, so a script written that way passes every gate
 *    while being unrunnable for anyone on Windows: npm hands the line to
 *    `cmd.exe`, which does not know the syntax and stops at the first token it
 *    cannot parse. `apps/viewer` shipped exactly that — its 583-file test suite
 *    could not be started at all on a Windows checkout, and nothing in CI could
 *    notice, because the platform that would notice is the one that cannot run
 *    it. Pass the pattern to the runner instead (`node --test` expands globs
 *    itself) and every platform gets the same list.
 *
 * Run via `pnpm check:test-wiring` (wired into the CI node-test job).
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repository, or a fixture standing in for one.
 *
 * `--root` exists so the guard's own tests can point it at a throwaway tree.
 * A guard that is only ever run against the real repo is asserted by nothing:
 * it prints a tick either because it works or because it silently found no
 * packages, and those two look identical from the outside.
 */
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag >= 0
  ? process.argv[rootFlag + 1]
  : join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIRS = ['packages', 'apps'];
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|js|mjs)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'pkg', 'build', 'coverage', '.turbo']);

function findTestFiles(dir, found = []) {
  if (found.length > 0) return found; // one hit is enough
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      findTestFiles(full, found);
      if (found.length > 0) return found;
    } else if (TEST_FILE_RE.test(entry)) {
      found.push(full);
      return found;
    }
  }
  return found;
}

const offenders = [];
const unportable = [];
let scriptCount = 0;

/**
 * Command substitution, in both spellings. Deliberately narrow: `&&`, `||` and
 * redirection all work under cmd.exe, so flagging those would be noise. This
 * matches the one construct that passes CI and cannot run on Windows at all.
 */
const SUBSTITUTION_RE = /\$\(|`/;

for (const parent of PACKAGE_DIRS) {
  const parentDir = join(ROOT, parent);
  if (!existsSync(parentDir)) continue;
  for (const name of readdirSync(parentDir)) {
    const pkgDir = join(parentDir, name);
    const pkgJsonPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    for (const [script, command] of Object.entries(pkgJson.scripts ?? {})) {
      scriptCount += 1;
      if (typeof command === 'string' && SUBSTITUTION_RE.test(command)) {
        unportable.push({ name: pkgJson.name ?? `${parent}/${name}`, script, command });
      }
    }
    if (pkgJson.scripts?.test) continue;
    const testFiles = findTestFiles(pkgDir);
    if (testFiles.length > 0) {
      offenders.push({ name: pkgJson.name ?? `${parent}/${name}`, example: testFiles[0].slice(ROOT.length + 1) });
    }
  }
}

if (offenders.length > 0) {
  console.error('❌ Packages with test files but no `test` script (these tests NEVER run in CI):\n');
  for (const { name, example } of offenders) {
    console.error(`   ${name}  (e.g. ${example})`);
  }
  console.error('\nAdd a `test` script to the package.json (vitest run / tsx --test) or remove the dead test files.');
  process.exit(1);
}

if (unportable.length > 0) {
  console.error('❌ Package scripts using shell command substitution (these cannot run on Windows):\n');
  for (const { name, script, command } of unportable) {
    console.error(`   ${name} → ${script}: ${command}`);
  }
  console.error(
    '\ncmd.exe does not understand `$(…)` or backticks, so npm/pnpm stops at the'
    + '\nfirst token it cannot parse. CI is Linux and cannot catch this.'
    + '\nPass the pattern to the tool instead — `node --test "src/**/*.test.ts"`'
    + '\nexpands globs itself — or move the logic into a .mjs script.',
  );
  process.exit(1);
}

console.log(`✅ All packages with test files have a test script, and ${scriptCount} scripts are shell-portable.`);
