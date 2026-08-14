/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The checks themselves, over a model reduced to the facts they need.
 *
 * Pure on purpose: every check is arithmetic over a flat list, so each one is
 * testable without a parsed file, and the awkward part — deciding what an
 * element IS — happens once in the hook and is not repeated per check.
 *
 * # The kinds, and why the distinction is not cosmetic
 * `IfcOpeningElement` is an `IfcElement`, and it is NOT contained in a storey:
 * it hangs off the wall it voids through `IfcRelVoidsElement`. A containment
 * check that did not know this would report every door and window opening in
 * the model as misplaced — thousands of findings, all wrong, which is how a
 * Prüfplan teaches people to ignore it. The same goes the other way for
 * `IfcSpace`, which reaches its storey by `IfcRelAggregates` rather than by
 * containment and is the one relationship Marc named explicitly.
 */

import type { HousekeepingFinding } from './findings.js';

/**
 * What an element is, for the purpose of these checks.
 *
 * - `structure` — site, building, storey: the tree itself.
 * - `space` — a room. Reaches its storey by aggregation.
 * - `feature` — an opening or projection. Belongs to its host, not to a storey.
 * - `element` — an ordinary building element, the subject of most checks.
 */
export type ElementKind = 'structure' | 'space' | 'feature' | 'element';

export interface HousekeepingElement {
  readonly expressId: number;
  readonly ifcType: string;
  readonly kind: ElementKind;
  readonly name: string;
  /** `null` where the class has no `LongName` at all. */
  readonly longName: string | null;
  /** Placed in the spatial tree, by containment or aggregation. */
  readonly inSpatialStructure: boolean;
  /** Defined by an `IfcTypeObject` through `IfcRelDefinesByType`. */
  readonly hasType: boolean;
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Elements that sit nowhere in the building.
 *
 * The expensive consequence is not that they look odd in the tree: an element
 * with no storey cannot be filtered by storey, cannot be drawn in a floor
 * plan, and — Marc's own reason for asking — gives the automatic numbering
 * nothing to build an identifier from, because that identifier is
 * building.storey.room by construction.
 */
export function checkSpatialContainment(
  elements: readonly HousekeepingElement[],
): HousekeepingFinding[] {
  const orphans = elements
    .filter((e) => e.kind === 'element' && !e.inSpatialStructure)
    .map((e) => e.expressId);
  if (orphans.length === 0) return [];

  return [{
    id: 'spatial-containment/orphans',
    checkId: 'spatial-containment',
    severity: 'error',
    title: `${count(orphans.length, 'Element', 'Elemente')} ohne Platz in der Bauwerksstruktur`,
    detail: 'Ohne IfcRelContainedInSpatialStructure gehört ein Element zu keinem '
      + 'Geschoss. Es lässt sich nicht nach Geschoss filtern, erscheint in keinem '
      + 'Grundriss, und die automatische Nummerierung hat nichts, woraus sie '
      + 'Gebäude.Geschoss.Raum bilden könnte.',
    elements: orphans,
  }];
}

/**
 * Rooms that hang outside the storeys.
 *
 * Separate from the check above because the relationship is a different one —
 * a space is AGGREGATED into its storey — and because a room without a storey
 * breaks more than a stray element does: every element that would be numbered
 * through that room loses its middle segment too.
 */
export function checkSpaceInStorey(
  elements: readonly HousekeepingElement[],
): HousekeepingFinding[] {
  const spaces = elements.filter((e) => e.kind === 'space');
  if (spaces.length === 0) return [];

  const loose = spaces.filter((e) => !e.inSpatialStructure).map((e) => e.expressId);
  if (loose.length === 0) return [];

  return [{
    id: 'space-in-storey/loose',
    checkId: 'space-in-storey',
    severity: 'error',
    title: `${count(loose.length, 'Raum', 'Räume')} ohne Geschoss`,
    detail: 'Ein Raum erreicht sein Geschoss über IfcRelAggregates. Fehlt die '
      + 'Beziehung, ist der Raum im Modell vorhanden, aber nirgends — und jede '
      + 'Nummer, die über diesen Raum gebildet würde, verliert ihren Mittelteil.',
    elements: loose,
  }];
}

/**
 * Elements no type object defines.
 *
 * A warning and not an error: IFC does not require a type, and a one-off piece
 * legitimately has none. It is worth listing because the type is where the
 * shared properties of a product live — without it every occurrence carries
 * its own copy or none at all, and the proxy triage has nothing to group by.
 */
export function checkTypeAssignment(
  elements: readonly HousekeepingElement[],
): HousekeepingFinding[] {
  const untyped = elements
    .filter((e) => e.kind === 'element' && !e.hasType)
    .map((e) => e.expressId);
  if (untyped.length === 0) return [];

  return [{
    id: 'type-assignment/untyped',
    checkId: 'type-assignment',
    severity: 'warning',
    title: `${count(untyped.length, 'Element', 'Elemente')} ohne Typ`,
    detail: 'Ohne IfcRelDefinesByType trägt jede Ausprägung ihre Eigenschaften '
      + 'selbst. Gemeinsame Produktdaten lassen sich dann nicht an einer Stelle '
      + 'pflegen, und gleichartige Elemente sind nicht als gleichartig erkennbar.',
    elements: untyped,
  }];
}

/**
 * Names and long names.
 *
 * Two findings rather than one, because they are two different jobs: a
 * nameless element is a gap anyone can fill, while a storey or room without a
 * `LongName` is usually a convention nobody applied. Only classes that HAVE
 * the attribute are asked about it — `longName: null` means the class has no
 * such slot, which is not a defect.
 *
 * The PATTERN half of Marc's request — "auch nach dem gewünschten Muster" —
 * is deliberately not here. A second rule language beside IDS would be a
 * second thing to learn and a second thing to disagree with the first; the
 * panel points at the IDS check instead.
 */
export function checkIdentification(
  elements: readonly HousekeepingElement[],
): HousekeepingFinding[] {
  const findings: HousekeepingFinding[] = [];

  const nameless = elements
    .filter((e) => e.kind !== 'feature' && e.name.trim().length === 0)
    .map((e) => e.expressId);
  if (nameless.length > 0) {
    findings.push({
      id: 'identification/no-name',
      checkId: 'identification',
      severity: 'warning',
      title: `${count(nameless.length, 'Element', 'Elemente')} ohne Namen`,
      detail: 'Name ist das Feld, über das ein Element in Listen, Plänen und '
        + 'Auswertungen wiedererkannt wird. Leer bleibt es dort namenlos.',
      elements: nameless,
      remedy: { label: 'Im Informationspanel ergänzen', target: 'properties' },
    });
  }

  const noLongName = elements
    .filter((e) => e.longName !== null && e.longName.trim().length === 0)
    .map((e) => e.expressId);
  if (noLongName.length > 0) {
    findings.push({
      id: 'identification/no-long-name',
      checkId: 'identification',
      severity: 'info',
      title: `${count(noLongName.length, 'Raum bzw. Geschoss', 'Räume bzw. Geschosse')} ohne LongName`,
      detail: 'Bei Räumen und Geschossen trägt Name die Nummer und LongName die '
        + 'Bezeichnung — „1.04" und „Sitzungszimmer". Fehlt LongName, steht in '
        + 'jeder Auswertung nur die Nummer.',
      elements: noLongName,
      remedy: { label: 'Im Informationspanel ergänzen', target: 'properties' },
    });
  }

  return findings;
}

/**
 * Elements left as `IfcBuildingElementProxy`.
 *
 * The count comes from the triage rather than being recomputed here, so the
 * plan and the tool that answers it can never disagree about how many there
 * are. Proxies the author has explained are already gone from that number.
 */
export function checkClassAssignment(
  openProxies: readonly number[],
  statedProxies: number,
): HousekeepingFinding[] {
  if (openProxies.length === 0) return [];

  const explained = statedProxies > 0
    ? ` ${count(statedProxies, 'weiteres Element ist', 'weitere Elemente sind')} bereits erklärt.`
    : '';

  return [{
    id: 'class-assignment/proxies',
    checkId: 'class-assignment',
    severity: 'warning',
    title: `${count(openProxies.length, 'Element', 'Elemente')} ohne Fachklasse`,
    detail: 'IfcBuildingElementProxy sagt nur, dass hier etwas ist. Auswertung, '
      + 'Regelprüfung und Mengenermittlung können mit der Klasse nichts anfangen.'
      + explained,
    elements: openProxies,
    remedy: { label: 'Proxy-Triage öffnen', target: 'proxy-triage' },
  }];
}
