# Updating the upstream version

This package wraps [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes). "Upstream" means that monorepo. The runtime comes from the `hyperframes` npm package it publishes; the `hyperframes/` git submodule holds the matching source, used for the skills library, the LICENSE symlink and the icon.

## Where the version lives

Four places must agree:

| Place                                  | What                                                        |
| -------------------------------------- | ----------------------------------------------------------- |
| `startos/versions/current.ts`          | `version: '<upstream>:<downstream>'`                        |
| `Dockerfile`                           | `ARG HYPERFRAMES_VERSION=<upstream>` (the npm tag installed) |
| `hyperframes/` submodule               | checked out at tag `v<upstream>`                            |
| `skills/README.md`                     | the upstream skill count, if it changed                     |

## Determining the upstream version

```sh
npm view hyperframes version                 # the published CLI
git -C hyperframes fetch --depth 1 origin tag v<version>
```

Releases are tagged `v<version>` and documented in `hyperframes/releases/v<version>.md`; the npm version and the git tag carry the same number.

## Applying the bump

1. Move the submodule: `git -C hyperframes fetch --depth 1 origin tag v<version> && git -C hyperframes checkout v<version>`.
2. Set `HYPERFRAMES_VERSION` in `Dockerfile`.
3. Edit `startos/versions/current.ts`: new upstream version, downstream `0`, release notes summarizing `hyperframes/releases/v<version>.md` in every locale.
4. Re-read `hyperframes/packages/cli/src/docker/Dockerfile.render`: if upstream changed the Chrome install, the system packages, the Playwright pin or the static FFmpeg pin (`FFMPEG_RELEASE`, `FFMPEG_BUILD` and both sha256s), mirror it in `Dockerfile`.
5. Compare `hyperframes/skills/` against `skills/README.md` (skill added, renamed or removed) and against the command map in `skills/hyperframes-server/SKILL.md`. Compare `hyperframes --help` output against `allowedCliCommands` in `server/src/util/cli.ts` and the `render` flags against `server/src/jobs.ts`.
6. Studio on a phone: `assets/studio-mobile.js` drives Studio's own controls (the tab strip, "Maximize panel", "Restore panel", "Close group", the "Window" menu). `assets/patch-studio.mjs` fails the image build when those strings leave the bundle; when it does, read `hyperframes/packages/studio/src/components/dock/` and `StudioHeader.tsx` for the new names, and re-check the header selector (`#root > div > div:first-child`) and the 600 px floor (`MIN_PREVIEW_W`, `MIN_SIDE_W_FLOOR` in `dockLayout.ts`). Verify with a 390 px wide browser: side groups closed, Export visible, the bar's three buttons work.
7. Community skills: `git -C community-skills fetch --depth 1 origin && git -C community-skills checkout origin/master`; read the diff of every copied skill's `SKILL.md` and scripts before moving the pin (they run on agent machines, and upstream warns they are not curated). All eight are copied once from the complete tree. Review additions/removals, update the routing table and exact inventory assertion in `server/test/skills-library.test.ts`, and regenerate the two SKILL.md overlays per `community-adaptations/README.md`. Preserve the declared deployment section and do not change creative assets or scripts without separate review.
8. HeyGen skills (`heygen-skills/`, a vendored copy, not a submodule): follow "Refreshing the copy" in `heygen-skills/README.md` and re-apply the edits listed there.
9. Run `npm run check`, then in `server/`: `npm ci && npm run check && npm test`.
10. Build and install on a StartOS box; create a project, lint, check, snapshot and render through the API; open Studio.
11. Merge to `main`. The Tag and Release workflow tags `v<version>` and publishes the `.s9pk` files as a GitHub release (see `README.md`, Releases). A `DEV_KEY` secret is optional; see `README.md`, Releases.

## Wrapper-only changes

Keep the upstream version and increment the downstream revision in `current.ts`. Bump `HF_SERVER_VERSION` in `Dockerfile` and `version` in `server/package.json` when the API or MCP surface changes.
