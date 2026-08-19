/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filenameStamp, restamp } from './filename-stamp';

describe('filenameStamp', () => {
  it('carries the clock time, not just the day', () => {
    // The reported case: two exports in one sitting used to collide on the
    // date alone, and the second became "… (1)" with nothing to tell them
    // apart afterwards.
    assert.equal(filenameStamp(new Date(2026, 7, 19, 12, 59)), '2026-08-19_1259');
  });

  it('pads every field, so the names sort chronologically', () => {
    assert.equal(filenameStamp(new Date(2026, 0, 5, 9, 7)), '2026-01-05_0907');
    const early = filenameStamp(new Date(2026, 0, 5, 9, 7));
    const later = filenameStamp(new Date(2026, 0, 5, 10, 7));
    assert.ok(early < later, `${early} should sort before ${later}`);
  });

  it('tells two exports minutes apart apart', () => {
    const first = filenameStamp(new Date(2026, 7, 19, 12, 59));
    const second = filenameStamp(new Date(2026, 7, 19, 13, 4));
    assert.notEqual(first, second);
  });
});

describe('restamp', () => {
  const at = (h: number, m: number) => new Date(2026, 7, 19, h, m);

  it('stamps a name that has none', () => {
    assert.equal(restamp('Langmatt_ARC_demo', at(12, 59)), 'Langmatt_ARC_demo_2026-08-19_1259');
  });

  it('replaces its own stamp instead of piling another one on', () => {
    // Export, open the export, export again: the second name is built from the
    // first, and the stamps used to accumulate.
    const once = restamp('Langmatt_ARC_demo', at(12, 59));
    const twice = restamp(once, at(13, 24));
    assert.equal(twice, 'Langmatt_ARC_demo_2026-08-19_1324');
    assert.equal(restamp(twice, at(14, 5)), 'Langmatt_ARC_demo_2026-08-19_1405');
  });

  it('also replaces a stamp from the date-only scheme', () => {
    assert.equal(restamp('Plan_2026-08-19', at(13, 24)), 'Plan_2026-08-19_1324');
  });

  it("leaves a date that is part of the author's own name alone", () => {
    // A survey or revision the client numbered: not this module's stamp shape,
    // so it means whatever they meant and stays.
    assert.equal(restamp('Aufnahme_2024-05-03_Ost', at(13, 24)),
      'Aufnahme_2024-05-03_Ost_2026-08-19_1324');
    assert.equal(restamp('Revision_1200', at(13, 24)), 'Revision_1200_2026-08-19_1324');
  });
});
