/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The move gizmo stays out of the 2D plan.
 *
 * Plan mode COVERS the 3D viewport rather than replacing it, so an overlay
 * that places itself with the 3D camera's projection keeps drawing — over a
 * plan whose transform it knows nothing about. The axis cross ended up beside
 * the building while the selected wall sat elsewhere, reported as "in 2D
 * völlig falsch, eher ein Relikt".
 *
 * The test drives the real overlay through the real store and changes exactly
 * ONE thing between the two cases: `viewMode`. Anything less — asserting the
 * source contains a check, or asserting the 2D case renders nothing without
 * first proving the 3D case renders something — would pass just as happily
 * against an overlay that never draws at all.
 */

import '@/test/setup-dom.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useViewerStore } from '@/store/index.js';
import { GizmoOverlay } from './GizmoOverlay.js';

const MODEL_ID = 'model-1';
const WALL_ID = 42;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

function renderNode(node: ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(node); });
  mounted.push({ root, container });
  return container;
}

/** One mesh with a real vertex range, so the bbox centre resolves. */
function wallMesh() {
  return {
    expressId: WALL_ID,
    ifcType: 'IfcWall',
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 2, 3, 0, 0, 3, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

/**
 * Everything the gizmo's own render conditions ask for, so that the only
 * question left open is the view mode.
 */
function armTheGizmo(viewMode: '2d' | '3d') {
  const geometryResult = { meshes: [wallMesh()] } as never;
  useViewerStore.setState({
    viewMode,
    editEnabled: true,
    activeTool: 'select',
    selectedEntityId: WALL_ID,
    selectedEntity: { modelId: MODEL_ID, expressId: WALL_ID } as never,
    geometryResult,
    models: new Map([[MODEL_ID, {
      id: MODEL_ID,
      ifcDataStore: {} as never,
      geometryResult,
    } as never]]) as never,
    cameraCallbacks: {
      ...useViewerStore.getState().cameraCallbacks,
      // A projection that always answers: the point of the test is the gate,
      // not the camera.
      projectToScreen: () => ({ x: 100, y: 100 }),
    } as never,
    readEntityPosition: () => ({ x: 0, y: 0, z: 0 }) as never,
  } as never);
}

/** The axis arrows, by the colours the overlay assigns them. */
function axisElements(container: HTMLElement): number {
  return [...container.querySelectorAll('line, path, polygon')]
    .filter((el) => {
      const paint = `${el.getAttribute('stroke') ?? ''}${el.getAttribute('fill') ?? ''}`;
      return /#ef4444|#10b981|#3b82f6/i.test(paint);
    }).length;
}

describe('the move gizmo in plan mode', () => {
  beforeEach(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => { root.unmount(); });
      container.remove();
    }
  });

  after(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => { root.unmount(); });
      container.remove();
    }
  });

  it('draws its axes in 3D, where the projection means something', () => {
    armTheGizmo('3d');
    assert.ok(axisElements(renderNode(<GizmoOverlay />)) > 0, 'expected axis arrows in 3D');
  });

  it('draws nothing once the plan covers the viewport', () => {
    armTheGizmo('2d');
    assert.equal(axisElements(renderNode(<GizmoOverlay />)), 0);
  });
});
