/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The catalogue of Fachklassen — which classes an element is allowed to be.
 *
 * A "Fachklasse" is an IFC entity plus its `PredefinedType`, and where that is
 * `USERDEFINED`, an `ObjectType` (Marc, 2026-08-13). `IfcSensor` alone is not
 * one; `IfcSensor.FIRESENSOR` is. That is the unit an author picks, and the
 * unit this catalogue lists.
 *
 * # Why this is not the product catalogue
 * `lib/catalog/` already exists and answers a different question: "what can I
 * PLACE" — a detector with a size, a mounting, technical data. This answers
 * "what may this element BE", and its entries carry no geometry because a
 * classification has none. The two meet at `CatalogIfcMapping`, which is the
 * same three fields; a product's entry names a Fachklasse, it does not replace
 * the list of them.
 *
 * # Where it comes from
 * The dictionary this repository's author publishes, at `data-dictionary.ch`
 * (1330 classes at the time
 * of writing), fetched ON DEMAND from a settings action and kept locally. Not
 * on every start: it changes on the scale of weeks, and a viewer that reaches
 * out to the network to open a file is a viewer that fails to open a file when
 * the network is down.
 *
 * Other catalogues, and letting the user point at one, are deliberately NOT
 * built yet — parked with Marc's agreement until the one that exists is
 * useful.
 */

/** One Fachklasse: an entity, a predefined type, and what to call it. */
export interface ClassCatalogEntry {
  /** `Entity.PREDEFINEDTYPE`, the dictionary's own identifier. */
  readonly id: string;
  /** IFC entity name, e.g. `IfcSensor`. */
  readonly entity: string;
  /** Enum value without dots, e.g. `FIRESENSOR`. `null` where the entity has none. */
  readonly predefinedType: string | null;
  /** Only meaningful where `predefinedType` is `USERDEFINED`. */
  readonly objectType: string | null;
  /** What a person calls it, in the dictionary's language. */
  readonly label: string;
  readonly definition: string;
  /** The dictionary's own lifecycle word — `active`, `proposed`, … */
  readonly status: string;
  /** Alternative names, which is most of what makes searching work. */
  readonly synonyms: readonly string[];
}

export interface ClassCatalog {
  readonly entries: readonly ClassCatalogEntry[];
  /** When this copy was fetched, so the settings page can say how old it is. */
  readonly fetchedAt: string;
  /** Where from, so a later second source is distinguishable from this one. */
  readonly source: string;
}

/** Marc's dictionary. One address, in one place, so it is changed once. */
export const DEFAULT_CLASS_CATALOG_URL = 'https://data-dictionary.ch/data/local-classes.json';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read a dictionary export into entries, skipping anything unusable.
 *
 * Skipping rather than failing: a catalogue is a living document, and one
 * malformed entry out of thirteen hundred should cost that entry and not the
 * whole sync. An entry with no entity cannot classify anything, so that is the
 * one thing required.
 *
 * The shape is the dictionary's: a top-level object whose `classes` is a MAP
 * from id to entry, not an array. Accepting an array too costs one line and
 * covers the day somebody exports it the other way.
 */
export function parseClassCatalog(
  payload: unknown,
  source = DEFAULT_CLASS_CATALOG_URL,
  fetchedAt = new Date().toISOString(),
): ClassCatalog | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = (payload as Record<string, unknown>).classes ?? payload;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null ? Object.values(raw) : null;
  if (!list) return null;

  const entries: ClassCatalogEntry[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const entity = text(record.entity);
    if (!entity) continue;

    const predefinedType = text(record.predefinedType) || null;
    entries.push({
      id: text(record.id) || (predefinedType ? `${entity}.${predefinedType}` : entity),
      entity,
      predefinedType,
      objectType: text(record.objectType) || null,
      label: text(record.label) || entity,
      definition: text(record.definition),
      status: text(record.status) || 'unknown',
      synonyms: Array.isArray(record.synonyms)
        ? record.synonyms.map(text).filter((s) => s.length > 0)
        : [],
    });
  }

  return entries.length > 0 ? { entries, fetchedAt, source } : null;
}

/**
 * The entries a search term matches, best first.
 *
 * Thirteen hundred classes is a list nobody scrolls, so the search is the
 * interface. It matches the LABEL, the entity and the synonyms, because those
 * are the three names a person might reach for — an author looking for a smoke
 * detector may type "Rauchmelder", "detector" or "IfcSensor" and should not
 * have to know which one this dictionary chose.
 *
 * Ranked by where the match falls: a label that STARTS with the term beats one
 * that merely contains it, and both beat a synonym. Without that, typing "Tür"
 * buries `Tür` under `Türblatt`, `Türzarge` and everything else containing it.
 *
 * The last tier matches the other way round — a LABEL contained in the term.
 * German builds its words by compounding, so a model that calls something a
 * `Deckenleuchte` is looking for the catalogue's `Leuchte`, and a search that
 * only ever asks whether the label contains the term finds nothing at all for
 * every compound an author ever wrote. Short labels are held back from this,
 * because a three-letter word appears inside half the language.
 */
const MIN_COMPOUND_LABEL = 4;
/** Rank of the compound tier, referenced by the tie-break below. */
const COMPOUND_SCORE = 6;
export function searchClassCatalog(
  catalog: ClassCatalog | null,
  query: string,
  limit = 50,
): ClassCatalogEntry[] {
  if (!catalog) return [];
  const term = query.trim().toLowerCase();
  if (!term) return catalog.entries.slice(0, limit);

  const scored: { entry: ClassCatalogEntry; score: number }[] = [];
  for (const entry of catalog.entries) {
    const label = entry.label.toLowerCase();
    const entity = entry.entity.toLowerCase();

    let score = -1;
    if (label.startsWith(term)) score = 0;
    else if (entity.startsWith(term)) score = 1;
    else if (label.includes(term)) score = 2;
    else if (entity.includes(term)) score = 3;
    else if (entry.id.toLowerCase().includes(term)) score = 4;
    else if (entry.synonyms.some((s) => s.toLowerCase().includes(term))) score = 5;
    else if (label.length >= MIN_COMPOUND_LABEL && term.includes(label)) score = COMPOUND_SCORE;

    if (score >= 0) scored.push({ entry, score });
  }

  // Within the compound tier the longer label wins: `Deckenleuchte` contains
  // both `Decke` and `Leuchte`, and the one that accounts for more of the word
  // is the one that was meant. Everywhere else the tie is broken by name, so
  // the order does not depend on how the catalogue happens to be stored.
  scored.sort((a, b) => a.score - b.score
    || (a.score === COMPOUND_SCORE ? b.entry.label.length - a.entry.label.length : 0)
    || a.entry.label.localeCompare(b.entry.label));
  return scored.slice(0, limit).map((s) => s.entry);
}

/** `IfcSensor.FIRESENSOR` as `Rauchmelder · IfcSensor.FIRESENSOR`. */
export function describeClass(entry: ClassCatalogEntry): string {
  return entry.label === entry.entity ? entry.id : `${entry.label} · ${entry.id}`;
}
