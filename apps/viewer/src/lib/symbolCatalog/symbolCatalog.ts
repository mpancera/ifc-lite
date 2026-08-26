/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which drawing symbol a Fachklasse gets, and on which plan product.
 *
 * The counterpart to `lib/classCatalog`, keyed the same way and fetched from
 * the same place. That catalogue answers "what may this element BE"; this one
 * answers "how is it DRAWN".
 *
 * # Why the symbols are not in this repository
 * The fire-safety symbols follow the Swiss VKF specification, whose drawings
 * are under copyright. This fork is public, so shipping them here is not an
 * option. They live beside the class dictionary on the author's own
 * infrastructure and are fetched on demand, exactly like `local-classes.json`
 * — which also means a correction to a symbol reaches every viewer without
 * anybody releasing a new build.
 *
 * # An entry without a drawing is a normal state
 * The catalogue is expected to exist BEFORE the drawings do: the useful first
 * step is the list of what needs a symbol at all, and which Fachklasse each one
 * belongs to. So `symbol` may be empty, and such an entry is kept rather than
 * dropped — it still says the class is meant to carry a symbol, which is
 * exactly what a "what is still missing" view needs to report.
 */

/** Where the catalogue lives. One address, in one place, so it changes once. */
export const DEFAULT_SYMBOL_CATALOG_URL = 'https://data-dictionary.ch/data/local-symbols.json';

/** Where a single drawing lives, given its `symbol` name. */
export function symbolDrawingUrl(
  symbol: string,
  catalogUrl = DEFAULT_SYMBOL_CATALOG_URL,
): string {
  // Derived from the catalogue's own address rather than hard-coded a second
  // time: pointing the viewer at a staging dictionary must move the drawings
  // with it, or it would mix one catalogue's list with another's pictures.
  const base = catalogUrl.replace(/\/[^/]*$/, '');
  return `${base}/symbols/${encodeURIComponent(symbol)}.svg`;
}

/** One Fachklasse and the symbol it is drawn with. */
export interface SymbolCatalogEntry {
  /**
   * The Fachklasse: `Entity.PREDEFINEDTYPE`, and where that is `USERDEFINED`,
   * `Entity.USERDEFINED.ObjectType`. The same key `local-classes.json` uses —
   * that identity is what lets the two catalogues be joined at all.
   */
  readonly id: string;
  /**
   * Drawing file name without extension, or `null` where none is drawn yet.
   *
   * `null` rather than an empty string so that "no drawing" is a state a
   * caller has to handle rather than one it can accidentally render.
   */
  readonly symbol: string | null;
  /** What the legend says. */
  readonly label: string;
  /**
   * Which plan products show this symbol. Empty means every product — a
   * symbol nobody restricted is not a symbol nobody uses.
   */
  readonly products: readonly string[];
  /**
   * This drawing is used by permission and its source has to be named
   * wherever it is shown.
   *
   * On the ENTRY rather than only on the catalogue, because a catalogue may
   * hold drawings from two sources and only one of them may carry terms. A
   * plan that draws none of them owes nobody a credit line, and a credit for
   * a source that is not on the sheet is just noise.
   */
  readonly attributionRequired?: boolean;
}

export interface SymbolCatalog {
  readonly entries: readonly SymbolCatalogEntry[];
  /** When this copy was fetched, so settings can say how old it is. */
  readonly fetchedAt: string;
  /** Where from, so a later second source is distinguishable from this one. */
  readonly source: string;
  /**
   * The drawings themselves, by `symbol` name: raw SVG text.
   *
   * Held with the catalogue rather than fetched per draw. A plan places
   * hundreds of symbols per repaint, and a network round trip inside that loop
   * is not a thing that can be made fast enough.
   */
  readonly drawings: Readonly<Record<string, string>>;
  /**
   * Who has to be named wherever these symbols are shown, or `null`.
   *
   * Set when a catalogue carries drawings used by permission rather than
   * owned. It rides WITH the drawings on purpose: an attribution kept
   * somewhere else is one a later refactor can drop without anything failing,
   * and the terms would be broken silently.
   */
  readonly attribution?: string | null;
  /** What that permission covers, in the issuer's own words. */
  readonly permission?: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read a catalogue export into entries, skipping anything unusable.
 *
 * Skipping rather than failing, for the reason `parseClassCatalog` gives: one
 * malformed entry should cost that entry and not the whole sync.
 *
 * The shape follows the class dictionary's: a top-level object whose `symbols`
 * is a MAP from id to entry. An array is accepted too, because it costs one
 * line and covers the day somebody exports it the other way.
 */
export function parseSymbolCatalog(
  payload: unknown,
  source = DEFAULT_SYMBOL_CATALOG_URL,
  fetchedAt = new Date().toISOString(),
  drawings: Readonly<Record<string, string>> = {},
): SymbolCatalog | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = (payload as Record<string, unknown>).symbols ?? payload;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null ? Object.entries(raw) : null;
  if (!list) return null;

  const entries: SymbolCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    // From a map we get `[key, value]`; the key is the id when the entry
    // itself does not repeat it, which is the natural way to write a map.
    const [key, value] = Array.isArray(item) && item.length === 2 && typeof item[0] === 'string'
      ? item as [string, unknown]
      : [null, item];

    if (typeof value !== 'object' || value === null) continue;
    const record = value as Record<string, unknown>;

    const id = text(record.id) || (key ?? '');
    // Without a Fachklasse the entry cannot be joined to anything.
    if (!id) continue;
    // A repeated id is NOT dropped. It used to be, because a duplicate made
    // the lookup depend on iteration order — and now that order is the
    // precedence between two sources for one Fachklasse, deliberately set by
    // whoever assembled the entries. Dropping the second row here would undo
    // that merge the first time a catalogue came back from storage, leaving
    // one source to answer for every plan product.
    seen.add(id);

    const symbol = text(record.symbol);
    entries.push({
      id,
      symbol: symbol.length > 0 ? symbol : null,
      label: text(record.label) || id,
      products: Array.isArray(record.products)
        ? record.products.map(text).filter((value) => value.length > 0)
        : [],
      // Survives a round trip through storage. A licensed drawing that comes
      // back without its obligation is the one outcome worth guarding: the
      // symbol would still be drawn, and nobody would be named for it.
      attributionRequired: record.attributionRequired === true ? true : undefined,
    });
  }

  // An empty catalogue is a real answer — somebody started the list and it has
  // no usable rows yet — but `null` means "this was not a catalogue at all",
  // and a caller must be able to tell those apart to report the right thing.
  return {
    entries,
    fetchedAt,
    source,
    drawings,
    // Only from a document that carries them — a plain catalogue export has
    // no terms attached, and inventing `null` here would be the same thing.
    attribution: text((payload as Record<string, unknown>).attribution) || null,
    permission: text((payload as Record<string, unknown>).permission) || null,
  };
}

/**
 * The Fachklasse key for an element, most specific first.
 *
 * Three candidates rather than one, because a catalogue may be written at any
 * of these levels and the specific entry should win:
 *
 *   `IfcSensor.USERDEFINED.Rauchmelder` → `IfcSensor.USERDEFINED` → `IfcSensor`
 *
 * The last of them is what lets one entry cover a whole entity — useful while
 * a catalogue is young, and the reason a lookup falls back rather than
 * demanding an exact row for every element in a model.
 */
export function classKeyCandidates(
  entity: string,
  predefinedType?: string | null,
  objectType?: string | null,
): string[] {
  const cleanEntity = text(entity);
  if (!cleanEntity) return [];

  const cleanPredefined = text(predefinedType);
  const cleanObject = text(objectType);
  const candidates: string[] = [];

  if (cleanPredefined && cleanObject) {
    candidates.push(`${cleanEntity}.${cleanPredefined}.${cleanObject}`);
  }
  if (cleanPredefined) candidates.push(`${cleanEntity}.${cleanPredefined}`);
  candidates.push(cleanEntity);
  return candidates;
}

/**
 * Entries by id, lower-cased — exporters disagree about case.
 *
 * A LIST per id, not one entry. One Fachklasse can legitimately carry two
 * different symbols: the authorities prescribe one drawing for a smoke
 * detector on a Brandschutzplan and the installers' association another on a
 * Werkplan. Which applies is decided by the plan product, so both have to be
 * reachable — with one entry per id the second source would overwrite the
 * first and quietly put association symbols on an authority plan.
 *
 * Insertion order is the precedence, so the caller that assembles the entries
 * decides which source wins where both apply. See `mergeSesCatalog`.
 */
function indexOf(catalog: SymbolCatalog): Map<string, SymbolCatalogEntry[]> {
  const index = new Map<string, SymbolCatalogEntry[]>();
  for (const entry of catalog.entries) {
    const key = entry.id.toLowerCase();
    const existing = index.get(key);
    if (existing) existing.push(entry);
    else index.set(key, [entry]);
  }
  return index;
}

/** Cached per catalogue object, which is replaced whole on every sync. */
const indexCache = new WeakMap<SymbolCatalog, Map<string, SymbolCatalogEntry[]>>();

function cachedIndex(catalog: SymbolCatalog): Map<string, SymbolCatalogEntry[]> {
  const existing = indexCache.get(catalog);
  if (existing) return existing;
  const built = indexOf(catalog);
  indexCache.set(catalog, built);
  return built;
}

/** Whether an entry is shown on a given product. */
export function entryAppliesTo(entry: SymbolCatalogEntry, productId: string | null): boolean {
  // No product asked, or an entry that names none: both mean "everywhere".
  if (productId === null || entry.products.length === 0) return true;
  return entry.products.includes(productId);
}

/**
 * The catalogue entry for an element, or `null`.
 *
 * `productId` filters: the whole point of the `products` field is that a fire
 * brigade plan shows fewer symbols than a concept plan, and asking for one
 * must not return the other's.
 */
export function symbolEntryFor(
  catalog: SymbolCatalog | null,
  entity: string,
  options: {
    readonly predefinedType?: string | null;
    readonly objectType?: string | null;
    readonly productId?: string | null;
  } = {},
): SymbolCatalogEntry | null {
  if (!catalog) return null;
  const index = cachedIndex(catalog);
  const productId = options.productId ?? null;

  for (const candidate of classKeyCandidates(entity, options.predefinedType, options.objectType)) {
    // A more specific entry that belongs to a DIFFERENT product must not stop
    // the search: the general one may still apply here. Same within one id —
    // the first entry that belongs to this product wins, later ones are the
    // other sources' answers for other products.
    const applying = (index.get(candidate.toLowerCase()) ?? [])
      .filter((entry) => entryAppliesTo(entry, productId));
    if (applying.length === 0) continue;

    // WITH NO PRODUCT CHOSEN, A LICENSED SYMBOL IS NOT THE DEFAULT
    //
    // `null` means "no product asked", and every entry applies — which put the
    // association's symbols in front of the authority's on a plan that had not
    // said which document it was. That is the wrong drawing by default, and
    // invisible, because both look plausible.
    //
    // A symbol used by permission is correct on ITS products and nowhere else,
    // so with nothing to go on the unrestricted source wins. Ask for a product
    // and the order decides again, as it should.
    if (productId === null) {
      const unrestricted = applying.find((entry) => !entry.attributionRequired);
      if (unrestricted) return unrestricted;
    }
    return applying[0];
  }
  return null;
}

/**
 * The SVG text for an element, or `null`.
 *
 * `null` covers both "no entry" and "an entry whose drawing is not made yet",
 * and callers treat those the same: nothing to draw. Which of the two it was
 * is a question for the settings view, and `symbolEntryFor` answers it.
 */
export function symbolDrawingFor(
  catalog: SymbolCatalog | null,
  entity: string,
  options: {
    readonly predefinedType?: string | null;
    readonly objectType?: string | null;
    readonly productId?: string | null;
  } = {},
): string | null {
  const entry = symbolEntryFor(catalog, entity, options);
  if (!entry?.symbol) return null;
  return catalog?.drawings[entry.symbol] ?? null;
}

/** Every drawing name the catalogue refers to, without duplicates. */
export function referencedSymbols(catalog: SymbolCatalog): string[] {
  const names = new Set<string>();
  for (const entry of catalog.entries) if (entry.symbol) names.add(entry.symbol);
  return [...names];
}

/** What is in the catalogue and what is still missing, for a settings view. */
export interface SymbolCatalogCoverage {
  readonly entries: number;
  /** Entries that name a drawing. */
  readonly withSymbol: number;
  /** Entries still waiting for one — the list's own to-do. */
  readonly withoutSymbol: number;
  /** Drawings named but not fetched, e.g. a 404 during sync. */
  readonly missingDrawings: readonly string[];
}

export function symbolCatalogCoverage(catalog: SymbolCatalog): SymbolCatalogCoverage {
  const missing = new Set<string>();
  // Counted by Fachklasse rather than by row. Since a second source may add a
  // row for a class the first already covers, counting rows would report more
  // classes than the model has and turn "how much is covered" into a number
  // that grows by adding no coverage at all.
  const withSymbol = new Set<string>();
  const all = new Set<string>();

  for (const entry of catalog.entries) {
    all.add(entry.id.toLowerCase());
    if (!entry.symbol) continue;
    withSymbol.add(entry.id.toLowerCase());
    if (typeof catalog.drawings[entry.symbol] !== 'string') missing.add(entry.symbol);
  }

  return {
    entries: all.size,
    withSymbol: withSymbol.size,
    withoutSymbol: all.size - withSymbol.size,
    missingDrawings: [...missing],
  };
}
