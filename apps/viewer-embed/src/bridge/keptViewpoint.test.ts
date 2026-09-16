/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `?keepCamera=1`: the view survives a destructive load.
 *
 * Driven through `aroundDestructiveLoad`, because the ORDER is the whole
 * point — the view has to be lifted out before the session reset and put back
 * after it, and a test that called capture/restore directly would pass
 * whatever the wrapper did.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { CameraViewpoint } from '@/store/types.js';
import { aroundDestructiveLoad, resetCameraIntent } from './cameraIntent.js';
import {
  hasKeptViewpoint,
  keepCameraArmed,
  resetKeptViewpoint,
  setKeepCamera,
} from './keptViewpoint.js';

/** A pose that is recognisably NOT the default framing of anything. */
function viewpoint(distance: number): CameraViewpoint {
  return {
    position: { x: distance, y: distance, z: distance },
    target: { x: 0.1, y: 0.2, z: 0.3 },
    up: { x: 0, y: 1, z: 0 },
    fov: 45,
    projectionMode: 'perspective',
  };
}

/**
 * The store as this module sees it: a camera that can be read and written,
 * plus the field that answers "has a model ever been shown here".
 */
function makeState({ shown = true, callbacks = true } = {}) {
  const applied: Array<{ viewpoint: CameraViewpoint; animate?: boolean }> = [];
  let live = viewpoint(50);
  const state: any = {
    geometryResult: shown ? { meshes: [{ expressId: 1 }] } : null,
    cameraCallbacks: callbacks
      ? {
          getViewpoint: () => live,
          applyViewpoint: (vp: CameraViewpoint, animate?: boolean) => {
            applied.push({ viewpoint: vp, animate });
            live = vp;
          },
        }
      : {},
    // Read by the pose queue in the same wrapper; irrelevant here but it
    // shares the getState.
    pendingCameraRotation: null,
    setCameraRotation: () => {},
  };
  return {
    applied,
    getState: () => state,
    /** What the session reset does to the camera: back to the default. */
    resetCamera: () => { live = viewpoint(1000); },
    liveViewpoint: () => live,
  };
}

beforeEach(() => {
  resetCameraIntent();
  resetKeptViewpoint();
});

describe('keepCamera, armed', () => {
  beforeEach(() => setKeepCamera(true));

  it('puts the view back after a load that reset the camera', async () => {
    const store = makeState();
    const before = store.liveViewpoint();

    await aroundDestructiveLoad(store.getState, async () => {
      // This is `loadFile`: the session reset happens inside it, and it is
      // what throws the view away.
      store.resetCamera();
    });

    expect(store.liveViewpoint()).toEqual(before);
    expect(hasKeptViewpoint()).toBe(true);
  });

  it('puts it back without animating', () => {
    // A tween here would be a visible lurch on every keystroke - which is the
    // complaint the flag answers, not a nicety.
    const store = makeState();
    return aroundDestructiveLoad(store.getState, async () => { store.resetCamera(); }).then(() => {
      expect(store.applied).toHaveLength(1);
      expect(store.applied[0].animate).toBe(false);
    });
  });

  it('keeps the distance, not only the direction', async () => {
    // The point of the whole exercise: `SET_CAMERA` could already carry the
    // direction. What no host can express is how far away it was.
    const store = makeState();

    await aroundDestructiveLoad(store.getState, async () => { store.resetCamera(); });

    expect(store.liveViewpoint().position).toEqual({ x: 50, y: 50, z: 50 });
    expect(store.liveViewpoint().target).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
  });

  it('keeps nothing when no model has ever been shown', async () => {
    // The first load must still be framed: a view read off a camera aimed at
    // an empty scene would leave the first model off-frame.
    const store = makeState({ shown: false });

    await aroundDestructiveLoad(store.getState, async () => { store.resetCamera(); });

    expect(store.applied).toEqual([]);
    expect(hasKeptViewpoint()).toBe(false);
  });

  it('survives a renderer that cannot answer', async () => {
    const store = makeState({ callbacks: false });

    await expect(
      aroundDestructiveLoad(store.getState, async () => { store.resetCamera(); }),
    ).resolves.toBeUndefined();
    expect(hasKeptViewpoint()).toBe(false);
  });

  it('drops the view when the load fails, instead of saving it for later', async () => {
    const store = makeState();

    await expect(
      aroundDestructiveLoad(store.getState, async () => { throw new Error('kaputt'); }),
    ).rejects.toThrow('kaputt');
    // Nothing was replaced, so there was nothing to put back.
    expect(store.applied).toEqual([]);

    // And the next load must not resurrect it: a view held over from a load
    // that delivered nothing would pin some later model to an older framing.
    const store2 = makeState({ shown: false });
    await aroundDestructiveLoad(store2.getState, async () => {});
    expect(store2.applied).toEqual([]);
  });

  it('forgets that it restored, once the next load starts', async () => {
    // `hasKeptViewpoint` answers for the model on screen NOW. Left true, it
    // would tell the framing hook to stand down for a model that was never
    // given a kept view.
    const store = makeState();
    await aroundDestructiveLoad(store.getState, async () => { store.resetCamera(); });
    expect(hasKeptViewpoint()).toBe(true);

    const fresh = makeState({ shown: false });
    await aroundDestructiveLoad(fresh.getState, async () => {});
    expect(hasKeptViewpoint()).toBe(false);
  });
});

describe('keepCamera, not armed', () => {
  it('is off unless the host asked - an absent flag frames the model', async () => {
    expect(keepCameraArmed()).toBe(false);
    const store = makeState();

    await aroundDestructiveLoad(store.getState, async () => { store.resetCamera(); });

    expect(store.applied).toEqual([]);
    expect(hasKeptViewpoint()).toBe(false);
    // The reset stands: this is the behaviour every other host still gets.
    expect(store.liveViewpoint().position).toEqual({ x: 1000, y: 1000, z: 1000 });
  });
});
