/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Escape routes: the line somebody walks, and how long it is.
 *
 * # Why this exists beside the escape-route ZONES
 * `lib/ifcZones/themes.ts` already carries `EscapeRouteHorizontal` and
 * `EscapeRouteVertical`, and those are right for what they say: WHICH ROOMS
 * form the escape route. That is a membership statement, and it is what lets a
 * reader ask "is this corridor part of an escape route".
 *
 * It is not what a fire concept is assessed on. The assessment is a LENGTH
 * along a path — how far somebody walks from the furthest point of a room to
 * the exit — and a set of rooms has no length. The two statements are about
 * the same thing and neither substitutes for the other, which is why a route
 * is authored as a polyline here and painted as a zone there.
 *
 * # Why the length is drawn on the plan
 * A drawn route that does not say how long it is asks every later reader to
 * measure it off the paper with a ruler, and that measurement is exactly the
 * one the drawing exists to settle. So the length is computed from the
 * geometry and committed as text beside the route — one number, from the same
 * coordinates that produced the line, which cannot disagree with it.
 *
 * The number is a TRUE length in metres, taken from model coordinates before
 * any plan rotation, because rotation turns the picture and not the building.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';
import type { AnnotationInStoreParams } from '@ifc-lite/create';

/**
 * `ObjectType` stamped on everything this writes.
 *
 * Its own marker rather than reusing `PLAN_ANNOTATION_OBJECTTYPES`: a room
 * label is a restatement of what the model already holds and can be
 * regenerated at will, while a route is something a person DREW and nothing
 * else in the file can reproduce. Committing plan labels must never sweep away
 * somebody's routes, and a shared marker would do exactly that.
 */
export const ESCAPE_ROUTE_OBJECTTYPES = {
  route: 'IfcLite:PlanEscapeRoute',
  arrow: 'IfcLite:PlanEscapeRouteArrow',
  label: 'IfcLite:PlanEscapeRouteLabel',
} as const;

export type EscapeRouteAnnotationKind = keyof typeof ESCAPE_ROUTE_OBJECTTYPES;

const MARKERS: ReadonlySet<string> = new Set<string>(
  Object.values(ESCAPE_ROUTE_OBJECTTYPES),
);

/** Whether an `ObjectType` marks an annotation this module wrote. */
export function isEscapeRouteObjectType(value: string | null | undefined): boolean {
  return typeof value === 'string' && MARKERS.has(value.trim());
}

/**
 * Where `ObjectType` sits in an `IfcAnnotation`'s attribute list.
 *
 * The same index `planAnnotations.ts` documents: `IfcRoot` contributes
 * GlobalId, OwnerHistory, Name and Description; `IfcObject` adds ObjectType at
 * 4. Fixed across IFC2X3, IFC4 and IFC4X3.
 */
export const ANNOTATION_OBJECTTYPE_INDEX = 4;

/**
 * Which existing annotations a re-commit should remove first.
 *
 * Only the kinds being re-committed, and only ones carrying OUR marker. A note
 * somebody drew by hand is not ours to delete — and neither is a room label,
 * which is why this module has its own markers rather than sharing
 * `planAnnotations`'.
 *
 * Candidates come from the file AND the session's overlay, because a committed
 * annotation lives in the overlay until it is exported and in the source
 * afterwards; a route re-committed across that boundary would otherwise double.
 */
export function escapeRouteIdsToReplace(
  candidates: readonly { readonly expressId: number; readonly attributes?: readonly unknown[] }[],
  kinds: readonly EscapeRouteAnnotationKind[],
): number[] {
  const wanted = new Set<string>(kinds.map((kind) => ESCAPE_ROUTE_OBJECTTYPES[kind]));
  if (wanted.size === 0) return [];

  const ids: number[] = [];
  for (const candidate of candidates) {
    const value = candidate.attributes?.[ANNOTATION_OBJECTTYPE_INDEX];
    if (typeof value !== 'string') continue;
    if (wanted.has(value.trim())) ids.push(candidate.expressId);
  }
  return ids;
}

/** Which kind of route this is, matching the zone themes of the same names. */
export type EscapeRouteKind = 'horizontal' | 'vertical';

/** One drawn route. */
export interface EscapeRoute {
  /** Stable key within the storey. */
  readonly id: string;
  /**
   * The walked path, in drawing coordinates, from the furthest point to the
   * exit. Direction matters — it is what the arrows point along.
   */
  readonly points: readonly Point2D[];
  readonly kind: EscapeRouteKind;
  /** What it is called on the plan, e.g. `Fluchtweg 1`. Optional. */
  readonly name?: string;
}

/**
 * The walked length in metres.
 *
 * Straight sum of the segments. A route that turns a corner is walked around
 * the corner, not through it, which is why this is not the distance from the
 * first point to the last — and getting that wrong understates every route
 * that bends, which is all of them.
 */
export function escapeRouteLength(points: readonly Point2D[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.hypot(dx, dy);
  }
  return total;
}

/** `24.6 m`. One decimal — the input is drawn by hand, not surveyed. */
export function formatRouteLength(metres: number): string {
  return `${metres.toFixed(1)} m`;
}

/** Nominal arrow length on paper. */
export const ARROW_PAPER_MM = 4;
/** How far apart arrows sit on paper, measured along the route. */
export const ARROW_SPACING_PAPER_MM = 40;
/** Half-angle of the arrow head, in radians. 20° gives a readable barb. */
const ARROW_HALF_ANGLE = 20 * (Math.PI / 180);

/**
 * Paper millimetres to model metres at a given scale.
 *
 * The same conversion `textHeightMetres` makes, and for the same reason: an
 * arrow drawn at its model size would be invisible, because it has no model
 * size — it is a drawing convention, not a thing in the building.
 */
export function paperMmToMetres(mm: number, scaleDenominator: number | null | undefined): number {
  const usable = typeof scaleDenominator === 'number'
    && Number.isFinite(scaleDenominator)
    && scaleDenominator > 0;
  return (mm / 1000) * (usable ? scaleDenominator : 100);
}

/** A point on the route, with the direction of travel there. */
export interface RoutePoint {
  readonly point: Point2D;
  /** Unit vector along the direction of travel. */
  readonly direction: Point2D;
}

/**
 * Walk a distance along the route and report where that lands.
 *
 * `null` when the route is shorter than the distance asked for, so a caller
 * placing arrows can simply stop rather than having to know the length first.
 */
export function pointAlongRoute(
  points: readonly Point2D[],
  distance: number,
): RoutePoint | null {
  if (points.length < 2 || !Number.isFinite(distance) || distance < 0) return null;

  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const segment = Math.hypot(dx, dy);
    // A zero-length segment has no direction to report; skipping it keeps a
    // duplicated click from producing a NaN arrow.
    if (segment <= 0) continue;

    if (travelled + segment >= distance) {
      const along = (distance - travelled) / segment;
      return {
        point: { x: from.x + dx * along, y: from.y + dy * along },
        direction: { x: dx / segment, y: dy / segment },
      };
    }
    travelled += segment;
  }
  return null;
}

/**
 * Where the direction arrows go.
 *
 * One at the exit end always — that is the arrow that says which way out —
 * and further ones back along the route at a fixed spacing ON PAPER, so a long
 * corridor at 1:200 gets the same visual rhythm as a short one at 1:50. Spaced
 * in model metres instead, a plan would either be bare or a row of barbs
 * depending only on its scale.
 */
export function arrowPositions(
  points: readonly Point2D[],
  scaleDenominator: number | null,
): RoutePoint[] {
  const total = escapeRouteLength(points);
  if (total <= 0) return [];

  const spacing = paperMmToMetres(ARROW_SPACING_PAPER_MM, scaleDenominator);
  const positions: RoutePoint[] = [];

  // The exit end first: it is the one that must never be dropped, whatever
  // the spacing works out to.
  const end = pointAlongRoute(points, total);
  if (end) positions.push(end);

  if (spacing <= 0) return positions;
  // Walk back from the end so the spacing is anchored to the exit rather than
  // to the far point — the arrow at the exit stays put when somebody extends
  // the other end of the route.
  for (let distance = total - spacing; distance > 0; distance -= spacing) {
    const at = pointAlongRoute(points, distance);
    if (at) positions.push(at);
  }
  return positions;
}

/**
 * The two barbs of one arrow head, as a polyline through the tip.
 *
 * One open V rather than a filled triangle: `IfcAnnotation` carries curves
 * here, and a filled head would need a surface — more geometry for something
 * that reads identically on a plan at this size.
 */
export function arrowHead(
  at: RoutePoint,
  lengthMetres: number,
): Point2D[] {
  const heading = Math.atan2(at.direction.y, at.direction.x);
  // Barbs point BACK along the route from the tip, hence the + PI.
  const left = heading + Math.PI - ARROW_HALF_ANGLE;
  const right = heading + Math.PI + ARROW_HALF_ANGLE;

  return [
    { x: at.point.x + Math.cos(left) * lengthMetres, y: at.point.y + Math.sin(left) * lengthMetres },
    { x: at.point.x, y: at.point.y },
    { x: at.point.x + Math.cos(right) * lengthMetres, y: at.point.y + Math.sin(right) * lengthMetres },
  ];
}

/** Drawing point → storey-local IFC, the same flip `planAnnotations` makes. */
function toLocal(point: Point2D): readonly [number, number] {
  return [point.x, -point.y];
}

export interface EscapeRouteAnnotationInput {
  readonly routes: readonly EscapeRoute[];
  /** The plan's current scale, as the 100 in 1:100. */
  readonly scaleDenominator: number | null;
  /** Text height in model metres, from `textHeightMetres`. */
  readonly textHeightMetres: number;
}

/** Everything a set of routes would commit, grouped by what it is. */
export interface EscapeRouteAnnotationSet {
  readonly route: readonly AnnotationInStoreParams[];
  readonly arrow: readonly AnnotationInStoreParams[];
  readonly label: readonly AnnotationInStoreParams[];
}

/**
 * Turn drawn routes into what the model carries.
 *
 * Three kinds rather than one, following `planAnnotations`: somebody who wants
 * the line without the arrows, or without the length text, can take one back
 * without losing the others.
 */
export function escapeRouteAnnotations(
  input: EscapeRouteAnnotationInput,
): EscapeRouteAnnotationSet {
  const route: AnnotationInStoreParams[] = [];
  const arrow: AnnotationInStoreParams[] = [];
  const label: AnnotationInStoreParams[] = [];

  const arrowLength = paperMmToMetres(ARROW_PAPER_MM, input.scaleDenominator);

  for (const drawn of input.routes) {
    // Two points is the shortest thing that is a path at all. One point is an
    // unfinished click, and committing it would put a zero-length route in the
    // file that reads as a real one with a length of nothing.
    if (drawn.points.length < 2) continue;

    const length = escapeRouteLength(drawn.points);
    if (length <= 0) continue;

    const name = drawn.name?.trim() || (
      drawn.kind === 'vertical' ? 'Fluchtweg vertikal' : 'Fluchtweg horizontal'
    );
    // The length rides in Description as well as in the drawn text: a reader
    // that does not render annotations still gets the number, and it stays
    // attached to the line rather than to a piece of text near it.
    const description = `${drawn.kind}|${formatRouteLength(length)}`;

    route.push({
      geometry: { kind: 'polyline', points: drawn.points.map(toLocal) },
      Name: name,
      Description: description,
      ObjectType: ESCAPE_ROUTE_OBJECTTYPES.route,
    });

    for (const at of arrowPositions(drawn.points, input.scaleDenominator)) {
      arrow.push({
        geometry: { kind: 'polyline', points: arrowHead(at, arrowLength).map(toLocal) },
        Name: name,
        Description: description,
        ObjectType: ESCAPE_ROUTE_OBJECTTYPES.arrow,
      });
    }

    // The text sits at the middle of the walked path rather than at the
    // midpoint of the straight line between the ends — on an L-shaped route
    // the latter can land outside the building.
    const middle = pointAlongRoute(drawn.points, length / 2);
    if (middle) {
      const text = formatRouteLength(length);
      const position = toLocal({
        x: middle.point.x,
        // Lifted clear of the line by one text height, so the number is not
        // struck through by the route it describes.
        y: middle.point.y - input.textHeightMetres,
      });
      label.push({
        geometry: {
          kind: 'text',
          text,
          position: [position[0], position[1]],
          width: Math.max(text.length * input.textHeightMetres * 0.6, input.textHeightMetres),
          height: input.textHeightMetres,
        },
        Name: name,
        Description: description,
        ObjectType: ESCAPE_ROUTE_OBJECTTYPES.label,
      });
    }
  }

  return { route, arrow, label };
}

/** `3 Fluchtwege, 11 Richtungspfeile, 3 Längen`. */
export function describeEscapeRouteSet(set: EscapeRouteAnnotationSet): string {
  const parts: string[] = [];
  const say = (n: number, singular: string, plural: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  say(set.route.length, 'Fluchtweg', 'Fluchtwege');
  say(set.arrow.length, 'Richtungspfeil', 'Richtungspfeile');
  say(set.label.length, 'Länge', 'Längen');
  return parts.length > 0 ? parts.join(', ') : 'nichts zu übernehmen';
}
