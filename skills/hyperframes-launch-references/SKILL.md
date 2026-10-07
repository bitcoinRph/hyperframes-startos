---
name: hyperframes-launch-references
description: >
  Use HeyGen's own launch films (github.com/heygen-com/hyperframes-launches) as reference
  material and as re-brandable templates on this server. Read it when a brief asks for a
  launch, promo, product sting, feature announcement or "something like HeyGen's videos";
  when you want a finished storyboard, script or handoff to model your plan on; or when the
  user wants a short branded motion piece fast. Covers what the repository holds, which
  projects are templates and which are study material, how to import one with
  `import_project`, how to re-brand without touching the motion, and the license limits on
  the bundled media.
---

# Launch references

HeyGen publishes the sources of its HyperFrames launch videos. Twenty project directories,
each a complete HyperFrames project: `index.html`, `compositions/`, `assets/`, fonts, and the
production documents the team wrote while making it (`BRIEF.md`, `STORYBOARD.md`, `SCRIPT.md`,
`HANDOFF.md`, `DESIGN.md`). Upstream's `/hyperframes-studio` skill names these films as the
worked example of its brief → storyboard → build order.

Two ways to use them here:

1. **Study material.** Read a storyboard, a script or a handoff from GitHub before you write
   your own. No import needed.
2. **Templates.** Import one of the four re-brandable stings, replace the brand layer, render.

## What is in the repository

Verified against commit `d7ac350` (2026-09-26) with the CLI this server pins (0.8.135).

### Re-brandable templates (`heygen-apple-motion/`)

Four finished single-file motion pieces built to be re-branded by an agent. Each has a
`README.md` written for you, a `ledger.json` of every cut, and no sub-compositions.

| Path                                  | Canvas    | Length | What it is                                                                 | Lint on 0.8.135 |
| ------------------------------------- | --------- | ------ | -------------------------------------------------------------------------- | --------------- |
| `heygen-apple-motion/01-ui-sting`     | 720×720   | 10.8 s | Sign-in card → counter → nav → click → menu → endcard, as one camera move | clean           |
| `heygen-apple-motion/02-bouncy-ui`    | 1080×1080 | 12.1 s | A prompt is typed and generated; springy 3D UI with drop shadows          | clean           |
| `heygen-apple-motion/03-message-sting`| 720×720   | 12.8 s | Tiles flip into a chat, a card docks, a store listing grows               | 1 error (autoAlpha on a clip; fix or accept) |
| `heygen-apple-motion/04-generate-reel`| 720×1280  | 11.8 s | Portrait: a phrase is selected, a glass panel fills, results whip away   | clean           |

`heygen-apple-motion/hero` is the 54 s compilation of the four with title cards.

### Launch films (study material)

Full campaign films, 1920×1080 unless noted, 30 fps. They were built on CLI 0.6.75 to 0.8.26.
On 0.8.135 most fail `lint` (media without `id`, `../assets` paths, missing `@font-face`,
pixel-snapping tweens). Treat them as references for structure, pacing and documents, not
as drop-in templates.

| Directory                              | Length | Documents                                   | Worth reading for                                      |
| -------------------------------------- | ------ | ------------------------------------------- | ------------------------------------------------------ |
| `hyperframes-launch`                   | 49.8 s | STORYBOARD, SCRIPT, HANDOFF, README         | The model storyboard: format, VO register, music direction, per-beat mood; 16 sub-compositions; a handoff that explains black-frame fixes |
| `website-to-hyperframes`               | 41.8 s | STORYBOARD, SCRIPT, README                  | Captured `<video>` compositing, per-beat VO and SFX, kinetic type |
| `claude-design-send-hyperframes-launch`| 49.3 s (1080²) | BRIEF, STORYBOARD, HANDOFF, README  | A complete BRIEF with aesthetic rules and a "faithful UI" rule; square format |
| `variables-launch`                     | 43.6 s | HANDOFF-HOOK-VARIANTS                       | Hook variants, `data-composition-variables` in practice |
| `spacex-launch`                        | 39.5 s | FRAME (design spec), design, README         | A `frame.md`-style design spec driving the whole film; SFX-heavy |
| `cloud-render-launch`, `timeline-launch`, `figma-launch`, `inspector-launch`, `sfx-music-launch`, `pr-to-video-launch`, `texture-launch-video`, `frame-md-launch-storyboard` | 22–64 s | mostly STORYBOARD + HANDOFF | Feature-announcement structure: hook, demo beats, proof, CTA |
| `codex-five-hour-limit-replica`        | 10.1 s (3840×2160) | STORYBOARD, HANDOFF            | A faithful UI replica at 4K |
| `claude-paper-launch`                  | 53.3 s | FRAME-claude                                | Paper-grain aesthetic, Lottie, 89 placed audio cues |
| `HF-heygen-stripe`, `vfx-heygen-combined`, `liquid-brand-refraction`, `k3-promo` | 6–39 s | varies | Brand-collab and VFX pieces (Three.js models, shader refraction) |

## Read without importing

Text files are served raw. Media and fonts are in Git LFS: the raw host returns a 131-byte
pointer, the media host returns the file.

```
https://raw.githubusercontent.com/heygen-com/hyperframes-launches/main/<dir>/STORYBOARD.md
https://media.githubusercontent.com/media/heygen-com/hyperframes-launches/main/<dir>/assets/<file>
```

Read the storyboard and script of the film closest to your brief before you write
`BRIEF.md` and `STORYBOARD.md`. Copy the shape, not the content: format line, VO direction,
music direction, global style guardrails, then beats with timecodes, on-screen action and
VO line. The rendered films are on `hyperframes.dev/viewer/...` links in the repository
README; watch one if you can, it shows the pacing the storyboard describes.

## Import a project onto this server

```json
import_project { "name": "acme-sting", "repo": "heygen-com/hyperframes-launches", "path": "heygen-apple-motion/01-ui-sting" }
```

REST: `POST /api/v1/projects/import` with the same body. The server copies every file under
the path, fetches LFS media in full, and returns the project summary plus `files`,
`lfsFiles`, `bytes` and the source commit. The directory must hold an `index.html`. Limits:
2000 files, 512 MiB per file, 2 GiB in total. Public repositories only; the server's
public-host policy applies to the GitHub hosts too.

Then: `read_file README.md`, `lint`, and `studio_open` so the user can watch it before you
change anything.

## Re-brand a template

The template READMEs set the rules. In short:

1. **Capture the brand instead of guessing it.** `run_cli ["capture", "https://<their-site>", "--json"]`
   in the project writes `capture/` with logo SVGs, screenshots, colors and font references.
   No site: ask for a logo and two or three hex values.
2. **Keep the motion.** Every frame number, ease and stamped track stays. Change copy strings,
   palette values, the marks in `assets/`, the `@font-face` block, the icon paths and the
   card internals. The README lists exactly which identifiers are yours to change.
3. **Fill the story slots** with surfaces the product really has. A design tool has files and
   frames; a payments app has balances. Product language is most of what makes it theirs.
4. **Fonts.** The templates ship TT Norms Pro and ABC Solar Display, commercial faces. Unless
   the user holds a license, delete `assets/fonts/` and the two `@font-face` blocks; the
   stack falls back to `sans-serif` and the layout holds. Register any replacement under a
   private family name, as the template does, so the renderer cannot alias it silently.
5. **Check.** `lint`, then `check` with `snapshots: true`, then `snapshot` at each cut listed
   in `ledger.json`. The endcard says "Made with HyperFrames"; keep or replace it as the user
   wants.

## License, stated once

Composition code, configuration and documents in the repository are Apache-2.0. Bundled
media, brand assets and fonts are **not**: HeyGen logos, product screenshots, music, voice
tracks and the commercial fonts keep their owners' terms. A re-brand must replace them. The
Apache license grants no trademark rights, so HeyGen marks never ship in a user's video.

## When not to use this

- A talking-head, captions or music-video brief: use the upstream workflow for it.
- A brief that needs a longer narrative than a 10–13 s sting: import a film for study, then
  build from `create_project` with the registry (`/hyperframes-registry`) rather than
  repairing a 2026-era film.
