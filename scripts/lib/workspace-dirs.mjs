/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where pnpm thinks the workspace members are.
 *
 * # Why ask pnpm instead of reading the globs
 * `pnpm-workspace.yaml` is the input, not the answer: pnpm applies its own
 * exclusions and its own glob dialect, and a second implementation here would
 * disagree with it on exactly the edge cases the guards that call this exist to
 * catch. Asking the tool means this cannot drift from it.
 *
 * # Why two spellings of one command
 * On Windows `pnpm` is `pnpm.cmd`. `execFile` does not consult PATHEXT, so the
 * bare name is ENOENT there; and since Node 20.12 a `.cmd` cannot be spawned
 * without a shell at all (EINVAL, the CVE-2024-27980 fix). Both guards that
 * call this had their own copy of the argv form, so `pnpm lint` died on every
 * Windows checkout before oxlint had run once -- twice over, in two scripts.
 * CI keeps the argv form, so the platform that gates PRs is untouched.
 */

import { execFileSync, execSync } from 'node:child_process';

const SCRIPT = 'console.log(process.cwd())';

/**
 * Absolute directories of the workspace members, deduplicated, unfiltered.
 * Callers narrow it themselves — they do not want the same subset.
 */
export function workspaceDirs(repoRoot) {
  const opts = { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 };
  const out = process.platform === 'win32'
    // The quotes are load-bearing: cmd.exe splits the argument on the
    // parentheses otherwise, and node is handed an unterminated expression.
    ? execSync(`pnpm -r exec node -e "${SCRIPT}"`, opts)
    : execFileSync('pnpm', ['-r', 'exec', 'node', '-e', SCRIPT], opts);
  return [...new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))];
}
