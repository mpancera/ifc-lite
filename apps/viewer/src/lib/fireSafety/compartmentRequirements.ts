/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a Brandabschnitt REQUIRES of the elements that form it.
 *
 * This is the Anforderungsinformation of the IG BIM&BS triad — the minimum
 * from the fire-safety concept, kept on the spatial element rather than on the
 * building parts. The Planungsinformation (what the wall is actually built to,
 * after acoustics and building physics have had their say) belongs on the
 * element and is usually higher; the Leistungsinformation is what was offered
 * and installed. Keeping the requirement here is what stops every small layout
 * change from touching a fire-safety model.
 *
 * The names and the value lists are NOT ours. They come from the Swiss
 * fire-safety exchange requirement's own check for a Brandabschnitt, which
 * reads `CHIBB_FireCompartmentRequirements` off an `IfcSpatialZone` and
 * compares the strings. A value spelled our way would pass every internal test
 * and fail the only check that matters, so the lists are transcribed exactly —
 * hyphen, case and all ("EI30-RF1", not "EI30 RF1").
 *
 * # Unset and NONE are different answers
 *
 * Every list ends in `NONE`, and that means "no requirement" — a decision that
 * was made. A property that is absent means nobody has decided yet. Collapsing
 * the two would turn an open question into a cleared one, which is the failure
 * mode this whole strand exists to prevent, so the picker offers an empty
 * entry and writes nothing for it.
 */

/** The property set the exchange requirement reads. */
export const COMPARTMENT_PSET = 'CHIBB_FireCompartmentRequirements';

export interface CompartmentRequirement {
  /** Property name, exactly as the requirement spells it. */
  name: string;
  /** What the author reads. */
  label: string;
  /** The permitted values, exactly as the requirement spells them. */
  values: readonly string[];
}

/**
 * Fire resistance of a compartment-forming part, by what the part does.
 *
 * Walls, slabs and the load-bearing structure carry the same alphabet with
 * different entries — openings have no `REI` (a door carries nothing) and the
 * structure has only `R` (it bears, it does not separate). Three separate
 * lists rather than one filtered, because the differences ARE the rule.
 */
const SEPARATING = [
  'EI30', 'EI30-Glas', 'EI30-RF1', 'EI60', 'EI60-Glas', 'EI60-RF1',
  'EI90', 'EI90-Glas', 'EI90-RF1',
  'E30', 'E30-Glas', 'E60', 'E90',
  'REI60', 'REI90', 'REI120', 'REI180',
  'RF1', 'RF1-Glas', 'NONE',
] as const;

const OPENINGS = [
  'EI30', 'EI30-Glas', 'EI30-RF1', 'EI60', 'EI60-Glas', 'EI60-RF1',
  'EI90', 'EI90-Glas', 'EI90-RF1',
  'E30', 'E30-Glas', 'E60',
  'RF1', 'RF1-Glas', 'NONE',
] as const;

const LOAD_BEARING = ['R30', 'R60', 'R90', 'R120', 'R180', 'R0', 'NONE'] as const;

/**
 * The five, in the order an author fills them.
 *
 * Not the order the specification lists them in: that is alphabetical by
 * accident of editing, and walls are what a compartment is argued about.
 * Ordering is a reading decision and ours to make — the NAMES are not.
 */
export const COMPARTMENT_REQUIREMENTS: readonly CompartmentRequirement[] = [
  { name: 'EscapeRouteType', label: 'Fluchtweg', values: ['Horizontal', 'Vertical', 'NONE'] },
  { name: 'FireRatingWalls', label: 'Feuerwiderstand Wände', values: SEPARATING },
  { name: 'FireRatingSlabs', label: 'Feuerwiderstand Decken', values: SEPARATING },
  { name: 'FireRatingOpenings', label: 'Feuerwiderstand Öffnungen', values: OPENINGS },
  { name: 'FireRatingConstruction', label: 'Feuerwiderstand Tragwerk', values: LOAD_BEARING },
];

/** Look one up by its property name. */
export function requirementByName(name: string): CompartmentRequirement | null {
  return COMPARTMENT_REQUIREMENTS.find((r) => r.name === name) ?? null;
}

/**
 * Is `value` one this requirement permits?
 *
 * Case-sensitive, because the check that matters is. A value that only differs
 * in case is a value another tool wrote its own way, and calling it valid here
 * would hide the one thing worth reporting.
 */
export function isPermitted(requirement: CompartmentRequirement, value: string): boolean {
  return requirement.values.includes(value);
}

/**
 * How a compartment reads in one line — for a list column or a tooltip.
 *
 * Only what is set: a row of five "—" says nothing, and the point of the
 * distinction between unset and NONE is lost the moment they are printed
 * alike.
 */
export function summariseRequirements(values: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  for (const requirement of COMPARTMENT_REQUIREMENTS) {
    const value = values.get(requirement.name);
    if (value) parts.push(`${requirement.label}: ${value}`);
  }
  return parts.join(' · ');
}
