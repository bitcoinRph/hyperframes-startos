# Skills library

Ready-made skills for AI agents that make video with this HyperFrames server. Two sets live here (the community and HeyGen trees below come from their own directories):

1. **Upstream HyperFrames skills** (7). They are the official skills from [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) at the version this package wraps. They are in the `hyperframes/skills/` submodule of this repository, and the service serves the same files at `/skills/<name>/` and as MCP resources (`hyperframes://skills/<name>/SKILL.md`). Do not copy them into this directory. Update them by moving the submodule (see `UPDATING.md`).
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
| `/hyperframes-voicestudio`         | The server has VoiceStudio installed (`voicestudio_status`) and the video needs narration, word-timed captions, a cloned or designed voice, or a dub. Audio is written straight into the project.                                  |
| `/hyperframes-launch-references`   | HeyGen's launch films as study material and as four re-brandable templates: what the repository holds, `import_project`, the re-brand recipe, the media license limits. |

## Upstream skills (served from the service)

Upstream 0.8.185 consolidated 21 standalone skills into **seven** complete trees. Removed slugs are not served from older releases.

| Skill | Purpose |
| --- | --- |
| `/hyperframes` | Read first: render contract, workflows under `references/`, including launch, explainer, music, captions and overlays |
| `/hyperframes-cli` | CLI loop, scoped check and snapshot review, rendering and diagnostics |
| `/hyperframes-registry` | Catalog blocks and components |
| `/media-use` | Media acquisition, processing and optional providers |
| `/figma` | Figma import (optional token) |
| `/remotion-to-hyperframes` | Remotion migration |
| `/slideshow` | Interactive decks |

The entire matching upstream tree is copied, including supporting references, scripts and assets. On this server shell commands become tool calls; `/hyperframes-server` carries the mapping. Older community instructions may name retired standalone skills; use `hyperframes/references/` instead of installing stale skills to restore an old count.

## Community skills (served from the service, run on your machine)

Eight skills from [heygen-com/hyperframes-community-skills](https://github.com/heygen-com/hyperframes-community-skills) (pinned in the `community-skills/` submodule) are served as a third tree. Upstream's caution applies: they are not curated, and a skill can run commands or call network services, so read a skill's `SKILL.md` and scripts before you follow it. Their scripts (Node, Python, Puppeteer, FFmpeg) run on the agent's own machine; this server runs only `hyperframes` commands. Build locally, then bring the project here with `import_project` from your own repository, `upload`, or `write_file`, and lint, check, review and render on the server.

| Skill                  | Use for                                                        | Runs on the agent's machine                              | Comes to the server as            |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| `/vox-explainer`       | 60–90 s collage explainers from a topic, document or link      | Node 22 seam scripts and a local Chrome for the seam gate; the rest is a prose workflow | `create_project` + `write_file`; `tts` via `run_cli` |
| `/camera-3d-captions`  | Captions in 3D space around a talking head                     | Python (fonttools, numpy, pillow), a word-level transcriber, FFmpeg | the kit JS and the composition via `write_file` or `upload` |
| `/duo`                 | Two UI screens on a foldable-phone plate, side by side         | Node 18, one build script                                | the generated project via `import_project` or `upload` |
| `/p5-paint-animation`  | Handwriting, paint-on and living-painting animations           | Node, Puppeteer with Chrome, p5, FFmpeg (about 500 MB)   | rendered frames or clips via `upload` |
| `/prod-by-claude`      | Strudel live-coding music videos                               | Puppeteer, Chrome for Testing, a 5–7 min recording       | the generated project via `upload` |
| `/x-posting-license`   | Animated "posting license" card for an X profile               | Node; calls `api.fxtwitter.com`                          | the generated project via `upload` |
| `/day-in-my-life` | Ink animation of an approved real work session; internal/personal only | Writable private job copy, Node/Puppeteer, compatible Python/NumPy/SciPy, FFmpeg | private local film; no private-history upload |
| `/session-story` | Watercolour work-session film from approved real receipts; internal/personal only | Writable private job copy, Node/Python, FFmpeg; Linux: FluidSynth + licensed soundfont | private local film; no private-history upload |

These two are newly served, with source-consent and pre-preview approval gates. Neither harvester supports Hermes natively, and upstream validators are not privacy enforcement. Do not automatically read chat history, memory or instruction files. Keep upstream's no-marketing restriction. `community-adaptations/README.md` documents the exact overlays and shared execution rules: fresh writable per-job copies (some helpers delete shared engine frames), compatible isolated Python, reviewed JavaScript, explicit outbound dependencies and no assumed Linux render parity. All original scripts/assets/references stay unchanged.

Install a community skill on a local agent with `npx skills add heygen-com/hyperframes-community-skills --skill <name>`.

## HeyGen skills (served from the service, run on your machine)

Three skills from [heygen-com/skills](https://github.com/heygen-com/skills), vendored in `heygen-skills/` (the upstream commit and the handful of deployment edits are listed in `heygen-skills/README.md`), are served as a fourth tree. They drive HeyGen's **hosted** products, not HyperFrames: the `heygen` CLI or the HeyGen MCP server runs on the agent's machine and bills the owner's HeyGen account. This server runs none of it. A finished HeyGen video can come here as footage (`upload` or `fetch_asset`) for `/embedded-captions`, `/talking-head-recut` or any composition.

| Skill               | Use for                                                                          | Needs on the agent's machine                              |
| ------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `/heygen-avatar`    | A persistent avatar (face + voice) for the agent, the owner or a named character | `heygen` CLI signed in, or the HeyGen MCP server          |
| `/heygen-video`     | A presenter-led video from an idea or script (HeyGen Video Agent, v3)             | same; 20–45 min per video, billed in HeyGen credits       |
| `/heygen-translate` | Dub an existing video into another language with voice clone and lip-sync        | same; billed by source minutes × languages                |

Install them on a local agent with `gh skill install heygen-com/skills <name>` or `npx skills add heygen-com/skills`.
