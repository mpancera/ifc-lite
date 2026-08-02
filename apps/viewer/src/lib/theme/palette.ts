/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Loadable colour palettes.
 *
 * A deployment that is not stock ifclite should be recognisable as such at a
 * glance — someone who uses both needs to know which one they are in before
 * they click anything. Type and layout stay put; only colour changes, which is
 * enough to tell the two apart without turning it into a different product.
 *
 * Palettes are DATA, loaded at runtime, never compiled in. That keeps any
 * organisation's brand colours out of this repository: the mechanism is
 * public, a particular corporate identity is not. The built-in default is
 * ifclite's own palette, unchanged.
 *
 * Two independent parts, because they answer to different rules:
 *   - `ui`      chrome — surfaces, text, borders, actions. Needs contrast.
 *   - `dataViz` series colours for Lens. Needs mutual distinguishability, and
 *                is normally a separate palette in a design system for exactly
 *                that reason.
 */

/** CSS custom properties the UI palette may set, mirroring the `@theme` block. */
export const UI_COLOR_KEYS = [
  'background', 'foreground',
  'card', 'card-foreground',
  'popover', 'popover-foreground',
  'primary', 'primary-foreground',
  'secondary', 'secondary-foreground',
  'muted', 'muted-foreground',
  'accent', 'accent-foreground',
  'destructive', 'destructive-foreground',
  'border', 'input', 'ring',
] as const;

export type UiColorKey = typeof UI_COLOR_KEYS[number];

/** A colour per role. Every key optional — a palette may restyle only part. */
export type UiColorSet = Partial<Record<UiColorKey, string>>;

export interface ColorPalette {
  /** Stable id; also the storage key. */
  id: string;
  /** Shown in the palette picker. */
  name: string;
  /** Optional provenance note, e.g. which design system this came from. */
  source?: string;
  ui?: { light?: UiColorSet; dark?: UiColorSet };
  /** Series colours for Lens, in the order rules should consume them. */
  dataViz?: string[];
}

export interface PaletteValidationResult {
  palette: ColorPalette | null;
  errors: string[];
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** `hsl(240 10% 3.9%)` and friends — the form the built-in theme already uses. */
const CSS_COLOR = /^(?:hsl|hsla|rgb|rgba|oklch|lab|lch)\([^;{}]*\)$/i;

function isColor(value: unknown): value is string {
  return typeof value === 'string' && (HEX.test(value.trim()) || CSS_COLOR.test(value.trim()));
}

function readColorSet(raw: unknown, where: string, errors: string[]): UiColorSet | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    errors.push(`${where}: expected an object of colour roles`);
    return undefined;
  }
  const out: UiColorSet = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(UI_COLOR_KEYS as readonly string[]).includes(key)) {
      errors.push(`${where}.${key}: not a known colour role`);
      continue;
    }
    if (!isColor(value)) {
      errors.push(`${where}.${key}: "${String(value)}" is not a colour`);
      continue;
    }
    out[key as UiColorKey] = (value as string).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parse and validate a palette. Unknown roles and malformed colours are
 * reported and skipped rather than failing the whole file — a palette that is
 * 90% right should load, with the rest named, instead of silently doing
 * nothing.
 */
export function parsePalette(json: unknown): PaletteValidationResult {
  const errors: string[] = [];
  if (typeof json !== 'object' || json === null) {
    return { palette: null, errors: ['Not a palette object.'] };
  }
  const raw = json as Record<string, unknown>;

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id) errors.push('id: required');
  if (!name) errors.push('name: required');

  const light = readColorSet((raw.ui as Record<string, unknown> | undefined)?.light, 'ui.light', errors);
  const dark = readColorSet((raw.ui as Record<string, unknown> | undefined)?.dark, 'ui.dark', errors);

  let dataViz: string[] | undefined;
  if (raw.dataViz !== undefined) {
    if (!Array.isArray(raw.dataViz)) {
      errors.push('dataViz: expected an array of colours');
    } else {
      dataViz = raw.dataViz.filter((c, i) => {
        if (isColor(c)) return true;
        errors.push(`dataViz[${i}]: "${String(c)}" is not a colour`);
        return false;
      }) as string[];
      if (dataViz.length === 0) dataViz = undefined;
    }
  }

  if (!id || !name) return { palette: null, errors };
  return {
    palette: {
      id, name,
      source: typeof raw.source === 'string' ? raw.source : undefined,
      ui: light || dark ? { light, dark } : undefined,
      dataViz,
    },
    errors,
  };
}

/**
 * The active palette's series colours, readable outside React.
 *
 * Lens evaluation runs from an effect that reads the store imperatively, not
 * from component props, so the palette has to be reachable without a hook.
 * Kept to the one field that needs it rather than mirroring the whole palette
 * into a second source of truth.
 */
let activeDataViz: readonly string[] | undefined;

export function setActiveDataVizPalette(colors: readonly string[] | undefined): void {
  activeDataViz = colors && colors.length > 0 ? colors : undefined;
}

export function activePaletteDataViz(): readonly string[] | undefined {
  return activeDataViz;
}

/** Element the palette writes to. Split out so tests can pass their own. */
export type StyleTarget = Pick<HTMLElement, 'style'>;

/**
 * Apply a palette's colours for one mode.
 *
 * Written with `important` priority deliberately: the built-in dark theme
 * declares its own values with `!important`, so a plain inline custom property
 * would lose to it and dark mode would silently ignore the palette.
 */
export function applyUiColors(target: StyleTarget, colors: UiColorSet | undefined): void {
  if (!colors) return;
  for (const [key, value] of Object.entries(colors)) {
    target.style.setProperty(`--color-${key}`, value, 'important');
  }
}

/** Remove every colour a palette could have set, restoring the built-in theme. */
export function clearUiColors(target: StyleTarget): void {
  for (const key of UI_COLOR_KEYS) {
    target.style.removeProperty(`--color-${key}`);
  }
}

/**
 * Apply the palette for the mode currently in effect. Called again on a
 * light/dark switch, since the two modes carry different colours.
 */
export function applyPalette(
  target: StyleTarget,
  palette: ColorPalette | null,
  mode: 'light' | 'dark',
): void {
  clearUiColors(target);
  if (!palette?.ui) return;
  applyUiColors(target, mode === 'dark' ? palette.ui.dark : palette.ui.light);
}
