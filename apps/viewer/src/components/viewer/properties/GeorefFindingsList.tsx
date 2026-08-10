/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Renders georeferencing plausibility findings at the top of the panel.
 *
 * Placed above the editable fields on purpose: a wrong coordinate looks
 * exactly like a right one in a list of numbers, so the reason to doubt it has
 * to arrive before the numbers do.
 */

import { AlertTriangle, AlertOctagon } from 'lucide-react';
import type { GeorefFinding } from '@/lib/geo/georef-validation';

export function GeorefFindingsList({ findings }: { findings: GeorefFinding[] }) {
  if (findings.length === 0) return null;

  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-900 border-b border-zinc-100 dark:border-zinc-900">
      {findings.map(finding => {
        const isError = finding.severity === 'error';
        const Icon = isError ? AlertOctagon : AlertTriangle;
        return (
          <div
            key={finding.code}
            className={`px-3 py-2 flex items-start gap-1.5 ${
              isError
                ? 'bg-red-50/60 dark:bg-red-950/20'
                : 'bg-amber-50/50 dark:bg-amber-950/20'
            }`}
          >
            <Icon
              className={`h-3 w-3 mt-0.5 shrink-0 ${
                isError ? 'text-red-600 dark:text-red-400' : 'text-amber-500'
              }`}
            />
            <span
              className={`text-[10px] leading-snug ${
                isError ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              <strong>{finding.title}.</strong> {finding.detail}
            </span>
          </div>
        );
      })}
    </div>
  );
}
