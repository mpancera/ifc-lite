/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { inputKindFromName, routeByKind } from './input-kind.js';
import { MessageCodes } from '../messages.js';

describe('inputKindFromName', () => {
  it('reads the extension case-insensitively', () => {
    expect(inputKindFromName('plan.DXF')).toBe('dxf');
    expect(inputKindFromName('plan.dwg')).toBe('dwg');
    expect(inputKindFromName('Ground floor 1_100.pdf')).toBe('pdf');
    expect(inputKindFromName('scan.JPG')).toBe('image');
    expect(inputKindFromName('scan.tiff')).toBe('image');
  });

  it('is unknown without a recognised extension', () => {
    expect(inputKindFromName('plan')).toBe('unknown');
    expect(inputKindFromName('plan.ifc')).toBe('unknown');
    expect(inputKindFromName('plan.dxf.bak')).toBe('unknown');
  });
});

describe('routeByKind', () => {
  it('sends DXF and PDF down the vector route pending a content check', () => {
    expect(routeByKind('a.dxf')).toMatchObject({ kind: 'dxf', route: 'vector', messages: [] });
    expect(routeByKind('a.pdf')).toMatchObject({ kind: 'pdf', route: 'vector', messages: [] });
  });

  it('sends images down the raster route with the underlay hint', () => {
    const r = routeByKind('a.png');
    expect(r.route).toBe('raster');
    expect(r.messages.map((m) => m.code)).toEqual([MessageCodes.RASTER_NOT_SUPPORTED]);
    expect(r.messages[0].text).toMatch(/underlay/);
  });

  it('refuses DWG and says what to ask for', () => {
    const r = routeByKind('a.dwg');
    expect(r.route).toBe('unavailable');
    expect(r.messages[0].code).toBe(MessageCodes.DWG_NOT_READABLE);
    expect(r.messages[0].text).toMatch(/DXF/);
  });

  it('names the file when it cannot place it', () => {
    const r = routeByKind('notes.txt');
    expect(r.route).toBe('unavailable');
    expect(r.messages[0].code).toBe(MessageCodes.UNKNOWN_INPUT);
    expect(r.messages[0].text).toContain('notes.txt');
  });
});
