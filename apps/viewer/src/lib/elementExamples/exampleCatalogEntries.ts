/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A synced Elementbeispiel, as an entry of the element library.
 *
 * # Why they join the same list instead of keeping their own
 * Because placing one is the same ACT. Marc's point (2026-09-16): the Add
 * Element panel already knows how to pick an element, resolve a storey from
 * where the cursor falls, snap, and drop — and an Elementbeispiel wants all of
 * that. A second placement surface beside it would mean two ways to do one
 * thing, differing only in where the geometry came from.
 *
 * So the difference travels as ONE field, `exampleUrl`. Everything that lists
 * and picks treats them alike; the placement branches once, on that field.
 *
 * # What an example cannot say in advance
 * Its size. A catalogue entry declares `geometry` so the panel can show a
 * default box and the renderer a preview; an example's extent is only known
 * once its file has been fetched, which happens at placement. The hint here is
 * therefore a PLACEHOLDER — deliberately modest, so it reads as "about this
 * big" rather than as a measurement — and it is not what gets placed. The
 * real geometry is copied from the file.
 */

import type { CatalogEntry } from '@/lib/catalog/types.js';
import { exampleFileUrl, type ElementExample } from './elementExamples.js';

/**
 * Stand-in extent, in metres, until the file itself says otherwise.
 *
 * Roughly a wall-mounted device. It drives the preview box and nothing in the
 * file: `placeExampleInStore` copies the example's own geometry.
 */
const PLACEHOLDER_EXTENT = { width: 0.2, depth: 0.2, height: 0.3 };

/**
 * Which trade a Fachklasse belongs to, for the library's colour and filter.
 *
 * A coarse reading of the IFC class, not a classification: the dictionary
 * publishes the Fachklasse, and the library's `discipline` is a UI grouping
 * this repository invented. Anything unrecognised lands in `other`, which is
 * honest — better than guessing `fire` for everything because most examples
 * happen to be fire today.
 */
function disciplineOf(entity: string, predefinedType: string | null): CatalogEntry['discipline'] {
  const klass = `${entity}.${predefinedType ?? ''}`.toUpperCase();
  if (/FIRE|SMOKE|HEAT|FLAME|ALARM|SPRINKLER|EXTINGUISH|BREAKGLASS|MANUALPULL/.test(klass)) {
    return 'fire';
  }
  if (/CAMERA|AUDIOVISUAL/.test(klass)) return 'security';
  if (/MOVEMENT|CONTACT|GLASSBREAK|INTRUS/.test(klass)) return 'intrusion';
  if (/SENSOR|CONTROLLER|ACTUATOR/.test(klass)) return 'automation';
  return 'other';
}

/** One synced example as a library entry. */
export function exampleToCatalogEntry(example: ElementExample, listUrl: string): CatalogEntry {
  return {
    // Prefixed so it can never collide with a company catalogue's own ids, and
    // so a glance at a placed element's `ElementType` says where it came from.
    id: `beispiel.${example.id}`,
    label: example.name,
    description: `Produktneutrales Elementbeispiel aus dem Swiss Data Dictionary (${example.organisation}).`,
    discipline: disciplineOf(example.entity, example.predefinedType),
    category: 'elementbeispiel',
    ifc: {
      entity: example.entity,
      predefinedType: example.predefinedType ?? undefined,
    },
    geometry: { ...PLACEHOLDER_EXTENT },
    // Not guessed from the class: the dictionary does not publish a mounting,
    // and `ceiling` is what the panel defaults to anyway.
    mounting: 'ceiling',
    exampleUrl: exampleFileUrl(listUrl, example.id),
    provenance: {
      source: 'dictionary-example',
      sourceRef: example.entity + (example.predefinedType ? `.${example.predefinedType}` : ''),
    },
  };
}

/** The whole synced list as library entries. */
export function examplesToCatalogEntries(
  examples: readonly ElementExample[],
  listUrl: string,
): CatalogEntry[] {
  return examples.map((example) => exampleToCatalogEntry(example, listUrl));
}
