# Gemini video generators: Veo 3.1 + Omni Flash 1.1

Date: 09/10/2026
Author: dedkamaroz (+ Claude)

## Goal

Add Google's **Veo 3.1** (generate / fast / lite) and **Gemini Omni Flash 1.1**
(`gemini-omni-1.1-flash`) as video generators, grouped under one new **Google**
publisher page in the VIDEO GENERATORS menu, exposing every parameter the Gemini
API documents for each. Uses the existing `GEMINI_API_KEY` in `.env`.

## Confirmed model IDs (Gemini API, verified against live Google docs 09/10/2026)

- `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview`
- `gemini-omni-1.1-flash` (GA, 27/08/2026; the `-preview` id was deprecated 30/09/2026)

## The one new thing: auth-gated outputs

Every existing provider returns a public CDN URL the browser renders and `/api/blob`
/ `/api/save` fetch with no auth. **Gemini outputs require `x-goog-api-key` on the
download**, and the download URLs carry no file extension. That drives the whole design.

## Two API shapes (both on `generativelanguage.googleapis.com/v1beta`)

### Veo - async operation
1. `POST /models/{id}:predictLongRunning` with `{instances:[{prompt,image,lastFrame,referenceImages,video}], parameters:{aspectRatio,resolution,durationSeconds,personGeneration,numberOfVideos,negativePrompt,seed}}`
2. Poll `GET /{operation.name}` until `done:true`
3. Download `response.generateVideoResponse.generatedSamples[0].video.uri` (auth-gated)

### Omni - synchronous Interactions API
1. `POST /interactions` with `{model, input:[{text},{image}], previous_interaction_id?, response_format:{type:"video",aspect_ratio,resolution,delivery:"uri"}, generation_config:{video_config:{task}}, background:false, store, stream:false}`
2. Response carries a Files-API uri; poll `GET /files/{id}` until `state:ACTIVE`
3. Download `/files/{id}:download?alt=media` (auth-gated)

## Verified against the live API (09/10/2026, cheapest configs)

- **Veo 3.1 Lite** 4s@720p text-to-video: submit -> poll operation -> `done` ->
  `response.generateVideoResponse.generatedSamples[0].video.uri` -> key-gated download of a
  1.73 MB MP4. **PASS.** Fix found in testing: `durationSeconds` must be a **number**, not the
  string the docs implied (API 400s on a string).
- **Omni Flash 1.1** 360p text-to-video: `/interactions` (sync) -> response carries
  `files/<id>` -> poll `GET /files/<id>` to `ACTIVE` -> `:download?alt=media` of a 730 KB MP4.
  **PASS.** Fixes found in testing: `input` is a **plain string** for text-to-video (an array
  of `{type:"image"|"text",...}` steps only when images are present) - not the `[{text}]` the
  first doc pass suggested. `delivery:"uri"` returns a real Files-API uri (no base64 fallback
  needed in practice; the fallback stays as a safety net).

## Changes

### server.py (backend auth only - everything else is provider-agnostic)
- `GEMINI_HOST = "generativelanguage.googleapis.com"`, `is_gemini()`, `gemini_key()`
- `key_var()` -> `GEMINI_API_KEY`; `auth_for()` -> `{"x-goog-api-key": key}`
- `_blob()` and `_save()`: attach `x-goog-api-key` when the fetched URL is a Gemini host
  (currently they fetch with no auth). This is the only change with no existing analog.
- `/api/config`: expose `hasGeminiKey` + hint (badge parity).

### index.html (new transport + two services behind one page)
- `const GEMINI = "https://generativelanguage.googleapis.com/v1beta"`
- Transport dispatch in `send.onclick`: `svc.veo` -> predictLongRunning; `svc.omni` -> interactions.
- `await svc.prep?.(body)` hook (1 line, backward-compatible) so Veo/Omni can base64-encode
  uploaded image/video inputs into `inlineData` before send (Gemini takes no http image URL).
- `trackVeo` (operation poll) + `trackOmni` (files poll), mirroring `trackQwen`.
- `showResult(el,url,id,abbr,opts={})`: `opts.video` forces video kind (postgen + naming),
  `opts.previewUrl` points the `<video>` at `/api/blob?url=...` so the auth-gated bytes render.
- 4 `SERVICES` entries (3 Veo variants + Omni) with full field schemas; per-variant limits
  (lite: no 4k / no reference / no extend; 1080p+4k force 8s).
- `pubGoogle` publisher + one new row in the VIDEO GENERATORS group.

## Testing (budget ~$1 USD, approved)
- Veo 3.1 **Lite** 4s @ 720p text-to-video (~$0.20)
- One short Omni 360p clip
- Confirm: generate -> poll -> download (auth) -> save. Report actual spend.

## Deliberately skipped (add when asked)
- Omni multi-turn conversational editing UI (single-turn + manual `previous_interaction_id` field instead).
- Vertex AI model IDs (Gemini API only).
