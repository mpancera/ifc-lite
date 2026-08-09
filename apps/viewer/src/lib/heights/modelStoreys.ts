/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * One model's storeys, written out so they can be compared against the
 * project's reference height system.
 *
 * The height system says how it SHOULD be. This says how one discipline model
 * actually is. The difference between the two is where the everyday
 * inconsistencies live, and neither file on its own reveals them.
 *
 * Deliberately one file per model. Merging them here would mean deciding which
 * model wins on a disagreement, and that decision belongs to the person
 * reading the comparison, not to the exporter.
 *
 * ## Why nothing is rounded
 *
 * The comparison reports differences from 5 cm up. A value rounded to the
 * centimetre has already spent a fifth of that budget before anyone compares
 * anything, and a rounded difference can cross the threshold in either
 * direction. Elevations therefore go out exactly as the multiplication
 * produced them.
 *
 * That is safe here in a way it is not in the height system: these numbers
 * come straight from the file times one scale factor, so they carry no
 * accumulated float noise from editing.
 *
 * ## Refusing rather than guessing
 *
 * Two conditions produce no file at all, and they mean different things:
 *
 * - **No storeys** — a terrain model or a georeferencing test simply has none.
 *   Writing an empty list would read on the other side as "this model lost all
 *   its storeys" and produce a "missing" finding for every reference storey.
 * - **No length unit** — refuse. A centimetre file read as metres gives a
 *   609 metre building out of a 6 metre one, and every finding about it is
 *   nonsense.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { readRawStoreys } from './read.js';
import type { ElevationSource } from './types.js';

/** A storey as this file carries it. No `levels`: those are project-wide and
 *  live in the height system, not in a per-model reading. */
export interface ModelStorey {
  /** `<model-uuid>:<express-id>`. Unique within the model, which is all the
   *  receiving side needs. */
  id: string;
  /** As written in the model. Display only — naming conventions differ per
   *  office, so the comparison matches on elevation, never on the name. */
  name: string;
  /** Relative to the project datum ±0.00, in METRES. */
  elevation: number;
  source: ElevationSource;
}

export interface ModelStoreys {
  formatVersion: 1;
  model: {
    /**
     * The actual file name. This is what ties the reading to a document in the
     * folder, so it is required — without it the list is a statement about
     * nothing.
     */
    fileName: string;
    documentId?: string;
    /** e.g. `'CENTI.METRE'`. Recorded so a reader can see what was assumed
     *  instead of trusting that somebody got it right. */
    sourceLengthUnit?: string;
  };
  /** ISO-8601. */
  updatedAt: string;
  /** Ascending by elevation. */
  storeys: ModelStorey[];
}

export type ModelStoreysResult =
  | { status: 'ok'; storeys: ModelStoreys }
  /** The model has none. Write no file. */
  | { status: 'no-storeys' }
  /** Something made the reading untrustworthy. Say so; write no file. */
  | { status: 'refused'; reason: string };

export interface ModelStoreysInput {
  store: IfcDataStore;
  /** The id the ids are prefixed with. */
  modelId: string;
  /** The actual file name, not a display name. */
  fileName: string;
  documentId?: string;
}

/** Read one model's storeys, in metres, with provenance. */
export function collectModelStoreys(
  input: ModelStoreysInput,
  now: Date = new Date(),
): ModelStoreysResult {
  const fileName = input.fileName?.trim();
  if (!fileName) {
    return {
      status: 'refused',
      reason: 'Ohne Dateinamen lässt sich die Geschossliste keinem Dokument zuordnen.',
    };
  }

  const { storeys, lengthUnitScale, lengthUnitName } = readRawStoreys(input.store, input.modelId);

  // Checked BEFORE the unit: a model with no storeys is not a unit problem,
  // and reporting it as one would send somebody looking for a missing
  // IfcUnitAssignment in a terrain model that never had storeys either.
  if (storeys.length === 0) return { status: 'no-storeys' };

  if (lengthUnitName === null) {
    return {
      status: 'refused',
      reason: 'Die Längeneinheit dieses Modells ist nicht bestimmbar. '
        + 'Ohne sie wären alle Koten Zahlen ohne Bedeutung.',
    };
  }
  if (!Number.isFinite(lengthUnitScale) || lengthUnitScale <= 0) {
    return { status: 'refused', reason: `Unbrauchbarer Einheitenfaktor: ${lengthUnitScale}.` };
  }

  return {
    status: 'ok',
    storeys: {
      formatVersion: 1,
      model: {
        fileName,
        ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
        sourceLengthUnit: lengthUnitName,
      },
      updatedAt: now.toISOString(),
      storeys: storeys
        .map((raw): ModelStorey => ({
          id: raw.id,
          name: raw.name,
          // Not rounded. See the note at the top of this file.
          elevation: raw.elevation * lengthUnitScale,
          source: raw.source,
        }))
        .sort((a, b) => a.elevation - b.elevation),
    },
  };
}

/** The file contents. Two-space indent: people read and diff this. */
export function serializeModelStoreys(storeys: ModelStoreys): string {
  return `${JSON.stringify(storeys, null, 2)}\n`;
}
