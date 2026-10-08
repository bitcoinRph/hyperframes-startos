# AGENTS.md

This is a StartOS service-package repository — it builds a `.s9pk` for StartOS.

Develop it inside a StartOS packaging workspace created by `start-cli s9pk init-workspace`,
which provides the packaging guide and agent context one level up. If you're reading this in a
bare clone with no workspace, the full guide is at <https://docs.start9.com/packaging>.

**Start every task at the recipe index** — `../start-technologies/projects/start-sdk/docs/src/recipes.md`
(or <https://docs.start9.com/packaging/recipes.html>). It maps an intent ("prompt the user to create
admin credentials", "expose a web UI") to the constructs, the reference pages, and a named production
package to copy. Find the recipe before you read this package's neighbours: a package you reach by
grepping may be non-conformant, and the recipe outranks it.

Keep `README.md` (technical reference for an AI support or administering agent) and
`instructions.md` (end-user docs) in sync with your changes.

**Bugs and feature requests are GitHub issues on this repo** — file them as you find them.
Don't record work in the repo instead: no `TODO.md`, no `NOTES.md`, no `PLAN.md`. What you
verified, tried, and decided belongs in the commit message and the PR body.

## This repo

- **Three parts, three toolchains.** `startos/` is the StartOS SDK package (TypeScript, `npm run check`, the SDK lint runner, prettier). `server/` is the agent API and MCP server that runs inside the image (its own `package.json`; `npm run check && npm test` there). `Dockerfile` builds both into one image following upstream's `packages/cli/src/docker/Dockerfile.render`.
- **The `hyperframes/` submodule is documentation, not the build input.** The image installs the published `hyperframes` npm package at `HYPERFRAMES_VERSION`; the submodule provides `skills/`, `LICENSE` and the icon at the same tag. Keep the two pinned together (see `UPDATING.md`).
- **Two daemons through `Daemons.dynamic`.** `studio` runs `hyperframes preview` on the project named in `startos/studio.json`; `server` runs `/opt/hyperframes-startos/server`. Only Studio restarts when the project changes, so render jobs survive a switch. The API server writes `studio.json` atomically; the SDK watches it.
- **Credentials are enforced at the StartOS proxy** (`addSsl.auth` in `startos/interfaces.ts`): basic auth for Studio, a bearer token for the API. The server checks the bearer token again. Studio has no auth of its own, so never bind it without the gate.
- **`run_cli` is allowlisted** in `server/src/util/cli.ts`. Commands that publish, talk to a hosted account, open browsers or report telemetry stay out. A command whose safety depends on its flags gets a `flagRules` entry (today: `upgrade`, read-only and project-local forms only). Add a command there only after reading what it does in the upstream CLI source, and add a test in `server/test/units.test.ts`.
- **Outbound URLs go through `server/src/util/net.ts`.** `fetch_asset` resolves the host, refuses private and local targets, pins the connection to the vetted address, re-checks every redirect and streams with a byte limit. Any new feature that takes a URL from an agent uses `downloadToFile`, not `fetch`.
- **Studio on a phone is an overlay, not a fork.** `assets/studio-mobile.{css,js}` are linked into the installed Studio bundle by `assets/patch-studio.mjs` at image build. The script only clicks controls Studio renders (tab strip, Maximize/Restore panel, Close group, Window menu) and the patch fails the build when they are gone. Verify any change with a 390 px wide browser against a local `hyperframes preview`; `tsc` sees none of it.
- **Community skills are a third skills tree** (`community-skills/` submodule, all eight copied once in `Dockerfile`, third in `HF_SKILLS_DIRS`; the two history-film SKILL.md files get documented overlays from `community-adaptations/`). Their scripts run on the agent's machine, never on this server; `skills/README.md` routes each one. Do not add Node, Python or Puppeteer to the image to run them.
- **HeyGen's agent skills are a fourth skills tree** (`heygen-skills/`, a vendored copy of `heygen-com/skills`, served last in `HF_SKILLS_DIRS`). They are a copy, not a submodule, because a few lines are edited for this deployment; `heygen-skills/README.md` lists the upstream commit and every edit. Re-apply those edits when refreshing the copy. Like the community skills, they run on the agent's machine (the `heygen` CLI or HeyGen MCP), never on this server.
- **Skills in `skills/` are StartOS-specific.** Upstream skills are served from the submodule; do not copy them here. When upstream renames a command or a skill, update `skills/hyperframes-server/SKILL.md` (the command map) and `skills/README.md`.
- **Verification that counts**: a green `tsc` proves little. The server has a local test path: install `hyperframes@<version>` in a scratch directory, run `server/dist/main.js` with `HF_CLI`, `HYPERFRAMES_PROJECTS_DIR`, `HF_API_KEY` and `PUPPETEER_EXECUTABLE_PATH` pointing at a Chromium, then create a project, lint, check, snapshot and render through `/api/v1` and `/mcp`.
