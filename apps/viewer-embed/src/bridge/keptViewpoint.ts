/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Carrying the view across a destructive load, for a host that reloads the
 * same object (`?keepCamera=1`).
 *
 * # The host this exists for
 * An editor whose preview IS the file it is building: change a number, and a
 * whole new model is posted over. The default behaviour — reset the session,
 * frame what arrives — is right for a viewer handed an unfamiliar model and
 * wrong here, because the model is the one already on screen with one
 * dimension moved by a centimetre. Every keystroke threw away the view the
 * author was working in, which made nudging by numbers unusable at exactly
 * the zoom level where nudging by numbers is the point.
 *
 * # Why the viewer does this and not the host
 * A host CAN'T. `CAMERA_CHANGED` reports orientation only, and its own
 * documentation says so: it does not fire for a pan or a zoom, and its `zoom`
 * field is reserved and never populated. So target and distance are not
 * observable from outside, and `SET_CAMERA` cannot set them either — a pose
 * on the wire would have to name a distance in some unit, which is the
 * question `camera.zoom` was left unanswered rather than guessed at (#2934).
 *
 * Here the numbers never cross the boundary. The viewer reads its own camera
 * before the load and puts it back afterwards; the host says only whether it
 * wants that. Nothing new has to be given a meaning in the protocol.
 *
 * # Why a snapshot and not "skip the reset"
 * The session reset does far more than the camera, it is shared with the full
 * viewer, and it runs deep inside `loadFile`. Making it conditional would put
 * this host's convenience in everyone's teardown path. A snapshot taken
 * outside the reset also survives the case where the renderer itself is
 * rebuilt: the pose is plain numbers held here, not a reference to a camera
 * that may not exist afterwards.
 *
 * # The first load is framed anyway
 * There is no view worth keeping before a model has ever been shown. Reading
 * a viewpoint off a camera aimed at an empty scene and restoring it would
 * leave the first model off-frame — the very thing `useEmbedPostLoad` exists
 * to prevent. So a snapshot is only taken when there is something on screen,
 * and `hasKeptViewpoint()` tells the framing hook to stand down only when one
 * was actually taken and restored.
 */

import type { CameraViewpoint } from '@/store/types.js';

/** What this module needs from the store. */
export interface KeptViewpointState {
  cameraCallbacks: {
    getViewpoint?: () => CameraViewpoint | null;
    applyViewpoint?: (viewpoint: CameraViewpoint, animate?: boolean, durationMs?: number) => void;
  };
  /**
   * The geometry on screen. Read at a load's ENTRY, where it still describes
   * the OUTGOING model, so `null` means nothing has ever been shown and there
   * is no view to keep.
   */
  geometryResult: unknown;
  /**
   * Tell the geometry pipeline that this model's camera is already placed.
   *
   * Restoring the pose is not enough on its own: the auto-fit in
   * `useGeometryStreaming` runs when bounds arrive and again when streaming
   * finishes, both LONG after the load call returned, and it would frame the
   * model over the top of the restored view. Measured that way first — the
   * view went back correctly and was overwritten about a second later.
   */
  setCameraPlacedForModel?: (placed: boolean) => void;
}

/** Whether the host asked for the view to be kept (`?keepCamera=1`). */
let armed = false;

/** The pose lifted out before the reset, waiting for the model to land. */
let kept: CameraViewpoint | null = null;

/** Whether the model now on screen had a kept view put back onto it. */
let restoredOntoCurrentModel = false;

/**
 * Arm or disarm. Called once from the embed component with the URL params.
 *
 * Module state with no reset on unmount, deliberately, for the same reason
 * `cameraIntent.ts` gives: StrictMode's dev-only mount → cleanup → remount
 * would otherwise disarm the flag while an auto-load's fetch is still in
 * flight.
 */
export function setKeepCamera(on: boolean): void {
  armed = on;
}

export function keepCameraArmed(): boolean {
  return armed;
}

/**
 * Did the model currently on screen get a kept view put back?
 *
 * Read by the framing hook, which must not fit over a view that was just
 * restored. A read, not a take: that effect can run more than once per load.
 */
export function hasKeptViewpoint(): boolean {
  return restoredOntoCurrentModel;
}

/**
 * Lift the current view out, before the load resets the session.
 *
 * Nothing is kept when the flag is off, when no model has ever been shown, or
 * when the renderer cannot answer — in every one of those the incoming model
 * should be framed as it always was.
 */
export function captureViewpoint(getState: () => KeptViewpointState): void {
  restoredOntoCurrentModel = false;
  kept = null;
  if (!armed) return;
  const state = getState();
  // `geometryResult != null`, not `meshes.length > 0` — the same distinction
  // `cameraIntent.ts` had to make: a spatial-only IFC loads to a non-null
  // result holding zero meshes, and that model WAS shown.
  if (state.geometryResult == null) return;
  kept = state.cameraCallbacks.getViewpoint?.() ?? null;
}

/**
 * Put the kept view back, once the load is past the reset.
 *
 * Without animation: this is not a camera move the user asked for, it is the
 * absence of one. A tween here would be a visible lurch on every keystroke,
 * which is the complaint this module answers.
 */
export function restoreViewpoint(getState: () => KeptViewpointState): boolean {
  const pose = kept;
  kept = null;
  if (!pose) return false;
  const state = getState();
  const apply = state.cameraCallbacks.applyViewpoint;
  if (!apply) return false;
  apply(pose, false);
  // Announced BEFORE the geometry finishes streaming, which is when the fits
  // happen. The session reset has already cleared the flag, so setting it here
  // can only ever speak about the model that just arrived.
  state.setCameraPlacedForModel?.(true);
  restoredOntoCurrentModel = true;
  return true;
}

/**
 * Forget the lifted view without applying it.
 *
 * For a load that FAILED: it replaced nothing and reset nothing, so the view
 * it was protecting is still on screen and putting it back would be a move
 * onto itself. Left held, it would instead surface at some later load and
 * pin a model the host never asked about to an older model's framing.
 */
export function dropKeptViewpoint(): void {
  kept = null;
}

/** Drop what is held. For tests; no production caller resets this module. */
export function resetKeptViewpoint(): void {
  armed = false;
  kept = null;
  restoredOntoCurrentModel = false;
}
