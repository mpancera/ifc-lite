/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a block reference stands for, from its name.
 *
 * In a security drawing the blocks ARE the devices: detectors, call points,
 * sounders, readers, cameras. Their names follow office conventions, so this
 * is a list of hints with a confidence, never a verdict; a host with its own
 * symbol library passes its names in and they win.
 */

export type SymbolClass =
  | 'detector'
  | 'callpoint'
  | 'sounder'
  | 'reader'
  | 'camera'
  | 'door'
  | 'window'
  | 'sanitary'
  | 'furniture'
  | 'unknown';

export interface SymbolRule {
  class: SymbolClass;
  pattern: RegExp;
  confidence: number;
}

/**
 * Matched against the block name with `_`, `-` and `.` turned into spaces,
 * so `\b` works on the parts of `RM_OPTISCH`. Order matters: the first rule
 * that matches wins, and the device rules come before the furniture rules
 * because "TISCH" is also the tail of "OPTISCH".
 */
export const DEFAULT_SYMBOL_RULES: readonly SymbolRule[] = [
  // Call points before detectors: "Handfeuermelder" contains "melder".
  { class: 'callpoint', pattern: /taster|handfeuer|callpoint|call point|\bmcp\b|\bhfm\b|\bdm\b/i, confidence: 0.85 },
  { class: 'detector', pattern: /melder|detect|smoke|rauch|heat|waerme|wärme|\bsd\b|\brm\b|\bod\b|\bmd\b|optisch|thermisch/i, confidence: 0.85 },
  { class: 'sounder', pattern: /sirene|sounder|\bhorn\b|hupe|blitz|beacon|alarmgeber/i, confidence: 0.8 },
  { class: 'reader', pattern: /leser|reader|badge|\bcard\b|zutritt|access/i, confidence: 0.8 },
  { class: 'camera', pattern: /kamera|camera|cctv|\bcam\b/i, confidence: 0.8 },
  { class: 'door', pattern: /\btuer\b|\btür\b|\bdoor\b|\bporte\b|\bporta\b/i, confidence: 0.7 },
  { class: 'window', pattern: /fenster|window|fenetre|finestra/i, confidence: 0.7 },
  { class: 'sanitary', pattern: /\bwc\b|toilet|lavabo|\bsink\b|\bbad\b|dusche|shower|urinal/i, confidence: 0.6 },
  { class: 'furniture', pattern: /\btisch\b|\btable\b|stuhl|chair|schrank|\bdesk\b|\bbed\b|\bbett\b|sofa|moeb|möb|furn/i, confidence: 0.6 },
];

export interface SymbolClassification {
  class: SymbolClass;
  /** 0-1: how much the name alone says. */
  confidence: number;
  /** The rule that matched, for the protocol. */
  matched?: string;
}

/** Anonymous blocks (`*U12`, `*D7`) are geometry the CAD made up, not symbols. */
export function isAnonymousBlock(name: string): boolean {
  return name.startsWith('*');
}

export function classifyBlock(name: string, rules: readonly SymbolRule[] = DEFAULT_SYMBOL_RULES): SymbolClassification {
  const words = name.replace(/[_\-.]+/g, ' ');
  for (const r of rules) {
    if (r.pattern.test(words)) return { class: r.class, confidence: r.confidence, matched: r.pattern.source };
  }
  return { class: 'unknown', confidence: 0.3 };
}
