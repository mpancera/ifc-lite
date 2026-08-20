/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What the recorder sees while a clip plays.
 *
 * # Nothing on this layer is a control
 * A tour card has a Next button, a Skip and a close X, because a person is
 * driving. A clip has none of them: every pixel here ends up in a slide, and
 * a button in the frame invites the audience to wonder who is pressing it.
 * The only interactive affordance is Escape, handled off-screen, and the end
 * card -- which the operator sees after they have stopped recording.
 *
 * # The pointer is drawn, not dispatched
 * The ring that travels to an anchor and pulses is a picture of a click. The
 * click itself happens in the beat's `perform`, against the store. Dispatching
 * a synthetic DOM click instead would make the clip a UI test that happens to
 * be filmed: it would break on a re-styled button and, worse, it would pass
 * while pointing at the wrong element.
 *
 * # Layering
 * Portalled to `document.body` at z-40, above floating panels and below
 * dialogs, matching TourHost. The layer never takes pointer events.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getViewerStoreApi } from '@/store';
import { advanceBeat, getLastRun, jumpToChapter, POINTER_TRAVEL_MS, stopClip, togglePause } from '@/lib/screenflow/player';
import { chapterAt, chaptersOf } from '@/lib/screenflow/chapters';
import { projectIfcPoint, storeyFloorY } from '@/lib/screenflow/worldPointer';
import { getClip } from '@/lib/screenflow/registry';
import { useScreenflowStore, type ScreenflowUiState } from '@/lib/screenflow/screenflow-store';
import { downloadSubtitles } from '@/lib/screenflow/subtitles';
import { useScreenflowLauncher } from '@/lib/screenflow/useScreenflowLauncher';
import { DemoFlowsLauncher } from './DemoFlowsLauncher';

interface TargetBox { x: number; y: number; left: number; top: number; width: number; height: number }

/** Follows the anchor's box, so a panel that resizes does not strand it. */
function useTargetBox(target: HTMLElement | null): TargetBox | null {
  const [box, setBox] = useState<TargetBox | null>(null);
  useEffect(() => {
    if (!target) { setBox(null); return; }
    const measure = () => {
      const r = target.getBoundingClientRect();
      setBox({
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        x: r.left + r.width / 2,
        // Tall panels: aim at the upper region, where the content the beat is
        // talking about actually sits, not at the middle of an empty column.
        y: r.top + Math.min(r.height / 2, 96),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [target]);
  return box;
}

/**
 * A ring around the element the beat is about.
 *
 * The cursor alone was not enough: in a clip embedded on a slide, a 26 px mark
 * on a busy interface is lost, and the viewer sees a caption without seeing
 * what it refers to. Outlining the target answers "where do I look" at a
 * glance, and it keeps working when the video is scaled down.
 */
function TargetHighlight({ box, clicking }: { box: TargetBox | null; clicking: boolean }) {
  if (!box) return null;
  return (
    <div
      className="pointer-events-none fixed rounded-lg"
      style={{
        left: box.left - 4,
        top: box.top - 4,
        width: box.width + 8,
        height: box.height + 8,
        border: '3px solid rgba(56, 189, 248, 0.95)',
        boxShadow: clicking
          ? '0 0 0 6px rgba(56, 189, 248, 0.30), 0 0 26px 6px rgba(56, 189, 248, 0.45)'
          : '0 0 0 3px rgba(56, 189, 248, 0.18), 0 0 18px 2px rgba(56, 189, 248, 0.25)',
        transition: 'left 400ms ease-out, top 400ms ease-out, width 400ms ease-out, height 400ms ease-out, box-shadow 240ms ease-out',
      }}
    />
  );
}

/**
 * The drawn cursor.
 *
 * An arrow, not a ring: a ring reads as a highlight, an arrow reads as
 * somebody using the software, which is the whole point of a screenflow. It
 * carries its own dark outline and a drop shadow so it stays legible over the
 * white panels and over the dark 3D viewport alike -- the first version was
 * white-on-white and effectively invisible, reported from the first take.
 */
function Pointer({ box, clicking }: { box: TargetBox | null; clicking: boolean }) {
  if (!box) return null;
  return (
    <div
      className="pointer-events-none fixed z-10"
      style={{
        left: box.x,
        top: box.y,
        transition: `left ${POINTER_TRAVEL_MS}ms cubic-bezier(0.33, 1, 0.68, 1), top ${POINTER_TRAVEL_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`,
      }}
    >
      {/* Click ripple, behind the arrow and centred on its tip. */}
      <div
        className="absolute rounded-full"
        style={{
          left: 0,
          top: 0,
          width: clicking ? 68 : 0,
          height: clicking ? 68 : 0,
          marginLeft: clicking ? -34 : 0,
          marginTop: clicking ? -34 : 0,
          border: '3px solid rgba(56, 189, 248, 0.9)',
          background: 'rgba(56, 189, 248, 0.18)',
          opacity: clicking ? 1 : 0,
          transition: 'width 300ms ease-out, height 300ms ease-out, margin 300ms ease-out, opacity 300ms ease-out',
        }}
      />
      <svg
        width="34"
        height="34"
        viewBox="0 0 24 24"
        className="absolute"
        style={{
          left: -3,
          top: -2,
          filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.55))',
          transform: clicking ? 'scale(0.86)' : 'scale(1)',
          transformOrigin: '10% 10%',
          transition: 'transform 160ms ease-out',
        }}
      >
        <path
          d="M5 3 L5 20 L9.6 15.6 L12.4 21.6 L15.3 20.2 L12.6 14.4 L19 14.2 Z"
          fill="#111827"
          stroke="#ffffff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/**
 * A building coordinate, followed every frame.
 *
 * Not measured once like a DOM box: the camera is often still moving when the
 * beat acts (a fit, an orbit), and a pointer pinned to where the point *was*
 * drifts visibly off the wall it is supposed to indicate. An animation frame
 * is cheap next to the render already happening.
 */
function useProjectedPoint(world: ScreenflowUiState['pointerWorld']): { x: number; y: number } | null {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!world) { setPoint(null); return; }
    let frame = 0;
    const tick = () => {
      const state = getViewerStoreApi().getState();
      const floorY = storeyFloorY(state, world.modelId, world.storeyId);
      setPoint(projectIfcPoint(state, world.point, floorY));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [world]);
  return point;
}

/** A small ring at a place in the building — the 3D counterpart of the box. */
function WorldMark({ point, clicking }: { point: { x: number; y: number }; clicking: boolean }) {
  return (
    <div
      className="pointer-events-none fixed rounded-full"
      style={{
        left: point.x,
        top: point.y,
        width: clicking ? 74 : 34,
        height: clicking ? 74 : 34,
        marginLeft: clicking ? -37 : -17,
        marginTop: clicking ? -37 : -17,
        border: '3px solid rgba(56, 189, 248, 0.95)',
        background: 'rgba(56, 189, 248, 0.16)',
        boxShadow: '0 0 18px 2px rgba(56, 189, 248, 0.35)',
        transition: 'width 260ms ease-out, height 260ms ease-out, margin 260ms ease-out',
      }}
    />
  );
}

/**
 * Ring and cursor share one measurement of the target, so they can never
 * disagree about where it is -- two independent observers of the same moving
 * box is how a highlight ends up next to the thing it highlights.
 *
 * A beat points either at an element or at a place in the building, never
 * both: two marks on screen would ask the viewer which one to follow.
 */
function StageFocus({
  target,
  world,
  clicking,
}: {
  target: HTMLElement | null;
  world: ScreenflowUiState['pointerWorld'];
  clicking: boolean;
}) {
  const box = useTargetBox(target);
  const projected = useProjectedPoint(world);

  if (box) {
    return (
      <>
        <TargetHighlight box={box} clicking={clicking} />
        <Pointer box={box} clicking={clicking} />
      </>
    );
  }
  if (projected) {
    const asBox: TargetBox = {
      left: projected.x, top: projected.y, width: 0, height: 0,
      x: projected.x, y: projected.y,
    };
    return (
      <>
        <WorldMark point={projected} clicking={clicking} />
        <Pointer box={asBox} clicking={clicking} />
      </>
    );
  }
  return null;
}

function CaptionBar({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center pb-[6vh]">
      <p
        key={text}
        className="max-w-[64ch] rounded-md bg-black/75 px-6 py-3 text-center text-[26px] font-medium leading-snug text-white shadow-lg backdrop-blur-sm"
        style={{ animation: 'screenflow-caption-in 320ms ease-out' }}
      >
        {text}
      </p>
    </div>
  );
}

function TitleCard({ text }: { text: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 flex items-center justify-center bg-black/85">
      <p className="max-w-[26ch] text-center text-[44px] font-semibold leading-tight text-white">{text}</p>
    </div>
  );
}

/**
 * The presenter's controls.
 *
 * Deliberately small and low-contrast: in a live demo the audience is looking
 * at this same screen, so the bar has to be readable to the person driving and
 * ignorable to everyone else. It exists ONLY while presenting — a recording
 * must not contain a control surface.
 *
 * A fault shows as a dot rather than the red end card: the presenter needs to
 * know a beat did not land, the room does not need to be told.
 */
function PresenterBar() {
  const clipId = useScreenflowStore((s) => s.clipId);
  const beatIndex = useScreenflowStore((s) => s.beatIndex);
  const beatCount = useScreenflowStore((s) => s.beatCount);
  const paused = useScreenflowStore((s) => s.paused);
  const seeking = useScreenflowStore((s) => s.seeking);
  const faults = useScreenflowStore((s) => s.faults);
  const [chaptersOpen, setChaptersOpen] = useState(false);

  const clip = clipId ? getClip(clipId) : undefined;
  if (!clip) return null;
  const chapters = chaptersOf(clip);
  const current = chapterAt(chapters, beatIndex);

  return (
    <div className="pointer-events-auto fixed bottom-3 left-3 flex items-center gap-2 rounded-md border border-white/15 bg-black/55 px-2 py-1.5 text-[12px] text-white/85 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        className="rounded px-2 py-0.5 hover:bg-white/15"
        onClick={togglePause}
        title="Leertaste"
      >
        {paused ? '▶' : '❚❚'}
      </button>
      <button
        type="button"
        className="rounded px-2 py-0.5 hover:bg-white/15"
        onClick={advanceBeat}
        title="Pfeil rechts"
      >
        ▸▸
      </button>
      <span className="tabular-nums text-white/60">
        {beatIndex + 1}/{beatCount}
      </span>
      <div className="relative">
        <button
          type="button"
          className="max-w-[22ch] truncate rounded px-2 py-0.5 hover:bg-white/15"
          onClick={() => setChaptersOpen((open) => !open)}
        >
          {seeking ? 'springt …' : current?.titleDe ?? clip.titleDe}
        </button>
        {chaptersOpen && (
          <div className="absolute bottom-full left-0 mb-1 w-72 overflow-hidden rounded-md border border-white/15 bg-black/85 py-1">
            {chapters.map((chapter) => (
              <button
                key={chapter.beatIndex}
                type="button"
                className="block w-full truncate px-3 py-1.5 text-left hover:bg-white/15"
                onClick={() => { setChaptersOpen(false); jumpToChapter(chapter.beatIndex); }}
              >
                {chapter.titleDe}
              </button>
            ))}
          </div>
        )}
      </div>
      {faults.length > 0 && (
        <span
          className="h-2 w-2 rounded-full bg-amber-400"
          title={`Takte ohne Nachweis: ${faults.join(', ')}`}
        />
      )}
    </div>
  );
}

/** Shown after the clip; the operator has stopped recording by now. */
function EndCard() {
  const faults = useScreenflowStore((s) => s.faults);
  const missing = useScreenflowStore((s) => s.missingFiles);
  const clipId = useScreenflowStore((s) => s.clipId);
  const clip = clipId ? getClip(clipId) : undefined;
  const lastRun = getLastRun();

  return (
    <div className="pointer-events-auto fixed left-1/2 top-1/2 w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg">
      <div className="text-sm font-semibold">
        {clip ? `Clip ${clip.number}: ${clip.titleDe}` : 'Screenflow'}
      </div>

      {missing.length > 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Nicht abgespielt – diese Dateien fehlen in <code>apps/viewer/public/demo-local/</code>:{' '}
          {missing.join(', ')}.
        </p>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {faults.length === 0
            ? 'Durchgelaufen. Die Untertitel tragen die gemessenen Zeiten dieser Aufnahme.'
            : `Mit Fehlern durchgelaufen: ${faults.join(', ')}. Diese Takte haben auf ihren Nachweis gewartet und sind in die Zeitgrenze gelaufen – diese Aufnahme nicht verwenden.`}
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {lastRun && lastRun.timeline.length > 0 && (
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-accent"
            onClick={() => downloadSubtitles(lastRun.clip, lastRun.timeline)}
          >
            Untertitel speichern (DE + EN)
          </button>
        )}
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground hover:opacity-90"
          onClick={stopClip}
        >
          Schliessen
        </button>
      </div>
    </div>
  );
}

export function ScreenflowStage() {
  useScreenflowLauncher();
  const status = useScreenflowStore((s) => s.status);
  const mode = useScreenflowStore((s) => s.mode);
  const caption = useScreenflowStore((s) => s.caption);
  const frame = useScreenflowStore((s) => s.frame);
  const pointerTarget = useScreenflowStore((s) => s.pointerTarget);
  const pointerWorld = useScreenflowStore((s) => s.pointerWorld);
  const clicking = useScreenflowStore((s) => s.clicking);

  // Escape aborts a take. The viewer's own Escape handler clears selection,
  // which would be a visible edit mid-clip, so this listener runs in the
  // capture phase and stops the event there. Space and the right arrow are
  // presenting only, and for the same reason: the app owns both keys, and a
  // recording must not be steerable by a stray press.
  useEffect(() => {
    if (status !== 'playing' && status !== 'arming') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stopClip();
        return;
      }
      if (mode !== 'present') return;
      // Not while typing: a presenter who stopped to rename a room must be
      // able to press space without the clip moving on.
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        e.stopPropagation();
        togglePause();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        advanceBeat();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [status, mode]);

  // The launcher is a sibling rather than an alternative: it belongs to the
  // same feature, this component is already mounted for the whole session, and
  // each of the two gates itself on `status`. An early return here would gate
  // it a second time, from outside, and leave the check inside it unreachable.
  const overlay = status === 'idle' ? null : createPortal(
    <div className="pointer-events-none fixed inset-0 z-40">
      <style>{`@keyframes screenflow-caption-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}</style>
      {status === 'done' ? (
        <EndCard />
      ) : (
        <>
          {frame === 'card' ? <TitleCard text={caption} /> : <CaptionBar text={caption} />}
          {frame !== 'card' && <StageFocus target={pointerTarget} world={pointerWorld} clicking={clicking} />}
          {mode === 'present' && <PresenterBar />}
        </>
      )}
    </div>,
    document.body,
  );

  return <><DemoFlowsLauncher />{overlay}</>;
}
