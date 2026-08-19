# Screenflows

Self-playing clips for a presentation. A clip drives the viewer itself, burns a
German caption into the picture, and writes SRT subtitle files with the timings
the take actually had. You start a screen recorder and press play; nothing has
to be clicked by hand, and a re-record after a UI change costs one more take
instead of one more afternoon.

This is the sibling of the interactive tours in `../tours/`, and shares their
anchor registry and anchor resolution. The difference is who acts: a tour waits
for the user, a clip performs and then waits for the app to prove it landed.

## Recording a clip

1. Put the demo models in `apps/viewer/public/demo-local/` (see below).
2. Size the browser window to the recording format. The captions are sized for
   1920x1080; a much smaller window makes them proportionally huge.
3. Start the screen recorder.
4. Go to `http://localhost:5173/?screenflow=clip-01-federation`.
   The clip waits `?delay=` milliseconds (default 1500) before its first beat,
   so there is time to get the mouse out of frame.
5. When the end card appears, stop the recorder, then press
   **Untertitel speichern** for the `.de.srt` and `.en.srt` sidecars.

`Escape` aborts a take at any point.

If the end card reports faults, throw the take away. A fault means a beat ran
into its deadline waiting for proof that its action landed -- the recording will
show a caption sitting over an app that did not do the thing.

## Presenting instead of recording

Append `&present` and the same clip becomes a live demo:

```
http://localhost:5173/?screenflow=strand-01-from-a-drawing&present
```

A small control bar appears bottom left — deliberately small, because the
audience is looking at this screen too:

| | |
|---|---|
| **Space** or the pause button | hold on the current beat while you talk |
| **Right arrow** or `▸▸` | end the current wait now, including a slow model load |
| the chapter name | a menu of the clip's sections; picking one jumps there |
| an amber dot | a beat did not land — for you, not for the room |

Two things worth knowing:

- **A chapter jump is a replay, not a seek.** Beats build on each other, so
  jumping to "detect the rooms" replays the tracing at speed first and only
  then hands over. The model really reaches that state, every proof included.
  It lands paused, so you can start talking.
- **Recording is unaffected.** The controls, the keys and the bar exist only
  while presenting; a take has no control surface and keeps its exact pacing,
  which is what the measured subtitles were built from.

`Escape` ends either mode.

## The private data

The repository is public. The models a clip is worth recording against are not,
and neither is the name of the building. So:

- `apps/viewer/public/demo-local/` is git-ignored and holds
  `demo-architecture.ifc` and `demo-fire-detection.ifc` -- generic names on
  purpose, because the viewer's model list is in frame.
- The committed captions speak generically ("das Architekturmodell"). To put
  real names on screen, add `apps/viewer/public/demo-local/captions.json`:

  ```json
  {
    "clip-01-federation": {
      "title": { "de": "Ihr Gebaeude, Ort", "en": "Your building, place" }
    }
  }
  ```

  Overrides may only change words. Beats, actions and order stay single-sourced
  in the clip, which is the part that would break a recording if it went stale.

## Writing a clip

A clip is a list of beats in `clips/`, registered in `registry.ts`. One beat is
one caption, one action, and one proof:

```ts
{
  id: 'isolate-storey',
  anchor: 'hierarchy-panel',
  captionDe: 'Ein Klick auf das Erdgeschoss.',
  captionEn: 'One click on the ground floor.',
  perform: (store) => store.getState().setActiveStorey(ref),
  settled: (s) => s.activeStorey !== null,
}
```

Rules that are enforced by `registry.test.ts`:

- Both languages on every beat. The English one is a subtitle cue over the same
  timeline, so a missing translation is a hole in the file, not a fallback.
- No caption longer than one beat can show (`isCaptionOverlong`). Split it.
- A beat that performs something observable declares `settled`. Without it the
  clip moves on hopefully, and hope does not survive a slow machine.
- `anchor` values come from `../tours/anchors.ts`. Moving a `data-tour`
  attribute means updating the clips too, same rule as for tours.

Look up model contents by NAME (`model-lookup.ts`), never by express id: the
demo files are regenerated whenever the underlying data is corrected, and a
clip pinned to ids keeps playing while pointing at the wrong element.

## The series

`PLANNED_CLIPS` in `registry.ts` lists all nine and what each still needs
before it can be filmed.
