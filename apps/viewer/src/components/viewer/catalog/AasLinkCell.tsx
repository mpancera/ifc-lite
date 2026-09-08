/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The AAS link of a product, as shown in a table cell.
 *
 * Three states, all of them meaningful and none of them an error:
 *   - no link: the product carries no Asset Administration Shell. Shown as a
 *     dash, not a warning — most products do not have one today.
 *   - a link that can be opened: an http(s) address, offered as a link.
 *   - a link that cannot: a `urn:`, a bare id, or an IRI-shaped identifier.
 *     Shown as text, because an AAS address is explicitly "URL **or**
 *     reference ID" and pretending an identifier is a destination produces a
 *     link that reliably goes nowhere.
 *
 * # On the privacy gate
 * This renders an anchor; it issues no request of its own. Following it is the
 * user's own click — which is exactly the "explicit, per-use action" that
 * `lib/privacy/externalRequests.ts` describes as the alternative to the gate,
 * rather than something the gate is meant to stop. An AAS client that fetches
 * on its own behalf is a different matter and must ask the gate first.
 */

import { ExternalLink } from 'lucide-react';
import { isOpenableAasAddress, type AasLink } from '@/lib/aas/connectorPset';

interface AasLinkCellProps {
  link: AasLink | null | undefined;
}

/** The `AASType` + version suffix, e.g. `Type · v1.4`, or just the kind. */
function subtitle(link: AasLink): string {
  return link.versionNumber ? `${link.kind} · v${link.versionNumber}` : link.kind;
}

export function AasLinkCell({ link }: AasLinkCellProps) {
  if (!link) {
    return <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">—</span>;
  }

  const label = (
    <>
      <span className="block max-w-[22ch] truncate">{link.address}</span>
      <span className="block text-[9px] text-zinc-400 dark:text-zinc-600">{subtitle(link)}</span>
    </>
  );

  if (!isOpenableAasAddress(link.address)) {
    return (
      <span
        className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400"
        title={`${link.address} — an identifier, not a reachable address`}
      >
        {label}
      </span>
    );
  }

  return (
    <a
      href={link.address}
      target="_blank"
      rel="noopener noreferrer"
      title={link.address}
      className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-start gap-1"
    >
      <ExternalLink className="h-3 w-3 shrink-0 mt-[1px]" />
      <span className="min-w-0">{label}</span>
    </a>
  );
}
