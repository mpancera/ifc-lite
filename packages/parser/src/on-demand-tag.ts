/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Give an entity table a `getTag`, resolved from the source on first ask.
 *
 * # Why the table does not simply have one
 * `Tag` is not one of the columns the parse fills in. It is cheap to skip and
 * most models never look at it, so the columnar pass leaves it out and the
 * server-parsed payload carries it as a real column instead. The result was a
 * `getTag` that existed on one parse path and not the other, and every reader
 * that wanted a tag had to know which store it was holding. Two of them did
 * not: a detector's number reached the plan and the DXF when the device had
 * been placed in this session, and vanished when the same model was reopened
 * from disk.
 *
 * # Why on demand and cached, rather than a column
 * Filling a Tag column at parse time costs one extra decode for every entity
 * in the file to serve a question asked about a few hundred of them. This
 * decodes the one record asked for and remembers the answer, so a list column
 * over ten thousand rows pays once per row and a repeat render pays nothing.
 *
 * A table that already has a real `getTag` — the server path — is left alone.
 */

import { EntityExtractor } from './entity-extractor.js';
import type { EntityByIdIndex } from './columnar-parser-indexes.js';
import type { IfcSourceBytes } from './source-bytes.js';
import { extractRootAttributesFromEntity } from './columnar-parser-root-attributes.js';

export function attachOnDemandTag(
    entities: { getTag?(expressId: number): string },
    byId: EntityByIdIndex,
    source: Uint8Array | IfcSourceBytes,
): void {
    if (entities.getTag) return;

    const cache = new Map<number, string>();
    // One extractor for the whole table: it holds nothing but the buffer.
    let extractor: EntityExtractor | null = null;

    entities.getTag = (expressId: number): string => {
        const cached = cache.get(expressId);
        if (cached !== undefined) return cached;

        const ref = byId.get(expressId);
        let tag = '';
        if (ref) {
            extractor ??= new EntityExtractor(source);
            const entity = extractor.extractEntity(ref);
            // A record that will not parse answers '' and is remembered as '',
            // so a broken line is re-decoded once rather than on every render.
            if (entity) tag = extractRootAttributesFromEntity(entity).tag;
        }
        cache.set(expressId, tag);
        return tag;
    };
}
