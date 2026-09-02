/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { Protocol } from './protocol.js';
import { MessageCodes, message } from './messages.js';

describe('Protocol', () => {
  it('records decisions with and without data', () => {
    const p = new Protocol();
    p.note('detect', 'DXF recognised');
    p.note('units', 'unit from $INSUNITS', { insunits: 6 });
    expect(p.decisions).toEqual([
      { step: 'detect', message: 'DXF recognised' },
      { step: 'units', message: 'unit from $INSUNITS', data: { insunits: 6 } },
    ]);
  });

  it('keeps every message, even the same code twice for different pages', () => {
    const p = new Protocol();
    p.say(message(MessageCodes.PDF_EMPTY_PAGE, 'info', { page: 0 }));
    p.say(message(MessageCodes.PDF_EMPTY_PAGE, 'info', { page: 1 }));
    expect(p.messages).toHaveLength(2);
    expect(p.messages[1].text).toBe('Page 2 is empty.');
  });

  it('accumulates timings per step with an injectable clock', () => {
    let t = 0;
    const p = new Protocol(() => t);
    const r = p.time('parse', () => {
      t += 12;
      return 'ok';
    });
    p.time('parse', () => {
      t += 3;
    });
    expect(r).toBe('ok');
    expect(p.timings).toEqual({ parse: 15 });
  });

  it('times asynchronous stages and records even when they throw', async () => {
    let t = 0;
    const p = new Protocol(() => t);
    await expect(
      p.timeAsync('load', async () => {
        t += 7;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(p.timings).toEqual({ load: 7 });
  });
});
