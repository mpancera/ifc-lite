/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Elementbeispiele — product-NEUTRAL reference objects, published as IFC.
 *
 * # Why this is a third thing, next to two catalogues that already exist
 * `lib/catalog/` answers "what can I place": a product, with a size, a
 * mounting, technical data, and — increasingly — an AAS behind it. That is a
 * COMPANY's catalogue, and its entries name real articles.
 * `lib/classCatalog/` answers "what may this element be": a classification,
 * which has no geometry at all.
 *
 * An Elementbeispiel answers a third question: "what does one of these look
 * like, when nobody has chosen a product yet". It is a small, complete IFC
 * object — geometry, attributes, properties, its 2D plan symbol, and the
 * virtual bodies that carry a clearance or a detection area — published by the
 * dictionary for a whole Fachklasse rather than for an article number. It is
 * what belongs in a model during design, before the procurement decision that
 * the Firmenbibliothek presumes.
 *
 * So the two are not rivals and one does not grow into the other: they answer
 * to different moments in a project. Keeping them apart is why the Product
 * Library shows them as separate tabs rather than merging the rows.
 *
 * # Fetched only when asked
 * Same rule as the class catalogue: opening the tab is the asking. A viewer
 * that reaches out to the network to open a file is a viewer that fails to
 * open a file when the network is down.
 */

/** One published example, as the list endpoint reports it. */
export interface ElementExample {
  /** The dictionary's own id, also the filename: `<id>.ifc`. */
  readonly id: string;
  /** What a person calls it, in the dictionary's language. */
  readonly name: string;
  /** IFC entity, e.g. `IfcSensor`. */
  readonly entity: string;
  /** Enum value without dots, `null` where the entity has none. */
  readonly predefinedType: string | null;
  /** Who publishes it — the dictionary is multi-tenant. */
  readonly organisation: string;
  /** ISO date of the last change, so a stale copy is visible as stale. */
  readonly changed: string;
  /**
   * How many bodies the example is built from.
   *
   * Carried because it is the one honest hint about an example's substance
   * that costs nothing: the list deliberately does NOT ship each example's
   * Bauplan (thirty examples would mean thirty construction plans for an
   * overview that shows names).
   */
  readonly parts: number;
}

export interface ElementExampleCatalog {
  readonly entries: readonly ElementExample[];
  /** When this copy was fetched, so the panel can say how old it is. */
  readonly fetchedAt: string;
  /** Where from, so a later second source is distinguishable from this one. */
  readonly source: string;
}

/** Marc's dictionary. One address, in one place, so it is changed once. */
export const DEFAULT_ELEMENT_EXAMPLES_URL = 'https://data-dictionary.ch/public/elementbeispiele';

/** The IFC file of one example, at the same origin as the list. */
export function exampleFileUrl(listUrl: string, id: string): string {
  const base = listUrl.endsWith('/') ? listUrl : `${listUrl}/`;
  return new URL(encodeURIComponent(id) + '.ifc', base).href;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read the dictionary's list into entries, skipping anything unusable.
 *
 * Skipping rather than failing, for the same reason the class catalogue does
 * it: a catalogue is a living document, and one malformed entry should cost
 * that entry and not the whole list. An entry with no id cannot be fetched and
 * one with no entity cannot be placed, so those two are required.
 *
 * The German field names are the dictionary's, and they stop here. Everything
 * above this line is this repository's vocabulary; a reader of the panel or of
 * the placement code should not have to know what `predefinedType` was called
 * on the wire.
 */
export function parseElementExamples(
  payload: unknown,
  source: string,
): ElementExampleCatalog | null {
  const list = (payload as { elementbeispiele?: unknown })?.elementbeispiele;
  if (!Array.isArray(list)) return null;

  const entries: ElementExample[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const id = text(row.id);
    const entity = text(row.klasse);
    if (!id || !entity) continue;
    entries.push({
      id,
      name: text(row.name) || id,
      entity,
      predefinedType: text(row.predefinedType) || null,
      organisation: text(row.organisation),
      changed: text(row.geaendert),
      parts: typeof row.teile === 'number' && Number.isFinite(row.teile) ? row.teile : 0,
    });
  }

  return { entries, fetchedAt: new Date().toISOString(), source };
}
