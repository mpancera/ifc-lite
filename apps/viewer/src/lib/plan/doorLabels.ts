/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What is written beside a door on a plan: its number, and its size.
 *
 * Built the same way as the room label and read the same way — the mark on the
 * first line, the measurement under it.
 *
 * # Why the size comes from the ATTRIBUTES here
 * The exact opposite of the rule the swing symbol follows, and deliberately.
 * A symbol has to agree with the drawing it sits on, so it is measured off the
 * geometry. A label has to agree with the DOOR SCHEDULE, and the schedule
 * carries nominal sizes: a door is a 90/210 even when its lining measures
 * 92 cm across and 216 high. Writing the measured figure would produce a plan
 * whose door sizes match nothing anybody else has.
 *
 * So `OverallWidth` / `OverallHeight` lead, and the geometry is the fallback
 * for the models — the majority, in practice — that leave one or both unset.
 */

/** Nominal opening size in metres, however it was established. */
export interface DoorSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The door's mark, out of the first place that carries one.
 *
 * `Name` first (Marc, 2026-08-13): that is where the number belongs and where
 * it is put when somebody numbers doors deliberately. `Pset_DoorCommon.Reference`
 * next, the schema's own home for a schedule mark, and `Tag` last, where a few
 * exporters put the same thing.
 *
 * The order matters because the two disagree in practice. In the model this was
 * built against, `Name` is a type designation and `Reference` is "D-1" on every
 * door alike — neither numbers anything, and the plan shows what the model
 * actually says rather than inventing a number that looks plausible.
 */
export function doorReference(sources: {
  readonly name?: string | null;
  readonly psetReference?: string | null;
  readonly tag?: string | null;
}): string {
  for (const value of [sources.name, sources.psetReference, sources.tag]) {
    const text = (value ?? '').trim();
    if (text.length > 0) return text;
  }
  return '';
}

/**
 * Door size in CENTIMETRES, as a plan writes it: `90/210`.
 *
 * Centimetres and no unit is the convention in Swiss and German drawings —
 * door dimensions are written this way while areas on the same sheet are in
 * m², and nobody reads the two as being in the same units. It is also the
 * compact form, which matters: this text has to fit beside a doorway.
 *
 * Rounded to whole centimetres. A door is manufactured to a nominal size, and
 * a millimetre on a plan is precision the number does not have.
 */
export function formatDoorSize(size: DoorSize): string {
  return `${Math.round(size.width * 100)}/${Math.round(size.height * 100)}`;
}

/**
 * The nominal size, from the attributes where the model states them and from
 * the geometry where it does not.
 *
 * `statedWidth` / `statedHeight` must already be in metres — a millimetre
 * model says 900, not 0.9, and the length-unit trap in `roomLabels.ts` applies
 * unchanged.
 *
 * The geometric height comes from the LEAF rather than the lining when there
 * is one: a leaf is the door, and its 2.10 is the nominal figure, where the
 * lining's 2.16 includes the frame and is a number no schedule contains.
 *
 * `null` when neither source gives a usable pair — better a number-only label
 * than one stating a size of zero.
 */
export function doorSize(sources: {
  readonly statedWidth?: number | null;
  readonly statedHeight?: number | null;
  readonly geometricWidth?: number | null;
  readonly geometricHeight?: number | null;
}): DoorSize | null {
  const pick = (stated?: number | null, geometric?: number | null): number | null => {
    if (typeof stated === 'number' && Number.isFinite(stated) && stated > 0) return stated;
    if (typeof geometric === 'number' && Number.isFinite(geometric) && geometric > 0) return geometric;
    return null;
  };

  const width = pick(sources.statedWidth, sources.geometricWidth);
  const height = pick(sources.statedHeight, sources.geometricHeight);
  if (width === null || height === null) return null;
  return { width, height };
}

/**
 * The lines to draw: mark first, size under it.
 *
 * Same shape as `roomLabelLines`, so both kinds go through one renderer and
 * one export — a door label and a room label are the same object on a plan,
 * differing only in what they say.
 */
export function doorLabelLines(reference: string, size: DoorSize | null): string[] {
  const lines: string[] = [];
  if (reference) lines.push(reference);
  if (size) lines.push(formatDoorSize(size));
  return lines;
}
