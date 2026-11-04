# Design: Live job-status indicators + Gallery redesign

Date: 04/11/2026
Status: awaiting approval

## Intent / why

When running several generations back-to-back across different models - especially
video, where each takes minutes - it is hard to tell what is still running, what is
done, and what errored, particularly with concurrent jobs. This surfaces live job
status on the existing top key-badges, and rebuilds the Gallery tab into a live view of
request history plus a dedicated post-gen script console. The console is trimmed at the
same time so the signal is not buried in request/response dumps.

## Goals

1. Each provider's top badge tints to show live job activity for that provider (busy /
   error), layered on top of its existing key-status function (text unchanged).
2. Gallery tab rebuilt: live request-history table showing model name, image/video row
   colour, live status, and the result thumbnail (click to preview larger).
3. A dedicated, independently-scrolling post-gen console in the Gallery that shows only
   post-gen script activity.
4. Console trimmed: drop the verbose POST request / POST response dumps; show a concise
   "request submitted" on success and the full error on failure.

## Non-goals

- Persisting history or jobs across a page reload (session only, by choice).
- Resuming polling of in-flight jobs after a reload.
- Post-gen status on the top badges (post-gen lives in the Gallery console).
- Server-side job-lifecycle tracking (the client registry is the single source).

## Anti-goals (a failure even if it technically works)

- Two parallel status systems. The badges and the Gallery table MUST read one in-memory
  job registry, not two.
- Losing the ability to set a save folder or pick post-gen scripts on the generation
  tabs. Those stay; they are only hidden on the Gallery tab, where they are unused.

## Architecture: one client-side job registry

`JOBS = []` in index.html. Every "Queue request" pushes one job:

```
{ id, provider, badge, model, kind:'image'|'video', tab,
  state:'busy'|'done'|'error',   // "queued" collapses into busy
  statusText, thumbUrl, errAck, t:Date }
```

Helpers (each ends by calling `renderJobsUI()`):
- `jobStart(svc, tabId)` -> create+return (state busy, statusText "queued").
- `jobSet(job, text)` -> live text, stays busy.
- `jobDone(job, text)` / `jobFail(job, text)` -> terminal state (fail sets errAck=false).
- `jobThumb(job, previewUrl)` -> set thumbUrl.

`renderJobsUI()` = `applyBadgeStates()` + (if Gallery is the open tab) re-render the
history tbody. Job counts are per-session and small, so a full tbody re-render each time
is fine. _(ponytail: O(n) re-render, swap for row patching only if it ever lags.)_

Derivations from a service definition:
- `svcProvider(svc)`: fal->fal/b-fal; bria|briav1->bria/b-bria; bfl->bfl/b-bfl;
  kling->kling/b-kling; qwen|qwenImage->qwen/b-qwen; ark|arkImage->ark/b-ark;
  veo|omni|geminiImage->gemini/b-gemini. (`base`/Enhancor -> null; it is off.)
- `svcModel(svc)`: `svc.title` with any trailing " - <endpoint>" trimmed, else
  `svc.model`, else endpoint id.
- `svcKind(svc, group)`: video if the owning group label matches /VIDEO/ (the same test
  `pgShow` uses), else image.

## Badge visual state machine (per provider)

Pure function `badgeTint(jobs, provider, onThisProvider)` (unit-tested):
- `active` = any job of this provider in state busy.
- `errU`   = any job of this provider in state error with errAck false.
- errU && active && !onThisProvider -> `err-alt`  (orange<->red alternating pulse)
- errU && !active && !onThisProvider -> `err-blink` (red pulse)
- active (no unacked error, or error already acked on this tab) -> `busy` (orange pulse)
- otherwise -> null (idle: keep the key-status colour)

Acknowledgement:
- Opening any tab marks that provider's jobs errAck=true (so its red clears).
- If a job fails while the user is already on its own tab, play a finite "red pulse x3"
  then clear (errAck=true immediately). Handled in `jobFail` by checking current tab.

Repaint: the badge text and base key-class stay owned by `refreshConfig` (every 5s).
After setting ok/bad/warn it calls `applyBadgeStates()`, which overlays the tint class
(busy/err-alt/err-blink) without touching the text. `renderJobsUI()` also calls it, so
tint updates immediately on job changes, not only on the 5s tick.

CSS: `@keyframes busyPulse` (orange), `errBlink` (red), `altBlink` (orange<->red),
`errAck3` (red, 3 iterations then JS removes the class). Tuned to the existing
`armPulse` feel.

## Gallery redesign (`renderGallery`)

Hide the global strip on Gallery: give the two top `.row.full` blocks ids
(`#row-savefolder`, `#row-postgen`) and toggle them off when `id==='gallery'`, on
otherwise. `pgShow` keeps doing the video/image sub-row logic for the generation tabs.

New pane:
```
Post-gen console          (category)
  #pg-console             scrolling box, its own buffer
Request history           (category)
  table: Time (AEST) | Model | Status | Output
```
- Remove the old "Results" (webhook cards) frame entirely - it is dead with Enhancor off.
- Rows come from JOBS, newest first.
  - Time: job.t as HH:MM:SS.
  - Model: job.model.
  - Status: job.statusText in a pill coloured by state (busy orange / done green / error red).
  - Output: thumbnail (`<img>`/`<video>`) of job.thumbUrl; click opens a lightbox at full
    size; "-" placeholder until ready.
  - Row background: faint orange for image, faint blue for video.
- Lightbox: one fixed overlay, click to dismiss, no library.
- Live while open: `renderJobsUI()` re-renders the tbody; post-gen events append to
  `#pg-console` as they arrive.

## Post-gen console buffer + routing

Server: tag the post-gen `log()` calls with meta `{"postgen": true}` - in `run_script`
(the `<-`, `[stem] line`, `exited`, `done` lines) and `postprocess` (the skip/stop
warnings). `log()` already forwards meta to the SSE event.

Client: the `/events` handler routes `ev.meta.postgen` events into `PGLOG` (capped ~500)
and into `#pg-console` if Gallery is open - and NOT into the main console, so each
console shows only its own kind of activity. Post-gen `out` lines (script stdout) are
shown in the post-gen console regardless of the main console's Bodies toggle - seeing
them is the point of the dedicated view.

## Console trim (POST request / response)

Server `call_api`:
- Delete the `log("req", ...)` dump.
- On 2xx: log nothing (kills the per-poll noise too).
- On >=400: `log("err", ...)` with the full error body (raise the 4000-char cap so the
  whole error shows). Keep the transport-error and key-missing error logs.

Client:
- `send.onclick`: on `r.ok` -> `local("sys", "request submitted")`; on `!r.ok` -> keep
  the per-tab bad status (the server already logged the full error).
- `pushLine`: always show the body for `kind==='err'` (not gated by the Bodies toggle),
  so a full error is visible without flipping Bodies.

## Files touched (2)

- `index.html` - CSS (badge animations, pg-console, history tint/thumbnail/lightbox) and
  JS (JOBS + helpers, badge state machine + applyBadgeStates, SSE routing + PGLOG,
  renderGallery rewrite, strip-hide on gallery, send.onclick job hooks + submit line,
  showResult thumb hook, every tracker -> job updates, pushLine error-body-always).
- `server.py` - call_api logging change; postgen meta tags.

No new files, no new dependencies.

## Verification

- `node` syntax eval of index.html inline JS (existing test_*.js pattern reads the file
  off disk); run the existing nine JS suites - must still pass.
- `python -c "import ast; ast.parse(open('server.py',encoding='utf-8').read())"` plus the
  server test suite.
- One assert-based self-check for the pure `badgeTint` state machine and `svcProvider`
  mapping (the only non-trivial logic). No framework.
- Run the app: fire an image job and a video job (and a second on the same provider),
  confirm badge busy/error tints and the ack behaviour, the Gallery table (model, row
  colour, live status, thumbnail, lightbox), the post-gen console if a script is
  configured, and the quieter main console.

## Phased build (each phase ends green)

1. Job registry + helpers + `svcProvider`/`svcModel`/`svcKind` + the `badgeTint` pure
   function and its self-check. Wire `send.onclick` and every tracker to create/update
   jobs. No UI yet.
2. Badge state machine: CSS animations + `applyBadgeStates`, hook into refreshConfig and
   renderJobsUI, tab-open acknowledgement, same-tab x3 pulse.
3. Gallery rewrite: hide strip on gallery, history table from JOBS, thumbnails, lightbox,
   row tints. Remove the Results frame.
4. Post-gen console: server postgen meta tags, client SSE routing + PGLOG, #pg-console
   render + live append.
5. Console trim: server call_api logging, client submit line, pushLine error-body.
6. Full verification pass.

## Left to the builder

- Pulse timings/opacity (match armPulse), thumbnail size, lightbox styling, row-tint alpha.
