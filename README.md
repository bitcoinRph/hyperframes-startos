<p align="center">
  <img src="icon.svg" alt="HyperFrames logo" width="18%">
</p>

# HyperFrames on StartOS

> **Upstream docs:** <https://hyperframes.heygen.com/introduction>
>
> Everything not listed in this document behaves the same as upstream HyperFrames at the version pinned in `startos/versions/current.ts`. If a feature, setting or behaviour is not mentioned here, the upstream documentation is accurate and fully applicable.

[HyperFrames](https://github.com/heygen-com/hyperframes) is HeyGen's open-source framework for turning HTML, CSS, media and seekable animations into deterministic video. Upstream, it is a CLI (`hyperframes`) plus a browser editor (Studio) that a person or a coding agent runs on their own machine. This package turns it into a **server**: Studio runs behind the StartOS proxy, and a purpose-built **agent API and MCP server** let AI agents (Hermes Agent, OpenClaw, Claude Code, Codex, any MCP client) create, check and render video on the StartOS box. The upstream **skills library** is served from the service so remote agents read the skills that match the installed CLI.

- **Upstream repo:** <https://github.com/heygen-com/hyperframes>
- **Package repo:** <https://github.com/bitcoinRph/hyperframes-startos>

---

## Table of Contents

- [Image and Container Runtime](#image-and-container-runtime)
- [Volume and Data Layout](#volume-and-data-layout)
- [File Models](#file-models)
- [Network Access and Interfaces](#network-access-and-interfaces)
- [Installation and First-Run Flow](#installation-and-first-run-flow)
- [Actions](#actions)
- [Tasks](#tasks)
- [Agent API](#agent-api)
- [MCP Server](#mcp-server)
- [Skills Library](#skills-library)
- [Health Checks](#health-checks)
- [Backups and Restore](#backups-and-restore)
- [Limitations and Differences](#limitations-and-differences)
- [Development](#development)
- [Quick Reference for AI Consumers](#quick-reference-for-ai-consumers)

---

## Image and Container Runtime

One image, built from the `Dockerfile` in this repository (`dockerBuild: {}`), modelled on upstream's `packages/cli/src/docker/Dockerfile.render`.

| Property      | Value                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Base          | `node:22-bookworm-slim`                                                                                 |
| Architectures | x86_64, aarch64                                                                                         |
| Runtime       | the published `hyperframes` npm package at `HYPERFRAMES_VERSION`, FFmpeg, Chromium shared libraries, Noto/Liberation/DejaVu fonts |
| Browser       | pinned `chrome-headless-shell` (chrome-for-testing on amd64, Playwright's build on arm64) at `/opt/chrome/chrome-headless-shell`, exported as `PRODUCER_HEADLESS_SHELL_PATH` for BeginFrame capture; Debian `chromium` as the fallback |
| Extra         | `/opt/hyperframes-startos/server` (the agent API and MCP server), `/opt/hyperframes/skills` and `/opt/hyperframes-startos/skills` (the skills library) |

| Subcontainer | Daemon   | Command     | Purpose                                                         |
| ------------ | -------- | ----------- | --------------------------------------------------------------- |
| `studio`     | `studio` | `hf-studio` | `hyperframes preview <project> --port 3002 --foreground --no-open` with `HYPERFRAMES_PREVIEW_HOST=0.0.0.0` |
| `server`     | `server` | `hf-server` | `node /opt/hyperframes-startos/server/dist/main.js` on port 3100 |

Both daemons are built through `sdk.Daemons.dynamic`, so a change that only affects Studio (the selected project) restarts only Studio. Provider keys and rendering settings are passed as environment variables and restart both.

`hf-studio` (from `assets/`) serves the project named in `startos/studio.json`. When that project is missing it falls back to the first project with an `index.html`; when there is none it scaffolds `welcome` with `hyperframes init --non-interactive`.

Environment set for both daemons: `HOME=/data/home`, `HYPERFRAMES_NO_TELEMETRY=1`, `HYPERFRAMES_NO_UPDATE_CHECK=1`, `HYPERFRAMES_SKIP_SKILLS=1`, `HYPERFRAMES_PROJECTS_DIR=/data/projects`, `CONTAINER=true`, plus the provider keys below when set and `PRODUCER_LOW_MEMORY_MODE` when forced.

## Volume and Data Layout

| Volume | Mount Point | Purpose                       |
| ------ | ----------- | ----------------------------- |
| `main` | `/data`     | Everything the service keeps  |

| Path                           | Contents                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `/data/projects/<name>/`       | One HyperFrames project per directory: `index.html`, `hyperframes.json`, `compositions/`, `assets/`, `renders/`, `snapshots/` |
| `/data/home/`                  | The CLI's home: `.hyperframes/` (config), `.cache/hyperframes/` (fonts, browsers, models), `.heygen/` |
| `/data/startos/studio.json`    | `{ "project": "<name>" }`, the project Studio serves                                        |
| `/data/startos/jobs/`          | Render job records (`<id>.json`) and logs (`<id>.log`)                                      |
| `/data/store.json`             | Package state (credentials, provider keys, rendering settings)                              |

## File Models

| File                         | Shape                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.json`                 | `apiKey?`, `studioPassword?`, `providers { heygenApiKey, elevenlabsApiKey, geminiApiKey, openrouterApiKey, figmaToken }`, `rendering { workers, lowMemoryMode, maxConcurrentRenders }` |
| `startos/studio.json`        | `project` (string). Written by the **Open Project in Studio** action and by the API server; `main.ts` reads it with `.const()`                    |

## Network Access and Interfaces

| Interface      | Id       | Port | Type | Auth enforced by StartOS proxy (`addSsl.auth`)                           |
| -------------- | -------- | ---- | ---- | ------------------------------------------------------------------------- |
| **Studio**     | `studio` | 3002 | ui   | HTTP basic, username `studio`, password from **Set Studio Password**       |
| **Agent API**  | `api`    | 3100 | api  | Bearer token from **Set API Key**                                          |
| **MCP Server** | `mcp`    | 3100 | api  | Same bearer token; path `/mcp`                                             |

Studio has no authentication of its own, so the proxy gate is what protects it. The API server validates the bearer token a second time and answers `503` until a key exists. StartOS decides where each interface is reachable (LAN, Tor, a domain); the package only declares what it serves.

## Installation and First-Run Flow

1. Install creates `store.json` and `startos/studio.json` with defaults (`init/seedStore.ts`). No credential is seeded.
2. `init/watchCredentials.ts` raises a **critical** task for **Set Studio Password** and an **important** task for **Set API Key** while they are unset.
3. On the first start `hf-studio` scaffolds `/data/projects/welcome` and serves it.
4. The user runs both actions, opens Studio, and hands the Agent API address and the key to their agents.

## Actions

| Action                       | Id                     | Input | Effect                                                                                                                                  |
| ---------------------------- | ---------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Set Studio Password          | `set-studio-password`  | none  | Generates a 24-character password, stores it, returns username + password. `setupInterfaces` re-runs and the proxy gate picks it up.    |
| Set API Key                  | `set-api-key`          | none  | Generates a 48-character key, stores it, returns it with the MCP path. Restarts the server daemon (the key is passed as `HF_API_KEY`).   |
| Open Project in Studio       | `open-studio-project`  | select | Lists directories under `projects/` with an `index.html`; writes `studio.json`; only Studio restarts.                                 |
| Configure Provider Keys      | `configure-providers`  | form  | Optional masked fields → `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `FIGMA_TOKEN`.               |
| Configure Rendering          | `configure-rendering`  | form  | `workers` (auto/1/2/4/8 → `--workers`), `lowMemoryMode` (auto/on/off → `PRODUCER_LOW_MEMORY_MODE`), `maxConcurrentRenders` (1-4).     |

## Tasks

| Task                 | Severity  | Raised when                      |
| -------------------- | --------- | -------------------------------- |
| Set Studio Password  | critical  | `studioPassword` is unset        |
| Set API Key          | important | `apiKey` is unset                |

## Agent API

Source: `server/`. Hono on `@hono/node-server`, Node 22. OpenAPI 3.1 at `GET /openapi.json`. Every route except `GET /health` requires `Authorization: Bearer <api key>`. Paths are project-relative and validated against lexical and symlink escapes (`server/src/util/paths.ts`). The CLI is spawned without a shell.

| Route                                               | Purpose                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /health`                                       | liveness, `apiKeyConfigured`                                             |
| `GET /api/v1/server`, `GET /api/v1/doctor`          | versions, URLs, limits; `hyperframes doctor --json` (cached 5 min)       |
| `GET/POST /api/v1/projects`, `GET/DELETE /api/v1/projects/:p` | list, create (`hyperframes init --non-interactive`), summary + tree, delete |
| `GET /api/v1/projects/:p/files[?path=]`             | recursive listing                                                        |
| `GET/PUT/DELETE /api/v1/projects/:p/files/<path>`   | download (`?json=1` for a JSON envelope), write (raw bytes or JSON `{content, encoding}`), delete |
| `POST /api/v1/projects/:p/upload`, `.../fetch`      | multipart upload; download a URL into the project                        |
| `POST /api/v1/projects/:p/lint`, `.../check`, `.../snapshot` | `lint --json`, `check --json`, `snapshot` into `snapshots/<run>/` |
| `GET /api/v1/projects/:p/timeline`, `.../info`      | `timeline --json`, `info --json`                                         |
| `GET /api/v1/catalog`, `POST /api/v1/projects/:p/catalog/add` | `catalog --json`, `add <name> --no-clipboard --json`           |
| `POST /api/v1/projects/:p/renders`                  | queue `hyperframes render` → job (202)                                   |
| `GET /api/v1/renders[/:id][?log=1]`, `DELETE /api/v1/renders/:id`, `GET /api/v1/renders/:id/download` | jobs, status, cancel, download |
| `GET/POST /api/v1/studio`                           | which project Studio serves; switch it                                   |
| `POST /api/v1/cli`                                  | run an allowlisted subcommand (`server/src/util/cli.ts`)                 |
| `GET /api/v1/skills`, `GET /skills/<skill>/<path>`  | skills catalog; raw skill files                                          |

Render jobs run through a queue sized by `maxConcurrentRenders`. Records persist under `/data/startos/jobs/`; jobs active during a restart are marked `interrupted`. Output lands in the project's `renders/`; `png-sequence` and `hls` produce directories.

`run_cli` / `POST /api/v1/cli` allow: `add beats capture catalog check clean compare compositions docs doctor figma grade-compare history info keyframes lint media-treatment media-use models normalize-audio remove-background render snapshot timeline transcribe tts upgrade`. Refused: `publish cloud lambda cloudrun auth feedback telemetry events preview play present open browser init skills`, `--docker`, `--file-issue`.

## MCP Server

`POST <api>/mcp`, Streamable HTTP, stateless (`sessionIdGenerator: undefined`, JSON responses enabled), built with `@modelcontextprotocol/sdk`. Tools: `server_info doctor list_projects create_project get_project delete_project list_files read_file write_file delete_file fetch_asset lint check snapshot timeline project_info catalog_search catalog_add render_video get_render_status list_renders cancel_render studio_status studio_open run_cli list_skills read_skill list_skill_files`. `snapshot` returns PNGs as image content. Resources: `hyperframes://skills/{skill}/{path}` and `hyperframes://server/info`. Tool names shared with HeyGen's hosted connector (`list_projects`, `get_project`, `render_video`, `get_render_status`) keep the same meaning.

## Skills Library

`skills/` holds the StartOS-specific skills; the upstream skills come from the `hyperframes/` submodule. Both are copied into the image and served at `/skills/` and as MCP resources. See `skills/README.md`.

## Health Checks

| Daemon   | Display            | Check                      | Grace |
| -------- | ------------------ | -------------------------- | ----- |
| `studio` | Studio             | port 3002 listening        | 60 s  |
| `server` | Agent API and MCP  | port 3100 listening        | 10 s  |

## Backups and Restore

`sdk.Backups.ofVolumes('main')` with `home/.cache`, `home/.npm` and `tmp` excluded. Projects, renders, job records, credentials and settings are all in the backup. Restore needs nothing extra; caches rebuild on first use (fonts are fetched again, the on-device catalog index re-downloads if it was enabled).

## Limitations and Differences

1. **Studio shows one project at a time.** Upstream runs one `preview` per project directory; here the project is selected by an action or by the API. Switching restarts Studio (a few seconds).
2. **Studio is gated by the StartOS proxy, not by HyperFrames.** Upstream Studio binds to loopback with no auth. Here it listens on all interfaces inside the container and StartOS enforces basic auth.
3. **No whisper, no Kokoro, no MusicGen.** `transcribe`, local `tts` and local music fall back are unavailable unless a future image adds them; `doctor` reports this. Hosted voices work with provider keys.
4. **No hosted features.** `publish`, `cloud`, `lambda`, `cloudrun`, `auth login`, the desktop-app hand-off and telemetry are disabled or refused.
5. **`render --docker` is unavailable**; the service already is the container, with the pinned headless shell that `--docker` would provide.
6. **Outbound network** is needed for CDN scripts in compositions (the template loads GSAP from jsDelivr), Google Fonts, the registry (`catalog`, `add`, `init --example`) and provider APIs.
7. **Low-memory detection reads host RAM**, as upstream documents for containers; force it in **Configure Rendering** on small servers.
8. **The upstream project `AGENTS.md`/`CLAUDE.md`** written by `init` tell a local agent to run `npx hyperframes`; on this server those commands map to the API (`skills/hyperframes-server`).

## Development

```sh
npm install && npm run check                       # StartOS SDK code
node node_modules/@start9labs/start-sdk/lint.mjs && npx prettier --check startos
cd server && npm ci && npm run check && npm test   # agent API and MCP server
make x86                                           # .s9pk, inside a packaging workspace with Docker
```

Local end-to-end test of the server without StartOS: install `hyperframes` in a scratch directory, then run `server/dist/main.js` with `HF_CLI=<path to hyperframes>`, `HYPERFRAMES_PROJECTS_DIR`, `HF_STATE_DIR`, `HF_API_KEY`, `HF_SKILLS_DIRS` and `PUPPETEER_EXECUTABLE_PATH=<a Chromium>`. The sequence create project → write `index.html` → lint → check → snapshot → render → download reproduces what an agent does.

## Releases

Every push to `main` runs `.github/workflows/tagAndRelease.yml`. It reads the version from `startos/versions/current.ts`; when no `v<upstream>_<downstream>` tag exists yet it pushes the tag, creates the GitHub release, and one job per architecture (x86_64 on `ubuntu-latest`, aarch64 on `ubuntu-24.04-arm`) builds the `.s9pk` and attaches it with a `SHA256SUMS-*.txt` file. A merge that does not change the version releases nothing. Pushing a `v*` tag by hand runs `.github/workflows/release.yml` for the same result.

Packages are about 650 MB each, so the release jobs upload straight from the build runner and never use Actions artifacts; Start9's reusable release workflow does, and a full artifact storage quota breaks it. The PR workflow `.github/workflows/build.yml` (skipped while the PR is a draft) builds both architectures and uploads artifacts only best effort.

Signing needs no setup. When a **`DEV_KEY`** repository secret exists (the developer key PEM that `start-cli init-key` writes to `~/.startos/id.key.pem`), every release is signed with it and carries one stable identity. Without the secret, each release job generates a key for that run and prints a warning. Add the secret if you want all releases signed by the same key.

## Quick Reference for AI Consumers

```yaml
service: hyperframes
upstream: https://github.com/heygen-com/hyperframes
image: built from Dockerfile (node:22-bookworm-slim + ffmpeg + chrome-headless-shell + hyperframes npm)
arch: [x86_64, aarch64]
volume: main -> /data
daemons:
  studio: { cmd: hf-studio, port: 3002, health: port-listening }
  server: { cmd: hf-server, port: 3100, health: port-listening }
interfaces:
  studio: { port: 3002, type: ui, auth: basic (user studio) }
  api: { port: 3100, type: api, auth: bearer }
  mcp: { port: 3100, type: api, path: /mcp, auth: bearer, transport: streamable-http }
actions: [set-studio-password, set-api-key, open-studio-project, configure-providers, configure-rendering]
tasks: { set-studio-password: critical, set-api-key: important }
state: { store: /data/store.json, studio: /data/startos/studio.json, jobs: /data/startos/jobs/ }
projects: /data/projects/<name>  (index.html, hyperframes.json, renders/, snapshots/)
skills: served at /skills/ and hyperframes://skills/{skill}/{path}
backup: volume main minus home/.cache, home/.npm, tmp
not_available: [publish, cloud, lambda, cloudrun, auth, telemetry, render --docker, whisper, kokoro]
```
