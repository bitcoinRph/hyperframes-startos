---
name: hyperframes-server
description: >
  Make, check and render HyperFrames videos on a HyperFrames StartOS server from any agent
  (Hermes Agent, OpenClaw, Claude Code, Codex, Claude.ai) over its agent API or MCP endpoint.
  Read first whenever the render target is "my server", a StartOS box, or a HyperFrames MCP
  connection you were given an API key for. Maps every `npx hyperframes <command>` in the
  upstream skills to the server's tools, and carries the remote production loop: project,
  compose, lint, check, snapshot, review in Studio, render, deliver.
---

# HyperFrames on a StartOS server

You are not on the machine that renders. The HyperFrames CLI, headless Chrome and FFmpeg run
inside a StartOS service; you reach them through its **agent API** (REST, `/api/v1`) or its
**MCP endpoint** (`/mcp`, streamable HTTP). Both need `Authorization: Bearer <api key>`. The
key comes from the service's **Set API Key** action in StartOS; the owner gives it to you.

Everything the upstream HyperFrames skills teach about *what* to write still holds. Only *how
you run commands* changes. Read `/hyperframes` and its `references/format.md` before writing
composition HTML; its contract, work loop and type-specific references replace the former
standalone core/animation/creative workflow skills in 0.8.185. This skill
covers the server side.

## 1. Orientation calls (do these once per session)

| Need                                        | MCP tool          | REST                                         |
| ------------------------------------------- | ----------------- | -------------------------------------------- |
| Versions, URLs, limits, where the docs live | `server_info`     | `GET /api/v1/server`                         |
| Chrome, FFmpeg, memory, optional tools      | `doctor`          | `GET /api/v1/doctor`                         |
| What skills the server serves               | `list_skills`     | `GET /api/v1/skills`                         |
| Read a skill or one of its references       | `read_skill`      | `GET /skills/<skill>/<path>`                 |
| Which project Studio shows, and its URL     | `studio_status`   | `GET /api/v1/studio`                         |

`doctor` tells you whether whisper (transcription) and Kokoro (local TTS) exist on this
server. They are not installed by default: narration needs a provider key (HeyGen or
ElevenLabs, configured by the owner in **Configure Provider Keys**) or an audio file you upload.

### HeyGen media-use on the server

Official `heygen` v0.10.0 is bundled on PATH. Use `run_cli` with `{"project":"demo","args":["media-use","resolve","--doctor","--json"]}` (or `POST /api/v1/cli` with that body). Read the separate PATH/version/authentication rows; overall `ok` alone is not proof of authentication. HyperFrames inherits the owner's configured `HEYGEN_API_KEY` and invokes the binary itself; no direct HeyGen tool or arbitrary-shell endpoint exists.

Missing authorization must be reported as **blocked**, not successful provider setup. The owner can configure a server-side key with **Configure Provider Keys**; an agent-host OAuth login does not authorize the server. Ask for explicit generation approval and a credit budget first: API keys bill API credits, and OAuth allowances are metered. Do not call auth, feedback, update or delete commands, or pass secrets in arguments. Keep media/output paths project-relative. CLI forwarding is for trusted agents, not a filesystem/network sandbox. Local Kokoro/whisper/Parakeet/Beat This! runtimes and weights remain opt-in, not bundled.

## 2. The project model

- Every video is a **project**: a directory under the projects root with an `index.html`
  composition, `hyperframes.json`, optional `compositions/`, `assets/`, `renders/` and
  `snapshots/`. Names are 1-64 characters: lowercase letters, digits, `_`, `-`.
- Create one with `create_project` (`POST /api/v1/projects`). It runs `hyperframes init
  --non-interactive`: a centered blank composition with GSAP wired in, the project
  `AGENTS.md`/`CLAUDE.md`, and `hyperframes.json`. Pass `resolution` for `portrait`, `square`,
  `landscape-4k`, `portrait-4k`, `square-4k`.
- Read and write files with `read_file`, `write_file`, `list_files`, `delete_file`
  (`/api/v1/projects/<p>/files/<path>`). Text goes as UTF-8; media goes as `encoding:
  "base64"`, a multipart `POST /api/v1/projects/<p>/upload`, or `fetch_asset` when the file is
  already on the web.
- Start from a finished project instead of a blank one with `import_project`
  (`POST /api/v1/projects/import`): a directory of a public GitHub repository, LFS media
  included. `/hyperframes-launch-references` lists HeyGen's launch films and the four
  re-brandable templates this was built for.
- Projects are deleted with `delete_project` (`confirm: true`). Renders live inside the
  project under `renders/`, so deleting a project deletes its videos.

## 3. Command map: upstream skill → this server

The upstream skills say `npx hyperframes <command>`. Translate like this. `run_cli` passes
arguments verbatim, no shell; add `--json` where the command supports it.

| Upstream command                                   | Here                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `hyperframes init <name>`                          | `create_project`                                                                       |
| `hyperframes lint`                                 | `lint` (`POST /projects/<p>/lint`)                                                     |
| `hyperframes check [--snapshots] [--at ...]`       | `check` (`POST /projects/<p>/check`)                                                   |
| `hyperframes snapshot --at ...`                    | `snapshot` (returns PNGs inline over MCP; files land in `snapshots/`)                  |
| `hyperframes timeline --json`                      | `timeline` (`GET /projects/<p>/timeline`)                                              |
| `hyperframes info --json`                          | `project_info` (`GET /projects/<p>/info`)                                              |
| `hyperframes catalog --query "..."`                | `catalog_search` (`GET /api/v1/catalog?query=`); word search, English queries           |
| (read one item's `registry-item.json`)             | `catalog_item` (`GET /api/v1/catalog/<name>`): variables, defaults, files, canvas       |
| `hyperframes add <item> [--vars '{...}']`          | `catalog_add` with `vars` (`POST /projects/<p>/catalog/add`)                            |
| `hyperframes catalog --on-device`                  | Owner opt-in only via `run_cli`: upstream supports `--yes` for non-interactive runtime/model downloads. This is a network/install operation, not the default word search. |
| `git clone` a launch film or template              | `import_project` (`POST /api/v1/projects/import`); see `/hyperframes-launch-references` |
| `node <skill>/scripts/*.mjs`, `python3 scripts/*.py` (community skills) | Not on the server. Run them where you run; bring the result here with `import_project`, `upload` or `write_file`. See `skills/README.md`, Community skills. |
| `hyperframes render ...`                           | `render_video` → job id → `get_render_status` (`POST /projects/<p>/renders`)           |
| `hyperframes preview`                              | `studio_open` + `studio_status`; give the user the project URL                         |
| `hyperframes inspect`, `layout`, `validate`, `keyframes`, `audio`, `beats`, `compositions`, `history`, `media-treatment`, `normalize-audio`, `compare`, `grade-compare` | `run_cli` with the same arguments (`audio` measures locally; no hosted provider here) |
| `hyperframes tts`, `transcribe`, `remove-background`, `media-use resolve`, `capture <url>` | `run_cli`; needs the optional tools or provider keys, check `doctor` first |
| Narration, word-timed transcripts, voice cloning or design, dubbing (VoiceStudio, if installed) | `voicestudio_status` first, then `voicestudio_speak`, `voicestudio_transcribe`, `voicestudio_clone_voice`, `voicestudio_design_voice`, `voicestudio_dub` + `voicestudio_dub_status` (REST under `/api/v1/voicestudio/` and `/api/v1/projects/<p>/voicestudio/`); read `/hyperframes-voicestudio` |
| `hyperframes publish`, `cloud`, `lambda`, `cloudrun`, `auth`, `feedback`, `telemetry` | Not available on the server, by design. Download the render instead. |
| `hyperframes render --docker`                      | Not available (the service is already the container). Omit `--docker`.                |
| `hyperframes skills update ...`                    | Not needed: the server serves the skills that match its CLI version. Use `read_skill`. |
| `hyperframes catch-up`                             | Not available: it syncs with the desktop app, which this server does not run.          |

Run the CLI from the project: `run_cli` with `project` set runs in that directory, so
relative paths in arguments resolve against the project.

### Scoped diagnostics and review sets (CLI 0.8.185)

- `check` accepts `range: [start, end]` (runtime sampling only; static lint stays
  project-wide), `components` (CSS selector list; filters findings but preserves the
  full-check status), `maxTransitionSamples` (1-10000), `maxIssues` (1-1000), and
  `collapseStatic: false`. Craft findings are returned in the upstream JSON report.
- `snapshot` accepts `review: true`: scene/beat stills, five-frame cut strips and
  phone-width sheets. It can be scoped with `composition` (**data-composition-id**,
  not a file path). Review chooses its own times: do not combine it with `at`,
  `range`, or `zoom`; `frames` is ignored upstream.
- Non-review snapshots accept `range: [start, end]` or `composition` instead of `at`;
  these three selectors are mutually exclusive.
- Snapshot results retain `outputDir`, `files`, and `stdout`, and add `json` with
  upstream frame times, contact-sheet paths and the optional review plan. Use the
  project-relative `files` paths for downloads; upstream JSON may contain paths
  inside the container. Dedicated REST/MCP snapshots **always** use
  `--describe false`: no implicit Gemini upload even if the owner has a key.
  A provider-assisted description is a separate, explicit `run_cli` operation.
- `run_cli` exposes the local `inspect` layout/motion diagnostic and its `layout`
  compatibility alias, plus legacy `validate` runtime/contrast checks. Prefer
  `check` for the combined gate. Headless composition checks can still load the
  external URLs authored in the HTML; “local” means no hosted rendering/provider
  API is selected, not an offline network sandbox.
- `timeline set` supports upstream assignment syntax and volume/rate/track edits
  through `run_cli`; use `--plan --json` to inspect a mutation before applying it.
  `media-treatment` now supports canvas sources as well as image/video sources.
- Browser install/cache management (`browser`), repeat benchmark renders
  (`benchmark`), telemetry (`events`, `usage`), desktop playback and hosted/cloud
  commands remain outside the allowlist. No arbitrary shell or JavaScript tool
  is exposed. `upgrade --check` / `--project` remain the only upgrade modes;
  `--check` may query the package registry and never replaces the pinned CLI.

## 4. Production loop on the server

Follow `/hyperframes` and its relevant `references/types/` and production references; run the
steps with the tools above. The server-specific shape:

1. **Brief and plan** exactly as the upstream workflow says. Write `BRIEF.md`, `STORYBOARD.md`,
   `frame.md` into the project with `write_file`; they are plain files.
2. **Scaffold**: `create_project`, or `import_project` when a launch template fits the brief.
   For every named look, run `catalog_search`, read `catalog_item` for its variables, then
   `catalog_add` with `vars` holding the brand copy and colors. Do this **before** any
   parallel work.
3. **Media**: upload or `fetch_asset` the user's footage, images and music into `assets/`.
   Generate voice with the `voicestudio_*` tools when `voicestudio_status` says VoiceStudio is
   ready (`/hyperframes-voicestudio`), else with `run_cli ["tts", ...]` only if `doctor` shows Kokoro, or a provider key
   is configured; otherwise ask the user for narration audio or skip narration.
4. **Compose**: `write_file` for `index.html` and each `compositions/*.html`. Keep the
   `/hyperframes` contract and `references/format.md`: root `data-composition-id`,
   `data-width`, `data-height`, explicit root `data-duration`, timed `.clip` elements
   with `data-start` and `data-duration`, and a paused timeline registered on
   `window.__timelines[id]`. Media `src` paths are
   project-relative. Scripts loaded from a CDN need outbound internet on the server; prefer
   the pinned `https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js` the template uses.
5. **Lint early**: `lint` after the first pass and after structural edits. Fix every error.
6. **The gate**: `check` (add `snapshots: true` to get the audited frames). `browserSkipped:
   true` means lint failed first; read the findings, fix, repeat until `ok`.
7. **Look at it**: `snapshot` at scene midpoints. Over MCP the PNGs come back inline (up to
   three by default; raise `inlineImages` when you need more). Over REST, fetch them from
   `snapshots/<run>/` through the files route. Judge composition, type scale and overlap, not
   just "did it render".
8. **Review with the user**: `studio_open` for the project, then hand them the URL from
   `studio_status.projectUrls`. Studio asks for the username `studio` and the password the
   owner set with **Set Studio Password**. Studio is a full editor: they can move clips,
   edit text and export there too. Wait for approval before the delivery render, unless the
   brief is autonomous.
9. **Render**: `render_video` with `quality: "draft"` while iterating, `"looks"` (default)
   for the first real encode, `"delivery"` for the final file. Choose `format`: `mp4` to
   share, `webm` or `mov` for transparency, `gif` for docs (use `fps: 15`), `png-sequence`
   for compositing, `hls` for streaming. The call returns a **job** at once.
10. **Poll**: `get_render_status` every 10-30 seconds. Terminal states: `succeeded`,
    `failed`, `cancelled`, `interrupted` (the service restarted). On `failed`, read `error`
    and the log (`fullLog: true` or `GET /api/v1/renders/<id>?log=1`), fix, re-render.
11. **Deliver**: give the user the download link, `GET /api/v1/renders/<id>/download`
    (absolute URL = an Agent API address from `server_info` + that path; the bearer header
    is required), or the project file route. Report duration, size, format, and the Studio URL.
    For `png-sequence` and `hls`, list the output directory through `list_files`.

Render time: a 1080p30 composition renders at roughly real time to a few times real time on
a small server. Long pieces take minutes. Do not re-submit a job because it is slow; check
`logTail` for progress. The queue runs the number of jobs the owner set in **Configure
Rendering** (default 1).

## 5. Variables and batch work

Compositions can declare `data-composition-variables`; pass `variables` to `render_video` to
render one variant, and submit one job per row for a batch (set `outputName` per row so the
files do not collide). The server keeps job records across restarts; `list_renders` shows
them.

## 6. What to tell the user

- The Studio URL for review, and that Studio needs the `studio` username and the Studio
  password from StartOS.
- The download link for each delivered render and where the file sits in the project.
- Anything the server could not do: no local transcription, no publish, no cloud render.
  Those are owner decisions (install tools, add provider keys), not failures of the video.

## 7. Failure patterns

| Symptom                                                           | Cause and fix                                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `401 unauthorized`                                                | Wrong or missing bearer token. Ask the owner to run **Set API Key** and give you the key.                 |
| `503 no API key is configured`                                    | The owner has not run **Set API Key** yet.                                                                 |
| `sub_timeline_script_failure ... gsap.min.js`                     | The server could not fetch the CDN script. Ask the owner about outbound access, or inline the library in `assets/` and reference it relatively. |
| `check` reports `browserSkipped: true`                            | Lint errors; fix them first.                                                                                |
| Render `failed` with `Render blocked by 1 correctness warning`    | Media missing or unready at capture time; read the warning code and fix the composition.                   |
| Render `interrupted`                                              | The service restarted (a settings change or an update). Submit the job again.                              |
| `studio_status.reachable` is false right after `studio_open`      | Studio restarts in a few seconds; poll again.                                                               |
| TLS errors from your client                                       | The StartOS LAN address uses the server's own root CA. See `/hyperframes-startos-connect`.                 |
