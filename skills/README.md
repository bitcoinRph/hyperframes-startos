# Skills library

Ready-made skills for AI agents that make video with this HyperFrames server. Two sets live here (the community and HeyGen trees below come from their own directories):

1. **Upstream HyperFrames skills** (21). They are the official skills from [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) at the version this package wraps. They are in the `hyperframes/skills/` submodule of this repository, and the service serves the same files at `/skills/<name>/` and as MCP resources (`hyperframes://skills/<name>/SKILL.md`). Do not copy them into this directory. Update them by moving the submodule (see `UPDATING.md`).
2. **StartOS skills** (this directory). They teach an agent how to use the upstream skills **through this server**, where the agent has no local shell on the machine that renders.

Install into a local agent with the skills CLI, or point the agent at the served copies:

```bash
# Local install (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Hermes Agent, OpenClaw)
npx skills add bitcoinRph/hyperframes-startos           # the StartOS skills in this directory
npx skills add heygen-com/hyperframes                    # the upstream skills

# Or read them from the running service (API key required)
curl -H "Authorization: Bearer $HF_API_KEY" https://<api-address>/skills/hyperframes-server/SKILL.md
```

## StartOS skills

| Skill                              | Read it when                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/hyperframes-server`              | **Read first.** Making a video on this server from any agent: the project model, the tool map from `npx hyperframes <cmd>` to API and MCP calls, the production loop, review and delivery. |
| `/hyperframes-startos-connect`     | Connecting a client: Claude Code, Codex, Hermes Agent, OpenClaw, Claude.ai, and any streamable-HTTP MCP client. Certificates, Tor, API key handling, troubleshooting.  |
| `/hyperframes-production-checklist`| The pre-render and pre-delivery gates: lint and check results, frame review, audio, variables, output format, file sizes.                                           |
| `/hyperframes-launch-references`   | HeyGen's launch films as study material and as four re-brandable templates: what the repository holds, `import_project`, the re-brand recipe, the media license limits. |

## Upstream skills (served from the service)

Routing and workflows:

| Skill                      | Use when                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/hyperframes`             | Read first for any request to make, edit, animate or render a video; the intent layer and the router to the workflows below. |
| `/product-launch-video`    | A website or product → launch, promo, site tour, up to about 3 minutes.                                                      |
| `/faceless-explainer`      | Arbitrary text → an explainer with invented visuals.                                                                         |
| `/pr-to-video`             | A GitHub pull request → a code-change explainer.                                                                             |
| `/embedded-captions`       | Captions on existing talking-head footage.                                                                                   |
| `/talking-head-recut`      | Designed graphic overlays on existing talking-head footage.                                                                  |
| `/motion-graphics`         | A short, unnarrated motion graphic (kinetic type, stat hit, logo sting, lower third).                                        |
| `/music-to-video`          | A music track → a beat-synced video.                                                                                         |
| `/slideshow`               | A presentation or interactive deck (a navigable page, not a rendered video).                                                 |
| `/general-video`           | Anything else, and companion mode.                                                                                           |
| `/remotion-to-hyperframes` | Port a Remotion composition to HyperFrames HTML.                                                                             |

Domain skills:

| Skill                    | Covers                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `/hyperframes-core`      | The composition contract: `data-*` timing, clips, tracks, sub-compositions, variables, determinism. |
| `/hyperframes-animation` | Motion rules, scene blueprints, transitions, runtime adapters (GSAP, CSS, Lottie, Three.js, Anime.js, WAAPI, TypeGPU). |
| `/hyperframes-keyframes` | Seek-safe keyframes: zooms, reframes, Ken Burns, paths, masks, SVG, 3D.                            |
| `/hyperframes-creative`  | Design specs (`frame.md`), palettes, typography, narration, beat planning.                         |
| `/media-use`             | Sourcing and generating media: music, SFX, images, logos, voice, grades, captions, background removal. |
| `/hyperframes-audio`     | Mixing placed audio: carve, effects, automation, submix buses.                                     |
| `/hyperframes-cli`       | The CLI loop: init, lint, check, snapshot, render, batch render, diagnostics.                      |
| `/hyperframes-registry`  | Finding and installing catalog blocks and components.                                               |
| `/hyperframes-studio`    | Studio conventions: timeline layout, safe zones, when a message is an edit.                        |
| `/figma`                 | Importing Figma assets, tokens, components and storyboards.                                        |

On this server the upstream skills' shell commands become tool calls. `/hyperframes-server` carries the mapping.

## Community skills (served from the service, run on your machine)

Six skills from [heygen-com/hyperframes-community-skills](https://github.com/heygen-com/hyperframes-community-skills) (pinned in the `community-skills/` submodule) are served as a third tree. Upstream's caution applies: they are not curated, and a skill can run commands or call network services, so read a skill's `SKILL.md` and scripts before you follow it. Their scripts (Node, Python, Puppeteer, FFmpeg) run on the agent's own machine; this server runs only `hyperframes` commands. Build locally, then bring the project here with `import_project` from your own repository, `upload`, or `write_file`, and lint, check, review and render on the server.

| Skill                  | Use for                                                        | Runs on the agent's machine                              | Comes to the server as            |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| `/vox-explainer`       | 60–90 s collage explainers from a topic, document or link      | Node 22 seam scripts and a local Chrome for the seam gate; the rest is a prose workflow | `create_project` + `write_file`; `tts` via `run_cli` |
| `/camera-3d-captions`  | Captions in 3D space around a talking head                     | Python (fonttools, numpy, pillow), a word-level transcriber, FFmpeg | the kit JS and the composition via `write_file` or `upload` |
| `/duo`                 | Two UI screens on a foldable-phone plate, side by side         | Node 18, one build script                                | the generated project via `import_project` or `upload` |
| `/p5-paint-animation`  | Handwriting, paint-on and living-painting animations           | Node, Puppeteer with Chrome, p5, FFmpeg (about 500 MB)   | rendered frames or clips via `upload` |
| `/prod-by-claude`      | Strudel live-coding music videos                               | Puppeteer, Chrome for Testing, a 5–7 min recording       | the generated project via `upload` |
| `/x-posting-license`   | Animated "posting license" card for an X profile               | Node; calls `api.fxtwitter.com`                          | the generated project via `upload` |

Not served: `day-in-my-life` and `session-story`. They film the agent's own chat history from `~/.claude`; upstream says they are not for marketing or anyone else's content.

Install a community skill on a local agent with `npx skills add heygen-com/hyperframes-community-skills --skill <name>`.

## HeyGen skills (served from the service, run on your machine)

Three skills from [heygen-com/skills](https://github.com/heygen-com/skills), vendored in `heygen-skills/` (the upstream commit and the handful of deployment edits are listed in `heygen-skills/README.md`), are served as a fourth tree. They drive HeyGen's **hosted** products, not HyperFrames: the `heygen` CLI or the HeyGen MCP server runs on the agent's machine and bills the owner's HeyGen account. This server runs none of it. A finished HeyGen video can come here as footage (`upload` or `fetch_asset`) for `/embedded-captions`, `/talking-head-recut` or any composition.

| Skill               | Use for                                                                          | Needs on the agent's machine                              |
| ------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `/heygen-avatar`    | A persistent avatar (face + voice) for the agent, the owner or a named character | `heygen` CLI signed in, or the HeyGen MCP server          |
| `/heygen-video`     | A presenter-led video from an idea or script (HeyGen Video Agent, v3)             | same; 20–45 min per video, billed in HeyGen credits       |
| `/heygen-translate` | Dub an existing video into another language with voice clone and lip-sync        | same; billed by source minutes × languages                |

Install them on a local agent with `gh skill install heygen-com/skills <name>` or `npx skills add heygen-com/skills`.
