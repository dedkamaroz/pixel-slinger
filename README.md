# Pixel Slinger

Local web console for image and video generation across four live providers - **Kling AI**
(`api-singapore.klingai.com`), **BytePlus ModelArk** (`ark.ap-southeast.bytepluses.com`),
**fal.ai** (`queue.fal.run`) and **QwenCloud** (`dashscope-intl.aliyuncs.com`). Drag-and-drop file input, every request and response streamed to an
on-page terminal, results saved to disk the moment they land.

A fifth provider, **Enhancor** (`apireq.enhancor.ai`), is built and working but switched off.
Its tabs, field gating and webhook plumbing are all still in the code; `set ENHANCOR=1` in
`start.bat` puts them back in the nav. There is deliberately no control for it in the page.

Each provider keeps its own key and its own transport; the proxy picks between them by hostname,
so one provider's body can never go out signed with another's key.

| Provider | Host | Auth | Flow |
|---|---|---|---|
| Kling AI | `api-singapore.klingai.com` | `Authorization: Bearer KLINGAI_API_KEY` | POST `/<capability>/<model>`, GET `/tasks?task_ids=` |
| BytePlus | `ark.ap-southeast.bytepluses.com` | `Authorization: Bearer BYTEPLUS_API_KEY` | video: POST `/contents/generations/tasks`, GET `.../{id}`; image: POST `/images/generations`, synchronous |
| fal.ai | `queue.fal.run` | `Authorization: Key FAL_KEY` | POST endpoint id, GET `status_url` then GET `response_url` |
| QwenCloud | `dashscope-intl.aliyuncs.com` | `Authorization: Bearer QWENCLOUD_API_KEY` | video: POST `/api/v1/services/aigc/video-generation/video-synthesis` (`X-DashScope-Async: enable`), GET `/api/v1/tasks/{id}`; image: POST `/api/v1/services/aigc/multimodal-generation/generation`, synchronous |
| Enhancor (off) | `apireq.enhancor.ai` | `x-api-key: ENHANCOR_API_KEY` | POST `/queue`, webhook + POST `/status` polling |

Three of the five sign with `Bearer`, so the hostname is the only thing keeping the BytePlus,
Kling and QwenCloud keys apart. `is_ark` / `is_kling` / `is_qwen` compare the parsed hostname
exactly - a lookalike host matches none of them.

## Start / stop

**First run:** double-click `setup.bat` once (see [Setup](#setup)).

**Start:** double-click `start.bat`. It first pulls the latest `main` from GitHub (fast-forward
only - a copy without git, or with a local edit in the way, just starts as it is), then a console
window opens, the tunnel comes up after a few seconds, and the browser opens on
http://127.0.0.1:8787. Python 3.10+, no pip install.

**Stop:** press `Ctrl+C` in that console window - the tunnel is torn down on the way out and it
prints `tunnel closed`. If you closed the window, lost it, or the server is running detached,
double-click `stop.bat` instead.

`stop.bat` reads `.server.pid` (written at startup) and kills exactly those two processes - the
server and its own tunnel - so it can never touch an unrelated tunnel of yours.

Closing the console window with the X does **not** stop the tunnel: Windows leaves the child
process running and it keeps serving `uploads/` to the internet. Use Ctrl+C or `stop.bat`. To
check nothing is left over:

```powershell
Get-Process cloudflared -EA SilentlyContinue     # should return nothing
```

## Setup

**The short version:** download the repo (green **Code** button on GitHub -> **Download ZIP**, then
right-click the zip -> Extract All; or `git clone` if you have git - a cloned copy updates itself
every time `start.bat` runs, a zip never does), double-click **`setup.bat`**, then double-click
**`start.bat`**. `setup.bat` installs Python if it is missing, downloads
`cloudflared` next to the other files, and opens `.env` in Notepad for your keys. It is safe to run
again any time - it skips whatever is already done.

You still have to bring your own API keys; there is nothing to sign into in the app itself.

The long version, if you would rather do it by hand:

1. Put your keys in `.env`:
   ```
   KLINGAI_API_KEY=api-key-kling-...
   QWENCLOUD_API_KEY=sk-ws-...
   BYTEPLUS_API_KEY=your_byteplus_key_here
   FAL_KEY=your_fal_key_here
   ENHANCOR_API_KEY=only_needed_with_ENHANCOR=1
   ```
   Keys stay server-side. The browser never sees them and they are redacted in the console log.
   The header carries a badge per provider; any of them can be missing and the tabs belonging to
   the others still work. A call to a provider whose key is absent is refused before it leaves
   the machine rather than being sent with the wrong credential.

2. Install cloudflared so the providers' servers can fetch your dropped files. `setup.bat`
   drops `cloudflared.exe` in this folder, which needs no admin and no package manager; the
   installed alternatives are:
   ```
   scoop install cloudflared          # no admin needed - this is what's installed here
   choco install cloudflared          # alternative, needs an elevated shell
   winget install --id Cloudflare.cloudflared
   ```
   The server starts a free quick tunnel on launch (no account, no login). The TUNNEL badge in
   the header goes green and the log prints the public hostname.

   Without a working tunnel, uploads still work locally but no provider can reach the URL, and
   every job fails on their side - fal with a download error, Kling with `Something went wrong
   when we tried to get the contents of the file`, BytePlus with a fetch failure.

## The tunnel

`cloudflared` opens a quick tunnel to the local server at startup. The hostname is random and
**changes every restart** - fine, the proxy rewrites the input URLs per request. If cloudflared
exits, the badge goes red; restart with `start.bat`.

## Why a tunnel is needed

Every provider here takes image and video inputs as **public URLs**, not as uploads. A dropped
file has to be served somewhere their workers can reach it, which is all the tunnel does:
`uploads/` on this machine, reachable from outside for as long as the server runs.

It is not equally removable per provider, and only the blockers below are verified here:

- **BytePlus refuses inline uploads for reference videos** outright (confirmed 20/08/2026).
- **Enhancor requires a reachable `webhookUrl` on every endpoint**, so it cannot run without one
  at any file size.
- fal is polled rather than webhooked and is believed to accept its own storage URLs and data
  URIs, which would make it tunnel-free - **not tested from here**.
- Kling's media parts are documented as a `url`. Its fetcher reports "not valid base64" on a
  malformed URL, which suggests the field is dual-mode, but that is inference, not a test.

So the tunnel stays. Removing it would mean a second upload path per provider and would still
leave BytePlus reference videos and Enhancor dead.

## What is exposed, and for how long

The tunnel is a reverse proxy, not storage. Files only ever live in `uploads/` on this machine.

- **While the server runs:** anything in `uploads/` is fetchable by anyone holding the URL, with
  no auth. Quick-tunnel hostnames are unguessable but not secret.
- **After you stop it:** the tunnel dies and the URLs stop resolving. Cloudflare does not retain
  a copy - `/files/` responses come back `CF-Cache-Status: DYNAMIC`, served from origin, never
  edge-cached, and sent `Cache-Control: no-store, private`.
- **Stopping the server deletes nothing.** Originals stay in `uploads/` until you remove them:
  `Remove-Item uploads\*`.
- **The provider keeps its own copy.** Each worker fetches the file, and results sit on their
  CDNs. Nothing here can reach that. For KYC-sensitive source material that is the retention
  that actually matters: assume anything submitted is out of your control.

## Tabs

The nav is three guarded-switch groups plus a standalone Gallery switch. Lift a guard to see the
models inside; picking one latches that switch and loads its form.

**Image Editors**

| Tab | Provider | Endpoint |
|---|---|---|
| QwenCloud Qwen-Image | QwenCloud | publisher page: `qwen-image-3.0-pro` on `/multimodal-generation/generation` - text to image, or edit with 1-3 reference images, 1-6 outputs, synchronous |
| Dola-Seedream-5.0-pro | BytePlus | `/images/generations`, model `dola-seedream-5-0-pro-260628` - up to 10 reference images, synchronous |
| Seedream 5 Pro Edit | fal.ai | `bytedance/seedream/v5/pro/edit` - up to 10 reference images, 1-6 outputs |
| Bria Expand | fal.ai | `fal-ai/bria/expand` - outpaint onto a larger canvas |

**Video Generators** - four publisher pages, each with its own model drop-down.

| Page | Models |
|---|---|
| QwenCloud Wan-Video | `wan3.0-video`, `wan3.0-video-prime` (same inputs, faster, double the price) - text, first/last frame, or up to 10 image / 5 video / 5 audio references plus a document or web link, 2-30s or smart duration, 480P-1080P |
| Kling AI | Kling 3.0 (+ motion control), 3.0 Omni, O1, 2.6 (+ motion control), 2.5 Turbo |
| BytePlus Seedance | `dreamina-seedance-2-5-260628` (480p/720p, to 30s, 30 image / 10 video / 10 audio refs), `dreamina-seedance-2-0-260128` (to 4k, 4-15s), `-2-0-fast-`, `-2-0-mini-`, `seedance-1-5-pro-251215` (first + last frame only) |
| fal.ai | `fal-ai/kling-video/v2.5-turbo/pro/image-to-video` (opens here), `fal-ai/bytedance/seedance/v1.5/pro/image-to-video`, `fal-ai/kling-video/v2.6/pro/image-to-video` |

**Gallery** - webhook results with save-to-disk, plus request history.

The Enhancor tabs (Skin, Portrait, Image Editor F/A, Kora, Upscale, Detailed, and five video
models) are hidden while the switch is off. Turning it on refills the Portrait Enhancors group,
which is otherwise empty and so disappears with them.

### Publisher pages

Models that share a publisher share a page: one nav entry, a brand plate at the top, and a
drop-down that swaps between that publisher's models. Kling 2.6 appears twice on purpose - once
on Kling's own API and once on fal - because pages group by who bills you, and having both a
click apart is what makes them comparable.

First visit opens the publisher's newest model (`models[0]`; the lists are ordered newest first).
After that it opens whatever was used last, remembered in `localStorage` under
`pubModel:<page id>`. A remembered id that no longer exists falls back to the newest.

**Switching models keeps your inputs.** `FORMS`, `OUTS` and `STATUS` are keyed by service id, so
each model keeps its own form state, result cards and live status line whether you leave it by
picking another model or by leaving the page. A job queued on 2.5 Turbo keeps polling and saving
while you set up a shot on 3.0 Omni.

Adding a model is one entry in the service map plus one line in `PUBLISHERS.<page>.models`.
Adding a publisher is one `PUBLISHERS` entry, one nav line and three CSS custom properties.

### Prompt library

Every tab with a prompt box has its own saved-prompt store: a picker above the box listing titles
newest-first, plus **New** / **Edit** / **Load** / **Delete**. Opening a tab loads the most recent
prompt. A live character count sits under the field's label - spaces included, titles excluded.

Prompts live in `localStorage` under `prompts:<service id>`, so they are per-browser and
per-model, and survive a restart. They are not part of the request payload.

The library is attached by `renderService` to any field literally named `prompt`, so a new tab
inherits the picker, buttons and counter from its ordinary field spec. `test_prompt_store.js`
pins that hook.

### Saving results

Files land in `uploads/`. Results **save themselves the moment a job finishes** - no clicking -
into the folder in the Save-to box, or `outputs/` if that box is empty or unusable.

**Source folder.** A dropped file's real path is invisible to a web page, so "save next to the
import" works the other way round: the **Source folder** button opens a native folder picker once
per session, and results then write straight into that folder. The bytes come through
`GET /api/blob?url=` (provider CDNs send no CORS headers, and the endpoint answers the local page
only, never the tunnel). Chrome/Edge only, and the pick does not survive a refresh.

Filenames are `<model>_<destination folder>.<ext>`: with the box set to `C:\new\dir` a Seedance
render lands as `C:\new\dir\sd2_dir.mp4`, then `sd2_dir_2.mp4` - a previous render is never
overwritten. The folder half comes from where the file *actually* landed, so a rejected path is
named `sd2_outputs.mp4` rather than claiming a folder it never reached. The extension comes from
the result URL, or from the CDN's `Content-Type` when a signed URL carries no extension.

A fal job returning several images saves each one: `sd5e_dir.jpeg`, `sd5e_dir_2.jpeg`, and so on.
The card's button re-saves on demand and reads `Retry save` if the fetch failed - result URLs sit
on a CDN and do expire, which is why the save no longer waits for a click.

### Post-generation scripts

Saved output can be put through local scripts. **Videos** get up to three, in an order you
choose; **images** get one. The two lists never mix. Both come from `.env`, one line per script:

```
POSTVIDGEN_1="C:\Scripts\PostProcessing_Script.bat"
POSTVIDGEN_2="C:\Scripts\Deai.bat"

POSTIMGGEN_1="D:\Tools\upscale\img.bat"
```

Add `POSTVIDGEN_4`, `POSTIMGGEN_2`... to offer more; each list is presented in numeric order and
the slot number **is** the run order. A blank slot runs nothing, and three is the ceiling per
video however many are defined. Only the row that applies to the open tab is shown, and a hidden
row runs nothing. The drop-down label is the command's own filename, and the lists refresh from
`.env` on the next config poll - no restart.

Each command runs with **its own folder as the working directory**, so a relative venv activates,
and with `stdin` at DEVNULL so a trailing `pause` gets EOF rather than waiting on a keypress. The
saved video's path is appended as the last argument, or substituted for `{}` if the command names
a spot for it. Scripts run strictly in sequence and each is handed **what the previous one
produced** - the newest video that appeared beside its input, or the same file if it wrote none.
A failure stops the chain rather than feeding on a half-written file.

Which scripts run is the local page's decision: a request arriving over the tunnel runs none, the
same rule that governs the save folder.

### Running several jobs at once

Jobs are independent - the server is threaded, each tab polls on its own, and results save as
they land. Queue one model, switch tabs, queue another, and both finish. State is keyed by model
rather than by what is on screen, so that holds for models behind a publisher page's drop-down as
well as for whole tabs. The Save folder box and the script drop-downs are global and read at save
time, so every result of a session lands in the same folder under the same chain.

## Kling AI

Kling's own open platform, six image-to-video models behind one page.

**Host.** `https://api-singapore.klingai.com`. `api.klingai.com` answers too, but task ids are
regional: a job created on one host is invisible from the other. This key was issued in
Singapore.

**Auth.** `Authorization: Bearer KLINGAI_API_KEY`. Most write-ups describe a JWT signed from an
AccessKey/SecretKey pair with a ~30 minute expiry - that is the older scheme. The key this
account holds is a static `api-key-kling-...` string the platform accepts as a plain bearer
token: no signing, no key pair, nothing to refresh.

**One request shape, one poller.** Every model is POST `/<capability>/<model-id>` with typed
parts in `contents`, knobs in `settings`, id/watermark in `options`. (2.1 Master, the last model
on the legacy flat `/v1/videos/image2video` route, was dropped on 02/09/2026 ahead of Kling
delisting it.)

The reply is `{code, message, request_id, data:{...}}` and the task id is *nested* at `data.id`.
The top-level `request_id` names the HTTP call, not the job. Polling is
`GET /tasks?task_ids=<id>`, answering
`data: [{id, status, outputs: [{type, id, url, duration}], message, billing: [{amount}]}]` with
`status` in `submitted / processing / succeeded / failed`.

### Silent and unwatermarked, on every model

No Kling tab offers an audio or a watermark control. `klingShape` pins `settings.audio: "off"`
and `options.watermark_info.enabled: false` on every model.

Both platform defaults go the other way - a generated soundtrack on the models that have one, and
a watermarked copy - so **both have to be sent, not merely omitted**. `test_kling.js` asserts
that no tab has grown either control back and that neither value reaches the wire any other way.

2.6's Voices field went with them. Voices only ever speak over a native soundtrack, so with
audio pinned off the field could not do anything - it is gone from the form, from `klingShape`
and from the wire, and the tests keep it that way.

### The five tabs

| Tab | Endpoint | Notes |
|---|---|---|
| Kling 3.0 | `/image-to-video/kling-3.0` | first + optional last frame, up to 3 elements, multi-shot prompts, 720p/1080p/4k, 3-15s |
| Kling 3.0 (motion control) | `/motion-control/kling-3.0` | mode on the same tab - appearance image + motion video, 1 element, character orientation |
| Kling 3.0 Omni | `/omni-video/kling-3.0-omni` | adds reference images, a feature video and base-video editing; aspect ratio |
| Kling O1 | `/omni-video/kling-o1` | same input set, 720p/1080p, 3-10s, no multi-shot |
| Kling 2.6 | `/image-to-video/kling-2.6` | first + optional last frame, 720p/1080p, 5s/10s |
| Kling 2.6 (motion control) | `/motion-control/kling-2.6` | as 3.0's, without elements |
| Kling 2.5 Turbo | `/image-to-video/kling-2.5-turbo` | first + optional last frame, 720p/1080p, 5s/10s |

**House defaults.** 10s on every i2v tab (12s on 3.0), 720p, and 3.0 opens single-shot. 2.6 and
2.5 Turbo only take a last frame at 1080p, so on both tabs the resolution select narrows to 1080p
the moment a last frame lands and reopens when it is cleared - the form never offers the 720p the
validator refuses. fal's Kling endpoints have no resolution field, so their tabs only say so.

Kling 3.0 Turbo (`/image-to-video/kling-3.0-turbo`) exists and is not wired up. Adding it is one
entry in `klingVideos` plus one line in `PUBLISHERS.pubKling.models`.

**Motion control as a mode.** It is a second endpoint on the same model rather than a model of
its own, so on the 3.0 and 2.6 tabs it is a `Mode` drop-down that swaps the path out from under
the form. `svc.kling` is therefore a function of form state, not a constant, and the output
abbreviation changes with it (`k30` / `k30mc`) so the two never overwrite each other on disk.

**Elements** are managed by their own CRUD API (`/v1/general/advanced-custom-elements`) and are
not wired into the console. The forms take the ids it returns, as JSON, in Kling's own shape:
`[{"element_id":"123","id":"Zhang"}]`. The `id` half is the name `@Zhang` in the prompt resolves
to. Custom voices (`/v1/general/custom-voices`) are not used at all now that audio is off.

**Reference numbering.** On the omni tabs the prompt addresses inputs as `@image_1`, `@video_1`.
Those names come from the `id` on each content part, which `klingShape` assigns in form order.

### Verified against the live API on 21/08/2026

Run with the account's own key, not read off the docs.

- **A real render.** `/image-to-video/kling-2.5-turbo`, 720p, 5s, one first frame: `succeeded`
  after ~50s, one `.mp4`, `billing.amount` 1.5 units. That is what fixed the response shape - the
  docs carry no response body for the task query.
- **Every route reachable.** All seven paths answer with a field-level validation error rather
  than a 404.
- **Unknown fields are ignored, not refused.** `{"zzz_nope": 1}` returns 200 on every model, so a
  box the API silently drops would read as set on the form while doing nothing: acceptance is not
  evidence of support.
- **Duration is an int in `settings`** and a select hands back a string, so `klingShape` casts it
  once rather than trusting five field specs to agree.

**Where the field lists came from.** `app.klingai.com/global/dev` is a Vue SPA that returns HTTP
446 to anything that is not a browser. Each doc page is a lazily-imported JS module listed in
`assets/api-module-loader-*.js`; importing one under node yields the reference as structured data.
That is the source for the tables, with the live validator as the tie-breaker.

## BytePlus ModelArk

The account sits in **ap-southeast-1**, and ModelArk is regional: `ark.ap-southeast.bytepluses.com`
is the only host that answers for it. The region is the host - not a path segment, header or body
field.

One platform, two flows, model id in the body rather than the path:

```
video   POST /api/v3/contents/generations/tasks   -> {"id": "cgt-..."}
        GET  /api/v3/contents/generations/tasks/{id}
             -> {"status": "queued|running|succeeded|failed|cancelled|expired",
                 "content": {"video_url": "...", "last_frame_url": "..."}}
image   POST /api/v3/images/generations           -> {"data": [{"url": "..."}]}   (synchronous)
```

Video bodies carry scalars at the top level (`resolution`, `ratio`, `duration`, `seed`,
`generate_audio`, `watermark`, `return_last_frame`) and media in a `content` array of typed parts,
each tagged with the job it does:

```json
{"model": "dreamina-seedance-2-0-260128",
 "content": [{"type": "text", "text": "..."},
             {"type": "image_url", "image_url": {"url": "..."}, "role": "first_frame"},
             {"type": "image_url", "image_url": {"url": "..."}, "role": "reference_image"},
             {"type": "video_url", "video_url": {"url": "..."}}],
 "resolution": "720p", "ratio": "16:9", "duration": 8, "generate_audio": true}
```

`arkShape()` does that conversion from the flat form fields; `test_byteplus.js` pins the output.

Verified on 20/08/2026 by sending deliberately invalid requests - nothing generated, nothing
billed. ModelArk resolves the model first and validates fields in a fixed order, so an
out-of-range `duration` guarantees the request dies before generation while the error message
reports on everything else.

- All model ids resolve; a made-up one answers `404 InvalidEndpointOrModel.NotFound`.
- **Unknown body fields are ignored, not rejected** - a typo fails silently and the model uses its
  default. Every field the tabs send was confirmed recognised.
- **The task type is inferred from the content roles**: text alone is `t2v`, a `first_frame` is
  `i2v`, first + last is `flf2v`, a `reference_image` is `r2v`. Seedance **1.5-pro rejects `r2v`
  outright**, which is why that tab offers first and last frame and no reference lists at all.
- Roles are how the platform tells a reference from a frame: `first_frame`, `last_frame`,
  `reference_image`, `reference_video`, `reference_audio`. An unknown role is a hard 400.
- A `last_frame` alone is refused; `reference_audio` cannot be the only reference on the 2.0
  series (2.5 does support audio-only).
- **Seedance 1.5-pro is an A/B pair** across ModelArk and fal, same model both sides, shared
  defaults pinned to the same values (9:16, 720p, 5s, audio off, camera fixed) so the platform is
  the only variable. fal's own defaults are 16:9, audio on, camera free; the tab overrides all
  three. fal's endpoint is image-to-video only, so give both tabs a first frame - ModelArk will
  silently run text-to-video from the same prompt otherwise.
- `camera_fixed` is offered on the 1.5-pro tab **only** - their reference lists three supported
  models and none of the 2.x tabs are among them. `true` appends a fixed-camera instruction to the
  prompt rather than constraining the model, so the result is not guaranteed.
- Seedream's pixel ceiling is **4,624,220**, quoted by the validator. `watermark` has no control
  on the Dola form; it is pinned `false` in `shape()`, because the platform default is on.

Notes that cost time if you meet them cold:

- **Every reference needs an explicit job in the prompt** (`[Image 1] is the woman...`), and shots
  split with time codes (`[0-4s]: ... [4-8s]: ...`). An unaddressed reference is silently ignored,
  and negative phrasing does not work - say what should be there.
- **Reference videos must be URLs.** The API will not take an inline upload, so the tunnel must be
  up for them.
- **Seedream 5.0 Pro takes about two minutes per image** and answers on the same request, which is
  why the proxy's outbound timeout is 240s. It supports neither `stream` nor
  `sequential_image_generation` - either is a 400 - so neither is offered.
- **Seedance 2.5 needs a prepaid resource pack**, not just balance. Without one the call returns
  `ModelNotOpen` rather than a validation error.
- ModelArk blocks real human portraits as references. Expect face-heavy sources to be rejected at
  submit.
- Model ids carry a release date and are what the API keys on, so each tab shows its id in the
  form heading. If BytePlus rotates one, `arkVideos` / `sd5pro` is the single place to change it.

## QwenCloud

[qwencloud.com](https://www.qwencloud.com) is the international storefront for Alibaba's Model
Studio. Its `sk-ws-...` keys answer on the DashScope-native routes of
`https://dashscope-intl.aliyuncs.com/api/v1` - the workspace-scoped
`{id}.<region>.maas.aliyuncs.com` hosts in Alibaba's own docs belong to keys cut in the Model
Studio console, not to a QwenCloud one.

**Auth.** `Authorization: Bearer QWENCLOUD_API_KEY`. Two pages, one per output kind, so each
sits in the nav group whose post-gen script row it needs:

| Page | Model | Flow |
|---|---|---|
| QwenCloud Qwen-Image (Image Editors) | `qwen-image-3.0-pro` | POST `/services/aigc/multimodal-generation/generation`, synchronous - the image URLs come back in the same response under `output.choices[].message.content[].image` |
| QwenCloud Wan-Video (Video Generators) | `wan3.0-video`, `wan3.0-video-prime` | POST `/services/aigc/video-generation/video-synthesis` with `X-DashScope-Async: enable` -> `output.task_id`, then GET `/tasks/{id}` until `task_status` is terminal; `output.video_url` |

Both post the same envelope: `model` at the top, inputs under `input`, every knob under
`parameters`. `qwenShape` in the page does the split; `test_qwen.js` checks it.

**Qwen-Image-3.0-Pro.** The prompt goes as `input.messages[0].content[0].text` (up to 4,500
tokens) and reference images as `{image: url}` parts after it, addressed as `Image 1`, `Image 2`,
`Image 3` in the prompt - any image switches the model from text-to-image into edit. `size` is free-form `width*height` between 512x512 and 2048x2048 of
area, billed in two tiers (1k / 2k), so the chips offer one size per tier per shape. `agent`
rewrite mode is text-to-image only and the API 400s rather than ignoring it with an image in
play, so the page drops it back to `direct` in that case. `enable_thinking` requires
`prompt_extend`, so it and the rewrite mode fold away when the rewrite is switched off and
neither reaches the body. `negative_prompt` is in their API
reference but their model guide lists Qwen-Image as ignoring it - the box stays, as a request.

**Wan3.0-Video.** Either a prompt or at least one media input. Media is a typed list -
`first_frame`, `last_frame`, `reference_image` (10), `reference_video` (5), `reference_audio`
(5), `file` (1), `link` (1). Their two hard rules are that the frame types and the reference
types cannot share a request, and that a document and a link cannot either. The form enforces
the first with a mode select - text-to-video, frame-to-video, reference-to-video - that gates
which inputs are offered, the way Kling's image-to-video / motion-control switch does; for the
second the document wins and the link is dropped. Editing or extending a clip is
reference-to-video with the clip as `Video 1` and the intent ("edit", "replace", "extend",
"continue") in the prompt. The prompt addresses references as `Image 1`, `Video 1`, `Audio 1`,
each type numbered on its own in the order the media list carries them, which is the order the
form shows them.

Their guide's recommendations are the form's defaults: `ratio` is `adaptive` whenever there is
an input to adapt to and a fixed ratio for text alone (adaptive is not offered there);
`duration` is 2-30, or -1 for smart duration, which their guide recommends for edits and
extensions because those keep the clip's own length; a value already typed survives a mode
switch, so the -1 is the hint's advice rather than something the form imposes. With a reference video, input plus output must
stay under 30s. No mode needs a minimum resolution and last frame does not force anything -
unlike Kling 2.5 / 2.6, where first-plus-last frame runs at 1080p only. `audio` defaults on at
no extra cost, `watermark` off. `wan3.0-video-prime` is the same model on the same route with
the same inputs, faster and at twice the per-second price; the drop-down is where the two are
told apart and the form is shared. Result URLs expire after 24 hours - the page saves on sight.

Fields, enums and limits were read off QwenCloud's own API reference on 02/09/2026 and
cross-checked against the Alibaba Model Studio page for each model. Neither has been run
against the live validator yet - the first real job is the check.

## fal.ai

Field lists were taken from fal's own OpenAPI document rather than the model page, so they are the
complete input schema and not a subset:

```
https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint id>
```

**Transport.** fal is a queue. Submit is a POST to `https://queue.fal.run/<endpoint id>`; the
reply carries `request_id`, `status_url` and `response_url`. The console polls `status_url` every
4s and fetches `response_url` once status is `COMPLETED`. It uses the URLs fal hands back rather
than building them - for a nested endpoint id like `bytedance/seedream/v5/pro/edit` the request
path is *not* the endpoint id, so constructing it by hand gets a 404.

**Seedream 5 Pro Edit** - `image_urls` (required, up to 10; past 10 only the last 10 count),
`prompt` (required), `image_size`, `num_images` (1-6), `output_format`, `enable_safety_checker`.
`image_size` is a union: an enum arm or an object `{width, height}`. The form drops the enum arm
and offers the same 12 chips as the Dola tab so the two can be run against each other on one size.
There is **no `seed`** on this endpoint - genuinely absent from the schema, re-confirmed against
fal's live OpenAPI on 20/08/2026 - and unknown fields are dropped rather than rejected, so
inventing one would read as a matched seed in an A/B that was never matched.

**Bria Expand** - `image_url` and `canvas_size` required, plus `original_image_size`,
`original_image_location`, `aspect_ratio`, `prompt`, `negative_prompt`, `seed`. Bria takes three
`[x, y]` pairs; the form asks for the six numbers separately and packs them at send time. A pair
is only sent when both halves are filled, because half a pair serialises as `[1200, null]` and
draws a shape error instead of the plain "field required" you want. Keep the subject above 15% of
canvas area. `aspect_ratio`, when set, overrides the placement fields.

The placement fields fill themselves as the source lands. Its long side is measured against the
canvas side of the same orientation: over 3/4 of it and the canvas becomes 4k in the source's
orientation (2160x3840 portrait, 3840x2160 landscape), otherwise the canvas stays as set. Either
way the source is scaled so its long side is half the matching canvas side - about a quarter of
the area - and centred. Square counts as portrait. The fields stay editable afterwards.

**Kling 2.5 Turbo i2v** - `image_url` and `prompt` required, plus `tail_image_url`, `duration`
(`"5"`/`"10"`, string), `negative_prompt`, `cfg_scale` (0-1). Nothing else is in the schema: no
resolution, aspect ratio, audio, voices or seed. **Kling 2.6 Pro i2v** adds `generate_audio` and
`voice_ids` and has no `cfg_scale`. Both tabs default to 10s and silent.

`sync_mode` is deliberately not exposed: it returns the image as a data URI and keeps the job out
of request history, which breaks save-to-disk.

Blank number fields stay blank all the way to the wire. `Number("")` is `0`, and on Bria's seed
and placement pairs `0` is a real value that means something else, so an empty box is dropped from
the payload rather than sent as zero. `test_fal_fields.js` pins that.

## Self-checks

All offline unless noted:

```
python test_server.py          python test_save_naming.py     python test_postprocess.py
node   test_kling.js           node   test_byteplus.js        node   test_fal_fields.js
node   test_video_fields.js    node   test_prompt_store.js    node   test_qwen.js
python test_skin_matrix.py     # live, needs the Enhancor key, costs nothing:
                               # every payload targets an unresolvable image host
```
