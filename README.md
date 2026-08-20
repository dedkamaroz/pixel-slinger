# Pixel Slinger

Local web interface for image and video generation across four providers - **Enhancor**
(`apireq.enhancor.ai`), **fal.ai** (`queue.fal.run`), **BytePlus ModelArk**
(`ark.ap-southeast.bytepluses.com`) and **Kling AI**
(`api-singapore.klingai.com`) - behind one console. Drag-and-drop file input, every
request and response streamed to an on-page terminal, results saved to disk the moment they
land.

**Enhancor is switched off (20/08/2026).** `ENHANCOR_ON = false` at the top of the script in
`index.html` drops every tab that posts to `apireq.enhancor.ai` out of the nav - which empties
the Portrait Enhancors group, so that switch disappears with them. Nothing was deleted: the
service definitions, field gating and polling are all still there, and setting the flag back to
`true` restores the whole set. fal.ai is untouched.

Forked from `D:\Tools\enhancor` on 16/08/2026, when fal models were added alongside the
Enhancor ones and the tool stopped being about a single vendor.

Each provider keeps its own key and its own transport; the proxy picks between them by
hostname, so a fal body can never go out signed with the Enhancor key or the reverse.

| Provider | Host | Auth | Flow |
|---|---|---|---|
| Enhancor (off) | `apireq.enhancor.ai` | `x-api-key: ENHANCOR_API_KEY` | POST `/queue`, webhook + POST `/status` polling |
| fal.ai | `queue.fal.run` | `Authorization: Key FAL_KEY` | POST endpoint id, GET `status_url` then GET `response_url` |
| BytePlus | `ark.ap-southeast.bytepluses.com` | `Authorization: Bearer BYTEPLUS_API_KEY` | video: POST `/contents/generations/tasks`, GET `.../{id}`; image: POST `/images/generations`, synchronous |
| Kling AI | `api-singapore.klingai.com` | `Authorization: Bearer KLINGAI_API_KEY` | POST `/<capability>/<model>` (2.1 Master: POST `/v1/videos/image2video`), GET `/tasks?task_ids=` |

Two of the four sign with `Bearer`, so the hostname is the only thing keeping the BytePlus key and
the Kling key apart. `is_ark` / `is_kling` compare the parsed hostname exactly - a lookalike host
matches neither.

## Start / stop

**Start:** double-click `start.bat`. A console window opens, the tunnel comes up after a few
seconds, and the browser opens on http://127.0.0.1:8787. Python 3.10+, no pip install.

**Stop:** press `Ctrl+C` in that console window - the tunnel is torn down on the way out and it
prints `tunnel closed`. If you closed the window, lost it, or the server is running detached,
double-click `stop.bat` instead.

`stop.bat` reads `.server.pid` (written at startup) and kills exactly those two processes - the
server and its own cloudflared - so it can never touch an unrelated tunnel of yours.

Closing the console window with the X does **not** stop the tunnel: Windows leaves the child
process running and it keeps serving `uploads/` to the internet. Use Ctrl+C or `stop.bat`.
To check nothing is left over:

```powershell
Get-Process cloudflared -EA SilentlyContinue     # should return nothing
```

## Setup

1. Put your keys in `.env`:
   ```
   ENHANCOR_API_KEY=your_key_here
   FAL_KEY=your_fal_key_here
   BYTEPLUS_API_KEY=your_byteplus_key_here
   KLINGAI_API_KEY=api-key-kling-...
   ```
   Keys stay server-side. The browser never sees them and they are redacted in the console log.
   The header carries a badge per provider; any of them can be missing and the tabs belonging
   to the others still work. A call to a provider whose key is absent is refused before
   it leaves the machine rather than being sent with the wrong credential.

2. Install cloudflared so the providers' servers can fetch your dropped files:
   ```
   scoop install cloudflared          # no admin needed - this is what's installed here
   choco install cloudflared          # alternative, needs an elevated shell
   winget install --id Cloudflare.cloudflared
   ```
   The server starts a free quick tunnel on launch (no Cloudflare account, no login). The
   TUNNEL badge in the header goes green and the log prints the public hostname. Without it,
   uploads work locally but neither provider can reach the image URL, and every job fails on
   their side - Enhancor with `Reference image 1 fetch failed`, fal with a download error.

   The hostname is random and **changes every restart** - that is fine, the proxy rewrites
   `img_url` and `webhook_url` per request.

## What is exposed, and for how long

cloudflared is a reverse proxy, not storage. Files only ever live in `uploads/` on this machine.

- **While the server runs:** anything in `uploads/` is fetchable by anyone holding the URL, with
  no auth. Quick-tunnel hostnames are unguessable but not secret.
- **After you stop it:** the tunnel dies and the URLs stop resolving. Verified that Cloudflare
  does not retain a copy - `/files/` responses come back `CF-Cache-Status: DYNAMIC`, i.e. served
  from origin, never edge-cached. They are also sent `Cache-Control: no-store, private`.
- **Stopping the server deletes nothing.** Your originals stay in `uploads/` until you remove
  them: `rm uploads/*` (or `Remove-Item uploads\*`).
- **The provider keeps its own copy.** Enhancor's and fal's workers each fetch the image, and
  their results sit on their own CDNs. Nothing here can reach that. For KYC-sensitive source
  material, that is the retention that actually matters - assume anything submitted to either
  provider is out of your control. Adding fal means a second party now receives whatever you
  drop on a fal tab.

## Why a tunnel is needed

Both providers take image inputs as **public URLs**, not file uploads - `img_url` / `input_urls`
on Enhancor, `image_url` / `image_urls` on fal. Neither offers multipart upload on these paths,
so a dropped file has to be served somewhere their workers can reach it. For Enhancor the tunnel
also supplies a real `webhookUrl` (a required field on every endpoint), so results arrive by
webhook instead of only by polling; fal is polled, so it only needs the tunnel for the inputs.

## Tabs

The nav is three guarded-switch groups plus a standalone Gallery switch. Lift a guard to see the
models inside; picking one latches that switch and loads its form.

**Image Editors**

| Tab | Provider | Endpoint |
|---|---|---|
| Dola-Seedream-5.0-pro | BytePlus | `/images/generations`, model `dola-seedream-5-0-pro-260628` - up to 10 reference images, synchronous |
| Seedream 5 Pro Edit | fal.ai | `bytedance/seedream/v5/pro/edit` - up to 10 reference images, 1-6 outputs |
| Bria Expand | fal.ai | `fal-ai/bria/expand` - outpaint onto a larger canvas |
| Image Editor F/A | Enhancor | `/api/enhancor-img-editor-full-access/v1` - 1-3 source images, 1-4 outputs (see below) |
| Kora | Enhancor | `/api/kora/v1` - text-to-image |
| Upscale | Enhancor | `/api/image-upscaler/v1` |
| Detailed | Enhancor | `/api/detailed/v1` |

**Portrait Enhancors** - hidden while `ENHANCOR_ON` is false, since both tabs are Enhancor's.

| Tab | Endpoint |
|---|---|
| Skin | `/api/realistic-skin/v1` - all four model versions, version-gated controls, 19 area-preserve flags |
| Portrait | `/api/upscaler/v1` - fast / professional |

**Video Generators** - three publisher pages, each with its own model drop-down (see
**Publisher pages** below), plus the Enhancor tabs that are hidden while `ENHANCOR_ON` is false.

| Page | Provider | Models |
|---|---|---|
| Kling AI | Kling AI | Kling 3.0 (+ motion control), 3.0 Omni, O1, 2.6 (+ motion control), 2.5 Turbo, 2.1 Master - see **Kling AI** below |
| BytePlus Seedance | BytePlus | `dreamina-seedance-2-5-260628` (480p/720p, to 30s, 30 image / 10 video / 10 audio refs), `dreamina-seedance-2-0-260128` (to 4k, 4-15s), `dreamina-seedance-2-0-fast-260128`, `dreamina-seedance-2-0-mini-260615`, `seedance-1-5-pro-251215` (first + last frame only) |
| fal.ai | fal.ai | `fal-ai/bytedance/seedance/v1.5/pro/image-to-video`, `fal-ai/kling-video/v2.6/pro/image-to-video` |

| Tab (Enhancor, hidden) | Endpoint |
|---|---|
| Seedance 2 | `/api/enhancor-video-pro/v1` - all seven modes, mode-gated controls, multi-file reference lists |
| Seedance 2.5 | `/api/seedance2.5/v1` - nine modes, no `type` field, up to 30s |
| MiniMax H3 | `/api/minimax-h3/v1` - type + mode, 768p / 2k |
| Seed Mini | `/api/seed-mini/v1` - type only, no mode |
| Kling 3 (Enhancor) | `/api/kling-v3/v1` - pro / standard, single or multi-shot, Kling elements |

**Gallery** - webhook results with save-to-disk, plus request history.

The Probe and Model Audit tabs were removed on 16/08/2026. Their findings are kept below as
record; the sweeps themselves had served their purpose and the audit tab queued billable jobs.

### Publisher pages (21/08/2026)

The video menu had grown a row per model and was about to gain six more. The models that share a
publisher now share a page: one nav entry, a brand plate at the top, and a drop-down that swaps
between that publisher's models.

| Nav entry | Models behind the drop-down |
|---|---|
| Kling AI | Kling 3.0, 3.0 Omni, O1, 2.6, 2.5 Turbo, 2.1 Master |
| BytePlus Seedance | Dreamina-Seedance 2.5, 2.0, 2.0-fast, 2.0-mini, ByteDance-Seedance 1.5-pro |
| fal.ai | Seedance 1.5 Pro i2v, Kling 2.6 Pro i2v |

Kling 2.6 appears twice on purpose - once on Kling's own API and once on fal - because pages group
by who bills you, and having both a click apart is what makes them comparable.

**The plate.** The publisher's wordmark in their own colours, centred, sticky to the top of the
scroll area so a long form scrolling past never leaves the page unlabelled. Kling is a
violet-to-magenta gradient, BytePlus azure-to-cyan, fal monochrome - which is fal's own design
language and, conveniently, the thing that tells it apart from two gradients at a glance. The
palettes are three CSS custom-property lines (`.pub-kling`, `.pub-byteplus`, `.pub-fal`) and are
approximations, not brand assets - retune them in place.

**Which model opens.** First visit opens the publisher's newest model, which is just
`models[0]` - the lists are ordered newest first. After that the page opens on whatever was used
last, remembered in `localStorage` under `pubModel:<page id>`. A remembered id that no longer
exists falls back to the newest rather than rendering an empty page.

**Only the chosen model's fields are shown**, because a publisher page renders exactly one
service form at a time - the same `renderService` the standalone tabs use, drawn into the box
below the plate instead of straight into the pane. That is the whole mechanism: `FORM_HOST`.

**Switching models keeps your inputs.** No new code: `FORMS`, `OUTS` and `STATUS` were already
keyed by service id, so each model keeps its own form state, its own result cards and its own live
status line whether you leave it by picking another model or by leaving the page. A job queued on
2.5 Turbo keeps polling and saving while you set up a shot on 3.0 Omni, and its results are still
there when you switch back.

Adding a model to a publisher is one entry in the service map plus one line in
`PUBLISHERS.<page>.models`. Adding a publisher is one `PUBLISHERS` entry, one nav line and three
CSS custom properties.

### Prompt library

Every tab with a prompt box has its own saved-prompt store: a picker above the box listing titles
newest-first, plus **New** / **Edit** / **Load** / **Delete**. Opening a tab selects and loads the
most recent prompt. `New` saves whatever is in the box under a title you type; `Edit` renames the
selected prompt **and** rewrites its body from the box; `Delete` asks first. A live character count
sits under the field's label - spaces included, titles excluded, since a title is never sent.

Prompts live in `localStorage` under `prompts:<service id>`, so they are per-browser and per-model,
and they survive a server restart. They are not part of the request payload.

**Adding a model later needs nothing extra.** The library is attached by `renderService` to any
field literally named `prompt`, so a new tab inherits the picker, the buttons and the counter from
its ordinary `["prompt","textarea","Prompt",{...}]` field spec. `test_prompt_store.js` asserts that
hook, so removing it breaks a test rather than quietly dropping the feature from new models.

Files land in `uploads/`. Results **save themselves the moment a job finishes** - no clicking -
into the folder in the Save-to box, or `outputs/` if that box is empty or the path is unusable.

Filenames are `<model>_<destination folder>.<ext>`: with the box set to `C:\new\dir` a Seedance
render lands as `C:\new\dir\sd2_dir.mp4`, then `sd2_dir_2.mp4`, `sd2_dir_3.mp4` - a previous render
is never overwritten. The folder half comes from where the file *actually* landed, so a rejected
path is named `sd2_outputs.mp4` rather than claiming a folder it never reached. The extension comes
from the result URL, or from the `Content-Type` the CDN served when a signed URL carries no
extension at all - the `.bin` that used to fall out of that matched neither post-gen list, so the
chain quietly ran nothing. Model abbreviations:
`ev1`/`ev3`/`ev4`/`ev4b`, `sd2`, `sd25`, `mmh3`, `smin`, `kv3`/`kv3s`, `kp`/`kpc`, `pup`/`pupf`, `ups`, `det`,
`imed`, `sd5e` (Seedream 5 Pro Edit), `brex` (Bria Expand).

A fal job that returns several images saves each one, so `num_images: 3` lands as
`sd5e_dir.jpeg`, `sd5e_dir_2.jpeg`, `sd5e_dir_3.jpeg`.

The card's button re-saves on demand and reads `Retry save` if the fetch failed - their result URLs
are on a CDN and do expire, which is why the save no longer waits for a click.

### Post-generation scripts

Saved output can be put through local scripts. **Videos** get up to three, in an order you choose;
**images** get one. The two lists are separate and never mix - a video script is not offered for an
image, and vice versa. Both come from `.env`, one line per script:

```
POSTVIDGEN_1="C:\Scripts\PostProcessing_Script.bat"
POSTVIDGEN_2="C:\Cats\ScratchingPost_Break.cat"
POSTVIDGEN_3="Cat\To-Werk.kek"

POSTIMGGEN_1="D:\Tools\upscale\img.bat"
```

Add `POSTVIDGEN_4`, `POSTIMGGEN_2`... to offer more choices; each list is presented in numeric
order. The three video drop-downs under Save folder pick which of them run and in what order, and
the slot number **is** the order; the single image drop-down picks the one image script. A blank
slot runs nothing, and three is the ceiling per video however many are defined. Only the row that
applies to the open tab is shown - video generators get the video row, the image editors the image
one, and the gallery both - and a hidden row runs nothing, so a pick left on the other row cannot
fire on a tab that never offered it. The drop-down label
is the command's own filename, so there is no second name to keep in sync, and the lists refresh
from `.env` on the next config poll - no restart.

Each command runs with **its own folder as the working directory**, so a relative venv activates,
and with `stdin` at DEVNULL so a trailing `pause` gets EOF rather than waiting on a keypress. The
saved video's path is appended as the last argument, or substituted for `{}` if the command names a
spot for it. Scripts run strictly in sequence and each one is handed **what the previous script
produced** - the newest video that appeared beside its input, or the same file if it wrote none.
That is what chains rPPG's `<stem>_dm<n>.mp4` into deai without either script knowing about the
other. A failure stops the chain rather than feeding on a half-written file.

Images are never post-processed. Which scripts run is the local page's decision: a request that
arrives over the tunnel runs none, the same rule that governs the save folder.

### Running several jobs at once

Jobs are independent - the server is threaded, each tab polls on its own, and results save
themselves as they land. Queue one model, switch tabs, queue another with the same inputs and both
finish. A tab keeps its form, its status line and its result cards while you are away, so coming
back shows the job mid-flight rather than a blank form. That applies to models behind a publisher
page's drop-down as well as to whole tabs - the state is keyed by model, not by what is on screen. The Save folder box and the script
drop-downs are global and read at save time, so every result of a session lands in the same folder
under the same chain.

Self-checks: `python test_server.py`, `python test_save_naming.py`, `python test_postprocess.py`,
`node test_video_fields.js`, `node test_fal_fields.js`, `node test_byteplus.js`,
`node test_kling.js` and `node test_prompt_store.js` (all offline), plus
`python test_skin_matrix.py` (live, needs a key, costs nothing - every payload targets an
unresolvable image host).

## Kling AI (added 21/08/2026)

Kling's own open platform, six image-to-video models behind one page. Added alongside the
consolidation of the video nav into publisher pages (see **Publisher pages** above).

**Host.** `https://api-singapore.klingai.com`. `api.klingai.com` answers as well, but task ids
are regional: a job created on one host is invisible from the other. This key was issued in
Singapore, so the Singapore host is the only one the tool talks to.

**Auth.** `Authorization: Bearer KLINGAI_API_KEY`. Most write-ups of this API describe a JWT
signed from an AccessKey/SecretKey pair with a ~30 minute expiry. That is the older scheme. The
key this account holds is a static `api-key-kling-...` string that the platform accepts as a
plain bearer token - no signing, no key pair, nothing to refresh. Verified on 21/08/2026 against
`GET /v1/videos/image2video?pageNum=1&pageSize=1` (200, `code: 0`).

**Two request shapes, one poller.**

| Models | Route | Body |
|---|---|---|
| 3.0, 3.0 Omni, O1, 2.6, 2.5 Turbo | POST `/<capability>/<model-id>` | typed parts in `contents`, knobs in `settings`, callback/id/watermark in `options` |
| 2.1 Master | POST `/v1/videos/image2video` | flat, model chosen by `model_name` |

Both return `{code, message, request_id, data:{...}}` - and the task id is *nested*: `data.id` on
the new routes, `data.task_id` on the legacy one. The top-level `request_id` names the HTTP call,
not the job, so taking it would put the wrong id in request history and poll something that does
not exist.

Polling is one route for both generations: `GET /tasks?task_ids=<id>`, which answers for legacy
tasks too (confirmed against a task created on `/v1/videos/image2video`). The reply is
`data: [{id, status, outputs: [{type, id, url, duration}], message, billing: [{amount}]}]`, with
`status` in `submitted / processing / succeeded / failed`. The console shows the billing units
next to the status as they land.

### The six tabs

| Tab | Endpoint | Notes |
|---|---|---|
| Kling 3.0 | `/image-to-video/kling-3.0` | first + optional last frame, up to 3 elements, multi-shot prompts, native audio, 720p/1080p/4k, 3-15s |
| Kling 3.0 (motion control) | `/motion-control/kling-3.0` | mode on the same tab - appearance image + motion video, 1 element, character orientation |
| Kling 3.0 Omni | `/omni-video/kling-3.0-omni` | adds reference images, a feature video and base-video editing; aspect ratio; `native` / `original` / `off` audio |
| Kling O1 | `/omni-video/kling-o1` | same input set, 720p/1080p, 3-10s, no native audio and no multi-shot |
| Kling 2.6 | `/image-to-video/kling-2.6` | first + optional last frame, up to 2 voices, native audio, 5s/10s |
| Kling 2.6 (motion control) | `/motion-control/kling-2.6` | as 3.0's, without elements |
| Kling 2.5 Turbo | `/image-to-video/kling-2.5-turbo` | first + optional last frame, 720p/1080p, 5s/10s |
| Kling 2.1 Master | `/v1/videos/image2video`, `model_name: kling-v2-1-master` | legacy route: `cfg_scale`, `negative_prompt`, `mode` std/pro, 5s/10s |

Kling 3.0 Turbo (`/image-to-video/kling-3.0-turbo`) exists and is not wired up - it was not asked
for. Adding it is one entry in `klingVideos` plus one line in `PUBLISHERS.pubKling.models`.

**Motion control as a mode.** Motion control is a second endpoint on the same model rather than a
model of its own, so on the 3.0 and 2.6 tabs it is a `Mode` drop-down that swaps the path out from
under the form. `svc.kling` is therefore a function of form state, not a constant. The output
abbreviation changes with it (`k30` / `k30mc`), so the two never overwrite each other on disk.

**Elements and voices** are managed by their own CRUD APIs (`/v1/general/advanced-custom-elements`,
`/v1/general/custom-voices`) and are not wired into the console. The forms take the ids those APIs
return, as JSON, in the same shape Kling's own docs use:
`[{"element_id":"123","id":"Zhang"}]`, `[{"voice_id":"...","id":"sweet"}]`. The `id` half is the
name `@Zhang` in the prompt resolves to.

**Reference numbering.** On the omni tabs the prompt addresses inputs as `@image_1`, `@video_1`.
Those names come from the `id` on each content part, which `klingShape` assigns in form order -
reference images become `image_1`, `image_2`..., the feature or base video becomes `video_1`.

### Verified against the live API on 21/08/2026

Everything below was run with the account's own key, not read off the docs.

- **A real render.** `/image-to-video/kling-2.5-turbo`, 720p, 5s, one first frame. `succeeded`
  after ~50s, one `.mp4` output, `billing.amount` 1.5 units. That is what fixed the response
  shape; the docs pages carry no response body for the task query.
- **Every route reachable.** `/image-to-video/kling-3.0`, `/image-to-video/kling-3.0-turbo`,
  `/omni-video/kling-3.0-omni`, `/omni-video/kling-o1`, `/image-to-video/kling-2.6`,
  `/motion-control/kling-2.6`, `/image-to-video/kling-2.5-turbo` and `/v1/videos/image2video` all
  answer with a field-level validation error rather than a 404.
- **Unknown fields are ignored, not refused.** `{"zzz_nope": 1}` returns 200 on every model. So a
  box the API silently drops would read as set on the form while doing nothing - which is why the
  2.1 Master tab omits `sound`, `multi_shot`, `element_list` and `voice_list` even though the
  validator accepts them: acceptance there is not evidence of support.
- **2.1 Master's real capability set**, from the validator rather than the capability map:

  | Field | Result |
  |---|---|
  | `cfg_scale: 5` | `cfgScale: must be less than or equal to 1` - supported, range [0,1] |
  | `mode: 4k` | `4k mode is not supported by the current model: kling-v2-1-master` |
  | `mode: std` / `pro` | accepted |
  | `duration` | only `"5"` and `"10"`; 3, 4, 6-15 all rejected |
  | `image_tail` | `Image tail is not supported by the current model` |
  | `static_mask` / `dynamic_masks` | `Motion brush is not supported by the current model` |
  | `camera_control` | `Camera control is not supported by the current model` |

  The docs' note that "kling-v2.x models do not support cfg_scale" is wrong for this model - the
  validator range-checks it - so the box stays.
- **Duration is typed differently by route.** An int in `settings` on the new routes, a string on
  the legacy one. `klingShape` casts it once rather than trusting five field specs to agree.
- **From the page, not just curl.** Submits driven through the UI for 2.5 Turbo, 3.0 Omni and
  2.1 Master, each with a deliberately unfetchable image so nothing rendered and nothing was
  billed: correct paths, correct bodies on the wire, task ids extracted from the right place, and
  the poller carrying the status back to the tab.

**Where the field lists came from.** `app.klingai.com/global/dev` is a Vue SPA that returns HTTP
446 to anything that is not a browser, so the reference cannot be fetched as a page. Each doc page
is a lazily-imported JS module listed in `assets/api-module-loader-*.js`; importing one under node
yields the reference as structured data - field name, type, required, default, enum and every note.
That is the source for the tables above, with the live validator as the tie-breaker.

## BytePlus ModelArk (added 20/08/2026)

The account sits in **ap-southeast-1**, and ModelArk is regional: `ark.ap-southeast.bytepluses.com`
is the only host that answers for it (`ark.eu-west.bytepluses.com` is the other region's, and the
console URL for a model reads `region:ark+ap-southeast-1`). The region is the host - it is not a
path segment, a header or a body field.

One platform, two flows, and the model id in the body rather than the path:

```
video   POST /api/v3/contents/generations/tasks   -> {"id": "cgt-..."}
        GET  /api/v3/contents/generations/tasks/{id}
             -> {"status": "queued|running|succeeded|failed|cancelled|expired",
                 "content": {"video_url": "...", "last_frame_url": "..."},
                 "usage": {"completion_tokens": n}}
image   POST /api/v3/images/generations           -> {"data": [{"url": "..."}]}   (synchronous)
```

Video bodies carry their scalars at the top level (`resolution`, `ratio`, `duration`, `seed`,
`generate_audio`, `watermark`, `return_last_frame`) and their media in a `content` array of typed
parts, each tagged with the job it does:

```json
{"model": "dreamina-seedance-2-0-260128",
 "content": [{"type": "text", "text": "..."},
             {"type": "image_url", "image_url": {"url": "..."}, "role": "first_frame"},
             {"type": "image_url", "image_url": {"url": "..."}, "role": "reference_image"},
             {"type": "video_url", "video_url": {"url": "..."}},
             {"type": "audio_url", "audio_url": {"url": "..."}}],
 "resolution": "720p", "ratio": "16:9", "duration": 8, "generate_audio": true}
```

`arkShape()` in `index.html` does that conversion from the flat form fields, and
`test_byteplus.js` pins the output shape.

### Verified against the live API on 20/08/2026

Every id and field below was confirmed by sending deliberately invalid requests - nothing was
generated and nothing billed. The trick is that ModelArk resolves the model first and validates
fields in a fixed order, so an out-of-range `duration` is a safety net that guarantees the request
dies before generation while the error message tells you what it thinks of everything else.

- All six model ids resolve. A made-up id answers `404 InvalidEndpointOrModel.NotFound`, so a
  falling-through error naming the model is proof the id is real: `dola-seedream-5-0-pro-260628`
  works and the un-prefixed `seedream-5-0-pro-260628` 404s.
- **Unknown body fields are ignored, not rejected** - a typo in a field name fails silently and the
  model just uses its default. Every field the tabs send was confirmed to be recognised
  (`resolution`, `ratio`, `duration`, `seed`, `generate_audio`, `watermark`, `return_last_frame`;
  and `prompt`, `image`, `size`, `watermark`, `seed` on Seedream).
- **The request's task type is inferred from the content roles**, and the error message names it:
  text alone is `t2v`, a `first_frame` is `i2v`, first + last is `flf2v`, a `reference_image` is
  `r2v`. Seedance **1.5-pro rejects `r2v` outright** - "the specified task_type r2v does not support
  model seedance-1-5-pro" - which is why that tab offers a first and last frame and no reference
  lists at all. The 2.x models take all four.
- A `last_frame` on its own is refused; it only means anything alongside a `first_frame`.
- `reference_audio` cannot be the only reference on the 2.0 series (2.5 does support audio-only).
- **Seedance 1.5-pro is set up as an A/B pair** across the two platforms: the ModelArk tab
  (`seedance-1-5-pro-251215`) and the fal tab (`.../seedance/v1.5/pro/image-to-video`) run the
  same model, and both carry a real `seed` (fal's is `integer | null`, -1 for random, confirmed
  against their live OpenAPI on 20/08/2026). Their shared defaults are pinned to the same values
  - 9:16, 720p, 5s, audio **off**, camera **fixed** - so the only variable is the platform. fal's
  own defaults are 16:9 with audio on and the camera free; the tab overrides all three.
  Unmatched by design: `camera_fixed`, `enable_safety_checker` (fal only), `watermark` and
  `return_last_frame` (ModelArk only). fal's endpoint is image-to-video only, so give both tabs
  a first frame - ModelArk will silently run text-to-video from the same prompt otherwise.
- `camera_fixed` is a real top-level boolean on ModelArk, default `false`, and it is offered on
  the 1.5-pro tab **only**: their Video Generation API reference lists exactly three supported
  models - Seedance 1.5 pro, 1.0 pro, 1.0 pro fast - and none of the 2.x tabs here are among
  them. Two things their doc is explicit about: `true` makes ModelArk **append a fixed-camera
  instruction to the prompt** rather than constrain the model, so the result is not guaranteed;
  and it is **not supported in reference-image scenarios**, which is moot on 1.5-pro since that
  tab has no reference lists (`refs: false`).
- Seedream's pixel ceiling is **4,624,220**, quoted by the validator itself, and `seed` runs
  -1 to 2147483647 on ModelArk. fal's Seedream v5 Pro has **no `seed` at all** (see below), so a
  seed-matched A/B across the two platforms is not possible from this side.
- The Dola tab's sizes are the 12 the Seedream docs list - four ratios x three tiers, ~1 / 2.4 /
  4.2 MP - picked as chips rather than a drop-down, and the ratio is read back off the stored
  `WxH` so nothing extra reaches the body. `watermark` has no control on the form; it is pinned
  `false` in `shape()`, because the platform's own default is on.

Notes that cost time if you meet them cold:

- **Every reference needs an explicit job in the prompt** (`[Image 1] is the woman...`), and shots
  split with time codes (`[0-4s]: ... [4-8s]: ...`). An unaddressed reference is silently ignored.
  Negative phrasing does not work - say what should be there.
- **Reference videos must be URLs.** The API will not take an inline upload. Ours are already
  tunnel URLs, so the drop zones work as they do everywhere else - but the tunnel must be up.
- **Seedream 5.0 Pro takes about two minutes per image** and answers on the same request, which is
  why the proxy's outbound timeout is 240s. It supports neither `stream` nor
  `sequential_image_generation` - sending either is a 400 - so neither is offered.
- **Seedance 2.5 needs a prepaid resource pack** on the account, not just balance. Without one the
  call returns `ModelNotOpen` rather than a validation error.
- ModelArk blocks real human portraits as references. That is their filter, not ours; expect
  face-heavy source images to be rejected at submit.
- Model ids carry a release date and are what the API keys on, so each tab shows its id in the
  form heading. If BytePlus rotates one, the id in `arkVideos` / `sd5pro` is the single place to
  change it.
- Roles are how the platform tells a reference apart from a frame: `first_frame`, `last_frame`,
  `reference_image`, `reference_video`, `reference_audio`. An unknown role is a hard 400.

## fal.ai tabs

Added 16/08/2026. Field lists were taken from fal's own OpenAPI document rather than the model
page, so they are the complete input schema and not a subset:

```
https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedream/v5/pro/edit
https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/bria/expand
```

**Transport.** fal is a queue, not a webhook service, for our purposes. Submit is a POST to
`https://queue.fal.run/<endpoint id>`; the reply carries `request_id`, `status_url` and
`response_url`. The console polls `status_url` (GET) every 4s and fetches `response_url` (GET)
once status is `COMPLETED`. It uses the URLs fal hands back rather than building them - for a
nested endpoint id like `bytedance/seedream/v5/pro/edit` the request path is *not* the endpoint
id, so constructing it by hand gets a 404. `?fal_webhook=` exists but is not used; the webhook
plumbing here is Enhancor-specific and fal takes its callback as a query param, never a body
field, so the injector skips fal URLs entirely.

**Seedream 5 Pro Edit** - `image_urls` (required, up to 10; past 10 only the last 10 count),
`prompt` (required), `image_size`, `num_images` (1-6), `output_format` (png/jpeg),
`enable_safety_checker`. `image_size` is a union in the schema: one of `auto_2K`, `auto_1K`,
`square_hd`, `square`, `portrait_4_3`, `portrait_16_9`, `landscape_4_3`, `landscape_16_9`, or an
object `{width, height}`. The form drops the enum arm and offers the same 12 chips as the Dola
tab, so the two can be run against each other on one size; `shape()` sends them as
`{width, height}`. fal documents the total pixel range as 1024x1024 to 2048x2048, which puts the
4.2 MP tier above their ceiling - it is kept because the model takes it, and the field hint says
so. There is no `seed` on this endpoint - genuinely absent from the schema, not omitted here, and
re-confirmed against fal's live OpenAPI on 20/08/2026 for both `/edit` and `/text-to-image`.
Unknown fields are dropped rather than rejected, so inventing one would read as a matched seed
in an A/B that was never matched.

**Bria Expand** - `image_url` and `canvas_size` (required), plus `original_image_size`,
`original_image_location`, `aspect_ratio`, `prompt`, `negative_prompt`, `seed`. Bria takes three
`[x, y]` pairs; the form asks for the six numbers separately so each gets its own label and
range, and packs them at send time. A pair is only sent when both halves are filled, because
half a pair serialises as `[1200, null]` and draws a shape error instead of the plain "field
required" you want. Keep the subject above 15% of canvas area. `aspect_ratio`, when set,
overrides the placement fields.

`sync_mode` is deliberately not exposed on either tab: it returns the image as a data URI and
keeps the job out of request history, which breaks save-to-disk.

Blank number fields stay blank all the way to the wire. `Number("")` is `0`, and on Bria's seed
and placement pairs `0` is a real value that means something else - so an empty box is dropped
from the payload rather than sent as zero. `test_fal_fields.js` pins that, along with both
shape hooks and both result extractors.

## Seedream 5 Pro is not on the public API (16/08/2026)

Their web app advertises "Seedream 5 Pro - Commercial Grade Visuals". It is not reachable with an
API key, and no tab here talks to it. Established by reading their front-end bundle
(`App-a9c4f558.js`, pulled from the `/image-editing` page's network tab):

- The bundle **embeds their own API docs**. Twenty documented sections, none named Seedream:
  Detailer, Enhancor Image Editor Full Access, Enhancor Text to Image Full Access, Enhancor UGC,
  Enhancor Video Full Access, GPT Image 2, Happy Horse, Kling V3, Kora Pro, Kora Reality,
  Lattice Motion, Nano Banana 2, Seed Mini, Seed Mini New, Seedance 2.0 Full Access,
  Seedance 2.0 Unrestricted, Seedance 2.5 Unrestricted, Seedance 2.5 Unrestricted New,
  Skin Enhancor, UGC Audio Fixer. Twenty-seven distinct `apireq.enhancor.ai/api/...` paths, no
  seedream anywhere.
- The web app posts it to a different host behind a different auth scheme:

```js
// model: "Seedream-5-Pro", prompt, imageUrl, imageSize, customImageSize,
// isUncensored, verifiedSignature, resolution ("1K" | "2K"), n forced to 1
fetch("https://enhancor-server.vercel.app/api/kora/v1/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: firebaseIdToken },
  body: JSON.stringify({ data: fr(payload) })   // fr() imported from account-*.js
})
```

Three walls: wrong host, a Firebase ID token instead of `x-api-key`, and `fr()` encoding the body
so the wire format is not plain JSON. Same pattern as `generateSkinTextureImg` below.

**The white-label question.** Two public endpoints are unnamed image models. Neither is it:

| | img-editor-full-access | txt-to-img-full-access | web app Seedream 5 Pro |
|---|---|---|---|
| cost | 117.6 x n | 90 x n | 58.5 @1K, 117 @2K |
| resolution | - | 4K/2K/1K | 1K/2K |
| sizes | `square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9` | aspect_ratio only | `square, portrait2:3, portrait3:4, portrait9:16, landscape3:2, landscape4:3, landscape16:9` |

The 2K cost is a near match for the image editor, but the size enum settles it: Seedream 5 Pro has
`portrait2:3` and `landscape3:2` and no `squareHD`. Different validator, so neither endpoint gets
to wear the name.

**Resolved 16/08/2026.** Going through Enhancor for this model was never possible, so the console
now calls **Seedream 5 Pro Edit on fal.ai directly** (`bytedance/seedream/v5/pro/edit`) - the
model itself, no reseller, its full parameter set, billed to a fal key. See the fal.ai section
above. This also confirms the reselling analysis below from the other direction: fal hosts the
weights, Enhancor was only ever a wrapper around them.

`enhancor-img-editor-full-access` stays in the group under its own name - the same uncensored
image-to-image editor at 117.6 credits per output image, useful when you want it billed to the
Enhancor key. Field names verified against the live validator, not just the docs (empty body ->
"Prompt is required"; prompt only -> "input_urls is required and must be a non-empty array of
image URLs").

Incidental: the app seeds its examples from `storage.googleapis.com/falserverless/...`, more fal.ai
provenance for the section below.

## Skin: what the public API actually exposes

Their published docs still describe only `enhancorv1` and `enhancorv3`. The live validator
disagrees. Recovered by feeding it junk values - it enumerates the allowed set on rejection -
with `img_url` pointed at `example.invalid` so nothing that passes validation ever renders or
bills. Verified 09/08/2026; `test_skin_matrix.py` re-runs the whole matrix.

```
model_version must be 'enhancorv1' , 'enhancorv3' , 'enhancorv4' or `enhancorv4_base`
```

| Version | Enhancement mode | Version-specific controls |
|---|---|---|
| `enhancorv1` | `standard`, `heavy` | `skin_realism_Level` 0-5; `portrait_depth` in heavy only |
| `enhancorv3` | `standard` only | `skin_realism_Level` 0-3, `portrait_depth`, `output_resolution`, `mask_image_url`, `mask_expand` |
| `enhancorv4` | ignored | `enhancement_strength`, `freckle_intensity`, `fix_lighting_mode`, `fast_mode` |
| `enhancorv4_base` | `standard` only | none - it upscales and skin-fixes in one pass |

**Four undocumented fields**, confirmed real because the validator type-checks them (an unknown
field is silently ignored and the request falls through to the image fetch):

| Field | Allowed | Applies |
|---|---|---|
| `enhancement_strength` | `subtle`, `realistic`, `pimple`, `freckle` | v4 |
| `freckle_intensity` | `0`, `50`, `100` - exactly, `25` is rejected | v4 + strength `freckle` |
| `fix_lighting_mode` | boolean | v4 + strength `realistic` |
| `fast_mode` | boolean | v4 |

`enhancementMode` is enforced per version, so the Skin tab now hides modes the selected version
rejects and drops hidden fields from the payload - picking v3 with `heavy` left over from v1 is a
hard 400, not a silent downgrade. Area flags are shown for v1/v3 only; their own docs state v4
has no area control.

### The two Skin Editor options that are not on the public API

`enhancorv2` and the `detailed` enhancement mode exist **only in their web Skin Editor**. Both are
rejected outright by the key-authenticated API:

```
model_version: "enhancorv2"                  -> Model version must be 'enhancorv1' , 'enhancorv3' ...
enhancorv1 + enhancementMode: "detailed"     -> Enhancement mode must be 'standard' or 'heavy'
```

Their web app bundle (`app.enhancor.ai/assets/App-*.js`) confirms the editor's real option set -
V1 `standard|detailed|heavy`, V2 `standard|pro|detailed`, V3 `standard|detailed|crisp`, V4 preset-
driven - and that the editor posts to a different backend
(`enhancor-server.vercel.app/api/realistic-skin/v1/generateSkinTextureImg`) behind a Firebase
`Authorization` token, with the request body encrypted before send. So there is no way to reach V2
or Detailed with an API key alone; replicating them locally means replicating that auth and
payload encoding, not adding a field here.

The nearest public equivalent to Detailed is the separate `/api/detailed/v1` endpoint (the
**Detailed** tab). It is a fixed pipeline - probing every plausible knob (`detail_level`,
`upscale_factor`, `mode`, `model_version`, `creativity`, ...) showed all of them ignored; it takes
`img_url` and `webhookUrl` and nothing else.

## Model audit (removed 16/08/2026 - kept as record)

The tab is gone. What it did and what it found:

**Phase 1 - endpoint sweep.** POSTs to ~20 candidate video paths (`/api/video/v1/queue`,
`/api/seedance/v1/queue`, `/api/kling/v1/queue`, ...). A 404 means the route does not exist;
a 400 or 422 means it exists and rejected the body, which is the signal worth having.

**Phase 2 - model sweep.** POSTs each candidate model string to a queue endpoint. The list
includes `__definitely_not_a_real_model__` as a control: if a string that cannot exist is
accepted the same way `seedance_2.5` is, that endpoint is not validating the model field and
acceptance proves nothing. The verdict block says so explicitly rather than reporting a
false positive.

**fal.ai provenance.** Enhancor is understood to resell fal.ai. Every response is scanned for
markers that give a passthrough away - result URLs on `fal.media`, `fal.run` references,
`x-fal-*` headers, and fal's FastAPI/pydantic `{"detail":[{"loc":...}]}` error shape. This
matters more than any model label: if they resell fal, fal's catalogue is their ceiling and
they cannot serve a version fal does not host. The check also runs on every completed job, so
a returned `fal.media` URL settles it outright.

## Findings, run 05/08/2026 with a live key

**There is exactly one video endpoint.** Every other candidate 404s, including `seedance-2-5`,
`seedance-3`, `kling-3`, `veo-3` and `sora-2`. The control path `/api/kora/v1/queue` returned 400
in the same sweep, so those 404s mean absence.

**`model_version` is not validated.** Posting `model_version: "__definitely_not_a_real_model__"`
with an otherwise complete body returns `200 {"success":true,"requestId":"..."}`. Their queue
accepts any string and runs the job regardless.

That is the whole answer to "do they really have Seedance 2.5". The version label is a free-text
field they never check, so a UI claiming any version is not evidence of anything - the same
mechanism behind the earlier Kling 3 / 2.6 relabel. Only a rendered clip compared against a known
reference can establish what the weights actually are.

Documented image endpoints do validate: kora rejects unknown models with
`{"error":{"message":"Invalid model"}}` and accepts only `kora_pro` / `kora_pro_cinema`.

## The video endpoint is now documented (re-verified 13/08/2026)

Enhancor published a "Seedance 2.0 Unrestricted API" doc page and moved the route:

```
was:  /api/seedance-2/v1          (undocumented, reverse-engineered)
now:  /api/enhancor-video-pro/v1  (documented)
```

The old path still answers and returns byte-identical validator errors, so it is an alias rather
than a replacement - but the console targets the documented one.

**What changed in the schema.** `ugc` mode is new. `4k` joins the resolution list, `aspect_ratio`
is now an enum rather than free text, and `webhook_url` is enforced (`"Webhook URL is required"` -
it used to be optional). Reference-list fields (`images`, `videos`, `audios`, `products`,
`influencers`) and `multi_frame_prompts` are documented for the first time. `full_access` and
`is_uncensored` are new booleans. `model_version`, `generate_audio`, `camera_fixed` and `seed` are
absent from the published schema; `model_version` is still accepted and still never validated, so
the finding above stands - they simply stopped advertising the field.

`POST /api/enhancor-video-pro/v1/queue`, poll `POST /api/enhancor-video-pro/v1/status` with
`{"request_id":...}`, or take the webhook (`{request_id, result, status, cost}`).

| Field | Notes |
|---|---|
| `type` | **required** - `text-to-video` or `image-to-video` |
| `mode` | **required** for image-to-video - `multi_reference`, `extend`, `multi_frame`, `lipsyncing`, `voice_clone`, `first_n_last_frames`, `ugc` |
| `webhook_url` | **required** - snake_case here, the image APIs want `webhookUrl`. The proxy sends both |
| `prompt` | required except `multi_frame`. `@image1` / `@video1` / `@audio1` reference the lists below; `@omni-character:char_...` a saved character |
| `duration` | 4-15s, default `"5"`. Ignored for `multi_frame` - derived from the segment list |
| `resolution` `aspect_ratio` | `480p` `720p` `1080p` `4k`; `21:9` `16:9` `4:3` `1:1` `3:4` `9:16`. 1080p and 4k require `fast_mode:false` |
| `fast_mode` `full_access` `is_uncensored` | booleans, all default false. `full_access` for human faces, `is_uncensored` for NSFW |
| `images` `videos` `audios` | URL arrays - max 9 / 3 / 3, video and audio references under 15s combined |
| `first_frame_image` / `last_frame_image` | `first_n_last_frames` - first required, last optional |
| `lipsyncing_audio` | mp3/wav, required for `lipsyncing` and `voice_clone` |
| `multi_frame_prompts` | `[{prompt, duration}]`, required for `multi_frame`, durations sum to 4-15s |
| `products` `influencers` | `ugc` only - combined 9 images |

The table lists *their* defaults. The console deliberately differs: 9:16, 720p and 12s, because
that is what gets generated here. Kora's `image_size` defaults to `portrait_9:16` to match - that
field is free text and unvalidated, so the string is a request, not a guarantee.

Enumerations above were re-read off the live validator on 13/08/2026, not just the doc page:
`Invalid mode, (allowed: ...)`, `Invalid resolution, (allowed: 480p, 720p, 1080p, 4k)`,
`Invalid aspect ratio, (allowed: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16)`.

Their doc contradicts itself on UGC: `images` is listed as "not supported when mode is ugc" while
`products` says the 9-image cap covers `products` + `influencers` + `images`. The tab follows the
first and hides `images` in ugc mode.

## Four more video models (added 13/08/2026)

The endpoint sweep in "Findings" is out of date: Enhancor has shipped four more video routes since.
None appear in their public docs repo - the route names and schemas below came out of their web app
bundle (`app.enhancor.ai/assets/App-*.js`, which carries the full API doc text) and were then
re-checked field by field against the live validators.

| Tab | Route | Shape |
|---|---|---|
| Seedance 2.5 | `/api/seedance2.5/v1` | **no `type` field** - `mode` alone: `text_to_video`, `first_n_last_frames`, `multi_reference`, `edit`, `extend`, `multi_frame`, `lipsyncing`, `voice_clone`, `ugc` |
| MiniMax H3 | `/api/minimax-h3/v1` | `type` + `mode` (`multi_reference`, `first_n_last_frames`) |
| Seed Mini | `/api/seed-mini/v1` | `type` only, **no `mode` at all** |
| Kling 3.0 | `/api/kling-v3/v1` | `mode` is quality (`pro` / `standard`), not a workflow |

Enumerations, read off the live validators:

| | duration | resolution | aspect_ratio |
|---|---|---|---|
| Seedance 2.5 | 4-30, or `-1` auto (`edit` **must** be `-1`) | `480p` `720p` | + `adaptive`; forced to it on `edit`/`extend`/`first_n_last_frames` |
| MiniMax H3 | 4-15 | `768p` `2k` | `21:9` `16:9` `4:3` `1:1` `3:4` `9:16` |
| Seed Mini | 4-15 | `480p` `720p` | as above - **no `adaptive`**, though both doc revisions list it |
| Kling 3.0 | 3-15 (default 8) | n/a | `16:9` `9:16` `1:1` only |

Model-specific fields: Seedance 2.5 adds `output_format` (`mp4`/`mov`), `pass_faces`, `full_access`,
and raises the reference caps to 30 images / 10 videos / 10 audios. Seed Mini adds `generate_audio`,
`full_access`, `is_uncensored`, and rejects any media field on a `text-to-video`
(`"text-to-video only accepts a prompt. Remove the following unsupported fields: ..."`) - its frame
fields and reference arrays are also mutually exclusive, which the tab hints at but cannot enforce.
Kling takes `image_input`, `multi_shots` + `multi_prompt`, `sound`, and `kling_elements`.

**Cost warning, learned the hard way.** Seedance 2.5's `text_to_video` needs nothing but a prompt, so
there is no unreachable-media trick to make a probe die for free: three field probes against it were
*accepted* and each queued a real job at 2790.96 credits. `output_format`, `full_access` and `type`
are not validated there. Probe that endpoint only with an invalid value in a field you know is
checked, and confirm the response is a 400 before sending the next one.

### Validation order (matters for probe design)

`type` -> `mode` -> `prompt` / `multi_frame_prompts` -> `webhook_url` -> media URL format ->
(`model_version` never checked). Miss any earlier gate and the request never reaches the field you
meant to test. Both sweeps guard against this and report INCONCLUSIVE rather than a false negative.

**Cost safety:** because `model_version` is unvalidated, every phase 2 probe against the video endpoint is
*accepted* and queues a job. The default base body points the frame URLs at `example.invalid`, an
unresolvable domain, so each job dies at image fetch with no render and no charge. Point those at
a real image and a full sweep will bill you for every row.

An accepted model string is a label, not proof of the weights behind it. The only conclusive
evidence is generated output compared against a known reference.
