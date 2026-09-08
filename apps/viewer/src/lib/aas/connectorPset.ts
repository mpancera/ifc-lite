/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The link from an IFC object to its Asset Administration Shell (AAS).
 *
 * # What this is
 * An AAS (IEC 63278 / DIN EN IEC 63278) holds a product's data over its whole
 * life: nameplate, technical data, documentation, carbon footprint — and, per
 * the DPP annex to IDTA-01002 v3.2, the Digital Product Passport itself. An
 * IFC file describes a state at a point in time; an AAS describes a course
 * over time. So the model does not COPY that data, it ADDRESSES it. This
 * module is that address.
 *
 * Two links, matching the two kinds of AAS:
 *   - a TYPE link, on the `IfcXxxType` — the product as a catalogue entry.
 *     Shared by every placement of that product.
 *   - an INSTANCE link, on the occurrence — one physical device, identified
 *     by its serial number. Only exists once something is actually installed.
 *
 * # Where the names come from
 * IDTA and buildingSMART Germany, "BIM building model for the integration of
 * machines, building services and external devices using the Asset
 * Administration Shell" (guideline, English edition 1.1, May 2025), §6.1.2
 * and Annex §8.1.2: a property set `AAS_PSet_Connector` carrying `AASAddress`,
 * `AASType`, `FetchDate` and `AASVersionNumber`, written once for the type AAS
 * and once for the instance AAS.
 *
 * # Why every name is defined HERE and nowhere else
 * That guideline is a recommendation, not a standard, and it is not even
 * self-consistent on this point: the prose calls the set `AAS_PSet_Connector`,
 * its own Table 7 heads the same set `AAS_PSet_IoT`. The normative successor,
 * IDTA-02105 "IFC-TBE Connector for Building Equipment", is still *In
 * Development* at the time of writing. So these names WILL likely move. Every
 * writer and reader in this app goes through the constants below, which makes
 * following the spec a one-line change instead of a search-and-replace across
 * the codebase.
 *
 * Deliberately not `Pset_`-prefixed: that prefix belongs to buildingSMART's
 * own standard sets, and this is not one of them. Same reasoning as
 * `library-type.ts`'s `CustomTechnicalData`.
 */

/** The property set carrying the AAS link. Single source of truth — see file doc. */
export const AAS_CONNECTOR_PSET = 'AAS_PSet_Connector';

/** The four property names inside it. Single source of truth — see file doc. */
export const AAS_CONNECTOR_PROPERTY = {
  /** Unique URL or reference ID of the asset in the AAS. */
  address: 'AASAddress',
  /** Which kind of AAS this points at — see `AAS_KIND`. */
  kind: 'AASType',
  /** When data was last taken over from the AAS (ISO 8601). */
  fetchDate: 'FetchDate',
  /** The AAS version current at that last takeover. */
  versionNumber: 'AASVersionNumber',
} as const;

/**
 * The two values `AASType` takes.
 *
 * The guideline says only "type of AAS" without fixing a vocabulary, so this
 * app fixes one: the AAS metamodel's own `AssetKind` spelling (`Type` /
 * `Instance`), rather than inventing German or lowercase variants. If
 * IDTA-02105 mandates something else, this constant is the one place to change.
 */
export const AAS_KIND = {
  type: 'Type',
  instance: 'Instance',
} as const;

export type AasKind = (typeof AAS_KIND)[keyof typeof AAS_KIND];

/** A resolved AAS link as this app passes it around. */
export interface AasLink {
  /** Unique URL or reference ID of the asset in the AAS. */
  address: string;
  /** Type AAS (the product) or instance AAS (the installed device). */
  kind: AasKind;
  /**
   * When data was last taken over from the AAS, ISO 8601.
   *
   * The quietly important field: it turns a copy into a DATED copy, which is
   * what makes "is this model value still current?" answerable at all. Absent
   * means nothing has been fetched yet — the link was recorded, not followed.
   */
  fetchDate?: string;
  /** The AAS version at that last takeover. Absent for the same reason. */
  versionNumber?: string;
}

/** Property triples in the shape `StoreEditor.addPropertySet` expects. */
export interface AasConnectorProperty {
  name: string;
  value: string;
  type: 'LABEL';
}

/**
 * The property set contents for a link, ready to hand to
 * `StoreEditor.addPropertySet(entityId, AAS_CONNECTOR_PSET, ...)`.
 *
 * Empty optional fields are OMITTED rather than written as empty strings: a
 * missing `FetchDate` means "never fetched", and an empty one would read as a
 * fetch that returned nothing. Every value goes out as `LABEL` — `FetchDate`
 * included, because IFC's date types would force a representation decision
 * the guideline does not make, and a round-trippable ISO 8601 string is the
 * honest option.
 */
export function aasConnectorProperties(link: AasLink): AasConnectorProperty[] {
  const properties: AasConnectorProperty[] = [
    { name: AAS_CONNECTOR_PROPERTY.address, value: link.address, type: 'LABEL' },
    { name: AAS_CONNECTOR_PROPERTY.kind, value: link.kind, type: 'LABEL' },
  ];
  if (link.fetchDate) {
    properties.push({ name: AAS_CONNECTOR_PROPERTY.fetchDate, value: link.fetchDate, type: 'LABEL' });
  }
  if (link.versionNumber) {
    properties.push({ name: AAS_CONNECTOR_PROPERTY.versionNumber, value: link.versionNumber, type: 'LABEL' });
  }
  return properties;
}

/**
 * The minimum an object has to look like to be read for a link.
 *
 * Three property shapes are accepted because this codebase genuinely holds
 * all three: `@ifc-lite/data`'s `PropertySet` (the one the viewer works with)
 * carries an ARRAY of `{ name, value }`, `@ifc-lite/parser`'s carries a `Map`,
 * and test fixtures and JSON round-trips tend to be plain objects. Converting
 * at every call site would be three chances to convert one of them wrongly.
 */
export interface ReadablePropertySet {
  name: string;
  properties:
    | ReadonlyArray<{ name: string; value: unknown }>
    | Map<string, { value: unknown }>
    | Record<string, unknown>;
}

/** Unwraps a `{ value }` record, which two of the three shapes nest values in. */
function unwrap(raw: unknown): unknown {
  return typeof raw === 'object' && raw !== null && 'value' in raw
    ? (raw as { value: unknown }).value
    : raw;
}

function propertyValue(set: ReadablePropertySet, name: string): string | null {
  const { properties } = set;
  let raw: unknown;
  if (Array.isArray(properties)) {
    raw = properties.find((p) => p?.name === name)?.value;
  } else if (properties instanceof Map) {
    raw = properties.get(name);
  } else {
    raw = (properties as Record<string, unknown>)[name];
  }
  const value = unwrap(raw);
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * The AAS link carried by these property sets, or `null` if there is none.
 *
 * A set without an `AASAddress` yields `null` even if the other three
 * properties are present: an address is the whole point, and a link that
 * cannot be followed is not a link. An unrecognised `AASType` falls back to
 * `Type` — a type AAS is what a planning model overwhelmingly carries, and
 * refusing to read the link over a spelling would lose the address too.
 */
export function readAasLink(propertySets: Iterable<ReadablePropertySet>): AasLink | null {
  for (const set of propertySets) {
    if (set.name !== AAS_CONNECTOR_PSET) continue;
    const address = propertyValue(set, AAS_CONNECTOR_PROPERTY.address);
    if (!address) continue;
    const rawKind = propertyValue(set, AAS_CONNECTOR_PROPERTY.kind);
    const kind: AasKind = rawKind?.toLowerCase() === AAS_KIND.instance.toLowerCase()
      ? AAS_KIND.instance
      : AAS_KIND.type;
    const link: AasLink = { address, kind };
    const fetchDate = propertyValue(set, AAS_CONNECTOR_PROPERTY.fetchDate);
    if (fetchDate) link.fetchDate = fetchDate;
    const versionNumber = propertyValue(set, AAS_CONNECTOR_PROPERTY.versionNumber);
    if (versionNumber) link.versionNumber = versionNumber;
    return link;
  }
  return null;
}

/**
 * Whether an address can be opened in a browser.
 *
 * `AASAddress` is explicitly "URL **or** reference ID", and a reference ID is
 * very often an IRI like `https://example.com/ids/asset/1234` that looks
 * clickable but is an identifier, not an endpoint — dereferencing it is not
 * guaranteed to work. This only decides whether the UI offers a link at all;
 * it deliberately does not promise the target resolves. Anything not
 * `http`/`https` (a `urn:`, a bare id) is shown as plain text.
 */
export function isOpenableAasAddress(address: string): boolean {
  try {
    const { protocol } = new URL(address);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    // Nothing to log: a throw here is the ordinary answer for a reference ID
    // that is not a URL, which is a valid `AASAddress`, not a fault.
    return false;
  }
}
