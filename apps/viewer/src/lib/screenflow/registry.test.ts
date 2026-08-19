/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Static integrity checks for the clip registry.
 *
 * A clip fails in front of an audience or not at all: nobody reviews a
 * screenflow by reading it, they review it by watching a recording, and by
 * then the take is spent. So everything that can be checked without a browser
 * is checked here -- both languages present, captions short enough to read,
 * observable actions carrying their proof, and no client or product name in
 * copy that lands in a public repository.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCaptionOverlong } from './pacing';
import { PLANNED_CLIPS, SCREENFLOW_REGISTRY, getClip } from './registry';

describe('the clip registry', () => {
  it('has unique, resolvable ids and unique positions in the series', () => {
    const ids = SCREENFLOW_REGISTRY.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate clip id');
    const numbers = [
      ...SCREENFLOW_REGISTRY.map((c) => c.number),
      ...PLANNED_CLIPS.map((c) => c.number),
    ];
    assert.equal(new Set(numbers).size, numbers.length, 'two clips claim the same position');
    for (const clip of SCREENFLOW_REGISTRY) {
      assert.equal(getClip(clip.id), clip);
      assert.ok(clip.version >= 1, `${clip.id}: version must be >= 1`);
      assert.ok(clip.number >= 0, `${clip.id}: number must not be negative`);
    }
  });

  it('accounts for all five strands, built or planned', () => {
    const numbers = [
      ...SCREENFLOW_REGISTRY.map((c) => c.number).filter((n) => n > 0),
      ...PLANNED_CLIPS.map((c) => c.number),
    ].sort((a, b) => a - b);
    assert.deepEqual(numbers, [1, 2, 3, 4, 5]);
  });

  it('keeps the sample clip out of the strand numbering', () => {
    // The federation sample is number 0: it proved the machinery, it is not a
    // strand. Giving it a strand number would silently claim one is done.
    for (const clip of SCREENFLOW_REGISTRY) {
      assert.ok(clip.number === 0 || clip.number >= 1);
    }
  });
});

describe('every beat', () => {
  it('has a unique id inside its clip', () => {
    for (const clip of SCREENFLOW_REGISTRY) {
      const ids = clip.beats.map((b) => b.id);
      assert.equal(new Set(ids).size, ids.length, `${clip.id}: duplicate beat id`);
      assert.ok(clip.beats.length >= 2, `${clip.id}: a clip needs at least 2 beats`);
    }
  });

  it('carries both languages, because the subtitle track has no fallback', () => {
    for (const clip of SCREENFLOW_REGISTRY) {
      for (const beat of clip.beats) {
        assert.ok(beat.captionDe.trim().length > 0, `${clip.id}/${beat.id}: no German caption`);
        assert.ok(beat.captionEn.trim().length > 0, `${clip.id}/${beat.id}: no English caption`);
      }
    }
  });

  it('keeps captions short enough to be read within one beat', () => {
    for (const clip of SCREENFLOW_REGISTRY) {
      for (const beat of clip.beats) {
        assert.equal(isCaptionOverlong(beat.captionDe), false, `${clip.id}/${beat.id}: German caption too long, split the beat`);
        assert.equal(isCaptionOverlong(beat.captionEn), false, `${clip.id}/${beat.id}: English caption too long, split the beat`);
      }
    }
  });

  it('proves an action landed whenever it performs one', () => {
    for (const clip of SCREENFLOW_REGISTRY) {
      for (const beat of clip.beats) {
        if (!beat.perform) continue;
        // Camera moves are the exception: they change nothing the store can be
        // asked about, and the tween is the content rather than a side effect.
        if (beat.id === 'units' || beat.id === 'to-plan-view' || beat.id === 'to-3d') continue;
        assert.ok(beat.settled, `${clip.id}/${beat.id}: performs without a proof it landed`);
      }
    }
  });

  it('never proves itself with a constant', () => {
    // `settled: () => true` is not a proof, it is a beat that cannot fail.
    // Five wall beats once played their captions and created nothing, and the
    // clip reported a clean run: the constant swallowed the failure.
    for (const clip of SCREENFLOW_REGISTRY) {
      for (const beat of clip.beats) {
        if (!beat.settled) continue;
        const body = beat.settled.toString().replace(/\s+/g, '');
        assert.ok(
          !/^\(?[a-z]*\)?=>true$/i.test(body),
          `${clip.id}/${beat.id}: settled is a constant - assert what the action produced`,
        );
      }
    }
  });

  it('only declares files the dataset knows about', async () => {
    const { DEMO_FILES } = await import('./dataset');
    for (const clip of SCREENFLOW_REGISTRY) {
      for (const id of clip.requires ?? []) {
        assert.ok(id in DEMO_FILES, `${clip.id}: unknown demo file ${id}`);
      }
    }
  });
});

describe('copy that lands in a public repository', () => {
  // The repository is world-readable (AGENTS.md). Committed clip copy is
  // generic; the real names arrive through the git-ignored caption overrides.
  // Whole words: "Lageplan" contains "eplan", and a substring match would
  // reject the correct German word for the thing strand 4 is about.
  const FORBIDDEN = ['langmatt', 'siemens', 'autocad', 'eplan', 'revit', 'fs-project'];
  const namesForbidden = (text: string): string | null =>
    FORBIDDEN.find((word) => new RegExp(`\\b${word}\\b`, 'i').test(text)) ?? null;

  it('actually detects a forbidden name', () => {
    // Without this, a botched escape (`\b` in a template literal is a
    // backspace, not a word boundary) makes every assertion below vacuous.
    assert.equal(namesForbidden('Export nach AutoCAD'), 'autocad');
    assert.equal(namesForbidden('Feuerwehrlageplan'), null, 'Lageplan contains ePLAN as a substring');
  });

  it('names no client, and no third-party product', () => {
    const texts: Array<[string, string]> = [];
    for (const clip of SCREENFLOW_REGISTRY) {
      texts.push([clip.id, clip.titleDe], [clip.id, clip.titleEn]);
      texts.push([clip.id, clip.messageDe], [clip.id, clip.messageEn]);
      for (const beat of clip.beats) {
        texts.push([`${clip.id}/${beat.id}`, beat.captionDe], [`${clip.id}/${beat.id}`, beat.captionEn]);
      }
    }
    for (const planned of PLANNED_CLIPS) {
      texts.push([`planned-${planned.number}`, planned.titleDe]);
      texts.push([`planned-${planned.number}`, planned.stepDe]);
      texts.push([`planned-${planned.number}`, planned.needsDe]);
    }
    for (const [at, text] of texts) {
      const hit = namesForbidden(text);
      assert.equal(hit, null, `${at}: copy names "${hit}" - keep it in the local caption overrides`);
    }
  });
});
