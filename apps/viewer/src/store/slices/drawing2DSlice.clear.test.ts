/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `clearDrawing2D` drops the cached drawing. It must not take the user's
 * markup with it — that regression looked like annotations expiring on their
 * own, because the only caller is a button that re-opens the 2D view.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore } from '../index.js';

describe('clearDrawing2D', () => {
  it('keeps measurements, areas, text boxes and clouds', () => {
    const s = useViewerStore.getState();

    s.addMeasure2DResult({
      id: 'm1',
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      distance: 1,
    });
    s.addTextAnnotation2D({
      id: 't1',
      position: { x: 2, y: 2 },
      text: 'Brandmelder prüfen',
      fontSize: 14,
      color: '#000000',
      backgroundColor: '#ffffff',
      borderColor: '#000000',
    });
    useViewerStore.setState({
      polygonArea2DResults: [
        { id: 'a1', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], area: 0.5 },
      ] as never,
      cloudAnnotations2D: [
        { id: 'c1', min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, color: '#E53935', label: 'A' },
      ] as never,
    });

    const before = useViewerStore.getState();
    assert.equal(before.measure2DResults.length, 1);
    assert.equal(before.textAnnotations2D.length, 1);

    useViewerStore.getState().clearDrawing2D();

    const after = useViewerStore.getState();
    assert.equal(after.measure2DResults.length, 1, 'measurements survived');
    assert.equal(after.textAnnotations2D.length, 1, 'text boxes survived');
    assert.equal(after.polygonArea2DResults.length, 1, 'areas survived');
    assert.equal(after.cloudAnnotations2D.length, 1, 'clouds survived');
    // …and it still did its actual job.
    assert.equal(after.drawing2D, null);
    assert.equal(after.drawing2DStatus, 'idle');
  });

  it('keeps drawing preferences, which are settings rather than drawing state', () => {
    useViewerStore.getState().updateDrawing2DDisplayOptions({ showConstructionProjection: true });
    useViewerStore.getState().clearDrawing2D();
    assert.equal(
      useViewerStore.getState().drawing2DDisplayOptions.showConstructionProjection,
      true,
    );
  });

  it('leaves removing markup to the tool that says it removes markup', () => {
    useViewerStore.getState().clearAllAnnotations2D();
    useViewerStore.getState().clearMeasure2DResults();
    const s = useViewerStore.getState();
    assert.equal(s.textAnnotations2D.length, 0);
    assert.equal(s.cloudAnnotations2D.length, 0);
    assert.equal(s.polygonArea2DResults.length, 0);
    assert.equal(s.measure2DResults.length, 0);
  });
});
