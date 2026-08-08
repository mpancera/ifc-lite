/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "Current units" — what the loaded models actually declare, and where they
 * disagree.
 *
 * IFC declares no default and no country table. Checked against the IFC4X3
 * schema: the only rule is `IfcCorrectUnitAssignment`, which merely forbids
 * duplicate unit types, and `IfcContext.UnitsInContext` is OPTIONAL — a valid
 * file may declare nothing at all. So "which units apply here" cannot be
 * inferred; it has to be read and shown.
 *
 * The value of the table is not the list but the DISAGREEMENTS. A real case
 * from this project: a model in centimetres whose areas and volumes were in
 * square and cubic FEET — an imperial template converted half-way. Nothing
 * about that is invalid IFC, and nothing about it is visible until length and
 * area sit in the same row.
 *
 * Pure: declared units in, findings out.
 */

import type { DeclaredUnit } from '@ifc-lite/parser';

/** What one model declares. `units: null` = no unit assignment at all. */
export interface ModelUnits {
  modelId: string;
  fileName: string;
  units: DeclaredUnit[] | null;
}

export type UnitIssueKind =
  /** The file declares no `IfcUnitAssignment`. Legal, and it means every
   *  number in it is unitless — nothing can be safely read. */
  | 'no-assignment'
  /** No LENGTHUNIT among the declared units. */
  | 'no-length-unit'
  /** The area unit is not the square of the length unit (or the volume unit
   *  not its cube) — the half-converted-template signature. */
  | 'inconsistent-derived'
  /** This model's length unit differs from the other loaded models'. */
  | 'differs-from-federation';

export interface UnitIssue {
  kind: UnitIssueKind;
  modelId: string;
  /** Ready to show. German, like the rest of the authoring surface. */
  message: string;
}

/** The unit declared for one `IfcUnitEnum` token, or `undefined`. */
export function unitOf(model: ModelUnits, unitType: string): DeclaredUnit | undefined {
  return model.units?.find((u) => u.unitType === unitType);
}

/**
 * The SI base name behind a possibly-prefixed name: `MILLI.METRE` → `METRE`.
 * A conversion-based unit has no prefix, so it comes back unchanged.
 */
function baseName(name: string): string {
  const dot = name.indexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : name;
}

/**
 * Whether an area/volume unit belongs to the same family as the length unit.
 *
 * Compares BASE names only, deliberately: `MILLI.METRE` with `SQUARE_METRE` is
 * how essentially every millimetre file is written and is perfectly consistent
 * — the prefix does not repeat on the derived unit. What this catches is the
 * family mismatch: metres against square FEET.
 */
function sameFamily(length: string, derived: string): boolean {
  const l = baseName(length);
  const d = baseName(derived);
  if (l === 'METRE') return d === 'SQUARE_METRE' || d === 'CUBIC_METRE' || d === 'METRE';
  // Imperial and anything else: the derived name is expected to mention the
  // length unit ('SQUARE FOOT' against 'FOOT').
  return d.includes(l);
}

/**
 * Everything worth flagging across the loaded models.
 *
 * Ordered most-severe first: a file with no units at all cannot be read at any
 * scale, so it outranks a mismatch inside one that can.
 */
export function findUnitIssues(models: readonly ModelUnits[]): UnitIssue[] {
  const issues: UnitIssue[] = [];

  for (const model of models) {
    if (model.units === null) {
      issues.push({
        kind: 'no-assignment', modelId: model.modelId,
        message: `${model.fileName}: keine Einheitenzuweisung. IFC erlaubt das — `
          + 'jede Länge in dieser Datei ist damit aber unbestimmt.',
      });
      continue;
    }

    const length = unitOf(model, 'LENGTHUNIT');
    if (!length) {
      issues.push({
        kind: 'no-length-unit', modelId: model.modelId,
        message: `${model.fileName}: keine Längeneinheit deklariert.`,
      });
      continue;
    }

    for (const token of ['AREAUNIT', 'VOLUMEUNIT'] as const) {
      const derived = unitOf(model, token);
      if (derived && !sameFamily(length.name, derived.name)) {
        issues.push({
          kind: 'inconsistent-derived', modelId: model.modelId,
          message: `${model.fileName}: Länge in ${length.name}, aber ${token === 'AREAUNIT' ? 'Fläche' : 'Volumen'} `
            + `in ${derived.name}. Typisch für eine halb umgestellte Vorlage.`,
        });
      }
    }
  }

  // Federation check last, and only when there is a federation to compare.
  const lengths = models
    .map((m) => ({ model: m, unit: m.units ? unitOf(m, 'LENGTHUNIT') : undefined }))
    .filter((e): e is { model: ModelUnits; unit: DeclaredUnit } => e.unit !== undefined);

  if (lengths.length > 1) {
    const names = new Set(lengths.map((e) => e.unit.name));
    if (names.size > 1) {
      for (const entry of lengths) {
        issues.push({
          kind: 'differs-from-federation', modelId: entry.model.modelId,
          message: `${entry.model.fileName}: ${entry.unit.name} — die geladenen Modelle `
            + `verwenden ${[...names].join(', ')}.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Every unit type any loaded model declares, in a stable, readable order.
 *
 * The common ones first because those are the ones anyone checks; the rest
 * alphabetically after them, so an unusual declaration is visible rather than
 * buried.
 */
export function unitTypeColumns(models: readonly ModelUnits[]): string[] {
  const known = ['LENGTHUNIT', 'AREAUNIT', 'VOLUMEUNIT', 'PLANEANGLEUNIT', 'MASSUNIT', 'TIMEUNIT'];
  const present = new Set<string>();
  for (const model of models) {
    for (const unit of model.units ?? []) present.add(unit.unitType);
  }

  const head = known.filter((k) => present.has(k));
  const tail = [...present].filter((k) => !known.includes(k)).sort();
  return [...head, ...tail];
}
