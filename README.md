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
| Studio patch  | `assets/patch-studio.mjs` links `studio-mobile.css`/`.js` from the installed Studio bundle (see Studio on a Phone)                 |
| Browser       | pinned `chrome-headless-shell` (chrome-for-testing on amd64, Playwright's build on arm64) at `/opt/chrome/chrome-headless-shell`, exported as `PRODUCER_HEADLESS_SHELL_PATH` for BeginFrame capture; Debian `chromium` as the fallback |
| Extra         | `/opt/hyperframes-startos/server` (the agent API and MCP server), `/opt/hyperframes/skills` and `/opt/hyperframes-startos/skills` (the skills library) |

| Subcontainer | Daemon   | Command     | Purpose                                                         |
| ------------ | -------- | ----------- | --------------------------------------------------------------- |
| `studio`     | `studio` | `hf-studio` | `hyperframes preview <project> --port 3002 --foreground --no-open` with `HYPERFRAMES_PREVIEW_HOST=0.0.0.0` |
| `server`     | `server` | `hf-server` | `node /opt/hyperframes-startos/server/dist/main.js` on port 3100 |

Both daemons are built through `sdk.Daemons.dynamic`, so a change that only affects Studio (the selected project) restarts only Studio. Provider keys and rendering settings are passed as environment variables and restart both.

`hf-studio` (from `assets/`) serves the project named in `startos/studio.json`. When that project is missing it falls back to the first project with an `index.html`; when there is none it scaffolds `welcome` with `hyperframes init --non-interactive`.

Environment set for both daemons: `HOME=/data/home`, `HYPERFRAMES_NO_TELEMETRY=1`, `HYPERFRAMES_NO_UPDATE_CHECK=1`, `HYPERFRAMES_SKIP_SKILLS=1`, `HYPERFRAMES_PROJECTS_DIR=/data/projects`, `CONTAINER=true`, plus the provider keys below when set and `PRODUCER_LOW_MEMORY_MODE` when forced.

### HeyGen executable and optional provider dependencies

The image includes the official **HeyGen CLI v0.10.0** at `/usr/local/bin/heygen`, not a similarly named npm/Python package. `assets/install-heygen.sh` installs the static Linux amd64/arm64 release archives with separately pinned SHA-256 hashes before extraction. Provenance: [official docs](https://developers.heygen.com/cli), [source/release](https://github.com/heygen-com/heygen-cli/releases/tag/v0.10.0), and the matching `checksums.txt` on the official CDN. Apache-2.0 LICENSE, README and NOTICE are retained under `/usr/local/share/licenses/heygen/`. Analytics and update checks are disabled; update only through a reviewed image rebuild.

Agents reach it **through HyperFrames**, not arbitrary HeyGen commands: MCP `run_cli` or `POST /api/v1/cli` with `{"project":"demo","args":["media-use","resolve","--doctor","--json"]}`. The CLI inherits PATH and the configured `HEYGEN_API_KEY`; its official media-use subprocesses discover `heygen` there. Inspect individual `heygen on PATH`, version and authentication rows: doctor's top-level `ok` does **not** certify provider authentication. Doctor may query the stable-version CDN, and with credentials its auth probe contacts HeyGen.

**Executable available does not mean account authorized.** No credential is bundled or created. The owner may use **Configure Provider Keys** for server-side HeyGen API access (uses API credits); OAuth login is a separate attended flow on the agent host, not an API tool here. A remote agent's local OAuth session is not forwarded to this container. Do not invoke generation without explicit owner approval and a credit/budget decision; subscription free allowance is metered, not guaranteed free. Missing credentials block catalog/voice/avatar provider workflows, not local HTML rendering. Standalone HeyGen skills still execute on the agent host.

Optional local dependencies are **not** silently installed/downloaded: Kokoro requires Python 3.10+, `kokoro-onnx`, `soundfile` and model/voice files; whisper.cpp needs git, CMake, a C/C++ compiler and weights; Parakeet uses an opt-in runtime/model download (~640 MB upstream); Beat This! needs a configured Python with `beat_this` plus a checkpoint (`HYPERFRAMES_BEAT_THIS_PYTHON` / `HYPERFRAMES_BEAT_THIS_CHECKPOINT`). Cutout models and semantic catalog search also download on demand. Apple-Silicon `mflux`/`parakeet-mlx` and local LTX are creator-host alternatives, not Linux image dependencies. See the shipped `media-use/references/setup-providers.md`, upstream `whisper/manager.ts`, `audio/providers.ts` and `audio/analysis/providers/localProviders.ts`. None of these optional model workflows is certified by shipping its skill files.

The bearer-token API is for trusted agents. Project selection and file APIs reject traversal/symlink escapes, and subprocesses use no shell; generic CLI arguments are not a filesystem or network sandbox. Keep media/output paths project-relative, never pass secrets as arguments, and do not expose the API to untrusted agents. No direct HeyGen auth/update/delete/feedback endpoint is added.

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
| `GET /api/v1/catalog`, `GET /api/v1/catalog/:name`, `POST /api/v1/projects/:p/catalog/add` | `catalog --json`; one item's `registry-item.json` from the registry (variables, files); `add <name> --no-clipboard --json [--vars json] [--force]` |
| `POST /api/v1/projects/import`                      | Copy a directory of a public GitHub repository into a new project, Git LFS media included (`server/src/importer.ts`); built for `heygen-com/hyperframes-launches` |
| `POST /api/v1/projects/:p/renders`                  | queue `hyperframes render` → job (202)                                   |
| `GET /api/v1/renders[/:id][?log=1]`, `DELETE /api/v1/renders/:id`, `GET /api/v1/renders/:id/download` | jobs, status, cancel, download |
| `GET/POST /api/v1/studio`                           | which project Studio serves; switch it                                   |
| `POST /api/v1/cli`                                  | run an allowlisted subcommand (`server/src/util/cli.ts`)                 |
| `GET /api/v1/skills`, `GET /skills/<skill>/<path>`  | skills catalog; raw skill files                                          |

Render jobs run through a queue sized by `maxConcurrentRenders`. Records persist under `/data/startos/jobs/`; jobs active during a restart are marked `interrupted`. Output lands in the project's `renders/`; `png-sequence` and `hls` produce directories.

`run_cli` / `POST /api/v1/cli` allow: `add audio beats capture catalog check clean compare compositions docs doctor figma grade-compare history info keyframes lint media-treatment media-use models normalize-audio remove-background render snapshot timeline transcribe tts upgrade`. Refused: `publish cloud lambda cloudrun auth feedback telemetry events preview play present open browser init skills catch-up`, `--docker`, `--file-issue`. `audio` runs its local signal analysis only: the hosted analysis provider needs `HYPERFRAMES_AUDIO_API_URL` and `HYPERFRAMES_AUDIO_API_KEY`, which the image never sets, and Beat This! needs a Python the image does not ship, so nothing is uploaded. `upgrade` is limited to `--check` and `--project` (plus `--json`): bare `upgrade` prompts, and `upgrade --yes` would replace the CLI the image pins.

`fetch_asset` / `POST /api/v1/projects/:p/fetch` downloads only from public hosts. The server resolves the name, refuses loopback, RFC 1918, link-local (including `169.254.169.254`), multicast, unique-local and `.local`/`.internal`/`.lan`/`.home.arpa` targets, connects to the address it vetted, applies the same rule to every redirect (5 at most), and streams the body to a `.part` file next to the destination with a 512 MiB limit on the bytes that actually arrive (`server/src/util/net.ts`).

## MCP Server

`POST <api>/mcp`, Streamable HTTP, stateless (`sessionIdGenerator: undefined`, JSON responses enabled), built with `@modelcontextprotocol/sdk`. Tools: `server_info doctor list_projects create_project import_project get_project delete_project list_files read_file write_file delete_file fetch_asset lint check snapshot timeline project_info catalog_search catalog_item catalog_add render_video get_render_status list_renders cancel_render studio_status studio_open run_cli list_skills read_skill list_skill_files`. `snapshot` returns PNGs as image content. Resources: `hyperframes://skills/{skill}/{path}` and `hyperframes://server/info`. Tool names shared with HeyGen's hosted connector (`list_projects`, `get_project`, `render_video`, `get_render_status`) keep the same meaning.

## Skills Library

`skills/` holds the StartOS-specific skills; the upstream skills come from the `hyperframes/` submodule; all eight community skills come from the `community-skills/` submodule (`heygen-com/hyperframes-community-skills`, pinned); the three HeyGen agent skills (`heygen-avatar`, `heygen-video`, `heygen-translate`) are a vendored copy of `heygen-com/skills` in `heygen-skills/`, with the upstream commit and the deployment edits listed in `heygen-skills/README.md`. All four trees are copied into the image and served at `/skills/` and as MCP resources, in that precedence order (`HF_SKILLS_DIRS`). The two history-film skills receive documented instruction overlays from `community-adaptations/`; they require explicit source consent and owner approval and are for private/internal demonstrations, not marketing. Community and HeyGen skills run on the agent's own machine, not on this server; `skills/README.md` has the routing tables.

## Studio on a Phone

Upstream Studio lays its panels out with a fixed floor: a 360 px preview plus two 120 px side columns. On any viewport under 600 px wide the dock overflows and clips by design, and the header's Export button sits off-screen. This package adds a phone overlay at image build time (`assets/studio-mobile.css`, `assets/studio-mobile.js`, installed by `assets/patch-studio.mjs` into the CLI's `dist/studio`): under 600 px the header wraps, the desktop-app button is hidden, the side groups are closed once so the preview and timeline take the full width, and a bottom bar offers **Preview**, **Timeline** (maximize or restore that group) and **Panels** (Studio's own Window menu, where every panel and Reset layout live). The overlay drives Studio only through controls Studio renders itself, so it needs no change to the upstream bundle; the patch fails the image build if those controls disappear in a newer Studio, and the files are served under content-hashed names because the studio server marks `/assets/*` immutable. Nothing changes at 600 px and above. Landscape phones and tablets fit without it.

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
3. **Optional local models are not bundled.** whisper.cpp, Kokoro, Parakeet, Beat This! and local music generation need their own runtimes/weights (see above); no large models are silently downloaded at build time. Hosted voices additionally require working provider authorization, not merely a configured field.
4. **No hosted rendering/publishing or interactive account management.** `publish`, `cloud`, `lambda`, `cloudrun`, `auth login`, the desktop-app hand-off and telemetry are disabled or refused. Optional media-use provider calls are distinct and require owner authorization.
5. **`render --docker` is unavailable**; the service already is the container, with the pinned headless shell that `--docker` would provide.
6. **Outbound network** is needed for CDN scripts in compositions (the template loads GSAP from jsDelivr), Google Fonts, the registry (`catalog`, `add`, `catalog_item`, `init --example`: `raw.githubusercontent.com`), `import_project` (`api.github.com`, `raw.githubusercontent.com`, `media.githubusercontent.com`) and provider APIs. `HF_REGISTRY_URL` points `catalog_item` at another registry; the CLI reads its own from the project's `hyperframes.json`.
7. **Low-memory detection reads host RAM**, as upstream documents for containers; force it in **Configure Rendering** on small servers.
8. **The upstream project `AGENTS.md`/`CLAUDE.md`** written by `init` tell a local agent to run `npx hyperframes`; on this server those commands map to the API (`skills/hyperframes-server`).

## Development

```sh
npm install && npm run check                       # StartOS SDK code
node node_modules/@start9labs/start-sdk/lint.mjs && npx prettier --check startos
cd server && npm ci && npm run check && npm test   # agent API and MCP server
cd server && npm audit --audit-level=high          # runtime dependency audit (must be clean)
make x86                                           # .s9pk, inside a packaging workspace with Docker
```

The `checks` job in every workflow runs the first four lines before any image is built, so a pull request, a push to `main` and a hand-pushed tag all stop at a type error, a lint or formatting finding, a failing server test or a high-severity finding in the server's dependencies.

**Root `npm audit` exception.** `npm audit --audit-level=high` at the repository root reports findings in `brace-expansion` and `js-yaml`. Both are pulled in only by the eslint tooling under `node_modules/@start9labs/start-sdk/node_modules/`, which runs the SDK lint step at build time. The bundle the package ships (`javascript/index.js`) contains neither, and nothing from the root `node_modules` enters the Docker image. The root audit therefore runs in CI as an informational step (`continue-on-error`), and the server audit is the blocking runtime gate. The exception ends with the move to `@start9labs/start-sdk` 3.x, which carries clean tooling; that upgrade changes the dependencies and manifest API and is its own, box-tested change.

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


## Upgrading to 0.8.185

Read the served `hyperframes` skill first: upstream consolidated its render contract and production workflows into seven complete skills (22 including the StartOS, community and HeyGen trees). Former standalone workflows now live under `hyperframes/references/`. Snapshot supports scoped `range`/`composition` and `review`; optional provider image descriptions are disabled on the dedicated REST/MCP snapshot operation; `run_cli` requires an explicit `--describe true` opt-in. Local rendering needs no hosted account. Existing project paths, credentials, actions and backup layout are unchanged.
