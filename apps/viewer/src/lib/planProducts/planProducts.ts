/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A plan PRODUCT — one drawing's worth of intent over the shared model.
 *
 * There is one Brandschutz model. From it come two drawings that a fire
 * authority would recognise as different documents: a Plan Brandschutzkonzept
 * and a Feuerwehrlageplan. They are NOT two visibility settings of the same
 * drawing, and the distinction is the whole reason this module exists.
 *
 * # Why a product is not a set of checkboxes
 * A floor plan shows what the model holds. A Feuerwehrlageplan shows what the
 * fire brigade needs and deliberately leaves out almost everything else — a
 * different SELECTION RULE, not a dimmer switch over the same one. Written as
 * toggles, the second drawing is only ever reachable by remembering which
 * fifteen switches to flip, and nobody reproduces that twice the same way.
 *
 * # Why the rotation lives here and not on the project
 * `planRotationStore` remembers how a project's plan is turned, and for a
 * building plan that is right: north is north for everybody. A
 * Feuerwehrlageplan is turned to the APPROACH DIRECTION instead, so the north
 * arrow points off at an angle — that is the convention, not a mistake. Two
 * intentions over one building, and a single project-wide angle cannot hold
 * both: opening the second product would silently retune the first. So a
 * product may carry its own angle, and `null` means "whatever the project is
 * set to" — which keeps every existing plan behaving exactly as before.
 *
 * # What a product is NOT allowed to be
 * None of this is written into the IFC. A product is an opinion about how to
 * DRAW the model, and the file must export byte-for-byte the same whether it
 * was opened under one product or the other. What the model carries — zones,
 * escape routes, the key depot — is authored through the normal editing tools
 * and belongs to the building; a product only decides what is drawn from it.
 */

import type { ProductSheet } from './productSheet.js';
import { BRANDSCHUTZ_SHEET, LAGEPLAN_SHEET } from './productSheet.js';

/**
 * One named drawing rule.
 *
 * Every field is a rule about DRAWING. There is deliberately no field naming
 * individual elements: a product that lists express IDs is a saved selection,
 * which breaks the first time somebody adds a detector, and the drawing it
 * produces silently stops being complete.
 */
export interface PlanProduct {
  /**
   * Stable key. Never shown, never translated — it identifies the product in
   * storage, so renaming a product must not orphan what was saved under it.
   */
  readonly id: string;
  /** What the author picks from, in the language of the drawing. */
  readonly name: string;
  /** One line saying what this drawing is for, shown under the name. */
  readonly purpose: string;
  /**
   * Whether this came with the viewer. Built-ins can be edited into a copy but
   * not overwritten, so a person who experiments can always get back to the
   * drawing the norm asks for.
   */
  readonly builtIn: boolean;
  /**
   * Zone themes to draw, by their `themes.ts` id.
   *
   * Empty means no zones at all, which is a legitimate product (a pure
   * device plan), not an unconfigured one.
   */
  readonly zoneThemes: readonly string[];
  /**
   * IFC entity names that carry the drawing, lower-cased for lookup.
   *
   * The building fabric a drawing needs for orientation plus the fire safety
   * equipment it is actually about. Held as entity names rather than
   * Fachklassen because a drawing shows all doors, not `IfcDoor.FIREDOOR`
   * alone — the refinement decides the SYMBOL, which is the symbol
   * catalogue's job, not the selection's.
   */
  readonly classes: readonly string[];
  /**
   * Which symbol set the drawing uses, matching the `products` field in the
   * symbol catalogue. `null` until the catalogue is wired up, which is why
   * nothing here depends on it existing yet.
   */
  readonly symbolSet: string | null;
  /**
   * The drawing's own rotation in radians, or `null` to follow the project.
   *
   * See the module note: `null` is not "zero", it is "no opinion". A product
   * with no opinion inherits the project's angle and behaves like every plan
   * did before products existed.
   */
  readonly rotation: number | null;
  /** Paper, scale and the views placed on it. */
  readonly sheet: ProductSheet;
}

/** Product ids the viewer ships. Referenced by the symbol catalogue too. */
export const BRANDSCHUTZKONZEPT_ID = 'brandschutzkonzept';
export const FEUERWEHRLAGEPLAN_ID = 'feuerwehrlageplan';

/**
 * Building fabric every fire drawing needs to be readable as a plan.
 *
 * Without walls and stairs a fire drawing is a scatter of symbols on white
 * paper — true, and useless. These are the CONTEXT, drawn thin; what the
 * drawing is about is added per product below.
 */
const FABRIC: readonly string[] = [
  'ifcwall',
  'ifcwallstandardcase',
  'ifcdoor',
  'ifcstair',
  'ifcstairflight',
  'ifcslab',
  'ifccolumn',
];

/**
 * The two products the viewer ships.
 *
 * Deliberately a short list of long entries rather than a clever composition:
 * somebody reading this file should be able to see what each drawing shows
 * without holding a second one in their head.
 */
export const BUILT_IN_PRODUCTS: readonly PlanProduct[] = [
  {
    id: BRANDSCHUTZKONZEPT_ID,
    name: 'Plan Brandschutzkonzept',
    purpose: 'Brandabschnitte, Fluchtwege und die Brandschutztechnik im Detail.',
    builtIn: true,
    // Everything the concept is about. The trigger and extinguishing zones
    // belong here and NOT on the Lageplan below: a fire brigade arriving does
    // not act on a detection zone boundary, and drawing it there would crowd
    // out what they do act on.
    zoneThemes: [
      'fire-compartment',
      'smoke',
      'escape-horizontal',
      'escape-vertical',
      'fire-trigger',
      'extinguishing',
    ],
    classes: [
      ...FABRIC,
      'ifcwindow',
      'ifcalarm',
      'ifcsensor',
      'ifcfiresuppressionterminal',
      'ifcflowterminal',
      'ifcdamper',
      'ifcannotation',
    ],
    symbolSet: BRANDSCHUTZKONZEPT_ID,
    // North up. A concept plan is read alongside the architect's drawings and
    // has to line up with them.
    rotation: null,
    sheet: BRANDSCHUTZ_SHEET,
  },
  {
    id: FEUERWEHRLAGEPLAN_ID,
    name: 'Feuerwehrlageplan',
    purpose: 'Was die Feuerwehr bei der Anfahrt braucht — bewusst reduziert.',
    builtIn: true,
    // Four themes against the concept's six. What survives is what somebody
    // standing at the building acts on: which compartment is burning, and
    // where the stairs are.
    zoneThemes: [
      'fire-compartment',
      'escape-vertical',
    ],
    classes: [
      ...FABRIC,
      'ifcalarm',
      'ifcfiresuppressionterminal',
      // Site level: the access route and the key depot. Authored as real
      // elements under IfcSite, which is why they are entity names here like
      // everything else rather than a special case.
      'ifcgeographicelement',
      'ifccivilelement',
      'ifcannotation',
    ],
    symbolSet: FEUERWEHRLAGEPLAN_ID,
    // Deliberately null rather than an angle: the approach direction is a
    // property of THIS building and nobody can guess it here. The author sets
    // it once, and from then on it belongs to this product rather than to the
    // project — see the module note.
    rotation: null,
    sheet: LAGEPLAN_SHEET,
  },
];

/** The product a session starts in. */
export const DEFAULT_PRODUCT_ID = BRANDSCHUTZKONZEPT_ID;

/** Look one up by id, built-ins and saved ones alike. */
export function findProduct(
  products: readonly PlanProduct[],
  id: string | null | undefined,
): PlanProduct | null {
  if (!id) return null;
  return products.find((product) => product.id === id) ?? null;
}

/**
 * Whether a product draws a given IFC class.
 *
 * Case-insensitive because the caller's class name comes from the file, where
 * `IFCWALL` and `IfcWall` are the same entity written by two different tools.
 */
export function productDrawsClass(product: PlanProduct, entity: string): boolean {
  const wanted = entity.trim().toLowerCase();
  return wanted.length > 0 && product.classes.includes(wanted);
}

/** Whether a product draws a given zone theme, by its `themes.ts` id. */
export function productDrawsTheme(product: PlanProduct, themeId: string): boolean {
  return product.zoneThemes.includes(themeId);
}

/**
 * A copy of a product under a new id and name, for "duplicate and edit".
 *
 * The copy is never a built-in, whatever it was copied from — that is what
 * makes the shipped products un-losable.
 */
export function copyProduct(product: PlanProduct, id: string, name: string): PlanProduct {
  return { ...product, id, name, builtIn: false };
}
