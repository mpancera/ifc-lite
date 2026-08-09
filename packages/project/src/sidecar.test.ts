/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { isSidecarOf, sidecarFileName, DEFAULT_SIDECAR_PREFIX } from './sidecar.js';

describe('sidecarFileName', () => {
  it('names a per-project file', () => {
    expect(sidecarFileName('heights')).toBe('dc.heights.json');
  });

  it('names a per-model file after the model', () => {
    expect(sidecarFileName('storeys', { subject: 'ARC-01' })).toBe('dc.storeys.ARC-01.json');
  });

  it('replaces an IFC extension rather than stacking on it', () => {
    // A model name usually arrives as a file name.
    for (const name of ['a.ifc', 'a.IFC', 'a.ifcx', 'a.ifczip']) {
      expect(sidecarFileName('storeys', { subject: name })).toBe('dc.storeys.a.json');
    }
  });

  it("runs the caller's sanitiser over the subject", () => {
    // The rules belong to the target filesystem, not to this module.
    expect(sidecarFileName('storeys', {
      subject: 'a/b:c.ifc',
      sanitize: (n) => n.replace(/[^a-z]/gi, '-'),
    })).toBe('dc.storeys.a-b-c.json');
  });

  it('drops a subject that sanitises away, rather than leaving an empty segment', () => {
    // `dc.storeys..json` is a name nobody can act on.
    expect(sidecarFileName('storeys', { subject: '///', sanitize: () => '' }))
      .toBe('dc.storeys.json');
    expect(sidecarFileName('storeys', { subject: '   ' })).toBe('dc.storeys.json');
  });

  it('takes a different prefix', () => {
    expect(sidecarFileName('heights', { prefix: 'x.' })).toBe('x.heights.json');
  });

  it('takes no prefix at all', () => {
    expect(sidecarFileName('heights', { prefix: '' })).toBe('heights.json');
  });

  it('keeps the default prefix short', () => {
    // It repeats on every file; its job is grouping, not explaining.
    expect(DEFAULT_SIDECAR_PREFIX.length).toBeLessThanOrEqual(4);
  });
});

describe('isSidecarOf', () => {
  it('recognises the current name', () => {
    expect(isSidecarOf('dc.heights.json', 'heights')).toBe(true);
    expect(isSidecarOf('dc.storeys.ARC-01.json', 'storeys')).toBe(true);
  });

  it('recognises a file written before the prefix existed', () => {
    // Reading is more forgiving than writing on purpose: refusing an older
    // but well-formed file would lose data for no gain.
    expect(isSidecarOf('heights.json', 'heights')).toBe(true);
  });

  it('recognises another toolchain-s prefix', () => {
    expect(isSidecarOf('acme.heights.json', 'heights')).toBe(true);
  });

  it('does not match a name that merely contains the word', () => {
    expect(isSidecarOf('myheights.json', 'heights')).toBe(false);
    expect(isSidecarOf('heights.txt', 'heights')).toBe(false);
  });

  it('keeps the two kinds apart', () => {
    expect(isSidecarOf('dc.storeys.a.json', 'heights')).toBe(false);
    expect(isSidecarOf('dc.heights.json', 'storeys')).toBe(false);
  });
});
