/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Download prebuilt @ifc-lite/wasm from npm when Rust/wasm-pack is unavailable.
 * Useful for Windows dev setups without WSL or a Rust toolchain.
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const wasmPkgJson = JSON.parse(
  readFileSync(join(rootDir, 'packages/wasm/package.json'), 'utf8'),
);
const version = wasmPkgJson.version;
const tarball = `@ifc-lite/wasm@${version}`;

const wasmOut = join(rootDir, 'packages/wasm/pkg');

/** What the prebuilt package actually contributes: the runtime, nothing else. */
const RUNTIME_FILES = ['ifc-lite.js', 'ifc-lite_bg.wasm'];
const wasmFile = join(wasmOut, 'ifc-lite_bg.wasm');

if (existsSync(wasmFile)) {
  console.log(`Prebuilt WASM already present at ${wasmFile}`);
  process.exit(0);
}

console.log(`Fetching ${tarball} from npm…`);
const tgzName = execSync(`npm pack ${tarball}`, {
  cwd: rootDir,
  encoding: 'utf8',
}).trim();

const extractDir = join(rootDir, '.wasm-fetch-tmp');
rmSync(extractDir, { recursive: true, force: true });
mkdirSync(extractDir, { recursive: true });

// Paths stay RELATIVE to the cwd set below. GNU tar -- which is what Git Bash
// and MSYS put on PATH -- reads an archive name containing a colon as
// `host:path` and tries to fetch it over the network, so an absolute Windows
// path fails with a bare status 2 and no useful message.
execSync(`tar -xzf ${JSON.stringify(tgzName)} -C ${JSON.stringify(relative(rootDir, extractDir))}`, {
  cwd: rootDir,
  stdio: 'inherit',
});

mkdirSync(wasmOut, { recursive: true });

// The RUNTIME only. `pkg/ifc-lite.d.ts` is committed (force-added past the
// wasm-pack `pkg/.gitignore`) and CI diffs it exactly; the npm tarball carries
// an unstripped copy, so copying the whole directory dirties a tracked file on
// every fetch -- and whoever commits next has changed the published type
// surface without touching a Rust source.
const pkgDir = join(extractDir, 'package/pkg');
for (const file of RUNTIME_FILES) {
  cpSync(join(pkgDir, file), join(wasmOut, file), { force: true });
}

rmSync(extractDir, { recursive: true, force: true });
rmSync(join(rootDir, tgzName), { force: true });

console.log(`Installed prebuilt WASM to ${wasmOut}`);
