/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What wiring a run means, decided before anything is written.
 *
 * # The order is the input, and it is the only thing that is
 * A Meldergruppe is a partition of an installation — a fact about which
 * devices belong together, derived from the rooms they stand in. A
 * **Melderkreis** is not derivable at all: which detector hangs where on the
 * cable is a decision somebody makes while pulling it. So this takes the
 * sequence as given and turns it into IFC, rather than trying to work it out.
 *
 * # One number, not two
 * The counter in a device's mark IS its position on the cable. `MK01.03` means
 * the third device on run MK01 — not the third device of a zone that happens
 * to be wired somewhere. That is why re-wiring renumbers: the number is a
 * property of the run, and changing the run changes it. A tool that kept the
 * old numbers after a re-wire would be claiming the cable had not moved.
 *
 * # Ring or stub, without being asked
 * A detection line usually leaves the controller, passes every device and
 * returns. Sometimes it just ends. Which one it is follows from the sequence
 * itself — if the last device is the controller again, it is a ring — so
 * nobody has to declare it up front and then get it wrong.
 *
 * Pure: no store, no React, no IFC. Everything here is decided from numbers
 * and names, which is what makes the decisions testable without a model.
 */

/** A device and where it sits, as the planner needs it. */
export interface WireStop {
  readonly expressId: number;
  /** Which end of a cable arrives here first. Set by the planner. */
  readonly index: number;
  /** The mark this device gets: `MK01.03`. */
  readonly mark: string;
}

/** One length of cable: from one device's OUT to the next device's IN. */
export interface WireHop {
  readonly fromExpressId: number;
  readonly toExpressId: number;
}

export interface WirePlanInput {
  /**
   * The run, in the order it was walked, controller FIRST.
   *
   * The controller leads because the numbering starts where the cable does. A
   * sequence that started at an arbitrary detector would number the same run
   * differently depending on which end somebody clicked first.
   */
  readonly sequence: readonly number[];
  /** The circuit's name — `MK01`. Also the prefix of every mark. */
  readonly circuitName: string;
  /** Devices already wired into OTHER runs, so a double booking is caught. */
  readonly alreadyWired?: ReadonlySet<number>;
}

export interface WirePlan {
  /** The controller the run hangs on — the first entry of the sequence. */
  readonly controllerId: number;
  /** Every device after the controller, in order, with its mark. */
  readonly stops: readonly WireStop[];
  /** The cable, hop by hop. Includes the return hop when the run is a ring. */
  readonly hops: readonly WireHop[];
  /** True when the run returns to its controller. */
  readonly ring: boolean;
  /**
   * Devices named twice in the same sequence, or already on another run.
   *
   * Reported rather than silently dropped: a detector wired into two lines is
   * a real mistake with a real consequence at the panel, and the person who
   * clicked it is the only one who can say which of the two was meant.
   */
  readonly conflicts: readonly number[];
}

/**
 * `ObjectType` on a run's circuit, so a reader can tell these from any other
 * `IfcDistributionCircuit` in the file — and so the tool knows which ones are
 * its own to rewrite.
 */
export const RUN_OBJECT_TYPE = 'Melderkreis';

/** A device's mark within its run: `MK01.03`. */
export function wireMark(circuitName: string, index: number): string {
  return `${circuitName}.${String(index).padStart(2, '0')}`;
}

/**
 * Turn a click sequence into a run.
 *
 * Throws only on input that cannot mean anything — fewer than two entries is
 * not a short run, it is no run at all. Everything else that is wrong with a
 * sequence comes back in `conflicts`, because it is the kind of wrong a person
 * has to look at rather than have decided for them.
 */
export function planWiring({
  sequence,
  circuitName,
  alreadyWired,
}: WirePlanInput): WirePlan {
  if (sequence.length < 2) {
    throw new Error('planWiring: a run needs a controller and at least one device');
  }
  const controllerId = sequence[0];

  // A closing click back on the controller says "ring" and is not a stop.
  const ring = sequence.length > 2 && sequence[sequence.length - 1] === controllerId;
  const body = ring ? sequence.slice(1, -1) : sequence.slice(1);

  const seen = new Set<number>();
  const conflicts: number[] = [];
  const stops: WireStop[] = [];
  for (const expressId of body) {
    if (expressId === controllerId || seen.has(expressId) || alreadyWired?.has(expressId)) {
      conflicts.push(expressId);
      continue;
    }
    seen.add(expressId);
    const index = stops.length + 1;
    stops.push({ expressId, index, mark: wireMark(circuitName, index) });
  }

  const hops: WireHop[] = [];
  let previous = controllerId;
  for (const stop of stops) {
    hops.push({ fromExpressId: previous, toExpressId: stop.expressId });
    previous = stop.expressId;
  }
  // The return leg closes the loop at the controller. Written as its own hop
  // rather than implied, so a reader of the file sees the cable that is
  // actually there.
  if (ring && stops.length > 0) {
    hops.push({ fromExpressId: previous, toExpressId: controllerId });
  }

  return { controllerId, stops, hops, ring, conflicts };
}

/**
 * The next free run name for an installation: `MK01`, `MK02`, …
 *
 * `MK` and not `MZ`: the zone prefix is taken, and a run named like a zone is
 * exactly the confusion this whole separation exists to end. Two digits,
 * because a building with a hundred detection lines is not the case being
 * designed for and three digits would make every plan read worse.
 */
export function nextRunName(existingNames: Iterable<string>, prefix = 'MK'): string {
  let highest = 0;
  for (const name of existingNames) {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(name.trim());
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > highest) highest = value;
  }
  return `${prefix}${String(highest + 1).padStart(2, '0')}`;
}
