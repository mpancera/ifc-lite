/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UI_COLOR_KEYS,
  applyPalette,
  applyUiColors,
  clearUiColors,
  parsePalette,
  type StyleTarget,
} from './palette.js';

/** Minimal CSSStyleDeclaration stand-in that records priority. */
function fakeTarget() {
  const set = new Map<string, { value: string; priority: string }>();
  const target: StyleTarget = {
    style: {
      setProperty: (name: string, value: string, priority?: string) => {
        set.set(name, { value, priority: priority ?? '' });
      },
      removeProperty: (name: string) => { set.delete(name); return ''; },
    } as unknown as CSSStyleDeclaration,
  };
  return { target, set };
}

test('parsePalette: rejects a non-object', () => {
  assert.equal(parsePalette('nope').palette, null);
  assert.equal(parsePalette(null).palette, null);
});

test('parsePalette: id and name are required', () => {
  const { palette, errors } = parsePalette({ ui: { light: { background: '#fff' } } });
  assert.equal(palette, null);
  assert.ok(errors.some((e) => e.startsWith('id')));
  assert.ok(errors.some((e) => e.startsWith('name')));
});

test('parsePalette: accepts hex and CSS colour functions', () => {
  const { palette, errors } = parsePalette({
    id: 'p', name: 'P',
    ui: { light: { background: '#FAFAFA', foreground: 'hsl(240 10% 3.9%)' } },
  });
  assert.deepEqual(errors, []);
  assert.equal(palette?.ui?.light?.background, '#FAFAFA');
  assert.equal(palette?.ui?.light?.foreground, 'hsl(240 10% 3.9%)');
});

test('parsePalette: a bad colour is skipped and named, the rest still loads', () => {
  // A palette that is mostly right should load with the problem reported —
  // failing the whole file would leave the user with no palette and no clue.
  const { palette, errors } = parsePalette({
    id: 'p', name: 'P',
    ui: { light: { background: '#FAFAFA', foreground: 'javascript:alert(1)' } },
  });
  assert.equal(palette?.ui?.light?.background, '#FAFAFA');
  assert.equal(palette?.ui?.light?.foreground, undefined);
  assert.ok(errors.some((e) => e.includes('foreground')));
});

test('parsePalette: an unknown colour role is reported, not applied', () => {
  const { palette, errors } = parsePalette({
    id: 'p', name: 'P', ui: { light: { notARole: '#fff' } },
  });
  assert.equal(palette?.ui, undefined);
  assert.ok(errors.some((e) => e.includes('notARole')));
});

test('parsePalette: dataViz keeps order and drops non-colours', () => {
  const { palette, errors } = parsePalette({
    id: 'p', name: 'P', dataViz: ['#009999', 'not-a-colour', '#D72339'],
  });
  assert.deepEqual(palette?.dataViz, ['#009999', '#D72339']);
  assert.ok(errors.some((e) => e.includes('dataViz[1]')));
});

test('applyUiColors: writes with important priority', () => {
  // The built-in dark theme declares its colours with !important, so a plain
  // inline custom property would lose and dark mode would ignore the palette.
  const { target, set } = fakeTarget();
  applyUiColors(target, { background: '#000028' });

  assert.deepEqual(set.get('--color-background'), { value: '#000028', priority: 'important' });
});

test('applyPalette: uses the colours of the active mode', () => {
  const { target, set } = fakeTarget();
  const palette = parsePalette({
    id: 'p', name: 'P',
    ui: { light: { background: '#FAFAFA' }, dark: { background: '#000028' } },
  }).palette!;

  applyPalette(target, palette, 'light');
  assert.equal(set.get('--color-background')?.value, '#FAFAFA');

  applyPalette(target, palette, 'dark');
  assert.equal(set.get('--color-background')?.value, '#000028');
});

test('applyPalette: switching modes drops colours the new mode does not define', () => {
  // Otherwise a light-only role would bleed into dark mode and read as a bug
  // that only appears after toggling the theme.
  const { target, set } = fakeTarget();
  const palette = parsePalette({
    id: 'p', name: 'P',
    ui: { light: { background: '#FAFAFA', ring: '#006B80' }, dark: { background: '#000028' } },
  }).palette!;

  applyPalette(target, palette, 'light');
  applyPalette(target, palette, 'dark');
  assert.equal(set.has('--color-ring'), false);
});

test('applyPalette: no palette restores the built-in theme', () => {
  const { target, set } = fakeTarget();
  applyUiColors(target, { background: '#000028', primary: '#009999' });
  applyPalette(target, null, 'light');

  assert.equal(set.size, 0);
});

test('clearUiColors: removes every role the palette could have set', () => {
  const { target, set } = fakeTarget();
  for (const key of UI_COLOR_KEYS) {
    target.style.setProperty(`--color-${key}`, '#fff', 'important');
  }
  clearUiColors(target);

  assert.equal(set.size, 0);
});
