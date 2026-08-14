/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Devices drawn as marks rather than as shapes.
 *
 * A smoke detector is 100 mm across. At 1:100 that is one millimetre on paper,
 * which is a speck; at 1:200 it is not there at all. So a plan does not draw
 * the thing, it draws a MARK for the thing, at a size somebody can see — and
 * that is what makes a plan usable for placing devices rather than only for
 * looking at walls (#50).
 *
 * # Why these are not in the cut
 * The plan is cut at 1.25 m and shows what is below it. A ceiling detector is
 * above the cut and a floor socket is below the projection's interest; neither
 * appears in the drawing at all. So this layer is not a decoration of the cut —
 * it is the only thing that puts these elements on the plan, and it takes them
 * from the STOREY rather than from the section.
 *
 * # What the symbols are, and are not
 * Shapes chosen to be told apart at a glance: a circle is not a square is not
 * a triangle. They are NOT the symbols of any national standard — DIN 1356,
 * SIA 400 and the rest each have their own, and picking one of them silently
 * would be worse than obviously not having picked. A real symbol library, with
 * the placing data #50 asks for, is its own job.
 */

/** The mark a device gets. */
export type DeviceSymbolKind =
  | 'sensor'
  | 'alarm'
  | 'sprinkler'
  | 'light'
  | 'electrical'
  | 'terminal';

/**
 * IFC class to mark, lower-cased for lookup.
 *
 * The families are what a plan distinguishes, not what the schema does: a
 * controller and a sensor are both "something that measures or decides" and
 * get one mark, while a sprinkler gets its own because a fire drawing turns on
 * being able to count them.
 */
const KIND_BY_TYPE: ReadonlyMap<string, DeviceSymbolKind> = new Map([
  ['ifcsensor', 'sensor'],
  ['ifcflowinstrument', 'sensor'],
  ['ifccontroller', 'sensor'],
  ['ifcactuator', 'sensor'],
  ['ifcunitarycontrolelement', 'sensor'],

  ['ifcalarm', 'alarm'],
  ['ifcaudiovisualappliance', 'alarm'],

  ['ifcfiresuppressionterminal', 'sprinkler'],

  ['ifclightfixture', 'light'],

  ['ifcoutlet', 'electrical'],
  ['ifcswitchingdevice', 'electrical'],
  ['ifcelectricappliance', 'electrical'],
  ['ifcelectricdistributionboard', 'electrical'],
  ['ifcelectrictimecontrol', 'electrical'],
  ['ifccommunicationsappliance', 'electrical'],

  ['ifcairterminal', 'terminal'],
]);

/**
 * The mark for an IFC class, or `null` for anything that is not a device.
 *
 * `null` is the common answer and the important one: a wall, a slab and a
 * beam are drawn as themselves, and a plan covered in marks for everything
 * would be no more readable than a plan with none.
 */
export function deviceSymbolKind(ifcType: string | undefined | null): DeviceSymbolKind | null {
  if (!ifcType) return null;
  return KIND_BY_TYPE.get(ifcType.toLowerCase()) ?? null;
}

/** Whether this class is drawn as a mark at all. */
export function isDeviceType(ifcType: string | undefined | null): boolean {
  return deviceSymbolKind(ifcType) !== null;
}

export interface DeviceMark {
  /** Identifies the OCCURRENCE — instanced devices share an express id. */
  readonly key: string;
  readonly expressId: number;
  readonly kind: DeviceSymbolKind;
  /** Where the mark goes, in drawing units. */
  readonly position: { readonly x: number; readonly y: number };
  /** What the model calls it, for the tooltip. */
  readonly name: string;
  /** Its IFC class, for the tooltip — the mark families lump several together. */
  readonly ifcType: string;
}

/**
 * How big to draw a mark, in the units the caller is working in.
 *
 * Fixed on SCREEN, like the labels, and for the same reason: a mark exists to
 * be seen, and one that shrank with the zoom would vanish exactly when the
 * plan got busy enough to need it. In the export the same argument gives paper
 * millimetres instead — a mark is 3 mm on a sheet whatever the sheet's scale.
 *
 * This is deliberately NOT the device's real size. A detector drawn at its
 * real 100 mm is the problem being solved, not the solution.
 */
export const DEVICE_MARK_SCREEN_PX = 11;

/** The same mark on paper, in millimetres. */
export const DEVICE_MARK_PAPER_MM = 3;

/**
 * The mark as line segments on a unit square centred at the origin, running
 * −0.5 … +0.5.
 *
 * Returned as geometry rather than drawn, so the screen overlay and the export
 * paint the SAME shape at their own size — two hand-drawn copies of a symbol
 * set diverge on the first change to either.
 *
 * A circle comes back as a polygon; at the size these are drawn, sixteen sides
 * are a circle, and it keeps every consumer to one primitive.
 */
export function deviceMarkPaths(kind: DeviceSymbolKind): { x: number; y: number }[][] {
  const circle = (r: number, sides = 16) => {
    const ring: { x: number; y: number }[] = [];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      ring.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return ring;
  };
  const square = (h: number) => [
    { x: -h, y: -h }, { x: h, y: -h }, { x: h, y: h }, { x: -h, y: h }, { x: -h, y: -h },
  ];

  switch (kind) {
    case 'sensor':
      return [circle(0.5)];
    case 'sprinkler':
      // A circle with its centre marked: a sprinkler is counted, so the head
      // has to be distinguishable from a detector at a glance.
      return [circle(0.5), circle(0.12, 8)];
    case 'alarm':
      // A triangle points at nothing in particular; it is here because it is
      // the shape least mistakable for a circle or a square.
      return [[{ x: 0, y: -0.5 }, { x: 0.5, y: 0.4 }, { x: -0.5, y: 0.4 }, { x: 0, y: -0.5 }]];
    case 'light':
      return [circle(0.5), [{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }], [{ x: 0, y: -0.5 }, { x: 0, y: 0.5 }]];
    case 'terminal':
      return [square(0.5), [{ x: -0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]];
    case 'electrical':
    default:
      return [square(0.5)];
  }
}
