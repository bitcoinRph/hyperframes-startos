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
4. Re-read `hyperframes/packages/cli/src/docker/Dockerfile.render`: if upstream changed the Chrome install, the system packages or the Playwright pin, mirror it in `Dockerfile`.
5. Compare `hyperframes/skills/` against `skills/README.md` (skill added, renamed or removed) and against the command map in `skills/hyperframes-server/SKILL.md`. Compare `hyperframes --help` output against `allowedCliCommands` in `server/src/util/cli.ts` and the `render` flags against `server/src/jobs.ts`.
6. Run `npm run check`, then in `server/`: `npm ci && npm run check && npm test`.
7. Build and install on a StartOS box; create a project, lint, check, snapshot and render through the API; open Studio.
8. Merge to `main`. The Tag and Release workflow tags `v<version>` and publishes the `.s9pk` files as a GitHub release (see `README.md`, Releases). It needs the `DEV_KEY` secret.

## Wrapper-only changes

Keep the upstream version and increment the downstream revision in `current.ts`. Bump `HF_SERVER_VERSION` in `Dockerfile` and `version` in `server/package.json` when the API or MCP surface changes.
