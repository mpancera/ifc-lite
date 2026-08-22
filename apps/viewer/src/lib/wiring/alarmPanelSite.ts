/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where an alarm panel goes when the model has none.
 *
 * # Why guess at all
 * A detection installation without its panel is a set of detectors reporting
 * to nothing, and the omission is invisible: every device looks right, every
 * circuit looks right, and the one box the fire service walks to is missing.
 * Placing one at a defensible spot and saying so is better than leaving the
 * hole — the position is a starting point somebody drags, the existence is
 * the thing that must not be forgotten.
 *
 * # The rule
 * Ground floor, by the entrance. That is where a panel belongs — the fire
 * service has to reach it from outside without going through the building —
 * and it is a rule that can be read off room names rather than guessed from
 * geometry. Everything here is name matching, which is why it is pure and
 * testable; the geometric part (where in the room) is the caller's.
 *
 * When nothing matches, the answer is the ground-floor storey itself and the
 * caller places the panel at the storey origin. Ugly, findable, and honest —
 * the alternative is not placing it, which is the failure this exists to end.
 */

/** A room as this module needs it. */
export interface PanelCandidateRoom {
  readonly expressId: number;
  readonly name: string;
  readonly longName: string;
  readonly storeyId: number;
}

export interface PanelCandidateStorey {
  readonly expressId: number;
  readonly name: string;
}

/**
 * Names an entrance goes by, in the order a match is preferred.
 *
 * `Vorhalle` and `Vestibül` are in because an older building often calls its
 * entrance that and nothing else — the list is only as good as the buildings
 * it has met, and it is a list rather than one regex so a near miss can be
 * added without re-reasoning the whole rule.
 */
const ENTRANCE_WORDS = [
  'eingang',
  'entree',
  'entrée',
  'entrance',
  'foyer',
  'vestibül',
  'vestibul',
  'vorhalle',
  'windfang',
  'empfang',
  'lobby',
  'vorplatz',
];

/**
 * Storey names that mean "ground floor".
 *
 * `00` is the numbering this repository's models use; the words cover a model
 * that was named by a person. A storey called `0` is deliberately NOT matched
 * by a bare prefix test — `0.OG` would match it and mean the wrong thing.
 */
const GROUND_NAMES = ['00', '0', 'eg', 'erdgeschoss', 'ground floor', 'ground', 'rez'];

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/** True when this storey reads as the ground floor. */
export function isGroundStorey(name: string): boolean {
  return GROUND_NAMES.includes(normalise(name));
}

/** How well a room reads as an entrance. Lower is better; `null` is no match. */
function entranceRank(room: PanelCandidateRoom): number | null {
  const haystack = `${normalise(room.name)} ${normalise(room.longName)}`;
  for (let i = 0; i < ENTRANCE_WORDS.length; i += 1) {
    if (haystack.includes(ENTRANCE_WORDS[i])) return i;
  }
  return null;
}

export interface PanelSite {
  /** The room to place it in, or `null` when only a storey could be found. */
  readonly roomId: number | null;
  /** The storey the panel is placed on. Always answered. */
  readonly storeyId: number;
  /** Why this spot — shown to the user, because a guess must say it is one. */
  readonly reason: string;
}

/**
 * Pick the spot, or `null` when the model has no storey at all.
 *
 * Ties between equally-named rooms are broken by express id, so two runs over
 * the same model put the panel in the same place. A tool that moved the panel
 * between runs would be worse than one that never placed it.
 */
export function findAlarmPanelSite(
  rooms: readonly PanelCandidateRoom[],
  storeys: readonly PanelCandidateStorey[],
): PanelSite | null {
  if (storeys.length === 0) return null;
  const ground = storeys.find((s) => isGroundStorey(s.name)) ?? storeys[0];
  const groundIsGuess = !storeys.some((s) => isGroundStorey(s.name));

  const candidates = rooms
    .filter((room) => room.storeyId === ground.expressId)
    .map((room) => ({ room, rank: entranceRank(room) }))
    .filter((entry): entry is { room: PanelCandidateRoom; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.room.expressId - b.room.expressId);

  if (candidates.length > 0) {
    const { room } = candidates[0];
    const label = room.longName || room.name;
    return {
      roomId: room.expressId,
      storeyId: ground.expressId,
      reason: `Eingangsbereich «${label}» im Geschoss ${ground.name}`,
    };
  }

  return {
    roomId: null,
    storeyId: ground.expressId,
    reason: groundIsGuess
      ? `Kein Erdgeschoss erkannt — im Geschoss ${ground.name} abgelegt, bitte verschieben`
      : `Kein Eingangsraum erkannt — im Geschoss ${ground.name} abgelegt, bitte verschieben`,
  };
}
